import {
  isMediaItem,
  manifestPlaylists,
  type Manifest,
  type ManifestItem,
  type PlayerError,
  type Transition,
} from '@tinnox/contracts';
import { AbortedError, PlayerFault, toPlayerError } from './errors.ts';
import { coveringSlices, playableIndexes, sliceIndexes } from './time-rules.ts';
import type { Clock, Sleep } from './types.ts';

/**
 * Where the renderer is in the active publication. The playlist on air is the slice of
 * `manifestPlaylists(manifest)` that holds `index`.
 */
export interface PlaybackPosition {
  readonly manifest: Manifest;
  /** Index into `manifest.assets`; always `order[cursor]`. */
  readonly index: number;
  /**
   * This round's play order (manifest indexes) over the playlist on air: as listed, or a
   * permutation when shuffling.
   */
  readonly order: readonly number[];
  readonly cursor: number;
}

export interface PlaybackStep extends PlaybackPosition {
  /** True when this step starts a publication other than the one that was playing. */
  readonly switched: boolean;
  /** True when this step starts a playlist: a new publication, or another playlist of the same one. */
  readonly restarted: boolean;
  /** Index into `manifestPlaylists(manifest)` of the playlist that holds `index`. */
  readonly slice: number;
  /** That playlist's transition. */
  readonly transition: Transition;
  /** How many items may be shown now (working hours, schedule and windows). */
  readonly playable: number;
}

function swap(order: number[], i: number, j: number): void {
  const a = order[i];
  const b = order[j];
  if (a === undefined || b === undefined) return;
  order[i] = b;
  order[j] = a;
}

/** A slice's indexes in a random order. One slice from 0 draws the numbers it always drew. */
function shuffled(slice: { from: number; count: number }, random: () => number): number[] {
  const order = sliceIndexes(slice);
  for (let i = slice.count - 1; i > 0; i -= 1) swap(order, i, Math.floor(random() * (i + 1)));
  return order;
}

/**
 * Decides what to show at an item boundary.
 * - no active publication: nothing (null);
 * - nothing in it may be shown now (working hours, schedule, windows): 'not_now';
 * - a different active publication than the one playing: its first playable item;
 * - another playlist of the same publication than the one playing (an event of its schedule
 *   started or ended, or a playlist in `skipSlices` gave way): that playlist's first
 *   playable item, without a switch;
 * - otherwise the next playable item, wrapping into a new round (a one-item playlist
 *   repeats). A shuffled playlist gets a new order each round that never starts with
 *   the item just shown, unless it is the only playable one.
 */
// shortcut: a playlist always starts at its first item (or a new shuffle) when it comes on; add resume at the interrupted item (spec section 11 rule 11) with priorities.
export function nextStep(
  current: PlaybackPosition | null,
  active: Manifest | null,
  {
    now,
    random,
    skipSlices,
  }: { now: number; random: () => number; skipSlices?: ReadonlySet<number> },
): PlaybackStep | 'not_now' | null {
  if (active === null || active.assets.length === 0) return null;
  const playable = playableIndexes(active, now, skipSlices);
  const first = playable[0];
  if (first === undefined) return 'not_now';
  const allowed = new Set(playable);
  // The playlist on air: `playableIndexes` never mixes slices, so the first index names it.
  const slices = manifestPlaylists(active);
  const sliceIndex = slices.findIndex((s) => s.from <= first && first < s.from + s.count);
  const slice = slices[sliceIndex];
  // Cannot happen: every playable index lies in a slice.
  if (slice === undefined) return 'not_now';
  const switched = current === null || current.manifest.publicationId !== active.publicationId;
  const restarted =
    switched || current.index < slice.from || current.index >= slice.from + slice.count;
  let order: readonly number[];
  let cursor: number;
  if (restarted) {
    order = slice.shuffle ? shuffled(slice, random) : sliceIndexes(slice);
    cursor = 0;
  } else {
    order = current.order;
    cursor = current.cursor + 1;
  }
  // Ends within two passes: `order` holds every index of the slice and at least one is allowed.
  for (;;) {
    if (cursor >= order.length) {
      cursor = 0;
      if (slice.shuffle) {
        const next = shuffled(slice, random);
        const [one, two] = next.flatMap((index, slot) => (allowed.has(index) ? [slot] : []));
        if (one !== undefined && two !== undefined && next[one] === current?.index) {
          swap(next, one, two);
        }
        order = next;
      }
    }
    const index = order[cursor];
    if (index !== undefined && allowed.has(index)) {
      return {
        manifest: active,
        index,
        order,
        cursor,
        switched,
        restarted,
        slice: sliceIndex,
        transition: slice.transition,
        playable: allowed.size,
      };
    }
    cursor += 1;
  }
}

