/**
 * Geometry for popovers (menus, tooltips). Pure: rectangles in, a position out.
 * Coordinates are CSS pixels in the viewport's frame, as `getBoundingClientRect` gives them.
 *
 * The rules, in order:
 * 1. Place the popover on the preferred side of its anchor.
 * 2. Flip to the opposite side when the preferred side is too small and the other has more room.
 * 3. Never let it grow past the room on the chosen side: `maxWidth` and `maxHeight` say how
 *    much there is, so the caller can let the content scroll instead.
 * 4. Slide it along the other axis until it sits inside the viewport margin.
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';

/** `bottom` means centred below; `bottom-start` lines the popover's start edge up with the anchor's. */
export type Placement = Side | `${Side}-start` | `${Side}-end`;

export interface PositionRequest {
  readonly anchor: Box;
  /** The popover's natural size, measured without any size limit applied. */
  readonly popover: Size;
  readonly viewport: Size;
  readonly placement: Placement;
  /** Distance between anchor and popover. Default 6. */
  readonly gap?: number;
  /** Smallest distance kept from every viewport edge. Default 8. */
  readonly margin?: number;
}

export interface Position {
  /** Top-left corner of the popover. */
  readonly x: number;
  readonly y: number;
  /** The side actually used, after any flip. */
  readonly side: Side;
  readonly align: Align;
  /** Room the popover may take. Apply both as limits before showing it. */
  readonly maxWidth: number;
  readonly maxHeight: number;
}

const OPPOSITE: { readonly [K in Side]: Side } = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/** A popover is never squeezed below this, even in a tiny viewport. */
const MIN_ROOM = 48;

export function parsePlacement(placement: Placement): {
  readonly side: Side;
  readonly align: Align;
} {
  const [side, align] = placement.split('-') as [Side, 'start' | 'end' | undefined];
  return { side, align: align ?? 'center' };
}

function clamp(value: number, min: number, max: number): number {
  // When the range is inverted (the popover is larger than the viewport) the start edge wins.
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function computePosition(request: PositionRequest): Position {
  const { anchor, popover, viewport } = request;
  const gap = request.gap ?? 6;
  const margin = request.margin ?? 8;
  const preferred = parsePlacement(request.placement);

  const room: { readonly [K in Side]: number } = {
    top: anchor.y - gap - margin,
    bottom: viewport.height - (anchor.y + anchor.height) - gap - margin,
    left: anchor.x - gap - margin,
    right: viewport.width - (anchor.x + anchor.width) - gap - margin,
  };

  const vertical = preferred.side === 'top' || preferred.side === 'bottom';
  const needed = vertical ? popover.height : popover.width;
  let side = preferred.side;
  if (needed > room[side] && room[OPPOSITE[side]] > room[side]) side = OPPOSITE[side];

  const fullWidth = Math.max(MIN_ROOM, viewport.width - margin * 2);
  const fullHeight = Math.max(MIN_ROOM, viewport.height - margin * 2);
  const maxWidth = vertical ? fullWidth : Math.min(fullWidth, Math.max(MIN_ROOM, room[side]));
  const maxHeight = vertical ? Math.min(fullHeight, Math.max(MIN_ROOM, room[side])) : fullHeight;
  const width = Math.min(popover.width, maxWidth);
  const height = Math.min(popover.height, maxHeight);

  const along = (
    anchorStart: number,
    anchorLength: number,
    length: number,
    viewportLength: number,
  ): number => {
    let start = anchorStart;
    if (preferred.align === 'center') start = anchorStart + (anchorLength - length) / 2;
    if (preferred.align === 'end') start = anchorStart + anchorLength - length;
    return clamp(start, margin, viewportLength - margin - length);
  };

  let x: number;
  let y: number;
  if (vertical) {
    x = along(anchor.x, anchor.width, width, viewport.width);
    y = side === 'bottom' ? anchor.y + anchor.height + gap : anchor.y - gap - height;
    y = clamp(y, margin, viewport.height - margin - height);
  } else {
    y = along(anchor.y, anchor.height, height, viewport.height);
    x = side === 'right' ? anchor.x + anchor.width + gap : anchor.x - gap - width;
    x = clamp(x, margin, viewport.width - margin - width);
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    side,
    align: preferred.align,
    maxWidth: Math.floor(maxWidth),
    maxHeight: Math.floor(maxHeight),
  };
}
