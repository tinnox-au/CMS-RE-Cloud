import type { TagColour, TagDto, TagScope } from '@tinnox/contracts';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { sortTags, tagsById } from '../../lib/tagColours.ts';

/**
 * The tags of one scope as a page holds them. Call `useTags` once per page and hand the
 * result to every shared tag component on it, so they show one list.
 */
export interface TagsResource {
  readonly scope: TagScope;
  /** `error` only when the first load failed; a failed reload keeps the list (`refreshError`). */
  readonly status: 'loading' | 'error' | 'ready';
  /** Ordered by name. Empty until `status` is `ready`. */
  readonly tags: readonly TagDto[];
  readonly byId: ReadonlyMap<string, TagDto>;
  /** What the first load threw, while `status` is `error`; otherwise null. */
  readonly error: unknown;
  /** What a later reload threw; `tags` is then the last list that arrived. Otherwise null. */
  readonly refreshError: unknown;
  /** Fetches the list again, keeping the current one on screen meanwhile. */
  readonly reload: () => void;
  /**
   * Creates a tag in this scope. Resolves with the tag as the API stored it, which is in
   * `tags` from the next render; rejects with what the API answered (a name already in use
   * is 409 `conflict`) and leaves the list as the server has it. Nothing is shown before the
   * server has answered.
   */
  readonly createTag: (name: string, colour: TagColour) => Promise<TagDto>;
}

const NO_TAGS: readonly TagDto[] = [];

/** Loads the tags of `scope` (`media` or `display`) with the portal's `useLoad` pattern. */
export function useTags(scope: TagScope): TagsResource {
  const load = useCallback((signal: AbortSignal) => api.listTags(scope, signal), [scope]);
  const { state, reload, setData } = useLoad(load);
  const data = state.status === 'ready' ? state.data : null;

  // The newest list, for a create that finishes after the list was reloaded.
  const latest = useRef<readonly TagDto[] | null>(null);
  useEffect(() => {
    latest.current = data;
  }, [data]);

  const tags = useMemo(
    () => (data === null ? NO_TAGS : sortTags(data.filter((tag) => tag.scope === scope))),
    [data, scope],
  );
  const byId = useMemo(() => tagsById(tags), [tags]);

  const createTag = useCallback(
    async (name: string, colour: TagColour): Promise<TagDto> => {
      let created: TagDto;
      try {
        created = await api.createTag({ scope, name, colour });
      } catch (error) {
        // Someone else may have taken the name: show the list as the server has it.
        if (isApiRequestError(error) && error.code === 'conflict') reload();
        throw error;
      }
      const current = latest.current;
      if (current !== null) {
        const merged = [...current.filter((tag) => tag.id !== created.id), created];
        latest.current = merged;
        setData(merged);
      }
      // The server's list is the truth; the merge above only spares the wait for it.
      reload();
      return created;
    },
    [scope, reload, setData],
  );

  return {
    scope,
    status: state.status,
    tags,
    byId,
    error: state.status === 'error' ? state.error : null,
    refreshError: state.status === 'ready' ? state.refreshError : null,
    reload,
    createTag,
  };
}
