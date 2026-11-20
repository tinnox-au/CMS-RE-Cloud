import { z } from 'zod';

const positiveInt = z.number().int().positive();

/**
 * Operational limits (prototype-m0.md section 6). Every value can be overridden
 * through the environment variable named in LIMIT_ENV_VARS.
 */
export const LimitsSchema = z
  .object({
    maxUploadBytes: positiveInt,
    maxImageSidePx: positiveInt,
    maxImagePixels: positiveInt,
    maxVideoWidthPx: positiveInt,
    maxVideoHeightPx: positiveInt,
    maxVideoDurationMs: positiveInt,
    minImageItemDurationMs: positiveInt,
    maxImageItemDurationMs: positiveInt,
    minCanvasSidePx: positiveInt,
    maxCanvasSidePx: positiveInt,
    maxOrgStorageBytes: positiveInt,
    maxPlaylistItems: positiveInt,
    pairingCodeTtlSeconds: positiveInt,
    pairingMaxWrongAttempts: positiveInt,
    pairingMaxSessionsPerIp: positiveInt,
    pairingSessionWindowSeconds: positiveInt,
    mediaUrlTtlSeconds: positiveInt,
    heartbeatIntervalSeconds: positiveInt,
    heartbeatStaleAfterSeconds: positiveInt,
    /** How long the raw heartbeat history is kept (diagnostics only; delivery state is separate). */
    heartbeatLogRetentionHours: positiveInt.max(24 * 366),
    mediaInspectionTimeoutMs: positiveInt,
  })
  .strict()
  .refine((l) => l.minImageItemDurationMs <= l.maxImageItemDurationMs, {
    message: 'minImageItemDurationMs must not exceed maxImageItemDurationMs',
  })
  .refine((l) => l.minCanvasSidePx <= l.maxCanvasSidePx, {
    message: 'minCanvasSidePx must not exceed maxCanvasSidePx',
  })
  .refine((l) => l.heartbeatIntervalSeconds < l.heartbeatStaleAfterSeconds, {
    message: 'heartbeatStaleAfterSeconds must be greater than heartbeatIntervalSeconds',
  });

export type Limits = z.infer<typeof LimitsSchema>;

export const DEFAULT_LIMITS: Limits = Object.freeze({
  maxUploadBytes: 200 * 1024 * 1024,
  maxImageSidePx: 8192,
  maxImagePixels: 40_000_000,
  maxVideoWidthPx: 3840,
  maxVideoHeightPx: 2160,
  maxVideoDurationMs: 10 * 60 * 1000,
  minImageItemDurationMs: 1_000,
  maxImageItemDurationMs: 3_600_000,
  minCanvasSidePx: 16,
  maxCanvasSidePx: 16_384,
  maxOrgStorageBytes: 5 * 1024 * 1024 * 1024,
  maxPlaylistItems: 200,
  pairingCodeTtlSeconds: 600,
  pairingMaxWrongAttempts: 5,
  pairingMaxSessionsPerIp: 10,
  pairingSessionWindowSeconds: 600,
  mediaUrlTtlSeconds: 300,
  heartbeatIntervalSeconds: 15,
  heartbeatStaleAfterSeconds: 60,
  heartbeatLogRetentionHours: 24,
  mediaInspectionTimeoutMs: 30_000,
});

/** Environment variable name for each limit. */
export const LIMIT_ENV_VARS: { readonly [K in keyof Limits]: string } = Object.freeze({
  maxUploadBytes: 'LIMIT_MAX_UPLOAD_BYTES',
  maxImageSidePx: 'LIMIT_MAX_IMAGE_SIDE_PX',
  maxImagePixels: 'LIMIT_MAX_IMAGE_PIXELS',
  maxVideoWidthPx: 'LIMIT_MAX_VIDEO_WIDTH_PX',
  maxVideoHeightPx: 'LIMIT_MAX_VIDEO_HEIGHT_PX',
  maxVideoDurationMs: 'LIMIT_MAX_VIDEO_DURATION_MS',
  minImageItemDurationMs: 'LIMIT_MIN_IMAGE_ITEM_DURATION_MS',
  maxImageItemDurationMs: 'LIMIT_MAX_IMAGE_ITEM_DURATION_MS',
  minCanvasSidePx: 'LIMIT_MIN_CANVAS_SIDE_PX',
  maxCanvasSidePx: 'LIMIT_MAX_CANVAS_SIDE_PX',
  maxOrgStorageBytes: 'LIMIT_MAX_ORG_STORAGE_BYTES',
  maxPlaylistItems: 'LIMIT_MAX_PLAYLIST_ITEMS',
  pairingCodeTtlSeconds: 'LIMIT_PAIRING_CODE_TTL_SECONDS',
  pairingMaxWrongAttempts: 'LIMIT_PAIRING_MAX_WRONG_ATTEMPTS',
  pairingMaxSessionsPerIp: 'LIMIT_PAIRING_MAX_SESSIONS_PER_IP',
  pairingSessionWindowSeconds: 'LIMIT_PAIRING_SESSION_WINDOW_SECONDS',
  mediaUrlTtlSeconds: 'LIMIT_MEDIA_URL_TTL_SECONDS',
  heartbeatIntervalSeconds: 'LIMIT_HEARTBEAT_INTERVAL_SECONDS',
  heartbeatStaleAfterSeconds: 'LIMIT_HEARTBEAT_STALE_AFTER_SECONDS',
  heartbeatLogRetentionHours: 'LIMIT_HEARTBEAT_LOG_RETENTION_HOURS',
  mediaInspectionTimeoutMs: 'LIMIT_MEDIA_INSPECTION_TIMEOUT_MS',
});

