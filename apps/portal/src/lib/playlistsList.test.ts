import type { PlaylistSummaryDto } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { applyListView } from './listView.ts';
import { pruneSelection, selectedRows } from './selection.ts';
import {
  assignedScreensLabel,
  checkPlaylistName,
  DEFAULT_PLAYLIST_SORT,
  modifiedLabel,
  PLAYLIST_SORT_ACCESSORS,
  PLAYLIST_SORT_COLUMNS,
  PLAYLIST_SORT_OPTIONS,
  playlistSearchTexts,
  playlistsCountLabel,
  playlistSortFromValue,
  playlistSortValue,
} from './playlistsList.ts';

function playlist(
  over: Partial<PlaylistSummaryDto> & { readonly name: string },
): PlaylistSummaryDto {
  return {
    id: `00000000-0000-4000-8000-${String(over.name.length).padStart(12, '0')}`,
    description: null,
    itemCount: 0,
    totalDurationMs: 0,
    kinds: [],
    previewMediaIds: [],
    assignedDisplayCount: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  };
}

const ROWS: readonly PlaylistSummaryDto[] = [
  playlist({
    name: 'Reception loop',
    description: 'Morning welcome',
    itemCount: 3,
    totalDurationMs: 45_000,
    assignedDisplayCount: 2,
    updatedAt: '2026-11-10T03:00:00.000Z',
  }),
  playlist({
    name: 'café menu',
    itemCount: 12,
    totalDurationMs: 3_600_000,
    updatedAt: '2026-11-14T03:00:00.000Z',
  }),
  playlist({
    name: 'Window 10',
    itemCount: 1,
    totalDurationMs: 8_000,
    assignedDisplayCount: 5,
    updatedAt: '2026-10-02T03:00:00.000Z',
  }),
  playlist({ name: 'Window 9', updatedAt: '2026-11-12T03:00:00.000Z' }),
];

function names(columnId: string, direction: 'asc' | 'desc'): string[] {
  return applyListView(ROWS, {
    sort: { columnId, direction },
    accessors: PLAYLIST_SORT_ACCESSORS,
    page: 1,
    pageSize: 100,
  }).rows.map((row) => row.name);
}

describe('sorting the playlists list', () => {
  it('has an accessor for every sortable column', () => {
    expect(Object.keys(PLAYLIST_SORT_ACCESSORS).sort()).toEqual([...PLAYLIST_SORT_COLUMNS].sort());
  });

  it('opens with the playlist changed last at the top', () => {
    expect(DEFAULT_PLAYLIST_SORT).toEqual({ columnId: 'modified', direction: 'desc' });
    expect(names('modified', 'desc')).toEqual([
      'café menu',
      'Window 9',
      'Reception loop',
      'Window 10',
    ]);
  });

  it('sorts names without case and digits by number', () => {
    expect(names('name', 'asc')).toEqual(['café menu', 'Reception loop', 'Window 9', 'Window 10']);
  });

  it('sorts items, length and screens by number', () => {
    expect(names('items', 'desc')[0]).toBe('café menu');
    expect(names('length', 'asc')[0]).toBe('Window 9');
    expect(names('length', 'desc')[0]).toBe('café menu');
    expect(names('screens', 'desc').slice(0, 2)).toEqual(['Window 10', 'Reception loop']);
  });
});

describe('the "Sort by" select of the grid view', () => {
  it('offers every column in both directions, each once', () => {
    expect(PLAYLIST_SORT_OPTIONS).toHaveLength(PLAYLIST_SORT_COLUMNS.length * 2);
    expect(new Set(PLAYLIST_SORT_OPTIONS.map((option) => option.value)).size).toBe(
      PLAYLIST_SORT_OPTIONS.length,
    );
    expect(new Set(PLAYLIST_SORT_OPTIONS.map((option) => option.label)).size).toBe(
      PLAYLIST_SORT_OPTIONS.length,
    );
    expect(PLAYLIST_SORT_OPTIONS[0]?.sort).toEqual(DEFAULT_PLAYLIST_SORT);
  });

  it('round-trips every order a table header can produce', () => {
    for (const columnId of PLAYLIST_SORT_COLUMNS) {
      for (const direction of ['asc', 'desc'] as const) {
        const sort = { columnId, direction };
        expect(playlistSortFromValue(playlistSortValue(sort))).toEqual(sort);
      }
    }
  });

  it('falls back to the default order for anything else', () => {
    expect(playlistSortValue(null)).toBe('modified:desc');
    expect(playlistSortValue({ columnId: 'colour', direction: 'asc' })).toBe('modified:desc');
    expect(playlistSortFromValue('')).toEqual(DEFAULT_PLAYLIST_SORT);
    expect(playlistSortFromValue('name:sideways')).toEqual(DEFAULT_PLAYLIST_SORT);
  });
});

