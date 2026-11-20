/**
 * `security.permission_denied`: the audit row of a refusal by role (CMS-13,
 * docs/portal-v2/stage-c.md section 6.4).
 *
 * Nothing changed, so the row is written in its own transaction after the refusal, as
 * `security.csrf_rejected` is (auth/session.ts). Route refusals are throttled per member with
 * the B6 pattern (routes/player.ts): one row when a member starts being refused in a window and
 * one when the member reaches the limit. Refused member and invite changes are always written.
 */
import type { PermissionKey } from '@tinnox/contracts';
import { auditScoped, withOrg } from '@tinnox/db';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../context.ts';
import { AuthFailureGuard } from './failure-guard.ts';
import type { OperatorSession } from './session.ts';

/**
 * Why a request was refused:
 * - `role`: the role lacks the route's keys (the guard, or a check on a stored row);
 * - `role_changed`: the role was lowered between the guard and the write;
 * - `rank`, `self`, `grant`, `last_owner`, `not_signed_in`: the people routes' rules.
 */
export type DenialReason =
  'role' | 'role_changed' | 'rank' | 'self' | 'grant' | 'last_owner' | 'not_signed_in';

export interface DenialRecord {
  /** The requirement that failed. */
  readonly keys: readonly PermissionKey[];
  readonly reason: DenialReason;
  /** Refused member and invite changes are always written; route refusals are throttled per member. */
  readonly always: boolean;
  /** The member or invite a people route refused to change; the route otherwise. */
  readonly object?: { readonly type: 'membership' | 'invite'; readonly id: string };
}

/** Throttled rows per member and window: the first refusal and the one that reaches this count. */
export const PERMISSION_DENIALS_PER_WINDOW = 20;
export const PERMISSION_DENIAL_WINDOW_MS = 10 * 60 * 1000;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// shortcut: the permission-denied throttle is in memory and per process (like the other rate
// limits of M0), so each API process writes its own two rows per member and window; move it to
// a shared store when the API runs as more than one process.
const guards = new WeakMap<AppContext, AuthFailureGuard>();

function guardOf(ctx: AppContext): AuthFailureGuard {
  let guard = guards.get(ctx);
  if (guard === undefined) {
    guard = new AuthFailureGuard({
      maxFailures: Math.ceil(PERMISSION_DENIALS_PER_WINDOW * (ctx.rateLimitScale ?? 1)),
      windowMs: PERMISSION_DENIAL_WINDOW_MS,
      now: () => ctx.now().getTime(),
    });
    guards.set(ctx, guard);
  }
  return guard;
}

/**
 * Writes the `security.permission_denied` row of a refused state-changing request, in its own
 * transaction. Refused reads are not recorded. A failure is logged and swallowed: the refusal
 * stands whether or not it could be recorded.
 */
export async function recordPermissionDenied(
  ctx: AppContext,
  request: FastifyRequest,
  session: OperatorSession,
  record: DenialRecord,
): Promise<void> {
  if (SAFE_METHODS.has(request.method)) return;
  // A membership id is not an address, so clientKeyOf keeps it as it is.
  const counted = guardOf(ctx).recordFailure(session.membershipId, '');
  if (!record.always && !counted.first && !counted.crossedLimit) return;
  const route = request.routeOptions.url ?? 'unknown';
  try {
    await withOrg(ctx.pool, session.orgId, (tx) =>
      auditScoped(tx, {
        actorType: 'operator',
        actorId: session.membershipId,
        action: 'security.permission_denied',
        objectType: record.object?.type ?? 'route',
        objectId: record.object?.id ?? `${request.method} ${route}`.slice(0, 100),
        result: 'denied',
        detail: {
          permission: [...record.keys],
          method: request.method,
          route,
          reason: record.reason,
          ...(record.always
            ? {}
            : { refusalsInWindow: counted.count, throttled: counted.crossedLimit }),
        },
      }),
    );
  } catch (error) {
    request.log.error({ err: error }, 'failed to record permission refusal');
  }
}
