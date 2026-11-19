/**
 * Signing in again after a member's sessions were ended (CMS-13; docs/portal-v2/stage-c.md
 * 6.5). A removal, demotion or "sign out everywhere" sets the member's cut-off; a sign-in the
 * identity provider authenticated before it is refused, and the browser is sent back to the
 * provider once with `prompt=login`. A provider that still answers with the old
 * authentication ends at `reauth_failed`, never in a loop.
 *
 * The provider is a fake with a settable `auth_time`, as in credential-audit.test.ts.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { sessionRevokeMembership, withOrg } from '@tinnox/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IdentityProvider } from '../../apps/api/src/auth/oidc.ts';
import {
  addMember,
  arrangeAsDefiner,
  asMigratorIn,
  auditEvents,
  createOrg,
  PORTAL_ORIGIN,
  signIn,
  startTestApp,
  statementHolds,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

const IDP_URL = 'http://localhost:8080/sign-in';

/** One query as the owner of the security functions (bypasses row-level security). */
async function queryAsDefiner<R extends pg.QueryResultRow>(
  text: string,
  values: readonly unknown[],
): Promise<R[]> {
  const client = new pg.Client({ connectionString: process.env['TEST_DATABASE_MIGRATOR_URL'] });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE tinnox_definer');
    const { rows } = await client.query<R>(text, [...values]);
    await client.query('COMMIT');
    return rows;
  } finally {
    await client.end();
  }
}

