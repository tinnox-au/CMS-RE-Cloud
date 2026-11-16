import { describe, expect, it } from 'vitest';
import {
  applyListView,
  compareValues,
  countLabel,
  matchesSearch,
  nextSort,
  normaliseSearch,
  pageInfo,
  paginate,
  rangeLabel,
  sortRows,
  type SortAccessors,
} from './listView.ts';

interface Row {
  readonly id: string;
  readonly name: string;
  readonly bytes: number | null;
  readonly modified: Date | null;
  readonly kind: 'image' | 'video';
}

const ROWS: readonly Row[] = [
  { id: 'a', name: 'Foyer loop 10', bytes: 300, modified: new Date('2026-11-01'), kind: 'video' },
  { id: 'b', name: 'foyer loop 2', bytes: 100, modified: new Date('2026-11-03'), kind: 'image' },
  { id: 'c', name: 'Café menu', bytes: null, modified: null, kind: 'image' },
  { id: 'd', name: 'Atrium ribbon', bytes: 200, modified: new Date('2026-11-02'), kind: 'video' },
];

const ACCESSORS: SortAccessors<Row> = {
  name: (row) => row.name,
  bytes: (row) => row.bytes,
  modified: (row) => row.modified,
};

const ids = (rows: readonly Row[]): string => rows.map((row) => row.id).join('');

describe('sorting', () => {
  it('starts a new column ascending and flips the current one', () => {
    expect(nextSort(null, 'name')).toEqual({ columnId: 'name', direction: 'asc' });
    expect(nextSort({ columnId: 'name', direction: 'asc' }, 'name').direction).toBe('desc');
    expect(nextSort({ columnId: 'name', direction: 'desc' }, 'name').direction).toBe('asc');
    expect(nextSort({ columnId: 'name', direction: 'desc' }, 'bytes', 'desc')).toEqual({
      columnId: 'bytes',
      direction: 'desc',
    });
  });

  it('compares text without case and digits by number', () => {
    expect(compareValues('foyer loop 2', 'Foyer loop 10')).toBeLessThan(0);
    expect(compareValues('alpha', 'Alpha')).toBe(0);
    expect(compareValues(2, 10)).toBeLessThan(0);
    expect(compareValues(false, true)).toBeLessThan(0);
    expect(compareValues(new Date('2026-01-02'), new Date('2026-01-01'))).toBeGreaterThan(0);
  });

  it('sorts a copy and leaves the input alone', () => {
    const sorted = sortRows(ROWS, { columnId: 'name', direction: 'asc' }, ACCESSORS);
    expect(ids(sorted)).toBe('dcba');
    expect(ids(ROWS)).toBe('abcd');
  });

  it('keeps rows without a value last in both directions', () => {
    expect(ids(sortRows(ROWS, { columnId: 'bytes', direction: 'asc' }, ACCESSORS))).toBe('bdac');
    expect(ids(sortRows(ROWS, { columnId: 'bytes', direction: 'desc' }, ACCESSORS))).toBe('adbc');
    expect(ids(sortRows(ROWS, { columnId: 'modified', direction: 'desc' }, ACCESSORS))).toBe(
      'bdac',
    );
  });

  it('is stable for equal values, also when descending', () => {
    const rows = [
      { id: '1', name: 'Same', bytes: 1, modified: null, kind: 'image' },
      { id: '2', name: 'same', bytes: 1, modified: null, kind: 'image' },
      { id: '3', name: 'SAME', bytes: 1, modified: null, kind: 'image' },
    ] as const;
    expect(ids(sortRows(rows, { columnId: 'name', direction: 'asc' }, ACCESSORS))).toBe('123');
    expect(ids(sortRows(rows, { columnId: 'name', direction: 'desc' }, ACCESSORS))).toBe('123');
  });

  it('leaves the order alone for no sort or an unknown column', () => {
    expect(ids(sortRows(ROWS, null, ACCESSORS))).toBe('abcd');
    expect(ids(sortRows(ROWS, { columnId: 'nope', direction: 'asc' }, ACCESSORS))).toBe('abcd');
  });
});

