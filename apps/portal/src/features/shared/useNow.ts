import { useSyncExternalStore } from 'react';

/**
 * One clock for every relative time on the page ("Last report 12 seconds ago"). However
 * many status pills are showing, a single timer runs, and none when nothing listens.
 */
const TICK_MS = 1000;

const listeners = new Set<() => void>();
let timer: number | undefined;
let now = 0;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    now = performance.now();
    timer = window.setInterval(() => {
      now = performance.now();
      for (const notify of listeners) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

function read(): number {
  return now;
}

/**
 * `performance.now()` as of the last tick, re-rendering the caller once a second while
 * `ticking` is true. Compare it with `fetchedAt` of a `useLoad` state.
 */
export function useNow(ticking = true): number {
  return useSyncExternalStore(ticking ? subscribe : subscribeToNothing, read);
}
