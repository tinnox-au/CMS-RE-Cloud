import {
  ScheduleInputSchema,
  type PlaylistSummaryDto,
  type ScheduleDto,
  type ScheduleSummaryDto,
} from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { sortRows } from './listView.ts';
import { ID } from './mediaLibrary.test-support.ts';
import {
  DEFAULT_SCHEDULE_SORT,
  endsNextDay,
  eventCountLabel,
  filterScheduleList,
  MAX_SCHEDULE_EVENTS,
  moveEvent,
  newEventDraft,
  NO_SCHEDULE_ERRORS,
  playlistsByName,
  SCHEDULE_SORT_ACCESSORS,
  scheduleDraftFromDto,
  scheduleErrorEntries,
  scheduleErrorsFromApi,
  scheduleIsDirty,
  scheduleSummaryLabel,
  validateScheduleDraft,
  withoutEventError,
  withoutScheduleError,
  type ScheduleDraft,
  type ScheduleEventDraft,
} from './schedules.ts';

const T = '2026-11-14T03:00:00.000Z';
const DEFAULT = ID(1);
const LUNCH = ID(2);
const NIGHT = ID(3);
const WEEKDAYS = [true, true, true, true, true, false, false];
const EVERY_DAY = [true, true, true, true, true, true, true];

function schedule(change: Partial<ScheduleDto> = {}): ScheduleDto {
  return {
    id: ID(9),
    name: 'Opening hours',
    description: null,
    defaultPlaylist: { id: DEFAULT, name: 'Lobby loop' },
    events: [
      { playlist: { id: LUNCH, name: 'Lunch' }, days: WEEKDAYS, start: '11:30', end: '14:00' },
      { playlist: { id: NIGHT, name: 'Night' }, days: EVERY_DAY, start: '22:00', end: '24:00' },
    ],
    assignedDisplayCount: 0,
    createdAt: T,
    updatedAt: T,
    ...change,
  };
}

function summary(n: number, change: Partial<ScheduleSummaryDto> = {}): ScheduleSummaryDto {
  return {
    id: ID(n),
    name: `Schedule ${String(n)}`,
    description: null,
    defaultPlaylist: { id: DEFAULT, name: 'Lobby loop' },
    eventCount: 0,
    assignedDisplayCount: 0,
    createdAt: T,
    updatedAt: T,
    ...change,
  };
}

function eventDraft(key: string, change: Partial<ScheduleEventDraft> = {}): ScheduleEventDraft {
  return { key, playlistId: LUNCH, days: WEEKDAYS, start: '09:00', end: '17:00', ...change };
}

function draftOf(change: Partial<ScheduleDraft> = {}): ScheduleDraft {
  return { ...scheduleDraftFromDto(schedule()), ...change };
}

describe('the draft of a schedule', () => {
  it('holds the stored schedule, with midnight at the end shown as 00:00', () => {
    expect(scheduleDraftFromDto(schedule({ description: 'Front of house' }))).toEqual({
      name: 'Opening hours',
      description: 'Front of house',
      defaultPlaylistId: DEFAULT,
      events: [
        { key: 'saved-0', playlistId: LUNCH, days: WEEKDAYS, start: '11:30', end: '14:00' },
        { key: 'saved-1', playlistId: NIGHT, days: EVERY_DAY, start: '22:00', end: '00:00' },
      ],
    });
    expect(scheduleDraftFromDto(schedule()).description).toBe('');
  });

  it('keeps the rendering keys it is given, by position', () => {
    const keys = scheduleDraftFromDto(schedule(), ['a']).events.map((event) => event.key);
    expect(keys).toEqual(['a', 'saved-1']);
  });

  it('starts a new event with no playlist, every day and no times', () => {
    expect(newEventDraft('k')).toEqual({
      key: 'k',
      playlistId: '',
      days: EVERY_DAY,
      start: '',
      end: '',
    });
    expect(MAX_SCHEDULE_EVENTS).toBe(50);
  });

  it('is clean until something that would be saved differs', () => {
    const saved = schedule({ description: 'Front of house' });
    const draft = scheduleDraftFromDto(saved);
    expect(scheduleIsDirty(saved, draft)).toBe(false);
    // Spaces around the name, a CR LF and other rendering keys are not changes.
    expect(scheduleIsDirty(saved, { ...draft, name: ' Opening hours ' })).toBe(false);
    expect(scheduleIsDirty(saved, { ...draft, description: 'Front of house\r\n' })).toBe(false);
    expect(scheduleIsDirty(saved, scheduleDraftFromDto(saved, ['x', 'y']))).toBe(false);

    expect(scheduleIsDirty(saved, { ...draft, name: 'Hours' })).toBe(true);
    expect(scheduleIsDirty(saved, { ...draft, description: '' })).toBe(true);
    expect(scheduleIsDirty(saved, { ...draft, defaultPlaylistId: LUNCH })).toBe(true);
    expect(scheduleIsDirty(saved, { ...draft, events: draft.events.slice(0, 1) })).toBe(true);
    expect(
      scheduleIsDirty(saved, { ...draft, events: [...draft.events, newEventDraft('n')] }),
    ).toBe(true);
    expect(scheduleIsDirty(saved, { ...draft, events: moveEvent(draft.events, 0, 1) })).toBe(true);
    const [first, second] = draft.events;
    if (first === undefined || second === undefined) throw new Error('two events expected');
    const edits: Partial<ScheduleEventDraft>[] = [
      { playlistId: NIGHT },
      { start: '11:00' },
      { end: '14:30' },
      { days: EVERY_DAY },
    ];
    for (const change of edits) {
      expect(scheduleIsDirty(saved, { ...draft, events: [{ ...first, ...change }, second] })).toBe(
        true,
      );
    }
  });
});

