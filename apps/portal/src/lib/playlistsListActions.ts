import { isPushPending, type PushPlanResponse, type PushState } from '@tinnox/contracts';
import { isApiRequestError } from '../api/client.ts';
import { bulkFailureTitle, countOf, type BulkFailure, type BulkOutcome } from './bulkOutcome.ts';

/**
 * Wording for what the actions of the playlists list did: delete (one or many), assign to
 * screens, duplicate. Pure functions, no DOM. Every result is reported per item, with the
 * server's message and its error code as text.
 *
 * In code the object is a `display`, as in the API and the contracts; every string an
 * operator sees says "screen" (P2-03).
 */

/**
 * The API names the object `display` in its messages as well. An operator reads "screen",
 * so a message is put into the portal's word before it is shown. The error code is never
 * changed.
 */
export function screenWording(text: string): string {
  return text.replace(
    /\b(d|D)isplay(s?)\b/g,
    (_match, first: string, plural: string) => `${first === 'D' ? 'S' : 's'}creen${plural}`,
  );
}

export interface FailureText {
  /** What went wrong, in a sentence. */
  readonly message: string;
  /** The API error code, or null when the failure did not come from the API client. */
  readonly code: string | null;
}

/** The message and the error code of whatever a request threw. */
export function failureText(error: unknown): FailureText {
  if (isApiRequestError(error)) return { message: screenWording(error.message), code: error.code };
  return {
    message: error instanceof Error ? error.message : 'An unexpected error occurred.',
    code: null,
  };
}

const nameList = new Intl.ListFormat('en-AU', { style: 'long', type: 'conjunction' });

export interface DeleteFailureText extends FailureText {
  /** What to do about it, when the portal knows; else null. */
  readonly hint: string | null;
  /** True when the server refused because a screen has the playlist assigned. */
  readonly inUse: boolean;
}

/**
 * Why a playlist was not deleted. The `playlist_in_use` refusal names up to five of the
 * screens that have the playlist assigned (in `details`); `assignedDisplayCount` is the
 * count the list last showed, used only to say that there are more than the server named.
 */
export function deleteFailureText(error: unknown, assignedDisplayCount: number): DeleteFailureText {
  if (!isApiRequestError(error) || !isInUseRefusal(error)) {
    return { ...failureText(error), hint: null, inUse: false };
  }
  const screens = error.details
    .filter((detail) => detail.path === 'display' && detail.message.trim() !== '')
    .map((detail) => detail.message);
  const more = Math.max(0, assignedDisplayCount - screens.length);
  const several = screens.length + more > 1;
  const message =
    screens.length === 0
      ? 'A screen has this playlist assigned.'
      : `Assigned to ${nameList.format(more > 0 ? [...screens, `${more} more`] : screens)}.`;
  return {
    message,
    code: error.code,
    hint: `Assign other content to ${several ? 'those screens' : 'that screen'}, then delete the playlist.`,
    inUse: true,
  };
}

/** True when the server refused a delete because a screen has the playlist assigned. */
export function isInUseRefusal(error: unknown): boolean {
  return isApiRequestError(error) && error.code === 'playlist_in_use';
}

/**
 * The failed deletes that "Try again" repeats: every one but a `playlist_in_use` refusal,
 * which can only be refused again until the screens are given other content. An empty list
 * means "Try again" is not offered.
 */
export function deleteRetryItems<T>(failed: readonly BulkFailure<T>[]): T[] {
  return failed.filter((failure) => !isInUseRefusal(failure.error)).map((f) => f.item);
}

/**
 * The outcome after "Try again" repeated `deleteRetryItems(earlier.failed)`: what was
 * deleted in either attempt, the in-use refusals of the earlier attempt (not repeated, so
 * they still stand), and the failures of the retry, in the order of the earlier list.
 */
export function mergeDeleteRetry<T, R>(
  earlier: BulkOutcome<T, R>,
  retry: BulkOutcome<T, R>,
): BulkOutcome<T, R> {
  const failed = earlier.failed.flatMap((failure) => {
    if (isInUseRefusal(failure.error)) return [failure];
    return retry.failed.filter((again) => again.item === failure.item);
  });
  return { done: [...earlier.done, ...retry.done], failed };
}

