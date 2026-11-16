import {
  ABSOLUTE,
  DescriptionInputSchema,
  NameSchema,
  PLAYLIST_PREVIEW_COUNT,
  type DisplayDto,
  type DisplayPatch,
  type FitMode,
  type MediaDto,
  type MediaKind,
  type PlaylistDto,
  type PushPlanResponse,
  type PushPlanRow,
} from '@tinnox/contracts';
import { playlistSummaryLabel } from './mediaName.ts';

/**
 * Pure logic of the screen details page (docs/portal-v2/stage-a.md, section 3.8): its tabs,
 * the name and description form, the pairing texts and what is said about the assigned
 * playlist. No DOM. In the code the object is a `display`; every text an operator reads says
 * "screen" (decision P2-03) and never calls a screen reachable or not (decision P2-04).
 */

/** How often the page reads the screen's status while the browser tab is visible, as in M0. */
export const SCREEN_STATUS_POLL_MS = 5000;

// ---------- Tabs ----------

/** The stages of docs/portal-v2/README.md, section 2, that bring a tab which is not built yet. */
export type PlannedStage = 'B' | 'C';

export interface ScreenDetailTab {
  readonly id: string;
  readonly label: string;
  /** Null for a tab that exists; otherwise the stage that brings it. */
  readonly plannedStage: PlannedStage | null;
}

export const SCREEN_DETAIL_TABS = [
  { id: 'overview', label: 'Overview', plannedStage: null },
  { id: 'canvas', label: 'Canvas', plannedStage: null },
  { id: 'pairing', label: 'Pairing', plannedStage: null },
  { id: 'tags', label: 'Tags', plannedStage: null },
  { id: 'working-hours', label: 'Working hours', plannedStage: 'B' },
  { id: 'alerts', label: 'Alerts', plannedStage: 'C' },
  { id: 'advanced', label: 'Advanced', plannedStage: 'B' },
] as const satisfies readonly ScreenDetailTab[];

export type ScreenDetailTabId = (typeof SCREEN_DETAIL_TABS)[number]['id'];

/** The tabs that can be opened. */
export const SCREEN_DETAIL_OPEN_TABS = ['overview', 'canvas', 'pairing', 'tags'] as const;
export type ScreenDetailOpenTabId = (typeof SCREEN_DETAIL_OPEN_TABS)[number];

export const DEFAULT_SCREEN_DETAIL_TAB: ScreenDetailOpenTabId = 'overview';

/** Tooltip and accessible description of a tab that is not built yet. */
export function plannedTabReason(stage: PlannedStage): string {
  return `Planned for stage ${stage}`;
}

/**
 * The tab named by `?tab=`. Anything that is not a tab which can be opened (nothing, an
 * unknown word, a planned tab) is the overview.
 */
export function screenDetailTabOf(param: string | null): ScreenDetailOpenTabId {
  return SCREEN_DETAIL_OPEN_TABS.find((id) => id === param) ?? DEFAULT_SCREEN_DETAIL_TAB;
}

/**
 * The query string that selects `tab`, keeping every other parameter. The overview is the
 * address without `tab`. Returns "" or a string that starts with "?".
 */
