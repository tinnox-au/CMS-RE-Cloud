import { z } from 'zod';
import {
  DisplayIdSchema,
  PublicationIdSchema,
  RegistrationIdSchema,
  UtcTimestampSchema,
} from './ids.ts';
import { ABSOLUTE } from './limits.ts';
import { PlayerErrorSchema, PlayerStateSchema, StagingPhaseSchema } from './player.ts';

/**
 * Single headline for the portal. Derived only from stored facts:
 * - unpaired: no active player registration
 * - nothing_published: no desired publication
 * - awaiting_player: paired, but no report received since registration
 * - stale: the last report is older than the staleness threshold
 * - updating: the player reports a different (or no) active publication than desired
 * - error: the player reports an error state
 * - standing_by: the player holds the desired publication and reports nothing is due to show now
 * - in_sync: the player recently reported that it is playing the desired publication
 */
export const DELIVERY_SUMMARIES = [
  'unpaired',
  'nothing_published',
  'awaiting_player',
  'stale',
  'updating',
  'error',
  'standing_by',
  'in_sync',
] as const;
export const DeliverySummarySchema = z.enum(DELIVERY_SUMMARIES);
export type DeliverySummary = z.infer<typeof DeliverySummarySchema>;

/** `GET /api/displays/:id/status` */
export const DeliveryStatusViewSchema = z
  .object({
    displayId: DisplayIdSchema,
    paired: z.boolean(),
    registrationId: RegistrationIdSchema.nullable(),
    /** What the operator published. */
    desired: z
      .object({ publicationId: PublicationIdSchema, publishedAt: UtcTimestampSchema })
      .strict()
      .nullable(),
    /** Last publication the player reported as fully downloaded and verified. */
    downloaded: z.object({ publicationId: PublicationIdSchema }).strict().nullable(),
    /** What the player software last reported it is rendering. */
    active: z
      .object({ publicationId: PublicationIdSchema, itemIndex: z.number().int().nonnegative() })
      .strict()
      .nullable(),
    playerState: PlayerStateSchema.nullable(),
    staging: z
      .object({
        publicationId: PublicationIdSchema,
        phase: StagingPhaseSchema,
        assetsDone: z.number().int().nonnegative(),
        assetsTotal: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    /** Server receive time of the last accepted report. */
    lastHeartbeatAt: UtcTimestampSchema.nullable(),
    /** True when there is no report, or the last one is older than `staleAfterSeconds`. */
    stale: z.boolean(),
    staleAfterSeconds: z.number().int().positive(),
    errors: z.array(PlayerErrorSchema),
    summary: DeliverySummarySchema,
    /** Server time the view was computed. */
    asOf: UtcTimestampSchema,
  })
  .strict();
export type DeliveryStatusView = z.infer<typeof DeliveryStatusViewSchema>;

/**
 * `GET /api/displays/status`: the status view of every display of the
 * organisation in one call, built exactly like the single-display route.
 * One item per display, in the order of `GET /api/displays`.
 */
export const DeliveryStatusListResponseSchema = z
  .object({ items: z.array(DeliveryStatusViewSchema).max(ABSOLUTE.maxListItems) })
  .strict();
export type DeliveryStatusListResponse = z.infer<typeof DeliveryStatusListResponseSchema>;