/** "Delete this playlist?", "Delete 3 playlists?". */
export function deleteQuestion(count: number): string {
  return count === 1 ? 'Delete this playlist?' : `Delete ${count} playlists?`;
}

/** The confirming button: "Delete playlist", "Delete 3 playlists". */
export function deleteConfirmLabel(count: number): string {
  return count === 1 ? 'Delete playlist' : `Delete ${count} playlists`;
}

/** After an attempt in which something failed: "The playlist was not deleted", "2 of 5 playlists were not deleted". */
export function deleteFailureTitle(failedCount: number, total: number): string {
  return bulkFailureTitle(failedCount, total, 'playlist', 'deleted');
}

/** What did happen in an attempt that also had failures, or null when nothing was deleted. */
export function deletedNote(deletedCount: number): string | null {
  if (deletedCount <= 0) return null;
  return `${countOf(deletedCount, 'playlist')} ${deletedCount === 1 ? 'was' : 'were'} deleted.`;
}

/** The toast after a delete that fully succeeded. */
export function deletedToast(names: readonly string[]): string {
  const [only] = names;
  return names.length === 1 && only !== undefined
    ? `“${only}” was deleted`
    : `${countOf(names.length, 'playlist')} deleted`;
}

/** The toast after a duplicate: the copy's name is the server's ("Copy of X"). */
export function duplicatedToast(copyName: string): string {
  return `Duplicated as “${copyName}”`;
}

/** The primary button of the screen picker: "Assign to screens", "Assign to 1 screen", "Assign to 3 screens". */
export function assignConfirmLabel(chosenCount: number): string {
  return chosenCount <= 0 ? 'Assign to screens' : `Assign to ${countOf(chosenCount, 'screen')}`;
}

/** The title of the result of assigning a playlist to screens. */
export function assignResultTitle(doneCount: number, failedCount: number): string {
  const total = doneCount + failedCount;
  if (failedCount === 0) return 'Playlist assigned';
  if (doneCount === 0) {
    return total === 1
      ? 'The playlist was not assigned'
      : `The playlist was not assigned to any of the ${total} screens`;
  }
  return `Assigned to ${doneCount} of ${countOf(total, 'screen')}`;
}

/** One sentence under that title: what is true now. Null when nothing was assigned. */
export function assignResultNote(playlistName: string, doneCount: number): string | null {
  if (doneCount <= 0) return null;
  return `“${playlistName}” is now assigned to ${countOf(doneCount, 'screen')}. Nothing changes on a screen until you push.`;
}

export interface AssignPushView {
  /**
   * True once the push plan shows the new assignment for every screen that was assigned.
   * Until then the plan on hand is older than the assignment and says nothing about it.
   */
  readonly known: boolean;
  /** The push state of each screen the plan has caught up on. */
  readonly stateById: ReadonlyMap<string, PushState>;
  /** The screens with changes waiting, in the order they were assigned. */
  readonly waitingIds: readonly string[];
}

/**
 * Reads the push plan for the screens a playlist was just assigned to. A row counts only
 * when it already names that playlist: a plan read before the assignment would otherwise be
 * taken for the state after it.
 */
export function assignPushView(
  assignedDisplayIds: readonly string[],
  plan: PushPlanResponse | null,
  playlistId: string,
): AssignPushView {
  const stateById = new Map<string, PushState>();
  if (plan !== null) {
    const wanted = new Set(assignedDisplayIds);
    for (const row of plan.items) {
      if (wanted.has(row.display.id) && row.playlist?.id === playlistId) {
        stateById.set(row.display.id, row.state);
      }
    }
  }
  const waitingIds = assignedDisplayIds.filter((id) => {
    const state = stateById.get(id);
    return state !== undefined && isPushPending(state);
  });
  return {
    known: assignedDisplayIds.every((id) => stateById.has(id)),
    stateById,
    waitingIds,
  };
}

/**
 * Whether "Push now" is offered after an assignment: when a screen has changes waiting, or
 * while the plan has not caught up (the push dialog reads a fresh plan when it opens).
 */
export function canPushAfterAssign(assignedCount: number, view: AssignPushView): boolean {
  if (assignedCount <= 0) return false;
  return !view.known || view.waitingIds.length > 0;
}
