export interface ByteRange {
  /** First byte offset, inclusive. */
  readonly start: number;
  /** Last byte offset, inclusive. */
  readonly end: number;
}

export type RangeRequest =
  /** No usable Range header: serve the whole object with 200. */
  | { readonly kind: 'full' }
  /** Serve 206 with `Content-Range: bytes start-end/size`. */
  | { readonly kind: 'partial'; readonly range: ByteRange }
  /** Respond 416 with `Content-Range: bytes * /size`. */
  | { readonly kind: 'unsatisfiable' };

const MAX_HEADER_LENGTH = 100;

/**
 * Interprets an HTTP Range header for an object of `size` bytes (RFC 9110).
 * Supports one `bytes=` range: `a-b`, `a-` and suffix `-n`. A header with
 * several ranges, another unit, or bad syntax is ignored (full response),
 * which the RFC allows and which avoids multipart responses entirely.
 */
export function parseRangeHeader(header: string | undefined | null, size: number): RangeRequest {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError('size must be a non-negative safe integer');
  }
  if (header === undefined || header === null || header === '') return { kind: 'full' };
  if (header.length > MAX_HEADER_LENGTH) return { kind: 'full' };
  const match = /^bytes=([0-9]{0,16})-([0-9]{0,16})$/.exec(header.trim());
  if (match === null) return { kind: 'full' };
  const first = match[1] ?? '';
  const last = match[2] ?? '';
  if (first === '' && last === '') return { kind: 'full' };

  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return { kind: 'unsatisfiable' };
    const start = Math.max(0, size - suffix);
    return { kind: 'partial', range: { start, end: size - 1 } };
  }

  const start = Number(first);
  if (start >= size) return { kind: 'unsatisfiable' };
  if (last === '') return { kind: 'partial', range: { start, end: size - 1 } };
  const end = Number(last);
  if (end < start) return { kind: 'full' };
  return { kind: 'partial', range: { start, end: Math.min(end, size - 1) } };
}

/** Value for the Content-Range header of a 206 response. */
export function contentRangeHeader(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`;
}

/** Value for the Content-Range header of a 416 response. */
export function unsatisfiableContentRangeHeader(size: number): string {
  return `bytes */${size}`;
}
