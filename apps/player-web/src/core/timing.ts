import { AbortedError } from './errors.ts';
import type { Clock, Sleep } from './types.ts';

export const systemClock: Clock = { now: () => Date.now() };

/**
 * Resolves after `ms`; rejects with AbortedError when the signal fires first.
 * The abort listener is removed when the timer completes, so a long-lived signal
 * does not collect listeners over days of playback.
 */
export const sleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new AbortedError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.max(0, Math.min(ms, 2_147_000_000)),
    );
    signal?.addEventListener('abort', onAbort, { once: true });
  });
