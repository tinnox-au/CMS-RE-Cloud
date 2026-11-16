import { randomUUID } from 'node:crypto';
import { withOrg } from '@tinnox/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDisplay,
  createOrg,
  pairPlayer,
  pngBytes,
  publishImages,
  readyImage,
  signIn,
  startTestApp,
  uploadBytes,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

interface Publish {
  publicationId: string;
  replayed: boolean;
  manifest: { assets: { assetId: string; durationMs: number; fit: string }[]; canvas: unknown };
}

describe('publishing', () => {
  let t: TestApp;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let alice: Operator;
  let bob: Operator;

  beforeAll(async () => {
    t = await startTestApp();
    orgA = await createOrg('Publish A');
    orgB = await createOrg('Publish B');
    alice = await signIn(t, orgA);
    bob = await signIn(t, orgB);
  });
  afterAll(async () => {
    await t.close();
  });

  async function playlistWith(operator: Operator, mediaIds: string[]): Promise<string> {
    const playlist = (await (
      await operator.fetch('/api/playlists', { method: 'POST', json: { name: 'P' } })
    ).json()) as { id: string };
    const put = await operator.fetch(`/api/playlists/${playlist.id}`, {
      method: 'PUT',
      json: {
        name: 'P',
        items: mediaIds.map((mediaId) => ({ mediaId, durationMs: 4000, fit: null })),
      },
    });
    expect(put.status).toBe(200);
    return playlist.id;
  }

  async function publicationCount(org: TestOrg, displayId: string): Promise<number> {
    return withOrg(t.pool, org.orgId, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM publication WHERE display_id = $1',
        [displayId],
      );
      return Number(rows[0]?.n ?? 0);
    });
  }

  it('creates one publication for many concurrent retries with the same Idempotency-Key', async () => {
    const display = await createDisplay(alice, orgA);
    const image = await readyImage(t, alice);
    const playlistId = await playlistWith(alice, [image.id, image.id]);
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        alice.fetch(`/api/playlists/${playlistId}/publish`, {
          method: 'POST',
          json: { displayId: display.id },
          headers: { 'idempotency-key': key },
        }),
      ),
    );
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as Publish[];
    expect(responses.map((r) => r.status).sort()).toEqual([...Array<number>(11).fill(200), 201]);
    expect(new Set(bodies.map((b) => b.publicationId)).size).toBe(1);
    expect(bodies.filter((b) => !b.replayed)).toHaveLength(1);
    expect(await publicationCount(orgA, display.id)).toBe(1);

    // A later retry still returns the same publication, even after the draft changed.
    await alice.fetch(`/api/playlists/${playlistId}`, {
      method: 'PUT',
      json: { name: 'P2', items: [] },
    });
    const late = await alice.fetch(`/api/playlists/${playlistId}/publish`, {
      method: 'POST',
      json: { displayId: display.id },
      headers: { 'idempotency-key': key },
    });
    const lateBody = (await late.json()) as Publish;
    expect(late.status).toBe(200);
    expect(lateBody.publicationId).toBe(bodies[0]?.publicationId);
    expect(lateBody.manifest.assets).toHaveLength(2);
  });

  it('writes manifest v1 at the default options and v2 with fade, which the player is served', async () => {
    const display = await createDisplay(alice, orgA);
    const image = await readyImage(t, alice);
    const playlistId = await playlistWith(alice, [image.id]);
    const publish = async (): Promise<Record<string, unknown>> => {
      const response = await alice.fetch(`/api/playlists/${playlistId}/publish`, {
        method: 'POST',
        json: { displayId: display.id },
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { manifest: Record<string, unknown> }).manifest;
    };

    const v1 = await publish();
    expect(v1.schemaVersion).toBe(1);
    expect(v1).not.toHaveProperty('transition');

    const put = await alice.fetch(`/api/playlists/${playlistId}`, {
      method: 'PUT',
      json: {
        name: 'P',
        transition: 'fade',
        items: [{ mediaId: image.id, durationMs: 4000, fit: null }],
      },
    });
    expect(put.status).toBe(200);
    const v2 = await publish();
    expect(v2).toMatchObject({
      schemaVersion: 2,
      transition: 'fade',
      shuffle: false,
      rotation: 0,
      workingHours: null,
      timeZone: expect.any(String) as string,
    });

    const player = await pairPlayer(t, alice, display.id);
    const served = await fetch(`${t.url}/player/manifest`, { headers: player.headers });
    expect(served.status).toBe(200);
    expect(((await served.json()) as { manifest: unknown }).manifest).toEqual(v2);
  });

  it('keeps a published snapshot unchanged when the playlist and the display are edited', async () => {
    const display = await createDisplay(alice, orgA);
    const first = await readyImage(t, alice);
    const second = await readyImage(t, alice, { width: 20, height: 40 });
    const { publicationId, playlistId } = await publishImages(alice, display.id, [
      first.id,
      second.id,
    ]);
    const read = (): Promise<unknown> =>
      withOrg(t.pool, orgA.orgId, async (tx) => {
        const { rows } = await tx.query<{ manifest: unknown }>(
          'SELECT manifest FROM publication WHERE id = $1',
          [publicationId],
        );
        return rows[0]?.manifest;
      });
    const before = JSON.stringify(await read());

    await alice.fetch(`/api/playlists/${playlistId}`, {
      method: 'PUT',
      json: { name: 'changed', items: [{ mediaId: second.id, durationMs: 9000, fit: 'cover' }] },
    });
    await alice.fetch(`/api/displays/${display.id}`, {
      method: 'PATCH',
      json: { canvas: { width: 1080, height: 1920 }, defaultFit: 'cover' },
    });
    expect(JSON.stringify(await read())).toBe(before);

    // The database itself refuses: the runtime role has no UPDATE privilege on publications.
    await expect(
      withOrg(t.pool, orgA.orgId, (tx) =>
        tx.query("UPDATE publication SET manifest = '{}'::jsonb WHERE id = $1", [publicationId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('refuses to publish media that is not ready, with a reason per item', async () => {
    const display = await createDisplay(alice, orgA);
    const ready = await readyImage(t, alice);
    const upload = await uploadBytes(alice, await pngBytes());
    const processing = ((await upload.json()) as { media: { id: string } }).media;
    const playlistId = await playlistWith(alice, [ready.id, processing.id]);
    const publish = await alice.fetch(`/api/playlists/${playlistId}/publish`, {
      method: 'POST',
      json: { displayId: display.id },
      headers: { 'idempotency-key': randomUUID() },
    });
    const body = (await publish.json()) as {
      error: { code: string; details: { path: string; code: string }[] };
    };
    expect(publish.status).toBe(422);
    expect(body.error.code).toBe('publication_rejected');
    expect(body.error.details).toEqual([
      expect.objectContaining({ path: 'items[1]', code: 'media_not_ready' }),
    ]);
    expect(await publicationCount(orgA, display.id)).toBe(0);
    // Nothing became "desired" for the display.
    const status = (await (await alice.fetch(`/api/displays/${display.id}/status`)).json()) as {
      desired: unknown;
    };
    expect(status.desired).toBeNull();
  });

  it('gives no access across organisations through any publishing or media route', async () => {
    const displayA = await createDisplay(alice, orgA);
    const imageA = await readyImage(t, alice);
    const playlistA = await playlistWith(alice, [imageA.id]);
    const displayB = await createDisplay(bob, orgB);
    const playlistB = await playlistWith(bob, []);
    const key = (): Record<string, string> => ({ 'idempotency-key': randomUUID() });

    const attempts: [string, Promise<Response>][] = [
      ['read display', bob.fetch(`/api/displays/${displayA.id}`)],
      ['read status', bob.fetch(`/api/displays/${displayA.id}/status`)],
      [
        'patch display',
        bob.fetch(`/api/displays/${displayA.id}`, { method: 'PATCH', json: { name: 'x' } }),
      ],
      [
        'revoke player',
        bob.fetch(`/api/displays/${displayA.id}/revoke-player`, { method: 'POST' }),
      ],
      ['read media', bob.fetch(`/api/media/${imageA.id}`)],
      ['preview media', bob.fetch(`/api/media/${imageA.id}/preview`)],
      ['delete media', bob.fetch(`/api/media/${imageA.id}`, { method: 'DELETE' })],
      ['read playlist', bob.fetch(`/api/playlists/${playlistA}`)],
      [
        'replace playlist',
        bob.fetch(`/api/playlists/${playlistA}`, { method: 'PUT', json: { name: 'x', items: [] } }),
      ],
      [
        'publish foreign playlist to own display',
        bob.fetch(`/api/playlists/${playlistA}/publish`, {
          method: 'POST',
          json: { displayId: displayB.id },
          headers: key(),
        }),
      ],
      [
        'publish own playlist to foreign display',
        bob.fetch(`/api/playlists/${playlistB}/publish`, {
          method: 'POST',
          json: { displayId: displayA.id },
          headers: key(),
        }),
      ],
    ];
    for (const [what, attempt] of attempts) {
      expect((await attempt).status, what).toBe(404);
    }

    // A foreign media id inside an otherwise valid playlist is "missing", not usable.
    const smuggle = await bob.fetch(`/api/playlists/${playlistB}`, {
      method: 'PUT',
      json: { name: 'x', items: [{ mediaId: imageA.id, durationMs: 4000, fit: null }] },
    });
    expect(smuggle.status).toBe(400);
    expect(JSON.stringify(await smuggle.json())).toContain('media_missing');

    // Lists show only the caller's organisation.
    const listed = (await (await bob.fetch('/api/media')).json()) as { items: { id: string }[] };
    expect(listed.items.map((m) => m.id)).not.toContain(imageA.id);
    const audit = (await (await bob.fetch('/api/audit?limit=200')).json()) as {
      items: { objectId: string }[];
    };
    expect(audit.items.map((e) => e.objectId)).not.toContain(imageA.id);

    // And the owner still has everything.
    expect((await alice.fetch(`/api/media/${imageA.id}/preview`)).status).toBe(200);
  });

  it('ignores an organisation id supplied by the client', async () => {
    const display = await createDisplay(alice, orgA);
    // Unknown fields are rejected by the strict schemas, so an org id cannot even be sent.
    const withOrgField = await bob.fetch(`/api/displays/${display.id}`, {
      method: 'PATCH',
      json: { name: 'x', orgId: orgA.orgId },
    });
    expect(withOrgField.status).toBe(400);
    const asQuery = await bob.fetch(`/api/displays?orgId=${orgA.orgId}`);
    const listed = (await asQuery.json()) as { items: { id: string }[] };
    expect(listed.items.map((d) => d.id)).not.toContain(display.id);
  });
});
