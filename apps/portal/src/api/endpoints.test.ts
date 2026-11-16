import {
  DEFAULT_LIMITS,
  HEADERS,
  ROUTES,
  type DeliveryStatusView,
  type DisplayDto,
  type FolderDto,
  type MediaDto,
  type OverviewResponse,
  type PlaylistDto,
  type PlaylistSummaryDto,
  type PushPlanResponse,
  type PushResponse,
  type TagDto,
} from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError, createApiClient, type FetchLike } from './client.ts';
import { createEndpoints, type Endpoints } from './endpoints.ts';
import { app } from '../lib/mediaLibrary.test-support.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const DISPLAY = '22222222-2222-4222-8222-222222222222';
const OTHER_DISPLAY = '2222222a-2222-4222-8222-222222222222';
const MEDIA = '33333333-3333-4333-8333-333333333333';
const PLAYLIST = '44444444-4444-4444-8444-444444444444';
const TAG = '55555555-5555-4555-8555-555555555555';
const FOLDER = '66666666-6666-4666-8666-666666666666';
const PUBLICATION = '77777777-7777-4777-8777-777777777777';
const SITE = '88888888-8888-4888-8888-888888888888';
const AT = '2026-11-15T03:00:00.000Z';
const CSRF = 'csrf-token-aaaaaaaaaaaaaaaaaaaa';
const ATTEMPT_ID = 'push-attempt-0001';

const media: MediaDto = {
  id: MEDIA,
  kind: 'image',
  status: 'ready',
  name: 'Spring poster',
  originalName: 'poster.png',
  description: 'Shown in the lobby',
  defaultDurationMs: 8000,
  availableFrom: null,
  availableUntil: null,
  folderId: FOLDER,
  tagIds: [TAG],
  usageCount: 1,
  mimeType: 'image/png',
  bytes: 1234,
  sha256: 'ab'.repeat(32),
  width: 640,
  height: 360,
  durationMs: null,
  codec: null,
  errorCode: null,
  errorDetail: null,
  createdAt: AT,
  updatedAt: AT,
};

const display: DisplayDto = {
  id: DISPLAY,
  siteId: SITE,
  name: 'Reception',
  description: null,
  canvas: { width: 1920, height: 1080 },
  contentRect: null,
  defaultFit: 'contain',
  rotation: 0,
  workingHours: null,
  route: 'browser',
  player: null,
  tagIds: [],
  assignedPlaylist: { id: PLAYLIST, name: 'Reception loop' },
  createdAt: AT,
  updatedAt: AT,
};

const status: DeliveryStatusView = {
  displayId: DISPLAY,
  paired: false,
  registrationId: null,
  desired: null,
  downloaded: null,
  active: null,
  playerState: null,
  staging: null,
  lastHeartbeatAt: null,
  stale: true,
  staleAfterSeconds: 60,
  errors: [],
  summary: 'unpaired',
  asOf: AT,
};

const playlist: PlaylistDto = {
  id: PLAYLIST,
  name: 'Reception loop',
  description: null,
  transition: 'cut',
  shuffle: false,
  items: [
    {
      id: '99999999-9999-4999-8999-999999999999',
      position: 0,
      mediaId: MEDIA,
      durationMs: 8000,
      fit: null,
      media,
    },
  ],
  createdAt: AT,
  updatedAt: AT,
};

const summary: PlaylistSummaryDto = {
  id: PLAYLIST,
  name: 'Reception loop',
  description: 'Morning content',
  itemCount: 1,
  totalDurationMs: 8000,
  kinds: ['image'],
  previewMediaIds: [MEDIA],
  assignedDisplayCount: 1,
  createdAt: AT,
  updatedAt: AT,
};

const tag: TagDto = { id: TAG, scope: 'media', name: 'Campaign', colour: 'teal', usageCount: 1 };
const folder: FolderDto = { id: FOLDER, name: 'Posters', itemCount: 1 };
const clock = app(7);

const pushPlan: PushPlanResponse = {
  items: [
    {
      display: { id: DISPLAY, name: 'Reception' },
      playlist: { id: PLAYLIST, name: 'Reception loop' },
      state: 'changes',
      issues: [],
      lastPushedAt: AT,
    },
    {
      display: { id: OTHER_DISPLAY, name: 'Foyer' },
      playlist: { id: PLAYLIST, name: 'Reception loop' },
      state: 'blocked',
      issues: [
        { path: 'items[0]', message: 'Item 1 is still being checked.', code: 'media_not_ready' },
      ],
      lastPushedAt: null,
    },
  ],
  pendingCount: 1,
};

