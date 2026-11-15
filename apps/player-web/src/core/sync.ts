import { parseManifest, type ManifestV1, type PlayerError } from '@tinnox/contracts';
import { backoffDelay, jitteredInterval, type BackoffPolicy } from './backoff.ts';
import { AbortedError, PlayerFault, RevokedError, toPlayerError } from './errors.ts';
import { collectGarbage, stagePublication, type StagingDeps } from './staging.ts';

export interface SyncTimings {
  /** Regular manifest poll interval. */
  readonly pollIntervalMs: number;
  /** ± share of the poll interval that is randomised. */
  readonly pollSpread: number;
  /** Backoff while the server cannot be reached. */
  readonly networkBackoff: BackoffPolicy;
  /** Backoff while an update keeps failing (bad manifest, failed download, no space). */
  readonly updateBackoff: BackoffPolicy;
}

export const DEFAULT_SYNC_TIMINGS: SyncTimings = {
  pollIntervalMs: 15_000,
  pollSpread: 0.2,
  networkBackoff: { baseMs: 5_000, maxMs: 5 * 60_000, factor: 2, jitter: 0.5 },
  updateBackoff: { baseMs: 30_000, maxMs: 10 * 60_000, factor: 2, jitter: 0.3 },
};

export type CycleResult =
  /** The server confirmed the player already has the desired publication, or nothing is published. */
  | { readonly kind: 'up_to_date' }
  | { readonly kind: 'activated'; readonly publicationId: string }
  /** The server could not be reached or answered with an error. Nothing changed. */
  | { readonly kind: 'unreachable'; readonly error: PlayerError }
  /** A manifest arrived but was rejected or could not be completed. The old version stays. */
  | {
      readonly kind: 'update_failed';
      readonly error: PlayerError;
      readonly publicationId: string | null;
    };

export interface SyncDeps extends StagingDeps {
  /** The display this registration belongs to; manifests for another display are refused. */
  readonly displayId: string;
  report(error: PlayerError): void;
  /** Called with the publication id of every manifest the player starts working on. */
  onAttempt?(publicationId: string): void;
}

/** How many times one cycle follows a "superseded" result before giving the loop a rest. */
const MAX_SUPERSEDED_HOPS = 3;

/**
 * One poll of the manifest and, when it names a new publication, one complete
 * update attempt. Never throws for ordinary failures; RevokedError and
 * AbortedError are passed to the caller.
 */
export async function syncCycle(deps: SyncDeps): Promise<CycleResult> {
  const nowIso = (): string => new Date(deps.clock.now()).toISOString();
  const active = await deps.state.getActive();
  const activeId = active?.manifest.publicationId ?? null;

  let fetched;
  try {
    fetched = await deps.api.fetchManifest(activeId);
  } catch (err) {
    if (err instanceof RevokedError || err instanceof AbortedError) throw err;
    const error = toPlayerError(err, {
      at: nowIso(),
      publicationId: null,
      fallbackCode: 'network_error',
    });
    deps.report(error);
    return { kind: 'unreachable', error };
  }
  if (fetched.kind !== 'manifest') return { kind: 'up_to_date' };

  const parsed = parseManifest(fetched.raw);
  if (!parsed.ok) {
    const error: PlayerError = {
      code:
        parsed.reason === 'unsupported_version'
          ? 'manifest_unsupported_version'
          : 'manifest_malformed',
      message: parsed.message,
      at: nowIso(),
      publicationId: null,
      assetId: null,
    };
    deps.report(error);
    return { kind: 'update_failed', error, publicationId: null };
  }

  let manifest: ManifestV1 = parsed.manifest;
  for (let hop = 0; ; hop += 1) {
    if (manifest.displayId !== deps.displayId) {
      const error = toPlayerError(
        new PlayerFault('manifest_malformed', 'manifest is addressed to another display'),
        { at: nowIso(), publicationId: null },
      );
      deps.report(error);
      return { kind: 'update_failed', error, publicationId: null };
    }
    // The server repeated what is already active (it ignored If-None-Match): nothing to do.
    if (manifest.publicationId === activeId) return { kind: 'up_to_date' };

    deps.onAttempt?.(manifest.publicationId);
    const outcome = await stagePublication(manifest, deps);
    if (outcome.kind === 'activated') return outcome;
    if (outcome.kind === 'failed') {
      deps.report(outcome.error);
      return { kind: 'update_failed', error: outcome.error, publicationId: manifest.publicationId };
    }
    if (hop + 1 >= MAX_SUPERSEDED_HOPS) {
      const error = toPlayerError(
        new PlayerFault('download_failed', 'publication changed repeatedly during the update'),
        { at: nowIso(), publicationId: manifest.publicationId },
      );
      return { kind: 'update_failed', error, publicationId: manifest.publicationId };
    }
    manifest = outcome.next;
  }
}

export interface SyncCounters {
  readonly networkFailures: number;
  readonly updateFailures: number;
}

export function nextCounters(previous: SyncCounters, result: CycleResult): SyncCounters {
  switch (result.kind) {
    case 'up_to_date':
    case 'activated':
      return { networkFailures: 0, updateFailures: 0 };
    case 'unreachable':
      return { ...previous, networkFailures: previous.networkFailures + 1 };
    case 'update_failed':
      return { networkFailures: 0, updateFailures: previous.updateFailures + 1 };
  }
}

