import type { WorkingHours } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { makeAsset, makeManifest, makeManifestV2 } from './fakes.test-support.ts';
import { localWallClock, playableIndexes } from './time-rules.ts';

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
