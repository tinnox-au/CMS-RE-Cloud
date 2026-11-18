/**
 * The layout tables, the layout a display has assigned, the playlist guards and the version 5
 * manifest added by migration 0011 (portal v2, stage B slice 4), exercised as the runtime role
 * tinnox_app against a real PostgreSQL. Tenant isolation of `layout` and `layout_zone` is
 * covered with every other table in rls.integration.test.ts.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  STAGE_A_CONSTRAINTS,
  STAGE_B_CONSTRAINTS,
  withOrg,
  type Pool,
  type Tx,
} from '../src/index.ts';
import {
  appPool,
  createOrg,
  migratorClient,
  PG,
  pgCode,
  pgViolation,
  type TestOrg,
} from './support.ts';

let pool: Pool;
let migrator: pg.Client;
let a: TestOrg;
let b: TestOrg;

beforeAll(async () => {
  pool = appPool(4);
  migrator = await migratorClient();
  a = await createOrg(migrator, 'Layouts one');
  b = await createOrg(migrator, 'Layouts two');
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

/** Runs one statement as organisation A and resolves to its PostgreSQL error code. */
const asA = (sql: string, values: readonly unknown[] = []) =>
  pgCode(withOrg(pool, a.orgId, (tx) => tx.query(sql, values)));

/** The same, resolving to the error code and the constraint name. */
const violationAsA = (sql: string, values: readonly unknown[] = []) =>
  pgViolation(withOrg(pool, a.orgId, (tx) => tx.query(sql, values)));

const unique = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

async function insertId(tx: Tx, sql: string, values: readonly unknown[]): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(`${sql} RETURNING id`, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('insert returned no row');
  return id;
}

const INSERT_ZONE =
  'INSERT INTO layout_zone (org_id, layout_id, position, playlist_id, x_bp, y_bp, width_bp, height_bp) VALUES (app_org_id(), $1, $2, $3, $4, $5, $6, $7)';
