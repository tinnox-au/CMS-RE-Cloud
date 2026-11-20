import {
  type MediaDto,
  type MediaErrorCode,
  type MediaKind,
  type MediaStatus,
} from '@tinnox/contracts';
import { countLabel, type SortAccessors } from './listView.ts';
import { mediaFailureMessage } from './mediaDetailFacts.ts';
import { mediaDisplayName } from './mediaName.ts';
import {
  LIBRARY_ROOT_FILTER,
  isFiltering,
  isFolderOnly,
  type LibraryQuery,
} from './mediaLibraryQuery.ts';
import { matchesTagFilter } from './tagColours.ts';

/**
 * Which files the media library lists and how it words them: the kind of each route, the
 * filter predicates, the sort values, the counts on the folder chips, the reason a file
 * failed, and which empty state applies. Pure functions, no DOM.
 */

/** The three library routes: every file, images only, videos only. */
export type LibraryKind = 'all' | MediaKind;

export const LIBRARY_TITLES: { readonly [K in LibraryKind]: string } = {
  all: 'All media',
  image: 'Images',
  video: 'Videos',
};

const NOUNS: {
  readonly [K in LibraryKind]: { readonly one: string; readonly many: string };
} = {
  all: { one: 'file', many: 'files' },
  image: { one: 'image', many: 'images' },
  video: { one: 'video', many: 'videos' },
};

/** "file", "image" or "video", and the plural, for counts and empty states. */
export function libraryNoun(kind: LibraryKind, count = 1): string {
  return count === 1 ? NOUNS[kind].one : NOUNS[kind].many;
}

export function matchesKind(media: Pick<MediaDto, 'kind'>, kind: LibraryKind): boolean {
  return kind === 'all' || media.kind === kind;
}

/** `folder` as in `LibraryQuery`: null is every folder, `LIBRARY_ROOT_FILTER` is no folder. */
export function matchesFolder(media: Pick<MediaDto, 'folderId'>, folder: string | null): boolean {
  if (folder === null) return true;
  if (folder === LIBRARY_ROOT_FILTER) return media.folderId === null;
  return media.folderId === folder;
}

export function matchesStatus(
  media: Pick<MediaDto, 'status'>,
  statuses: readonly MediaStatus[],
): boolean {
  return statuses.length === 0 || statuses.includes(media.status);
}

/** The predicates of the folder, tag and status filters, for `applyListView`. */
export function libraryFilters(
  query: Pick<LibraryQuery, 'folder' | 'tags' | 'statuses'>,
): readonly ((media: MediaDto) => boolean)[] {
  const tags = new Set(query.tags);
  return [
    (media) => matchesFolder(media, query.folder),
    (media) => matchesTagFilter(media.tagIds, tags),
    (media) => matchesStatus(media, query.statuses),
  ];
}

/** What the search field is matched against: the shown name and the uploaded file name. */
export function librarySearchTexts(media: Pick<MediaDto, 'name' | 'originalName'>): string[] {
  return [mediaDisplayName(media), media.originalName];
}

/** Sort values of the three sortable columns. A file with no size yet sorts last. */
export const LIBRARY_SORT_ACCESSORS: SortAccessors<MediaDto> = {
  name: (media) => mediaDisplayName(media),
  modified: (media) => new Date(media.updatedAt),
  size: (media) => media.bytes,
};

/**
 * When the list's columns do not fit, the kit's DataTable hides every column of priority 4,
 * then 3, then 2 (priority 1 always stays). Section 3.2 of the stage A spec drops Size first,
 * then Details; Kind, Tags and Modified stay until the window is narrow (about 768 px), where
 * the name cell's second line repeats Details and Size. Name and Status always stay.
 */
export const LIBRARY_COLUMN_PRIORITY = {
  kind: 2,
  details: 3,
  size: 4,
  tags: 2,
  modified: 2,
} as const satisfies Readonly<Record<string, 2 | 3 | 4>>;

export interface FolderCounts {
  /** Every file given. */
  readonly all: number;
  /** Files in no folder. */
  readonly root: number;
  readonly byFolder: ReadonlyMap<string, number>;
}

/** How many of the given files are in each folder, for the numbers on the folder chips. */
export function folderCounts(items: readonly Pick<MediaDto, 'folderId'>[]): FolderCounts {
  const byFolder = new Map<string, number>();
  let root = 0;
  for (const item of items) {
    if (item.folderId === null) root += 1;
    else byFolder.set(item.folderId, (byFolder.get(item.folderId) ?? 0) + 1);
  }
  return { all: items.length, root, byFolder };
}

export interface MediaFailureText {
  /** The explanation from the shared message table; without what to do next when read-only. */
  readonly message: string;
  /** The API's error code, shown as text. Null when none was recorded. */
  readonly code: MediaErrorCode | null;
  /** What the inspection added, when it added anything. */
  readonly detail: string | null;
}

/**
 * Why a file failed its check, worded as M0 words it. Null for a file that has not failed.
 * `readOnly` (a role that cannot upload) keeps what went wrong and drops what to do next.
 */
export function mediaFailureText(
  media: Pick<MediaDto, 'status' | 'errorCode' | 'errorDetail'>,
  readOnly = false,
): MediaFailureText | null {
  if (media.status !== 'failed') return null;
  return {
    message: mediaFailureMessage(media.errorCode, readOnly),
    code: media.errorCode,
    detail: media.errorDetail,
  };
}

/** "12 files", or "3 of 12 images" while a search or filter narrows the list. */
export function libraryCountLabel(
  matched: number,
  total: number,
  filtering: boolean,
  kind: LibraryKind,
): string {
  const label = countLabel(total, NOUNS[kind].one, NOUNS[kind].many);
  return filtering ? `${matched} of ${label}` : label;
}

const dayFormat = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' });
const dayYearFormat = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });

/**
 * A compact local date and time for the Modified column: "16 Nov, 3:04 pm", with the year
 * once it is not the current one. The full timestamp with its time zone goes in the title.
 */
export function modifiedLabel(iso: string, now: Date = new Date()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  const date = new Date(time);
  const day =
    date.getFullYear() === now.getFullYear() ? dayFormat.format(date) : dayYearFormat.format(date);
  return `${day}, ${timeFormat.format(date)}`;
}

export type LibraryEmptyState =
  /** The library holds nothing at all. */
  | 'library_empty'
  /** The library has files, but none of this route's kind. */
  | 'kind_empty'
  /** The address names a folder that is not in the list (deleted since the link was made). */
  | 'folder_missing'
  /** Only a folder is chosen and nothing of this kind is in it. */
  | 'folder_empty'
  /** A search or filter hides everything. */
  | 'no_match';

/**
 * Which empty state to show when no row is listed. `folderKnown` is false only when the
 * folder list has arrived and does not hold the chosen folder.
 */
export function libraryEmptyState(input: {
  readonly libraryTotal: number;
  readonly kindTotal: number;
  readonly query: LibraryQuery;
  readonly folderKnown: boolean;
}): LibraryEmptyState {
  const { libraryTotal, kindTotal, query, folderKnown } = input;
  if (!folderKnown) return 'folder_missing';
  if (libraryTotal === 0 && !isFiltering(query)) return 'library_empty';
  if (kindTotal === 0 && !isFiltering(query)) return 'kind_empty';
  if (isFolderOnly(query)) return 'folder_empty';
  return 'no_match';
}
