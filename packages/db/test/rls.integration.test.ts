/**
 * Proof of tenant isolation at the database, connected as the runtime role
 * tinnox_app against a real PostgreSQL (the integration-test database).
 * Nothing here goes through the API: these are the policies themselves.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrg, withoutOrg, withResolvedOrg, type Pool } from '../src/index.ts';
import {
  appPool,
  createOrg,
  migratorClient,
  PG,
  pgCode,
  pgViolation,
  type TestOrg,
} from './support.ts';

const TENANT_TABLES = [
  'organization',
  'membership',
  'site',
  'display',
  'player_registration',
  'media',
  'playlist',
  'playlist_item',
  'publication',
  'publication_asset',
  'display_delivery',
  'heartbeat_log',
  'audit_event',
  'folder',
  'tag',
  'media_tag',
  'display_tag',
  'app',
  'schedule',
  'schedule_event',
  'layout',
  'layout_zone',
  'member_invite',
] as const;
/**
 * Rows that `createOrg` gives one organisation, where that is not exactly one:
 * registrations and heartbeats come from a player, there is one tag per scope, the
 * layout has two zones, and invites are requests nobody has made yet.
 */
const ROWS_PER_ORG: Partial<Record<(typeof TENANT_TABLES)[number], number>> = {
  player_registration: 0,
  heartbeat_log: 0,
  tag: 2,
  layout_zone: 2,
  member_invite: 0,
};
const LOCKED_TABLES = [
  'session',
  'login_state',
  'pairing_session',
  'pairing_claim_failure',
  'schema_migrations',
] as const;

let pool: Pool;
let migrator: pg.Client;
let a: TestOrg;
let b: TestOrg;

