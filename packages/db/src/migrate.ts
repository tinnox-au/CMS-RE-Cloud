import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

export interface MigrationOptions {
  /** Connection string for role tinnox_migrator. */
  readonly connectionString: string;
  /** Directory holding NNNN_name.sql files. */
  readonly directory: string;
  readonly log?: (message: string) => void;
}

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

const FILE_PATTERN = /^([0-9]{4})_[a-z0-9_]+\.sql$/;
/** Arbitrary constant; serialises concurrent migration runs on one database. */
const ADVISORY_LOCK_KEY = 7_411_660_001;

/**
 * Applies pending SQL migrations in file-name order. Each file runs in its own
 * transaction together with its schema_migrations row, so a failure leaves no
 * partial migration. An applied file whose content changed is an error.
 */
export async function runMigrations(options: MigrationOptions): Promise<MigrationResult> {
  const log = options.log ?? (() => undefined);
  const names = (await readdir(options.directory)).filter((n) => n.endsWith('.sql')).sort();
  const versions = new Set<string>();
  for (const name of names) {
    const match = FILE_PATTERN.exec(name);
    if (match === null || match[1] === undefined) {
      throw new Error(`migration file name must look like 0001_description.sql: ${name}`);
    }
    if (versions.has(match[1])) throw new Error(`duplicate migration number ${match[1]}`);
    versions.add(match[1]);
  }

  const client = new pg.Client({
    connectionString: options.connectionString,
    application_name: 'tinnox-migrate',
  });
  await client.connect();
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  try {
    const who = await client.query<{ current_user: string }>('SELECT current_user');
    if (who.rows[0]?.current_user !== 'tinnox_migrator') {
      throw new Error('migrations must run as role tinnox_migrator');
    }
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        name       text PRIMARY KEY,
        sha256     text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const done = await client.query<{ name: string; sha256: string }>(
      'SELECT name, sha256 FROM public.schema_migrations',
    );
    const doneByName = new Map(done.rows.map((r) => [r.name, r.sha256]));

    for (const name of names) {
      const sql = await readFile(join(options.directory, name), 'utf8');
      const digest = createHash('sha256').update(sql).digest('hex');
      const previous = doneByName.get(name);
      if (previous !== undefined) {
        if (previous !== digest) {
          throw new Error(
            `migration ${name} was changed after it was applied; add a new migration instead`,
          );
        }
        alreadyApplied.push(name);
        continue;
      }
      log(`applying ${name}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migrations (name, sha256) VALUES ($1, $2)', [
          name,
          digest,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`migration ${name} failed: ${message}`, { cause: error });
      }
      applied.push(name);
    }
    for (const name of doneByName.keys()) {
      if (!names.includes(name))
        throw new Error(`database has migration ${name} that is missing from ${options.directory}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
  return { applied, alreadyApplied };
}

/**
 * TEST DATABASES ONLY. Drops everything the migrator owns in schemas public and
 * sec so migrations can run from scratch. Refuses any database whose name does
 * not end in `_test`.
 */
export async function resetTestDatabase(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString, application_name: 'tinnox-test-reset' });
  await client.connect();
  try {
    const db = await client.query<{ name: string }>('SELECT current_database() AS name');
    const name = db.rows[0]?.name ?? '';
    if (!name.endsWith('_test')) {
      throw new Error(`refusing to reset database "${name}": only *_test databases may be reset`);
    }
    await client.query('DROP SCHEMA IF EXISTS sec CASCADE');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}
