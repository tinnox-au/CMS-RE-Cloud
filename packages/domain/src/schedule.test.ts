import { describe, expect, it } from 'vitest';
import {
  EVERY_DAY,
  ID,
  WEEKDAYS,
  display,
  planSchedule,
  playback,
  route,
  type FixturePlaylist,
} from './fixtures.test-support.ts';
import { manifestVersionFor, type PlanPublicationResult } from './manifest.ts';
import { planSchedulePublication } from './schedule.ts';
import type { DraftItem, PublicationDraft, PublishIssue } from './types.ts';

const image = (mediaId: string, durationMs = 5000): DraftItem => ({
  mediaId,
  durationMs,
  fit: null,
});
const video = (mediaId: string): DraftItem => ({ mediaId, durationMs: null, fit: null });

const DEFAULT: FixturePlaylist = {
  name: 'Reception loop',
  items: [image(ID.jpeg), video(ID.video)],
  playback: { transition: 'fade', shuffle: false },
};
const LUNCH: FixturePlaylist = { name: 'Lunch', items: [image(ID.png, 8000)] };
const EVENING: FixturePlaylist = {
  name: 'Evening',
  items: [image(ID.png), image(ID.jpeg, 3000), video(ID.video)],
  playback: { transition: 'cut', shuffle: true },
};
const PLAYLISTS = {
  [ID.listDefault]: DEFAULT,
  [ID.listLunch]: LUNCH,
  [ID.listEvening]: EVENING,
};

const event = (
  playlistId: string,
  start = '11:30',
  end = '14:00',
  days: readonly boolean[] = WEEKDAYS,
) => ({ playlistId, days, start, end });

function draftOf(plan: PlanPublicationResult): PublicationDraft {
  if (!plan.ok) throw new Error(`expected a draft, got ${plan.issues[0]?.code}`);
  return plan.draft;
}
function issuesOf(plan: PlanPublicationResult): readonly PublishIssue[] {
  if (plan.ok) throw new Error('expected a refusal');
  return plan.issues;
}
/** The draft of one playlist on its own. */
const alone = (id: string) =>
  draftOf(planSchedule(PLAYLISTS, { defaultPlaylistId: id, events: [] }));

