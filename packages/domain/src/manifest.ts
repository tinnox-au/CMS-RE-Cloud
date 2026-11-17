import {
  isMediaItem,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_SCHEMA_VERSION_V2,
  MANIFEST_SCHEMA_VERSION_V3,
  MANIFEST_SCHEMA_VERSION_V4,
  ManifestSchema,
  type Limits,
  type Manifest,
} from '@tinnox/contracts';
import { buildPublicationDraft } from './playlist.ts';
import type {
  AppRecord,
  DisplayTarget,
  DraftItem,
  MediaRecord,
  PlaybackOptions,
  PublicationDraft,
  PublicationValidator,
  PublishIssue,
  ResolvedMediaItem,
} from './types.ts';

export interface ManifestIdentity {
  readonly publicationId: string;
  /** UTC instant of publication. */
  readonly createdAt: Date;
}

/** True when the draft uses a playback option or time rule that only manifest v2 carries. */
export function needsV2(draft: PublicationDraft): boolean {
  return (
    draft.transition !== 'cut' ||
    draft.shuffle ||
    draft.rotation !== 0 ||
    draft.workingHours !== null ||
    draft.items.some(
      (item) =>
        item.kind !== 'app' && (item.availableFrom !== null || item.availableUntil !== null),
    )
  );
}

/**
 * The oldest manifest version that carries the draft: 4 with a schedule, 3 with an app, 2 with
 * a v2 option, else 1.
 */
export function manifestVersionFor(draft: PublicationDraft): 1 | 2 | 3 | 4 {
  if (draft.schedule !== null) return MANIFEST_SCHEMA_VERSION_V4;
  if (draft.items.some((item) => item.kind === 'app')) return MANIFEST_SCHEMA_VERSION_V3;
  return needsV2(draft) ? MANIFEST_SCHEMA_VERSION_V2 : MANIFEST_SCHEMA_VERSION;
}

function v1Asset(item: ResolvedMediaItem) {
  return {
    assetId: item.assetId,
    mediaType: item.mediaType,
    kind: item.kind,
    bytes: item.bytes,
    sha256: item.sha256,
    durationMs: item.durationMs,
    fit: item.fit,
    width: item.width,
    height: item.height,
  };
}

/**
 * Turns a validated draft into the immutable manifest document, in the oldest
 * version that carries it (`manifestVersionFor`), so unchanged screens keep the
 * same kind of document. The result is checked against its schema; a failure
 * here is a programming error.
 */
export function buildManifest(draft: PublicationDraft, identity: ManifestIdentity): Manifest {
  const version = manifestVersionFor(draft);
  const header = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    publicationId: identity.publicationId,
    displayId: draft.displayId,
    createdAt: identity.createdAt.toISOString(),
    canvas: { width: draft.canvas.width, height: draft.canvas.height },
    contentRect: draft.contentRect === null ? null : { ...draft.contentRect },
    muted: true,
  };
  // shortcut: no per-player version negotiation; a v1 player keeps old content when v2 is needed. Add a schemaVersion signal on GET /player/manifest when a non-browser route ships.
  let candidate: unknown;
  if (version === MANIFEST_SCHEMA_VERSION) {
    // Version 1 has no app items: manifestVersionFor gives 3 whenever there is one.
    candidate = {
      ...header,
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      assets: draft.items.flatMap((item) => (item.kind === 'app' ? [] : [v1Asset(item)])),
    };
  } else {
    // shortcut: site.timezone is seed-only and length-checked; an invalid zone throws here. Validate at site write when sites become editable.
    new Intl.DateTimeFormat('en', { timeZone: draft.timeZone });
    candidate = {
      ...header,
      schemaVersion: version,
      timeZone: draft.timeZone,
      transition: draft.transition,
      shuffle: draft.shuffle,
      rotation: draft.rotation,
      workingHours: draft.workingHours,
      assets: draft.items.map((item) =>
        item.kind === 'app'
          ? { kind: 'app', appId: item.appId, durationMs: item.durationMs, content: item.content }
          : {
              ...v1Asset(item),
              availableFrom: item.availableFrom,
              availableUntil: item.availableUntil,
            },
      ),
      // Version 4 is version 3 plus the schedule, copied field by field.
      ...(draft.schedule === null
        ? {}
        : {
            schedule: {
              playlists: draft.schedule.playlists.map((playlist) => ({
                count: playlist.count,
                transition: playlist.transition,
                shuffle: playlist.shuffle,
              })),
              events: draft.schedule.events.map((event) => ({
                playlist: event.playlist,
                days: [...event.days],
                start: event.start,
                end: event.end,
              })),
            },
          }),
    };
  }
  // The discriminated union checks the candidate against the schema of its version.
  const parsed = ManifestSchema.safeParse(candidate);
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
  readonly appsById: ReadonlyMap<string, AppRecord>;
  readonly limits: Limits;
  /** The playlist's playback options. */
  readonly playback: PlaybackOptions;
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
  const built = buildPublicationDraft(
    input.display,
    input.items,
    input.mediaById,
    input.appsById,
    input.limits,
    input.playback,
  );
  if (!built.ok) return built;
  const issues = input.route.validate(built.draft);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, draft: built.draft };
}

/** Distinct asset ids of a manifest's media items, in first-use order. */
export function manifestAssetIds(manifest: Manifest): string[] {
  return [...new Set(manifest.assets.filter(isMediaItem).map((a) => a.assetId))];
}

/** Total bytes a player must store for a manifest (each distinct asset once). */
export function manifestStorageBytes(manifest: Manifest): number {
  const seen = new Set<string>();
  let total = 0;
  for (const asset of manifest.assets.filter(isMediaItem)) {
    if (seen.has(asset.sha256)) continue;
    seen.add(asset.sha256);
    total += asset.bytes;
  }
  return total;
}
