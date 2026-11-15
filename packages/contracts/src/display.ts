import { z } from 'zod';
import { CanvasSchema, contentRectProblem, FitModeSchema, RectSchema } from './canvas.ts';
import { DisplayIdSchema, RegistrationIdSchema, SiteIdSchema, UtcTimestampSchema } from './ids.ts';
import { ABSOLUTE } from './limits.ts';

/** Delivery routes known to the product. Only `browser` exists in M0. */
export const DELIVERY_ROUTE_IDS = ['browser'] as const;
export const DeliveryRouteIdSchema = z.enum(DELIVERY_ROUTE_IDS);
export type DeliveryRouteId = z.infer<typeof DeliveryRouteIdSchema>;

export const NameSchema = z
  .string()
  .trim()
  .min(1, 'name is required')
  .max(ABSOLUTE.maxNameLength)
  // Reject control characters; names are rendered as text only.
  // eslint-disable-next-line no-control-regex -- matching control characters is the purpose of this pattern
  .regex(/^[^\u0000-\u001f\u007f]*$/, 'name must not contain control characters');

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
 * Partial update. When canvas or contentRect changes, the API must re-check the
 * combined result with `CanvasSpecSchema` before saving.
 */
export const DisplayPatchSchema = z
  .object({
    name: NameSchema.optional(),
    canvas: CanvasSchema.optional(),
    contentRect: RectSchema.nullable().optional(),
    defaultFit: FitModeSchema.optional(),
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
