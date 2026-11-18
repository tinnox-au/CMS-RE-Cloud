import type { DisplayDto, PushPlanRow } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  anyHasOtherContent,
  assignedContent,
  CONTENT_KIND_LABEL,
  CONTENT_REPLACED_NOTE,
  contentHref,
  planRowContent,
} from './assignedContent.ts';
import { ID } from './mediaLibrary.test-support.ts';

const PLAYLIST = { id: ID(1), name: 'Lobby loop' };
const MAIN = { id: ID(2), name: 'Menu' };
const SCHEDULE = { id: ID(3), name: 'Opening hours', defaultPlaylist: PLAYLIST };
const LAYOUT = { id: ID(4), name: 'Menu with band', mainPlaylist: MAIN };

type Assigned = Pick<DisplayDto, 'assignedPlaylist' | 'assignedSchedule' | 'assignedLayout'>;
const NOTHING: Assigned = { assignedPlaylist: null, assignedSchedule: null, assignedLayout: null };

type Row = Pick<PushPlanRow, 'playlist' | 'schedule' | 'layout'>;

describe('assignedContent', () => {
  it('names the one kind of content a screen has, or null', () => {
    expect(assignedContent(NOTHING)).toBeNull();
    expect(assignedContent({ ...NOTHING, assignedPlaylist: PLAYLIST })).toEqual({
      kind: 'playlist',
      id: PLAYLIST.id,
      name: 'Lobby loop',
    });
    expect(assignedContent({ ...NOTHING, assignedSchedule: SCHEDULE })).toEqual({
      kind: 'schedule',
      id: SCHEDULE.id,
      name: 'Opening hours',
    });
    // The main playlist travels with the layout but is not what the screen has assigned.
    expect(assignedContent({ ...NOTHING, assignedLayout: LAYOUT })).toEqual({
      kind: 'layout',
      id: LAYOUT.id,
      name: 'Menu with band',
    });
  });
});

describe('planRowContent', () => {
  const none: Row = { playlist: null, schedule: null, layout: null };

  it('is null for a row with nothing assigned', () => {
    expect(planRowContent(none)).toBeNull();
  });

  it('reads a playlist row as its playlist', () => {
    expect(planRowContent({ ...none, playlist: PLAYLIST })).toEqual({
      kind: 'playlist',
      id: PLAYLIST.id,
      name: 'Lobby loop',
    });
  });

  it('reads a schedule row as its schedule, not its default playlist', () => {
    const row: Row = {
      ...none,
      playlist: PLAYLIST,
      schedule: { id: SCHEDULE.id, name: 'Opening hours' },
    };
    expect(planRowContent(row)).toEqual({
      kind: 'schedule',
      id: SCHEDULE.id,
      name: 'Opening hours',
    });
  });

  it('reads a layout row as its layout, not its main zone playlist', () => {
    const row: Row = { ...none, playlist: MAIN, layout: { id: LAYOUT.id, name: 'Menu with band' } };
    expect(planRowContent(row)).toEqual({ kind: 'layout', id: LAYOUT.id, name: 'Menu with band' });
  });
});

describe('contentHref and labels', () => {
  it('links each kind to its own page', () => {
    expect(contentHref('playlist', ID(1))).toBe(`/playlists/${ID(1)}`);
    expect(contentHref('schedule', ID(3))).toBe(`/schedules/${ID(3)}`);
    expect(contentHref('layout', ID(4))).toBe(`/layouts/${ID(4)}`);
  });

  it('labels each kind', () => {
    expect(CONTENT_KIND_LABEL).toEqual({
      playlist: 'Playlist',
      schedule: 'Schedule',
      layout: 'Layout',
    });
  });
});

describe('anyHasOtherContent', () => {
  it('is true when any screen has a schedule or a layout', () => {
    expect(anyHasOtherContent([])).toBe(false);
    expect(anyHasOtherContent([NOTHING, { ...NOTHING, assignedPlaylist: PLAYLIST }])).toBe(false);
    expect(anyHasOtherContent([NOTHING, { ...NOTHING, assignedSchedule: SCHEDULE }])).toBe(true);
    expect(anyHasOtherContent([{ ...NOTHING, assignedLayout: LAYOUT }, NOTHING])).toBe(true);
  });

  it('says what assigning a playlist does to them', () => {
    expect(CONTENT_REPLACED_NOTE).toBe(
      'A screen that has a schedule or a layout gets this playlist instead.',
    );
  });
});
