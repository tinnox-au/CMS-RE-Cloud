/**
 * The screens list (docs/portal-v2/stage-a.md, 3.6). Pure functions, no DOM: joining the
 * list of screens with their sites, status views and push plan rows, the status filter kept
 * in the address (`?status=`), sorting, the shape of a grid tile, and the wording of the
 * assign-content outcome.
 *
 * In code the object is a `display`, as in the API and the contracts; every string an
 * operator sees says "screen" (P2-03). Status wording comes from `screenStatus.ts` (P2-04).
 */
import type {
  DeliveryStatusView,
  DisplayDto,
  PushPlanResponse,
  PushPlanRow,
  PushState,
  SiteDto,
} from '@tinnox/contracts';
import { assignedContent, planRowContent } from './assignedContent.ts';
import { countOf } from './bulkOutcome.ts';
import type { SortAccessors } from './listView.ts';
import { formatDimensions } from './mediaName.ts';
import {
  screenStatus,
  screenStatusGroup,
  type ScreenStatusGroup,
  type ScreenStatusKind,
} from './screenStatus.ts';

// ---------------------------------------------------------------------------
// Rows

/** Shown in the Site column when a screen names a site the list of sites does not hold. */
export const UNKNOWN_SITE_LABEL = 'Unknown site';

export interface ScreenRow {
  readonly display: DisplayDto;
  /** The site's name, or `UNKNOWN_SITE_LABEL`; null while the sites are not known. */
  readonly siteName: string | null;
  /** What the player last reported; null while the statuses are not known. */
  readonly view: DeliveryStatusView | null;
  /** The kind the status pill shows for `view`; null with no view. */
  readonly statusKind: ScreenStatusKind | null;
  /** This screen's row of the push plan; null while the plan is not known. */
  readonly push: PushPlanRow | null;
  /** A player holds a credential for this screen, by the list or by the latest status. */
  readonly paired: boolean;
}

/** Identifiers compare without regard to letter case; the API answers in lower case. */
function idKey(id: string): string {
  return id.toLowerCase();
}

export interface ScreenRowSources {
  readonly displays: readonly DisplayDto[];
  /** Null while the sites are loading or could not be loaded. */
  readonly sites: readonly SiteDto[] | null;
  /** Null while the statuses are loading or could not be loaded. */
  readonly statuses: readonly DeliveryStatusView[] | null;
  /** Null until the push plan was read. */
  readonly plan: PushPlanResponse | null;
}

/** One row per screen, in the order of `displays`. */
export function buildScreenRows(sources: ScreenRowSources): ScreenRow[] {
  const { displays, sites, statuses, plan } = sources;
  const siteNames = new Map((sites ?? []).map((site) => [idKey(site.id), site.name]));
  const views = new Map((statuses ?? []).map((view) => [idKey(view.displayId), view]));
  const pushRows = new Map((plan?.items ?? []).map((row) => [idKey(row.display.id), row]));
  return displays.map((display) => {
    const view = views.get(idKey(display.id)) ?? null;
    return {
      display,
      siteName:
        sites === null ? null : (siteNames.get(idKey(display.siteId)) ?? UNKNOWN_SITE_LABEL),
      view,
      statusKind: view === null ? null : screenStatus(view, 0).kind,
      push: pushRows.get(idKey(display.id)) ?? null,
      paired: display.player !== null || view?.paired === true,
    };
  });
}

/**
 * True when the statuses name a screen the list does not hold: a screen was added somewhere
 * else since the list was read, so the list is worth reading again.
 */
export function hasUnlistedScreen(
  displays: readonly DisplayDto[],
  statuses: readonly DeliveryStatusView[],
): boolean {
  const listed = new Set(displays.map((display) => idKey(display.id)));
  return statuses.some((view) => !listed.has(idKey(view.displayId)));
}

/** "1920 × 1080 px", with the multiplication sign. */
export function canvasLabel(display: Pick<DisplayDto, 'canvas'>): string {
  return (
    formatDimensions(display.canvas.width, display.canvas.height) ??
    `${display.canvas.width} × ${display.canvas.height} px`
  );
}

