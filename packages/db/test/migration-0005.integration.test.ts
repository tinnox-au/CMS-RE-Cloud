/**
 * Upgrade test for migration 0005 on a database that already holds data.
 *
 * The integration run normally builds the test database from zero, so a backfill
 * would have nothing to do. This file rebuilds the test database at migration 0004,
 * fills it as an M0 installation would be (two organisations, displays with and
 * without publications), then applies 0005 with the real migration runner and checks
 * the result: the assigned playlists, and that forced row-level security, which the
 * backfill lifts inside its transaction, is back on every table.
 *
 * Before that, it applies a copy of 0005 that fails in the middle of the backfill, at
 * the point where forced row-level security is lifted and a trigger is disabled, and
 * checks that the database is exactly as it was at 0004: nothing of a failed migration
 * may stay behind, least of all a table without forced row-level security.
 *
 * It resets the shared integration-test database. Integration files run one at a
 * time and each arranges its own data, so the others are unaffected; `afterAll`
 * always leaves the database at the newest migration.
 */
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  resetTestDatabase,
  runMigrations,
  withOrg,
  type MigrationResult,
  type Pool,
} from '../src/index.ts';
import { appPool, migratorClient, migratorUrl } from './support.ts';

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'db',
  'migrations',
);
const TARGET = '0005_portal_v2_stage_a.sql';
/** A fixed instant in the past, so an accidental `updated_at = now()` is unmistakable. */
const LONG_AGO = '2026-11-01T00:00:00.000Z';

interface LegacyDisplay {
  readonly id: string;
  /** What the backfill must assign. */
  readonly expected: string | null;
}

interface LegacyOrg {
  readonly orgId: string;
  readonly playlists: readonly [string, string];
  readonly displays: Readonly<
    Record<
      'publishedOnce' | 'republished' | 'olderDesired' | 'neverPublished' | 'noDeliveryRow',
      LegacyDisplay
    >
  >;
}

/**
 * Inserts one organisation using only what exists at migration 0004. As at run time,
 * the owner needs the organisation context, because row-level security is forced.
 */
