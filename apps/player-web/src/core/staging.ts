import {
  parseManifest,
  type ManifestAssetV1,
  type ManifestV1,
  type PlayerError,
} from '@tinnox/contracts';
import { downloadAsset } from './download.ts';
import {
  AbortedError,
  PlayerFault,
  RevokedError,
  throwIfAborted,
  toPlayerError,
} from './errors.ts';
import {
  manifestHashes,
  uniqueAssets,
  type AssetStore,
  type Clock,
  type DeviceApi,
  type Sleep,
  type StagingRecord,
  type StateStore,
} from './types.ts';

/** New URLs are requested when the current ones have less than this left. */
const URL_EXPIRY_MARGIN_MS = 20_000;

export interface StagingDeps {
  /** The registration this update is for; activation is refused if it changed meanwhile. */
  readonly registrationId: string;
  /** Origin of the player API. Signed media URLs on any other origin are refused. */
  readonly apiOrigin: string;
  readonly state: StateStore;
  readonly assets: AssetStore;
  readonly api: DeviceApi;
  /** Lower-case hex SHA-256 of the blob. */
  digest(blob: Blob): Promise<string>;
  /** Resolves when the bytes actually decode as the stated media type; rejects otherwise. */
  probe(asset: ManifestAssetV1, blob: Blob): Promise<void>;
  /** Hashes the renderer has on screen right now; never garbage-collected. */
  inUse(): ReadonlySet<string>;
  readonly clock: Clock;
  readonly sleep: Sleep;
  readonly random: () => number;
  readonly signal: AbortSignal;
  onProgress?(record: StagingRecord | null): void;
}

export type StageOutcome =
  | { readonly kind: 'activated'; readonly publicationId: string }
  | { readonly kind: 'failed'; readonly error: PlayerError }
  /** The server published something newer while this one was downloading. */
  | { readonly kind: 'superseded'; readonly next: ManifestV1 };

function iso(clock: Clock): string {
  return new Date(clock.now()).toISOString();
}

/** Signed URLs for the assets of one publication, renewed when they expire. */
class UrlBook {
  readonly #deps: StagingDeps;
  readonly #publicationId: string;
  readonly #assetIds: readonly string[];
  #urls = new Map<string, { url: string; expiresAtMs: number }>();

  constructor(deps: StagingDeps, publicationId: string, assetIds: readonly string[]) {
    this.#deps = deps;
    this.#publicationId = publicationId;
    this.#assetIds = assetIds;
  }

  async get(assetId: string, refresh: boolean): Promise<string> {
    const known = this.#urls.get(assetId);
    const fresh =
      known !== undefined && known.expiresAtMs - this.#deps.clock.now() > URL_EXPIRY_MARGIN_MS;
    if (known !== undefined && fresh && !refresh) return known.url;

    const response = await this.#deps.api.requestMediaUrls(this.#publicationId, this.#assetIds);
    if (response.publicationId !== this.#publicationId) {
      throw new PlayerFault('download_failed', 'media URLs were issued for another publication');
    }
    const next = new Map<string, { url: string; expiresAtMs: number }>();
    for (const entry of response.urls) {
      let origin: string;
      try {
        origin = new URL(entry.url).origin;
      } catch {
        throw new PlayerFault('download_failed', 'server issued a malformed media URL');
      }
      if (origin !== this.#deps.apiOrigin) {
        // The device credential is attached to media requests; never send it elsewhere.
        throw new PlayerFault(
          'download_failed',
          'server issued a media URL on an unexpected origin',
        );
      }
      next.set(entry.assetId, { url: entry.url, expiresAtMs: Date.parse(entry.expiresAt) });
    }
    this.#urls = next;
    const issued = next.get(assetId);
    if (issued === undefined) {
      throw new PlayerFault('download_failed', 'server issued no URL for a required asset', {
        assetId,
      });
    }
    return issued.url;
  }
}

/**
 * Removes cached assets that nothing needs. An asset is kept when it belongs to
 * the active version, to the staging version, or is on screen right now.
 * If the state cannot be read, nothing is deleted.
 */
export async function collectGarbage(
  deps: Pick<StagingDeps, 'state' | 'assets' | 'inUse'>,
): Promise<{ removed: string[]; kept: number }> {
  const [active, staging, cached] = await Promise.all([
    deps.state.getActive(),
    deps.state.getStaging(),
    deps.assets.list(),
  ]);
  const keep = new Set<string>(deps.inUse());
  if (active !== null) for (const hash of manifestHashes(active.manifest)) keep.add(hash);
  if (staging !== null) for (const hash of manifestHashes(staging.manifest)) keep.add(hash);
  const removed: string[] = [];
  for (const hash of cached) {
    if (keep.has(hash)) continue;
    await deps.assets.delete(hash);
    removed.push(hash);
  }
  return { removed, kept: cached.length - removed.length };
}

/**
 * Two-phase update (prototype-m0.md D14).
 *
 * 1. Staging: every asset of `manifest` is downloaded (unless already cached),
 *    checked for exact length and SHA-256, stored, and probed for decodability.
 * 2. Activation: one atomic state-store transaction makes the publication active.
 *
 * Until step 2 succeeds the active version is not touched, so any failure, at any
 * point, leaves the previous publication playing. RevokedError and AbortedError
 * are thrown to the caller; every other failure is returned as `failed`.
 */
