import { describe, expect, it } from 'vitest';
import {
  ManifestV1Schema,
  ManifestV2Schema,
  ManifestV3Schema,
  ManifestV4Schema,
} from '@tinnox/contracts';
import { checkCapabilities } from './capability.ts';
import {
  EVERY_DAY,
  ID,
  WEEKDAYS,
  apps,
  display,
  library,
  limits,
  planSchedule,
  playback,
  tickerContent,
  type FixturePlaylist,
} from './fixtures.test-support.ts';
import type { AppRecord } from './types.ts';
import {
  buildManifest,
  manifestAssetIds,
  manifestStorageBytes,
  manifestVersionFor,
  needsV2,
  planPublication,
} from './manifest.ts';
import { buildPublicationDraft, validatePlaylist } from './playlist.ts';
import type { PublicationValidator } from './types.ts';

const image = (mediaId: string, durationMs: number | null = 5000) => ({
  mediaId,
  durationMs,
  fit: null,
});
const video = (mediaId: string) => ({ mediaId, durationMs: null, fit: null });
const app = (appId: string, durationMs = 10_000) => ({ appId, durationMs });

describe('validatePlaylist', () => {
  it('accepts images with durations and video with natural duration', () => {
    expect(
      validatePlaylist(
        [image(ID.jpeg), video(ID.video), image(ID.png, 1000)],
        library(),
        apps(),
        limits,
        {
          mode: 'publish',
        },
      ),
    ).toEqual([]);
  });

  it('allows an empty draft but not an empty publication', () => {
    expect(validatePlaylist([], library(), apps(), limits, { mode: 'draft' })).toEqual([]);
    expect(
      validatePlaylist([], library(), apps(), limits, { mode: 'publish' }).map((i) => i.code),
    ).toEqual(['playlist_empty']);
  });

  it('allows processing media in a draft but not in a publication', () => {
    expect(
      validatePlaylist([image(ID.processing)], library(), apps(), limits, { mode: 'draft' }),
    ).toEqual([]);
    const issues = validatePlaylist([image(ID.processing)], library(), apps(), limits, {
      mode: 'publish',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ index: 0, code: 'media_not_ready' });
  });

  it('reports missing and failed media with the item position', () => {
    const issues = validatePlaylist(
      [image(ID.jpeg), image('99999999-9999-4999-8999-999999999999'), image(ID.failed)],
      library(),
      apps(),
      limits,
      { mode: 'draft' },
    );
    expect(issues.map((i) => [i.index, i.code])).toEqual([
      [1, 'media_missing'],
      [2, 'media_failed'],
    ]);
    expect(issues[0]?.message).toContain('Item 2');
  });

  it('enforces image duration rules and forbids custom video durations', () => {
    const issues = validatePlaylist(
      [
        image(ID.jpeg, null),
        image(ID.jpeg, 999),
        image(ID.jpeg, 3_600_001),
        { mediaId: ID.video, durationMs: 4000, fit: null },
      ],
      library(),
      apps(),
      limits,
      { mode: 'publish' },
    );
    expect(issues.map((i) => i.code)).toEqual([
      'duration_required',
      'duration_out_of_range',
      'duration_out_of_range',
      'duration_not_allowed',
    ]);
  });

  it('accepts the boundary durations', () => {
    expect(
      validatePlaylist(
        [image(ID.jpeg, 1000), image(ID.jpeg, 3_600_000)],
        library(),
        apps(),
        limits,
        {
          mode: 'publish',
        },
      ),
    ).toEqual([]);
  });

  it('reports a missing app and an app duration out of range', () => {
    const issues = validatePlaylist(
      [
        app(ID.clock, 1000),
        app(ID.ticker, 3_600_000),
        app('99999999-9999-4999-8999-999999999999'),
        app(ID.clock, 999),
        app(ID.ticker, 3_600_001),
      ],
      library(),
      apps(),
      limits,
      { mode: 'publish' },
    );
    expect(issues.map((i) => [i.index, i.code])).toEqual([
      [2, 'app_missing'],
      [3, 'duration_out_of_range'],
      [4, 'duration_out_of_range'],
    ]);
    expect(issues[0]?.message).toBe('Item 3 refers to an app that does not exist or was deleted.');
    expect(issues[1]?.message).toBe(
      'Item 4 has a duration of 0.999 s; apps must be shown for 1 s to 3600 s.',
    );
  });

  it('enforces the item count limit', () => {
    const many = Array.from({ length: limits.maxPlaylistItems + 1 }, () => image(ID.jpeg));
    expect(
      validatePlaylist(many, library(), apps(), limits, { mode: 'draft' }).map((i) => i.code),
    ).toEqual(['too_many_items']);
  });
});

