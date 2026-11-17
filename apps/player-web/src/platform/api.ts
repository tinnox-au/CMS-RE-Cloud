import {
  HeartbeatResponseSchema,
  manifestEtag,
  MediaUrlsRequestSchema,
  MediaUrlsResponseSchema,
  PairingCreateResponseSchema,
  PairingPollResponseSchema,
  PLAYER_PREFIX,
  ROUTES,
  type HeartbeatResponse,
  type HeartbeatV1,
  type MediaUrlsResponse,
  type PairingCreateResponse,
  type PairingPollResponse,
} from '@tinnox/contracts';
import { z } from 'zod';
import { AbortedError, PlayerFault, RevokedError } from '../core/errors.ts';
import type { DeviceApi, ManifestFetchResult, MediaResponse } from '../core/types.ts';

/**
 * Deadline for one JSON call, from sending the request through reading or discarding
 * the body. Headers arriving does not end it: a stalled body must still fail the call.
 */
export const JSON_TIMEOUT_MS = 15_000;
/** A media transfer is abandoned when no bytes arrive for this long. */
export const MEDIA_STALL_TIMEOUT_MS = 30_000;
/** Largest JSON body the player will read from the API. */
const MAX_JSON_BYTES = 2 * 1024 * 1024;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_INIT: RequestInit = {
  mode: 'cors',
  // The player has no cookies for the API and must never send any.
  credentials: 'omit',
  // API responses must not be kept by the HTTP cache (and the service worker never sees them).
  cache: 'no-store',
  // A redirect could carry the bearer credential to another place: refuse.
  redirect: 'error',
  referrerPolicy: 'no-referrer',
};

const ManifestEnvelopeSchema = z.object({ manifest: z.unknown() });

export type PairingPollResult = PairingPollResponse | { status: 'gone' };

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function readJson(response: Response, what: string): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new PlayerFault('internal_error', `${what}: response too large`);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    throw new PlayerFault('network_error', `${what}: response body could not be read`, {
      cause: err,
    });
  }
  if (text.length > MAX_JSON_BYTES)
    throw new PlayerFault('internal_error', `${what}: response too large`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PlayerFault('internal_error', `${what}: response is not JSON`);
  }
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function callerAborted(signal: AbortSignal | null): boolean {
  return signal?.aborted === true;
}

/** HTTP client for the player protocol (prototype-m0.md D9, D13). Holds no credential itself. */
export class PlayerHttpApi {
  readonly #base: string;
  readonly #fetch: FetchLike;

  constructor(apiOrigin: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
    this.#base = apiOrigin.replace(/\/+$/, '');
    this.#fetch = fetchImpl;
  }

