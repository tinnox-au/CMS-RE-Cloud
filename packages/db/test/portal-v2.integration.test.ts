/**
 * The tables, columns, constraints, grants and guards added by migration 0005
 * (portal v2, stage A), exercised as the runtime role tinnox_app against a real
 * PostgreSQL. Tenant isolation of the new tables is proven in rls.integration.test.ts;
 * the upgrade of a database that already holds data in migration-0005.integration.test.ts.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  STAGE_A_CONSTRAINTS,
  violatedConstraint,
  withOrg,
  type Pool,
  type PoolClient,
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
  pool = appPool(6);
  migrator = await migratorClient();
  a = await createOrg(migrator, 'Stage A one');
  b = await createOrg(migrator, 'Stage A two');
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

/** Runs one statement as organisation A and resolves to its PostgreSQL error code. */
const asA = (sql: string, values: readonly unknown[] = []) =>
  pgCode(withOrg(pool, a.orgId, (tx) => tx.query(sql, values)));

const unique = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

async function insertId(tx: Tx, sql: string, values: readonly unknown[]): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(`${sql} RETURNING id`, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('insert returned no row');
  return id;
}

const newPlaylist = (tx: Tx, name = unique('Playlist')) =>
  insertId(tx, 'INSERT INTO playlist (org_id, name) VALUES (app_org_id(), $1)', [name]);
const newDisplay = (tx: Tx, siteId: string, assignedPlaylistId: string | null = null) =>
  insertId(
    tx,
    `INSERT INTO display (org_id, site_id, name, canvas_width, canvas_height, assigned_playlist_id)
     VALUES (app_org_id(), $1, $2, 640, 360, $3)`,
    [siteId, unique('Display'), assignedPlaylistId],
  );
const newMedia = (tx: Tx, kind: 'image' | 'video' = 'image') =>
  insertId(tx, 'INSERT INTO media (org_id, kind, original_name) VALUES (app_org_id(), $1, $2)', [
    kind,
    kind === 'image' ? 'photo.png' : 'clip.mp4',
  ]);
const newTag = (tx: Tx, scope: 'media' | 'display', name = unique('Tag')) =>
  insertId(tx, 'INSERT INTO tag (org_id, scope, name) VALUES (app_org_id(), $1, $2)', [
    scope,
    name,
  ]);
const newFolder = (tx: Tx, name = unique('Folder')) =>
  insertId(tx, 'INSERT INTO folder (org_id, name) VALUES (app_org_id(), $1)', [name]);

