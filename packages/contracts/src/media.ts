import { z } from 'zod';
import { MediaIdSchema, Sha256HexSchema, UtcTimestampSchema, UuidSchema } from './ids.ts';
import { ABSOLUTE } from './limits.ts';

export const MEDIA_KINDS = ['image', 'video'] as const;
export const MediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const MEDIA_STATUSES = ['processing', 'ready', 'failed'] as const;
export const MediaStatusSchema = z.enum(MEDIA_STATUSES);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

/** MIME types accepted in M0, decided from file content, never from the name. */
export const MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'video/mp4'] as const;
export const MediaMimeTypeSchema = z.enum(MEDIA_MIME_TYPES);
export type MediaMimeType = z.infer<typeof MediaMimeTypeSchema>;

export const MEDIA_KIND_BY_MIME: { readonly [K in MediaMimeType]: MediaKind } = Object.freeze({
  'image/jpeg': 'image',
  'image/png': 'image',
  'video/mp4': 'video',
});

/** Video codecs the M0 browser route accepts (as reported by ffprobe codec_name). */
export const SUPPORTED_VIDEO_CODECS = ['h264'] as const;

/** Why a media file was rejected. Each code has an operator-facing explanation. */
export const MEDIA_ERROR_CODES = [
  'unrecognised_type',
  'type_mismatch',
  'unsupported_type',
  'unsupported_codec',
  'unsupported_pixel_format',
  'no_video_stream',
  'corrupt',
  'image_too_large',
  'video_resolution_too_large',
  'video_too_long',
  'file_too_large',
  'empty_file',
  'inspection_timeout',
  'inspection_failed',
] as const;
export const MediaErrorCodeSchema = z.enum(MEDIA_ERROR_CODES);
export type MediaErrorCode = z.infer<typeof MediaErrorCodeSchema>;

export const MEDIA_ERROR_MESSAGES: { readonly [K in MediaErrorCode]: string } = Object.freeze({
  unrecognised_type:
    'The file content is not a recognised image or video. Upload a JPEG, PNG or MP4 file.',
  type_mismatch:
    'The file content does not match its declared type. Export the file again and re-upload it.',
  unsupported_type: 'This file type is not supported. Upload a JPEG, PNG or MP4 (H.264) file.',
  unsupported_codec:
    'The video codec is not supported. Re-encode the video as H.264 in an MP4 container.',
  unsupported_pixel_format:
    'The video pixel format is not supported. Re-encode as H.264 with 8-bit 4:2:0 colour.',
  no_video_stream: 'The MP4 file contains no video stream.',
  corrupt: 'The file is damaged or incomplete and could not be read.',
  image_too_large:
    'The image dimensions exceed the allowed size. Resize the image and upload it again.',
  video_resolution_too_large:
    'The video resolution exceeds the allowed size. Re-encode at a lower resolution.',
  video_too_long: 'The video is longer than the allowed duration.',
  file_too_large: 'The file is larger than the upload limit.',
  empty_file: 'The file is empty.',
  inspection_timeout: 'The file took too long to inspect and was rejected.',
  inspection_failed:
    'The file could not be inspected. Try again; if it keeps failing, re-export the file.',
});

export const MediaDtoSchema = z
  .object({
    id: MediaIdSchema,
    kind: MediaKindSchema,
    status: MediaStatusSchema,
    /** Display name supplied at upload. Shown as text only, never used as a path. */
    originalName: z.string().max(ABSOLUTE.maxOriginalNameLength),
    mimeType: MediaMimeTypeSchema.nullable(),
    bytes: z.number().int().nonnegative().nullable(),
    sha256: Sha256HexSchema.nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    /** Natural duration for video; null for images. */
    durationMs: z.number().int().positive().nullable(),
    codec: z.string().max(40).nullable(),
    errorCode: MediaErrorCodeSchema.nullable(),
    errorDetail: z.string().max(500).nullable(),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type MediaDto = z.infer<typeof MediaDtoSchema>;

export const MediaListResponseSchema = z
  .object({
    items: z.array(MediaDtoSchema),
    storage: z
      .object({
        usedBytes: z.number().int().nonnegative(),
        limitBytes: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type MediaListResponse = z.infer<typeof MediaListResponseSchema>;

export const MediaUploadResponseSchema = z.object({ media: MediaDtoSchema }).strict();
export type MediaUploadResponse = z.infer<typeof MediaUploadResponseSchema>;

/** Multipart field name that carries the file in `POST /api/media`. */
export const MEDIA_UPLOAD_FIELD = 'file';

/* ---- API <-> media worker exchange (D11). Files only, no network. ---- */

/** Written by the API as `inbox/<jobId>.json` next to the bytes at `inbox/<jobId>`. */
export const MediaJobSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: UuidSchema,
    limits: z
      .object({
        maxBytes: z.number().int().positive(),
        maxImageSidePx: z.number().int().positive(),
        maxImagePixels: z.number().int().positive(),
        maxVideoWidthPx: z.number().int().positive(),
        maxVideoHeightPx: z.number().int().positive(),
        maxVideoDurationMs: z.number().int().positive(),
        timeoutMs: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type MediaJobSpec = z.infer<typeof MediaJobSpecSchema>;

const MediaJobAcceptedSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: UuidSchema,
    outcome: z.literal('accepted'),
    kind: MediaKindSchema,
    mimeType: MediaMimeTypeSchema,
    width: z.number().int().positive().max(100_000),
    height: z.number().int().positive().max(100_000),
    durationMs: z.number().int().positive().max(ABSOLUTE.maxItemDurationMs).nullable(),
    codec: z.string().max(40).nullable(),
  })
  .strict();

const MediaJobRejectedSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: UuidSchema,
    outcome: z.literal('rejected'),
    errorCode: MediaErrorCodeSchema,
    errorDetail: z.string().max(500).nullable(),
  })
  .strict();

/**
 * Written by the worker as `outbox/<jobId>.json`. The worker is untrusted:
 * the API re-validates this document and computes bytes and SHA-256 itself.
 */
export const MediaJobResultSchema = z.discriminatedUnion('outcome', [
  MediaJobAcceptedSchema,
  MediaJobRejectedSchema,
]);
export type MediaJobResult = z.infer<typeof MediaJobResultSchema>;
