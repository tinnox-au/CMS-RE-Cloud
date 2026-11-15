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

  async #request(
    what: string,
    path: string,
    init: RequestInit,
    timeoutMs: number = JSON_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const outer = init.signal ?? null;
    const signal = outer === null ? controller.signal : AbortSignal.any([outer, controller.signal]);
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await this.#fetch(`${this.#base}${path}`, { ...BASE_INIT, ...init, signal });
    } catch (err) {
      if (outer?.aborted === true) throw new AbortedError();
      throw new PlayerFault(
        'network_error',
        controller.signal.aborted
          ? `${what}: no answer within ${timeoutMs} ms`
          : `${what}: server unreachable`,
        { cause: err },
      );
    } finally {
      clearTimeout(timer);
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
    const response = await this.#request(what, ROUTES.playerPairing, {
      method: 'POST',
      ...(signal ? { signal } : {}),
    });
    if (response.status !== 200 && response.status !== 201) return this.#fail(what, response);
    const parsed = PairingCreateResponseSchema.safeParse(await readJson(response, what));
    if (!parsed.success)
      throw new PlayerFault('internal_error', `${what}: unexpected response shape`);
    return parsed.data;
  }

  /** `GET /player/pairing/:id` with the polling token. `gone` means the session cannot be used any more. */
  async pollPairing(
    pairingId: string,
    pollingToken: string,
    signal?: AbortSignal,
  ): Promise<PairingPollResult> {
    const what = 'pairing poll';
    const response = await this.#request(what, ROUTES.playerPairingPoll(pairingId), {
      method: 'GET',
      headers: bearer(pollingToken),
      ...(signal ? { signal } : {}),
    });
    if (response.status === 404 || response.status === 401 || response.status === 410) {
      await discard(response);
      return { status: 'gone' };
    }
    if (response.status !== 200) return this.#fail(what, response);
    const parsed = PairingPollResponseSchema.safeParse(await readJson(response, what));
    if (!parsed.success)
      throw new PlayerFault('internal_error', `${what}: unexpected response shape`);
    return parsed.data;
  }

  /** Player calls bound to one device credential. */
  forDevice(deviceToken: string): DeviceApi & {
    heartbeat(body: HeartbeatV1): Promise<HeartbeatResponse>;
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
      fetchManifest: async (ifNoneMatchPublicationId): Promise<ManifestFetchResult> => {
        const what = 'manifest poll';
        const headers: Record<string, string> = { ...auth, accept: 'application/json' };
        if (ifNoneMatchPublicationId !== null) {
          headers['if-none-match'] = manifestEtag(ifNoneMatchPublicationId);
        }
        const response = await guard(
          what,
          await this.#request(what, ROUTES.playerManifest, { method: 'GET', headers }),
        );
        if (response.status === 304) return { kind: 'not_modified' };
        if (response.status === 204) return { kind: 'none' };
        const body = await readJson(response, what);
        const envelope = ManifestEnvelopeSchema.safeParse(body);
        // A body without a manifest is passed on as-is so it is reported as a malformed manifest.
        return { kind: 'manifest', raw: envelope.success ? envelope.data.manifest : body };
      },

      requestMediaUrls: async (publicationId, assetIds): Promise<MediaUrlsResponse> => {
        const what = 'media URL request';
        const body = MediaUrlsRequestSchema.parse({ publicationId, assetIds: [...assetIds] });
        const response = await guard(
          what,
          await this.#request(what, ROUTES.playerMediaUrls, {
            method: 'POST',
            headers: { ...auth, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        );
        if (response.status !== 200) return this.#fail(what, response);
        const parsed = MediaUrlsResponseSchema.safeParse(await readJson(response, what));
        if (!parsed.success)
          throw new PlayerFault('internal_error', `${what}: unexpected response shape`);
        return parsed.data;
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
          const response = await this.#request(
            'registration release',
            `${PLAYER_PREFIX}/registration`,
            { method: 'DELETE', headers: auth },
            timeoutMs,
          );
          await discard(response);
          return response.status === 204 || response.status === 200;
        } catch {
          return false;
        }
      },

      heartbeat: async (heartbeat): Promise<HeartbeatResponse> => {
        const what = 'heartbeat';
        const response = await guard(
          what,
          await this.#request(what, ROUTES.playerHeartbeat, {
            method: 'POST',
            headers: { ...auth, 'content-type': 'application/json' },
            body: JSON.stringify(heartbeat),
          }),
        );
        if (response.status !== 200) return this.#fail(what, response);
        const parsed = HeartbeatResponseSchema.safeParse(await readJson(response, what));
        if (!parsed.success)
          throw new PlayerFault('internal_error', `${what}: unexpected response shape`);
        return parsed.data;
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
