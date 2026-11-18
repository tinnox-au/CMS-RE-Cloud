/**
 * The playlist editor of portal v2 (docs/portal-v2/stage-a.md, 3.5). Pure functions, no DOM.
 *
 * It builds on the M0 draft in `playlistDraft.ts` (order, durations, fit, the dirty check and
 * the full-list replacement body) and adds what the new editor needs: the description, adding
 * from the library with the media's own default duration, moving an item to a drop position,
 * the geometry of a drag over the filmstrip, the library filters, the error summary, and the
 * words of the push card.
 *
 * In code the object is a `display`, as in the API and the contracts; every string an
 * operator sees says "screen" (P2-03).
 */
import {
  ABSOLUTE,
  isPushPending,
  type AppDto,
  type FitMode,
  type Limits,
  type MediaDto,
  type MediaKind,
  type PlaylistDto,
  type PlaylistReplace,
  type PushPlanResponse,
  type PushPlanRow,
  type Transition,
} from '@tinnox/contracts';
import { planRowContent } from './assignedContent.ts';
import { durationFieldText } from './duration.ts';
import { countLabel, matchesSearch } from './listView.ts';
import { formatClock, mediaDetailsLabel, mediaDisplayName, mediaKindLabel } from './mediaName.ts';
import { APP_TYPE_LABELS } from './apps.ts';
import {
  appendApp,
  appendMedia,
  DEFAULT_IMAGE_SECONDS,
  draftFromPlaylist,
  draftLoopMs,
  isDirty,
  itemName,
  itemRefId,
  moveItem,
  updateItem,
  validateDraft,
  type DraftErrors,
  type DraftItem,
  type PlaylistDraft,
} from './playlistDraft.ts';
import { matchesTagFilter } from './tagColours.ts';

type DraftLimits = Pick<
  Limits,
  'minImageItemDurationMs' | 'maxImageItemDurationMs' | 'maxPlaylistItems'
>;

// ---------------------------------------------------------------------------
// The draft

/** The M0 draft plus the description, as typed, and the playback options. */
export interface EditorDraft extends PlaylistDraft {
  readonly description: string;
  readonly transition: Transition;
  readonly shuffle: boolean;
}

/** Line ends as the API stores them: a text area may hand back CR LF on some platforms. */
function normaliseLines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function descriptionToSave(text: string): string | null {
  const trimmed = normaliseLines(text).trim();
  return trimmed === '' ? null : trimmed;
}

export function editorDraftFromPlaylist(playlist: PlaylistDto): EditorDraft {
  return {
    ...draftFromPlaylist(playlist),
    description: playlist.description ?? '',
    transition: playlist.transition,
    shuffle: playlist.shuffle,
  };
}

/**
 * The draft of a playlist that was just saved, keeping the rendering keys of the draft it
 * was saved from wherever the same media sits at the same position. The filmstrip then keeps
 * its tiles (and their loaded thumbnails and keyboard focus) across a save.
 */
export function carryItemKeys(next: EditorDraft, previous: PlaylistDraft): EditorDraft {
  const used = new Set<string>();
  const items = next.items.map((item, index) => {
    const before = previous.items[index];
    if (
      before === undefined ||
      before.source !== item.source ||
      itemRefId(before) !== itemRefId(item) ||
      used.has(before.key)
    ) {
      return item;
    }
    used.add(before.key);
    return before.key === item.key ? item : { ...item, key: before.key };
  });
  return { ...next, items };
}

export interface SavedDraft {
  /** The draft to show once the save has been answered. */
  readonly draft: EditorDraft;
  /**
   * True when the draft is the stored playlist again (the errors shown since the attempt can
   * go); false when it was edited while the save was in flight and those edits are kept.
   */
  readonly settled: boolean;
}

/**
 * The draft after `PUT /api/playlists/:id` answered with `playlist`. The editor stays open
 * while a save is in flight, so `current` may have moved on from `sentFrom`, the draft that
 * was sent: every edit makes a new draft object, so reference equality tells. Edits made in
 * the meantime are kept (the page then reads "Unsaved changes"); otherwise the draft becomes
 * the server's answer, with the rendering keys carried over.
 */
