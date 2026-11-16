import type { ManifestAssetV1, ManifestV1, PushState, Rect } from '@tinnox/contracts';
import type { PlanPublicationResult } from './manifest.ts';
import type { PublicationDraft, ResolvedItem } from './types.ts';

/**
 * The facts of one play-list entry that a player is given, besides the asset id.
 * A draft entry and a manifest entry describe the same thing when the asset id
 * and all of these are equal.
 */
const COMPARED_ITEM_FACTS = [
  'sha256',
  'bytes',
  'mediaType',
  'kind',
  'durationMs',
  'fit',
  'width',
  'height',
] as const satisfies readonly (keyof ManifestAssetV1 & keyof ResolvedItem)[];

export type ComparedItemField = 'assetId' | (typeof COMPARED_ITEM_FACTS)[number];

/** The first place where a draft and a manifest disagree. */
export type DraftManifestDifference =
  | { readonly kind: 'display' }
  | { readonly kind: 'canvas' }
  | { readonly kind: 'content_rect' }
  | { readonly kind: 'item_count'; readonly draftItems: number; readonly manifestItems: number }
  | { readonly kind: 'item'; readonly index: number; readonly field: ComparedItemField };

/** Identifiers are UUIDs, which compare without regard to letter case. */
function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Compares what would be published now (`draft`) with what a display was last
 * given (`manifest`) and returns the first difference, or null when publishing
 * the draft would hand the player the same content.
 *
 * Compared: the display, the canvas, the content rectangle, and the play list
 * entry by entry in order (asset id, SHA-256, size, media type, kind, time on
 * screen, fit, pixel size). The draft carries every fit already resolved from
 * the display's default, so a changed default shows up as a changed fit.
 *
 * Not compared: `publicationId` and `createdAt`, which identify a publication
 * rather than describe its content, and `muted` and the region count, which
 * have one possible value in manifest v1 and in a draft.
 */
export function firstDraftManifestDifference(
  draft: PublicationDraft,
  manifest: ManifestV1,
): DraftManifestDifference | null {
  if (!sameId(draft.displayId, manifest.displayId)) return { kind: 'display' };
  if (
    draft.canvas.width !== manifest.canvas.width ||
    draft.canvas.height !== manifest.canvas.height
  ) {
    return { kind: 'canvas' };
  }
  if (!sameRect(draft.contentRect, manifest.contentRect)) return { kind: 'content_rect' };
  const itemCount: DraftManifestDifference = {
    kind: 'item_count',
    draftItems: draft.items.length,
    manifestItems: manifest.assets.length,
  };
  if (draft.items.length !== manifest.assets.length) return itemCount;
  for (const [index, item] of draft.items.entries()) {
    const asset = manifest.assets[index];
    if (asset === undefined) return itemCount;
    if (!sameId(item.assetId, asset.assetId)) return { kind: 'item', index, field: 'assetId' };
    for (const field of COMPARED_ITEM_FACTS) {
      if (item[field] !== asset[field]) return { kind: 'item', index, field };
    }
  }
  return null;
}

/**
 * True when publishing `draft` would give the display the content it already
 * has in `manifest`. A display has changes waiting when this is false.
 */
export function draftMatchesManifest(draft: PublicationDraft, manifest: ManifestV1): boolean {
  return firstDraftManifestDifference(draft, manifest) === null;
}

export interface PushStateInput {
  /**
   * Result of `planPublication` for the display's assigned playlist as it is
   * now, or null when no playlist is assigned.
   */
  readonly plan: PlanPublicationResult | null;
  /** Manifest of the display's current (desired) publication, or null when it has none. */
  readonly currentManifest: ManifestV1 | null;
}

/**
 * Decides where a display stands between its assigned content and what it was
 * last given (portal v2 decision P2-05). A playlist that cannot be published
 * is `blocked` whether or not the display already has a publication, because
 * a push would be refused either way.
 */
export function decidePushState(input: PushStateInput): PushState {
  if (input.plan === null) return 'nothing_assigned';
  if (!input.plan.ok) return 'blocked';
  if (input.currentManifest === null) return 'never_pushed';
  return draftMatchesManifest(input.plan.draft, input.currentManifest) ? 'up_to_date' : 'changes';
}
