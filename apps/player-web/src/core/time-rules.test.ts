import {
  localWallClock,
  ManifestSchema,
  type ManifestAssetV1,
  type ManifestScheduleEvent,
  type ManifestV4,
  type WorkingHours,
} from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  EVERY_DAY,
  makeAppItem,
  makeAsset,
  makeManifest,
  makeManifestV2,
  makeManifestV3,
  makeManifestV4,
} from './fakes.test-support.ts';
import { coveringSlices, playableIndexes } from './time-rules.ts';

const at = (iso: string): number => Date.parse(iso);

async function threeImages(): Promise<Parameters<typeof makeManifestV2>[0]> {
  return Promise.all([1, 2, 3].map(async (seed) => (await makeAsset(seed)).asset));
}

describe('localWallClock (Australia/Melbourne)', () => {
  it('reads the wall clock across the spring-forward gap', () => {
    expect(localWallClock(at('2026-10-03T15:59:00Z'), 'Australia/Melbourne')).toEqual({
      stamp: '2026-10-04T01:59',
      day: 6,
      time: '01:59',
    });
    // 02:00 standard time does not exist that night: the clock reads 03:00.
    expect(localWallClock(at('2026-10-03T16:00:00Z'), 'Australia/Melbourne')).toEqual({
      stamp: '2026-10-04T03:00',
      day: 6,
      time: '03:00',
    });
  });

  it('is null for a zone this browser does not know', () => {
    expect(localWallClock(at('2026-11-16T02:00:00Z'), 'Mars/Olympus_Mons')).toBeNull();
  });
});

describe('playableIndexes', () => {
  // Sunday 18:00 until midnight only.
  const sundayEvening: WorkingHours = [
    null,
    null,
    null,
    null,
    null,
    null,
    { start: '18:00', end: '24:00' },
  ];

  it('plays everything from a v1 manifest', async () => {
    const m = makeManifest(await threeImages());
    expect(playableIndexes(m, at('2026-11-16T02:00:00Z'))).toEqual([0, 1, 2]);
  });

  it("keeps a day open until midnight with '24:00', and is closed on a null day", async () => {
    const m = makeManifestV2(await threeImages(), { workingHours: sundayEvening });
    // Sunday 23:59 local.
    expect(playableIndexes(m, at('2026-11-22T12:59:00Z'))).toEqual([0, 1, 2]);
    // Monday 00:00 local: Monday is closed.
    expect(playableIndexes(m, at('2026-11-22T13:00:00Z'))).toEqual([]);
    // Sunday 17:59 local: before the start.
    expect(playableIndexes(m, at('2026-11-22T06:59:00Z'))).toEqual([]);
  });

  it('opens a window at its start minute and closes it at its end minute', async () => {
    const m = makeManifestV2(await threeImages());
    m.assets[1] = { ...m.assets[1]!, availableFrom: '2026-11-16T13:00' };
    m.assets[2] = { ...m.assets[2]!, availableUntil: '2026-11-16T14:00' };
    // Monday 12:59, 13:00 and 14:00 local (UTC+11).
    expect(playableIndexes(m, at('2026-11-16T01:59:00Z'))).toEqual([0, 2]);
    expect(playableIndexes(m, at('2026-11-16T02:00:00Z'))).toEqual([0, 1, 2]);
    expect(playableIndexes(m, at('2026-11-16T03:00:00Z'))).toEqual([0, 1]);
  });

  it('lets apps ignore windows but obey working hours', async () => {
    const [image] = await threeImages();
    const m = makeManifestV3([image!, makeAppItem()], { workingHours: sundayEvening });
    m.assets[0] = { ...image!, availableFrom: '2026-12-01T00:00', availableUntil: null };
    // Sunday 23:59 local: open; the image waits for its window, the app plays.
    expect(playableIndexes(m, at('2026-11-22T12:59:00Z'))).toEqual([1]);
    // Monday 00:00 local: closed for both.
    expect(playableIndexes(m, at('2026-11-22T13:00:00Z'))).toEqual([]);
  });

  it('fails open when the clock is well behind the publication', async () => {
    const m = makeManifestV2(await threeImages(), { workingHours: sundayEvening });
    // createdAt is 2026-11-14T01:00Z; a dead RTC reads 1970.
    expect(playableIndexes(m, 0)).toEqual([0, 1, 2]);
    expect(playableIndexes(m, at('2026-11-14T00:54:00Z'))).toEqual([0, 1, 2]);
    // Within five minutes the clock is believed: Saturday is closed.
    expect(playableIndexes(m, at('2026-11-14T00:56:00Z'))).toEqual([]);
  });

  it('fails open when the zone is unknown to this browser', async () => {
    const m = makeManifestV2(await threeImages(), {
      timeZone: 'Mars/Olympus_Mons',
      workingHours: sundayEvening,
    });
    expect(playableIndexes(m, at('2026-11-16T02:00:00Z'))).toEqual([0, 1, 2]);
  });
});

