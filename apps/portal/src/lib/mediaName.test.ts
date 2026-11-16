import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDimensions,
  mediaDetailsLabel,
  mediaDisplayName,
  mediaIsRenamed,
  mediaKindLabel,
  mediaKindPluralLabel,
  mediaKindsLabel,
  mediaSizeLabel,
  playlistItemCountLabel,
  playlistLengthLabel,
  playlistSummaryLabel,
  presentMediaStatus,
} from './mediaName.ts';

describe('media names', () => {
  it('shows the given name, else the file name, and never a blank', () => {
    expect(mediaDisplayName({ name: 'Spring sale', originalName: 'IMG_0042.jpg' })).toBe(
      'Spring sale',
    );
    expect(mediaDisplayName({ name: '  ', originalName: 'IMG_0042.jpg' })).toBe('IMG_0042.jpg');
    expect(mediaDisplayName({ name: '', originalName: '' })).toBe('Unnamed file');
  });

  it('knows when an operator renamed the item', () => {
    expect(mediaIsRenamed({ name: 'Spring sale', originalName: 'IMG_0042.jpg' })).toBe(true);
    expect(mediaIsRenamed({ name: 'IMG_0042.jpg', originalName: 'IMG_0042.jpg' })).toBe(false);
  });

  it('names the kinds', () => {
    expect(mediaKindLabel('image')).toBe('Image');
    expect(mediaKindLabel('video')).toBe('Video');
    expect(mediaKindPluralLabel('video')).toBe('Videos');
    expect(mediaKindsLabel([])).toBe('');
    expect(mediaKindsLabel(['image'])).toBe('Images');
    expect(mediaKindsLabel(['video'])).toBe('Videos');
    expect(mediaKindsLabel(['image', 'video'])).toBe('Images and videos');
  });
});

describe('media measures', () => {
  it('writes dimensions with a multiplication sign, as the M0 pages do', () => {
    expect(formatDimensions(3840, 480)).toBe('3840 × 480 px');
    expect(formatDimensions(null, 480)).toBeNull();
    expect(formatDimensions(1920, null)).toBeNull();
  });

  it('writes a length as a clock reading', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(400)).toBe('0:01');
    expect(formatClock(9_500)).toBe('0:10');
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(599_999)).toBe('10:00');
    expect(formatClock(3_600_000)).toBe('1:00:00');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(-1)).toBeNull();
    expect(formatClock(Number.NaN)).toBeNull();
  });

  it('gives the details of an image and of a video', () => {
    expect(mediaDetailsLabel({ kind: 'image', width: 1920, height: 1080, durationMs: null })).toBe(
      '1920 × 1080 px',
    );
    expect(mediaDetailsLabel({ kind: 'video', width: 1280, height: 720, durationMs: 12_000 })).toBe(
      '1280 × 720 px · 0:12',
    );
    expect(
      mediaDetailsLabel({ kind: 'video', width: null, height: null, durationMs: 12_000 }),
    ).toBe('0:12');
    expect(
      mediaDetailsLabel({ kind: 'image', width: null, height: null, durationMs: null }),
    ).toBeNull();
  });

  it('gives the size, or null while it is not known', () => {
    expect(mediaSizeLabel({ bytes: 2_500_000 })).toBe('2.4 MB');
    expect(mediaSizeLabel({ bytes: 0 })).toBe('0 bytes');
    expect(mediaSizeLabel({ bytes: null })).toBeNull();
  });

  it('words the three media states as M0 does', () => {
    expect(presentMediaStatus('ready')).toEqual({ tone: 'ok', label: 'Ready' });
    expect(presentMediaStatus('processing')).toEqual({ tone: 'warn', label: 'Processing' });
    expect(presentMediaStatus('failed')).toEqual({ tone: 'danger', label: 'Failed' });
  });
});

describe('playlist measures', () => {
  it('counts items and gives the loop length', () => {
    expect(playlistItemCountLabel(1)).toBe('1 item');
    expect(playlistItemCountLabel(12)).toBe('12 items');
    expect(playlistLengthLabel(45_000)).toBe('0:45');
    expect(playlistLengthLabel(0)).toBe('0:00');
  });

  it('writes one line for a playlist row', () => {
    expect(playlistSummaryLabel({ itemCount: 3, totalDurationMs: 45_000 })).toBe('3 items · 0:45');
    expect(playlistSummaryLabel({ itemCount: 1, totalDurationMs: 10_000 })).toBe('1 item · 0:10');
    expect(playlistSummaryLabel({ itemCount: 0, totalDurationMs: 0 })).toBe('No items');
  });
});