describe('tags', () => {
  it('accepts both scopes and all eight colours, and defaults the colour to teal', async () => {
    await withOrg(pool, a.orgId, async (tx) => {
      const id = await newTag(tx, 'media');
      const created = await tx.query<{ colour: string; scope: string }>(
        'SELECT colour, scope FROM tag WHERE id = $1',
        [id],
      );
      expect(created.rows).toEqual([{ colour: 'teal', scope: 'media' }]);
      for (const colour of ['teal', 'sky', 'slate', 'green', 'amber', 'red', 'violet', 'pink']) {
        const updated = await tx.query('UPDATE tag SET colour = $2 WHERE id = $1', [id, colour]);
        expect(updated.rowCount, colour).toBe(1);
      }
      await newTag(tx, 'display');
      await newTag(tx, 'media', 'x'.repeat(40));
    });
  });

  it('refuses names out of bounds, untrimmed names, unknown colours and unknown scopes', async () => {
    const insert = 'INSERT INTO tag (org_id, scope, name, colour) VALUES ($1, $2, $3, $4)';
    const bad: [string, string, string][] = [
      ['media', '', 'teal'],
      ['media', 'x'.repeat(41), 'teal'],
      ['media', ' padded', 'teal'],
      ['media', 'padded ', 'teal'],
      ['media', unique('Tag'), 'magenta'],
      ['media', unique('Tag'), 'Teal'],
      ['media', unique('Tag'), '#0f4761'],
      ['playlist', unique('Tag'), 'teal'],
      ['', unique('Tag'), 'teal'],
    ];
    for (const [scope, name, colour] of bad) {
      expect(await asA(insert, [a.orgId, scope, name, colour]), `${scope}/${name}/${colour}`).toBe(
        PG.check,
      );
    }
    expect(await asA("UPDATE tag SET name = '' WHERE id = $1", [a.mediaTagId])).toBe(PG.check);
    expect(await asA("UPDATE tag SET colour = 'gold' WHERE id = $1", [a.mediaTagId])).toBe(
      PG.check,
    );
  });

  it('keeps names unique per organisation and scope, ignoring case', async () => {
    const name = unique('Summer Sale');
    await withOrg(pool, a.orgId, (tx) => newTag(tx, 'media', name));
    const insert = 'INSERT INTO tag (org_id, scope, name) VALUES ($1, $2, $3)';
    expect(await asA(insert, [a.orgId, 'media', name])).toBe(PG.unique);
    expect(await asA(insert, [a.orgId, 'media', name.toUpperCase()])).toBe(PG.unique);
    expect(await asA(insert, [a.orgId, 'media', name.toLowerCase()])).toBe(PG.unique);
    // The same name is free in the other scope and in another organisation.
    expect(await asA(insert, [a.orgId, 'display', name])).toBe('no error');
    expect(
      await pgCode(withOrg(pool, b.orgId, (tx) => tx.query(insert, [b.orgId, 'media', name]))),
    ).toBe('no error');
    // Renaming onto a taken name is refused too.
    const other = await withOrg(pool, a.orgId, (tx) => newTag(tx, 'media'));
    expect(await asA('UPDATE tag SET name = $2 WHERE id = $1', [other, name.toLowerCase()])).toBe(
      PG.unique,
    );
  });

  it('lets the runtime role rename and recolour a tag, never change its scope or identity', async () => {
    expect(
      await asA("UPDATE tag SET name = $2, colour = 'violet' WHERE id = $1", [
        a.mediaTagId,
        unique('Renamed'),
      ]),
    ).toBe('no error');
    for (const sql of [
      "UPDATE tag SET scope = 'display' WHERE id = $1",
      'UPDATE tag SET scope = scope WHERE id = $1',
      'UPDATE tag SET id = gen_random_uuid() WHERE id = $1',
      'UPDATE tag SET org_id = org_id WHERE id = $1',
      'UPDATE tag SET created_at = now() WHERE id = $1',
    ]) {
      expect(await asA(sql, [a.mediaTagId]), sql).toBe(PG.insufficientPrivilege);
    }
    expect(await asA('TRUNCATE tag CASCADE')).toBe(PG.insufficientPrivilege);
  });

  it('touches updated_at when a tag or a folder changes', async () => {
    const changedAfter = (table: 'tag' | 'folder', id: string, update: string) =>
      withOrg(pool, a.orgId, async (tx) => {
        const before = await tx.query<{ unchanged: boolean }>(
          `SELECT updated_at = created_at AS unchanged FROM ${table} WHERE id = $1`,
          [id],
        );
        await tx.query(update, [id]);
        const after = await tx.query<{ changed: boolean }>(
          `SELECT updated_at > created_at AS changed FROM ${table} WHERE id = $1`,
          [id],
        );
        return [before.rows[0]?.unchanged, after.rows[0]?.changed];
      });
    // Created in one transaction, changed in a later one.
    const tag = await withOrg(pool, a.orgId, (tx) => newTag(tx, 'media'));
    expect(await changedAfter('tag', tag, "UPDATE tag SET colour = 'red' WHERE id = $1")).toEqual([
      true,
      true,
    ]);
    const folder = await withOrg(pool, a.orgId, (tx) => newFolder(tx));
    expect(
      await changedAfter('folder', folder, "UPDATE folder SET name = name || ' 2' WHERE id = $1"),
    ).toEqual([true, true]);
  });

  it('puts a tag only on what its scope names', async () => {
    const mediaTag = 'INSERT INTO media_tag (org_id, media_id, tag_id) VALUES ($1, $2, $3)';
    const displayTag = 'INSERT INTO display_tag (org_id, display_id, tag_id) VALUES ($1, $2, $3)';
    // A display tag on media and a media tag on a display fail the scope-carrying foreign key.
    expect(await asA(mediaTag, [a.orgId, a.mediaId, a.displayTagId])).toBe(PG.foreignKey);
    expect(await asA(displayTag, [a.orgId, a.displayId, a.mediaTagId])).toBe(PG.foreignKey);
    // The scope column of a join row cannot be set to make such a pair fit.
    expect(
      await asA(
        "INSERT INTO media_tag (org_id, media_id, tag_id, scope) VALUES ($1, $2, $3, 'display')",
        [a.orgId, a.mediaId, a.displayTagId],
      ),
    ).toBe(PG.check);
    expect(
      await asA(
        "INSERT INTO display_tag (org_id, display_id, tag_id, scope) VALUES ($1, $2, $3, 'media')",
        [a.orgId, a.displayId, a.mediaTagId],
      ),
    ).toBe(PG.check);
    // The same tag twice on one item is refused; join rows are never updated.
    expect(await asA(mediaTag, [a.orgId, a.mediaId, a.mediaTagId])).toBe(PG.unique);
    expect(await asA(displayTag, [a.orgId, a.displayId, a.displayTagId])).toBe(PG.unique);
    expect(await asA('UPDATE media_tag SET tag_id = tag_id')).toBe(PG.insufficientPrivilege);
    expect(await asA('UPDATE display_tag SET tag_id = tag_id')).toBe(PG.insufficientPrivilege);
    // Unknown ids fail the foreign keys.
    expect(await asA(mediaTag, [a.orgId, randomUUID(), a.mediaTagId])).toBe(PG.foreignKey);
    expect(await asA(mediaTag, [a.orgId, a.mediaId, randomUUID()])).toBe(PG.foreignKey);
  });

  it('removes a deleted tag from everything that carried it, and nothing else', async () => {
    await withOrg(pool, a.orgId, async (tx) => {
      const doomed = await newTag(tx, 'media');
      const kept = await newTag(tx, 'media');
      const displayDoomed = await newTag(tx, 'display');
      const media = await newMedia(tx);
      const display = await newDisplay(tx, a.siteId);
      await tx.query(
        'INSERT INTO media_tag (org_id, media_id, tag_id) VALUES (app_org_id(), $1, $2), (app_org_id(), $1, $3)',
        [media, doomed, kept],
      );
      await tx.query(
        'INSERT INTO display_tag (org_id, display_id, tag_id) VALUES (app_org_id(), $1, $2)',
        [display, displayDoomed],
      );
      expect((await tx.query('DELETE FROM tag WHERE id = $1', [doomed])).rowCount).toBe(1);
      expect((await tx.query('DELETE FROM tag WHERE id = $1', [displayDoomed])).rowCount).toBe(1);
      const left = await tx.query<{ tag_id: string }>(
        'SELECT tag_id FROM media_tag WHERE media_id = $1',
        [media],
      );
      expect(left.rows).toEqual([{ tag_id: kept }]);
      expect(
        (await tx.query('SELECT 1 FROM display_tag WHERE display_id = $1', [display])).rowCount,
      ).toBe(0);
      expect((await tx.query('SELECT 1 FROM media WHERE id = $1', [media])).rowCount).toBe(1);
      expect((await tx.query('SELECT 1 FROM display WHERE id = $1', [display])).rowCount).toBe(1);
    });
  });

  it('drops the tag rows of a media item that is deleted for good, and keeps the tag', async () => {
    await withOrg(pool, a.orgId, async (tx) => {
      const tag = await newTag(tx, 'media');
      const media = await newMedia(tx);
      await tx.query(
        'INSERT INTO media_tag (org_id, media_id, tag_id) VALUES (app_org_id(), $1, $2)',
        [media, tag],
      );
      expect((await tx.query('DELETE FROM media WHERE id = $1', [media])).rowCount).toBe(1);
      expect((await tx.query('SELECT 1 FROM media_tag WHERE tag_id = $1', [tag])).rowCount).toBe(0);
      expect((await tx.query('SELECT 1 FROM tag WHERE id = $1', [tag])).rowCount).toBe(1);
    });
  });
});