async function createLegacyOrg(migrator: pg.Client, name: string): Promise<LegacyOrg> {
  const orgId = randomUUID();
  const siteId = randomUUID();
  const membershipId = randomUUID();
  const mediaId = randomUUID();
  const first = randomUUID();
  const second = randomUUID();

  const display = async (label: string): Promise<string> => {
    const id = randomUUID();
    await migrator.query(
      `INSERT INTO display (id, org_id, site_id, name, canvas_width, canvas_height, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 640, 360, $5, $5)`,
      [id, orgId, siteId, `${name} ${label}`, LONG_AGO],
    );
    return id;
  };
  /** One publication of `playlistId` to `displayId`, `minutesAgo` minutes old. */
  const publish = async (
    displayId: string,
    playlistId: string,
    minutesAgo: number,
  ): Promise<string> => {
    const id = randomUUID();
    const manifest = {
      schemaVersion: 1,
      publicationId: id,
      displayId,
      assets: [{ assetId: mediaId }],
    };
    await migrator.query(
      `INSERT INTO publication (id, org_id, display_id, playlist_id, manifest, idempotency_key, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() - make_interval(mins => $8))`,
      [
        id,
        orgId,
        displayId,
        playlistId,
        JSON.stringify(manifest),
        `legacy-${randomUUID()}`,
        membershipId,
        minutesAgo,
      ],
    );
    return id;
  };
  const deliver = (displayId: string, desiredPublicationId: string | null) =>
    migrator.query(
      `INSERT INTO display_delivery (display_id, org_id, desired_publication_id, desired_at)
       VALUES ($1, $2, $3, CASE WHEN $3::uuid IS NULL THEN NULL ELSE now() END)`,
      [displayId, orgId, desiredPublicationId],
    );

  await migrator.query('BEGIN');
  try {
    await migrator.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    await migrator.query('INSERT INTO organization (id, name) VALUES ($1, $2)', [orgId, name]);
    await migrator.query(
      "INSERT INTO site (id, org_id, name, timezone) VALUES ($1, $2, $3, 'Australia/Melbourne')",
      [siteId, orgId, `${name} site`],
    );
    await migrator.query('INSERT INTO membership (id, org_id, oidc_sub) VALUES ($1, $2, $3)', [
      membershipId,
      orgId,
      `legacy-sub-${randomUUID()}`,
    ]);
    await migrator.query(
      `INSERT INTO media (id, org_id, kind, status, mime_type, bytes, sha256, width, height, storage_key, original_name)
       VALUES ($1, $2, 'image', 'ready', 'image/png', 10, $3, 4, 4, $4, 'pixel.png')`,
      [mediaId, orgId, 'ab'.repeat(32), `${orgId}/${randomUUID()}`],
    );
    await migrator.query(
      'INSERT INTO playlist (id, org_id, name) VALUES ($1, $3, $4), ($2, $3, $5)',
      [first, second, orgId, `${name} first`, `${name} second`],
    );
    // An audit trail from before the upgrade: 0005 adds a column to these rows.
    await migrator.query(
      `INSERT INTO audit_event (org_id, actor_type, actor_id, action, object_type, object_id, result)
       VALUES ($1, 'operator', $2, 'playlist.create', 'playlist', $3, 'success'),
              ($1, 'operator', $2, 'publication.create', 'playlist', $3, 'failure')`,
      [orgId, membershipId, first],
    );

    // Published once: the desired publication is the only one.
    const publishedOnce = await display('published once');
    await deliver(publishedOnce, await publish(publishedOnce, first, 30));

    // Published twice with different playlists: the later one is desired.
    const republished = await display('republished');
    await publish(republished, first, 30);
    await deliver(republished, await publish(republished, second, 10));

    // The desired publication is not the newest one: "desired" decides, not "latest".
    const olderDesired = await display('older desired');
    const older = await publish(olderDesired, second, 30);
    await publish(olderDesired, first, 10);
    await deliver(olderDesired, older);

    // A player has reported, but nothing was ever published.
    const neverPublished = await display('never published');
    await deliver(neverPublished, null);

    // Created and left alone.
    const noDeliveryRow = await display('no delivery row');

    await migrator.query('COMMIT');
    return {
      orgId,
      playlists: [first, second],
      displays: {
        publishedOnce: { id: publishedOnce, expected: first },
        republished: { id: republished, expected: second },
        olderDesired: { id: olderDesired, expected: second },
        neverPublished: { id: neverPublished, expected: null },
        noDeliveryRow: { id: noDeliveryRow, expected: null },
      },
    };
  } catch (error) {
    await migrator.query('ROLLBACK');
    throw error;
  }
}

let migrator: pg.Client;
let pool: Pool;
let scratch: string;
let a: LegacyOrg;
let b: LegacyOrg;
let upgrade: MigrationResult;

/** What can be seen of the schema and the data without an organisation context. */
interface SchemaSnapshot {
  readonly migrations: string[];
  readonly tables: { name: string; rowSecurity: boolean; forced: boolean }[];
  readonly columns: string[];
  readonly indexes: string[];
  readonly triggers: { name: string; enabled: string }[];
  readonly functions: string[];
  readonly policies: string[];
  readonly grants: string[];
}

