import {
  HEARTBEAT_SCHEMA_VERSION,
  HeartbeatV1Schema,
  type HeartbeatResponse,
  type HeartbeatV1,
  type PlayerError,
  type PlayerState,
} from '@tinnox/contracts';
import { backoffDelay, jitteredInterval, type BackoffPolicy } from './backoff.ts';
import { AbortedError, RevokedError, toPlayerError } from './errors.ts';
import type { Clock, Sleep, StagingRecord, StateStore } from './types.ts';

/** Everything a heartbeat says, gathered at the moment of sending. Nothing is queued. */
export interface HeartbeatSnapshot {
  readonly displayId: string;
  /** Publication stored as complete and verified (the active version in the state store). */
  readonly downloadedPublicationId: string | null;
  /** What the renderer has on screen right now. */
  readonly rendering: { readonly publicationId: string; readonly itemIndex: number } | null;
  readonly playerState: PlayerState;
  readonly staging: Pick<StagingRecord, 'manifest' | 'phase' | 'assetsDone' | 'assetsTotal'> | null;
  readonly errors: readonly PlayerError[];
  readonly version: string;
  readonly storagePersisted: boolean | null;
  readonly online: boolean;
}

/**
 * Builds a schema-valid heartbeat. The player never reports `playing` without
 * something on screen: the state is downgraded to `idle` instead.
 */
export function buildHeartbeat(
  snapshot: HeartbeatSnapshot,
  seq: number,
  sentAt: string,
): HeartbeatV1 {
  const rendering = snapshot.rendering;
  const playerState: PlayerState =
    snapshot.playerState === 'playing' && rendering === null ? 'idle' : snapshot.playerState;
  return HeartbeatV1Schema.parse({
    schemaVersion: HEARTBEAT_SCHEMA_VERSION,
    seq,
    sentAt,
    displayId: snapshot.displayId,
    downloadedPublicationId: snapshot.downloadedPublicationId,
    activePublicationId: rendering?.publicationId ?? null,
    activeItemIndex: rendering?.itemIndex ?? null,
    playerState,
    staging:
      snapshot.staging === null
        ? null
        : {
            publicationId: snapshot.staging.manifest.publicationId,
            phase: snapshot.staging.phase,
            assetsDone: Math.min(snapshot.staging.assetsDone, snapshot.staging.assetsTotal),
            assetsTotal: snapshot.staging.assetsTotal,
          },
    errors: [...snapshot.errors],
    player: {
      version: snapshot.version.slice(0, 40),
      storagePersisted: snapshot.storagePersisted,
      online: snapshot.online,
    },
  } satisfies HeartbeatV1);
}

export interface HeartbeatTimings {
  readonly intervalMs: number;
  readonly spread: number;
  /** Shortest time between two reports, however many state changes happen. */
  readonly minGapMs: number;
  readonly backoff: BackoffPolicy;
}

export const DEFAULT_HEARTBEAT_TIMINGS: HeartbeatTimings = {
  intervalMs: 15_000,
  spread: 0.1,
  minGapMs: 2_000,
  backoff: { baseMs: 5_000, maxMs: 60_000, factor: 2, jitter: 0.5 },
};

export interface HeartbeatDeps {
  readonly state: Pick<StateStore, 'nextHeartbeatSeq'>;
  /** Null when there is nothing to report (not registered). */
  snapshot(): Promise<HeartbeatSnapshot | null>;
  send(heartbeat: HeartbeatV1): Promise<HeartbeatResponse>;
  readonly clock: Clock;
  readonly sleep: Sleep;
  readonly random: () => number;
  readonly signal: AbortSignal;
  onRevoked(): void;
  onResponse?(response: HeartbeatResponse): void;
  /** Local-only note about a failed report. It is NOT added to the heartbeat error list. */
  onSendFailure?(error: PlayerError): void;
}