export function draftAfterSave(
  current: EditorDraft,
  sentFrom: EditorDraft,
  playlist: PlaylistDto,
): SavedDraft {
  if (current !== sentFrom) return { draft: current, settled: false };
  return { draft: carryItemKeys(editorDraftFromPlaylist(playlist), sentFrom), settled: true };
}

/**
 * True when saving would change the stored playlist: name, description, playback options,
 * order, durations or fit.
 */
export function editorIsDirty(draft: EditorDraft, saved: PlaylistDto): boolean {
  return (
    isDirty(draft, saved) ||
    descriptionToSave(draft.description) !== saved.description ||
    draft.transition !== saved.transition ||
    draft.shuffle !== saved.shuffle
  );
}

// ---------------------------------------------------------------------------
// Validation

export interface EditorErrors extends DraftErrors {
  readonly description: string | null;
}

export const NO_EDITOR_ERRORS: EditorErrors = {
  name: null,
  description: null,
  form: null,
  items: {},
};

export type EditorResult =
  | { readonly ok: true; readonly value: PlaylistReplace }
  | { readonly ok: false; readonly errors: EditorErrors };

/** Anything but a line feed among the control characters; a description may have several lines. */
function hasControlCharacter(text: string, allowLineFeed: boolean): boolean {
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code === 0x7f || (code < 0x20 && !(allowLineFeed && code === 0x0a))) return true;
  }
  return false;
}

/** What is wrong with the name as typed, or null. The API applies the same rules. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name.';
  if (trimmed.length > ABSOLUTE.maxNameLength) {
    return `Use at most ${ABSOLUTE.maxNameLength} characters (now ${trimmed.length}).`;
  }
  if (hasControlCharacter(trimmed, false)) return 'Remove the line breaks or tabs from the name.';
  return null;
}

/** What is wrong with the description as typed, or null. An empty description is fine. */
export function descriptionProblem(description: string): string | null {
  const text = descriptionToSave(description);
  if (text === null) return null;
  if (text.length > ABSOLUTE.maxDescriptionLength) {
    return `Use at most ${ABSOLUTE.maxDescriptionLength} characters (now ${text.length}).`;
  }
  if (hasControlCharacter(text, true)) return 'Remove the tabs or other control characters.';
  return null;
}

/**
 * Builds the body of `PUT /api/playlists/:id` (the name, the description, the playback
 * options and the whole item list), or every error to show. Item durations and the item limit are judged by the M0
 * `validateDraft`; the description is always sent, so clearing the field clears it.
 */
export function validateEditorDraft(draft: EditorDraft, limits: DraftLimits): EditorResult {
  const base = validateDraft(draft, limits);
  const name = nameProblem(draft.name);
  const description = descriptionProblem(draft.description);
  if (!base.ok) {
    return { ok: false, errors: { ...base.errors, name: name ?? base.errors.name, description } };
  }
  if (name !== null || description !== null) {
    return { ok: false, errors: { ...NO_EDITOR_ERRORS, name, description } };
  }
  return {
    ok: true,
    value: {
      ...base.value,
      description: descriptionToSave(draft.description),
      transition: draft.transition,
      shuffle: draft.shuffle,
    },
  };
}

export function hasProblems(errors: EditorErrors): boolean {
  return (
    errors.name !== null ||
    errors.description !== null ||
    errors.form !== null ||
    Object.keys(errors.items).length > 0
  );
}

/** "One item has an invalid duration." as M0 says it, or null when every duration is usable. */
export function invalidDurationSummary(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? 'One item has an invalid duration.'
    : `${count} items have an invalid duration.`;
}

/** Where a line of the error summary leads: a field of the form, or one item of the sequence. */
export type ProblemTarget =
  | { readonly kind: 'name' }
  | { readonly kind: 'description' }
  | { readonly kind: 'item'; readonly key: string };

export interface Problem {
  /** Stable for rendering. */
  readonly id: string;
  /** What the problem is about: "Playlist name", "Item 3, sunrise.jpg". */
  readonly label: string;
  readonly message: string;
  /** Null for a problem of the playlist as a whole (too many items). */
  readonly target: ProblemTarget | null;
}

