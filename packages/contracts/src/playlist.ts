import { z } from 'zod';
import { AppDtoSchema } from './app.ts';
import { FitModeSchema } from './canvas.ts';
import {
  AppIdSchema,
  DisplayIdSchema,
  MediaIdSchema,
  PlaylistIdSchema,
  PlaylistItemIdSchema,
  PublicationIdSchema,
  UtcTimestampSchema,
} from './ids.ts';
import { ABSOLUTE } from './limits.ts';
import { ManifestSchema, TransitionSchema } from './manifest.ts';
import { MediaDtoSchema } from './media.ts';
import { DescriptionInputSchema, DescriptionSchema, NameSchema } from './text.ts';

/**
 * A media entry of a one-level playlist.
 * - `durationMs`: required for images; must be null for video (natural duration is used).
 * - `fit`: null means "use the display's default fit at publish time".
 * The kind-dependent rules are enforced by `validatePlaylist` in @tinnox/domain,
 * which has the media records; this schema only bounds the values.
 */
export const PlaylistMediaItemInputSchema = z
  .object({
    mediaId: MediaIdSchema,
    durationMs: z.number().int().positive().max(ABSOLUTE.maxItemDurationMs).nullable(),
    fit: FitModeSchema.nullable(),
  })
  .strict();
export type PlaylistMediaItemInput = z.infer<typeof PlaylistMediaItemInputSchema>;

/** An app entry: always a time on screen, never a fit. `validatePlaylist` checks the range. */
export const PlaylistAppItemInputSchema = z
  .object({
    appId: AppIdSchema,
    durationMs: z.number().int().positive().max(ABSOLUTE.maxItemDurationMs),
  })
  .strict();
export type PlaylistAppItemInput = z.infer<typeof PlaylistAppItemInputSchema>;

/** One entry of a one-level playlist: a media item or an app. */
export const PlaylistItemInputSchema = z.union([
  PlaylistMediaItemInputSchema,
  PlaylistAppItemInputSchema,
]);
export type PlaylistItemInput = z.infer<typeof PlaylistItemInputSchema>;

export const PlaylistMediaItemDtoSchema = z
  .object({
    id: PlaylistItemIdSchema,
    position: z.number().int().nonnegative(),
    mediaId: MediaIdSchema,
    durationMs: z.number().int().positive().nullable(),
    fit: FitModeSchema.nullable(),
    /** Current media record, so the editor can show status and thumbnails. */
    media: MediaDtoSchema,
  })
  .strict();
export type PlaylistMediaItemDto = z.infer<typeof PlaylistMediaItemDtoSchema>;

export const PlaylistAppItemDtoSchema = z
  .object({
    id: PlaylistItemIdSchema,
    position: z.number().int().nonnegative(),
    appId: AppIdSchema,
    durationMs: z.number().int().positive(),
    /** Current app record. */
    app: AppDtoSchema,
  })
  .strict();
export type PlaylistAppItemDto = z.infer<typeof PlaylistAppItemDtoSchema>;

export const PlaylistItemDtoSchema = z.union([
  PlaylistMediaItemDtoSchema,
  PlaylistAppItemDtoSchema,
]);
export type PlaylistItemDto = z.infer<typeof PlaylistItemDtoSchema>;

/** What a playlist can hold: the media kinds, then apps. */
export const PLAYLIST_ITEM_KINDS = ['image', 'video', 'app'] as const;
export const PlaylistItemKindSchema = z.enum(PLAYLIST_ITEM_KINDS);
export type PlaylistItemKind = z.infer<typeof PlaylistItemKindSchema>;

/** How many media ids a playlist summary carries for its thumbnail mosaic. */
export const PLAYLIST_PREVIEW_COUNT = 4;

