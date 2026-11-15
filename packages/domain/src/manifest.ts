import {
  MANIFEST_SCHEMA_VERSION,
  ManifestV1Schema,
  type Limits,
  type ManifestV1,
} from '@tinnox/contracts';
import { buildPublicationDraft } from './playlist.ts';
import type {
  DisplayTarget,
  DraftItem,
  MediaRecord,
  PublicationDraft,
  PublicationValidator,
  PublishIssue,
} from './types.ts';

export interface ManifestIdentity {
  readonly publicationId: string;
  /** UTC instant of publication. */
  readonly createdAt: Date;
}

/**
 * Turns a validated draft into the immutable manifest document. The result is
 * checked against the manifest schema; a failure here is a programming error.
 */
export function buildManifest(draft: PublicationDraft, identity: ManifestIdentity): ManifestV1 {
  const candidate = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    publicationId: identity.publicationId,
    displayId: draft.displayId,
    createdAt: identity.createdAt.toISOString(),
    canvas: { width: draft.canvas.width, height: draft.canvas.height },
    contentRect: draft.contentRect === null ? null : { ...draft.contentRect },
    muted: true,
    assets: draft.items.map((item) => ({
      assetId: item.assetId,
      mediaType: item.mediaType,
      kind: item.kind,
      bytes: item.bytes,
      sha256: item.sha256,
      durationMs: item.durationMs,
      fit: item.fit,
      width: item.width,
      height: item.height,
    })),
  };
  const parsed = ManifestV1Schema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `built manifest failed schema validation: ${first ? `${first.path.join('.')}: ${first.message}` : 'unknown'}`,
    );
  }
  return parsed.data;
}

export interface PlanPublicationInput {
  readonly display: DisplayTarget;
  readonly items: readonly DraftItem[];
  readonly mediaById: ReadonlyMap<string, MediaRecord>;
  readonly limits: Limits;
  /** The delivery route of the target display (or any object with the same two methods). */
  readonly route: PublicationValidator;
}

export type PlanPublicationResult =
  | { readonly ok: true; readonly draft: PublicationDraft }
  | { readonly ok: false; readonly issues: readonly PublishIssue[] };

/**
 * The publishing rule, independent of any route implementation:
 * 1. the playlist must be valid and every item ready;
 * 2. the target route must accept the resulting draft.
 * On success the caller assigns an id and calls `buildManifest`.
 */
export function planPublication(input: PlanPublicationInput): PlanPublicationResult {
  const built = buildPublicationDraft(input.display, input.items, input.mediaById, input.limits);
  if (!built.ok) return built;
  const issues = input.route.validate(built.draft);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, draft: built.draft };
}

/** Distinct asset ids of a manifest, in first-use order. */
export function manifestAssetIds(manifest: ManifestV1): string[] {
  return [...new Set(manifest.assets.map((a) => a.assetId))];
}

/** Total bytes a player must store for a manifest (each distinct asset once). */
export function manifestStorageBytes(manifest: ManifestV1): number {
  const seen = new Set<string>();
  let total = 0;
  for (const asset of manifest.assets) {
    if (seen.has(asset.sha256)) continue;
    seen.add(asset.sha256);
    total += asset.bytes;
  }
  return total;
}
