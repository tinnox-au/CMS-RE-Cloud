/** Exponential backoff with jitter. Pure: the random source is injected. */
export interface BackoffPolicy {
  /** Delay after the first failure. */
  readonly baseMs: number;
  /** Ceiling for the un-jittered delay. */
  readonly maxMs: number;
  /** Multiplier per additional failure (2 doubles). */
  readonly factor: number;
  /** Share of the delay that is randomised, 0 to 1. 0.5 gives a delay in [50 %, 100 %] of nominal. */
  readonly jitter: number;
}

function unit(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(Math.max(value, 0), 1);
}

/**
 * Delay before the next attempt after `failures` consecutive failures (1 or more).
 * The result is always between `nominal * (1 - jitter)` and `nominal`, where
 * `nominal = min(maxMs, baseMs * factor^(failures - 1))`.
 */
export function backoffDelay(
  policy: BackoffPolicy,
  failures: number,
  random: () => number,
): number {
  const n = Math.max(1, Math.floor(failures));
  // Cap the exponent so the power cannot overflow to Infinity.
  const nominal = Math.min(
    policy.maxMs,
    policy.baseMs * Math.pow(policy.factor, Math.min(n - 1, 40)),
  );
  const jitter = Math.min(Math.max(policy.jitter, 0), 1);
  return Math.round(nominal * (1 - jitter + jitter * unit(random)));
}

/** A regular interval spread by ±`spread` (0 to 1) so many players do not poll in step. */
export function jitteredInterval(baseMs: number, spread: number, random: () => number): number {
  const s = Math.min(Math.max(spread, 0), 1);
  return Math.round(baseMs * (1 - s + 2 * s * unit(random)));
}
