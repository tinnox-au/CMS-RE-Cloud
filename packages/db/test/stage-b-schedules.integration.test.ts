/**
 * The schedule tables, the schedule a display has assigned, the playlist guards and the
 * version 4 manifest added by migration 0008 (portal v2, stage B slice 3), exercised as the
 * runtime role tinnox_app against a real PostgreSQL. Tenant isolation of `schedule` and
 * `schedule_event` is covered with every other table in rls.integration.test.ts.
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
  a = await createOrg(migrator, 'Schedules one');
  b = await createOrg(migrator, 'Schedules two');
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

const newPlaylist = (tx: Tx) =>
  insertId(tx, 'INSERT INTO playlist (org_id, name) VALUES (app_org_id(), $1)', [
    unique('Playlist'),
  ]);
const newSchedule = (tx: Tx, defaultPlaylistId: string) =>
  insertId(
    tx,
    'INSERT INTO schedule (org_id, name, default_playlist_id) VALUES (app_org_id(), $1, $2)',
    [unique('Schedule'), defaultPlaylistId],
  );
const newDisplay = (tx: Tx) =>
  insertId(
    tx,
    `INSERT INTO display (org_id, site_id, name, canvas_width, canvas_height)
     VALUES (app_org_id(), $1, $2, 640, 360)`,
    [a.siteId, unique('Display')],
  );

const INSERT_SCHEDULE =
  'INSERT INTO schedule (org_id, name, description, default_playlist_id) VALUES (app_org_id(), $1, $2, $3)';
const insertSchedule = (
  values: { name?: string; description?: string | null; defaultPlaylistId?: string } = {},
) =>
  asA(INSERT_SCHEDULE, [
    values.name ?? 'Opening hours',
    values.description ?? null,
    values.defaultPlaylistId ?? a.playlistId,
  ]);

const EVERY_DAY = [true, true, true, true, true, true, true];
const INSERT_EVENT =
  'INSERT INTO schedule_event (org_id, schedule_id, position, playlist_id, days, start_time, end_time) VALUES (app_org_id(), $1, $2, $3, $4, $5, $6)';
interface EventValues {
  scheduleId?: string;
  position?: number;
  playlistId?: string;
  /** A JavaScript array, or an array literal for the shapes an array cannot say. */
  days?: unknown;
  start?: string;
  end?: string;
}
const eventValues = (event: EventValues): unknown[] => [
  event.scheduleId ?? a.scheduleId,
  event.position ?? 1,
  event.playlistId ?? a.playlistId,
  event.days ?? EVERY_DAY,
  event.start ?? '09:00',
  event.end ?? '17:00',
];
const insertEvent = (event: EventValues = {}) => asA(INSERT_EVENT, eventValues(event));

const SOFT_DELETE = 'UPDATE playlist SET deleted_at = now() WHERE id = $1';

describe('schedule rows', () => {
  it('bounds the name and the description', async () => {
    expect(await insertSchedule()).toBe('no error');
    expect(await insertSchedule({ name: 'x'.repeat(120) })).toBe('no error');
    expect(await insertSchedule({ name: '' })).toBe(PG.check);
    expect(await insertSchedule({ name: 'x'.repeat(121) })).toBe(PG.check);
    expect(await insertSchedule({ name: ' Opening hours' })).toBe(PG.check);
    expect(await insertSchedule({ name: 'Opening hours ' })).toBe(PG.check);
    expect(await insertSchedule({ description: 'x'.repeat(500) })).toBe('no error');
    expect(await insertSchedule({ description: '' })).toBe(PG.check);
    expect(await insertSchedule({ description: 'x'.repeat(501) })).toBe(PG.check);
  });

  it('touches updated_at when a schedule changes', async () => {
    const id = await withOrg(pool, a.orgId, (tx) => newSchedule(tx, a.playlistId));
    const { rows } = await withOrg(pool, a.orgId, async (tx) => {
      await tx.query("UPDATE schedule SET name = 'Renamed' WHERE id = $1", [id]);
      return tx.query<{ touched: boolean }>(
        'SELECT updated_at > created_at AS touched FROM schedule WHERE id = $1',
        [id],
      );
    });
    expect(rows).toEqual([{ touched: true }]);
  });

  it('refuses a default playlist that does not exist or belongs to another organisation', async () => {
    const refused = { code: PG.foreignKey, constraint: 'schedule_default_playlist_fk' };
    for (const playlistId of [randomUUID(), b.playlistId]) {
      expect(await violationAsA(INSERT_SCHEDULE, ['Planted', null, playlistId])).toEqual(refused);
      expect(
        await violationAsA('UPDATE schedule SET default_playlist_id = $2 WHERE id = $1', [
          a.scheduleId,
          playlistId,
        ]),
      ).toEqual(refused);
    }
  });
});

