import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createDisplay,
  createOrg,
  pairPlayer,
  signIn,
  startTestApp,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

interface Pairing {
  pairingId: string;
  code: string;
  pollingToken: string;
}

describe('pairing over HTTP', () => {
  let t: TestApp;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let alice: Operator;
  let bob: Operator;

  beforeAll(async () => {
    t = await startTestApp();
    orgA = await createOrg('Pairing A');
    orgB = await createOrg('Pairing B');
    alice = await signIn(t, orgA);
    bob = await signIn(t, orgB);
  });
  afterAll(async () => {
    await t.close();
  });

  const newPairing = async (): Promise<Pairing> =>
    (await (await fetch(`${t.url}/player/pairing`, { method: 'POST' })).json()) as Pairing;
  const poll = (p: Pairing): Promise<Response> =>
    fetch(`${t.url}/player/pairing/${p.pairingId}`, {
      headers: { authorization: `Bearer ${p.pollingToken}` },
    });

  it('lets exactly one of many concurrent claims of the same code win', async () => {
    const displaysA = await Promise.all(
      [1, 2, 3, 4].map((n) => createDisplay(alice, orgA, `A${n}`)),
    );
    const displaysB = await Promise.all([1, 2, 3, 4].map((n) => createDisplay(bob, orgB, `B${n}`)));
    const pairing = await newPairing();

    // Eight claims at once: four displays of one organisation, four of another.
    const claims = await Promise.all([
      ...displaysA.map((d) =>
        alice.fetch(`/api/displays/${d.id}/claim`, {
          method: 'POST',
          json: { code: pairing.code },
        }),
      ),
      ...displaysB.map((d) =>
        bob.fetch(`/api/displays/${d.id}/claim`, { method: 'POST', json: { code: pairing.code } }),
      ),
    ]);
    const statuses = claims.map((c) => c.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 400)).toHaveLength(7);

    // Exactly one device token is handed out, however many polls race for it.
    const polls = await Promise.all([1, 2, 3, 4, 5, 6].map(() => poll(pairing)));
    const bodies = (await Promise.all(polls.map((p) => p.json()))) as {
      status: string;
      deviceToken?: string;
      orgId?: string;
    }[];
    const claimed = bodies.filter((b) => b.status === 'claimed');
    expect(claimed).toHaveLength(1);
    expect(bodies.filter((b) => b.status === 'consumed')).toHaveLength(5);

    // The registration belongs to the organisation whose claim won, and only there.
    const winner = claims.findIndex((c) => c.status === 200);
    expect(claimed[0]?.orgId).toBe(winner < 4 ? orgA.orgId : orgB.orgId);
    const manifest = await fetch(`${t.url}/player/manifest`, {
      headers: { authorization: `Bearer ${claimed[0]?.deviceToken ?? ''}` },
    });
    expect(manifest.status).toBe(204);
  });

  it('never reveals whether a pairing session exists to a caller without its polling token', async () => {
    const pairing = await newPairing();
    const wrong = await fetch(`${t.url}/player/pairing/${pairing.pairingId}`, {
      headers: { authorization: `Bearer ${'x'.repeat(43)}` },
    });
    const unknown = await fetch(`${t.url}/player/pairing/00000000-0000-4000-8000-000000000000`, {
      headers: { authorization: `Bearer ${pairing.pollingToken}` },
    });
    const none = await fetch(`${t.url}/player/pairing/${pairing.pairingId}`);
    expect([wrong.status, unknown.status, none.status]).toEqual([404, 404, 404]);
    const strip = (text: string): string => text.replace(/"requestId":"[^"]+"/, '');
    expect(strip(await wrong.text())).toBe(strip(await unknown.text()));
  });

  it('locks a pairing session after repeated wrong polling tokens', async () => {
    const pairing = await newPairing();
    for (let i = 0; i < 5; i += 1) {
      await fetch(`${t.url}/player/pairing/${pairing.pairingId}`, {
        headers: { authorization: `Bearer ${String(i).repeat(43)}` },
      });
    }
    // Even the right token is refused now, and the code can no longer be claimed.
    expect((await poll(pairing)).status).toBe(404);
    const display = await createDisplay(alice, orgA, 'locked');
    const claim = await alice.fetch(`/api/displays/${display.id}/claim`, {
      method: 'POST',
      json: { code: pairing.code },
    });
    expect(claim.status).toBe(400);
  });

  it('blocks an operator who keeps guessing codes, without blocking a colleague', async () => {
    const guesser = await signIn(t, await addMember(orgA));
    const display = await createDisplay(alice, orgA, 'guess target');
    const codes = ['22222222', '33333333', '44444444', '55555555', '66666666'];
    for (const code of codes) {
      const response = await guesser.fetch(`/api/displays/${display.id}/claim`, {
        method: 'POST',
        json: { code },
      });
      expect(response.status).toBe(400);
    }
    const pairing = await newPairing();
    const blocked = await guesser.fetch(`/api/displays/${display.id}/claim`, {
      method: 'POST',
      json: { code: pairing.code },
    });
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      'pairing_locked',
    );
    // The real code is still claimable by someone who is not blocked.
    const colleague = await signIn(t, await addMember(orgA));
    const ok = await colleague.fetch(`/api/displays/${display.id}/claim`, {
      method: 'POST',
      json: { code: pairing.code },
    });
    expect(ok.status).toBe(200);
  });

  it("refuses a claim for another organisation's display", async () => {
    const displayB = await createDisplay(bob, orgB, 'B only');
    const pairing = await newPairing();
    const claim = await alice.fetch(`/api/displays/${displayB.id}/claim`, {
      method: 'POST',
      json: { code: pairing.code },
    });
    expect(claim.status).toBe(404);
    // The code was not consumed by the refused attempt.
    expect(((await (await poll(pairing)).json()) as { status: string }).status).toBe('pending');
  });

  it('replaces the previous player of a display and revokes its credential', async () => {
    const display = await createDisplay(alice, orgA, 'replace');
    const first = await pairPlayer(t, alice, display.id);
    const second = await pairPlayer(t, alice, display.id);
    expect((await fetch(`${t.url}/player/manifest`, { headers: first.headers })).status).toBe(401);
    expect((await fetch(`${t.url}/player/manifest`, { headers: second.headers })).status).toBe(204);
  });

  it('lets a player give up its own registration (reset)', async () => {
    const display = await createDisplay(alice, orgA, 'reset');
    const player = await pairPlayer(t, alice, display.id);
    const reset = await fetch(`${t.url}/player/registration`, {
      method: 'DELETE',
      headers: player.headers,
    });
    expect(reset.status).toBe(204);
    expect((await fetch(`${t.url}/player/manifest`, { headers: player.headers })).status).toBe(401);
    const dto = (await (await alice.fetch(`/api/displays/${display.id}`)).json()) as {
      player: unknown;
    };
    expect(dto.player).toBeNull();
  });
});

describe('rate limits at their real values', () => {
  it('answers 429 with the error envelope once a route limit is passed', async () => {
    const t = await startTestApp({}, 1);
    try {
      const org = await createOrg('Rate limit');
      const operator = await signIn(t, org);
      const display = await createDisplay(operator, org);
      const statuses: number[] = [];
      // The claim route allows 20 requests per minute per address.
      for (let i = 0; i < 23; i += 1) {
        const response = await operator.fetch(`/api/displays/${display.id}/claim`, {
          method: 'POST',
          json: { code: 'not a code' },
        });
        statuses.push(response.status);
        if (response.status === 429) {
          const body = (await response.json()) as { error: { code: string } };
          expect(body.error.code).toBe('rate_limited');
          expect(response.headers.get('retry-after')).not.toBeNull();
        }
      }
      expect(statuses.slice(0, 20).every((s) => s === 400)).toBe(true);
      expect(statuses.slice(20).every((s) => s === 429)).toBe(true);
    } finally {
      await t.close();
    }
  });
});
