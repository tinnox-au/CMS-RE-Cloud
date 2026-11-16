/**
 * The app table, the app items of a playlist and the version 3 manifest added by migration
 * 0007 (portal v2, stage B slice 2), exercised as the runtime role tinnox_app against a real
 * PostgreSQL. Tenant isolation of `app` is covered with every other table in
 * rls.integration.test.ts.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrg, type Pool, type Tx } from '../src/index.ts';
import { appPool, createOrg, migratorClient, PG, pgCode, type TestOrg } from './support.ts';

let pool: Pool;
let migrator: pg.Client;
let a: TestOrg;
let b: TestOrg;

beforeAll(async () => {
  pool = appPool(4);
  migrator = await migratorClient();
  a = await createOrg(migrator, 'Apps one');
  b = await createOrg(migrator, 'Apps two');
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

/** Runs one statement as organisation A and resolves to its PostgreSQL error code. */
const asA = (sql: string, values: readonly unknown[] = []) =>
  pgCode(withOrg(pool, a.orgId, (tx) => tx.query(sql, values)));

const textSettings = {
  heading: 'Welcome',
  body: '',
  textColour: '#ffffff',
  backgroundColour: '#000000',
};

const insertApp = (
  values: { type?: string; name?: string; description?: string | null; settings?: unknown } = {},
) =>
  asA(
    'INSERT INTO app (org_id, type, name, description, settings) VALUES (app_org_id(), $1, $2, $3, $4)',
    [
      values.type ?? 'text',
      values.name ?? 'Welcome',
      values.description ?? null,
      JSON.stringify(values.settings ?? textSettings),
    ],
  );

const newApp = async (tx: Tx): Promise<string> => {
  const { rows } = await tx.query<{ id: string }>(
    "INSERT INTO app (org_id, type, name, settings) VALUES (app_org_id(), 'text', 'Item app', $1) RETURNING id",
    [JSON.stringify(textSettings)],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('insert returned no row');
  return id;
};

const insertItem = (
  position: number,
  item: {
    mediaId?: string | null;
    appId?: string | null;
    durationMs?: number | null;
    fit?: string | null;
  },
) =>
  asA(
    'INSERT INTO playlist_item (org_id, playlist_id, position, media_id, app_id, duration_ms, fit) VALUES (app_org_id(), $1, $2, $3, $4, $5, $6)',
    [
      a.playlistId,
      position,
      item.mediaId ?? null,
      item.appId ?? null,
      item.durationMs ?? null,
      item.fit ?? null,
    ],
  );

describe('app rows', () => {
  it('knows the six types and bounds the name, description and settings', async () => {
    for (const type of ['clock', 'date', 'countdown', 'ticker', 'qr', 'text'])
      expect(await insertApp({ type }), type).toBe('no error');
    expect(await insertApp({ type: 'Clock' })).toBe(PG.check);
    expect(await insertApp({ type: 'weather' })).toBe(PG.check);
    expect(await insertApp({ name: 'x'.repeat(120) })).toBe('no error');
    expect(await insertApp({ name: '' })).toBe(PG.check);
    expect(await insertApp({ name: 'x'.repeat(121) })).toBe(PG.check);
    expect(await insertApp({ name: ' Welcome' })).toBe(PG.check);
    expect(await insertApp({ description: 'x'.repeat(500) })).toBe('no error');
    expect(await insertApp({ description: '' })).toBe(PG.check);
    expect(await insertApp({ description: 'x'.repeat(501) })).toBe(PG.check);
    expect(await insertApp({ settings: [textSettings] })).toBe(PG.check);
    expect(await insertApp({ settings: 'text' })).toBe(PG.check);
    // Random text, so the size is not hidden by compression.
    expect(await insertApp({ settings: { body: randomBytes(3200).toString('base64') } })).toBe(
      PG.check,
    );
  });

  it('touches updated_at when an app changes', async () => {
    const id = await withOrg(pool, a.orgId, newApp);
    const { rows } = await withOrg(pool, a.orgId, async (tx) => {
      await tx.query("UPDATE app SET name = 'Renamed' WHERE id = $1", [id]);
      return tx.query<{ touched: boolean }>(
        'SELECT updated_at > created_at AS touched FROM app WHERE id = $1',
        [id],
      );
    });
    expect(rows).toEqual([{ touched: true }]);
  });

  it('grants the runtime role select, insert, delete and an update of name, description and settings only', async () => {
    const table = await migrator.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.table_privileges
       WHERE table_schema = 'public' AND table_name = 'app' AND grantee = 'tinnox_app'
       ORDER BY 1`,
    );
    expect(table.rows.map((r) => r.privilege_type)).toEqual(['DELETE', 'INSERT', 'SELECT']);
    const columns = await migrator.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE table_schema = 'public' AND table_name = 'app'
         AND grantee = 'tinnox_app' AND privilege_type = 'UPDATE'
       ORDER BY 1`,
    );
    expect(columns.rows.map((r) => r.column_name)).toEqual(['description', 'name', 'settings']);
    expect(
      await asA(
        "UPDATE app SET name = 'Clock', description = 'Lobby', settings = $2 WHERE id = $1",
        [a.appId, JSON.stringify({ ...textSettings, heading: 'x' })],
      ),
    ).toBe('no error');
    for (const sql of [
      "UPDATE app SET type = 'text' WHERE id = $1",
      'UPDATE app SET type = type WHERE id = $1',
      'UPDATE app SET org_id = org_id WHERE id = $1',
      'UPDATE app SET id = gen_random_uuid() WHERE id = $1',
      'UPDATE app SET created_at = now() WHERE id = $1',
      'UPDATE app SET updated_at = now() WHERE id = $1',
    ]) {
      expect(await asA(sql, [a.appId]), sql).toBe(PG.insufficientPrivilege);
    }
    expect(await asA('TRUNCATE app CASCADE')).toBe(PG.insufficientPrivilege);
  });
});

