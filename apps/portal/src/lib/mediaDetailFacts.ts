import {
  MEDIA_ERROR_MESSAGES,
  type MediaDto,
  type MediaMimeType,
  type MediaUsageResponse,
} from '@tinnox/contracts';
import { formatDurationMs } from './format.ts';
import { countLabel } from './listView.ts';
import { formatClock, mediaKindLabel } from './mediaName.ts';

/**
 * How the media details page words the facts about a file, its failure and where it is
 * used. Pure functions, no DOM.
 */

const FORMAT_LABELS: { readonly [K in MediaMimeType]: string } = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'video/mp4': 'MP4',
};

/** "JPEG", "PNG" or "MP4"; null while the type is not known (processing or failed media). */
export function mediaFormatLabel(mimeType: MediaMimeType | null): string | null {
  return mimeType === null ? null : FORMAT_LABELS[mimeType];
}

/** "Image (PNG)", or "Image" while the format is not known. */
export function mediaKindFact(media: Pick<MediaDto, 'kind' | 'mimeType'>): string {
  const format = mediaFormatLabel(media.mimeType);
  const kind = mediaKindLabel(media.kind);
  return format === null ? kind : `${kind} (${format})`;
}

const CODEC_LABELS: Readonly<Record<string, string>> = { h264: 'H.264' };

/** The codec as people write it ("H.264"); an unknown codec is shown as the worker reported it. */
export function codecLabel(codec: string | null): string | null {
  if (codec === null) return null;
  const reported = codec.trim();
  if (reported === '') return null;
  return CODEC_LABELS[reported.toLowerCase()] ?? reported;
}

/** A video's length as a clock reading and in words: "0:12 (12 s)". Null when not known. */
export function videoLengthFact(durationMs: number | null): string | null {
  if (durationMs === null) return null;
  const clock = formatClock(durationMs);
  return clock === null ? null : `${clock} (${formatDurationMs(durationMs)})`;
}

/** The first characters of a hash followed by an ellipsis; a short value is shown whole. */
export function shortHash(hash: string, length = 12): string {
  return hash.length <= length ? hash : `${hash.slice(0, length)}…`;
}

export interface MediaFailureText {
  /** What went wrong and what to do about it, from the shared message table. */
  readonly message: string;
  /** The machine-readable reason, shown as text; null when none was recorded. */
  readonly code: string | null;
  /** What the checker added, if anything. */
  readonly detail: string | null;
}

/** Why a failed file was rejected, worded as M0 words it. */
export function mediaFailureText(
  media: Pick<MediaDto, 'errorCode' | 'errorDetail'>,
): MediaFailureText {
  return {
    message:
      media.errorCode !== null
        ? MEDIA_ERROR_MESSAGES[media.errorCode]
        : 'The file was rejected. No reason was recorded.',
    code: media.errorCode,
    detail: media.errorDetail,
  };
}

/**
 * Where a file is used, in a few words: "In 2 playlists · Pushed to 1 screen". "Pushed to"
 * is what the API reports: the screens whose last push contains the file, whatever was
 * edited since. It says nothing about what a player is showing.
 */
export function usageSummary(usage: MediaUsageResponse): string {
  const playlists = usage.playlists.length;
  const screens = usage.displays.length;
  if (playlists === 0 && screens === 0) return 'Not used yet';
  const parts: string[] = [];
  if (playlists > 0) parts.push(`In ${countLabel(playlists, 'playlist')}`);
  if (screens > 0) parts.push(`Pushed to ${countLabel(screens, 'screen')}`);
  return parts.join(' · ');
}

/**
 * What the delete confirmation says about use, before the server decides. The server refuses
 * while a playlist holds the file (`media_in_use`); screens keep what they were last given.
 */
export function deleteConsequence(usage: MediaUsageResponse | null): string {
  if (usage === null) {
    return 'If a playlist still uses the file, the server refuses the deletion.';
  }
  if (usage.playlists.length > 0) {
    return `It is in ${countLabel(usage.playlists.length, 'playlist')}, so the server will refuse the deletion until it is removed from ${usage.playlists.length === 1 ? 'that playlist' : 'those playlists'}.`;
  }
  return 'No playlist uses it.';
}
