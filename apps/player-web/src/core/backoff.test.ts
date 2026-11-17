import { describe, expect, it } from 'vitest';
import { backoffDelay, jitteredInterval, type BackoffPolicy } from './backoff.ts';
import { DEFAULT_SYNC_TIMINGS, nextCounters, nextSyncDelay } from './sync.ts';

const policy: BackoffPolicy = { baseMs: 1_000, maxMs: 60_000, factor: 2, jitter: 0.5 };

describe('backoffDelay', () => {
  it('doubles from the base and stops at the ceiling (upper edge of the jitter)', () => {
    const top = (): number => 1;
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => backoffDelay(policy, n, top))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000,
    ]);
  });

  it('stays inside [nominal × (1 − jitter), nominal] for any random value', () => {
    for (const r of [0, 0.01, 0.25, 0.5, 0.99, 1]) {
      for (let failures = 1; failures <= 12; failures += 1) {
        const nominal = Math.min(60_000, 1_000 * 2 ** (failures - 1));
        const delay = backoffDelay(policy, failures, () => r);
        expect(delay).toBeGreaterThanOrEqual(nominal * 0.5);
        expect(delay).toBeLessThanOrEqual(nominal);
      }
    }
  });

  it('is safe with nonsense input: zero or huge failure counts, bad random sources', () => {
    expect(backoffDelay(policy, 0, () => 1)).toBe(1_000);
    expect(backoffDelay(policy, -5, () => 1)).toBe(1_000);
    expect(backoffDelay(policy, 100_000, () => 1)).toBe(60_000);
    expect(backoffDelay(policy, 3, () => Number.NaN)).toBe(3_000);
    expect(backoffDelay(policy, 3, () => 7)).toBe(4_000);
    expect(backoffDelay(policy, 3, () => -7)).toBe(2_000);
  });

  it('has no jitter when the policy asks for none', () => {
    expect(backoffDelay({ ...policy, jitter: 0 }, 3, () => 0)).toBe(4_000);
  });
});

describe('jitteredInterval', () => {
  it('spreads symmetrically around the base', () => {
    expect(jitteredInterval(10_000, 0.2, () => 0)).toBe(8_000);
    expect(jitteredInterval(10_000, 0.2, () => 0.5)).toBe(10_000);
    expect(jitteredInterval(10_000, 0.2, () => 1)).toBe(12_000);
  });
});

describe('sync loop delay', () => {
  const top = (): number => 1;
  it('polls at the regular interval while healthy', () => {
    const delay = nextSyncDelay(
      { networkFailures: 0, updateFailures: 0 },
      DEFAULT_SYNC_TIMINGS,
      () => 0.5,
    );
    expect(delay).toBe(DEFAULT_SYNC_TIMINGS.pollIntervalMs);
  });

  it('backs off exponentially while the server is unreachable, up to five minutes', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      nextSyncDelay({ networkFailures: n, updateFailures: 0 }, DEFAULT_SYNC_TIMINGS, top),
    );
    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
  });

  it('backs off separately, and more slowly, while an update keeps failing', () => {
    expect(
      nextSyncDelay({ networkFailures: 0, updateFailures: 1 }, DEFAULT_SYNC_TIMINGS, top),
    ).toBe(30_000);
    expect(
      nextSyncDelay({ networkFailures: 0, updateFailures: 20 }, DEFAULT_SYNC_TIMINGS, top),
    ).toBe(600_000);
  });

  it('holds a failed update for the Retry-After of its last download (FCX-06)', () => {
    // The ordinary update backoff after one failure is 30 s; the server asked for 10 minutes.
    expect(
      nextSyncDelay({ networkFailures: 0, updateFailures: 1 }, DEFAULT_SYNC_TIMINGS, top, 600_000),
    ).toBe(600_000);
    expect(
      nextSyncDelay({ networkFailures: 0, updateFailures: 1 }, DEFAULT_SYNC_TIMINGS, top, 5_000),
    ).toBe(30_000);
  });

  it('counts failures by kind and clears them on success', () => {
    const error = {
      code: 'network_error',
      message: 'x',
      at: '2026-11-14T00:00:00.000Z',
      publicationId: null,
      assetId: null,
    } as const;
    let counters = { networkFailures: 0, updateFailures: 0 };
    counters = nextCounters(counters, { kind: 'unreachable', error, retryAfterMs: null });
    counters = nextCounters(counters, { kind: 'unreachable', error, retryAfterMs: null });
    expect(counters).toEqual({ networkFailures: 2, updateFailures: 0 });
    counters = nextCounters(counters, { kind: 'update_failed', error, publicationId: null });
    expect(counters).toEqual({ networkFailures: 0, updateFailures: 1 });
    counters = nextCounters(counters, { kind: 'unreachable', error, retryAfterMs: null });
    expect(counters).toEqual({ networkFailures: 1, updateFailures: 1 });
    expect(nextCounters(counters, { kind: 'up_to_date' })).toEqual({
      networkFailures: 0,
      updateFailures: 0,
    });
    expect(nextCounters(counters, { kind: 'activated', publicationId: 'p' })).toEqual({
      networkFailures: 0,
      updateFailures: 0,
    });
  });
});
