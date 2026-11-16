import type { FolderDto } from '@tinnox/contracts';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { sortFolders } from '../../lib/folderChoice.ts';

/**
 * The media folders as a page holds them. Call `useFolders` once per page and hand the
 * result to every shared folder component on it, so they show one list.
 */
export interface FoldersResource {
  /** `error` only when the first load failed; a failed reload keeps the list (`refreshError`). */
  readonly status: 'loading' | 'error' | 'ready';
  /** Ordered by name. Empty until `status` is `ready`. */
  readonly folders: readonly FolderDto[];
  readonly byId: ReadonlyMap<string, FolderDto>;
  /** What the first load threw, while `status` is `error`; otherwise null. */
  readonly error: unknown;
  /** What a later reload threw; `folders` is then the last list that arrived. Otherwise null. */
  readonly refreshError: unknown;
  /** Fetches the list again (item counts change when media moves), keeping the current one. */
  readonly reload: () => void;
  /**
   * Creates a folder. Resolves with the folder as the API stored it, which is in `folders`
   * from the next render; rejects with what the API answered (a name already in use is 409
   * `conflict`). Nothing is shown before the server has answered.
   */
  readonly createFolder: (name: string) => Promise<FolderDto>;
}

const NO_FOLDERS: readonly FolderDto[] = [];

function loadFolders(signal: AbortSignal): Promise<FolderDto[]> {
  return api.listFolders(signal);
}

/** Loads the media folders with the portal's `useLoad` pattern. */
export function useFolders(): FoldersResource {
  const { state, reload, setData } = useLoad(loadFolders);
  const data = state.status === 'ready' ? state.data : null;

  // The newest list, for a create that finishes after the list was reloaded.
  const latest = useRef<readonly FolderDto[] | null>(null);
  useEffect(() => {
    latest.current = data;
  }, [data]);

  const folders = useMemo(() => (data === null ? NO_FOLDERS : sortFolders(data)), [data]);
  const byId = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);

  const createFolder = useCallback(
    async (name: string): Promise<FolderDto> => {
      let created: FolderDto;
      try {
        created = await api.createFolder(name);
      } catch (error) {
        if (isApiRequestError(error) && error.code === 'conflict') reload();
        throw error;
      }
      const current = latest.current;
      if (current !== null) {
        const merged = [...current.filter((folder) => folder.id !== created.id), created];
        latest.current = merged;
        setData(merged);
      }
      reload();
      return created;
    },
    [reload, setData],
  );

  return {
    status: state.status,
    folders,
    byId,
    error: state.status === 'error' ? state.error : null,
    refreshError: state.status === 'ready' ? state.refreshError : null,
    reload,
    createFolder,
  };
}