export async function stagePublication(
  manifest: ManifestV1,
  deps: StagingDeps,
): Promise<StageOutcome> {
  const { state, assets } = deps;
  const publicationId = manifest.publicationId;
  const unique = uniqueAssets(manifest);
  let record: StagingRecord = {
    manifest,
    phase: 'downloading',
    assetsDone: 0,
    assetsTotal: unique.length,
    startedAt: iso(deps.clock),
  };
  let currentAssetId: string | null = null;

  const save = async (patch: Partial<StagingRecord>): Promise<void> => {
    record = { ...record, ...patch };
    await state.putStaging(record);
    deps.onProgress?.(record);
  };

  try {
    throwIfAborted(deps.signal);
    await save({});

    const missing: ManifestAssetV1[] = [];
    let done = 0;
    for (const asset of unique) {
      if (await assets.has(asset.sha256, asset.bytes)) done += 1;
      else missing.push(asset);
    }
    if (done > 0) await save({ assetsDone: done });

    if (missing.length > 0) {
      const needed = missing.reduce((sum, asset) => sum + asset.bytes, 0);
      const estimate = await assets.estimate();
      if (estimate !== null && needed > estimate.quota - estimate.usage) {
        throw new PlayerFault(
          'quota_exceeded',
          `update needs ${needed} bytes but the browser reports ${Math.max(0, estimate.quota - estimate.usage)} bytes free`,
        );
      }

      const urls = new UrlBook(deps, publicationId, [
        ...new Set(missing.map((asset) => asset.assetId)),
      ]);
      for (const asset of missing) {
        throwIfAborted(deps.signal);
        currentAssetId = asset.assetId;
        const blob = await downloadAsset(asset, {
          getUrl: (assetId, refresh) => urls.get(assetId, refresh),
          fetchMedia: (url, rangeStart, signal) => deps.api.fetchMedia(url, rangeStart, signal),
          sleep: deps.sleep,
          random: deps.random,
          signal: deps.signal,
        });
        if (blob.size !== asset.bytes) {
          throw new PlayerFault('size_mismatch', `expected ${asset.bytes} bytes, got ${blob.size}`);
        }
        const digest = await deps.digest(blob);
        if (digest !== asset.sha256) {
          throw new PlayerFault(
            'integrity_mismatch',
            'SHA-256 of the download does not match the manifest',
          );
        }
        await assets.put(asset.sha256, asset.mediaType, blob);
        done += 1;
        await save({ assetsDone: done });
      }
    }

    await save({ phase: 'verifying' });
    for (const asset of unique) {
      throwIfAborted(deps.signal);
      currentAssetId = asset.assetId;
      const blob = await assets.getBlob(asset.sha256);
      if (blob === null || blob.size !== asset.bytes) {
        // Evicted or damaged between download and verification: drop it so a retry downloads again.
        await assets.delete(asset.sha256).catch(() => undefined);
        throw new PlayerFault('storage_error', 'a verified asset is missing from the cache');
      }
      await deps.probe(asset, blob);
    }
    currentAssetId = null;
    await save({ phase: 'ready' });

    // The publication may have been replaced while it was downloading. Ask once more;
    // if the question cannot be answered (offline), the verified version is still activated.
    const newer = await newerManifest(deps, manifest);
    if (newer !== null) {
      await state.clearStaging();
      deps.onProgress?.(null);
      return { kind: 'superseded', next: newer };
    }

    throwIfAborted(deps.signal);
    const activated = await state.activate(deps.registrationId, manifest, iso(deps.clock));
    if (!activated) {
      throw new PlayerFault(
        'storage_error',
        'registration changed during the update; not activated',
      );
    }
    deps.onProgress?.(null);
  } catch (err) {
    if (err instanceof RevokedError || err instanceof AbortedError) throw err;
    if (deps.signal.aborted) throw new AbortedError();
    if (err instanceof PlayerFault && err.status === 404) {
      // The server no longer serves this publication's media. The usual reason is that
      // something newer was published meanwhile: move on to it at once, without backoff.
      const newer = await newerManifest(deps, manifest);
      if (newer !== null) {
        await state.clearStaging().catch(() => undefined);
        deps.onProgress?.(null);
        return { kind: 'superseded', next: newer };
      }
    }
    const error = toPlayerError(err, {
      at: iso(deps.clock),
      publicationId,
      assetId: currentAssetId,
      fallbackCode: 'internal_error',
    });
    try {
      if (error.code === 'quota_exceeded') {
        // Give the space back: forget this update and remove what only it needed.
        await state.clearStaging();
        deps.onProgress?.(null);
        await collectGarbage(deps);
      } else {
        // Keep the record: assets already verified are reused by the next attempt.
        record = { ...record, phase: 'failed' };
        await state.putStaging(record);
        deps.onProgress?.(record);
      }
    } catch {
      // Storage is failing too. The active version is untouched, which is what matters.
      deps.onProgress?.({ ...record, phase: 'failed' });
    }
    return { kind: 'failed', error };
  }

  // Activation is committed. Cleaning up is best effort and can never undo it.
  try {
    await collectGarbage(deps);
  } catch {
    // Unreferenced assets stay until the next successful collection.
  }
  return { kind: 'activated', publicationId };
}

async function newerManifest(deps: StagingDeps, staged: ManifestV1): Promise<ManifestV1 | null> {
  try {
    const result = await deps.api.fetchManifest(staged.publicationId);
    if (result.kind !== 'manifest') return null;
    const parsed = parseManifest(result.raw);
    if (!parsed.ok) return null;
    if (parsed.manifest.publicationId === staged.publicationId) return null;
    if (parsed.manifest.displayId !== staged.displayId) return null;
    return parsed.manifest;
  } catch (err) {
    if (err instanceof RevokedError || err instanceof AbortedError) throw err;
    return null;
  }
}