/** What the search field is matched against. */
export function screenSearchTexts(row: ScreenRow): readonly (string | null)[] {
  return [
    row.display.name,
    row.display.description,
    row.siteName,
    assignedContent(row.display)?.name ?? null,
    canvasLabel(row.display),
    `${row.display.canvas.width}x${row.display.canvas.height}`,
  ];
}

// ---------------------------------------------------------------------------
// The status filter

/** The values of `?status=`, in the order of the chips. The dashboard links with them. */
export const SCREEN_STATUS_FILTERS = ['in_sync', 'updating', 'attention', 'unpaired'] as const;
export type ScreenStatusFilter = (typeof SCREEN_STATUS_FILTERS)[number];

export const SCREEN_STATUS_FILTER_LABELS: { readonly [K in ScreenStatusFilter]: string } = {
  in_sync: 'In sync',
  updating: 'Updating',
  attention: 'Needs attention',
  unpaired: 'Not paired',
};

/** One sentence per chip, for its tooltip: which statuses it gathers. */
export const SCREEN_STATUS_FILTER_HINTS: { readonly [K in ScreenStatusFilter]: string } = {
  in_sync: 'The player recently reported that it plays what was pushed, or is standing by.',
  updating: 'Updating, Waiting for player or Nothing pushed.',
  attention: 'Error or Not reporting.',
  unpaired: 'No player holds a credential for the screen.',
};

const FILTER_OF_GROUP: { readonly [K in ScreenStatusGroup]: ScreenStatusFilter } = {
  in_sync: 'in_sync',
  pending: 'updating',
  attention: 'attention',
  not_paired: 'unpaired',
};

/** The chip a status belongs to. Every status belongs to exactly one. */
export function statusFilterOf(kind: ScreenStatusKind): ScreenStatusFilter {
  return FILTER_OF_GROUP[screenStatusGroup(kind)];
}

function isStatusFilter(value: string): value is ScreenStatusFilter {
  return (SCREEN_STATUS_FILTERS as readonly string[]).includes(value);
}

/**
 * Reads `?status=`. Several values are separated by commas; unknown values are ignored, so
 * an address typed by hand never breaks the page.
 */
export function parseStatusFilter(param: string | null): ReadonlySet<ScreenStatusFilter> {
  const selected = new Set<ScreenStatusFilter>();
  if (param === null) return selected;
  for (const part of param.split(',')) {
    const value = part.trim().toLowerCase();
    if (isStatusFilter(value)) selected.add(value);
  }
  return selected;
}

/** The value of `?status=` for a selection, in chip order; null when nothing is selected. */
export function formatStatusFilter(selected: ReadonlySet<ScreenStatusFilter>): string | null {
  const values = SCREEN_STATUS_FILTERS.filter((value) => selected.has(value));
  return values.length === 0 ? null : values.join(',');
}

export function toggleStatusFilter(
  selected: ReadonlySet<ScreenStatusFilter>,
  value: ScreenStatusFilter,
  on: boolean,
): ReadonlySet<ScreenStatusFilter> {
  const next = new Set(selected);
  if (on) next.add(value);
  else next.delete(value);
  return next;
}

/**
 * Whether a row passes the status filter. A screen whose status is not known passes only
 * when no status is filtered on: the list never guesses a status.
 */
export function matchesStatusFilter(
  kind: ScreenStatusKind | null,
  selected: ReadonlySet<ScreenStatusFilter>,
): boolean {
  if (selected.size === 0) return true;
  return kind !== null && selected.has(statusFilterOf(kind));
}