describe('playlist items', () => {
  it('holds exactly one of a media item and an app; an app item has a duration and no fit', async () => {
    const appId = await withOrg(pool, a.orgId, newApp);
    expect(await insertItem(20, {})).toBe(PG.check);
    expect(await insertItem(20, { mediaId: a.mediaId, appId, durationMs: 5000 })).toBe(PG.check);
    expect(await insertItem(20, { appId })).toBe(PG.check);
    expect(await insertItem(20, { appId, durationMs: 5000, fit: 'contain' })).toBe(PG.check);
    expect(await insertItem(20, { appId, durationMs: 5000 })).toBe('no error');
    // Media items keep their rules: fit allowed, duration optional (video).
    expect(await insertItem(21, { mediaId: a.mediaId, fit: 'cover' })).toBe('no error');
  });

  it('refuses an app that does not exist or belongs to another organisation', async () => {
    expect(await insertItem(30, { appId: randomUUID(), durationMs: 5000 })).toBe(PG.foreignKey);
    expect(await insertItem(30, { appId: b.appId, durationMs: 5000 })).toBe(PG.foreignKey);
  });

  it('refuses to delete an app that a playlist uses', async () => {
    const appId = await withOrg(pool, a.orgId, newApp);
    expect(await insertItem(40, { appId, durationMs: 5000 })).toBe('no error');
    expect(await asA('DELETE FROM app WHERE id = $1', [appId])).toBe(PG.foreignKey);
    expect(
      await asA('DELETE FROM playlist_item WHERE playlist_id = $1 AND app_id = $2', [
        a.playlistId,
        appId,
      ]),
    ).toBe('no error');
    expect(await asA('DELETE FROM app WHERE id = $1', [appId])).toBe('no error');
  });
});

describe('version 3 publications', () => {
  const clock = {
    kind: 'app',
    durationMs: 5000,
    content: {
      type: 'clock',
      settings: {
        hourCycle: '12',
        showSeconds: false,
        textColour: '#ffffff',
        backgroundColour: '#000000',
      },
    },
  };

  const insertPublication = (tx: Tx, id: string, assets: unknown[]) =>
    tx.query(
      'INSERT INTO publication (id, org_id, display_id, playlist_id, manifest, idempotency_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        id,
        a.orgId,
        a.displayId,
        a.playlistId,
        JSON.stringify({ schemaVersion: 3, publicationId: id, displayId: a.displayId, assets }),
        `key-${randomUUID()}`,
        a.membershipId,
      ],
    );

  it('keeps publication_asset rows to the media positions of the manifest', async () => {
    const assets = [{ ...clock, appId: a.appId }, { assetId: a.mediaId }];
    const create = (position: number) =>
      pgCode(
        withOrg(pool, a.orgId, async (tx) => {
          const id = randomUUID();
          await insertPublication(tx, id, assets);
          await tx.query(
            'INSERT INTO publication_asset (publication_id, position, org_id, media_id) VALUES ($1, $2, $3, $4)',
            [id, position, a.orgId, a.mediaId],
          );
        }),
      );
    expect(await create(1)).toBe('no error');
    expect(await create(0)).toBe(PG.restrict);
  });

  it('fits the worst case: 500 tickers of 300 three-byte characters', async () => {
    const ticker = {
      kind: 'app',
      appId: a.appId,
      durationMs: 3_600_000,
      content: {
        type: 'ticker',
        settings: {
          text: '€'.repeat(300),
          speed: 'medium',
          textColour: '#ffffff',
          backgroundColour: '#000000',
        },
      },
    };
    const id = randomUUID();
    expect(
      await pgCode(
        withOrg(pool, a.orgId, (tx) => insertPublication(tx, id, Array(500).fill(ticker))),
      ),
    ).toBe('no error');
  });
});
