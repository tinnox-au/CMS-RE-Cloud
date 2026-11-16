import type { PlayerError } from '@tinnox/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { PlayerFault, RevokedError } from './errors.ts';
import {
  API_ORIGIN,
  digestBlob,
  DISPLAY_ID,
  FakeDeviceApi,
  instantSleep,
  makeAsset,
  makeManifest,
  makeManifestV2,
  MemoryAssetStore,
  MemoryStateStore,
  REGISTRATION_ID,
  type TestAsset,
} from './fakes.test-support.ts';
import { SyncLoop, syncCycle, type CycleResult, type SyncDeps } from './sync.ts';

interface World {
  state: MemoryStateStore;
  assets: MemoryAssetStore;
  api: FakeDeviceApi;
  reported: PlayerError[];
  attempts: string[];
  deps: SyncDeps;
  a: TestAsset;
  b: TestAsset;
}

async function world(): Promise<World> {
  const state = new MemoryStateStore();
  const assets = new MemoryAssetStore();
  const api = new FakeDeviceApi();
  const reported: PlayerError[] = [];
  const attempts: string[] = [];
  const a = await makeAsset(1);
  const b = await makeAsset(2);
  api.serve(a);
  api.serve(b);
  return {
    state,
    assets,
    api,
    reported,
    attempts,
    a,
    b,
    deps: {
      registrationId: REGISTRATION_ID,
      displayId: DISPLAY_ID,
      apiOrigin: API_ORIGIN,
      state,
      assets,
      api,
      digest: digestBlob,
      probe: async () => undefined,
      inUse: () => new Set(),
      clock: { now: () => Date.parse('2026-11-14T03:00:00.000Z') },
      sleep: instantSleep(),
      random: () => 0.5,
      signal: new AbortController().signal,
      report: (e) => reported.push(e),
      onAttempt: (id) => attempts.push(id),
    },
  };
}

