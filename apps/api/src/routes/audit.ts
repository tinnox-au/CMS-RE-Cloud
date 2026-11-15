import {
  AuditActorTypeSchema,
  AuditListQuerySchema,
  AuditResultSchema,
  ROUTES,
  type AuditListResponse,
} from '@tinnox/contracts';
import { withOrg } from '@tinnox/db';
import type { FastifyInstance } from 'fastify';
import { operatorOf } from '../auth/session.ts';
import type { AppContext } from '../context.ts';
import { iso } from '../db-helpers.ts';
import { parseInput } from '../errors.ts';

interface AuditRow {
  id: string;
  occurred_at: Date;
  actor_type: string;
  actor_id: string | null;
  action: string;
  object_type: string | null;
  object_id: string | null;
  result: string;
  detail: unknown;
}

/** Organisation-scoped audit trail, newest first. Events without an organisation are not exposed here. */
export function registerAuditRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(ROUTES.audit, async (request): Promise<AuditListResponse> => {
    const session = operatorOf(request);
    const query = parseInput(AuditListQuerySchema, request.query, 'query');
    return withOrg(ctx.pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<AuditRow>(
        `SELECT id, occurred_at, actor_type, actor_id, action, object_type, object_id, result, detail
         FROM audit_event
         WHERE org_id = app_org_id() AND ($2::bigint IS NULL OR id < $2::bigint)
         ORDER BY id DESC
         LIMIT $1`,
        [query.limit + 1, query.before ?? null],
      );
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({
          id: r.id,
          occurredAt: iso(r.occurred_at),
          actorType: AuditActorTypeSchema.parse(r.actor_type),
          actorId: r.actor_id,
          action: r.action,
          objectType: r.object_type,
          objectId: r.object_id,
          result: AuditResultSchema.parse(r.result),
          detail:
            typeof r.detail === 'object' && r.detail !== null && !Array.isArray(r.detail)
              ? (r.detail as Record<string, unknown>)
              : null,
        })),
        nextBefore: rows.length > query.limit && last !== undefined ? last.id : null,
      };
    });
  });
}