/** Delay before the next cycle, given the counters AFTER applying the last result. */
export function nextSyncDelay(
  counters: SyncCounters,
  timings: SyncTimings,
  random: () => number,
): number {
  if (counters.networkFailures > 0) {
    return backoffDelay(timings.networkBackoff, counters.networkFailures, random);
  }
  if (counters.updateFailures > 0) {
    return backoffDelay(timings.updateBackoff, counters.updateFailures, random);
  }
  return jitteredInterval(timings.pollIntervalMs, timings.pollSpread, random);
}

export interface SyncStatus {
  readonly lastCycleAt: string | null;
  readonly lastResult: CycleResult['kind'] | 'never';
  readonly nextCycleInMs: number | null;
  readonly counters: SyncCounters;
  readonly lastAttemptedPublicationId: string | null;
}

/** Runs sync cycles for as long as the player is registered. One cycle at a time. */
export class SyncLoop {
  readonly #deps: SyncDeps;
  readonly #timings: SyncTimings;
  readonly #onRevoked: () => void;
  readonly #onActivated: (publicationId: string) => void;
  readonly #onSettled: (result: CycleResult) => void;
  #wake: AbortController | null = null;
  #wakeRequested = false;
  #gcRequested = false;
  #running = false;
  #status: SyncStatus = {
    lastCycleAt: null,
    lastResult: 'never',
    nextCycleInMs: null,
    counters: { networkFailures: 0, updateFailures: 0 },
    lastAttemptedPublicationId: null,
  };

  constructor(
    deps: SyncDeps,
    handlers: {
      onRevoked(): void;
      onActivated(publicationId: string): void;
      /** Every finished cycle, after onActivated. */
      onSettled?(result: CycleResult): void;
    },
    timings: SyncTimings = DEFAULT_SYNC_TIMINGS,
  ) {
    this.#deps = {
      ...deps,
      onAttempt: (publicationId) => {
        this.#status = { ...this.#status, lastAttemptedPublicationId: publicationId };
        deps.onAttempt?.(publicationId);
      },
    };
    this.#timings = timings;
    this.#onRevoked = () => {
      handlers.onRevoked();
    };
    this.#onActivated = (publicationId) => {
      handlers.onActivated(publicationId);
    };
    this.#onSettled = (result) => {
      handlers.onSettled?.(result);
    };
  }

  get status(): SyncStatus {
    return this.#status;
  }

  /** Starts the loop. It ends when `deps.signal` is aborted or the device is revoked. */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    void this.#run().finally(() => {
      this.#running = false;
    });
  }

  /** Runs the next cycle now instead of waiting (network came back, server hinted at a publish). */
  wake(): void {
    this.#wakeRequested = true;
    this.#wake?.abort();
  }

  /**
   * Asks for unreferenced assets to be removed (the renderer has let go of the previous
   * version). The collection runs inside the loop, never at the same time as an update.
   */
  requestGarbageCollection(): void {
    this.#gcRequested = true;
    this.wake();
  }

  /**
   * The server's heartbeat reply names the publication it wants. Wake the loop only
   * when that is news; a publication that already failed here keeps its backoff.
   */
  hintDesired(publicationId: string | null, activePublicationId: string | null): void {
    if (publicationId === null || publicationId === activePublicationId) return;
    if (publicationId === this.#status.lastAttemptedPublicationId) return;
    this.wake();
  }

  async #run(): Promise<void> {
    const { signal } = this.#deps;
    let counters = this.#status.counters;
    while (!signal.aborted) {
      this.#wakeRequested = false;
      if (this.#gcRequested) {
        this.#gcRequested = false;
        try {
          await collectGarbage(this.#deps);
        } catch (err) {
          this.#deps.report(
            toPlayerError(err, {
              at: new Date(this.#deps.clock.now()).toISOString(),
              publicationId: null,
              fallbackCode: 'storage_error',
            }),
          );
        }
      }
      let result: CycleResult;
      try {
        result = await syncCycle(this.#deps);
      } catch (err) {
        if (err instanceof RevokedError) {
          this.#onRevoked();
          return;
        }
        if (err instanceof AbortedError || signal.aborted) return;
        const error = toPlayerError(err, {
          at: new Date(this.#deps.clock.now()).toISOString(),
          publicationId: null,
        });
        this.#deps.report(error);
        result = { kind: 'update_failed', error, publicationId: null };
      }
      if (result.kind === 'activated') this.#onActivated(result.publicationId);
      this.#onSettled(result);

      counters = nextCounters(counters, result);
      const delay = nextSyncDelay(counters, this.#timings, this.#deps.random);
      this.#status = {
        ...this.#status,
        lastCycleAt: new Date(this.#deps.clock.now()).toISOString(),
        lastResult: result.kind,
        nextCycleInMs: delay,
        counters,
      };

      if (this.#wakeRequested) continue;
      const wake = new AbortController();
      this.#wake = wake;
      try {
        await this.#deps.sleep(delay, AbortSignal.any([signal, wake.signal]));
      } catch {
        // Woken early or shut down; the loop condition decides which.
      } finally {
        this.#wake = null;
      }
    }
  }
}