export function screenDetailSearch(search: string, tab: ScreenDetailOpenTabId): string {
  const params = new URLSearchParams(search);
  if (tab === DEFAULT_SCREEN_DETAIL_TAB) params.delete('tab');
  else params.set('tab', tab);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

// ---------- Push state ----------

/** The row of the push plan for one screen, or null when the plan does not list it. */
export function pushRowFor(plan: PushPlanResponse | null, displayId: string): PushPlanRow | null {
  if (plan === null) return null;
  const id = displayId.toLowerCase();
  return plan.items.find((row) => row.display.id.toLowerCase() === id) ?? null;
}

// ---------- Name and description ----------

export interface ScreenDetailsValues {
  readonly name: string;
  /** The text as typed; an empty description is stored as none. */
  readonly description: string;
}

export type ScreenDetailsField = 'name' | 'description';
export type ScreenDetailsErrors = Partial<Record<ScreenDetailsField, string>>;

export type ScreenDetailsResult =
  /** `patch` is null when nothing differs from what is stored once the text is tidied. */
  | { readonly ok: true; readonly patch: DisplayPatch | null }
  | { readonly ok: false; readonly errors: ScreenDetailsErrors };

type DetailsSource = Pick<DisplayDto, 'name' | 'description'>;

export const SCREEN_NAME_MAX = ABSOLUTE.maxNameLength;
export const SCREEN_DESCRIPTION_MAX = ABSOLUTE.maxDescriptionLength;

export function screenDetailsOf(display: DetailsSource): ScreenDetailsValues {
  return { name: display.name, description: display.description ?? '' };
}

/** True when the form holds something other than what is stored. */
export function screenDetailsDirty(values: ScreenDetailsValues, display: DetailsSource): boolean {
  const stored = screenDetailsOf(display);
  return values.name !== stored.name || values.description !== stored.description;
}

/** A textarea may hand back Windows line endings; the API accepts line feeds only. */
function normaliseLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Checks the name and description as the API will (the shared schemas are the last word)
 * and builds the body of `PATCH /api/displays/:id` from the fields that changed.
 */
export function validateScreenDetails(
  values: ScreenDetailsValues,
  display: DetailsSource,
): ScreenDetailsResult {
  const errors: ScreenDetailsErrors = {};

  const trimmedName = values.name.trim();
  let name: string | null = null;
  if (trimmedName === '') {
    errors.name = 'Enter a name.';
  } else if (trimmedName.length > SCREEN_NAME_MAX) {
    errors.name = `A name can have at most ${SCREEN_NAME_MAX} characters. This one has ${trimmedName.length}.`;
  } else {
    const parsed = NameSchema.safeParse(values.name);
    if (parsed.success) name = parsed.data;
    else errors.name = 'A name cannot contain line breaks or other control characters.';
  }

  const descriptionText = normaliseLineEndings(values.description);
  const trimmedDescription = descriptionText.trim();
  let description: string | null = null;
  if (trimmedDescription.length > SCREEN_DESCRIPTION_MAX) {
    errors.description = `A description can have at most ${SCREEN_DESCRIPTION_MAX} characters. This one has ${trimmedDescription.length}.`;
  } else {
    const parsed = DescriptionInputSchema.safeParse(descriptionText);
    if (parsed.success) description = parsed.data;
    else {
      errors.description =
        'A description can contain line breaks, but no tabs or other control characters.';
    }
  }

  if (Object.keys(errors).length > 0 || name === null) return { ok: false, errors };

  const patch: { name?: string; description?: string | null } = {};
  if (name !== display.name) patch.name = name;
  if (description !== display.description) patch.description = description;
  return { ok: true, patch: Object.keys(patch).length === 0 ? null : patch };
}

/** "12 of 500 characters", for the hint under the description. */
export function descriptionCountLabel(description: string): string {
  const length = normaliseLineEndings(description).trim().length;
  return `${length} of ${SCREEN_DESCRIPTION_MAX} characters`;
}

// ---------- Tags ----------

/** True when the two lists hold the same tag ids, in any order. */
export function sameTagIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** The toast after the tags of a screen were saved. */
export function tagsSavedText(count: number): string {
  if (count === 0) return 'Tags removed from this screen';
  return count === 1 ? '1 tag saved for this screen' : `${count} tags saved for this screen`;
}

// ---------- Pairing ----------

export const PAIRING_CODE_PROBLEM =
  'A pairing code has 8 letters or digits, for example ABCD-2345. It never contains 0, 1, I, L, O or U.';

/** How long a pairing code lasts, in whole minutes (at least one). */
export function pairingTtlMinutes(pairingCodeTtlSeconds: number): number {
  return Math.max(1, Math.round(pairingCodeTtlSeconds / 60));
}

function minutes(count: number): string {
  return count === 1 ? '1 minute' : `${count} minutes`;
}

export function pairingHint(ttlMinutes: number): string {
  return `Open the player in a browser; it shows an 8-character code that works once and lasts ${minutes(ttlMinutes)}.`;
}

/** What to do about a refused pairing, by API error code. Null when there is nothing to add. */
export function pairingHelp(errorCode: string | null, ttlMinutes: number): string | null {
  switch (errorCode) {
    case 'pairing_code_invalid':
    case 'not_found':
      return `The code was not accepted: it is mistyped, has expired (codes last ${minutes(ttlMinutes)}) or was already used. Read the code currently on the player and try again.`;
    case 'pairing_expired':
      return 'That code has expired. The player shows a new code; enter that one.';
    case 'pairing_locked':
    case 'rate_limited':
      return 'Too many wrong codes were entered. Wait a few minutes before trying again.';
    default:
      return null;
  }
}

/** What is said after a code was accepted. */
export function pairingAcceptedText(replacedPrevious: boolean): string {
  return [
    'The player collects its credential the next time it checks in, usually within a few seconds.',
    ...(replacedPrevious ? ['The previous player credential was revoked.'] : []),
    'The status shows the player once it sends its first report.',
  ].join(' ');
}

/** What is said after a revocation, by what the API answered. */
export function revokeOutcomeText(revokedRegistrationId: string | null): string {
  return revokedRegistrationId === null
    ? 'This screen had no active player credential. Nothing was changed.'
    : 'The player credential was revoked. That player can no longer fetch manifests or media. Content it already cached stays on the device until it is reset there.';
}

/** The sentence about who holds a credential now. `since` is an already formatted time. */
export function pairingStateText(since: string | null): string {
  return since === null
    ? 'No player is paired with this screen.'
    : `A player has held a credential since ${since}. Pairing another player replaces it and revokes the current credential.`;
}

// ---------- Assigned content ----------

export interface AssignedFirstItem {
  readonly media: Pick<MediaDto, 'id' | 'kind' | 'status'>;
  /** The media item's shown name. */
  readonly name: string;
  /** The fit the item is drawn with: its own, or else the screen's default. */
  readonly fit: FitMode;
  /** False when the fit is the screen's default. */
  readonly fitFromItem: boolean;
}

export interface AssignedContent {
  readonly itemCount: number;
  /**
   * Length of one loop, counted as the playlist list does: an image's time on screen plus a
   * video's natural length; an item with no length yet counts as zero.
   */
  readonly loopMs: number;
  /** "3 items · 0:45", or "No items". */
  readonly summary: string;
  /** The first distinct media ids in play order, for the thumbnail mosaic. */
  readonly previewMediaIds: readonly string[];
  /** The media kinds present, each once. */
  readonly kinds: readonly MediaKind[];
  readonly kindById: ReadonlyMap<string, MediaKind>;
  /** The item that plays first, or null for an empty playlist. */
  readonly first: AssignedFirstItem | null;
}

/** What the screen page shows of the assigned playlist, from the playlist itself. */
export function assignedContent(playlist: PlaylistDto, defaultFit: FitMode): AssignedContent {
  const items = [...playlist.items].sort((a, b) => a.position - b.position);
  const kindById = new Map<string, MediaKind>();
  const previewMediaIds: string[] = [];
  let loopMs = 0;
  for (const item of items) {
    const length = item.media.kind === 'video' ? item.media.durationMs : item.durationMs;
    loopMs += length ?? 0;
    if (!kindById.has(item.mediaId)) {
      kindById.set(item.mediaId, item.media.kind);
      if (previewMediaIds.length < PLAYLIST_PREVIEW_COUNT) previewMediaIds.push(item.mediaId);
    }
  }
  const kinds = (['image', 'video'] as const).filter((kind) =>
    items.some((item) => item.media.kind === kind),
  );
  const head = items[0];
  return {
    itemCount: items.length,
    loopMs,
    summary: playlistSummaryLabel({ itemCount: items.length, totalDurationMs: loopMs }),
    previewMediaIds,
    kinds,
    kindById,
    first:
      head === undefined
        ? null
        : {
            media: { id: head.media.id, kind: head.media.kind, status: head.media.status },
            name: head.media.name,
            fit: head.fit ?? defaultFit,
            fitFromItem: head.fit !== null,
          },
  };
}

/** One successful read of the assigned playlist, tagged with the id it was read for. */
export interface AssignedRead {
  readonly playlistId: string;
  readonly playlist: PlaylistDto;
}

/**
 * A failed read of the assigned playlist, tagged with the id it was read for, so a failure
 * is never shown against another assignment (or hidden behind an earlier one's answer).
 */
export class AssignedReadError extends Error {
  readonly playlistId: string;

  constructor(playlistId: string, cause: unknown) {
    super('The assigned playlist could not be read', { cause });
    this.name = 'AssignedReadError';
    this.playlistId = playlistId;
  }
}

/** The shape of a load state (hooks/useLoad.ts) that the resolver below needs. */
export type AssignedLoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly data: AssignedRead | null;
      readonly refreshError: unknown;
    };

