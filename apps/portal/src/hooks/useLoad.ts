import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbort } from '../api/client.ts';

export type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly data: T;
      /** Set when a later refresh failed; `data` is then the last successful answer. */
      readonly refreshError: unknown;
      /** `performance.now()` when `data` arrived. */
      readonly fetchedAt: number;
    };

export interface LoadResult<T> {
  readonly state: LoadState<T>;
  /** Fetches again now, keeping the current data on screen meanwhile. */
  readonly reload: () => void;
  /** Replaces the data without a request, for example with the answer of a save. */
  readonly setData: (data: T) => void;
}

/**
 * Loads data when mounted and whenever `load` changes (wrap it in useCallback).
 * With `poll` it repeats after each completed attempt while the tab is visible; `poll`
 * may be a function of the latest data, for example "only while something is processing".
 * A failed refresh never discards data that was already shown; it is flagged instead.
 */
export function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  poll: number | null | ((data: T) => number | null) = null,
): LoadResult<T> {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const pollRef = useRef(poll);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let disposed = false;
    let interval: number | null = null;

    const schedule = () => {
      if (disposed || interval === null) return;
      timer = window.setTimeout(
        () => {
          if (document.visibilityState === 'hidden') schedule();
          else void run();
        },
        Math.max(500, interval),
      );
    };

    const run = async () => {
      try {
        const data = await load(controller.signal);
        if (disposed) return;
        const current = pollRef.current;
        interval = typeof current === 'function' ? current(data) : current;
        setState({ status: 'ready', data, refreshError: null, fetchedAt: performance.now() });
      } catch (error) {
        if (disposed || isAbort(error)) return;
        // Keep the previous rhythm after a failed attempt; a fixed interval applies at once.
        const current = pollRef.current;
        if (typeof current !== 'function') interval = current;
        setState((previous) =>
          previous.status === 'ready'
            ? { ...previous, refreshError: error }
            : { status: 'error', error },
        );
      }
      schedule();
    };

    void run();
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [load, nonce]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  const setData = useCallback((data: T) => {
    setState({ status: 'ready', data, refreshError: null, fetchedAt: performance.now() });
  }, []);

  return { state, reload, setData };
}

/** Re-renders the caller every `intervalMs` so relative times keep moving. */
export function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(performance.now());
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