interface ZoneValues {
  layoutId?: string;
  position?: number;
  playlistId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
const zoneValues = (zone: ZoneValues): unknown[] => [
  zone.layoutId ?? a.layoutId,
  zone.position ?? 3,
  zone.playlistId ?? a.playlistId,
  zone.x ?? 0,
  zone.y ?? 0,
  zone.width ?? 10_000,
  zone.height ?? 10_000,
];
const insertZone = (zone: ZoneValues = {}) => asA(INSERT_ZONE, zoneValues(zone));

const newPlaylist = (tx: Tx) =>
  insertId(tx, 'INSERT INTO playlist (org_id, name) VALUES (app_org_id(), $1)', [
    unique('Playlist'),
  ]);
/** A layout with one zone per playlist in position order, stacked as rows a quarter high. */
async function newLayout(tx: Tx, playlistIds: readonly string[] = []): Promise<string> {
  const id = await insertId(tx, 'INSERT INTO layout (org_id, name) VALUES (app_org_id(), $1)', [
    unique('Layout'),
  ]);
  for (const [position, playlistId] of playlistIds.entries()) {
    await tx.query(INSERT_ZONE, [id, position, playlistId, 0, position * 2500, 10_000, 2500]);
  }
  return id;
}
const newDisplay = (tx: Tx) =>
  insertId(
    tx,
    `INSERT INTO display (org_id, site_id, name, canvas_width, canvas_height)
     VALUES (app_org_id(), $1, $2, 640, 360)`,
    [a.siteId, unique('Display')],
  );

const INSERT_LAYOUT =
  'INSERT INTO layout (org_id, name, description) VALUES (app_org_id(), $1, $2)';
const insertLayout = (values: { name?: string; description?: string | null } = {}) =>
  asA(INSERT_LAYOUT, [values.name ?? 'Lobby band', values.description ?? null]);

const SOFT_DELETE = 'UPDATE playlist SET deleted_at = now() WHERE id = $1';

const zoneCount = async (layoutId: string) => {
  const { rows } = await withOrg(pool, a.orgId, (tx) =>
    tx.query<{ n: string }>('SELECT count(*) AS n FROM layout_zone WHERE layout_id = $1', [
      layoutId,
    ]),
  );
  return Number(rows[0]?.n);
};

describe('layout rows', () => {
  it('bound the name and the description', async () => {
    expect(await insertLayout()).toBe('no error');
    expect(await insertLayout({ name: 'x'.repeat(120) })).toBe('no error');
    expect(await insertLayout({ description: 'x'.repeat(500) })).toBe('no error');
    const bad: [string, { name?: string; description?: string }, string][] = [
      ['empty name', { name: '' }, 'layout_name_length'],
      ['long name', { name: 'x'.repeat(121) }, 'layout_name_length'],
      ['leading space', { name: ' Lobby band' }, 'layout_name_trimmed'],
      ['trailing space', { name: 'Lobby band ' }, 'layout_name_trimmed'],
      ['empty description', { description: '' }, 'layout_description_length'],
      ['long description', { description: 'x'.repeat(501) }, 'layout_description_length'],
    ];
    for (const [label, values, constraint] of bad) {
      expect(
        await violationAsA(INSERT_LAYOUT, [
          values.name ?? 'Lobby band',
          values.description ?? null,
        ]),
        label,
      ).toEqual({ code: PG.check, constraint });
    }
  });

  it('touch updated_at when a layout changes', async () => {
    const id = await withOrg(pool, a.orgId, (tx) => newLayout(tx));
    const { rows } = await withOrg(pool, a.orgId, async (tx) => {
      await tx.query("UPDATE layout SET name = 'Renamed' WHERE id = $1", [id]);
      return tx.query<{ touched: boolean }>(
        'SELECT updated_at > created_at AS touched FROM layout WHERE id = $1',
        [id],
      );
    });
    expect(rows).toEqual([{ touched: true }]);
  });
});

describe('layout zones', () => {
  it('hold positions 0 to 3, each once in a layout', async () => {
    const layoutId = await withOrg(pool, a.orgId, (tx) => newLayout(tx));
    expect(await insertZone({ layoutId, position: 0 })).toBe('no error');
    expect(await insertZone({ layoutId, position: 3 })).toBe('no error');
    for (const position of [4, -1]) {
      expect(
        await violationAsA(INSERT_ZONE, zoneValues({ layoutId, position })),
        `${position}`,
      ).toEqual({ code: PG.check, constraint: 'layout_zone_position_range' });
    }
    expect(await insertZone({ layoutId, position: 3 })).toBe(PG.unique);
  });

  it('lie inside the area, at least one basis point wide and high', async () => {
    const layoutId = await withOrg(pool, a.orgId, (tx) => newLayout(tx));
    const good: ZoneValues[] = [
      { x: 0, y: 0, width: 10_000, height: 10_000 },
      { x: 9_999, y: 9_999, width: 1, height: 1 },
      { x: 0, y: 8_500, width: 10_000, height: 1_500 },
    ];
    for (const [position, zone] of good.entries()) {
      expect(await insertZone({ layoutId, position, ...zone }), JSON.stringify(zone)).toBe(
        'no error',
      );
    }
    const bad: [string, ZoneValues][] = [
      ['negative x', { x: -1, width: 100 }],
      ['negative y', { y: -1, height: 100 }],
      ['width 0', { width: 0 }],
      ['height 0', { height: 0 }],
      ['x + width 10 001', { x: 1, width: 10_000 }],
      ['y + height 10 001', { y: 1, height: 10_000 }],
    ];
    for (const [label, zone] of bad) {
      expect(await violationAsA(INSERT_ZONE, zoneValues({ layoutId, ...zone })), label).toEqual({
        code: PG.check,
        constraint: 'layout_zone_in_bounds',
      });
    }
  });

  it('refuse a playlist or a layout that does not exist or belongs to another organisation', async () => {
    for (const playlistId of [randomUUID(), b.playlistId]) {
      expect(await violationAsA(INSERT_ZONE, zoneValues({ playlistId }))).toEqual({
        code: PG.foreignKey,
        constraint: 'layout_zone_playlist_fk',
      });
    }
    for (const layoutId of [randomUUID(), b.layoutId]) {
      expect(await violationAsA(INSERT_ZONE, zoneValues({ layoutId }))).toEqual({
        code: PG.foreignKey,
        constraint: 'layout_zone_layout_fk',
      });
    }
  });
});

describe('grants of the runtime role', () => {
  const tablePrivileges = async (table: string) => {
    const { rows } = await migrator.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.table_privileges
       WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'tinnox_app'
       ORDER BY 1`,
      [table],
    );
    return rows.map((r) => r.privilege_type);
  };
  const updatableColumns = async (table: string) => {
    const { rows } = await migrator.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE table_schema = 'public' AND table_name = $1
         AND grantee = 'tinnox_app' AND privilege_type = 'UPDATE'
       ORDER BY 1`,
      [table],
    );
    return rows.map((r) => r.column_name);
  };

  it('are select, insert, delete and an update of name and description on layout', async () => {
    expect(await tablePrivileges('layout')).toEqual(['DELETE', 'INSERT', 'SELECT']);
    expect(await updatableColumns('layout')).toEqual(['description', 'name']);
    const layoutId = await withOrg(pool, a.orgId, (tx) => newLayout(tx));
    expect(
      await asA("UPDATE layout SET name = 'Foyer', description = 'Lobby' WHERE id = $1", [
        layoutId,
      ]),
    ).toBe('no error');
    for (const sql of [
      'UPDATE layout SET id = gen_random_uuid() WHERE id = $1',
      'UPDATE layout SET org_id = org_id WHERE id = $1',
      'UPDATE layout SET created_at = now() WHERE id = $1',
      'UPDATE layout SET updated_at = now() WHERE id = $1',
    ]) {
      expect(await asA(sql, [layoutId]), sql).toBe(PG.insufficientPrivilege);
    }
    expect(await asA('TRUNCATE layout CASCADE')).toBe(PG.insufficientPrivilege);
  });

  it('are select, insert and delete on layout_zone, with no update at all', async () => {
    expect(await tablePrivileges('layout_zone')).toEqual(['DELETE', 'INSERT', 'SELECT']);
    expect(await updatableColumns('layout_zone')).toEqual([]);
    for (const sql of [
      'UPDATE layout_zone SET layout_id = layout_id WHERE layout_id = $1',
      'UPDATE layout_zone SET position = position WHERE layout_id = $1',
      'UPDATE layout_zone SET org_id = org_id WHERE layout_id = $1',
      'UPDATE layout_zone SET playlist_id = playlist_id WHERE layout_id = $1',
      'UPDATE layout_zone SET x_bp = x_bp WHERE layout_id = $1',
      'UPDATE layout_zone SET y_bp = y_bp WHERE layout_id = $1',
      'UPDATE layout_zone SET width_bp = width_bp WHERE layout_id = $1',
      'UPDATE layout_zone SET height_bp = height_bp WHERE layout_id = $1',
    ]) {
      expect(await asA(sql, [a.layoutId]), sql).toBe(PG.insufficientPrivilege);
    }
    expect(await asA('TRUNCATE layout_zone')).toBe(PG.insufficientPrivilege);
    // Replaced as a set: delete, then insert.
    const layoutId = await withOrg(pool, a.orgId, (tx) => newLayout(tx, [a.playlistId]));
    expect(await asA('DELETE FROM layout_zone WHERE layout_id = $1', [layoutId])).toBe('no error');
    expect(await insertZone({ layoutId, position: 0, height: 5_000 })).toBe('no error');
  });

  it('include an update of the layout a display has assigned', async () => {
    // The whole list of display columns is pinned in stage-b.integration.test.ts.
    expect(await updatableColumns('display')).toContain('assigned_layout_id');
    const displayId = await withOrg(pool, a.orgId, newDisplay);
    const assign = 'UPDATE display SET assigned_layout_id = $2 WHERE id = $1';
    expect(await asA(assign, [displayId, a.layoutId])).toBe('no error');
    expect(await asA(assign, [displayId, null])).toBe('no error');
  });
});