/**
 * Hard ceilings baked into the wire schemas. Configured limits may be lower, never higher.
 * They keep request bodies and stored documents bounded even if configuration is wrong.
 */
export const ABSOLUTE = Object.freeze({
  minCanvasSidePx: 16,
  maxCanvasSidePx: 16_384,
  maxPlaylistItems: 500,
  /** Weekly events in one schedule. Twin of the schedule_event position CHECK (0009). */
  maxScheduleEvents: 50,
  /** Zones in one layout. Twin of the layout_zone position CHECK (0011). The ceiling of manifest v5, frozen with player 0.5.0. */
  maxLayoutZones: 4,
  maxItemDurationMs: 24 * 60 * 60 * 1000,
  maxAssetBytes: 2 * 1024 * 1024 * 1024,
  maxNameLength: 120,
  maxOriginalNameLength: 255,
  maxDescriptionLength: 500,
  maxTagNameLength: 40,
  maxFolderNameLength: 80,
  /** Tags on one media item or one display. */
  maxTagsPerItem: 50,
  /** Displays named in one push request. */
  maxPushDisplays: 200,
  /** Rows in a list response that has no paging; the portal refuses a longer list. */
  maxListItems: 10_000,
  /** Pending invites per organisation. Checked under the membership lock by `POST /api/invites`. */
  maxPendingInvites: 100,
  maxHeartbeatErrors: 10,
  maxErrorMessageLength: 300,
  maxHeartbeatBodyBytes: 16 * 1024,
  maxJsonBodyBytes: 256 * 1024,
});

/**
 * Builds limits from an environment map. Unset variables use the default.
 * Throws with the variable name when a value is not a positive integer.
 */
export function limitsFromEnv(env: Readonly<Record<string, string | undefined>>): Limits {
  const out: Record<string, number> = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(LIMIT_ENV_VARS) as (keyof Limits)[]) {
    const name = LIMIT_ENV_VARS[key];
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') continue;
    if (!/^[0-9]{1,15}$/.test(raw.trim())) {
      throw new Error(`${name} must be a positive integer`);
    }
    out[key] = Number(raw.trim());
  }
  const parsed = LimitsSchema.safeParse(out);
  if (!parsed.success) {
    throw new Error(
      `Invalid limits configuration: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  if (
    parsed.data.maxCanvasSidePx > ABSOLUTE.maxCanvasSidePx ||
    parsed.data.minCanvasSidePx < ABSOLUTE.minCanvasSidePx
  ) {
    throw new Error(
      `Canvas limits must stay within ${ABSOLUTE.minCanvasSidePx} to ${ABSOLUTE.maxCanvasSidePx} px`,
    );
  }
  if (parsed.data.maxPlaylistItems > ABSOLUTE.maxPlaylistItems) {
    throw new Error(`LIMIT_MAX_PLAYLIST_ITEMS must not exceed ${ABSOLUTE.maxPlaylistItems}`);
  }
  if (
    parsed.data.maxImageItemDurationMs > ABSOLUTE.maxItemDurationMs ||
    parsed.data.maxVideoDurationMs > ABSOLUTE.maxItemDurationMs
  ) {
    throw new Error(`Duration limits must not exceed ${ABSOLUTE.maxItemDurationMs} ms`);
  }
  if (parsed.data.maxUploadBytes > ABSOLUTE.maxAssetBytes) {
    throw new Error(`LIMIT_MAX_UPLOAD_BYTES must not exceed ${ABSOLUTE.maxAssetBytes}`);
  }
  return Object.freeze(parsed.data);
}
