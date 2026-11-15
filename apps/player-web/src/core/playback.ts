import type { ManifestAssetV1, ManifestV1, PlayerError } from '@tinnox/contracts';
import { AbortedError, PlayerFault, toPlayerError } from './errors.ts';
import type { Clock, Sleep } from './types.ts';

/** Where the renderer is in the active publication. */
export interface PlaybackPosition {
  readonly manifest: ManifestV1;
  readonly index: number;
}

export interface PlaybackStep extends PlaybackPosition {
  /** True when this step starts a publication other than the one that was playing. */
  readonly switched: boolean;
}

/**
 * Decides what to show at an item boundary.
 * - no active publication: nothing (null);
 * - a different active publication than the one playing: its first item;
 * - otherwise the next item, wrapping to the first (a one-item playlist repeats).
 */
export function nextStep(
  current: PlaybackPosition | null,
  active: ManifestV1 | null,
): PlaybackStep | null {
  if (active === null || active.assets.length === 0) return null;
  if (current === null || current.manifest.publicationId !== active.publicationId) {
    return { manifest: active, index: 0, switched: true };
  }
  return {
    manifest: current.manifest,
    index: (current.index + 1) % current.manifest.assets.length,
    switched: false,
  };
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
export function holdTimeMs(asset: ManifestAssetV1): number {
  return asset.kind === 'video' ? videoWatchdogMs(asset.durationMs) : asset.durationMs;
}

export interface ShownItem {
  /**
   * Video only: resolves when the video reaches its natural end, rejects with a
   * PlayerFault when playback breaks. Null for images.
   */
  readonly finished: Promise<void> | null;
}

/** Puts things on screen. The DOM implementation lives in ui/presenter.ts. */
export interface Presenter {
  /**
   * Prepares the asset off screen, then swaps it in. Resolves once it is visible.
   * Rejects with a PlayerFault; the previous item stays visible in that case.
   */
  show(asset: ManifestAssetV1, manifest: ManifestV1, signal: AbortSignal): Promise<ShownItem>;
  /** Removes all content from the screen. */
  clear(): void;
}

export type PlaybackEvent =
  | { readonly type: 'item_started'; readonly publicationId: string; readonly index: number }
  | { readonly type: 'version_adopted'; readonly publicationId: string }
  | { readonly type: 'item_failed'; readonly error: PlayerError }
  /** A whole round of the playlist failed; the screen was cleared. */
  | { readonly type: 'all_failed'; readonly publicationId: string }
  | { readonly type: 'no_content' };

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
  loadActive(): Promise<ManifestV1 | null>;
  readonly presenter: Presenter;
  readonly clock: Clock;
  readonly sleep: Sleep;
  readonly signal: AbortSignal;
  onEvent(event: PlaybackEvent): void;
}

/**
 * The render loop. It holds no growing state: one position, one failure counter.
 * A new active version is picked up only between items, never in the middle of one.
 */
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
    let lastKnown: ManifestV1 | null = null;

    while (!signal.aborted) {
      let active: ManifestV1 | null;
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

      const step = nextStep(this.#position, active);
      if (step === null) {
        presenter.clear();
        this.#position = null;
        consecutiveFailures = 0;
        this.#deps.onEvent({ type: 'no_content' });
        if (!(await this.#idle(this.#timings.idleRecheckMs))) return;
        continue;
      }
      if (step.switched) {
        consecutiveFailures = 0;
        this.#deps.onEvent({ type: 'version_adopted', publicationId: step.manifest.publicationId });
      }
      this.#position = { manifest: step.manifest, index: step.index };
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
          error: this.#error(err, publicationId, asset?.assetId ?? null, 'playback_error'),
        });
        if (consecutiveFailures >= step.manifest.assets.length) {
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
  async #hold(asset: ManifestAssetV1, shown: ShownItem): Promise<void> {
    const { sleep, signal } = this.#deps;
    if (shown.finished === null) {
      // A still image has no timeline of its own, so a freshly activated version may
      // end its hold early (wake). A video is always allowed to finish.
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
          {
            assetId: asset.assetId,
          },
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
