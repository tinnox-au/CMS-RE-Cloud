import {
  isMediaItem,
  type ManifestAssetV1,
  type Manifest,
  type ManifestScheduleEvent,
  type ManifestV1,
  type ManifestV4,
  type Transition,
} from '@tinnox/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerFault } from './errors.ts';
import {
  EVERY_DAY,
  instantSleep,
  makeAppItem,
  makeAsset,
  makeManifest,
  makeManifestV2,
  makeManifestV3,
  makeManifestV4,
  type TestPlaylist,
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
function walk(manifest: Manifest, count: number, random: () => number, now = NOW): number[] {
  const shown: number[] = [];
  let position: PlaybackPosition | null = null;
  for (let i = 0; i < count; i += 1) {
    const step = nextStep(position, manifest, { now, random });
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

/** A moment on Monday 2026-11-16 in Melbourne (UTC+11), after the test manifests' createdAt. */
const monday = (time: string): number => Date.parse(`2026-11-16T${time}+11:00`);

const event = (playlist: number, start: string, end: string): ManifestScheduleEvent => ({
  playlist,
  days: EVERY_DAY,
  start,
  end,
});

type ItemSpec = { kind?: 'image' | 'video'; durationMs: number };

/**
 * A v4 manifest with one playlist per entry of `playlists` (the first is the default), in one
 * flat list: `[[a, b], [c]]` gives the default at indexes 0 and 1 and an event playlist at 2.
 */
async function scheduledOf(
  playlists: readonly (
    readonly ItemSpec[] | (Omit<TestPlaylist, 'items'> & { items: ItemSpec[] })
  )[],
  events: readonly ManifestScheduleEvent[],
  overrides: Partial<ManifestV4> = {},
): Promise<ManifestV4> {
  const built: TestPlaylist[] = [];
  let seed = 300;
  for (const playlist of playlists) {
    const { items: specs, ...options } = 'items' in playlist ? playlist : { items: playlist };
    const items: ManifestAssetV1[] = [];
    for (const spec of specs) {
      items.push((await makeAsset(seed, spec)).asset);
      seed += 1;
    }
    built.push({ ...options, items });
  }
  return makeManifestV4(built, events, overrides);
}

const second = { durationMs: 1_000 };

describe('nextStep with a schedule (v4)', () => {
  it("starts in the playlist the schedule picks, with that playlist's order and transition", async () => {
    const m = await scheduledOf(
      [[second, second, second], { items: [second, second], transition: 'fade' }],
      [event(1, '12:00', '14:00')],
    );
    expect(nextStep(null, m, { now: monday('13:00:00'), random: Math.random })).toEqual({
      manifest: m,
      index: 3,
      order: [3, 4],
      cursor: 0,
      switched: true,
      restarted: true,
      slice: 1,
      transition: 'fade',
      playable: 2,
    });
    expect(nextStep(null, m, { now: monday('15:00:00'), random: Math.random })).toMatchObject({
      index: 0,
      order: [0, 1, 2],
      slice: 0,
      transition: 'cut',
      playable: 3,
    });
  });

  it('rebuilds the order over the new playlist when an event starts and ends, without a switch', async () => {
    const m = await scheduledOf(
      [[second, second, second], { items: [second, second], transition: 'fade' }],
      [event(1, '12:00', '14:00')],
    );
    const random = Math.random;
    const first = nextStep(null, m, { now: monday('11:59:58'), random });
    const next = nextStep(first as PlaybackPosition, m, { now: monday('11:59:59'), random });
    expect(next).toMatchObject({ index: 1, cursor: 1, switched: false, restarted: false });

    // The event starts: its playlist from its first item, not a new publication.
    const started = nextStep(next as PlaybackPosition, m, { now: monday('12:00:00'), random });
    expect(started).toMatchObject({
      index: 3,
      order: [3, 4],
      cursor: 0,
      switched: false,
      restarted: true,
      slice: 1,
      transition: 'fade',
    });
    const inside = nextStep(started as PlaybackPosition, m, { now: monday('12:00:01'), random });
    expect(inside).toMatchObject({ index: 4, cursor: 1, restarted: false, slice: 1 });
    const wrapped = nextStep(inside as PlaybackPosition, m, { now: monday('12:00:02'), random });
    expect(wrapped).toMatchObject({ index: 3, order: [3, 4], cursor: 0, restarted: false });

    // The event ends: the default playlist from its first item.
    const back = nextStep(wrapped as PlaybackPosition, m, { now: monday('14:00:00'), random });
    expect(back).toMatchObject({
      index: 0,
      order: [0, 1, 2],
      cursor: 0,
      switched: false,
      restarted: true,
      slice: 0,
      transition: 'cut',
    });
  });

  it('shuffles a playlist inside its own slice, and leaves the other playlist as listed', async () => {
    const m = await scheduledOf(
      [[second, second], { items: [second, second, second, second, second], shuffle: true }],
      [event(1, '12:00', '14:00')],
    );
    const shown = walk(m, 5 * 40, seeded(7), monday('13:00:00'));
    for (let round = 0; round < 40; round += 1) {
      expect([...shown.slice(round * 5, round * 5 + 5)].sort()).toEqual([2, 3, 4, 5, 6]);
    }
    shown.slice(1).forEach((index, i) => {
      expect(index).not.toBe(shown[i]);
    });
    expect(shown.slice(0, 10)).not.toEqual([2, 3, 4, 5, 6, 2, 3, 4, 5, 6]);
    expect(walk(m, 5, seeded(7), monday('15:00:00'))).toEqual([0, 1, 0, 1, 0]);
  });

  it('draws the same random numbers for a playlist as a v2 manifest does for its one list', async () => {
    const v2 = makeManifestV2(await images(5), { shuffle: true });
    const expected = walk(v2, 30, seeded(11));
    // The default playlist of a schedule (slice 0, from 0): the very same walk.
    const five = [second, second, second, second, second];
    const asDefault = await scheduledOf(
      [{ items: five, shuffle: true }, [second]],
      [event(1, '20:00', '21:00')],
    );
    expect(walk(asDefault, 30, seeded(11))).toEqual(expected);
    // An event playlist that starts at index 2: the same walk, two further on.
    const asEvent = await scheduledOf(
      [[second, second], { items: five, shuffle: true }],
      [event(1, '00:00', '24:00')],
    );
    expect(walk(asEvent, 30, seeded(11))).toEqual(expected.map((index) => index + 2));
  });

  it('passes over a playlist in skipSlices', async () => {
    const m = await scheduledOf(
      [[second], [second], [second]],
      [event(1, '12:00', '14:00'), event(2, '12:00', '14:00')],
    );
    const options = { now: monday('13:00:00'), random: Math.random };
    expect(nextStep(null, m, options)).toMatchObject({ index: 1, slice: 1 });
    expect(nextStep(null, m, { ...options, skipSlices: new Set([1]) })).toMatchObject({
      index: 2,
      slice: 2,
    });
    expect(nextStep(null, m, { ...options, skipSlices: new Set([1, 2]) })).toMatchObject({
      index: 0,
      slice: 0,
    });
  });

  it('reports slice 0, the manifest transition and one restart for v1 to v3', async () => {
    const v1 = await manifestOf(second, second);
    const first = nextStep(null, v1, opts);
    expect(first).toMatchObject({ restarted: true, slice: 0, transition: 'cut', order: [0, 1] });
    expect(nextStep(first as PlaybackPosition, v1, opts)).toMatchObject({
      index: 1,
      switched: false,
      restarted: false,
      slice: 0,
    });
    const v2 = makeManifestV2(await images(2), { transition: 'fade' });
    expect(nextStep(null, v2, opts)).toMatchObject({ slice: 0, transition: 'fade' });
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
  /** The transition the loop asked for with each item that was shown. */
  transitions: Transition[];
  clears: number;
  /** assetId (appId for an app) → how the item behaves. */
  behaviour: Map<string, 'ok' | 'fail_to_show' | 'video_ends' | 'video_errors' | 'video_stalls'>;
}

function stage(videoPlayMs = 4_000): Stage {
  const s: Stage = {
    shown: [],
    transitions: [],
    clears: 0,
    behaviour: new Map(),
    presenter: {
      show: async (asset, _manifest, _signal, transition): Promise<ShownItem> => {
        const id = isMediaItem(asset) ? asset.assetId : asset.appId;
        const mode = s.behaviour.get(id) ?? (asset.kind === 'video' ? 'video_ends' : 'ok');
        if (mode === 'fail_to_show')
          throw new PlayerFault('decode_failed', 'injected: cannot show');
        s.shown.push(id);
        s.transitions.push(transition);
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

  it('does not cut a v2 still at a working-hours edge (rules at item boundaries, as released)', async () => {
    // Monday 16:59:58 in Melbourne; open 09:00 to 17:00 every day.
    vi.setSystemTime(monday('16:59:58'));
    const hours = { start: '09:00', end: '17:00' };
    active = makeManifestV2([(await makeAsset(1, { durationMs: 10_000 })).asset], {
      workingHours: [hours, hours, hours, hours, hours, hours, hours],
    });
    const s = stage();
    loop(s).start();
    // 17:00:07.999: closed for eight seconds, the image is still held.
    await vi.advanceTimersByTimeAsync(9_999);
    expect(started()).toEqual([0]);
    expect(events.some((e) => e.type === 'no_content')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(events.at(-1)).toEqual({ type: 'no_content', reason: 'not_now' });
  });

  describe('with a schedule (v4)', () => {
    const tenSeconds = { durationMs: 10_000 };
    const count = (type: PlaybackEvent['type']): number =>
      events.filter((e) => e.type === type).length;
    /** Makes every item of the playlist at the given flat indexes fail to show. */
    function breakItems(s: Stage, m: ManifestV4, ...indexes: number[]): void {
      for (const index of indexes) {
        const item = m.assets[index];
        if (item !== undefined && isMediaItem(item)) s.behaviour.set(item.assetId, 'fail_to_show');
      }
    }

    it('cuts a still of the default playlist at the minute an event starts, without adopting a version', async () => {
      vi.setSystemTime(monday('10:59:58'));
      active = await scheduledOf(
        [[tenSeconds], { items: [{ durationMs: 5_000 }], transition: 'fade' }],
        [event(1, '11:00', '12:00')],
      );
      const s = stage();
      loop(s).start();
      await vi.advanceTimersByTimeAsync(0);
      expect(started()).toEqual([0]);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(started()).toEqual([0]);
      // 11:00:00, two seconds into a ten-second image: the event's item starts.
      await vi.advanceTimersByTimeAsync(1);
      expect(started()).toEqual([0, 1]);
      // The same publication all along, and each item shown with its own playlist's transition.
      expect(count('version_adopted')).toBe(1);
      expect(s.transitions).toEqual(['cut', 'fade']);
      // The event's item is held for its own time while the event is on.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(started()).toEqual([0, 1, 1]);
    });

    it('cuts a still at a working-hours edge too', async () => {
      vi.setSystemTime(monday('16:59:58'));
      const hours = { start: '09:00', end: '17:00' };
      active = await scheduledOf([[tenSeconds], [tenSeconds]], [event(1, '20:00', '21:00')], {
        workingHours: [hours, hours, hours, hours, hours, hours, hours],
      });
      const s = stage();
      loop(s).start();
      await vi.advanceTimersByTimeAsync(1_999);
      expect(events.some((e) => e.type === 'no_content')).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(events.at(-1)).toEqual({ type: 'no_content', reason: 'not_now' });
    });

    it('does not cut a video when an event starts', async () => {
      vi.setSystemTime(monday('10:59:58'));
      active = await scheduledOf(
        [[{ kind: 'video', durationMs: 10_000 }], [tenSeconds]],
        [event(1, '11:00', '12:00')],
      );
      const s = stage(4_000);
      loop(s).start();
      // 11:00:01.999: the event has been on for two seconds, the video still plays.
      await vi.advanceTimersByTimeAsync(3_999);
      expect(started()).toEqual([0]);
      await vi.advanceTimersByTimeAsync(1);
      expect(started()).toEqual([0, 1]);
      expect(count('item_failed')).toBe(0);
    });

    it('resets the failure counter on a playlist change', async () => {
      // The default playlist's first item fails 200 ms before the event starts.
      vi.setSystemTime(monday('10:59:59.800'));
      const m = await scheduledOf(
        [
          [second, second],
          [second, second],
        ],
        [event(1, '11:00', '12:00')],
      );
      active = m;
      const s = stage();
      breakItems(s, m, 0, 2);
      loop(s).start();
      await vi.advanceTimersByTimeAsync(1_000);
      // One failure in each playlist. Counted together they would equal the event playlist's
      // two items and it would be passed over; its second item plays instead.
      expect(count('item_failed')).toBe(2);
      expect(started()).toEqual([3]);
      expect(count('all_failed')).toBe(0);
    });

    it('falls back to the default when an event playlist fails, without all_failed or a cleared screen, and tries it again after the event ended', async () => {
      vi.setSystemTime(monday('11:00:00'));
      // Two events with the same playlist: 11:00 to 11:02, and again from 11:03.
      const m = await scheduledOf(
        [[tenSeconds], [tenSeconds]],
        [event(1, '11:00', '11:02'), event(1, '11:03', '11:10')],
      );
      active = m;
      const s = stage();
      breakItems(s, m, 1);
      loop(s).start();
      await vi.advanceTimersByTimeAsync(500);
      expect(count('item_failed')).toBe(1);
      expect(started()).toEqual([0]);
      expect(count('all_failed')).toBe(0);
      expect(s.clears).toBe(0);
      // 11:02:30: the first event has ended; nothing was tried in between.
      await vi.advanceTimersByTimeAsync(149_500);
      expect(count('item_failed')).toBe(1);
      expect(new Set(started())).toEqual(new Set([0]));
      // 11:03:00, two minutes before the five-minute retry: the event is on again and is tried.
      s.behaviour.clear();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(started().at(-1)).toBe(1);
      expect(s.clears).toBe(0);
    });

    it('a failed event playlist is tried again while the same event is still on', async () => {
      vi.setSystemTime(monday('11:00:00'));
      const m = await scheduledOf([[tenSeconds], [tenSeconds]], [event(1, '11:00', '12:00')]);
      active = m;
      const s = stage();
      breakItems(s, m, 1);
      loop(s).start();
      await vi.advanceTimersByTimeAsync(500);
      expect(count('item_failed')).toBe(1);
      // 11:05:00.499: the five minutes are over, but the default's item is not (its boundary
      // is at 11:05:00.500). The retry never cuts an item.
      await vi.advanceTimersByTimeAsync(299_999);
      expect(count('item_failed')).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      // Tried, failed and reported again, so the error does not age out of the report.
      expect(count('item_failed')).toBe(2);
      await vi.advanceTimersByTimeAsync(500);
      expect(started().at(-1)).toBe(0);
      expect(new Set(started())).toEqual(new Set([0]));
      expect(count('all_failed')).toBe(0);
      expect(s.clears).toBe(0);
    });

    it('a 00:00 to 24:00 event recovers after a transient failure', async () => {
      vi.setSystemTime(monday('11:00:00'));
      const m = await scheduledOf([[tenSeconds], [tenSeconds]], [event(1, '00:00', '24:00')]);
      active = m;
      const s = stage();
      breakItems(s, m, 1);
      loop(s).start();
      await vi.advanceTimersByTimeAsync(500);
      expect(started()).toEqual([0]);
      s.behaviour.clear();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(started().at(-1)).toBe(1);
      // And it stays on: the event never ends.
      const before = started().length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(started().slice(before)).toEqual([1, 1, 1]);
    });

    it('lets the lower covering event play when the higher event playlist fails', async () => {
      vi.setSystemTime(monday('11:00:00'));
      const m = await scheduledOf(
        [[tenSeconds], [tenSeconds], [tenSeconds]],
        [event(1, '11:00', '12:00'), event(2, '11:00', '12:00')],
      );
      active = m;
      const s = stage();
      breakItems(s, m, 1);
      loop(s).start();
      await vi.advanceTimersByTimeAsync(20_500);
      expect(started()).toEqual([2, 2, 2]);
      expect(count('item_failed')).toBe(1);
      expect(count('all_failed')).toBe(0);
    });

    it('reaches the default playlist when two overlapping event playlists both fail', async () => {
      vi.setSystemTime(monday('11:00:00'));
      const m = await scheduledOf(
        [[tenSeconds], [tenSeconds], [tenSeconds]],
        [event(1, '11:00', '12:00'), event(2, '11:00', '12:00')],
      );
      active = m;
      const s = stage();
      breakItems(s, m, 1, 2);
      loop(s).start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(count('item_failed')).toBe(2);
      expect(started()).toEqual([0]);
      // Both stay skipped: the default goes round, neither event hands the skip to the other.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(count('item_failed')).toBe(2);
      expect(new Set(started())).toEqual(new Set([0]));
      expect(count('all_failed')).toBe(0);
      expect(s.clears).toBe(0);
    });

    it('does not extend the skip when the clock is set back', async () => {
      vi.setSystemTime(monday('11:00:00'));
      const m = await scheduledOf([[tenSeconds], [tenSeconds]], [event(1, '00:00', '24:00')]);
      active = m;
      const s = stage();
      breakItems(s, m, 1);
      loop(s).start();
      await vi.advanceTimersByTimeAsync(5_500);
      expect(started()).toEqual([0]);
      s.behaviour.clear();
      // An hour back: by the new clock the retry would be 65 minutes away.
      vi.setSystemTime(monday('10:00:05.500'));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(started()).toEqual([0, 1]);
    });

    it('while an event playlist is skipped as failed, a 3-minute default still is held for its full time', async () => {
      vi.setSystemTime(monday('11:00:00'));
      const m = await scheduledOf(
        [[{ durationMs: 180_000 }], [tenSeconds]],
        [event(1, '11:00', '12:00')],
      );
      active = m;
      const s = stage();
      breakItems(s, m, 1);
      loop(s).start();
      await vi.advanceTimersByTimeAsync(500);
      expect(started()).toEqual([0]);
      // Three minute edges pass (11:01, 11:02, 11:03); the still is not cut at any of them.
      await vi.advanceTimersByTimeAsync(179_999);
      expect(started()).toEqual([0]);
      expect(count('item_failed')).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(started()).toEqual([0, 0]);
    });

    it('still gives all_failed when the default playlist fails, also after an event playlist gave way', async () => {
      vi.setSystemTime(monday('11:00:00'));
      const m = await scheduledOf([[tenSeconds], [tenSeconds]], [event(1, '11:00', '12:00')]);
      active = m;
      const s = stage();
      breakItems(s, m, 0, 1);
      loop(s).start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(count('item_failed')).toBe(2);
      expect(events.filter((e) => e.type === 'all_failed')).toEqual([
        { type: 'all_failed', publicationId: m.publicationId },
      ]);
      expect(s.clears).toBe(1);
      expect(started()).toEqual([]);
      // The default is tried again after 30 s, as without a schedule.
      s.behaviour.clear();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(started()).toEqual([0]);
    });

    it('cannot spin the hold with an instant sleep and a clock that stands still', async () => {
      // 30 s into a minute, and it stays there: every part is 30 s long.
      const now = monday('11:00:30');
      active = await scheduledOf(
        [[{ durationMs: 600_000 }], [second]],
        [event(1, '20:00', '21:00')],
      );
      const s = stage();
      const instant = instantSleep();
      const l = new PlaybackLoop({
        loadActive: async () => active,
        presenter: s.presenter,
        clock: { now: () => now },
        sleep: instant,
        random: Math.random,
        signal: abort.signal,
        onEvent: (e) => {
          events.push(e);
          // Stop at the second item: the first hold has run to its end by then.
          if (started().length === 2) abort.abort();
        },
      });
      await l.run();
      // The ten minutes were counted down by what was slept, not by the clock.
      expect(instant.delays).toEqual(Array.from({ length: 20 }, () => 30_000));
    });

    it('ends a still at once when its reveal took it past the minute an event starts', async () => {
      vi.setSystemTime(monday('10:59:58'));
      const m = await scheduledOf([[tenSeconds], [tenSeconds]], [event(1, '11:00', '12:00')]);
      active = m;
      const s = stage();
      const slowId = (m.assets[0] as { assetId: string }).assetId;
      // The default's still takes three seconds to show: it is revealed at 11:00:01.
      const presenter: Presenter = {
        ...s.presenter,
        show: async (item, manifest, signal, transition) => {
          if (isMediaItem(item) && item.assetId === slowId) await sleep(3_000);
          return s.presenter.show(item, manifest, signal, transition);
        },
      };
      loop({ ...s, presenter }).start();
      await vi.advanceTimersByTimeAsync(2_999);
      expect(started()).toEqual([]);
      // Not held to 11:01:00: the event's item follows straight after the reveal.
      await vi.advanceTimersByTimeAsync(1);
      expect(started()).toEqual([0, 1]);
    });

    it('counts the retry of a failed event playlist from its failure, after a long video watchdog', async () => {
      vi.setSystemTime(monday('11:00:00'));
      // Watchdog 505 s, longer than the 300 s retry.
      const m = await scheduledOf(
        [[tenSeconds], [{ kind: 'video', durationMs: 400_000 }]],
        [event(1, '00:00', '24:00')],
      );
      active = m;
      const s = stage();
      s.behaviour.set((m.assets[1] as { assetId: string }).assetId, 'video_stalls');
      loop(s).start();
      await vi.advanceTimersByTimeAsync(505_000);
      expect(count('item_failed')).toBe(1);
      // The default plays, not the event again.
      await vi.advanceTimersByTimeAsync(500);
      expect(started()).toEqual([1, 0]);
      // Five minutes after the failure (805 s), at the default's next boundary (805.5 s).
      await vi.advanceTimersByTimeAsync(299_999);
      expect(started().filter((i) => i === 1)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(started().at(-1)).toBe(1);
      expect(count('all_failed')).toBe(0);
    });

    it('still reaches all_failed for a slowly failing default while an event playlist is skipped', async () => {
      vi.setSystemTime(monday('11:00:00'));
      // Each default video fails after its 380 s watchdog, beyond the 300 s retry of the event.
      const video = { kind: 'video' as const, durationMs: 300_000 };
      const m = await scheduledOf([[video, video], [tenSeconds]], [event(1, '00:00', '24:00')]);
      active = m;
      const s = stage();
      breakItems(s, m, 2);
      for (const index of [0, 1]) {
        s.behaviour.set((m.assets[index] as { assetId: string }).assetId, 'video_stalls');
      }
      loop(s).start();
      await vi.advanceTimersByTimeAsync(500);
      expect(count('item_failed')).toBe(1);
      // First default video fails at 380.5 s; the event is not retried in the middle of the round.
      await vi.advanceTimersByTimeAsync(380_500);
      expect(count('item_failed')).toBe(2);
      expect(started()).toEqual([0, 1]);
      await vi.advanceTimersByTimeAsync(380_000);
      expect(count('item_failed')).toBe(3);
      expect(events.filter((e) => e.type === 'all_failed')).toEqual([
        { type: 'all_failed', publicationId: m.publicationId },
      ]);
      expect(s.clears).toBe(1);
    });
  });
});
