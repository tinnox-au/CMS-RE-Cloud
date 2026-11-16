import { describe, expect, it } from 'vitest';
import { computePosition, parsePlacement, type Box } from './positioner.ts';

const VIEWPORT = { width: 1280, height: 800 };
const MENU = { width: 220, height: 180 };

function anchorAt(x: number, y: number, width = 36, height = 36): Box {
  return { x, y, width, height };
}

describe('parsePlacement', () => {
  it('splits side and alignment, centring by default', () => {
    expect(parsePlacement('bottom')).toEqual({ side: 'bottom', align: 'center' });
    expect(parsePlacement('bottom-start')).toEqual({ side: 'bottom', align: 'start' });
    expect(parsePlacement('left-end')).toEqual({ side: 'left', align: 'end' });
  });
});

describe('computePosition', () => {
  it('puts a menu below its button, start edges aligned', () => {
    const position = computePosition({
      anchor: anchorAt(400, 100),
      popover: MENU,
      viewport: VIEWPORT,
      placement: 'bottom-start',
    });
    expect(position).toMatchObject({ x: 400, y: 142, side: 'bottom', align: 'start' });
  });

  it('aligns end edges for a row menu at the right of a table', () => {
    const position = computePosition({
      anchor: anchorAt(1200, 100),
      popover: MENU,
      viewport: VIEWPORT,
      placement: 'bottom-end',
    });
    expect(position.x).toBe(1200 + 36 - 220);
    expect(position.side).toBe('bottom');
  });

  it('flips above when the space below is too small and above is larger', () => {
    const position = computePosition({
      anchor: anchorAt(400, 700),
      popover: MENU,
      viewport: VIEWPORT,
      placement: 'bottom-start',
    });
    expect(position.side).toBe('top');
    expect(position.y).toBe(700 - 6 - 180);
    expect(position.maxHeight).toBe(700 - 6 - 8);
  });

  it('stays on the preferred side when the other side is smaller still', () => {
    const position = computePosition({
      anchor: anchorAt(400, 300),
      popover: { width: 220, height: 900 },
      viewport: VIEWPORT,
      placement: 'bottom-start',
    });
    expect(position.side).toBe('bottom');
    expect(position.maxHeight).toBe(800 - 336 - 6 - 8);
    expect(position.y).toBe(342);
  });

  it('never crosses the viewport margin sideways', () => {
    const right = computePosition({
      anchor: anchorAt(1230, 100),
      popover: MENU,
      viewport: VIEWPORT,
      placement: 'bottom-start',
    });
    expect(right.x).toBe(1280 - 8 - 220);
    const left = computePosition({
      anchor: anchorAt(2, 100),
      popover: MENU,
      viewport: VIEWPORT,
      placement: 'bottom-end',
    });
    expect(left.x).toBe(8);
  });

  it('centres a tooltip over its target and flips it below at the top edge', () => {
    const tip = { width: 100, height: 28 };
    const above = computePosition({
      anchor: anchorAt(500, 300),
      popover: tip,
      viewport: VIEWPORT,
      placement: 'top',
      gap: 8,
    });
    expect(above).toMatchObject({ x: 500 + 18 - 50, y: 300 - 8 - 28, side: 'top' });
    const below = computePosition({
      anchor: anchorAt(500, 10),
      popover: tip,
      viewport: VIEWPORT,
      placement: 'top',
      gap: 8,
    });
    expect(below).toMatchObject({ y: 10 + 36 + 8, side: 'bottom' });
  });

  it('handles the horizontal sides, flipping left to right when needed', () => {
    const position = computePosition({
      anchor: anchorAt(20, 400),
      popover: MENU,
      viewport: VIEWPORT,
      placement: 'left-start',
    });
    expect(position.side).toBe('right');
    expect(position.x).toBe(20 + 36 + 6);
    expect(position.y).toBe(400);
    const centred = computePosition({
      anchor: anchorAt(600, 400),
      popover: MENU,
      viewport: VIEWPORT,
      placement: 'right',
    });
    expect(centred).toMatchObject({ x: 642, y: 400 + 18 - 90, side: 'right' });
  });

  it('keeps an oversized popover at the start margin and reports the room it has', () => {
    const position = computePosition({
      anchor: anchorAt(100, 100),
      popover: { width: 2000, height: 100 },
      viewport: { width: 320, height: 480 },
      placement: 'bottom',
    });
    expect(position.x).toBe(8);
    expect(position.maxWidth).toBe(320 - 16);
  });

  it('keeps a usable minimum in a viewport with no room at all', () => {
    const position = computePosition({
      anchor: anchorAt(0, 0, 40, 40),
      popover: MENU,
      viewport: { width: 60, height: 60 },
      placement: 'bottom-start',
    });
    expect(position.maxHeight).toBeGreaterThanOrEqual(48);
    expect(position.maxWidth).toBeGreaterThanOrEqual(48);
    expect(position.x).toBe(8);
    expect(position.y).toBe(8);
  });

  it('answers whole pixels', () => {
    const position = computePosition({
      anchor: { x: 10.4, y: 20.6, width: 33.3, height: 30.2 },
      popover: { width: 101, height: 41 },
      viewport: VIEWPORT,
      placement: 'bottom',
    });
    expect(Number.isInteger(position.x)).toBe(true);
    expect(Number.isInteger(position.y)).toBe(true);
  });
});
