/**
 * Idempotency keys for publishing.
 *
 * One key stands for one operator intent: "publish this saved playlist revision to
 * this display". If the outcome of a request is unknown (no response, server fault),
 * the retry must carry the same key so the server cannot create two publications.
 * Once the server has clearly answered (created or refused), the next click is a new
 * intent and gets a new key.
 */
export interface PublishIntent {
  readonly signature: string;
  readonly key: string;
}

export function intentSignature(
  playlistId: string,
  displayId: string,
  playlistRevision: string,
): string {
  return `${playlistId}|${displayId}|${playlistRevision}`;
}

/** Returns the pending intent when it matches, otherwise a new one with a fresh key. */
export function intentFor(
  pending: PublishIntent | null,
  signature: string,
  newKey: () => string,
): PublishIntent {
  if (pending !== null && pending.signature === signature) return pending;
  return { signature, key: newKey() };
}

export type PublishOutcome = 'succeeded' | 'refused' | 'unknown';

/** What to remember after an attempt: keep the intent only while its outcome is unknown. */
export function intentAfter(intent: PublishIntent, outcome: PublishOutcome): PublishIntent | null {
  return outcome === 'unknown' ? intent : null;
}
