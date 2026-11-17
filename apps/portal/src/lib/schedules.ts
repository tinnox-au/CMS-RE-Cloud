/**
 * Schedules in the portal (docs/portal-v2/stage-b.md, slice 3, section 7). Pure functions, no
 * DOM: the editor's draft, what differs from the saved schedule, the body of
 * `POST /api/schedules` and `PUT /api/schedules/:id`, the checks in plain words, where a
 * refusal's details belong, and the list's search, order and labels. The API stays the authority.
 */
import {
  ABSOLUTE,
  type ApiErrorDetail,
  type PlaylistSummaryDto,
  type ScheduleDto,
  type ScheduleInput,
  type ScheduleSummaryDto,
} from '@tinnox/contracts';
import { matchesSearch, sortRows, type SortAccessors, type SortState } from './listView.ts';
import { descriptionProblem, nameProblem } from './playlistEditor.ts';

// ---------------------------------------------------------------------------
// The editor's draft

/** One weekly event as the form holds it. */
export interface ScheduleEventDraft {
  /** Stable key for rendering and for the event's errors; not sent to the API. */
  readonly key: string;
  /** '' while no playlist is chosen. */
  readonly playlistId: string;
  /** Seven entries, Monday first: the days on which the event starts. */
  readonly days: readonly boolean[];
  /** '' or 'HH:mm', as a time field gives it. */
  readonly start: string;
  /** '' or 'HH:mm'; '00:00' is midnight at the end of the day. */
  readonly end: string;
}

export interface ScheduleDraft {
  readonly name: string;
  readonly description: string;
  /** '' while no playlist is chosen. */
  readonly defaultPlaylistId: string;
  /** In priority order: the first event that covers a moment plays. */
  readonly events: readonly ScheduleEventDraft[];
}

/** The most events a schedule holds; "Add event" stops here. */
export const MAX_SCHEDULE_EVENTS = ABSOLUTE.maxScheduleEvents;

/** The playlists by name, as the native selects of the create dialog and the editor list them. */
export function playlistsByName(
  playlists: readonly PlaylistSummaryDto[],
): readonly PlaylistSummaryDto[] {
  return sortRows(playlists, { columnId: 'name', direction: 'asc' }, { name: (p) => p.name });
}

/** A time field cannot show 24:00, so midnight at the end is shown, and typed, as 00:00. */
function shownEnd(end: string): string {
  return end === '24:00' ? '00:00' : end;
}

/** The end as the API stores it. */
function storedEnd(end: string): string {
  return end === '00:00' ? '24:00' : end;
}

/**
 * The draft of a stored schedule. `keys` are the rendering keys to keep, by position (the
 * draft the schedule was just saved from), so a save does not rebuild the event rows.
 */
export function scheduleDraftFromDto(
  schedule: ScheduleDto,
  keys: readonly string[] = [],
): ScheduleDraft {
  return {
    name: schedule.name,
    description: schedule.description ?? '',
    defaultPlaylistId: schedule.defaultPlaylist.id,
    events: schedule.events.map((event, index) => ({
      key: keys[index] ?? `saved-${String(index)}`,
      playlistId: event.playlist.id,
      days: [...event.days],
      start: event.start,
      end: shownEnd(event.end),
    })),
  };
}

/** A new event: no playlist, every day ticked, no times. */
export function newEventDraft(key: string): ScheduleEventDraft {
  return { key, playlistId: '', days: Array.from({ length: 7 }, () => true), start: '', end: '' };
}

/** The events with the one at `index` moved by `delta` places; the same list when it cannot move. */
export function moveEvent(
  events: readonly ScheduleEventDraft[],
  index: number,
  delta: number,
): readonly ScheduleEventDraft[] {
  const target = index + delta;
  const event = events[index];
  if (event === undefined || delta === 0 || target < 0 || target >= events.length) return events;
  const next = events.filter((_, at) => at !== index);
  next.splice(target, 0, event);
  return next;
}

/** True when both times are set and the event runs past midnight into the next day. */
export function endsNextDay(event: Pick<ScheduleEventDraft, 'start' | 'end'>): boolean {
  return event.start !== '' && event.end !== '' && storedEnd(event.end) < event.start;
}

// The rule of the playlist editor's private `descriptionToSave` (lib/playlistEditor.ts).
function descriptionToSave(text: string): string | null {
  const trimmed = text.replace(/\r\n?/g, '\n').trim();
  return trimmed === '' ? null : trimmed;
}

function sameEvent(a: ScheduleEventDraft, b: ScheduleEventDraft): boolean {
  return (
    a.playlistId === b.playlistId &&
    a.start === b.start &&
    a.end === b.end &&
    a.days.length === b.days.length &&
    a.days.every((day, index) => day === b.days[index])
  );
}