describe('folders', () => {
  it('bounds the name and keeps it unique per organisation, ignoring case', async () => {
    const insert = 'INSERT INTO folder (org_id, name) VALUES ($1, $2)';
    for (const name of ['', 'x'.repeat(81), ' padded', 'padded ']) {
      expect(await asA(insert, [a.orgId, name]), JSON.stringify(name)).toBe(PG.check);
    }
    expect(await asA(insert, [a.orgId, 'x'.repeat(80)])).toBe('no error');
    const name = unique('Campaigns');
    expect(await asA(insert, [a.orgId, name])).toBe('no error');
    expect(await asA(insert, [a.orgId, name.toUpperCase()])).toBe(PG.unique);
    expect(await pgCode(withOrg(pool, b.orgId, (tx) => tx.query(insert, [b.orgId, name])))).toBe(
      'no error',
    );
    expect(await asA('UPDATE folder SET name = $2 WHERE id = $1', [a.folderId, name])).toBe(
      PG.unique,
    );
  });

  it('lets the runtime role rename a folder, never change its identity', async () => {
    expect(
      await asA('UPDATE folder SET name = $2 WHERE id = $1', [a.folderId, unique('Renamed')]),
    ).toBe('no error');
    for (const sql of [
      'UPDATE folder SET id = gen_random_uuid() WHERE id = $1',
      'UPDATE folder SET org_id = org_id WHERE id = $1',
    ]) {
      expect(await asA(sql, [a.folderId]), sql).toBe(PG.insufficientPrivilege);
    }
  });

  it('moves the media of a deleted folder to the root and leaves the rest of the row alone', async () => {
    await withOrg(pool, a.orgId, async (tx) => {
      const doomed = await newFolder(tx);
      const kept = await newFolder(tx);
      const inDoomed = await newMedia(tx);
      const inKept = await newMedia(tx);
      await tx.query('UPDATE media SET folder_id = $2 WHERE id = $1', [inDoomed, doomed]);
      await tx.query('UPDATE media SET folder_id = $2 WHERE id = $1', [inKept, kept]);
      expect((await tx.query('DELETE FROM folder WHERE id = $1', [doomed])).rowCount).toBe(1);
      const rows = await tx.query<{ id: string; folder_id: string | null; org_id: string }>(
        'SELECT id, folder_id, org_id FROM media WHERE id = ANY($1::uuid[]) ORDER BY folder_id NULLS FIRST',
        [[inDoomed, inKept]],
      );
      expect(rows.rows).toEqual([
        { id: inDoomed, folder_id: null, org_id: a.orgId },
        { id: inKept, folder_id: kept, org_id: a.orgId },
      ]);
    });
  });

  it('refuses a folder that does not exist', async () => {
    expect(
      await asA('UPDATE media SET folder_id = $2 WHERE id = $1', [a.mediaId, randomUUID()]),
    ).toBe(PG.foreignKey);
  });
});

