import type { ManifestAssetV1 } from '@tinnox/contracts';
import { backoffDelay, type BackoffPolicy } from './backoff.ts';
import {
  AbortedError,
  describeError,
  PlayerFault,
  RevokedError,
  throwIfAborted,
} from './errors.ts';
import { retryAfterMsOf, retryDelay } from './retry-after.ts';
import type { DeviceApi, Sleep } from './types.ts';

export const DOWNLOAD_BACKOFF: BackoffPolicy = {
  baseMs: 1_000,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.5,
};
export const DOWNLOAD_MAX_ATTEMPTS = 6;
/** An attempt that added at least this much is treated as progress and resets the failure count. */
const PROGRESS_BYTES = 1024 * 1024;

export interface DownloadDeps {
  /** Current signed URL for the asset. `refresh` forces new URLs to be requested. */
  getUrl(assetId: string, refresh: boolean): Promise<string>;
  fetchMedia: DeviceApi['fetchMedia'];
  sleep: Sleep;
  random: () => number;
  signal: AbortSignal;
  maxAttempts?: number;
  backoff?: BackoffPolicy;
}

/**
 * Downloads one asset as a stream and returns exactly `asset.bytes` bytes.
 *
 * - A broken or short transfer is resumed with a Range request from the last
 *   received byte. If the server answers 200 instead of 206 the transfer restarts.
 * - 401, 403 or 410 mean the signed URL is no longer accepted: new URLs are requested
 *   (that request fails with RevokedError when the device itself was revoked).
 * - More bytes than the manifest states stops the transfer at once (`size_mismatch`),
 *   so a wrong or hostile response cannot fill memory.
 *
 * The caller verifies the SHA-256 digest; this function only guarantees the length.
 */
export async function downloadAsset(asset: ManifestAssetV1, deps: DownloadDeps): Promise<Blob> {
  const maxAttempts = deps.maxAttempts ?? DOWNLOAD_MAX_ATTEMPTS;
  const policy = deps.backoff ?? DOWNLOAD_BACKOFF;
  let chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  let failures = 0;
  let refresh = false;
  let retryAfterMs: number | null = null;
  let last: { code: 'download_failed' | 'size_mismatch' | 'network_error'; detail: string } = {
    code: 'download_failed',
    detail: 'no attempt made',
  };

  const restart = (): void => {
    chunks = [];
    received = 0;
  };

  for (;;) {
    throwIfAborted(deps.signal);
    if (failures >= maxAttempts) {
      throw new PlayerFault(
        last.code,
        `download gave up after ${failures} attempts: ${last.detail}`,
        { assetId: asset.assetId },
      );
    }
    if (failures > 0) {
      await deps.sleep(
        retryDelay(backoffDelay(policy, failures, deps.random), retryAfterMs),
        deps.signal,
      );
      retryAfterMs = null;
    }

    let url: string;
    try {
      url = await deps.getUrl(asset.assetId, refresh);
      refresh = false;
    } catch (err) {
      if (err instanceof RevokedError || err instanceof AbortedError) throw err;
      if (err instanceof PlayerFault && err.status === 404) {
        // The server answers 404 when the publication is no longer the display's current
        // one. Retrying cannot help; the caller asks for the newer manifest instead.
        throw new PlayerFault(
          'download_failed',
          'the server no longer issues media URLs for this publication (HTTP 404)',
          { assetId: asset.assetId, status: 404 },
        );
      }
      failures += 1;
      retryAfterMs = retryAfterMsOf(err);
      last = {
        code: 'download_failed',
        detail: `could not get a media URL: ${describeError(err)}`,
      };
      continue;
    }

    let response;
    try {
      response = await deps.fetchMedia(url, received > 0 ? received : null, deps.signal);
    } catch (err) {
      if (err instanceof RevokedError || err instanceof AbortedError) throw err;
      throwIfAborted(deps.signal);
      failures += 1;
      last = { code: 'network_error', detail: describeError(err) };
      continue;
    }

    const status = response.status;
    if (status === 401 || status === 403 || status === 410) {
      response.cancel();
      refresh = true;
      failures += 1;
      last = { code: 'download_failed', detail: `media URL rejected (HTTP ${status})` };
      continue;
    }
    if (status === 404) {
      response.cancel();
      throw new PlayerFault('download_failed', 'asset not found on the server (HTTP 404)', {
        assetId: asset.assetId,
        status,
      });
    }
    if (status === 416) {
      response.cancel();
      restart();
      failures += 1;
      last = { code: 'download_failed', detail: 'server refused the resume range (HTTP 416)' };
      continue;
    }
    if (status !== 200 && status !== 206) {
      response.cancel();
      failures += 1;
      retryAfterMs = status === 429 ? response.retryAfterMs : null;
      last = { code: 'download_failed', detail: `unexpected HTTP ${status}` };
      continue;
    }
    if (status === 200 && received > 0) restart(); // The server ignored the Range header.
    if (status === 206 && response.rangeStart !== null && response.rangeStart !== received) {
      response.cancel();
      restart();
      failures += 1;
      last = { code: 'download_failed', detail: 'server answered with a different byte range' };
      continue;
    }

    const before = received;
    try {
      for await (const chunk of response.chunks) {
        throwIfAborted(deps.signal);
        received += chunk.byteLength;
        if (received > asset.bytes) {
          response.cancel();
          throw new PlayerFault(
            'size_mismatch',
            `server sent more than the ${asset.bytes} bytes stated in the manifest`,
            { assetId: asset.assetId },
          );
        }
        chunks.push(chunk);
      }
    } catch (err) {
      if (err instanceof AbortedError || err instanceof RevokedError) throw err;
      if (err instanceof PlayerFault && err.code === 'size_mismatch') throw err;
      throwIfAborted(deps.signal);
      // Keep what arrived; the next attempt resumes from `received`.
      failures = received - before >= PROGRESS_BYTES ? 1 : failures + 1;
      last = { code: 'network_error', detail: `transfer interrupted: ${describeError(err)}` };
      continue;
    }

    if (received === asset.bytes) return new Blob(chunks, { type: asset.mediaType });

    failures = received - before >= PROGRESS_BYTES ? 1 : failures + 1;
    last = {
      code: 'size_mismatch',
      detail: `transfer ended after ${received} of ${asset.bytes} bytes`,
    };
  }
}
