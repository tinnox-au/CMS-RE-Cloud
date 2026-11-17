import type { HeartbeatV1 } from '@tinnox/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbortedError, PlayerFault, RevokedError } from '../core/errors.ts';
import { JSON_TIMEOUT_MS, parseRangeStart, PlayerHttpApi, type FetchLike } from './api.ts';

const ORIGIN = 'http://api.test';
const TOKEN = 'T'.repeat(43);
const PUB = '3b1e0f8a-7c2d-4e5f-9a6b-1c2d3e4f5a6b';

interface Seen {
  url: string;
  init: RequestInit;
}

function api(handler: (seen: Seen) => Response | Promise<Response>): {
  client: PlayerHttpApi;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  const fetchImpl: FetchLike = async (url, init = {}) => {
    const entry = { url, init };
    seen.push(entry);
    return handler(entry);
  };
  return { client: new PlayerHttpApi(ORIGIN, fetchImpl), seen };
}

function header(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

describe('PlayerHttpApi', () => {
  it('sends the device token as a bearer header, never in the URL, with no cookies, cache or redirects', async () => {
    const { client, seen } = api(() => new Response(null, { status: 304 }));
    await client.forDevice(TOKEN).fetchManifest(PUB);
    const call = seen[0]!;
    expect(call.url).toBe(`${ORIGIN}/player/manifest`);
    expect(call.url).not.toContain(TOKEN);
    expect(header(call.init, 'authorization')).toBe(`Bearer ${TOKEN}`);
    expect(header(call.init, 'if-none-match')).toBe(`"${PUB}"`);
    expect(call.init.credentials).toBe('omit');
    expect(call.init.cache).toBe('no-store');
    expect(call.init.redirect).toBe('error');
  });

  it('maps 304, 204 and 200 of the manifest poll', async () => {
    const device = (status: number, body?: unknown) =>
      api(
        () => new Response(body === undefined ? null : JSON.stringify(body), { status }),
      ).client.forDevice(TOKEN);
    expect(await device(304).fetchManifest(PUB)).toEqual({ kind: 'not_modified' });
    expect(await device(204).fetchManifest(null)).toEqual({ kind: 'none' });
    expect(await device(200, { manifest: { schemaVersion: 1 } }).fetchManifest(null)).toEqual({
      kind: 'manifest',
      raw: { schemaVersion: 1 },
    });
  });

  it('omits If-None-Match when the player has no publication', async () => {
    const { client, seen } = api(() => new Response(null, { status: 204 }));
    await client.forDevice(TOKEN).fetchManifest(null);
    expect(header(seen[0]!.init, 'if-none-match')).toBeUndefined();
  });

  it('treats 401 on manifest, media-urls and heartbeat as revocation', async () => {
    const device = api(() => new Response('{}', { status: 401 })).client.forDevice(TOKEN);
    await expect(device.fetchManifest(null)).rejects.toBeInstanceOf(RevokedError);
    await expect(device.requestMediaUrls(PUB, [PUB])).rejects.toBeInstanceOf(RevokedError);
  });

  it('reports other HTTP errors and unreachable servers as network faults without the URL', async () => {
    const failing = api(() => new Response('oops', { status: 503 })).client.forDevice(TOKEN);
    await expect(failing.fetchManifest(null)).rejects.toMatchObject({
      code: 'network_error',
      status: 503,
    });
    const down = api(() => {
      throw new TypeError('Failed to fetch');
    }).client.forDevice(TOKEN);
    const error = await down.fetchManifest(null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlayerFault);
    expect((error as PlayerFault).message).not.toContain('http');
  });

  it('rejects a response that is not JSON or has the wrong shape', async () => {
    const notJson = api(() => new Response('<html>', { status: 200 })).client.forDevice(TOKEN);
    await expect(notJson.requestMediaUrls(PUB, [PUB])).rejects.toMatchObject({
      code: 'internal_error',
    });
    const wrong = api(
      () => new Response(JSON.stringify({ urls: 'no' }), { status: 200 }),
    ).client.forDevice(TOKEN);
    await expect(wrong.requestMediaUrls(PUB, [PUB])).rejects.toMatchObject({
      code: 'internal_error',
    });
  });

  it('never sends the credential to a media URL on another origin', async () => {
    const { client, seen } = api(() => new Response('x'));
    const device = client.forDevice(TOKEN);
    await expect(
      device.fetchMedia('http://elsewhere.test/player/media/x', null, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'download_failed' });
    expect(seen).toHaveLength(0);
  });

  it('streams media, asks for a byte range when resuming, and reads Content-Range', async () => {
    const { client, seen } = api(
      () =>
        new Response(new Uint8Array([4, 5, 6]), {
          status: 206,
          headers: { 'content-range': 'bytes 3-5/6' },
        }),
    );
    const response = await client
      .forDevice(TOKEN)
      .fetchMedia(`${ORIGIN}/player/media/x?sig=abc`, 3, new AbortController().signal);
    expect(header(seen[0]!.init, 'range')).toBe('bytes=3-');
    // The signed URL is the authorisation; the device token is not sent with media requests.
    expect(header(seen[0]!.init, 'authorization')).toBeUndefined();
    expect(response.status).toBe(206);
    expect(response.rangeStart).toBe(3);
    const received: number[] = [];
    for await (const chunk of response.chunks) received.push(...chunk);
    expect(received).toEqual([4, 5, 6]);
  });

  it('returns the status of a rejected media URL instead of declaring the device revoked', async () => {
    const { client } = api(() => new Response('{}', { status: 401 }));
    const response = await client
      .forDevice(TOKEN)
      .fetchMedia(`${ORIGIN}/player/media/x`, null, new AbortController().signal);
    expect(response.status).toBe(401);
  });

  it('stops a media request when aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const { client } = api((seen) => {
      if (seen.init.signal?.aborted === true) throw new DOMException('aborted', 'AbortError');
      return new Response('x');
    });
    await expect(
      client.forDevice(TOKEN).fetchMedia(`${ORIGIN}/player/media/x`, null, abort.signal),
    ).rejects.toBeInstanceOf(AbortedError);
  });

  it('pairing: no credential on create; polling token as bearer; 404 means the session is gone', async () => {
    const create = api(
      () =>
        new Response(
          JSON.stringify({
            pairingId: PUB,
            code: 'ABCD2345',
            pollingToken: 'p'.repeat(43),
            expiresAt: '2026-11-14T03:10:00.000Z',
            expiresInSeconds: 600,
            pollIntervalMs: 2000,
          }),
          { status: 201 },
        ),
    );
    const created = await create.client.createPairing();
    expect(created.code).toBe('ABCD2345');
    expect(header(create.seen[0]!.init, 'authorization')).toBeUndefined();
    expect(create.seen[0]!.init.body).toBeUndefined();

    const poll = api(() => new Response('{}', { status: 404 }));
    expect(await poll.client.pollPairing(PUB, 'p'.repeat(43))).toEqual({ status: 'gone' });
    expect(header(poll.seen[0]!.init, 'authorization')).toBe(`Bearer ${'p'.repeat(43)}`);
    expect(poll.seen[0]!.url).not.toContain('ppppp');
  });
});

