import type {
  Limits,
  MediaDto,
  PlaylistDto,
  PlaylistItemInput,
  PlaylistReplace,
  PlaylistSummaryDto,
} from '@tinnox/contracts';
import { countOf, type BulkOutcome } from './bulkOutcome.ts';
import { DEFAULT_IMAGE_SECONDS } from './playlistDraft.ts';

/**
 * What the media library's actions send and say: appending a file to a playlist, and the
 * wording around deleting one file or several. Pure functions, no DOM.
 */

/** Time on screen of an image that has no default of its own: the editor's 10 seconds. */
export const DEFAULT_IMAGE_DURATION_MS = Number(DEFAULT_IMAGE_SECONDS) * 1000;

type DurationLimits = Pick<Limits, 'minImageItemDurationMs' | 'maxImageItemDurationMs'>;

/**
 * The duration a file gets when it is appended to a playlist: an image's own default, or
 * else 10 seconds, kept inside the configured range; null for a video, which always plays
 * its natural length.
 */
export function appendedItemDurationMs(
  media: Pick<MediaDto, 'kind' | 'defaultDurationMs'>,
  limits: DurationLimits,
): number | null {
  if (media.kind !== 'image') return null;
  const wanted = media.defaultDurationMs ?? DEFAULT_IMAGE_DURATION_MS;
  return Math.min(limits.maxImageItemDurationMs, Math.max(limits.minImageItemDurationMs, wanted));
}

/**
 * The body of `PUT /api/playlists/:id` that adds one file to the end of a playlist and
 * changes nothing else: the name and every existing item go back as they were read, in play
 * order. The description is left out, which keeps the stored one.
 */
export function playlistWithMediaAppended(
  playlist: Pick<PlaylistDto, 'name' | 'items'>,
  media: Pick<MediaDto, 'id' | 'kind' | 'defaultDurationMs'>,
  limits: DurationLimits,
): PlaylistReplace {
  const existing = [...playlist.items]
    .sort((a, b) => a.position - b.position)
    .map((item): PlaylistItemInput =>
      'appId' in item
        ? { appId: item.appId, durationMs: item.durationMs }
        : { mediaId: item.mediaId, durationMs: item.durationMs, fit: item.fit },
    );
  return {
    name: playlist.name,
    items: [
      ...existing,
      { mediaId: media.id, durationMs: appendedItemDurationMs(media, limits), fit: null },
    ],
  };
}

/** Why nothing more can be added to a playlist, or null when there is room. */
export function playlistFullReason(
  playlist: Pick<PlaylistSummaryDto, 'itemCount'>,
  limits: Pick<Limits, 'maxPlaylistItems'>,
): string | null {
  return playlist.itemCount >= limits.maxPlaylistItems
    ? `Full: a playlist holds at most ${limits.maxPlaylistItems} items`
    : null;
}

/** Why a file cannot be added to a playlist from the library, or null when it can. */
export function addToPlaylistBlock(media: Pick<MediaDto, 'status'>): string | null {
  if (media.status === 'processing') return 'Still being checked';
  if (media.status === 'failed') return 'Failed its check';
  return null;
}

export interface DeleteWording {
  /** The question in the dialog's title. One file keeps the M0 wording. */
  readonly title: string;
  /** The confirming button. One file keeps the M0 wording. */
  readonly confirmLabel: string;
}

export function deleteWording(count: number): DeleteWording {
  if (count === 1) return { title: 'Delete this file?', confirmLabel: 'Delete file' };
  return { title: `Delete ${count} files?`, confirmLabel: `Delete ${count} files` };
}

/**
 * A warning for the delete dialog when the list already shows that the server will refuse:
 * files that are in a playlist. Null when none of them is. The server stays the authority;
 * the dialog still lets the operator try.
 */
export function deleteUsageWarning(items: readonly Pick<MediaDto, 'usageCount'>[]): string | null {
  const used = items.filter((item) => item.usageCount > 0);
  if (used.length === 0) return null;
  const first = items[0];
  if (items.length === 1 && first !== undefined) {
    return `It is used in ${countOf(first.usageCount, 'playlist')}, so the server will refuse until it is removed from ${first.usageCount === 1 ? 'that playlist' : 'those playlists'}.`;
  }
  return `${used.length} of them ${used.length === 1 ? 'is' : 'are'} used in a playlist, so the server will refuse to delete ${used.length === 1 ? 'that one' : 'those'}.`;
}

/** The toast after a delete in which everything asked for was deleted. */
export function deletedToast(names: readonly string[]): string {
  const first = names[0];
  if (names.length === 1 && first !== undefined) return `${first} deleted`;
  return `${countOf(names.length, 'file')} deleted`;
}

/** What did succeed in a delete where something failed: "2 files were deleted." or null. */
export function deletedNote<T, R>(outcome: BulkOutcome<T, R>): string | null {
  const done = outcome.done.length;
  if (done === 0) return null;
  return `${countOf(done, 'file')} ${done === 1 ? 'was' : 'were'} deleted.`;
}
