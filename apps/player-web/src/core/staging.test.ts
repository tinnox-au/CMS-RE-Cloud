import { beforeEach, describe, expect, it } from 'vitest';
import { AbortedError, PlayerFault, RevokedError } from './errors.ts';
import {
  API_ORIGIN,
  bytesOf,
  digestBlob,
  FakeDeviceApi,
  instantSleep,
  makeAsset,
  makeManifest,
  MemoryAssetStore,
  MemoryStateStore,
  REGISTRATION_ID,
  type TestAsset,
} from './fakes.test-support.ts';
import { collectGarbage, stagePublication, type StagingDeps } from './staging.ts';
import type { ManifestV1 } from '@tinnox/contracts';

interface World {
  state: MemoryStateStore;
  assets: MemoryAssetStore;
  api: FakeDeviceApi;
  abort: AbortController;
  inUse: Set<string>;
  probed: string[];
  probeFailure: PlayerFault | null;
  deps: StagingDeps;
  /** The publication that was playing before the update: assets `shared` and `oldOnly`. */
  old: ManifestV1;
  shared: TestAsset;
  oldOnly: TestAsset;
  /** The update: assets `shared`, `fresh1`, `fresh2`. */
  next: ManifestV1;
  fresh1: TestAsset;
  fresh2: TestAsset;
}

async function world(): Promise<World> {
  const state = new MemoryStateStore();
  const assets = new MemoryAssetStore();
  const api = new FakeDeviceApi();
  const abort = new AbortController();
  const inUse = new Set<string>();
  const shared = await makeAsset(1);
  const oldOnly = await makeAsset(2);
  const fresh1 = await makeAsset(3, { length: 100 });
  const fresh2 = await makeAsset(4, { length: 80, kind: 'video' });
  const old = makeManifest([shared.asset, oldOnly.asset]);
  const next = makeManifest([shared.asset, fresh1.asset, fresh2.asset, fresh1.asset]);
  assets.seed(shared);
  assets.seed(oldOnly);
  state.active = { manifest: old, activatedAt: '2026-11-14T00:30:00.000Z' };
  for (const asset of [shared, oldOnly, fresh1, fresh2]) api.serve(asset);
  const w: World = {
    state,
    assets,
    api,
    abort,
    inUse,
    probed: [],
    probeFailure: null,
    old,
    shared,
    oldOnly,
    next,
    fresh1,
    fresh2,
    deps: {
      registrationId: REGISTRATION_ID,
      apiOrigin: API_ORIGIN,
      state,
      assets,
      api,
      digest: digestBlob,
      probe: async (asset) => {
        w.probed.push(asset.assetId);
        if (w.probeFailure !== null && asset.assetId === w.probeFailure.assetId)
          throw w.probeFailure;
      },
      inUse: () => inUse,
      clock: { now: () => Date.parse('2026-11-14T02:00:00.000Z') },
      sleep: instantSleep(),
      random: () => 0.5,
      signal: abort.signal,
    },
  };
  api.now = w.deps.clock.now;
  return w;
}

/** The single property every failure case must keep: the old version is exactly as it was. */
function expectOldVersionIntact(w: World): void {
  expect(w.state.active?.manifest.publicationId).toBe(w.old.publicationId);
  expect(w.state.active?.manifest).toEqual(w.old);
  expect(w.assets.blobs.has(w.shared.asset.sha256)).toBe(true);
  expect(w.assets.blobs.has(w.oldOnly.asset.sha256)).toBe(true);
}