describe('media columns', () => {
  it('bounds the given name and the description; null clears them', async () => {
    const set = (column: string, value: string | null) =>
      asA(`UPDATE media SET ${column} = $2 WHERE id = $1`, [a.mediaId, value]);
    expect(await set('name', 'Lobby poster')).toBe('no error');
    expect(await set('name', 'x'.repeat(120))).toBe('no error');
    expect(await set('name', 'x'.repeat(121))).toBe(PG.check);
    expect(await set('name', '')).toBe(PG.check);
    expect(await set('name', null)).toBe('no error');
    expect(await set('description', 'x'.repeat(500))).toBe('no error');
    expect(await set('description', 'x'.repeat(501))).toBe(PG.check);
    expect(await set('description', '')).toBe(PG.check);
    expect(await set('description', null)).toBe('no error');
  });

  it('bounds the default duration and allows it on images only', async () => {
    const set = (id: string, value: number | null) =>
      asA('UPDATE media SET default_duration_ms = $2 WHERE id = $1', [id, value]);
    expect(await set(a.mediaId, 1)).toBe('no error');
    expect(await set(a.mediaId, 86_400_000)).toBe('no error');
    expect(await set(a.mediaId, 86_400_001)).toBe(PG.check);
    expect(await set(a.mediaId, 0)).toBe(PG.check);
    expect(await set(a.mediaId, -5000)).toBe(PG.check);
    expect(await set(a.mediaId, null)).toBe('no error');
    const video = await withOrg(pool, a.orgId, (tx) => newMedia(tx, 'video'));
    expect(await set(video, 8000)).toBe(PG.check);
    expect(await set(video, null)).toBe('no error');
  });
});

