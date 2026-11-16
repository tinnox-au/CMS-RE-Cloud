import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { searchFontSize } from './fit.ts';
import { qrPath } from './qr.ts';
import { clockText, countdownText, dateText } from './text.ts';
import { wallToEpoch } from './zone.ts';

const MELBOURNE = 'Australia/Melbourne';
// 15:05:09 in Melbourne (AEDT, +11).
const AT = Date.parse('2026-11-16T04:05:09Z');

describe('clockText and dateText', () => {
  it('formats 12 and 24 hour time in the site zone', () => {
    expect(clockText(AT, MELBOURNE, { hourCycle: '12', showSeconds: false })).toMatch(/^3:05\spm$/);
    expect(clockText(AT, MELBOURNE, { hourCycle: '24', showSeconds: true })).toBe('15:05:09');
    expect(
      clockText(Date.parse('2026-11-15T13:00:00Z'), MELBOURNE, {
        hourCycle: '24',
        showSeconds: false,
      }),
    ).toBe('00:00');
  });

  it('gives the day, month and year', () => {
    const long = dateText(AT, MELBOURNE, 'long');
    expect(long).toContain('Monday');
    expect(long).toContain('16');
    expect(long).toContain('November');
    expect(long).toContain('2026');
    expect(dateText(AT, MELBOURNE, 'numeric')).toBe('16/11/2026');
    expect(dateText(AT, MELBOURNE, 'short')).toContain('Nov');
  });

  it('falls back to the device zone for a zone this ICU does not know', () => {
    expect(() =>
      clockText(AT, 'Mars/Olympus_Mons', { hourCycle: '24', showSeconds: false }),
    ).not.toThrow();
  });
});

describe('countdownText', () => {
  it('rounds up to the shown unit', () => {
    expect(countdownText(1, true)).toBe('00:00:01');
    expect(countdownText(1001, true)).toBe('00:00:02');
    expect(countdownText(61_000, false)).toBe('00:02');
    expect(countdownText(3_600_000, true)).toBe('01:00:00');
  });

  it('prefixes whole days', () => {
    expect(countdownText(86_400_000, true)).toBe('1 day 00:00:00');
    expect(countdownText(86_400_001, true)).toBe('1 day 00:00:01');
    expect(countdownText(2 * 86_400_000 + 3_600_000, false)).toBe('2 days 01:00');
  });

  it('is null once the moment has come', () => {
    expect(countdownText(0, true)).toBeNull();
    expect(countdownText(-5000, false)).toBeNull();
  });
});

describe('wallToEpoch', () => {
  it('reads the stamp in the site zone, in summer and in winter', () => {
    expect(wallToEpoch('2026-12-25T09:00', MELBOURNE)).toBe(Date.parse('2026-12-24T22:00:00Z'));
    expect(wallToEpoch('2026-07-01T09:00', MELBOURNE)).toBe(Date.parse('2026-06-30T23:00:00Z'));
  });

  it('moves a time inside the skipped DST hour by an hour', () => {
    // 02:30 on 4 October 2026 does not exist in Melbourne: 01:30 AEST or 03:30 AEDT.
    expect([Date.parse('2026-10-03T15:30:00Z'), Date.parse('2026-10-03T16:30:00Z')]).toContain(
      wallToEpoch('2026-10-04T02:30', MELBOURNE),
    );
  });

  it('uses the device zone for a null or unknown zone', () => {
    const device = new Date('2026-12-25T09:00').getTime();
    expect(wallToEpoch('2026-12-25T09:00', null)).toBe(device);
    expect(wallToEpoch('2026-12-25T09:00', 'Mars/Olympus_Mons')).toBe(device);
  });
});

describe('searchFontSize', () => {
  const fitsUpTo = (limit: number) => (px: number) => px <= limit;

  it('finds the largest fitting size, never above it', () => {
    const size = searchFontSize(fitsUpTo(37.3), 10, 200);
    expect(size).toBeLessThanOrEqual(37.3);
    expect(size).toBeGreaterThan(37.3 - 190 / 1024 - 1e-9);
  });

  it('is monotone in the room available', () => {
    const sizes = [12, 30, 55, 90, 140, 199].map((limit) =>
      searchFontSize(fitsUpTo(limit), 10, 200),
    );
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
  });

  it('gives max when max fits and min when nothing does', () => {
    expect(searchFontSize(fitsUpTo(500), 10, 200)).toBe(200);
    expect(searchFontSize(fitsUpTo(5), 10, 200)).toBe(10);
  });
});

describe('qrPath', () => {
  it('draws a version 1 code without a border for short text', () => {
    const { size, d } = qrPath('HELLO');
    expect(size).toBe(21);
    expect(d).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
    // The three finder patterns put a dark module in each of these corners.
    expect(d).toContain('M0 0h1v1h-1z');
    expect(d).toContain('M20 0h1v1h-1z');
    expect(d).toContain('M0 20h1v1h-1z');
  });

  it('encodes text outside ASCII as its UTF-8 bytes, so it scans as written', () => {
    const text = 'café €5';
    const bytes = Array.from(new TextEncoder().encode(text));
    expect(bytes).toHaveLength(10);
    expect(encode(text, { ecc: 'M', border: 0 }).data).toEqual(
      encode(bytes, { ecc: 'M', border: 0 }).data,
    );
  });

  it('grows with the content', () => {
    expect(qrPath('café €5').size).toBe(21);
    expect(qrPath('x'.repeat(300)).size).toBeGreaterThan(21);
  });
});
