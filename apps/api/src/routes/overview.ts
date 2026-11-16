/**
 * The numbers on the dashboard (portal v2, stage A). Every figure is counted
 * from stored facts at the time of the request; nothing is cached or estimated.
 * A display's summary reports what its player software last said and nothing
 * more (decision P2-04).
 */
import {
  DELIVERY_SUMMARIES,
  ROUTES,
  type DeliverySummary,
  type OverviewResponse,
} from '@tinnox/contracts';
import { withOrg } from '@tinnox/db';
import type { FastifyInstance } from 'fastify';
import { operatorOf } from '../auth/session.ts';
import type { AppContext } from '../context.ts';
import { bigintToNumber } from '../db-helpers.ts';
import { loadStatusViews } from './displays.ts';
import { usedBytes } from './media.ts';
import { loadPushPlan, pendingCount } from './push.ts';

export function registerOverviewRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { pool, config } = ctx;

  app.get(ROUTES.overview, async (request): Promise<OverviewResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => {
      // The same builder as the status routes, so the counters and the list agree.
      const statuses = await loadStatusViews(tx, ctx, null);
      const bySummary = Object.fromEntries(
        DELIVERY_SUMMARIES.map((summary) => [summary, 0]),
      ) as Record<DeliverySummary, number>;
      for (const status of statuses) bySummary[status.summary] += 1;

      const media = await tx.query<{
        total: string;
        ready: string;
        processing: string;
        failed: string;
      }>(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE status = 'ready') AS ready,
                count(*) FILTER (WHERE status = 'processing') AS processing,
                count(*) FILTER (WHERE status = 'failed') AS failed
         FROM media WHERE org_id = app_org_id() AND deleted_at IS NULL`,
      );
      const playlists = await tx.query<{ total: string }>(
        'SELECT count(*) AS total FROM playlist WHERE org_id = app_org_id() AND deleted_at IS NULL',
      );
      const counts = media.rows[0];

      return {
        displays: {
          total: statuses.length,
          paired: statuses.filter((status) => status.paired).length,
          bySummary,
        },
        media: {
          total: bigintToNumber(counts?.total ?? 0),
          ready: bigintToNumber(counts?.ready ?? 0),
          processing: bigintToNumber(counts?.processing ?? 0),
          failed: bigintToNumber(counts?.failed ?? 0),
          usedBytes: await usedBytes(tx),
          limitBytes: config.limits.maxOrgStorageBytes,
        },
        playlists: { total: bigintToNumber(playlists.rows[0]?.total ?? 0) },
        pendingPushCount: pendingCount(await loadPushPlan(tx, ctx)),
      };
    });
  });
}