describe('syncCycle', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  it('first publication: polls without If-None-Match, downloads and activates', async () => {
    const manifest = makeManifest([w.a.asset]);
    w.api.manifestResults = [{ kind: 'manifest', raw: manifest }];
    const result = await syncCycle(w.deps);
    expect(result).toEqual({ kind: 'activated', publicationId: manifest.publicationId });
    expect(w.api.calls.fetchManifest[0]).toBeNull();
    expect(w.state.active?.manifest).toEqual(manifest);
    expect(w.reported).toEqual([]);
  });

  it('sends the active publication as If-None-Match and does nothing on 304', async () => {
    const manifest = makeManifest([w.a.asset]);
    w.assets.seed(w.a);
    w.state.active = { manifest, activatedAt: '2026-11-14T02:00:00.000Z' };
    w.api.manifestResults = [{ kind: 'not_modified' }];
    expect(await syncCycle(w.deps)).toEqual({ kind: 'up_to_date' });
    expect(w.api.calls.fetchManifest).toEqual([manifest.publicationId]);
    expect(w.api.calls.requestMediaUrls).toEqual([]);
  });

  it('keeps playing when nothing is published (204)', async () => {
    const manifest = makeManifest([w.a.asset]);
    w.state.active = { manifest, activatedAt: '2026-11-14T02:00:00.000Z' };
    w.api.manifestResults = [{ kind: 'none' }];
    expect(await syncCycle(w.deps)).toEqual({ kind: 'up_to_date' });
    expect(w.state.active.manifest).toEqual(manifest);
  });

  it('ignores a repeat of the publication that is already active (stale or uncached response)', async () => {
    const manifest = makeManifest([w.a.asset]);
    w.assets.seed(w.a);
    w.state.active = { manifest, activatedAt: '2026-11-14T02:00:00.000Z' };
    w.api.manifestResults = [{ kind: 'manifest', raw: manifest }];
    expect(await syncCycle(w.deps)).toEqual({ kind: 'up_to_date' });
    expect(w.attempts).toEqual([]);
    expect(w.state.putStagingCalls).toBe(0);
  });

  it('reports an unreachable server and changes nothing', async () => {
    const manifest = makeManifest([w.a.asset]);
    w.state.active = { manifest, activatedAt: '2026-11-14T02:00:00.000Z' };
    w.api.manifestResults = [new PlayerFault('network_error', 'manifest poll: server unreachable')];
    const result = await syncCycle(w.deps);
    expect(result.kind).toBe('unreachable');
    expect(w.reported.map((e) => e.code)).toEqual(['network_error']);
    expect(w.state.active.manifest).toEqual(manifest);
  });

  it.each([
    ['not an object', 'just text'],
    ['no schema version', { publicationId: 'x' }],
    ['missing assets', { schemaVersion: 1, publicationId: crypto.randomUUID() }],
    ['empty asset list', null],
    ['unknown extra field', undefined],
    ['bad hash', undefined],
    ['content rectangle outside the canvas', undefined],
  ])('rejects a malformed manifest (%s) and keeps the current version', async (name, raw) => {
    const current = makeManifest([w.a.asset]);
    w.state.active = { manifest: current, activatedAt: '2026-11-14T02:00:00.000Z' };
    const base = makeManifest([w.b.asset]);
    let body: unknown = raw;
    if (name === 'empty asset list') body = { ...base, assets: [] };
    if (name === 'unknown extra field') body = { ...base, script: 'alert(1)' };
    if (name === 'bad hash') body = { ...base, assets: [{ ...w.b.asset, sha256: 'ABC' }] };
    if (name === 'content rectangle outside the canvas') {
      body = { ...base, contentRect: { x: 1900, y: 0, width: 100, height: 100 } };
    }
    w.api.manifestResults = [{ kind: 'manifest', raw: body }];
    const result = await syncCycle(w.deps);
    expect(result.kind).toBe('update_failed');
    expect(w.reported.map((e) => e.code)).toEqual(['manifest_malformed']);
    expect(w.state.active.manifest).toEqual(current);
    expect(w.state.staging).toBeNull();
    expect(w.api.calls.requestMediaUrls).toEqual([]);
  });

  it('downloads and activates a v2 manifest', async () => {
    const manifest = makeManifestV2([w.a.asset], { transition: 'fade', rotation: 90 });
    w.api.manifestResults = [{ kind: 'manifest', raw: manifest }];
    const result = await syncCycle(w.deps);
    expect(result).toEqual({ kind: 'activated', publicationId: manifest.publicationId });
    expect(w.state.active?.manifest).toEqual(manifest);
  });

  it('reports an unsupported manifest version separately', async () => {
    w.api.manifestResults = [
      { kind: 'manifest', raw: { ...makeManifest([w.a.asset]), schemaVersion: 3 } },
    ];
    const result = await syncCycle(w.deps);
    expect(result.kind).toBe('update_failed');
    expect(w.reported.map((e) => e.code)).toEqual(['manifest_unsupported_version']);
    expect(w.state.active).toBeNull();
  });

  it('refuses a manifest addressed to another display', async () => {
    const foreign = makeManifest([w.a.asset], { displayId: crypto.randomUUID() });
    w.api.manifestResults = [{ kind: 'manifest', raw: foreign }];
    const result = await syncCycle(w.deps);
    expect(result.kind).toBe('update_failed');
    expect(w.reported[0]?.code).toBe('manifest_malformed');
    expect(w.state.active).toBeNull();
    expect(w.api.calls.requestMediaUrls).toEqual([]);
  });

  it('reports a failed update with its publication id and keeps the old version', async () => {
    const current = makeManifest([w.a.asset]);
    w.assets.seed(w.a);
    w.state.active = { manifest: current, activatedAt: '2026-11-14T02:00:00.000Z' };
    const next = makeManifest([w.b.asset]);
    w.api.media.delete(w.b.asset.assetId);
    w.api.manifestResults = [{ kind: 'manifest', raw: next }];
    const result = await syncCycle(w.deps);
    expect(result).toMatchObject({ kind: 'update_failed', publicationId: next.publicationId });
    expect(w.reported.map((e) => e.code)).toEqual(['download_failed']);
    expect(w.state.active.manifest).toEqual(current);
    expect(w.attempts).toEqual([next.publicationId]);
  });

  it('follows a publication that was superseded during the download and activates the newest', async () => {
    const first = makeManifest([w.a.asset]);
    const second = makeManifest([w.b.asset]);
    w.api.manifestResults = [
      { kind: 'manifest', raw: first }, // the poll
      { kind: 'manifest', raw: second }, // the check before activating `first`
      { kind: 'not_modified' }, // the check before activating `second`
    ];
    const result = await syncCycle(w.deps);
    expect(result).toEqual({ kind: 'activated', publicationId: second.publicationId });
    expect(w.attempts).toEqual([first.publicationId, second.publicationId]);
    expect(w.state.active?.manifest).toEqual(second);
    // The superseded publication's asset is not left behind.
    expect(w.assets.blobs.has(w.a.asset.sha256)).toBe(false);
  });

  it('gives up for this cycle when publications keep changing', async () => {
    const chain = [
      makeManifest([w.a.asset]),
      makeManifest([w.b.asset]),
      makeManifest([w.a.asset]),
      makeManifest([w.b.asset]),
    ];
    w.api.manifestResults = chain.map((raw) => ({ kind: 'manifest', raw }) as const);
    const result = await syncCycle(w.deps);
    expect(result.kind).toBe('update_failed');
    expect(w.state.active).toBeNull();
  });

  it('passes revocation up from the manifest poll', async () => {
    w.api.manifestResults = [new RevokedError()];
    await expect(syncCycle(w.deps)).rejects.toBeInstanceOf(RevokedError);
  });
});

describe('SyncLoop', () => {
  it('tells the app about every finished cycle, so resolved errors can be cleared', async () => {
    const w = await world();
    const manifest = makeManifest([w.a.asset]);
    w.api.manifestResults = [{ kind: 'manifest', raw: manifest }, { kind: 'not_modified' }];
    const abort = new AbortController();
    const settled: CycleResult[] = [];
    const activated: string[] = [];
    const done = new Promise<void>((resolve) => {
      const loop = new SyncLoop(
        { ...w.deps, signal: abort.signal },
        {
          onRevoked: () => undefined,
          onActivated: (id) => activated.push(id),
          onSettled: (result) => {
            settled.push(result);
            if (settled.length === 2) {
              abort.abort();
              resolve();
            }
          },
        },
      );
      loop.start();
    });
    await done;
    expect(activated).toEqual([manifest.publicationId]);
    expect(settled).toEqual([
      { kind: 'activated', publicationId: manifest.publicationId },
      { kind: 'up_to_date' },
    ]);
  });
});