describe('schedule events', () => {
  it('takes seven days, Monday first, with at least one ticked', async () => {
    const monday = [true, false, false, false, false, false, false];
    expect(await insertEvent({ position: 1 })).toBe('no error');
    expect(await insertEvent({ position: 2, days: monday })).toBe('no error');
    const bad: [string, unknown][] = [
      ['six entries', EVERY_DAY.slice(0, 6)],
      ['eight entries', [...EVERY_DAY, true]],
      ['no entry', '{}'],
      ['a NULL entry', [true, null, true, true, true, true, true]],
      ['two dimensions', [EVERY_DAY]],
      ['seven entries in two dimensions', '{{t},{t},{t},{t},{t},{t},{t}}'],
      ['all false', Array(7).fill(false)],
      ['a lower bound of 0', '[0:6]={t,t,t,t,t,t,t}'],
    ];
    for (const [label, days] of bad) {
      expect(await violationAsA(INSERT_EVENT, eventValues({ position: 3, days })), label).toEqual({
        code: PG.check,
        constraint: 'schedule_event_days_shape',
      });
    }
  });

  it('takes HH:mm times, 24:00 only as the end, and no empty window', async () => {
    const good: [string, string][] = [
      ['00:00', '24:00'],
      ['22:00', '02:00'],
      ['23:59', '00:01'],
      ['09:00', '09:01'],
    ];
    for (const [index, [start, end]] of good.entries()) {
      expect(await insertEvent({ position: 10 + index, start, end }), `${start} to ${end}`).toBe(
        'no error',
      );
    }
    const bad: [string, string, string][] = [
      ['24:00', '02:00', 'schedule_event_start_format'],
      ['9:00', '17:00', 'schedule_event_start_format'],
      ['09:60', '17:00', 'schedule_event_start_format'],
      ['09:00:00', '17:00', 'schedule_event_start_format'],
      ['', '17:00', 'schedule_event_start_format'],
      ['09:00', '00:00', 'schedule_event_end_format'],
      ['09:00', '24:01', 'schedule_event_end_format'],
      ['09:00', '25:00', 'schedule_event_end_format'],
      ['09:00', '5pm', 'schedule_event_end_format'],
      ['09:00', '09:00', 'schedule_event_not_empty'],
    ];
    for (const [start, end, constraint] of bad) {
      expect(
        await violationAsA(INSERT_EVENT, eventValues({ position: 20, start, end })),
        `${start} to ${end}`,
      ).toEqual({ code: PG.check, constraint });
    }
  });

  it('holds positions 0 to 49, each once in a schedule', async () => {
    const scheduleId = await withOrg(pool, a.orgId, (tx) => newSchedule(tx, a.playlistId));
    expect(await insertEvent({ scheduleId, position: 0 })).toBe('no error');
    expect(await insertEvent({ scheduleId, position: 49 })).toBe('no error');
    expect(await insertEvent({ scheduleId, position: 50 })).toBe(PG.check);
    expect(await insertEvent({ scheduleId, position: -1 })).toBe(PG.check);
    expect(await insertEvent({ scheduleId, position: 49 })).toBe(PG.unique);
  });

  it('refuses a playlist or a schedule that does not exist or belongs to another organisation', async () => {
    for (const playlistId of [randomUUID(), b.playlistId]) {
      expect(await violationAsA(INSERT_EVENT, eventValues({ position: 30, playlistId }))).toEqual({
        code: PG.foreignKey,
        constraint: 'schedule_event_playlist_fk',
      });
    }
    for (const scheduleId of [randomUUID(), b.scheduleId]) {
      expect(await violationAsA(INSERT_EVENT, eventValues({ position: 30, scheduleId }))).toEqual({
        code: PG.foreignKey,
        constraint: 'schedule_event_schedule_fk',
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

  it('are select, insert, delete and an update of name, description and default playlist on schedule', async () => {
    expect(await tablePrivileges('schedule')).toEqual(['DELETE', 'INSERT', 'SELECT']);
    expect(await updatableColumns('schedule')).toEqual([
      'default_playlist_id',
      'description',
      'name',
    ]);
    const { scheduleId, playlistId } = await withOrg(pool, a.orgId, async (tx) => {
      const playlist = await newPlaylist(tx);
      return { scheduleId: await newSchedule(tx, a.playlistId), playlistId: playlist };
    });
    expect(
      await asA(
        "UPDATE schedule SET name = 'Weekdays', description = 'Lobby', default_playlist_id = $2 WHERE id = $1",
        [scheduleId, playlistId],
      ),
    ).toBe('no error');
    for (const sql of [
      'UPDATE schedule SET id = gen_random_uuid() WHERE id = $1',
      'UPDATE schedule SET org_id = org_id WHERE id = $1',
      'UPDATE schedule SET created_at = now() WHERE id = $1',
      'UPDATE schedule SET updated_at = now() WHERE id = $1',
    ]) {
      expect(await asA(sql, [scheduleId]), sql).toBe(PG.insufficientPrivilege);
    }
    expect(await asA('TRUNCATE schedule CASCADE')).toBe(PG.insufficientPrivilege);
  });

  it('are select, insert and delete on schedule_event, with no update at all', async () => {
    expect(await tablePrivileges('schedule_event')).toEqual(['DELETE', 'INSERT', 'SELECT']);
    expect(await updatableColumns('schedule_event')).toEqual([]);
    for (const sql of [
      'UPDATE schedule_event SET position = position WHERE schedule_id = $1',
      'UPDATE schedule_event SET playlist_id = playlist_id WHERE schedule_id = $1',
      'UPDATE schedule_event SET days = days WHERE schedule_id = $1',
      "UPDATE schedule_event SET start_time = '10:00' WHERE schedule_id = $1",
      "UPDATE schedule_event SET end_time = '18:00' WHERE schedule_id = $1",
      'UPDATE schedule_event SET schedule_id = schedule_id WHERE schedule_id = $1',
      'UPDATE schedule_event SET org_id = org_id WHERE schedule_id = $1',
    ]) {
      expect(await asA(sql, [a.scheduleId]), sql).toBe(PG.insufficientPrivilege);
    }
    expect(await asA('TRUNCATE schedule_event')).toBe(PG.insufficientPrivilege);
    // Replaced as a set: delete, then insert.
    const scheduleId = await withOrg(pool, a.orgId, (tx) => newSchedule(tx, a.playlistId));
    expect(await insertEvent({ scheduleId, position: 0 })).toBe('no error');
    expect(await asA('DELETE FROM schedule_event WHERE schedule_id = $1', [scheduleId])).toBe(
      'no error',
    );
    expect(await insertEvent({ scheduleId, position: 0, start: '10:00' })).toBe('no error');
  });

  it('include an update of the schedule a display has assigned', async () => {
    // The whole list of display columns is pinned in stage-b.integration.test.ts.
    expect(await updatableColumns('display')).toContain('assigned_schedule_id');
    const displayId = await withOrg(pool, a.orgId, newDisplay);
    const assign = 'UPDATE display SET assigned_schedule_id = $2 WHERE id = $1';
    expect(await asA(assign, [displayId, a.scheduleId])).toBe('no error');
    expect(await asA(assign, [displayId, null])).toBe('no error');
  });
});

describe('the content a display has assigned', () => {
  it('is a playlist or a schedule, never both', async () => {
    const refused = { code: PG.check, constraint: 'display_one_assignment' };
    const displayId = await withOrg(pool, a.orgId, newDisplay);
    const set = (playlistId: string | null, scheduleId: string | null) =>
      violationAsA(
        'UPDATE display SET assigned_playlist_id = $2, assigned_schedule_id = $3 WHERE id = $1',
        [displayId, playlistId, scheduleId],
      );
    expect(await set(a.playlistId, null)).toBeNull();
    expect(await set(a.playlistId, a.scheduleId)).toEqual(refused);
    // Adding the schedule while the playlist stays is the same refusal.
    expect(
      await violationAsA('UPDATE display SET assigned_schedule_id = $2 WHERE id = $1', [
        displayId,
        a.scheduleId,
      ]),
    ).toEqual(refused);
    // One statement swaps the two, in either direction, and clears both.
    expect(await set(null, a.scheduleId)).toBeNull();
    expect(
      await violationAsA('UPDATE display SET assigned_playlist_id = $2 WHERE id = $1', [
        displayId,
        a.playlistId,
      ]),
    ).toEqual(refused);
    expect(await set(a.playlistId, null)).toBeNull();
    expect(await set(null, null)).toBeNull();
    expect(
      await violationAsA(
        `INSERT INTO display (org_id, site_id, name, canvas_width, canvas_height, assigned_playlist_id, assigned_schedule_id)
         VALUES (app_org_id(), $1, 'Planted', 640, 360, $2, $3)`,
        [a.siteId, a.playlistId, a.scheduleId],
      ),
    ).toEqual(refused);
  });

  it('refuses a schedule that does not exist or belongs to another organisation', async () => {
    const displayId = await withOrg(pool, a.orgId, newDisplay);
    for (const scheduleId of [randomUUID(), b.scheduleId]) {
      expect(
        await violationAsA('UPDATE display SET assigned_schedule_id = $2 WHERE id = $1', [
          displayId,
          scheduleId,
        ]),
      ).toEqual({
        code: PG.foreignKey,
        constraint: STAGE_B_CONSTRAINTS.displayAssignedSchedule,
      });
    }
  });
});

describe('deleted playlists', () => {
  it('cannot be the default playlist of a schedule or the playlist of an event', async () => {
    const { deleted, scheduleId } = await withOrg(pool, a.orgId, async (tx) => {
      const gone = await newPlaylist(tx);
      await tx.query(SOFT_DELETE, [gone]);
      return { deleted: gone, scheduleId: await newSchedule(tx, a.playlistId) };
    });
    const asDefault = { code: PG.restrict, constraint: 'schedule_default_playlist_guard' };
    expect(await violationAsA(INSERT_SCHEDULE, ['Planted', null, deleted])).toEqual(asDefault);
    expect(
      await violationAsA('UPDATE schedule SET default_playlist_id = $2 WHERE id = $1', [
        scheduleId,
        deleted,
      ]),
    ).toEqual(asDefault);
    expect(
      await violationAsA(
        INSERT_EVENT,
        eventValues({ scheduleId, position: 0, playlistId: deleted }),
      ),
    ).toEqual({ code: PG.restrict, constraint: 'schedule_event_playlist_guard' });
    // The owner is bound by the same rule.
    await migrator.query("SELECT set_config('app.org_id', $1, false)", [a.orgId]);
    try {
      expect(
        await pgCode(
          migrator.query('UPDATE schedule SET default_playlist_id = $2 WHERE id = $1', [
            scheduleId,
            deleted,
          ]),
        ),
      ).toBe(PG.restrict);
    } finally {
      await migrator.query("SELECT set_config('app.org_id', '', false)");
    }
  });

  it('refuses to delete a playlist that a schedule uses as its default, softly or for good', async () => {
    const { playlistId, scheduleId } = await withOrg(pool, a.orgId, async (tx) => {
      const playlist = await newPlaylist(tx);
      return { playlistId: playlist, scheduleId: await newSchedule(tx, playlist) };
    });
    expect(await violationAsA(SOFT_DELETE, [playlistId])).toEqual({
      code: PG.restrict,
      constraint: STAGE_A_CONSTRAINTS.playlistStillAssigned,
    });
    expect(await violationAsA('DELETE FROM playlist WHERE id = $1', [playlistId])).toEqual({
      code: PG.foreignKey,
      constraint: 'schedule_default_playlist_fk',
    });
    // Other changes to the playlist are unaffected.
    expect(await asA("UPDATE playlist SET name = 'Still here' WHERE id = $1", [playlistId])).toBe(
      'no error',
    );
    // Once the schedule is gone, it can be deleted.
    expect(await asA('DELETE FROM schedule WHERE id = $1', [scheduleId])).toBe('no error');
    expect(await asA(SOFT_DELETE, [playlistId])).toBe('no error');
  });

  it('refuses to delete a playlist that an event of a schedule uses, softly or for good', async () => {
    const { playlistId, scheduleId } = await withOrg(pool, a.orgId, async (tx) => {
      const playlist = await newPlaylist(tx);
      const schedule = await newSchedule(tx, a.playlistId);
      await tx.query(
        INSERT_EVENT,
        eventValues({ scheduleId: schedule, position: 0, playlistId: playlist }),
      );
      return { playlistId: playlist, scheduleId: schedule };
    });
    expect(await violationAsA(SOFT_DELETE, [playlistId])).toEqual({
      code: PG.restrict,
      constraint: STAGE_A_CONSTRAINTS.playlistStillAssigned,
    });
    expect(await violationAsA('DELETE FROM playlist WHERE id = $1', [playlistId])).toEqual({
      code: PG.foreignKey,
      constraint: 'schedule_event_playlist_fk',
    });
    // Once the event is gone, it can be deleted.
    expect(await asA('DELETE FROM schedule_event WHERE schedule_id = $1', [scheduleId])).toBe(
      'no error',
    );
    expect(await asA(SOFT_DELETE, [playlistId])).toBe('no error');
  });

  it('still refuses to delete a playlist that a display has assigned, and still deletes an unused one', async () => {
    const { assigned, unused, displayId } = await withOrg(pool, a.orgId, async (tx) => {
      const playlist = await newPlaylist(tx);
      const display = await newDisplay(tx);
      await tx.query('UPDATE display SET assigned_playlist_id = $2 WHERE id = $1', [
        display,
        playlist,
      ]);
      return { assigned: playlist, unused: await newPlaylist(tx), displayId: display };
    });
    expect(await violationAsA(SOFT_DELETE, [assigned])).toEqual({
      code: PG.restrict,
      constraint: STAGE_A_CONSTRAINTS.playlistStillAssigned,
    });
    expect(await asA(SOFT_DELETE, [unused])).toBe('no error');
    expect(
      await asA('UPDATE display SET assigned_playlist_id = NULL WHERE id = $1', [displayId]),
    ).toBe('no error');
    expect(await asA(SOFT_DELETE, [assigned])).toBe('no error');
    const { rows } = await withOrg(pool, a.orgId, (tx) =>
      tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM playlist WHERE id = ANY ($1) AND deleted_at IS NOT NULL',
        [[assigned, unused]],
      ),
    );
    expect(rows).toEqual([{ n: '2' }]);
  });
});

describe('deleting a schedule', () => {
  const events = async (scheduleId: string) => {
    const { rows } = await withOrg(pool, a.orgId, (tx) =>
      tx.query<{ n: string }>('SELECT count(*) AS n FROM schedule_event WHERE schedule_id = $1', [
        scheduleId,
      ]),
    );
    return Number(rows[0]?.n);
  };

  it('is refused while a display has it assigned, and takes its events with it afterwards', async () => {
    const { scheduleId, displayId } = await withOrg(pool, a.orgId, async (tx) => {
      const schedule = await newSchedule(tx, a.playlistId);
      for (const position of [0, 1]) {
        await tx.query(INSERT_EVENT, eventValues({ scheduleId: schedule, position }));
      }
      const display = await newDisplay(tx);
      await tx.query('UPDATE display SET assigned_schedule_id = $2 WHERE id = $1', [
        display,
        schedule,
      ]);
      return { scheduleId: schedule, displayId: display };
    });
    expect(await violationAsA('DELETE FROM schedule WHERE id = $1', [scheduleId])).toEqual({
      code: PG.foreignKey,
      constraint: STAGE_B_CONSTRAINTS.displayAssignedSchedule,
    });
    expect(await events(scheduleId)).toBe(2);
    expect(
      await asA('UPDATE display SET assigned_schedule_id = NULL WHERE id = $1', [displayId]),
    ).toBe('no error');
    expect(await asA('DELETE FROM schedule WHERE id = $1', [scheduleId])).toBe('no error');
    expect(await events(scheduleId)).toBe(0);
  });
});

describe('version 4 publications', () => {
  const rule = { days: EVERY_DAY, start: '09:00', end: '17:00' };

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

  // That version 4 is accepted and 5 refused is pinned in stage-b.integration.test.ts.
  it('keep publication_asset rows to the media positions of the flat list, in every playlist', async () => {
    const clock = { kind: 'app', appId: a.appId, durationMs: 5000 };
    // The default playlist (one media item), then an event playlist (an app and a media item).
    const manifest = {
      schemaVersion: 4,
      assets: [{ assetId: a.mediaId }, clock, { assetId: a.mediaId }],
      schedule: {
        playlists: [
          { count: 1, transition: 'cut', shuffle: false },
          { count: 2, transition: 'fade', shuffle: true },
        ],
        events: [{ playlist: 1, ...rule }],
      },
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