describe('playlist and display columns', () => {
  it('bounds both descriptions', async () => {
    for (const [table, id] of [
      ['playlist', a.playlistId],
      ['display', a.displayId],
    ] as const) {
      const set = (value: string | null) =>
        asA(`UPDATE ${table} SET description = $2 WHERE id = $1`, [id, value]);
      expect(await set('x'.repeat(500)), table).toBe('no error');
      expect(await set('x'.repeat(501)), table).toBe(PG.check);
      expect(await set(''), table).toBe(PG.check);
      expect(await set(null), table).toBe('no error');
    }
  });

  // The exact list of updatable display columns is checked in stage-b.integration.test.ts.
  it('grants the runtime role the two new display columns, but not route or site_id', async () => {
    await withOrg(pool, a.orgId, async (tx) => {
      const playlist = await newPlaylist(tx);
      const display = await newDisplay(tx, a.siteId);
      const updated = await tx.query(
        "UPDATE display SET description = 'Behind the desk', assigned_playlist_id = $2 WHERE id = $1",
        [display, playlist],
      );
      expect(updated.rowCount).toBe(1);
      const cleared = await tx.query(
        'UPDATE display SET assigned_playlist_id = NULL WHERE id = $1 RETURNING assigned_playlist_id',
        [display],
      );
      expect(cleared.rows).toEqual([{ assigned_playlist_id: null }]);
    });
    expect(await asA("UPDATE display SET route = 'browser' WHERE id = $1", [a.displayId])).toBe(
      PG.insufficientPrivilege,
    );
    expect(await asA('UPDATE display SET site_id = site_id WHERE id = $1', [a.displayId])).toBe(
      PG.insufficientPrivilege,
    );
    expect(await asA('DELETE FROM display WHERE id = $1', [a.displayId])).toBe(
      PG.insufficientPrivilege,
    );
  });

  it('refuses an assigned playlist that does not exist', async () => {
    expect(
      await asA('UPDATE display SET assigned_playlist_id = $2 WHERE id = $1', [
        a.displayId,
        randomUUID(),
      ]),
    ).toBe(PG.foreignKey);
  });
});

describe('deleted playlists', () => {
  const softDelete = 'UPDATE playlist SET deleted_at = now() WHERE id = $1';
  const assign = 'UPDATE display SET assigned_playlist_id = $2 WHERE id = $1';

  it('soft-deletes a playlist that no display has assigned', async () => {
    const playlist = await withOrg(pool, a.orgId, (tx) => newPlaylist(tx));
    expect(await asA(softDelete, [playlist])).toBe('no error');
    const row = await withOrg(pool, a.orgId, (tx) =>
      tx.query<{ deleted: boolean }>(
        'SELECT deleted_at IS NOT NULL AS deleted FROM playlist WHERE id = $1',
        [playlist],
      ),
    );
    expect(row.rows).toEqual([{ deleted: true }]);
  });

  it('refuses to delete a playlist while a display has it assigned, softly or for good', async () => {
    const { playlist, display } = await withOrg(pool, a.orgId, async (tx) => {
      const id = await newPlaylist(tx);
      return { playlist: id, display: await newDisplay(tx, a.siteId, id) };
    });
    expect(await asA(softDelete, [playlist])).toBe(PG.restrict);
    expect(await asA('DELETE FROM playlist WHERE id = $1', [playlist])).toBe(PG.foreignKey);
    // Other changes to an assigned playlist are unaffected.
    expect(await asA("UPDATE playlist SET name = 'Still here' WHERE id = $1", [playlist])).toBe(
      'no error',
    );
    // Once unassigned, it can be deleted.
    expect(await asA(assign, [display, null])).toBe('no error');
    expect(await asA(softDelete, [playlist])).toBe('no error');
  });

  it('refuses to assign a deleted playlist, on update and on insert', async () => {
    const { playlist, display } = await withOrg(pool, a.orgId, async (tx) => {
      const id = await newPlaylist(tx);
      await tx.query(softDelete, [id]);
      return { playlist: id, display: await newDisplay(tx, a.siteId) };
    });
    expect(await asA(assign, [display, playlist])).toBe(PG.restrict);
    expect(
      await asA(
        `INSERT INTO display (org_id, site_id, name, canvas_width, canvas_height, assigned_playlist_id)
         VALUES ($1, $2, 'Planted', 640, 360, $3)`,
        [a.orgId, a.siteId, playlist],
      ),
    ).toBe(PG.restrict);
    // The owner is bound by the same rule.
    await migrator.query("SELECT set_config('app.org_id', $1, false)", [a.orgId]);
    try {
      expect(await pgCode(migrator.query(assign, [display, playlist]))).toBe(PG.restrict);
    } finally {
      await migrator.query("SELECT set_config('app.org_id', '', false)");
    }
  });

  /** Two sessions of organisation A, each inside an open transaction. */
  async function twoSessions<T>(
    work: (first: PoolClient, second: PoolClient) => Promise<T>,
  ): Promise<T> {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      for (const client of [first, second]) {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.org_id', $1, true)", [a.orgId]);
      }
      return await work(first, second);
    } finally {
      for (const client of [first, second]) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }
  }

  /** Resolves to true when the promise is still pending after a short wait. */
  async function stillWaiting(promise: Promise<unknown>): Promise<boolean> {
    let settled = false;
    const mark = () => {
      settled = true;
    };
    promise.then(mark, mark);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return !settled;
  }

  it('lets a concurrent deletion wait for an assignment, then refuses it', async () => {
    const { playlist, display } = await withOrg(pool, a.orgId, async (tx) => ({
      playlist: await newPlaylist(tx),
      display: await newDisplay(tx, a.siteId),
    }));
    await twoSessions(async (assigning, deleting) => {
      await assigning.query(assign, [display, playlist]);
      const deletion = pgCode(deleting.query(softDelete, [playlist]));
      expect(await stillWaiting(deletion)).toBe(true);
      await assigning.query('COMMIT');
      expect(await deletion).toBe(PG.restrict);
    });
    const state = await withOrg(pool, a.orgId, (tx) =>
      tx.query<{ deleted_at: Date | null; assigned: string | null }>(
        `SELECT p.deleted_at, d.assigned_playlist_id AS assigned
         FROM playlist p JOIN display d ON d.id = $2 WHERE p.id = $1`,
        [playlist, display],
      ),
    );
    expect(state.rows).toEqual([{ deleted_at: null, assigned: playlist }]);
  });

  it('lets a concurrent assignment wait for a deletion, then refuses it', async () => {
    const { playlist, display } = await withOrg(pool, a.orgId, async (tx) => ({
      playlist: await newPlaylist(tx),
      display: await newDisplay(tx, a.siteId),
    }));
    await twoSessions(async (deleting, assigning) => {
      await deleting.query(softDelete, [playlist]);
      const assignment = pgCode(assigning.query(assign, [display, playlist]));
      expect(await stillWaiting(assignment)).toBe(true);
      await deleting.query('COMMIT');
      expect(await assignment).toBe(PG.restrict);
    });
    const state = await withOrg(pool, a.orgId, (tx) =>
      tx.query<{ deleted: boolean; assigned: string | null }>(
        `SELECT p.deleted_at IS NOT NULL AS deleted, d.assigned_playlist_id AS assigned
         FROM playlist p JOIN display d ON d.id = $2 WHERE p.id = $1`,
        [playlist, display],
      ),
    );
    expect(state.rows).toEqual([{ deleted: true, assigned: null }]);
  });
});