const pushResponse: PushResponse = {
  results: [
    { displayId: DISPLAY, outcome: 'published', publicationId: PUBLICATION, issues: [] },
    {
      displayId: OTHER_DISPLAY,
      outcome: 'rejected',
      publicationId: null,
      issues: [{ path: 'playlist', message: 'The playlist has no items.', code: 'playlist_empty' }],
    },
  ],
};

const overview: OverviewResponse = {
  displays: {
    total: 2,
    paired: 1,
    bySummary: {
      unpaired: 1,
      nothing_published: 0,
      awaiting_player: 0,
      stale: 0,
      updating: 0,
      error: 0,
      standing_by: 0,
      in_sync: 1,
    },
  },
  media: { total: 3, ready: 2, processing: 1, failed: 0, usedBytes: 2468, limitBytes: 5_000_000 },
  playlists: { total: 1 },
  pendingPushCount: 1,
};

interface Call {
  readonly path: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly init: RequestInit;
}

/**
 * An endpoints object on a real client whose `fetch` answers every call after
 * the session with `status` and `body`, and records what was sent.
 */
async function harness(
  body: unknown,
  status = 200,
): Promise<{ api: Endpoints; calls: Call[]; last: () => Call }> {
  const calls: Call[] = [];
  const fetch: FetchLike = (path, init) => {
    if (path === ROUTES.session) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            authenticated: true,
            user: { displayName: 'Test Operator', role: 'operator' },
            organization: { id: ORG, name: 'Test Organisation' },
            csrfToken: CSRF,
            expiresAt: AT,
            limits: DEFAULT_LIMITS,
          }),
          { status: 200 },
        ),
      );
    }
    calls.push({
      path,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      init,
    });
    return Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));
  };
  const client = createApiClient({ fetch, onUnauthenticated: () => undefined });
  await client.loadSession();
  return {
    api: createEndpoints(client),
    calls,
    last: () => {
      const call = calls[calls.length - 1];
      if (call === undefined) throw new Error('no call was made');
      return call;
    },
  };
}

async function rejection(promise: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiRequestError) return error;
    throw error;
  }
  throw new Error('expected the promise to reject');
}

describe('endpoints: reads', () => {
  it('asks each read at its path with GET and returns the validated answer', async () => {
    const signal = new AbortController().signal;
    const cases: [string, unknown, (api: Endpoints) => Promise<unknown>, unknown][] = [
      [ROUTES.displays, { items: [display] }, (api) => api.listDisplays(signal), [display]],
      [ROUTES.display(DISPLAY), display, (api) => api.getDisplay(DISPLAY, signal), display],
      [
        ROUTES.displayStatus(DISPLAY),
        status,
        (api) => api.getDisplayStatus(DISPLAY, signal),
        status,
      ],
      [
        ROUTES.displaysStatus,
        { items: [status] },
        (api) => api.listDisplayStatuses(signal),
        [status],
      ],
      [
        ROUTES.media,
        { items: [media], storage: { usedBytes: 1234, limitBytes: 5000 } },
        (api) => api.listMedia(signal),
        { items: [media], storage: { usedBytes: 1234, limitBytes: 5000 } },
      ],
      [ROUTES.mediaItem(MEDIA), media, (api) => api.getMedia(MEDIA, signal), media],
      [
        ROUTES.mediaUsage(MEDIA),
        { playlists: [{ id: PLAYLIST, name: 'Reception loop' }], displays: [] },
        (api) => api.getMediaUsage(MEDIA, signal),
        { playlists: [{ id: PLAYLIST, name: 'Reception loop' }], displays: [] },
      ],
      [ROUTES.tags, { items: [tag] }, (api) => api.listTags(undefined, signal), [tag]],
      [`${ROUTES.tags}?scope=media`, { items: [tag] }, (api) => api.listTags('media'), [tag]],
      [`${ROUTES.tags}?scope=display`, { items: [] }, (api) => api.listTags('display'), []],
      [ROUTES.folders, { items: [folder] }, (api) => api.listFolders(signal), [folder]],
      [ROUTES.apps, { items: [clock] }, (api) => api.listApps(signal), [clock]],
      [ROUTES.app(clock.id), clock, (api) => api.getApp(clock.id, signal), clock],
      [ROUTES.playlists, { items: [summary] }, (api) => api.listPlaylists(signal), [summary]],
      [ROUTES.playlist(PLAYLIST), playlist, (api) => api.getPlaylist(PLAYLIST, signal), playlist],
      [ROUTES.push, pushPlan, (api) => api.getPushPlan(signal), pushPlan],
      [ROUTES.overview, overview, (api) => api.getOverview(signal), overview],
    ];
    for (const [path, body, call, expected] of cases) {
      const { api, calls } = await harness(body);
      expect(await call(api), path).toEqual(expected);
      expect(calls, path).toHaveLength(1);
      expect(calls[0]?.path).toBe(path);
      expect(calls[0]?.method).toBe('GET');
      expect(calls[0]?.body).toBeUndefined();
      // A read carries no CSRF token and no Idempotency-Key.
      expect(calls[0]?.headers[HEADERS.csrf]).toBeUndefined();
      expect(calls[0]?.headers[HEADERS.idempotencyKey]).toBeUndefined();
    }
  });

  it('passes the abort signal through', async () => {
    const controller = new AbortController();
    const { api, last } = await harness(overview);
    await api.getOverview(controller.signal);
    expect(last().init.signal).toBe(controller.signal);
    await api.getOverview();
    expect(last().init.signal ?? null).toBeNull();
  });

  it('builds the audit query from the limit, the cursor and the filters', async () => {
    const { api, last } = await harness({ items: [], nextBefore: null });
    await api.listAudit({ limit: 50 });
    expect(last().path).toBe(`${ROUTES.audit}?limit=50`);
    await api.listAudit({ limit: 25, before: '981', category: 'publication', result: 'failure' });
    expect(last().path).toBe(
      `${ROUTES.audit}?limit=25&before=981&category=publication&result=failure`,
    );
    await api.listAudit({ limit: 10, category: 'tag' });
    expect(last().path).toBe(`${ROUTES.audit}?limit=10&category=tag`);
  });
});

