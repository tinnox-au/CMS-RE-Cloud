import type { Limits, MediaDto } from '@tinnox/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAbort, isRoleRefusal } from '../../../api/client.ts';
import { apiClient } from '../../../api/index.ts';
import { uploadMedia, type UploadHandle } from '../../../api/upload.ts';
import {
  isFinished,
  newEntry,
  nextToStart,
  patchEntry,
  type UploadEntry,
} from '../../../lib/uploadQueue.ts';

export interface UploadQueue {
  /** One entry per file added, in the order they were added. */
  readonly entries: readonly UploadEntry[];
  /** The server's answer to each upload that went through, by entry id. */
  readonly uploaded: ReadonlyMap<string, MediaDto>;
  /** Adds files to the end of the queue. The file type is not looked at: the server decides. */
  readonly addFiles: (files: readonly File[]) => void;
  /** Stops the upload in flight, or takes a waiting file out of the queue. */
  readonly cancel: (id: string) => void;
  /** Queues a failed or cancelled file again. */
  readonly retry: (id: string) => void;
  /** Removes every entry that is neither waiting nor in flight. */
  readonly clearFinished: () => void;
}

interface QueueState {
  readonly entries: readonly UploadEntry[];
  readonly uploaded: ReadonlyMap<string, MediaDto>;
}

const EMPTY: QueueState = { entries: [], uploaded: new Map() };

function patch(
  state: QueueState,
  id: string,
  change: Partial<Omit<UploadEntry, 'id'>>,
): QueueState {
  return { ...state, entries: patchEntry(state.entries, id, change) };
}

/**
 * The M0 upload queue, unchanged in behaviour: files go to the server one at a time, in the
 * order they were added, so progress is honest and the server's storage accounting stays
 * simple. A file is checked only for what can be known without reading it (empty, over the
 * upload limit); its type is never judged here.
 *
 * `onSettled` runs after every upload that ended, however it ended: the outcome on the server
 * may be unknown, so the caller reloads the list. An upload in flight is aborted when the
 * component that holds the queue goes away.
 */
export function useUploadQueue(
  limits: Pick<Limits, 'maxUploadBytes'>,
  onSettled: () => void,
): UploadQueue {
  const [state, setState] = useState<QueueState>(EMPTY);
  const files = useRef(new Map<string, File>());
  const active = useRef<{ id: string; handle: UploadHandle } | null>(null);
  const { entries, uploaded } = state;

  // Start the next queued upload whenever nothing is in flight.
  useEffect(() => {
    if (active.current !== null) return;
    const next = nextToStart(entries);
    if (next === null) return;
    const file = files.current.get(next.id);
    if (file === undefined) {
      setState((previous) => patch(previous, next.id, { status: 'cancelled' }));
      return;
    }
    const id = next.id;
    const handle = uploadMedia(apiClient, file, (loaded) => {
      setState((previous) => patch(previous, id, { loaded: Math.min(loaded, file.size) }));
    });
    active.current = { id, handle };
    setState((previous) => patch(previous, id, { status: 'uploading', loaded: 0 }));
    handle.done
      .then((media) => {
        files.current.delete(id);
        setState((previous) => ({
          entries: patchEntry(previous.entries, id, { status: 'done', loaded: file.size }),
          uploaded: new Map(previous.uploaded).set(id, media),
        }));
        onSettled();
      })
      .catch((error: unknown) => {
        setState((previous) => {
          // A refusal by role refuses every file after it too: fail the waiting ones with the
          // same message instead of sending them one by one.
          if (isRoleRefusal(error)) {
            return {
              ...previous,
              entries: previous.entries.map((entry) =>
                entry.id === id || entry.status === 'queued'
                  ? { ...entry, status: 'failed', error }
                  : entry,
              ),
            };
          }
          return patch(
            previous,
            id,
            isAbort(error) ? { status: 'cancelled' } : { status: 'failed', error },
          );
        });
        // The outcome on the server may be unknown; show its current list.
        onSettled();
      })
      .finally(() => {
        if (active.current?.id === id) active.current = null;
        // Wake this effect so the next queued file starts.
        setState((previous) => ({ ...previous, entries: [...previous.entries] }));
      });
  }, [entries, onSettled]);

  // Abort an upload in flight if the operator leaves the page.
  useEffect(
    () => () => {
      active.current?.handle.cancel();
    },
    [],
  );

  const addFiles = useCallback(
    (chosen: readonly File[]) => {
      if (chosen.length === 0) return;
      const added = chosen.map((file) => {
        const id = crypto.randomUUID();
        const entry = newEntry(id, file, limits);
        if (entry.status === 'queued') files.current.set(id, file);
        return entry;
      });
      setState((previous) => ({ ...previous, entries: [...previous.entries, ...added] }));
    },
    [limits],
  );

  const cancel = useCallback((id: string) => {
    if (active.current?.id === id) {
      active.current.handle.cancel();
      return;
    }
    setState((previous) => patch(previous, id, { status: 'cancelled' }));
  }, []);

  const retry = useCallback((id: string) => {
    if (!files.current.has(id)) return;
    setState((previous) => patch(previous, id, { status: 'queued', loaded: 0, error: null }));
  }, []);

  const clearFinished = useCallback(() => {
    setState((previous) => {
      const kept = previous.entries.filter((entry) => !isFinished(entry));
      if (kept.length === previous.entries.length) return previous;
      const keptIds = new Set(kept.map((entry) => entry.id));
      // Dropping a held file twice is harmless, so this is safe to run more than once.
      for (const entry of previous.entries) {
        if (!keptIds.has(entry.id)) files.current.delete(entry.id);
      }
      return {
        entries: kept,
        uploaded: new Map([...previous.uploaded].filter(([id]) => keptIds.has(id))),
      };
    });
  }, []);

  return useMemo(
    () => ({ entries, uploaded, addFiles, cancel, retry, clearFinished }),
    [entries, uploaded, addFiles, cancel, retry, clearFinished],
  );
}