describe('moving an event', () => {
  const events = [eventDraft('a'), eventDraft('b'), eventDraft('c')];
  const keys = (list: readonly ScheduleEventDraft[]) => list.map((event) => event.key).join('');

  it('moves it up or down by one place', () => {
    expect(keys(moveEvent(events, 0, 1))).toBe('bac');
    expect(keys(moveEvent(events, 2, -1))).toBe('acb');
    expect(keys(moveEvent(events, 1, -1))).toBe('bac');
    expect(keys(events)).toBe('abc');
  });

  it('returns the same list when the event cannot move', () => {
    expect(moveEvent(events, 0, -1)).toBe(events);
    expect(moveEvent(events, 2, 1)).toBe(events);
    expect(moveEvent(events, 5, -1)).toBe(events);
    expect(moveEvent(events, 1, 0)).toBe(events);
  });
});

describe('an event that runs past midnight', () => {
  it('is one whose stored end is before its start', () => {
    expect(endsNextDay({ start: '22:00', end: '02:00' })).toBe(true);
    expect(endsNextDay({ start: '09:00', end: '17:00' })).toBe(false);
    // Up to midnight is the same day; 00:00 to 00:00 is the whole day.
    expect(endsNextDay({ start: '22:00', end: '00:00' })).toBe(false);
    expect(endsNextDay({ start: '00:00', end: '00:00' })).toBe(false);
    expect(endsNextDay({ start: '', end: '02:00' })).toBe(false);
    expect(endsNextDay({ start: '22:00', end: '' })).toBe(false);
  });
});

describe('validateScheduleDraft', () => {
  it('builds the whole schedule, with the description always sent', () => {
    const result = validateScheduleDraft(
      draftOf({ name: '  Opening hours ', description: ' Front of house\r\nand bar ' }),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Opening hours',
        description: 'Front of house\nand bar',
        defaultPlaylistId: DEFAULT,
        events: [
          { playlistId: LUNCH, days: WEEKDAYS, start: '11:30', end: '14:00' },
          { playlistId: NIGHT, days: EVERY_DAY, start: '22:00', end: '24:00' },
        ],
      },
    });
    const cleared = validateScheduleDraft(draftOf({ description: '   ', events: [] }));
    expect(cleared.ok && cleared.value.description).toBeNull();
    expect(cleared.ok && cleared.value.events).toEqual([]);
  });

  it('sends what the API accepts: an end of 00:00, the whole day and an overnight event', () => {
    const result = validateScheduleDraft(
      draftOf({
        events: [
          eventDraft('a', { start: '18:00', end: '00:00' }),
          eventDraft('b', { start: '00:00', end: '00:00' }),
          eventDraft('c', { start: '22:00', end: '02:00' }),
        ],
      }),
    );
    if (!result.ok) throw new Error('expected a valid draft');
    expect(result.value.events.map((event) => `${event.start}-${event.end}`)).toEqual([
      '18:00-24:00',
      '00:00-24:00',
      '22:00-02:00',
    ]);
    expect(ScheduleInputSchema.safeParse(result.value).success).toBe(true);
  });

  it('says in plain words what is missing, at each control', () => {
    const result = validateScheduleDraft({
      name: '  ',
      description: 'a\tb',
      defaultPlaylistId: '',
      events: [
        eventDraft('ok'),
        newEventDraft('new'),
        eventDraft('none', { days: Array.from({ length: 7 }, () => false) }),
        eventDraft('same', { start: '10:00', end: '10:00' }),
        eventDraft('half', { end: '' }),
      ],
    });
    if (result.ok) throw new Error('expected errors');
    expect(result.errors.name).toBe('Enter a name.');
    expect(result.errors.description).toBe('Remove the tabs or other control characters.');
    expect(result.errors.defaultPlaylistId).toBe('Choose a default playlist.');
    expect(result.errors.form).toBeUndefined();
    expect([...result.errors.events.keys()]).toEqual(['new', 'none', 'same', 'half']);
    expect(result.errors.events.get('new')).toEqual({
      playlistId: 'Choose a playlist.',
      time: 'Enter a start and an end time.',
    });
    expect(result.errors.events.get('none')).toEqual({ days: 'Choose at least one day.' });
    expect(result.errors.events.get('same')).toEqual({
      time: 'Start and end must differ. For the whole day, set both to 00:00.',
    });
    expect(result.errors.events.get('half')).toEqual({ time: 'Enter a start and an end time.' });
  });

  it('refuses a description that is too long', () => {
    const result = validateScheduleDraft(draftOf({ description: 'x'.repeat(501) }));
    expect(!result.ok && result.errors.description).toBe('Use at most 500 characters (now 501).');
  });
});

