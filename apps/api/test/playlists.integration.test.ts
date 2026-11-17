/**
 * Portal v2, stage A: playlist descriptions, the list summary, duplicating and
 * deleting. A deleted playlist keeps its row for the publications that refer to
 * it and is invisible to everything else.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  PlaylistDtoSchema,
  PlaylistDuplicateResponseSchema,
  PlaylistListResponseSchema,
  type PlaylistDto,
  type PlaylistSummaryDto,
} from '@tinnox/contracts';
import { withOrg } from '@tinnox/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appItem,
  assignPlaylist,
  auditEvents,
  createApp,
  createDisplay,
  createOrg,
  createPlaylist,
  createSchedule,
  desiredPublicationId,
  imageItem,
  pairPlayer,
  readyImage,
  readyVideo,
  scheduleEvent,
  signIn,
  startTestApp,
  uploadBytes,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string; code?: string }[];
  };
}

describe('playlists: description, summary, duplicate and delete', () => {
  let t: TestApp;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let alice: Operator;
  let bob: Operator;

  beforeAll(async () => {
    t = await startTestApp();
    orgA = await createOrg('Playlists A');
    orgB = await createOrg('Playlists B');
    alice = await signIn(t, orgA);
    bob = await signIn(t, orgB);
  });
  afterAll(async () => {
    await t.close();
  });

  async function getPlaylist(operator: Operator, id: string): Promise<PlaylistDto> {
    const response = await operator.fetch(`/api/playlists/${id}`);
    expect(response.status).toBe(200);
    return PlaylistDtoSchema.parse(await response.json());
  }

  async function summaries(operator: Operator): Promise<PlaylistSummaryDto[]> {
    const response = await operator.fetch('/api/playlists');
    expect(response.status).toBe(200);
    return PlaylistListResponseSchema.parse(await response.json()).items;
  }

  async function summaryOf(operator: Operator, id: string): Promise<PlaylistSummaryDto> {
    const found = (await summaries(operator)).find((item) => item.id === id);
    if (found === undefined) throw new Error('the playlist is not listed');
    return found;
  }

  function publish(operator: Operator, playlistId: string, displayId: string): Promise<Response> {
    return operator.fetch(`/api/playlists/${playlistId}/publish`, {
      method: 'POST',
      json: { displayId },
      headers: { 'idempotency-key': randomUUID() },
    });
  }

  describe('description', () => {
    it('is kept when a save leaves it out, replaced when sent, and cleared by null or an empty string', async () => {
      const id = await createPlaylist(alice, 'Reception loop');
      expect((await getPlaylist(alice, id)).description).toBeNull();
      const save = async (body: Record<string, unknown>): Promise<PlaylistDto> => {
        const response = await alice.fetch(`/api/playlists/${id}`, {
          method: 'PUT',
          json: { name: 'Reception loop', items: [], ...body },
        });
        expect(response.status).toBe(200);
        return PlaylistDtoSchema.parse(await response.json());
      };

      expect((await save({ description: '  Morning content.\nSwap at noon.  ' })).description).toBe(
        'Morning content.\nSwap at noon.',
      );
      // An editor that does not know about descriptions (M0) does not wipe one.
      expect((await save({})).description).toBe('Morning content.\nSwap at noon.');
      expect((await summaryOf(alice, id)).description).toBe('Morning content.\nSwap at noon.');
      expect((await save({ description: null })).description).toBeNull();
      expect((await save({ description: 'Again' })).description).toBe('Again');
      expect((await save({ description: '  ' })).description).toBeNull();

      const tooLong = await alice.fetch(`/api/playlists/${id}`, {
        method: 'PUT',
        json: { name: 'Reception loop', items: [], description: 'd'.repeat(501) },
      });
      expect(tooLong.status).toBe(400);
      expect((await save({ description: 'd'.repeat(500) })).description).toHaveLength(500);
    });
  });

  describe('playback options', () => {
    it('start as cut without shuffle, are kept when a save leaves them out, and are replaced when sent', async () => {
      const id = await createPlaylist(alice, 'Options loop');
      expect(await getPlaylist(alice, id)).toMatchObject({ transition: 'cut', shuffle: false });
      const save = async (body: Record<string, unknown>): Promise<Response> =>
        alice.fetch(`/api/playlists/${id}`, {
          method: 'PUT',
          json: { name: 'Options loop', items: [], ...body },
        });

      const set = await save({ transition: 'fade', shuffle: true });
      expect(set.status).toBe(200);
      expect(PlaylistDtoSchema.parse(await set.json())).toMatchObject({
        transition: 'fade',
        shuffle: true,
      });
      expect((await save({})).status).toBe(200);
      expect(await getPlaylist(alice, id)).toMatchObject({ transition: 'fade', shuffle: true });
      expect((await save({ shuffle: false })).status).toBe(200);
      expect(await getPlaylist(alice, id)).toMatchObject({ transition: 'fade', shuffle: false });
      expect((await save({ transition: 'wipe' })).status).toBe(400);

      const [event] = (await auditEvents(alice, '&category=playlist')).filter(
        (e) => e.objectId === id && e.action === 'playlist.update',
      );
      // Newest first: the last save sent shuffle only.
      expect(event?.detail).toEqual({ itemCount: 0, shuffle: false });
    });
  });

  describe('GET /api/playlists', () => {
    it('summarises items, loop length, kinds, preview media and assigned displays', async () => {
      const org = await createOrg('Playlist summary');
      const carol = await signIn(t, org);
      const images = [
        await readyImage(t, carol),
        await readyImage(t, carol),
        await readyImage(t, carol),
        await readyImage(t, carol),
        await readyImage(t, carol),
      ].map((image) => image.id);
      const video = await readyVideo(t, carol, 7500);
      const [a, b, c, d, e] = images as [string, string, string, string, string];

      const mixed = await createPlaylist(carol, 'Mixed', [
        imageItem(b, 4),
        imageItem(a, 6),
        imageItem(b, 10),
        { mediaId: video.id, durationMs: null, fit: 'cover' },
        imageItem(c, 1),
        imageItem(d, 1),
        imageItem(e, 1),
      ]);
      const videoOnly = await createPlaylist(carol, 'Video only', [
        { mediaId: video.id, durationMs: null, fit: null },
      ]);
      const empty = await createPlaylist(carol, 'Empty');
      const first = await createDisplay(carol, org, 'First');
      const second = await createDisplay(carol, org, 'Second');
      await assignPlaylist(carol, first.id, mixed);
      await assignPlaylist(carol, second.id, mixed);

      const listed = await summaries(carol);
      // In the order they were created.
      expect(listed.map((item) => item.id)).toEqual([mixed, videoOnly, empty]);
      expect(listed[0]).toMatchObject({
        name: 'Mixed',
        description: null,
        itemCount: 7,
        totalDurationMs: 4000 + 6000 + 10_000 + 7500 + 3000,
        kinds: ['image', 'video'],
        // The first four different items in play order; the repeat of `b` is not counted twice.
        previewMediaIds: [b, a, video.id, c],
        assignedDisplayCount: 2,
      });
      expect(listed[1]).toMatchObject({
        itemCount: 1,
        totalDurationMs: 7500,
        kinds: ['video'],
        previewMediaIds: [video.id],
        assignedDisplayCount: 0,
      });
      expect(listed[2]).toMatchObject({
        itemCount: 0,
        totalDurationMs: 0,
        kinds: [],
        previewMediaIds: [],
        assignedDisplayCount: 0,
      });
    });

    it('counts a video that is still being checked as zero length', async () => {
      // Bytes that begin like an MP4 file and have no verdict yet: a video without a length.
      const head = Buffer.from([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
      const upload = await uploadBytes(alice, Buffer.concat([head, randomBytes(52)]), 'new.mp4');
      expect(upload.status).toBe(201);
      const processing = ((await upload.json()) as { media: { id: string; kind: string } }).media;
      expect(processing.kind).toBe('video');
      const ready = await readyImage(t, alice);
      const id = await createPlaylist(alice, 'Half checked', [
        imageItem(ready.id, 3),
        { mediaId: processing.id, durationMs: null, fit: null },
      ]);
      expect(await summaryOf(alice, id)).toMatchObject({
        itemCount: 2,
        totalDurationMs: 3000,
        kinds: ['image', 'video'],
      });
    });
  });

  describe('apps in playlists', () => {
    it('saves app items, lists their kind and time, and copies them in a duplicate', async () => {
      const image = await readyImage(t, alice);
      const app = await createApp(alice);
      const id = await createPlaylist(alice, 'Clock loop', [
        appItem(app.id, 15),
        imageItem(image.id, 4),
        appItem(app.id, 5),
      ]);
      const saved = await getPlaylist(alice, id);
      expect(saved.items).toEqual([
        {
          id: expect.any(String) as string,
          position: 0,
          appId: app.id,
          durationMs: 15_000,
          app: { ...app, usageCount: 1, updatedAt: expect.any(String) as string },
        },
        expect.objectContaining({ position: 1, mediaId: image.id, durationMs: 4000, fit: null }),
        expect.objectContaining({ position: 2, appId: app.id, durationMs: 5000 }),
      ]);
      expect(await summaryOf(alice, id)).toMatchObject({
        itemCount: 3,
        totalDurationMs: 15_000 + 4000 + 5000,
        kinds: ['image', 'app'],
        previewMediaIds: [image.id],
      });
      const appOnly = await createPlaylist(alice, 'Only apps', [appItem(app.id)]);
      expect(await summaryOf(alice, appOnly)).toMatchObject({
        totalDurationMs: 10_000,
        kinds: ['app'],
        previewMediaIds: [],
      });

      const duplicate = await alice.fetch(`/api/playlists/${id}/duplicate`, { method: 'POST' });
      expect(duplicate.status).toBe(201);
      const copy = PlaylistDuplicateResponseSchema.parse(await duplicate.json());
      expect(copy.items.map((item) => ('appId' in item ? item.appId : item.mediaId))).toEqual([
        app.id,
        image.id,
        app.id,
      ]);
    });

    it('refuses an app item that has a fit, a duration out of range, or an unknown app', async () => {
      const app = await createApp(alice);
      const id = await createPlaylist(alice, 'Bad apps');
      const save = (items: unknown[]): Promise<Response> =>
        alice.fetch(`/api/playlists/${id}`, { method: 'PUT', json: { name: 'Bad apps', items } });

      expect((await save([{ appId: app.id, durationMs: 5000, fit: 'cover' }])).status).toBe(400);
      expect((await save([{ appId: app.id, durationMs: null }])).status).toBe(400);
      const tooLong = await save([appItem(app.id, 3601)]);
      expect(tooLong.status).toBe(400);
      expect(((await tooLong.json()) as ErrorBody).error.details).toEqual([
        expect.objectContaining({ path: 'items[0]', code: 'duration_out_of_range' }),
      ]);
      const unknown = await save([appItem(randomUUID())]);
      expect(unknown.status).toBe(400);
      expect(((await unknown.json()) as ErrorBody).error.details).toEqual([
        expect.objectContaining({ path: 'items[0]', code: 'app_missing' }),
      ]);
    });
  });

  describe('POST /api/playlists/:id/duplicate', () => {
    it('copies the description, the playback options and every item into a new, unassigned playlist', async () => {
      const first = await readyImage(t, alice);
      const second = await readyImage(t, alice);
      const display = await createDisplay(alice, orgA, 'Duplicate source display');
      const sourceId = await createPlaylist(alice, 'Window loop');
      await alice.fetch(`/api/playlists/${sourceId}`, {
        method: 'PUT',
        json: {
          name: 'Window loop',
          description: 'Street side',
          transition: 'fade',
          shuffle: true,
          items: [
            { mediaId: second.id, durationMs: 9000, fit: 'cover' },
            imageItem(first.id, 4),
            { mediaId: second.id, durationMs: 2000, fit: 'contain' },
          ],
        },
      });
      await assignPlaylist(alice, display.id, sourceId);
      const source = await getPlaylist(alice, sourceId);

      const response = await alice.fetch(`/api/playlists/${sourceId}/duplicate`, {
        method: 'POST',
      });
      expect(response.status).toBe(201);
      const copy = PlaylistDuplicateResponseSchema.parse(await response.json());
      expect(copy.id).not.toBe(sourceId);
      expect(copy.name).toBe('Copy of Window loop');
      expect(copy.description).toBe('Street side');
      expect(copy).toMatchObject({ transition: 'fade', shuffle: true });
      const shape = (playlist: PlaylistDto): unknown =>
        playlist.items.map((item) =>
          'mediaId' in item
            ? [item.position, item.mediaId, item.durationMs, item.fit]
            : [item.position, item.appId, item.durationMs],
        );
      expect(shape(copy)).toEqual(shape(source));
      // New rows, not shared ones: editing the copy cannot touch the original.
      const sourceItemIds = source.items.map((item) => item.id);
      expect(copy.items.some((item) => sourceItemIds.includes(item.id))).toBe(false);
      expect(await getPlaylist(alice, copy.id)).toEqual(copy);

      expect(await summaryOf(alice, copy.id)).toMatchObject({ assignedDisplayCount: 0 });
      expect(await summaryOf(alice, sourceId)).toMatchObject({ assignedDisplayCount: 1 });
      // The original is as it was: same rows, not touched by the copy.
      const sourceAfter = await getPlaylist(alice, sourceId);
      expect(sourceAfter.items.map((item) => item.id)).toEqual(sourceItemIds);
      expect(sourceAfter.updatedAt).toBe(source.updatedAt);
      // Each media item is now used by two playlists.
      expect(
        sourceAfter.items.map((item) => ('media' in item ? item.media.usageCount : null)),
      ).toEqual([2, 2, 2]);

      const [event] = (await auditEvents(alice, '&category=playlist')).filter(
        (e) => e.objectId === copy.id,
      );
      expect(event).toMatchObject({
        action: 'playlist.create',
        result: 'success',
        actorId: orgA.membershipId,
        detail: { duplicatedFrom: sourceId, itemCount: 3 },
      });
    });

    it('cuts the name of the copy to the name limit', async () => {
      const longName = 'L'.repeat(120);
      const sourceId = await createPlaylist(alice, longName);
      const response = await alice.fetch(`/api/playlists/${sourceId}/duplicate`, {
        method: 'POST',
      });
      expect(response.status).toBe(201);
      const copy = PlaylistDuplicateResponseSchema.parse(await response.json());
      expect(copy.name).toBe(`Copy of ${'L'.repeat(112)}`);
      expect(copy.name).toHaveLength(120);
    });

    it('answers 404 for an unknown playlist and for a playlist of another organisation, and creates nothing', async () => {
      const sourceId = await createPlaylist(alice, 'Not yours');
      const before = (await summaries(bob)).length;
      for (const id of [sourceId, randomUUID()]) {
        const response = await bob.fetch(`/api/playlists/${id}/duplicate`, { method: 'POST' });
        expect(response.status).toBe(404);
        expect(((await response.json()) as ErrorBody).error.message).toBe(
          'The playlist was not found.',
        );
      }
      expect(await summaries(bob)).toHaveLength(before);
    });
  });

  describe('DELETE /api/playlists/:id', () => {
    it('refuses with 409 playlist_in_use while a display has the playlist assigned', async () => {
      const image = await readyImage(t, alice);
      const id = await createPlaylist(alice, 'Assigned loop', [imageItem(image.id)]);
      const display = await createDisplay(alice, orgA, 'Holding display');
      await assignPlaylist(alice, display.id, id);

      const refused = await alice.fetch(`/api/playlists/${id}`, { method: 'DELETE' });
      expect(refused.status).toBe(409);
      const body = (await refused.json()) as ErrorBody;
      expect(body.error.code).toBe('playlist_in_use');
      expect(body.error.message).toBe(
        'This playlist is assigned to a screen. Assign other content to the screen first.',
      );
      // The refusal names the display, so the operator knows where to look.
      expect(body.error.details).toEqual([{ path: 'display', message: 'Holding display' }]);
      expect((await getPlaylist(alice, id)).items).toHaveLength(1);
      expect((await summaries(alice)).map((item) => item.id)).toContain(id);

      // Once nothing has it assigned, it can go.
      await assignPlaylist(alice, display.id, null);
      expect((await alice.fetch(`/api/playlists/${id}`, { method: 'DELETE' })).status).toBe(204);
    });

    it('also refuses while the assignment came from publishing', async () => {
      const image = await readyImage(t, alice);
      const id = await createPlaylist(alice, 'Published loop', [imageItem(image.id)]);
      const display = await createDisplay(alice, orgA, 'Published display');
      expect((await publish(alice, id, display.id)).status).toBe(201);
      const refused = await alice.fetch(`/api/playlists/${id}`, { method: 'DELETE' });
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as ErrorBody).error.code).toBe('playlist_in_use');
    });

    it('refuses with 409 playlist_in_use while a schedule uses the playlist, as its default or in an event', async () => {
      const usual = await createPlaylist(alice, 'Usual loop');
      const special = await createPlaylist(alice, 'Special loop');
      const spare = await createPlaylist(alice, 'Spare loop');
      const zulu = await createSchedule(alice, 'zulu week', usual, [
        scheduleEvent(special),
        scheduleEvent(special, '18:00', '20:00'),
      ]);
      const alpha = await createSchedule(alice, 'Alpha week', special);

      const cases: [string, string[]][] = [
        [usual, ['zulu week']],
        // By name; a schedule that uses the playlist twice is named once.
        [special, ['Alpha week', 'zulu week']],
      ];
      for (const [id, names] of cases) {
        const refused = await alice.fetch(`/api/playlists/${id}`, { method: 'DELETE' });
        expect(refused.status).toBe(409);
        const body = (await refused.json()) as ErrorBody;
        expect(body.error.code).toBe('playlist_in_use');
        expect(body.error.message).toBe(
          'This playlist is used by a schedule. Choose another playlist in the schedule first.',
        );
        expect(body.error.details).toEqual(names.map((message) => ({ path: 'schedule', message })));
        expect((await summaries(alice)).map((item) => item.id)).toContain(id);
      }

      // Once no schedule uses it, each can go: one by an edit, one by deleting the schedules.
      const replaced = await alice.fetch(`/api/schedules/${zulu.id}`, {
        method: 'PUT',
        json: { name: 'zulu week', defaultPlaylistId: spare, events: [scheduleEvent(special)] },
      });
      expect(replaced.status).toBe(200);
      expect((await alice.fetch(`/api/playlists/${usual}`, { method: 'DELETE' })).status).toBe(204);
      for (const schedule of [zulu, alpha]) {
        expect(
          (await alice.fetch(`/api/schedules/${schedule.id}`, { method: 'DELETE' })).status,
        ).toBe(204);
      }
      expect((await alice.fetch(`/api/playlists/${special}`, { method: 'DELETE' })).status).toBe(
        204,
      );
    });

    it('hides a deleted playlist from every route and keeps what displays were given', async () => {
      const image = await readyImage(t, alice);
      const id = await createPlaylist(alice, 'Retired loop', [imageItem(image.id)]);
      const display = await createDisplay(alice, orgA, 'Kept playing');
      const other = await createDisplay(alice, orgA, 'Other display');
      const published = await publish(alice, id, display.id);
      expect(published.status).toBe(201);
      const { publicationId } = (await published.json()) as { publicationId: string };
      const player = await pairPlayer(t, alice, display.id);
      // Assign something else, so the playlist is free to be deleted.
      const replacement = await createPlaylist(alice, 'Replacement', [imageItem(image.id)]);
      await assignPlaylist(alice, display.id, replacement);

      const removed = await alice.fetch(`/api/playlists/${id}`, { method: 'DELETE' });
      expect(removed.status).toBe(204);

      const key = { 'idempotency-key': randomUUID() };
      const attempts: [string, Promise<Response>][] = [
        ['read', alice.fetch(`/api/playlists/${id}`)],
        [
          'save',
          alice.fetch(`/api/playlists/${id}`, { method: 'PUT', json: { name: 'Back', items: [] } }),
        ],
        ['duplicate', alice.fetch(`/api/playlists/${id}/duplicate`, { method: 'POST' })],
        ['delete again', alice.fetch(`/api/playlists/${id}`, { method: 'DELETE' })],
        [
          'publish',
          alice.fetch(`/api/playlists/${id}/publish`, {
            method: 'POST',
            json: { displayId: other.id },
            headers: key,
          }),
        ],
        [
          'assign',
          alice.fetch(`/api/displays/${other.id}`, {
            method: 'PATCH',
            json: { assignedPlaylistId: id },
          }),
        ],
      ];
      for (const [what, attempt] of attempts) {
        const response = await attempt;
        expect(response.status, what).toBe(404);
        expect(((await response.json()) as ErrorBody).error.message, what).toBe(
          'The playlist was not found.',
        );
      }
      expect((await summaries(alice)).map((item) => item.id)).not.toContain(id);
      const otherDisplay = (await (await alice.fetch(`/api/displays/${other.id}`)).json()) as {
        assignedPlaylist: unknown;
      };
      expect(otherDisplay.assignedPlaylist).toBeNull();
      expect(await desiredPublicationId(alice, other.id)).toBeNull();

      // The display still has the publication made from the deleted playlist, and
      // its player is still served that publication.
      expect(await desiredPublicationId(alice, display.id)).toBe(publicationId);
      const manifest = await fetch(`${t.url}/player/manifest`, { headers: player.headers });
      expect(manifest.status).toBe(200);
      expect(
        ((await manifest.json()) as { manifest: { publicationId: string } }).manifest.publicationId,
      ).toBe(publicationId);

      // The row is kept for the publication, without its items.
      const stored = await withOrg(t.pool, orgA.orgId, async (tx) => {
        const playlist = await tx.query<{ deleted: boolean }>(
          'SELECT deleted_at IS NOT NULL AS deleted FROM playlist WHERE id = $1',
          [id],
        );
        const items = await tx.query('SELECT 1 FROM playlist_item WHERE playlist_id = $1', [id]);
        return { deleted: playlist.rows[0]?.deleted, items: items.rowCount };
      });
      expect(stored).toEqual({ deleted: true, items: 0 });

      const [event] = (await auditEvents(alice, '&category=playlist')).filter(
        (e) => e.action === 'playlist.delete' && e.objectId === id,
      );
      expect(event).toMatchObject({
        result: 'success',
        actorId: orgA.membershipId,
        objectType: 'playlist',
        detail: { itemCount: 1 },
      });
    });

    it('frees the media of a deleted playlist: it no longer counts as in use', async () => {
      const image = await readyImage(t, alice);
      const id = await createPlaylist(alice, 'Short lived', [imageItem(image.id)]);
      const usageCount = async (): Promise<number> =>
        ((await (await alice.fetch(`/api/media/${image.id}`)).json()) as { usageCount: number })
          .usageCount;
      expect(await usageCount()).toBe(1);
      const inUse = await alice.fetch(`/api/media/${image.id}`, { method: 'DELETE' });
      expect(inUse.status).toBe(409);
      expect(((await inUse.json()) as ErrorBody).error.code).toBe('media_in_use');

      expect((await alice.fetch(`/api/playlists/${id}`, { method: 'DELETE' })).status).toBe(204);
      expect(await usageCount()).toBe(0);
      const usage = (await (await alice.fetch(`/api/media/${image.id}/usage`)).json()) as {
        playlists: unknown[];
      };
      expect(usage.playlists).toEqual([]);
      // A deleted playlist does not hold its media back.
      expect((await alice.fetch(`/api/media/${image.id}`, { method: 'DELETE' })).status).toBe(204);
      expect((await alice.fetch(`/api/media/${image.id}`)).status).toBe(404);
    });

    it('answers 404 for an unknown playlist and for a playlist of another organisation', async () => {
      const id = await createPlaylist(alice, 'Still here');
      for (const target of [id, randomUUID()]) {
        const response = await bob.fetch(`/api/playlists/${target}`, { method: 'DELETE' });
        expect(response.status).toBe(404);
      }
      expect((await getPlaylist(alice, id)).name).toBe('Still here');
    });

    it('lets exactly one of a delete and a concurrent assignment win', async () => {
      // Whichever commits first, the result is consistent: either the playlist is
      // gone and nothing has it assigned, or it is assigned and still there.
      for (let round = 0; round < 6; round += 1) {
        const id = await createPlaylist(alice, `Race ${round}`);
        const display = await createDisplay(alice, orgA, `Race display ${round}`);
        const [removed, assigned] = await Promise.all([
          alice.fetch(`/api/playlists/${id}`, { method: 'DELETE' }),
          alice.fetch(`/api/displays/${display.id}`, {
            method: 'PATCH',
            json: { assignedPlaylistId: id },
          }),
        ]);
        const dto = (await (await alice.fetch(`/api/displays/${display.id}`)).json()) as {
          assignedPlaylist: { id: string } | null;
        };
        const listed = (await summaries(alice)).some((item) => item.id === id);
        if (removed.status === 204) {
          expect(assigned.status, `round ${round}`).toBe(404);
          expect(dto.assignedPlaylist).toBeNull();
          expect(listed).toBe(false);
        } else {
          expect(removed.status, `round ${round}`).toBe(409);
          expect(assigned.status).toBe(200);
          expect(dto.assignedPlaylist?.id).toBe(id);
          expect(listed).toBe(true);
        }
      }
    });
  });
});
