import {
  isMediaItem,
  type ManifestAssetV1,
  type Manifest,
  type ManifestV1,
} from '@tinnox/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerFault } from './errors.ts';
import {
  makeAppItem,
  makeAsset,
  makeManifest,
  makeManifestV2,
  makeManifestV3,
} from './fakes.test-support.ts';
import {
  holdTimeMs,
  nextStep,
  PlaybackLoop,
  videoWatchdogMs,
  type PlaybackEvent,
  type PlaybackPosition,
  type Presenter,
  type ShownItem,
} from './playback.ts';
import { sleep } from './timing.ts';

async function manifestOf(
  ...specs: { kind?: 'image' | 'video'; durationMs: number }[]
): Promise<ManifestV1> {
  const assets: ManifestAssetV1[] = [];
  for (const [i, spec] of specs.entries()) assets.push((await makeAsset(100 + i, spec)).asset);
  return makeManifest(assets);
}

/** Monday 2026-11-16 13:00 in Melbourne, after the test manifests' createdAt. */
const NOW = Date.parse('2026-11-16T02:00:00Z');
const opts = { now: NOW, random: Math.random };

/** A position partway through a playlist played in listed order. */
function at(manifest: Manifest, index: number): PlaybackPosition {
  return { manifest, index, order: manifest.assets.map((_, i) => i), cursor: index };
}

/** Deterministic random numbers in [0, 1) (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Walks `count` boundaries from nothing playing; returns the manifest indexes shown. */
function walk(manifest: Manifest, count: number, random: () => number): number[] {
  const shown: number[] = [];
  let position: PlaybackPosition | null = null;
  for (let i = 0; i < count; i += 1) {
    const step = nextStep(position, manifest, { now: NOW, random });
    if (step === null || step === 'not_now') throw new Error('expected a step');
    expect(step.index).toBe(step.order[step.cursor]);
    shown.push(step.index);
    position = step;
  }
  return shown;
}

async function images(count: number): Promise<ManifestAssetV1[]> {
  const assets: ManifestAssetV1[] = [];
  for (let i = 0; i < count; i += 1)
    assets.push((await makeAsset(200 + i, { durationMs: 1_000 })).asset);
  return assets;
}

describe('nextStep (what to show at an item boundary)', () => {
  it('shows nothing without an active publication', async () => {
    expect(nextStep(null, null, opts)).toBeNull();
    const m = await manifestOf({ durationMs: 1000 });
    expect(nextStep(at(m, 0), null, opts)).toBeNull();
  });

  it('starts a publication at its first item', async () => {
    const m = await manifestOf({ durationMs: 1000 }, { durationMs: 1000 });
    expect(nextStep(null, m, opts)).toMatchObject({
      manifest: m,
      index: 0,
      switched: true,
      playable: 2,
    });
  });

  it('advances in order and wraps around', async () => {
    const m = await manifestOf({ durationMs: 1 }, { durationMs: 1 }, { durationMs: 1 });
    expect(walk(m, 7, Math.random)).toEqual([0, 1, 2, 0, 1, 2, 0]);
    expect(nextStep(at(m, 2), m, opts)).toMatchObject({ manifest: m, index: 0, switched: false });
  });

  it('repeats a one-item playlist', async () => {
    const m = await manifestOf({ durationMs: 1 });
    expect(nextStep(at(m, 0), m, opts)).toMatchObject({ manifest: m, index: 0, switched: false });
  });

  it('switches to a newly activated publication at the boundary, from its first item', async () => {
    const a = await manifestOf({ durationMs: 1 }, { durationMs: 1 }, { durationMs: 1 });
    const b = await manifestOf({ durationMs: 1 });
    expect(nextStep(at(a, 1), b, opts)).toMatchObject({ manifest: b, index: 0, switched: true });
  });

  it('shuffles: every round plays each item once, never the same item twice in a row', async () => {
    const m = makeManifestV2(await images(5), { shuffle: true });
    const shown = walk(m, 5 * 40, seeded(7));
    for (let round = 0; round < 40; round += 1) {
      expect([...shown.slice(round * 5, round * 5 + 5)].sort()).toEqual([0, 1, 2, 3, 4]);
    }
    shown.slice(1).forEach((index, i) => {
      expect(index).not.toBe(shown[i]);
    });
    // Not merely the listed order.
    expect(shown.slice(0, 10)).not.toEqual([0, 1, 2, 3, 4, 0, 1, 2, 3, 4]);
  });

  it('skips items outside their window', async () => {
    const m = makeManifestV2(await images(3));
    m.assets[1] = { ...m.assets[1]!, availableFrom: '2026-12-01T00:00' };
    expect(walk(m, 4, Math.random)).toEqual([0, 2, 0, 2]);
    expect(nextStep(null, m, opts)).toMatchObject({ playable: 2 });
  });

  it('shuffles only the items in their window, still without a repeat', async () => {
    const m = makeManifestV2(await images(5), { shuffle: true });
    m.assets[0] = { ...m.assets[0]!, availableUntil: '2026-11-01T00:00' };
    m.assets[3] = { ...m.assets[3]!, availableUntil: '2026-11-01T00:00' };
    const shown = walk(m, 60, seeded(11));
    expect(new Set(shown)).toEqual(new Set([1, 2, 4]));
    shown.slice(1).forEach((index, i) => {
      expect(index).not.toBe(shown[i]);
    });
  });

  it("says 'not_now' when nothing may be shown", async () => {
    const hours = { start: '09:00', end: '10:00' };
    const m = makeManifestV2(await images(2), {
      workingHours: [hours, hours, hours, hours, hours, hours, hours],
    });
    expect(nextStep(null, m, opts)).toBe('not_now');
    expect(nextStep(at(m, 0), m, opts)).toBe('not_now');
  });
});