/** How many sign-ins with no organisation were recorded with `reason` (database administrator only). */
async function unscopedLoginFailures(reason: string): Promise<number> {
  const url = new URL(process.env['TEST_DATABASE_MIGRATOR_URL'] ?? '');
  url.username = 'postgres';
  url.password = encodeURIComponent(process.env['POSTGRES_SUPERUSER_PASSWORD'] ?? '');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.audit_event
       WHERE org_id IS NULL AND action = 'auth.login' AND actor_type = 'anonymous'
         AND result = 'failure' AND detail->>'reason' = $1`,
      [reason],
    );
    return Number(rows[0]?.n ?? 0);
  } finally {
    await client.end();
  }
}

/** The value of a cookie the response sets, or null ('' when it is cleared). */
function setCookie(response: Response, name: string): string | null {
  for (const line of response.headers.getSetCookie()) {
    const [pair = ''] = line.split(';');
    const at = pair.indexOf('=');
    if (pair.slice(0, at) === name) return pair.slice(at + 1);
  }
  return null;
}

describe('signing in again after the sessions were ended', () => {
  const holds = statementHolds();
  let t: TestApp;
  let org: TestOrg;
  let owner: Operator;
  let member: TestOrg;

  /** What the fake provider answers. */
  const idp = {
    sub: '',
    authTime: null as number | null,
    state: '',
    begins: [] as ({ readonly reauthenticate?: boolean } | undefined)[],
  };

  beforeAll(async () => {
    t = await startTestApp({}, 1000, { wrapPool: holds.wrapPool });
    const provider: IdentityProvider = {
      beginLogin: (options) => {
        idp.begins.push(options);
        idp.state = randomUUID();
        return Promise.resolve({
          state: idp.state,
          nonce: randomBytes(32).toString('base64url'),
          codeVerifier: randomBytes(32).toString('base64url'),
          url: `${IDP_URL}?state=${idp.state}`,
        });
      },
      completeLogin: () =>
        Promise.resolve({
          sub: idp.sub,
          acr: null,
          amr: [],
          idToken: null,
          authTime: idp.authTime,
        }),
      endSessionUrl: () => Promise.resolve(null),
      check: () => Promise.resolve(true),
    };
    (t.ctx as { idp: IdentityProvider }).idp = provider;
    org = await createOrg('Re-authentication');
    owner = await signIn(t, org);
    member = await addMember(org);
    idp.sub = member.oidcSub;
  });
  afterAll(async () => {
    await t.close();
  });

  const nowSeconds = (): number => Math.floor(Date.now() / 1000);

  /** GET /api/auth/login: the pre-auth cookie and the state the provider was given. */
  async function startLogin(): Promise<{ preAuth: string; state: string }> {
    const begin = await fetch(`${t.url}/api/auth/login`, { redirect: 'manual' });
    expect(begin.status).toBe(303);
    const preAuth = setCookie(begin, t.config.loginCookieName);
    expect(preAuth).toBeTruthy();
    return { preAuth: preAuth ?? '', state: idp.state };
  }

  /** The provider's redirect back to the callback, with the browser's cookies. */
  function callback(
    login: { preAuth: string; state: string },
    session?: string,
  ): Promise<Response> {
    const cookies = [`${t.config.loginCookieName}=${login.preAuth}`];
    if (session !== undefined) cookies.push(`${t.config.sessionCookieName}=${session}`);
    return fetch(`${t.url}/api/auth/callback?code=test&state=${login.state}`, {
      redirect: 'manual',
      headers: { cookie: cookies.join('; ') },
    });
  }

  async function sessionOf(
    cookie: string,
  ): Promise<{ authenticated: boolean; user?: { role: string } }> {
    const response = await fetch(`${t.url}/api/session`, {
      headers: { cookie: `${t.config.sessionCookieName}=${cookie}` },
    });
    return (await response.json()) as { authenticated: boolean; user?: { role: string } };
  }

  const liveSessions = async (membershipId: string): Promise<number> =>
    Number(
      (
        await queryAsDefiner<{ n: string }>(
          'SELECT count(*) AS n FROM public.session WHERE membership_id = $1 AND revoked_at IS NULL',
          [membershipId],
        )
      )[0]?.n,
    );

  const loginDenials = async (reason: string): Promise<number> =>
    (await auditEvents(owner, '&category=auth')).filter(
      (row) =>
        row.action === 'auth.login' &&
        row.result === 'denied' &&
        row.actorId === member.membershipId &&
        row.objectType === 'membership' &&
        row.detail?.['reason'] === reason,
    ).length;

  let cutOff: Date;
  let firstSession = '';
  let forced: { preAuth: string; state: string };

  it('signs a member in normally', async () => {
    idp.authTime = nowSeconds();
    const response = await callback(await startLogin());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${PORTAL_ORIGIN}/`);
    firstSession = setCookie(response, t.config.sessionCookieName) ?? '';
    expect(firstSession).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const session = await sessionOf(firstSession);
    expect(session).toMatchObject({ authenticated: true, user: { role: 'owner' } });
    expect(idp.begins.at(-1)).toBeUndefined();
  });

  it('sends a sign-in authenticated before the cut-off back to the provider once', async () => {
    // A cut-off on a whole second, so the test knows the boundary exactly.
    cutOff = new Date(nowSeconds() * 1000);
    await arrangeAsDefiner('UPDATE public.membership SET sessions_valid_after = $2 WHERE id = $1', [
      member.membershipId,
      cutOff,
    ]);
    expect(await liveSessions(member.membershipId)).toBe(1);
    idp.authTime = nowSeconds() - 3600;
    const begins = idp.begins.length;

    const response = await callback(await startLogin(), firstSession);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${IDP_URL}?state=${idp.state}`);
    expect(idp.begins).toHaveLength(begins + 2);
    expect(idp.begins.at(-1)).toEqual({ reauthenticate: true });
    // A new pre-auth cookie for the forced sign-in; no session; the old one cleared and revoked.
    const preAuth = setCookie(response, t.config.loginCookieName);
    expect(preAuth).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(setCookie(response, t.config.sessionCookieName)).toBe('');
    expect(await liveSessions(member.membershipId)).toBe(0);
    expect(await loginDenials('reauth_required')).toBe(1);
    forced = { preAuth: preAuth ?? '', state: idp.state };
  });

  it('refuses the forced sign-in when the provider answers with the old authentication', async () => {
    const begins = idp.begins.length;
    const response = await callback(forced);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${PORTAL_ORIGIN}/?authError=reauth_failed`);
    expect(idp.begins).toHaveLength(begins);
    expect(setCookie(response, t.config.sessionCookieName)).toBe('');
    expect(await loginDenials('reauth_failed')).toBe(1);
    expect(await liveSessions(member.membershipId)).toBe(0);
  });

  it('signs the member in once the provider authenticated them after the cut-off', async () => {
    const reauth = await callback(await startLogin());
    expect(reauth.headers.get('location')).toBe(`${IDP_URL}?state=${idp.state}`);
    const login = {
      preAuth: setCookie(reauth, t.config.loginCookieName) ?? '',
      state: idp.state,
    };
    // auth_time has whole seconds: the second of the cut-off itself is still refused.
    idp.authTime = cutOff.getTime() / 1000 + 2;
    const response = await callback(login);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${PORTAL_ORIGIN}/`);
    const cookie = setCookie(response, t.config.sessionCookieName) ?? '';
    expect(await sessionOf(cookie)).toMatchObject({ authenticated: true });
    expect(await liveSessions(member.membershipId)).toBe(1);
  });

  it('asks again when the provider reports no auth_time and a cut-off exists', async () => {
    idp.authTime = null;
    const begins = idp.begins.length;
    const response = await callback(await startLogin());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${IDP_URL}?state=${idp.state}`);
    expect(idp.begins.slice(begins)).toEqual([undefined, { reauthenticate: true }]);
  });

  it('refuses a removed member', async () => {
    const removed = await addMember(org, 'editor');
    await asMigratorIn(org.orgId, (c) =>
      c.query('UPDATE membership SET removed_at = now() WHERE id = $1', [removed.membershipId]),
    );
    const sub = idp.sub;
    idp.sub = removed.oidcSub;
    idp.authTime = nowSeconds();
    try {
      const response = await callback(await startLogin());
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${PORTAL_ORIGIN}/?authError=no_membership`);
      expect(setCookie(response, t.config.sessionCookieName)).toBe('');
    } finally {
      idp.sub = sub;
    }
  });

  it('records a sign-in that waited past lock_timeout for the member row', async () => {
    const locked = await addMember(org, 'editor');
    const sub = idp.sub;
    idp.sub = locked.oidcSub;
    idp.authTime = nowSeconds();
    const before = await unscopedLoginFailures('member_locked');
    // A member change that holds the member row longer than tinnox_app's 5 s lock_timeout.
    const change = new pg.Client({ connectionString: process.env['TEST_DATABASE_MIGRATOR_URL'] });
    await change.connect();
    try {
      const login = await startLogin();
      await change.query('BEGIN');
      await change.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
      await change.query('UPDATE membership SET role = role WHERE id = $1', [locked.membershipId]);
      const response = await callback(login);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(
        `${PORTAL_ORIGIN}/?authError=provider_unavailable`,
      );
      expect(setCookie(response, t.config.sessionCookieName) ?? '').toBe('');
    } finally {
      await change.query('ROLLBACK');
      await change.end();
      idp.sub = sub;
    }
    expect(await unscopedLoginFailures('member_locked')).toBe(before + 1);
    expect(await liveSessions(locked.membershipId)).toBe(0);
  });

  it('locks the member row before the old session, so a revocation meanwhile cannot deadlock', async () => {
    // The member's browser still sends a live session cookie.
    const signedIn = await addMember(org, 'editor');
    const browser = await signIn(t, signedIn);
    const cookie = browser.cookie.slice(browser.cookie.indexOf('=') + 1);
    const sub = idp.sub;
    idp.sub = signedIn.oidcSub;
    idp.authTime = nowSeconds();
    try {
      const login = await startLogin();
      const held = holds.hold((text) => text.includes('sec.session_create('));
      const signingIn = callback(login, cookie);
      await held.reached;
      // "Sign out everywhere" for the member while the sign-in waits.
      const revoking = withOrg(t.ctx.pool, org.orgId, (tx) =>
        sessionRevokeMembership(tx, signedIn.membershipId),
      );
      // With the old order the revocation would now wait for the sign-in's session row lock.
      await Promise.race([revoking, new Promise((resolve) => setTimeout(resolve, 500))]);
      held.release();
      const [response, ended] = await Promise.all([signingIn, revoking]);
      expect(response.status).toBe(303);
      // The revocation committed first: the sign-in authenticated before it is sent back.
      expect(response.headers.get('location')).toBe(`${IDP_URL}?state=${idp.state}`);
      expect(ended).toBe(1);
      expect((await browser.fetch('/api/displays')).status).toBe(401);
    } finally {
      idp.sub = sub;
    }
  });
});