describe('stagePublication: success', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  it('downloads only what is missing, verifies, probes, activates, then collects garbage', async () => {
    const progress: (string | null)[] = [];
    const outcome = await stagePublication(w.next, {
      ...w.deps,
      onProgress: (r) =>
        progress.push(r === null ? null : `${r.phase}:${r.assetsDone}/${r.assetsTotal}`),
    });

    expect(outcome).toEqual({ kind: 'activated', publicationId: w.next.publicationId });
    expect(w.state.active?.manifest).toEqual(w.next);
    expect(w.state.staging).toBeNull();
    // The shared asset was already cached: it is not requested or downloaded again.
    expect(w.api.calls.requestMediaUrls).toEqual([
      [w.fresh1.asset.assetId, w.fresh2.asset.assetId],
    ]);
    expect(w.api.calls.fetchMedia.map((c) => c.assetId)).toEqual([
      w.fresh1.asset.assetId,
      w.fresh2.asset.assetId,
    ]);
    // Every distinct asset of the new version is probed, including the one that was already cached.
    expect(w.probed).toEqual([
      w.shared.asset.assetId,
      w.fresh1.asset.assetId,
      w.fresh2.asset.assetId,
    ]);
    // Stored bytes are exactly the served bytes.
    expect(await digestBlob(w.assets.blobs.get(w.fresh1.asset.sha256)!)).toBe(
      w.fresh1.asset.sha256,
    );
    // Garbage collection: the asset only the old version used is gone; the shared one stays.
    expect(w.assets.deleted).toEqual([w.oldOnly.asset.sha256]);
    expect([...w.assets.blobs.keys()].sort()).toEqual(
      [w.shared.asset.sha256, w.fresh1.asset.sha256, w.fresh2.asset.sha256].sort(),
    );
    expect(progress).toEqual([
      'downloading:0/3',
      'downloading:1/3',
      'downloading:2/3',
      'downloading:3/3',
      'verifying:3/3',
      'ready:3/3',
      null,
    ]);
  });

  it('does not collect an asset that is still on screen from the old version', async () => {
    w.inUse.add(w.oldOnly.asset.sha256);
    await stagePublication(w.next, w.deps);
    expect(w.assets.blobs.has(w.oldOnly.asset.sha256)).toBe(true);
    // Once the renderer lets go, the next collection removes it.
    w.inUse.clear();
    const result = await collectGarbage(w.deps);
    expect(result.removed).toEqual([w.oldOnly.asset.sha256]);
  });

  it('activates without any download when every asset is already cached', async () => {
    w.assets.seed(w.fresh1);
    w.assets.seed(w.fresh2);
    const outcome = await stagePublication(w.next, w.deps);
    expect(outcome.kind).toBe('activated');
    expect(w.api.calls.requestMediaUrls).toEqual([]);
    expect(w.api.calls.fetchMedia).toEqual([]);
  });

  it('replaces a cached entry whose size is wrong instead of trusting it', async () => {
    w.assets.blobs.set(w.fresh1.asset.sha256, new Blob([bytesOf(10, 9)]));
    const outcome = await stagePublication(w.next, w.deps);
    expect(outcome.kind).toBe('activated');
    expect(w.assets.blobs.get(w.fresh1.asset.sha256)?.size).toBe(w.fresh1.asset.bytes);
  });

  it('keeps activation even when garbage collection fails afterwards', async () => {
    w.assets.delete = async () => {
      throw new Error('injected: delete failed');
    };
    const outcome = await stagePublication(w.next, w.deps);
    expect(outcome.kind).toBe('activated');
    expect(w.state.active?.manifest.publicationId).toBe(w.next.publicationId);
  });

  it('asks for new URLs when the first ones are rejected mid-update (expired)', async () => {
    w.api.script.set(w.fresh2.asset.assetId, [{ kind: 'status', status: 403 }]);
    const outcome = await stagePublication(w.next, w.deps);
    expect(outcome.kind).toBe('activated');
    expect(w.api.calls.requestMediaUrls).toHaveLength(2);
  });

  it('asks for new URLs before using ones that are about to expire', async () => {
    let now = Date.parse('2026-11-14T02:00:00.000Z');
    w.api.urlLifetimeMs = 60_000;
    w.api.now = () => now;
    const sleep = instantSleep();
    const deps: StagingDeps = {
      ...w.deps,
      clock: { now: () => now },
      // Time passes during the first download: 55 s later the URLs have 5 s left.
      digest: async (blob) => {
        now += 55_000;
        return digestBlob(blob);
      },
      sleep,
    };
    const outcome = await stagePublication(w.next, deps);
    expect(outcome.kind).toBe('activated');
    expect(w.api.calls.requestMediaUrls).toHaveLength(2);
  });

  it('resumes an interrupted transfer with a Range request and still verifies the whole file', async () => {
    w.api.script.set(w.fresh1.asset.assetId, [{ kind: 'break', after: 32 }]);
    const outcome = await stagePublication(w.next, w.deps);
    expect(outcome.kind).toBe('activated');
    const calls = w.api.calls.fetchMedia.filter((c) => c.assetId === w.fresh1.asset.assetId);
    expect(calls).toEqual([
      { assetId: w.fresh1.asset.assetId, rangeStart: null },
      { assetId: w.fresh1.asset.assetId, rangeStart: 32 },
    ]);
    expect(await digestBlob(w.assets.blobs.get(w.fresh1.asset.sha256)!)).toBe(
      w.fresh1.asset.sha256,
    );
  });

  it('starts over when the server ignores the Range header', async () => {
    w.api.script.set(w.fresh1.asset.assetId, [
      { kind: 'break', after: 48 },
      { kind: 'ignore_range' },
    ]);
    const outcome = await stagePublication(w.next, w.deps);
    expect(outcome.kind).toBe('activated');
    expect(await digestBlob(w.assets.blobs.get(w.fresh1.asset.sha256)!)).toBe(
      w.fresh1.asset.sha256,
    );
  });
});