describe('constraint names reported to the caller', () => {
  const C = STAGE_A_CONSTRAINTS;
  const violationAsA = (sql: string, values: readonly unknown[] = []) =>
    pgViolation(withOrg(pool, a.orgId, (tx) => tx.query(sql, values)));

  it('names a taken tag name and a taken folder name', async () => {
    const tagName = unique('Taken');
    const folderName = unique('Taken');
    await withOrg(pool, a.orgId, async (tx) => {
      await newTag(tx, 'display', tagName);
      await newFolder(tx, folderName);
    });
    expect(
      await violationAsA("INSERT INTO tag (org_id, scope, name) VALUES ($1, 'display', $2)", [
        a.orgId,
        tagName.toUpperCase(),
      ]),
    ).toEqual({ code: PG.unique, constraint: C.tagNameTaken });
    expect(
      await violationAsA('INSERT INTO folder (org_id, name) VALUES ($1, $2)', [
        a.orgId,
        folderName.toLowerCase(),
      ]),
    ).toEqual({ code: PG.unique, constraint: C.folderNameTaken });
  });

  it('names which reference was not found', async () => {
    const mediaTag = 'INSERT INTO media_tag (org_id, media_id, tag_id) VALUES ($1, $2, $3)';
    const displayTag = 'INSERT INTO display_tag (org_id, display_id, tag_id) VALUES ($1, $2, $3)';
    const cases: [string, readonly unknown[], string][] = [
      ['UPDATE media SET folder_id = $2 WHERE id = $1', [a.mediaId, randomUUID()], C.mediaFolder],
      ['UPDATE media SET folder_id = $2 WHERE id = $1', [a.mediaId, b.folderId], C.mediaFolder],
      [mediaTag, [a.orgId, randomUUID(), a.mediaTagId], C.mediaTagMedia],
      [mediaTag, [a.orgId, a.mediaId, randomUUID()], C.mediaTagTag],
      [mediaTag, [a.orgId, a.mediaId, a.displayTagId], C.mediaTagTag],
      [mediaTag, [a.orgId, a.mediaId, b.mediaTagId], C.mediaTagTag],
      [displayTag, [a.orgId, randomUUID(), a.displayTagId], C.displayTagDisplay],
      [displayTag, [a.orgId, a.displayId, randomUUID()], C.displayTagTag],
      [displayTag, [a.orgId, a.displayId, a.mediaTagId], C.displayTagTag],
      [displayTag, [a.orgId, a.displayId, b.displayTagId], C.displayTagTag],
      [
        'UPDATE display SET assigned_playlist_id = $2 WHERE id = $1',
        [a.displayId, randomUUID()],
        C.displayAssignedPlaylist,
      ],
      [
        'UPDATE display SET assigned_playlist_id = $2 WHERE id = $1',
        [a.displayId, b.playlistId],
        C.displayAssignedPlaylist,
      ],
    ];
    for (const [sql, values, constraint] of cases) {
      expect(await violationAsA(sql, values), `${constraint}: ${sql}`).toEqual({
        code: PG.foreignKey,
        constraint,
      });
    }
  });

  it('names the two playlist guards and the images-only rule', async () => {
    const { assigned, deleted, display } = await withOrg(pool, a.orgId, async (tx) => {
      const live = await newPlaylist(tx);
      const gone = await newPlaylist(tx);
      await tx.query('UPDATE playlist SET deleted_at = now() WHERE id = $1', [gone]);
      return { assigned: live, deleted: gone, display: await newDisplay(tx, a.siteId, live) };
    });
    expect(
      await violationAsA('UPDATE playlist SET deleted_at = now() WHERE id = $1', [assigned]),
    ).toEqual({ code: PG.restrict, constraint: C.playlistStillAssigned });
    expect(await violationAsA('DELETE FROM playlist WHERE id = $1', [assigned])).toEqual({
      code: PG.foreignKey,
      constraint: C.displayAssignedPlaylist,
    });
    expect(
      await violationAsA('UPDATE display SET assigned_playlist_id = $2 WHERE id = $1', [
        display,
        deleted,
      ]),
    ).toEqual({ code: PG.restrict, constraint: C.assignedPlaylistDeleted });
    const video = await withOrg(pool, a.orgId, (tx) => newMedia(tx, 'video'));
    expect(
      await violationAsA('UPDATE media SET default_duration_ms = 5000 WHERE id = $1', [video]),
    ).toEqual({ code: PG.check, constraint: C.defaultDurationImagesOnly });
  });

  it('reads no constraint from anything that is not a database error', () => {
    for (const value of [
      null,
      undefined,
      'tag_org_scope_name_key',
      new Error('x'),
      {},
      { constraint: 7 },
      { constraint: '' },
    ])
      expect(violatedConstraint(value)).toBeNull();
    expect(violatedConstraint({ constraint: 'folder_org_name_key' })).toBe(C.folderNameTaken);
  });
});

