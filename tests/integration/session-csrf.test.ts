/**
 * Cookie-session boundary: unauthenticated access, CSRF token, Origin allowlist,
 * session expiry and sign-out, and the CORS rules of the two route groups.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX, ROUTES } from '@tinnox/contracts';
import {
  arrangeAsDefiner,
  createDisplay,
  createOrg,
  PLAYER_ORIGIN,
  PORTAL_ORIGIN,
  signIn,
  startTestApp,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

describe('operator session, CSRF and origin checks', () => {
  let t: TestApp;
  let org: TestOrg;
  let operator: Operator;
  let displayId: string;

  beforeAll(async () => {
    t = await startTestApp();
    org = await createOrg('Session checks');
    operator = await signIn(t, org);
    displayId = (await createDisplay(operator, org)).id;
  });
  afterAll(async () => {
    await t.close();
  });

  const id = randomUUID();
  /**
   * Every route of the operator API, as registered (`:id` is a UUID). The test
   * below fails when the application serves an operator route that is not listed
   * here, so a new route cannot skip the session, CSRF and Origin checks unnoticed.
   */
  const OPERATOR_ROUTE_PATTERNS: [string, string][] = [
    ['GET', '/api/sites'],
    ['GET', '/api/displays'],
    ['POST', '/api/displays'],
    ['GET', '/api/displays/status'],
    ['GET', '/api/displays/:id'],
    ['PATCH', '/api/displays/:id'],
    ['POST', '/api/displays/:id/claim'],
    ['POST', '/api/displays/:id/revoke-player'],
    ['GET', '/api/displays/:id/status'],
    ['GET', '/api/media'],
    ['POST', '/api/media'],
    ['GET', '/api/media/:id'],
    ['PATCH', '/api/media/:id'],
    ['DELETE', '/api/media/:id'],
    ['GET', '/api/media/:id/preview'],
    ['GET', '/api/media/:id/thumbnail'],
    ['GET', '/api/media/:id/usage'],
    ['GET', '/api/apps'],
    ['POST', '/api/apps'],
    ['GET', '/api/apps/:id'],
    ['PATCH', '/api/apps/:id'],
    ['DELETE', '/api/apps/:id'],
    ['GET', '/api/schedules'],
    ['POST', '/api/schedules'],
    ['GET', '/api/schedules/:id'],
    ['PUT', '/api/schedules/:id'],
    ['DELETE', '/api/schedules/:id'],
    ['GET', '/api/layouts'],
    ['POST', '/api/layouts'],
    ['GET', '/api/layouts/:id'],
    ['PUT', '/api/layouts/:id'],
    ['DELETE', '/api/layouts/:id'],
    ['GET', '/api/tags'],
    ['POST', '/api/tags'],
    ['PATCH', '/api/tags/:id'],
    ['DELETE', '/api/tags/:id'],
    ['GET', '/api/folders'],
    ['POST', '/api/folders'],
    ['PATCH', '/api/folders/:id'],
    ['DELETE', '/api/folders/:id'],
    ['GET', '/api/playlists'],
    ['POST', '/api/playlists'],
    ['GET', '/api/playlists/:id'],
    ['PUT', '/api/playlists/:id'],
    ['DELETE', '/api/playlists/:id'],
    ['POST', '/api/playlists/:id/duplicate'],
    ['POST', '/api/playlists/:id/publish'],
    ['GET', '/api/push'],
    ['POST', '/api/push'],
    ['GET', '/api/overview'],
    ['GET', '/api/audit'],
  ];
  const OPERATOR_ROUTES: [string, string][] = OPERATOR_ROUTE_PATTERNS.map(([method, pattern]) => [
    method,
    pattern.replace(':id', id),
  ]);
  const STATE_CHANGING_ROUTES = OPERATOR_ROUTES.filter(([method]) => method !== 'GET');
  /** Routes under /api that deliberately work without an operator session. */
  const PUBLIC_API_ROUTES: [string, string][] = [
    ['GET', ROUTES.authLogin],
    ['GET', ROUTES.authCallback],
    ['GET', ROUTES.session],
  ];
  /** Signing out needs the session, the token and the Origin, but is not in the operator plugin. */
  const LOGOUT: [string, string] = ['POST', ROUTES.authLogout];

  it('lists every /api route the application serves', () => {
    const listed = new Set(
      [...OPERATOR_ROUTE_PATTERNS, ...PUBLIC_API_ROUTES, LOGOUT].map(
        ([method, pattern]) => `${method} ${pattern}`,
      ),
    );
    // Every path the contracts know, under every method: what the application answers to.
    const patterns = new Set<string>();
    for (const value of Object.values(ROUTES) as unknown[]) {
      if (typeof value === 'string' && value.startsWith(`${API_PREFIX}/`)) patterns.add(value);
    }
    expect(patterns.size).toBeGreaterThan(20);
    const served: string[] = [];
    for (const url of patterns) {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        if (t.app.hasRoute({ method, url })) served.push(`${method} ${url}`);
      }
    }
    expect(served.filter((route) => !listed.has(route))).toEqual([]);
    // And nothing is listed that the application does not serve.
    expect([...listed].filter((route) => !served.includes(route))).toEqual([]);
  });

  it('refuses every operator route without a session, with or without a made-up cookie', async () => {
    for (const [method, path] of OPERATOR_ROUTES) {
      for (const cookie of [
        undefined,
        `tinnox_session=${randomBytes(32).toString('base64url')}`,
        'tinnox_session=x',
      ]) {
        const response = await fetch(`${t.url}${path}`, {
          method,
          headers: {
            origin: PORTAL_ORIGIN,
            'x-csrf-token': randomBytes(32).toString('base64url'),
            ...(cookie === undefined ? {} : { cookie }),
          },
        });
        expect(response.status, `${method} ${path}`).toBe(401);
        const body = (await response.json()) as { error: { code: string } };
        expect(body.error.code).toBe('unauthenticated');
      }
    }
    const session = await fetch(`${t.url}/api/session`);
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ authenticated: false });
  });

  it('refuses a device credential on operator routes and a session cookie on player routes', async () => {
    const asBearer = await fetch(`${t.url}/api/displays`, {
      headers: { authorization: `Bearer ${randomBytes(32).toString('base64url')}` },
    });
    expect(asBearer.status).toBe(401);
    const asCookie = await fetch(`${t.url}/player/manifest`, {
      headers: { cookie: operator.cookie },
    });
    expect(asCookie.status).toBe(401);
  });

  it('requires the CSRF token of this session on every state-changing request', async () => {
    const other = await signIn(t, org);
    const body = JSON.stringify({ name: 'Renamed without token' });
    const base = {
      cookie: operator.cookie,
      origin: PORTAL_ORIGIN,
      'content-type': 'application/json',
    };
    const cases: [string, Record<string, string>][] = [
      ['no token', {}],
      ['empty token', { 'x-csrf-token': '' }],
      ['random token', { 'x-csrf-token': randomBytes(32).toString('base64url') }],
      ['token of another session of the same user', { 'x-csrf-token': other.csrfToken }],
    ];
    for (const [what, extra] of cases) {
      const response = await fetch(`${t.url}/api/displays/${displayId}`, {
        method: 'PATCH',
        headers: { ...base, ...extra },
        body,
      });
      expect(response.status, what).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'csrf_failed',
      );
    }
    // A token in the query string or the body is not accepted in place of the header.
    const inQuery = await fetch(
      `${t.url}/api/displays/${displayId}?x-csrf-token=${operator.csrfToken}`,
      {
        method: 'PATCH',
        headers: base,
        body,
      },
    );
    expect(inQuery.status).toBe(403);
    const display = (await (await operator.fetch(`/api/displays/${displayId}`)).json()) as {
      name: string;
    };
    expect(display.name).toBe('Test display');
  });

  it('requires the exact portal Origin on every state-changing request, even with a valid token', async () => {
    const send = (headers: Record<string, string>): Promise<Response> =>
      fetch(`${t.url}/api/displays/${displayId}`, {
        method: 'PATCH',
        headers: {
          cookie: operator.cookie,
          'x-csrf-token': operator.csrfToken,
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ name: 'Renamed from elsewhere' }),
      });
    const refused: [string, Record<string, string>][] = [
      ['no Origin', {}],
      ['the player origin', { origin: PLAYER_ORIGIN }],
      ['another site', { origin: 'https://attacker.example' }],
      ['same host, other port', { origin: 'http://localhost:5175' }],
      ['same host, other scheme', { origin: 'https://localhost:5173' }],
      ['look-alike host', { origin: 'http://localhost:5173.attacker.example' }],
      ['null', { origin: 'null' }],
      [
        'right Origin but a cross-site fetch',
        { origin: PORTAL_ORIGIN, 'sec-fetch-site': 'cross-site' },
      ],
    ];
    for (const [what, headers] of refused) {
      const response = await send(headers);
      expect(response.status, what).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'origin_not_allowed',
      );
    }
    const display = (await (await operator.fetch(`/api/displays/${displayId}`)).json()) as {
      name: string;
    };
    expect(display.name).toBe('Test display');
    // The same request from the portal, with its token, works.
    expect((await send({ origin: PORTAL_ORIGIN, 'sec-fetch-site': 'same-origin' })).status).toBe(
      200,
    );

    const audit = (await (await operator.fetch('/api/audit?limit=200')).json()) as {
      items: { action: string; result: string }[];
    };
    expect(
      audit.items.filter(
        (event) => event.action === 'security.csrf_rejected' && event.result === 'denied',
      ).length,
    ).toBeGreaterThanOrEqual(refused.length);
  });

  it('applies the CSRF token and the Origin check to every state-changing operator route', async () => {
    const other = await signIn(t, org);
    for (const [method, path] of [...STATE_CHANGING_ROUTES, LOGOUT]) {
      const what = `${method} ${path}`;
      const send = (headers: Record<string, string>): Promise<Response> =>
        fetch(`${t.url}${path}`, { method, headers: { cookie: operator.cookie, ...headers } });

      for (const token of [undefined, other.csrfToken]) {
        const response = await send({
          origin: PORTAL_ORIGIN,
          ...(token === undefined ? {} : { 'x-csrf-token': token }),
        });
        expect(response.status, `${what} without this session's token`).toBe(403);
        expect(((await response.json()) as { error: { code: string } }).error.code, what).toBe(
          'csrf_failed',
        );
      }
      for (const origin of [undefined, PLAYER_ORIGIN, 'https://attacker.example']) {
        const response = await send({
          'x-csrf-token': operator.csrfToken,
          ...(origin === undefined ? {} : { origin }),
        });
        expect(response.status, `${what} from ${origin ?? 'no origin'}`).toBe(403);
        expect(((await response.json()) as { error: { code: string } }).error.code, what).toBe(
          'origin_not_allowed',
        );
      }
      // With both, the request gets past the checks: whatever it answers, it is not 401 or 403.
      if (path !== LOGOUT[1]) {
        const passed = await send({ origin: PORTAL_ORIGIN, 'x-csrf-token': operator.csrfToken });
        expect([401, 403], what).not.toContain(passed.status);
      }
    }
    // The session survived every refused request, the refused sign-out included.
    expect((await operator.fetch('/api/displays')).status).toBe(200);
  });

  it('never grants cross-origin access to the operator API', async () => {
    for (const origin of ['https://attacker.example', PLAYER_ORIGIN, PORTAL_ORIGIN]) {
      const preflight = await fetch(`${t.url}/api/displays`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'x-csrf-token,content-type',
        },
      });
      expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
      expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();
      const read = await fetch(`${t.url}/api/displays`, {
        headers: { origin, cookie: operator.cookie },
      });
      expect(read.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('allows CORS on player routes for the player origin only, never with credentials', async () => {
    const allowed = await fetch(`${t.url}/player/manifest`, {
      method: 'OPTIONS',
      headers: {
        origin: PLAYER_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,if-none-match',
      },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(PLAYER_ORIGIN);
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull();
    for (const origin of [
      'https://attacker.example',
      PORTAL_ORIGIN,
      'http://localhost:5174.attacker.example',
      'null',
    ]) {
      const preflight = await fetch(`${t.url}/player/manifest`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization',
        },
      });
      expect(preflight.headers.get('access-control-allow-origin'), origin).toBeNull();
      const post = await fetch(`${t.url}/player/pairing`, { method: 'POST', headers: { origin } });
      expect(post.headers.get('access-control-allow-origin'), origin).toBeNull();
    }
  });

  it('sends hardening headers and never caches API answers', async () => {
    const response = await operator.fetch('/api/displays');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // A text/plain or form body is not parsed as JSON by accident (CSRF through simple requests).
    const form = await fetch(`${t.url}/api/playlists`, {
      method: 'POST',
      headers: {
        cookie: operator.cookie,
        origin: PORTAL_ORIGIN,
        'x-csrf-token': operator.csrfToken,
        'content-type': 'text/plain',
      },
      body: JSON.stringify({ name: 'smuggled' }),
    });
    expect(form.status).toBe(415);
  });

  it('ends a session at sign-out, at its absolute expiry and after the idle timeout', async () => {
    const signedOut = await signIn(t, org);
    expect((await signedOut.fetch('/api/displays')).status).toBe(200);
    // Sign-out itself is CSRF-protected.
    const withoutToken = await fetch(`${t.url}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: signedOut.cookie, origin: PORTAL_ORIGIN },
    });
    expect(withoutToken.status).toBe(403);
    expect((await signedOut.fetch('/api/displays')).status).toBe(200);
    const logout = await signedOut.fetch('/api/auth/logout', { method: 'POST' });
    expect(logout.status).toBe(200);
    expect(logout.headers.get('set-cookie') ?? '').toMatch(/tinnox_session=;/);
    expect((await signedOut.fetch('/api/displays')).status).toBe(401);

    const expired = await signIn(t, org);
    const idle = await signIn(t, org);
    await arrangeAsDefiner(
      "UPDATE public.session SET expires_at = now() - interval '1 second' WHERE csrf_token = $1",
      [expired.csrfToken],
    );
    await arrangeAsDefiner(
      "UPDATE public.session SET last_seen_at = now() - interval '31 minutes' WHERE csrf_token = $1",
      [idle.csrfToken],
    );
    expect((await expired.fetch('/api/displays')).status).toBe(401);
    expect((await idle.fetch('/api/displays')).status).toBe(401);
    expect(await (await expired.fetch('/api/session')).json()).toEqual({ authenticated: false });
    // The first session is unaffected.
    expect((await operator.fetch('/api/displays')).status).toBe(200);
  });

  it('refuses sign-in callbacks that do not belong to a sign-in this server started', async () => {
    for (const query of [
      '',
      '?code=abc&state=' + randomBytes(32).toString('base64url'),
      '?error=access_denied&state=x',
    ]) {
      const response = await fetch(`${t.url}/api/auth/callback${query}`, { redirect: 'manual' });
      expect(response.headers.get('set-cookie') ?? '').not.toMatch(
        /tinnox_session=[A-Za-z0-9_-]{20,}/,
      );
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location') ?? '';
        expect(location.startsWith(`${PORTAL_ORIGIN}/`)).toBe(true);
        expect(location).toContain('authError=');
      } else {
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    }
    // The return path cannot send the browser to another site.
    const open = await fetch(`${t.url}/api/auth/login?returnTo=//attacker.example`, {
      redirect: 'manual',
    });
    expect(open.status).toBe(400);
  });
});