/**
 * Longest time a video may stay on screen before the loop moves on without it
 * having ended. Based on the duration in the manifest, with room for start-up
 * and brief buffering, so a stalled decoder cannot freeze the playlist.
 */
export function videoWatchdogMs(durationMs: number): number {
  return Math.ceil(durationMs * 1.25) + 5_000;
}

/** How long an item is held before the next boundary, when nothing goes wrong. */
export function holdTimeMs(item: ManifestItem): number {
  return item.kind === 'video' ? videoWatchdogMs(item.durationMs) : item.durationMs;
}

export interface ShownItem {
  /**
   * Video only: resolves when the video reaches its natural end, rejects with a
   * PlayerFault when playback breaks. Null for images and apps.
   */
  readonly finished: Promise<void> | null;
}

/** Puts things on screen. The DOM implementation lives in ui/presenter.ts. */
export interface Presenter {
  /**
   * Prepares the item off screen, then swaps it in. Resolves once it is visible.
   * Rejects with a PlayerFault; the previous item stays visible in that case.
   * `transition` is that of the playlist the item belongs to.
   */
  show(
    item: ManifestItem,
    manifest: Manifest,
    signal: AbortSignal,
    transition: Transition,
  ): Promise<ShownItem>;
  /** Removes all content from the screen. */
  clear(): void;
}

export type PlaybackEvent =
  | { readonly type: 'item_started'; readonly publicationId: string; readonly index: number }
  | { readonly type: 'version_adopted'; readonly publicationId: string }
  | { readonly type: 'item_failed'; readonly error: PlayerError }
  /**
   * A whole round of the playlist failed; the screen was cleared. With a schedule this is the
   * default playlist: a failed event playlist gives way without this event.
   */
  | { readonly type: 'all_failed'; readonly publicationId: string }
  /** Nothing is active, or (`not_now`) nothing in it is due to show now. The screen was cleared. */
  | { readonly type: 'no_content'; readonly reason?: 'not_now' };

export interface PlaybackTimings {
  /** How often an idle or fully failed loop looks again when nobody wakes it. */
  readonly idleRecheckMs: number;
  readonly allFailedRetryMs: number;
  /** Pause after one failed item, so a broken playlist cannot spin. */
  readonly failureGapMs: number;
  /**
   * How long an event playlist that failed as a whole is passed over before it is tried
   * again. Longer than `allFailedRetryMs`, because every try restarts the playlist that was
   * on air at its first item.
   */
  readonly eventRetryMs: number;
}

export const DEFAULT_PLAYBACK_TIMINGS: PlaybackTimings = {
  idleRecheckMs: 5_000,
  allFailedRetryMs: 30_000,
  failureGapMs: 500,
  eventRetryMs: 300_000,
};

export interface PlaybackDeps {
  /** The active version from durable state. Read at every item boundary. */
  loadActive(): Promise<Manifest | null>;
  readonly presenter: Presenter;
  readonly clock: Clock;
  readonly sleep: Sleep;
  /** Shuffle source; Math.random in the browser, seeded in tests. */
  readonly random: () => number;
  readonly signal: AbortSignal;
  onEvent(event: PlaybackEvent): void;
}

/**
 * The render loop. It holds no growing state: one position, one failure counter, and the
 * event playlists of the active publication that failed lately (at most one entry per playlist).
 * A new active version is picked up only between items, never in the middle of one.
 */
// shortcut: for manifests without a schedule (v1 to v3, and the v3 views of v5 zones) rules are checked at item boundaries; an item may overrun an edge by its own length. A video is never cut, in any version.
export class PlaybackLoop {
  readonly #deps: PlaybackDeps;
  readonly #timings: PlaybackTimings;
  #position: PlaybackPosition | null = null;
  /**
   * Event playlists (slices) of one publication that failed as a whole, each with the clock
   * time of its next try. A set of slices, not one slot: with one slot two broken overlapping
   * events would hand the skip to each other for ever and never reach the default playlist.
   */
  // shortcut: a retry restarts the playlist that was on air at its first item; keep its position when resume (spec section 11 rule 11) is built.
  #failed: { publicationId: string; retryAt: Map<number, number> } | null = null;
  #wake: AbortController | null = null;
  #running = false;