describe('planSchedulePublication', () => {
  it('puts every playlist once into one list, the default first, then in first-use order', () => {
    const saturday = [false, false, false, false, false, true, false];
    const draft = draftOf(
      planSchedule(PLAYLISTS, {
        defaultPlaylistId: ID.listDefault,
        events: [
          event(ID.listLunch),
          event(ID.listEvening, '22:00', '02:00', EVERY_DAY),
          // A playlist used by two events, and the default named by an event.
          event(ID.listLunch, '10:00', '15:00', saturday),
          event(ID.listDefault, '12:00', '12:30'),
        ],
      }),
    );
    expect(draft.items).toEqual([
      ...alone(ID.listDefault).items,
      ...alone(ID.listLunch).items,
      ...alone(ID.listEvening).items,
    ]);
    expect(draft.schedule).toEqual({
      playlists: [
        { count: 2, transition: 'fade', shuffle: false },
        { count: 1, transition: 'cut', shuffle: false },
        { count: 3, transition: 'cut', shuffle: true },
      ],
      events: [
        { playlist: 1, days: WEEKDAYS, start: '11:30', end: '14:00' },
        { playlist: 2, days: EVERY_DAY, start: '22:00', end: '02:00' },
        { playlist: 1, days: saturday, start: '10:00', end: '15:00' },
        { playlist: 0, days: WEEKDAYS, start: '12:00', end: '12:30' },
      ],
    });
    // Everything else is the default playlist's draft.
    expect({ ...draft, items: null, schedule: null }).toEqual({
      ...alone(ID.listDefault),
      items: null,
    });
    expect(draft.transition).toBe('fade');
    expect(manifestVersionFor(draft)).toBe(4);
  });

  it('plans each distinct playlist once, whatever the letter case of its id', () => {
    const asked: string[] = [];
    const plan = planSchedulePublication({
      defaultPlaylistId: ID.listDefault.toUpperCase(),
      events: [
        event(ID.listLunch.toUpperCase()),
        event(ID.listLunch),
        event(ID.listDefault),
        event(ID.listEvening),
      ],
      planPlaylist: (id) => {
        asked.push(id);
        const playlist = PLAYLISTS[id as keyof typeof PLAYLISTS];
        return {
          name: playlist.name,
          itemCount: playlist.items.length,
          plan: () => ({ ok: true, draft: alone(id) }),
        };
      },
      route: route(),
    });
    expect(asked).toEqual([ID.listDefault, ID.listLunch, ID.listEvening]);
    expect(draftOf(plan).schedule?.events.map((e) => e.playlist)).toEqual([1, 1, 0, 2]);
  });

  it('does not share the days of an event with its input', () => {
    const days = [...WEEKDAYS];
    const draft = draftOf(
      planSchedule(PLAYLISTS, {
        defaultPlaylistId: ID.listDefault,
        events: [{ playlistId: ID.listLunch, days, start: '11:30', end: '14:00' }],
      }),
    );
    days[0] = false;
    expect(draft.schedule?.events[0]?.days).toEqual(WEEKDAYS);
  });

  it('refuses an empty event playlist at the first event that uses it', () => {
    const plan = planSchedule(
      { ...PLAYLISTS, [ID.listLunch]: { name: 'Lunch', items: [] } },
      {
        defaultPlaylistId: ID.listDefault,
        events: [event(ID.listEvening), event(ID.listLunch), event(ID.listLunch, '18:00', '19:00')],
      },
    );
    expect(issuesOf(plan)).toEqual([
      {
        index: null,
        code: 'playlist_empty',
        path: 'events[1].playlist',
        message: 'In playlist "Lunch": The playlist has no items. Add at least one image or video.',
      },
    ]);
  });

  it('keeps the item number of the playlist that holds a problem', () => {
    const plan = planSchedule(
      {
        ...PLAYLISTS,
        [ID.listDefault]: { name: 'Reception loop', items: [image(ID.processing)] },
        [ID.listLunch]: {
          name: 'Lunch',
          items: [image(ID.jpeg), image(ID.png), image(ID.failed), video(ID.hevc)],
        },
      },
      {
        defaultPlaylistId: ID.listDefault,
        events: [event(ID.listLunch), event(ID.listEvening)],
      },
    );
    // All of them, in playlist order; the route's refusal of the fourth item is not reached
    // because the playlist itself is invalid.
    expect(issuesOf(plan)).toEqual([
      {
        index: 0,
        code: 'media_not_ready',
        path: 'default.items[0]',
        message:
          'In playlist "Reception loop": Item 1 is still being checked. Wait until it is ready, then publish again.',
      },
      {
        index: 2,
        code: 'media_failed',
        path: 'events[0].items[2]',
        message:
          'In playlist "Lunch": Item 3 uses a file that failed validation. Remove it or upload a corrected file.',
      },
    ]);
  });

  it('passes on what the route refuses in one playlist', () => {
    const plan = planSchedule(
      {
        ...PLAYLISTS,
        [ID.listEvening]: { name: 'Evening', items: [image(ID.jpeg), video(ID.hevc)] },
      },
      { defaultPlaylistId: ID.listDefault, events: [event(ID.listLunch), event(ID.listEvening)] },
    );
    expect(issuesOf(plan)).toMatchObject([
      { index: 1, code: 'unsupported_codec', path: 'events[1].items[1]' },
    ]);
    expect(issuesOf(plan)[0]?.message).toMatch(
      /^In playlist "Evening": Item 2 uses the video codec/,
    );
  });

  it('refuses a playlist that no longer exists, as the default or in an event', () => {
    const message =
      'A playlist of this schedule no longer exists. Open the schedule and choose another.';
    const gone = '66666666-6666-4666-8666-0000000000ff';
    expect(
      issuesOf(
        planSchedule(PLAYLISTS, {
          defaultPlaylistId: ID.listDefault,
          events: [event(gone), event(ID.listLunch), event(gone)],
        }),
      ),
    ).toEqual([{ index: null, code: 'playlist_empty', path: 'events[0].playlist', message }]);
    expect(
      issuesOf(planSchedule(PLAYLISTS, { defaultPlaylistId: gone, events: [event(ID.listLunch)] })),
    ).toEqual([{ index: null, code: 'playlist_empty', path: 'default.playlist', message }]);
    // Even when no event could ever play another playlist.
    expect(issuesOf(planSchedule(PLAYLISTS, { defaultPlaylistId: gone, events: [] }))).toHaveLength(
      1,
    );
  });

  it('gives the draft of the default playlist when there are no events', () => {
    const draft = draftOf(planSchedule(PLAYLISTS, { defaultPlaylistId: ID.listLunch, events: [] }));
    expect(draft.schedule).toBeNull();
    expect(draft.items).toHaveLength(1);
    expect(manifestVersionFor(draft)).toBe(1);
  });

  it('gives the same draft when every event uses the default playlist', () => {
    const none = draftOf(
      planSchedule(PLAYLISTS, { defaultPlaylistId: ID.listDefault, events: [] }),
    );
    for (const events of [
      [event(ID.listDefault)],
      [event(ID.listDefault), event(ID.listDefault.toUpperCase(), '18:00', '20:00', EVERY_DAY)],
    ]) {
      const draft = draftOf(planSchedule(PLAYLISTS, { defaultPlaylistId: ID.listDefault, events }));
      expect(draft).toEqual(none);
      expect(draft.schedule).toBeNull();
      // The fade of the default playlist needs version 2, and nothing more.
      expect(manifestVersionFor(draft)).toBe(2);
    }
  });

  it('does not ask the route about a draft that is one playlist', () => {
    let judged = 0;
    const plan = planSchedulePublication({
      defaultPlaylistId: ID.listDefault,
      events: [event(ID.listDefault)],
      planPlaylist: (id) => ({
        name: 'Reception loop',
        itemCount: 2,
        plan: () => ({ ok: true, draft: alone(id) }),
      }),
      route: {
        capabilities: () => {
          throw new Error('not needed');
        },
        validate: () => {
          judged += 1;
          return [];
        },
      },
    });
    expect(plan.ok).toBe(true);
    expect(judged).toBe(0);
  });

  it('refuses a schedule whose playlists hold more items together than the route takes', () => {
    const many = (name: string): FixturePlaylist => ({
      name,
      items: Array.from({ length: 150 }, () => image(ID.jpeg)),
    });
    const playlists = { [ID.listDefault]: many('Reception loop'), [ID.listLunch]: many('Lunch') };
    const schedule = { defaultPlaylistId: ID.listDefault, events: [event(ID.listLunch)] };
    expect(issuesOf(planSchedule(playlists, schedule, { route: route(200) }))).toEqual([
      {
        index: null,
        code: 'too_many_items',
        path: 'schedule',
        message:
          'The playlists of this schedule hold 300 items in total; The browser player supports up to 200.',
      },
    ]);
    expect(draftOf(planSchedule(playlists, schedule, { route: route(300) })).items).toHaveLength(
      300,
    );
    // Each playlist alone is within the limit, so the schedule without the event is accepted.
    expect(planSchedule(playlists, { ...schedule, events: [] }, { route: route(200) }).ok).toBe(
      true,
    );
  });

  it('counts the items of every playlist before planning any of them', () => {
    let planned = 0;
    const plan = planSchedulePublication({
      defaultPlaylistId: ID.listDefault,
      events: [event(ID.listLunch), event(ID.listEvening)],
      planPlaylist: (id) => ({
        name: id,
        itemCount: 120,
        plan: () => {
          planned += 1;
          return { ok: true, draft: alone(ID.listDefault) };
        },
      }),
      route: route(200),
    });
    expect(issuesOf(plan)).toEqual([
      {
        index: null,
        code: 'too_many_items',
        path: 'schedule',
        message:
          'The playlists of this schedule hold 360 items in total; The browser player supports up to 200.',
      },
    ]);
    expect(planned).toBe(0);
  });

  it('carries the display facts of the target into the combined draft', () => {
    const hours = [{ start: '09:00', end: '17:00' }, null, null, null, null, null, null];
    const target = display({ rotation: 90, workingHours: hours, timeZone: 'Australia/Lord_Howe' });
    const draft = draftOf(
      planSchedule(
        {
          ...PLAYLISTS,
          [ID.listDefault]: { name: 'Reception loop', items: DEFAULT.items, playback },
        },
        { defaultPlaylistId: ID.listDefault, events: [event(ID.listLunch)] },
        { display: target },
      ),
    );
    expect(draft).toMatchObject({
      displayId: ID.display,
      rotation: 90,
      workingHours: hours,
      timeZone: 'Australia/Lord_Howe',
      transition: 'cut',
      shuffle: false,
    });
  });
});
