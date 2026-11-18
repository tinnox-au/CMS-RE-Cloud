import { z } from 'zod';
import { AppContentSchema } from './app.ts';
import {
  CanvasSchema,
  contentRectProblem,
  FitModeSchema,
  RectSchema,
  rectsOverlap,
  RotationSchema,
  type Rotation,
} from './canvas.ts';
import { WorkingHoursSchema, type WorkingHours } from './display.ts';
import {
  AppIdSchema,
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
import { checkScheduleRule, scheduleRuleShape } from './schedule.ts';

export const MANIFEST_SCHEMA_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION_V2 = 2;
export const MANIFEST_SCHEMA_VERSION_V3 = 3;
export const MANIFEST_SCHEMA_VERSION_V4 = 4;
export const MANIFEST_SCHEMA_VERSION_V5 = 5;

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

/**
 * Checks shared by every manifest version (zod refuses `.extend()` on a refined object).
 * Repeated assets are checked over media items only: an app item has no assetId.
 */
function checkManifestBody(
  m: {
    canvas: ManifestV1['canvas'];
    contentRect: ManifestV1['contentRect'];
    assets: ManifestItem[];
  },
  ctx: z.RefinementCtx,
): void {
  if (m.contentRect !== null) {
    const problem = contentRectProblem(m.canvas, m.contentRect);
    if (problem !== null) ctx.addIssue({ code: 'custom', path: ['contentRect'], message: problem });
  }
  const seen = new Map<string, ManifestAssetV1>();
  m.assets.forEach((asset, index) => {
    if (!isMediaItem(asset)) return;
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

/** Checks of version 2 and later: the common body plus window order on media items. */
function checkManifestV2Body(
  m: Pick<ManifestV3, 'canvas' | 'contentRect' | 'assets'>,
  ctx: z.RefinementCtx,
): void {
  checkManifestBody(m, ctx);
  m.assets.forEach((asset, index) => {
    if (
      isMediaItem(asset) &&
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
}

const manifestV2Object = manifestV1Object
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
  .strict();

/**
 * Manifest version 2: version 1 plus playback options and time rules. Written
 * only when a draft needs one of them. Every field is required. Frozen: a
 * released player parses it strictly.
 */
export const ManifestV2Schema = manifestV2Object.superRefine(checkManifestV2Body);
export type ManifestV2 = z.infer<typeof ManifestV2Schema>;

/**
 * A built-in app in the play list. Carries a copy of the app's content, not a
 * reference, so the player needs nothing else. No `assetId` on purpose: an app
 * is not media and never gets a download URL.
 */
export const ManifestAppItemSchema = z
  .object({
    kind: z.literal('app'),
    appId: AppIdSchema,
    durationMs: z.number().int().positive().max(ABSOLUTE.maxItemDurationMs),
    content: AppContentSchema,
  })
  .strict();
export type ManifestAppItem = z.infer<typeof ManifestAppItemSchema>;

export const ManifestItemV3Schema = z.union([ManifestAssetV2Schema, ManifestAppItemSchema]);
export type ManifestItemV3 = z.infer<typeof ManifestItemV3Schema>;

/**
 * Manifest version 3: version 2 plus app items. Written only when a draft holds
 * an app. Frozen.
 */
export const ManifestV3Schema = manifestV2Object
  .extend({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION_V3),
    assets: z.array(ManifestItemV3Schema).min(1).max(ABSOLUTE.maxPlaylistItems),
  })
  .strict()
  .superRefine(checkManifestV2Body);
export type ManifestV3 = z.infer<typeof ManifestV3Schema>;

/** One playlist of a scheduled manifest: a run of `count` consecutive entries of `assets`. */
export const ManifestSchedulePlaylistSchema = z
  .object({
    count: z.number().int().positive().max(ABSOLUTE.maxPlaylistItems),
    transition: TransitionSchema,
    shuffle: z.boolean(),
  })
  .strict();
export type ManifestSchedulePlaylist = z.infer<typeof ManifestSchedulePlaylistSchema>;

/** A weekly event of a scheduled manifest. `playlist` is an index into `schedule.playlists`. */
export const ManifestScheduleEventSchema = z
  .object({
    playlist: z.number().int().nonnegative().max(ABSOLUTE.maxScheduleEvents),
    ...scheduleRuleShape,
  })
  .strict()
  .superRefine(checkScheduleRule);
export type ManifestScheduleEvent = z.infer<typeof ManifestScheduleEventSchema>;

/**
 * The schedule of a manifest. `playlists` are consecutive slices of `assets`: `[0]` is the
 * default playlist, which plays whenever no event applies, and a playlist that is used several
 * times appears once. `events` are in priority order (see `eventCovers`). The server only
 * writes this block with two or more playlists; a player must handle one.
 *
 * No playlist id, no schedule id and no slice start: a player reads none of them.
 */
export const ManifestScheduleSchema = z
  .object({
    playlists: z
      .array(ManifestSchedulePlaylistSchema)
      .min(1)
      .max(ABSOLUTE.maxScheduleEvents + 1),
    events: z.array(ManifestScheduleEventSchema).min(1).max(ABSOLUTE.maxScheduleEvents),
  })
  .strict();
export type ManifestSchedule = z.infer<typeof ManifestScheduleSchema>;

/** Checks of version 4: those of version 2 over the flat list, plus the schedule block. */
function checkManifestV4Body(
  m: Pick<ManifestV3, 'canvas' | 'contentRect' | 'assets' | 'transition' | 'shuffle'> & {
    schedule: ManifestSchedule;
  },
  ctx: z.RefinementCtx,
): void {
  checkManifestV2Body(m, ctx);
  const { playlists, events } = m.schedule;
  if (playlists.reduce((sum, playlist) => sum + playlist.count, 0) !== m.assets.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['schedule', 'playlists'],
      message: 'playlist counts must add up to the number of assets',
    });
  }
  events.forEach((event, index) => {
    if (event.playlist >= playlists.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['schedule', 'events', index, 'playlist'],
        message: 'playlist must be an index into schedule.playlists',
      });
    }
  });
  const first = playlists[0];
  if (first !== undefined && (first.transition !== m.transition || first.shuffle !== m.shuffle)) {
    ctx.addIssue({
      code: 'custom',
      path: ['schedule', 'playlists', 0],
      message: 'the first playlist must carry the top-level transition and shuffle',
    });
  }
}

/**
 * Manifest version 4: version 3 plus `schedule`. Written only when the assigned schedule has
 * an event that uses a playlist other than its default. `assets` is every playlist's items in
 * one flat list, default playlist first; the top-level `transition` and `shuffle` are the
 * default playlist's. Frozen.
 */
export const ManifestV4Schema = manifestV2Object
  .extend({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION_V4),
    assets: z.array(ManifestItemV3Schema).min(1).max(ABSOLUTE.maxPlaylistItems),
    schedule: ManifestScheduleSchema,
  })
  .strict()
  .superRefine(checkManifestV4Body);
export type ManifestV4 = z.infer<typeof ManifestV4Schema>;

/**
 * One zone of a layout's manifest: a rectangle in canvas pixels, inside the content rectangle
 * (the whole canvas when there is none), and the next `count` entries of `assets`, played with
 * this zone's transition and shuffle. `zones[0]` is the main zone.
 */
export const ManifestZoneSchema = z
  .object({
    rect: RectSchema,
    count: z.number().int().positive().max(ABSOLUTE.maxPlaylistItems),
    transition: TransitionSchema,
    shuffle: z.boolean(),
  })
  .strict();
export type ManifestZone = z.infer<typeof ManifestZoneSchema>;

/** Checks of version 5: those of version 2 over the flat list, plus the zones. */
function checkManifestV5Body(
  m: Pick<ManifestV3, 'canvas' | 'contentRect' | 'assets' | 'transition' | 'shuffle'> & {
    zones: ManifestZone[];
  },
  ctx: z.RefinementCtx,
): void {
  checkManifestV2Body(m, ctx);
  if (m.zones.reduce((sum, zone) => sum + zone.count, 0) !== m.assets.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['zones'],
      message: 'zone counts must add up to the number of assets',
    });
  }
  const first = m.zones[0];
  if (first !== undefined && (first.transition !== m.transition || first.shuffle !== m.shuffle)) {
    ctx.addIssue({
      code: 'custom',
      path: ['zones', 0],
      message: 'the first zone must carry the top-level transition and shuffle',
    });
  }
  const area = m.contentRect ?? { x: 0, y: 0, width: m.canvas.width, height: m.canvas.height };
  m.zones.forEach((zone, i) => {
    const r = zone.rect;
    if (
      r.x < area.x ||
      r.y < area.y ||
      r.x + r.width > area.x + area.width ||
      r.y + r.height > area.y + area.height
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['zones', i, 'rect'],
        message: 'the zone must lie inside the content rectangle',
      });
    }
    if (m.zones.slice(0, i).some((other) => rectsOverlap(other.rect, r))) {
      ctx.addIssue({
        code: 'custom',
        path: ['zones', i, 'rect'],
        message: 'zones must not overlap',
      });
    }
  });
}

