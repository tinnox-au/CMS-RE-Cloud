/**
 * Minimal PNG writer and reader for tests: synthetic images with known colours, and
 * pixel sampling of Playwright screenshots. 8-bit RGB/RGBA, non-interlaced only.
 */
import { crc32, deflateSync, inflateSync } from 'node:zlib';

export type Rgb = readonly [number, number, number];

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** Encodes an RGB image whose pixel colours come from `colourAt(x, y)`. */
export function encodePng(
  width: number,
  height: number,
  colourAt: (x: number, y: number) => Rgb,
): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colourAt(x, y);
      const at = y * stride + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  pixel(x: number, y: number): Rgb;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(bytes: Buffer): DecodedPng {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const colourType = body[9];
      if (body[8] !== 8 || (colourType !== 2 && colourType !== 6) || body[12] !== 0) {
        throw new Error('unsupported PNG variant');
      }
      channels = colourType === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let i = 0; i < stride; i += 1) {
      const value = raw[y * (stride + 1) + 1 + i] ?? 0;
      const left = i >= channels ? (pixels[y * stride + i - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + i] ?? 0) : 0;
      const upLeft = y > 0 && i >= channels ? (pixels[(y - 1) * stride + i - channels] ?? 0) : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) predicted = paeth(left, up, upLeft);
      pixels[y * stride + i] = (value + predicted) & 0xff;
    }
  }
  return {
    width,
    height,
    pixel(x: number, y: number): Rgb {
      const px = Math.min(width - 1, Math.max(0, Math.round(x)));
      const py = Math.min(height - 1, Math.max(0, Math.round(y)));
      const at = py * stride + px * channels;
      return [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0];
    },
  };
}