describe('stagePublication: a failure at any step keeps the previous version', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  async function expectFailure(code: string): Promise<void> {
    const outcome = await stagePublication(w.next, w.deps);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.error.code).toBe(code);
      expect(outcome.error.publicationId).toBe(w.next.publicationId);
    }
    expectOldVersionIntact(w);
  }

  it('step 1, recording the staging version fails (storage)', async () => {
    w.state.failing.add('putStaging');
    await expectFailure('internal_error');
    expect(w.api.calls.fetchMedia).toEqual([]);
  });

  it('step 2, the storage estimate says there is not enough room', async () => {
    w.assets.quota = 150; // 128 used by the old version; the update needs 180 more
    await expectFailure('quota_exceeded');
    expect(w.api.calls.fetchMedia).toEqual([]);
    expect(w.state.staging).toBeNull();
  });

  it('step 3, media URLs cannot be obtained', async () => {
    w.api.mediaUrlsFailure = new PlayerFault('network_error', 'injected: unreachable');
    await expectFailure('download_failed');
    expect(w.state.staging?.phase).toBe('failed');
  });

  it('step 3, media URLs point at another origin (credential must not follow)', async () => {
    w.api.urlOrigin = 'http://elsewhere.test';
    await expectFailure('download_failed');
    expect(w.api.calls.fetchMedia).toEqual([]);
  });

  it('step 4, an asset is not on the server', async () => {
    w.api.media.delete(w.fresh2.asset.assetId);
    await expectFailure('download_failed');
    // What was already verified is kept for the retry, and is protected by the staging record.
    expect(w.assets.blobs.has(w.fresh1.asset.sha256)).toBe(true);
    expect(w.state.staging?.phase).toBe('failed');
    expect((await collectGarbage(w.deps)).removed).toEqual([]);
  });

  it('step 4, the connection keeps failing', async () => {
    w.api.script.set(
      w.fresh1.asset.assetId,
      Array.from({ length: 10 }, () => ({ kind: 'unreachable' }) as const),
    );
    await expectFailure('network_error');
  });

  it('step 4, the download is truncated every time', async () => {
    const short = w.fresh1.data.slice(0, 40);
    w.api.script.set(
      w.fresh1.asset.assetId,
      Array.from({ length: 10 }, () => ({ kind: 'bytes', data: short }) as const),
    );
    await expectFailure('size_mismatch');
    expect(w.assets.blobs.has(w.fresh1.asset.sha256)).toBe(false);
  });

  it('step 4, the server sends more bytes than the manifest states', async () => {
    w.api.script.set(w.fresh1.asset.assetId, [{ kind: 'bytes', data: bytesOf(4_000, 5) }]);
    await expectFailure('size_mismatch');
    // Stopped at once: no retry storm, nothing stored.
    expect(w.api.calls.fetchMedia.filter((c) => c.assetId === w.fresh1.asset.assetId)).toHaveLength(
      1,
    );
    expect(w.assets.blobs.has(w.fresh1.asset.sha256)).toBe(false);
  });

  it('step 5, the bytes have the right length but the wrong SHA-256 (corruption)', async () => {
    const corrupt = w.fresh1.data.slice();
    corrupt[10] = (corrupt[10]! + 1) % 256;
    w.api.script.set(w.fresh1.asset.assetId, [{ kind: 'bytes', data: corrupt }]);
    await expectFailure('integrity_mismatch');
    expect(w.assets.blobs.has(w.fresh1.asset.sha256)).toBe(false);
  });

  it('step 6, the browser runs out of space while storing (QuotaExceededError)', async () => {
    w.assets.putFailure = 'quota';
    await expectFailure('quota_exceeded');
    expect(w.state.staging).toBeNull();
  });

  it('step 6, a partly stored update is removed again when space runs out', async () => {
    // First new asset fits; the second does not.
    const realPut = w.assets.put.bind(w.assets);
    let puts = 0;
    w.assets.put = async (sha, type, blob) => {
      puts += 1;
      if (puts > 1) throw new PlayerFault('quota_exceeded', 'injected: quota reached');
      await realPut(sha, type, blob);
    };
    await expectFailure('quota_exceeded');
    expect(w.assets.blobs.has(w.fresh1.asset.sha256)).toBe(false);
    expect(w.assets.blobs.size).toBe(2);
  });

  it('step 6, writing to the cache fails for another reason', async () => {
    w.assets.putFailure = 'error';
    await expectFailure('storage_error');
  });

  it('step 7, a stored asset has vanished before verification (eviction)', async () => {
    const realGet = w.assets.getBlob.bind(w.assets);
    w.assets.getBlob = async (sha) => (sha === w.fresh2.asset.sha256 ? null : realGet(sha));
    await expectFailure('storage_error');
  });

  it('step 7, an asset does not decode in this browser', async () => {
    w.probeFailure = new PlayerFault('decode_failed', 'injected: cannot decode', {
      assetId: w.fresh2.asset.assetId,
    });
    const outcome = await stagePublication(w.next, w.deps);
    expect(outcome).toMatchObject({
      kind: 'failed',
      error: { code: 'decode_failed', assetId: w.fresh2.asset.assetId },
    });
    expectOldVersionIntact(w);
  });

  it('step 7, a video uses an unsupported codec', async () => {
    w.probeFailure = new PlayerFault('unsupported_media', 'injected: codec', {
      assetId: w.fresh2.asset.assetId,
    });
    await expectFailure('unsupported_media');
  });

  it('step 8, the activation transaction fails', async () => {
    w.state.failing.add('activate');
    await expectFailure('internal_error');
    expect(w.state.staging?.phase).toBe('failed');
  });

  it('step 8, the registration changed while the update was running', async () => {
    w.state.registration = { ...w.state.registration!, registrationId: crypto.randomUUID() };
    const outcome = await stagePublication(w.next, w.deps);
    expect(outcome).toMatchObject({ kind: 'failed', error: { code: 'storage_error' } });
    expect(w.state.active?.manifest.publicationId).toBe(w.old.publicationId);
  });

  it('storage failing completely still returns a failure and leaves the active version', async () => {
    w.state.failPutStagingAfter = 1;
    w.assets.putFailure = 'error';
    await expectFailure('internal_error');
  });

  it('revocation during the update is passed up and nothing is activated', async () => {
    w.api.mediaUrlsFailure = new RevokedError();
    await expect(stagePublication(w.next, w.deps)).rejects.toBeInstanceOf(RevokedError);
    expectOldVersionIntact(w);
  });

  it('a URL rejection followed by a revoked device is treated as revocation', async () => {
    w.api.script.set(w.fresh1.asset.assetId, [{ kind: 'status', status: 401 }]);
    const realRequest = w.api.requestMediaUrls.bind(w.api);
    let calls = 0;
    w.api.requestMediaUrls = async (publicationId, assetIds) => {
      calls += 1;
      if (calls > 1) throw new RevokedError();
      return realRequest(publicationId, assetIds);
    };
    await expect(stagePublication(w.next, w.deps)).rejects.toBeInstanceOf(RevokedError);
    expectOldVersionIntact(w);
  });

  it('an abort (reset, shutdown) stops the update without activating', async () => {
    const realFetch = w.api.fetchMedia.bind(w.api);
    w.api.fetchMedia = async (url, range, signal) => {
      w.abort.abort();
      return realFetch(url, range, signal);
    };
    await expect(stagePublication(w.next, w.deps)).rejects.toBeInstanceOf(AbortedError);
    expectOldVersionIntact(w);
  });

  it('with no previous version, a failed first update leaves the player with nothing active', async () => {
    w.state.active = null;
    w.api.media.delete(w.fresh1.asset.assetId);
    const outcome = await stagePublication(w.next, w.deps);
    expect(outcome.kind).toBe('failed');
    expect(w.state.active).toBeNull();
  });
});

