import {
  ABSOLUTE,
  DEFAULT_LIMITS,
  type AppContent,
  type CapabilityProfile,
  type HeartbeatV1,
  type Limits,
} from '@tinnox/contracts';
import { checkCapabilities } from './capability.ts';
import { planLayoutPublication, type LayoutPlanInput } from './layout.ts';
import { planPublication, type PlanPublicationResult } from './manifest.ts';
import { planSchedulePublication, type SchedulePlanInput } from './schedule.ts';
import type { PlanPlaylist } from './sources.ts';
import type {
  AppRecord,
  DisplayTarget,
  DraftItem,
  MediaRecord,
  PlaybackOptions,
  PublicationValidator,
} from './types.ts';

export const limits: Limits = DEFAULT_LIMITS;

/** Playlist options at their defaults, which keep a publication at manifest v1. */
export const playback: PlaybackOptions = { transition: 'cut', shuffle: false };

export const ID = {
  display: '11111111-1111-4111-8111-111111111111',
  otherDisplay: '11111111-1111-4111-8111-222222222222',
  jpeg: '22222222-2222-4222-8222-000000000001',
  png: '22222222-2222-4222-8222-000000000002',
  video: '22222222-2222-4222-8222-000000000003',
  processing: '22222222-2222-4222-8222-000000000004',
  failed: '22222222-2222-4222-8222-000000000005',
  hevc: '22222222-2222-4222-8222-000000000006',
  clock: '55555555-5555-4555-8555-000000000001',
  ticker: '55555555-5555-4555-8555-000000000002',
  pubA: '33333333-3333-4333-8333-00000000000a',
  pubB: '33333333-3333-4333-8333-00000000000b',
  regA: '44444444-4444-4444-8444-00000000000a',
  regB: '44444444-4444-4444-8444-00000000000b',
  listDefault: '66666666-6666-4666-8666-00000000000a',
  listLunch: '66666666-6666-4666-8666-00000000000b',
  listEvening: '66666666-6666-4666-8666-00000000000c',
  listBand: '66666666-6666-4666-8666-00000000000d',
} as const;

export function display(overrides: Partial<DisplayTarget> = {}): DisplayTarget {
  return {
    id: ID.display,
    canvas: { width: 1920, height: 1080 },
    contentRect: null,
    defaultFit: 'contain',
    route: 'browser',
    rotation: 0,
    workingHours: null,
    timeZone: 'Australia/Melbourne',
    ...overrides,
  };
}

function media(id: string, overrides: Partial<MediaRecord>): MediaRecord {
  return {
    id,
    kind: 'image',
    status: 'ready',
    mimeType: 'image/jpeg',
    bytes: 120_000,
    sha256: id.replace(/-/g, '').padEnd(64, 'a'),
    width: 1600,
    height: 900,
    durationMs: null,
    codec: null,
    availableFrom: null,
    availableUntil: null,
    ...overrides,
  };
}

export function library(): Map<string, MediaRecord> {
  const records = [
    media(ID.jpeg, {}),
    media(ID.png, { mimeType: 'image/png', width: 640, height: 1344, bytes: 300_000 }),
    media(ID.video, {
      kind: 'video',
      mimeType: 'video/mp4',
      codec: 'h264',
      durationMs: 12_500,
      width: 1920,
      height: 1080,
      bytes: 4_000_000,
    }),
    media(ID.processing, {
      status: 'processing',
      mimeType: null,
      bytes: null,
      sha256: null,
      width: null,
      height: null,
    }),
    media(ID.failed, {
      status: 'failed',
      mimeType: null,
      bytes: null,
      sha256: null,
      width: null,
      height: null,
    }),
    media(ID.hevc, {
      kind: 'video',
      mimeType: 'video/mp4',
      codec: 'hevc',
      durationMs: 8_000,
      width: 1920,
      height: 1080,
    }),
  ];
  return new Map(records.map((r) => [r.id, r]));
}

export const clockContent: AppContent = {
  type: 'clock',
  settings: {
    hourCycle: '12',
    showSeconds: false,
    textColour: '#ffffff',
    backgroundColour: '#000000',
  },
};

export const tickerContent = {
  type: 'ticker',
  settings: {
    text: 'Doors open at nine',
    speed: 'medium',
    textColour: '#ffffff',
    backgroundColour: '#1d1d1f',
  },
} satisfies AppContent;

export function apps(): Map<string, AppRecord> {
  const records: AppRecord[] = [
    { id: ID.clock, content: clockContent },
    { id: ID.ticker, content: tickerContent },
  ];
  return new Map(records.map((r) => [r.id, r]));
}