/** A moment on a Melbourne wall clock in November 2026 (daylight time, UTC+11). */
const melbourne = (date: string, time: string): number => Date.parse(`${date}T${time}:00+11:00`);
const MONDAY = '2026-11-16';
const FRIDAY = '2026-11-20';
const SATURDAY = '2026-11-21';
const SUNDAY = '2026-11-22';
const NEXT_MONDAY = '2026-11-23';

const WEEKDAYS = [true, true, true, true, true, false, false];
const only = (day: number): boolean[] => EVERY_DAY.map((_, index) => index === day);
const event = (
  playlist: number,
  start: string,
  end: string,
  days: boolean[] = EVERY_DAY,
): ManifestScheduleEvent => ({ playlist, days, start, end });

/**
 * Three playlists in one flat list: the default (indexes 0 and 1), "lunch" (2 and 3) and
 * "night" (4).
 */
async function scheduled(
  events: readonly ManifestScheduleEvent[],
  overrides: Partial<ManifestV4> = {},
): Promise<ManifestV4> {
  const images: ManifestAssetV1[] = [];
  for (let seed = 1; seed <= 5; seed += 1) images.push((await makeAsset(seed)).asset);
  return makeManifestV4(
    [{ items: images.slice(0, 2) }, { items: images.slice(2, 4) }, { items: images.slice(4) }],
    events,
    overrides,
  );
}

const DEFAULT = [0, 1];
const LUNCH = [2, 3];
const NIGHT = [4];

/** Moves every item of the given indexes outside its availability window. */
function expire(m: ManifestV4, indexes: readonly number[]): void {
  for (const index of indexes) {
    const item = m.assets[index];
    if (item !== undefined && item.kind !== 'app') {
      m.assets[index] = { ...item, availableUntil: '2026-11-01T00:00' };
    }
  }
}

describe('coveringSlices', () => {
  it('the test manifests are real v4 documents', async () => {
    const m = await scheduled([event(1, '09:00', '17:00', WEEKDAYS), event(2, '22:00', '02:00')]);
    expect(ManifestSchema.safeParse(m).success).toBe(true);
  });

  it('lists the playlists the events name, in priority order, each once', async () => {
    const m = await scheduled([
      event(2, '12:00', '14:00'),
      event(1, '11:00', '15:00'),
      event(2, '13:00', '16:00'),
      event(0, '13:30', '13:45'),
    ]);
    expect(coveringSlices(m, melbourne(MONDAY, '11:30'))).toEqual([1]);
    expect(coveringSlices(m, melbourne(MONDAY, '13:00'))).toEqual([2, 1]);
    // It may contain 0: an event may name the default playlist.
    expect(coveringSlices(m, melbourne(MONDAY, '13:30'))).toEqual([2, 1, 0]);
    expect(coveringSlices(m, melbourne(MONDAY, '15:30'))).toEqual([2]);
    expect(coveringSlices(m, melbourne(MONDAY, '17:00'))).toEqual([]);
  });

  it('is empty for a manifest without a schedule (v1 to v3)', async () => {
    const [image] = await threeImages();
    const t = melbourne(MONDAY, '13:00');
    expect(coveringSlices(makeManifest([image!]), t)).toEqual([]);
    expect(coveringSlices(makeManifestV2([image!]), t)).toEqual([]);
    expect(coveringSlices(makeManifestV3([image!, makeAppItem()]), t)).toEqual([]);
  });

  it('is empty when the clock or the zone cannot be trusted', async () => {
    const allDay = [event(1, '00:00', '24:00')];
    const m = await scheduled(allDay);
    // Control: the event covers a believed moment.
    expect(coveringSlices(m, melbourne(MONDAY, '13:00'))).toEqual([1]);
    // createdAt is 2026-11-14T01:00Z; a dead RTC reads 1970.
    expect(coveringSlices(m, 0)).toEqual([]);
    expect(coveringSlices(m, Date.parse('2026-11-14T00:54:00Z'))).toEqual([]);
    const unknownZone = await scheduled(allDay, { timeZone: 'Mars/Olympus_Mons' });
    expect(coveringSlices(unknownZone, melbourne(MONDAY, '13:00'))).toEqual([]);
  });
});