describe('indexes for the stage A lookups', () => {
  it('exist under the documented names, and the superseded playlist index is gone', async () => {
    const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'",
    );
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    const expected: [string, RegExp][] = [
      ['tag_org_scope_name_key', /UNIQUE INDEX .* \(org_id, scope, lower\(name\)\)/],
      ['folder_org_name_key', /UNIQUE INDEX .* \(org_id, lower\(name\)\)/],
      ['media_tag_pkey', /\(media_id, tag_id\)/],
      ['media_tag_tag_idx', /\(tag_id\)/],
      ['display_tag_pkey', /\(display_id, tag_id\)/],
      ['display_tag_tag_idx', /\(tag_id\)/],
      ['media_folder_idx', /\(folder_id\) WHERE \(folder_id IS NOT NULL\)/],
      ['playlist_live_idx', /\(org_id, created_at\) WHERE \(deleted_at IS NULL\)/],
      [
        'display_assigned_playlist_idx',
        /\(assigned_playlist_id\) WHERE \(assigned_playlist_id IS NOT NULL\)/,
      ],
      ['audit_event_org_category_idx', /\(org_id, category, id DESC\)/],
      ['audit_event_org_result_idx', /\(org_id, result, id DESC\)/],
    ];
    for (const [name, definition] of expected) {
      expect(byName.get(name), name).toMatch(definition);
    }
    expect(byName.has('playlist_org_idx')).toBe(false);
  });
});