export function heartbeat(overrides: Partial<HeartbeatV1> = {}): HeartbeatV1 {
  return {
    schemaVersion: 1,
    seq: 1,
    sentAt: '2026-11-14T00:00:00.000Z',
    displayId: ID.display,
    downloadedPublicationId: ID.pubA,
    activePublicationId: ID.pubA,
    activeItemIndex: 0,
    playerState: 'playing',
    staging: null,
    errors: [],
    player: { version: 'test', storagePersisted: true, online: true },
    ...overrides,
  };
}

/**
 * A route with the browser player's profile and the given item total and region count. One
 * region by default, so a test double still refuses a layout (`multiple_regions_unsupported`).
 */
export function route(maxItems = 200, maxRegions = 1): PublicationValidator {
  const profile: CapabilityProfile = {
    routeId: 'browser',
    profileVersion: 1,
    label: 'The browser player',
    mediaTypes: ['image/jpeg', 'image/png', 'video/mp4'],
    videoCodecs: ['h264'],
    fitModes: ['contain', 'cover'],
    maxRegions,
    audio: false,
    supportsContentRect: true,
    maxCanvas: { width: 16384, height: 16384 },
    maxVideoWidthPx: 3840,
    maxVideoHeightPx: 2160,
    maxAssetBytes: 200 * 1024 * 1024,
    maxItems,
  };
  return { capabilities: () => profile, validate: (draft) => checkCapabilities(draft, profile) };
}

export const WEEKDAYS: readonly boolean[] = [true, true, true, true, true, false, false];
export const EVERY_DAY: readonly boolean[] = [true, true, true, true, true, true, true];

export interface FixturePlaylist {
  readonly name: string;
  readonly items: readonly DraftItem[];
  /** Defaults to `playback`. */
  readonly playback?: PlaybackOptions;
}

export interface PlanScheduleOptions {
  readonly display?: DisplayTarget;
  readonly mediaById?: ReadonlyMap<string, MediaRecord>;
  readonly appsById?: ReadonlyMap<string, AppRecord>;
  readonly route?: PublicationValidator;
}

/**
 * Plans each of the given playlists (keyed by id) as the API does: through `planPublication`
 * for the display; an id that is not in the map no longer exists.
 */
function planPlaylistOf(
  playlists: Readonly<Record<string, FixturePlaylist>>,
  options: PlanScheduleOptions,
  target: PublicationValidator,
): PlanPlaylist {
  return (id) => {
    const playlist = playlists[id];
    if (playlist === undefined) return undefined;
    return {
      name: playlist.name,
      itemCount: playlist.items.length,
      plan: () =>
        planPublication({
          display: options.display ?? display(),
          items: playlist.items,
          mediaById: options.mediaById ?? library(),
          appsById: options.appsById ?? apps(),
          limits,
          playback: playlist.playback ?? playback,
          route: target,
        }),
    };
  };
}

/** Plans a schedule over the given playlists (keyed by id) as the API does. */
export function planSchedule(
  playlists: Readonly<Record<string, FixturePlaylist>>,
  schedule: Pick<SchedulePlanInput, 'defaultPlaylistId' | 'events'>,
  options: PlanScheduleOptions = {},
): PlanPublicationResult {
  const target = options.route ?? route();
  return planSchedulePublication({
    ...schedule,
    planPlaylist: planPlaylistOf(playlists, options, target),
    route: target,
  });
}

/**
 * A main zone and a band along the bottom, `percent` of the height, in basis points: what the
 * portal's one preset writes (same arguments as its `bandZones`).
 */
export function bandZones(
  percent: number,
  mainPlaylistId: string,
  bandPlaylistId: string,
): LayoutPlanInput['zones'] {
  const band = percent * 100;
  return [
    { playlistId: mainPlaylistId, x: 0, y: 0, width: 10_000, height: 10_000 - band },
    { playlistId: bandPlaylistId, x: 0, y: 10_000 - band, width: 10_000, height: band },
  ];
}

/**
 * Plans a layout over the given playlists (keyed by id) on the display (`options.display`) as
 * the API does. The route takes ABSOLUTE.maxLayoutZones regions unless `options.route` is given.
 */
export function planLayout(
  playlists: Readonly<Record<string, FixturePlaylist>>,
  zones: LayoutPlanInput['zones'],
  options: PlanScheduleOptions = {},
): PlanPublicationResult {
  const target = options.route ?? route(200, ABSOLUTE.maxLayoutZones);
  const { canvas, contentRect } = options.display ?? display();
  return planLayoutPublication({
    canvas,
    contentRect,
    zones,
    planPlaylist: planPlaylistOf(playlists, options, target),
    route: target,
  });
}
