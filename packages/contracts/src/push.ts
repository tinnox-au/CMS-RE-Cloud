import { z } from 'zod';
import { DisplayIdSchema, PublicationIdSchema, UtcTimestampSchema } from './ids.ts';
import { ABSOLUTE } from './limits.ts';
import { PublishRejectionCodeSchema } from './playlist.ts';
import { DisplayRefSchema, LayoutRefSchema, PlaylistRefSchema, ScheduleRefSchema } from './refs.ts';

/**
 * Where a display stands between what is assigned to it and what it was last given
 * (portal v2 decision P2-05: assign, then push).
 * - nothing_assigned: no playlist, schedule or layout is assigned; there is nothing to push
 * - blocked: the assigned content cannot be published to this display; `issues` say why
 * - never_pushed: content is assigned and publishable, and the display has no publication yet
 * - changes: the publication that would be built now differs from the display's current one
 * - up_to_date: the publication that would be built now equals the display's current one
 */
export const PUSH_STATES = [
  'nothing_assigned',
  'never_pushed',
  'changes',
  'up_to_date',
  'blocked',
] as const;
export const PushStateSchema = z.enum(PUSH_STATES);
export type PushState = z.infer<typeof PushStateSchema>;

/** The states a push would act on. Displays in these states make up the pending count. */
export const PUSH_PENDING_STATES = [
  'never_pushed',
  'changes',
] as const satisfies readonly PushState[];

export function isPushPending(state: PushState): boolean {
  return (PUSH_PENDING_STATES as readonly PushState[]).includes(state);
}

/** Same ceiling as `error.details` in the error envelope. */
const MAX_ISSUES = 100;

/**
 * One reason the assigned content cannot be published to a display. The same shape as an
 * entry of `error.details` in a `publication_rejected` answer; `code` is the rejection code.
 * `path` is `playlist` or `items[n]` for a playlist, and `default.playlist`,
 * `default.items[n]`, `events[n].playlist`, `events[n].items[n]` or `schedule` for a schedule
 * (the event is the first one that uses the playlist; item numbers count inside that playlist;
 * `schedule` is a problem of all its playlists together). For a layout it is
 * `zones[n].playlist`, `zones[n].items[k]`, `zones[n]` (the zone is too small on this screen)
 * or `layout` (n is the zone, from 0; item numbers count inside that zone's playlist; `layout`
 * is a problem of all its playlists together).
 */
export const PushIssueSchema = z
  .object({
    path: z.string().max(200),
    /** Complete sentence for the operator. */
    message: z.string().max(500),
    code: PublishRejectionCodeSchema,
  })
  .strict();
export type PushIssue = z.infer<typeof PushIssueSchema>;

export const PushPlanRowSchema = z
  .object({
    display: DisplayRefSchema,
    /**
     * The assigned playlist, or for a display with a schedule the schedule's default
     * playlist, or for a display with a layout the main zone's playlist; null exactly when
     * `state` is `nothing_assigned`.
     */
    playlist: PlaylistRefSchema.nullable(),
    /** The assigned schedule; null for a display with a playlist, a layout or nothing assigned. */
    schedule: ScheduleRefSchema.nullable(),
    /** The assigned layout; null otherwise. */
    layout: LayoutRefSchema.nullable(),
    state: PushStateSchema,
    /** Empty unless `state` is `blocked`. */
    issues: z.array(PushIssueSchema).max(MAX_ISSUES),
    /** When the display's current publication was created; null when it has none. */
    lastPushedAt: UtcTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((row, ctx) => {
    if ((row.playlist === null) !== (row.state === 'nothing_assigned')) {
      ctx.addIssue({
        code: 'custom',
        path: ['playlist'],
        message: 'playlist must be null exactly when state is nothing_assigned',
      });
    }
    if (row.schedule !== null && row.playlist === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['schedule'],
        message: 'a row with a schedule carries the default playlist of the schedule',
      });
    }
    if (row.layout !== null && row.playlist === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['layout'],
        message: 'a row with a layout carries the playlist of its main zone',
      });
    }
    if (row.layout !== null && row.schedule !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['layout'],
        message: 'a row has a schedule or a layout, not both',
      });
    }
    if (row.issues.length > 0 !== (row.state === 'blocked')) {
      ctx.addIssue({
        code: 'custom',
        path: ['issues'],
        message: 'issues must be listed exactly when state is blocked',
      });
    }
    if (row.state === 'never_pushed' && row.lastPushedAt !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['lastPushedAt'],
        message: 'a display that was never pushed has no lastPushedAt',
      });
    }
    if ((row.state === 'changes' || row.state === 'up_to_date') && row.lastPushedAt === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['lastPushedAt'],
        message: 'a display with a publication has a lastPushedAt',
      });
    }
  });
