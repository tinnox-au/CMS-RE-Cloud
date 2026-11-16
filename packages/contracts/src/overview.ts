import { z } from 'zod';
import type { DeliverySummary } from './status.ts';

const count = z.number().int().nonnegative();

/** One counter per delivery summary; the compiler keeps this in step with `DELIVERY_SUMMARIES`. */
const bySummaryShape = {
  unpaired: count,
  nothing_published: count,
  awaiting_player: count,
  stale: count,
  updating: count,
  error: count,
  standing_by: count,
  in_sync: count,
} satisfies Record<DeliverySummary, typeof count>;

/**
 * `GET /api/overview`: the numbers on the dashboard.
 * - `displays.bySummary` counts displays by the `summary` of their status view,
 *   which reports what the player software last said and nothing more.
 * - `media` counts items that are not deleted; `usedBytes` and `limitBytes` are
 *   the same storage figures as in `GET /api/media`.
 * - `playlists.total` does not count deleted playlists.
 * - `pendingPushCount` equals `pendingCount` of `GET /api/push`.
 */
export const OverviewResponseSchema = z
  .object({
    displays: z
      .object({
        total: count,
        /** Displays with an active player registration. */
        paired: count,
        bySummary: z.object(bySummaryShape).strict(),
      })
      .strict(),
    media: z
      .object({
        total: count,
        ready: count,
        processing: count,
        failed: count,
        usedBytes: count,
        limitBytes: z.number().int().positive(),
      })
      .strict(),
    playlists: z.object({ total: count }).strict(),
    pendingPushCount: count,
  })
  .strict();
export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;