export type AssignedPlaylistState =
  | { readonly status: 'none' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly playlist: PlaylistDto;
      readonly content: AssignedContent;
      /** Set when a later read failed; `playlist` is then the last good answer. */
      readonly refreshError: unknown;
    };

/** The failure behind `error` when it belongs to `playlistId`; `undefined` when it does not. */
function failureFor(error: unknown, playlistId: string): unknown {
  if (error instanceof AssignedReadError) {
    return error.playlistId === playlistId ? (error.cause ?? null) : undefined;
  }
  return error;
}

/**
 * What the screen page shows of the assignment. The load keeps an earlier assignment's answer
 * while a new one is read; that answer means "loading" for the new one, but a failure of the
 * new read is an error with its retry, never an endless skeleton.
 */
export function assignedPlaylistStateOf(
  playlistId: string | null,
  load: AssignedLoadState,
  defaultFit: FitMode,
): AssignedPlaylistState {
  if (playlistId === null) return { status: 'none' };
  if (load.status === 'loading') return { status: 'loading' };
  if (load.status === 'error') {
    const failure = failureFor(load.error, playlistId);
    return failure === undefined ? { status: 'loading' } : { status: 'error', error: failure };
  }
  const read = load.data;
  const failure =
    load.refreshError === null ? undefined : failureFor(load.refreshError, playlistId);
  if (read === null || read.playlistId !== playlistId) {
    // An earlier assignment's answer: the new one is still being read, or its read failed.
    return failure === undefined ? { status: 'loading' } : { status: 'error', error: failure };
  }
  return {
    status: 'ready',
    playlist: read.playlist,
    content: assignedContent(read.playlist, defaultFit),
    refreshError: failure ?? null,
  };
}