describe('stagePublication: a newer publication appears during the update', () => {
  it('does not activate the superseded one and hands back the newer manifest', async () => {
    const w = await world();
    const newer = makeManifest([w.shared.asset]);
    w.api.manifestResults = [{ kind: 'manifest', raw: newer }];
    const outcome = await stagePublication(w.next, w.deps);
    expect(outcome).toEqual({ kind: 'superseded', next: newer });
    expect(w.api.calls.fetchManifest).toEqual([w.next.publicationId]);
    expectOldVersionIntact(w);
    expect(w.state.staging).toBeNull();
  });

  it('moves on at once when the server stops issuing media URLs for it (HTTP 404)', async () => {
    const w = await world();
    const newer = makeManifest([w.shared.asset]);
    w.api.mediaUrlsFailure = new PlayerFault('network_error', 'injected: HTTP 404', {
      status: 404,
    });
    w.api.manifestResults = [{ kind: 'manifest', raw: newer }];
    const sleep = instantSleep();
    const outcome = await stagePublication(w.next, { ...w.deps, sleep });
    expect(outcome).toEqual({ kind: 'superseded', next: newer });
    // No retry and no backoff: one URL request, no download, no waiting.
    expect(w.api.calls.requestMediaUrls).toHaveLength(1);
    expect(w.api.calls.fetchMedia).toEqual([]);
    expect(sleep.delays).toEqual([]);
    expectOldVersionIntact(w);
    expect(w.state.staging).toBeNull();
  });

  it('reports a failure when media URLs are refused (404) and nothing newer exists', async () => {
    const w = await world();
    w.api.mediaUrlsFailure = new PlayerFault('network_error', 'injected: HTTP 404', {
      status: 404,
    });
    w.api.manifestResults = [{ kind: 'not_modified' }];
    const outcome = await stagePublication(w.next, w.deps);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.error.code).toBe('download_failed');
    expect(w.api.calls.requestMediaUrls).toHaveLength(1);
    expectOldVersionIntact(w);
  });

  it('activates when the server confirms it is still current, or cannot be asked', async () => {
    const confirmed = await world();
    confirmed.api.manifestResults = [{ kind: 'not_modified' }];
    expect((await stagePublication(confirmed.next, confirmed.deps)).kind).toBe('activated');

    const offline = await world();
    offline.api.manifestResults = [new PlayerFault('network_error', 'injected: offline')];
    expect((await stagePublication(offline.next, offline.deps)).kind).toBe('activated');

    const garbage = await world();
    garbage.api.manifestResults = [{ kind: 'manifest', raw: { schemaVersion: 1, nonsense: true } }];
    expect((await stagePublication(garbage.next, garbage.deps)).kind).toBe('activated');
  });
});

