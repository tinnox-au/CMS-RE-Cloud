/**
 * The columns, constraints and grants added by migration 0006 (portal v2, stage B slice 1),
 * exercised as the runtime role tinnox_app against a real PostgreSQL.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrg, type Pool } from '../src/index.ts';
import { appPool, createOrg, migratorClient, PG, pgCode, type TestOrg } from './support.ts';

let pool: Pool;
let migrator: pg.Client;
let a: TestOrg;
let b: TestOrg;

beforeAll(async () => {
  pool = appPool(4);
  migrator = await migratorClient();
  a = await createOrg(migrator, 'Stage B one');
  b = await createOrg(migrator, 'Stage B two');
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

/** Runs one statement as organisation A and resolves to its PostgreSQL error code. */
const asA = (sql: string, values: readonly unknown[] = []) =>
  pgCode(withOrg(pool, a.orgId, (tx) => tx.query(sql, values)));

describe('playlist options', () => {
  it('defaults to cut without shuffle and knows only cut and fade', async () => {
    const row = await withOrg(pool, a.orgId, (tx) =>
      tx.query('SELECT transition, shuffle FROM playlist WHERE id = $1', [a.playlistId]),
    );
    expect(row.rows).toEqual([{ transition: 'cut', shuffle: false }]);
    const set = (transition: string) =>
      asA('UPDATE playlist SET transition = $2, shuffle = true WHERE id = $1', [
        a.playlistId,
        transition,
      ]);
    expect(await set('fade')).toBe('no error');
    expect(await set('cut')).toBe('no error');
    expect(await set('Fade')).toBe(PG.check);
    expect(await set('wipe')).toBe(PG.check);
  });
});

describe('media availability and thumbnail', () => {
  const window = (from: string | null, until: string | null) =>
    asA('UPDATE media SET available_from = $2, available_until = $3 WHERE id = $1', [
      a.mediaId,
      from,
      until,
    ]);

  it('accepts an open or ordered window and refuses an empty or reversed one', async () => {
    expect(await window('2026-12-01T09:00', null)).toBe('no error');
    expect(await window(null, '2026-12-01T09:00')).toBe('no error');
    expect(await window('2026-12-01T09:00', '2026-12-01T09:01')).toBe('no error');
    expect(await window('2026-12-01T09:00', '2026-12-01T09:00')).toBe(PG.check);
    expect(await window('2026-12-02T09:00', '2026-12-01T09:00')).toBe(PG.check);
    expect(await window(null, null)).toBe('no error');
  });

  it('keeps the wall-clock value as written, whatever the session zone', async () => {
    const row = await withOrg(pool, a.orgId, async (tx) => {
      await tx.query("SET LOCAL TIME ZONE 'Pacific/Auckland'");
      await tx.query(
        "UPDATE media SET available_from = '2026-12-01T09:00', available_until = NULL WHERE id = $1",
        [a.mediaId],
      );
      return tx.query(
        `SELECT to_char(available_from, 'YYYY-MM-DD"T"HH24:MI') AS available_from FROM media WHERE id = $1`,
        [a.mediaId],
      );
    });
    expect(row.rows).toEqual([{ available_from: '2026-12-01T09:00' }]);
    expect(await window(null, null)).toBe('no error');
  });

  it('accepts a thumbnail key only inside its own organisation, once', async () => {
    const set = (key: string | null) =>
      asA('UPDATE media SET thumb_storage_key = $2 WHERE id = $1', [a.mediaId, key]);
    const own = `${a.orgId}/${randomUUID()}`;
    expect(await set(`${b.orgId}/${randomUUID()}`)).toBe(PG.check);
    expect(await set(`${a.orgId}/../${randomUUID()}`)).toBe(PG.check);
    expect(await set(`${a.orgId}/${randomUUID().toUpperCase()}`)).toBe(PG.check);
    expect(await set(own)).toBe('no error');
    const other = await withOrg(pool, a.orgId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO media (org_id, kind, original_name) VALUES (app_org_id(), 'image', 'photo.png') RETURNING id",
      );
      return rows[0]?.id;
    });
    expect(await asA('UPDATE media SET thumb_storage_key = $2 WHERE id = $1', [other, own])).toBe(
      PG.unique,
    );
    expect(await set(null)).toBe('no error');
  });
});

describe('display rotation and working hours', () => {
  const day = { start: '09:00', end: '17:00' };
  const week = [day, day, day, day, day, null, null];

  it('defaults to no rotation and always on', async () => {
    const row = await withOrg(pool, a.orgId, (tx) =>
      tx.query('SELECT rotation, working_hours FROM display WHERE id = $1', [a.displayId]),
    );
    expect(row.rows).toEqual([{ rotation: 0, working_hours: null }]);
  });

  it('knows only the four right-angle rotations', async () => {
    const set = (rotation: number) =>
      asA('UPDATE display SET rotation = $2 WHERE id = $1', [a.displayId, rotation]);
    for (const rotation of [90, 180, 270, 0])
      expect(await set(rotation), String(rotation)).toBe('no error');
    expect(await set(45)).toBe(PG.check);
    expect(await set(360)).toBe(PG.check);
    expect(await set(-90)).toBe(PG.check);
  });

  it('accepts seven days or NULL and refuses any other shape or an oversized value', async () => {
    const set = (hours: unknown) =>
      asA('UPDATE display SET working_hours = $2 WHERE id = $1', [
        a.displayId,
        hours === null ? null : JSON.stringify(hours),
      ]);
    expect(await set(week)).toBe('no error');
    expect(await set(null)).toBe('no error');
    expect(await set(week.slice(0, 6))).toBe(PG.check);
    expect(await set([...week, null])).toBe(PG.check);
    expect(await set({ monday: day })).toBe(PG.check);
    const padded = { start: '09:00', end: '17:00', pad: 'x'.repeat(200) };
    expect(await set(Array(7).fill(padded))).toBe(PG.check);
  });

  it('grants the runtime role exactly rotation and working_hours on top of stage A', async () => {
    const { rows } = await migrator.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE table_schema = 'public' AND table_name = 'display'
         AND grantee = 'tinnox_app' AND privilege_type = 'UPDATE'
       ORDER BY column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(
      [
        // 0001
        'name',
        'canvas_width',
        'canvas_height',
        'content_x',
        'content_y',
        'content_width',
        'content_height',
        'default_fit',
        // 0005
        'description',
        'assigned_playlist_id',
        // 0006
        'rotation',
        'working_hours',
      ].sort(),
    );
  });
});

describe('publication manifest version', () => {
  it('accepts schema versions 1 and 2 and refuses 3', async () => {
    const insert = (version: number) => {
      const id = randomUUID();
      const manifest = {
        schemaVersion: version,
        publicationId: id,
        displayId: a.displayId,
        assets: [{ assetId: a.mediaId }],
      };
      return asA(
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
    };
    expect(await insert(1)).toBe('no error');
    expect(await insert(2)).toBe('no error');
    expect(await insert(3)).toBe(PG.check);
  });
});
