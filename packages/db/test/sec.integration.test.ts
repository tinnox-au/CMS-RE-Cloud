/**
 * The SECURITY DEFINER functions in schema `sec`, called as the runtime role
 * tinnox_app through the typed wrappers: sessions, login state, pairing
 * (expiry, single use, concurrent claims, attempt limits) and device tokens.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditScoped,
  auditUnscoped,
  deviceByTokenHash,
  heartbeatLogPurge,
  loginStatePut,
  loginStateTake,
  membershipByOidcSub,
  pairingCancelClaims,
  pairingClaim,
  pairingComplete,
  pairingCreate,
  pairingPoll,
  poolAsTx,
  sessionByIdHash,
  sessionCreate,
  sessionPurgeExpired,
  sessionRevoke,
  sha256,
  withOrg,
  withoutOrg,
  type Pool,
  type Tx,
} from '../src/index.ts';
import {
  appPool,
  asDefiner,
  createOrg,
  hash,
  migratorClient,
  pairingCode,
  PG,
  pgCode,
  stillWaiting,
  twoTransactions,
  type TestOrg,
} from './support.ts';

let pool: Pool;
let db: Tx;
let migrator: pg.Client;
let a: TestOrg;
let b: TestOrg;

beforeAll(async () => {
  pool = appPool(8);
  db = poolAsTx(pool);
  migrator = await migratorClient();
  a = await createOrg(migrator, 'Sec A');
  b = await createOrg(migrator, 'Sec B');
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

const limits = { ttlSeconds: 600, maxSessionsPerClient: 10, windowSeconds: 600 };
const claimLimits = { maxFailures: 5, windowSeconds: 600 };

async function newPairing(clientKey = `client-${randomUUID()}`) {
  const pollingTokenHash = hash();
  const code = pairingCode();
  const created = await pairingCreate(db, { code, pollingTokenHash, clientKey, ...limits });
  if (created.outcome !== 'created') throw new Error(`pairing not created: ${created.outcome}`);
  return { code, pollingTokenHash, pairingId: created.pairingId, expiresAt: created.expiresAt };
}
const claim = (org: TestOrg, code: string, displayId = org.displayId) =>
  withOrg(pool, org.orgId, (tx) =>
    pairingClaim(tx, { code, displayId, membershipId: org.membershipId, ...claimLimits }),
  );
const pollOutcome = async (p: { pairingId: string; pollingTokenHash: Buffer }) =>
  (await pairingPoll(db, { ...p, maxWrongAttempts: 5 })).outcome;

/** Adds a second member, an Editor, to an organisation; returns the membership id. */
async function addMember(org: TestOrg): Promise<string> {
  const id = randomUUID();
  await migrator.query('BEGIN');
  await migrator.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
  await migrator.query(
    "INSERT INTO membership (id, org_id, oidc_sub, role) VALUES ($1, $2, $3, 'editor')",
    [id, org.orgId, `sec-test-${id}`],
  );
  await migrator.query('COMMIT');
  return id;
}

