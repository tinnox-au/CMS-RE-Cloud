import { isQuotaError, PlayerFault } from '../core/errors.ts';
import type { AssetStore, StorageEstimate } from '../core/types.ts';

/** Every media cache of this player starts with this prefix. The shell cache does not. */
export const MEDIA_CACHE_PREFIX = 'tinnox-media-v1:';

/** One cache per organisation and registration, so content can never cross either boundary. */
export function mediaCacheName(orgId: string, registrationId: string): string {
  return `${MEDIA_CACHE_PREFIX}${orgId}:${registrationId}`;
}

const KEY_PATH = '/__asset/';
const BYTES_HEADER = 'x-asset-bytes';
const SHA_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Media bytes in Cache Storage, keyed by SHA-256 under a synthetic same-origin
 * URL that is never requested from the network. Only verified bytes are stored.
 */
export class CacheAssetStore implements AssetStore {
  readonly #caches: CacheStorage;
  readonly #name: string;
  readonly #origin: string;

  constructor(caches: CacheStorage, name: string, origin: string) {
    this.#caches = caches;
    this.#name = name;
    this.#origin = origin;
  }

  #key(sha256: string): string {
    if (!SHA_PATTERN.test(sha256)) throw new PlayerFault('internal_error', 'invalid asset hash');
    return `${this.#origin}${KEY_PATH}${sha256}`;
  }

  async #open(): Promise<Cache> {
    return this.#caches.open(this.#name);
  }

  async has(sha256: string, bytes: number): Promise<boolean> {
    const cache = await this.#open();
    const response = await cache.match(this.#key(sha256));
    if (response === undefined) return false;
    const stored = Number(response.headers.get(BYTES_HEADER));
    await response.body?.cancel().catch(() => undefined);
    return Number.isSafeInteger(stored) && stored === bytes;
  }

  async put(sha256: string, mediaType: string, blob: Blob): Promise<void> {
    const key = this.#key(sha256);
    try {
      const cache = await this.#open();
      await cache.put(
        key,
        new Response(blob, {
          status: 200,
          headers: {
            'content-type': mediaType,
            'content-length': String(blob.size),
            [BYTES_HEADER]: String(blob.size),
          },
        }),
      );
    } catch (err) {
      if (isQuotaError(err)) {
        throw new PlayerFault(
          'quota_exceeded',
          'the browser refused to store the asset: storage quota reached',
          {
            cause: err,
          },
        );
      }
      throw new PlayerFault('storage_error', 'could not write the asset to the cache', {
        cause: err,
      });
    }
  }

  async getBlob(sha256: string): Promise<Blob | null> {
    const cache = await this.#open();
    const response = await cache.match(this.#key(sha256));
    if (response === undefined) return null;
    return response.blob();
  }

  async list(): Promise<string[]> {
    const cache = await this.#open();
    const requests = await cache.keys();
    const hashes: string[] = [];
    for (const request of requests) {
      const path = new URL(request.url).pathname;
      if (!path.startsWith(KEY_PATH)) continue;
      const hash = path.slice(KEY_PATH.length);
      if (SHA_PATTERN.test(hash)) hashes.push(hash);
    }
    return hashes;
  }

  async delete(sha256: string): Promise<void> {
    const cache = await this.#open();
    await cache.delete(this.#key(sha256));
  }

  async estimate(): Promise<StorageEstimate | null> {
    return storageEstimate();
  }
}

export async function storageEstimate(): Promise<StorageEstimate | null> {
  try {
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.usage !== 'number' || typeof estimate.quota !== 'number') return null;
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return null;
  }
}

/**
 * Deletes every media cache of this origin, whatever organisation or registration
 * it belonged to. The player shell cache (static build files) is left alone.
 * Returns the names that were removed.
 */
export async function deleteAllMediaCaches(caches: CacheStorage): Promise<string[]> {
  const removed: string[] = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith('tinnox-media-')) continue;
    if (await caches.delete(name)) removed.push(name);
  }
  return removed;
}

/** Asks the browser not to evict this origin's storage. The answer is a request result, not a guarantee. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