/** The errors as lines for the summary above the form, in the order of the page. */
export function listProblems(draft: EditorDraft, errors: EditorErrors): readonly Problem[] {
  const problems: Problem[] = [];
  if (errors.name !== null) {
    problems.push({
      id: 'name',
      label: 'Playlist name',
      message: errors.name,
      target: { kind: 'name' },
    });
  }
  if (errors.description !== null) {
    problems.push({
      id: 'description',
      label: 'Description',
      message: errors.description,
      target: { kind: 'description' },
    });
  }
  if (errors.form !== null) {
    problems.push({ id: 'form', label: 'Sequence', message: errors.form, target: null });
  }
  draft.items.forEach((item, index) => {
    const message = errors.items[item.key];
    if (message === undefined) return;
    problems.push({
      id: `item:${item.key}`,
      label: `Item ${index + 1}, ${itemName(item)}`,
      message,
      target: { kind: 'item', key: item.key },
    });
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Adding and moving

/**
 * The seconds a new item starts with: an image's own default duration when it has one, else
 * the portal's 10 seconds. A video plays for its own length and has no field.
 */
export function initialDurationText(media: Pick<MediaDto, 'kind' | 'defaultDurationMs'>): string {
  if (media.kind !== 'image') return '';
  return media.defaultDurationMs === null
    ? DEFAULT_IMAGE_SECONDS
    : durationFieldText(media.defaultDurationMs);
}

/** How many more items the playlist can take. */
export function remainingCapacity(draft: PlaylistDraft, limits: DraftLimits): number {
  return Math.max(0, limits.maxPlaylistItems - draft.items.length);
}

/** Said wherever an item cannot be added because the playlist is full. */
export function capacityMessage(limits: DraftLimits): string {
  return `A playlist can hold at most ${countLabel(limits.maxPlaylistItems)}. Remove an item before adding another.`;
}

export type AddResult =
  | { readonly ok: true; readonly draft: EditorDraft; readonly index: number }
  | { readonly ok: false; readonly reason: 'full' | 'not_ready' };

/** What the library offers to add: a ready media item or an app. */
export type LibraryEntry =
  | { readonly kind: 'media'; readonly media: MediaDto }
  | { readonly kind: 'app'; readonly app: AppDto };

export function entryName(entry: LibraryEntry): string {
  return entry.kind === 'app' ? entry.app.name : mediaDisplayName(entry.media);
}

/**
 * Adds a media item or an app to the draft: at the end, or at `slot` (0 puts it first; the
 * number of items puts it last). Only ready media can be added, and never past the item limit.
 */
export function addEntry(
  draft: EditorDraft,
  entry: LibraryEntry,
  key: string,
  limits: DraftLimits,
  slot?: number,
): AddResult {
  if (entry.kind === 'media' && entry.media.status !== 'ready') {
    return { ok: false, reason: 'not_ready' };
  }
  if (remainingCapacity(draft, limits) === 0) return { ok: false, reason: 'full' };
  const end = draft.items.length;
  const appended =
    entry.kind === 'app'
      ? appendApp(draft, entry.app, key)
      : updateItem(appendMedia(draft, entry.media, key), key, {
          durationText: initialDurationText(entry.media),
        });
  const index =
    slot === undefined || !Number.isInteger(slot) ? end : Math.min(end, Math.max(0, slot));
  const moved = moveItem(appended, end, index - end);
  return { ok: true, draft: { ...draft, ...moved }, index };
}

/**
 * Where the item at `fromIndex` lands when it is dropped on `slot`. A slot is a gap between
 * tiles: slot 0 is before the first item and slot n after the last of n.
 */
export function indexAfterSlotMove(fromIndex: number, slot: number): number {
  return slot > fromIndex ? slot - 1 : slot;
}

/** True when dropping on `slot` would leave the item where it is (the gaps on either side of it). */
export function slotKeepsPlace(fromIndex: number, slot: number): boolean {
  return slot === fromIndex || slot === fromIndex + 1;
}

/** Moves the item at `fromIndex` to `slot`. Returns the same draft when nothing would move. */
export function moveItemToSlot(draft: EditorDraft, fromIndex: number, slot: number): EditorDraft {
  if (!Number.isInteger(slot) || slot < 0 || slot > draft.items.length) return draft;
  if (slotKeepsPlace(fromIndex, slot)) return draft;
  const target = indexAfterSlotMove(fromIndex, slot);
  const moved = moveItem(draft, fromIndex, target - fromIndex);
  return moved === draft ? draft : { ...draft, ...moved };
}

// ---------------------------------------------------------------------------
// Geometry of a drag over the filmstrip

/** One tile along the strip's axis, in any one coordinate system. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * The slot a pointer at `x` would drop into: the number of tiles whose middle lies before
 * it. An empty strip has the one slot 0.
 */
export function dropSlotAt(tiles: readonly Span[], x: number): number {
  let slot = 0;
  for (const tile of tiles) {
    if (x > (tile.start + tile.end) / 2) slot += 1;
  }
  return slot;
}

/**
 * How fast the strip should scroll while something is dragged at `x`: nothing in the
 * middle, faster the closer the pointer is to an edge of the visible strip (and at full
 * speed beyond it). Pixels per frame; negative scrolls towards the start.
 */
export function edgeScrollSpeed(
  x: number,
  viewportStart: number,
  viewportEnd: number,
  zone = 72,
  maxSpeed = 18,
): number {
  const width = viewportEnd - viewportStart;
  if (!(width > 0) || !Number.isFinite(x)) return 0;
  const reach = Math.min(zone, width / 3);
  const fromStart = x - viewportStart;
  const fromEnd = viewportEnd - x;
  if (fromStart < reach) {
    return -Math.ceil(maxSpeed * Math.min(1, (reach - fromStart) / reach));
  }
  if (fromEnd < reach) {
    return Math.ceil(maxSpeed * Math.min(1, (reach - fromEnd) / reach));
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Words of the sequence

export interface FitChoice {
  /** Null is "use the screen's own default fit when pushing". */
  readonly value: FitMode | null;
  readonly label: string;
  /** What the choice does, in a few words. */
  readonly hint: string;
}

export const FIT_CHOICES: readonly FitChoice[] = [
  { value: null, label: 'Screen default', hint: 'Each screen uses its own setting' },
  { value: 'contain', label: 'Contain', hint: 'Whole picture, bars where needed' },
  { value: 'cover', label: 'Cover', hint: 'Fills the frame, edges may be cut' },
];

export function fitLabel(fit: FitMode | null): string {
  return FIT_CHOICES.find((choice) => choice.value === fit)?.label ?? 'Screen default';
}

/** "3 items". */
export function sequenceCountLabel(draft: PlaylistDraft): string {
  return countLabel(draft.items.length);
}

/**
 * "Loop length 0:45": one pass through the sequence. When a duration is missing or
 * unusable the length cannot be told, and the label says so instead of guessing.
 */
export function loopLengthLabel(draft: PlaylistDraft, limits: DraftLimits): string {
  const loopMs = draftLoopMs(draft, limits);
  const clock = loopMs === null ? null : formatClock(loopMs);
  return clock === null ? 'Loop length not known' : `Loop length ${clock}`;
}

/** The fixed length of a video item: "0:12", or "Not known" while the file has none. */
export function videoLengthLabel(media: Pick<MediaDto, 'durationMs'>): string {
  const clock = media.durationMs === null ? null : formatClock(media.durationMs);
  return clock ?? 'Not known';
}

function secondsText(ms: number): string {
  return String(ms / 1000);
}

/** One sentence on how long items show, with the configured limits. */
export function durationRuleText(
  limits: Pick<Limits, 'minImageItemDurationMs' | 'maxImageItemDurationMs'>,
): string {
  return `Images stay on screen for ${secondsText(limits.minImageItemDurationMs)} to ${secondsText(
    limits.maxImageItemDurationMs,
  )} seconds each, and so do apps. Videos play muted for their own length.`;
}

/** Bounds of the seconds stepper, in whole seconds inside the configured limits. */
export function durationStepperBounds(
  limits: Pick<Limits, 'minImageItemDurationMs' | 'maxImageItemDurationMs'>,
): { readonly min: number; readonly max: number } {
  const min = Math.max(1, Math.ceil(limits.minImageItemDurationMs / 1000));
  const max = Math.max(min, Math.floor(limits.maxImageItemDurationMs / 1000));
  return { min, max };
}

/** Why an item whose file is not ready is a problem, or null for a ready file. */
export function itemNotReadyMessage(media: Pick<MediaDto, 'status'>): string | null {
  if (media.status === 'ready') return null;
  return 'This file is not ready, so the playlist cannot be pushed with it.';
}

/** The item as the library holds it now, where the library has been loaded since. */
export function withCurrentMedia(
  item: DraftItem,
  mediaById: ReadonlyMap<string, MediaDto>,
): DraftItem {
  if (item.source === 'app') return item;
  const current = mediaById.get(item.media.id);
  return current === undefined || current === item.media ? item : { ...item, media: current };
}

// Announcements for the live region. Each names the item and where it now is.

export function addedAnnouncement(name: string, position: number): string {
  return `Added ${name} at position ${position}.`;
}

export function movedAnnouncement(name: string, position: number, count: number): string {
  return `Moved ${name} to position ${position} of ${count}.`;
}

export function removedAnnouncement(name: string, position: number): string {
  return `Removed ${name} from position ${position}.`;
}

export function keptAnnouncement(name: string, position: number): string {
  return `${name} stays at position ${position}.`;
}

// ---------------------------------------------------------------------------
// The library

export type KindFilter = 'all' | MediaKind | 'app';

/** Folder filter values that are not folder ids. */
export const ALL_FOLDERS = 'all';
export const ROOT_FOLDER = 'root';

export interface LibraryFilters {
  readonly query: string;
  readonly kind: KindFilter;
  /** `ALL_FOLDERS`, `ROOT_FOLDER` (media in no folder) or a folder id. */
  readonly folder: string;
  /** Tag ids; a file passes when it carries any of them. */
  readonly tags: ReadonlySet<string>;
}

export const NO_LIBRARY_FILTERS: LibraryFilters = {
  query: '',
  kind: 'all',
  folder: ALL_FOLDERS,
  tags: new Set(),
};

export function libraryFiltersActive(filters: LibraryFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.kind !== 'all' ||
    filters.folder !== ALL_FOLDERS ||
    filters.tags.size > 0
  );
}

/** Only ready media can go into a playlist. */
export function readyMedia(items: readonly MediaDto[]): MediaDto[] {
  return items.filter((item) => item.status === 'ready');
}

/** The ready media that pass the search and every filter, in the order given. */
export function filterLibrary(
  items: readonly MediaDto[],
  filters: LibraryFilters,
): readonly MediaDto[] {
  return items.filter((item) => {
    if (item.status !== 'ready') return false;
    if (filters.kind !== 'all' && item.kind !== filters.kind) return false;
    if (filters.folder === ROOT_FOLDER && item.folderId !== null) return false;
    if (
      filters.folder !== ALL_FOLDERS &&
      filters.folder !== ROOT_FOLDER &&
      item.folderId !== filters.folder
    ) {
      return false;
    }
    if (!matchesTagFilter(item.tagIds, filters.tags)) return false;
    return matchesSearch(
      [mediaDisplayName(item), item.originalName, item.description],
      filters.query,
    );
  });
}

/** True when the folder or tag filter is on: apps have neither, so none is listed then. */
export function mediaOnlyFilters(filters: LibraryFilters): boolean {
  return filters.folder !== ALL_FOLDERS || filters.tags.size > 0;
}

/**
 * The apps that pass the search and filters, in the order given. "All" lists them only when
 * no folder or tag filter is on; "Apps" ignores those filters (the page disables them).
 */
export function filterApps(apps: readonly AppDto[], filters: LibraryFilters): readonly AppDto[] {
  if (filters.kind === 'image' || filters.kind === 'video') return [];
  if (filters.kind === 'all' && mediaOnlyFilters(filters)) return [];
  return apps.filter((app) => matchesSearch([app.name], filters.query));
}

/** The line under an app card's name: its type. */
export function appMetaLabel(app: Pick<AppDto, 'content'>): string {
  return APP_TYPE_LABELS[app.content.type];
}

/** "12 files", or "4 of 12 files" while a search or filter is on; "items" once apps are listed too. */
export function libraryCountLabel(
  shown: number,
  total: number,
  filtered: boolean,
  noun: 'file' | 'item' = 'file',
): string {
  if (!filtered || shown === total) return countLabel(total, noun);
  return `${shown} of ${countLabel(total, noun)}`;
}

/** The line under a library card's name: "Image · 1920 × 1080 px", "Video · 1280 × 720 px · 0:12". */
export function libraryMetaLabel(
  media: Pick<MediaDto, 'kind' | 'width' | 'height' | 'durationMs'>,
): string {
  const details = mediaDetailsLabel(media);
  return details === null
    ? mediaKindLabel(media.kind)
    : `${mediaKindLabel(media.kind)} · ${details}`;
}

/** How often each media item or app already sits in the draft, by its id. */
export function usageInDraft(draft: PlaylistDraft): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const item of draft.items) {
    const id = itemRefId(item);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** "In this playlist" or "In this playlist 3 times", or null when the file is not in it. */
export function usageLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? 'In this playlist' : `In this playlist ${count} times`;
}

/** The note under the library about files that cannot be added yet, or null when all are ready. */
export function notReadyNote(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? 'file is' : 'files are'} still processing or failed and cannot be added.`;
}

// ---------------------------------------------------------------------------
// The push card

function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The screens that have this playlist assigned directly, in the order of the push plan. The
 * row of a screen with a schedule or a layout carries the default or main zone playlist as
 * its playlist; such a screen is not one of this playlist's, so it is left out.
 */
export function rowsForPlaylist(
  plan: PushPlanResponse | null,
  playlistId: string,
): readonly PushPlanRow[] {
  if (plan === null) return [];
  return plan.items.filter((row) => {
    const content = planRowContent(row);
    return content?.kind === 'playlist' && sameId(content.id, playlistId);
  });
}

/** How many of the rows a push would act on (changes waiting, or never pushed). */
export function waitingCount(rows: readonly PushPlanRow[]): number {
  return rows.filter((row) => isPushPending(row.state)).length;
}

function screens(count: number): string {
  return countLabel(count, 'screen');
}

/** One sentence under the card's title: how many screens play this playlist and what is waiting. */
export function pushSummary(rows: readonly PushPlanRow[]): string {
  if (rows.length === 0) return 'No screen has this playlist assigned directly.';
  const waiting = waitingCount(rows);
  const blocked = rows.filter((row) => row.state === 'blocked').length;
  const has = rows.length === 1 ? '1 screen has' : `${rows.length} screens have`;
  const parts = [`${has} this playlist assigned.`];
  if (waiting > 0) {
    parts.push(
      waiting === rows.length && blocked === 0
        ? rows.length === 1
          ? 'It has changes waiting.'
          : 'All have changes waiting.'
        : `${waiting} ${waiting === 1 ? 'has' : 'have'} changes waiting.`,
    );
  }
  if (blocked > 0) parts.push(`${blocked} ${blocked === 1 ? 'is' : 'are'} blocked.`);
  if (waiting === 0 && blocked === 0) {
    parts.push(rows.length === 1 ? 'It is up to date.' : 'All are up to date.');
  }
  return parts.join(' ');
}

/**
 * Why "Push now" does nothing at the moment, or null when it can be pressed. Unsaved
 * changes come first: only the saved playlist can be pushed.
 */
export function pushHoldReason(dirty: boolean, rows: readonly PushPlanRow[]): string | null {
  if (dirty) return 'Save the draft first. Only the saved playlist can be pushed.';
  if (rows.length === 0) {
    return 'No screen has this playlist assigned directly. Screens that play it through a schedule or a layout are pushed with Push to screens.';
  }
  return null;
}

/** The toast after assigning: "Playlist assigned to Foyer wall", "Playlist assigned to 3 screens". */
export function assignedMessage(screenNames: readonly string[]): string {
  const [only] = screenNames;
  if (screenNames.length === 1 && only !== undefined) return `Playlist assigned to ${only}`;
  return `Playlist assigned to ${screens(screenNames.length)}`;
}

/** The label of the confirm button in the screen picker. */
export function assignConfirmLabel(count: number): string {
  return count === 0 ? 'Assign to screens' : `Assign to ${screens(count)}`;
}
