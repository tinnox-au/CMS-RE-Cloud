import { z } from 'zod';
import { AppIdSchema, LocalDateTimeSchema, UtcTimestampSchema } from './ids.ts';
import { ABSOLUTE } from './limits.ts';
import { appTextSchema, DescriptionInputSchema, DescriptionSchema, NameSchema } from './text.ts';

/** Built-in apps. The type of an app is fixed for life. Twin of `app_type_known` (migration 0007). */
export const APP_TYPES = ['clock', 'date', 'countdown', 'ticker', 'qr', 'text'] as const;
export const AppTypeSchema = z.enum(APP_TYPES);
export type AppType = z.infer<typeof AppTypeSchema>;

/** Longest operator text per app field, in characters. */
export const APP_TEXT_LIMITS = {
  countdownLabel: 60,
  finishedText: 60,
  tickerText: 300,
  qrContent: 300,
  qrCaption: 80,
  heading: 60,
  body: 280,
} as const;

/** Lower case only: `<input type="color">` always gives lower case. */
export const ColourSchema = z.string().regex(/^#[0-9a-f]{6}$/, 'expected a colour like #ffffff');
export type Colour = z.infer<typeof ColourSchema>;

const style = { textColour: ColourSchema, backgroundColour: ColourSchema };

/*
 * Invariant: settings objects are flat (string and boolean values only). The push comparison
 * (domain push.ts `sameContent`) compares them key by key with `===` and relies on it.
 */

export const ClockSettingsSchema = z
  .object({ hourCycle: z.enum(['12', '24']), showSeconds: z.boolean(), ...style })
  .strict();
export type ClockSettings = z.infer<typeof ClockSettingsSchema>;

export const DATE_FORMATS = ['long', 'short', 'numeric'] as const;
export const DateSettingsSchema = z.object({ format: z.enum(DATE_FORMATS), ...style }).strict();
export type DateSettings = z.infer<typeof DateSettingsSchema>;

/** `target` is wall-clock time in the zone of each screen's site. */
export const CountdownSettingsSchema = z
  .object({
    target: LocalDateTimeSchema,
    label: appTextSchema(APP_TEXT_LIMITS.countdownLabel, 'label'),
    finishedText: appTextSchema(APP_TEXT_LIMITS.finishedText, 'finished text', {
      required: true,
    }),
    showSeconds: z.boolean(),
    ...style,
  })
  .strict();
export type CountdownSettings = z.infer<typeof CountdownSettingsSchema>;

export const TICKER_SPEEDS = ['slow', 'medium', 'fast'] as const;
export const TickerSettingsSchema = z
  .object({
    text: appTextSchema(APP_TEXT_LIMITS.tickerText, 'text', { required: true }),
    speed: z.enum(TICKER_SPEEDS),
    ...style,
  })
  .strict();
export type TickerSettings = z.infer<typeof TickerSettingsSchema>;

export const QrSettingsSchema = z
  .object({
    content: appTextSchema(APP_TEXT_LIMITS.qrContent, 'content', { required: true }),
    caption: appTextSchema(APP_TEXT_LIMITS.qrCaption, 'caption'),
    ...style,
  })
  .strict();
export type QrSettings = z.infer<typeof QrSettingsSchema>;

export const TextSettingsSchema = z
  .object({
    heading: appTextSchema(APP_TEXT_LIMITS.heading, 'heading'),
    body: appTextSchema(APP_TEXT_LIMITS.body, 'message', { multiLine: true }),
    ...style,
  })
  .strict()
  .refine((s) => s.heading !== '' || s.body !== '', {
    path: ['heading'],
    message: 'enter a heading or a message',
  });
export type TextSettings = z.infer<typeof TextSettingsSchema>;

/** What an app shows. Every field is required; there are no defaults. */
export const AppContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('clock'), settings: ClockSettingsSchema }).strict(),
  z.object({ type: z.literal('date'), settings: DateSettingsSchema }).strict(),
  z.object({ type: z.literal('countdown'), settings: CountdownSettingsSchema }).strict(),
  z.object({ type: z.literal('ticker'), settings: TickerSettingsSchema }).strict(),
  z.object({ type: z.literal('qr'), settings: QrSettingsSchema }).strict(),
  z.object({ type: z.literal('text'), settings: TextSettingsSchema }).strict(),
]);
export type AppContent = z.infer<typeof AppContentSchema>;

export const AppDtoSchema = z
  .object({
    id: AppIdSchema,
    name: z.string(),
    description: DescriptionSchema.nullable(),
    content: AppContentSchema,
    /** Live playlists that contain the app. */
    usageCount: z.number().int().nonnegative(),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type AppDto = z.infer<typeof AppDtoSchema>;

/** `GET /api/apps`. */
export const AppListResponseSchema = z
  .object({ items: z.array(AppDtoSchema).max(ABSOLUTE.maxListItems) })
  .strict();
export type AppListResponse = z.infer<typeof AppListResponseSchema>;

/** `POST /api/apps` answers 201 with the `AppDto`. */
export const AppCreateSchema = z
  .object({
    name: NameSchema,
    description: DescriptionInputSchema.optional(),
    content: AppContentSchema,
  })
  .strict();
export type AppCreate = z.infer<typeof AppCreateSchema>;

/**
 * `PATCH /api/apps/:id`: at least one field. `content.type` must match the stored type.
 * `DELETE /api/apps/:id` answers 409 `app_in_use` while a live playlist contains the app.
 */
export const AppPatchSchema = z
  .object({
    name: NameSchema.optional(),
    description: DescriptionInputSchema.optional(),
    content: AppContentSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'send at least one field' });
export type AppPatch = z.infer<typeof AppPatchSchema>;
