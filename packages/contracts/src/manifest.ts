import { z } from 'zod';
import {
  CanvasSchema,
  contentRectProblem,
  FitModeSchema,
  RectSchema,
  RotationSchema,
  type Rotation,
} from './canvas.ts';
import { WorkingHoursSchema, type WorkingHours } from './display.ts';
import {
  DisplayIdSchema,
  LocalDateTimeSchema,
  MediaIdSchema,
  PublicationIdSchema,
  Sha256HexSchema,
  TimeZoneSchema,
  UtcTimestampSchema,
} from './ids.ts';
import { ABSOLUTE } from './limits.ts';
import { MediaKindSchema, MediaMimeTypeSchema } from './media.ts';

export const MANIFEST_SCHEMA_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION_V2 = 2;

export const ManifestAssetV1Schema = z
  .object({
    /** Stable private media reference. Not a URL; download URLs are issued separately. */
    assetId: MediaIdSchema,
    mediaType: MediaMimeTypeSchema,
    kind: MediaKindSchema,
    bytes: z.number().int().positive().max(ABSOLUTE.maxAssetBytes),
    sha256: Sha256HexSchema,
    /** Time on screen. For video this is the natural duration. */
    durationMs: z.number().int().positive().max(ABSOLUTE.maxItemDurationMs),
    fit: FitModeSchema,
    /** Intrinsic pixel size, so a player can lay out before decoding. */
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export type ManifestAssetV1 = z.infer<typeof ManifestAssetV1Schema>;

const manifestV1Object = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    publicationId: PublicationIdSchema,
    displayId: DisplayIdSchema,
    createdAt: UtcTimestampSchema,
    canvas: CanvasSchema,
    contentRect: RectSchema.nullable(),
    /** Always true in M0. */
    muted: z.literal(true),
    assets: z.array(ManifestAssetV1Schema).min(1).max(ABSOLUTE.maxPlaylistItems),
  })
  .strict();

/** Checks shared by every manifest version (zod refuses `.extend()` on a refined object). */
function checkManifestBody(
  m: Pick<ManifestV1, 'canvas' | 'contentRect' | 'assets'>,
  ctx: z.RefinementCtx,
): void {
  if (m.contentRect !== null) {
    const problem = contentRectProblem(m.canvas, m.contentRect);
    if (problem !== null) ctx.addIssue({ code: 'custom', path: ['contentRect'], message: problem });
  }
  const seen = new Map<string, ManifestAssetV1>();
  m.assets.forEach((asset, index) => {
    const first = seen.get(asset.assetId);
    if (first === undefined) {
      seen.set(asset.assetId, asset);
    } else if (
      first.sha256 !== asset.sha256 ||
      first.bytes !== asset.bytes ||
      first.mediaType !== asset.mediaType
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['assets', index],
        message: 'repeated assetId must carry identical bytes, sha256 and mediaType',
      });
    }
  });
}

/**
 * Immutable publication manifest, version 1. Stored verbatim in `publication.manifest`.
 * `assets` is the ordered play list; the same assetId may appear more than once.
 */
export const ManifestV1Schema = manifestV1Object.superRefine(checkManifestBody);
export type ManifestV1 = z.infer<typeof ManifestV1Schema>;

export const TRANSITIONS = ['cut', 'fade'] as const;
export const TransitionSchema = z.enum(TRANSITIONS);
export type Transition = z.infer<typeof TransitionSchema>;

/** A v1 asset plus its availability window, wall clock in the site's zone. */
export const ManifestAssetV2Schema = ManifestAssetV1Schema.extend({
  availableFrom: LocalDateTimeSchema.nullable(),
  availableUntil: LocalDateTimeSchema.nullable(),
}).strict();
export type ManifestAssetV2 = z.infer<typeof ManifestAssetV2Schema>;

/**
 * Manifest version 2: version 1 plus playback options and time rules. Written
 * only when a draft needs one of them. Every field is required.
 */
export const ManifestV2Schema = manifestV1Object
  .extend({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION_V2),
    /** Zone of the screen's site; working hours and windows are read in it. */
    timeZone: TimeZoneSchema,
    transition: TransitionSchema,
    shuffle: z.boolean(),
    rotation: RotationSchema,
    /** Null means always on. */
    workingHours: WorkingHoursSchema.nullable(),
    assets: z.array(ManifestAssetV2Schema).min(1).max(ABSOLUTE.maxPlaylistItems),
  })
  .strict()
  .superRefine((m, ctx) => {
    checkManifestBody(m, ctx);
    m.assets.forEach((asset, index) => {
      if (
        asset.availableFrom !== null &&
        asset.availableUntil !== null &&
        asset.availableFrom >= asset.availableUntil
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['assets', index, 'availableUntil'],
          message: 'availableUntil must be after availableFrom',
        });
      }
    });
  });
export type ManifestV2 = z.infer<typeof ManifestV2Schema>;

export const ManifestSchema = z.discriminatedUnion('schemaVersion', [
  ManifestV1Schema,
  ManifestV2Schema,
]);
export type Manifest = z.infer<typeof ManifestSchema>;

/** Playback facts of any manifest; version 1 carries the defaults. */
export function manifestV2Facts(m: Manifest): {
  transition: Transition;
  shuffle: boolean;
  rotation: Rotation;
  workingHours: WorkingHours | null;
  timeZone: string | null;
} {
  if (m.schemaVersion === MANIFEST_SCHEMA_VERSION) {
    return { transition: 'cut', shuffle: false, rotation: 0, workingHours: null, timeZone: null };
  }
  return {
    transition: m.transition,
    shuffle: m.shuffle,
    rotation: m.rotation,
    workingHours: m.workingHours,
    timeZone: m.timeZone,
  };
}

/**
 * Parses a manifest of unknown version. Returns a discriminated result so a
 * player can report "unsupported schema version" separately from "malformed".
 */
export function parseManifest(
  input: unknown,
):
  | { ok: true; manifest: Manifest }
  | { ok: false; reason: 'unsupported_version' | 'malformed'; message: string } {
  const version = z.object({ schemaVersion: z.number() }).safeParse(input);
  if (!version.success) {
    return { ok: false, reason: 'malformed', message: 'manifest has no numeric schemaVersion' };
  }
  let schema: typeof ManifestV1Schema | typeof ManifestV2Schema;
  switch (version.data.schemaVersion) {
    case MANIFEST_SCHEMA_VERSION:
      schema = ManifestV1Schema;
      break;
    case MANIFEST_SCHEMA_VERSION_V2:
      schema = ManifestV2Schema;
      break;
    default:
      return {
        ok: false,
        reason: 'unsupported_version',
        message: `manifest schemaVersion ${version.data.schemaVersion} is not supported (expected ${MANIFEST_SCHEMA_VERSION} or ${MANIFEST_SCHEMA_VERSION_V2})`,
      };
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      reason: 'malformed',
      message: first ? `${first.path.join('.')}: ${first.message}` : 'manifest failed validation',
    };
  }
  return { ok: true, manifest: parsed.data };
}