describe('endpoints: changes', () => {
  it('sends each change with its method, path, body and the CSRF token', async () => {
    const cases: [
      string,
      string,
      unknown,
      unknown,
      (api: Endpoints) => Promise<unknown>,
      unknown,
    ][] = [
      [
        'PATCH',
        ROUTES.display(DISPLAY),
        { description: 'By the door', tagIds: [TAG], assignedPlaylistId: PLAYLIST },
        display,
        (api) =>
          api.patchDisplay(DISPLAY, {
            description: 'By the door',
            tagIds: [TAG],
            assignedPlaylistId: PLAYLIST,
          }),
        display,
      ],
      [
        'PATCH',
        ROUTES.display(DISPLAY),
        { assignedPlaylistId: null },
        { ...display, assignedPlaylist: null },
        (api) => api.patchDisplay(DISPLAY, { assignedPlaylistId: null }),
        { ...display, assignedPlaylist: null },
      ],
      [
        'PATCH',
        ROUTES.mediaItem(MEDIA),
        { name: 'Spring poster', defaultDurationMs: 8000, folderId: null, tagIds: [] },
        media,
        (api) =>
          api.patchMedia(MEDIA, {
            name: 'Spring poster',
            defaultDurationMs: 8000,
            folderId: null,
            tagIds: [],
          }),
        media,
      ],
      [
        'POST',
        ROUTES.tags,
        { scope: 'media', name: 'Campaign' },
        tag,
        (api) => api.createTag({ scope: 'media', name: 'Campaign' }),
        tag,
      ],
      [
        'PATCH',
        ROUTES.tag(TAG),
        { colour: 'amber' },
        { ...tag, colour: 'amber' },
        (api) => api.patchTag(TAG, { colour: 'amber' }),
        { ...tag, colour: 'amber' },
      ],
      [
        'POST',
        ROUTES.folders,
        { name: 'Posters' },
        folder,
        (api) => api.createFolder('Posters'),
        folder,
      ],
      [
        'PATCH',
        ROUTES.folder(FOLDER),
        { name: 'Menus' },
        { ...folder, name: 'Menus' },
        (api) => api.renameFolder(FOLDER, 'Menus'),
        { ...folder, name: 'Menus' },
      ],
      [
        'POST',
        ROUTES.apps,
        { name: clock.name, content: clock.content },
        clock,
        (api) => api.createApp({ name: clock.name, content: clock.content }),
        clock,
      ],
      [
        'PATCH',
        ROUTES.app(clock.id),
        { name: 'Lobby clock' },
        { ...clock, name: 'Lobby clock' },
        (api) => api.patchApp(clock.id, { name: 'Lobby clock' }),
        { ...clock, name: 'Lobby clock' },
      ],
      [
        'PUT',
        ROUTES.playlist(PLAYLIST),
        { name: 'Reception loop', description: null, items: [] },
        playlist,
        (api) =>
          api.replacePlaylist(PLAYLIST, { name: 'Reception loop', description: null, items: [] }),
        playlist,
      ],
      [
        'POST',
        ROUTES.playlistDuplicate(PLAYLIST),
        undefined,
        { ...playlist, name: 'Copy of Reception loop' },
        (api) => api.duplicatePlaylist(PLAYLIST),
        { ...playlist, name: 'Copy of Reception loop' },
      ],
      [
        'POST',
        ROUTES.playlists,
        { name: 'New loop' },
        { ...playlist, items: [] },
        (api) => api.createPlaylist('New loop'),
        { id: PLAYLIST },
      ],
    ];
    for (const [method, path, sent, answer, call, expected] of cases) {
      const what = `${method} ${path}`;
      const { api, calls } = await harness(answer, method === 'POST' ? 201 : 200);
      expect(await call(api), what).toEqual(expected);
      expect(calls, what).toHaveLength(1);
      expect(calls[0]?.method, what).toBe(method);
      expect(calls[0]?.path, what).toBe(path);
      expect(calls[0]?.body, what).toEqual(sent);
      expect(calls[0]?.headers[HEADERS.csrf], what).toBe(CSRF);
    }
  });

  it('sends each delete with DELETE and the CSRF token, and accepts an empty 204', async () => {
    const cases: [string, (api: Endpoints) => Promise<void>][] = [
      [ROUTES.mediaItem(MEDIA), (api) => api.deleteMedia(MEDIA)],
      [ROUTES.tag(TAG), (api) => api.deleteTag(TAG)],
      [ROUTES.folder(FOLDER), (api) => api.deleteFolder(FOLDER)],
      [ROUTES.app(clock.id), (api) => api.deleteApp(clock.id)],
      [ROUTES.playlist(PLAYLIST), (api) => api.deletePlaylist(PLAYLIST)],
    ];
    for (const [path, call] of cases) {
      const { api, calls } = await harness(null, 204);
      await expect(call(api), path).resolves.toBeUndefined();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('DELETE');
      expect(calls[0]?.path).toBe(path);
      expect(calls[0]?.body).toBeUndefined();
      expect(calls[0]?.headers[HEADERS.csrf]).toBe(CSRF);
    }
  });

  it('reports the refusal of a delete with the API code', async () => {
    const { api } = await harness(
      {
        error: {
          code: 'playlist_in_use',
          message: 'This playlist is assigned to a display.',
          details: [{ path: 'display', message: 'Reception' }],
        },
      },
      409,
    );
    const error = await rejection(api.deletePlaylist(PLAYLIST));
    expect(error.status).toBe(409);
    expect(error.code).toBe('playlist_in_use');
    expect(error.fromApi).toBe(true);
    expect(error.details).toEqual([{ path: 'display', message: 'Reception' }]);
  });

  it('pushes the chosen displays under the given Idempotency-Key', async () => {
    const { api, last, calls } = await harness(pushResponse);
    const ids: readonly string[] = Object.freeze([DISPLAY, OTHER_DISPLAY]);
    expect(await api.push(ids, ATTEMPT_ID)).toEqual(pushResponse);
    expect(calls).toHaveLength(1);
    expect(last().method).toBe('POST');
    expect(last().path).toBe(ROUTES.push);
    expect(last().body).toEqual({ displayIds: [DISPLAY, OTHER_DISPLAY] });
    expect(last().headers[HEADERS.idempotencyKey]).toBe(ATTEMPT_ID);
    expect(last().headers[HEADERS.csrf]).toBe(CSRF);
    // The plan is a read at the same path: no key, no token.
    const plan = await harness(pushPlan);
    await plan.api.getPushPlan();
    expect(plan.last().method).toBe('GET');
    expect(plan.last().headers[HEADERS.idempotencyKey]).toBeUndefined();
  });

  it('still publishes one playlist to one display under its key', async () => {
    const answer = {
      publicationId: PUBLICATION,
      displayId: DISPLAY,
      playlistId: PLAYLIST,
      createdAt: AT,
      replayed: false,
      manifest: {
        schemaVersion: 1,
        publicationId: PUBLICATION,
        displayId: DISPLAY,
        createdAt: AT,
        canvas: { width: 1920, height: 1080 },
        contentRect: null,
        muted: true,
        assets: [
          {
            assetId: MEDIA,
            mediaType: 'image/png',
            kind: 'image',
            bytes: 1234,
            sha256: 'ab'.repeat(32),
            durationMs: 8000,
            fit: 'contain',
            width: 640,
            height: 360,
          },
        ],
      },
    };
    const { api, last } = await harness(answer, 201);
    expect((await api.publish(PLAYLIST, DISPLAY, ATTEMPT_ID)).publicationId).toBe(PUBLICATION);
    expect(last().path).toBe(ROUTES.playlistPublish(PLAYLIST));
    expect(last().body).toEqual({ displayId: DISPLAY });
    expect(last().headers[HEADERS.idempotencyKey]).toBe(ATTEMPT_ID);
  });
});

