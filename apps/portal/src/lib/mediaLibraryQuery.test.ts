import { describe, expect, it } from 'vitest';
import { ID } from './mediaLibrary.test-support.ts';
import {
  changeLibraryQuery,
  clearLibraryFilters,
  DEFAULT_LIBRARY_SORT,
  isFiltering,
  isFolderOnly,
  LIBRARY_ROOT_FILTER,
  LIBRARY_SORT_CHOICES,
  libraryQueryParams,
  parseLibraryQuery,
  parseSortParam,
  sortParam,
  toggleStatus,
} from './mediaLibraryQuery.ts';

const parse = (search: string) => parseLibraryQuery(new URLSearchParams(search));

describe('library query from the address', () => {
  it('gives the defaults for a plain address', () => {
    expect(parse('')).toEqual({
      search: '',
      folder: null,
      tags: [],
      statuses: [],
      sort: DEFAULT_LIBRARY_SORT,
      page: 1,
      pageSize: 10,
      view: 'list',
    });
  });

  it('reads every part it writes, and writes nothing for the defaults', () => {
    const query = parse(
      `q=spring+sale&folder=${ID(1)}&tag=${ID(2)}&tag=${ID(3)}&status=failed&status=ready&sort=-size&page=3&per=25&view=grid`,
    );
    expect(query).toEqual({
      search: 'spring sale',
      folder: ID(1),
      tags: [ID(2), ID(3)],
      statuses: ['ready', 'failed'],
      sort: { columnId: 'size', direction: 'desc' },
      page: 3,
      pageSize: 25,
      view: 'grid',
    });
    expect(parse(libraryQueryParams(query).toString())).toEqual(query);
    expect(libraryQueryParams(parse('')).toString()).toBe('');
  });

  it('ignores what it does not understand instead of failing', () => {
    const query = parse(
      'folder=../etc&tag=nope&tag=' +
        ID(4).toUpperCase() +
        `&tag=${ID(4)}&status=deleted&sort=colour&page=-2&per=7&view=table`,
    );
    expect(query.folder).toBeNull();
    expect(query.tags).toEqual([ID(4)]);
    expect(query.statuses).toEqual([]);
    expect(query.sort).toEqual(DEFAULT_LIBRARY_SORT);
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(10);
    expect(query.view).toBe('list');
  });

  it('keeps the root folder filter apart from folder ids', () => {
    expect(parse('folder=none').folder).toBe(LIBRARY_ROOT_FILTER);
  });

  it('uses the viewer’s earlier view and page size where the address names none', () => {
    const query = parseLibraryQuery(new URLSearchParams(''), { view: 'grid', pageSize: 50 });
    expect(query.view).toBe('grid');
    expect(query.pageSize).toBe(50);
  });

  it('caps the search text and the number of tags', () => {
    const many = Array.from(
      { length: 60 },
      (_, index) => `tag=${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
    ).join('&');
    expect(parse(many).tags).toHaveLength(50);
    expect(parse(`q=${'x'.repeat(500)}`).search).toHaveLength(200);
  });
});

describe('library query changes', () => {
  const base = parse('page=4&view=grid');

  it('goes back to page one when the rows change, not on a page turn or view switch', () => {
    expect(changeLibraryQuery(base, { search: 'a' }).page).toBe(1);
    expect(changeLibraryQuery(base, { statuses: ['failed'] }).page).toBe(1);
    expect(changeLibraryQuery(base, { sort: { columnId: 'name', direction: 'asc' } }).page).toBe(1);
    expect(changeLibraryQuery(base, { view: 'list' }).page).toBe(4);
    expect(changeLibraryQuery(base, { page: 2 }).page).toBe(2);
    expect(changeLibraryQuery(base, { pageSize: 50, page: 1 }).page).toBe(1);
  });

  it('clears search and filters but keeps order, page size and view', () => {
    const query = parse(
      `q=a&folder=none&tag=${ID(1)}&status=ready&sort=name&per=50&view=grid&page=2`,
    );
    expect(clearLibraryFilters(query)).toEqual({
      ...query,
      search: '',
      folder: null,
      tags: [],
      statuses: [],
      page: 1,
    });
  });

  it('knows when the list is narrowed, and when only by folder', () => {
    expect(isFiltering(parse('sort=name&view=grid'))).toBe(false);
    expect(isFiltering(parse('q=%20%20'))).toBe(false);
    expect(isFiltering(parse('status=failed'))).toBe(true);
    expect(isFolderOnly(parse('folder=none'))).toBe(true);
    expect(isFolderOnly(parse('folder=none&q=a'))).toBe(false);
  });

  it('toggles statuses in a fixed order', () => {
    expect(toggleStatus(['failed'], 'processing', true)).toEqual(['processing', 'failed']);
    expect(toggleStatus(['processing', 'failed'], 'processing', false)).toEqual(['failed']);
  });
});

describe('sort parameter', () => {
  it('round-trips every offered order', () => {
    for (const choice of LIBRARY_SORT_CHOICES) {
      expect(parseSortParam(sortParam(choice.sort))).toEqual(choice.sort);
      expect(choice.value).toBe(sortParam(choice.sort));
    }
    expect(parseSortParam(null)).toEqual(DEFAULT_LIBRARY_SORT);
    expect(parseSortParam('-')).toEqual(DEFAULT_LIBRARY_SORT);
  });
});