describe('the content a display has assigned', () => {
  it('is one of a playlist, a schedule or a layout', async () => {
    const refused = { code: PG.check, constraint: 'display_one_assignment' };
    const displayId = await withOrg(pool, a.orgId, newDisplay);
    const set = (playlistId: string | null, scheduleId: string | null, layoutId: string | null) =>
      violationAsA(
        'UPDATE display SET assigned_playlist_id = $2, assigned_schedule_id = $3, assigned_layout_id = $4 WHERE id = $1',
        [displayId, playlistId, scheduleId, layoutId],
      );
    expect(await set(a.playlistId, null, a.layoutId)).toEqual(refused);
    expect(await set(null, a.scheduleId, a.layoutId)).toEqual(refused);
    expect(await set(a.playlistId, a.scheduleId, a.layoutId)).toEqual(refused);
    expect(await set(null, null, a.layoutId)).toBeNull();
    // Adding a playlist or a schedule while the layout stays is the same refusal.
    for (const [column, id] of [
      ['assigned_playlist_id', a.playlistId],
      ['assigned_schedule_id', a.scheduleId],
    ] as const) {
      expect(
        await violationAsA(`UPDATE display SET ${column} = $2 WHERE id = $1`, [displayId, id]),
        column,
      ).toEqual(refused);
    }
    // One statement swaps them, in either direction, and clears all three.
    expect(await set(a.playlistId, null, null)).toBeNull();
    expect(await set(null, null, a.layoutId)).toBeNull();
    expect(await set(null, a.scheduleId, null)).toBeNull();
    expect(await set(null, null, null)).toBeNull();
    expect(
      await violationAsA(
        `INSERT INTO display (org_id, site_id, name, canvas_width, canvas_height, assigned_playlist_id, assigned_layout_id)
         VALUES (app_org_id(), $1, 'Planted', 640, 360, $2, $3)`,
        [a.siteId, a.playlistId, a.layoutId],
      ),
    ).toEqual(refused);
  });

  it('refuses a layout that does not exist or belongs to another organisation', async () => {
    const displayId = await withOrg(pool, a.orgId, newDisplay);
    for (const layoutId of [randomUUID(), b.layoutId]) {
      expect(
        await violationAsA('UPDATE display SET assigned_layout_id = $2 WHERE id = $1', [
          displayId,
          layoutId,
        ]),
      ).toEqual({ code: PG.foreignKey, constraint: STAGE_B_CONSTRAINTS.displayAssignedLayout });
    }
  });
});

