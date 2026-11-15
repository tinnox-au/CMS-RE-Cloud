/**
 * Inspects one quarantined file. Decides the type from the content only (the
 * worker never sees a file name or a declared type), reads image metadata with
 * sharp under a pixel limit, and asks ffprobe about video through an argument
 * array - never a shell string - with a timeout and an output cap.
 */
import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import {
  MEDIA_MIME_TYPES,
  type MediaErrorCode,
  type MediaJobSpec,
  type MediaMimeType,
} from '@tinnox/contracts';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';
import { judgeProbe } from './video.ts';

export type Limits = MediaJobSpec['limits'];

export type Inspection =
  | {
      readonly outcome: 'accepted';
      readonly kind: 'image' | 'video';
      readonly mimeType: MediaMimeType;
      readonly width: number;
      readonly height: number;
      readonly durationMs: number | null;
      readonly codec: string | null;
      readonly hasAudio: boolean;
    }
  | {
      readonly outcome: 'rejected';
      readonly errorCode: MediaErrorCode;
      readonly errorDetail: string | null;
    };

const FFPROBE_OUTPUT_CAP_BYTES = 512 * 1024;

function rejected(errorCode: MediaErrorCode, errorDetail: string | null = null): Inspection {
  return { outcome: 'rejected', errorCode, errorDetail };
}

function isSupportedMime(mime: string): mime is MediaMimeType {
  return (MEDIA_MIME_TYPES as readonly string[]).includes(mime);
}

sharp.cache(false);
sharp.concurrency(1);

async function inspectImage(
  path: string,
  mimeType: 'image/jpeg' | 'image/png',
  limits: Limits,
): Promise<Inspection> {
  // limitInputPixels makes libvips refuse an image whose header declares more pixels
  // than allowed, before any pixel is decoded (decompression-bomb guard).
  const options = {
    limitInputPixels: limits.maxImagePixels,
    failOn: 'error' as const,
    sequentialRead: true,
    pages: 1,
  };
  let meta;
  try {
    meta = await sharp(path, options).metadata();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/pixel limit/i.test(message)) return rejected('image_too_large');
    return rejected('corrupt');
  }
  const expected = mimeType === 'image/jpeg' ? 'jpeg' : 'png';
  if (meta.format !== expected) return rejected('type_mismatch');
  if (
    !Number.isInteger(meta.width) ||
    !Number.isInteger(meta.height) ||
    meta.width <= 0 ||
    meta.height <= 0
  ) {
    return rejected('corrupt');
  }
  if ((meta.pages ?? 1) > 1)
    return rejected('unsupported_type', 'Animated images are not supported.');
  // Browsers honour the EXIF orientation, so report the size as displayed.
  const turned = typeof meta.orientation === 'number' && meta.orientation >= 5;
  const width = turned ? meta.height : meta.width;
  const height = turned ? meta.width : meta.height;
  if (
    width > limits.maxImageSidePx ||
    height > limits.maxImageSidePx ||
    width * height > limits.maxImagePixels
  ) {
    return rejected(
      'image_too_large',
      `${width}x${height} pixels; the limit is ${limits.maxImageSidePx} per side`,
    );
  }
  // Decode the whole image once, streamed and scaled down, to prove the data is intact.
  try {
    await sharp(path, options).resize({ width: 64, height: 64, fit: 'inside' }).raw().toBuffer();
  } catch {
    return rejected('corrupt');
  }
  return {
    outcome: 'accepted',
    kind: 'image',
    mimeType,
    width,
    height,
    durationMs: null,
    codec: null,
    hasAudio: false,
  };
}

type ProbeRun =
  | { readonly kind: 'ok'; readonly json: unknown }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'failed' };

function runFfprobe(path: string, timeoutMs: number): Promise<ProbeRun> {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      [
        '-v',
        'error',
        '-hide_banner',
        // Local files only: a crafted file must not make ffprobe open anything else.
        '-protocol_whitelist',
        'file',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        // Read every packet (no decoding), so cut-off media data is noticed.
        '-count_packets',
        '-i',
        `file:${path}`,
      ],
      {
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: FFPROBE_OUTPUT_CAP_BYTES,
        encoding: 'utf8',
        cwd: '/tmp',
        env: { PATH: '/usr/local/bin:/usr/bin:/bin' },
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          const killed = (error as { killed?: boolean }).killed === true;
          const code = (error as { code?: unknown }).code;
          resolve(
            killed && code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
              ? { kind: 'timeout' }
              : { kind: 'failed' },
          );
          return;
        }
        try {
          resolve({ kind: 'ok', json: JSON.parse(stdout) as unknown });
        } catch {
          resolve({ kind: 'failed' });
        }
      },
    );
  });
}

async function inspectVideo(path: string, limits: Limits, timeoutMs: number): Promise<Inspection> {
  const run = await runFfprobe(path, timeoutMs);
  if (run.kind === 'timeout') return rejected('inspection_timeout');
  if (run.kind === 'failed') return rejected('corrupt');
  const verdict = judgeProbe(run.json, limits);
  if (!verdict.ok) return rejected(verdict.code, verdict.detail);
  return {
    outcome: 'accepted',
    kind: 'video',
    mimeType: 'video/mp4',
    width: verdict.width,
    height: verdict.height,
    durationMs: verdict.durationMs,
    codec: verdict.codec,
    hasAudio: verdict.hasAudio,
  };
}

/** `path` is chosen by the worker from a validated job id; it never contains user input. */
export async function inspectFile(
  path: string,
  limits: Limits,
  timeoutMs: number,
): Promise<Inspection> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    return rejected('inspection_failed', 'The file to inspect is missing.');
  }
  if (!info.isFile())
    return rejected('inspection_failed', 'The job does not point at a regular file.');
  if (info.size === 0) return rejected('empty_file');
  if (info.size > limits.maxBytes) return rejected('file_too_large');

  // Magic bytes. Text, HTML, SVG and anything else without a known binary signature
  // yields no type at all.
  let detected;
  try {
    detected = await fileTypeFromFile(path);
  } catch {
    return rejected('corrupt');
  }
  if (detected === undefined) return rejected('unrecognised_type');
  const mime: string = detected.mime;
  if (!isSupportedMime(mime)) {
    return rejected(
      'unsupported_type',
      `detected ${mime.replace(/[^a-z0-9/.+-]/gi, '?').slice(0, 60)}`,
    );
  }
  if (mime === 'video/mp4') return inspectVideo(path, limits, timeoutMs);
  return inspectImage(path, mime, limits);
}
