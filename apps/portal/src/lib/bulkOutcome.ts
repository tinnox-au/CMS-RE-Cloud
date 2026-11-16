/**
 * One change applied to several items, one request after another, where each item succeeds
 * or fails by itself (the tags dialog, the move-to-folder dialog). Pure apart from calling
 * the action it is given.
 */

import { isApiRequestError } from '../api/client.ts';

export interface BulkSuccess<T, R> {
  readonly item: T;
  readonly result: R;
}

export interface BulkFailure<T> {
  readonly item: T;
  /** Whatever the action threw. */
  readonly error: unknown;
}

export interface BulkOutcome<T, R> {
  readonly done: readonly BulkSuccess<T, R>[];
  readonly failed: readonly BulkFailure<T>[];
}

/** How often one item waits out a "too many requests" answer before it counts as failed. */
export const MAX_THROTTLE_WAITS = 5;
/** The wait when a 429 answer says nothing about how long; the API's window is a minute. */
export const DEFAULT_THROTTLE_WAIT_MS = 5_000;
/** The longest single wait; a server asking for more makes the item fail instead. */
export const MAX_THROTTLE_WAIT_MS = 60_000;

/**
 * How long to wait before trying an item again after `error`: the API's `Retry-After` when
 * it throttled the request (429 `rate_limited`), else `DEFAULT_THROTTLE_WAIT_MS`, at least
 * one second. Null for any other error, and for a wait longer than `MAX_THROTTLE_WAIT_MS`.
 * A throttled request was not carried out, so trying it again cannot apply it twice.
 */
export function throttleWaitMs(error: unknown): number | null {
  if (!isApiRequestError(error) || error.status !== 429 || !error.fromApi) return null;
  const asked = error.retryAfterMs ?? DEFAULT_THROTTLE_WAIT_MS;
  if (asked > MAX_THROTTLE_WAIT_MS) return null;
  return Math.max(1_000, asked);
}

export interface RunInSequenceOptions {
  /** Waits `ms`; replaced in tests. */
  readonly wait?: (ms: number) => Promise<void>;
  /** Called before each wait, so the dialog can say why nothing is moving. */
  readonly onThrottled?: (waitMs: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `action` for each item in order, never two at once, and never stops at a failure:
 * the items after it still get their turn. `onProgress` is called after each item with the
 * number finished so far.
 *
 * One request per item can meet the API's rate limit on a large selection. A "too many
 * requests" answer is therefore not a failure of the item: the run waits as long as the
 * server asks (`throttleWaitMs`) and sends the same item again, up to `MAX_THROTTLE_WAITS`
 * times, before it records the item as failed.
 */
export async function runInSequence<T, R>(
  items: readonly T[],
  action: (item: T) => Promise<R>,
  onProgress?: (finished: number, total: number) => void,
  options: RunInSequenceOptions = {},
): Promise<BulkOutcome<T, R>> {
  const wait = options.wait ?? sleep;
  const done: BulkSuccess<T, R>[] = [];
  const failed: BulkFailure<T>[] = [];
  for (const item of items) {
    for (let waits = 0; ; waits += 1) {
      try {
        done.push({ item, result: await action(item) });
        break;
      } catch (error) {
        const delay = waits < MAX_THROTTLE_WAITS ? throttleWaitMs(error) : null;
        if (delay === null) {
          failed.push({ item, error });
          break;
        }
        options.onThrottled?.(delay);
        await wait(delay);
      }
    }
    onProgress?.(done.length + failed.length, items.length);
  }
  return { done, failed };
}

/** Joins the outcome of a retry of the failed items with what had already succeeded. */
export function mergeBulkOutcomes<T, R>(
  earlier: BulkOutcome<T, R>,
  retry: BulkOutcome<T, R>,
): BulkOutcome<T, R> {
  return { done: [...earlier.done, ...retry.done], failed: retry.failed };
}

/** "1 file", "3 files", "2 screens". */
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The title of the notice after a run in which something failed:
 * "2 of 5 files were not updated", "The file was not updated" for a single item.
 */
export function bulkFailureTitle(
  failedCount: number,
  total: number,
  singular: string,
  verb: string,
  plural = `${singular}s`,
): string {
  if (total <= 1) return `The ${singular} was not ${verb}`;
  if (failedCount >= total)
    return `None of the ${total} ${plural} ${total === 1 ? 'was' : 'were'} ${verb}`;
  return `${failedCount} of ${total} ${plural} ${failedCount === 1 ? 'was' : 'were'} not ${verb}`;
}
