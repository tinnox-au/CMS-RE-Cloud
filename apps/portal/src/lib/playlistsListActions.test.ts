import type { PushPlanResponse, PushPlanRow, PushState } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../api/client.ts';
import {
  assignConfirmLabel,
  assignPushView,
  assignResultNote,
  assignResultTitle,
  canPushAfterAssign,
  deleteConfirmLabel,
  deletedNote,
  deletedToast,
  deleteFailureText,
  deleteFailureTitle,
  deleteQuestion,
  deleteRetryItems,
  duplicatedToast,
  failureText,
  isInUseRefusal,
  mergeDeleteRetry,
  refusalNames,
  screenWording,
} from './playlistsListActions.ts';

const PLAYLIST = '11111111-1111-4111-8111-111111111111';
const OTHER_PLAYLIST = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function inUse(screens: readonly string[]): ApiRequestError {
  return new ApiRequestError({
    status: 409,
    code: 'playlist_in_use',
    message: 'This playlist is assigned to a display. Assign other content to the display first.',
    details: screens.map((name) => ({ path: 'display', message: name })),
    fromApi: true,
  });
}

function usedBySchedules(schedules: readonly string[]): ApiRequestError {
  return new ApiRequestError({
    status: 409,
    code: 'playlist_in_use',
    message: 'This playlist is used by a schedule. Choose another playlist in the schedule first.',
    details: schedules.map((name) => ({ path: 'schedule', message: name })),
    fromApi: true,
  });
}

function row(
  displayId: string,
  state: PushState,
  playlistId: string | null,
  scheduleId: string | null = null,
): PushPlanRow {
  return {
    display: { id: displayId, name: `Screen ${displayId.slice(0, 1)}` },
    playlist: playlistId === null ? null : { id: playlistId, name: 'Loop' },
    schedule: scheduleId === null ? null : { id: scheduleId, name: 'Opening hours' },
    state,
    issues:
      state === 'blocked'
        ? [{ code: 'playlist_empty', path: '', message: 'The playlist has no items.' }]
        : [],
    lastPushedAt: null,
  };
}

function plan(...items: PushPlanRow[]): PushPlanResponse {
  return {
    items,
    pendingCount: items.filter((item) => item.state === 'changes' || item.state === 'never_pushed')
      .length,
  };
}

describe('the portal’s word for the object', () => {
  it('puts an API message into it and leaves the rest alone', () => {
    expect(screenWording('The display was not found.')).toBe('The screen was not found.');
    expect(screenWording('Displays of another site')).toBe('Screens of another site');
    expect(screenWording('assigned to 2 displays')).toBe('assigned to 2 screens');
    expect(screenWording('The displayed name is too long')).toBe('The displayed name is too long');
    expect(screenWording('The playlist was not found.')).toBe('The playlist was not found.');
  });
});

describe('what a failed request says', () => {
  it('gives the API message and its code', () => {
    const error = new ApiRequestError({
      status: 404,
      code: 'not_found',
      message: 'The display was not found.',
      fromApi: true,
    });
    expect(failureText(error)).toEqual({ message: 'The screen was not found.', code: 'not_found' });
  });

  it('has no code for anything else', () => {
    expect(failureText(new Error('boom'))).toEqual({ message: 'boom', code: null });
    expect(failureText('odd')).toEqual({ message: 'An unexpected error occurred.', code: null });
  });
});

