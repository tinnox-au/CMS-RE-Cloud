import type { ApiErrorDetail, MediaDto, MediaPatch, MediaStatus } from '@tinnox/contracts';

/**
 * The states and messages of the media details page that are not about the form fields:
 * how a failed load is read, when the item is polled, what a save or an addition reports,
 * and which shared lists a save makes stale. Pure functions, no DOM.
 */

/** How often a file that is still being checked is read again. */
export const PROCESSING_POLL_MS = 2000;

/** The polling interval for the item as last read: only while the check runs. */
export function mediaPollInterval(media: Pick<MediaDto, 'status'>): number | null {
  return media.status === 'processing' ? PROCESSING_POLL_MS : null;
}

/** The fields of an API refusal the page needs; an `ApiRequestError` fits. */
export interface RefusalLike {
  readonly status: number;
  readonly code: string;
  readonly details: readonly ApiErrorDetail[];
}

/**
 * Why the item could not be loaded, as the page tells it:
 * - `missing`: the API does not know the id in this organisation (404), or the address does
 *   not hold a valid id (400 about the `id` path). Trying again would not help.
 * - `failed`: anything else (network, server, session); trying again may help.
 */
export function mediaLoadProblem(error: RefusalLike | null): 'missing' | 'failed' {
  if (error === null) return 'failed';
  if (error.status === 404 || error.code === 'not_found') return 'missing';
  if (
    error.status === 400 &&
    error.code === 'validation_failed' &&
    error.details.some((detail) => detail.path === 'id')
  ) {
    return 'missing';
  }
  return 'failed';
}

/** The quiet label beside the header actions. */
export function headerStatusLabel(dirty: boolean): string {
  return dirty ? 'Unsaved changes' : 'Saved';
}

/** The lists of the shared pickers whose counts a save changes. */
export interface StaleLists {
  readonly tags: boolean;
  readonly folders: boolean;
}

/** Tag usage counts change when tags were sent; folder item counts when a folder was. */
export function staleListsAfterSave(patch: MediaPatch): StaleLists {
  return { tags: patch.tagIds !== undefined, folders: patch.folderId !== undefined };
}

/**
 * The refusals after which the page's lists are probably out of date: a folder or tag that
 * was deleted elsewhere (404 on a save that named one), or a name taken meanwhile (409).
 */
export function saveRefusalNeedsReload(error: RefusalLike | null, patch: MediaPatch): boolean {
  if (error === null) return false;
  if (error.status === 404) return patch.folderId !== undefined || patch.tagIds !== undefined;
  return error.status === 409;
}

/** The toast after an addition to a playlist. */
export function addedToPlaylistMessage(playlistName: string): string {
  return `Added to ${playlistName}`;
}

/** The toast after a deletion. */
export function deletedMessage(mediaName: string): string {
  return `“${mediaName}” was deleted`;
}

/** What the state card of a file that is not ready says. */
export interface PendingStateText {
  readonly title: string;
  readonly text: string;
}

export function pendingStateText(status: Exclude<MediaStatus, 'ready'>): PendingStateText {
  return status === 'processing'
    ? {
        title: 'Checking the file',
        text: 'The file is being checked before it can be used. This page updates by itself when the check has finished; then you can name it, describe it and add it to playlists.',
      }
    : {
        title: 'This file was not accepted',
        text: 'It cannot be shown on a screen or added to a playlist. Fix the file and upload it again, then delete this one.',
      };
}