  constructor(deps: PlaybackDeps, timings: PlaybackTimings = DEFAULT_PLAYBACK_TIMINGS) {
    this.#deps = deps;
    this.#timings = timings;
  }

  get position(): PlaybackPosition | null {
    return this.#position;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    void this.run().finally(() => {
      this.#running = false;
    });
  }

  /** Ends an idle wait or a still image's hold early (a version was just activated). Never cuts a video. */
  wake(): void {
    this.#wake?.abort();
  }

  async run(): Promise<void> {
    const { signal, presenter } = this.#deps;
    let consecutiveFailures = 0;
    let lastKnown: Manifest | null = null;

    while (!signal.aborted) {
      let active: Manifest | null;
      try {
        active = await this.#deps.loadActive();
        lastKnown = active;
      } catch (err) {
        // State could not be read: keep playing what is already loaded.
        active = lastKnown;
        this.#deps.onEvent({
          type: 'item_failed',
          error: this.#error(err, null, null, 'storage_error'),
        });
      }

      const now = this.#deps.clock.now();
      // One copy per step: the hold below must judge the item by the set its step was chosen with.
      const skipSlices = this.#skipSlices(active, now, consecutiveFailures > 0);
      const step = nextStep(this.#position, active, {
        now,
        random: this.#deps.random,
        skipSlices,
      });
      if (step === null) {
        presenter.clear();
        this.#position = null;
        consecutiveFailures = 0;
        this.#deps.onEvent({ type: 'no_content' });
        if (!(await this.#idle(this.#timings.idleRecheckMs))) return;
        continue;
      }
      if (step === 'not_now') {
        // Keep the position, so coming back into hours is not a switch.
        presenter.clear();
        consecutiveFailures = 0;
        this.#deps.onEvent({ type: 'no_content', reason: 'not_now' });
        if (!(await this.#idle(this.#timings.idleRecheckMs))) return;
        continue;
      }
      // A playlist that comes on starts with a clean count, in the same publication too.
      if (step.restarted) consecutiveFailures = 0;
      if (step.switched) {
        this.#deps.onEvent({ type: 'version_adopted', publicationId: step.manifest.publicationId });
      }
      this.#position = {
        manifest: step.manifest,
        index: step.index,
        order: step.order,
        cursor: step.cursor,
      };
      const asset = step.manifest.assets[step.index];
      const publicationId = step.manifest.publicationId;

      try {
        if (asset === undefined)
          throw new PlayerFault('internal_error', 'playlist index out of range');
        const shown = await presenter.show(asset, step.manifest, signal, step.transition);
        this.#deps.onEvent({ type: 'item_started', publicationId, index: step.index });
        await this.#hold(step, asset, shown, skipSlices);
        consecutiveFailures = 0;
      } catch (err) {
        if (err instanceof AbortedError || signal.aborted) return;
        consecutiveFailures += 1;
        this.#deps.onEvent({
          type: 'item_failed',
          error: this.#error(
            err,
            publicationId,
            asset !== undefined && isMediaItem(asset) ? asset.assetId : null,
            'playback_error',
          ),
        });
        // Counted against what may be shown now, so windows cannot hide a broken publication.
        if (consecutiveFailures >= step.playable && step.slice !== 0) {
          // Nothing in this event's playlist can be shown. Pass it over for a while: the next
          // covering event or the default playlist plays, and the last good item stays on
          // screen until then. Each failure was already reported as `item_failed`.
          if (this.#failed?.publicationId !== publicationId) {
            this.#failed = { publicationId, retryAt: new Map() };
          }
          // From the failure, not from the step: a stalled video fails only after its watchdog.
          this.#failed.retryAt.set(step.slice, this.#deps.clock.now() + this.#timings.eventRetryMs);
          consecutiveFailures = 0;
          if (!(await this.#pause(this.#timings.failureGapMs))) return;
        } else if (consecutiveFailures >= step.playable) {
          // Nothing in this publication can be shown. Say so; do not pretend to play.
          presenter.clear();
          consecutiveFailures = 0;
          this.#deps.onEvent({ type: 'all_failed', publicationId });
          if (!(await this.#idle(this.#timings.allFailedRetryMs))) return;
        } else if (!(await this.#pause(this.#timings.failureGapMs))) {
          return;
        }
      }
    }
  }

  /**
   * The event playlists to pass over at `now`. Forgets every entry of another publication,
   * of an event that has ended, and of a skip that has run its time. While the playlist on air
   * is part-way through a failing run (`midRound`) no skip ends by time: a retry would restart
   * that playlist with a clean count, and slow failures could then never add up to `all_failed`.
   */
  #skipSlices(active: Manifest | null, now: number, midRound: boolean): ReadonlySet<number> {
    if (active === null || this.#failed?.publicationId !== active.publicationId) {
      this.#failed = null;
    } else {
      const covering = coveringSlices(active, now);
      for (const [slice, retryAt] of this.#failed.retryAt) {
        if (
          !covering.includes(slice) ||
          (!midRound &&
            (now >= retryAt ||
              // The clock was set back: without this the skip would outlive its time by the jump.
              now < retryAt - this.#timings.eventRetryMs))
        ) {
          this.#failed.retryAt.delete(slice);
        }
      }
    }
    return new Set(this.#failed?.retryAt.keys());
  }

  /**
   * Keeps the item on screen for its time. Throws a PlayerFault when a video breaks or stalls.
   * `skipSlices` is the set the step was chosen with: with any other set a skipped event
   * playlist would look chosen, and every still of the default playlist would be cut at each minute.
   */
  async #hold(
    step: PlaybackStep,
    asset: ManifestItem,
    shown: ShownItem,
    skipSlices: ReadonlySet<number>,
  ): Promise<void> {
    const { sleep, signal, clock } = this.#deps;
    if (shown.finished === null) {
      // A still image or an app has no timeline of its own, so a freshly activated version
      // may end its hold early (wake). A video is always allowed to finish.
      const wake = new AbortController();
      this.#wake = wake;
      try {
        // With a schedule (v4) the hold sleeps in parts to the next wall-clock minute and ends
        // early when the item may no longer be shown: rules have minute granularity, so a
        // still or an app changes on the minute. The check comes first, so an item whose reveal
        // took it past an edge ends at once. v1 to v3 take one sleep, as released.
        // shortcut: minute alignment assumes whole-minute zone offsets; poll every few seconds instead if a zone with a second-level offset is ever supported.
        const scheduled = step.manifest.schemaVersion === 4;
        // One wake controller and one signal for the whole hold.
        const stop = AbortSignal.any([signal, wake.signal]);
        let remaining = holdTimeMs(asset);
        while (remaining > 0) {
          if (
            scheduled &&
            !playableIndexes(step.manifest, clock.now(), skipSlices).includes(step.index)
          ) {
            break;
          }
          const part = scheduled ? Math.min(remaining, 60_000 - (clock.now() % 60_000)) : remaining;
          await sleep(part, stop);
          // Counted by what was slept, never by the clock: an instant test sleep or a clock
          // jump cannot spin.
          remaining -= part;
        }
      } catch {
        if (signal.aborted) throw new AbortedError();
      } finally {
        this.#wake = null;
      }
      return;
    }
    const timer = new AbortController();
    const watchdog = sleep(holdTimeMs(asset), AbortSignal.any([signal, timer.signal])).then(
      () => 'timeout' as const,
      () => 'cancelled' as const,
    );
    try {
      const winner = await Promise.race([shown.finished.then(() => 'ended' as const), watchdog]);
      if (signal.aborted) throw new AbortedError();
      if (winner === 'timeout') {
        throw new PlayerFault(
          'playback_error',
          'video did not finish in the expected time; skipped',
          { assetId: isMediaItem(asset) ? asset.assetId : null },
        );
      }
    } finally {
      timer.abort();
    }
  }

  /** Waits, ending early on wake(). Returns false when the loop must stop. */
  async #idle(ms: number): Promise<boolean> {
    const { signal, sleep } = this.#deps;
    const wake = new AbortController();
    this.#wake = wake;
    try {
      await sleep(ms, AbortSignal.any([signal, wake.signal]));
    } catch {
      // Woken or stopped.
    } finally {
      this.#wake = null;
    }
    return !signal.aborted;
  }

  async #pause(ms: number): Promise<boolean> {
    try {
      await this.#deps.sleep(ms, this.#deps.signal);
    } catch {
      return false;
    }
    return !this.#deps.signal.aborted;
  }

  #error(
    err: unknown,
    publicationId: string | null,
    assetId: string | null,
    fallbackCode: PlayerError['code'],
  ): PlayerError {
    return toPlayerError(err, {
      at: new Date(this.#deps.clock.now()).toISOString(),
      publicationId,
      assetId,
      fallbackCode,
    });
  }
}
