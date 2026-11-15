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
  heartbeatBody,
  pairPlayer,
  publishImages,
  readyImage,
  requestMediaUrls,
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
  let a: {
    displayId: string;
    mediaId: string;
    playlistId: string;
    publicationId: string;
    player: PairedPlayer;
  };
  let b: {
    displayId: string;
    mediaId: string;
    playlistId: string;
    publicationId: string;
    player: PairedPlayer;
  };

  async function world(operator: Operator, org: TestOrg): Promise<typeof a> {
    const display = await createDisplay(operator, org, 'Isolation display');
    const media = await readyImage(t, operator);
    const published = await publishImages(operator, display.id, [media.id]);
    const player = await pairPlayer(t, operator, display.id);
    return {
      displayId: display.id,
      mediaId: media.id,
      playlistId: published.playlistId,
      publicationId: published.publicationId,
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
    const paths = (ids: { displayId: string; mediaId: string; playlistId: string }): string[] => [
      `/api/displays/${ids.displayId}`,
      `/api/displays/${ids.displayId}/status`,
      `/api/media/${ids.mediaId}`,
      `/api/media/${ids.mediaId}/preview`,
      `/api/playlists/${ids.playlistId}`,
    ];
    const foreign = paths(a);
    const missing = paths({ displayId: unknown, mediaId: unknown, playlistId: unknown });
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
      '/api/media',
      '/api/playlists',
      '/api/audit?limit=200',
    ]) {
      const text = await (await bob.fetch(path)).text();
      for (const id of [
        orgA.orgId,
        orgA.siteId,
        orgA.membershipId,
        a.displayId,
        a.mediaId,
        a.playlistId,
        a.publicationId,
        a.player.registrationId,
      ]) {
        expect(text, `${path} leaks ${id}`).not.toContain(id);
      }
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
    const before = {
      display: await (await alice.fetch(`/api/displays/${a.displayId}`)).text(),
      playlist: await (await alice.fetch(`/api/playlists/${a.playlistId}`)).text(),
      media: await (await alice.fetch(`/api/media/${a.mediaId}`)).text(),
    };
    const attempts: [string, Promise<Response>][] = [
      [
        'PATCH display',
        bob.fetch(`/api/displays/${a.displayId}`, { method: 'PATCH', json: { name: 'taken' } }),
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
    // Creating a display on A's site is refused.
    const onForeignSite = await bob.fetch('/api/displays', {
      method: 'POST',
      json: { siteId: orgA.siteId, name: 'planted', canvas: { width: 640, height: 360 } },
    });
    expect(onForeignSite.status).toBe(404);

    expect(await (await alice.fetch(`/api/displays/${a.displayId}`)).text()).toBe(before.display);
    expect(await (await alice.fetch(`/api/playlists/${a.playlistId}`)).text()).toBe(
      before.playlist,
    );
    expect(await (await alice.fetch(`/api/media/${a.mediaId}`)).text()).toBe(before.media);
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
      'playlist',
      'playlist_item',
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
