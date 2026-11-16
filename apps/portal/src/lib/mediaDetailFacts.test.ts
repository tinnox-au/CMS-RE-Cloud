import type { MediaUsageResponse } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  codecLabel,
  deleteConsequence,
  mediaFailureText,
  mediaFormatLabel,
  mediaKindFact,
  shortHash,
  usageSummary,
  videoLengthFact,
} from './mediaDetailFacts.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function usage(playlists: number, screens: number): MediaUsageResponse {
  return {
    playlists: Array.from({ length: playlists }, (_, i) => ({ id: ID(i), name: `Loop ${i}` })),
    displays: Array.from({ length: screens }, (_, i) => ({ id: ID(100 + i), name: `Foyer ${i}` })),
  };
}

describe('media facts', () => {
  it('names the format', () => {
    expect(mediaFormatLabel('image/jpeg')).toBe('JPEG');
    expect(mediaFormatLabel('image/png')).toBe('PNG');
    expect(mediaFormatLabel('video/mp4')).toBe('MP4');
    expect(mediaFormatLabel(null)).toBeNull();
    expect(mediaKindFact({ kind: 'image', mimeType: 'image/png' })).toBe('Image (PNG)');
    expect(mediaKindFact({ kind: 'video', mimeType: null })).toBe('Video');
  });

  it('writes a codec as people write it', () => {
    expect(codecLabel('h264')).toBe('H.264');
    expect(codecLabel('H264')).toBe('H.264');
    expect(codecLabel('vp9')).toBe('vp9');
    expect(codecLabel('  ')).toBeNull();
    expect(codecLabel(null)).toBeNull();
  });

  it('gives a video length as a clock reading and in words', () => {
    expect(videoLengthFact(12_000)).toBe('0:12 (12 s)');
    expect(videoLengthFact(65_000)).toBe('1:05 (1 min 5 s)');
    expect(videoLengthFact(null)).toBeNull();
  });

  it('shortens a hash and leaves a short value whole', () => {
    expect(shortHash('0123456789abcdef0123')).toBe('0123456789ab…');
    expect(shortHash('abc')).toBe('abc');
    expect(shortHash('0123456789abcdef', 8)).toBe('01234567…');
  });

  it('explains a failed file as M0 does', () => {
    expect(mediaFailureText({ errorCode: 'unsupported_codec', errorDetail: 'codec hevc' })).toEqual(
      {
        message:
          'The video codec is not supported. Re-encode the video as H.264 in an MP4 container.',
        code: 'unsupported_codec',
        detail: 'codec hevc',
      },
    );
    expect(mediaFailureText({ errorCode: null, errorDetail: null })).toEqual({
      message: 'The file was rejected. No reason was recorded.',
      code: null,
      detail: null,
    });
  });
});

describe('media usage wording', () => {
  it('sums up where a file is used', () => {
    expect(usageSummary(usage(0, 0))).toBe('Not used yet');
    expect(usageSummary(usage(1, 0))).toBe('In 1 playlist');
    expect(usageSummary(usage(2, 1))).toBe('In 2 playlists · Pushed to 1 screen');
    expect(usageSummary(usage(0, 3))).toBe('Pushed to 3 screens');
  });

  it('says before a delete what the server will do', () => {
    expect(deleteConsequence(null)).toBe(
      'If a playlist still uses the file, the server refuses the deletion.',
    );
    expect(deleteConsequence(usage(0, 2))).toBe('No playlist uses it.');
    expect(deleteConsequence(usage(1, 0))).toMatch(/It is in 1 playlist, .* from that playlist\./);
    expect(deleteConsequence(usage(3, 0))).toMatch(
      /It is in 3 playlists, .* from those playlists\./,
    );
  });

  it('uses the operator-facing words only', () => {
    const texts = [
      usageSummary(usage(2, 2)),
      deleteConsequence(usage(2, 2)),
      deleteConsequence(null),
    ].join(' ');
    expect(texts).not.toMatch(/display/i);
    expect(texts).not.toMatch(/\bonline\b|\boffline\b/i);
  });
});
