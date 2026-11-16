import { useCallback, useEffect, useRef, useState } from 'react';
import { NavigationType, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import {
  changeLibraryQuery,
  DEFAULT_LIBRARY_PREFERENCES,
  libraryQueryParams,
  parseLibraryQuery,
  type LibraryPreferences,
  type LibraryQuery,
  type LibraryQueryChange,
} from '../../../lib/mediaLibraryQuery.ts';

/**
 * The view and page size chosen earlier in this visit, used where an address names none (the
 * sidebar's links). Held in memory only: the portal uses no web storage.
 */
let remembered: LibraryPreferences = DEFAULT_LIBRARY_PREFERENCES;

/** Marks a history entry this hook wrote, so its arrival is not mistaken for a navigation. */
const OWN_WRITE = { mediaLibraryQuery: true } as const;

function isOwnWrite(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'mediaLibraryQuery' in state;
}

function read(search: string): LibraryQuery {
  return parseLibraryQuery(new URLSearchParams(search), remembered);
}

export interface LibraryQueryControl {
  readonly query: LibraryQuery;
  /** Applies a change; anything but a page turn or a view switch returns to page one. */
  readonly change: (change: LibraryQueryChange) => void;
  /** Replaces the whole state, for example with `clearLibraryFilters(query)`. */
  readonly replace: (query: LibraryQuery) => void;
}

/**
 * The library's search, filters, order, page and view, mirrored in the query string so that a
 * reload or a shared link shows the same list.
 *
 * The state lives here and is written to the address with `replace`, so the page reacts to a
 * key press at once (the router applies a navigation a moment later, which would move the
 * caret of a search field that read its value from the address) and Back leaves the library
 * instead of undoing one filter at a time. When the address changes for another reason (a
 * link, Back, Forward) the state is read from it again.
 */
export function useLibraryQuery(): LibraryQueryControl {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();

  const [held, setHeld] = useState(() => ({ key: location.key, query: read(location.search) }));
  let query = held.query;
  if (held.key !== location.key) {
    const own = navigationType === NavigationType.Replace && isOwnWrite(location.state);
    if (!own) query = read(location.search);
    setHeld({ key: location.key, query });
  }

  // The newest state, so two changes made in one handler build on each other.
  const latest = useRef(query);
  useEffect(() => {
    latest.current = query;
  }, [query]);

  const replace = useCallback(
    (next: LibraryQuery) => {
      latest.current = next;
      remembered = { view: next.view, pageSize: next.pageSize };
      setHeld((current) => ({ key: current.key, query: next }));
      const search = libraryQueryParams(next).toString();
      void navigate(
        { search: search === '' ? '' : `?${search}` },
        { replace: true, state: OWN_WRITE, preventScrollReset: true },
      );
    },
    [navigate],
  );

  const change = useCallback(
    (delta: LibraryQueryChange) => {
      replace(changeLibraryQuery(latest.current, delta));
    },
    [replace],
  );

  return { query, change, replace };
}