describe('playableIndexes with a schedule (v4)', () => {
  it('picks the playlist by day and time; the window is half-open', async () => {
    const m = await scheduled([event(1, '09:00', '17:00', WEEKDAYS)]);
    expect(playableIndexes(m, melbourne(MONDAY, '08:59'))).toEqual(DEFAULT);
    expect(playableIndexes(m, melbourne(MONDAY, '09:00'))).toEqual(LUNCH);
    expect(playableIndexes(m, melbourne(MONDAY, '16:59'))).toEqual(LUNCH);
    expect(playableIndexes(m, melbourne(MONDAY, '17:00'))).toEqual(DEFAULT);
    // Saturday is not ticked.
    expect(playableIndexes(m, melbourne(SATURDAY, '13:00'))).toEqual(DEFAULT);
  });

  it('runs an overnight event into the next morning, from the day it starts on', async () => {
    const m = await scheduled([event(2, '22:00', '02:00', only(4))]);
    expect(playableIndexes(m, melbourne(FRIDAY, '21:59'))).toEqual(DEFAULT);
    expect(playableIndexes(m, melbourne(FRIDAY, '22:00'))).toEqual(NIGHT);
    expect(playableIndexes(m, melbourne(SATURDAY, '01:59'))).toEqual(NIGHT);
    expect(playableIndexes(m, melbourne(SATURDAY, '02:00'))).toEqual(DEFAULT);
    // Friday morning belongs to Thursday's event, and Thursday is not ticked.
    expect(playableIndexes(m, melbourne(FRIDAY, '01:00'))).toEqual(DEFAULT);
    expect(playableIndexes(m, melbourne(SATURDAY, '23:00'))).toEqual(DEFAULT);
  });

  it('runs a Sunday night event into Monday morning', async () => {
    const m = await scheduled([event(2, '22:00', '02:00', only(6))]);
    expect(playableIndexes(m, melbourne(SUNDAY, '23:00'))).toEqual(NIGHT);
    expect(playableIndexes(m, melbourne(NEXT_MONDAY, '01:00'))).toEqual(NIGHT);
    expect(playableIndexes(m, melbourne(MONDAY, '01:00'))).toEqual(NIGHT);
    expect(playableIndexes(m, melbourne(NEXT_MONDAY, '23:00'))).toEqual(DEFAULT);
  });

  it('lets the first event win where two overlap', async () => {
    const m = await scheduled([event(1, '12:00', '14:00'), event(2, '11:00', '15:00')]);
    expect(playableIndexes(m, melbourne(MONDAY, '11:30'))).toEqual(NIGHT);
    expect(playableIndexes(m, melbourne(MONDAY, '13:00'))).toEqual(LUNCH);
    expect(playableIndexes(m, melbourne(MONDAY, '14:00'))).toEqual(NIGHT);
  });

  it('plays the default playlist when no event covers the moment', async () => {
    const m = await scheduled([event(1, '12:00', '14:00'), event(2, '22:00', '02:00')]);
    expect(playableIndexes(m, melbourne(MONDAY, '16:00'))).toEqual(DEFAULT);
  });

  it('never mixes playlists: an event playlist plays only its own items in their windows', async () => {
    const m = await scheduled([event(1, '12:00', '14:00')]);
    expire(m, [0, 2]);
    expect(playableIndexes(m, melbourne(MONDAY, '13:00'))).toEqual([3]);
    expect(playableIndexes(m, melbourne(MONDAY, '15:00'))).toEqual([1]);
  });

  it('lets the lower covering event play when the higher one has nothing in its window', async () => {
    const m = await scheduled([event(1, '12:00', '14:00'), event(2, '11:00', '15:00')]);
    expire(m, LUNCH);
    expect(playableIndexes(m, melbourne(MONDAY, '13:00'))).toEqual(NIGHT);
  });

  it('lets the lower covering event play when the higher one is skipped as failed', async () => {
    const m = await scheduled([event(1, '12:00', '14:00'), event(2, '11:00', '15:00')]);
    expect(playableIndexes(m, melbourne(MONDAY, '13:00'), new Set([1]))).toEqual(NIGHT);
  });

  it('plays the default playlist when every covering event is skipped; the default is never skipped', async () => {
    const m = await scheduled([event(1, '12:00', '14:00'), event(2, '11:00', '15:00')]);
    const t = melbourne(MONDAY, '13:00');
    expect(playableIndexes(m, t, new Set([1, 2]))).toEqual(DEFAULT);
    expect(playableIndexes(m, t, new Set([0, 1, 2]))).toEqual(DEFAULT);
  });

  it('plays the default playlist when the only event has nothing in its window', async () => {
    const m = await scheduled([event(1, '12:00', '14:00')]);
    expire(m, LUNCH);
    expect(playableIndexes(m, melbourne(MONDAY, '13:00'))).toEqual(DEFAULT);
  });

  it('lets an event that names the default playlist cut a hole in a wider event below it', async () => {
    const m = await scheduled([event(0, '13:00', '13:30'), event(1, '12:00', '14:00')]);
    expect(playableIndexes(m, melbourne(MONDAY, '12:59'))).toEqual(LUNCH);
    expect(playableIndexes(m, melbourne(MONDAY, '13:10'))).toEqual(DEFAULT);
    expect(playableIndexes(m, melbourne(MONDAY, '13:30'))).toEqual(LUNCH);
  });

  it('says nothing may be shown when neither a covering event nor the default has anything', async () => {
    const m = await scheduled([event(1, '12:00', '14:00')]);
    expire(m, [...DEFAULT, ...LUNCH]);
    expect(playableIndexes(m, melbourne(MONDAY, '13:00'))).toEqual([]);
  });

  it('fails open to the default playlist only when the clock is well behind the publication', async () => {
    const m = await scheduled([event(1, '00:00', '24:00')]);
    // Control: a believed clock picks the event.
    expect(playableIndexes(m, melbourne(MONDAY, '13:00'))).toEqual(LUNCH);
    expect(playableIndexes(m, 0)).toEqual(DEFAULT);
    expect(playableIndexes(m, Date.parse('2026-11-14T00:54:00Z'))).toEqual(DEFAULT);
    // Windows are ignored too, as for v2: never blank on a dead RTC.
    expire(m, DEFAULT);
    expect(playableIndexes(m, 0)).toEqual(DEFAULT);
  });

  it('fails open to the default playlist only when the zone is unknown to this browser', async () => {
    const m = await scheduled([event(1, '00:00', '24:00')], { timeZone: 'Mars/Olympus_Mons' });
    expect(playableIndexes(m, melbourne(MONDAY, '13:00'))).toEqual(DEFAULT);
  });

  it('lets working hours outrank the events', async () => {
    const hours = { start: '09:00', end: '17:00' };
    const m = await scheduled([event(1, '00:00', '24:00')], {
      workingHours: [hours, hours, hours, hours, hours, hours, hours],
    });
    expect(playableIndexes(m, melbourne(MONDAY, '13:00'))).toEqual(LUNCH);
    expect(playableIndexes(m, melbourne(MONDAY, '17:00'))).toEqual([]);
    expect(playableIndexes(m, melbourne(MONDAY, '08:59'))).toEqual([]);
  });

  it('leaves v2 and v3 as they were: one playlist, and skipped slices mean nothing', async () => {
    const v2 = makeManifestV2(await threeImages());
    v2.assets[1] = { ...v2.assets[1]!, availableFrom: '2026-11-16T13:00' };
    expect(playableIndexes(v2, melbourne(MONDAY, '12:59'), new Set([0, 1]))).toEqual([0, 2]);
    expect(playableIndexes(v2, melbourne(MONDAY, '13:00'), new Set([0, 1]))).toEqual([0, 1, 2]);
    const [image] = await threeImages();
    const v3 = makeManifestV3([image!, makeAppItem()]);
    expect(playableIndexes(v3, melbourne(MONDAY, '13:00'), new Set([0, 1]))).toEqual([0, 1]);
  });
});