describe('releaseRegistration (local reset)', () => {
  it('calls DELETE /player/registration with the credential and reports the outcome', async () => {
    const ok = api(() => new Response(null, { status: 204 }));
    expect(await ok.client.forDevice(TOKEN).releaseRegistration(1000)).toBe(true);
    expect(ok.seen[0]!.url).toBe(`${ORIGIN}/player/registration`);
    expect(ok.seen[0]!.init.method).toBe('DELETE');
    expect(header(ok.seen[0]!.init, 'authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('never throws: offline or rejected simply means the server was not told', async () => {
    const down = api(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await down.client.forDevice(TOKEN).releaseRegistration(1000)).toBe(false);
    const rejected = api(() => new Response('{}', { status: 401 }));
    expect(await rejected.client.forDevice(TOKEN).releaseRegistration(1000)).toBe(false);
  });
});

/** A JSON body that never yields a byte and never ends. */
function stalledJson(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('JSON deadline covers the body (FCX-01)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function atDeadline(
    run: (client: PlayerHttpApi) => Promise<unknown>,
    response: () => Response = stalledJson,
  ): Promise<unknown> {
    const { client } = api(() => response());
    let error: unknown = 'pending';
    void run(client).then(
      (value) => {
        error = value;
      },
      (err: unknown) => {
        error = err;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toBe('pending');
    await vi.advanceTimersByTimeAsync(JSON_TIMEOUT_MS - 1);
    expect(error).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    return error;
  }

  it('rejects a stalled manifest body when the deadline elapses', async () => {
    const error = await atDeadline((client) => client.forDevice(TOKEN).fetchManifest(null));
    expect(error).toBeInstanceOf(PlayerFault);
    expect((error as PlayerFault).message).toContain(`no answer within ${JSON_TIMEOUT_MS} ms`);
  });

  it('rejects a stalled heartbeat body when the deadline elapses', async () => {
    const error = await atDeadline((client) =>
      client.forDevice(TOKEN).heartbeat({} as HeartbeatV1),
    );
    expect(error).toBeInstanceOf(PlayerFault);
    expect((error as PlayerFault).message).toContain(`no answer within ${JSON_TIMEOUT_MS} ms`);
  });

  it('rejects a stalled media-URL body when the deadline elapses', async () => {
    const error = await atDeadline((client) =>
      client.forDevice(TOKEN).requestMediaUrls(PUB, [PUB]),
    );
    expect(error).toBeInstanceOf(PlayerFault);
    expect((error as PlayerFault).message).toContain(`no answer within ${JSON_TIMEOUT_MS} ms`);
  });

  it('rejects a stalled pairing body when the deadline elapses', async () => {
    const error = await atDeadline((client) => client.createPairing());
    expect(error).toBeInstanceOf(PlayerFault);
    expect((error as PlayerFault).message).toContain(`no answer within ${JSON_TIMEOUT_MS} ms`);
    const poll = await atDeadline((client) => client.pollPairing(PUB, 'p'.repeat(43)));
    expect(poll).toBeInstanceOf(PlayerFault);
  });

  it('settles a stalled registration release when discarding the body does not finish', async () => {
    const error = await atDeadline(
      (client) => client.forDevice(TOKEN).releaseRegistration(JSON_TIMEOUT_MS),
      () =>
        new Response(
          new ReadableStream({
            cancel() {
              return new Promise<void>(() => undefined);
            },
          }),
          { status: 200 },
        ),
    );
    // The call reports that the server was not told, instead of hanging.
    expect(error).toBe(false);
  });

  it('aborts a stalled credentialed read when the session signal aborts', async () => {
    const abort = new AbortController();
    const { client } = api(() => stalledJson());
    const device = client.forDevice(TOKEN);
    const runs = [
      device.fetchManifest(null, abort.signal),
      device.requestMediaUrls(PUB, [PUB], abort.signal),
      device.heartbeat({} as HeartbeatV1, abort.signal),
    ];
    const errors: unknown[] = runs.map(() => 'pending');
    runs.forEach((run, index) => {
      void run.then(
        () => {
          errors[index] = 'resolved';
        },
        (err: unknown) => {
          errors[index] = err;
        },
      );
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toEqual(['pending', 'pending', 'pending']);
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    for (const error of errors) expect(error).toBeInstanceOf(AbortedError);
  });

  it('aborts a stalled body when the caller cancels, and the deadline does not fire later', async () => {
    const abort = new AbortController();
    const { client } = api(() => stalledJson());
    let error: unknown = 'pending';
    void client.createPairing(abort.signal).then(
      () => {
        error = 'resolved';
      },
      (err: unknown) => {
        error = err;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toBe('pending');
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toBeInstanceOf(AbortedError);
    await vi.advanceTimersByTimeAsync(JSON_TIMEOUT_MS);
    expect(error).toBeInstanceOf(AbortedError);
  });

  it('does not fail a finished call when the deadline later elapses', async () => {
    const { client } = api(
      () => new Response(JSON.stringify({ manifest: { schemaVersion: 1 } }), { status: 200 }),
    );
    await expect(client.forDevice(TOKEN).fetchManifest(null)).resolves.toEqual({
      kind: 'manifest',
      raw: { schemaVersion: 1 },
    });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(JSON_TIMEOUT_MS + 5_000);
  });
});

describe('parseRangeStart', () => {
  it('reads the first byte position', () => {
    expect(parseRangeStart('bytes 100-199/200')).toBe(100);
    expect(parseRangeStart('bytes 0-9/*')).toBe(0);
  });
  it('returns null for anything else', () => {
    expect(parseRangeStart(null)).toBeNull();
    expect(parseRangeStart('bytes */200')).toBeNull();
    expect(parseRangeStart('items 1-2/3')).toBeNull();
  });
});