  get origin(): string {
    return new URL(this.#base).origin;
  }

  /**
   * One JSON call. `consume` reads or discards the body while the deadline is still
   * armed, and the timer is cleared on every path out. A caller signal aborts the
   * same operation, including a body read that has already started.
   */
  async #request<T>(
    what: string,
    path: string,
    init: RequestInit,
    consume: (response: Response) => Promise<T>,
    timeoutMs: number = JSON_TIMEOUT_MS,
  ): Promise<T> {
    const outer = init.signal ?? null;
    if (callerAborted(outer)) throw new AbortedError();

    const timed = new AbortController();
    const signal = outer === null ? timed.signal : AbortSignal.any([outer, timed.signal]);
    let response: Response | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const work = (async (): Promise<T> => {
      response = await this.#fetch(`${this.#base}${path}`, { ...BASE_INIT, ...init, signal });
      return await consume(response);
    })();

    let onOuterAbort: (() => void) | undefined;
    const cancelled =
      outer === null
        ? null
        : new Promise<never>((_, reject) => {
            onOuterAbort = (): void => {
              reject(new AbortedError());
            };
            outer.addEventListener('abort', onOuterAbort);
          });

    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timed.abort();
        const body = response?.body;
        if (body !== undefined && body !== null) void body.cancel().catch(() => undefined);
        reject(new PlayerFault('network_error', `${what}: no answer within ${timeoutMs} ms`));
      }, timeoutMs);
    });

    // A loser of the race can reject after the winner has settled. Observe it.
    void work.catch(() => undefined);
    void deadline.catch(() => undefined);
    if (cancelled !== null) void cancelled.catch(() => undefined);

    try {
      const contenders: Promise<T>[] = [work, deadline];
      if (cancelled !== null) contenders.push(cancelled);
      return await Promise.race(contenders);
    } catch (err) {
      if (callerAborted(outer) || err instanceof AbortedError) throw new AbortedError();
      if (err instanceof PlayerFault || err instanceof RevokedError) throw err;
      throw new PlayerFault(
        'network_error',
        timed.signal.aborted
          ? `${what}: no answer within ${timeoutMs} ms`
          : `${what}: server unreachable`,
        { cause: err },
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (outer !== null && onOuterAbort !== undefined)
        outer.removeEventListener('abort', onOuterAbort);
    }
  }

  async #fail(what: string, response: Response): Promise<never> {
    await discard(response);
    throw new PlayerFault('network_error', `${what}: HTTP ${response.status}`, {
      status: response.status,
    });
  }

  /** `POST /player/pairing`. No credential, no body. */
  async createPairing(signal?: AbortSignal): Promise<PairingCreateResponse> {
    const what = 'pairing request';
    return this.#request(
      what,
      ROUTES.playerPairing,
      { method: 'POST', ...(signal ? { signal } : {}) },
      async (response) => {
        if (response.status !== 200 && response.status !== 201) return this.#fail(what, response);
        const parsed = PairingCreateResponseSchema.safeParse(await readJson(response, what));
        if (!parsed.success)
          throw new PlayerFault('internal_error', `${what}: unexpected response shape`);
        return parsed.data;
      },
    );
  }

  /** `GET /player/pairing/:id` with the polling token. `gone` means the session cannot be used any more. */
  async pollPairing(
    pairingId: string,
    pollingToken: string,
    signal?: AbortSignal,
  ): Promise<PairingPollResult> {
    const what = 'pairing poll';
    return this.#request(
      what,
      ROUTES.playerPairingPoll(pairingId),
      {
        method: 'GET',
        headers: bearer(pollingToken),
        ...(signal ? { signal } : {}),
      },
      async (response) => {
        if (response.status === 404 || response.status === 401 || response.status === 410) {
          await discard(response);
          return { status: 'gone' };
        }
        if (response.status !== 200) return this.#fail(what, response);
        const parsed = PairingPollResponseSchema.safeParse(await readJson(response, what));
        if (!parsed.success)
          throw new PlayerFault('internal_error', `${what}: unexpected response shape`);
        return parsed.data;
      },
    );
  }

  /** Player calls bound to one device credential. */
  forDevice(deviceToken: string): DeviceApi & {
    heartbeat(body: HeartbeatV1, signal?: AbortSignal): Promise<HeartbeatResponse>;
    /**
     * `DELETE /player/registration`: the player gives up its own credential (local reset).
     * Best effort; resolves false when the server could not be told.
     */
    releaseRegistration(timeoutMs: number): Promise<boolean>;
  } {
    const auth = bearer(deviceToken);
    const origin = this.origin;

    const guard = async (what: string, response: Response): Promise<Response> => {
      if (response.status === 401) {
        await discard(response);
        throw new RevokedError();
      }
      if (response.status === 304 || response.status === 204) return response;
      if (response.status !== 200) return this.#fail(what, response);
      return response;
    };

    return {
      fetchManifest: async (ifNoneMatchPublicationId, signal): Promise<ManifestFetchResult> => {
        const what = 'manifest poll';
        const headers: Record<string, string> = { ...auth, accept: 'application/json' };
        if (ifNoneMatchPublicationId !== null) {
          headers['if-none-match'] = manifestEtag(ifNoneMatchPublicationId);
        }
        return this.#request(
          what,
          ROUTES.playerManifest,
          { method: 'GET', headers, ...(signal ? { signal } : {}) },
          async (response) => {
            const guarded = await guard(what, response);
            if (guarded.status === 304 || guarded.status === 204) {
              await discard(guarded);
              return guarded.status === 304 ? { kind: 'not_modified' } : { kind: 'none' };
            }
            const body = await readJson(guarded, what);
            const envelope = ManifestEnvelopeSchema.safeParse(body);
            // A body without a manifest is passed on as-is so it is reported as a malformed manifest.
            return { kind: 'manifest', raw: envelope.success ? envelope.data.manifest : body };
          },
        );
      },

      requestMediaUrls: async (publicationId, assetIds, signal): Promise<MediaUrlsResponse> => {
        const what = 'media URL request';
        const body = MediaUrlsRequestSchema.parse({ publicationId, assetIds: [...assetIds] });
        return this.#request(
          what,
          ROUTES.playerMediaUrls,
          {
            method: 'POST',
            headers: { ...auth, 'content-type': 'application/json' },
            body: JSON.stringify(body),
            ...(signal ? { signal } : {}),
          },
          async (response) => {
            const guarded = await guard(what, response);
            if (guarded.status !== 200) return this.#fail(what, response);
            const parsed = MediaUrlsResponseSchema.safeParse(await readJson(guarded, what));
            if (!parsed.success)
              throw new PlayerFault('internal_error', `${what}: unexpected response shape`);
            return parsed.data;
          },
        );
      },

      fetchMedia: async (url, rangeStart, signal): Promise<MediaResponse> => {
        const what = 'media download';
        // A signed media URL is its own authorisation (prototype-m0.md D13), so the device
        // credential is NOT attached. URLs on any origin but the API's are still refused.
        if (new URL(url).origin !== origin) {
          throw new PlayerFault('download_failed', `${what}: URL is not on the API origin`);
        }
        const headers: Record<string, string> = {};
        if (rangeStart !== null) headers.range = `bytes=${rangeStart}-`;
        const stall = new AbortController();
        let timer = setTimeout(() => {
          stall.abort();
        }, MEDIA_STALL_TIMEOUT_MS);
        const kick = (): void => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            stall.abort();
          }, MEDIA_STALL_TIMEOUT_MS);
        };
        let response: Response;
        try {
          response = await this.#fetch(url, {
            ...BASE_INIT,
            method: 'GET',
            headers,
            signal: AbortSignal.any([signal, stall.signal]),
          });
        } catch (err) {
          clearTimeout(timer);
          if (signal.aborted) throw new AbortedError();
          throw new PlayerFault(
            'network_error',
            stall.signal.aborted ? `${what}: no answer in time` : `${what}: server unreachable`,
            { cause: err },
          );
        }
        const body = response.body;
        const cancel = (): void => {
          clearTimeout(timer);
          stall.abort();
        };
        if (body === null || (response.status !== 200 && response.status !== 206)) {
          cancel();
          return {
            status: body === null && response.ok ? 502 : response.status,
            rangeStart: null,
            chunks: empty(),
            cancel,
          };
        }
        return {
          status: response.status,
          rangeStart: parseRangeStart(response.headers.get('content-range')),
          chunks: readChunks(body, kick, () => {
            clearTimeout(timer);
          }),
          cancel,
        };
      },

      releaseRegistration: async (timeoutMs): Promise<boolean> => {
        try {
          return await this.#request(
            'registration release',
            `${PLAYER_PREFIX}/registration`,
            { method: 'DELETE', headers: auth },
            async (response) => {
              await discard(response);
              return response.status === 204 || response.status === 200;
            },
            timeoutMs,
          );
        } catch {
          return false;
        }
      },

      heartbeat: async (heartbeat, signal): Promise<HeartbeatResponse> => {
        const what = 'heartbeat';
        return this.#request(
          what,
          ROUTES.playerHeartbeat,
          {
            method: 'POST',
            headers: { ...auth, 'content-type': 'application/json' },
            body: JSON.stringify(heartbeat),
            ...(signal ? { signal } : {}),
          },
          async (response) => {
            const guarded = await guard(what, response);
            if (guarded.status !== 200) return this.#fail(what, response);
            const parsed = HeartbeatResponseSchema.safeParse(await readJson(guarded, what));
            if (!parsed.success)
              throw new PlayerFault('internal_error', `${what}: unexpected response shape`);
            return parsed.data;
          },
        );
      },
    };
  }
}

/** First byte position of a `Content-Range: bytes 100-199/200` header; null when absent or unreadable. */
export function parseRangeStart(header: string | null): number | null {
  if (header === null) return null;
  const match = /^bytes (\d{1,15})-\d{1,15}\/(?:\d{1,15}|\*)$/.exec(header.trim());
  return match?.[1] === undefined ? null : Number(match[1]);
}

async function* empty(): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  // No body.
}

async function* readChunks(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
  onChunk: () => void,
  onDone: () => void,
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      onChunk();
      yield value;
    }
  } finally {
    onDone();
    await reader.cancel().catch(() => undefined);
  }
}
