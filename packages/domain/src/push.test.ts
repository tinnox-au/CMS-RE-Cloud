import { describe, expect, it } from 'vitest';
import type { FitMode, Manifest, ManifestAssetV1, ManifestV1 } from '@tinnox/contracts';
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
import { buildManifest, type PlanPublicationResult } from './manifest.ts';
import { buildPublicationDraft } from './playlist.ts';
import { decidePushState, draftMatchesManifest, firstDraftManifestDifference } from './push.ts';
import type {
  AppRecord,
  DisplayTarget,
  DraftItem,
  MediaRecord,
  PlaybackOptions,
  PublicationDraft,
} from './types.ts';

const image = (
  mediaId: string,
  durationMs: number | null = 5000,
  fit: FitMode | null = null,
): DraftItem => ({ mediaId, durationMs, fit });
const video = (mediaId: string, fit: FitMode | null = null): DraftItem => ({
  mediaId,
  durationMs: null,
  fit,
});

/** The playlist most cases start from: an image, a video, another image. */
const BASE: readonly DraftItem[] = [image(ID.jpeg), video(ID.video), image(ID.png, 8000, 'cover')];

function draftOf(
  items: readonly DraftItem[] = BASE,
  target: DisplayTarget = display(),
  options: PlaybackOptions = playback,
  mediaById: ReadonlyMap<string, MediaRecord> = library(),
): PublicationDraft {
  const built = buildPublicationDraft(target, items, mediaById, apps(), limits, options);
  if (!built.ok) throw new Error(`fixture playlist is not publishable: ${built.issues[0]?.code}`);
  return built.draft;
}

/** The manifest a display holds after `draft` was published. */
function published(draft: PublicationDraft): Manifest {
  return buildManifest(draft, {
    publicationId: ID.pubA,
    createdAt: new Date('2026-11-14T00:00:00.000Z'),
  });
}

/** The v1 manifest a display holds after `items` were published to `target`. */
function publishedManifest(
  items: readonly DraftItem[] = BASE,
  target: DisplayTarget = display(),
): ManifestV1 {
  const manifest = published(draftOf(items, target));
  if (manifest.schemaVersion !== 1) throw new Error('fixture should publish v1');
  return manifest;
}

