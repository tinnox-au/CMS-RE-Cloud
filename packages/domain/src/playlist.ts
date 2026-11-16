import type { Limits } from '@tinnox/contracts';
import type {
  DisplayTarget,
  DraftItem,
  MediaRecord,
  PlaybackOptions,
  PublicationDraft,
  PublishIssue,
  ResolvedItem,
} from './types.ts';

export interface ValidatePlaylistOptions {
  /**
   * 'draft': saving an editable playlist. Media may still be processing.
   * 'publish': every item must be ready and the playlist must not be empty.
   */
  readonly mode: 'draft' | 'publish';
}

function seconds(ms: number): string {
  return `${ms / 1000} s`;
}

/**
 * Checks a one-level playlist against the media records and configured limits.
 * Returns every problem found, in playlist order; an empty array means valid.
 */
export function validatePlaylist(
  items: readonly DraftItem[],
  mediaById: ReadonlyMap<string, MediaRecord>,
  limits: Limits,
  options: ValidatePlaylistOptions,
): PublishIssue[] {
  const issues: PublishIssue[] = [];

  if (options.mode === 'publish' && items.length === 0) {
    issues.push({
      index: null,
      code: 'playlist_empty',
      message: 'The playlist has no items. Add at least one image or video.',
    });
  }
  if (items.length > limits.maxPlaylistItems) {
    issues.push({
      index: null,
      code: 'too_many_items',
      message: `The playlist has ${items.length} items; the limit is ${limits.maxPlaylistItems}.`,
    });
  }

  items.forEach((item, index) => {
    const n = index + 1;
    const media = mediaById.get(item.mediaId);
    if (media === undefined) {
      issues.push({
        index,
        code: 'media_missing',
        message: `Item ${n} refers to media that does not exist or was deleted.`,
      });
      return;
    }
    if (media.status === 'failed') {
      issues.push({
        index,
        code: 'media_failed',
        message: `Item ${n} uses a file that failed validation. Remove it or upload a corrected file.`,
      });
      return;
    }
    if (options.mode === 'publish' && media.status !== 'ready') {
      issues.push({
        index,
        code: 'media_not_ready',
        message: `Item ${n} is still being checked. Wait until it is ready, then publish again.`,
      });
      return;
    }

    if (media.kind === 'image') {
      if (item.durationMs === null) {
        issues.push({
          index,
          code: 'duration_required',
          message: `Item ${n} is an image and needs a duration.`,
        });
      } else if (
        item.durationMs < limits.minImageItemDurationMs ||
        item.durationMs > limits.maxImageItemDurationMs
      ) {
        issues.push({
          index,
          code: 'duration_out_of_range',
          message: `Item ${n} has a duration of ${seconds(item.durationMs)}; images must be shown for ${seconds(limits.minImageItemDurationMs)} to ${seconds(limits.maxImageItemDurationMs)}.`,
        });
      }
    } else if (item.durationMs !== null) {
      issues.push({
        index,
        code: 'duration_not_allowed',
        message: `Item ${n} is a video and always plays for its natural length; remove the custom duration.`,
      });
    }
  });

  return issues;
}

export type DraftResult =
  | { readonly ok: true; readonly draft: PublicationDraft }
  | { readonly ok: false; readonly issues: readonly PublishIssue[] };

/**
 * Resolves a playlist against ready media and a target display into a
 * vendor-neutral publication draft. Fails with the full list of problems.
 */
export function buildPublicationDraft(
  display: DisplayTarget,
  items: readonly DraftItem[],
  mediaById: ReadonlyMap<string, MediaRecord>,
  limits: Limits,
  playback: PlaybackOptions,
): DraftResult {
  const issues = validatePlaylist(items, mediaById, limits, { mode: 'publish' });
  if (issues.length > 0) return { ok: false, issues };

  const resolved: ResolvedItem[] = [];
  const late: PublishIssue[] = [];
  items.forEach((item, index) => {
    const media = mediaById.get(item.mediaId);
    // validatePlaylist guarantees presence and readiness; these checks guard against
    // a "ready" row with missing inspection data, which must never reach a manifest.
    if (
      media === undefined ||
      media.mimeType === null ||
      media.bytes === null ||
      media.sha256 === null ||
      media.width === null ||
      media.height === null ||
      media.bytes <= 0
    ) {
      late.push({
        index,
        code: 'media_not_ready',
        message: `Item ${index + 1} has incomplete inspection data and cannot be published.`,
      });
      return;
    }
    const durationMs = media.kind === 'video' ? media.durationMs : item.durationMs;
    if (durationMs === null || durationMs <= 0) {
      late.push({
        index,
        code: 'media_not_ready',
        message: `Item ${index + 1} has no usable duration and cannot be published.`,
      });
      return;
    }
    if (media.kind === 'video' && durationMs > limits.maxVideoDurationMs) {
      late.push({
        index,
        code: 'duration_out_of_range',
        message: `Item ${index + 1} is a video of ${seconds(durationMs)}; the limit is ${seconds(limits.maxVideoDurationMs)}.`,
      });
      return;
    }
    resolved.push({
      assetId: media.id,
      kind: media.kind,
      mediaType: media.mimeType,
      codec: media.codec,
      bytes: media.bytes,
      sha256: media.sha256,
      durationMs,
      fit: item.fit ?? display.defaultFit,
      width: media.width,
      height: media.height,
      availableFrom: media.availableFrom,
      availableUntil: media.availableUntil,
    });
  });
  if (late.length > 0) return { ok: false, issues: late };

  return {
    ok: true,
    draft: {
      displayId: display.id,
      canvas: display.canvas,
      contentRect: display.contentRect,
      regions: 1,
      audio: false,
      items: resolved,
      transition: playback.transition,
      shuffle: playback.shuffle,
      rotation: display.rotation,
      workingHours: display.workingHours,
      timeZone: display.timeZone,
    },
  };
}