// The only pin on the wall-clock behaviour of events at a daylight-saving change (SCH-02,
// SCH-05): an event wholly inside the skipped hour does not play that day, one that starts
// inside it starts when the clock jumps, and an edge in the repeated hour applies twice.
describe('schedule events across daylight-saving changes (real instants)', () => {
  interface Row {
    readonly name: string;
    readonly timeZone: string;
    readonly start: string;
    readonly end: string;
    /** [instant, the wall clock expected there, whether the event covers it]. */
    readonly moments: readonly (readonly [string, string, boolean])[];
  }

  const rows: Row[] = [
    {
      name: 'Sydney 2026-10-04: an event wholly inside the skipped hour does not play that day',
      timeZone: 'Australia/Sydney',
      start: '02:00',
      end: '03:00',
      moments: [
        // Control: the same wall-clock times one day earlier.
        ['2026-10-02T16:00:00Z', '2026-10-03T02:00', true],
        ['2026-10-02T16:59:00Z', '2026-10-03T02:59', true],
        ['2026-10-03T15:59:00Z', '2026-10-04T01:59', false],
        ['2026-10-03T16:00:00Z', '2026-10-04T03:00', false],
        ['2026-10-03T16:30:00Z', '2026-10-04T03:30', false],
      ],
    },
    {
      name: 'Sydney 2026-10-04: an event that starts inside the skipped hour starts at 03:00 (16:00Z)',
      timeZone: 'Australia/Sydney',
      start: '02:30',
      end: '04:00',
      moments: [
        // Control: one day earlier it starts at 02:30 (16:30Z).
        ['2026-10-02T16:29:00Z', '2026-10-03T02:29', false],
        ['2026-10-02T16:30:00Z', '2026-10-03T02:30', true],
        ['2026-10-03T15:59:00Z', '2026-10-04T01:59', false],
        ['2026-10-03T16:00:00Z', '2026-10-04T03:00', true],
        ['2026-10-03T16:59:00Z', '2026-10-04T03:59', true],
        ['2026-10-03T17:00:00Z', '2026-10-04T04:00', false],
      ],
    },
    {
      name: 'Sydney 2027-04-04: an edge in the repeated hour applies twice',
      timeZone: 'Australia/Sydney',
      start: '02:30',
      end: '03:30',
      moments: [
        ['2027-04-03T15:29:00Z', '2027-04-04T02:29', false],
        // 30 minutes of the event in daylight time,
        ['2027-04-03T15:30:00Z', '2027-04-04T02:30', true],
        ['2027-04-03T15:59:00Z', '2027-04-04T02:59', true],
        // 30 minutes of the default once the clock is back at 02:00,
        ['2027-04-03T16:00:00Z', '2027-04-04T02:00', false],
        ['2027-04-03T16:29:00Z', '2027-04-04T02:29', false],
        // then the event for its 60 minutes in standard time.
        ['2027-04-03T16:30:00Z', '2027-04-04T02:30', true],
        ['2027-04-03T17:29:00Z', '2027-04-04T03:29', true],
        ['2027-04-03T17:30:00Z', '2027-04-04T03:30', false],
      ],
    },
    {
      name: 'Brisbane 2026-10-04: no shift, the 02:00 to 03:00 event plays',
      timeZone: 'Australia/Brisbane',
      start: '02:00',
      end: '03:00',
      moments: [
        ['2026-10-03T15:59:00Z', '2026-10-04T01:59', false],
        ['2026-10-03T16:00:00Z', '2026-10-04T02:00', true],
        ['2026-10-03T16:59:00Z', '2026-10-04T02:59', true],
        ['2026-10-03T17:00:00Z', '2026-10-04T03:00', false],
      ],
    },
    {
      name: 'Brisbane 2027-04-04: no shift, the 02:30 to 03:30 event plays once',
      timeZone: 'Australia/Brisbane',
      start: '02:30',
      end: '03:30',
      moments: [
        ['2027-04-03T15:30:00Z', '2027-04-04T01:30', false],
        ['2027-04-03T16:29:00Z', '2027-04-04T02:29', false],
        ['2027-04-03T16:30:00Z', '2027-04-04T02:30', true],
        ['2027-04-03T17:29:00Z', '2027-04-04T03:29', true],
        ['2027-04-03T17:30:00Z', '2027-04-04T03:30', false],
      ],
    },
    {
      name: 'Lord Howe 2026-10-04: 02:15 falls in the 30-minute gap',
      timeZone: 'Australia/Lord_Howe',
      start: '02:00',
      end: '02:30',
      moments: [
        // Control: 02:15 one day earlier (UTC+10:30).
        ['2026-10-02T15:45:00Z', '2026-10-03T02:15', true],
        ['2026-10-03T15:29:00Z', '2026-10-04T01:59', false],
        // 02:00 does not exist: the clock reads 02:30 (UTC+11).
        ['2026-10-03T15:30:00Z', '2026-10-04T02:30', false],
        ['2026-10-03T15:45:00Z', '2026-10-04T02:45', false],
      ],
    },
  ];

  it.each(rows)('$name', async ({ timeZone, start, end, moments }) => {
    // Published long before every instant, so no row passes or fails by the fail-open rule.
    const m = await scheduled([event(1, start, end)], {
      timeZone,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    // Every row has a moment at which the same event does match.
    expect(moments.some(([, , covers]) => covers)).toBe(true);
    for (const [instant, wallClock, covers] of moments) {
      const t = Date.parse(instant);
      expect(localWallClock(t, timeZone)?.stamp, instant).toBe(wallClock);
      expect(coveringSlices(m, t), instant).toEqual(covers ? [1] : []);
      expect(playableIndexes(m, t), instant).toEqual(covers ? LUNCH : DEFAULT);
    }
  });
});
