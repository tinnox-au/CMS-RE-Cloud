/**
 * Judges ffprobe's JSON description of a file against the M0 video rules:
 * MP4 container, one H.264 video stream, 8-bit 4:2:0, bounded size and length.
 * Pure function: no I/O, so the rules can be unit-tested without ffprobe.
 */
import { SUPPORTED_VIDEO_CODECS, type MediaErrorCode } from '@tinnox/contracts';
import { z } from 'zod';

export interface VideoLimits {
  readonly maxVideoWidthPx: number;
  readonly maxVideoHeightPx: number;
  readonly maxVideoDurationMs: number;
}

export type VideoVerdict =
  | {
      readonly ok: true;
      readonly width: number;
      readonly height: number;
      readonly durationMs: number;
      readonly codec: string;
      /** Reported for information; playback is muted in M0. */
      readonly hasAudio: boolean;
    }
  | { readonly ok: false; readonly code: MediaErrorCode; readonly detail: string | null };

const numeric = z.union([z.number(), z.string()]).optional();

const StreamSchema = z.looseObject({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  profile: z.union([z.string(), z.number()]).optional(),
  pix_fmt: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: numeric,
  /** Frames the container index declares, and packets actually read with -count_packets. */
  nb_frames: numeric,
  nb_read_packets: numeric,
  disposition: z.looseObject({ attached_pic: z.number().optional() }).optional(),
  tags: z.looseObject({ rotate: numeric }).optional(),
  side_data_list: z.array(z.looseObject({ rotation: numeric })).optional(),
});

const ProbeSchema = z.looseObject({
  streams: z.array(StreamSchema).max(64),
  format: z.looseObject({ format_name: z.string().optional(), duration: numeric }),
});

/** 8-bit 4:2:0, the only chroma layout every mainstream browser decodes in H.264. */
const PIXEL_FORMATS = new Set(['yuv420p', 'yuvj420p']);
const H264_PROFILES = new Set(['baseline', 'constrained baseline', 'main', 'extended', 'high']);

function reject(code: MediaErrorCode, detail: string | null = null): VideoVerdict {
  return { ok: false, code, detail };
}

/** ffprobe strings come from the file's own metadata: keep them short and plain before echoing them. */
function plain(value: unknown): string {
  return String(value)
    .replace(/[^A-Za-z0-9 ._:+-]/g, '?')
    .slice(0, 40);
}

function seconds(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function quarterTurn(stream: z.infer<typeof StreamSchema>): boolean {
  const candidates: unknown[] = [stream.tags?.rotate];
  for (const side of stream.side_data_list ?? []) candidates.push(side.rotation);
  return candidates.some((value) => {
    const n = Number(value);
    return Number.isFinite(n) && Math.abs(Math.round(n)) % 180 === 90;
  });
}

export function judgeProbe(probe: unknown, limits: VideoLimits): VideoVerdict {
  const parsed = ProbeSchema.safeParse(probe);
  if (!parsed.success) return reject('corrupt', 'The file structure could not be read.');
  const { streams, format } = parsed.data;

  const formats = (format.format_name ?? '').split(',');
  if (!formats.includes('mp4')) {
    return reject('unsupported_type', `container ${plain(format.format_name ?? 'unknown')}`);
  }

  const video = streams.filter(
    (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1,
  );
  const stream = video[0];
  if (stream === undefined) return reject('no_video_stream');
  if (video.length > 1) {
    return reject('unsupported_type', 'The file has more than one video stream.');
  }

  const codec = (stream.codec_name ?? '').toLowerCase();
  if (!(SUPPORTED_VIDEO_CODECS as readonly string[]).includes(codec)) {
    return reject('unsupported_codec', `codec ${plain(stream.codec_name ?? 'unknown')}`);
  }
  // No pixel format means ffprobe could not read a single frame header.
  if (stream.pix_fmt === undefined) return reject('corrupt', 'The video data could not be read.');
  if (!PIXEL_FORMATS.has(stream.pix_fmt)) {
    return reject('unsupported_pixel_format', `pixel format ${plain(stream.pix_fmt)}`);
  }
  const profile = String(stream.profile ?? '').toLowerCase();
  if (!H264_PROFILES.has(profile)) {
    return reject(
      'unsupported_pixel_format',
      `H.264 profile ${plain(stream.profile ?? 'unknown')}`,
    );
  }

  const codedWidth = stream.width;
  const codedHeight = stream.height;
  if (
    codedWidth === undefined ||
    codedHeight === undefined ||
    !Number.isInteger(codedWidth) ||
    !Number.isInteger(codedHeight) ||
    codedWidth <= 0 ||
    codedHeight <= 0
  ) {
    return reject('corrupt', 'The video has no valid frame size.');
  }
  // Display size: a 90 or 270 degree rotation flag swaps the sides.
  const rotated = quarterTurn(stream);
  const width = rotated ? codedHeight : codedWidth;
  const height = rotated ? codedWidth : codedHeight;
  if (width > limits.maxVideoWidthPx || height > limits.maxVideoHeightPx) {
    return reject(
      'video_resolution_too_large',
      `${width}x${height} pixels; the limit is ${limits.maxVideoWidthPx}x${limits.maxVideoHeightPx}`,
    );
  }

  const durationSeconds = seconds(stream.duration) ?? seconds(format.duration);
  if (durationSeconds === null) return reject('corrupt', 'The video has no readable duration.');
  const durationMs = Math.max(1, Math.round(durationSeconds * 1000));
  if (durationMs > limits.maxVideoDurationMs) {
    return reject(
      'video_too_long',
      `${Math.round(durationSeconds)} s; the limit is ${Math.round(limits.maxVideoDurationMs / 1000)} s`,
    );
  }

  // The index (moov) can be intact while the media data is cut short. ffprobe was asked
  // to read every packet; fewer packets than the index declares means missing data.
  const declaredFrames = Number(stream.nb_frames);
  const readPackets = Number(stream.nb_read_packets);
  if (
    stream.nb_read_packets === undefined ||
    !Number.isFinite(readPackets) ||
    readPackets <= 0 ||
    (Number.isFinite(declaredFrames) && declaredFrames > 0 && readPackets < declaredFrames)
  ) {
    return reject('corrupt', 'The video data is incomplete.');
  }

  return {
    ok: true,
    width,
    height,
    durationMs,
    codec,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}