/** True when the draft holds something other than the saved schedule. */
export function scheduleIsDirty(saved: ScheduleDto, draft: ScheduleDraft): boolean {
  const stored = scheduleDraftFromDto(saved);
  return (
    draft.name.trim() !== stored.name ||
    descriptionToSave(draft.description) !== saved.description ||
    draft.defaultPlaylistId !== stored.defaultPlaylistId ||
    draft.events.length !== stored.events.length ||
    draft.events.some((event, index) => {
      const other = stored.events[index];
      return other === undefined || !sameEvent(event, other);
    })
  );
}

// ---------------------------------------------------------------------------
// Checks

/** The messages of one event, under the control each belongs to. */
export interface ScheduleEventErrors {
  readonly playlistId?: string;
  readonly days?: string;
  /** Start and end share one message, shown under the pair. */
  readonly time?: string;
}

export interface ScheduleErrors {
  readonly name?: string;
  readonly description?: string;
  readonly defaultPlaylistId?: string;
  /** A message that belongs to no control; shown in the error summary only. */
  readonly form?: string;
  /** By the event's `key`. */
  readonly events: ReadonlyMap<string, ScheduleEventErrors>;
}

export const NO_SCHEDULE_ERRORS: ScheduleErrors = Object.freeze({ events: new Map() });

export type ScheduleDraftResult =
  | { readonly ok: true; readonly value: ScheduleInput }
  | { readonly ok: false; readonly errors: ScheduleErrors };

function eventProblems(event: ScheduleEventDraft): ScheduleEventErrors | null {
  const problems: { playlistId?: string; days?: string; time?: string } = {};
  if (event.playlistId === '') problems.playlistId = 'Choose a playlist.';
  if (!event.days.some(Boolean)) problems.days = 'Choose at least one day.';
  if (event.start === '' || event.end === '') {
    problems.time = 'Enter a start and an end time.';
  } else if (event.start === storedEnd(event.end)) {
    // 00:00 to 00:00 is stored as 00:00 to 24:00, the whole day, so it does not come here.
    problems.time = 'Start and end must differ. For the whole day, set both to 00:00.';
  }
  return Object.keys(problems).length === 0 ? null : problems;
}

function hasErrors(errors: ScheduleErrors): boolean {
  return (
    errors.name !== undefined ||
    errors.description !== undefined ||
    errors.defaultPlaylistId !== undefined ||
    errors.form !== undefined ||
    errors.events.size > 0
  );
}

/**
 * Checks the draft and builds the whole schedule for the API, or every message to show. The
 * description is always sent (the trimmed text, or null when blank), so clearing the field
 * clears it; an end of 00:00 is sent as 24:00.
 */
export function validateScheduleDraft(draft: ScheduleDraft): ScheduleDraftResult {
  const top: { name?: string; description?: string; defaultPlaylistId?: string } = {};
  const name = nameProblem(draft.name);
  if (name !== null) top.name = name;
  const description = descriptionProblem(draft.description);
  if (description !== null) top.description = description;
  if (draft.defaultPlaylistId === '') top.defaultPlaylistId = 'Choose a default playlist.';
  const events = new Map<string, ScheduleEventErrors>();
  for (const event of draft.events) {
    const problems = eventProblems(event);
    if (problems !== null) events.set(event.key, problems);
  }
  const errors: ScheduleErrors = { ...top, events };
  if (hasErrors(errors)) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: draft.name.trim(),
      description: descriptionToSave(draft.description),
      defaultPlaylistId: draft.defaultPlaylistId,
      events: draft.events.map((event) => ({
        playlistId: event.playlistId,
        days: [...event.days],
        start: event.start,
        end: storedEnd(event.end),
      })),
    },
  };
}

const EVENT_SLOTS: Readonly<Record<string, keyof ScheduleEventErrors>> = {
  playlistId: 'playlistId',
  days: 'days',
  start: 'time',
  end: 'time',
};

/**
 * A refusal's field details as messages at the controls. The API names the fields of this
 * body with dots (`ScheduleInputSchema`): `name`, `description`, `defaultPlaylistId`,
 * `events.2.playlistId`, `events.0.days`, `events.1.start`, `events.1.end`; a bare
 * `events.1` is the event's times. Anything else (an unknown path, an index with no event)
 * goes to `form`. The first message per slot wins.
 */
export function scheduleErrorsFromApi(
  details: readonly ApiErrorDetail[],
  draft: ScheduleDraft,
): ScheduleErrors {
  const top: { name?: string; description?: string; defaultPlaylistId?: string; form?: string } =
    {};
  const events = new Map<string, { playlistId?: string; days?: string; time?: string }>();
  for (const detail of details) {
    const [first, second, third] = detail.path.split('.');
    const text = detail.message.trim();
    const message =
      text === '' ? 'The server refused this value.' : `The server refused this value: ${text}`;
    if (
      second === undefined &&
      (first === 'name' || first === 'description' || first === 'defaultPlaylistId')
    ) {
      top[first] ??= message;
      continue;
    }
    const event =
      first === 'events' && second !== undefined && /^\d+$/.test(second)
        ? draft.events[Number(second)]
        : undefined;
    const slot = third === undefined ? 'time' : EVENT_SLOTS[third];
    if (event === undefined || slot === undefined) {
      top.form ??= message;
      continue;
    }
    const slots = events.get(event.key) ?? {};
    slots[slot] ??= message;
    events.set(event.key, slots);
  }
  return { ...top, events };
}

