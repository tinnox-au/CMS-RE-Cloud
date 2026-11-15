/**
 * Crash accounting for one job. The worker writes `<jobId>.started` before inspecting a
 * file and the API removes it with the job. A marker found at start-up means an earlier
 * attempt died part-way: perhaps because of the file (a decoder that exhausts memory), or
 * for a reason unrelated to it (`docker compose restart`, a deploy, a host out of memory).
 * One more attempt is allowed; a file that kills the worker twice is rejected, so a
 * hostile file cannot keep it in a crash loop.
 */

/** Attempts per job, including the first. */
export const MAX_ATTEMPTS = 2;

export type AttemptDecision =
  { readonly action: 'inspect'; readonly attempt: number } | { readonly action: 'reject' };

/**
 * Decides from the marker's content (null when there is no marker). The content is the
 * number of attempts already started; anything unreadable counts as the maximum.
 */
export function decideAttempt(marker: string | null, maxAttempts = MAX_ATTEMPTS): AttemptDecision {
  if (marker === null) return { action: 'inspect', attempt: 1 };
  const text = marker.trim();
  // An empty marker was written by a worker version that did not count attempts.
  const started = text === '' ? 1 : /^[0-9]{1,3}$/.test(text) ? Number(text) : maxAttempts;
  if (started >= maxAttempts) return { action: 'reject' };
  return { action: 'inspect', attempt: started + 1 };
}
