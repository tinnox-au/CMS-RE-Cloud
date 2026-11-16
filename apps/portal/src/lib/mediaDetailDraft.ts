import {
  ABSOLUTE,
  LocalDateTimeSchema,
  MediaPatchSchema,
  PlaylistReplaceSchema,
  type ApiErrorDetail,
  type Limits,
  type MediaDto,
  type MediaPatch,
  type PlaylistDto,
  type PlaylistItemInput,
  type PlaylistReplace,
} from '@tinnox/contracts';
import { durationFieldText, parseImageDuration } from './duration.ts';
import { DEFAULT_IMAGE_SECONDS } from './playlistDraft.ts';

/**
 * The form of the media details page as pure logic: the draft an operator edits, what
 * differs from the saved item, the `PATCH /api/media/:id` body for exactly those
 * differences, and the checks that mirror `MediaPatchSchema`. The API stays the authority;
 * these checks only spare a round trip. No DOM.
 */

/** What the form holds, as typed. Nothing here has been sent. */
export interface MediaDetailDraft {
  readonly name: string;
  readonly description: string;
  /** Seconds as typed. Empty means "no default of its own". Ignored for a video. */
  readonly durationText: string;
  /** Null is the root of the library. */
  readonly folderId: string | null;
  readonly tagIds: readonly string[];
  /** The availability window as `datetime-local` gives it, 'YYYY-MM-DDTHH:mm'; empty is no limit. */
  readonly availableFrom: string;
  readonly availableUntil: string;
}

/** The fields of the form, named as `MediaPatchSchema` names them. */
export const MEDIA_DETAIL_FIELDS = [
  'name',
  'description',
  'defaultDurationMs',
  'availableFrom',
  'availableUntil',
  'folderId',
  'tagIds',
] as const;
export type MediaDetailField = (typeof MEDIA_DETAIL_FIELDS)[number];

/** What an operator reads for each field, in the order of the form. */
export const MEDIA_DETAIL_FIELD_LABELS: { readonly [K in MediaDetailField]: string } = {
  name: 'Name',
  description: 'Description',
  defaultDurationMs: 'Default duration',
  availableFrom: 'Available from',
  availableUntil: 'Available until',
  folderId: 'Folder',
  tagIds: 'Tags',
};

/** One message per field that has a problem; `form` is a problem that belongs to no field. */
export type MediaDetailErrors = { readonly [K in MediaDetailField | 'form']?: string };

export const NO_MEDIA_DETAIL_ERRORS: MediaDetailErrors = Object.freeze({});

type DurationLimits = Pick<Limits, 'minImageItemDurationMs' | 'maxImageItemDurationMs'>;

/** The seconds a playlist proposes for an image that has no default of its own. */
export const STANDARD_IMAGE_DURATION_MS = Number(DEFAULT_IMAGE_SECONDS) * 1000;

function storedDurationText(media: Pick<MediaDto, 'kind' | 'defaultDurationMs'>): string {
  return media.kind === 'image' && media.defaultDurationMs !== null
    ? durationFieldText(media.defaultDurationMs)
    : '';
}

export function draftFromMedia(media: MediaDto): MediaDetailDraft {
  return {
    name: media.name,
    description: media.description ?? '',
    durationText: storedDurationText(media),
    folderId: media.folderId,
    tagIds: media.tagIds,
    availableFrom: media.availableFrom ?? '',
    availableUntil: media.availableUntil ?? '',
  };
}

/**
 * Stands in for a `datetime-local` that is only partly filled. Such a field reports '' like
 * an empty one; without this value a half-typed date would be saved as "no limit".
 */
export const INCOMPLETE_DATE_TIME = 'incomplete';

function windowValue(text: string): string | null {
  return text === '' ? null : text;
}

function windowChanged(draft: MediaDetailDraft, media: MediaDto): boolean {
  return (
    windowValue(draft.availableFrom) !== media.availableFrom ||
    windowValue(draft.availableUntil) !== media.availableUntil
  );
}

