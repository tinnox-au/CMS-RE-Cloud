/** Which toasts stay on screen, and for how long. Pure. */

/** Milliseconds a toast shows when the caller does not say. */
export const DEFAULT_TOAST_DURATION_MS = 5000;

/**
 * How long a toast stays before it leaves by itself, or `null` when it stays until it is
 * dismissed. An error stays unless the caller gave it a duration.
 */
export function toastDuration(
  isError: boolean,
  durationMs: number | null | undefined,
): number | null {
  if (durationMs === undefined) return isError ? null : DEFAULT_TOAST_DURATION_MS;
  return durationMs;
}

/** What the queue needs to know about a toast. */
export interface QueuedToast {
  readonly id: string;
  /** True for a toast that stays until it is dismissed. */
  readonly sticky: boolean;
}

/**
 * Adds `next` to the visible toasts and keeps at most `max` of them.
 *
 * When one has to go, it is the oldest toast that would have left by itself anyway. A toast
 * that stays until dismissed (an error) is given up only when every older toast is one too;
 * the toast just added is never the one removed.
 */
export function pushToast<T extends QueuedToast>(
  current: readonly T[],
  next: T,
  max: number,
): readonly T[] {
  const limit = Math.max(1, Math.floor(max));
  const kept = [...current];
  while (kept.length >= limit) {
    const passing = kept.findIndex((toast) => !toast.sticky);
    kept.splice(passing === -1 ? 0 : passing, 1);
  }
  return [...kept, next];
}