describe('scheduleErrorsFromApi', () => {
  const draft = draftOf({ events: [eventDraft('a'), eventDraft('b'), eventDraft('c')] });

  it('puts each dotted path at its control', () => {
    const errors = scheduleErrorsFromApi(
      [
        { path: 'description', message: 'description must not contain control characters' },
        { path: 'defaultPlaylistId', message: 'The playlist was not found.' },
        { path: 'events.2.playlistId', message: 'The playlist was not found.' },
        { path: 'events.0.days', message: 'choose at least one day' },
        { path: 'events.1.start', message: 'start must be before 24:00' },
        { path: 'events.1.end', message: 'end must differ from start' },
        { path: 'name', message: '' },
      ],
      draft,
    );
    expect(errors.name).toBe('The server refused this value.');
    expect(errors.description).toBe(
      'The server refused this value: description must not contain control characters',
    );
    expect(errors.defaultPlaylistId).toBe(
      'The server refused this value: The playlist was not found.',
    );
    expect(errors.form).toBeUndefined();
    expect(errors.events.get('c')).toEqual({
      playlistId: 'The server refused this value: The playlist was not found.',
    });
    expect(errors.events.get('a')).toEqual({
      days: 'The server refused this value: choose at least one day',
    });
    // Start and end share one slot; the first message wins.
    expect(errors.events.get('b')).toEqual({
      time: 'The server refused this value: start must be before 24:00',
    });
  });

  it('reads a bare event path as its times', () => {
    const errors = scheduleErrorsFromApi([{ path: 'events.1', message: 'bad rule' }], draft);
    expect(errors.events.get('b')).toEqual({ time: 'The server refused this value: bad rule' });
  });

  it('sends anything it cannot place to the form', () => {
    for (const path of [
      'colour',
      'events',
      'events.7.playlistId',
      'events.x.days',
      'events.0.colour',
      'name.first',
      '',
    ]) {
      const errors = scheduleErrorsFromApi([{ path, message: 'no' }], draft);
      expect(errors.form, path).toBe('The server refused this value: no');
      expect(errors.events.size, path).toBe(0);
      expect(errors.name, path).toBeUndefined();
    }
    const two = scheduleErrorsFromApi(
      [
        { path: 'colour', message: 'first' },
        { path: 'shape', message: 'second' },
      ],
      draft,
    );
    expect(two.form).toBe('The server refused this value: first');
  });
});

