/**
 * Brief section 8 items 3 and 11 (server side): pairing codes expire, work once and have
 * attempt limits; a revoked or reset credential gets no manifest, no URLs, no media and
 * no report accepted; a player moved to another organisation gets nothing of the first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  arrangeAsDefiner,
  createDisplay,
  createOrg,
  heartbeatBody,
  newPairing,
  pairPlayer,
  pollPairing,
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

describe('pairing codes and device credentials', () => {
  let t: TestApp;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let alice: Operator;
  let bob: Operator;

  beforeAll(async () => {
    t = await startTestApp();
    orgA = await createOrg('Credentials A');
    orgB = await createOrg('Credentials B');
    alice = await signIn(t, orgA);
    bob = await signIn(t, orgB);
  });
  afterAll(async () => {
    await t.close();
  });

  const claim = (operator: Operator, displayId: string, code: string): Promise<Response> =>
    operator.fetch(`/api/displays/${displayId}/claim`, { method: 'POST', json: { code } });

  it('issues unguessable, short-lived codes and keeps the polling token out of the claim path', async () => {
    const pairings = await Promise.all(Array.from({ length: 20 }, () => newPairing(t)));
    const codes = new Set(pairings.map((pairing) => pairing.code));
    expect(codes.size).toBe(20);
    for (const pairing of pairings) {
      expect(pairing.code).toMatch(/^[2-9A-HJKMNP-TV-Z]{8}$/);
      expect(pairing.pollingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const lifetimeMs = Date.parse(pairing.expiresAt) - Date.now();
      expect(lifetimeMs).toBeGreaterThan(9 * 60 * 1000);
      expect(lifetimeMs).toBeLessThanOrEqual(10 * 60 * 1000 + 5000);
    }
    // Claiming needs an operator session.
    const display = await createDisplay(alice, orgA);
    const anonymous = await fetch(`${t.url}/api/displays/${display.id}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ code: pairings[0]?.code }),
    });
    expect(anonymous.status).toBe(401);
    // The operator's answer never contains the device credential or the polling token.
    const claimed = await claim(alice, display.id, pairings[0]?.code ?? '');
    expect(claimed.status).toBe(200);
    const text = await claimed.text();
    expect(text).not.toContain(pairings[0]?.pollingToken ?? 'missing');
    expect(text).not.toMatch(/deviceToken|token/i);
  });

  it('refuses an expired code, and tells the player its session expired', async () => {
    const display = await createDisplay(alice, orgA);
    const pairing = await newPairing(t);
    await arrangeAsDefiner(
      "UPDATE public.pairing_session SET expires_at = now() - interval '1 second' WHERE id = $1",
      [pairing.pairingId],
    );
    const late = await claim(alice, display.id, pairing.code);
    expect(late.status).toBeGreaterThanOrEqual(400);
    expect(late.status).toBeLessThan(500);
    const poll = await pollPairing(t, pairing);
    expect(((await poll.json()) as { status: string }).status).toBe('expired');
    const after = (await (await alice.fetch(`/api/displays/${display.id}`)).json()) as {
      player: unknown;
    };
    expect(after.player).toBeNull();
  });

  it('accepts a code once: a second claim fails and the credential is handed over exactly once', async () => {
    const first = await createDisplay(alice, orgA, 'First');
    const second = await createDisplay(alice, orgA, 'Second');
    const pairing = await newPairing(t);
    expect(((await (await pollPairing(t, pairing)).json()) as { status: string }).status).toBe(
      'pending',
    );

    expect((await claim(alice, first.id, pairing.code)).status).toBe(200);
    for (const [operator, displayId] of [
      [alice, first.id],
      [alice, second.id],
    ] as const) {
      const again = await claim(operator, displayId, pairing.code);
      expect(again.status).toBeGreaterThanOrEqual(400);
      expect(again.status).toBeLessThan(500);
    }
    const otherOrgDisplay = await createDisplay(bob, orgB);
    expect((await claim(bob, otherOrgDisplay.id, pairing.code)).status).toBeGreaterThanOrEqual(400);

    // Ten polls at once: one receives the credential, none of the others does.
    const polls = await Promise.all(Array.from({ length: 10 }, () => pollPairing(t, pairing)));
    const bodies = (await Promise.all(polls.map((poll) => poll.json()))) as {
      status: string;
      deviceToken?: string;
    }[];
    const withToken = bodies.filter((body) => typeof body.deviceToken === 'string');
    expect(withToken).toHaveLength(1);
    expect(withToken[0]?.status).toBe('claimed');
    for (const body of bodies) {
      if (body.deviceToken === undefined) expect(['consumed', 'claimed']).toContain(body.status);
    }
    const later = (await (await pollPairing(t, pairing)).json()) as {
      status: string;
      deviceToken?: string;
    };
    expect(later.status).toBe('consumed');
    expect(later.deviceToken).toBeUndefined();

    // The credential works for the first display only.
    const token = withToken[0]?.deviceToken ?? '';
    const manifest = await fetch(`${t.url}/player/manifest`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect([200, 204]).toContain(manifest.status);
    const secondDisplay = (await (await alice.fetch(`/api/displays/${second.id}`)).json()) as {
      player: unknown;
    };
    expect(secondDisplay.player).toBeNull();
  });

  it('stops guessing: five wrong codes block the operator, five wrong polling tokens lock the session', async () => {
    const guesser = await createOrg('Credentials guesser');
    const mallory = await signIn(t, guesser);
    const display = await createDisplay(mallory, guesser);
    const real = await newPairing(t);
    const wrongCodes = ['22222222', '33333333', '44444444', '55555555', '66666666'].filter(
      (code) => code !== real.code,
    );
    for (const code of wrongCodes) {
      const response = await claim(mallory, display.id, code);
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    // Now even the right code is refused for this operator.
    const blocked = await claim(mallory, display.id, real.code);
    expect(blocked.status).toBe(429);
    // The code itself was not burnt: another operator can still use it.
    const mine = await createDisplay(alice, orgA);
    expect((await claim(alice, mine.id, real.code)).status).toBe(200);

    const session = await newPairing(t);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await fetch(`${t.url}/player/pairing/${session.pairingId}`, {
        headers: { authorization: `Bearer ${'A'.repeat(42)}${attempt}` },
      });
      expect(wrong.status).toBe(404);
    }
    // Locked: the genuine token gets the same answer as a stranger, and the code is dead.
    expect((await pollPairing(t, session)).status).toBe(404);
    const dead = await createDisplay(alice, orgA);
    expect((await claim(alice, dead.id, session.code)).status).toBeGreaterThanOrEqual(400);
  });

  async function playing(
    operator: Operator,
    org: TestOrg,
  ): Promise<{
    displayId: string;
    mediaId: string;
    publicationId: string;
    player: PairedPlayer;
    mediaUrl: string;
  }> {
    const display = await createDisplay(operator, org);
    const media = await readyImage(t, operator);
    const { publicationId } = await publishImages(operator, display.id, [media.id]);
    const player = await pairPlayer(t, operator, display.id);
    const issued = (await (
      await requestMediaUrls(t, player, publicationId, [media.id])
    ).json()) as {
      urls: { url: string }[];
    };
    const url = new URL(issued.urls[0]?.url ?? '');
    return {
      displayId: display.id,
      mediaId: media.id,
      publicationId,
      player,
      mediaUrl: `${t.url}${url.pathname}${url.search}`,
    };
  }

  async function expectNoAccess(setup: Awaited<ReturnType<typeof playing>>): Promise<void> {
    const { player, displayId, publicationId, mediaId, mediaUrl } = setup;
    const manifest = await fetch(`${t.url}/player/manifest`, { headers: player.headers });
    expect(manifest.status).toBe(401);
    expect(((await manifest.json()) as { error: { code: string } }).error.code).toBe(
      'device_revoked',
    );
    expect((await requestMediaUrls(t, player, publicationId, [mediaId])).status).toBe(401);
    expect((await sendHeartbeat(t, player, heartbeatBody(displayId, Date.now()))).status).toBe(401);
    // A signed URL issued before revocation, still inside its lifetime, is dead too.
    const media = await fetch(mediaUrl);
    expect(media.status).toBeGreaterThanOrEqual(400);
    expect((await media.text()).length).toBeLessThan(600);
  }

  it('cuts off a revoked player at once: no manifest, no URLs, no media, no reports', async () => {
    const setup = await playing(alice, orgA);
    expect(
      (await fetch(`${t.url}/player/manifest`, { headers: setup.player.headers })).status,
    ).toBe(200);
    expect((await fetch(setup.mediaUrl)).status).toBe(200);
    expect((await sendHeartbeat(t, setup.player, heartbeatBody(setup.displayId, 5))).status).toBe(
      200,
    );

    const revoke = await alice.fetch(`/api/displays/${setup.displayId}/revoke-player`, {
      method: 'POST',
    });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toEqual({
      revokedRegistrationId: setup.player.registrationId,
      cancelledPairingCount: 0,
    });
    await expectNoAccess(setup);

    const status = (await (
      await alice.fetch(`/api/displays/${setup.displayId}/status`)
    ).json()) as {
      paired: boolean;
      summary: string;
    };
    expect(status.paired).toBe(false);
    expect(status.summary).toBe('unpaired');
    // Revoking again is harmless and says so.
    const again = await alice.fetch(`/api/displays/${setup.displayId}/revoke-player`, {
      method: 'POST',
    });
    expect(
      ((await again.json()) as { revokedRegistrationId: null }).revokedRegistrationId,
    ).toBeNull();
    const audit = (await (await alice.fetch('/api/audit?limit=200')).json()) as {
      items: { action: string; objectId: string | null }[];
    };
    expect(audit.items.some((event) => event.action === 'player.revoke')).toBe(true);
  });

  it('an older claim no player collected cannot take the screen back after a replacement or a revocation (round 3, SCX-01)', async () => {
    const display = await createDisplay(alice, orgA, 'Supersede screen');
    const manifestStatus = async (player: PairedPlayer) =>
      (await fetch(`${t.url}/player/manifest`, { headers: player.headers })).status;
    type AuditItem = {
      action: string;
      objectId: string | null;
      detail: Record<string, unknown> | null;
    };
    const auditItems = async () =>
      ((await (await alice.fetch('/api/audit?limit=200')).json()) as { items: AuditItem[] }).items;

    // Replacement: a code is claimed but its player does not collect; another player is paired.
    const older = await newPairing(t);
    expect((await claim(alice, display.id, older.code)).status).toBe(200);
    const current = await pairPlayer(t, alice, display.id);
    // The first player comes back within its code's lifetime: it is told to start again,
    // and the current player keeps the screen.
    const late = await pollPairing(t, older);
    expect(late.status).toBe(200);
    expect(await late.json()).toEqual({ status: 'expired' });
    expect(await manifestStatus(current)).not.toBe(401);

    // Revocation: a claim the player has not collected is cancelled by revoking.
    const dormant = await newPairing(t);
    expect((await claim(alice, display.id, dormant.code)).status).toBe(200);
    expect(await manifestStatus(current)).toBe(401); // replaced by the claim, as before
    const revoke = await alice.fetch(`/api/displays/${display.id}/revoke-player`, {
      method: 'POST',
    });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toEqual({ revokedRegistrationId: null, cancelledPairingCount: 1 });
    const afterRevoke = await pollPairing(t, dormant);
    expect(afterRevoke.status).toBe(200);
    expect(await afterRevoke.json()).toEqual({ status: 'expired' });
    const statusAfter = (await (
      await alice.fetch(`/api/displays/${display.id}/status`)
    ).json()) as {
      paired: boolean;
    };
    expect(statusAfter.paired).toBe(false);

    // Both cancellations are in the audit trail, with the operator's action that caused them.
    const items = await auditItems();
    const claims = items.filter(
      (item) => item.action === 'pairing.claim' && item.objectId === display.id,
    );
    expect(claims.map((item) => item.detail?.['cancelledPairingIds'])).toContainEqual([
      older.pairingId,
    ]);
    const revocation = items.find(
      (item) =>
        item.action === 'player.revoke' &&
        item.detail?.['reason'] === 'operator' &&
        item.detail['displayId'] === display.id,
    );
    expect(revocation?.detail?.['cancelledPairingIds']).toEqual([dormant.pairingId]);
  });

  it('a player that is reset and paired with another organisation gets nothing of the first', async () => {
    const inA = await playing(alice, orgA);
    // Local reset: the player gives its registration back.
    const reset = await fetch(`${t.url}/player/registration`, {
      method: 'DELETE',
      headers: inA.player.headers,
    });
    expect(reset.status).toBe(204);
    await expectNoAccess(inA);

    // The same device now pairs with organisation B.
    const displayB = await createDisplay(bob, orgB);
    const mediaB = await readyImage(t, bob);
    const publishedB = await publishImages(bob, displayB.id, [mediaB.id]);
    const inB = await pairPlayer(t, bob, displayB.id);
    expect(inB.deviceToken).not.toBe(inA.player.deviceToken);
    expect(inB.registrationId).not.toBe(inA.player.registrationId);

    const manifest = (await (
      await fetch(`${t.url}/player/manifest`, { headers: inB.headers })
    ).json()) as {
      manifest: { publicationId: string; assets: { assetId: string }[] };
    };
    expect(manifest.manifest.publicationId).toBe(publishedB.publicationId);
    expect(manifest.manifest.assets.map((asset) => asset.assetId)).toEqual([mediaB.id]);
    // With its new credential it still cannot reach what it used to play.
    expect((await requestMediaUrls(t, inB, inA.publicationId, [inA.mediaId])).status).toBe(404);
    expect((await requestMediaUrls(t, inB, publishedB.publicationId, [inA.mediaId])).status).toBe(
      404,
    );
    const replayed = new URL(inA.mediaUrl);
    replayed.searchParams.set('reg', inB.registrationId);
    expect((await fetch(replayed)).status).toBe(403);
    // Organisation A sees its display as unpaired; B's operator cannot see A's display at all.
    const statusA = (await (await alice.fetch(`/api/displays/${inA.displayId}/status`)).json()) as {
      paired: boolean;
    };
    expect(statusA.paired).toBe(false);
    expect((await bob.fetch(`/api/displays/${inA.displayId}/status`)).status).toBe(404);
  });

  it('shows status from telemetry only: awaiting, in sync, stale, and never in sync without a report', async () => {
    const display = await createDisplay(alice, orgA);
    const media = await readyImage(t, alice);
    const status = async (): Promise<{
      summary: string;
      stale: boolean;
      paired: boolean;
      lastHeartbeatAt: string | null;
      desired: { publicationId: string } | null;
      downloaded: { publicationId: string } | null;
      active: { publicationId: string; itemIndex: number } | null;
    }> => (await (await alice.fetch(`/api/displays/${display.id}/status`)).json()) as never;

    expect((await status()).summary).toBe('unpaired');
    const { publicationId } = await publishImages(alice, display.id, [media.id]);
    // Published but nobody is paired: desired is set, nothing is claimed about playback.
    let view = await status();
    expect(view.desired?.publicationId).toBe(publicationId);
    expect(view.active).toBeNull();
    expect(view.downloaded).toBeNull();
    expect(view.summary).toBe('unpaired');

    const player = await pairPlayer(t, alice, display.id);
    view = await status();
    expect(view.summary).toBe('awaiting_player');
    expect(view.stale).toBe(true);
    expect(view.lastHeartbeatAt).toBeNull();

    // Reporting, but the push is not downloaded yet: updating, not "in sync".
    await sendHeartbeat(t, player, heartbeatBody(display.id, 1));
    view = await status();
    expect(view.downloaded).toBeNull();
    expect(view.summary).toBe('updating');

    // Downloaded, idle and showing nothing: standing by (stage B; also briefly true before
    // the first item is shown, see the shortcut in delivery-state.ts).
    await sendHeartbeat(
      t,
      player,
      heartbeatBody(display.id, 2, { downloadedPublicationId: publicationId }),
    );
    view = await status();
    expect(view.downloaded?.publicationId).toBe(publicationId);
    expect(view.active).toBeNull();
    expect(view.summary).toBe('standing_by');

    await sendHeartbeat(
      t,
      player,
      heartbeatBody(display.id, 3, {
        downloadedPublicationId: publicationId,
        activePublicationId: publicationId,
        activeItemIndex: 0,
        playerState: 'playing',
      }),
    );
    view = await status();
    expect(view.summary).toBe('in_sync');
    expect(view.stale).toBe(false);

    // A delayed copy of the first report arrives late: ignored, state unchanged.
    const delayed = await sendHeartbeat(
      t,
      player,
      heartbeatBody(display.id, 1, { downloadedPublicationId: publicationId }),
    );
    expect(await delayed.json()).toMatchObject({ accepted: false, ignoredReason: 'stale_seq' });
    expect((await status()).summary).toBe('in_sync');

    // No reports for longer than the threshold: stale, whatever the last report said.
    t.advanceClock((t.config.limits.heartbeatStaleAfterSeconds + 1) * 1000);
    view = await status();
    expect(view.stale).toBe(true);
    expect(view.summary).toBe('stale');
    expect(view.active?.publicationId).toBe(publicationId);
  });
});