async function schemaSnapshot(): Promise<SchemaSnapshot> {
  const list = async <R extends pg.QueryResultRow>(sql: string): Promise<R[]> =>
    (await migrator.query<R>(sql)).rows;
  const names = async (sql: string): Promise<string[]> =>
    (await list<{ name: string }>(sql)).map((row) => row.name);
  return {
    migrations: await names('SELECT name FROM public.schema_migrations ORDER BY name'),
    tables: await list(
      `SELECT c.relname AS name, c.relrowsecurity AS "rowSecurity", c.relforcerowsecurity AS forced
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`,
    ),
    columns: await names(
      `SELECT table_name || '.' || column_name || ' ' || data_type AS name
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1`,
    ),
    indexes: await names(
      "SELECT indexdef AS name FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1",
    ),
    triggers: await list(
      `SELECT c.relname || '.' || g.tgname AS name, g.tgenabled::text AS enabled
       FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT g.tgisinternal ORDER BY 1`,
    ),
    functions: await names(
      `SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' ORDER BY 1`,
    ),
    policies: await names(
      `SELECT tablename || '.' || policyname AS name FROM pg_policies
       WHERE schemaname = 'public' ORDER BY 1`,
    ),
    grants: await names(
      `SELECT grantee || ' ' || privilege_type || ' ' || table_name || '.' || column_name AS name
       FROM information_schema.column_privileges
       WHERE table_schema = 'public' AND grantee IN ('tinnox_app', 'tinnox_definer') ORDER BY 1`,
    ),
  };
}

/** Rows of one organisation that the backfill and the audit column would touch. */
async function dataSnapshot(org: LegacyOrg): Promise<unknown> {
  return {
    displays: await asOwnerIn(
      org.orgId,
      'SELECT id, name, updated_at, xmin::text AS version FROM display ORDER BY id',
    ),
    deliveries: await asOwnerIn(
      org.orgId,
      'SELECT display_id, desired_publication_id FROM display_delivery ORDER BY display_id',
    ),
    audit: await asOwnerIn(
      org.orgId,
      'SELECT id, occurred_at, action, result, object_id FROM audit_event ORDER BY id',
    ),
  };
}

/** The line of 0005 that follows its backfill; the planted failure goes right before it. */
const AFTER_BACKFILL = 'ALTER TABLE public.display ENABLE TRIGGER display_set_updated_at;';
const PLANTED_FAILURE = 'planted failure in the middle of the backfill';

interface FailedAttempt {
  readonly error: string;
  readonly schemaBefore: SchemaSnapshot;
  readonly schemaAfter: SchemaSnapshot;
  readonly dataBefore: unknown;
  readonly dataAfter: unknown;
}
let failed: FailedAttempt;

/**
 * Applies a copy of 0005 that raises an error straight after the backfill UPDATE: forced
 * row-level security is lifted on three tables, a trigger is disabled, the new tables,
 * columns and grants exist, and displays have been assigned. Everything must be undone.
 */
