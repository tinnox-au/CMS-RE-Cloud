import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbort } from '../api/client.ts';
import { createReadOrder } from '../lib/readOrder.ts';

/** Back-off before re-reading when a refresh failed before a function `poll` knew its rhythm. */
export const REFRESH_RETRY_MS = 5_000;
/** The back-off doubles while those re-reads keep failing, up to this. */
export const REFRESH_RETRY_MAX_MS = 60_000;

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
  /**
   * Replaces the data without a request, for example with the answer of a save. A read that
   * was already in flight is then discarded, so it cannot put older data back.
   */
  readonly setData: (data: T) => void;
}

/**
 * Loads data when mounted and whenever `load` changes (wrap it in useCallback).
 * With `poll` it repeats after each completed attempt while the tab is visible; `poll`
 * may be a function of the latest data, for example "only while something is processing".
 * A failed refresh never discards data that was already shown; it is flagged instead. If it
 * was the first read after `reload()` or a new `load` and `poll` is a function, the hook
 * retries after `REFRESH_RETRY_MS` (doubling up to `REFRESH_RETRY_MAX_MS` while re-reads keep
 * failing) and the next answer decides the rhythm again.
 *
 * A new `load` (another filter, a status read forced after pairing) also keeps the current
 * data on screen until its answer arrives, and a failure is flagged as `refreshError`. That
 * is right for another view of the same thing, not for another object: a page that shows one
 * object by id must be mounted under a key of that id (App.tsx does this for the detail
 * routes), so a different id starts from 'loading' and a missing one ends in 'error'.
 */
export function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  poll: number | null | ((data: T) => number | null) = null,
): LoadResult<T> {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const pollRef = useRef(poll);
  // setData invalidates reads already in flight, so a slower answer cannot undo a save.
  const order = useRef(createReadOrder()).current;
  // True once data is shown (state 'ready'); it stays shown for the life of the hook.
  const shown = useRef(false);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let disposed = false;
    let interval: number | null = null;
    // Set while re-reading after a failed refresh, so failures in a row back off.
    let retrying = false;

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
      const ticket = order.begin();
      try {
        const data = await load(controller.signal);
        if (disposed) return;
        if (!order.isCurrent(ticket)) {
          // Started before setData: its answer may be older than the data shown. Drop it
          // and keep the rhythm; the next poll or reload reads again.
          schedule();
          return;
        }
        const current = pollRef.current;
        interval = typeof current === 'function' ? current(data) : current;
        retrying = false;
        shown.current = true;
        setState({ status: 'ready', data, refreshError: null, fetchedAt: performance.now() });
      } catch (error) {
        if (disposed || isAbort(error)) return;
        if (!order.isCurrent(ticket)) {
          schedule();
          return;
        }
        // Keep the previous rhythm after a failed attempt; a fixed interval applies at once.
        // A failed refresh before a function poll knew its rhythm retries, so a reload that
        // failed does not end the polling; a failed first load waits for the Retry button.
        const current = pollRef.current;
        if (typeof current !== 'function') interval = current;
        else if (retrying && interval !== null) {
          interval = Math.min(interval * 2, REFRESH_RETRY_MAX_MS);
        } else if (interval === null && shown.current) {
          interval = REFRESH_RETRY_MS;
          retrying = true;
        }
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
  }, [load, nonce, order]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  const setData = useCallback(
    (data: T) => {
      order.invalidate();
      shown.current = true;
      setState({ status: 'ready', data, refreshError: null, fetchedAt: performance.now() });
    },
    [order],
  );

  return { state, reload, setData };
}