describe('deleted playlists', () => {
  it('cannot be the playlist of a zone', async () => {
    const { deleted, layoutId } = await withOrg(pool, a.orgId, async (tx) => {
      const gone = await newPlaylist(tx);
      await tx.query(SOFT_DELETE, [gone]);
      return { deleted: gone, layoutId: await newLayout(tx, [a.playlistId]) };
    });
    const refused = { code: PG.restrict, constraint: 'layout_zone_playlist_guard' };
    expect(
      await violationAsA(INSERT_ZONE, zoneValues({ layoutId, position: 1, playlistId: deleted })),
    ).toEqual(refused);
    // The owner, who may update a zone, is bound by the same rule.
    await migrator.query("SELECT set_config('app.org_id', $1, false)", [a.orgId]);
    try {
      expect(
        await pgViolation(
          migrator.query('UPDATE layout_zone SET playlist_id = $2 WHERE layout_id = $1', [
            layoutId,
            deleted,
          ]),
        ),
      ).toEqual(refused);
    } finally {
      await migrator.query("SELECT set_config('app.org_id', '', false)");
    }
  });

  it('refuses to delete a playlist that a zone uses, softly or for good', async () => {
    const { main, band, layoutId } = await withOrg(pool, a.orgId, async (tx) => {
      const mainPlaylist = await newPlaylist(tx);
      const bandPlaylist = await newPlaylist(tx);
      return {
        main: mainPlaylist,
        band: bandPlaylist,
        layoutId: await newLayout(tx, [mainPlaylist, bandPlaylist]),
      };
    });
    for (const playlistId of [main, band]) {
      expect(await violationAsA(SOFT_DELETE, [playlistId])).toEqual({
        code: PG.restrict,
        constraint: STAGE_A_CONSTRAINTS.playlistStillAssigned,
      });
      expect(await violationAsA('DELETE FROM playlist WHERE id = $1', [playlistId])).toEqual({
        code: PG.foreignKey,
        constraint: 'layout_zone_playlist_fk',
      });
    }
    // Other changes to the playlist are unaffected.
    expect(await asA("UPDATE playlist SET name = 'Still here' WHERE id = $1", [main])).toBe(
      'no error',
    );
    // Once the layout is gone, both can be deleted.
    expect(await asA('DELETE FROM layout WHERE id = $1', [layoutId])).toBe('no error');
    expect(await asA(SOFT_DELETE, [main])).toBe('no error');
    expect(await asA(SOFT_DELETE, [band])).toBe('no error');
  });

  it('still refuses to delete a playlist that a display has assigned or a schedule uses, and still deletes an unused one', async () => {
    const playlists = await withOrg(pool, a.orgId, async (tx) => {
      const assigned = await newPlaylist(tx);
      const display = await newDisplay(tx);
      await tx.query('UPDATE display SET assigned_playlist_id = $2 WHERE id = $1', [
        display,
        assigned,
      ]);
      const byDefault = await newPlaylist(tx);
      const byEvent = await newPlaylist(tx);
      const schedule = await insertId(
        tx,
        'INSERT INTO schedule (org_id, name, default_playlist_id) VALUES (app_org_id(), $1, $2)',
        [unique('Schedule'), byDefault],
      );
      await tx.query(
        `INSERT INTO schedule_event (org_id, schedule_id, position, playlist_id, days, start_time, end_time)
         VALUES (app_org_id(), $1, 0, $2, '{t,t,t,t,t,t,t}', '09:00', '17:00')`,
        [schedule, byEvent],
      );
      return { assigned, byDefault, byEvent, unused: await newPlaylist(tx) };
    });
    for (const playlistId of [playlists.assigned, playlists.byDefault, playlists.byEvent]) {
      expect(await violationAsA(SOFT_DELETE, [playlistId])).toEqual({
        code: PG.restrict,
        constraint: STAGE_A_CONSTRAINTS.playlistStillAssigned,
      });
    }
    expect(await asA(SOFT_DELETE, [playlists.unused])).toBe('no error');
  });
});

