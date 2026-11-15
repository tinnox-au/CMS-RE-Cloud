import { z } from 'zod';
import { CanvasSchema, contentRectProblem, FitModeSchema, RectSchema } from './canvas.ts';
import {
  DisplayIdSchema,
  MediaIdSchema,
  PublicationIdSchema,
  Sha256HexSchema,
  UtcTimestampSchema,
} from './ids.ts';
import { ABSOLUTE } from './limits.ts';
import { MediaKindSchema, MediaMimeTypeSchema } from './media.ts';

export const MANIFEST_SCHEMA_VERSION = 1;

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

/**
 * Immutable publication manifest, version 1. Stored verbatim in `publication.manifest`.
 * `assets` is the ordered play list; the same assetId may appear more than once.
 */
export const ManifestV1Schema = z
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
  .strict()
  .superRefine((m, ctx) => {
    if (m.contentRect !== null) {
      const problem = contentRectProblem(m.canvas, m.contentRect);
      if (problem !== null)
        ctx.addIssue({ code: 'custom', path: ['contentRect'], message: problem });
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
  });
export type ManifestV1 = z.infer<typeof ManifestV1Schema>;

/**
 * Parses a manifest of unknown version. Returns a discriminated result so a
 * player can report "unsupported schema version" separately from "malformed".
 */
export function parseManifest(
  input: unknown,
):
  | { ok: true; manifest: ManifestV1 }
  | { ok: false; reason: 'unsupported_version' | 'malformed'; message: string } {
  const version = z.object({ schemaVersion: z.number() }).safeParse(input);
  if (!version.success) {
    return { ok: false, reason: 'malformed', message: 'manifest has no numeric schemaVersion' };
  }
  if (version.data.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'unsupported_version',
      message: `manifest schemaVersion ${version.data.schemaVersion} is not supported (expected ${MANIFEST_SCHEMA_VERSION})`,
    };
  }
  const parsed = ManifestV1Schema.safeParse(input);
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
