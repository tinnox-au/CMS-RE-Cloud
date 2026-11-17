import { PlayerFault } from './errors.ts';

/**
 * The longest `Retry-After` taken at its word. A larger value is read as this.
 * The API's own windows are at most 10 minutes, and the portal client uses the same cap.
 */
export const MAX_RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * Reads a `Retry-After` header: delay-seconds or an HTTP-date (RFC 9110).
 * Null when the header is missing or unreadable. A date in the past reads as 0.
 */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (header === null) return null;
  const text = header.trim();
  if (/^\d{1,10}$/.test(text)) return Math.min(Number(text) * 1000, MAX_RETRY_AFTER_MS);
  if (!/[a-z]/i.test(text)) return null;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now), MAX_RETRY_AFTER_MS);
}

/**
 * How long to wait before trying again. At least the ordinary backoff, and at least
 * the server's `Retry-After` when it sent one.
 */
export function retryDelay(backoffMs: number, retryAfterMs: number | null | undefined): number {
  return Math.max(backoffMs, heldRetryMs(retryAfterMs));
}

/** The part of a wait a wake must not cut short. 0 when the server did not ask. */
export function heldRetryMs(retryAfterMs: number | null | undefined): number {
  if (retryAfterMs === null || retryAfterMs === undefined || !Number.isFinite(retryAfterMs)) {
    return 0;
  }
  return Math.min(Math.max(0, retryAfterMs), MAX_RETRY_AFTER_MS);
}

/** `Retry-After` carried on a fault, or null when `err` has none. */
export function retryAfterMsOf(err: unknown): number | null {
  return err instanceof PlayerFault ? err.retryAfterMs : null;
}