describe('the error summary', () => {
  it('lists the messages in the order of the form, each with the control to focus', () => {
    const draft = draftOf({ events: [eventDraft('a'), eventDraft('b'), eventDraft('c')] });
    const entries = scheduleErrorEntries(
      {
        name: 'Enter a name.',
        description: 'Too long.',
        defaultPlaylistId: 'Choose a default playlist.',
        form: 'Something else.',
        events: new Map([
          ['c', { playlistId: 'Choose a playlist.', days: 'Choose at least one day.' }],
          ['b', { time: 'Enter a start and an end time.' }],
          // An event that has since been removed is not listed.
          ['gone', { playlistId: 'Choose a playlist.' }],
        ]),
      },
      draft,
    );
    expect(entries.map((entry) => [entry.text, entry.target])).toEqual([
      ['Name: Enter a name.', 'schedule-name'],
      ['Description: Too long.', 'schedule-description'],
      ['Default playlist: Choose a default playlist.', 'schedule-default-playlist'],
      ['Event 2: Enter a start and an end time.', 'schedule-event-1-start'],
      ['Event 3: Choose a playlist.', 'schedule-event-2-playlist'],
      ['Event 3: Choose at least one day.', 'schedule-event-2-day-0'],
      ['Schedule: Something else.', null],
    ]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(scheduleErrorEntries(NO_SCHEDULE_ERRORS, draft)).toEqual([]);
  });

  it('drops a message once its control changes', () => {
    const errors = {
      name: 'Enter a name.',
      events: new Map([
        ['a', { playlistId: 'Choose a playlist.', time: 'Enter a start and an end time.' }],
      ]),
    };
    expect(withoutScheduleError(errors, 'name').name).toBeUndefined();
    expect(withoutScheduleError(errors, 'description')).toBe(errors);

    const withoutPlaylist = withoutEventError(errors, 'a', 'playlistId');
    expect(withoutPlaylist.events.get('a')).toEqual({ time: 'Enter a start and an end time.' });
    expect(withoutPlaylist.name).toBe('Enter a name.');
    expect(withoutEventError(withoutPlaylist, 'a', 'time').events.size).toBe(0);
    expect(withoutEventError(errors, 'a', 'days')).toBe(errors);
    expect(withoutEventError(errors, 'b', 'time')).toBe(errors);
    // The original is never changed.
    expect(errors.events.get('a')).toHaveProperty('playlistId');
  });
});

describe('the playlists a select lists', () => {
  it('are in order of name, whatever order the API gave', () => {
    const playlist = (n: number, name: string): PlaylistSummaryDto => ({
      id: ID(n),
      name,
      description: null,
      itemCount: 0,
      totalDurationMs: 0,
      kinds: [],
      previewMediaIds: [],
      assignedDisplayCount: 0,
      createdAt: T,
      updatedAt: T,
    });
    const listed = [playlist(1, 'lunch'), playlist(2, 'Evening 10'), playlist(3, 'Evening 2')];
    expect(playlistsByName(listed).map((item) => item.name)).toEqual([
      'Evening 2',
      'Evening 10',
      'lunch',
    ]);
    expect(listed[0]?.name).toBe('lunch');
  });
});

describe('the schedules list', () => {
  const items = [
    summary(1, { name: 'Weekend', description: 'Saturday specials', eventCount: 3 }),
    summary(2, {
      name: 'Opening hours',
      defaultPlaylist: { id: LUNCH, name: 'Menu board' },
      assignedDisplayCount: 2,
      updatedAt: '2026-11-15T03:00:00.000Z',
    }),
    summary(3, { name: 'After hours', eventCount: 1 }),
  ];

  it('counts events in words', () => {
    expect(eventCountLabel(0)).toBe('No events');
    expect(eventCountLabel(1)).toBe('1 event');
    expect(eventCountLabel(12)).toBe('12 events');
  });

  it('describes a schedule in a picker', () => {
    expect(scheduleSummaryLabel(summary(1))).toBe('Default: Lobby loop · No events');
    expect(scheduleSummaryLabel(summary(1, { eventCount: 2 }))).toBe(
      'Default: Lobby loop · 2 events',
    );
  });

  it('searches the name, the description and the default playlist', () => {
    const names = (query: string) => filterScheduleList(items, query).map((item) => item.name);
    expect(names('')).toEqual(['Weekend', 'Opening hours', 'After hours']);
    expect(names('HOURS')).toEqual(['Opening hours', 'After hours']);
    expect(names('saturday')).toEqual(['Weekend']);
    expect(names('menu')).toEqual(['Opening hours']);
    expect(names('nothing')).toEqual([]);
  });

  it('sorts by each column, by name to start with', () => {
    const order = (columnId: string, direction: 'asc' | 'desc' = 'asc') =>
      sortRows(items, { columnId, direction }, SCHEDULE_SORT_ACCESSORS).map((item) => item.name);
    expect(sortRows(items, DEFAULT_SCHEDULE_SORT, SCHEDULE_SORT_ACCESSORS)[0]?.name).toBe(
      'After hours',
    );
    expect(order('name')).toEqual(['After hours', 'Opening hours', 'Weekend']);
    expect(order('playlist')[2]).toBe('Opening hours');
    expect(order('events', 'desc')).toEqual(['Weekend', 'After hours', 'Opening hours']);
    expect(order('screens', 'desc')[0]).toBe('Opening hours');
    expect(order('updated', 'desc')[0]).toBe('Opening hours');
  });
});
