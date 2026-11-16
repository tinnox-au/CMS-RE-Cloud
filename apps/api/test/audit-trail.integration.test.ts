/**
 * Portal v2, stage A: what the new routes leave in the audit trail.
 *
 * Every state change writes exactly one event, in the transaction of the change;
 * a request that changes nothing writes none. An event names its object in one
 * spelling (lower case), whatever letter case the request used, and its detail
 * carries identifiers, counts and field names only: never a name, a description
 * or any other text an operator typed.
 */
import { randomUUID } from 'node:crypto';
import { withOrg } from '@tinnox/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEvents,
  createDisplay,
  createOrg,
  createPlaylist,
  imageItem,
  push,
  readyImage,
  signIn,
  startTestApp,
  type AuditEntry,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

/** Text that must never reach the audit trail: it stands for what an operator typed. */
const TYPED = 'Typed-by-operator';
const upper = (id: string): string => id.toUpperCase();

describe('the audit trail of the stage A routes', () => {
  let t: TestApp;
  let org: TestOrg;
  let operator: Operator;

  beforeAll(async () => {
    t = await startTestApp();
    org = await createOrg('Audit trail');
    operator = await signIn(t, org);
  });
  afterAll(async () => {
    await t.close();
  });

  async function eventCount(): Promise<number> {
    return withOrg(t.pool, org.orgId, async (tx) => {
      const { rows } = await tx.query<{ n: string }>('SELECT count(*) AS n FROM audit_event');
      return Number(rows[0]?.n);
    });
  }

  /**
   * Sends one request and returns its parsed answer with the events it added to the
   * trail, newest first. The body is read once, here.
   */
  async function eventsOf(
    send: () => Promise<Response>,
    expectedStatus: number,
  ): Promise<{ body: unknown; events: AuditEntry[] }> {
    const before = await eventCount();
    const response = await send();
    const text = await response.text();
    expect(response.status, text).toBe(expectedStatus);
    const added = (await eventCount()) - before;
    return {
      body: text === '' ? null : (JSON.parse(text) as unknown),
      events: (await auditEvents(operator)).slice(0, added),
    };
  }

  const idOf = (body: unknown): string => (body as { id: string }).id;
  const created = async (response: Response): Promise<string> => {
    expect(response.status).toBe(201);
    return idOf(await response.json());
  };

  it('writes one event per change, names the object in lower case, and none for a refusal', async () => {
    const image = (await readyImage(t, operator)).id;
    const display = (await createDisplay(operator, org, `${TYPED} display`)).id;
    const playlist = await createPlaylist(operator, `${TYPED} loop`, [imageItem(image)]);

    // Tags.
    const tagCreate = await eventsOf(
      () =>
        operator.fetch('/api/tags', {
          method: 'POST',
          json: { scope: 'media', name: `${TYPED} tag`, colour: 'red' },
        }),
      201,
    );
    const tag = idOf(tagCreate.body);
    expect(tagCreate.events).toEqual([
      expect.objectContaining({
        action: 'tag.create',
        result: 'success',
        actorId: org.membershipId,
        objectType: 'tag',
        objectId: tag,
        detail: { scope: 'media', colour: 'red' },
      }),
    ]);
    const displayTag = await created(
      await operator.fetch('/api/tags', {
        method: 'POST',
        json: { scope: 'display', name: `${TYPED} display tag` },
      }),
    );
    const tagUpdate = await eventsOf(
      () =>
        operator.fetch(`/api/tags/${upper(tag)}`, {
          method: 'PATCH',
          json: { name: `${TYPED} renamed` },
        }),
      200,
    );
    expect(tagUpdate.events).toEqual([
      expect.objectContaining({
        action: 'tag.update',
        objectId: tag,
        detail: { fields: ['name'] },
      }),
    ]);
    // A name that is taken is refused, and a refusal leaves no event.
    const taken = await eventsOf(
      () =>
        operator.fetch('/api/tags', {
          method: 'POST',
          json: { scope: 'media', name: `${TYPED} RENAMED` },
        }),
      409,
    );
    expect(taken.events).toEqual([]);

    // Folders.
    const folderCreate = await eventsOf(
      () => operator.fetch('/api/folders', { method: 'POST', json: { name: `${TYPED} folder` } }),
      201,
    );
    const folder = idOf(folderCreate.body);
    expect(folderCreate.events).toEqual([
      expect.objectContaining({ action: 'folder.create', objectId: folder, detail: null }),
    ]);
    const folderUpdate = await eventsOf(
      () =>
        operator.fetch(`/api/folders/${upper(folder)}`, {
          method: 'PATCH',
          json: { name: `${TYPED} folder two` },
        }),
      200,
    );
    expect(folderUpdate.events).toEqual([
      expect.objectContaining({ action: 'folder.update', objectId: folder }),
    ]);

    // Media: one event for one request, however many fields it sets.
    const mediaUpdate = await eventsOf(
      () =>
        operator.fetch(`/api/media/${upper(image)}`, {
          method: 'PATCH',
          json: {
            name: `${TYPED} media`,
            description: `${TYPED} description`,
            defaultDurationMs: 7000,
            folderId: upper(folder),
            tagIds: [upper(tag)],
          },
        }),
      200,
    );
    expect(mediaUpdate.events).toEqual([
      expect.objectContaining({
        action: 'media.update',
        objectType: 'media',
        objectId: image,
        detail: { fields: ['defaultDurationMs', 'description', 'folderId', 'name', 'tagIds'] },
      }),
    ]);
    const mediaRefused = await eventsOf(
      () =>
        operator.fetch(`/api/media/${image}`, {
          method: 'PATCH',
          json: { name: 'kept out', tagIds: [displayTag] },
        }),
      404,
    );
    expect(mediaRefused.events).toEqual([]);

    // Displays: the assignment is recorded with the playlist, in lower case; the
    // stage B fields are named like the others.
    const displayUpdate = await eventsOf(
      () =>
        operator.fetch(`/api/displays/${upper(display)}`, {
          method: 'PATCH',
          json: {
            description: `${TYPED} description`,
            tagIds: [displayTag],
            assignedPlaylistId: upper(playlist),
            rotation: 90,
            workingHours: null,
          },
        }),
      200,
    );
    expect(displayUpdate.events).toEqual([
      expect.objectContaining({
        action: 'display.update',
        objectId: display,
        detail: {
          fields: ['assignedPlaylistId', 'description', 'rotation', 'tagIds', 'workingHours'],
          assignedPlaylistId: playlist,
        },
      }),
    ]);

    // Playlists: a copy is one creation.
    const duplicate = await eventsOf(
      () => operator.fetch(`/api/playlists/${upper(playlist)}/duplicate`, { method: 'POST' }),
      201,
    );
    const copy = idOf(duplicate.body);
    expect(duplicate.events).toEqual([
      expect.objectContaining({
        action: 'playlist.create',
        objectId: copy,
        detail: { duplicatedFrom: playlist, itemCount: 1 },
      }),
    ]);
    const inUse = await eventsOf(
      () => operator.fetch(`/api/playlists/${playlist}`, { method: 'DELETE' }),
      409,
    );
    expect(inUse.events).toEqual([]);
    const playlistDelete = await eventsOf(
      () => operator.fetch(`/api/playlists/${upper(copy)}`, { method: 'DELETE' }),
      204,
    );
    expect(playlistDelete.events).toEqual([
      expect.objectContaining({
        action: 'playlist.delete',
        objectType: 'playlist',
        objectId: copy,
        detail: { itemCount: 1 },
      }),
    ]);

    // Push: one event per publication made; none when nothing was made.
    const unassigned = (await createDisplay(operator, org, `${TYPED} unassigned`)).id;
    const key = randomUUID();
    const firstPush = await eventsOf(() => push(operator, [upper(display), unassigned], key), 200);
    const results = (
      firstPush.body as {
        results: { displayId: string; outcome: string; publicationId: string | null }[];
      }
    ).results;
    expect(results.map((r) => [r.displayId, r.outcome])).toEqual([
      [display, 'published'],
      [unassigned, 'skipped'],
    ]);
    expect(firstPush.events).toEqual([
      expect.objectContaining({
        action: 'publication.create',
        result: 'success',
        objectType: 'publication',
        objectId: results[0]?.publicationId,
        detail: {
          displayId: display,
          playlistId: playlist,
          items: 1,
          route: 'browser',
          via: 'push',
        },
      }),
    ]);
    // A repeat with the same key, and a push that finds nothing to do, write nothing.
    expect((await eventsOf(() => push(operator, [display, unassigned], key), 200)).events).toEqual(
      [],
    );
    expect((await eventsOf(() => push(operator, [display]), 200)).events).toEqual([]);

    // A blocked display: one failure event naming the reasons, and no publication.
    await operator.fetch(`/api/playlists/${playlist}`, {
      method: 'PUT',
      json: { name: `${TYPED} loop`, items: [] },
    });
    const rejected = await eventsOf(() => push(operator, [display]), 200);
    expect(rejected.events).toEqual([
      expect.objectContaining({
        action: 'publication.create',
        result: 'failure',
        objectType: 'playlist',
        objectId: playlist,
        detail: { displayId: display, reasons: ['playlist_empty'], via: 'push' },
      }),
    ]);

    // Deleting a folder and a tag: one event each, with what was affected.
    const folderDelete = await eventsOf(
      () => operator.fetch(`/api/folders/${upper(folder)}`, { method: 'DELETE' }),
      204,
    );
    expect(folderDelete.events).toEqual([
      expect.objectContaining({
        action: 'folder.delete',
        objectId: folder,
        detail: { movedToRoot: 1 },
      }),
    ]);
    const tagDelete = await eventsOf(
      () => operator.fetch(`/api/tags/${upper(tag)}`, { method: 'DELETE' }),
      204,
    );
    expect(tagDelete.events).toEqual([
      expect.objectContaining({
        action: 'tag.delete',
        objectId: tag,
        detail: { scope: 'media', removedFrom: 1 },
      }),
    ]);

    // The whole trail of this organisation: every object in lower case, nothing typed.
    const trail = await auditEvents(operator);
    expect(trail.length).toBeGreaterThan(15);
    for (const event of trail) {
      if (event.objectId !== null) expect(event.objectId).toBe(event.objectId.toLowerCase());
      const detail = JSON.stringify(event.detail);
      expect(detail).toBe(detail.replace(/[0-9A-F]{8}-[0-9A-F]{4}-/g, (id) => id.toLowerCase()));
      expect(detail).not.toContain(TYPED);
      expect(detail.length).toBeLessThan(1024);
    }
  });

  it('records the same object under the same id from the routes that existed before stage A', async () => {
    const image = (await readyImage(t, operator)).id;
    const display = (await createDisplay(operator, org, 'Earlier routes')).id;
    const playlist = await createPlaylist(operator, 'Earlier loop', []);
    const requests: [string, string, () => Promise<Response>, number][] = [
      [
        'display.update',
        display,
        () =>
          operator.fetch(`/api/displays/${upper(display)}`, {
            method: 'PATCH',
            json: { name: 'Renamed' },
          }),
        200,
      ],
      [
        'player.revoke',
        display,
        () => operator.fetch(`/api/displays/${upper(display)}/revoke-player`, { method: 'POST' }),
        200,
      ],
      [
        'playlist.update',
        playlist,
        () =>
          operator.fetch(`/api/playlists/${upper(playlist)}`, {
            method: 'PUT',
            json: { name: 'Earlier loop', items: [imageItem(image)] },
          }),
        200,
      ],
      [
        'publication.create',
        '',
        () =>
          operator.fetch(`/api/playlists/${upper(playlist)}/publish`, {
            method: 'POST',
            json: { displayId: upper(display) },
            headers: { 'idempotency-key': randomUUID() },
          }),
        201,
      ],
    ];
    for (const [action, objectId, send, status] of requests) {
      const { events } = await eventsOf(send, status);
      expect(
        events.map((event) => event.action),
        action,
      ).toEqual([action]);
      if (objectId !== '') expect(events[0]?.objectId, action).toBe(objectId);
      expect(JSON.stringify(events[0]?.detail), action).not.toMatch(/[0-9A-F]{8}-[0-9A-F]{4}-/);
    }
    // Media is in a playlist: refused, no event. Out of the playlist: one event.
    expect(
      (
        await eventsOf(
          () => operator.fetch(`/api/media/${upper(image)}`, { method: 'DELETE' }),
          409,
        )
      ).events,
    ).toEqual([]);
  });
});