describe('item timing', () => {
  it('holds an image for exactly its duration', async () => {
    const { asset } = await makeAsset(1, { kind: 'image', durationMs: 7_000 });
    expect(holdTimeMs(asset)).toBe(7_000);
  });

  it('gives a video its natural duration plus a margin before the watchdog fires', async () => {
    expect(videoWatchdogMs(10_000)).toBe(17_500);
    expect(videoWatchdogMs(600_000)).toBe(755_000);
    expect(videoWatchdogMs(1)).toBeGreaterThanOrEqual(5_000);
    const { asset } = await makeAsset(1, { kind: 'video', durationMs: 10_000 });
    expect(holdTimeMs(asset)).toBe(17_500);
  });

  it('holds an app for exactly its duration', () => {
    expect(holdTimeMs(makeAppItem(12_000))).toBe(12_000);
  });
});

interface Stage {
  presenter: Presenter;
  shown: string[];
  clears: number;
  /** assetId (appId for an app) → how the item behaves. */
  behaviour: Map<string, 'ok' | 'fail_to_show' | 'video_ends' | 'video_errors' | 'video_stalls'>;
}

function stage(videoPlayMs = 4_000): Stage {
  const s: Stage = {
    shown: [],
    clears: 0,
    behaviour: new Map(),
    presenter: {
      show: async (asset): Promise<ShownItem> => {
        const id = isMediaItem(asset) ? asset.assetId : asset.appId;
        const mode = s.behaviour.get(id) ?? (asset.kind === 'video' ? 'video_ends' : 'ok');
        if (mode === 'fail_to_show')
          throw new PlayerFault('decode_failed', 'injected: cannot show');
        s.shown.push(id);
        if (asset.kind !== 'video') return { finished: null };
        if (mode === 'video_stalls') return { finished: new Promise<void>(() => undefined) };
        const finished =
          mode === 'video_errors'
            ? sleep(500).then(() => {
                throw new PlayerFault('playback_error', 'injected: decoder error');
              })
            : sleep(videoPlayMs);
        finished.catch(() => undefined);
        return { finished };
      },
      clear: () => {
        s.clears += 1;
      },
    },
  };
  return s;
}

