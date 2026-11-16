import { z } from 'zod';
import { CanvasSchema, contentRectProblem, FitModeSchema, RectSchema } from './canvas.ts';
import {
  DisplayIdSchema,
  PlaylistIdSchema,
  RegistrationIdSchema,
  SiteIdSchema,
  UtcTimestampSchema,
} from './ids.ts';
import { PlaylistRefSchema } from './refs.ts';
import { TagIdsInputSchema, TagIdsSchema } from './tag.ts';
import { DescriptionInputSchema, DescriptionSchema, NameSchema } from './text.ts';

/** Delivery routes known to the product. Only `browser` exists in M0. */
export const DELIVERY_ROUTE_IDS = ['browser'] as const;
export const DeliveryRouteIdSchema = z.enum(DELIVERY_ROUTE_IDS);
export type DeliveryRouteId = z.infer<typeof DeliveryRouteIdSchema>;

export const SiteDtoSchema = z
  .object({
    id: SiteIdSchema,
    name: z.string(),
    /** IANA time zone name, for example Australia/Melbourne. */
    timezone: z.string(),
  })
  .strict();
export type SiteDto = z.infer<typeof SiteDtoSchema>;

export const SiteListResponseSchema = z.object({ items: z.array(SiteDtoSchema) }).strict();
export type SiteListResponse = z.infer<typeof SiteListResponseSchema>;

export const DisplayDtoSchema = z
  .object({
    id: DisplayIdSchema,
    siteId: SiteIdSchema,
    name: z.string(),
    description: DescriptionSchema.nullable(),
    canvas: CanvasSchema,
    contentRect: RectSchema.nullable(),
    defaultFit: FitModeSchema,
    route: DeliveryRouteIdSchema,
    /** Present when a player registration is currently active for this display. */
    player: z
      .object({
        registrationId: RegistrationIdSchema,
        registeredAt: UtcTimestampSchema,
      })
      .strict()
      .nullable(),
    tagIds: TagIdsSchema,
    /**
     * The playlist assigned to the display, or null. Assigning changes nothing on
     * the display; a push builds the publication (see `push.ts`).
     */
    assignedPlaylist: PlaylistRefSchema.nullable(),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type DisplayDto = z.infer<typeof DisplayDtoSchema>;

export const DisplayListResponseSchema = z.object({ items: z.array(DisplayDtoSchema) }).strict();
export type DisplayListResponse = z.infer<typeof DisplayListResponseSchema>;

export const DisplayCreateSchema = z
  .object({
    siteId: SiteIdSchema,
    name: NameSchema,
    canvas: CanvasSchema,
    contentRect: RectSchema.nullable().default(null),
    defaultFit: FitModeSchema.default('contain'),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.contentRect === null) return;
    const problem = contentRectProblem(d.canvas, d.contentRect);
    if (problem !== null) ctx.addIssue({ code: 'custom', path: ['contentRect'], message: problem });
  });
export type DisplayCreate = z.infer<typeof DisplayCreateSchema>;
export type DisplayCreateInput = z.input<typeof DisplayCreateSchema>;

/**
 * `PATCH /api/displays/:id`: partial update, at least one field.
 * - When `canvas` or `contentRect` changes, the API must re-check the combined
 *   result with `CanvasSpecSchema` before saving.
 * - `tagIds`: the complete new set of display tags. An unknown tag, or a tag of
 *   the media scope, answers 404.
 * - `assignedPlaylistId`: null removes the assignment. An unknown or deleted
 *   playlist answers 404. Nothing reaches the display until a push.
 */
export const DisplayPatchSchema = z
  .object({
    name: NameSchema.optional(),
    description: DescriptionInputSchema.optional(),
    canvas: CanvasSchema.optional(),
    contentRect: RectSchema.nullable().optional(),
    defaultFit: FitModeSchema.optional(),
    tagIds: TagIdsInputSchema.optional(),
    assignedPlaylistId: PlaylistIdSchema.nullable().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'at least one field is required' });
export type DisplayPatch = z.infer<typeof DisplayPatchSchema>;

export const RevokePlayerResponseSchema = z
  .object({
    /** Null when the display had no active registration (the call is idempotent). */
    revokedRegistrationId: RegistrationIdSchema.nullable(),
  })
  .strict();
export type RevokePlayerResponse = z.infer<typeof RevokePlayerResponseSchema>;
