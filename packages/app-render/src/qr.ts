import { encode } from 'uqr';

/**
 * The dark modules of a QR code (error correction M, no quiet zone) as one SVG path in
 * module units. uqr encodes text as UTF-8 bytes, so "é" and "€" scan as written.
 */
export function qrPath(content: string): { size: number; d: string } {
  const { size, data } = encode(content, { ecc: 'M', border: 0 });
  let d = '';
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${String(x)} ${String(y)}h1v1h-1z`;
    });
  });
  return { size, d };
}