describe('audit category', () => {
  const insertAudit = (tx: Tx, action: string) =>
    tx.query<{ category: string }>(
      `INSERT INTO audit_event (org_id, actor_type, action, result)
       VALUES (app_org_id(), 'system', $1, 'success') RETURNING category`,
      [action],
    );

  it('is computed by the database from the action, and no role can write it', async () => {
    await withOrg(pool, a.orgId, async (tx) => {
      for (const [action, category] of [
        ['media.upload', 'media'],
        ['publication.create', 'publication'],
        ['security.csrf_rejected', 'security'],
        ['a.b.c', 'a'],
      ] as const) {
        expect((await insertAudit(tx, action)).rows[0]?.category).toBe(category);
      }
    });
    // A generated column refuses a value from any writer (428C9), the owner included.
    const forged = `INSERT INTO audit_event (org_id, actor_type, action, result, category)
                    VALUES ($1, 'system', 'media.upload', 'success', 'auth')`;
    expect(await asA(forged, [a.orgId])).toBe('428C9');
    await migrator.query("SELECT set_config('app.org_id', $1, false)", [a.orgId]);
    try {
      expect(await pgCode(migrator.query(forged, [a.orgId]))).toBe('428C9');
    } finally {
      await migrator.query("SELECT set_config('app.org_id', '', false)");
    }
    expect(await asA("UPDATE audit_event SET category = 'auth'")).toBe('428C9');
  });

  /**
   * The reason the category is a column. Under row-level security the planner uses a
   * condition as an index condition only when it is leakproof; `split_part()` is not, so
   * an index on that expression is never used by the runtime role, and the filter would
   * walk the audit rows of every organisation. This test fails if the filter of
   * GET /api/audit stops being served by its index.
   */
  it('lets the runtime role filter by category through the index, under row-level security', async () => {
    // Enough rows that reading them all is clearly dearer than the index; 'folder' is rare.
    await withOrg(pool, a.orgId, (tx) =>
      tx.query(
        `INSERT INTO audit_event (org_id, actor_type, action, result)
         SELECT app_org_id(), 'system',
                (ARRAY['media.upload', 'display.update', 'publication.create', 'playlist.update'])[1 + g % 4],
                'success'
         FROM generate_series(1, 20000) g`,
      ),
    );
    await withOrg(pool, a.orgId, (tx) => insertAudit(tx, 'folder.create'));
    await migrator.query('ANALYZE public.audit_event');

    interface PlanNode {
      'Node Type': string;
      'Index Name'?: string;
      'Index Cond'?: string;
      Filter?: string;
      Plans?: PlanNode[];
    }
    const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
    const plan = async (condition: string): Promise<PlanNode[]> =>
      withOrg(pool, a.orgId, async (tx) => {
        const { rows } = await tx.query<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(
          `EXPLAIN (FORMAT JSON)
           SELECT id, action FROM audit_event
           WHERE org_id = app_org_id() AND ${condition}
           ORDER BY id DESC LIMIT 51`,
          ['folder'],
        );
        const root = rows[0]?.['QUERY PLAN'][0]?.Plan;
        if (root === undefined) throw new Error('EXPLAIN returned no plan');
        return nodes(root);
      });

    const byColumn = await plan('category = $1');
    const scan = byColumn.find((node) => node['Index Name'] === 'audit_event_org_category_idx');
    expect(scan, JSON.stringify(byColumn)).toBeDefined();
    expect(scan?.['Index Cond']).toContain('category');
    expect(byColumn.some((node) => node['Node Type'] === 'Seq Scan')).toBe(false);

    // The same question asked through the expression cannot be an index condition.
    const byExpression = await plan("split_part(action, '.', 1) = $1");
    for (const node of byExpression) {
      expect(node['Index Cond'] ?? '').not.toContain('split_part');
    }

    // And the filter answers correctly: exactly the one rare event.
    const found = await withOrg(pool, a.orgId, (tx) =>
      tx.query<{ action: string }>(
        `SELECT action FROM audit_event
         WHERE org_id = app_org_id() AND category = $1 ORDER BY id DESC LIMIT 51`,
        ['folder'],
      ),
    );
    expect(found.rows.map((row) => row.action)).toEqual(['folder.create']);
  });
});
