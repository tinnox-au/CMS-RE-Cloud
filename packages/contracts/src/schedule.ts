import { z } from 'zod';
import { LocalTimeSchema, PlaylistIdSchema, ScheduleIdSchema, UtcTimestampSchema } from './ids.ts';
import { ABSOLUTE } from './limits.ts';
import { PlaylistRefSchema } from './refs.ts';
import { DescriptionInputSchema, DescriptionSchema, NameSchema } from './text.ts';

// Imports only ids, limits, refs and text, so manifest.ts and display.ts can import this file
// without a cycle.

/**
 * The days of the week on which an event starts: seven entries, index 0 is Monday (as in
 * `WorkingHoursSchema`), at least one true.
 */
export const ScheduleDaysSchema = z
  .array(z.boolean())
  .length(7)
  .refine((d) => d.some(Boolean), { message: 'choose at least one day' });

/**
 * The fields of a weekly rule, as a plain shape: zod refuses `.extend()` on a refined object,
 * so every schema that carries a rule spreads this and adds `checkScheduleRule`.
 */
export const scheduleRuleShape = {
  days: ScheduleDaysSchema,
  start: LocalTimeSchema.refine((v) => v !== '24:00', 'start must be before 24:00'),
  /** '24:00' is the only way to say midnight at the end, so every rule has one stored form. */
  end: LocalTimeSchema.refine((v) => v !== '00:00', 'use 24:00 for midnight at the end'),
};

/** The cross-field check of a weekly rule: an event that starts and ends at the same time is empty. */
export function checkScheduleRule(
  rule: { start: string; end: string },
  ctx: z.RefinementCtx,
): void {
  if (rule.start === rule.end) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'end must differ from start' });
  }
}

/**
 * When a weekly event applies, wall clock HH:mm in each screen's site zone.
 * - `end > start`: a window on one day, `[start, end)`.
 * - `end < start`: the event runs past midnight into the next day.
 * - `00:00` to `24:00`: the whole day.
 * A day in `days` is the day on which the event starts. Twin of the schedule_event CHECKs (0009).
 */
export const ScheduleRuleSchema = z
  .object(scheduleRuleShape)
  .strict()
  .superRefine(checkScheduleRule);
export type ScheduleRule = z.infer<typeof ScheduleRuleSchema>;

/**
 * True when the rule covers the moment `time` (HH:mm, 00:00 to 23:59) on `day` (0 is Monday).
 * The one evaluator: the player and the tests use it. String compares, as working hours do;
 * '24:00' is greater than every `time`.
 */
export function eventCovers(
  rule: Pick<ScheduleRule, 'days' | 'start' | 'end'>,
  day: number,
  time: string,
): boolean {
  if (rule.end > rule.start) {
    return rule.days[day] === true && rule.start <= time && time < rule.end;
  }
  // Past midnight: the evening of a start day, or the morning after one.
  return (
    (rule.days[day] === true && time >= rule.start) ||
    (rule.days[(day + 6) % 7] === true && time < rule.end)
  );
}

/** One weekly event of a schedule in a request body. */
export const ScheduleEventInputSchema = z
  .object({ playlistId: PlaylistIdSchema, ...scheduleRuleShape })
  .strict()
  .superRefine(checkScheduleRule);
export type ScheduleEventInput = z.infer<typeof ScheduleEventInputSchema>;

/**
 * `POST /api/schedules` and `PUT /api/schedules/:id`: the whole schedule. `events` are in
 * priority order: the first one that covers a moment and has something to show wins, otherwise
 * the default playlist plays. Overlapping events are allowed.
 *
 * On PUT an absent `description` is left as it is; null or an empty string clears it (as the
 * playlist PUT). An unknown or deleted playlist answers 400.
 *
 * A refusal of this body names its fields with dots, as the API joins zod paths: `name`,
 * `description`, `defaultPlaylistId`, `events.3.playlistId`, `events.3.days`, `events.3.start`,
 * `events.3.end` (the event index counts from 0). The API's own playlist check and the portal's
 * mapping use the same strings. The bracket form (`events[n].playlist`) belongs to push issues
 * only (`PushIssueSchema`).
 */
export const ScheduleInputSchema = z
  .object({
    name: NameSchema,
    description: DescriptionInputSchema.optional(),
    /** Plays whenever no event applies. */
    defaultPlaylistId: PlaylistIdSchema,
    events: z.array(ScheduleEventInputSchema).max(ABSOLUTE.maxScheduleEvents),
  })
  .strict();
export type ScheduleInput = z.infer<typeof ScheduleInputSchema>;

export const ScheduleEventDtoSchema = z
  .object({ playlist: PlaylistRefSchema, ...scheduleRuleShape })
  .strict();
export type ScheduleEventDto = z.infer<typeof ScheduleEventDtoSchema>;

/** The fields a schedule and its list row share. */
const scheduleFactsShape = {
  id: ScheduleIdSchema,
  name: z.string(),
  description: DescriptionSchema.nullable(),
  defaultPlaylist: PlaylistRefSchema,
  /** How many displays have this schedule assigned. */
  assignedDisplayCount: z.number().int().nonnegative(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
};

export const ScheduleDtoSchema = z
  .object({
    ...scheduleFactsShape,
    /** In priority order. */
    events: z.array(ScheduleEventDtoSchema).max(ABSOLUTE.maxScheduleEvents),
  })
  .strict();
export type ScheduleDto = z.infer<typeof ScheduleDtoSchema>;

/** One row of `GET /api/schedules`. */
export const ScheduleSummaryDtoSchema = z
  .object({
    ...scheduleFactsShape,
    eventCount: z.number().int().nonnegative().max(ABSOLUTE.maxScheduleEvents),
  })
  .strict();
export type ScheduleSummaryDto = z.infer<typeof ScheduleSummaryDtoSchema>;

export const ScheduleListResponseSchema = z
  .object({ items: z.array(ScheduleSummaryDtoSchema).max(ABSOLUTE.maxListItems) })
  .strict();
export type ScheduleListResponse = z.infer<typeof ScheduleListResponseSchema>;