describe('searching the playlists list', () => {
  const search = (query: string) =>
    applyListView(ROWS, {
      search: { query, texts: playlistSearchTexts },
      page: 1,
      pageSize: 100,
    }).rows.map((row) => row.name);

  it('matches the name and the description, without case or accents', () => {
    expect(search('CAFE')).toEqual(['café menu']);
    expect(search('welcome')).toEqual(['Reception loop']);
    expect(search('window')).toEqual(['Window 10', 'Window 9']);
    expect(search('nothing like it')).toEqual([]);
  });

  // The page prunes its selection against the rows the search matches (as the media library
  // does), and the bulk Delete takes its targets from those rows.
  it('leaves rows the search hides out of the selection and of a bulk action', () => {
    const alpha = playlist({ id: '00000000-0000-4000-8000-00000000000a', name: 'ZZ Alpha' });
    const bravo = playlist({ id: '00000000-0000-4000-8000-00000000000b', name: 'ZZ Bravo' });
    const charlie = playlist({ id: '00000000-0000-4000-8000-00000000000c', name: 'ZZ Charlie' });
    const rows = [alpha, bravo, charlie];
    const chosen = new Set([alpha.id, charlie.id]);
    const view = (query: string, page = 1, pageSize = 100) =>
      applyListView(rows, { search: { query, texts: playlistSearchTexts }, page, pageSize });
    const targets = (query: string, page?: number, pageSize?: number) => {
      const { matched } = view(query, page, pageSize);
      const selected = pruneSelection(
        chosen,
        matched.map((row) => row.id),
      );
      return selectedRows(matched, selected, (row) => row.id).map((row) => row.name);
    };
    expect(targets('Bravo')).toEqual([]);
    expect(targets('Alpha')).toEqual(['ZZ Alpha']);
    expect(targets('')).toEqual(['ZZ Alpha', 'ZZ Charlie']);
    // Rows on another page of the same search stay selected.
    expect(view('ZZ', 2, 1).rows.map((row) => row.name)).toEqual(['ZZ Bravo']);
    expect(targets('ZZ', 2, 1)).toEqual(['ZZ Alpha', 'ZZ Charlie']);
  });
});

describe('counts', () => {
  it('names the playlists, and the part a search leaves', () => {
    expect(playlistsCountLabel(1, 1, false)).toBe('1 playlist');
    expect(playlistsCountLabel(12, 12, false)).toBe('12 playlists');
    expect(playlistsCountLabel(3, 12, true)).toBe('3 of 12 playlists');
    expect(playlistsCountLabel(0, 1, true)).toBe('0 of 1 playlist');
  });

  it('says how many screens have a playlist assigned', () => {
    expect(assignedScreensLabel(0)).toBe('Not assigned');
    expect(assignedScreensLabel(1)).toBe('1 screen');
    expect(assignedScreensLabel(4)).toBe('4 screens');
  });
});

describe('the name of a new playlist', () => {
  it('asks for a name when there is none', () => {
    expect(checkPlaylistName('')).toEqual({ ok: false, problem: 'Enter a name.' });
    expect(checkPlaylistName('   ')).toEqual({ ok: false, problem: 'Enter a name.' });
  });

  it('trims a good name', () => {
    expect(checkPlaylistName('  Reception loop ')).toEqual({ ok: true, name: 'Reception loop' });
    expect(checkPlaylistName('x'.repeat(120))).toEqual({ ok: true, name: 'x'.repeat(120) });
  });

  it('refuses a name the API would refuse, in plain words', () => {
    expect(checkPlaylistName('x'.repeat(121))).toEqual({
      ok: false,
      problem: 'Use 120 characters or fewer.',
    });
    expect(checkPlaylistName('two\nlines')).toEqual({
      ok: false,
      problem: 'Use a single line of text without control characters.',
    });
  });
});

describe('when a playlist was last changed', () => {
  const now = new Date('2026-11-16T02:00:00.000Z');
  const plain = (text: string) => text.replace(/\s+/gu, ' ').toLowerCase();

  it('shows the day and the time within the current year', () => {
    expect(plain(modifiedLabel('2026-11-15T09:22:11.000Z', now, 'Australia/Sydney'))).toBe(
      '15 nov, 8:22 pm',
    );
  });

  it('shows the day and the year before that', () => {
    expect(plain(modifiedLabel('2025-03-04T01:00:00.000Z', now, 'Australia/Sydney'))).toBe(
      '4 mar 2025',
    );
  });

  it('decides the year in the zone it is shown in', () => {
    // 31 December 2025 in UTC is already 1 January 2026 in Sydney.
    expect(plain(modifiedLabel('2025-12-31T20:00:00.000Z', now, 'Australia/Sydney'))).toBe(
      '1 jan, 7:00 am',
    );
    expect(plain(modifiedLabel('2025-12-31T20:00:00.000Z', now, 'UTC'))).toBe('31 dec 2025');
  });

  it('hands back a value that is not a time as it came', () => {
    expect(modifiedLabel('not a time', now)).toBe('not a time');
  });
});

describe('wording', () => {
  it('never calls a screen a display', () => {
    const texts = [
      ...PLAYLIST_SORT_OPTIONS.map((option) => option.label),
      assignedScreensLabel(0),
      assignedScreensLabel(2),
      playlistsCountLabel(1, 2, true),
    ];
    for (const text of texts) expect(text).not.toMatch(/display|online|offline/i);
  });
});
