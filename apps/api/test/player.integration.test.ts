import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ManifestSchema, PushResponseSchema, manifestPlaylists } from '@tinnox/contracts';
import {
  assignSchedule,
  createDisplay,
  createOrg,
  createPlaylist,
  createSchedule,
  imageItem,
  pairPlayer,
  PLAYER_ORIGIN,
  publishImages,
  push,
  readyImage,
  scheduleEvent,
  signIn,
  startTestApp,
  type Operator,
  type PairedPlayer,
  type TestApp,
  type TestOrg,
} from './support.ts';

interface Status {
  summary: string;
  stale: boolean;
  lastHeartbeatAt: string | null;
  active: { publicationId: string; itemIndex: number } | null;
  downloaded: { publicationId: string } | null;
  desired: { publicationId: string } | null;
  playerState: string | null;
  errors: unknown[];
}

describe('player protocol', () => {
  let t: TestApp;
  let org: TestOrg;
  let other: TestOrg;
  let operator: Operator;
  let otherOperator: Operator;

  beforeAll(async () => {
    t = await startTestApp();
    org = await createOrg('Player A');
    other = await createOrg('Player B');
    operator = await signIn(t, org);
    otherOperator = await signIn(t, other);
  });
  afterAll(async () => {
    await t.close();
  });

  function report(displayId: string, seq: number, fields: Record<string, unknown> = {}): string {
    return JSON.stringify({
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
    });
  }
  const heartbeat = (player: PairedPlayer, body: string): Promise<Response> =>
    fetch(`${t.url}/player/heartbeat`, {
      method: 'POST',
      headers: { ...player.headers, 'content-type': 'application/json' },
      body,
    });
  const status = async (displayId: string): Promise<Status> =>
    (await (await operator.fetch(`/api/displays/${displayId}/status`)).json()) as Status;
  async function mediaUrls(
    player: PairedPlayer,
    publicationId: string,
    assetIds: string[],
  ): Promise<Response> {
    return fetch(`${t.url}/player/media-urls`, {
      method: 'POST',
      headers: { ...player.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ publicationId, assetIds }),
    });
  }
  /** Signed URLs name the public origin; tests reach the same path on the test listener. */
  const local = (url: string | URL): string => {
    const parsed = new URL(url);
    return `${t.url}${parsed.pathname}${parsed.search}`;
  };

  it('never lets a delayed or replayed report overwrite newer state', async () => {
    const display = await createDisplay(operator, org);
    const image = await readyImage(t, operator);
    const { publicationId } = await publishImages(operator, display.id, [
      image.id,
      image.id,
      image.id,
    ]);
    const player = await pairPlayer(t, operator, display.id);
    const playing = (seq: number, itemIndex: number): string =>
      report(display.id, seq, {
        downloadedPublicationId: publicationId,
        activePublicationId: publicationId,
        activeItemIndex: itemIndex,
        playerState: 'playing',
      });

    expect(
      ((await (await heartbeat(player, playing(10, 2))).json()) as { accepted: boolean }).accepted,
    ).toBe(true);

    // Older reports arrive late, in a burst, together with a duplicate of the newest.
    const late = await Promise.all([
      heartbeat(player, playing(3, 0)),
      heartbeat(player, report(display.id, 7, { playerState: 'error' })),
      heartbeat(player, playing(10, 1)),
      heartbeat(player, playing(9, 0)),
    ]);
    for (const response of late) {
      expect(await response.json()).toMatchObject({ accepted: false, ignoredReason: 'stale_seq' });
    }
    let view = await status(display.id);
    expect(view).toMatchObject({
      summary: 'in_sync',
      playerState: 'playing',
      active: { publicationId, itemIndex: 2 },
    });

    // Many reports racing each other: the stored state is always the highest sequence number.
    const burst = Array.from({ length: 20 }, (_, i) => 11 + i).sort(() => Math.random() - 0.5);
    await Promise.all(burst.map((seq) => heartbeat(player, playing(seq, seq % 3))));
    view = await status(display.id);
    expect(view.active).toEqual({ publicationId, itemIndex: 30 % 3 });

    // A newly paired player starts its own sequence; the old player's numbers do not block it.
    const replacement = await pairPlayer(t, operator, display.id);
    expect(await (await heartbeat(replacement, playing(1, 1))).json()).toMatchObject({
      accepted: true,
    });
    expect((await status(display.id)).active).toEqual({ publicationId, itemIndex: 1 });
    expect((await heartbeat(player, playing(99, 0))).status).toBe(401);
  });

  it('rejects reports for another display or an unknown publication, and malformed reports', async () => {
    const displayA = await createDisplay(operator, org, 'hb A');
    const displayB = await createDisplay(operator, org, 'hb B');
    const image = await readyImage(t, operator);
    const publicationB = (await publishImages(operator, displayB.id, [image.id])).publicationId;
    const player = await pairPlayer(t, operator, displayA.id);

    expect((await heartbeat(player, report(displayB.id, 1))).status).toBe(403);
    // A real publication, but of another display of the same organisation.
    const foreign = report(displayA.id, 2, {
      downloadedPublicationId: publicationB,
      activePublicationId: publicationB,
      activeItemIndex: 0,
      playerState: 'playing',
    });
    expect((await heartbeat(player, foreign)).status).toBe(409);
    expect(
      (
        await heartbeat(
          player,
          report(displayA.id, 3, { activePublicationId: randomUUID(), activeItemIndex: 0 }),
        )
      ).status,
    ).toBe(409);
    expect(
      (await heartbeat(player, report(displayA.id, 4, { playerState: 'playing' }))).status,
    ).toBe(400);
    expect((await heartbeat(player, report(displayA.id, -1))).status).toBe(400);
    expect((await heartbeat(player, report(displayA.id, 5, { admin: true }))).status).toBe(400);
    expect((await heartbeat(player, '{"schemaVersion":1')).status).toBe(400);
    const oversized = await heartbeat(player, JSON.stringify({ pad: 'x'.repeat(17 * 1024) }));
    expect(oversized.status).toBe(413);
    // None of the rejected reports left a trace in the delivery state.
    expect(await status(displayA.id)).toMatchObject({
      lastHeartbeatAt: null,
      summary: 'nothing_published',
    });
  });

  it('computes staleness from the clock, not from a stored flag', async () => {
    const display = await createDisplay(operator, org, 'stale');
    const image = await readyImage(t, operator);
    const { publicationId } = await publishImages(operator, display.id, [image.id]);
    const player = await pairPlayer(t, operator, display.id);
    expect(await status(display.id)).toMatchObject({ summary: 'awaiting_player', stale: true });

    await heartbeat(
      player,
      report(display.id, 1, {
        downloadedPublicationId: publicationId,
        activePublicationId: publicationId,
        activeItemIndex: 0,
        playerState: 'playing',
      }),
    );
    expect(await status(display.id)).toMatchObject({ summary: 'in_sync', stale: false });

    t.advanceClock((t.config.limits.heartbeatStaleAfterSeconds - 5) * 1000);
    expect((await status(display.id)).stale).toBe(false);
    t.advanceClock(10_000);
    const view = await status(display.id);
    expect(view).toMatchObject({ summary: 'stale', stale: true });
    // The last known facts are still shown, marked stale.
    expect(view.active).toEqual({ publicationId, itemIndex: 0 });
  });

  it('serves the manifest with ETag and 304, and only the current publication', async () => {
    const display = await createDisplay(operator, org, 'manifest');
    const image = await readyImage(t, operator);
    const player = await pairPlayer(t, operator, display.id);
    const get = (headers: Record<string, string> = {}): Promise<Response> =>
      fetch(`${t.url}/player/manifest`, {
        headers: { ...player.headers, origin: PLAYER_ORIGIN, ...headers },
      });

    expect((await get()).status).toBe(204);
    const first = (await publishImages(operator, display.id, [image.id])).publicationId;
    const response = await get();
    const etag = response.headers.get('etag') ?? '';
    expect(response.status).toBe(200);
    expect(etag).toBe(`"${first}"`);
    expect(response.headers.get('access-control-allow-origin')).toBe(PLAYER_ORIGIN);
    expect(response.headers.get('access-control-expose-headers')?.toLowerCase()).toContain('etag');
    expect(
      ((await response.json()) as { manifest: { publicationId: string } }).manifest.publicationId,
    ).toBe(first);
    expect((await get({ 'if-none-match': etag })).status).toBe(304);
    expect((await get({ 'if-none-match': `"${randomUUID()}", ${etag}` })).status).toBe(304);
    expect((await get({ 'if-none-match': '"something-else"' })).status).toBe(200);

    const second = (await publishImages(operator, display.id, [image.id, image.id])).publicationId;
    const changed = await get({ 'if-none-match': etag });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).toBe(`"${second}"`);
    // URLs are issued for the current publication only.
    expect((await mediaUrls(player, first, [image.id])).status).toBe(404);
    expect((await mediaUrls(player, second, [image.id])).status).toBe(200);

    // A request from any other web origin gets no CORS permission.
    const foreignOrigin = await fetch(`${t.url}/player/manifest`, {
      headers: { ...player.headers, origin: 'http://localhost:5173' },
    });
    expect(foreignOrigin.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('serves a version 4 manifest and the media of every playlist of the schedule', async () => {
    const display = await createDisplay(operator, org, 'scheduled');
    const usual = await readyImage(t, operator, { width: 30, height: 10 });
    // In the event playlist only: not in the default playlist, nor anywhere else.
    const special = await readyImage(t, operator, { width: 10, height: 30 });
    const schedule = await createSchedule(
      operator,
      'Week',
      await createPlaylist(operator, 'Usual', [imageItem(usual.id)]),
      [scheduleEvent(await createPlaylist(operator, 'Special', [imageItem(special.id)]))],
    );
    await assignSchedule(operator, display.id, schedule.id);
    const player = await pairPlayer(t, operator, display.id);
    const [result] = PushResponseSchema.parse(
      await (await push(operator, [display.id])).json(),
    ).results;
    const publicationId = result?.publicationId ?? '';
    expect(result?.outcome).toBe('published');

    const response = await fetch(`${t.url}/player/manifest`, { headers: player.headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe(`"${publicationId}"`);
    const manifest = ManifestSchema.parse(
      ((await response.json()) as { manifest: unknown }).manifest,
    );
    expect(manifest).toMatchObject({ schemaVersion: 4, publicationId, displayId: display.id });
    expect(manifest.assets.map((asset) => ('assetId' in asset ? asset.assetId : null))).toEqual([
      usual.id,
      special.id,
    ]);
    expect(manifestPlaylists(manifest).map((slice) => [slice.from, slice.count])).toEqual([
      [0, 1],
      [1, 1],
    ]);

    // The player stages every playlist before it activates, so each file has a URL.
    const issued = await mediaUrls(player, publicationId, [usual.id, special.id]);
    expect(issued.status).toBe(200);
    const { urls } = (await issued.json()) as { urls: { assetId: string; url: string }[] };
    expect(urls.map((entry) => entry.assetId)).toEqual([usual.id, special.id]);
    const file = await fetch(local(urls[1]?.url ?? ''));
    expect(file.status).toBe(200);
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(special.sha256);
  });

  it('binds signed media URLs to registration, publication, asset and expiry', async () => {
    const displayA = await createDisplay(operator, org, 'url A');
    const displayB = await createDisplay(operator, org, 'url B');
    const imageA = await readyImage(t, operator, { width: 30, height: 10 });
    const imageB = await readyImage(t, operator, { width: 10, height: 30 });
    const publicationA = (await publishImages(operator, displayA.id, [imageA.id])).publicationId;
    const publicationB = (await publishImages(operator, displayB.id, [imageB.id])).publicationId;
    const playerA = await pairPlayer(t, operator, displayA.id);
    const playerB = await pairPlayer(t, operator, displayB.id);

    const issued = await mediaUrls(playerA, publicationA, [imageA.id]);
    const { urls } = (await issued.json()) as {
      urls: { assetId: string; url: string; expiresAt: string }[];
    };
    const url = new URL(urls[0]?.url ?? '');
    expect(url.origin).toBe(t.config.apiPublicOrigin);
    expect([...url.searchParams.keys()].sort()).toEqual(['exp', 'pub', 'reg', 'sig']);

    // The URL works without any header, and the bytes are exactly the validated upload.
    const ok = await fetch(local(url));
    const bytes = Buffer.from(await ok.arrayBuffer());
    expect(ok.status).toBe(200);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(imageA.sha256);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ok.headers.get('cache-control')).toContain('immutable');
    const ranged = await fetch(local(url), { headers: { range: 'bytes=0-7' } });
    expect(ranged.status).toBe(206);
    expect(Buffer.from(await ranged.arrayBuffer())).toEqual(bytes.subarray(0, 8));

    // Tampering with any signed field breaks the signature.
    const tamper = (change: (u: URL) => void): Promise<Response> => {
      const copy = new URL(url);
      change(copy);
      return fetch(local(copy));
    };
    const cases: [string, (u: URL) => void][] = [
      ['another asset', (u) => (u.pathname = u.pathname.replace(imageA.id, imageB.id))],
      ['another publication', (u) => u.searchParams.set('pub', publicationB)],
      ['another registration', (u) => u.searchParams.set('reg', playerB.registrationId)],
      [
        'later expiry',
        (u) => u.searchParams.set('exp', String(Number(u.searchParams.get('exp')) + 1)),
      ],
      [
        'truncated signature',
        (u) => u.searchParams.set('sig', (u.searchParams.get('sig') ?? '').slice(0, 42)),
      ],
      [
        'flipped signature',
        (u) =>
          u.searchParams.set(
            'sig',
            (u.searchParams.get('sig') ?? '').replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
          ),
      ],
      ['extra parameter', (u) => u.searchParams.set('download', '1')],
      ['no signature', (u) => u.searchParams.delete('sig')],
    ];
    for (const [what, change] of cases) {
      const response = await tamper(change);
      expect(response.status, what).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code, what).toBe(
        'url_signature_invalid',
      );
    }

    // Cross-display: player A cannot obtain URLs for display B's content at all,
    // even though both displays belong to the same organisation.
    expect((await mediaUrls(playerA, publicationB, [imageB.id])).status).toBe(404);
    expect((await mediaUrls(playerA, publicationA, [imageB.id])).status).toBe(404);
    // Cross-organisation.
    const foreignDisplay = await createDisplay(otherOperator, other, 'foreign');
    const foreignPlayer = await pairPlayer(t, otherOperator, foreignDisplay.id);
    expect((await mediaUrls(foreignPlayer, publicationA, [imageA.id])).status).toBe(404);

    // Expiry is enforced by the server clock.
    t.advanceClock((t.config.limits.mediaUrlTtlSeconds - 2) * 1000);
    expect((await fetch(local(url))).status).toBe(200);
    t.advanceClock(4_000);
    const expired = await fetch(local(url));
    expect(expired.status).toBe(403);
    expect(((await expired.json()) as { error: { code: string } }).error.code).toBe('url_expired');

    // Revocation: a freshly issued, unexpired URL stops working at once.
    const fresh = (await (await mediaUrls(playerA, publicationA, [imageA.id])).json()) as {
      urls: { url: string }[];
    };
    const freshUrl = fresh.urls[0]?.url ?? '';
    expect((await fetch(local(freshUrl))).status).toBe(200);
    await operator.fetch(`/api/displays/${displayA.id}/revoke-player`, { method: 'POST' });
    expect((await fetch(local(freshUrl))).status).toBe(401);
    expect((await mediaUrls(playerA, publicationA, [imageA.id])).status).toBe(401);
  });

  it('requires a well-formed device credential on every credentialed route', async () => {
    const routes: [string, string][] = [
      ['GET', '/player/manifest'],
      ['POST', '/player/media-urls'],
      ['POST', '/player/heartbeat'],
      ['DELETE', '/player/registration'],
    ];
    for (const [method, path] of routes) {
      for (const authorization of [
        undefined,
        'Bearer short',
        `Bearer ${'z'.repeat(43)}`,
        `Basic ${'z'.repeat(43)}`,
      ]) {
        const response = await fetch(`${t.url}${path}`, {
          method,
          headers: {
            ...(authorization === undefined ? {} : { authorization }),
            ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
          },
          ...(method === 'POST' ? { body: '{}' } : {}),
        });
        expect(response.status, `${method} ${path} ${authorization ?? 'none'}`).toBe(401);
      }
    }
    // An operator session is not a device credential, and a device credential is not a session.
    const display = await createDisplay(operator, org, 'separation');
    const player = await pairPlayer(t, operator, display.id);
    expect(
      (await fetch(`${t.url}/player/manifest`, { headers: { cookie: operator.cookie } })).status,
    ).toBe(401);
    expect((await fetch(`${t.url}/api/displays`, { headers: player.headers })).status).toBe(401);
  });
});
