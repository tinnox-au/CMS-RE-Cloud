import { z } from 'zod';
import {
  CanvasSchema,
  contentRectProblem,
  FitModeSchema,
  RectSchema,
  RotationSchema,
} from './canvas.ts';
import {
  DisplayIdSchema,
  LocalTimeSchema,
  PlaylistIdSchema,
  RegistrationIdSchema,
  ScheduleIdSchema,
  SiteIdSchema,
  UtcTimestampSchema,
} from './ids.ts';
import { ABSOLUTE } from './limits.ts';
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

/** Opening hours of one day, in the site's zone. '24:00' is the only way to say midnight at the end. */
export const DayHoursSchema = z
  .object({ start: LocalTimeSchema, end: LocalTimeSchema })
  .strict()
  .refine((d) => d.start < d.end, { path: ['end'], message: 'end must be after start' });
export type DayHours = z.infer<typeof DayHoursSchema>;

/** Seven days, index 0 is Monday; null means closed all day. Null for the whole value means always on. */
export const WorkingHoursSchema = z
  .array(DayHoursSchema.nullable())
  .length(7)
  .refine((days) => days.some((d) => d !== null), { message: 'at least one day must be open' });
export type WorkingHours = z.infer<typeof WorkingHoursSchema>;

/**
 * The schedule assigned to a display. The default playlist is carried so the screen page can
 * preview it without a second round trip.
 */
export const AssignedScheduleSchema = z
  .object({
    id: ScheduleIdSchema,
    name: z.string().min(1).max(ABSOLUTE.maxNameLength),
    defaultPlaylist: PlaylistRefSchema,
  })
  .strict();
export type AssignedSchedule = z.infer<typeof AssignedScheduleSchema>;

export const DisplayDtoSchema = z
  .object({
    id: DisplayIdSchema,
    siteId: SiteIdSchema,
    name: z.string(),
    description: DescriptionSchema.nullable(),
    canvas: CanvasSchema,
    contentRect: RectSchema.nullable(),
    defaultFit: FitModeSchema,
    rotation: RotationSchema,
    /** Null means always on. */
    workingHours: WorkingHoursSchema.nullable(),
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
    /**
     * The schedule assigned to the display, or null. A display has a playlist or a schedule
     * assigned, never both: at most one of `assignedPlaylist` and `assignedSchedule` is set.
     */
    assignedSchedule: AssignedScheduleSchema.nullable(),
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
 * - `assignedScheduleId`: an unknown schedule answers 404. A display has a playlist
 *   or a schedule, never both: a non-null id on one side clears the other side, null
 *   clears its own side only, and `{ assignedPlaylistId: null, assignedScheduleId: null }`
 *   removes all content. Both ids non-null is refused.
 * - `workingHours`: null clears them (always on).
 */
export const DisplayPatchSchema = z
  .object({
    name: NameSchema.optional(),
    description: DescriptionInputSchema.optional(),
    canvas: CanvasSchema.optional(),
    contentRect: RectSchema.nullable().optional(),
    defaultFit: FitModeSchema.optional(),
    rotation: RotationSchema.optional(),
    workingHours: WorkingHoursSchema.nullable().optional(),
    tagIds: TagIdsInputSchema.optional(),
    assignedPlaylistId: PlaylistIdSchema.nullable().optional(),
    assignedScheduleId: ScheduleIdSchema.nullable().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'at least one field is required' })
  // Each id is a string, null or absent: only two strings name both.
  .refine(
    (p) => typeof p.assignedPlaylistId !== 'string' || typeof p.assignedScheduleId !== 'string',
    {
      path: ['assignedScheduleId'],
      message: 'assign a playlist or a schedule, not both',
    },
  );
export type DisplayPatch = z.infer<typeof DisplayPatchSchema>;

export const RevokePlayerResponseSchema = z
  .object({
    /** Null when the display had no active registration (the call is idempotent). */
    revokedRegistrationId: RegistrationIdSchema.nullable(),
  })
  .strict();
export type RevokePlayerResponse = z.infer<typeof RevokePlayerResponseSchema>;
