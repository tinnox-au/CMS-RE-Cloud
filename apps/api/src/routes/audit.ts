import {
  AuditActorTypeSchema,
  AuditListQuerySchema,
  AuditResultSchema,
  ROUTES,
  type AuditListResponse,
} from '@tinnox/contracts';
import { withOrg } from '@tinnox/db';
import { ACTIVITY_CATEGORIES, can } from '@tinnox/domain';
import type { FastifyInstance } from 'fastify';
import { forbidden, parseRole } from '../auth/permissions.ts';
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

/**
 * Organisation-scoped audit trail, newest first, optionally narrowed to one
 * category (the part of the action before the first dot) and one result.
 * Events without an organisation are not exposed here. Without `audit.read` (Editors and
 * Viewers) only the activity categories are returned (stage-c.md 1.5): content and screen
 * events, never sign-ins, security refusals, invites or membership changes.
 */
export function registerAuditRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(ROUTES.audit, async (request): Promise<AuditListResponse> => {
    const session = operatorOf(request);
    const query = parseInput(AuditListQuerySchema, request.query, 'query');
    // The guard has already refused an unknown role.
    const role = parseRole(session.role);
    if (role === null) throw forbidden();
    const fullLog = can(role, 'audit.read');
    // shortcut: the activity filter is per category; split by action if pairing.lock must leave
    // the Editors' view.
    const activity: readonly string[] = ACTIVITY_CATEGORIES;
    if (!fullLog && query.category !== undefined && !activity.includes(query.category)) {
      return { items: [], nextBefore: null };
    }
    // A filter is part of the statement only when it was asked for, so the planner
    // sees a plain equality on a column and can use the index made for it. The
    // category is a column the database computes from the action (migration 0005):
    // under row-level security a condition that calls split_part() could not be
    // used as an index condition. Only fixed text and parameter numbers are put
    // into the statement; every value from the request is a parameter.
    const values: unknown[] = [query.limit + 1];
    const conditions: string[] = [];
    const parameter = (value: unknown): string => `$${values.push(value)}`;
    if (query.before !== undefined) conditions.push(`id < ${parameter(query.before)}::bigint`);
    if (query.category !== undefined) {
      conditions.push(`category = ${parameter(query.category)}`);
    } else if (!fullLog) {
      // A plain column comparison, leakproof under row-level security (0005).
      conditions.push(`category = ANY(${parameter([...ACTIVITY_CATEGORIES])}::text[])`);
    }
    if (query.result !== undefined) conditions.push(`result = ${parameter(query.result)}`);
    const where = ['org_id = app_org_id()', ...conditions].join(' AND ');
    return withOrg(ctx.pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<AuditRow>(
        `SELECT id, occurred_at, actor_type, actor_id, action, object_type, object_id, result, detail
         FROM audit_event
         WHERE ${where}
         ORDER BY id DESC
         LIMIT $1`,
        values,
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