/** How many screens each chip would show. Screens without a known status are not counted. */
export function countByStatusFilter(rows: readonly ScreenRow[]): {
  readonly [K in ScreenStatusFilter]: number;
} {
  const counts = { in_sync: 0, updating: 0, attention: 0, unpaired: 0 };
  for (const row of rows) {
    if (row.statusKind !== null) counts[statusFilterOf(row.statusKind)] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// The view kept in the address

export const SCREEN_LIST_VIEWS = ['list', 'grid'] as const;
export type ScreenListView = (typeof SCREEN_LIST_VIEWS)[number];

/** Reads `?view=`; anything but `grid` is the list. */
export function parseListView(param: string | null): ScreenListView {
  return param === 'grid' ? 'grid' : 'list';
}

// ---------------------------------------------------------------------------
// Sorting

/** Ascending order of the Status column: what needs a person first. */
const STATUS_RANK: { readonly [K in ScreenStatusKind]: number } = {
  error: 0,
  not_reporting: 1,
  updating: 2,
  waiting_for_player: 3,
  nothing_pushed: 4,
  standing_by: 5,
  in_sync: 6,
  not_paired: 7,
};

export const SCREEN_SORT_ACCESSORS: SortAccessors<ScreenRow> = {
  name: (row) => row.display.name,
  status: (row) => (row.statusKind === null ? null : STATUS_RANK[row.statusKind]),
  content: (row) => assignedContent(row.display)?.name ?? null,
  site: (row) => row.siteName,
  canvas: (row) => row.display.canvas.width * row.display.canvas.height,
};

// ---------------------------------------------------------------------------
// Push marker

/**
 * The push states the Content column marks: something is waiting to be pushed, or the
 * assigned content cannot be pushed. "Up to date" and "Nothing assigned" need no marker.
 */
export function showsPushMarker(state: PushState): boolean {
  return state === 'changes' || state === 'never_pushed' || state === 'blocked';
}

/**
 * The push state to mark next to a screen's assigned content, or null for no marker. The
 * plan is read less often than the list: a plan row that is about other content than what is
 * assigned now (the assignment changed a moment ago) gives no marker rather than a wrong
 * one. A plan row of a schedule or a layout also carries a playlist (the default or the main
 * zone's), so the row is compared by what it is about: a screen with a playlist matches only
 * a row of that playlist alone.
 */
export function pushMarkerFor(row: Pick<ScreenRow, 'display' | 'push'>): PushState | null {
  const { push } = row;
  if (push === null) return null;
  const assigned = assignedContent(row.display);
  const planned = planRowContent(push);
  const planIsAboutIt =
    assigned !== null &&
    planned !== null &&
    assigned.kind === planned.kind &&
    idKey(assigned.id) === idKey(planned.id);
  if (!planIsAboutIt) return null;
  return showsPushMarker(push.state) ? push.state : null;
}

// ---------------------------------------------------------------------------
// The canvas-shaped frame of a grid tile and of a row's lead

/**
 * The thinnest a frame is drawn: its short side is at least this share of the stage's side
 * along it, so a strip never becomes a hairline. In a 16:9 tile that allows any canvas from
 * about 1:2.8 to 8.9:1, which takes in every preset the wizard offers, the 3840 × 480 "Wide
 * strip" (8:1) included, at its true proportion. In the 44 px square lead of a list row the
 * same share allows 1:5 to 5:1, so the strip is drawn there at 5:1 and flagged as clamped.
 */
export const MIN_FRAME_SHARE = 0.2;

export interface FrameShape {
  /** Width over height of the frame as drawn, within the limits. */
  readonly ratio: number;
  /** Size of the frame as a percentage of the stage it is centred in. */
  readonly widthPercent: number;
  readonly heightPercent: number;
  /** True when the real canvas is more extreme than the frame that is drawn. */
  readonly clamped: boolean;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Fits a frame of the canvas's shape into a stage of `stageRatio` (width over height),
 * touching the stage on its longer side. A canvas so long or so tall that its short side
 * would be thinner than `MIN_FRAME_SHARE` of the stage is drawn at that limit, and
 * `clamped` says so. A size that is not a positive number gives the stage's own shape.
 */
export function frameShape(width: number, height: number, stageRatio = 16 / 9): FrameShape {
  const stage = Number.isFinite(stageRatio) && stageRatio > 0 ? stageRatio : 16 / 9;
  const valid = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  const real = valid ? width / height : stage;
  const ratio = Math.min(stage / MIN_FRAME_SHARE, Math.max(stage * MIN_FRAME_SHARE, real));
  const wide = ratio >= stage;
  return {
    ratio,
    widthPercent: wide ? 100 : round((ratio / stage) * 100),
    heightPercent: wide ? round((stage / ratio) * 100) : 100,
    clamped: ratio !== real,
  };
}

export interface FrameInset {
  readonly leftPercent: number;
  readonly topPercent: number;
  readonly widthPercent: number;
  readonly heightPercent: number;
}

/** The content area of a canvas without a content rectangle: all of it. */
export const WHOLE_CANVAS: FrameInset = {
  leftPercent: 0,
  topPercent: 0,
  widthPercent: 100,
  heightPercent: 100,
};

/**
 * Where the content rectangle lies inside the frame, as percentages of the canvas. Null when
 * the screen has no content rectangle, or when the rectangle covers the whole canvas.
 */
export function contentInset(
  display: Pick<DisplayDto, 'canvas' | 'contentRect'>,
): FrameInset | null {
  const { canvas, contentRect } = display;
  if (contentRect === null || canvas.width <= 0 || canvas.height <= 0) return null;
  const left = Math.min(100, Math.max(0, (contentRect.x / canvas.width) * 100));
  const top = Math.min(100, Math.max(0, (contentRect.y / canvas.height) * 100));
  const width = Math.min(100 - left, Math.max(0, (contentRect.width / canvas.width) * 100));
  const height = Math.min(100 - top, Math.max(0, (contentRect.height / canvas.height) * 100));
  if (left === 0 && top === 0 && width === 100 && height === 100) return null;
  return {
    leftPercent: round(left),
    topPercent: round(top),
    widthPercent: round(width),
    heightPercent: round(height),
  };
}

// ---------------------------------------------------------------------------
// Assigning content

/**
 * The screens an assignment would change: those that do not have this playlist already. A
 * screen with a schedule or a layout has no playlist, so it counts for any playlist chosen (it
 * gets the playlist instead) and never for "no playlist".
 */
export function screensToAssign(
  displays: readonly DisplayDto[],
  playlistId: string | null,
): DisplayDto[] {
  return displays.filter((display) => {
    const current = display.assignedPlaylist?.id ?? null;
    if (current === null || playlistId === null) return current !== playlistId;
    return idKey(current) !== idKey(playlistId);
  });
}

/**
 * The playlist every one of the screens has assigned, or null when they differ or when any
 * of them has none. The assign dialog starts on it.
 */
export function commonPlaylistId(displays: readonly DisplayDto[]): string | null {
  const first = displays[0]?.assignedPlaylist?.id ?? null;
  if (first === null) return null;
  return displays.every((display) => {
    const id = display.assignedPlaylist?.id ?? null;
    return id !== null && idKey(id) === idKey(first);
  })
    ? first
    : null;
}

/**
 * The toast after an assignment that fully succeeded: one screen by name, several by count.
 * Choosing no playlist only clears the assignment; the screen is not cleared (decision P2-05),
 * so it says "unassigned", never that something was removed from the screen.
 */
export function assignedMessage(
  changed: readonly Pick<DisplayDto, 'name'>[] | number,
  playlistName: string | null,
): string {
  const where =
    typeof changed === 'number'
      ? countOf(changed, 'screen')
      : changed.length === 1
        ? (changed[0]?.name ?? '1 screen')
        : countOf(changed.length, 'screen');
  return playlistName === null
    ? `Playlist unassigned from ${where}`
    : `${playlistName} assigned to ${where}`;
}

/** The second line of that toast: assigning sends nothing by itself. */
export function assignedDetail(playlistName: string | null, count: number): string {
  if (playlistName === null) {
    return count === 1
      ? 'The screen keeps what it was last given.'
      : 'Each screen keeps what it was last given.';
  }
  return count === 1
    ? 'Nothing changes on the screen until you push.'
    : 'Nothing changes on a screen until you push.';
}

/**
 * What was changed, in the notice after a bulk assignment where some screens were refused:
 * one sentence for the screens that were changed, then what that means for those screens.
 */
export function assignedDoneText(playlistName: string | null, count: number): string {
  if (count === 0) return 'No screen was changed.';
  const changed =
    playlistName === null
      ? `The playlist was unassigned from ${countOf(count, 'screen')}.`
      : `${playlistName} was assigned to ${countOf(count, 'screen')}.`;
  return `${changed} ${assignedDetail(playlistName, count)}`;
}

/** "3 screens", "1 screen". */
export function screensLabel(count: number): string {
  return countOf(count, 'screen');
}
