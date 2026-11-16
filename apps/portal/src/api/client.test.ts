import { DEFAULT_LIMITS, DisplayListResponseSchema, HEADERS, ROUTES } from '@tinnox/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  createApiClient,
  errorFromResponse,
  isOutcomeUnknown,
  parseRetryAfter,
  type FetchLike,
} from './client.ts';
import { mediaFromUploadResponse } from './upload.ts';

const ORG = '11111111-1111-4111-8111-111111111111';

function sessionBody(csrfToken: string) {
  return {
    authenticated: true,
    user: { displayName: 'Test Operator', role: 'operator' },
    organization: { id: ORG, name: 'Test Organisation' },
    csrfToken,
    expiresAt: '2026-11-14T10:00:00.000Z',
    limits: DEFAULT_LIMITS,
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function apiErrorBody(code: string, message: string) {
  return { error: { code, message } };
}

interface Call {
  readonly path: string;
  readonly init: RequestInit;
}

function harness(responder: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const onUnauthenticated = vi.fn();
  const fetch: FetchLike = async (path, init) => {
    const call = { path, init };
    calls.push(call);
    return responder(call, calls.length - 1);
  };
  const client = createApiClient({ fetch, onUnauthenticated });
  return { client, calls, onUnauthenticated };
}

function header(call: Call | undefined, name: string): string | undefined {
  return (call?.init.headers as Record<string, string> | undefined)?.[name];
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

const TOKEN_A = 'csrf-token-aaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'csrf-token-bbbbbbbbbbbbbbbbbbbb';

describe('api client: session and CSRF', () => {
  it('keeps the CSRF token from GET /api/session and sends it only on state-changing calls', async () => {
    const { client, calls } = harness((call) => {
      if (call.path === ROUTES.session) return json(200, sessionBody(TOKEN_A));
      if (call.init.method === 'GET') return json(200, { items: [] });
      return new Response(null, { status: 204 });
    });
    const session = await client.loadSession();
    expect(session.authenticated).toBe(true);
    expect(client.getCsrfToken()).toBe(TOKEN_A);

    await client.request({ path: ROUTES.displays }, DisplayListResponseSchema);
    expect(header(calls[1], HEADERS.csrf)).toBeUndefined();

    await client.requestNoContent({ method: 'DELETE', path: ROUTES.mediaItem(ORG) });
    expect(header(calls[2], HEADERS.csrf)).toBe(TOKEN_A);
  });

  it('always uses same-origin credentials, no caching and no redirects', async () => {
    const { client, calls } = harness(() => json(200, { items: [] }));
    await client.request({ path: ROUTES.displays }, DisplayListResponseSchema);
    expect(calls[0]?.init.credentials).toBe('same-origin');
    expect(calls[0]?.init.cache).toBe('no-store');
    expect(calls[0]?.init.redirect).toBe('error');
  });

  it('refuses a state-changing call when there is no session token, without sending it', async () => {
    const { client, calls } = harness(() => json(200, {}));
    const error = await rejection(
      client.requestNoContent({ method: 'POST', path: ROUTES.authLogout }),
    );
    expect(error.code).toBe('no_session');
    expect(calls).toHaveLength(0);
  });

  it('treats an unauthenticated session answer as signed out and holds no token', async () => {
    const { client, onUnauthenticated } = harness(() => json(200, { authenticated: false }));
    expect(await client.loadSession()).toEqual({ authenticated: false });
    expect(client.getCsrfToken()).toBeNull();
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('treats 401 from GET /api/session as signed out rather than an error', async () => {
    const { client, onUnauthenticated } = harness(() =>
      json(401, apiErrorBody('unauthenticated', 'Sign in required')),
    );
    expect(await client.loadSession()).toEqual({ authenticated: false });
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('on 401 notifies once, forgets the token and reports the API error', async () => {
    const { client, onUnauthenticated } = harness((call) =>
      call.path === ROUTES.session
        ? json(200, sessionBody(TOKEN_A))
        : json(401, apiErrorBody('unauthenticated', 'Session expired')),
    );
    await client.loadSession();
    const error = await rejection(
      client.request({ path: ROUTES.displays }, DisplayListResponseSchema),
    );
    expect(error.status).toBe(401);
    expect(error.code).toBe('unauthenticated');
    expect(error.message).toBe('Session expired');
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(client.getCsrfToken()).toBeNull();
  });

  it('after csrf_failed fetches a fresh token and retries exactly once with it', async () => {
    let sessions = 0;
    const { client, calls } = harness((call) => {
      if (call.path === ROUTES.session) {
        sessions += 1;
        return json(200, sessionBody(sessions === 1 ? TOKEN_A : TOKEN_B));
      }
      return header(call, HEADERS.csrf) === TOKEN_B
        ? new Response(null, { status: 204 })
        : json(403, apiErrorBody('csrf_failed', 'CSRF token mismatch'));
    });
    await client.loadSession();
    await client.requestNoContent({
      method: 'POST',
      path: ROUTES.playlistPublish(ORG),
      body: { displayId: ORG },
      headers: { [HEADERS.idempotencyKey]: 'key-0123456789abcdef' },
    });
    const posts = calls.filter((call) => call.init.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(header(posts[1], HEADERS.csrf)).toBe(TOKEN_B);
    // The retry is the same intent, so it must carry the same idempotency key.
    expect(header(posts[1], HEADERS.idempotencyKey)).toBe('key-0123456789abcdef');
  });

  it('does not loop when the CSRF token keeps being rejected', async () => {
    const { client, calls } = harness((call) =>
      call.path === ROUTES.session
        ? json(200, sessionBody(TOKEN_A))
        : json(403, apiErrorBody('csrf_failed', 'CSRF token mismatch')),
    );
    await client.loadSession();
    const error = await rejection(
      client.requestNoContent({ method: 'POST', path: ROUTES.authLogout }),
    );
    expect(error.code).toBe('csrf_failed');
    expect(calls.filter((call) => call.init.method === 'POST')).toHaveLength(2);
  });

  it('returns to sign-in when the session is gone at the time of a CSRF failure', async () => {
    let sessions = 0;
    const { client, onUnauthenticated } = harness((call) => {
      if (call.path === ROUTES.session) {
        sessions += 1;
        return sessions === 1
          ? json(200, sessionBody(TOKEN_A))
          : json(200, { authenticated: false });
      }
      return json(403, apiErrorBody('csrf_failed', 'CSRF token mismatch'));
    });
    await client.loadSession();
    await rejection(client.requestNoContent({ method: 'POST', path: ROUTES.authLogout }));
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(client.getCsrfToken()).toBeNull();
  });
});

describe('api client: responses and errors', () => {
  it('surfaces the API error code, message, details and request id', async () => {
    const { client } = harness(() =>
      json(
        422,
        {
          error: {
            code: 'publication_rejected',
            message: 'The playlist cannot be published to this display.',
            details: [
              { path: 'items[1]', message: 'Media is still processing', code: 'media_not_ready' },
            ],
            requestId: 'req-42',
          },
        },
        { [HEADERS.requestId]: 'req-header' },
      ),
    );
    const error = await rejection(
      client.request({ path: ROUTES.displays }, DisplayListResponseSchema),
    );
    expect(error.fromApi).toBe(true);
    expect(error.code).toBe('publication_rejected');
    expect(error.message).toBe('The playlist cannot be published to this display.');
    expect(error.details).toEqual([
      { path: 'items[1]', message: 'Media is still processing', code: 'media_not_ready' },
    ]);
    expect(error.requestId).toBe('req-42');
  });

  it('does not invent an API code when the error body is not the envelope', () => {
    const error = errorFromResponse(502, '<html>Bad gateway</html>', 'req-7');
    expect(error.code).toBe('invalid_response');
    expect(error.fromApi).toBe(false);
    expect(error.requestId).toBe('req-7');
    expect(error.message).toContain('502');
  });

  it('keeps the wait a throttled answer asks for', async () => {
    const { client } = harness(() =>
      json(429, apiErrorBody('rate_limited', 'Too many requests. Try again in 7 seconds.'), {
        'retry-after': '7',
      }),
    );
    const error = await rejection(
      client.request({ path: ROUTES.displays }, DisplayListResponseSchema),
    );
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterMs).toBe(7_000);
    expect(errorFromResponse(500, '', null).retryAfterMs).toBeNull();
  });

  it('reads Retry-After as seconds or as a date', () => {
    const now = Date.parse('2026-11-16T00:00:00Z');
    expect(parseRetryAfter('0', now)).toBe(0);
    expect(parseRetryAfter(' 12 ', now)).toBe(12_000);
    expect(parseRetryAfter('Mon, 16 Nov 2026 00:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Sun, 15 Nov 2026 23:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('99999999', now)).toBe(10 * 60 * 1000);
    for (const bad of [null, '', '-3', '1.5', 'soon', '12abc']) {
      expect(parseRetryAfter(bad, now), String(bad)).toBeNull();
    }
  });

  it('rejects a 2xx body that does not match the shared schema', async () => {
    const { client } = harness(() => json(200, { items: [{ id: 'not-a-display' }] }));
    const error = await rejection(
      client.request({ path: ROUTES.displays }, DisplayListResponseSchema),
    );
    expect(error.code).toBe('invalid_response');
    expect(error.details.length).toBeGreaterThan(0);
  });

  it('rejects unknown keys, because the shared schemas are strict', async () => {
    const { client } = harness(() => json(200, { items: [], online: true }));
    const error = await rejection(
      client.request({ path: ROUTES.displays }, DisplayListResponseSchema),
    );
    expect(error.code).toBe('invalid_response');
  });

  it('maps a transport failure to network_error and an abort to aborted', async () => {
    const failing = harness(() => {
      throw new TypeError('fetch failed');
    });
    expect(
      (
        await rejection(
          failing.client.request({ path: ROUTES.displays }, DisplayListResponseSchema),
        )
      ).code,
    ).toBe('network_error');

    const aborting = harness(() => {
      throw new DOMException('Aborted', 'AbortError');
    });
    expect(
      (
        await rejection(
          aborting.client.request({ path: ROUTES.displays }, DisplayListResponseSchema),
        )
      ).code,
    ).toBe('aborted');
  });

  it('classifies which failures leave the outcome unknown', () => {
    const make = (status: number, code: ApiRequestError['code']) =>
      new ApiRequestError({ status, code, message: 'x', fromApi: status !== 0 });
    expect(isOutcomeUnknown(make(0, 'network_error'))).toBe(true);
    expect(isOutcomeUnknown(make(503, 'service_unavailable'))).toBe(true);
    expect(isOutcomeUnknown(make(500, 'internal_error'))).toBe(true);
    expect(isOutcomeUnknown(make(429, 'rate_limited'))).toBe(true);
    expect(isOutcomeUnknown(make(200, 'invalid_response'))).toBe(true);
    expect(isOutcomeUnknown(new Error('anything else'))).toBe(true);
    expect(isOutcomeUnknown(make(422, 'publication_rejected'))).toBe(false);
    expect(isOutcomeUnknown(make(409, 'idempotency_conflict'))).toBe(false);
    expect(isOutcomeUnknown(make(404, 'not_found'))).toBe(false);
  });
});

describe('upload response handling', () => {
  const media = {
    id: ORG,
    kind: 'image',
    status: 'processing',
    name: 'poster.png',
    originalName: 'poster.png',
    description: null,
    defaultDurationMs: null,
    folderId: null,
    tagIds: [],
    usageCount: 0,
    mimeType: null,
    bytes: null,
    sha256: null,
    width: null,
    height: null,
    durationMs: null,
    codec: null,
    errorCode: null,
    errorDetail: null,
    createdAt: '2026-11-14T03:00:00.000Z',
    updatedAt: '2026-11-14T03:00:00.000Z',
  };

  it('accepts a valid upload answer', () => {
    expect(mediaFromUploadResponse(201, JSON.stringify({ media }), null).id).toBe(ORG);
  });

  it('reports the API error for a refused upload', () => {
    const body = JSON.stringify(apiErrorBody('payload_too_large', 'File exceeds the limit'));
    expect(() => mediaFromUploadResponse(413, body, null)).toThrowError('File exceeds the limit');
  });

  it('does not claim success when a 2xx answer is unreadable', () => {
    expect(() => mediaFromUploadResponse(200, 'OK', null)).toThrowError(/could not be read/);
  });
});
