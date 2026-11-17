/**
 * Brief section 8 item 4: a second organisation with its own member and its own session
 * (and its own paired player) gets nothing from the first organisation, through direct
 * API requests with known ids and, underneath, through the database policies.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appClient,
  createDisplay,
  createOrg,
  createSchedule,
  heartbeatBody,
  pairPlayer,
  publishImages,
  readyImage,
  requestMediaUrls,
  scheduleEvent,
  sendHeartbeat,
  signIn,
  startTestApp,
  type Operator,
  type PairedPlayer,
  type TestApp,
  type TestOrg,
} from './support.ts';

describe('organisation isolation through the API', () => {
  let t: TestApp;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let alice: Operator;
  let bob: Operator;
  interface World {
    displayId: string;
    mediaId: string;
    playlistId: string;
    publicationId: string;
    folderId: string;
    mediaTagId: string;
    displayTagId: string;
    appId: string;
    scheduleId: string;
    player: PairedPlayer;
  }
  let a: World;
  let b: World;

  async function created(response: Response): Promise<string> {
    if (response.status !== 201) throw new Error(`arranging failed: ${response.status}`);
    return ((await response.json()) as { id: string }).id;
  }

  /**
   * One of everything an organisation can own: a display with a paired player, ready
   * media in a folder, a playlist published and so assigned to the display, and a tag
   * of each scope put on the media item and on the display, an app, and a schedule
   * with one event on the playlist (assigned to no display).
   */
  async function world(operator: Operator, org: TestOrg): Promise<World> {
    const display = await createDisplay(operator, org, 'Isolation display');
    const media = await readyImage(t, operator);
    const published = await publishImages(operator, display.id, [media.id]);
    const player = await pairPlayer(t, operator, display.id);
    const folderId = await created(
      await operator.fetch('/api/folders', { method: 'POST', json: { name: 'Isolation folder' } }),
    );
    const tag = (scope: string): Promise<Response> =>
      operator.fetch('/api/tags', { method: 'POST', json: { scope, name: 'Isolation tag' } });
    const mediaTagId = await created(await tag('media'));
    const displayTagId = await created(await tag('display'));
    const filed = await operator.fetch(`/api/media/${media.id}`, {
      method: 'PATCH',
      json: { folderId, tagIds: [mediaTagId] },
    });
    const tagged = await operator.fetch(`/api/displays/${display.id}`, {
      method: 'PATCH',
      json: { tagIds: [displayTagId] },
    });
    if (filed.status !== 200 || tagged.status !== 200) throw new Error('arranging failed');
    const appId = await created(
      await operator.fetch('/api/apps', {
        method: 'POST',
        json: {
          name: 'Isolation clock',
          content: {
            type: 'clock',
            settings: {
              hourCycle: '12',
              showSeconds: false,
              textColour: '#ffffff',
              backgroundColour: '#000000',
            },
          },
        },
      }),
    );
    const schedule = await createSchedule(operator, 'Isolation week', published.playlistId, [
      scheduleEvent(published.playlistId),
    ]);
    return {
      displayId: display.id,
      mediaId: media.id,
      playlistId: published.playlistId,
      publicationId: published.publicationId,
      folderId,
      mediaTagId,
      displayTagId,
      appId,
      scheduleId: schedule.id,
      player,
    };
  }

  beforeAll(async () => {
    t = await startTestApp();
    orgA = await createOrg('Isolation A');
    orgB = await createOrg('Isolation B');
    alice = await signIn(t, orgA);
    bob = await signIn(t, orgB);
    a = await world(alice, orgA);
    b = await world(bob, orgB);
    // Give A's display some reported state and an audit trail to protect.
    const report = await sendHeartbeat(
      t,
      a.player,
      heartbeatBody(a.displayId, 10, {
        downloadedPublicationId: a.publicationId,
        activePublicationId: a.publicationId,
        activeItemIndex: 0,
        playerState: 'playing',
      }),
    );
    expect(report.status).toBe(200);
  });
  afterAll(async () => {
    await t.close();
  });

  it('answers every read of another organisation’s object like an unknown id', async () => {
    const unknown = randomUUID();
    const paths = (ids: {
      displayId: string;
      mediaId: string;
      playlistId: string;
      appId: string;
      scheduleId: string;
    }): string[] => [
      `/api/displays/${ids.displayId}`,
      `/api/displays/${ids.displayId}/status`,
      `/api/media/${ids.mediaId}`,
      `/api/media/${ids.mediaId}/preview`,
      `/api/media/${ids.mediaId}/thumbnail`,
      `/api/media/${ids.mediaId}/usage`,
      `/api/playlists/${ids.playlistId}`,
      `/api/apps/${ids.appId}`,
      `/api/schedules/${ids.scheduleId}`,
    ];
    const foreign = paths(a);
    const missing = paths({
      displayId: unknown,
      mediaId: unknown,
      playlistId: unknown,
      appId: unknown,
      scheduleId: unknown,
    });
    for (let i = 0; i < foreign.length; i += 1) {
      const real = await bob.fetch(foreign[i] ?? '');
      const none = await bob.fetch(missing[i] ?? '');
      expect(real.status, foreign[i]).toBe(404);
      expect(none.status).toBe(404);
      const realBody = (await real.json()) as { error: { code: string; message: string } };
      const noneBody = (await none.json()) as { error: { code: string; message: string } };
      // Same code and same message: the response does not confirm that the object exists.
      expect(realBody.error.code).toBe(noneBody.error.code);
      expect(realBody.error.message).toBe(noneBody.error.message);
      // The owner still reads it.
      expect((await alice.fetch(foreign[i] ?? '')).status).toBe(200);
    }
  });

  it('keeps lists, storage totals and the audit trail to the caller’s organisation', async () => {
    for (const path of [
      '/api/sites',
      '/api/displays',
      '/api/displays/status',
      '/api/media',
      `/api/media/${b.mediaId}/usage`,
      '/api/tags',
      '/api/tags?scope=media',
      '/api/tags?scope=display',
      '/api/folders',
      '/api/apps',
      '/api/schedules',
      '/api/playlists',
      '/api/push',
      '/api/overview',
      '/api/audit?limit=200',
      '/api/audit?limit=200&category=tag',
    ]) {
      const response = await bob.fetch(path);
      expect(response.status, path).toBe(200);
      const text = await response.text();
      for (const id of [
        orgA.orgId,
        orgA.siteId,
        orgA.membershipId,
        a.displayId,
        a.mediaId,
        a.playlistId,
        a.publicationId,
        a.folderId,
        a.mediaTagId,
        a.displayTagId,
        a.appId,
        a.scheduleId,
        a.player.registrationId,
      ]) {
        expect(text, `${path} leaks ${id}`).not.toContain(id);
      }
    }
    // Each organisation's lists and numbers describe exactly its own world: both
    // have the same things, so any row of the other would show up as a wrong count.
    for (const operator of [alice, bob]) {
      const json = async <T>(path: string): Promise<T> =>
        (await (await operator.fetch(path)).json()) as T;
      for (const path of [
        '/api/displays',
        '/api/displays/status',
        '/api/media',
        '/api/push',
        '/api/apps',
        '/api/schedules',
      ]) {
        expect((await json<{ items: unknown[] }>(path)).items, path).toHaveLength(1);
      }
      expect((await json<{ items: unknown[] }>('/api/tags')).items).toHaveLength(2);
      expect(await json('/api/folders')).toMatchObject({ items: [{ itemCount: 1 }] });
      expect(await json('/api/tags?scope=media')).toMatchObject({ items: [{ usageCount: 1 }] });
      expect(await json('/api/overview')).toMatchObject({
        displays: { total: 1, paired: 1 },
        media: { total: 1, ready: 1 },
        pendingPushCount: 0,
      });
    }
    const audit = (await (await bob.fetch('/api/audit?limit=200')).json()) as {
      items: { actorId: string | null }[];
    };
    expect(audit.items.length).toBeGreaterThan(0);
    for (const event of audit.items) {
      expect([orgB.membershipId, b.player.registrationId, null]).toContain(event.actorId);
    }
  });

  it('refuses every mutation of another organisation’s object and leaves it unchanged', async () => {
    const snapshot = async (): Promise<Record<string, string>> => ({
      display: await (await alice.fetch(`/api/displays/${a.displayId}`)).text(),
      playlist: await (await alice.fetch(`/api/playlists/${a.playlistId}`)).text(),
      playlists: await (await alice.fetch('/api/playlists')).text(),
      media: await (await alice.fetch(`/api/media/${a.mediaId}`)).text(),
      tags: await (await alice.fetch('/api/tags')).text(),
      folders: await (await alice.fetch('/api/folders')).text(),
      apps: await (await alice.fetch('/api/apps')).text(),
      schedule: await (await alice.fetch(`/api/schedules/${a.scheduleId}`)).text(),
      schedules: await (await alice.fetch('/api/schedules')).text(),
      push: await (await alice.fetch('/api/push')).text(),
      status: JSON.stringify({
        ...((await (await alice.fetch(`/api/displays/${a.displayId}/status`)).json()) as object),
        asOf: null,
      }),
    });
    const before = await snapshot();
    const ownBefore = (await (
      await bob.fetch(`/api/displays/${b.displayId}/status`)
    ).json()) as object;
    const attempts: [string, Promise<Response>][] = [
      [
        'PATCH display',
        bob.fetch(`/api/displays/${a.displayId}`, { method: 'PATCH', json: { name: 'taken' } }),
      ],
      [
        'PATCH media',
        bob.fetch(`/api/media/${a.mediaId}`, { method: 'PATCH', json: { name: 'taken' } }),
      ],
      [
        'PATCH tag',
        bob.fetch(`/api/tags/${a.mediaTagId}`, { method: 'PATCH', json: { name: 'taken' } }),
      ],
      ['DELETE media tag', bob.fetch(`/api/tags/${a.mediaTagId}`, { method: 'DELETE' })],
      ['DELETE display tag', bob.fetch(`/api/tags/${a.displayTagId}`, { method: 'DELETE' })],
      [
        'PATCH folder',
        bob.fetch(`/api/folders/${a.folderId}`, { method: 'PATCH', json: { name: 'taken' } }),
      ],
      ['DELETE folder', bob.fetch(`/api/folders/${a.folderId}`, { method: 'DELETE' })],
      [
        'PATCH app',
        bob.fetch(`/api/apps/${a.appId}`, { method: 'PATCH', json: { name: 'taken' } }),
      ],
      ['DELETE app', bob.fetch(`/api/apps/${a.appId}`, { method: 'DELETE' })],
      [
        'PUT schedule',
        bob.fetch(`/api/schedules/${a.scheduleId}`, {
          method: 'PUT',
          json: { name: 'taken', defaultPlaylistId: b.playlistId, events: [] },
        }),
      ],
      ['DELETE schedule', bob.fetch(`/api/schedules/${a.scheduleId}`, { method: 'DELETE' })],
      ['DELETE playlist', bob.fetch(`/api/playlists/${a.playlistId}`, { method: 'DELETE' })],
      [
        'duplicate playlist',
        bob.fetch(`/api/playlists/${a.playlistId}/duplicate`, { method: 'POST' }),
      ],
      [
        'push to A display',
        bob.fetch('/api/push', {
          method: 'POST',
          json: { displayIds: [a.displayId] },
          headers: { 'idempotency-key': randomUUID() },
        }),
      ],
      [
        'push to own and A display',
        bob.fetch('/api/push', {
          method: 'POST',
          json: { displayIds: [b.displayId, a.displayId] },
          headers: { 'idempotency-key': randomUUID() },
        }),
      ],
      // Pointing one's own objects at another organisation's is refused the same way.
      [
        'assign A playlist to own display',
        bob.fetch(`/api/displays/${b.displayId}`, {
          method: 'PATCH',
          json: { assignedPlaylistId: a.playlistId },
        }),
      ],
      [
        'assign A schedule to own display',
        bob.fetch(`/api/displays/${b.displayId}`, {
          method: 'PATCH',
          json: { assignedScheduleId: a.scheduleId },
        }),
      ],
      [
        'put A display tag on own display',
        bob.fetch(`/api/displays/${b.displayId}`, {
          method: 'PATCH',
          json: { tagIds: [b.displayTagId, a.displayTagId] },
        }),
      ],
      [
        'move own media into A folder',
        bob.fetch(`/api/media/${b.mediaId}`, { method: 'PATCH', json: { folderId: a.folderId } }),
      ],
      [
        'put A media tag on own media',
        bob.fetch(`/api/media/${b.mediaId}`, {
          method: 'PATCH',
          json: { tagIds: [a.mediaTagId] },
        }),
      ],
      [
        'revoke player',
        bob.fetch(`/api/displays/${a.displayId}/revoke-player`, { method: 'POST' }),
      ],
      ['DELETE media', bob.fetch(`/api/media/${a.mediaId}`, { method: 'DELETE' })],
      [
        'PUT playlist',
        bob.fetch(`/api/playlists/${a.playlistId}`, {
          method: 'PUT',
          json: { name: 'taken', items: [] },
        }),
      ],
      [
        'publish A playlist to A display',
        bob.fetch(`/api/playlists/${a.playlistId}/publish`, {
          method: 'POST',
          json: { displayId: a.displayId },
          headers: { 'idempotency-key': randomUUID() },
        }),
      ],
      [
        'publish A playlist to own display',
        bob.fetch(`/api/playlists/${a.playlistId}/publish`, {
          method: 'POST',
          json: { displayId: b.displayId },
          headers: { 'idempotency-key': randomUUID() },
        }),
      ],
      [
        'publish own playlist to A display',
        bob.fetch(`/api/playlists/${b.playlistId}/publish`, {
          method: 'POST',
          json: { displayId: a.displayId },
          headers: { 'idempotency-key': randomUUID() },
        }),
      ],
    ];
    for (const [what, attempt] of attempts) {
      expect((await attempt).status, what).toBe(404);
    }
    // Putting A's media into B's own playlist is refused too.
    const smuggle = await bob.fetch(`/api/playlists/${b.playlistId}`, {
      method: 'PUT',
      json: { name: 'mine', items: [{ mediaId: a.mediaId, durationMs: 5000, fit: null }] },
    });
    expect(smuggle.status).toBeGreaterThanOrEqual(400);
    expect(smuggle.status).toBeLessThan(500);
    const own = (await (await bob.fetch(`/api/playlists/${b.playlistId}`)).json()) as {
      items: { mediaId: string }[];
    };
    expect(own.items.map((item) => item.mediaId)).not.toContain(a.mediaId);
    // So is putting A's app into B's own playlist: to B it does not exist.
    const smuggleApp = await bob.fetch(`/api/playlists/${b.playlistId}`, {
      method: 'PUT',
      json: { name: 'mine', items: [{ appId: a.appId, durationMs: 5000 }] },
    });
    expect(smuggleApp.status).toBe(400);
    expect(JSON.stringify(await smuggleApp.json())).toContain('app_missing');
    // So is naming A's playlist in a schedule of B's own, as its default or in an event.
    for (const json of [
      { name: 'mine', defaultPlaylistId: a.playlistId, events: [] },
      { name: 'mine', defaultPlaylistId: b.playlistId, events: [scheduleEvent(a.playlistId)] },
    ]) {
      for (const smuggleSchedule of [
        await bob.fetch('/api/schedules', { method: 'POST', json }),
        await bob.fetch(`/api/schedules/${b.scheduleId}`, { method: 'PUT', json }),
      ]) {
        expect(smuggleSchedule.status).toBe(400);
        expect(JSON.stringify(await smuggleSchedule.json())).toContain(
          'The playlist was not found.',
        );
      }
    }
    // Creating a display on A's site is refused.
    const onForeignSite = await bob.fetch('/api/displays', {
      method: 'POST',
      json: { siteId: orgA.siteId, name: 'planted', canvas: { width: 640, height: 360 } },
    });
    expect(onForeignSite.status).toBe(404);

    expect(await snapshot()).toEqual(before);
    // Bob's own objects were not half-changed by the refused requests either.
    const ownDisplay = (await (await bob.fetch(`/api/displays/${b.displayId}`)).json()) as {
      tagIds: string[];
      assignedPlaylist: { id: string } | null;
      assignedSchedule: { id: string } | null;
    };
    expect(ownDisplay.tagIds).toEqual([b.displayTagId]);
    expect(ownDisplay.assignedPlaylist?.id).toBe(b.playlistId);
    expect(ownDisplay.assignedSchedule).toBeNull();
    const ownSchedule = (await (await bob.fetch(`/api/schedules/${b.scheduleId}`)).json()) as {
      name: string;
      defaultPlaylist: { id: string };
    };
    expect(ownSchedule).toMatchObject({
      name: 'Isolation week',
      defaultPlaylist: { id: b.playlistId },
    });
    const ownMedia = (await (await bob.fetch(`/api/media/${b.mediaId}`)).json()) as {
      folderId: string | null;
      tagIds: string[];
    };
    expect(ownMedia).toMatchObject({ folderId: b.folderId, tagIds: [b.mediaTagId] });
    // The push that named A's display did not push Bob's own display either.
    expect({
      ...((await (await bob.fetch(`/api/displays/${b.displayId}/status`)).json()) as object),
      asOf: null,
    }).toEqual({ ...ownBefore, asOf: null });
    // A's player credential is still valid: the foreign revoke did nothing.
    expect((await fetch(`${t.url}/player/manifest`, { headers: a.player.headers })).status).toBe(
      200,
    );
  });

  it('does not let a pairing code be claimed onto another organisation’s display', async () => {
    const created = (await (await fetch(`${t.url}/player/pairing`, { method: 'POST' })).json()) as {
      code: string;
    };
    const claim = await bob.fetch(`/api/displays/${a.displayId}/claim`, {
      method: 'POST',
      json: { code: created.code },
    });
    expect(claim.status).toBe(404);
    // The code was not consumed by the refused attempt.
    const rightful = await bob.fetch(`/api/displays/${b.displayId}/claim`, {
      method: 'POST',
      json: { code: created.code },
    });
    expect(rightful.status).toBe(200);
    // That replaced B's player; pair again so later tests have a live credential.
    b = { ...b, player: await pairPlayer(t, bob, b.displayId) };
  });

  it('gives a player of one organisation nothing from another organisation', async () => {
    // Its manifest is its own display's.
    const manifest = (await (
      await fetch(`${t.url}/player/manifest`, { headers: b.player.headers })
    ).json()) as { manifest: { publicationId: string; displayId: string } };
    expect(manifest.manifest.publicationId).toBe(b.publicationId);
    expect(manifest.manifest.displayId).toBe(b.displayId);

    // Media URLs for A's publication or A's asset.
    expect((await requestMediaUrls(t, b.player, a.publicationId, [a.mediaId])).status).toBe(404);
    expect((await requestMediaUrls(t, b.player, b.publicationId, [a.mediaId])).status).toBe(404);

    // A valid URL issued to A's player, re-pointed at B's registration or B's asset.
    const issued = (await (
      await requestMediaUrls(t, a.player, a.publicationId, [a.mediaId])
    ).json()) as { urls: { url: string }[] };
    const good = new URL(issued.urls[0]?.url ?? '');
    const local = (url: URL): string => `${t.url}${url.pathname}${url.search}`;
    expect((await fetch(local(good))).status).toBe(200);
    const otherRegistration = new URL(good);
    otherRegistration.searchParams.set('reg', b.player.registrationId);
    expect((await fetch(local(otherRegistration))).status).toBe(403);
    const otherAsset = new URL(good);
    otherAsset.pathname = otherAsset.pathname.replace(a.mediaId, b.mediaId);
    expect((await fetch(local(otherAsset))).status).toBe(403);
    // A device credential is not a way into the media route either.
    const withBearer = new URL(good);
    withBearer.searchParams.delete('sig');
    expect(
      (await fetch(local(withBearer), { headers: b.player.headers })).status,
    ).toBeGreaterThanOrEqual(400);

    // Reports about A's display or A's publication are rejected and change nothing.
    const statusBefore = (await (
      await alice.fetch(`/api/displays/${a.displayId}/status`)
    ).json()) as { asOf: string };
    const forDisplay = await sendHeartbeat(t, b.player, heartbeatBody(a.displayId, 999_999));
    expect(forDisplay.status).toBeGreaterThanOrEqual(400);
    const forPublication = await sendHeartbeat(
      t,
      b.player,
      heartbeatBody(b.displayId, 1_000_000, {
        downloadedPublicationId: a.publicationId,
        activePublicationId: a.publicationId,
        activeItemIndex: 0,
        playerState: 'playing',
      }),
    );
    expect(forPublication.status).toBeGreaterThanOrEqual(400);
    const statusAfter = (await (
      await alice.fetch(`/api/displays/${a.displayId}/status`)
    ).json()) as {
      asOf: string;
    };
    expect({ ...statusAfter, asOf: null }).toEqual({ ...statusBefore, asOf: null });
    const ownStatus = (await (await bob.fetch(`/api/displays/${b.displayId}/status`)).json()) as {
      active: unknown;
    };
    expect(ownStatus.active).toBeNull();
  });

  it('ignores organisation ids supplied in the request', async () => {
    const withQuery = await bob.fetch(`/api/displays?orgId=${orgA.orgId}`);
    const text = await withQuery.text();
    expect(text).not.toContain(a.displayId);
    const withHeader = await bob.fetch('/api/displays', { headers: { 'x-org-id': orgA.orgId } });
    expect(await withHeader.text()).not.toContain(a.displayId);
    const withBody = await bob.fetch('/api/playlists', {
      method: 'POST',
      json: { name: 'planted', orgId: orgA.orgId },
    });
    // Strict schemas: an unknown key is a validation error, not a hint.
    expect(withBody.status).toBe(400);
  });

  it('holds at the database: the runtime role sees nothing without a context and only its own rows with one', async () => {
    const TABLES = [
      'organization',
      'membership',
      'site',
      'display',
      'player_registration',
      'media',
      'folder',
      'tag',
      'media_tag',
      'display_tag',
      'playlist',
      'playlist_item',
      'schedule',
      'schedule_event',
      'publication',
      'publication_asset',
      'display_delivery',
      'heartbeat_log',
      'audit_event',
    ];
    // Both organisations have a row in every tenant table, heartbeat log included.
    expect((await sendHeartbeat(t, b.player, heartbeatBody(b.displayId, Date.now()))).status).toBe(
      200,
    );
    const client = await appClient();
    try {
      const role = await client.query<{ current_user: string; bypass: boolean; super: boolean }>(
        'SELECT current_user, rolbypassrls AS bypass, rolsuper AS super FROM pg_roles WHERE rolname = current_user',
      );
      expect(role.rows[0]).toEqual({ current_user: 'tinnox_app', bypass: false, super: false });

      // No WHERE clause anywhere below: only the policies decide what comes back.
      for (const table of TABLES) {
        const none = await client.query(`SELECT * FROM ${table}`);
        expect(none.rowCount, `${table} without context`).toBe(0);
      }
      for (const [mine, theirs] of [
        [orgA, orgB],
        [orgB, orgA],
      ] as const) {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.org_id', $1, true)", [mine.orgId]);
        for (const table of TABLES) {
          const column = table === 'organization' ? 'id' : 'org_id';
          const rows = await client.query<{ org: string }>(`SELECT ${column} AS org FROM ${table}`);
          expect(rows.rowCount, `${table} for its own organisation`).toBeGreaterThan(0);
          expect(
            rows.rows.every((row) => row.org === mine.orgId),
            table,
          ).toBe(true);
          expect(
            rows.rows.some((row) => row.org === theirs.orgId),
            table,
          ).toBe(false);
        }
        // Writes aimed at the other organisation's rows touch nothing.
        const update = await client.query("UPDATE playlist SET name = 'taken'");
        expect(update.rowCount).toBeGreaterThan(0);
        const names = await client.query<{ org_id: string }>('SELECT org_id FROM playlist');
        expect(names.rows.every((row) => row.org_id === mine.orgId)).toBe(true);
        await client.query('ROLLBACK');
      }
      // After the transactions the connection has no context again.
      expect((await client.query('SELECT * FROM display')).rowCount).toBe(0);
    } finally {
      await client.end();
    }
    // The other organisation's playlist names were not touched by the unfiltered UPDATE.
    const playlistA = (await (await alice.fetch(`/api/playlists/${a.playlistId}`)).json()) as {
      name: string;
    };
    expect(playlistA.name).toBe('Test playlist');
  });
});
