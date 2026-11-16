import {
  CanvasSchema,
  DisplayIdSchema,
  ManifestSchema,
  OpaqueTokenSchema,
  OrgIdSchema,
  PairingCodeSchema,
  PairingSessionIdSchema,
  PlayerErrorSchema,
  RectSchema,
  RegistrationIdSchema,
  StagingPhaseSchema,
  UtcTimestampSchema,
  type ManifestAssetV1,
  type Manifest,
  type MediaUrlsResponse,
  type PlayerError,
} from '@tinnox/contracts';
import { z } from 'zod';

/**
 * What the player keeps about its registration. `deviceToken` is the bearer
 * credential (prototype-m0.md D8); it is null once the server has rejected it.
 */
export const RegistrationRecordSchema = z
  .object({
    registrationId: RegistrationIdSchema,
    orgId: OrgIdSchema,
    deviceToken: OpaqueTokenSchema.nullable(),
    display: z
      .object({
        id: DisplayIdSchema,
        name: z.string().max(200),
        canvas: CanvasSchema,
        contentRect: RectSchema.nullable(),
      })
      .strict(),
    pairedAt: UtcTimestampSchema,
    revokedAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type RegistrationRecord = z.infer<typeof RegistrationRecordSchema>;

/** The complete, verified publication the renderer plays. */
export const ActiveVersionSchema = z
  .object({ manifest: ManifestSchema, activatedAt: UtcTimestampSchema })
  .strict();
export type ActiveVersion = z.infer<typeof ActiveVersionSchema>;

/** An update in progress or the last failed one. Never rendered. */
export const StagingRecordSchema = z
  .object({
    manifest: ManifestSchema,
    phase: StagingPhaseSchema,
    assetsDone: z.number().int().nonnegative(),
    assetsTotal: z.number().int().nonnegative(),
    startedAt: UtcTimestampSchema,
  })
  .strict();
export type StagingRecord = z.infer<typeof StagingRecordSchema>;

/** A pairing session in progress, kept so a reload shows the same code. */
export const PairingRecordSchema = z
  .object({
    pairingId: PairingSessionIdSchema,
    code: PairingCodeSchema,
    pollingToken: OpaqueTokenSchema,
    /** Server time; shown in diagnostics only, never compared with the local clock. */
    expiresAt: UtcTimestampSchema,
    /**
     * Local-clock deadline (ms since the epoch by this device's clock), computed from the
     * server's relative lifetime when the code was issued. Correct however wrong the
     * device clock is, as long as it is not changed while the code is shown.
     */
    localExpiresAtMs: z.number().int().nonnegative(),
    pollIntervalMs: z.number().int().min(1000).max(60_000),
  })
  .strict();
export type PairingRecord = z.infer<typeof PairingRecordSchema>;

export const StoredErrorsSchema = z.array(PlayerErrorSchema).max(50);

/** Durable player state (IndexedDB in the browser, a fake in unit tests). */
export interface StateStore {
  getRegistration(): Promise<RegistrationRecord | null>;
  /**
   * Stores a new registration and, in the same transaction, removes every
   * trace of the previous one (active and staging versions, pairing session,
   * heartbeat sequence, errors).
   */
  replaceRegistration(registration: RegistrationRecord): Promise<void>;
  /** Drops the credential and both versions, and marks the registration revoked. */
  markRevoked(at: string): Promise<void>;

  getActive(): Promise<ActiveVersion | null>;
  getStaging(): Promise<StagingRecord | null>;
  putStaging(record: StagingRecord): Promise<void>;
  clearStaging(): Promise<void>;
  /**
   * Atomic activation: in ONE transaction, check that `registrationId` is still
   * the stored, unrevoked registration, write the active version and remove the
   * staging record. Returns false (and changes nothing) when the check fails.
   */
  activate(registrationId: string, manifest: Manifest, at: string): Promise<boolean>;

  /** Returns a sequence number greater than every one returned before, across reloads. */
  nextHeartbeatSeq(nowMs: number): Promise<number>;

  getErrors(): Promise<PlayerError[]>;
  putErrors(errors: readonly PlayerError[]): Promise<void>;

  getPairing(): Promise<PairingRecord | null>;
  putPairing(record: PairingRecord): Promise<void>;
  clearPairing(): Promise<void>;
}

export interface StorageEstimate {
  readonly usage: number;
  readonly quota: number;
}

/** Media bytes keyed by SHA-256, private to one organisation and registration. */
export interface AssetStore {
  /** True only when an entry exists and has exactly `bytes` bytes. */
  has(sha256: string, bytes: number): Promise<boolean>;
  /** Stores verified bytes. Throws PlayerFault `quota_exceeded` or `storage_error`. */
  put(sha256: string, mediaType: string, blob: Blob): Promise<void>;
  getBlob(sha256: string): Promise<Blob | null>;
  list(): Promise<string[]>;
  delete(sha256: string): Promise<void>;
  /** Null when the browser cannot say. */
  estimate(): Promise<StorageEstimate | null>;
}

export type ManifestFetchResult =
  | { readonly kind: 'not_modified' }
  /** Nothing is published to this display. */
  | { readonly kind: 'none' }
  /** Raw, unvalidated manifest from the response body. */
  | { readonly kind: 'manifest'; readonly raw: unknown };

export interface MediaResponse {
  readonly status: number;
  /** First byte position from `Content-Range`, or null when absent or unreadable. */
  readonly rangeStart: number | null;
  /** Body chunks; iteration rejects when the transfer breaks or stalls. */
  readonly chunks: AsyncIterable<Uint8Array<ArrayBuffer>>;
  /** Releases the connection without reading the rest. */
  cancel(): void;
}

/**
 * Player API calls for one registered device. `fetchManifest` and `requestMediaUrls`
 * throw RevokedError on 401. `fetchMedia` uses only the signed URL and returns the
 * status instead: a rejected URL may merely have expired, and asking for new URLs
 * is what tells expiry and revocation apart.
 */
export interface DeviceApi {
  fetchManifest(ifNoneMatchPublicationId: string | null): Promise<ManifestFetchResult>;
  requestMediaUrls(publicationId: string, assetIds: readonly string[]): Promise<MediaUrlsResponse>;
  fetchMedia(url: string, rangeStart: number | null, signal: AbortSignal): Promise<MediaResponse>;
}

export interface Clock {
  now(): number;
}

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Assets of a manifest with duplicates (same bytes used twice in the playlist) removed. */
export function uniqueAssets(manifest: Manifest): ManifestAssetV1[] {
  const bySha = new Map<string, ManifestAssetV1>();
  for (const asset of manifest.assets) {
    if (!bySha.has(asset.sha256)) bySha.set(asset.sha256, asset);
  }
  return [...bySha.values()];
}

export function manifestHashes(manifest: Manifest): Set<string> {
  return new Set(manifest.assets.map((asset) => asset.sha256));
}
