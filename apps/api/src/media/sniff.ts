import type { MediaMimeType } from '@tinnox/contracts';

/** Number of leading bytes `sniffMediaType` needs. */
export const SNIFF_BYTES = 16;

/**
 * Minimal magic-byte check done by the API on the first bytes of an upload.
 * It decides nothing about validity - the isolated worker does the real
 * inspection - it only refuses content that is plainly not JPEG, PNG or an
 * ISO-BMFF (MP4 family) file before anything is queued. The declared
 * Content-Type and the file name are ignored.
 */
export function sniffMediaType(head: Uint8Array): MediaMimeType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length >= png.length && png.every((byte, index) => head[index] === byte)) {
    return 'image/png';
  }
  // ISO base media file: a box size, then the type "ftyp".
  if (
    head.length >= 12 &&
    head[4] === 0x66 &&
    head[5] === 0x74 &&
    head[6] === 0x79 &&
    head[7] === 0x70
  ) {
    return 'video/mp4';
  }
  return null;
}