/** What the preview frame is showing, for the line under it. */
export type PreviewState =
  | 'nothing_assigned'
  | 'loading'
  | 'unavailable'
  | 'empty_playlist'
  | 'processing'
  | 'failed'
  | 'ready';

export function previewStateOf(
  assigned: boolean,
  content: AssignedContent | 'loading' | 'unavailable',
): PreviewState {
  if (!assigned) return 'nothing_assigned';
  if (content === 'loading' || content === 'unavailable') return content;
  if (content.first === null) return 'empty_playlist';
  if (content.first.media.status === 'ready') return 'ready';
  return content.first.media.status;
}

/** One sentence under the preview frame that says what is, or is not, drawn in it. */
export function previewCaption(
  state: PreviewState,
  playlistName: string | null,
  firstItemName: string | null,
): string {
  const playlist = playlistName === null ? 'the assigned playlist' : `“${playlistName}”`;
  switch (state) {
    case 'nothing_assigned':
      return 'No playlist is assigned to this screen, so there is nothing to preview.';
    case 'loading':
      return `Loading the first item of ${playlist}.`;
    case 'unavailable':
      return `The items of ${playlist} could not be loaded, so there is no preview.`;
    case 'empty_playlist':
      return `${capitalise(playlist)} has no items yet, so there is nothing to preview.`;
    case 'processing':
      return `The first item of ${playlist} is still being checked.`;
    case 'failed':
      return `The first item of ${playlist} failed its check and cannot be shown.`;
    case 'ready':
      return firstItemName === null
        ? `The first item of ${playlist}.`
        : `“${firstItemName}”, the first item of ${playlist}.`;
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The sentence that must stay next to every preview and status on the page. */
export const PREVIEW_DISCLAIMER =
  'A mock-up drawn from the library file. It is not a picture of the physical screen.';

export const STATUS_DISCLAIMER =
  'Player status is reported by player software. It is not proof of what a physical screen shows.';

export const REPORTED_FACTS_NOTE =
  'These values are what the player program last told the server. They are evidence from software, not proof of what a physical screen is showing.';