/** The errors without the message of one top-level field; the same object when it had none. */
export function withoutScheduleError(
  errors: ScheduleErrors,
  field: 'name' | 'description' | 'defaultPlaylistId',
): ScheduleErrors {
  if (errors[field] === undefined) return errors;
  const { [field]: _removed, ...rest } = errors;
  return rest;
}

/** The errors without one message of one event; the same object when it had none. */
export function withoutEventError(
  errors: ScheduleErrors,
  key: string,
  slot: keyof ScheduleEventErrors,
): ScheduleErrors {
  const current = errors.events.get(key);
  if (current?.[slot] === undefined) return errors;
  const { [slot]: _removed, ...rest } = current;
  const events = new Map(errors.events);
  if (Object.keys(rest).length === 0) events.delete(key);
  else events.set(key, rest);
  return { ...errors, events };
}

/** One line of the editor's error summary. */
export interface ScheduleErrorEntry {
  /** Unique within the summary. */
  readonly id: string;
  /** "Event 3: Choose a playlist." */
  readonly text: string;
  /** The test id of the control the line's link focuses; null for a message with no control. */
  readonly target: string | null;
}

/** The first control of each slot of an event, by the suffix of its test id. */
const EVENT_TARGETS: readonly (readonly [keyof ScheduleEventErrors, string])[] = [
  ['playlistId', 'playlist'],
  ['days', 'day-0'],
  ['time', 'start'],
];

/** The error summary, top to bottom in the order of the form. Events count from 1. */
export function scheduleErrorEntries(
  errors: ScheduleErrors,
  draft: ScheduleDraft,
): readonly ScheduleErrorEntry[] {
  const entries: ScheduleErrorEntry[] = [];
  if (errors.name !== undefined) {
    entries.push({ id: 'name', text: `Name: ${errors.name}`, target: 'schedule-name' });
  }
  if (errors.description !== undefined) {
    entries.push({
      id: 'description',
      text: `Description: ${errors.description}`,
      target: 'schedule-description',
    });
  }
  if (errors.defaultPlaylistId !== undefined) {
    entries.push({
      id: 'defaultPlaylistId',
      text: `Default playlist: ${errors.defaultPlaylistId}`,
      target: 'schedule-default-playlist',
    });
  }
  draft.events.forEach((event, index) => {
    const problems = errors.events.get(event.key);
    if (problems === undefined) return;
    for (const [slot, suffix] of EVENT_TARGETS) {
      const message = problems[slot];
      if (message === undefined) continue;
      entries.push({
        id: `${event.key}-${slot}`,
        text: `Event ${String(index + 1)}: ${message}`,
        target: `schedule-event-${String(index)}-${suffix}`,
      });
    }
  });
  if (errors.form !== undefined) {
    entries.push({ id: 'form', text: `Schedule: ${errors.form}`, target: null });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// The list

/** "No events", "1 event", "3 events". */
export function eventCountLabel(count: number): string {
  if (count <= 0) return 'No events';
  return count === 1 ? '1 event' : `${String(count)} events`;
}

/** The second line of a schedule in a picker: "Default: Lobby loop · 2 events". */
export function scheduleSummaryLabel(
  schedule: Pick<ScheduleSummaryDto, 'defaultPlaylist' | 'eventCount'>,
): string {
  return `Default: ${schedule.defaultPlaylist.name} · ${eventCountLabel(schedule.eventCount)}`;
}

export const SCHEDULE_SORT_ACCESSORS: SortAccessors<ScheduleSummaryDto> = {
  name: (schedule) => schedule.name,
  playlist: (schedule) => schedule.defaultPlaylist.name,
  events: (schedule) => schedule.eventCount,
  screens: (schedule) => schedule.assignedDisplayCount,
  updated: (schedule) => new Date(schedule.updatedAt),
};

export const DEFAULT_SCHEDULE_SORT: SortState = { columnId: 'name', direction: 'asc' };

/** The schedules a search (name, description and default playlist name) leaves. */
export function filterScheduleList(
  items: readonly ScheduleSummaryDto[],
  query: string,
): readonly ScheduleSummaryDto[] {
  return items.filter((schedule) =>
    matchesSearch([schedule.name, schedule.description, schedule.defaultPlaylist.name], query),
  );
}
