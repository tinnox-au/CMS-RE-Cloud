import {
  manifestV2Facts,
  type Manifest,
  type ManifestAssetV1,
  type ManifestAssetV2,
  type PushState,
  type Rect,
  type WorkingHours,
} from '@tinnox/contracts';
import { needsV2, type PlanPublicationResult } from './manifest.ts';
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

export type ComparedItemField =
  'assetId' | (typeof COMPARED_ITEM_FACTS)[number] | 'availableFrom' | 'availableUntil';

export type PlaybackField =
  'schemaVersion' | 'transition' | 'shuffle' | 'rotation' | 'workingHours' | 'timeZone';

/** The first place where a draft and a manifest disagree. */
export type DraftManifestDifference =
  | { readonly kind: 'display' }
  | { readonly kind: 'canvas' }
  | { readonly kind: 'content_rect' }
  | { readonly kind: 'playback'; readonly field: PlaybackField }
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

/** Compared day by day: a stored jsonb value comes back with its keys in another order. */
function sameHours(a: WorkingHours | null, b: WorkingHours | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((day, i) => {
    const other = b[i] ?? null;
    if (day === null || other === null) return day === other;
    return day.start === other.start && day.end === other.end;
  });
}

/**
 * Compares what would be published now (`draft`) with what a display was last
 * given (`manifest`) and returns the first difference, or null when publishing
 * the draft would hand the player the same content.
 *
 * Compared: the manifest version the draft needs (v1 unless a v2 option or time
 * rule is in use, so turning every v2 option off offers a push back to v1), the
 * display, the canvas, the content rectangle, the playback options (transition,
 * shuffle, rotation, working hours, and the time zone when the manifest is v2;
 * a v1 manifest counts as all defaults), and the play list entry by entry in
 * order (asset id, SHA-256, size, media type, kind, time on screen, fit, pixel
 * size, availability window). The draft carries every fit already resolved from
 * the display's default, so a changed default shows up as a changed fit.
 *
 * Not compared: `publicationId` and `createdAt`, which identify a publication
 * rather than describe its content, and `muted` and the region count, which
 * have one possible value in a manifest and in a draft.
 */
export function firstDraftManifestDifference(
  draft: PublicationDraft,
  manifest: Manifest,
): DraftManifestDifference | null {
  if (manifest.schemaVersion !== (needsV2(draft) ? 2 : 1)) {
    return { kind: 'playback', field: 'schemaVersion' };
  }
  if (!sameId(draft.displayId, manifest.displayId)) return { kind: 'display' };
  if (
    draft.canvas.width !== manifest.canvas.width ||
    draft.canvas.height !== manifest.canvas.height
  ) {
    return { kind: 'canvas' };
  }
  if (!sameRect(draft.contentRect, manifest.contentRect)) return { kind: 'content_rect' };
  const facts = manifestV2Facts(manifest);
  if (draft.transition !== facts.transition) return { kind: 'playback', field: 'transition' };
  if (draft.shuffle !== facts.shuffle) return { kind: 'playback', field: 'shuffle' };
  if (draft.rotation !== facts.rotation) return { kind: 'playback', field: 'rotation' };
  if (!sameHours(draft.workingHours, facts.workingHours)) {
    return { kind: 'playback', field: 'workingHours' };
  }
  if (facts.timeZone !== null && draft.timeZone !== facts.timeZone) {
    return { kind: 'playback', field: 'timeZone' };
  }
  const itemCount: DraftManifestDifference = {
    kind: 'item_count',
    draftItems: draft.items.length,
    manifestItems: manifest.assets.length,
  };
  if (draft.items.length !== manifest.assets.length) return itemCount;
  const assets: readonly (ManifestAssetV1 &
    Partial<Pick<ManifestAssetV2, 'availableFrom' | 'availableUntil'>>)[] = manifest.assets;
  for (const [index, item] of draft.items.entries()) {
    const asset = assets[index];
    if (asset === undefined) return itemCount;
    if (!sameId(item.assetId, asset.assetId)) return { kind: 'item', index, field: 'assetId' };
    for (const field of COMPARED_ITEM_FACTS) {
      if (item[field] !== asset[field]) return { kind: 'item', index, field };
    }
    if (item.availableFrom !== (asset.availableFrom ?? null)) {
      return { kind: 'item', index, field: 'availableFrom' };
    }
    if (item.availableUntil !== (asset.availableUntil ?? null)) {
      return { kind: 'item', index, field: 'availableUntil' };
    }
  }
  return null;
}

/**
 * True when publishing `draft` would give the display the content it already
 * has in `manifest`. A display has changes waiting when this is false.
 */
export function draftMatchesManifest(draft: PublicationDraft, manifest: Manifest): boolean {
  return firstDraftManifestDifference(draft, manifest) === null;
}

export interface PushStateInput {
  /**
   * Result of `planPublication` for the display's assigned playlist as it is
   * now, or null when no playlist is assigned.
   */
  readonly plan: PlanPublicationResult | null;
  /** Manifest of the display's current (desired) publication, or null when it has none. */
  readonly currentManifest: Manifest | null;
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