describe('collectGarbage', () => {
  it('never removes an asset of the active version, the staging version, or one on screen', async () => {
    const w = await world();
    const stray = await makeAsset(50);
    const onScreen = await makeAsset(51);
    w.assets.seed(stray);
    w.assets.seed(onScreen);
    w.assets.seed(w.fresh1);
    w.inUse.add(onScreen.asset.sha256);
    w.state.staging = {
      manifest: w.next,
      phase: 'downloading',
      assetsDone: 1,
      assetsTotal: 3,
      startedAt: '2026-11-14T02:00:00.000Z',
    };
    const result = await collectGarbage(w.deps);
    expect(result.removed).toEqual([stray.asset.sha256]);
    for (const kept of [w.shared, w.oldOnly, w.fresh1, onScreen]) {
      expect(w.assets.blobs.has(kept.asset.sha256)).toBe(true);
    }
  });

  it('removes nothing when the state cannot be read', async () => {
    const w = await world();
    w.assets.seed(await makeAsset(60));
    w.state.failing.add('getActive');
    await expect(collectGarbage(w.deps)).rejects.toThrow();
    expect(w.assets.deleted).toEqual([]);
  });

  it('removes everything unreferenced when nothing is active or staging', async () => {
    const w = await world();
    w.state.active = null;
    const result = await collectGarbage(w.deps);
    expect(result.removed.sort()).toEqual([w.shared.asset.sha256, w.oldOnly.asset.sha256].sort());
  });
});