describe('endpoints: answers the portal must not trust', () => {
  it('refuses an answer with a missing field, an unknown field or a broken rule', async () => {
    const { usageCount: _usageCount, ...mediaWithoutUsage } = media;
    const cases: [string, unknown, (api: Endpoints) => Promise<unknown>][] = [
      ['media without usageCount', mediaWithoutUsage, (api) => api.getMedia(MEDIA)],
      [
        'media with an empty name',
        { ...media, name: '' },
        (api) => api.patchMedia(MEDIA, { name: null }),
      ],
      [
        'a display with an extra field',
        { ...display, online: true },
        (api) => api.getDisplay(DISPLAY),
      ],
      [
        'a display without assignedPlaylist',
        { ...display, assignedPlaylist: undefined },
        (api) => api.patchDisplay(DISPLAY, { assignedPlaylistId: null }),
      ],
      ['a status list that is a bare array', [status], (api) => api.listDisplayStatuses()],
      [
        'a tag with an unknown colour',
        { ...tag, colour: 'magenta' },
        (api) => api.patchTag(TAG, { colour: 'red' }),
      ],
      [
        'a tag list with an extra field',
        { items: [tag], total: 1 },
        (api) => api.listTags('media'),
      ],
      ['a folder without itemCount', { id: FOLDER, name: 'Posters' }, (api) => api.listFolders()],
      [
        'a playlist summary without the stage A fields',
        { items: [{ id: PLAYLIST, name: 'Loop', itemCount: 1, createdAt: AT, updatedAt: AT }] },
        (api) => api.listPlaylists(),
      ],
      [
        'a push plan whose pending count does not match its rows',
        { ...pushPlan, pendingCount: 2 },
        (api) => api.getPushPlan(),
      ],
      [
        'a push plan row that is blocked without a reason',
        {
          items: [{ ...pushPlan.items[1], issues: [] }],
          pendingCount: 0,
        },
        (api) => api.getPushPlan(),
      ],
      [
        'a push result that says published without a publication',
        {
          results: [{ displayId: DISPLAY, outcome: 'published', publicationId: null, issues: [] }],
        },
        (api) => api.push([DISPLAY], ATTEMPT_ID),
      ],
      [
        'a push result with an unknown outcome',
        { results: [{ displayId: DISPLAY, outcome: 'queued', publicationId: null, issues: [] }] },
        (api) => api.push([DISPLAY], ATTEMPT_ID),
      ],
      [
        'an overview with a summary it does not know',
        {
          ...overview,
          displays: {
            ...overview.displays,
            bySummary: { ...overview.displays.bySummary, online: 2 },
          },
        },
        (api) => api.getOverview(),
      ],
      [
        'an overview without the pending count',
        { ...overview, pendingPushCount: undefined },
        (api) => api.getOverview(),
      ],
      [
        'a media usage answer with a bare id',
        { playlists: [PLAYLIST], displays: [] },
        (api) => api.getMediaUsage(MEDIA),
      ],
    ];
    for (const [what, body, call] of cases) {
      const { api } = await harness(body);
      const error = await rejection(call(api));
      expect(error.code, what).toBe('invalid_response');
      expect(error.fromApi, what).toBe(false);
    }
  });

  it('percent-encodes an id it is given, so it cannot change the path', async () => {
    const { api, last } = await harness(null, 204);
    await api.deleteTag('../playlists/x?y=1');
    expect(last().path).toBe(`${ROUTES.tags}/..%2Fplaylists%2Fx%3Fy%3D1`);
  });
});
