/**
 * Portal v2, stage A: the numbers on the dashboard (`GET /api/overview`), the
 * status of every display in one call (`GET /api/displays/status`) and the
 * audit log filters.
 */
import { randomUUID } from 'node:crypto';
import {
  AuditListResponseSchema,
  DeliveryStatusListResponseSchema,
  DeliveryStatusViewSchema,
  MediaListResponseSchema,
  OverviewResponseSchema,
  PushPlanResponseSchema,
  auditCategoryOf,
  type AuditListResponse,
  type DeliveryStatusView,
  type OverviewResponse,
} from '@tinnox/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actAsWorker,
  assignPlaylist,
  createDisplay,
  createOrg,
  createPlaylist,
  imageItem,
  pairPlayer,
  pngBytes,
  push,
  readyImage,
  signIn,
  startTestApp,
  uploadBytes,
  type Operator,
  type PairedPlayer,
  type TestApp,
} from './support.ts';

describe('dashboard numbers, status of every display, audit filters', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  async function overview(operator: Operator): Promise<OverviewResponse> {
    const response = await operator.fetch('/api/overview');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return OverviewResponseSchema.parse(await response.json());
  }

  async function statuses(operator: Operator): Promise<DeliveryStatusView[]> {
    const response = await operator.fetch('/api/displays/status');
    expect(response.status).toBe(200);
    return DeliveryStatusListResponseSchema.parse(await response.json()).items;
  }

  function heartbeat(
    player: PairedPlayer,
    displayId: string,
    seq: number,
    fields: Record<string, unknown> = {},
  ): Promise<Response> {
    return fetch(`${t.url}/player/heartbeat`, {
      method: 'POST',
      headers: { ...player.headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        seq,
        sentAt: new Date().toISOString(),
        displayId,
        downloadedPublicationId: null,
        activePublicationId: null,
        activeItemIndex: null,
        playerState: 'idle',
        staging: null,
        errors: [],
        player: { version: 'test', storagePersisted: null, online: true },
        ...fields,
      }),
    });
  }

  it('answers with zeros and the configured storage limit for a new organisation', async () => {
    const org = await createOrg('Overview empty');
    const operator = await signIn(t, org);
    expect(await overview(operator)).toEqual({
      displays: {
        total: 0,
        paired: 0,
        bySummary: {
          unpaired: 0,
          nothing_published: 0,
          awaiting_player: 0,
          stale: 0,
          updating: 0,
          error: 0,
          in_sync: 0,
        },
      },
      media: {
        total: 0,
        ready: 0,
        processing: 0,
        failed: 0,
        usedBytes: 0,
        limitBytes: t.config.limits.maxOrgStorageBytes,
      },
      playlists: { total: 0 },
      pendingPushCount: 0,
    });
    expect(await statuses(operator)).toEqual([]);
  });

  it('counts displays by what their players last reported, media by status, live playlists and pending pushes', async () => {
    const org = await createOrg('Overview full');
    const operator = await signIn(t, org);
    const other = await signIn(t, await createOrg('Overview other'));

    // Media: two ready, one still being checked, one failed, one deleted.
    const image = (await readyImage(t, operator)).id;
    const spare = (await readyImage(t, operator)).id;
    await uploadBytes(operator, await pngBytes());
    const failing = (
      (await (await uploadBytes(operator, await pngBytes())).json()) as { media: { id: string } }
    ).media.id;
    await actAsWorker(t, {
      schemaVersion: 1,
      jobId: failing,
      outcome: 'rejected',
      errorCode: 'corrupt',
      errorDetail: null,
    });
    await t.ctx.media.tick();
    const gone = (await readyImage(t, operator)).id;
    expect((await operator.fetch(`/api/media/${gone}`, { method: 'DELETE' })).status).toBe(204);

    // Playlists: two live, one deleted.
    const loop = await createPlaylist(operator, 'Loop', [imageItem(image)]);
    const second = await createPlaylist(operator, 'Second', [imageItem(spare)]);
    const removed = await createPlaylist(operator, 'Removed');
    expect((await operator.fetch(`/api/playlists/${removed}`, { method: 'DELETE' })).status).toBe(
      204,
    );

    // Displays, one per summary that can be arranged without waiting for the clock.
    const unpaired = await createDisplay(operator, org, 'Unpaired, never pushed');
    await assignPlaylist(operator, unpaired.id, loop);
    const nothing = await createDisplay(operator, org, 'Paired, nothing published');
    await pairPlayer(t, operator, nothing.id);
    const awaiting = await createDisplay(operator, org, 'Paired, pushed, no report');
    await assignPlaylist(operator, awaiting.id, loop);
    await pairPlayer(t, operator, awaiting.id);
    const playing = await createDisplay(operator, org, 'In sync');
    await assignPlaylist(operator, playing.id, loop);
    const playingPlayer = await pairPlayer(t, operator, playing.id);
    const updating = await createDisplay(operator, org, 'Updating');
    await assignPlaylist(operator, updating.id, second);
    const updatingPlayer = await pairPlayer(t, operator, updating.id);
    const failed = await createDisplay(operator, org, 'Error');
    await assignPlaylist(operator, failed.id, second);
    const failedPlayer = await pairPlayer(t, operator, failed.id);

    const pushedTo = [awaiting.id, playing.id, updating.id, failed.id];
    const results = (
      (await (await push(operator, pushedTo)).json()) as {
        results: { displayId: string; publicationId: string }[];
      }
    ).results;
    const publicationOf = (displayId: string): string | undefined =>
      results.find((r) => r.displayId === displayId)?.publicationId;
    expect(
      (
        await heartbeat(playingPlayer, playing.id, 1, {
          downloadedPublicationId: publicationOf(playing.id),
          activePublicationId: publicationOf(playing.id),
          activeItemIndex: 0,
          playerState: 'playing',
        })
      ).status,
    ).toBe(200);
    expect((await heartbeat(updatingPlayer, updating.id, 1)).status).toBe(200);
    expect(
      (
        await heartbeat(failedPlayer, failed.id, 1, {
          playerState: 'error',
          errors: [
            {
              code: 'download_failed',
              message: 'Synthetic failure',
              at: new Date().toISOString(),
              publicationId: null,
              assetId: null,
            },
          ],
        })
      ).status,
    ).toBe(200);
    // One display has a change waiting after its push.
    await operator.fetch(`/api/playlists/${second}`, {
      method: 'PUT',
      json: { name: 'Second', items: [imageItem(spare, 8)] },
    });

    const numbers = await overview(operator);
    expect(numbers.displays).toEqual({
      total: 6,
      paired: 5,
      bySummary: {
        unpaired: 1,
        nothing_published: 1,
        awaiting_player: 1,
        stale: 0,
        updating: 1,
        error: 1,
        in_sync: 1,
      },
    });
    const library = MediaListResponseSchema.parse(
      await (await operator.fetch('/api/media')).json(),
    );
    expect(numbers.media).toEqual({
      total: 4,
      ready: 2,
      processing: 1,
      failed: 1,
      usedBytes: library.storage.usedBytes,
      limitBytes: library.storage.limitBytes,
    });
    expect(library.items).toHaveLength(numbers.media.total);
    expect(numbers.media.usedBytes).toBeGreaterThan(0);
    expect(numbers.playlists).toEqual({ total: 2 });

    // Pending: the display that was never pushed, and the two whose playlist changed.
    const plan = PushPlanResponseSchema.parse(await (await operator.fetch('/api/push')).json());
    expect(plan.pendingCount).toBe(3);
    expect(numbers.pendingPushCount).toBe(plan.pendingCount);

    // The counters and the status list are built by the same code and agree.
    const list = await statuses(operator);
    const counted: Record<string, number> = {};
    for (const view of list) counted[view.summary] = (counted[view.summary] ?? 0) + 1;
    for (const [summary, count] of Object.entries(numbers.displays.bySummary)) {
      expect(counted[summary] ?? 0, summary).toBe(count);
    }

    // When the reports stop, the same displays count as stale; nothing else moves.
    t.advanceClock((t.config.limits.heartbeatStaleAfterSeconds + 1) * 1000);
    try {
      expect((await overview(operator)).displays.bySummary).toEqual({
        unpaired: 1,
        nothing_published: 1,
        awaiting_player: 1,
        stale: 3,
        updating: 0,
        error: 0,
        in_sync: 0,
      });
    } finally {
      t.advanceClock(-(t.config.limits.heartbeatStaleAfterSeconds + 1) * 1000);
    }

    // Another organisation sees none of it.
    expect(await overview(other)).toMatchObject({
      displays: { total: 0, paired: 0 },
      media: { total: 0, usedBytes: 0 },
      playlists: { total: 0 },
      pendingPushCount: 0,
    });
  });

  it('lists the status of every display exactly as the single-display route gives it', async () => {
    const org = await createOrg('Status list');
    const operator = await signIn(t, org);
    const outsider = await signIn(t, await createOrg('Status outsider'));
    const image = (await readyImage(t, operator)).id;
    const loop = await createPlaylist(operator, 'Loop', [imageItem(image)]);

    const first = await createDisplay(operator, org, 'First');
    const second = await createDisplay(operator, org, 'Second');
    const third = await createDisplay(operator, org, 'Third');
    await assignPlaylist(operator, second.id, loop);
    const player = await pairPlayer(t, operator, second.id);
    const [result] = (
      (await (await push(operator, [second.id])).json()) as {
        results: { publicationId: string }[];
      }
    ).results;
    await heartbeat(player, second.id, 1, {
      downloadedPublicationId: result?.publicationId,
      activePublicationId: result?.publicationId,
      activeItemIndex: 0,
      playerState: 'playing',
    });
    await pairPlayer(t, operator, third.id);

    const list = await statuses(operator);
    // One item per display, in the order of the display list.
    const displays = (await (await operator.fetch('/api/displays')).json()) as {
      items: { id: string }[];
    };
    expect(list.map((view) => view.displayId)).toEqual(displays.items.map((d) => d.id));
    expect(list.map((view) => view.displayId)).toEqual([first.id, second.id, third.id]);
    expect(list.map((view) => view.summary)).toEqual(['unpaired', 'in_sync', 'nothing_published']);

    for (const view of list) {
      const single = DeliveryStatusViewSchema.parse(
        await (await operator.fetch(`/api/displays/${view.displayId}/status`)).json(),
      );
      expect({ ...single, asOf: null }).toEqual({ ...view, asOf: null });
    }
    expect(list[1]).toMatchObject({
      paired: true,
      desired: { publicationId: result?.publicationId },
      active: { publicationId: result?.publicationId, itemIndex: 0 },
      playerState: 'playing',
      stale: false,
    });

    // Another organisation gets its own, empty list, and no status of these displays.
    expect(await statuses(outsider)).toEqual([]);
    expect((await outsider.fetch(`/api/displays/${second.id}/status`)).status).toBe(404);
    // "status" is the list, never mistaken for a display id; other words are still refused.
    expect((await operator.fetch('/api/displays/statuses')).status).toBe(400);
  });

  describe('GET /api/audit filters', () => {
    let operator: Operator;
    let all: AuditListResponse['items'];

    async function audit(query: string): Promise<AuditListResponse> {
      const response = await operator.fetch(`/api/audit${query}`);
      expect(response.status, query).toBe(200);
      return AuditListResponseSchema.parse(await response.json());
    }

    beforeAll(async () => {
      const org = await createOrg('Audit filters');
      operator = await signIn(t, org);
      const display = await createDisplay(operator, org, 'Audited');
      const empty = await createPlaylist(operator, 'Empty');
      await assignPlaylist(operator, display.id, empty);
      // A failure (blocked push) and a denial (wrong pairing code), next to the successes.
      await push(operator, [display.id]);
      await operator.fetch(`/api/displays/${display.id}/claim`, {
        method: 'POST',
        json: { code: 'ABCD-EFGH' },
      });
      for (const name of ['One', 'Two', 'Three']) {
        await operator.fetch('/api/tags', { method: 'POST', json: { scope: 'media', name } });
      }
      await operator.fetch('/api/folders', { method: 'POST', json: { name: 'Folder' } });
      all = (await audit('?limit=200')).items;
    });

    it('recorded events of several categories and results to filter', () => {
      expect(new Set(all.map((e) => auditCategoryOf(e.action)))).toEqual(
        new Set(['display', 'playlist', 'publication', 'pairing', 'tag', 'folder']),
      );
      expect(new Set(all.map((e) => e.result))).toEqual(new Set(['success', 'failure', 'denied']));
    });

    it('narrows the list to one category, to one result, or to both', async () => {
      for (const category of ['display', 'playlist', 'publication', 'pairing', 'tag', 'folder']) {
        const { items } = await audit(`?limit=200&category=${category}`);
        expect(items, category).toEqual(all.filter((e) => auditCategoryOf(e.action) === category));
        expect(items.length, category).toBeGreaterThan(0);
      }
      for (const result of ['success', 'failure', 'denied']) {
        const { items } = await audit(`?limit=200&result=${result}`);
        expect(items, result).toEqual(all.filter((e) => e.result === result));
        expect(items.length, result).toBeGreaterThan(0);
      }
      const failures = await audit('?category=publication&result=failure');
      expect(failures.items).toHaveLength(1);
      expect(failures.items[0]).toMatchObject({
        action: 'publication.create',
        detail: { reasons: ['playlist_empty'], via: 'push' },
      });
      // A category with nothing in it, and a combination that matches nothing.
      expect((await audit('?category=media')).items).toEqual([]);
      expect((await audit('?category=tag&result=denied')).items).toEqual([]);
    });

    it('keeps the filters while paging to older events', async () => {
      const first = await audit('?limit=2&category=tag');
      expect(first.items.map((e) => e.action)).toEqual(['tag.create', 'tag.create']);
      expect(first.nextBefore).toBe(first.items[1]?.id);
      const second = await audit(`?limit=2&category=tag&before=${first.nextBefore}`);
      expect(second.items).toHaveLength(1);
      expect(second.items[0]?.action).toBe('tag.create');
      expect(second.nextBefore).toBeNull();
      const ids = [...first.items, ...second.items].map((e) => e.id);
      expect(ids).toEqual(all.filter((e) => e.action === 'tag.create').map((e) => e.id));
    });

    it('refuses a category or result that does not exist, and never takes one as SQL', async () => {
      for (const query of [
        '?category=tags',
        '?category=tag.create',
        '?category=',
        '?result=ok',
        "?category=tag'%20OR%20'1'='1",
        '?category=tag&category=folder',
        `?orgId=${randomUUID()}`,
      ]) {
        const response = await operator.fetch(`/api/audit${query}`);
        expect(response.status, query).toBe(400);
      }
    });
  });
});
