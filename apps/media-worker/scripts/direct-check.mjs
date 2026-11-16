#!/usr/bin/env node
// Checks the worker image by itself, without the API in front of it: every sample file is
// handed to a throwaway worker container (same isolation flags as the compose service) as a
// job, and the verdict files are compared with what is expected. This proves the worker
// rejects disguised and hostile files on its own, even those the API would refuse earlier.
//
// Prerequisites: the image is built and node apps/api/test-fixtures/generate.mjs has run.
// Usage: node apps/media-worker/scripts/direct-check.mjs
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixtures = join(root, 'apps', 'api', 'test-fixtures', 'out');
const image = process.env.TINNOX_WORKER_IMAGE ?? 'tinnox-cms-media-worker:m0';
const jobs = mkdtempSync(join(tmpdir(), 'tinnox-worker-check-'));
const inbox = join(jobs, 'inbox');
const outbox = join(jobs, 'outbox');
mkdirSync(inbox);
mkdirSync(outbox);
chmodSync(jobs, 0o755);
chmodSync(inbox, 0o755);
chmodSync(outbox, 0o1777);

const limits = {
  maxBytes: 200 * 1024 * 1024,
  maxImageSidePx: 8192,
  maxImagePixels: 40_000_000,
  maxVideoWidthPx: 3840,
  maxVideoHeightPx: 2160,
  maxVideoDurationMs: 600_000,
  timeoutMs: 30_000,
};
const expectations = [];
let order = 0;
function job(label, bytes, expected, spec = {}) {
  const jobId = randomUUID();
  writeFileSync(join(inbox, jobId), bytes, { mode: 0o644 });
  const specText =
    typeof spec === 'string'
      ? spec
      : JSON.stringify({ schemaVersion: 1, jobId, limits: { ...limits, ...spec } });
  writeFileSync(join(inbox, `${jobId}.json`), specText, { mode: 0o644 });
  // The worker handles jobs oldest first; give each job a distinct, increasing time.
  const at = new Date(Date.now() - 60_000 + order * 1000);
  order += 1;
  utimesSync(join(inbox, `${jobId}.json`), at, at);
  expectations.push({ label, jobId, expected });
  return jobId;
}
const fixture = (name) => readFileSync(join(fixtures, name));