export type PushPlanRow = z.infer<typeof PushPlanRowSchema>;

/**
 * `GET /api/push`: the push plan. One row per display of the organisation, in
 * the order of `GET /api/displays`. `pendingCount` is the number of rows whose
 * state is in `PUSH_PENDING_STATES`.
 */
export const PushPlanResponseSchema = z
  .object({
    items: z.array(PushPlanRowSchema).max(ABSOLUTE.maxListItems),
    pendingCount: z.number().int().nonnegative().max(ABSOLUTE.maxListItems),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const pending = plan.items.filter((row) => isPushPending(row.state)).length;
    if (plan.pendingCount !== pending) {
      ctx.addIssue({
        code: 'custom',
        path: ['pendingCount'],
        message: `pendingCount must equal the number of pending rows (${pending})`,
      });
    }
  });
export type PushPlanResponse = z.infer<typeof PushPlanResponseSchema>;

/**
 * `POST /api/push`; requires the `Idempotency-Key` header (`IdempotencyKeySchema`).
 * Every id must be a display of the caller's organisation; otherwise the API
 * answers 404 and pushes nothing.
 */
export const PushRequestSchema = z
  .object({
    displayIds: z
      .array(DisplayIdSchema)
      .min(1)
      .max(ABSOLUTE.maxPushDisplays)
      .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
        message: 'a display may be listed only once',
      }),
  })
  .strict();
export type PushRequest = z.infer<typeof PushRequestSchema>;

/**
 * What a push did for one display.
 * - published: a publication exists for this display under this Idempotency-Key,
 *   created by this call or by an earlier call with the same key
 * - unchanged: the display's current publication already equals what would be built
 * - rejected: the assigned content cannot be published; the previous publication stays current
 * - skipped: nothing is assigned
 */
export const PUSH_OUTCOMES = ['published', 'unchanged', 'rejected', 'skipped'] as const;
export const PushOutcomeSchema = z.enum(PUSH_OUTCOMES);
export type PushOutcome = z.infer<typeof PushOutcomeSchema>;

export const PushResultSchema = z
  .object({
    displayId: DisplayIdSchema,
    outcome: PushOutcomeSchema,
    /**
     * `published`: the publication made for this display under this key.
     * `unchanged`: the display's current publication. Otherwise null.
     */
    publicationId: PublicationIdSchema.nullable(),
    /** Empty unless `outcome` is `rejected`. */
    issues: z.array(PushIssueSchema).max(MAX_ISSUES),
  })
  .strict()
  .superRefine((result, ctx) => {
    const hasPublication = result.outcome === 'published' || result.outcome === 'unchanged';
    if ((result.publicationId !== null) !== hasPublication) {
      ctx.addIssue({
        code: 'custom',
        path: ['publicationId'],
        message: 'publicationId must be set exactly when outcome is published or unchanged',
      });
    }
    if (result.issues.length > 0 !== (result.outcome === 'rejected')) {
      ctx.addIssue({
        code: 'custom',
        path: ['issues'],
        message: 'issues must be listed exactly when outcome is rejected',
      });
    }
  });
export type PushResult = z.infer<typeof PushResultSchema>;

/**
 * Answer of `POST /api/push` (200): one result per requested display, in request
 * order. Each display is pushed in its own transaction, so one rejection does
 * not undo the others.
 *
 * A repeat with the same Idempotency-Key is answered per display: a display that got a
 * publication under the key is answered `published` with that same publication, and no
 * second one is made. A display that stored nothing under the key the first time
 * (`unchanged`, `skipped` or `rejected`, or not reached before a failure) is decided again
 * as it stands now, so it may be published by the repeat, for example once a blocked
 * playlist has been fixed. Repeat a key only for the same intent while its outcome is
 * unknown (stage-a.md, 7.2).
 */
export const PushResponseSchema = z
  .object({ results: z.array(PushResultSchema).min(1).max(ABSOLUTE.maxPushDisplays) })
  .strict();
export type PushResponse = z.infer<typeof PushResponseSchema>;
