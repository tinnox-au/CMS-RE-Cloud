import {
  PlaylistReplaceSchema,
  type AppDto,
  type FitMode,
  type Limits,
  type MediaDto,
  type PlaylistDto,
  type PlaylistItemInput,
  type PlaylistReplace,
} from '@tinnox/contracts';
import { durationFieldText, parseImageDuration } from './duration.ts';
import { mediaDisplayName } from './mediaName.ts';

export interface DraftMediaItem {
  readonly source: 'media';
  /** Stable key for rendering; not sent to the API. */
  readonly key: string;
  readonly media: MediaDto;
  /** Seconds as typed. Ignored for video, which always plays its natural duration. */
  readonly durationText: string;
  /** Null means "use the display's default fit when publishing". */
  readonly fit: FitMode | null;
}

/** A built-in app: shown for its duration (the image rule), never fitted. */
export interface DraftAppItem {
  readonly source: 'app';
  readonly key: string;
  readonly app: AppDto;
  readonly durationText: string;
}

export type DraftItem = DraftMediaItem | DraftAppItem;

/** The id of the media item or app an item shows. */
export function itemRefId(item: DraftItem): string {
  return item.source === 'app' ? item.app.id : item.media.id;
}

export function itemName(item: DraftItem): string {
  return item.source === 'app' ? item.app.name : mediaDisplayName(item.media);
}

export interface PlaylistDraft {
  readonly name: string;
  readonly items: readonly DraftItem[];
}

export const DEFAULT_IMAGE_SECONDS = '10';

export function draftFromPlaylist(playlist: PlaylistDto): PlaylistDraft {
  const ordered = [...playlist.items].sort((a, b) => a.position - b.position);
  return {
    name: playlist.name,
    items: ordered.map((item): DraftItem =>
      'appId' in item
        ? {
            source: 'app',
            key: item.id,
            app: item.app,
            durationText: durationFieldText(item.durationMs),
          }
        : {
            source: 'media',
            key: item.id,
            media: item.media,
            durationText:
              item.media.kind === 'image' && item.durationMs !== null
                ? durationFieldText(item.durationMs)
                : item.media.kind === 'image'
                  ? DEFAULT_IMAGE_SECONDS
                  : '',
            fit: item.fit,
          },
    ),
  };
}

export function appendMedia(draft: PlaylistDraft, media: MediaDto, key: string): PlaylistDraft {
  const item: DraftItem = {
    source: 'media',
    key,
    media,
    durationText: media.kind === 'image' ? DEFAULT_IMAGE_SECONDS : '',
    fit: null,
  };
  return { ...draft, items: [...draft.items, item] };
}

export function appendApp(draft: PlaylistDraft, app: AppDto, key: string): PlaylistDraft {
  const item: DraftItem = { source: 'app', key, app, durationText: DEFAULT_IMAGE_SECONDS };
  return { ...draft, items: [...draft.items, item] };
}

/** Moves the item at `index` by `delta` places. Returns the same draft when the move is impossible. */
export function moveItem(draft: PlaylistDraft, index: number, delta: number): PlaylistDraft {
  const target = index + delta;
  if (!Number.isInteger(index) || !Number.isInteger(target)) return draft;
  if (index < 0 || index >= draft.items.length || target < 0 || target >= draft.items.length) {
    return draft;
  }
  const items = [...draft.items];
  const [moved] = items.splice(index, 1);
  if (moved === undefined) return draft;
  items.splice(target, 0, moved);
  return { ...draft, items };
}

export function removeItem(draft: PlaylistDraft, key: string): PlaylistDraft {
  return { ...draft, items: draft.items.filter((item) => item.key !== key) };
}

/** A change to one item; an app has no fit, so `fit` is ignored for it. */
export interface ItemChange {
  readonly durationText?: string;
  readonly fit?: FitMode | null;
}

export function updateItem(draft: PlaylistDraft, key: string, change: ItemChange): PlaylistDraft {
  return {
    ...draft,
    items: draft.items.map((item): DraftItem => {
      if (item.key !== key) return item;
      if (item.source === 'app') {
        return change.durationText === undefined
          ? item
          : { ...item, durationText: change.durationText };
      }
      return {
        ...item,
        durationText: change.durationText ?? item.durationText,
        fit: change.fit === undefined ? item.fit : change.fit,
      };
    }),
  };
}

/** Compares what would be saved, so retyping "10" as "10.0" or re-adding an item still counts. */
export function draftSignature(draft: PlaylistDraft): string {
  return JSON.stringify([
    draft.name.trim(),
    draft.items.map((item) =>
      item.source === 'app'
        ? ['app', item.app.id, item.durationText.trim()]
        : [item.media.id, item.media.kind === 'image' ? item.durationText.trim() : null, item.fit],
    ),
  ]);
}

export function isDirty(draft: PlaylistDraft, saved: PlaylistDto): boolean {
  return draftSignature(draft) !== draftSignature(draftFromPlaylist(saved));
}

export interface DraftErrors {
  readonly name: string | null;
  readonly form: string | null;
  readonly items: Readonly<Record<string, string>>;
}

export type DraftResult =
  | { readonly ok: true; readonly value: PlaylistReplace }
  | { readonly ok: false; readonly errors: DraftErrors };

type DraftLimits = Pick<
  Limits,
  'minImageItemDurationMs' | 'maxImageItemDurationMs' | 'maxPlaylistItems'
>;

/** Builds the full-list replacement body for `PUT /api/playlists/:id`, or the errors to show. */
export function validateDraft(draft: PlaylistDraft, limits: DraftLimits): DraftResult {
  let name: string | null = null;
  let form: string | null = null;
  const itemErrors: Record<string, string> = {};
  const items: PlaylistItemInput[] = [];

  if (draft.name.trim() === '') name = 'Enter a name.';
  if (draft.items.length > limits.maxPlaylistItems) {
    form = `A playlist can hold at most ${limits.maxPlaylistItems} items.`;
  }
  for (const item of draft.items) {
    if (item.source === 'media' && item.media.kind === 'video') {
      items.push({ mediaId: item.media.id, durationMs: null, fit: item.fit });
      continue;
    }
    const duration = parseImageDuration(item.durationText, limits);
    if (!duration.ok) {
      itemErrors[item.key] = duration.message;
      continue;
    }
    items.push(
      item.source === 'app'
        ? { appId: item.app.id, durationMs: duration.ms }
        : { mediaId: item.media.id, durationMs: duration.ms, fit: item.fit },
    );
  }
  if (name !== null || form !== null || Object.keys(itemErrors).length > 0) {
    return { ok: false, errors: { name, form, items: itemErrors } };
  }

  const parsed = PlaylistReplaceSchema.safeParse({ name: draft.name, items });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'name') name ??= issue.message;
      else form ??= issue.message;
    }
    return { ok: false, errors: { name, form, items: itemErrors } };
  }
  return { ok: true, value: parsed.data };
}

/** Total time of one pass through the draft, or null when a duration is missing or invalid. */
export function draftLoopMs(draft: PlaylistDraft, limits: DraftLimits): number | null {
  let total = 0;
  for (const item of draft.items) {
    if (item.source === 'media' && item.media.kind === 'video') {
      if (item.media.durationMs === null) return null;
      total += item.media.durationMs;
    } else {
      const duration = parseImageDuration(item.durationText, limits);
      if (!duration.ok) return null;
      total += duration.ms;
    }
  }
  return total;
}