describe('a playlist that was not deleted', () => {
  it('names the screens that have it assigned and says what to do', () => {
    expect(deleteFailureText(inUse(['Foyer']), 1)).toEqual({
      message: 'Assigned to Foyer.',
      code: 'playlist_in_use',
      hint: 'Assign other content to that screen, then delete the playlist.',
      inUse: true,
      bySchedule: false,
    });
    expect(deleteFailureText(inUse(['Foyer', 'Lift lobby', 'Window']), 3)).toMatchObject({
      message: 'Assigned to Foyer, Lift lobby and Window.',
      hint: 'Assign other content to those screens, then delete the playlist.',
    });
  });

  it('names the schedules that use it and says what to do', () => {
    expect(deleteFailureText(usedBySchedules(['Opening hours']), 0)).toEqual({
      message: 'Used by the schedule Opening hours.',
      code: 'playlist_in_use',
      hint: 'Choose another playlist in that schedule, then delete the playlist.',
      inUse: true,
      bySchedule: true,
    });
    // The count of screens says nothing about schedules: no "and 3 more".
    expect(deleteFailureText(usedBySchedules(['Opening hours', 'Weekend']), 3)).toMatchObject({
      message: 'Used by the schedules Opening hours and Weekend.',
      hint: 'Choose another playlist in those schedules, then delete the playlist.',
    });
  });

  it('reads the names of one kind from the details of a refusal', () => {
    const details = [
      { path: 'display', message: 'Foyer' },
      { path: 'schedule', message: 'Opening hours' },
      { path: 'display', message: '  ' },
      { path: 'display', message: 'Lift lobby' },
      { path: 'name', message: 'not a name' },
    ];
    expect(refusalNames(details, 'display')).toEqual(['Foyer', 'Lift lobby']);
    expect(refusalNames(details, 'schedule')).toEqual(['Opening hours']);
    expect(refusalNames([], 'display')).toEqual([]);
  });

  it('says that there are more screens than the five the server names', () => {
    const five = ['A', 'B', 'C', 'D', 'E'];
    expect(deleteFailureText(inUse(five), 8).message).toBe('Assigned to A, B, C, D, E and 3 more.');
    // A count that is older than the refusal never takes screens away.
    expect(deleteFailureText(inUse(five), 2).message).toBe('Assigned to A, B, C, D and E.');
  });

  it('still explains a refusal that names no screen', () => {
    // The refusal of a delete that raced an assignment: a screen or a schedule, unnamed.
    expect(deleteFailureText(inUse([]), 0)).toEqual({
      message: 'A screen has this playlist assigned or a schedule uses it.',
      code: 'playlist_in_use',
      hint: 'Assign other content to the screen, or choose another playlist in the schedule, then delete the playlist.',
      inUse: true,
      bySchedule: false,
    });
  });

  it('shows any other failure with the server’s message and code, and no hint', () => {
    const gone = new ApiRequestError({
      status: 404,
      code: 'not_found',
      message: 'The playlist was not found.',
      fromApi: true,
    });
    expect(deleteFailureText(gone, 0)).toEqual({
      message: 'The playlist was not found.',
      code: 'not_found',
      hint: null,
      inUse: false,
      bySchedule: false,
    });
  });

  it('words the question, the button, the result and the toast by how many there are', () => {
    expect(deleteQuestion(1)).toBe('Delete this playlist?');
    expect(deleteQuestion(4)).toBe('Delete 4 playlists?');
    expect(deleteConfirmLabel(1)).toBe('Delete playlist');
    expect(deleteConfirmLabel(4)).toBe('Delete 4 playlists');
    expect(deleteFailureTitle(1, 1)).toBe('The playlist was not deleted');
    expect(deleteFailureTitle(2, 5)).toBe('2 of 5 playlists were not deleted');
    expect(deleteFailureTitle(5, 5)).toBe('None of the 5 playlists were deleted');
    expect(deletedNote(0)).toBeNull();
    expect(deletedNote(1)).toBe('1 playlist was deleted.');
    expect(deletedNote(3)).toBe('3 playlists were deleted.');
    expect(deletedToast(['Foyer loop'])).toBe('“Foyer loop” was deleted');
    expect(deletedToast(['a', 'b'])).toBe('2 playlists deleted');
    expect(duplicatedToast('Copy of Foyer loop')).toBe('Duplicated as “Copy of Foyer loop”');
  });
});

describe('trying a delete again', () => {
  const offline = () =>
    new ApiRequestError({
      status: 0,
      code: 'network_error',
      message: 'The server could not be reached.',
      fromApi: false,
    });
  const alpha = { name: 'Alpha' };
  const bravo = { name: 'Bravo' };
  const charlie = { name: 'Charlie' };

  it('tells an in-use refusal from any other failure', () => {
    expect(isInUseRefusal(inUse(['Foyer']))).toBe(true);
    expect(isInUseRefusal(usedBySchedules(['Opening hours']))).toBe(true);
    expect(isInUseRefusal(offline())).toBe(false);
    expect(isInUseRefusal(new Error('boom'))).toBe(false);
  });

  it('offers nothing to repeat when every failure is an in-use refusal', () => {
    expect(deleteRetryItems([{ item: alpha, error: inUse(['Foyer']) }])).toEqual([]);
    expect(deleteRetryItems([{ item: alpha, error: usedBySchedules(['Opening hours']) }])).toEqual(
      [],
    );
  });

  it('repeats only the failures that another attempt could change', () => {
    const failed = [
      { item: alpha, error: inUse(['Foyer']) },
      { item: bravo, error: offline() },
      { item: charlie, error: new Error('boom') },
    ];
    expect(deleteRetryItems(failed)).toEqual([bravo, charlie]);
  });

  it('keeps the in-use refusals after a retry, in the earlier order', () => {
    const refusal = inUse(['Foyer']);
    const again = offline();
    const merged = mergeDeleteRetry(
      {
        done: [],
        failed: [
          { item: alpha, error: refusal },
          { item: bravo, error: offline() },
          { item: charlie, error: offline() },
        ],
      },
      { done: [{ item: bravo, result: null }], failed: [{ item: charlie, error: again }] },
    );
    expect(merged.done.map((entry) => entry.item)).toEqual([bravo]);
    expect(merged.failed).toEqual([
      { item: alpha, error: refusal },
      { item: charlie, error: again },
    ]);
    expect(deleteRetryItems(merged.failed)).toEqual([charlie]);
  });
});