describe('search', () => {
  it('normalises case, accents and spacing', () => {
    expect(normaliseSearch('  Café   MENU ')).toBe('cafe menu');
  });

  it('needs every word, in any order, in any of the texts', () => {
    expect(matchesSearch(['Foyer loop 10', 'video'], 'loop foyer')).toBe(true);
    expect(matchesSearch(['Foyer loop 10', 'video'], 'video 10')).toBe(true);
    expect(matchesSearch(['Foyer loop 10'], 'foyer atrium')).toBe(false);
    expect(matchesSearch(['Café menu'], 'cafe')).toBe(true);
    expect(matchesSearch([null, undefined, 'x'], '')).toBe(true);
    expect(matchesSearch([null, undefined], 'x')).toBe(false);
  });
});

describe('paging', () => {
  it('describes a middle page', () => {
    expect(pageInfo(42, 2, 10)).toEqual({
      page: 2,
      pageSize: 10,
      pageCount: 5,
      total: 42,
      from: 11,
      to: 20,
      hasPrevious: true,
      hasNext: true,
    });
  });

  it('clamps a page that no longer exists', () => {
    expect(pageInfo(42, 9, 10)).toMatchObject({ page: 5, from: 41, to: 42, hasNext: false });
    expect(pageInfo(42, 0, 10)).toMatchObject({ page: 1, from: 1, to: 10, hasPrevious: false });
    expect(pageInfo(42, Number.NaN, 10).page).toBe(1);
  });

  it('describes an empty list as one empty page', () => {
    expect(pageInfo(0, 1, 10)).toMatchObject({ pageCount: 1, from: 0, to: 0, hasNext: false });
  });

  it('slices the rows of the page', () => {
    const numbers = Array.from({ length: 23 }, (_, index) => index + 1);
    expect(paginate(numbers, 3, 10).rows).toEqual([21, 22, 23]);
    expect(paginate(numbers, 99, 10).rows).toEqual([21, 22, 23]);
    expect(paginate([], 1, 10).rows).toEqual([]);
  });

  it('labels ranges and counts', () => {
    expect(rangeLabel(pageInfo(42, 1, 10))).toBe('1 to 10 of 42');
    expect(rangeLabel(pageInfo(41, 5, 10))).toBe('41 of 41');
    expect(rangeLabel(pageInfo(0, 1, 10))).toBe('0 of 0');
    expect(countLabel(1)).toBe('1 item');
    expect(countLabel(12)).toBe('12 items');
    expect(countLabel(0, 'display')).toBe('0 displays');
    expect(countLabel(2, 'entry', 'entries')).toBe('2 entries');
  });
});

describe('applyListView', () => {
  it('searches, filters, sorts and pages in that order', () => {
    const result = applyListView(ROWS, {
      search: { query: 'foyer', texts: (row) => [row.name] },
      filters: [(row) => row.bytes !== null],
      sort: { columnId: 'bytes', direction: 'asc' },
      accessors: ACCESSORS,
      page: 1,
      pageSize: 1,
    });
    expect(ids(result.rows)).toBe('b');
    expect(ids(result.matched)).toBe('ba');
    expect(result.total).toBe(4);
    expect(result.info).toMatchObject({ total: 2, pageCount: 2, hasNext: true });
  });

  it('tells an empty list apart from a search with no match', () => {
    const none = applyListView(ROWS, {
      search: { query: 'zzz', texts: (row) => [row.name] },
      page: 1,
      pageSize: 10,
    });
    expect(none.matched).toHaveLength(0);
    expect(none.total).toBe(4);
    const empty = applyListView<Row>([], { page: 1, pageSize: 10 });
    expect(empty.total).toBe(0);
    expect(empty.rows).toEqual([]);
  });

  it('matches numbers in the search texts and ignores other values', () => {
    const result = applyListView(ROWS, {
      search: { query: '300', texts: (row) => [row.name, row.bytes, row.modified] },
      page: 1,
      pageSize: 10,
    });
    expect(ids(result.rows)).toBe('a');
  });

  it('falls back to the last page when filtering shortens the list', () => {
    const result = applyListView(ROWS, { page: 7, pageSize: 3 });
    expect(result.info.page).toBe(2);
    expect(ids(result.rows)).toBe('d');
  });
});