beforeAll(async () => {
  pool = appPool();
  migrator = await migratorClient();
  a = await createOrg(migrator, 'Org A');
  b = await createOrg(migrator, 'Org B');
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

const count = async (
  q: { query: Pool['query'] } | { query: (text: string) => Promise<{ rows: { n: string }[] }> },
  table: string,
) => {
  const result = await (q as Pool).query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(result.rows[0]?.n);
};

describe('the runtime role itself', () => {
  it('is tinnox_app: not superuser, no BYPASSRLS, cannot create roles or databases', async () => {
    const { rows } = await pool.query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
    }>(
      'SELECT current_user, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user',
    );
    expect(rows[0]).toEqual({
      current_user: 'tinnox_app',
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
  });

  it('owns no table and no function', async () => {
    const tables = await pool.query(
      "SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'tinnox_app'",
    );
    const functions = await pool.query(
      "SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = 'tinnox_app'",
    );
    expect(tables.rowCount).toBe(0);
    expect(functions.rowCount).toBe(0);
  });

  it('every table in public has row-level security enabled and forced', async () => {
    const { rows } = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations' ORDER BY 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual(
      [
        ...TENANT_TABLES,
        'session',
        'login_state',
        'pairing_session',
        'pairing_claim_failure',
      ].sort(),
    );
    expect(rows.filter((r) => !(r.relrowsecurity && r.relforcerowsecurity))).toEqual([]);
  });

  it('cannot escalate: no SET ROLE, no DDL, cannot switch row security off', async () => {
    expect(await pgCode(pool.query('SET ROLE tinnox_definer'))).toBe(PG.insufficientPrivilege);
    expect(await pgCode(pool.query('SET ROLE tinnox_migrator'))).toBe(PG.insufficientPrivilege);
    expect(await pgCode(pool.query('CREATE TABLE public.x (id int)'))).toBe(
      PG.insufficientPrivilege,
    );
    expect(await pgCode(pool.query('CREATE TABLE sec.x (id int)'))).toBe(PG.insufficientPrivilege);
    expect(await pgCode(pool.query('ALTER TABLE media DISABLE ROW LEVEL SECURITY'))).toBe(
      PG.insufficientPrivilege,
    );
    expect(await pgCode(pool.query('DROP POLICY tenant_isolation ON media'))).toBe(
      PG.insufficientPrivilege,
    );
    expect(
      await pgCode(pool.query('ALTER TABLE publication DISABLE TRIGGER publication_immutable')),
    ).toBe(PG.insufficientPrivilege);
    expect(await pgCode(pool.query('TRUNCATE media'))).toBe(PG.insufficientPrivilege);
  });

  it('keeps its timeouts and row security on new connections when it changes its own defaults (round 3, SCU-02)', async () => {
    // PostgreSQL lets every role change its own defaults; no grant can stop it.
    const alterOwnDefaults = (clause: string): Promise<unknown> =>
      pool.query(
        `DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I ${clause}', current_database()); END $$`,
      );
    try {
      for (const clause of [
        'SET statement_timeout = 0',
        'SET lock_timeout = 0',
        'SET idle_in_transaction_session_timeout = 0',
        'SET row_security = off',
      ]) {
        await alterOwnDefaults(clause);
      }
      // A plain connection gets the changed defaults: the change took effect...
      const plain = new pg.Client({ connectionString: process.env['TEST_DATABASE_URL'] });
      await plain.connect();
      try {
        const { rows } = await plain.query<{ lt: string; rs: string }>(
          "SELECT current_setting('lock_timeout') AS lt, current_setting('row_security') AS rs",
        );
        expect(rows[0]).toEqual({ lt: '0', rs: 'off' });
      } finally {
        await plain.end();
      }
      // ...but the API's pool sets its own values when it connects, and they win.
      const fresh = appPool(1);
      try {
        const { rows } = await fresh.query<Record<string, string>>(
          `SELECT current_setting('statement_timeout') AS statement,
                  current_setting('lock_timeout') AS lock,
                  current_setting('idle_in_transaction_session_timeout') AS idle,
                  current_setting('row_security') AS row_security`,
        );
        expect(rows[0]).toEqual({ statement: '15s', lock: '5s', idle: '30s', row_security: 'on' });
      } finally {
        await fresh.end();
      }
    } finally {
      await alterOwnDefaults('RESET ALL');
    }
  });

  it('has no access at all to session, login-state, pairing and migration tables', async () => {
    for (const table of LOCKED_TABLES) {
      expect(await pgCode(pool.query(`SELECT * FROM ${table}`)), table).toBe(
        PG.insufficientPrivilege,
      );
      expect(await pgCode(pool.query(`DELETE FROM ${table}`)), table).toBe(
        PG.insufficientPrivilege,
      );
    }
  });
});

describe('with no organisation context', () => {
  it('sees zero rows in every tenant table although both organisations have data', async () => {
    for (const table of TENANT_TABLES) {
      expect(await count(pool, table), table).toBe(0);
    }
    await withoutOrg(pool, async (tx) => {
      for (const table of TENANT_TABLES) expect(await count(tx as never, table), table).toBe(0);
    });
  });

  it('cannot insert, update or delete anything', async () => {
    expect(
      await pgCode(
        pool.query('INSERT INTO playlist (org_id, name) VALUES ($1, $2)', [a.orgId, 'x']),
      ),
    ).toBe(PG.rlsViolation);
    expect(
      await pgCode(
        pool.query(
          "INSERT INTO audit_event (org_id, actor_type, action, result) VALUES ($1, 'system', 'a.b', 'success')",
          [a.orgId],
        ),
      ),
    ).toBe(PG.rlsViolation);
    expect((await pool.query("UPDATE playlist SET name = 'hijacked'")).rowCount).toBe(0);
    expect((await pool.query('DELETE FROM playlist_item')).rowCount).toBe(0);
    expect((await pool.query('DELETE FROM media')).rowCount).toBe(0);
  });

  it('treats an empty or malformed context as no access', async () => {
    await withoutOrg(pool, async (tx) => {
      await tx.query("SELECT set_config('app.org_id', '', true)");
      expect(await count(tx as never, 'media')).toBe(0);
    });
    const malformed = withoutOrg(pool, async (tx) => {
      await tx.query("SELECT set_config('app.org_id', 'not-a-uuid', true)");
      await tx.query('SELECT * FROM media');
    });
    expect(await pgCode(malformed)).toBe(PG.invalidText);
    await expect(withOrg(pool, "x' OR '1'='1", async () => undefined)).rejects.toThrow(/UUID/);
    await expect(withOrg(pool, a.orgId.toUpperCase(), async () => undefined)).rejects.toThrow(
      /UUID/,
    );
  });
});

describe('with organisation A as context', () => {
  it('sees exactly its own rows in every tenant table', async () => {
    await withOrg(pool, a.orgId, async (tx) => {
      for (const table of TENANT_TABLES) {
        expect(await count(tx as never, table), table).toBe(ROWS_PER_ORG[table] ?? 1);
      }
      const org = await tx.query<{ id: string }>('SELECT id FROM organization');
      expect(org.rows).toEqual([{ id: a.orgId }]);
      const media = await tx.query<{ org_id: string }>('SELECT DISTINCT org_id FROM media');
      expect(media.rows).toEqual([{ org_id: a.orgId }]);
    });
  });

  it("cannot read organisation B's rows even by primary key", async () => {
    await withOrg(pool, a.orgId, async (tx) => {
      const probes: [string, string][] = [
        ['SELECT 1 FROM organization WHERE id = $1', b.orgId],
        ['SELECT 1 FROM membership WHERE id = $1', b.membershipId],
        ['SELECT 1 FROM site WHERE id = $1', b.siteId],
        ['SELECT 1 FROM display WHERE id = $1', b.displayId],
        ['SELECT 1 FROM media WHERE id = $1', b.mediaId],
        ['SELECT 1 FROM playlist WHERE id = $1', b.playlistId],
        ['SELECT 1 FROM playlist_item WHERE playlist_id = $1', b.playlistId],
        ['SELECT 1 FROM publication WHERE id = $1', b.publicationId],
        ['SELECT 1 FROM publication_asset WHERE publication_id = $1', b.publicationId],
        ['SELECT 1 FROM display_delivery WHERE display_id = $1', b.displayId],
        ['SELECT 1 FROM audit_event WHERE org_id = $1', b.orgId],
        ['SELECT 1 FROM folder WHERE id = $1', b.folderId],
        ['SELECT 1 FROM tag WHERE id = $1', b.mediaTagId],
        ['SELECT 1 FROM tag WHERE id = $1', b.displayTagId],
        ['SELECT 1 FROM media_tag WHERE media_id = $1', b.mediaId],
        ['SELECT 1 FROM media_tag WHERE tag_id = $1', b.mediaTagId],
        ['SELECT 1 FROM display_tag WHERE display_id = $1', b.displayId],
        ['SELECT 1 FROM display_tag WHERE tag_id = $1', b.displayTagId],
        ['SELECT 1 FROM display WHERE assigned_playlist_id = $1', b.playlistId],
        ['SELECT 1 FROM media WHERE folder_id = $1', b.folderId],
        ['SELECT 1 FROM app WHERE id = $1', b.appId],
        ['SELECT 1 FROM schedule WHERE id = $1', b.scheduleId],
        ['SELECT 1 FROM schedule WHERE default_playlist_id = $1', b.playlistId],
        ['SELECT 1 FROM schedule_event WHERE schedule_id = $1', b.scheduleId],
        ['SELECT 1 FROM schedule_event WHERE playlist_id = $1', b.playlistId],
        ['SELECT 1 FROM layout WHERE id = $1', b.layoutId],
        ['SELECT 1 FROM layout_zone WHERE layout_id = $1', b.layoutId],
        ['SELECT 1 FROM layout_zone WHERE playlist_id = $1', b.playlistId],
      ];
      for (const [sql, id] of probes) expect((await tx.query(sql, [id])).rowCount, sql).toBe(0);
    });
  });

  it("cannot update or delete organisation B's rows", async () => {
    await withOrg(pool, a.orgId, async (tx) => {
      expect(
        (await tx.query("UPDATE display SET name = 'hijacked' WHERE id = $1", [b.displayId]))
          .rowCount,
      ).toBe(0);
      expect(
        (await tx.query("UPDATE media SET original_name = 'hijacked' WHERE id = $1", [b.mediaId]))
          .rowCount,
      ).toBe(0);
      expect(
        (await tx.query("UPDATE playlist SET name = 'hijacked' WHERE id = $1", [b.playlistId]))
          .rowCount,
      ).toBe(0);
      expect(
        (
          await tx.query(
            'UPDATE display_delivery SET desired_publication_id = NULL WHERE display_id = $1',
            [b.displayId],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (await tx.query('DELETE FROM playlist_item WHERE playlist_id = $1', [b.playlistId]))
          .rowCount,
      ).toBe(0);
      expect((await tx.query('DELETE FROM playlist WHERE id = $1', [b.playlistId])).rowCount).toBe(
        0,
      );
      const stageA: [string, string][] = [
        ["UPDATE tag SET name = 'hijacked' WHERE id = $1", b.mediaTagId],
        ["UPDATE folder SET name = 'hijacked' WHERE id = $1", b.folderId],
        ["UPDATE display SET description = 'hijacked' WHERE id = $1", b.displayId],
        ['UPDATE display SET assigned_playlist_id = NULL WHERE id = $1', b.displayId],
        ['UPDATE media SET folder_id = NULL WHERE id = $1', b.mediaId],
        ['UPDATE playlist SET deleted_at = now() WHERE id = $1', b.playlistId],
        ['DELETE FROM media_tag WHERE media_id = $1', b.mediaId],
        ['DELETE FROM display_tag WHERE display_id = $1', b.displayId],
        ['DELETE FROM tag WHERE id = $1', b.mediaTagId],
        ['DELETE FROM tag WHERE id = $1', b.displayTagId],
        ['DELETE FROM folder WHERE id = $1', b.folderId],
        ["UPDATE app SET name = 'hijacked' WHERE id = $1", b.appId],
        ['DELETE FROM app WHERE id = $1', b.appId],
        ["UPDATE schedule SET name = 'hijacked' WHERE id = $1", b.scheduleId],
        ['DELETE FROM schedule_event WHERE schedule_id = $1', b.scheduleId],
        ['DELETE FROM schedule WHERE id = $1', b.scheduleId],
        ["UPDATE layout SET name = 'hijacked' WHERE id = $1", b.layoutId],
        ['DELETE FROM layout_zone WHERE layout_id = $1', b.layoutId],
        ['DELETE FROM layout WHERE id = $1', b.layoutId],
      ];
      for (const [sql, id] of stageA) expect((await tx.query(sql, [id])).rowCount, sql).toBe(0);
      // 0013's column grant on membership: the policy hides B's member, and display_name has
      // no second check (membership_guard covers only role and removal).
      const stageC: [string, unknown[]][] = [
        ["UPDATE membership SET display_name = 'hijacked' WHERE id = $1", [b.membershipId]],
        ["UPDATE membership SET role = 'viewer' WHERE id = $1", [b.membershipId]],
        [
          'UPDATE membership SET removed_at = now(), removed_by = $2 WHERE id = $1',
          [b.membershipId, a.membershipId],
        ],
      ];
      for (const [sql, values] of stageC)
        expect((await tx.query(sql, values)).rowCount, sql).toBe(0);
    });
    // Nothing of organisation B was touched.
    await withOrg(pool, b.orgId, async (tx) => {
      const member = await tx.query(
        'SELECT role, display_name, removed_at FROM membership WHERE id = $1',
        [b.membershipId],
      );
      expect(member.rows).toEqual([{ role: 'owner', display_name: null, removed_at: null }]);
      const { rows } = await tx.query<{
        tags: string;
        folders: string;
        media_tags: string;
        display_tags: string;
        foldered: string;
        assigned: string;
      }>(
        `SELECT (SELECT count(*) FROM tag WHERE name NOT LIKE 'hijacked%') AS tags,
                (SELECT count(*) FROM folder WHERE name NOT LIKE 'hijacked%') AS folders,
                (SELECT count(*) FROM media_tag) AS media_tags,
                (SELECT count(*) FROM display_tag) AS display_tags,
                (SELECT count(*) FROM media WHERE folder_id IS NOT NULL) AS foldered,
                (SELECT count(*) FROM display WHERE assigned_playlist_id IS NOT NULL
                   AND description IS NULL) AS assigned`,
      );
      expect(rows[0]).toEqual({
        tags: '2',
        folders: '1',
        media_tags: '1',
        display_tags: '1',
        foldered: '1',
        assigned: '1',
      });
    });
    // The owner is subject to the same policy (FORCE), so it needs the context too.
    expect(
      (await migrator.query('SELECT name FROM display WHERE id = $1', [b.displayId])).rowCount,
    ).toBe(0);
    await migrator.query("SELECT set_config('app.org_id', $1, false)", [b.orgId]);
    const check = await migrator.query<{ name: string }>('SELECT name FROM display WHERE id = $1', [
      b.displayId,
    ]);
    await migrator.query("SELECT set_config('app.org_id', '', false)");
    expect(check.rows[0]?.name).toBe('Org B display');
  });

  it('cannot insert rows that belong to organisation B', async () => {
    const attempts: [string, unknown[]][] = [
      ['INSERT INTO playlist (org_id, name) VALUES ($1, $2)', [b.orgId, 'planted']],
      [
        'INSERT INTO display (org_id, site_id, name, canvas_width, canvas_height) VALUES ($1, $2, $3, 100, 100)',
        [b.orgId, b.siteId, 'planted'],
      ],
      [
        "INSERT INTO media (org_id, kind, original_name) VALUES ($1, 'image', 'planted.png')",
        [b.orgId],
      ],
      [
        'INSERT INTO playlist_item (org_id, playlist_id, position, media_id, duration_ms) VALUES ($1, $2, 9, $3, 1000)',
        [b.orgId, b.playlistId, b.mediaId],
      ],
      [
        "INSERT INTO audit_event (org_id, actor_type, action, result) VALUES ($1, 'operator', 'media.upload', 'success')",
        [b.orgId],
      ],
      ['INSERT INTO display_delivery (display_id, org_id) VALUES ($1, $2)', [b.displayId, b.orgId]],
      ['INSERT INTO folder (org_id, name) VALUES ($1, $2)', [b.orgId, 'planted']],
      ["INSERT INTO tag (org_id, scope, name) VALUES ($1, 'media', $2)", [b.orgId, 'planted']],
      ["INSERT INTO tag (org_id, scope, name) VALUES ($1, 'display', $2)", [b.orgId, 'planted']],
      [
        "INSERT INTO app (org_id, type, name, settings) VALUES ($1, 'text', 'planted', '{}')",
        [b.orgId],
      ],
      [
        'INSERT INTO schedule (org_id, name, default_playlist_id) VALUES ($1, $2, $3)',
        [b.orgId, 'planted', b.playlistId],
      ],
      [
        "INSERT INTO schedule_event (org_id, schedule_id, position, playlist_id, days, start_time, end_time) VALUES ($1, $2, 9, $3, '{t,t,t,t,t,t,t}', '09:00', '17:00')",
        [b.orgId, b.scheduleId, b.playlistId],
      ],
      ['INSERT INTO layout (org_id, name) VALUES ($1, $2)', [b.orgId, 'planted']],
      [
        'INSERT INTO layout_zone (org_id, layout_id, position, playlist_id, x_bp, y_bp, width_bp, height_bp) VALUES ($1, $2, 3, $3, 0, 0, 1, 1)',
        [b.orgId, b.layoutId, b.playlistId],
      ],
      [
        'INSERT INTO media_tag (org_id, media_id, tag_id) VALUES ($1, $2, $3)',
        [b.orgId, b.mediaId, b.mediaTagId],
      ],
      [
        'INSERT INTO display_tag (org_id, display_id, tag_id) VALUES ($1, $2, $3)',
        [b.orgId, b.displayId, b.displayTagId],
      ],
      // Its own media and tag, filed under the other organisation.
      [
        'INSERT INTO media_tag (org_id, media_id, tag_id) VALUES ($1, $2, $3)',
        [b.orgId, a.mediaId, a.mediaTagId],
      ],
    ];
    for (const [sql, values] of attempts) {
      expect(await pgCode(withOrg(pool, a.orgId, (tx) => tx.query(sql, values))), sql).toBe(
        PG.rlsViolation,
      );
    }
  });

  it('cannot move its own row into organisation B', async () => {
    expect(
      await pgCode(
        withOrg(pool, a.orgId, (tx) =>
          tx.query('UPDATE playlist SET org_id = $1 WHERE id = $2', [b.orgId, a.playlistId]),
        ),
      ),
    ).toBe(PG.rlsViolation);
    expect(
      await pgCode(
        withOrg(pool, a.orgId, (tx) =>
          tx.query('UPDATE media SET org_id = $1 WHERE id = $2', [b.orgId, a.mediaId]),
        ),
      ),
    ).toBe(PG.rlsViolation);
    // The new tables give the runtime role no UPDATE on org_id at all.
    for (const [sql, id] of [
      ['UPDATE tag SET org_id = $1 WHERE id = $2', a.mediaTagId],
      ['UPDATE folder SET org_id = $1 WHERE id = $2', a.folderId],
      ['UPDATE media_tag SET org_id = $1 WHERE media_id = $2', a.mediaId],
      ['UPDATE display_tag SET org_id = $1 WHERE display_id = $2', a.displayId],
      ['UPDATE app SET org_id = $1 WHERE id = $2', a.appId],
      ['UPDATE schedule SET org_id = $1 WHERE id = $2', a.scheduleId],
      ['UPDATE schedule_event SET org_id = $1 WHERE schedule_id = $2', a.scheduleId],
      ['UPDATE layout SET org_id = $1 WHERE id = $2', a.layoutId],
      ['UPDATE layout_zone SET org_id = $1 WHERE layout_id = $2', a.layoutId],
    ] as const) {
      expect(await pgCode(withOrg(pool, a.orgId, (tx) => tx.query(sql, [b.orgId, id]))), sql).toBe(
        PG.insufficientPrivilege,
      );
    }
  });

  it("cannot attach its own rows to organisation B's rows (composite foreign keys)", async () => {
    const attempts: [string, unknown[]][] = [
      [
        'INSERT INTO display (org_id, site_id, name, canvas_width, canvas_height) VALUES ($1, $2, $3, 100, 100)',
        [a.orgId, b.siteId, 'cross-site'],
      ],
      [
        'INSERT INTO playlist_item (org_id, playlist_id, position, media_id, duration_ms) VALUES ($1, $2, 5, $3, 1000)',
        [a.orgId, a.playlistId, b.mediaId],
      ],
      [
        'INSERT INTO playlist_item (org_id, playlist_id, position, media_id, duration_ms) VALUES ($1, $2, 5, $3, 1000)',
        [a.orgId, b.playlistId, a.mediaId],
      ],
      [
        'UPDATE display_delivery SET desired_publication_id = $2 WHERE display_id = $1',
        [a.displayId, b.publicationId],
      ],
      [
        'UPDATE display_delivery SET active_publication_id = $2, active_item_index = 0 WHERE display_id = $1',
        [a.displayId, b.publicationId],
      ],
      // Its own media with the other organisation's tag, and the reverse.
      [
        'INSERT INTO media_tag (org_id, media_id, tag_id) VALUES ($1, $2, $3)',
        [a.orgId, a.mediaId, b.mediaTagId],
      ],
      [
        'INSERT INTO media_tag (org_id, media_id, tag_id) VALUES ($1, $2, $3)',
        [a.orgId, b.mediaId, a.mediaTagId],
      ],
      [
        'INSERT INTO display_tag (org_id, display_id, tag_id) VALUES ($1, $2, $3)',
        [a.orgId, a.displayId, b.displayTagId],
      ],
      [
        'INSERT INTO display_tag (org_id, display_id, tag_id) VALUES ($1, $2, $3)',
        [a.orgId, b.displayId, a.displayTagId],
      ],
      // Its own media in the other organisation's folder.
      ['UPDATE media SET folder_id = $2 WHERE id = $1', [a.mediaId, b.folderId]],
      [
        "INSERT INTO media (org_id, kind, original_name, folder_id) VALUES ($1, 'image', 'x.png', $2)",
        [a.orgId, b.folderId],
      ],
      // Its own display with the other organisation's playlist assigned.
      ['UPDATE display SET assigned_playlist_id = $2 WHERE id = $1', [a.displayId, b.playlistId]],
      // Its own playlist with the other organisation's app.
      [
        'INSERT INTO playlist_item (org_id, playlist_id, position, app_id, duration_ms) VALUES ($1, $2, 5, $3, 1000)',
        [a.orgId, a.playlistId, b.appId],
      ],
      [
        'INSERT INTO display (org_id, site_id, name, canvas_width, canvas_height, assigned_playlist_id) VALUES ($1, $2, $3, 100, 100, $4)',
        [a.orgId, a.siteId, 'cross-playlist', b.playlistId],
      ],
      // Its own schedule on the other organisation's playlist, as the default and in an event.
      [
        'INSERT INTO schedule (org_id, name, default_playlist_id) VALUES ($1, $2, $3)',
        [a.orgId, 'cross-playlist', b.playlistId],
      ],
      ['UPDATE schedule SET default_playlist_id = $2 WHERE id = $1', [a.scheduleId, b.playlistId]],
      [
        "INSERT INTO schedule_event (org_id, schedule_id, position, playlist_id, days, start_time, end_time) VALUES ($1, $2, 5, $3, '{t,t,t,t,t,t,t}', '09:00', '17:00')",
        [a.orgId, a.scheduleId, b.playlistId],
      ],
      // Its own event in the other organisation's schedule.
      [
        "INSERT INTO schedule_event (org_id, schedule_id, position, playlist_id, days, start_time, end_time) VALUES ($1, $2, 5, $3, '{t,t,t,t,t,t,t}', '09:00', '17:00')",
        [a.orgId, b.scheduleId, a.playlistId],
      ],
      // Its own display with the other organisation's schedule assigned.
      [
        'INSERT INTO display (org_id, site_id, name, canvas_width, canvas_height, assigned_schedule_id) VALUES ($1, $2, $3, 100, 100, $4)',
        [a.orgId, a.siteId, 'cross-schedule', b.scheduleId],
      ],
      // Its own layout with a zone on the other organisation's playlist.
      [
        'INSERT INTO layout_zone (org_id, layout_id, position, playlist_id, x_bp, y_bp, width_bp, height_bp) VALUES ($1, $2, 3, $3, 0, 0, 1, 1)',
        [a.orgId, a.layoutId, b.playlistId],
      ],
      // Its own zone in the other organisation's layout.
      [
        'INSERT INTO layout_zone (org_id, layout_id, position, playlist_id, x_bp, y_bp, width_bp, height_bp) VALUES ($1, $2, 3, $3, 0, 0, 1, 1)',
        [a.orgId, b.layoutId, a.playlistId],
      ],
      // Its own display with the other organisation's layout assigned.
      [
        'INSERT INTO display (org_id, site_id, name, canvas_width, canvas_height, assigned_layout_id) VALUES ($1, $2, $3, 100, 100, $4)',
        [a.orgId, a.siteId, 'cross-layout', b.layoutId],
      ],
    ];
    for (const [sql, values] of attempts) {
      expect(await pgCode(withOrg(pool, a.orgId, (tx) => tx.query(sql, values))), sql).toBe(
        PG.foreignKey,
      );
    }
  });

  it('can do its own work', async () => {
    await withOrg(pool, a.orgId, async (tx) => {
      const created = await tx.query<{ id: string }>(
        'INSERT INTO playlist (org_id, name) VALUES ($1, $2) RETURNING id',
        [a.orgId, 'Mine'],
      );
      expect(created.rowCount).toBe(1);
      expect(
        (
          await tx.query("UPDATE playlist SET name = 'Renamed' WHERE id = $1", [
            created.rows[0]?.id,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (await tx.query('DELETE FROM playlist WHERE id = $1', [created.rows[0]?.id])).rowCount,
      ).toBe(1);
      expect(
        (await tx.query("UPDATE display SET name = 'Org A display' WHERE id = $1", [a.displayId]))
          .rowCount,
      ).toBe(1);
    });
  });

  it('cannot change columns it has no grant for (display.org_id, display.route, registration token)', async () => {
    expect(
      await pgCode(
        withOrg(pool, a.orgId, (tx) =>
          tx.query("UPDATE display SET route = 'browser' WHERE id = $1", [a.displayId]),
        ),
      ),
    ).toBe(PG.insufficientPrivilege);
    expect(
      await pgCode(
        withOrg(pool, a.orgId, (tx) =>
          tx.query('UPDATE display SET org_id = org_id WHERE id = $1', [a.displayId]),
        ),
      ),
    ).toBe(PG.insufficientPrivilege);
    expect(
      await pgCode(
        withOrg(pool, a.orgId, (tx) =>
          tx.query("UPDATE player_registration SET token_hash = '\\x00'"),
        ),
      ),
    ).toBe(PG.insufficientPrivilege);
    expect(
      await pgCode(
        withOrg(pool, a.orgId, (tx) =>
          tx.query(
            'INSERT INTO player_registration (org_id, display_id, token_hash) VALUES ($1, $2, $3)',
            [a.orgId, a.displayId, Buffer.alloc(32, 1)],
          ),
        ),
      ),
    ).toBe(PG.insufficientPrivilege);
    // 0013 grants an UPDATE of role, display_name, removed_at and removed_by only (the people
    // routes). A member's identity, organisation, first sign-in, cut-off and rename stamp stay
    // out of reach.
    for (const column of [
      'oidc_sub',
      'org_id',
      'first_signed_in_at',
      'sessions_valid_after',
      'display_name_changed_at',
    ]) {
      expect(
        await pgCode(
          withOrg(pool, a.orgId, (tx) =>
            tx.query(`UPDATE membership SET ${column} = ${column} WHERE id = $1`, [a.membershipId]),
          ),
        ),
        column,
      ).toBe(PG.insufficientPrivilege);
    }
    // A role change passes the privilege check and is decided by the 0013 trigger: the only
    // Owner stays one.
    expect(
      await pgViolation(
        withOrg(pool, a.orgId, (tx) =>
          tx.query("UPDATE membership SET role = 'viewer' WHERE id = $1", [a.membershipId]),
        ),
      ),
    ).toEqual({ code: PG.restrict, constraint: 'membership_last_owner' });
    expect(
      await pgCode(
        withOrg(pool, a.orgId, (tx) =>
          tx.query('INSERT INTO membership (org_id, oidc_sub) VALUES ($1, $2)', [
            a.orgId,
            'self-made',
          ]),
        ),
      ),
    ).toBe(PG.insufficientPrivilege);
    expect(
      await pgCode(
        withOrg(pool, a.orgId, (tx) =>
          tx.query("INSERT INTO organization (id, name) VALUES ($1, 'x')", [a.orgId]),
        ),
      ),
    ).toBe(PG.insufficientPrivilege);
  });
});

describe('transaction-scoped context on pooled connections', () => {
  it('does not leak to the next user of the same connection', async () => {
    const single = appPool(1);
    try {
      const pidInside = await withOrg(single, a.orgId, async (tx) => {
        expect(await count(tx as never, 'media')).toBe(1);
        return (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
      });
      const after = await single.query<{ pid: number; setting: string | null; n: string }>(
        "SELECT pg_backend_pid() AS pid, current_setting('app.org_id', true) AS setting, (SELECT count(*) FROM media) AS n",
      );
      expect(after.rows[0]?.pid).toBe(pidInside);
      expect(after.rows[0]?.setting ?? '').toBe('');
      expect(Number(after.rows[0]?.n)).toBe(0);
      await withOrg(single, b.orgId, async (tx) => {
        const ids = await tx.query<{ id: string }>('SELECT id FROM media');
        expect(ids.rows).toEqual([{ id: b.mediaId }]);
      });
    } finally {
      await single.end();
    }
  });

  it('rolls back and clears the context when the work throws', async () => {
    const single = appPool(1);
    try {
      const name = `rollback-${randomUUID()}`;
      await expect(
        withOrg(single, a.orgId, async (tx) => {
          await tx.query('INSERT INTO playlist (org_id, name) VALUES ($1, $2)', [a.orgId, name]);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await count(single, 'playlist')).toBe(0);
      await withOrg(single, a.orgId, async (tx) => {
        expect((await tx.query('SELECT 1 FROM playlist WHERE name = $1', [name])).rowCount).toBe(0);
      });
    } finally {
      await single.end();
    }
  });

  it('replaces a connection that was lost in the middle of a transaction', async () => {
    const single = appPool(1);
    try {
      let lost: number | undefined;
      await expect(
        withOrg(single, a.orgId, async (tx) => {
          lost = (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
          // The server closes this connection, so the ROLLBACK that follows cannot succeed.
          await tx.query('SELECT pg_terminate_backend(pg_backend_pid())');
        }),
      ).rejects.toThrow();
      const after = await single.query<{ pid: number; setting: string | null; n: string }>(
        "SELECT pg_backend_pid() AS pid, current_setting('app.org_id', true) AS setting, (SELECT count(*) FROM media) AS n",
      );
      expect(lost).toBeTypeOf('number');
      expect(after.rows[0]?.pid).not.toBe(lost);
      expect(after.rows[0]?.setting ?? '').toBe('');
      expect(Number(after.rows[0]?.n)).toBe(0);
    } finally {
      await single.end();
    }
  });

  it('enters an organisation part-way through a transaction, and only for that transaction', async () => {
    const single = appPool(1);
    try {
      await withResolvedOrg(single, async (tx, enterOrg) => {
        expect(await count(tx as never, 'media')).toBe(0);
        await enterOrg(a.orgId);
        const ids = await tx.query<{ id: string }>('SELECT id FROM media');
        expect(ids.rows).toEqual([{ id: a.mediaId }]);
      });
      expect(await count(single, 'media')).toBe(0);
      // A failure after entering rolls back what was written before and after it.
      const name = `resolved-${randomUUID()}`;
      await expect(
        withResolvedOrg(single, async (tx, enterOrg) => {
          await enterOrg(a.orgId);
          await tx.query('INSERT INTO playlist (org_id, name) VALUES ($1, $2)', [a.orgId, name]);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      await withOrg(single, a.orgId, async (tx) => {
        expect((await tx.query('SELECT 1 FROM playlist WHERE name = $1', [name])).rowCount).toBe(0);
      });
      await expect(
        withResolvedOrg(single, (_tx, enterOrg) => enterOrg("x' OR '1'='1")),
      ).rejects.toThrow(/UUID/);
    } finally {
      await single.end();
    }
  });

  it('keeps concurrent organisations apart under load', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const org = i % 2 === 0 ? a : b;
        return withOrg(pool, org.orgId, async (tx) => {
          await tx.query('SELECT pg_sleep(0.005)');
          const rows = (
            await tx.query<{ org_id: string }>(
              'SELECT org_id FROM media UNION SELECT org_id FROM publication UNION SELECT id FROM organization',
            )
          ).rows;
          return rows.every((r) => r.org_id === org.orgId) && rows.length === 1;
        });
      }),
    );
    expect(results.every(Boolean)).toBe(true);
  });
});

describe('immutable publications and append-only audit', () => {
  it('the runtime role cannot UPDATE or DELETE a publication or its assets', async () => {
    for (const sql of [
      "UPDATE publication SET manifest = '{}'::jsonb",
      "UPDATE publication SET idempotency_key = 'changed-key-0000000'",
      'DELETE FROM publication',
      'UPDATE publication_asset SET position = 7',
      'DELETE FROM publication_asset',
      'TRUNCATE publication CASCADE',
    ]) {
      expect(await pgCode(withOrg(pool, a.orgId, (tx) => tx.query(sql))), sql).toBe(
        PG.insufficientPrivilege,
      );
    }
  });

  it('even the table owner cannot UPDATE, DELETE or TRUNCATE a publication (trigger)', async () => {
    await migrator.query("SELECT set_config('app.org_id', $1, false)", [a.orgId]);
    try {
      expect(
        await pgCode(
          migrator.query(
            'UPDATE publication SET manifest = manifest || \'{"muted": false}\'::jsonb WHERE id = $1',
            [a.publicationId],
          ),
        ),
      ).toBe(PG.restrict);
      expect(
        await pgCode(migrator.query('DELETE FROM publication WHERE id = $1', [a.publicationId])),
      ).toBe(PG.restrict);
      expect(
        await pgCode(
          migrator.query('DELETE FROM publication_asset WHERE publication_id = $1', [
            a.publicationId,
          ]),
        ),
      ).toBe(PG.restrict);
      expect(await pgCode(migrator.query('TRUNCATE publication CASCADE'))).toBe(PG.restrict);
      const still = await migrator.query<{ muted: boolean }>(
        "SELECT (manifest ->> 'muted')::boolean AS muted FROM publication WHERE id = $1",
        [a.publicationId],
      );
      expect(still.rows).toEqual([{ muted: true }]);
    } finally {
      await migrator.query("SELECT set_config('app.org_id', '', false)");
    }
  });

  it('the runtime role can append and read audit events but cannot UPDATE or DELETE them', async () => {
    await withOrg(pool, a.orgId, async (tx) => {
      await tx.query(
        "INSERT INTO audit_event (org_id, actor_type, actor_id, action, result, detail) VALUES ($1, 'operator', $2, 'media.upload', 'success', $3)",
        [a.orgId, a.membershipId, JSON.stringify({ bytes: 10 })],
      );
      expect(await count(tx as never, 'audit_event')).toBe(2);
    });
    for (const sql of [
      "UPDATE audit_event SET result = 'failure'",
      'DELETE FROM audit_event',
      'TRUNCATE audit_event',
    ]) {
      expect(await pgCode(withOrg(pool, a.orgId, (tx) => tx.query(sql))), sql).toBe(
        PG.insufficientPrivilege,
      );
    }
  });

  it('nobody can rewrite an audit event, including the table owner', async () => {
    await migrator.query("SELECT set_config('app.org_id', $1, false)", [a.orgId]);
    try {
      expect(await pgCode(migrator.query("UPDATE audit_event SET result = 'failure'"))).toBe(
        PG.restrict,
      );
    } finally {
      await migrator.query("SELECT set_config('app.org_id', '', false)");
    }
  });

  it('cannot add assets to an existing publication, nor assets that differ from its manifest', async () => {
    // Appending a row to a publication committed earlier would widen what its player may download.
    expect(
      await pgCode(
        withOrg(pool, a.orgId, (tx) =>
          tx.query(
            'INSERT INTO publication_asset (publication_id, position, org_id, media_id) VALUES ($1, 99, $2, $3)',
            [a.publicationId, a.orgId, a.mediaId],
          ),
        ),
      ),
    ).toBe(PG.restrict);
    // Within the creating transaction, rows must match the frozen manifest position by position.
    const id = randomUUID();
    const manifest = {
      schemaVersion: 1,
      publicationId: id,
      displayId: a.displayId,
      assets: [{ assetId: a.mediaId }],
    };
    const create = (rows: [number, string][]) =>
      withOrg(pool, a.orgId, async (tx) => {
        await tx.query(
          'INSERT INTO publication (id, org_id, display_id, playlist_id, manifest, idempotency_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            id,
            a.orgId,
            a.displayId,
            a.playlistId,
            JSON.stringify(manifest),
            `key-${randomUUID()}`,
            a.membershipId,
          ],
        );
        for (const [position, mediaId] of rows) {
          await tx.query(
            'INSERT INTO publication_asset (publication_id, position, org_id, media_id) VALUES ($1, $2, $3, $4)',
            [id, position, a.orgId, mediaId],
          );
        }
      });
    expect(await pgCode(create([[1, a.mediaId]]))).toBe(PG.restrict);
    expect(await pgCode(create([[0, a.mediaId]]))).toBe('no error');
    expect(
      await pgCode(
        withOrg(pool, a.orgId, (tx) =>
          tx.query(
            'INSERT INTO publication_asset (publication_id, position, org_id, media_id) VALUES ($1, 1, $2, $3)',
            [id, a.orgId, a.mediaId],
          ),
        ),
      ),
    ).toBe(PG.restrict);
  });

  it('stamps every audit event with the database time; nobody can backdate one', async () => {
    const occurred = await withOrg(pool, a.orgId, async (tx) => {
      const { rows } = await tx.query<{ occurred_at: Date; now: Date }>(
        `INSERT INTO audit_event (occurred_at, org_id, actor_type, actor_id, action, result)
         VALUES ('2020-01-01T00:00:00Z', $1, 'operator', $2, 'auth.login', 'success')
         RETURNING occurred_at, now() AS now`,
        [a.orgId, a.membershipId],
      );
      return rows[0];
    });
    expect(occurred?.occurred_at.getTime()).toBe(occurred?.now.getTime());
    await migrator.query("SELECT set_config('app.org_id', $1, false)", [a.orgId]);
    try {
      const { rows } = await migrator.query<{ year: number }>(
        `INSERT INTO audit_event (occurred_at, org_id, actor_type, action, result)
         VALUES ('2030-01-01T00:00:00Z', $1, 'system', 'media.validate', 'success')
         RETURNING extract(year FROM occurred_at)::int AS year`,
        [a.orgId],
      );
      expect(rows[0]?.year).toBe(new Date().getUTCFullYear());
    } finally {
      await migrator.query("SELECT set_config('app.org_id', '', false)");
    }
  });

  it('rejects publications whose manifest does not match the row, and duplicate idempotency keys', async () => {
    const insert = (id: string, manifest: Record<string, unknown>, key: string) =>
      withOrg(pool, a.orgId, (tx) =>
        tx.query(
          'INSERT INTO publication (id, org_id, display_id, playlist_id, manifest, idempotency_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [id, a.orgId, a.displayId, a.playlistId, JSON.stringify(manifest), key, a.membershipId],
        ),
      );
    const id = randomUUID();
    const good = {
      schemaVersion: 1,
      publicationId: id,
      displayId: a.displayId,
      assets: [{ assetId: a.mediaId }],
    };
    expect(
      await pgCode(insert(id, { ...good, publicationId: randomUUID() }, 'key-aaaaaaaaaaaaaaaa')),
    ).toBe(PG.check);
    expect(
      await pgCode(insert(id, { ...good, displayId: b.displayId }, 'key-aaaaaaaaaaaaaaaa')),
    ).toBe(PG.check);
    expect(await pgCode(insert(id, { ...good, schemaVersion: 6 }, 'key-aaaaaaaaaaaaaaaa'))).toBe(
      PG.check,
    );
    expect(await pgCode(insert(id, { ...good, assets: [] }, 'key-aaaaaaaaaaaaaaaa'))).toBe(
      PG.check,
    );
    expect(await pgCode(insert(id, good, 'short'))).toBe(PG.check);
    expect(await pgCode(insert(id, good, 'key-aaaaaaaaaaaaaaaa'))).toBe('no error');
    const second = randomUUID();
    expect(
      await pgCode(insert(second, { ...good, publicationId: second }, 'key-aaaaaaaaaaaaaaaa')),
    ).toBe(PG.unique);
  });

  it('rejects a manifest that lacks a required field, and ready media without a size (0008)', async () => {
    const id = randomUUID();
    const good: Record<string, unknown> = {
      schemaVersion: 1,
      publicationId: id,
      displayId: a.displayId,
      assets: [{ assetId: a.mediaId }],
    };
    const insert = (manifest: Record<string, unknown>) =>
      withOrg(pool, a.orgId, (tx) =>
        tx.query(
          'INSERT INTO publication (id, org_id, display_id, playlist_id, manifest, idempotency_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            id,
            a.orgId,
            a.displayId,
            a.playlistId,
            JSON.stringify(manifest),
            `key-${randomUUID()}`,
            a.membershipId,
          ],
        ),
      );
    expect(await pgCode(insert({})), 'empty manifest').toBe(PG.check);
    for (const field of Object.keys(good)) {
      const { [field]: _omitted, ...rest } = good;
      expect(await pgCode(insert(rest)), `without ${field}`).toBe(PG.check);
      expect(await pgCode(insert({ ...good, [field]: null })), `${field}: null`).toBe(PG.check);
    }

    const ready = await withOrg(pool, a.orgId, (tx) =>
      tx.query<{ status: string }>('SELECT status FROM media WHERE id = $1', [a.mediaId]),
    );
    expect(ready.rows[0]?.status).toBe('ready');
    expect(
      await pgCode(
        withOrg(pool, a.orgId, (tx) =>
          tx.query('UPDATE media SET bytes = NULL WHERE id = $1', [a.mediaId]),
        ),
      ),
    ).toBe(PG.check);
  });
});

describe('member invites (0013)', () => {
  const invite = (org: TestOrg) => ({
    id: randomUUID(),
    values: [
      org.orgId,
      `Invitee ${org.orgId}`,
      `invitee-${org.orgId}@example.com`,
      org.membershipId,
    ],
  });
  const INSERT_INVITE = `INSERT INTO member_invite (id, org_id, role, name, email, invited_by, expires_at)
     VALUES ($1, $2, 'editor', $3, $4, $5, now() + interval '14 days')`;

  it('are read, written and changed only inside their own organisation', async () => {
    const mine = invite(a);
    const theirs = invite(b);
    for (const [org, row] of [
      [a, mine],
      [b, theirs],
    ] as const) {
      await migrator.query('BEGIN');
      try {
        await migrator.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
        await migrator.query(INSERT_INVITE, [row.id, ...row.values]);
        await migrator.query('COMMIT');
      } catch (error) {
        await migrator.query('ROLLBACK');
        throw error;
      }
    }

    await withOrg(pool, a.orgId, async (tx) => {
      const { rows } = await tx.query<{ id: string; org_id: string }>(
        'SELECT id, org_id FROM member_invite',
      );
      expect(rows).toEqual([{ id: mine.id, org_id: a.orgId }]);
      expect(
        (await tx.query('SELECT 1 FROM member_invite WHERE id = $1', [theirs.id])).rowCount,
      ).toBe(0);
      expect(
        (
          await tx.query(
            "UPDATE member_invite SET status = 'cancelled', closed_by = $2 WHERE id = $1",
            [theirs.id, a.membershipId],
          )
        ).rowCount,
      ).toBe(0);
    });
    // An invite filed under organisation B, by B's own member: refused by the policy's WITH CHECK.
    expect(
      await pgCode(
        withOrg(pool, a.orgId, (tx) =>
          tx.query(INSERT_INVITE, [
            randomUUID(),
            b.orgId,
            'Planted',
            'planted@example.com',
            b.membershipId,
          ]),
        ),
      ),
    ).toBe(PG.rlsViolation);
    // Nothing of organisation B was touched.
    await withOrg(pool, b.orgId, async (tx) => {
      const { rows } = await tx.query<{ id: string; status: string }>(
        'SELECT id, status FROM member_invite',
      );
      expect(rows).toEqual([{ id: theirs.id, status: 'pending' }]);
    });
  });
});
