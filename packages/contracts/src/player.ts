import { z } from 'zod';
import { DisplayIdSchema, MediaIdSchema, PublicationIdSchema, UtcTimestampSchema } from './ids.ts';
import { ABSOLUTE } from './limits.ts';
import { ManifestV1Schema } from './manifest.ts';

/**
 * `GET /player/manifest`
 * - 200 with ManifestResponse and `ETag: "<publicationId>"`
 * - 304 when `If-None-Match` equals the current ETag
 * - 204 when nothing is published to the display yet
 */
export const ManifestResponseSchema = z.object({ manifest: ManifestV1Schema }).strict();
export type ManifestResponse = z.infer<typeof ManifestResponseSchema>;

export function manifestEtag(publicationId: string): string {
  return `"${publicationId}"`;
}

/** Extracts the publication id from an ETag / If-None-Match value; null if it is not one of ours. */
export function publicationIdFromEtag(header: string | undefined | null): string | null {
  if (header === undefined || header === null || header.length > 200) return null;
  const match = /^(?:W\/)?"([0-9a-fA-F-]{36})"$/.exec(header.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

/** `POST /player/media-urls` */
export const MediaUrlsRequestSchema = z
  .object({
    publicationId: PublicationIdSchema,
    assetIds: z.array(MediaIdSchema).min(1).max(ABSOLUTE.maxPlaylistItems),
  })
  .strict();
export type MediaUrlsRequest = z.infer<typeof MediaUrlsRequestSchema>;

export const MediaUrlsResponseSchema = z
  .object({
    publicationId: PublicationIdSchema,
    urls: z.array(
      z
        .object({
          assetId: MediaIdSchema,
          /** Absolute, short-lived, bound to this registration. Never log this value. */
          url: z.url(),
          expiresAt: UtcTimestampSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type MediaUrlsResponse = z.infer<typeof MediaUrlsResponseSchema>;

/** Query string of `GET /player/media/:assetId`. `reg` binds the signature to one registration. */
export const MediaUrlQuerySchema = z
  .object({
    pub: PublicationIdSchema,
    reg: z.uuid(),
    exp: z.string().regex(/^[0-9]{10,12}$/, 'exp must be a unix timestamp in seconds'),
    sig: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'malformed signature'),
  })
  .strict();
export type MediaUrlQuery = z.infer<typeof MediaUrlQuerySchema>;

/** Field names that must be redacted wherever requests are logged. */
export const REDACTED_QUERY_PARAMS = ['sig'] as const;
export const REDACTED_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-csrf-token'] as const;

export const HEARTBEAT_SCHEMA_VERSION = 1;

export const PLAYER_STATES = ['idle', 'playing', 'error'] as const;
export const PlayerStateSchema = z.enum(PLAYER_STATES);
export type PlayerState = z.infer<typeof PlayerStateSchema>;

export const STAGING_PHASES = ['downloading', 'verifying', 'ready', 'failed'] as const;
export const StagingPhaseSchema = z.enum(STAGING_PHASES);
export type StagingPhase = z.infer<typeof StagingPhaseSchema>;

export const PLAYER_ERROR_CODES = [
  'manifest_malformed',
  'manifest_unsupported_version',
  'network_error',
  'auth_rejected',
  'download_failed',
  'size_mismatch',
  'integrity_mismatch',
  'quota_exceeded',
  'storage_error',
  'unsupported_media',
  'decode_failed',
  'playback_error',
  'internal_error',
] as const;
export const PlayerErrorCodeSchema = z.enum(PLAYER_ERROR_CODES);
export type PlayerErrorCode = z.infer<typeof PlayerErrorCodeSchema>;

export const PlayerErrorSchema = z
  .object({
    code: PlayerErrorCodeSchema,
    /** Short diagnostic text. Must not contain URLs with signatures or tokens. */
    message: z.string().max(ABSOLUTE.maxErrorMessageLength),
    at: UtcTimestampSchema,
    publicationId: PublicationIdSchema.nullable(),
    assetId: MediaIdSchema.nullable(),
  })
  .strict();
export type PlayerError = z.infer<typeof PlayerErrorSchema>;

/**
 * `POST /player/heartbeat`, version 1. A report from player software; it is
 * evidence of what the software believes, not proof of what a physical panel shows.
 */
export const HeartbeatV1Schema = z
  .object({
    schemaVersion: z.literal(HEARTBEAT_SCHEMA_VERSION),
    /**
     * Strictly increasing per registration. The server ignores a report whose
     * seq is not greater than the last one it stored for the same registration.
     */
    seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    /** Player clock; informational only. The server records its own receive time. */
    sentAt: UtcTimestampSchema,
    /** Must equal the display bound to the device credential, otherwise the report is rejected. */
    displayId: DisplayIdSchema,
    /** Last publication fully downloaded and verified. */
    downloadedPublicationId: PublicationIdSchema.nullable(),
    /** Publication currently being rendered. */
    activePublicationId: PublicationIdSchema.nullable(),
    /** Index into the active manifest's `assets`. Null when nothing is active. */
    activeItemIndex: z.number().int().nonnegative().max(ABSOLUTE.maxPlaylistItems).nullable(),
    playerState: PlayerStateSchema,
    /** Update in progress, if any. */
    staging: z
      .object({
        publicationId: PublicationIdSchema,
        phase: StagingPhaseSchema,
        assetsDone: z.number().int().nonnegative().max(ABSOLUTE.maxPlaylistItems),
        assetsTotal: z.number().int().nonnegative().max(ABSOLUTE.maxPlaylistItems),
      })
      .strict()
      .nullable(),
    /** Most recent problems, newest first. */
    errors: z.array(PlayerErrorSchema).max(ABSOLUTE.maxHeartbeatErrors),
    player: z
      .object({
        /** Player build identifier. */
        version: z.string().max(40),
        /** Result of navigator.storage.persisted(); null when the API is unavailable. */
        storagePersisted: z.boolean().nullable(),
        online: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((hb, ctx) => {
    if ((hb.activePublicationId === null) !== (hb.activeItemIndex === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['activeItemIndex'],
        message: 'activePublicationId and activeItemIndex must both be set or both be null',
      });
    }
    if (hb.playerState === 'playing' && hb.activePublicationId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['playerState'],
        message: 'playing requires an active publication',
      });
    }
    if (hb.staging !== null && hb.staging.assetsDone > hb.staging.assetsTotal) {
      ctx.addIssue({
        code: 'custom',
        path: ['staging', 'assetsDone'],
        message: 'assetsDone exceeds assetsTotal',
      });
    }
  });
export type HeartbeatV1 = z.infer<typeof HeartbeatV1Schema>;

export const HEARTBEAT_IGNORE_REASONS = ['stale_seq'] as const;

export const HeartbeatResponseSchema = z
  .object({
    /** False when the report was valid but ignored (for example an out-of-date seq). */
    accepted: z.boolean(),
    ignoredReason: z.enum(HEARTBEAT_IGNORE_REASONS).nullable(),
    /** What the server wants this display to play. Lets a player notice a publish without a manifest poll. */
    desiredPublicationId: PublicationIdSchema.nullable(),
    serverTime: UtcTimestampSchema,
    nextHeartbeatInMs: z.number().int().min(1000).max(600_000),
  })
  .strict();
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;
