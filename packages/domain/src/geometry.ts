import {
  LAYOUT_UNITS,
  type Canvas,
  type FitMode,
  type LayoutBox,
  type Rect,
  type Rotation,
} from '@tinnox/contracts';

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Rectangle with fractional coordinates, in canvas pixels. */
export interface FloatRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  /** Uniform scale applied to the source. */
  readonly scale: number;
  /**
   * Where the whole scaled source lands, in canvas pixels. For `cover` this
   * extends beyond `clip` on one axis; a renderer must clip to `clip`.
   */
  readonly dest: FloatRect;
  /** Region of the canvas that may show content (the content rectangle). */
  readonly clip: FloatRect;
  /** Part of `clip` actually covered by content. Equals `clip` for `cover`. */
  readonly visible: FloatRect;
  /** Part of the source that ends up visible, in source pixels. The whole source for `contain`. */
  readonly sourceCrop: FloatRect;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${String(value)}`);
  }
}

/** The area content is rendered into: the content rectangle, or the whole canvas. */
export function effectiveContentRect(canvas: Canvas, contentRect: Rect | null): Rect {
  if (contentRect === null) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }
  if (
    contentRect.x < 0 ||
    contentRect.y < 0 ||
    contentRect.x + contentRect.width > canvas.width ||
    contentRect.y + contentRect.height > canvas.height
  ) {
    throw new RangeError('content rectangle lies outside the canvas');
  }
  return contentRect;
}

/**
 * A zone's rectangle in canvas pixels. `area` is the effective content rectangle (the content
 * rectangle, or the whole canvas) and `zone` is in basis points of it (LAYOUT_UNITS). Edges are
 * rounded, not sizes: two zones that share an edge in basis points share it in pixels, so they
 * never gap or overlap, and rounding is monotone, so disjoint zones stay disjoint. The products
 * are at most 16 384 × 10 000, exact in doubles.
 */
export function zoneRect(area: Rect, zone: LayoutBox): Rect {
  const x0 = area.x + Math.round((area.width * zone.x) / LAYOUT_UNITS);
  const x1 = area.x + Math.round((area.width * (zone.x + zone.width)) / LAYOUT_UNITS);
  const y0 = area.y + Math.round((area.height * zone.y) / LAYOUT_UNITS);
  const y1 = area.y + Math.round((area.height * (zone.y + zone.height)) / LAYOUT_UNITS);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Places a source of intrinsic size `source` into `frame`, centred, keeping the aspect ratio.
 * - contain: the whole source is visible; unused frame area stays empty (letterbox or pillarbox).
 * - cover: the frame is completely filled; the overflow of the source is cropped equally on both sides.
 */
export function fitRect(source: Size, frame: FloatRect, fit: FitMode): Placement {
  assertPositiveFinite(source.width, 'source.width');
  assertPositiveFinite(source.height, 'source.height');
  assertPositiveFinite(frame.width, 'frame.width');
  assertPositiveFinite(frame.height, 'frame.height');
  if (!Number.isFinite(frame.x) || !Number.isFinite(frame.y)) {
    throw new RangeError('frame origin must be finite');
  }

  const scaleX = frame.width / source.width;
  const scaleY = frame.height / source.height;
  const scale = fit === 'contain' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);

  const width = source.width * scale;
  const height = source.height * scale;
  const dest: FloatRect = {
    x: frame.x + (frame.width - width) / 2,
    y: frame.y + (frame.height - height) / 2,
    width,
    height,
  };

  if (fit === 'contain') {
    return {
      scale,
      dest,
      clip: frame,
      visible: dest,
      sourceCrop: { x: 0, y: 0, width: source.width, height: source.height },
    };
  }

  const cropWidth = frame.width / scale;
  const cropHeight = frame.height / scale;
  return {
    scale,
    dest,
    clip: frame,
    visible: frame,
    sourceCrop: {
      x: (source.width - cropWidth) / 2,
      y: (source.height - cropHeight) / 2,
      width: cropWidth,
      height: cropHeight,
    },
  };
}

/** Convenience: placement of a source on a display canvas, honouring the content rectangle. */
export function placeOnCanvas(
  source: Size,
  canvas: Canvas,
  contentRect: Rect | null,
  fit: FitMode,
): Placement {
  return fitRect(source, effectiveContentRect(canvas, contentRect), fit);
}

/**
 * Uniform scale and offset that show a whole canvas inside a viewport
 * (for example a 640x1344 LED-shaped canvas previewed on a 1920x1080 monitor).
 * The canvas is never cropped.
 */
export function canvasToViewport(
  canvas: Canvas,
  viewport: Size,
): { scale: number; offsetX: number; offsetY: number } {
  const placement = fitRect(
    canvas,
    { x: 0, y: 0, width: viewport.width, height: viewport.height },
    'contain',
  );
  return { scale: placement.scale, offsetX: placement.dest.x, offsetY: placement.dest.y };
}

/**
 * How to turn the picture for a screen mounted on its side or upside down.
 * `viewport` is the size to lay the canvas out in (width and height swapped for
 * 90 and 270); `prefix` is the CSS transform, with origin 0 0, that maps that
 * layout back onto the real `stage`.
 */
export function stageTransform(
  rotation: Rotation,
  stage: Size,
): { viewport: Size; prefix: string } {
  const W = stage.width;
  const H = stage.height;
  switch (rotation) {
    case 0:
      return { viewport: { width: W, height: H }, prefix: '' };
    case 90:
      return { viewport: { width: H, height: W }, prefix: `translate(${W}px,0) rotate(90deg)` };
    case 180:
      return {
        viewport: { width: W, height: H },
        prefix: `translate(${W}px,${H}px) rotate(180deg)`,
      };
    case 270:
      return { viewport: { width: H, height: W }, prefix: `translate(0,${H}px) rotate(270deg)` };
  }
}