/** The message when the window ends before it starts. */
export const WINDOW_ORDER_MESSAGE = 'Must be after Available from.';

type Change<T> = { readonly changed: false } | { readonly changed: true; readonly value: T };

const UNCHANGED = { changed: false } as const;

/**
 * An emptied name goes back to the file name (the API takes null for that). It is a change
 * only when the item carries a name of its own now.
 */
function nameChange(draft: MediaDetailDraft, media: MediaDto): Change<string | null> {
  if (draft.name === media.name) return UNCHANGED;
  const typed = draft.name.trim();
  if (typed === '') {
    return media.name === media.originalName ? UNCHANGED : { changed: true, value: null };
  }
  return typed === media.name.trim() ? UNCHANGED : { changed: true, value: typed };
}

function descriptionChange(draft: MediaDetailDraft, media: MediaDto): Change<string | null> {
  const typed = draft.description.trim();
  if (typed === (media.description ?? '').trim()) return UNCHANGED;
  return { changed: true, value: typed === '' ? null : typed };
}

type DurationChange = Change<number | null> | { readonly changed: true; readonly problem: string };

/** Compares what would be stored, so "10" retyped as "10.0" is not a change. */
function durationChange(
  draft: MediaDetailDraft,
  media: MediaDto,
  limits: DurationLimits,
): DurationChange {
  if (media.kind !== 'image') return UNCHANGED;
  const typed = draft.durationText.trim();
  if (typed === storedDurationText(media)) return UNCHANGED;
  if (typed === '') {
    return media.defaultDurationMs === null ? UNCHANGED : { changed: true, value: null };
  }
  const parsed = parseImageDuration(typed, limits);
  if (!parsed.ok) return { changed: true, problem: parsed.message };
  return parsed.ms === media.defaultDurationMs ? UNCHANGED : { changed: true, value: parsed.ms };
}

/** The ids once each, in the order given. Ids are compared without regard to letter case. */
function distinctIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(id);
  }
  return result;
}

function tagsChange(draft: MediaDetailDraft, media: MediaDto): Change<string[]> {
  const next = distinctIds(draft.tagIds);
  const current = new Set(media.tagIds.map((id) => id.toLowerCase()));
  const same = next.length === current.size && next.every((id) => current.has(id.toLowerCase()));
  return same ? UNCHANGED : { changed: true, value: next };
}

/** The fields whose value would differ after a save, in the order of the form. */
export function changedFields(
  draft: MediaDetailDraft,
  media: MediaDto,
  limits: DurationLimits,
): readonly MediaDetailField[] {
  const changed: MediaDetailField[] = [];
  if (nameChange(draft, media).changed) changed.push('name');
  if (descriptionChange(draft, media).changed) changed.push('description');
  if (durationChange(draft, media, limits).changed) changed.push('defaultDurationMs');
  if (windowValue(draft.availableFrom) !== media.availableFrom) changed.push('availableFrom');
  if (windowValue(draft.availableUntil) !== media.availableUntil) changed.push('availableUntil');
  if (draft.folderId !== media.folderId) changed.push('folderId');
  if (tagsChange(draft, media).changed) changed.push('tagIds');
  return changed;
}

/** True when saving would send something. Typing a value and typing it back is not dirty. */
export function isDraftDirty(
  draft: MediaDetailDraft,
  media: MediaDto,
  limits: DurationLimits,
): boolean {
  return changedFields(draft, media, limits).length > 0;
}

export type MediaDetailResult =
  | {
      readonly ok: true;
      /** The body to send, holding only what changed; null when nothing changed. */
      readonly patch: MediaPatch | null;
      readonly changed: readonly MediaDetailField[];
    }
  | { readonly ok: false; readonly errors: MediaDetailErrors };

function isField(value: unknown): value is MediaDetailField {
  return MEDIA_DETAIL_FIELDS.some((field) => field === value);
}