describe('deleting a layout', () => {
  it('is refused while a display has it assigned, and takes its zones with it afterwards', async () => {
    const { layoutId, displayId } = await withOrg(pool, a.orgId, async (tx) => {
      const layout = await newLayout(tx, [a.playlistId, a.playlistId]);
      const display = await newDisplay(tx);
      await tx.query('UPDATE display SET assigned_layout_id = $2 WHERE id = $1', [display, layout]);
      return { layoutId: layout, displayId: display };
    });
    expect(await violationAsA('DELETE FROM layout WHERE id = $1', [layoutId])).toEqual({
      code: PG.foreignKey,
      constraint: STAGE_B_CONSTRAINTS.displayAssignedLayout,
    });
    expect(await zoneCount(layoutId)).toBe(2);
    expect(
      await asA('UPDATE display SET assigned_layout_id = NULL WHERE id = $1', [displayId]),
    ).toBe('no error');
    expect(await asA('DELETE FROM layout WHERE id = $1', [layoutId])).toBe('no error');
    expect(await zoneCount(layoutId)).toBe(0);
  });
});

describe('version 5 publications', () => {
  const insertPublication = (tx: Tx, id: string, manifest: Record<string, unknown>) =>
    tx.query(
      'INSERT INTO publication (id, org_id, display_id, playlist_id, manifest, idempotency_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        id,
        a.orgId,
        a.displayId,
        a.playlistId,
        JSON.stringify({ ...manifest, publicationId: id, displayId: a.displayId }),
        `key-${randomUUID()}`,
        a.membershipId,
      ],
    );

  // That version 5 is accepted and 6 refused is pinned in stage-b.integration.test.ts and
  // rls.integration.test.ts.
  it('keep publication_asset rows to the media positions of the flat list, in every zone', async () => {
    const clock = { kind: 'app', appId: a.appId, durationMs: 5000 };
    const zone = (rect: Record<string, number>, count: number) => ({
      rect,
      count,
      transition: 'cut',
      shuffle: false,
    });
    // The main zone (one media item), then the band (an app and a media item).
    const manifest = {
      schemaVersion: 5,
      transition: 'cut',
      shuffle: false,
      assets: [{ assetId: a.mediaId }, clock, { assetId: a.mediaId }],
      zones: [
        zone({ x: 0, y: 0, width: 640, height: 306 }, 1),
        zone({ x: 0, y: 306, width: 640, height: 54 }, 2),
      ],
    };
    const create = (positions: number[]) =>
      pgCode(
        withOrg(pool, a.orgId, async (tx) => {
          const id = randomUUID();
          await insertPublication(tx, id, manifest);
          for (const position of positions) {
            await tx.query(
              'INSERT INTO publication_asset (publication_id, position, org_id, media_id) VALUES ($1, $2, $3, $4)',
              [id, position, a.orgId, a.mediaId],
            );
          }
        }),
      );
    expect(await create([0, 2])).toBe('no error');
    expect(await create([0, 1])).toBe(PG.restrict);
    expect(await create([0, 2, 3])).toBe(PG.restrict);
  });
});
