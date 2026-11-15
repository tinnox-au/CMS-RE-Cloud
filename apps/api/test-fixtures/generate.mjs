#!/usr/bin/env node
// Generates small synthetic sample media into apps/api/test-fixtures/out (gitignored).
// Images are made with sharp on the host. Videos are made with ffmpeg INSIDE the
// media-worker image (the host needs no ffmpeg), with no network and an argument
// array - no shell. Build the image first:
//   docker compose --env-file .env -f infra/docker-compose.yml --profile worker build media-worker
// Usage: node apps/api/test-fixtures/generate.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const image = process.env.TINNOX_WORKER_IMAGE ?? 'tinnox-cms-media-worker:m0';
mkdirSync(out, { recursive: true });

const gradient = (width, height, a, b) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
       <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
       <rect width="100%" height="100%" fill="url(#g)"/>
       <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="#ffffff"/>
     </svg>`,
  );

// Valid images.
await sharp(gradient(640, 360, '#0b3d91', '#f2a900'))
  .jpeg({ quality: 80 })
  .toFile(join(out, 'landscape.jpg'));
await sharp(gradient(360, 640, '#1b5e20', '#e0f2f1'))
  .png()
  .toFile(join(out, 'portrait.png'));
// Valid PNG whose side exceeds the default 8192 px limit.
await sharp({ create: { width: 9000, height: 16, channels: 3, background: '#336699' } })
  .png()
  .toFile(join(out, 'too-wide.png'));

// Not media at all, with misleading names.
writeFileSync(join(out, 'text-renamed.jpg'), 'This is plain text, not a JPEG.\n'.repeat(20));
writeFileSync(
  join(out, 'html-renamed.png'),
  '<!doctype html><html><body><script>alert(1)</script></body></html>\n',
);
writeFileSync(
  join(out, 'vector-renamed.png'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>\n',
);
// Starts with a real JPEG signature, then garbage: passes a magic-byte check, fails decoding.
writeFileSync(
  join(out, 'jpeg-signature-then-garbage.jpg'),
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
    Buffer.alloc(4096, 0x41),
  ]),
);

function ffmpeg(args) {
  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      // Write the outputs as the invoking user: the image's own user (uid 10001)
      // cannot write into a checkout owned by someone else on Linux (CI runners).
      '--user',
      `${process.getuid()}:${process.getgid()}`,
      '--entrypoint',
      'ffmpeg',
      '-v',
      `${out}:/out`,
      image,
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...args,
    ],
    { stdio: 'inherit' },
  );
}
const source = ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2'];
const tone = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2'];

// Supported: H.264 High, 8-bit 4:2:0, MP4, no audio.
ffmpeg([
  ...source,
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  '/out/h264.mp4',
]);
// Supported, with an audio track (playback is muted; the worker reports audio presence).
ffmpeg([
  ...source,
  ...tone,
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-shortest',
  '/out/h264-with-audio.mp4',
]);
// Unsupported codecs in an MP4 container.
ffmpeg([...source, '-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '/out/hevc.mp4']);
ffmpeg([...source, '-c:v', 'libvpx-vp9', '-b:v', '200k', '/out/vp9.mp4']);
// H.264 but 4:4:4 chroma, which browsers do not reliably decode.
ffmpeg([...source, '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '/out/h264-yuv444.mp4']);
// H.264 in a Matroska container with a misleading name.
ffmpeg([
  ...source,
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-f',
  'matroska',
  '/out/matroska-renamed.mp4',
]);

console.log(`sample media written to ${out}`);