/** One row of `GET /api/playlists`. Deleted playlists are never listed. */
export const PlaylistSummaryDtoSchema = z
  .object({
    id: PlaylistIdSchema,
    name: z.string(),
    description: DescriptionSchema.nullable(),
    itemCount: z.number().int().nonnegative(),
    /**
     * Length of one loop: each image's and app's time on screen plus each video's
     * natural length. An item with no length yet (an image without a duration, a video
     * still being checked) counts as zero.
     */
    totalDurationMs: z
      .number()
      .int()
      .nonnegative()
      .max(ABSOLUTE.maxPlaylistItems * ABSOLUTE.maxItemDurationMs),
    /** The item kinds present, each once, in the order of `PLAYLIST_ITEM_KINDS`. */
    kinds: z.array(PlaylistItemKindSchema).max(PLAYLIST_ITEM_KINDS.length),
    /** The first distinct media ids in play order, for the thumbnail mosaic. */
    previewMediaIds: z.array(MediaIdSchema).max(PLAYLIST_PREVIEW_COUNT),
    /** How many displays have this playlist assigned. */
    assignedDisplayCount: z.number().int().nonnegative(),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type PlaylistSummaryDto = z.infer<typeof PlaylistSummaryDtoSchema>;

export const PlaylistDtoSchema = z
  .object({
    id: PlaylistIdSchema,
    name: z.string(),
    description: DescriptionSchema.nullable(),
    items: z.array(PlaylistItemDtoSchema),
    transition: TransitionSchema,
    shuffle: z.boolean(),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type PlaylistDto = z.infer<typeof PlaylistDtoSchema>;

export const PlaylistListResponseSchema = z
  .object({ items: z.array(PlaylistSummaryDtoSchema) })
  .strict();
export type PlaylistListResponse = z.infer<typeof PlaylistListResponseSchema>;

/** `POST /api/playlists` */
export const PlaylistCreateSchema = z.object({ name: NameSchema }).strict();
export type PlaylistCreate = z.infer<typeof PlaylistCreateSchema>;

/**
 * `PUT /api/playlists/:id` replaces the name and the whole ordered item list.
 * `description` is optional: left out, the stored description stays as it is;
 * null or an empty string clears it. `transition` and `shuffle` work the same
 * way: left out, the stored value stays.
 */
export const PlaylistReplaceSchema = z
  .object({
    name: NameSchema,
    description: DescriptionInputSchema.optional(),
    transition: TransitionSchema.optional(),
    shuffle: z.boolean().optional(),
    items: z.array(PlaylistItemInputSchema).max(ABSOLUTE.maxPlaylistItems),
  })
  .strict();
export type PlaylistReplace = z.infer<typeof PlaylistReplaceSchema>;

/**
 * `POST /api/playlists/:id/duplicate` takes no body. It copies the description,
 * the playback options and every item into a new playlist named by
 * `duplicatePlaylistName`, assigned to no display, and answers 201 with the copy.
 */
export const PlaylistDuplicateResponseSchema = PlaylistDtoSchema;
export type PlaylistDuplicateResponse = z.infer<typeof PlaylistDuplicateResponseSchema>;

const COPY_PREFIX = 'Copy of ';

/** Name of a duplicated playlist: "Copy of X", cut to the name limit, never mid-character. */
export function duplicatePlaylistName(name: string): string {
  let result = COPY_PREFIX;
  for (const character of name.trim()) {
    if (result.length + character.length > ABSOLUTE.maxNameLength) break;
    result += character;
  }
  return result.trimEnd();
}

/** `POST /api/playlists/:id/publish`; requires the `Idempotency-Key` header. */
export const PublishRequestSchema = z.object({ displayId: DisplayIdSchema }).strict();
export type PublishRequest = z.infer<typeof PublishRequestSchema>;

/** Client-generated key; a UUID is recommended. */
export const IdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/, 'Idempotency-Key must be 16 to 64 URL-safe characters');
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

export const PublishResponseSchema = z
  .object({
    publicationId: PublicationIdSchema,
    displayId: DisplayIdSchema,
    playlistId: PlaylistIdSchema,
    createdAt: UtcTimestampSchema,
    /** True when this response repeats an earlier publish with the same Idempotency-Key. */
    replayed: z.boolean(),
    manifest: ManifestSchema,
  })
  .strict();
export type PublishResponse = z.infer<typeof PublishResponseSchema>;

/** Why a publish was refused. Returned in `error.details[].code` with `publication_rejected`. */
export const PUBLISH_REJECTION_CODES = [
  'playlist_empty',
  'too_many_items',
  'media_missing',
  'app_missing',
  'media_not_ready',
  'media_failed',
  'duration_required',
  'duration_not_allowed',
  'duration_out_of_range',
  'unsupported_media_type',
  'unsupported_codec',
  'unsupported_fit',
  'content_rect_unsupported',
  'canvas_too_large',
  'asset_too_large',
  'video_resolution_too_large',
  'audio_unsupported',
  'multiple_regions_unsupported',
  'zone_too_small',
] as const;
export const PublishRejectionCodeSchema = z.enum(PUBLISH_REJECTION_CODES);
export type PublishRejectionCode = z.infer<typeof PublishRejectionCodeSchema>;