describe('assigning a playlist to screens', () => {
  it('words the button by how many screens are chosen', () => {
    expect(assignConfirmLabel(0)).toBe('Assign to screens');
    expect(assignConfirmLabel(1)).toBe('Assign to 1 screen');
    expect(assignConfirmLabel(3)).toBe('Assign to 3 screens');
  });

  it('titles the result honestly', () => {
    expect(assignResultTitle(3, 0)).toBe('Playlist assigned');
    expect(assignResultTitle(2, 1)).toBe('Assigned to 2 of 3 screens');
    expect(assignResultTitle(0, 1)).toBe('The playlist was not assigned');
    expect(assignResultTitle(0, 4)).toBe('The playlist was not assigned to any of the 4 screens');
  });

  it('says what is true now, and that a push is still needed', () => {
    expect(assignResultNote('Foyer loop', 0)).toBeNull();
    expect(assignResultNote('Foyer loop', 1)).toBe(
      '“Foyer loop” is now assigned to 1 screen. Nothing changes on a screen until you push.',
    );
    expect(assignResultNote('Foyer loop', 2)).toContain('assigned to 2 screens');
  });
});

describe('the push state after an assignment', () => {
  it('knows nothing before the plan has been read', () => {
    const view = assignPushView([A, B], null, PLAYLIST);
    expect(view.known).toBe(false);
    expect(view.stateById.size).toBe(0);
    expect(view.waitingIds).toEqual([]);
    expect(canPushAfterAssign(2, view)).toBe(true);
  });

  it('ignores a plan that is older than the assignment', () => {
    // The plan still shows the playlist the screen had before.
    const stale = plan(row(A, 'up_to_date', OTHER_PLAYLIST), row(B, 'nothing_assigned', null));
    const view = assignPushView([A, B], stale, PLAYLIST);
    expect(view.known).toBe(false);
    expect(view.stateById.size).toBe(0);
    expect(canPushAfterAssign(2, view)).toBe(true);
  });

  it('reads the state of each screen once the plan shows the assignment', () => {
    const fresh = plan(
      row(A, 'changes', PLAYLIST),
      row(B, 'never_pushed', PLAYLIST),
      row(C, 'up_to_date', PLAYLIST),
    );
    const view = assignPushView([C, B, A], fresh, PLAYLIST);
    expect(view.known).toBe(true);
    expect(view.stateById.get(C)).toBe('up_to_date');
    expect(view.waitingIds).toEqual([B, A]);
    expect(canPushAfterAssign(3, view)).toBe(true);
  });

  it('is partly known while only some rows have caught up', () => {
    const mixed = plan(row(A, 'changes', PLAYLIST), row(B, 'up_to_date', OTHER_PLAYLIST));
    const view = assignPushView([A, B], mixed, PLAYLIST);
    expect(view.known).toBe(false);
    expect(view.stateById.get(A)).toBe('changes');
    expect(view.stateById.has(B)).toBe(false);
    expect(view.waitingIds).toEqual([A]);
  });

  it('does not take the row of a schedule for the playlist assigned over it', () => {
    // Read before the assignment: the screen still had a schedule whose default playlist is
    // the one now assigned, and that schedule was up to date.
    const stale = plan(row(A, 'up_to_date', PLAYLIST, C), row(B, 'changes', PLAYLIST));
    const view = assignPushView([A, B], stale, PLAYLIST);
    expect(view.known).toBe(false);
    expect(view.stateById.has(A)).toBe(false);
    expect(view.stateById.get(B)).toBe('changes');
    expect(canPushAfterAssign(2, assignPushView([A], stale, PLAYLIST))).toBe(true);
  });

  it('does not offer a push when nothing is waiting', () => {
    const blocked = plan(row(A, 'blocked', PLAYLIST), row(B, 'up_to_date', PLAYLIST));
    const view = assignPushView([A, B], blocked, PLAYLIST);
    expect(view.known).toBe(true);
    expect(view.waitingIds).toEqual([]);
    expect(canPushAfterAssign(2, view)).toBe(false);
  });

  it('never offers a push when no screen was assigned', () => {
    expect(canPushAfterAssign(0, assignPushView([], null, PLAYLIST))).toBe(false);
  });
});

describe('wording', () => {
  it('never calls a screen a display, and never says a screen is online', () => {
    const texts = [
      deleteFailureText(inUse(['Foyer']), 1).message,
      deleteFailureText(inUse(['Foyer']), 1).hint ?? '',
      deleteFailureText(inUse([]), 0).message,
      deleteFailureText(usedBySchedules(['Opening hours']), 0).message,
      deleteFailureText(usedBySchedules(['Opening hours']), 0).hint ?? '',
      failureText(inUse(['Foyer'])).message,
      assignConfirmLabel(0),
      assignConfirmLabel(2),
      assignResultTitle(1, 1),
      assignResultTitle(0, 2),
      assignResultNote('Loop', 2) ?? '',
    ];
    for (const text of texts) expect(text).not.toMatch(/display|online|offline/i);
  });
});