async function attemptBrokenUpgrade(names: readonly string[]): Promise<FailedAttempt> {
  const original = await readFile(join(MIGRATIONS, TARGET), 'utf8');
  expect(original.split(AFTER_BACKFILL)).toHaveLength(2);
  const broken = await mkdtemp(join(tmpdir(), 'tinnox-migration-0005-broken-'));
  try {
    for (const name of names) await copyFile(join(MIGRATIONS, name), join(broken, name));
    await writeFile(
      join(broken, TARGET),
      // A replacer function: in a replacement string "$$" would be read as one "$".
      original.replace(
        AFTER_BACKFILL,
        () => `DO $$ BEGIN RAISE EXCEPTION '${PLANTED_FAILURE}'; END $$;\n${AFTER_BACKFILL}`,
      ),
    );
    const schemaBefore = await schemaSnapshot();
    const dataBefore = [await dataSnapshot(a), await dataSnapshot(b)];
    let error = 'the broken migration was applied';
    try {
      await runMigrations({ connectionString: migratorUrl(), directory: broken });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    return {
      error,
      schemaBefore,
      schemaAfter: await schemaSnapshot(),
      dataBefore,
      dataAfter: [await dataSnapshot(a), await dataSnapshot(b)],
    };
  } finally {
    await rm(broken, { recursive: true, force: true });
  }
}

/** Runs a query as the table owner inside one organisation's context. */
async function asOwnerIn<R extends pg.QueryResultRow>(
  orgId: string,
  sql: string,
  values: unknown[] = [],
): Promise<R[]> {
  await migrator.query("SELECT set_config('app.org_id', $1, false)", [orgId]);
  try {
    return (await migrator.query<R>(sql, values)).rows;
  } finally {
    await migrator.query("SELECT set_config('app.org_id', '', false)");
  }
}

beforeAll(async () => {
  const names = (await readdir(MIGRATIONS)).filter((n) => n.endsWith('.sql')).sort();
  const before = names.filter((n) => n < TARGET);
  expect(names).toContain(TARGET);
  expect(before).toHaveLength(4);
  scratch = await mkdtemp(join(tmpdir(), 'tinnox-migration-0005-'));
  for (const name of before) await copyFile(join(MIGRATIONS, name), join(scratch, name));

  await resetTestDatabase(migratorUrl());
  await runMigrations({ connectionString: migratorUrl(), directory: scratch });

  migrator = await migratorClient();
  a = await createLegacyOrg(migrator, 'Legacy A');
  b = await createLegacyOrg(migrator, 'Legacy B');

  failed = await attemptBrokenUpgrade(before);
  upgrade = await runMigrations({ connectionString: migratorUrl(), directory: MIGRATIONS });
  pool = appPool(2);
});

afterAll(async () => {
  await pool?.end();
  await migrator?.end();
  // Whatever happened above, leave the shared test database at the newest migration.
  await runMigrations({ connectionString: migratorUrl(), directory: MIGRATIONS });
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
});

describe('migration 0005 that fails in the middle of its backfill', () => {
  it('fails as a whole, with the error of the statement that failed', () => {
    expect(failed.error).toContain(TARGET);
    expect(failed.error).toContain(PLANTED_FAILURE);
  });

  it('leaves the schema exactly as it was at 0004: tables, columns, indexes, triggers, policies, grants', () => {
    expect(failed.schemaAfter).toEqual(failed.schemaBefore);
    expect(failed.schemaAfter.migrations).toHaveLength(4);
    expect(failed.schemaAfter.migrations).not.toContain(TARGET);
    // Spot checks, so the comparison above cannot pass on two equally wrong snapshots.
    const tables = failed.schemaAfter.tables.map((table) => table.name);
    for (const created of ['folder', 'tag', 'media_tag', 'display_tag']) {
      expect(tables).not.toContain(created);
    }
    expect(failed.schemaAfter.columns.some((c) => c.startsWith('display.assigned_'))).toBe(false);
    expect(failed.schemaAfter.columns.some((c) => c.startsWith('audit_event.category'))).toBe(
      false,
    );
    expect(failed.schemaAfter.indexes.some((i) => i.includes('playlist_org_idx'))).toBe(true);
    expect(failed.schemaAfter.functions).not.toContain('playlist_delete_guard');
  });

  it('leaves forced row-level security on every table, the three it had lifted included', () => {
    const tenantTables = failed.schemaAfter.tables.filter((t) => t.name !== 'schema_migrations');
    expect(tenantTables.length).toBeGreaterThan(10);
    for (const table of tenantTables) {
      expect(table.rowSecurity && table.forced, table.name).toBe(true);
    }
    for (const lifted of ['display', 'display_delivery', 'publication']) {
      expect(tenantTables.find((t) => t.name === lifted)?.forced, lifted).toBe(true);
    }
  });

  it('leaves every trigger enabled, the one it had disabled included', () => {
    expect(failed.schemaAfter.triggers.length).toBeGreaterThan(5);
    for (const trigger of failed.schemaAfter.triggers) {
      expect(trigger.enabled, trigger.name).toBe('O');
    }
    expect(failed.schemaAfter.triggers.map((t) => t.name)).toContain(
      'display.display_set_updated_at',
    );
  });

  it('leaves every row as it was: no display was assigned or rewritten, no audit row touched', () => {
    expect(failed.dataAfter).toEqual(failed.dataBefore);
    const [first] = failed.dataAfter as { displays: unknown[]; audit: unknown[] }[];
    expect(first?.displays).toHaveLength(5);
    expect(first?.audit).toHaveLength(2);
  });
});

describe('migration 0005 on a database that already holds publications', () => {
  it('gives the audit events from before the upgrade their category, and changes nothing else in them', async () => {
    const before = failed.dataBefore as { audit: Record<string, unknown>[] }[];
    for (const [index, org] of [a, b].entries()) {
      const rows = await asOwnerIn<Record<string, unknown>>(
        org.orgId,
        'SELECT id, occurred_at, action, result, object_id, category FROM audit_event ORDER BY id',
      );
      expect(rows.map((row) => row.category)).toEqual(['playlist', 'publication']);
      expect(rows.map(({ category: _category, ...rest }) => rest)).toEqual(before[index]?.audit);
    }
  });

  it('is the only migration applied on top of 0004, and is not applied twice', async () => {
    const later = (await readdir(MIGRATIONS)).filter((n) => n.endsWith('.sql') && n > TARGET);
    expect(upgrade.alreadyApplied).toHaveLength(4);
    expect(upgrade.applied).toEqual([TARGET, ...later.sort()]);
    const again = await runMigrations({ connectionString: migratorUrl(), directory: MIGRATIONS });
    expect(again.applied).toEqual([]);
    expect(again.alreadyApplied).toContain(TARGET);
  });

  it('assigns every display the playlist of its desired publication, in each organisation', async () => {
    for (const org of [a, b]) {
      const rows = await asOwnerIn<{ id: string; assigned_playlist_id: string | null }>(
        org.orgId,
        'SELECT id, assigned_playlist_id FROM display',
      );
      const assigned = new Map(rows.map((r) => [r.id, r.assigned_playlist_id]));
      expect(assigned.size).toBe(5);
      for (const [label, display] of Object.entries(org.displays)) {
        expect(assigned.get(display.id), label).toBe(display.expected);
      }
      // Every assignment is one of this organisation's own two playlists.
      for (const playlistId of assigned.values()) {
        if (playlistId !== null) expect(org.playlists).toContain(playlistId);
      }
    }
    // The fixture covers both playlists and both outcomes.
    expect(a.displays.publishedOnce.expected).toBe(a.playlists[0]);
    expect(a.displays.republished.expected).toBe(a.playlists[1]);
    expect(a.displays.olderDesired.expected).toBe(a.playlists[1]);
  });

  it('shows the assignments to the runtime role, each organisation its own only', async () => {
    for (const [org, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const rows = await withOrg(pool, org.orgId, (tx) =>
        tx.query<{ id: string; name: string | null }>(
          `SELECT d.id, p.name
           FROM display d LEFT JOIN playlist p
             ON p.id = d.assigned_playlist_id AND p.org_id = d.org_id AND p.deleted_at IS NULL
           ORDER BY d.name`,
        ),
      );
      expect(rows.rows).toHaveLength(5);
      expect(rows.rows.filter((r) => r.name !== null)).toHaveLength(3);
      const foreign = Object.values(other.displays).map((d) => d.id);
      expect(rows.rows.some((r) => foreign.includes(r.id))).toBe(false);
    }
  });

  it('leaves the delivery state and the publications as they were', async () => {
    for (const org of [a, b]) {
      const rows = await asOwnerIn<{ display_id: string; playlist_id: string | null }>(
        org.orgId,
        `SELECT dd.display_id, p.playlist_id
         FROM display_delivery dd
         LEFT JOIN publication p ON p.id = dd.desired_publication_id`,
      );
      const desired = new Map(rows.map((r) => [r.display_id, r.playlist_id]));
      expect(desired.size).toBe(4);
      expect(desired.get(org.displays.publishedOnce.id)).toBe(org.playlists[0]);
      expect(desired.get(org.displays.republished.id)).toBe(org.playlists[1]);
      expect(desired.get(org.displays.olderDesired.id)).toBe(org.playlists[1]);
      expect(desired.get(org.displays.neverPublished.id)).toBeNull();
      const publications = await asOwnerIn<{ n: string }>(
        org.orgId,
        'SELECT count(*) AS n FROM publication',
      );
      expect(publications[0]?.n).toBe('5');
    }
  });

  it('does not count the backfill as an edit: updated_at is untouched', async () => {
    for (const org of [a, b]) {
      const rows = await asOwnerIn<{ updated_at: Date }>(
        org.orgId,
        'SELECT DISTINCT updated_at FROM display',
      );
      expect(rows.map((r) => r.updated_at.toISOString())).toEqual([LONG_AGO]);
    }
    // The trigger that maintains updated_at is working again.
    const [changed] = await asOwnerIn<{ updated_at: Date }>(
      a.orgId,
      "UPDATE display SET description = 'Edited after the upgrade' WHERE id = $1 RETURNING updated_at",
      [a.displays.noDeliveryRow.id],
    );
    expect(changed?.updated_at.toISOString()).not.toBe(LONG_AGO);
  });

  it('gives the existing playlists and media the new columns, empty', async () => {
    for (const org of [a, b]) {
      const playlists = await asOwnerIn<{ n: string }>(
        org.orgId,
        'SELECT count(*) AS n FROM playlist WHERE deleted_at IS NULL AND description IS NULL',
      );
      expect(playlists[0]?.n).toBe('2');
      const media = await asOwnerIn<{ n: string }>(
        org.orgId,
        `SELECT count(*) AS n FROM media
         WHERE name IS NULL AND description IS NULL AND default_duration_ms IS NULL AND folder_id IS NULL`,
      );
      expect(media[0]?.n).toBe('1');
      for (const table of ['tag', 'folder', 'media_tag', 'display_tag']) {
        const rows = await asOwnerIn<{ n: string }>(
          org.orgId,
          `SELECT count(*) AS n FROM ${table}`,
        );
        expect(rows[0]?.n, table).toBe('0');
      }
    }
  });

  // The same populated database then goes through every later migration, so this is an
  // upgrade of existing rows, not the fresh schema the stage B suites start from.
  it('carries the existing rows through 0006 to 0011', async () => {
    expect(upgrade.applied).toEqual(
      expect.arrayContaining([
        '0006_stage_b_slice1.sql',
        '0007_stage_b_apps.sql',
        '0008_null_safe_checks.sql',
        '0009_stage_b_schedules.sql',
        '0011_stage_b_layouts.sql',
      ]),
    );
    for (const org of [a, b]) {
      const count = async (sql: string): Promise<number> =>
        Number(
          (await asOwnerIn<{ n: string }>(org.orgId, `SELECT count(*) AS n FROM ${sql}`))[0]?.n,
        );
      // 0006: new display and media columns take their defaults.
      expect(await count('display')).toBeGreaterThan(0);
      expect(await count('display WHERE rotation <> 0 OR working_hours IS NOT NULL')).toBe(0);
      expect(
        await count(
          'media WHERE available_from IS NOT NULL OR available_until IS NOT NULL OR thumb_storage_key IS NOT NULL',
        ),
      ).toBe(0);
      // 0007: no apps yet, and every publication from before is still a version 1 manifest
      // that the re-created CHECK accepted.
      expect(await count('app')).toBe(0);
      expect(await count('publication')).toBeGreaterThan(0);
      expect(await count("publication WHERE manifest ->> 'schemaVersion' <> '1'")).toBe(0);
    }
    // 0008: the NULL-safe definitions are the ones in force after the upgrade (0009 and 0011
    // keep the manifest check NULL-safe when they add versions 4 and 5).
    const checks = await migrator.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname IN ('publication_manifest_shape', 'media_ready_is_complete') ORDER BY conname`,
    );
    expect(checks.rows.map((row) => row.conname)).toEqual([
      'media_ready_is_complete',
      'publication_manifest_shape',
    ]);
    expect(checks.rows[0]?.def).toContain('bytes IS NOT NULL');
    expect(checks.rows[1]?.def).toContain('IS TRUE');
    expect(checks.rows[1]?.def).toContain("'4'");
    expect(checks.rows[1]?.def).toContain("'5'");
  });
});

describe('forced row-level security after migration 0005', () => {
  it('is enabled and forced on every table in public, the backfilled ones included', async () => {
    const { rows } = await migrator.query<{ relname: string; forced: boolean }>(
      `SELECT c.relname, (c.relrowsecurity AND c.relforcerowsecurity) AS forced
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
       ORDER BY 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual(
      [
        // 0007, applied with the rest by the upgrade above.
        'app',
        'audit_event',
        'display',
        'display_delivery',
        'display_tag',
        'folder',
        'heartbeat_log',
        'login_state',
        'media',
        'media_tag',
        'membership',
        'organization',
        'pairing_claim_failure',
        'pairing_session',
        'player_registration',
        'playlist',
        'playlist_item',
        'publication',
        'publication_asset',
        // 0009, applied with the rest.
        'schedule',
        'schedule_event',
        // 0011, applied with the rest.
        'layout',
        'layout_zone',
        // 0013, applied with the rest.
        'member_invite',
        'session',
        'site',
        'tag',
      ].sort(),
    );
    expect(rows.filter((r) => !r.forced)).toEqual([]);
  });

  it('binds the table owner again: without a context it sees none of the rows it backfilled', async () => {
    for (const table of ['display', 'display_delivery', 'publication', 'playlist', 'media']) {
      const { rows } = await migrator.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
      expect(rows[0]?.n, table).toBe('0');
    }
    const updated = await migrator.query('UPDATE display SET assigned_playlist_id = NULL');
    expect(updated.rowCount).toBe(0);
  });

  it('hides everything from the runtime role without a context', async () => {
    for (const table of ['display', 'display_delivery', 'publication', 'tag', 'folder']) {
      const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
      expect(rows[0]?.n, table).toBe('0');
    }
  });

  it('gives the new tables the same tenant policy as the old ones', async () => {
    const { rows } = await migrator.query<{
      tablename: string;
      cmd: string;
      roles: string;
      qual: string;
      with_check: string;
    }>(
      `SELECT tablename, cmd, roles::text, qual, with_check FROM pg_policies
       WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
         AND tablename IN ('media', 'folder', 'tag', 'media_tag', 'display_tag')
       ORDER BY tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      'display_tag',
      'folder',
      'media',
      'media_tag',
      'tag',
    ]);
    const reference = rows.find((r) => r.tablename === 'media');
    expect(reference).toMatchObject({ cmd: 'ALL', roles: '{public}' });
    expect(reference?.qual).toContain('app_org_id()');
    for (const row of rows) {
      expect({ ...row, tablename: 'media' }, row.tablename).toEqual(reference);
    }
    // Exactly one policy per new table.
    const counts = await migrator.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_policies
       WHERE schemaname = 'public' AND tablename IN ('folder', 'tag', 'media_tag', 'display_tag')`,
    );
    expect(counts.rows[0]?.n).toBe('4');
  });

  it('leaves every trigger enabled, the updated_at trigger of display included', async () => {
    const { rows } = await migrator.query<{ name: string; enabled: string }>(
      `SELECT c.relname || '.' || g.tgname AS name, g.tgenabled::text AS enabled
       FROM pg_trigger g
       JOIN pg_class c ON c.oid = g.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT g.tgisinternal`,
    );
    const names = rows.map((r) => r.name);
    expect(names).toContain('display.display_set_updated_at');
    expect(names).toContain('display.display_assigned_playlist_guard');
    expect(names).toContain('playlist.playlist_delete_guard');
    expect(rows.filter((r) => r.enabled !== 'O')).toEqual([]);
  });
});