const TOO_LONG: { readonly [K in 'name' | 'description']: (length: number) => string } = {
  name: (length) => `Use at most ${ABSOLUTE.maxNameLength} characters. This name has ${length}.`,
  description: (length) =>
    `Use at most ${ABSOLUTE.maxDescriptionLength} characters. This description has ${length}.`,
};

const BAD_CHARACTERS: { readonly [K in 'name' | 'description']: string } = {
  name: 'Remove the control characters from the name, for example a tab.',
  description:
    'Remove the control characters from the description, for example a tab. Line breaks are fine.',
};

/** Our wording for one issue the shared schema raised about a field. */
function schemaMessage(
  field: MediaDetailField,
  issue: { readonly code?: string; readonly message: string },
  patch: Record<string, unknown>,
): string {
  if (field === 'name' || field === 'description') {
    const value = patch[field];
    if (issue.code === 'too_big' && typeof value === 'string') {
      return TOO_LONG[field](value.length);
    }
    if (issue.code === 'invalid_format') return BAD_CHARACTERS[field];
  }
  // Both sides are always sent and their order is checked first, so this is the format.
  if (field === 'availableFrom' || field === 'availableUntil') {
    return 'Enter a full date and time, year 1000 or later.';
  }
  if (field === 'tagIds' && issue.code === 'too_big') {
    return `One item carries at most ${ABSOLUTE.maxTagsPerItem} tags. Remove some.`;
  }
  return issue.message;
}

/**
 * Checks the draft and builds the body for `PATCH /api/media/:id` from the fields that
 * changed. A field the operator did not touch is neither sent nor checked, so an old value
 * the form merely shows (a long file name standing in for the name) cannot block a save.
 */
export function validateMediaDraft(
  draft: MediaDetailDraft,
  media: MediaDto,
  limits: DurationLimits,
): MediaDetailResult {
  const errors: { -readonly [K in keyof MediaDetailErrors]: string } = {};
  const patch: Record<string, unknown> = {};

  const name = nameChange(draft, media);
  if (name.changed) patch['name'] = name.value;

  const description = descriptionChange(draft, media);
  if (description.changed) patch['description'] = description.value;

  const duration = durationChange(draft, media, limits);
  if (duration.changed) {
    if ('problem' in duration) errors.defaultDurationMs = duration.problem;
    else patch['defaultDurationMs'] = duration.value;
  }

  // The API takes the two sides of the window together only.
  if (windowChanged(draft, media)) {
    const from = windowValue(draft.availableFrom);
    const until = windowValue(draft.availableUntil);
    patch['availableFrom'] = from;
    patch['availableUntil'] = until;
    // An incomplete side gets the format message from the schema, not the order message.
    if (
      from !== null &&
      until !== null &&
      from !== INCOMPLETE_DATE_TIME &&
      until !== INCOMPLETE_DATE_TIME &&
      from >= until
    ) {
      errors.availableUntil = WINDOW_ORDER_MESSAGE;
    }
  }

  if (draft.folderId !== media.folderId) patch['folderId'] = draft.folderId;

  const tags = tagsChange(draft, media);
  if (tags.changed) patch['tagIds'] = tags.value;

  const changed = changedFields(draft, media, limits);
  if (changed.length === 0) return { ok: true, patch: null, changed };

  if (Object.keys(patch).length > 0) {
    const parsed = MediaPatchSchema.safeParse(patch);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        // The order was checked above; the schema's order issue on a well-formed side only
        // repeats that the other side is malformed, and that side carries the message.
        if (
          (field === 'availableFrom' || field === 'availableUntil') &&
          LocalDateTimeSchema.safeParse(patch[field]).success
        ) {
          continue;
        }
        if (isField(field)) errors[field] ??= schemaMessage(field, issue, patch);
        else errors.form ??= issue.message;
      }
    } else if (Object.keys(errors).length === 0) {
      return { ok: true, patch: parsed.data, changed };
    }
  }
  return { ok: false, errors };
}

/** The fields with a problem, in the order of the form, for the summary above it. */
export function errorFields(errors: MediaDetailErrors): readonly MediaDetailField[] {
  return MEDIA_DETAIL_FIELDS.filter((field) => errors[field] !== undefined);
}

