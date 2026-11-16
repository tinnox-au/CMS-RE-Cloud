import {
  isMediaItem,
  manifestV2Facts,
  type Manifest,
  type ManifestItem,
  type PlayerError,
} from '@tinnox/contracts';
import { AbortedError, PlayerFault, toPlayerError } from './errors.ts';
import { playableIndexes } from './time-rules.ts';
import type { Clock, Sleep } from './types.ts';

/** Where the renderer is in the active publication. */
export interface PlaybackPosition {
  readonly manifest: Manifest;
  /** Index into `manifest.assets`; always `order[cursor]`. */
  readonly index: number;
  /** This round's play order (manifest indexes): as listed, or a permutation when shuffling. */
  readonly order: readonly number[];
  readonly cursor: number;
}

export interface PlaybackStep extends PlaybackPosition {
  /** True when this step starts a publication other than the one that was playing. */
  readonly switched: boolean;
  /** How many items may be shown now (working hours and windows). */
  readonly playable: number;
}

function swap(order: number[], i: number, j: number): void {
  const a = order[i];
  const b = order[j];
  if (a === undefined || b === undefined) return;
  order[i] = b;
  order[j] = a;
}

function shuffled(length: number, random: () => number): number[] {
  const order = Array.from({ length }, (_, index) => index);
  for (let i = length - 1; i > 0; i -= 1) swap(order, i, Math.floor(random() * (i + 1)));
  return order;
}

/**
 * Decides what to show at an item boundary.
 * - no active publication: nothing (null);
 * - nothing in it may be shown now (working hours, windows): 'not_now';
 * - a different active publication than the one playing: its first playable item;
 * - otherwise the next playable item, wrapping into a new round (a one-item playlist
 *   repeats). A shuffled playlist gets a new order each round that never starts with
 *   the item just shown, unless it is the only playable one.
 */
export function nextStep(
  current: PlaybackPosition | null,
  active: Manifest | null,
  { now, random }: { now: number; random: () => number },
): PlaybackStep | 'not_now' | null {
  if (active === null || active.assets.length === 0) return null;
  const allowed = new Set(playableIndexes(active, now));
  if (allowed.size === 0) return 'not_now';
  const { shuffle } = manifestV2Facts(active);
  const length = active.assets.length;
  const switched = current === null || current.manifest.publicationId !== active.publicationId;
  let order: readonly number[];
  let cursor: number;
  if (switched) {
    order = shuffle ? shuffled(length, random) : active.assets.map((_, index) => index);
    cursor = 0;
  } else {
    order = current.order;
    cursor = current.cursor + 1;
  }
  // Ends within two passes: `order` holds every index and at least one is allowed.
  for (;;) {
    if (cursor >= order.length) {
      cursor = 0;
      if (shuffle) {
        const next = shuffled(length, random);
        const [first, second] = next.flatMap((index, slot) => (allowed.has(index) ? [slot] : []));
        if (first !== undefined && second !== undefined && next[first] === current?.index) {
          swap(next, first, second);
        }
        order = next;
      }
    }
    const index = order[cursor];
    if (index !== undefined && allowed.has(index)) {
      return { manifest: active, index, order, cursor, switched, playable: allowed.size };
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
   */
  show(item: ManifestItem, manifest: Manifest, signal: AbortSignal): Promise<ShownItem>;
  /** Removes all content from the screen. */
  clear(): void;
}

export type PlaybackEvent =
  | { readonly type: 'item_started'; readonly publicationId: string; readonly index: number }
  | { readonly type: 'version_adopted'; readonly publicationId: string }
  | { readonly type: 'item_failed'; readonly error: PlayerError }
  /** A whole round of the playlist failed; the screen was cleared. */
  | { readonly type: 'all_failed'; readonly publicationId: string }
  /** Nothing is active, or (`not_now`) nothing in it is due to show now. The screen was cleared. */
  | { readonly type: 'no_content'; readonly reason?: 'not_now' };

export interface PlaybackTimings {
  /** How often an idle or fully failed loop looks again when nobody wakes it. */
  readonly idleRecheckMs: number;
  readonly allFailedRetryMs: number;
  /** Pause after one failed item, so a broken playlist cannot spin. */
  readonly failureGapMs: number;
}

export const DEFAULT_PLAYBACK_TIMINGS: PlaybackTimings = {
  idleRecheckMs: 5_000,
  allFailedRetryMs: 30_000,
  failureGapMs: 500,
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
 * The render loop. It holds no growing state: one position, one failure counter.
 * A new active version is picked up only between items, never in the middle of one.
 */
// shortcut: rules are checked at item boundaries; an item may overrun an edge by its own length. Wake the image hold at the next edge if long images are used with hours.
export class PlaybackLoop {
  readonly #deps: PlaybackDeps;
  readonly #timings: PlaybackTimings;
  #position: PlaybackPosition | null = null;
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

      const step = nextStep(this.#position, active, {
        now: this.#deps.clock.now(),
        random: this.#deps.random,
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
      if (step.switched) {
        consecutiveFailures = 0;
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
        const shown = await presenter.show(asset, step.manifest, signal);
        this.#deps.onEvent({ type: 'item_started', publicationId, index: step.index });
        await this.#hold(asset, shown);
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
        if (consecutiveFailures >= step.playable) {
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

  /** Keeps the item on screen for its time. Throws a PlayerFault when a video breaks or stalls. */
  async #hold(asset: ManifestItem, shown: ShownItem): Promise<void> {
    const { sleep, signal } = this.#deps;
    if (shown.finished === null) {
      // A still image or an app has no timeline of its own, so a freshly activated version
      // may end its hold early (wake). A video is always allowed to finish.
      const wake = new AbortController();
      this.#wake = wake;
      try {
        await sleep(holdTimeMs(asset), AbortSignal.any([signal, wake.signal]));
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