/**
 * Manifest version 5: version 3 plus `zones`. Written exactly when the screen has a layout
 * assigned. `assets` is every zone's items in one flat list, zone 0 (the main zone) first; the
 * top-level `transition` and `shuffle` are the main zone's. No layout id or name: a player reads
 * neither. Frozen once player 0.5.0 is released; the next addition is version 6.
 */
export const ManifestV5Schema = manifestV2Object
  .extend({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION_V5),
    assets: z.array(ManifestItemV3Schema).min(1).max(ABSOLUTE.maxPlaylistItems),
    zones: z.array(ManifestZoneSchema).min(2).max(ABSOLUTE.maxLayoutZones),
  })
  .strict()
  .superRefine(checkManifestV5Body);
export type ManifestV5 = z.infer<typeof ManifestV5Schema>;

export type ManifestItem = ManifestAssetV1 | ManifestAssetV2 | ManifestAppItem;

/** True for an image or video item, false for an app item. */
export function isMediaItem(item: ManifestItem): item is ManifestAssetV1 | ManifestAssetV2 {
  return item.kind !== 'app';
}

export const ManifestSchema = z.discriminatedUnion('schemaVersion', [
  ManifestV1Schema,
  ManifestV2Schema,
  ManifestV3Schema,
  ManifestV4Schema,
  ManifestV5Schema,
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

/** One playlist of a manifest as a run of `assets`: the entries `from` to `from + count - 1`. */
export interface ManifestPlaylistSlice {
  readonly from: number;
  readonly count: number;
  readonly transition: Transition;
  readonly shuffle: boolean;
}

/**
 * The playlists of any manifest, so player code has no version branches: version 4 gives one
 * slice per `schedule.playlists` entry (`[0]` is the default playlist), version 5 one slice per
 * zone (`[0]` is the main zone), versions 1 to 3 give one slice that is the whole list.
 */
export function manifestPlaylists(m: Manifest): ManifestPlaylistSlice[] {
  if (
    m.schemaVersion !== MANIFEST_SCHEMA_VERSION_V4 &&
    m.schemaVersion !== MANIFEST_SCHEMA_VERSION_V5
  ) {
    const { transition, shuffle } = manifestV2Facts(m);
    return [{ from: 0, count: m.assets.length, transition, shuffle }];
  }
  const runs = m.schemaVersion === MANIFEST_SCHEMA_VERSION_V4 ? m.schedule.playlists : m.zones;
  let from = 0;
  return runs.map((run) => {
    const slice = { from, count: run.count, transition: run.transition, shuffle: run.shuffle };
    from += run.count;
    return slice;
  });
}

/**
 * The zones of any manifest, each as a manifest a player can play on its own, so player code
 * has no version branches. Versions 1 to 4 give `[m]`, the same object. Version 5 gives one
 * version 3 view per zone: the zone's run of `assets`, the zone's transition and shuffle, and
 * the zone's rectangle as the content rectangle; every other field is copied from `m`.
 * Built on the player; never stored or sent.
 */
export function manifestZones(m: Manifest): Exclude<Manifest, ManifestV5>[] {
  if (m.schemaVersion !== MANIFEST_SCHEMA_VERSION_V5) return [m];
  let from = 0;
  return m.zones.map((zone): ManifestV3 => {
    const view: ManifestV3 = {
      schemaVersion: MANIFEST_SCHEMA_VERSION_V3,
      publicationId: m.publicationId,
      displayId: m.displayId,
      createdAt: m.createdAt,
      canvas: m.canvas,
      contentRect: zone.rect,
      muted: m.muted,
      timeZone: m.timeZone,
      transition: zone.transition,
      shuffle: zone.shuffle,
      rotation: m.rotation,
      workingHours: m.workingHours,
      assets: m.assets.slice(from, from + zone.count),
    };
    from += zone.count;
    return view;
  });
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
  let schema:
    | typeof ManifestV1Schema
    | typeof ManifestV2Schema
    | typeof ManifestV3Schema
    | typeof ManifestV4Schema
    | typeof ManifestV5Schema;
  switch (version.data.schemaVersion) {
    case MANIFEST_SCHEMA_VERSION:
      schema = ManifestV1Schema;
      break;
    case MANIFEST_SCHEMA_VERSION_V2:
      schema = ManifestV2Schema;
      break;
    case MANIFEST_SCHEMA_VERSION_V3:
      schema = ManifestV3Schema;
      break;
    case MANIFEST_SCHEMA_VERSION_V4:
      schema = ManifestV4Schema;
      break;
    case MANIFEST_SCHEMA_VERSION_V5:
      schema = ManifestV5Schema;
      break;
    default:
      return {
        ok: false,
        reason: 'unsupported_version',
        message: `manifest schemaVersion ${version.data.schemaVersion} is not supported (expected ${MANIFEST_SCHEMA_VERSION}, ${MANIFEST_SCHEMA_VERSION_V2}, ${MANIFEST_SCHEMA_VERSION_V3}, ${MANIFEST_SCHEMA_VERSION_V4} or ${MANIFEST_SCHEMA_VERSION_V5})`,
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
