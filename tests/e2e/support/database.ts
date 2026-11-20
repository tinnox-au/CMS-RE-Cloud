/**
 * The end-to-end run uses its own database, `tinnox_e2e_test`, rebuilt from the migrations
 * and the seed at the start of every run, and its own media directory. The development
 * database (`tinnox`) and `data/media` are never touched, so the run leaves no displays,
 * publications or files behind there. (Publications are immutable and cannot be deleted,
 * so a shared database would only ever grow.)
 *
 * The media-worker container is shared with development: it watches `data/jobs`, which
 * the E2E API therefore also uses. Do not run the development API at the same time.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetTestDatabase, runMigrations } from '@tinnox/db';
import pg from 'pg';

// Not imported from stack.ts, which imports this module.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const runDir = join(repoRoot, 'tests', '.run');
// Test worker processes need the connection settings too; values already set win.
if (existsSync(join(repoRoot, '.env'))) process.loadEnvFile(join(repoRoot, '.env'));

export const E2E_DATABASE = 'tinnox_e2e_test';

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set; run npm run setup`);
  return value;
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** Connection strings for the E2E database, derived from the development ones in .env. */
export function e2eUrls(): { app: string; migrator: string } {
  return {
    app: withDatabase(need('DATABASE_URL'), E2E_DATABASE),
    migrator: withDatabase(need('DATABASE_MIGRATOR_URL'), E2E_DATABASE),
  };
}

/** Media storage of the E2E API (gitignored, under tests/.run). */
export const e2eMediaRoot = join(runDir, 'media');

/**
 * Creates the database once (as the cluster superuser, the only role allowed to), then
 * empties it, applies every migration and seeds both organisations (the first one with one
 * member per role: Owner, Admin, Editor and Viewer).
 */
export async function prepareE2eDatabase(): Promise<void> {
  const admin = new URL(need('DATABASE_MIGRATOR_URL'));
  admin.username = 'postgres';
  admin.password = encodeURIComponent(need('POSTGRES_SUPERUSER_PASSWORD'));
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      E2E_DATABASE,
    ]);
    if (exists.rowCount === 0) {
      // Fixed identifier, same settings as tinnox_test in infra/postgres/init/01-roles.sh.
      await client.query(`CREATE DATABASE ${E2E_DATABASE} OWNER tinnox_migrator ENCODING 'UTF8'`);
      await client.query(`REVOKE ALL ON DATABASE ${E2E_DATABASE} FROM PUBLIC`);
      await client.query(`GRANT CONNECT ON DATABASE ${E2E_DATABASE} TO tinnox_app`);
      await client.query(`ALTER DATABASE ${E2E_DATABASE} SET timezone = 'UTC'`);
    }
  } finally {
    await client.end();
  }
  const urls = e2eUrls();
  await resetTestDatabase(urls.migrator);
  await runMigrations({
    connectionString: urls.migrator,
    directory: join(repoRoot, 'db', 'migrations'),
  });
  execFileSync(
    process.execPath,
    ['--import', 'tsx', join(repoRoot, 'scripts', 'seed.ts'), '--second-org'],
    {
      cwd: repoRoot,
      // The seed's notes stay quiet; a failure prints its reason (stderr) in the run's output.
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, DATABASE_MIGRATOR_URL: urls.migrator },
    },
  );
}
