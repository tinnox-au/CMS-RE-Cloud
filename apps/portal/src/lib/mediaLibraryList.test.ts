import { MEDIA_ERROR_MESSAGES } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { applyListView } from './listView.ts';
import { ID, media } from './mediaLibrary.test-support.ts';
import {
  folderCounts,
  LIBRARY_COLUMN_PRIORITY,
  LIBRARY_SORT_ACCESSORS,
  LIBRARY_TITLES,
  libraryCountLabel,
  libraryEmptyState,
  libraryFilters,
  libraryNoun,
  librarySearchTexts,
  matchesFolder,
  matchesKind,
  matchesStatus,
  mediaFailureText,
  modifiedLabel,
} from './mediaLibraryList.ts';
import { LIBRARY_ROOT_FILTER, parseLibraryQuery } from './mediaLibraryQuery.ts';

const query = (search: string) => parseLibraryQuery(new URLSearchParams(search));

describe('media library filters', () => {
  const inFolder = media(1, 'image', { folderId: ID(7), tagIds: [ID(5)] });
  const atRoot = media(2, 'video', { status: 'failed', errorCode: 'unsupported_codec' });

  it('matches kind, folder and status', () => {
    expect(matchesKind(atRoot, 'all')).toBe(true);
    expect(matchesKind(atRoot, 'image')).toBe(false);
    expect(matchesFolder(inFolder, null)).toBe(true);
    expect(matchesFolder(inFolder, ID(7))).toBe(true);
    expect(matchesFolder(inFolder, LIBRARY_ROOT_FILTER)).toBe(false);
    expect(matchesFolder(atRoot, LIBRARY_ROOT_FILTER)).toBe(true);
    expect(matchesStatus(atRoot, [])).toBe(true);
    expect(matchesStatus(atRoot, ['ready'])).toBe(false);
  });

  it('combines folder, tags and status', () => {
    const rows = [inFolder, atRoot];
    const run = (search: string) =>
      applyListView(rows, {
        filters: libraryFilters(query(search)),
        page: 1,
        pageSize: 10,
      }).matched.map((row) => row.id);
    expect(run('')).toEqual([ID(1), ID(2)]);
    expect(run(`tag=${ID(5)}`)).toEqual([ID(1)]);
    expect(run('status=failed')).toEqual([ID(2)]);
    expect(run(`folder=${ID(7)}&status=failed`)).toEqual([]);
  });

  it('searches the shown name and the uploaded file name', () => {
    expect(
      librarySearchTexts(media(3, 'image', { name: 'Spring sale', originalName: 'a.png' })),
    ).toEqual(['Spring sale', 'a.png']);
  });

  it('sorts by name, modified and size, with an unknown size last', () => {
    const rows = [
      media(1, 'image', { name: 'b', bytes: null, updatedAt: '2026-11-14T03:00:00.000Z' }),
      media(2, 'image', { name: 'a', bytes: 500, updatedAt: '2026-11-15T03:00:00.000Z' }),
      media(3, 'image', { name: 'c', bytes: 900, updatedAt: '2026-11-13T03:00:00.000Z' }),
    ];
    const order = (columnId: string, direction: 'asc' | 'desc') =>
      applyListView(rows, {
        sort: { columnId, direction },
        accessors: LIBRARY_SORT_ACCESSORS,
        page: 1,
        pageSize: 10,
      }).rows.map((row) => row.name);
    expect(order('name', 'asc')).toEqual(['a', 'b', 'c']);
    expect(order('modified', 'desc')).toEqual(['a', 'b', 'c']);
    expect(order('size', 'asc')).toEqual(['a', 'c', 'b']);
  });
});

describe('media library wording', () => {
  it('names the route and its files', () => {
    expect(LIBRARY_TITLES).toEqual({ all: 'All media', image: 'Images', video: 'Videos' });
    expect(libraryNoun('all')).toBe('file');
    expect(libraryNoun('video', 2)).toBe('videos');
    expect(libraryCountLabel(12, 12, false, 'all')).toBe('12 files');
    expect(libraryCountLabel(3, 12, true, 'image')).toBe('3 of 12 images');
    expect(libraryCountLabel(1, 1, false, 'video')).toBe('1 video');
  });

  it('counts the files per folder', () => {
    const counts = folderCounts([
      media(1, 'image', { folderId: ID(7) }),
      media(2, 'image', { folderId: ID(7) }),
      media(3, 'image'),
    ]);
    expect(counts.all).toBe(3);
    expect(counts.root).toBe(1);
    expect(counts.byFolder.get(ID(7))).toBe(2);
  });

  it('words a failure as M0 does: the message, the code and the detail', () => {
    expect(mediaFailureText(media(1, 'image'))).toBeNull();
    expect(
      mediaFailureText(
        media(2, 'video', {
          status: 'failed',
          errorCode: 'unsupported_codec',
          errorDetail: 'codec hevc',
        }),
      ),
    ).toEqual({
      message: MEDIA_ERROR_MESSAGES.unsupported_codec,
      code: 'unsupported_codec',
      detail: 'codec hevc',
    });
    expect(mediaFailureText(media(3, 'video', { status: 'failed' }))?.message).toBe(
      'The file was rejected. No reason was recorded.',
    );
    // A role that cannot upload is told what went wrong, not to re-encode and upload.
    expect(
      mediaFailureText(
        media(4, 'video', { status: 'failed', errorCode: 'unsupported_codec' }),
        true,
      )?.message,
    ).toBe('The video codec is not supported.');
  });

  it('dates the Modified column, with the year only when it differs', () => {
    const now = new Date('2026-11-16T05:00:00.000Z');
    expect(modifiedLabel('2026-11-14T03:00:00.000Z', now)).not.toMatch(/2026/);
    expect(modifiedLabel('2025-01-02T03:00:00.000Z', now)).toMatch(/2025/);
    expect(modifiedLabel('not a date', now)).toBe('not a date');
  });
});

describe('media library empty states', () => {
  const state = (libraryTotal: number, kindTotal: number, search: string, folderKnown = true) =>
    libraryEmptyState({ libraryTotal, kindTotal, query: query(search), folderKnown });

  it('tells nothing-yet apart from nothing-matches', () => {
    expect(state(0, 0, '')).toBe('library_empty');
    expect(state(5, 0, '')).toBe('kind_empty');
    expect(state(5, 5, 'folder=none')).toBe('folder_empty');
    expect(state(5, 5, 'q=zzz')).toBe('no_match');
    expect(state(0, 0, 'q=zzz')).toBe('no_match');
    expect(state(5, 5, `folder=${ID(9)}`, false)).toBe('folder_missing');
  });
});

describe('media library column priorities', () => {
  /** The rule of ui/DataTable.tsx and styles/table.css: step n hides priority 5 - n and up. */
  const hiddenAt = (step: 1 | 2 | 3): string[] =>
    Object.entries(LIBRARY_COLUMN_PRIORITY)
      .filter(([, priority]) => priority >= 5 - step)
      .map(([id]) => id)
      .sort();

  it('drops Size first, then Details, as section 3.2 says', () => {
    expect(hiddenAt(1)).toEqual(['size']);
    expect(hiddenAt(2)).toEqual(['details', 'size']);
  });

  it('keeps Kind, Tags and Modified until the last step', () => {
    expect(hiddenAt(3)).toEqual(['details', 'kind', 'modified', 'size', 'tags']);
  });
});
