import type { DisplayDto } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { displayFormFromDto, validateDisplayForm } from './displayForm.ts';
import {
  attentionTitle,
  CANVAS_PRESETS,
  canvasErrorItems,
  canvasFormDirty,
  canvasFormForValidation,
  canvasShapeCaption,
  canvasShapeDescription,
  canvasSizeLabel,
  contentRectLabel,
  DEFAULT_FIT_OPTION_LABELS,
  defaultFitHint,
  frameGeometry,
  shapeOfDisplay,
  toCanvasPatch,
} from './screenDetailCanvas.ts';

const display: DisplayDto = {
  id: '17b118a7-b491-405b-bff2-b26f55cf9f61',
  siteId: '27b118a7-b491-405b-bff2-b26f55cf9f61',
  name: 'Foyer',
  description: null,
  canvas: { width: 1920, height: 1080 },
  contentRect: null,
  defaultFit: 'contain',
  route: 'browser',
  player: null,
  tagIds: [],
  assignedPlaylist: null,
  createdAt: '2026-11-15T00:00:00.000Z',
  updatedAt: '2026-11-15T00:00:00.000Z',
};
const limits = { minCanvasSidePx: 16, maxCanvasSidePx: 16384 };

describe('canvas form', () => {
  it('is dirty only for the canvas fields, and the rectangle only while it is on', () => {
    const stored = displayFormFromDto(display);
    expect(canvasFormDirty(stored, display)).toBe(false);
    expect(canvasFormDirty({ ...stored, name: 'Other' }, display)).toBe(false);
    expect(canvasFormDirty({ ...stored, width: '3840' }, display)).toBe(true);
    expect(canvasFormDirty({ ...stored, rectWidth: '100' }, display)).toBe(false);
    expect(canvasFormDirty({ ...stored, useContentRect: true }, display)).toBe(true);
    expect(canvasFormDirty({ ...stored, defaultFit: 'cover' }, display)).toBe(true);
  });

  it('validates with the stored name and site and sends only the canvas', () => {
    const values = {
      ...displayFormFromDto(display),
      name: '',
      siteId: '',
      width: '3840',
      height: '480',
    };
    const result = validateDisplayForm(canvasFormForValidation(values, display), limits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toCanvasPatch(result.value)).toEqual({
      canvas: { width: 3840, height: 480 },
      contentRect: null,
      defaultFit: 'contain',
    });
  });

  it('keeps the M0 messages and lists them in reading order', () => {
    const values = {
      ...displayFormFromDto(display),
      width: 'abc',
      height: '5',
      useContentRect: true,
      rectWidth: '',
      rectHeight: '10',
    };
    const result = validateDisplayForm(canvasFormForValidation(values, display), limits);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const items = canvasErrorItems(result.errors);
    expect(items.map((i) => i.label)).toEqual([
      'Width (px)',
      'Height (px)',
      'Content width (px)',
      'Content height (px)',
    ]);
    expect(items[0]?.message).toBe('Width must be a whole number of pixels.');
    expect(attentionTitle(1)).toBe('One field needs attention.');
    expect(attentionTitle(4)).toBe('4 fields need attention.');
  });

  it('reports a rectangle outside the canvas', () => {
    const values = {
      ...displayFormFromDto(display),
      useContentRect: true,
      rectX: '1900',
      rectY: '0',
      rectWidth: '100',
      rectHeight: '100',
    };
    const result = validateDisplayForm(canvasFormForValidation(values, display), limits);
    expect(result.ok ? [] : canvasErrorItems(result.errors).map((i) => i.field)).toEqual([
      'contentRect',
    ]);
  });

  it('keeps the M0 presets', () => {
    expect(CANVAS_PRESETS.map((p) => p.label)).toContain('Wide strip 3840 × 480');
  });
});

describe('labels and geometry', () => {
  const rect = { x: 100, y: 0, width: 2000, height: 400 };
  it('writes sizes with the multiplication sign', () => {
    expect(canvasSizeLabel({ width: 3840, height: 480 })).toBe('3840 × 480 px');
    expect(contentRectLabel(null)).toBe('Whole canvas');
    expect(contentRectLabel(rect)).toBe('2000 × 400 px at (100, 0)');
    const shape = shapeOfDisplay({
      ...display,
      canvas: { width: 3840, height: 480 },
      contentRect: rect,
    });
    expect(canvasShapeCaption(shape)).toBe('3840 × 480 px, content 2000 × 400 at (100, 0)');
    expect(canvasShapeDescription(shape)).toMatch(/content rectangle of 2000 by 400 pixels/);
  });

  it('places the content rectangle in per cent and never outside the frame', () => {
    const whole = frameGeometry(shapeOfDisplay(display));
    expect(whole.ratio).toBeCloseTo(16 / 9);
    expect(whole.limited).toBe(false);
    expect(whole.content).toEqual({ left: 0, top: 0, width: 100, height: 100 });
    const part = frameGeometry({
      canvas: { width: 1000, height: 500 },
      contentRect: { x: 900, y: 250, width: 500, height: 500 },
      contentRectOutOfBounds: false,
    });
    expect(part.limited).toBe(true);
    expect(part.content.left).toBe(90);
    expect(part.content.width).toBe(10);
    expect(part.content.top).toBe(50);
    expect(part.content.height).toBe(50);
  });
});

describe('the default fit select', () => {
  it('keeps the options short and explains the chosen fit in the hint', () => {
    for (const label of Object.values(DEFAULT_FIT_OPTION_LABELS)) {
      expect(label.length).toBeLessThanOrEqual(12);
    }
    expect(defaultFitHint('contain')).toContain('black bars where the shape differs');
    expect(defaultFitHint('cover')).toContain('cropping the item equally on both sides');
    expect(defaultFitHint('cover')).toContain('do not choose their own fit');
  });
});
