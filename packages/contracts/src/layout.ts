import { z } from 'zod';
import { rectsOverlap } from './canvas.ts';
import { LayoutIdSchema, PlaylistIdSchema, UtcTimestampSchema } from './ids.ts';
import { ABSOLUTE } from './limits.ts';
import { PlaylistRefSchema } from './refs.ts';
import { DescriptionInputSchema, DescriptionSchema, NameSchema } from './text.ts';

// Imports only ids, limits, refs, text and canvas, never playlist.ts (which imports manifest.ts),
// so display.ts and manifest.ts can import this file without a cycle.

/** Zone geometry is in basis points of each screen's content rectangle: 10 000 is its whole width or height. Twin of layout_zone_in_bounds (0011). */
export const LAYOUT_UNITS = 10_000;

const offset = z.number().int().min(0).max(LAYOUT_UNITS);
const extent = z.number().int().min(1).max(LAYOUT_UNITS);
/** A zone's rectangle, origin top-left, in basis points (a plain shape: zod refuses `.extend()` on a refined object). */
export const layoutBoxShape = { x: offset, y: offset, width: extent, height: extent };
export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The cross-zone checks of a layout: every zone ends inside the area, and no two zones overlap
 * (touching is allowed). Paths use the dotted form the API gives (`zones.1.width`).
 */
export function checkLayoutZones(zones: readonly LayoutBox[], ctx: z.RefinementCtx): void {
  zones.forEach((zone, n) => {
    if (zone.x + zone.width > LAYOUT_UNITS) {
      ctx.addIssue({
        code: 'custom',
        path: ['zones', n, 'width'],
        message: `x + width must not exceed ${LAYOUT_UNITS}`,
      });
    }
    if (zone.y + zone.height > LAYOUT_UNITS) {
      ctx.addIssue({
        code: 'custom',
        path: ['zones', n, 'height'],
        message: `y + height must not exceed ${LAYOUT_UNITS}`,
      });
    }
    const earlier = zones.slice(0, n).findIndex((other) => rectsOverlap(other, zone));
    if (earlier !== -1) {
      // Both zones counted from 1, as zone_too_small names its zone; the path counts from 0.
      ctx.addIssue({
        code: 'custom',
        path: ['zones', n],
        message: `zone ${n + 1} overlaps zone ${earlier + 1}`,
      });
    }
  });
}

export const LayoutZoneInputSchema = z
  .object({ playlistId: PlaylistIdSchema, ...layoutBoxShape })
  .strict();
export type LayoutZoneInput = z.infer<typeof LayoutZoneInputSchema>;

/**
 * `POST /api/layouts` and `PUT /api/layouts/:id`: the whole layout. Two to four zones, each a
 * rectangle with a playlist; `zones[0]` is the main zone, which speaks for the screen.
 *
 * On PUT an absent `description` is left as it is; null or a blank string clears it (as the
 * schedule PUT). An unknown or deleted playlist answers 400.
 *
 * A refusal of this body names its fields with dots, as the API joins zod paths: `name`,
 * `description`, `zones`, `zones.1`, `zones.1.playlistId`, `zones.1.x`, `zones.1.width` (the
 * zone index counts from 0). The API's own playlist check and the portal's mapping use the same
 * strings. The bracket form (`zones[1].playlist`) belongs to push issues only (`PushIssueSchema`).
 */
export const LayoutInputSchema = z
  .object({
    name: NameSchema,
    description: DescriptionInputSchema.optional(),
    /** Position order: [0] is the main zone. */
    zones: z.array(LayoutZoneInputSchema).min(2).max(ABSOLUTE.maxLayoutZones),
  })
  .strict()
  .superRefine((input, ctx) => {
    checkLayoutZones(input.zones, ctx);
  });
export type LayoutInput = z.infer<typeof LayoutInputSchema>;

export const LayoutZoneDtoSchema = z
  .object({ playlist: PlaylistRefSchema, ...layoutBoxShape })
  .strict();
export type LayoutZoneDto = z.infer<typeof LayoutZoneDtoSchema>;

/** One layout, in `GET /api/layouts` and on its own: a layout has at most four child rows. */
export const LayoutDtoSchema = z
  .object({
    id: LayoutIdSchema,
    name: z.string(),
    description: DescriptionSchema.nullable(),
    /** Position order: [0] is the main zone. */
    zones: z.array(LayoutZoneDtoSchema).min(2).max(ABSOLUTE.maxLayoutZones),
    /** How many displays have this layout assigned. */
    assignedDisplayCount: z.number().int().nonnegative(),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type LayoutDto = z.infer<typeof LayoutDtoSchema>;

export const LayoutListResponseSchema = z
  .object({ items: z.array(LayoutDtoSchema).max(ABSOLUTE.maxListItems) })
  .strict();
export type LayoutListResponse = z.infer<typeof LayoutListResponseSchema>;
