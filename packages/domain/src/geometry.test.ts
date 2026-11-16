import { describe, expect, it } from 'vitest';
import {
  canvasToViewport,
  effectiveContentRect,
  fitRect,
  placeOnCanvas,
  stageTransform,
} from './geometry.ts';

const frame = (width: number, height: number, x = 0, y = 0) => ({ x, y, width, height });

describe('fitRect contain', () => {
  it('pillarboxes a 4:3 source on a 16:9 landscape canvas', () => {
    const p = fitRect({ width: 800, height: 600 }, frame(1920, 1080), 'contain');
    expect(p.scale).toBeCloseTo(1.8);
    expect(p.dest).toEqual({ x: 240, y: 0, width: 1440, height: 1080 });
    expect(p.visible).toEqual(p.dest);
    expect(p.sourceCrop).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('letterboxes a landscape source on a portrait canvas', () => {
    const p = fitRect({ width: 1920, height: 1080 }, frame(1080, 1920), 'contain');
    expect(p.dest.width).toBeCloseTo(1080);
    expect(p.dest.height).toBeCloseTo(607.5);
    expect(p.dest.x).toBeCloseTo(0);
    expect(p.dest.y).toBeCloseTo(656.25);
  });

  it('fits a 16:9 source on a tall 640x1344 LED-shaped canvas', () => {
    const p = fitRect({ width: 1920, height: 1080 }, frame(640, 1344), 'contain');
    expect(p.scale).toBeCloseTo(1 / 3);
    expect(p.dest.width).toBeCloseTo(640);
    expect(p.dest.height).toBeCloseTo(360);
    expect(p.dest.y).toBeCloseTo(492);
  });

  it('fits a portrait source on a wide 768x448 canvas', () => {
    const p = fitRect({ width: 1080, height: 1920 }, frame(768, 448), 'contain');
    expect(p.dest.height).toBeCloseTo(448);
    expect(p.dest.width).toBeCloseTo(252);
    expect(p.dest.x).toBeCloseTo(258);
    expect(p.dest.y).toBeCloseTo(0);
  });

  it('never exceeds the frame for many aspect ratios', () => {
    for (const [sw, sh] of [
      [1, 1],
      [3000, 10],
      [10, 3000],
      [1920, 1080],
      [640, 1344],
      [768, 448],
    ] as const) {
      for (const [fw, fh] of [
        [1920, 1080],
        [1080, 1920],
        [640, 1344],
        [768, 448],
        [16, 16384],
      ] as const) {
        const p = fitRect({ width: sw, height: sh }, frame(fw, fh), 'contain');
        expect(p.dest.width).toBeLessThanOrEqual(fw + 1e-9);
        expect(p.dest.height).toBeLessThanOrEqual(fh + 1e-9);
        expect(p.dest.x).toBeGreaterThanOrEqual(-1e-9);
        expect(p.dest.y).toBeGreaterThanOrEqual(-1e-9);
        // one axis is filled exactly and the aspect ratio is preserved
        expect(Math.min(fw - p.dest.width, fh - p.dest.height)).toBeCloseTo(0, 6);
        expect(p.dest.width / p.dest.height).toBeCloseTo(sw / sh, 6);
      }
    }
  });
});

describe('fitRect cover', () => {
  it('crops the sides of a 16:9 source on a 640x1344 canvas', () => {
    const p = fitRect({ width: 1920, height: 1080 }, frame(640, 1344), 'cover');
    expect(p.scale).toBeCloseTo(1344 / 1080);
    expect(p.dest.height).toBeCloseTo(1344);
    expect(p.dest.width).toBeCloseTo(1920 * (1344 / 1080));
    expect(p.dest.x).toBeCloseTo((640 - 1920 * (1344 / 1080)) / 2);
    expect(p.visible).toEqual(frame(640, 1344));
    expect(p.sourceCrop.height).toBeCloseTo(1080);
    expect(p.sourceCrop.width).toBeCloseTo(640 / (1344 / 1080));
    expect(p.sourceCrop.x).toBeCloseTo((1920 - 640 / (1344 / 1080)) / 2);
  });

  it('crops top and bottom of a portrait source on a 768x448 canvas', () => {
    const p = fitRect({ width: 1080, height: 1920 }, frame(768, 448), 'cover');
    expect(p.dest.width).toBeCloseTo(768);
    expect(p.dest.height).toBeCloseTo(1920 * (768 / 1080));
    expect(p.dest.y).toBeLessThan(0);
    expect(p.sourceCrop.width).toBeCloseTo(1080);
    expect(p.sourceCrop.height).toBeCloseTo(448 / (768 / 1080));
  });

  it('always covers the frame and keeps the aspect ratio', () => {
    for (const [sw, sh] of [
      [1, 1],
      [3000, 10],
      [10, 3000],
      [1920, 1080],
    ] as const) {
      for (const [fw, fh] of [
        [1920, 1080],
        [1080, 1920],
        [640, 1344],
        [768, 448],
      ] as const) {
        const p = fitRect({ width: sw, height: sh }, frame(fw, fh), 'cover');
        expect(p.dest.width).toBeGreaterThanOrEqual(fw - 1e-9);
        expect(p.dest.height).toBeGreaterThanOrEqual(fh - 1e-9);
        expect(p.dest.x).toBeLessThanOrEqual(1e-9);
        expect(p.dest.y).toBeLessThanOrEqual(1e-9);
        expect(p.dest.width / p.dest.height).toBeCloseTo(sw / sh, 6);
        expect(p.sourceCrop.x).toBeGreaterThanOrEqual(-1e-9);
        expect(p.sourceCrop.x + p.sourceCrop.width).toBeLessThanOrEqual(sw + 1e-9);
        expect(p.sourceCrop.y + p.sourceCrop.height).toBeLessThanOrEqual(sh + 1e-9);
      }
    }
  });

  it('contain and cover agree when aspect ratios match', () => {
    const a = fitRect({ width: 1280, height: 720 }, frame(1920, 1080), 'contain');
    const b = fitRect({ width: 1280, height: 720 }, frame(1920, 1080), 'cover');
    expect(a.dest).toEqual(b.dest);
  });
});

describe('content rectangle', () => {
  it('uses the whole canvas when there is no content rectangle', () => {
    expect(effectiveContentRect({ width: 768, height: 448 }, null)).toEqual({
      x: 0,
      y: 0,
      width: 768,
      height: 448,
    });
  });

  it('places content inside an offset content rectangle', () => {
    const p = placeOnCanvas(
      { width: 100, height: 100 },
      { width: 1920, height: 1080 },
      { x: 100, y: 50, width: 640, height: 320 },
      'contain',
    );
    expect(p.dest).toEqual({ x: 260, y: 50, width: 320, height: 320 });
    expect(p.clip).toEqual({ x: 100, y: 50, width: 640, height: 320 });
  });

  it('rejects a content rectangle outside the canvas', () => {
    expect(() =>
      effectiveContentRect({ width: 640, height: 1344 }, { x: 600, y: 0, width: 100, height: 100 }),
    ).toThrow(RangeError);
  });
});

describe('input checking and preview scaling', () => {
  it('rejects zero, negative and non-finite sizes', () => {
    expect(() => fitRect({ width: 0, height: 10 }, frame(10, 10), 'contain')).toThrow(RangeError);
    expect(() => fitRect({ width: 10, height: -1 }, frame(10, 10), 'cover')).toThrow(RangeError);
    expect(() => fitRect({ width: 10, height: 10 }, frame(Number.NaN, 10), 'cover')).toThrow(
      RangeError,
    );
    expect(() =>
      fitRect({ width: 10, height: 10 }, frame(10, Number.POSITIVE_INFINITY), 'contain'),
    ).toThrow(RangeError);
  });

  it('scales a 640x1344 canvas into a 1920x1080 monitor without cropping', () => {
    const v = canvasToViewport({ width: 640, height: 1344 }, { width: 1920, height: 1080 });
    expect(v.scale).toBeCloseTo(1080 / 1344);
    expect(v.offsetY).toBeCloseTo(0);
    expect(v.offsetX).toBeCloseTo((1920 - 640 * (1080 / 1344)) / 2);
  });
});

describe('stageTransform', () => {
  const stage = { width: 1920, height: 1080 };
  it('swaps the layout size for a quarter turn and maps it back onto the stage', () => {
    expect(stageTransform(0, stage)).toEqual({ viewport: stage, prefix: '' });
    expect(stageTransform(90, stage)).toEqual({
      viewport: { width: 1080, height: 1920 },
      prefix: 'translate(1920px,0) rotate(90deg)',
    });
    expect(stageTransform(180, stage)).toEqual({
      viewport: stage,
      prefix: 'translate(1920px,1080px) rotate(180deg)',
    });
    expect(stageTransform(270, stage)).toEqual({
      viewport: { width: 1080, height: 1920 },
      prefix: 'translate(0,1080px) rotate(270deg)',
    });
  });
});
