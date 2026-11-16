/**
 * Client-side search, filtering, sorting and paging for list pages. Pure functions, no DOM.
 * Every list (media, playlists, displays, audit) runs its rows through `applyListView`
 * so the pages behave the same way.
 */

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  readonly columnId: string;
  readonly direction: SortDirection;
}

/** What a sortable column may hand back for a row. Dates sort by time, booleans false first. */
export type SortValue = string | number | boolean | Date | null | undefined;

export type SortAccessors<T> = Readonly<Record<string, (row: T) => SortValue>>;

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;

const collator = new Intl.Collator('en-AU', { numeric: true, sensitivity: 'base' });

/**
 * Clicking a column header: a new column starts in `first` order, the current column flips.
 */
export function nextSort(
  current: SortState | null,
  columnId: string,
  first: SortDirection = 'asc',
): SortState {
  if (current === null || current.columnId !== columnId) return { columnId, direction: first };
  return { columnId, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

function isMissing(value: SortValue): value is null | undefined {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'number' && Number.isNaN(value)) ||
    (value instanceof Date && Number.isNaN(value.getTime()))
  );
}

function rank(value: Exclude<SortValue, null | undefined>): number | string {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/** Ascending comparison of two present values. Text compares without case, digits by number. */
export function compareValues(a: SortValue, b: SortValue): number {
  if (isMissing(a) || isMissing(b)) return isMissing(a) ? (isMissing(b) ? 0 : 1) : -1;
  const left = rank(a);
  const right = rank(b);
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return collator.compare(String(left), String(right));
}

/**
 * Returns a sorted copy. The sort is stable, and rows with no value for the column stay
 * at the end in both directions. An unknown column leaves the order alone.
 */
export function sortRows<T>(
  rows: readonly T[],
  sort: SortState | null,
  accessors: SortAccessors<T>,
): T[] {
  const copy = rows.slice();
  if (sort === null) return copy;
  const accessor = accessors[sort.columnId];
  if (accessor === undefined) return copy;
  const sign = sort.direction === 'asc' ? 1 : -1;
  const keyed = copy.map((row, index) => ({ row, index, value: accessor(row) }));
  keyed.sort((a, b) => {
    const aMissing = isMissing(a.value);
    const bMissing = isMissing(b.value);
    if (aMissing || bMissing) {
      if (aMissing && bMissing) return a.index - b.index;
      return aMissing ? 1 : -1;
    }
    return sign * compareValues(a.value, b.value) || a.index - b.index;
  });
  return keyed.map((entry) => entry.row);
}

/** Lower case, accents removed, runs of white space collapsed. */
export function normaliseSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when every word of the query appears somewhere in the given texts.
 * An empty query matches everything.
 */
export function matchesSearch(
  texts: readonly (string | null | undefined)[],
  query: string,
): boolean {
  const terms = normaliseSearch(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normaliseSearch(texts.filter((text) => typeof text === 'string').join(' '));
  return terms.every((term) => haystack.includes(term));
}

export interface PageInfo {
  /** 1-based, already clamped to the pages that exist. */
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly total: number;
  /** 1-based position of the first and last row shown; both 0 when there are no rows. */
  readonly from: number;
  readonly to: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

export function pageInfo(total: number, page: number, pageSize: number): PageInfo {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const safeSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 1;
  const pageCount = Math.max(1, Math.ceil(safeTotal / safeSize));
  const safePage = Number.isFinite(page) ? Math.min(pageCount, Math.max(1, Math.floor(page))) : 1;
  const from = safeTotal === 0 ? 0 : (safePage - 1) * safeSize + 1;
  const to = Math.min(safeTotal, safePage * safeSize);
  return {
    page: safePage,
    pageSize: safeSize,
    pageCount,
    total: safeTotal,
    from,
    to,
    hasPrevious: safePage > 1,
    hasNext: safePage < pageCount,
  };
}

export function paginate<T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): { readonly rows: T[]; readonly info: PageInfo } {
  const info = pageInfo(rows.length, page, pageSize);
  return { rows: info.total === 0 ? [] : rows.slice(info.from - 1, info.to), info };
}

/** "1 to 10 of 42", "1 of 1", "0 of 0". */
export function rangeLabel(info: PageInfo): string {
  if (info.total === 0) return '0 of 0';
  if (info.from === info.to) return `${info.from} of ${info.total}`;
  return `${info.from} to ${info.to} of ${info.total}`;
}

/** "1 item", "12 items", "3 displays". */
export function countLabel(count: number, singular = 'item', plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export interface ListViewOptions<T> {
  /** Free-text query and the texts of a row it is matched against. */
  readonly search?: { readonly query: string; readonly texts: (row: T) => readonly unknown[] };
  /** Every predicate must accept a row. */
  readonly filters?: readonly ((row: T) => boolean)[];
  readonly sort?: SortState | null;
  readonly accessors?: SortAccessors<T>;
  readonly page: number;
  readonly pageSize: number;
}

export interface ListViewResult<T> {
  /** The rows of the current page. */
  readonly rows: T[];
  /** Every row that passed search and filters, sorted. Bulk actions and "select all" use this. */
  readonly matched: T[];
  /** Rows before search and filters. Tells "nothing yet" apart from "nothing matches". */
  readonly total: number;
  readonly info: PageInfo;
}

function searchTexts(values: readonly unknown[]): string[] {
  const texts: string[] = [];
  for (const value of values) {
    if (typeof value === 'string') texts.push(value);
    else if (typeof value === 'number' && Number.isFinite(value)) texts.push(String(value));
  }
  return texts;
}

export function applyListView<T>(
  rows: readonly T[],
  options: ListViewOptions<T>,
): ListViewResult<T> {
  const { search, filters = [], sort = null, accessors = {} } = options;
  const filtered = rows.filter((row) => {
    if (search !== undefined && !matchesSearch(searchTexts(search.texts(row)), search.query)) {
      return false;
    }
    return filters.every((accept) => accept(row));
  });
  const matched = sortRows(filtered, sort, accessors);
  const page = paginate(matched, options.page, options.pageSize);
  return { rows: page.rows, matched, total: rows.length, info: page.info };
}