describe('PlaybackLoop', () => {
  let abort: AbortController;
  let events: PlaybackEvent[];
  let active: Manifest | null;

  function loop(s: Stage): PlaybackLoop {
    return new PlaybackLoop({
      loadActive: async () => active,
      presenter: s.presenter,
      clock: { now: () => Date.now() },
      sleep,
      random: Math.random,
      signal: abort.signal,
      onEvent: (e) => events.push(e),
    });
  }
  const started = (): number[] =>
    events.flatMap((e) => (e.type === 'item_started' ? [e.index] : []));

  beforeEach(() => {
    vi.useFakeTimers();
    abort = new AbortController();
    events = [];
    active = null;
  });
  afterEach(() => {
    abort.abort();
    vi.useRealTimers();
  });

  it('plays images for their durations, in order, and loops', async () => {
    active = await manifestOf({ durationMs: 3_000 }, { durationMs: 5_000 });
    const s = stage();
    loop(s).start();
    await vi.advanceTimersByTimeAsync(0);
    expect(started()).toEqual([0]);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(started()).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(started()).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(started()).toEqual([0, 1, 0]);
  });

  it('loops a single-item playlist', async () => {
    active = await manifestOf({ durationMs: 2_000 });
    const s = stage();
    loop(s).start();
    await vi.advanceTimersByTimeAsync(6_500);
    expect(started()).toEqual([0, 0, 0, 0]);
  });

  it('advances a video when it ends, not when the manifest duration elapses', async () => {
    active = await manifestOf({ kind: 'video', durationMs: 10_000 }, { durationMs: 1_000 });
    const s = stage(4_000);
    loop(s).start();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(started()).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(started()).toEqual([0, 1]);
    expect(events.some((e) => e.type === 'item_failed')).toBe(false);
  });

  it('skips a stalled video when the watchdog fires, and reports it', async () => {
    active = await manifestOf({ kind: 'video', durationMs: 10_000 }, { durationMs: 1_000 });
    const s = stage();
    s.behaviour.set(active.assets[0]!.assetId, 'video_stalls');
    loop(s).start();
    await vi.advanceTimersByTimeAsync(17_499);
    expect(started()).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1 + 500);
    expect(started()).toEqual([0, 1]);
    const failure = events.find((e) => e.type === 'item_failed');
    expect(failure).toMatchObject({
      error: { code: 'playback_error', assetId: active.assets[0]!.assetId },
    });
  });

  it('reports a runtime video error, skips the item and keeps the loop going', async () => {
    active = await manifestOf({ kind: 'video', durationMs: 10_000 }, { durationMs: 1_000 });
    const s = stage();
    s.behaviour.set(active.assets[0]!.assetId, 'video_errors');
    loop(s).start();
    await vi.advanceTimersByTimeAsync(500 + 500);
    expect(started()).toEqual([0, 1]);
    expect(events.filter((e) => e.type === 'item_failed')).toHaveLength(1);
    expect(events.some((e) => e.type === 'all_failed')).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000 + 500 + 500);
    expect(started()).toEqual([0, 1, 0, 1]);
  });

  it('skips an item that cannot be shown and continues with the rest', async () => {
    active = await manifestOf({ durationMs: 1_000 }, { durationMs: 1_000 }, { durationMs: 1_000 });
    const s = stage();
    s.behaviour.set(active.assets[1]!.assetId, 'fail_to_show');
    loop(s).start();
    await vi.advanceTimersByTimeAsync(1_000 + 500 + 1_000);
    expect(started()).toEqual([0, 2, 0]);
    expect(events.some((e) => e.type === 'all_failed')).toBe(false);
  });

  it('when every item fails: clears the screen, says so, never claims to play, and retries later', async () => {
    active = await manifestOf({ durationMs: 1_000 }, { durationMs: 1_000 });
    const s = stage();
    for (const asset of active.assets) s.behaviour.set(asset.assetId, 'fail_to_show');
    loop(s).start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started()).toEqual([]);
    expect(events.filter((e) => e.type === 'item_failed')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'all_failed')).toEqual([
      { type: 'all_failed', publicationId: active.publicationId },
    ]);
    expect(s.clears).toBeGreaterThan(0);
    // After the retry delay the content is tried again; if it now works, playback resumes.
    s.behaviour.clear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(started()).toEqual([0]);
  });

  it('shows nothing and waits when there is no publication, then starts when one is activated', async () => {
    const s = stage();
    const l = loop(s);
    l.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(events.map((e) => e.type)).toEqual(['no_content']);
    active = await manifestOf({ durationMs: 1_000 });
    l.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(started()).toEqual([0]);
    expect(events.map((e) => e.type)).toContain('version_adopted');
  });

  it('picks up a new version only at the item boundary of a video', async () => {
    const first = await manifestOf({ kind: 'video', durationMs: 10_000 });
    const second = await manifestOf({ durationMs: 1_000 });
    active = first;
    const s = stage(4_000);
    const l = loop(s);
    l.start();
    await vi.advanceTimersByTimeAsync(1_000);
    active = second;
    l.wake();
    await vi.advanceTimersByTimeAsync(2_000);
    // Still the first publication's video: it is allowed to finish.
    expect(s.shown).toEqual([first.assets[0]!.assetId]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.shown).toEqual([first.assets[0]!.assetId, second.assets[0]!.assetId]);
    expect(events.filter((e) => e.type === 'version_adopted')).toHaveLength(2);
  });

  it('lets a freshly activated version end a still image early', async () => {
    const first = await manifestOf({ durationMs: 3_600_000 });
    const second = await manifestOf({ durationMs: 1_000 });
    active = first;
    const s = stage();
    const l = loop(s);
    l.start();
    await vi.advanceTimersByTimeAsync(5_000);
    active = second;
    l.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.shown).toEqual([first.assets[0]!.assetId, second.assets[0]!.assetId]);
  });

  it('keeps playing the loaded version when state cannot be read at a boundary', async () => {
    active = await manifestOf({ durationMs: 1_000 }, { durationMs: 1_000 });
    const s = stage();
    let broken = false;
    const l = new PlaybackLoop({
      loadActive: async () => {
        if (broken) throw new Error('injected: IndexedDB unavailable');
        return active;
      },
      presenter: s.presenter,
      clock: { now: () => Date.now() },
      sleep,
      random: Math.random,
      signal: abort.signal,
      onEvent: (e) => events.push(e),
    });
    l.start();
    await vi.advanceTimersByTimeAsync(0);
    broken = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(started()).toEqual([0, 1, 0]);
    expect(events.some((e) => e.type === 'item_failed' && e.error.code === 'storage_error')).toBe(
      true,
    );
  });

  it('runs many cycles without accumulating timers', async () => {
    active = await manifestOf({ durationMs: 1_000 }, { kind: 'video', durationMs: 2_000 });
    const s = stage(2_000);
    loop(s).start();
    await vi.advanceTimersByTimeAsync(3_000 * 500);
    expect(started().length).toBeGreaterThanOrEqual(999);
    // One hold timer (plus at most the watchdog/finished pair of the current video).
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
  });

  it('gives all_failed after the playable items fail, when windows hide the rest', async () => {
    vi.setSystemTime(NOW);
    const m = makeManifestV2(await images(3));
    m.assets[0] = { ...m.assets[0]!, availableUntil: '2026-11-01T00:00' };
    active = m;
    const s = stage();
    s.behaviour.set(m.assets[1]!.assetId, 'fail_to_show');
    s.behaviour.set(m.assets[2]!.assetId, 'fail_to_show');
    loop(s).start();
    await vi.advanceTimersByTimeAsync(600);
    expect(events.filter((e) => e.type === 'item_failed')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'all_failed')).toHaveLength(1);
  });

  it('goes black outside working hours and resumes without a switch', async () => {
    // Monday 16:59:58 in Melbourne; open 09:00 to 17:00 every day.
    vi.setSystemTime(Date.parse('2026-11-16T05:59:58Z'));
    const hours = { start: '09:00', end: '17:00' };
    active = makeManifestV2(await images(2), {
      workingHours: [hours, hours, hours, hours, hours, hours, hours],
    });
    const s = stage();
    loop(s).start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(started()).toEqual([0, 1]);
    expect(events.at(-1)).toEqual({ type: 'no_content', reason: 'not_now' });
    expect(s.clears).toBe(1);
    // Tuesday 09:00: the next item in the round, not the first of a new publication.
    vi.setSystemTime(Date.parse('2026-11-16T22:00:00Z'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(started()).toEqual([0, 1, 0]);
    expect(events.filter((e) => e.type === 'version_adopted')).toHaveLength(1);
  });

  it('holds an app like an image, between media items, and reports its failure without an assetId', async () => {
    vi.setSystemTime(NOW);
    const [first, last] = await images(2);
    const app = makeAppItem(2_000);
    active = makeManifestV3([first!, app, last!]);
    const s = stage();
    loop(s).start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started()).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(started()).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(started()).toEqual([0, 1, 2]);

    s.behaviour.set(app.appId, 'fail_to_show');
    await vi.advanceTimersByTimeAsync(2_500);
    expect(events.find((e) => e.type === 'item_failed')).toMatchObject({
      error: { assetId: null },
    });
  });

  it('stops when aborted', async () => {
    active = await manifestOf({ durationMs: 1_000 });
    const s = stage();
    loop(s).start();
    await vi.advanceTimersByTimeAsync(1_500);
    abort.abort();
    const before = started().length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(started().length).toBe(before);
  });
});