export function hasErrors(errors: MediaDetailErrors): boolean {
  return errors.form !== undefined || errorFields(errors).length > 0;
}

/** Drops the message of one field, when the operator changes that field again. */
export function withoutError(
  errors: MediaDetailErrors,
  field: MediaDetailField,
): MediaDetailErrors {
  if (errors[field] === undefined) return errors;
  const rest: { -readonly [K in keyof MediaDetailErrors]: string } = { ...errors };
  delete rest[field];
  return rest;
}

/**
 * The fields a refusal by the API names (`details[].path` of a 400 `validation_failed`),
 * with the server's own words, so the message also shows at the field. Paths that are not a
 * field of this form are left to the error notice, which lists every detail.
 */
export function fieldErrorsFromApi(details: readonly ApiErrorDetail[]): MediaDetailErrors {
  const errors: { -readonly [K in keyof MediaDetailErrors]: string } = {};
  for (const detail of details) {
    const field = detail.path.split(/[.[]/, 1)[0];
    if (!isField(field)) continue;
    const message = detail.message.trim();
    errors[field] ??=
      message === ''
        ? 'The server refused this value.'
        : `The server refused this value: ${message}`;
  }
  return errors;
}

/** "1 to 3600": the range of whole seconds the default duration stepper offers. */
export interface DurationBounds {
  readonly min: number;
  readonly max: number;
}

/** The configured image duration limits as whole seconds for the stepper. */
export function durationBoundsSeconds(limits: DurationLimits): DurationBounds {
  const min = Math.max(1, Math.ceil(limits.minImageItemDurationMs / 1000));
  const max = Math.max(min, Math.floor(limits.maxImageItemDurationMs / 1000));
  return { min, max };
}

export type PlaylistAppendResult =
  | { readonly ok: true; readonly body: PlaylistReplace }
  | { readonly ok: false; readonly message: string };

/**
 * The body for `PUT /api/playlists/:id` that keeps the playlist as it is and adds the media
 * item at the end. The API has no append call, so the whole list is sent again: existing
 * items keep their duration and fit, the name stays, and the description is left out so the
 * stored one is kept. An image is added with its own default duration, or else 10 seconds;
 * a video always plays for its own length.
 */
export function appendToPlaylistBody(
  playlist: PlaylistDto,
  media: Pick<MediaDto, 'id' | 'kind' | 'status' | 'defaultDurationMs'>,
  limits: Pick<Limits, 'maxPlaylistItems'>,
): PlaylistAppendResult {
  if (media.status !== 'ready') {
    return { ok: false, message: 'Only a file that is ready can be added to a playlist.' };
  }
  if (playlist.items.length >= limits.maxPlaylistItems) {
    return {
      ok: false,
      message: `This playlist already holds ${playlist.items.length} items. A playlist can hold at most ${limits.maxPlaylistItems}.`,
    };
  }
  const ordered = [...playlist.items].sort((a, b) => a.position - b.position);
  const items: PlaylistItemInput[] = ordered.map((item) =>
    'appId' in item
      ? { appId: item.appId, durationMs: item.durationMs }
      : {
          mediaId: item.mediaId,
          durationMs:
            item.media.kind === 'image' ? (item.durationMs ?? STANDARD_IMAGE_DURATION_MS) : null,
          fit: item.fit,
        },
  );
  items.push({
    mediaId: media.id,
    durationMs:
      media.kind === 'image' ? (media.defaultDurationMs ?? STANDARD_IMAGE_DURATION_MS) : null,
    fit: null,
  });
  const parsed = PlaylistReplaceSchema.safeParse({ name: playlist.name, items });
  if (!parsed.success) {
    return {
      ok: false,
      message: `The playlist could not be prepared for saving: ${parsed.error.issues[0]?.message ?? 'unknown problem'}.`,
    };
  }
  return { ok: true, body: parsed.data };
}
