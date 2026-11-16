import { MEDIA_STATUSES, type MediaStatus } from '@tinnox/contracts';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  type SortDirection,
  type SortState,
} from './listView.ts';

/**
 * What the media library is showing, as it is written in the address: the search, the folder,
 * the tags, the statuses, the order, the page and the view. Pure functions, no DOM.
 *
 * The address is the record: a reload or a shared link shows the same list. Values that are
 * the default are left out, so a plain `/media` stays plain.
 */

export type LibraryView = 'list' | 'grid';

export const LIBRARY_SORT_COLUMNS = ['name', 'modified', 'size'] as const;
export type LibrarySortColumn = (typeof LIBRARY_SORT_COLUMNS)[number];

/** The folder filter that means "files that are in no folder". Never a folder id. */
export const LIBRARY_ROOT_FILTER = 'none';

/** Newest first: what an operator who has just uploaded expects to see at the top. */
export const DEFAULT_LIBRARY_SORT: SortState = { columnId: 'modified', direction: 'desc' };

export interface LibraryQuery {
  /** The search text as typed. */
  readonly search: string;
  /** null: every folder. `LIBRARY_ROOT_FILTER`: files in no folder. Otherwise a folder id. */
  readonly folder: string | null;
  /** Tag ids, each once. A file matches when it carries any of them. */
  readonly tags: readonly string[];
  /** Statuses, each once, in the order of `MEDIA_STATUSES`. Empty means every status. */
  readonly statuses: readonly MediaStatus[];
  readonly sort: SortState;
  /** 1-based. May point past the last page; the list clamps it. */
  readonly page: number;
  readonly pageSize: number;
  readonly view: LibraryView;
}

/** What a viewer chose earlier in this visit, used where the address says nothing. */
export interface LibraryPreferences {
  readonly view: LibraryView;
  readonly pageSize: number;
}

export const DEFAULT_LIBRARY_PREFERENCES: LibraryPreferences = {
  view: 'list',
  pageSize: DEFAULT_PAGE_SIZE,
};

const PARAM = {
  search: 'q',
  folder: 'folder',
  tag: 'tag',
  status: 'status',
  sort: 'sort',
  page: 'page',
  pageSize: 'per',
  view: 'view',
} as const;

const MAX_SEARCH_LENGTH = 200;
const MAX_TAGS = 50;
const MAX_PAGE = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parseId(value: string): string | null {
  const id = value.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

function isSortColumn(value: string): value is LibrarySortColumn {
  return (LIBRARY_SORT_COLUMNS as readonly string[]).includes(value);
}

/** "name" is ascending, "-name" descending. Anything else is the default order. */
export function parseSortParam(value: string | null): SortState {
  if (value === null) return DEFAULT_LIBRARY_SORT;
  const descending = value.startsWith('-');
  const columnId = descending ? value.slice(1) : value;
  if (!isSortColumn(columnId)) return DEFAULT_LIBRARY_SORT;
  return { columnId, direction: descending ? 'desc' : 'asc' };
}

export function sortParam(sort: SortState): string {
  return sort.direction === 'desc' ? `-${sort.columnId}` : sort.columnId;
}

function sameSort(a: SortState, b: SortState): boolean {
  return a.columnId === b.columnId && a.direction === b.direction;
}

function parsePositiveInt(value: string | null): number | null {
  if (value === null || !/^[0-9]{1,7}$/.test(value)) return null;
  const number = Number(value);
  return number >= 1 ? number : null;
}

/**
 * Reads the library state from the query string. Anything that is not understood (an
 * unknown status, a page size that is not offered, a malformed id) is ignored, never an error:
 * an old or hand-edited link still opens the library.
 */
export function parseLibraryQuery(
  params: URLSearchParams,
  preferences: LibraryPreferences = DEFAULT_LIBRARY_PREFERENCES,
): LibraryQuery {
  const folderParam = params.get(PARAM.folder);
  const folder =
    folderParam === null
      ? null
      : folderParam === LIBRARY_ROOT_FILTER
        ? LIBRARY_ROOT_FILTER
        : parseId(folderParam);

  const tags: string[] = [];
  for (const value of params.getAll(PARAM.tag)) {
    const id = parseId(value);
    if (id !== null && !tags.includes(id) && tags.length < MAX_TAGS) tags.push(id);
  }

  const wanted = new Set(params.getAll(PARAM.status));
  const statuses = MEDIA_STATUSES.filter((status) => wanted.has(status));

  const pageSize = parsePositiveInt(params.get(PARAM.pageSize));
  const viewParam = params.get(PARAM.view);

  return {
    search: (params.get(PARAM.search) ?? '').slice(0, MAX_SEARCH_LENGTH),
    folder,
    tags,
    statuses,
    sort: parseSortParam(params.get(PARAM.sort)),
    page: Math.min(MAX_PAGE, parsePositiveInt(params.get(PARAM.page)) ?? 1),
    pageSize:
      pageSize !== null && (PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSize)
        ? pageSize
        : preferences.pageSize,
    view: viewParam === 'grid' || viewParam === 'list' ? viewParam : preferences.view,
  };
}

/** The query string of a library state, in a fixed order, with defaults left out. */
export function libraryQueryParams(query: LibraryQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search.trim() !== '') params.set(PARAM.search, query.search);
  if (query.folder !== null) params.set(PARAM.folder, query.folder);
  for (const id of query.tags) params.append(PARAM.tag, id);
  for (const status of query.statuses) params.append(PARAM.status, status);
  if (!sameSort(query.sort, DEFAULT_LIBRARY_SORT)) params.set(PARAM.sort, sortParam(query.sort));
  if (query.page > 1) params.set(PARAM.page, String(query.page));
  if (query.pageSize !== DEFAULT_PAGE_SIZE) params.set(PARAM.pageSize, String(query.pageSize));
  if (query.view !== 'list') params.set(PARAM.view, query.view);
  return params;
}