/** A stored manifest whose entry at `index` differs in the given facts. */
function withAsset(
  manifest: ManifestV1,
  index: number,
  change: Partial<ManifestAssetV1>,
): ManifestV1 {
  return {
    ...manifest,
    assets: manifest.assets.map((asset, i) => (i === index ? { ...asset, ...change } : asset)),
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('draftMatchesManifest', () => {
  it('matches the manifest that was built from the same playlist and display', () => {
    expect(firstDraftManifestDifference(draftOf(), publishedManifest())).toBeNull();
    expect(draftMatchesManifest(draftOf(), publishedManifest())).toBe(true);
  });

  it('ignores the publication id and the time of publication', () => {
    const later = buildManifest(draftOf(), {
      publicationId: ID.pubB,
      createdAt: new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(draftMatchesManifest(draftOf(), later)).toBe(true);
  });

  it('matches a manifest that went through JSON, as a stored one has', () => {
    const stored = JSON.parse(JSON.stringify(publishedManifest())) as ManifestV1;
    expect(draftMatchesManifest(draftOf(), stored)).toBe(true);
  });

  it('compares identifiers without regard to letter case', () => {
    const manifest = publishedManifest();
    const shouted: ManifestV1 = {
      ...manifest,
      displayId: manifest.displayId.toUpperCase(),
      assets: manifest.assets.map((asset) => ({ ...asset, assetId: asset.assetId.toUpperCase() })),
    };
    expect(draftMatchesManifest(draftOf(), shouted)).toBe(true);
  });

  it('sees reordered items', () => {
    const reordered = [BASE[1]!, BASE[0]!, BASE[2]!];
    expect(firstDraftManifestDifference(draftOf(reordered), publishedManifest())).toEqual({
      kind: 'item',
      index: 0,
      field: 'assetId',
    });
    expect(draftMatchesManifest(draftOf(reordered), publishedManifest())).toBe(false);
  });

  it('sees a reordering that only swaps the last two items', () => {
    const reordered = [BASE[0]!, BASE[2]!, BASE[1]!];
    expect(firstDraftManifestDifference(draftOf(reordered), publishedManifest())).toMatchObject({
      kind: 'item',
      index: 1,
    });
  });

  it('sees an added and a removed item', () => {
    const longer = [...BASE, image(ID.jpeg, 3000)];
    expect(firstDraftManifestDifference(draftOf(longer), publishedManifest())).toEqual({
      kind: 'item_count',
      draftItems: 4,
      manifestItems: 3,
    });
    const shorter = BASE.slice(0, 2);
    expect(firstDraftManifestDifference(draftOf(shorter), publishedManifest())).toEqual({
      kind: 'item_count',
      draftItems: 2,
      manifestItems: 3,
    });
  });

  it('sees an item replaced by another file', () => {
    const replaced = [BASE[0]!, BASE[1]!, image(ID.jpeg, 8000, 'cover')];
    expect(firstDraftManifestDifference(draftOf(replaced), publishedManifest())).toEqual({
      kind: 'item',
      index: 2,
      field: 'assetId',
    });
  });

  it('sees a changed image duration, down to one millisecond', () => {
    const changed = [image(ID.jpeg, 5001), BASE[1]!, BASE[2]!];
    expect(firstDraftManifestDifference(draftOf(changed), publishedManifest())).toEqual({
      kind: 'item',
      index: 0,
      field: 'durationMs',
    });
  });

  it('sees a changed fit on one item', () => {
    const changed = [BASE[0]!, video(ID.video, 'cover'), BASE[2]!];
    expect(firstDraftManifestDifference(draftOf(changed), publishedManifest())).toEqual({
      kind: 'item',
      index: 1,
      field: 'fit',
    });
  });

  it('sees a fit that changed because the display default changed', () => {
    // Items 0 and 1 leave the fit to the display; item 2 sets its own.
    const coverByDefault = display({ defaultFit: 'cover' });
    expect(
      firstDraftManifestDifference(draftOf(BASE, coverByDefault), publishedManifest()),
    ).toEqual({ kind: 'item', index: 0, field: 'fit' });
    // A playlist in which every item sets its own fit is untouched by the default.
    const explicit = [image(ID.jpeg, 5000, 'contain'), video(ID.video, 'cover')];
    expect(
      draftMatchesManifest(draftOf(explicit, coverByDefault), publishedManifest(explicit)),
    ).toBe(true);
  });

  it('treats a fit left to the display and the same fit set on the item as equal', () => {
    const inherited = [image(ID.jpeg, 5000, null)];
    const explicit = [image(ID.jpeg, 5000, 'contain')];
    expect(draftMatchesManifest(draftOf(explicit), publishedManifest(inherited))).toBe(true);
    expect(
      draftMatchesManifest(
        draftOf(inherited, display({ defaultFit: 'cover' })),
        publishedManifest([image(ID.jpeg, 5000, 'cover')]),
      ),
    ).toBe(true);
  });

  it('sees a changed canvas, in either dimension', () => {
    for (const canvas of [
      { width: 1080, height: 1080 },
      { width: 1920, height: 1200 },
      { width: 1080, height: 1920 },
    ]) {
      expect(
        firstDraftManifestDifference(draftOf(BASE, display({ canvas })), publishedManifest()),
        JSON.stringify(canvas),
      ).toEqual({ kind: 'canvas' });
    }
  });

  it('sees a content rectangle that was added, removed, moved or resized', () => {
    const rect = { x: 0, y: 60, width: 1920, height: 960 };
    const withRect = display({ contentRect: rect });
    expect(firstDraftManifestDifference(draftOf(BASE, withRect), publishedManifest())).toEqual({
      kind: 'content_rect',
    });
    expect(firstDraftManifestDifference(draftOf(), publishedManifest(BASE, withRect))).toEqual({
      kind: 'content_rect',
    });
    for (const changed of [
      { ...rect, x: 16 },
      { ...rect, y: 0 },
      { ...rect, width: 1280 },
      { ...rect, height: 480 },
    ]) {
      expect(
        draftMatchesManifest(
          draftOf(BASE, display({ contentRect: changed })),
          publishedManifest(BASE, withRect),
        ),
        JSON.stringify(changed),
      ).toBe(false);
    }
    // Equal by value, not by identity.
    expect(
      draftMatchesManifest(
        draftOf(BASE, display({ contentRect: { ...rect } })),
        publishedManifest(BASE, withRect),
      ),
    ).toBe(true);
  });

  it('handles repeated assets: the same repeats match, and each repeat is compared in place', () => {
    const repeated = [image(ID.jpeg, 5000), video(ID.video), image(ID.jpeg, 9000, 'cover')];
    expect(draftMatchesManifest(draftOf(repeated), publishedManifest(repeated))).toBe(true);

    // One repeat fewer.
    expect(
      firstDraftManifestDifference(draftOf(repeated.slice(0, 2)), publishedManifest(repeated)),
    ).toMatchObject({ kind: 'item_count' });

    // The same set of assets, the repeats in other positions.
    const moved = [image(ID.jpeg, 5000), image(ID.jpeg, 9000, 'cover'), video(ID.video)];
    expect(firstDraftManifestDifference(draftOf(moved), publishedManifest(repeated))).toEqual({
      kind: 'item',
      index: 1,
      field: 'assetId',
    });

    // The durations of the two repeats swapped: same assets in the same order, different play list.
    const swapped = [image(ID.jpeg, 9000), video(ID.video), image(ID.jpeg, 5000, 'cover')];
    expect(firstDraftManifestDifference(draftOf(swapped), publishedManifest(repeated))).toEqual({
      kind: 'item',
      index: 0,
      field: 'durationMs',
    });

    // Only the second repeat changed.
    const second = [image(ID.jpeg, 5000), video(ID.video), image(ID.jpeg, 9000, 'contain')];
    expect(firstDraftManifestDifference(draftOf(second), publishedManifest(repeated))).toEqual({
      kind: 'item',
      index: 2,
      field: 'fit',
    });
  });

  it('sees content that changed under the same asset id', () => {
    const cases: [Partial<ManifestAssetV1>, string][] = [
      [{ sha256: 'cd'.repeat(32) }, 'sha256'],
      [{ bytes: 119_999 }, 'bytes'],
      [{ mediaType: 'image/png' }, 'mediaType'],
      [{ kind: 'video' }, 'kind'],
      [{ width: 1601 }, 'width'],
      [{ height: 901 }, 'height'],
    ];
    for (const [change, field] of cases) {
      expect(
        firstDraftManifestDifference(draftOf(), withAsset(publishedManifest(), 0, change)),
        field,
      ).toEqual({ kind: 'item', index: 0, field });
    }
  });

  it('sees a video whose natural length differs from the published one', () => {
    expect(
      firstDraftManifestDifference(
        draftOf(),
        withAsset(publishedManifest(), 1, { durationMs: 12_000 }),
      ),
    ).toEqual({ kind: 'item', index: 1, field: 'durationMs' });
  });

  it('does not match a manifest of another display', () => {
    const other = publishedManifest(BASE, display({ id: ID.otherDisplay }));
    expect(firstDraftManifestDifference(draftOf(), other)).toEqual({ kind: 'display' });
  });

  it('reports the first difference when several exist', () => {
    const everythingChanged = draftOf(
      [image(ID.png, 1000)],
      display({ canvas: { width: 640, height: 1344 }, defaultFit: 'cover' }),
    );
    expect(firstDraftManifestDifference(everythingChanged, publishedManifest())).toEqual({
      kind: 'canvas',
    });
  });

  it('does not change its inputs', () => {
    const draft = deepFreeze(draftOf());
    const manifest = deepFreeze(publishedManifest());
    expect(draftMatchesManifest(draft, manifest)).toBe(true);
    const other = deepFreeze(draftOf([image(ID.png)]));
    expect(draftMatchesManifest(other, manifest)).toBe(false);
  });
});

describe('draftMatchesManifest with playback options and time rules', () => {
  const HOURS = [
    { start: '09:00', end: '17:00' },
    { start: '09:00', end: '17:00' },
    null,
    null,
    null,
    null,
    { start: '10:00', end: '24:00' },
  ];
  const fade: PlaybackOptions = { transition: 'fade', shuffle: false };
  const windowed = (from: string | null, until: string | null): Map<string, MediaRecord> => {
    const lib = library();
    const jpeg = lib.get(ID.jpeg);
    if (jpeg === undefined) throw new Error('fixture');
    lib.set(ID.jpeg, { ...jpeg, availableFrom: from, availableUntil: until });
    return lib;
  };

  it('matches a v1 manifest with a draft at the defaults', () => {
    expect(firstDraftManifestDifference(draftOf(), publishedManifest())).toBeNull();
  });

  it('asks for a push back to v1 when every v2 option is off', () => {
    const v2 = published(draftOf(BASE, display(), fade));
    expect(firstDraftManifestDifference(draftOf(), v2)).toEqual({
      kind: 'playback',
      field: 'schemaVersion',
    });
  });

  it('sees each playback option', () => {
    const stored = published(draftOf(BASE, display(), fade));
    const cases: [PublicationDraft, string][] = [
      [draftOf(BASE, display(), { transition: 'fade', shuffle: true }), 'shuffle'],
      [draftOf(BASE, display({ rotation: 90 }), fade), 'rotation'],
      [draftOf(BASE, display({ workingHours: HOURS }), fade), 'workingHours'],
      [draftOf(BASE, display({ timeZone: 'Europe/London' }), fade), 'timeZone'],
    ];
    for (const [draft, field] of cases) {
      expect(firstDraftManifestDifference(draft, stored), field).toEqual({
        kind: 'playback',
        field,
      });
    }
    const shuffled = published(draftOf(BASE, display(), { transition: 'cut', shuffle: true }));
    expect(
      firstDraftManifestDifference(
        draftOf(BASE, display(), { transition: 'fade', shuffle: true }),
        shuffled,
      ),
    ).toEqual({ kind: 'playback', field: 'transition' });
  });

  it('matches working hours stored as jsonb, with keys in another order', () => {
    const target = display({ workingHours: HOURS });
    const stored = JSON.parse(
      JSON.stringify(published(draftOf(BASE, target))).replace(
        /\{"start":"([0-9:]+)","end":"([0-9:]+)"\}/g,
        '{"end":"$2","start":"$1"}',
      ),
    ) as Manifest;
    expect(JSON.stringify(stored)).toContain('{"end":"17:00","start":"09:00"}');
    expect(firstDraftManifestDifference(draftOf(BASE, target), stored)).toBeNull();
  });

  it('sees each side of an availability window', () => {
    const stored = published(
      draftOf(BASE, display(), playback, windowed('2026-12-01T09:00', null)),
    );
    expect(
      firstDraftManifestDifference(
        draftOf(BASE, display(), playback, windowed('2026-12-01T10:00', null)),
        stored,
      ),
    ).toEqual({ kind: 'item', index: 0, field: 'availableFrom' });
    expect(
      firstDraftManifestDifference(
        draftOf(BASE, display(), playback, windowed('2026-12-01T09:00', '2026-12-24T18:00')),
        stored,
      ),
    ).toEqual({ kind: 'item', index: 0, field: 'availableUntil' });
  });
});

describe('draftMatchesManifest with apps', () => {
  const ticker = (appId: string = ID.ticker, durationMs = 10_000): DraftItem => ({
    appId,
    durationMs,
  });
  const WITH_APP: readonly DraftItem[] = [image(ID.jpeg), ticker()];
  /** The app records with the ticker's settings changed. */
  const editedTicker = (change: { speed: 'slow' | 'medium' | 'fast' }): Map<string, AppRecord> => {
    const records = apps();
    records.set(ID.ticker, {
      id: ID.ticker,
      content: { type: 'ticker', settings: { ...tickerContent.settings, ...change } },
    });
    return records;
  };
  const draftWithApps = (
    items: readonly DraftItem[],
    appsById: ReadonlyMap<string, AppRecord>,
  ): PublicationDraft => {
    const built = buildPublicationDraft(display(), items, library(), appsById, limits, playback);
    if (!built.ok) throw new Error(`fixture playlist is not publishable: ${built.issues[0]?.code}`);
    return built.draft;
  };

  it('matches the v3 manifest built from the same playlist', () => {
    const stored = published(draftOf(WITH_APP));
    expect(stored.schemaVersion).toBe(3);
    expect(firstDraftManifestDifference(draftOf(WITH_APP), stored)).toBeNull();
  });

  it('matches settings stored as jsonb, with keys in another order', () => {
    const stored = JSON.parse(JSON.stringify(published(draftOf(WITH_APP)))) as Manifest;
    const entry = stored.assets[1];
    if (entry === undefined || entry.kind !== 'app') throw new Error('fixture');
    const reversed = Object.fromEntries(Object.entries(entry.content.settings).reverse());
    (entry.content as { settings: unknown }).settings = reversed;
    expect(Object.keys(entry.content.settings)[0]).toBe('backgroundColour');
    expect(firstDraftManifestDifference(draftOf(WITH_APP), stored)).toBeNull();
  });

  it('sees a changed setting, a changed duration and another app', () => {
    const stored = published(draftOf(WITH_APP));
    expect(
      firstDraftManifestDifference(
        draftWithApps(WITH_APP, editedTicker({ speed: 'fast' })),
        stored,
      ),
    ).toEqual({ kind: 'item', index: 1, field: 'content' });
    expect(
      firstDraftManifestDifference(draftOf([image(ID.jpeg), ticker(ID.ticker, 10_001)]), stored),
    ).toEqual({ kind: 'item', index: 1, field: 'durationMs' });
    expect(
      firstDraftManifestDifference(draftOf([image(ID.jpeg), ticker(ID.clock)]), stored),
    ).toEqual({ kind: 'item', index: 1, field: 'appId' });
  });

  it('sees an app swapped for media and media swapped for an app', () => {
    const stored = published(draftOf(WITH_APP));
    expect(
      firstDraftManifestDifference(
        draftOf([ticker(), image(ID.jpeg), ticker()]),
        published(draftOf([image(ID.jpeg), ticker(), ticker()])),
      ),
    ).toEqual({ kind: 'item', index: 0, field: 'kind' });
    expect(firstDraftManifestDifference(draftOf([ticker(), ticker()]), stored)).toEqual({
      kind: 'item',
      index: 0,
      field: 'kind',
    });
  });

  it('offers a push back when the last app is removed', () => {
    const stored = published(draftOf(WITH_APP));
    expect(firstDraftManifestDifference(draftOf([image(ID.jpeg)]), stored)).toEqual({
      kind: 'playback',
      field: 'schemaVersion',
    });
  });
});

describe('draftMatchesManifest with a schedule', () => {
  const PLAYLISTS: Record<string, FixturePlaylist> = {
    [ID.listDefault]: { name: 'Reception loop', items: [image(ID.jpeg), video(ID.video)] },
    [ID.listLunch]: { name: 'Lunch', items: [image(ID.png, 8000), image(ID.jpeg, 3000)] },
    [ID.listEvening]: { name: 'Evening', items: [video(ID.video)] },
  };
  type Events = Parameters<typeof planSchedule>[1]['events'];
  const lunch = { playlistId: ID.listLunch, days: WEEKDAYS, start: '11:30', end: '14:00' };
  const evening = { playlistId: ID.listEvening, days: EVERY_DAY, start: '18:00', end: '24:00' };
  const EVENTS: Events = [lunch, evening];
  const scheduled = (events: Events = EVENTS, playlists = PLAYLISTS): PublicationDraft => {
    const plan = planSchedule(playlists, { defaultPlaylistId: ID.listDefault, events });
    if (!plan.ok) throw new Error(`fixture schedule is not publishable: ${plan.issues[0]?.code}`);
    return plan.draft;
  };
  const stored = (): Manifest => published(scheduled());
  const SCHEDULE = { kind: 'playback', field: 'schedule' };
  const VERSION = { kind: 'playback', field: 'schemaVersion' };

  it('matches the v4 manifest built from the same schedule', () => {
    expect(stored().schemaVersion).toBe(4);
    expect(firstDraftManifestDifference(scheduled(), stored())).toBeNull();
    expect(draftMatchesManifest(scheduled(), stored())).toBe(true);
  });

  it('matches a schedule stored as jsonb, with keys in another order', () => {
    const reversed = (value: object) => Object.fromEntries(Object.entries(value).reverse());
    const manifest = JSON.parse(JSON.stringify(stored())) as Manifest;
    if (manifest.schemaVersion !== 4) throw new Error('fixture should publish v4');
    (manifest as { schedule: unknown }).schedule = {
      events: manifest.schedule.events.map(reversed),
      playlists: manifest.schedule.playlists.map(reversed),
    };
    expect(Object.keys(manifest.schedule.events[0] ?? {})[0]).toBe('end');
    expect(firstDraftManifestDifference(scheduled(), manifest)).toBeNull();
  });

  it('sees a changed day, time or playlist of an event', () => {
    const saturdayToo = [true, true, true, true, true, true, false];
    const cases: [string, Events][] = [
      ['day', [{ ...lunch, days: saturdayToo }, evening]],
      ['start', [{ ...lunch, start: '11:00' }, evening]],
      ['end', [lunch, { ...evening, end: '23:00' }]],
    ];
    for (const [what, events] of cases) {
      expect(firstDraftManifestDifference(scheduled(events), stored()), what).toEqual(SCHEDULE);
    }
    // The third event points at another playlist that the schedule already holds.
    const three = published(scheduled([lunch, evening, lunch]));
    expect(
      firstDraftManifestDifference(
        scheduled([lunch, evening, { ...lunch, playlistId: ID.listEvening }]),
        three,
      ),
    ).toEqual(SCHEDULE);
  });

  it('sees an added, a removed and a reordered event', () => {
    const late = { ...lunch, start: '15:00', end: '16:00' };
    const three = published(scheduled([lunch, evening, late]));
    // The same playlists in the same slices; only the order of the events differs.
    expect(firstDraftManifestDifference(scheduled([lunch, late, evening]), three)).toEqual(
      SCHEDULE,
    );
    expect(firstDraftManifestDifference(scheduled([lunch, evening]), three)).toEqual(SCHEDULE);
    expect(firstDraftManifestDifference(scheduled([lunch, evening, late, late]), three)).toEqual(
      SCHEDULE,
    );
    // A reordering that changes which playlist is used first moves its items in the one list.
    expect(firstDraftManifestDifference(scheduled([evening, lunch, late]), three)).toMatchObject({
      kind: 'item',
      index: 2,
    });
  });

  it('sees the playback options of an event playlist, and of the default playlist first', () => {
    const withLunch = (options: PlaybackOptions) =>
      scheduled(EVENTS, {
        ...PLAYLISTS,
        [ID.listLunch]: {
          name: 'Lunch',
          items: [image(ID.png, 8000), image(ID.jpeg, 3000)],
          playback: options,
        },
      });
    expect(
      firstDraftManifestDifference(withLunch({ transition: 'cut', shuffle: true }), stored()),
    ).toEqual(SCHEDULE);
    expect(
      firstDraftManifestDifference(withLunch({ transition: 'fade', shuffle: false }), stored()),
    ).toEqual(SCHEDULE);
    const shuffledDefault = scheduled(EVENTS, {
      ...PLAYLISTS,
      [ID.listDefault]: {
        name: 'Reception loop',
        items: [image(ID.jpeg), video(ID.video)],
        playback: { transition: 'cut', shuffle: true },
      },
    });
    expect(firstDraftManifestDifference(shuffledDefault, stored())).toEqual({
      kind: 'playback',
      field: 'shuffle',
    });
  });

  it('sees a changed item inside an event playlist at its place in the one list', () => {
    const edited = scheduled(EVENTS, {
      ...PLAYLISTS,
      [ID.listLunch]: { name: 'Lunch', items: [image(ID.png, 8000), image(ID.jpeg, 3001)] },
    });
    // Two items of the default playlist come first.
    expect(firstDraftManifestDifference(edited, stored())).toEqual({
      kind: 'item',
      index: 3,
      field: 'durationMs',
    });
    // An item moved from one playlist to the next: the same list, other runs.
    const moved = scheduled(EVENTS, {
      ...PLAYLISTS,
      [ID.listDefault]: { name: 'Reception loop', items: [image(ID.jpeg)] },
      [ID.listLunch]: {
        name: 'Lunch',
        items: [video(ID.video), image(ID.png, 8000), image(ID.jpeg, 3000)],
      },
    });
    expect(firstDraftManifestDifference(moved, stored())).toEqual(SCHEDULE);
    const longer = scheduled(EVENTS, {
      ...PLAYLISTS,
      [ID.listEvening]: { name: 'Evening', items: [video(ID.video), image(ID.png)] },
    });
    expect(firstDraftManifestDifference(longer, stored())).toEqual({
      kind: 'item_count',
      draftItems: 6,
      manifestItems: 5,
    });
  });

  it('offers a push back when no event uses another playlist any more', () => {
    const one = published(scheduled([lunch]));
    expect(one.schemaVersion).toBe(4);
    // The last event removed, and the only event pointed at the default playlist.
    expect(firstDraftManifestDifference(scheduled([]), one)).toEqual(VERSION);
    expect(
      firstDraftManifestDifference(scheduled([{ ...lunch, playlistId: ID.listDefault }]), one),
    ).toEqual(VERSION);
    // A playlist assigned in place of the schedule, and a schedule in place of a playlist.
    expect(firstDraftManifestDifference(draftOf(), one)).toEqual(VERSION);
    expect(firstDraftManifestDifference(scheduled([lunch]), publishedManifest())).toEqual(VERSION);
  });

  it('decides the push state of a scheduled display', () => {
    const plan = { ok: true as const, draft: scheduled() };
    expect(decidePushState({ plan, currentManifest: null })).toBe('never_pushed');
    expect(decidePushState({ plan, currentManifest: stored() })).toBe('up_to_date');
    expect(
      decidePushState({
        plan: { ok: true, draft: scheduled([lunch]) },
        currentManifest: stored(),
      }),
    ).toBe('changes');
  });
});

describe('decidePushState', () => {
  const ok = (draft: PublicationDraft): PlanPublicationResult => ({ ok: true, draft });
  const refused: PlanPublicationResult = {
    ok: false,
    issues: [{ index: null, code: 'playlist_empty', message: 'The playlist has no items.' }],
  };

  it('is nothing_assigned when no playlist is assigned, with or without a publication', () => {
    expect(decidePushState({ plan: null, currentManifest: null })).toBe('nothing_assigned');
    expect(decidePushState({ plan: null, currentManifest: publishedManifest() })).toBe(
      'nothing_assigned',
    );
  });

  it('is blocked when the assigned playlist cannot be published, with or without a publication', () => {
    expect(decidePushState({ plan: refused, currentManifest: null })).toBe('blocked');
    expect(decidePushState({ plan: refused, currentManifest: publishedManifest() })).toBe(
      'blocked',
    );
  });

  it('is never_pushed when the display has no publication yet', () => {
    expect(decidePushState({ plan: ok(draftOf()), currentManifest: null })).toBe('never_pushed');
  });

  it('is up_to_date when the draft equals the current publication', () => {
    expect(decidePushState({ plan: ok(draftOf()), currentManifest: publishedManifest() })).toBe(
      'up_to_date',
    );
  });

  it('is changes when the draft differs from the current publication', () => {
    const edited = draftOf([...BASE, image(ID.png, 2000)]);
    expect(decidePushState({ plan: ok(edited), currentManifest: publishedManifest() })).toBe(
      'changes',
    );
    const otherPlaylist = draftOf([image(ID.png, 2000)]);
    expect(decidePushState({ plan: ok(otherPlaylist), currentManifest: publishedManifest() })).toBe(
      'changes',
    );
  });
});