describe('function hardening', () => {
  it('every sec function is SECURITY DEFINER, owned by tinnox_definer, with a locked search_path, and not executable by PUBLIC', async () => {
    const { rows } = await migrator.query<{
      proname: string;
      prosecdef: boolean;
      owner: string;
      proconfig: string[] | null;
      public_exec: boolean;
      app_exec: boolean;
    }>(
      `SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
              has_function_privilege('tinnox_app', p.oid, 'EXECUTE') AS app_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'sec' ORDER BY 1`,
    );
    // 14 from migration 0002, two lookups from 0003_api_lookups.sql,
    // heartbeat_log_purge from 0004_review_hardening.sql, pairing_cancel_claims from
    // 0010_pairing_hardening.sql, session_revoke_membership from 0013_roles_and_members.sql, and
    // display_alert_orgs and alert_recipient_by_token_hash from 0014_display_alerts.sql.
    expect(rows.length).toBe(21);
    for (const r of rows) {
      expect(r, r.proname).toMatchObject({
        prosecdef: true,
        owner: 'tinnox_definer',
        proconfig: ['search_path=pg_catalog, pg_temp'],
        public_exec: false,
        app_exec: true,
      });
    }
    const role = await migrator.query<{
      rolcanlogin: boolean;
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>("SELECT rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'tinnox_definer'");
    expect(role.rows[0]).toEqual({ rolcanlogin: false, rolbypassrls: true, rolsuper: false });
  });
});

describe('membership and sessions', () => {
  it('maps an OIDC subject to exactly its organisation', async () => {
    expect(await membershipByOidcSub(db, a.oidcSub)).toEqual({
      membershipId: a.membershipId,
      orgId: a.orgId,
      role: 'owner',
      orgName: 'Sec A',
    });
    expect(await membershipByOidcSub(db, 'unknown-subject')).toBeNull();
    expect(await membershipByOidcSub(db, "' OR 1=1 --")).toBeNull();
  });

  it('stores login state once and returns it once', async () => {
    const stateHash = hash();
    await loginStatePut(db, {
      stateHash,
      codeVerifier: 'v'.repeat(43),
      nonce: 'n'.repeat(22),
      returnTo: '/displays',
      ttlSeconds: 300,
    });
    expect(await loginStateTake(db, stateHash)).toEqual({
      codeVerifier: 'v'.repeat(43),
      nonce: 'n'.repeat(22),
      returnTo: '/displays',
    });
    expect(await loginStateTake(db, stateHash)).toBeNull();
    expect(await loginStateTake(db, hash())).toBeNull();
    expect(
      await pgCode(
        loginStatePut(db, {
          stateHash: hash(),
          codeVerifier: 'v'.repeat(43),
          nonce: 'n'.repeat(22),
          returnTo: null,
          ttlSeconds: 5,
        }),
      ),
    ).toBe('22023');
  });

  it('does not return expired login state', async () => {
    const stateHash = hash();
    await loginStatePut(db, {
      stateHash,
      codeVerifier: 'v'.repeat(43),
      nonce: 'n'.repeat(22),
      returnTo: null,
      ttlSeconds: 30,
    });
    await migrator
      .query(
        "UPDATE login_state SET expires_at = now() - interval '1 second' WHERE state_hash = $1",
        [stateHash],
      )
      .catch(() => undefined);
    // The migrator has no BYPASSRLS, so it cannot touch the row either; expire it as the definer role instead.
    await migrator.query('BEGIN');
    await migrator.query('SET LOCAL ROLE tinnox_definer');
    await migrator.query(
      "UPDATE public.login_state SET expires_at = now() - interval '1 second' WHERE state_hash = $1",
      [stateHash],
    );
    await migrator.query('COMMIT');
    expect(await loginStateTake(db, stateHash)).toBeNull();
  });

  it('creates a session whose organisation comes from the membership only', async () => {
    const idHash = sha256(`cookie-${randomUUID()}`);
    const created = await sessionCreate(db, {
      idHash,
      oidcSub: a.oidcSub,
      csrfToken: 'c'.repeat(43),
      ttlSeconds: 3600,
      idToken: 'header.payload.signature',
      authTime: new Date(),
    });
    expect(created).toMatchObject({
      outcome: 'created',
      membershipId: a.membershipId,
      orgId: a.orgId,
      role: 'owner',
    });
    const found = await sessionByIdHash(db, idHash, 1800);
    expect(found).toMatchObject({
      membershipId: a.membershipId,
      orgId: a.orgId,
      oidcSub: a.oidcSub,
      orgName: 'Sec A',
      csrfToken: 'c'.repeat(43),
      role: 'owner',
    });
    expect(await sessionByIdHash(db, hash(), 1800)).toBeNull();

    const revoked = await sessionRevoke(db, idHash);
    expect(revoked).toEqual({
      membershipId: a.membershipId,
      orgId: a.orgId,
      idToken: 'header.payload.signature',
    });
    expect(await sessionByIdHash(db, idHash, 1800)).toBeNull();
    expect(await sessionRevoke(db, idHash)).toBeNull();
  });

  it('refuses a session for a subject with no membership', async () => {
    const idHash = hash();
    expect(
      await sessionCreate(db, {
        idHash,
        oidcSub: 'no-membership',
        csrfToken: 'c'.repeat(43),
        ttlSeconds: 3600,
        idToken: null,
        authTime: new Date(),
      }),
    ).toEqual({ outcome: 'no_membership' });
    expect(await sessionByIdHash(db, idHash, 1800)).toBeNull();
  });

  it('ends sessions at absolute expiry and after the idle timeout', async () => {
    const asDefiner = async (sql: string, values: unknown[]) => {
      await migrator.query('BEGIN');
      await migrator.query('SET LOCAL ROLE tinnox_definer');
      await migrator.query(sql, values);
      await migrator.query('COMMIT');
    };
    const expired = hash();
    await sessionCreate(db, {
      idHash: expired,
      oidcSub: a.oidcSub,
      csrfToken: 'c'.repeat(43),
      ttlSeconds: 3600,
      idToken: null,
      authTime: new Date(),
    });
    await asDefiner(
      "UPDATE public.session SET expires_at = now() - interval '1 second' WHERE id_hash = $1",
      [expired],
    );
    expect(await sessionByIdHash(db, expired, 1800)).toBeNull();

    const idle = hash();
    await sessionCreate(db, {
      idHash: idle,
      oidcSub: a.oidcSub,
      csrfToken: 'c'.repeat(43),
      ttlSeconds: 3600,
      idToken: null,
      authTime: new Date(),
    });
    await asDefiner(
      "UPDATE public.session SET last_seen_at = now() - interval '31 minutes' WHERE id_hash = $1",
      [idle],
    );
    expect(await sessionByIdHash(db, idle, 1800)).toBeNull();
    expect(await sessionByIdHash(db, idle, 3600)).not.toBeNull();
  });

  it('drops the stored ID token as soon as a session has ended, before the row is purged', async () => {
    const asDefiner = async <R extends object>(sql: string, values: unknown[]): Promise<R[]> => {
      await migrator.query('BEGIN');
      try {
        await migrator.query('SET LOCAL ROLE tinnox_definer');
        const { rows } = await migrator.query<R>(sql, values);
        await migrator.query('COMMIT');
        return rows;
      } catch (error) {
        await migrator.query('ROLLBACK');
        throw error;
      }
    };
    const ended = hash();
    const live = hash();
    for (const idHash of [ended, live]) {
      await sessionCreate(db, {
        idHash,
        oidcSub: a.oidcSub,
        csrfToken: 'c'.repeat(43),
        ttlSeconds: 3600,
        idToken: 'header.payload.signature',
        authTime: new Date(),
      });
    }
    await asDefiner(
      "UPDATE public.session SET expires_at = now() - interval '1 second' WHERE id_hash = $1",
      [ended],
    );
    await sessionPurgeExpired(db);
    const rows = await asDefiner<{ id_hash: Buffer; id_token: string | null }>(
      'SELECT id_hash, id_token FROM public.session WHERE id_hash = ANY($1::bytea[])',
      [[ended, live]],
    );
    const tokenOf = (h: Buffer) => rows.find((r) => r.id_hash.equals(h))?.id_token;
    expect(rows.length).toBe(2);
    expect(tokenOf(ended)).toBeNull();
    expect(tokenOf(live)).toBe('header.payload.signature');
  });

  it('rejects out-of-range lifetimes', async () => {
    expect(
      await pgCode(
        sessionCreate(db, {
          idHash: hash(),
          oidcSub: a.oidcSub,
          csrfToken: 'c'.repeat(43),
          ttlSeconds: 10,
          idToken: null,
          authTime: new Date(),
        }),
      ),
    ).toBe('22023');
    expect(await pgCode(sessionByIdHash(db, hash(), 1))).toBe('22023');
  });
});

describe('pairing', () => {
  it('runs the whole flow and hands the device credential over exactly once', async () => {
    const p = await newPairing();
    expect(
      await pairingPoll(db, {
        pairingId: p.pairingId,
        pollingTokenHash: p.pollingTokenHash,
        maxWrongAttempts: 5,
      }),
    ).toMatchObject({ outcome: 'pending' });
    // Not claimed yet: nothing to collect.
    expect(
      await pairingComplete(db, {
        pairingId: p.pairingId,
        pollingTokenHash: p.pollingTokenHash,
        deviceTokenHash: hash(),
      }),
    ).toEqual({ outcome: 'not_claimable' });

    const claimed = await claim(a, p.code);
    expect(claimed).toMatchObject({
      outcome: 'claimed',
      pairingId: p.pairingId,
      replacedRegistrationId: null,
    });
    expect(
      (
        await pairingPoll(db, {
          pairingId: p.pairingId,
          pollingTokenHash: p.pollingTokenHash,
          maxWrongAttempts: 5,
        })
      ).outcome,
    ).toBe('claimed');

    const deviceTokenHash = sha256(`device-${randomUUID()}`);
    const completed = await pairingComplete(db, {
      pairingId: p.pairingId,
      pollingTokenHash: p.pollingTokenHash,
      deviceTokenHash,
    });
    expect(completed).toMatchObject({
      outcome: 'completed',
      orgId: a.orgId,
      displayId: a.displayId,
    });
    if (completed.outcome !== 'completed') return;

    expect(
      await pairingComplete(db, {
        pairingId: p.pairingId,
        pollingTokenHash: p.pollingTokenHash,
        deviceTokenHash: hash(),
      }),
    ).toEqual({ outcome: 'not_claimable' });
    expect(
      (
        await pairingPoll(db, {
          pairingId: p.pairingId,
          pollingTokenHash: p.pollingTokenHash,
          maxWrongAttempts: 5,
        })
      ).outcome,
    ).toBe('completed');
    expect(await deviceByTokenHash(db, deviceTokenHash)).toEqual({
      registrationId: completed.registrationId,
      orgId: a.orgId,
      displayId: a.displayId,
    });
    expect(await deviceByTokenHash(db, hash())).toBeNull();

    // The code is spent.
    expect(await claim(a, p.code)).toEqual({ outcome: 'invalid_code' });
    expect(await claim(b, p.code)).toEqual({ outcome: 'invalid_code' });
  });

  it('lets exactly one of many concurrent claims win', async () => {
    const p = await newPairing();
    // Twelve different operators (so the per-operator guess throttle plays no part) race for one code.
    const racers: TestOrg[] = [];
    for (let i = 0; i < 12; i += 1) racers.push(await createOrg(migrator, `Racer ${i}`));
    const outcomes = await Promise.all(racers.map((org) => claim(org, p.code)));
    expect(outcomes.filter((o) => o.outcome === 'claimed')).toHaveLength(1);
    expect(outcomes.filter((o) => o.outcome === 'invalid_code')).toHaveLength(11);
    const winner = racers[outcomes.findIndex((o) => o.outcome === 'claimed')];
    const done = await pairingComplete(db, {
      pairingId: p.pairingId,
      pollingTokenHash: p.pollingTokenHash,
      deviceTokenHash: hash(),
    });
    expect(done).toMatchObject({
      outcome: 'completed',
      orgId: winner?.orgId,
      displayId: winner?.displayId,
    });
  });

  it('lets exactly one of many concurrent completions create a registration', async () => {
    const p = await newPairing();
    const b = await createOrg(migrator, 'Complete race');
    expect((await claim(b, p.code)).outcome).toBe('claimed');
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        pairingComplete(db, {
          pairingId: p.pairingId,
          pollingTokenHash: p.pollingTokenHash,
          deviceTokenHash: hash(),
        }),
      ),
    );
    expect(results.filter((r) => r.outcome === 'completed')).toHaveLength(1);
    await withOrg(pool, b.orgId, async (tx) => {
      const active = await tx.query(
        'SELECT 1 FROM player_registration WHERE display_id = $1 AND revoked_at IS NULL',
        [b.displayId],
      );
      expect(active.rowCount).toBe(1);
    });
  });

  it('does not let an expired code be claimed', async () => {
    const a = await createOrg(migrator, 'Expiry');
    const p = await newPairing();
    await migrator.query('BEGIN');
    await migrator.query('SET LOCAL ROLE tinnox_definer');
    await migrator.query(
      "UPDATE public.pairing_session SET expires_at = now() - interval '1 second' WHERE id = $1",
      [p.pairingId],
    );
    await migrator.query('COMMIT');
    expect(await claim(a, p.code)).toEqual({ outcome: 'invalid_code' });
    expect(
      (
        await pairingPoll(db, {
          pairingId: p.pairingId,
          pollingTokenHash: p.pollingTokenHash,
          maxWrongAttempts: 5,
        })
      ).outcome,
    ).toBe('expired');
    expect(
      await pairingComplete(db, {
        pairingId: p.pairingId,
        pollingTokenHash: p.pollingTokenHash,
        deviceTokenHash: hash(),
      }),
    ).toEqual({ outcome: 'not_claimable' });
  });

  it("cannot claim a code for another organisation's display, and the code stays claimable by its rightful user", async () => {
    const p = await newPairing();
    const a = await createOrg(migrator, 'Cross A');
    const b = await createOrg(migrator, 'Cross B');
    expect(await claim(a, p.code, b.displayId)).toEqual({ outcome: 'display_not_found' });
    expect(await claim(a, p.code, randomUUID())).toEqual({ outcome: 'display_not_found' });
    expect((await claim(b, p.code)).outcome).toBe('claimed');
  });

  it("refuses a claim that uses another organisation's membership or no organisation context", async () => {
    const p = await newPairing();
    const foreignMember = withOrg(pool, a.orgId, (tx) =>
      pairingClaim(tx, {
        code: p.code,
        displayId: a.displayId,
        membershipId: b.membershipId,
        ...claimLimits,
      }),
    );
    expect(await pgCode(foreignMember)).toBe(PG.insufficientPrivilege);
    const noContext = withoutOrg(pool, (tx) =>
      pairingClaim(tx, {
        code: p.code,
        displayId: a.displayId,
        membershipId: a.membershipId,
        ...claimLimits,
      }),
    );
    expect(await pgCode(noContext)).toBe(PG.insufficientPrivilege);
  });

  it('a stolen code is useless without the polling token: wrong tokens lock the session', async () => {
    const p = await newPairing();
    const a = await createOrg(migrator, 'Thief target');
    expect((await claim(a, p.code)).outcome).toBe('claimed');
    const thief = hash();
    expect(
      await pairingComplete(db, {
        pairingId: p.pairingId,
        pollingTokenHash: thief,
        deviceTokenHash: hash(),
      }),
    ).toEqual({ outcome: 'not_claimable' });
    for (let i = 0; i < 4; i += 1) {
      expect(
        (
          await pairingPoll(db, {
            pairingId: p.pairingId,
            pollingTokenHash: thief,
            maxWrongAttempts: 5,
          })
        ).outcome,
      ).toBe('wrong_token');
    }
    // The attempt that locks the session says so, once, for its audit event (round 3, SCX-04).
    expect(
      (
        await pairingPoll(db, {
          pairingId: p.pairingId,
          pollingTokenHash: thief,
          maxWrongAttempts: 5,
        })
      ).outcome,
    ).toBe('wrong_token_locked');
    expect(
      (
        await pairingPoll(db, {
          pairingId: p.pairingId,
          pollingTokenHash: thief,
          maxWrongAttempts: 5,
        })
      ).outcome,
    ).toBe('locked');
    // Locked for the rightful player too: it must start a new pairing.
    expect(
      (
        await pairingPoll(db, {
          pairingId: p.pairingId,
          pollingTokenHash: p.pollingTokenHash,
          maxWrongAttempts: 5,
        })
      ).outcome,
    ).toBe('locked');
    expect(
      await pairingComplete(db, {
        pairingId: p.pairingId,
        pollingTokenHash: p.pollingTokenHash,
        deviceTokenHash: hash(),
      }),
    ).toEqual({ outcome: 'not_claimable' });
    expect(
      (
        await pairingPoll(db, {
          pairingId: randomUUID(),
          pollingTokenHash: thief,
          maxWrongAttempts: 5,
        })
      ).outcome,
    ).toBe('not_found');
  });

  it('limits pairing sessions per client within the window', async () => {
    const clientKey = `flood-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 14 }, () =>
        pairingCreate(db, { code: pairingCode(), pollingTokenHash: hash(), clientKey, ...limits }),
      ),
    );
    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(10);
    expect(results.filter((r) => r.outcome === 'rate_limited')).toHaveLength(4);
    expect(
      (
        await pairingCreate(db, {
          code: pairingCode(),
          pollingTokenHash: hash(),
          clientKey: `other-${randomUUID()}`,
          ...limits,
        })
      ).outcome,
    ).toBe('created');
  });

  it('reports a code collision instead of creating an ambiguous code', async () => {
    const p = await newPairing();
    expect(
      await pairingCreate(db, {
        code: p.code,
        pollingTokenHash: hash(),
        clientKey: `c-${randomUUID()}`,
        ...limits,
      }),
    ).toEqual({ outcome: 'code_collision' });
  });

  it('throttles an operator who keeps guessing codes', async () => {
    const guesser = await createOrg(migrator, 'Guesser');
    for (let i = 0; i < 5; i += 1)
      expect(await claim(guesser, pairingCode())).toEqual({ outcome: 'invalid_code' });
    const real = await newPairing();
    expect(await claim(guesser, real.code)).toEqual({ outcome: 'rate_limited' });
    // Another operator is unaffected and the code was not consumed by the throttled attempt.
    const other = await createOrg(migrator, 'Not throttled');
    expect((await claim(other, real.code)).outcome).toBe('claimed');
  });

  it('a new pairing replaces the previous player, whose credential stops resolving', async () => {
    const org = await createOrg(migrator, 'Replace');
    const first = await newPairing();
    await claim(org, first.code);
    const firstToken = hash();
    const one = await pairingComplete(db, {
      pairingId: first.pairingId,
      pollingTokenHash: first.pollingTokenHash,
      deviceTokenHash: firstToken,
    });
    if (one.outcome !== 'completed') throw new Error('expected completed');

    const second = await newPairing();
    expect(await claim(org, second.code)).toMatchObject({
      outcome: 'claimed',
      replacedRegistrationId: one.registrationId,
    });
    expect(await deviceByTokenHash(db, firstToken)).toBeNull();
    const secondToken = hash();
    const two = await pairingComplete(db, {
      pairingId: second.pairingId,
      pollingTokenHash: second.pollingTokenHash,
      deviceTokenHash: secondToken,
    });
    expect(two.outcome).toBe('completed');
    expect((await deviceByTokenHash(db, secondToken))?.displayId).toBe(org.displayId);
  });

  it('a newer claim cancels an older one no player collected: the older one can neither complete nor take the screen back (round 3, SCX-01)', async () => {
    const org = await createOrg(migrator, 'Supersede');
    const older = await newPairing();
    const newer = await newPairing();
    expect(await claim(org, older.code)).toMatchObject({
      outcome: 'claimed',
      cancelledPairingIds: [],
    });
    expect(await claim(org, newer.code)).toMatchObject({
      outcome: 'claimed',
      cancelledPairingIds: [older.pairingId],
    });
    const newerToken = hash();
    expect(
      (
        await pairingComplete(db, {
          pairingId: newer.pairingId,
          pollingTokenHash: newer.pollingTokenHash,
          deviceTokenHash: newerToken,
        })
      ).outcome,
    ).toBe('completed');

    // The older player comes back within its code's lifetime: told to start again.
    expect(await pollOutcome(older)).toBe('expired');
    expect(
      await pairingComplete(db, {
        pairingId: older.pairingId,
        pollingTokenHash: older.pollingTokenHash,
        deviceTokenHash: hash(),
      }),
    ).toEqual({ outcome: 'not_claimable' });
    expect((await deviceByTokenHash(db, newerToken))?.displayId).toBe(org.displayId);
  });

  it('revoking the player cancels claims no player has collected, in its own organisation only (round 3, SCX-01)', async () => {
    const org = await createOrg(migrator, 'Revoke cancels');
    const p = await newPairing();
    expect((await claim(org, p.code)).outcome).toBe('claimed');

    // Another organisation naming this display, or no organisation, cancels nothing.
    expect(await withOrg(pool, b.orgId, (tx) => pairingCancelClaims(tx, org.displayId))).toEqual(
      [],
    );
    expect(await pgCode(withoutOrg(pool, (tx) => pairingCancelClaims(tx, org.displayId)))).toBe(
      PG.insufficientPrivilege,
    );
    expect(await pollOutcome(p)).toBe('claimed');

    expect(await withOrg(pool, org.orgId, (tx) => pairingCancelClaims(tx, org.displayId))).toEqual([
      p.pairingId,
    ]);
    expect(await pollOutcome(p)).toBe('expired');
    expect(
      await pairingComplete(db, {
        pairingId: p.pairingId,
        pollingTokenHash: p.pollingTokenHash,
        deviceTokenHash: hash(),
      }),
    ).toEqual({ outcome: 'not_claimable' });
    expect(await withOrg(pool, org.orgId, (tx) => pairingCancelClaims(tx, org.displayId))).toEqual(
      [],
    );
  });

  it("takes the screen's lock only for the organisation that owns the screen (migration 0012)", async () => {
    const org = await createOrg(migrator, 'Cancel lock');
    const cancel = 'SELECT sec.pairing_cancel_claims($1) AS ids';
    // The second transaction would fail on its lock timeout if it had to wait for the first.
    await twoTransactions(pool, org.orgId, async (stranger, owner) => {
      await stranger.query("SELECT set_config('app.org_id', $1, true)", [b.orgId]);
      expect((await stranger.query(cancel, [org.displayId])).rows).toEqual([{ ids: [] }]);
      expect((await owner.query(cancel, [org.displayId])).rows).toEqual([{ ids: [] }]);
    });
    await twoTransactions(pool, org.orgId, async (owner, stranger) => {
      await stranger.query("SELECT set_config('app.org_id', $1, true)", [b.orgId]);
      expect((await owner.query(cancel, [org.displayId])).rows).toEqual([{ ids: [] }]);
      expect((await stranger.query(cancel, [org.displayId])).rows).toEqual([{ ids: [] }]);
      // Two operators of the owning organisation still take turns.
      const colleague = await pool.connect();
      try {
        await colleague.query('BEGIN');
        await colleague.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
        const late = colleague.query(cancel, [org.displayId]);
        expect(await stillWaiting(late)).toBe(true);
        await owner.query('COMMIT');
        expect((await late).rows).toEqual([{ ids: [] }]);
      } finally {
        await colleague.query('ROLLBACK').catch(() => undefined);
        colleague.release();
      }
    });
  });

  it('completing a pairing never replaces an active registration (round 3, SCX-01)', async () => {
    const org = await createOrg(migrator, 'No displacement');
    const first = await newPairing();
    expect((await claim(org, first.code)).outcome).toBe('claimed');
    const firstToken = hash();
    expect(
      (
        await pairingComplete(db, {
          pairingId: first.pairingId,
          pollingTokenHash: first.pollingTokenHash,
          deviceTokenHash: firstToken,
        })
      ).outcome,
    ).toBe('completed');

    // A claimed session that no later claim cancelled, as one claimed before
    // migration 0010 could be. Its claimer is an active member, so the member check
    // of 0013 passes and the active-registration check is what refuses it.
    const stray = await newPairing();
    await asDefiner(
      migrator,
      `UPDATE public.pairing_session
       SET status = 'claimed', org_id = $2, display_id = $3, claimed_at = now(),
           claimed_by_membership = $4, expires_at = now() + interval '5 minutes'
       WHERE id = $1`,
      [stray.pairingId, org.orgId, org.displayId, org.membershipId],
    );
    expect(
      await pairingComplete(db, {
        pairingId: stray.pairingId,
        pollingTokenHash: stray.pollingTokenHash,
        deviceTokenHash: hash(),
      }),
    ).toEqual({ outcome: 'not_claimable' });
    expect(await pollOutcome(stray)).toBe('expired');
    expect((await deviceByTokenHash(db, firstToken))?.displayId).toBe(org.displayId);
  });

  it('of two claims for one screen at the same time, the later waits and cancels the earlier (round 3, SCX-01)', async () => {
    const org = await createOrg(migrator, 'Claim race');
    const colleague = await addMember(org);
    const p1 = await newPairing();
    const p2 = await newPairing();
    const sql = 'SELECT outcome, cancelled_pairing_ids FROM sec.pairing_claim($1, $2, $3, 5, 600)';
    await twoTransactions(pool, org.orgId, async (first, second) => {
      const one = await first.query(sql, [p1.code, org.displayId, org.membershipId]);
      expect(one.rows[0]).toEqual({ outcome: 'claimed', cancelled_pairing_ids: [] });
      const late = second
        .query(sql, [p2.code, org.displayId, colleague])
        .then((result) => result.rows[0] as unknown);
      expect(await stillWaiting(late)).toBe(true);
      await first.query('COMMIT');
      expect(await late).toEqual({ outcome: 'claimed', cancelled_pairing_ids: [p1.pairingId] });
      await second.query('COMMIT');
    });
    expect(await pollOutcome(p1)).toBe('expired');
    expect(await pollOutcome(p2)).toBe('claimed');
  });

  it("checks and uses an operator's wrong-code budget in one step, also across concurrent claims (round 3, SCX-05)", async () => {
    const guesser = await createOrg(migrator, 'Concurrent guesser');
    for (let i = 0; i < 4; i += 1)
      expect(await claim(guesser, pairingCode())).toEqual({ outcome: 'invalid_code' });
    const real = await newPairing();
    const sql = 'SELECT outcome FROM sec.pairing_claim($1, $2, $3, 5, 600)';
    await twoTransactions(pool, guesser.orgId, async (first, second) => {
      // The fifth wrong code, not committed yet.
      const fifth = await first.query(sql, [
        pairingCode(),
        guesser.displayId,
        guesser.membershipId,
      ]);
      expect(fifth.rows[0]).toEqual({ outcome: 'invalid_code' });
      // The same operator with the right code must wait, then count the fifth failure.
      const late = second
        .query(sql, [real.code, guesser.displayId, guesser.membershipId])
        .then((result) => result.rows[0] as unknown);
      expect(await stillWaiting(late)).toBe(true);
      await first.query('COMMIT');
      expect(await late).toEqual({ outcome: 'rate_limited' });
      await second.query('COMMIT');
    });
    const failures = await asDefiner<{ n: string }>(
      migrator,
      'SELECT count(*) AS n FROM public.pairing_claim_failure WHERE membership_id = $1',
      [guesser.membershipId],
    );
    expect(Number(failures[0]?.n)).toBe(5);
    // The throttled attempt did not use up the code.
    const other = await createOrg(migrator, 'Not throttled either');
    expect((await claim(other, real.code)).outcome).toBe('claimed');
  });
});

describe('device credentials', () => {
  it('stop resolving immediately after revocation, and a revocation cannot be undone', async () => {
    const org = await createOrg(migrator, 'Revoke');
    const p = await newPairing();
    await claim(org, p.code);
    const token = hash();
    const done = await pairingComplete(db, {
      pairingId: p.pairingId,
      pollingTokenHash: p.pollingTokenHash,
      deviceTokenHash: token,
    });
    if (done.outcome !== 'completed') throw new Error('expected completed');
    expect(await deviceByTokenHash(db, token)).not.toBeNull();

    // Another organisation cannot revoke it.
    const foreign = await withOrg(pool, a.orgId, (tx) =>
      tx.query(
        "UPDATE player_registration SET revoked_at = now(), revoked_reason = 'operator' WHERE id = $1",
        [done.registrationId],
      ),
    );
    expect(foreign.rowCount).toBe(0);
    expect(await deviceByTokenHash(db, token)).not.toBeNull();

    const own = await withOrg(pool, org.orgId, (tx) =>
      tx.query(
        "UPDATE player_registration SET revoked_at = now(), revoked_reason = 'operator' WHERE id = $1 AND revoked_at IS NULL",
        [done.registrationId],
      ),
    );
    expect(own.rowCount).toBe(1);
    expect(await deviceByTokenHash(db, token)).toBeNull();

    const undo = withOrg(pool, org.orgId, (tx) =>
      tx.query(
        'UPDATE player_registration SET revoked_at = NULL, revoked_reason = NULL WHERE id = $1',
        [done.registrationId],
      ),
    );
    expect(await pgCode(undo)).toBe(PG.restrict);
    expect(await deviceByTokenHash(db, token)).toBeNull();
  });

  it('stores only a 32-byte hash and rejects duplicates', async () => {
    const org = await createOrg(migrator, 'Hash');
    const p = await newPairing();
    await claim(org, p.code);
    expect(
      await pgCode(
        pairingComplete(db, {
          pairingId: p.pairingId,
          pollingTokenHash: p.pollingTokenHash,
          deviceTokenHash: Buffer.from('short'),
        }),
      ),
    ).toBe(PG.check);
    // The failed attempt rolled back; the session is still collectable.
    expect(
      (
        await pairingComplete(db, {
          pairingId: p.pairingId,
          pollingTokenHash: p.pollingTokenHash,
          deviceTokenHash: hash(),
        })
      ).outcome,
    ).toBe('completed');
  });
});

describe('audit helpers', () => {
  it('writes scoped events to the current organisation and unscoped events where no organisation can read them', async () => {
    const marker = `obj-${randomUUID()}`;
    await withOrg(pool, a.orgId, (tx) =>
      auditScoped(tx, {
        actorType: 'operator',
        actorId: a.membershipId,
        action: 'pairing.claim',
        objectType: 'display',
        objectId: marker,
        result: 'success',
        detail: { via: 'test' },
      }),
    );
    await auditUnscoped(db, {
      actorType: 'anonymous',
      actorId: null,
      action: 'auth.login',
      objectType: null,
      objectId: marker,
      result: 'denied',
      detail: { reason: 'no_membership' },
    });

    const seenByA = await withOrg(pool, a.orgId, (tx) =>
      tx.query<{ action: string; org_id: string }>(
        'SELECT action, org_id FROM audit_event WHERE object_id = $1',
        [marker],
      ),
    );
    expect(seenByA.rows).toEqual([{ action: 'pairing.claim', org_id: a.orgId }]);
    const seenByB = await withOrg(pool, b.orgId, (tx) =>
      tx.query('SELECT 1 FROM audit_event WHERE object_id = $1', [marker]),
    );
    expect(seenByB.rowCount).toBe(0);
    expect(
      await pgCode(
        auditUnscoped(db, {
          actorType: 'operator',
          actorId: null,
          action: 'Not An Action',
          objectType: null,
          objectId: null,
          result: 'success',
          detail: null,
        }),
      ),
    ).toBe(PG.check);
  });
});

describe('heartbeat history retention', () => {
  it('purges by age in every organisation and refuses a retention under one hour', async () => {
    expect(await pgCode(heartbeatLogPurge(db, 60))).toBe('22023');
    expect(await pgCode(heartbeatLogPurge(db, -1))).toBe('22023');
    expect(await heartbeatLogPurge(db, 3600)).toBeGreaterThanOrEqual(0);
  });
});