/** True when a search or a filter is narrowing the list (order, page and view do not). */
export function isFiltering(query: LibraryQuery): boolean {
  return (
    query.search.trim() !== '' ||
    query.folder !== null ||
    query.tags.length > 0 ||
    query.statuses.length > 0
  );
}

/** True when the folder is the only thing narrowing the list. */
export function isFolderOnly(query: LibraryQuery): boolean {
  return (
    query.folder !== null &&
    query.search.trim() === '' &&
    query.tags.length === 0 &&
    query.statuses.length === 0
  );
}

export type LibraryQueryChange = Partial<LibraryQuery>;

/**
 * Applies a change. Anything that changes which rows are listed, or their order, goes back to
 * the first page; turning a page or switching the view keeps the page.
 */
export function changeLibraryQuery(query: LibraryQuery, change: LibraryQueryChange): LibraryQuery {
  const next: LibraryQuery = { ...query, ...change };
  const keepsPage = Object.keys(change).every((key) => key === 'page' || key === 'view');
  if (keepsPage) return next;
  return change.page === undefined ? { ...next, page: 1 } : next;
}

/** Search and every filter removed; order, page size and view stay. */
export function clearLibraryFilters(query: LibraryQuery): LibraryQuery {
  return { ...query, search: '', folder: null, tags: [], statuses: [], page: 1 };
}

/** Adds or removes one status, keeping the order of `MEDIA_STATUSES`. */
export function toggleStatus(
  statuses: readonly MediaStatus[],
  status: MediaStatus,
  on: boolean,
): MediaStatus[] {
  return MEDIA_STATUSES.filter((candidate) =>
    candidate === status ? on : statuses.includes(candidate),
  );
}

export interface LibrarySortChoice {
  /** The value of `sortParam`. */
  readonly value: string;
  readonly label: string;
  readonly sort: SortState;
}

function choice(
  columnId: LibrarySortColumn,
  direction: SortDirection,
  label: string,
): LibrarySortChoice {
  const sort: SortState = { columnId, direction };
  return { value: sortParam(sort), label, sort };
}

/** The orders offered where there are no column headers to press (the grid view). */
export const LIBRARY_SORT_CHOICES: readonly LibrarySortChoice[] = [
  choice('modified', 'desc', 'Newest first'),
  choice('modified', 'asc', 'Oldest first'),
  choice('name', 'asc', 'Name, A to Z'),
  choice('name', 'desc', 'Name, Z to A'),
  choice('size', 'desc', 'Largest first'),
  choice('size', 'asc', 'Smallest first'),
];
