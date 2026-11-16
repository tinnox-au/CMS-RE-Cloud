import type { MediaDto, MediaKind, MediaStatus, PlaylistSummaryDto } from '@tinnox/contracts';
import { formatBytes } from './format.ts';
import { countLabel } from './listView.ts';
import type { ScreenStatusTone } from './screenStatus.ts';

/**
 * How media and playlists are named and measured wherever the portal lists them: the shown
 * name, the kind, dimensions, length and size of a media item, its status wording, and the
 * item count and loop length of a playlist. Pure functions, no DOM.
 */

/**
 * The name to show for a media item: the name an operator gave it, or else the file name
 * supplied at upload. The API already resolves `name`; the fallbacks cover an empty value.
 */
export function mediaDisplayName(media: Pick<MediaDto, 'name' | 'originalName'>): string {
  const name = media.name.trim();
  if (name !== '') return name;
  const original = media.originalName.trim();
  return original !== '' ? original : 'Unnamed file';
}

/** True when an operator gave the item a name other than its file name. */
export function mediaIsRenamed(media: Pick<MediaDto, 'name' | 'originalName'>): boolean {
  return media.name.trim() !== '' && media.name !== media.originalName;
}

const KIND_LABELS: { readonly [K in MediaKind]: { readonly one: string; readonly many: string } } =
  {
    image: { one: 'Image', many: 'Images' },
    video: { one: 'Video', many: 'Videos' },
  };

/** "Image" or "Video". */
export function mediaKindLabel(kind: MediaKind): string {
  return KIND_LABELS[kind].one;
}

/** "Images" or "Videos", for filter chips and section titles. */
export function mediaKindPluralLabel(kind: MediaKind): string {
  return KIND_LABELS[kind].many;
}

/** The kinds in a playlist as text: "Images", "Videos", "Images and videos", or "" for none. */
export function mediaKindsLabel(kinds: readonly MediaKind[]): string {
  const hasImage = kinds.includes('image');
  const hasVideo = kinds.includes('video');
  if (hasImage && hasVideo) return 'Images and videos';
  if (hasImage) return 'Images';
  if (hasVideo) return 'Videos';
  return '';
}

/** "1920 × 1080 px", or null while the size is not known (processing or failed media). */
export function formatDimensions(width: number | null, height: number | null): string | null {
  if (width === null || height === null) return null;
  return `${width} × ${height} px`;
}

/**
 * A length as a clock reading: 65000 gives "1:05", 3600000 gives "1:00:00". Rounded to whole
 * seconds; anything above zero shows at least "0:01". Null for a value that is not a length.
 */
export function formatClock(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = ms > 0 ? Math.max(1, Math.round(ms / 1000)) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
  return `${minutes}:${seconds}`;
}

/**
 * The "Details" of a media item: its dimensions, and for a video its length after them
 * ("1920 × 1080 px · 0:12"). Null when nothing is known yet.
 */
export function mediaDetailsLabel(
  media: Pick<MediaDto, 'kind' | 'width' | 'height' | 'durationMs'>,
): string | null {
  const parts: string[] = [];
  const dimensions = formatDimensions(media.width, media.height);
  if (dimensions !== null) parts.push(dimensions);
  if (media.kind === 'video' && media.durationMs !== null) {
    const length = formatClock(media.durationMs);
    if (length !== null) parts.push(length);
  }
  return parts.length === 0 ? null : parts.join(' · ');
}

/** "2.4 MB", or null while the size is not known. */
export function mediaSizeLabel(media: Pick<MediaDto, 'bytes'>): string | null {
  return media.bytes === null ? null : formatBytes(media.bytes);
}

export interface MediaStatusPresentation {
  readonly tone: ScreenStatusTone;
  readonly label: string;
}

const STATUS_PRESENTATIONS: { readonly [K in MediaStatus]: MediaStatusPresentation } = {
  ready: { tone: 'ok', label: 'Ready' },
  processing: { tone: 'warn', label: 'Processing' },
  failed: { tone: 'danger', label: 'Failed' },
};

/** The pill of a media item: Ready, Processing or Failed, as M0 words them. */
export function presentMediaStatus(status: MediaStatus): MediaStatusPresentation {
  return STATUS_PRESENTATIONS[status];
}

/** "1 item", "12 items". */
export function playlistItemCountLabel(itemCount: number): string {
  return countLabel(itemCount);
}

/** The length of one loop as a clock reading, or "0:00" for an empty playlist. */
export function playlistLengthLabel(totalDurationMs: number): string {
  return formatClock(totalDurationMs) ?? '0:00';
}

/** One line under a playlist's name: "3 items · 0:45". */
export function playlistSummaryLabel(
  playlist: Pick<PlaylistSummaryDto, 'itemCount' | 'totalDurationMs'>,
): string {
  if (playlist.itemCount === 0) return 'No items';
  return `${playlistItemCountLabel(playlist.itemCount)} · ${playlistLengthLabel(playlist.totalDurationMs)}`;
}
