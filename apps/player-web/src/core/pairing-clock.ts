/**
 * Pairing-code timing that does not trust the device clock to agree with the server.
 *
 * The server returns its absolute expiry and a relative lifetime. Comparing the absolute
 * expiry with Date.now() breaks on a device whose clock is wrong: a clock ten minutes fast
 * treats every fresh code as already expired and keeps asking for new ones. Instead the
 * player turns the relative lifetime into a deadline on its own clock at the moment the
 * response arrives. Whether a code is still valid is decided by the server's poll answer;
 * the local deadline only drives the countdown and gives up when the server cannot be asked.
 */

/** Extra time after the local deadline before a code is abandoned without the server's word. */
export const PAIRING_EXPIRY_SLACK_MS = 30_000;

export function localPairingDeadline(receivedAtMs: number, expiresInSeconds: number): number {
  return Math.floor(receivedAtMs + Math.max(0, expiresInSeconds) * 1000);
}

/** Seconds left on the local clock, for the countdown (never negative). */
export function pairingSecondsLeft(localDeadlineMs: number, nowMs: number): number {
  return Math.max(0, (localDeadlineMs - nowMs) / 1000);
}

/** A stored code is reused after a reload only if it has at least `minRemainingMs` left. */
export function canReusePairing(
  localDeadlineMs: number,
  nowMs: number,
  minRemainingMs: number,
): boolean {
  return localDeadlineMs - nowMs >= minRemainingMs;
}

/**
 * True when the player should give up on a code without a server answer (for example
 * while offline). A server answer of "expired" or "consumed" ends it earlier.
 */
export function pairingAbandoned(localDeadlineMs: number, nowMs: number): boolean {
  return nowMs >= localDeadlineMs + PAIRING_EXPIRY_SLACK_MS;
}

/**
 * How long to wait after a failed poll. `waitMs` is the ordinary wait, which is cut short at
 * the code's local deadline so an expired code is replaced rather than held (at least one
 * second). A `Retry-After` from the server (`heldMs`) is never cut short: the deadline only
 * shortens the player's own backoff.
 */
export function pairingPollRetryWait(
  waitMs: number,
  heldMs: number,
  localDeadlineMs: number,
  nowMs: number,
): number {
  return Math.max(heldMs, Math.min(waitMs, Math.max(1_000, localDeadlineMs - nowMs)));
}