describe('buildPublicationDraft and buildManifest', () => {
  const created = { publicationId: ID.pubA, createdAt: new Date('2026-11-14T01:02:03.000Z') };

  it('resolves durations, default fit and asset facts in order', () => {
    const result = buildPublicationDraft(
      display({ defaultFit: 'cover' }),
      [
        image(ID.jpeg, 7000),
        video(ID.video),
        { mediaId: ID.png, durationMs: 2000, fit: 'contain' },
      ],
      library(),
      apps(),
      limits,
      playback,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.draft.items.map((i) => 'assetId' in i && [i.assetId, i.durationMs, i.fit]),
    ).toEqual([
      [ID.jpeg, 7000, 'cover'],
      [ID.video, 12_500, 'cover'],
      [ID.png, 2000, 'contain'],
    ]);
    const manifest = buildManifest(result.draft, created);
    expect(ManifestV1Schema.safeParse(manifest).success).toBe(true);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      publicationId: ID.pubA,
      displayId: ID.display,
      createdAt: '2026-11-14T01:02:03.000Z',
      canvas: { width: 1920, height: 1080 },
      contentRect: null,
      muted: true,
    });
    expect(manifest.assets[1]).toMatchObject({
      assetId: ID.video,
      mediaType: 'video/mp4',
      kind: 'video',
      bytes: 4_000_000,
      durationMs: 12_500,
    });
    const second = manifest.assets[1];
    expect(second !== undefined && 'sha256' in second && second.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('carries an unusual canvas and content rectangle into the manifest', () => {
    const result = buildPublicationDraft(
      display({
        canvas: { width: 640, height: 1344 },
        contentRect: { x: 0, y: 64, width: 640, height: 1280 },
      }),
      [image(ID.png)],
      library(),
      apps(),
      limits,
      playback,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest = buildManifest(result.draft, created);
    expect(manifest.canvas).toEqual({ width: 640, height: 1344 });
    expect(manifest.contentRect).toEqual({ x: 0, y: 64, width: 640, height: 1280 });
  });

  it('refuses unready media and returns every issue', () => {
    const result = buildPublicationDraft(
      display(),
      [image(ID.processing), image(ID.failed)],
      library(),
      apps(),
      limits,
      playback,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toEqual(['media_not_ready', 'media_failed']);
  });

  it('refuses a ready record with missing inspection data', () => {
    const lib = library();
    const jpeg = lib.get(ID.jpeg);
    if (jpeg === undefined) throw new Error('fixture');
    lib.set(ID.jpeg, { ...jpeg, sha256: null });
    const result = buildPublicationDraft(
      display(),
      [image(ID.jpeg)],
      lib,
      apps(),
      limits,
      playback,
    );
    expect(result.ok).toBe(false);
  });

  it('does not change a built manifest when the draft inputs change afterwards', () => {
    const lib = library();
    const items = [image(ID.jpeg, 5000)];
    const result = buildPublicationDraft(display(), items, lib, apps(), limits, playback);
    if (!result.ok) throw new Error('expected ok');
    const manifest = buildManifest(result.draft, created);
    const snapshot = JSON.stringify(manifest);
    items[0] = image(ID.png, 9000);
    lib.delete(ID.jpeg);
    expect(JSON.stringify(manifest)).toBe(snapshot);
  });

  it('counts repeated assets once for storage and lists distinct ids', () => {
    const result = buildPublicationDraft(
      display(),
      [image(ID.jpeg), image(ID.png), image(ID.jpeg, 2000)],
      library(),
      apps(),
      limits,
      playback,
    );
    if (!result.ok) throw new Error('expected ok');
    const manifest = buildManifest(result.draft, created);
    expect(manifestAssetIds(manifest)).toEqual([ID.jpeg, ID.png]);
    expect(manifestStorageBytes(manifest)).toBe(120_000 + 300_000);
  });
});

describe('manifest v3 (apps)', () => {
  const created = { publicationId: ID.pubA, createdAt: new Date('2026-11-14T01:02:03.000Z') };
  const draftOf = (
    items: Parameters<typeof validatePlaylist>[0],
    appsById = apps(),
    l = limits,
  ) => {
    const r = buildPublicationDraft(display(), items, library(), appsById, l, playback);
    if (!r.ok) throw new Error(`fixture draft should build: ${r.issues[0]?.code}`);
    return r.draft;
  };

  it('gives version 1, 2 and 3', () => {
    expect(manifestVersionFor(draftOf([image(ID.jpeg)]))).toBe(1);
    const lib = library();
    const jpeg = lib.get(ID.jpeg);
    if (jpeg === undefined) throw new Error('fixture');
    lib.set(ID.jpeg, { ...jpeg, availableFrom: '2026-12-01T09:00' });
    const windowed = buildPublicationDraft(
      display(),
      [image(ID.jpeg)],
      lib,
      apps(),
      limits,
      playback,
    );
    if (!windowed.ok) throw new Error('fixture');
    expect(manifestVersionFor(windowed.draft)).toBe(2);
    expect(manifestVersionFor(draftOf([image(ID.jpeg), app(ID.clock)]))).toBe(3);
    expect(manifestVersionFor(draftOf([app(ID.clock)]))).toBe(3);
  });

  it('builds a v3 manifest that parses, with media and apps in their positions', () => {
    const manifest = buildManifest(
      draftOf([image(ID.jpeg), app(ID.ticker, 15_000), video(ID.video), app(ID.clock)]),
      created,
    );
    expect(ManifestV3Schema.safeParse(manifest).success).toBe(true);
    expect(manifest).toMatchObject({ schemaVersion: 3, timeZone: 'Australia/Melbourne' });
    expect(manifest.assets.map((a) => a.kind)).toEqual(['image', 'app', 'video', 'app']);
    expect(manifest.assets[1]).toEqual({
      kind: 'app',
      appId: ID.ticker,
      durationMs: 15_000,
      content: tickerContent,
    });
    expect(manifest.assets[0]).toMatchObject({ assetId: ID.jpeg, availableFrom: null });
    expect(manifestAssetIds(manifest)).toEqual([ID.jpeg, ID.video]);
    expect(manifestStorageBytes(manifest)).toBe(120_000 + 4_000_000);
  });

  it('keeps the worst case (500 tickers of 300 euro signs) under 600 KB of JSON', () => {
    const text = '\u20ac'.repeat(300);
    const records: AppRecord[] = Array.from({ length: 500 }, (_, i) => ({
      id: `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`,
      content: { type: 'ticker', settings: { ...tickerContent.settings, text } },
    }));
    const draft = draftOf(
      records.map((r) => app(r.id)),
      new Map(records.map((r) => [r.id, r])),
      { ...limits, maxPlaylistItems: 500 },
    );
    const manifest = buildManifest(draft, created);
    expect(new TextEncoder().encode(JSON.stringify(manifest)).length).toBeLessThan(600 * 1024);
  });
});

describe('manifest v4 (schedules)', () => {
  const created = { publicationId: ID.pubA, createdAt: new Date('2026-11-14T01:02:03.000Z') };
  const PLAYLISTS: Record<string, FixturePlaylist> = {
    [ID.listDefault]: {
      name: 'Reception loop',
      items: [image(ID.jpeg), app(ID.clock)],
      playback: { transition: 'fade', shuffle: false },
    },
    [ID.listLunch]: {
      name: 'Lunch',
      items: [video(ID.video), image(ID.png), image(ID.jpeg, 3000)],
      playback: { transition: 'cut', shuffle: true },
    },
  };
  const lunch = { playlistId: ID.listLunch, days: WEEKDAYS, start: '11:30', end: '14:00' };
  const draftOf = (
    events: Parameters<typeof planSchedule>[1]['events'],
    options: Parameters<typeof planSchedule>[2] = {},
    playlists = PLAYLISTS,
  ) => {
    const r = planSchedule(playlists, { defaultPlaylistId: ID.listDefault, events }, options);
    if (!r.ok) throw new Error(`fixture schedule should plan: ${r.issues[0]?.code}`);
    return r.draft;
  };

  it('gives version 4 only with a schedule', () => {
    expect(manifestVersionFor(draftOf([lunch]))).toBe(4);
    // Without an event that uses another playlist the draft is the default playlist's.
    expect(manifestVersionFor(draftOf([]))).toBe(3);
    expect(manifestVersionFor(draftOf([{ ...lunch, playlistId: ID.listDefault }]))).toBe(3);
    // The schedule alone decides: no app, no v2 option and still version 4.
    const plain = draftOf(
      [lunch],
      {},
      {
        [ID.listDefault]: { name: 'Reception loop', items: [image(ID.jpeg)] },
        [ID.listLunch]: { name: 'Lunch', items: [image(ID.png)] },
      },
    );
    expect(needsV2(plain)).toBe(false);
    expect(manifestVersionFor(plain)).toBe(4);
    expect(manifestVersionFor({ ...plain, schedule: null })).toBe(1);
  });

  it('builds a v4 manifest that parses, with the playlists as runs of one list', () => {
    const night = { playlistId: ID.listLunch, days: EVERY_DAY, start: '22:00', end: '02:00' };
    const draft = draftOf([lunch, night]);
    const manifest = buildManifest(draft, created);
    expect(ManifestV4Schema.safeParse(manifest).success).toBe(true);
    expect(manifest).toMatchObject({
      schemaVersion: 4,
      timeZone: 'Australia/Melbourne',
      transition: 'fade',
      shuffle: false,
      schedule: {
        playlists: [
          { count: 2, transition: 'fade', shuffle: false },
          { count: 3, transition: 'cut', shuffle: true },
        ],
        events: [
          { playlist: 1, days: WEEKDAYS, start: '11:30', end: '14:00' },
          { playlist: 1, days: EVERY_DAY, start: '22:00', end: '02:00' },
        ],
      },
    });
    expect(manifest.assets.map((a) => a.kind)).toEqual(['image', 'app', 'video', 'image', 'image']);
    // Every playlist's media is in the one list, so staging and storage need no schedule.
    expect(manifestAssetIds(manifest)).toEqual([ID.jpeg, ID.video, ID.png]);
    expect(manifestStorageBytes(manifest)).toBe(120_000 + 4_000_000 + 300_000);
    // A copy: the manifest does not change when the draft does.
    const snapshot = JSON.stringify(manifest);
    (draft.schedule?.events[0]?.days as boolean[] | undefined)?.fill(false);
    expect(JSON.stringify(manifest)).toBe(snapshot);
  });

  it('throws on a site time zone the runtime does not know', () => {
    const draft = draftOf([lunch], { display: display({ timeZone: 'Mars/Olympus_Mons' }) });
    expect(() => buildManifest(draft, created)).toThrow(RangeError);
  });

  it('keeps the worst case (200 tickers of 300 euro signs in five playlists, 50 events) under 300 KB of JSON', () => {
    const text = '\u20ac'.repeat(300);
    const records: AppRecord[] = Array.from({ length: 200 }, (_, i) => ({
      id: `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`,
      content: { type: 'ticker', settings: { ...tickerContent.settings, text } },
    }));
    const listId = (n: number) => `66666666-6666-4666-8666-${String(n).padStart(12, '0')}`;
    const playlists: Record<string, FixturePlaylist> = Object.fromEntries(
      Array.from({ length: 5 }, (_, n) => [
        listId(n),
        { name: `Playlist ${n}`, items: records.slice(n * 40, n * 40 + 40).map((r) => app(r.id)) },
      ]),
    );
    const plan = planSchedule(
      playlists,
      {
        defaultPlaylistId: listId(0),
        events: Array.from({ length: 50 }, (_, n) => ({
          playlistId: listId(n % 5),
          days: EVERY_DAY,
          start: '22:00',
          end: '02:00',
        })),
      },
      { appsById: new Map(records.map((r) => [r.id, r])) },
    );
    if (!plan.ok) throw new Error(`fixture schedule should plan: ${plan.issues[0]?.code}`);
    const manifest = buildManifest(plan.draft, created);
    expect(manifest).toMatchObject({ schemaVersion: 4 });
    expect(manifest.assets).toHaveLength(200);
    expect(new TextEncoder().encode(JSON.stringify(manifest)).length).toBeLessThan(300 * 1024);
  });
});

describe('manifest version', () => {
  const created = { publicationId: ID.pubA, createdAt: new Date('2026-11-14T01:02:03.000Z') };
  const draftWith = (
    d = display(),
    options = playback,
    lib = library(),
  ): Parameters<typeof buildManifest>[0] => {
    const r = buildPublicationDraft(
      d,
      [image(ID.jpeg), video(ID.video)],
      lib,
      apps(),
      limits,
      options,
    );
    if (!r.ok) throw new Error('fixture draft should build');
    return r.draft;
  };

  it('writes v1 at the defaults and v2 when any v2 option or time rule is used', () => {
    const lib = library();
    const jpeg = lib.get(ID.jpeg);
    if (jpeg === undefined) throw new Error('fixture');
    lib.set(ID.jpeg, { ...jpeg, availableUntil: '2026-12-24T18:00' });
    const hours = [{ start: '09:00', end: '17:00' }, null, null, null, null, null, null];
    expect(needsV2(draftWith())).toBe(false);
    expect(buildManifest(draftWith(), created).schemaVersion).toBe(1);
    for (const draft of [
      draftWith(display(), { transition: 'fade', shuffle: false }),
      draftWith(display(), { transition: 'cut', shuffle: true }),
      draftWith(display({ rotation: 270 })),
      draftWith(display({ workingHours: hours })),
      draftWith(display(), playback, lib),
    ]) {
      expect(needsV2(draft)).toBe(true);
    }
  });

  it('builds a v2 manifest that parses, with the facts carried through', () => {
    const lib = library();
    const jpeg = lib.get(ID.jpeg);
    if (jpeg === undefined) throw new Error('fixture');
    lib.set(ID.jpeg, { ...jpeg, availableFrom: '2026-12-01T09:00' });
    const manifest = buildManifest(
      draftWith(display({ rotation: 90 }), { transition: 'fade', shuffle: true }, lib),
      created,
    );
    expect(ManifestV2Schema.safeParse(manifest).success).toBe(true);
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      timeZone: 'Australia/Melbourne',
      transition: 'fade',
      shuffle: true,
      rotation: 90,
      workingHours: null,
    });
    expect(manifest.assets.map((a) => ('availableFrom' in a ? a.availableFrom : 'v1'))).toEqual([
      '2026-12-01T09:00',
      null,
    ]);
  });

  it('throws on a site time zone the runtime does not know when v2 is needed', () => {
    const d = draftWith(display({ timeZone: 'Mars/Olympus_Mons' }), {
      transition: 'fade',
      shuffle: false,
    });
    expect(() => buildManifest(d, created)).toThrow(RangeError);
  });
});

describe('planPublication', () => {
  it('asks the route and passes its rejection through', () => {
    const calls: number[] = [];
    const route: PublicationValidator = {
      capabilities: () => {
        throw new Error('not needed');
      },
      validate: (draft) => {
        calls.push(draft.items.length);
        return [{ index: 0, code: 'unsupported_media_type', message: 'no' }];
      },
    };
    const result = planPublication({
      display: display(),
      items: [image(ID.jpeg)],
      mediaById: library(),
      appsById: apps(),
      limits,
      playback,
      route,
    });
    expect(calls).toEqual([1]);
    expect(result.ok).toBe(false);
  });

  it('does not consult the route when the playlist itself is invalid', () => {
    const route: PublicationValidator = {
      capabilities: () => {
        throw new Error('not needed');
      },
      validate: () => {
        throw new Error('must not be called');
      },
    };
    const result = planPublication({
      display: display(),
      items: [],
      mediaById: library(),
      appsById: apps(),
      limits,
      playback,
      route,
    });
    expect(result.ok).toBe(false);
  });
});

describe('checkCapabilities', () => {
  const profile = {
    routeId: 'browser' as const,
    profileVersion: 1,
    label: 'The browser player',
    mediaTypes: ['image/jpeg' as const, 'image/png' as const, 'video/mp4' as const],
    videoCodecs: ['h264'],
    fitModes: ['contain' as const, 'cover' as const],
    maxRegions: 1,
    audio: false,
    supportsContentRect: true,
    maxCanvas: { width: 16384, height: 16384 },
    maxVideoWidthPx: 3840,
    maxVideoHeightPx: 2160,
    maxAssetBytes: 200 * 1024 * 1024,
    maxItems: 200,
  };
  const draftOf = (
    items: { mediaId: string; durationMs: number | null; fit: null }[],
    d = display(),
  ) => {
    const r = buildPublicationDraft(d, items, library(), apps(), limits, playback);
    if (!r.ok) throw new Error('fixture draft should build');
    return r.draft;
  };

  it('accepts a supported draft', () => {
    expect(checkCapabilities(draftOf([image(ID.jpeg), video(ID.video)]), profile)).toEqual([]);
  });

  it('explains an unsupported codec in plain words', () => {
    const issues = checkCapabilities(draftOf([video(ID.hevc)]), profile);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('unsupported_codec');
    expect(issues[0]?.message).toBe(
      'Item 1 uses the video codec hevc, which The browser player cannot play. Supported codecs: h264.',
    );
  });

  it('rejects media types, content rectangles, canvases and sizes the profile lacks', () => {
    const narrow = {
      ...profile,
      label: 'A limited target',
      mediaTypes: ['image/png' as const],
      fitModes: ['cover' as const],
      supportsContentRect: false,
      maxCanvas: { width: 1024, height: 1024 },
      maxAssetBytes: 100_000,
      maxItems: 1,
    };
    const draft = draftOf(
      [image(ID.jpeg), image(ID.png)],
      display({ contentRect: { x: 0, y: 0, width: 100, height: 100 } }),
    );
    expect(checkCapabilities(draft, narrow).map((i) => i.code)).toEqual([
      'canvas_too_large',
      'content_rect_unsupported',
      'too_many_items',
      'unsupported_media_type',
      'unsupported_fit',
      'asset_too_large',
    ]);
  });

  it('counts the items of a playlist, and of a schedule in the words of a schedule', () => {
    const three = draftOf([image(ID.jpeg), image(ID.png), video(ID.video)]);
    const tight = { ...profile, maxItems: 2 };
    expect(checkCapabilities(three, tight)).toEqual([
      {
        index: null,
        code: 'too_many_items',
        message: 'The playlist has 3 items; The browser player supports up to 2.',
      },
    ]);
    const scheduled = {
      ...three,
      schedule: {
        playlists: [
          { count: 1, transition: 'cut' as const, shuffle: false },
          { count: 2, transition: 'cut' as const, shuffle: false },
        ],
        events: [{ playlist: 1, days: EVERY_DAY, start: '09:00', end: '17:00' }],
      },
    };
    expect(checkCapabilities(scheduled, tight).map((i) => i.message)).toEqual([
      'The playlists of this schedule hold 3 items in total; The browser player supports up to 2.',
    ]);
    expect(checkCapabilities(scheduled, profile)).toEqual([]);
  });

  it('skips app items', () => {
    const r = buildPublicationDraft(
      display(),
      [app(ID.clock), image(ID.png)],
      library(),
      apps(),
      limits,
      playback,
    );
    if (!r.ok) throw new Error('fixture draft should build');
    expect(checkCapabilities(r.draft, { ...profile, mediaTypes: ['image/png' as const] })).toEqual(
      [],
    );
  });

  it('rejects video above the profile resolution', () => {
    const issues = checkCapabilities(draftOf([video(ID.video)]), {
      ...profile,
      maxVideoWidthPx: 1280,
      maxVideoHeightPx: 720,
    });
    expect(issues.map((i) => i.code)).toEqual(['video_resolution_too_large']);
  });
});