export interface HeartbeatStatus {
  readonly lastSeq: number | null;
  readonly lastAcceptedAt: string | null;
  readonly lastFailure: string | null;
  readonly consecutiveFailures: number;
}

/**
 * Sends the current state every interval and soon after a state change.
 * There is no queue: while offline, reports are simply not sent, and the first
 * report after reconnecting carries the state at that moment.
 */
export class HeartbeatLoop {
  readonly #deps: HeartbeatDeps;
  readonly #timings: HeartbeatTimings;
  #wake: AbortController | null = null;
  #dirty = false;
  #running = false;
  #status: HeartbeatStatus = {
    lastSeq: null,
    lastAcceptedAt: null,
    lastFailure: null,
    consecutiveFailures: 0,
  };

  constructor(deps: HeartbeatDeps, timings: HeartbeatTimings = DEFAULT_HEARTBEAT_TIMINGS) {
    this.#deps = deps;
    this.#timings = timings;
  }

  get status(): HeartbeatStatus {
    return this.#status;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    void this.#run().finally(() => {
      this.#running = false;
    });
  }

  /** Something worth reporting changed (state, publication, staging phase, connectivity). */
  notifyChange(): void {
    this.#dirty = true;
    this.#wake?.abort();
  }

  /** Sends one report now. Returns the server's suggested interval, or null on failure. */
  async sendOnce(): Promise<number | null> {
    const snapshot = await this.#deps.snapshot();
    if (snapshot === null) return null;
    const nowMs = this.#deps.clock.now();
    const seq = await this.#deps.state.nextHeartbeatSeq(nowMs);
    const heartbeat = buildHeartbeat(snapshot, seq, new Date(nowMs).toISOString());
    const response = await this.#deps.send(heartbeat);
    this.#status = {
      lastSeq: seq,
      lastAcceptedAt: new Date(this.#deps.clock.now()).toISOString(),
      lastFailure: null,
      consecutiveFailures: 0,
    };
    this.#deps.onResponse?.(response);
    return response.nextHeartbeatInMs;
  }

  async #run(): Promise<void> {
    const { signal, sleep, random } = this.#deps;
    let interval = this.#timings.intervalMs;
    while (!signal.aborted) {
      this.#dirty = false;
      const startedAt = this.#deps.clock.now();
      let delay: number;
      try {
        const suggested = await this.sendOnce();
        if (suggested !== null) interval = suggested;
        delay = jitteredInterval(interval, this.#timings.spread, random);
      } catch (err) {
        if (err instanceof RevokedError) {
          this.#deps.onRevoked();
          return;
        }
        if (err instanceof AbortedError || signal.aborted) return;
        const failures = this.#status.consecutiveFailures + 1;
        const error = toPlayerError(err, {
          at: new Date(this.#deps.clock.now()).toISOString(),
          publicationId: null,
          fallbackCode: 'network_error',
        });
        this.#status = {
          ...this.#status,
          lastFailure: error.message,
          consecutiveFailures: failures,
        };
        this.#deps.onSendFailure?.(error);
        delay = backoffDelay(this.#timings.backoff, failures, random);
      }

      // Wait for the interval, or until a change is flagged; then respect the minimum gap.
      if (!this.#dirty) {
        const wake = new AbortController();
        this.#wake = wake;
        try {
          await sleep(delay, AbortSignal.any([signal, wake.signal]));
        } catch {
          // Woken by a change, or shut down.
        } finally {
          this.#wake = null;
        }
      }
      if (signal.aborted) return;
      const sinceStart = this.#deps.clock.now() - startedAt;
      // A failing connection must not be hammered just because state keeps changing.
      const floor =
        this.#status.consecutiveFailures > 0
          ? Math.min(delay, this.#timings.backoff.baseMs)
          : this.#timings.minGapMs;
      if (sinceStart < floor) {
        try {
          await sleep(floor - sinceStart, signal);
        } catch {
          return;
        }
      }
    }
  }
}
