import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../api/client.ts';
import {
  MAX_THROTTLE_WAITS,
  bulkFailureTitle,
  countOf,
  mergeBulkOutcomes,
  runInSequence,
  throttleWaitMs,
} from './bulkOutcome.ts';

function throttled(retryAfterMs: number | null = 2_000): ApiRequestError {
  return new ApiRequestError({
    status: 429,
    code: 'rate_limited',
    message: 'Too many requests. Try again in 2 seconds.',
    fromApi: true,
    retryAfterMs,
  });
}

describe('waiting out the rate limit', () => {
  it('reads how long to wait from a throttled answer only', () => {
    expect(throttleWaitMs(throttled(2_000))).toBe(2_000);
    expect(throttleWaitMs(throttled(null))).toBe(5_000);
    expect(throttleWaitMs(throttled(0))).toBe(1_000);
    expect(throttleWaitMs(throttled(120_000))).toBeNull();
    expect(throttleWaitMs(new Error('x'))).toBeNull();
    expect(
      throttleWaitMs(
        new ApiRequestError({ status: 409, code: 'conflict', message: 'x', fromApi: true }),
      ),
    ).toBeNull();
    // A 429 that did not come from the API (a proxy) is not taken as a promise to wait.
    expect(
      throttleWaitMs(
        new ApiRequestError({
          status: 429,
          code: 'invalid_response',
          message: 'x',
          fromApi: false,
        }),
      ),
    ).toBeNull();
  });

  it('sends a throttled item again after the wait the server asked for', async () => {
    const waits: number[] = [];
    const told: number[] = [];
    const calls: string[] = [];
    let throttle = 2;
    const progress: number[] = [];
    const outcome = await runInSequence(
      ['a', 'b', 'c'],
      (item) => {
        calls.push(item);
        if (item === 'b' && throttle > 0) {
          throttle -= 1;
          return Promise.reject(throttled(3_000));
        }
        return Promise.resolve(item);
      },
      (finished) => progress.push(finished),
      {
        wait: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
        onThrottled: (ms) => told.push(ms),
      },
    );
    expect(calls).toEqual(['a', 'b', 'b', 'b', 'c']);
    expect(waits).toEqual([3_000, 3_000]);
    expect(told).toEqual([3_000, 3_000]);
    expect(outcome.done.map((d) => d.item)).toEqual(['a', 'b', 'c']);
    expect(outcome.failed).toEqual([]);
    // Progress moves once per item, not per attempt.
    expect(progress).toEqual([1, 2, 3]);
  });

  it('records the item as failed after the last wait, and goes on with the next', async () => {
    let waits = 0;
    const outcome = await runInSequence(
      ['a', 'b'],
      (item) => (item === 'a' ? Promise.reject(throttled()) : Promise.resolve(item)),
      undefined,
      {
        wait: () => {
          waits += 1;
          return Promise.resolve();
        },
      },
    );
    expect(waits).toBe(MAX_THROTTLE_WAITS);
    expect(outcome.failed.map((f) => f.item)).toEqual(['a']);
    expect((outcome.failed[0]?.error as ApiRequestError).code).toBe('rate_limited');
    expect(outcome.done.map((d) => d.item)).toEqual(['b']);
  });
});

describe('running one change over several items', () => {
  it('runs one at a time, in order, and carries on after a failure', async () => {
    const log: string[] = [];
    let running = 0;
    let mostAtOnce = 0;
    const progress: [number, number][] = [];
    const outcome = await runInSequence(
      ['a', 'b', 'c'],
      async (item) => {
        running += 1;
        mostAtOnce = Math.max(mostAtOnce, running);
        log.push(`start ${item}`);
        await Promise.resolve();
        running -= 1;
        if (item === 'b') throw new Error('refused');
        log.push(`end ${item}`);
        return item.toUpperCase();
      },
      (finished, total) => progress.push([finished, total]),
    );
    expect(mostAtOnce).toBe(1);
    expect(log).toEqual(['start a', 'end a', 'start b', 'start c', 'end c']);
    expect(outcome.done).toEqual([
      { item: 'a', result: 'A' },
      { item: 'c', result: 'C' },
    ]);
    expect(outcome.failed.map((f) => f.item)).toEqual(['b']);
    expect(outcome.failed[0]?.error).toBeInstanceOf(Error);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('does nothing for an empty list', async () => {
    let calls = 0;
    const outcome = await runInSequence([], async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    expect(outcome).toEqual({ done: [], failed: [] });
  });

  it('joins a retry of the failed items with what had already succeeded', () => {
    const first = {
      done: [{ item: 'a', result: 1 }],
      failed: [
        { item: 'b', error: 'x' },
        { item: 'c', error: 'y' },
      ],
    };
    const retry = { done: [{ item: 'b', result: 2 }], failed: [{ item: 'c', error: 'z' }] };
    expect(mergeBulkOutcomes(first, retry)).toEqual({
      done: [
        { item: 'a', result: 1 },
        { item: 'b', result: 2 },
      ],
      failed: [{ item: 'c', error: 'z' }],
    });
  });
});

describe('wording of a run', () => {
  it('counts things', () => {
    expect(countOf(1, 'file')).toBe('1 file');
    expect(countOf(3, 'file')).toBe('3 files');
    expect(countOf(0, 'screen')).toBe('0 screens');
  });

  it('titles the notice after a failure', () => {
    expect(bulkFailureTitle(1, 1, 'file', 'updated')).toBe('The file was not updated');
    expect(bulkFailureTitle(1, 5, 'file', 'updated')).toBe('1 of 5 files was not updated');
    expect(bulkFailureTitle(2, 5, 'screen', 'updated')).toBe('2 of 5 screens were not updated');
    expect(bulkFailureTitle(5, 5, 'file', 'moved')).toBe('None of the 5 files were moved');
  });
});
