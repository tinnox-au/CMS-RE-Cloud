import { ABSOLUTE, PlaylistCreateSchema, type PlaylistSummaryDto } from '@tinnox/contracts';
import { countLabel, type SortAccessors, type SortDirection, type SortState } from './listView.ts';

/**
 * The playlists list (docs/portal-v2/stage-a.md, section 3.4): what is searched, how the
 * columns sort, and the wording of its counts, dates and name check. Pure functions, no DOM.
 */

type PlaylistRow = Pick<
  PlaylistSummaryDto,
  'name' | 'description' | 'itemCount' | 'totalDurationMs' | 'assignedDisplayCount' | 'updatedAt'
>;

/** The sortable columns of the list, by column id. */
export const PLAYLIST_SORT_COLUMNS = ['name', 'items', 'length', 'screens', 'modified'] as const;
export type PlaylistSortColumn = (typeof PLAYLIST_SORT_COLUMNS)[number];

export const PLAYLIST_SORT_ACCESSORS: SortAccessors<PlaylistRow> = {
  name: (playlist) => playlist.name,
  items: (playlist) => playlist.itemCount,
  length: (playlist) => playlist.totalDurationMs,
  screens: (playlist) => playlist.assignedDisplayCount,
  modified: (playlist) => new Date(playlist.updatedAt),
} satisfies { readonly [K in PlaylistSortColumn]: (playlist: PlaylistRow) => unknown };

/** The list opens with the playlist that was changed last at the top. */
export const DEFAULT_PLAYLIST_SORT: SortState = { columnId: 'modified', direction: 'desc' };

/** The texts a search is matched against: the name and the description. */
export function playlistSearchTexts(
  playlist: Pick<PlaylistSummaryDto, 'name' | 'description'>,
): readonly (string | null)[] {
  return [playlist.name, playlist.description];
}

export interface PlaylistSortOption {
  /** `column:direction`, the value of the option in the "Sort by" select. */
  readonly value: string;
  readonly label: string;
  readonly sort: SortState;
}

const SORT_OPTION_LABELS: {
  readonly [K in PlaylistSortColumn]: { readonly [D in SortDirection]: string };
} = {
  modified: { desc: 'Modified, newest first', asc: 'Modified, oldest first' },
  name: { asc: 'Name, A to Z', desc: 'Name, Z to A' },
  items: { desc: 'Items, most first', asc: 'Items, fewest first' },
  length: { desc: 'Length, longest first', asc: 'Length, shortest first' },
  screens: { desc: 'Screens, most first', asc: 'Screens, fewest first' },
};

function optionValue(sort: SortState): string {
  return `${sort.columnId}:${sort.direction}`;
}

/**
 * Every order the table's headers can produce, for the "Sort by" select of the grid view,
 * where there are no column headers to press.
 */
export const PLAYLIST_SORT_OPTIONS: readonly PlaylistSortOption[] = (
  ['modified', 'name', 'items', 'length', 'screens'] as const
).flatMap((columnId) => {
  const labels = SORT_OPTION_LABELS[columnId];
  const first: SortDirection = columnId === 'name' ? 'asc' : 'desc';
  const second: SortDirection = first === 'asc' ? 'desc' : 'asc';
  return [first, second].map((direction) => {
    const sort: SortState = { columnId, direction };
    return { value: optionValue(sort), label: labels[direction], sort };
  });
});

/** The select value of the current order; the default order when it is not one of the options. */
export function playlistSortValue(sort: SortState | null): string {
  const value = sort === null ? null : optionValue(sort);
  const known = PLAYLIST_SORT_OPTIONS.some((option) => option.value === value);
  return known && value !== null ? value : optionValue(DEFAULT_PLAYLIST_SORT);
}

/** The order a select value stands for; the default order for a value that is not an option. */
export function playlistSortFromValue(value: string): SortState {
  return (
    PLAYLIST_SORT_OPTIONS.find((option) => option.value === value)?.sort ?? DEFAULT_PLAYLIST_SORT
  );
}

/** "12 playlists", or "3 of 12 playlists" while a search narrows the list. */
export function playlistsCountLabel(matched: number, total: number, searching: boolean): string {
  const all = countLabel(total, 'playlist');
  return searching ? `${matched} of ${all}` : all;
}

/** How many screens have the playlist assigned, in words: "Not assigned", "1 screen", "3 screens". */
export function assignedScreensLabel(assignedDisplayCount: number): string {
  return assignedDisplayCount <= 0 ? 'Not assigned' : countLabel(assignedDisplayCount, 'screen');
}

export type PlaylistNameCheck =
  { readonly ok: true; readonly name: string } | { readonly ok: false; readonly problem: string };

/**
 * Checks the name of a new playlist against the shared schema before it is sent: the same
 * rule the API applies, so the answer here is only a faster one. The name comes back trimmed.
 */
export function checkPlaylistName(input: string): PlaylistNameCheck {
  if (input.trim() === '') return { ok: false, problem: 'Enter a name.' };
  const parsed = PlaylistCreateSchema.safeParse({ name: input });
  if (parsed.success) return { ok: true, name: parsed.data.name };
  if (input.trim().length > ABSOLUTE.maxNameLength) {
    return { ok: false, problem: `Use ${ABSOLUTE.maxNameLength} characters or fewer.` };
  }
  return { ok: false, problem: 'Use a single line of text without control characters.' };
}

const LOCALE = 'en-AU';

function formatter(options: Intl.DateTimeFormatOptions, timeZone: string | undefined) {
  return new Intl.DateTimeFormat(
    LOCALE,
    timeZone === undefined ? options : { ...options, timeZone },
  );
}

/**
 * When a playlist was last changed, short enough for a table cell: "15 Nov, 8:22 pm" within
 * the current year, "15 Nov 2025" before it. The full time, with seconds and the time zone,
 * belongs in the cell's title (`formatTimestamp`). `timeZone` is for tests; the viewer's own
 * zone is used without it.
 */
export function modifiedLabel(iso: string, now: Date, timeZone?: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  const year = formatter({ year: 'numeric' }, timeZone);
  if (year.format(time) === year.format(now)) {
    return formatter(
      { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' },
      timeZone,
    ).format(time);
  }
  return formatter({ day: 'numeric', month: 'short', year: 'numeric' }, timeZone).format(time);
}