const thumbChecks = [
  [job('landscape.jpg', fixture('landscape.jpg'), 'accepted image/jpeg 640x360'), '480x270'],
  [job('portrait.png', fixture('portrait.png'), 'accepted image/png 360x640'), '270x480'],
  [job('h264.mp4', fixture('h264.mp4'), 'accepted video/mp4 320x240'), 'none'],
];
job('h264-with-audio.mp4', fixture('h264-with-audio.mp4'), 'accepted video/mp4 320x240');
job('hevc.mp4', fixture('hevc.mp4'), 'rejected unsupported_codec');
job('vp9.mp4', fixture('vp9.mp4'), 'rejected unsupported_codec');
job('h264-yuv444.mp4', fixture('h264-yuv444.mp4'), 'rejected unsupported_pixel_format');
job('matroska-renamed.mp4 (not MP4)', fixture('matroska-renamed.mp4'), 'rejected unsupported_type');
job('text-renamed.jpg', fixture('text-renamed.jpg'), 'rejected unrecognised_type');
job('html-renamed.png', fixture('html-renamed.png'), 'rejected unrecognised_type');
job('vector-renamed.png (SVG)', fixture('vector-renamed.png'), 'rejected unrecognised_type');
job(
  'jpeg-signature-then-garbage.jpg',
  fixture('jpeg-signature-then-garbage.jpg'),
  'rejected corrupt',
);
job('too-wide.png (9000 px side)', fixture('too-wide.png'), 'rejected image_too_large');
job('h264.mp4 cut to 3000 bytes', fixture('h264.mp4').subarray(0, 3000), 'rejected corrupt');
// The index is at the front (faststart), so the header reads fine; only the media data is short.
job(
  'h264.mp4 cut to 60 % (index intact)',
  fixture('h264.mp4').subarray(0, Math.floor(fixture('h264.mp4').length * 0.6)),
  'rejected corrupt',
);
job(
  'h264-with-audio.mp4 cut to 80 % (index at the end)',
  fixture('h264-with-audio.mp4').subarray(
    0,
    Math.floor(fixture('h264-with-audio.mp4').length * 0.8),
  ),
  'rejected corrupt',
);
job('truncated portrait.png', fixture('portrait.png').subarray(0, 9000), 'rejected corrupt');
job('empty file', Buffer.alloc(0), 'rejected empty_file');
job('file above the job byte limit', fixture('landscape.jpg'), 'rejected file_too_large', {
  maxBytes: 1000,
});
job('video above the job duration limit', fixture('h264.mp4'), 'rejected video_too_long', {
  maxVideoDurationMs: 1000,
});
job(
  'video above the job resolution limit',
  fixture('h264.mp4'),
  'rejected video_resolution_too_large',
  { maxVideoWidthPx: 200 },
);
job(
  'GIF',
  Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
  'rejected unsupported_type',
);
job('PDF header', Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'), 'rejected unsupported_type');
// Decompression bomb: a small file that declares 81 megapixels (limit 40).
const bomb = await sharp({
  create: { width: 9000, height: 9000, channels: 3, background: '#000000' },
})
  .png({ compressionLevel: 9 })
  .toBuffer();
job(
  `decompression bomb (${bomb.length} bytes on disk, 81 megapixels)`,
  bomb,
  'rejected image_too_large',
  { maxImageSidePx: 20_000 },
);
job(
  'job description that is not JSON',
  fixture('landscape.jpg'),
  'rejected inspection_failed',
  '{not json',
);
job(
  'job description with a path in it',
  fixture('landscape.jpg'),
  'rejected inspection_failed',
  JSON.stringify({ schemaVersion: 1, jobId: '../../etc/passwd', limits }),
);
// A job a previous worker run died on: marker present, no verdict. Must not be retried.
const poisoned = job(
  'job a previous run died on (marker, no verdict)',
  fixture('landscape.jpg'),
  'rejected inspection_failed',
);
writeFileSync(join(outbox, `${poisoned}.started`), '');
// Last: an inspection that cannot finish in its time budget. The worker reports the timeout and exits.
job('inspection over its time budget (1 ms)', fixture('h264.mp4'), 'rejected inspection_timeout', {
  timeoutMs: 1,
});

const name = `tinnox-worker-check-${process.pid}`;
const container = spawn(
  'docker',
  [
    'run',
    '--rm',
    '--name',
    name,
    '--network',
    'none',
    '--read-only',
    '--user',
    '10001:10001',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--pids-limit',
    '128',
    '--memory',
    '768m',
    '--memory-swap',
    '768m',
    '--cpus',
    '1',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777',
    '-e',
    'MEDIA_JOBS_DIR=/jobs',
    '-v',
    `${jobs}:/jobs:rw`,
    image,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let log = '';
container.stdout.on('data', (chunk) => (log += chunk));
container.stderr.on('data', (chunk) => (log += chunk));
const exited = new Promise((resolve) => container.on('exit', (code) => resolve(code)));

const deadline = Date.now() + 90_000;
while (
  Date.now() < deadline &&
  !expectations.every((e) => existsSync(join(outbox, `${e.jobId}.json`)))
) {
  await new Promise((resolve) => setTimeout(resolve, 250));
}
const exitCode = await Promise.race([
  exited,
  new Promise((resolve) => setTimeout(() => resolve('still running'), 5000)),
]);
if (exitCode === 'still running') execFileSync('docker', ['kill', name], { stdio: 'ignore' });

let failures = 0;
for (const { label, jobId, expected } of expectations) {
  let actual = 'no verdict';
  try {
    const verdict = JSON.parse(readFileSync(join(outbox, `${jobId}.json`), 'utf8'));
    actual =
      verdict.outcome === 'accepted'
        ? `accepted ${verdict.mimeType} ${verdict.width}x${verdict.height}`
        : `rejected ${verdict.errorCode}`;
  } catch {
    /* reported below */
  }
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'ok   ' : 'FAIL '} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`,
  );
}
for (const [jobId, expected] of thumbChecks) {
  const path = join(outbox, `${jobId}.thumb.jpg`);
  let actual = 'none';
  if (existsSync(path)) {
    const meta = await sharp(readFileSync(path)).metadata();
    actual = `${meta.format} ${meta.width}x${meta.height}`;
  }
  const want = expected === 'none' ? 'none' : `jpeg ${expected}`;
  const ok = actual === want;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'ok   ' : 'FAIL '} thumbnail for ${jobId}: ${actual}${ok ? '' : ` (expected ${want})`}`,
  );
}
const audio = log.split('\n').filter((line) => line.includes('"hasAudio":true')).length;
console.log(
  `${audio === 1 ? 'ok   ' : 'FAIL '} worker log reports audio presence for exactly one accepted video`,
);
if (audio !== 1) failures += 1;
console.log(
  `${exitCode === 3 ? 'ok   ' : 'FAIL '} worker exited with code 3 after the timed-out inspection (got ${exitCode})`,
);
if (exitCode !== 3) failures += 1;
rmSync(jobs, { recursive: true, force: true });
console.log(
  failures === 0 ? '\nAll worker checks passed.' : `\n${failures} worker check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
