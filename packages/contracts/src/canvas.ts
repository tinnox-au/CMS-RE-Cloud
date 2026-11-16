import { z } from 'zod';
import { ABSOLUTE } from './limits.ts';

export const FIT_MODES = ['contain', 'cover'] as const;
export const FitModeSchema = z.enum(FIT_MODES);
export type FitMode = z.infer<typeof FitModeSchema>;

/** Clockwise turn of the picture, for a screen mounted on its side or upside down. */
export const ROTATIONS = [0, 90, 180, 270] as const;
export const RotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
export type Rotation = z.infer<typeof RotationSchema>;

const side = z.number().int().min(ABSOLUTE.minCanvasSidePx).max(ABSOLUTE.maxCanvasSidePx);

/** Output frame in pixels. */
export const CanvasSchema = z.object({ width: side, height: side }).strict();
export type Canvas = z.infer<typeof CanvasSchema>;

/** Rectangle in canvas pixels, origin top-left. */
export const RectSchema = z
  .object({
    x: z.number().int().min(0).max(ABSOLUTE.maxCanvasSidePx),
    y: z.number().int().min(0).max(ABSOLUTE.maxCanvasSidePx),
    width: side,
    height: side,
  })
  .strict();
export type Rect = z.infer<typeof RectSchema>;

/** Returns a message when the rectangle does not lie fully inside the canvas, otherwise null. */
export function contentRectProblem(canvas: Canvas, rect: Rect): string | null {
  if (rect.x + rect.width > canvas.width) {
    return `content rectangle exceeds canvas width (${rect.x} + ${rect.width} > ${canvas.width})`;
  }
  if (rect.y + rect.height > canvas.height) {
    return `content rectangle exceeds canvas height (${rect.y} + ${rect.height} > ${canvas.height})`;
  }
  return null;
}

/**
 * A canvas plus an optional content rectangle inside it. Content is rendered
 * only inside the content rectangle (the whole canvas when it is null); the
 * rest of the output frame stays black. Reserved for later LED mapping.
 */
export const CanvasSpecSchema = z
  .object({
    canvas: CanvasSchema,
    contentRect: RectSchema.nullable(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    if (spec.contentRect === null) return;
    const problem = contentRectProblem(spec.canvas, spec.contentRect);
    if (problem !== null) {
      ctx.addIssue({ code: 'custom', path: ['contentRect'], message: problem });
    }
  });
export type CanvasSpec = z.infer<typeof CanvasSpecSchema>;
