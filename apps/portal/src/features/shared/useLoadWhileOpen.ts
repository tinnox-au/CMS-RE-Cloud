import { useCallback, useState } from 'react';
import { isAbort } from '../../api/client.ts';
import { useLoad } from '../../hooks/useLoad.ts';

export type OpenLoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly data: T;
      /** `performance.now()` when `data` arrived. */
      readonly fetchedAt: number;
    };

interface Tagged<T> {
  readonly opening: number;
  readonly result:
    | { readonly ok: true; readonly data: T; readonly fetchedAt: number }
    | { readonly ok: false; readonly error: unknown };
}

/**
 * Loads data for a dialog: nothing while it is closed, afresh each time it opens. What an
 * earlier opening loaded, or failed to load, is never shown again; the dialog starts on its
 * skeleton. `loader` must be a stable function (declare it at module level).
 */
export function useLoadWhileOpen<T>(
  open: boolean,
  loader: (signal: AbortSignal) => Promise<T>,
): { readonly state: OpenLoadState<T>; readonly reload: () => void } {
  const [opening, setOpening] = useState(open ? 1 : 0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening(opening + 1);
  }

  const load = useCallback(
    async (signal: AbortSignal): Promise<Tagged<T> | null> => {
      if (!open) return null;
      try {
        const data = await loader(signal);
        return { opening, result: { ok: true, data, fetchedAt: performance.now() } };
      } catch (error) {
        if (isAbort(error)) throw error;
        return { opening, result: { ok: false, error } };
      }
    },
    [open, opening, loader],
  );
  const { state, reload } = useLoad(load);

  if (state.status === 'error') return { state: { status: 'error', error: state.error }, reload };
  if (state.status === 'loading' || state.data === null || state.data.opening !== opening) {
    return { state: { status: 'loading' }, reload };
  }
  const { result } = state.data;
  if (!result.ok) return { state: { status: 'error', error: result.error }, reload };
  return { state: { status: 'ready', data: result.data, fetchedAt: result.fetchedAt }, reload };
}
