/**
 * Roles enforced (CMS-13, DEC-35; docs/portal-v2/stage-c.md sections 6.1 to 6.3).
 *
 * - Every operator route has an entry in ROUTE_PERMISSIONS (default deny). A start-up check
 *   compares the table with the registered routes and refuses to start on any difference.
 * - `permissionGuard` decides each request from the session's role before the handler runs:
 *   a refusal is the same 403 for every id (own, unknown, another organisation's), because it
 *   is decided before any lookup.
 * - Every write transaction re-reads the member row FOR SHARE as its first statement
 *   (`withOrgAllowed`), so no write commits under a role, or a session, that was taken away
 *   while the request was on its way.
 *
 * Who holds which key: ROLE_PERMISSIONS in packages/domain/src/permissions.ts.
 */
import {
  PERMISSION_KEYS,
  RoleSchema,
  ROUTES,
  type DisplayPatch,
  type PermissionKey,
  type Role,
  type TagScope,
} from '@tinnox/contracts';
import { lockOrgMembership, membershipForCheck, withOrg, type Tx } from '@tinnox/db';
import { permissionsOf } from '@tinnox/domain';
import type { FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import type { AppContext } from '../context.ts';
import type { Decision } from '../db-helpers.ts';
import { HttpError, pgErrorCode } from '../errors.ts';
import {
  recordPermissionDenied,
  type DenialReason,
  type DenialRecord,
} from './permission-audit.ts';
import { operatorOf, type OperatorSession } from './session.ts';

export type RefineName = 'displayPatchFields' | 'tagScopeFromBody' | 'tagScopeFromRow';
export type RouteRule =
  | { readonly all: readonly PermissionKey[] }
  | { readonly any: readonly PermissionKey[]; readonly refine: RefineName };
export type Requirement =
  { readonly all: readonly PermissionKey[] } | { readonly any: readonly PermissionKey[] };

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `permissionGuard`: what the route needs from this request's role. */
    permission: { readonly required: Requirement } | null;
  }
}

// ------------------------------------------------------------------ route-to-key table

const all = (...keys: PermissionKey[]): RouteRule => Object.freeze({ all: Object.freeze(keys) });
const any = (refine: RefineName, ...keys: PermissionKey[]): RouteRule =>
  Object.freeze({ any: Object.freeze(keys), refine });

/**
 * Every operator route and the keys it needs (section 6.1): 59 entries, 26 GET and 33 writes.
 * Keyed by `${METHOD} ${pattern}` with the contract constants, so a renamed path breaks the
 * build. HEAD is read as GET (`routeKey`).
 */
export const ROUTE_PERMISSIONS: Readonly<Record<string, RouteRule>> = Object.freeze({
  [`GET ${ROUTES.sites}`]: all('org.read'),
  [`GET ${ROUTES.displays}`]: all('org.read'),
  [`POST ${ROUTES.displays}`]: all('screen.setup'),
  [`GET ${ROUTES.displaysStatus}`]: all('org.read'),
  [`GET ${ROUTES.displayPattern}`]: all('org.read'),
  [`PATCH ${ROUTES.displayPattern}`]: any(
    'displayPatchFields',
    'screen.assign',
    'screen.details',
    'screen.hours',
    'screen.setup',
  ),
  [`POST ${ROUTES.displayClaimPattern}`]: all('screen.pair'),
  [`POST ${ROUTES.displayRevokePlayerPattern}`]: all('screen.pair'),
  [`GET ${ROUTES.displayStatusPattern}`]: all('org.read'),

  [`GET ${ROUTES.media}`]: all('org.read'),
  [`POST ${ROUTES.media}`]: all('content.write'),
  [`GET ${ROUTES.mediaItemPattern}`]: all('org.read'),
  [`PATCH ${ROUTES.mediaItemPattern}`]: all('content.write'),
  [`DELETE ${ROUTES.mediaItemPattern}`]: all('media.delete'),
  [`GET ${ROUTES.mediaPreviewPattern}`]: all('org.read'),
  [`GET ${ROUTES.mediaThumbnailPattern}`]: all('org.read'),
  [`GET ${ROUTES.mediaUsagePattern}`]: all('org.read'),

  [`GET ${ROUTES.apps}`]: all('org.read'),
  [`POST ${ROUTES.apps}`]: all('content.write'),
  [`GET ${ROUTES.appPattern}`]: all('org.read'),
  [`PATCH ${ROUTES.appPattern}`]: all('content.write'),
  [`DELETE ${ROUTES.appPattern}`]: all('content.delete'),

  [`GET ${ROUTES.schedules}`]: all('org.read'),
  [`POST ${ROUTES.schedules}`]: all('content.write'),
  [`GET ${ROUTES.schedulePattern}`]: all('org.read'),
  [`PUT ${ROUTES.schedulePattern}`]: all('content.write'),
  [`DELETE ${ROUTES.schedulePattern}`]: all('content.delete'),

  [`GET ${ROUTES.layouts}`]: all('org.read'),
  [`POST ${ROUTES.layouts}`]: all('content.write'),
  [`GET ${ROUTES.layoutPattern}`]: all('org.read'),
  [`PUT ${ROUTES.layoutPattern}`]: all('content.write'),
  [`DELETE ${ROUTES.layoutPattern}`]: all('content.delete'),

  [`GET ${ROUTES.tags}`]: all('org.read'),
  [`POST ${ROUTES.tags}`]: any('tagScopeFromBody', 'content.write', 'screen.setup'),
  [`PATCH ${ROUTES.tagPattern}`]: any('tagScopeFromRow', 'content.write', 'screen.setup'),
  [`DELETE ${ROUTES.tagPattern}`]: any('tagScopeFromRow', 'content.delete', 'screen.setup'),

  [`GET ${ROUTES.folders}`]: all('org.read'),
  [`POST ${ROUTES.folders}`]: all('content.write'),
  [`PATCH ${ROUTES.folderPattern}`]: all('content.write'),
  [`DELETE ${ROUTES.folderPattern}`]: all('content.delete'),

  [`GET ${ROUTES.playlists}`]: all('org.read'),
  [`POST ${ROUTES.playlists}`]: all('content.write'),
  [`GET ${ROUTES.playlistPattern}`]: all('org.read'),
  [`PUT ${ROUTES.playlistPattern}`]: all('content.write'),
  [`DELETE ${ROUTES.playlistPattern}`]: all('content.delete'),
  [`POST ${ROUTES.playlistDuplicatePattern}`]: all('content.write'),
  // Kept for scripts and tests; no portal caller. A cleanup card retires it.
  [`POST ${ROUTES.playlistPublishPattern}`]: all('push.publish', 'screen.assign'),

  [`GET ${ROUTES.push}`]: all('org.read'),
  [`POST ${ROUTES.push}`]: all('push.publish'),
  [`GET ${ROUTES.overview}`]: all('org.read'),
  // The handler narrows the log to the activity categories without audit.read; it never refuses.
  [`GET ${ROUTES.audit}`]: all('activity.read'),

  [`GET ${ROUTES.members}`]: all('member.read'),
  [`GET ${ROUTES.memberNames}`]: all('activity.read'),
  // The people routes then apply the rank rule (routes/members.ts).
  [`PATCH ${ROUTES.memberPattern}`]: all('member.manage'),
  [`POST ${ROUTES.memberRemovePattern}`]: all('member.manage'),
  [`POST ${ROUTES.memberSignOutPattern}`]: all('member.manage'),
  [`GET ${ROUTES.invites}`]: all('member.read'),
  [`POST ${ROUTES.invites}`]: all('member.manage'),
  [`POST ${ROUTES.inviteCancelPattern}`]: all('member.manage'),
} satisfies Record<string, RouteRule>);

/** `${METHOD} ${pattern}`, with HEAD read as GET (Fastify registers a HEAD twin of every GET). */
export function routeKey(method: string, pattern: string): string {
  const upper = method.toUpperCase();
  return `${upper === 'HEAD' ? 'GET' : upper} ${pattern}`;
}

function ruleOf(key: string, table: Readonly<Record<string, RouteRule>>): RouteRule | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

// ---------------------------------------------------------------------------- refines

/**
 * PATCH /api/displays/:id field → key. `satisfies` makes a new DisplayPatch field a compile
 * error until it is mapped.
 */
export const DISPLAY_PATCH_KEYS = Object.freeze({
  name: 'screen.details',
  description: 'screen.details',
  tagIds: 'screen.details',
  workingHours: 'screen.hours',
  canvas: 'screen.setup',
  contentRect: 'screen.setup',
  defaultFit: 'screen.setup',
  rotation: 'screen.setup',
  assignedPlaylistId: 'screen.assign',
  assignedScheduleId: 'screen.assign',
  assignedLayoutId: 'screen.assign',
} as const satisfies { readonly [K in keyof DisplayPatch]-?: PermissionKey });

/** The keys the named fields need, unique and in PERMISSION_KEYS order; unknown fields need none. */
export function displayPatchKeys(fields: Iterable<string>): PermissionKey[] {
  const needed = new Set<PermissionKey>();
  for (const field of fields) {
    if (Object.hasOwn(DISPLAY_PATCH_KEYS, field)) {
      needed.add(DISPLAY_PATCH_KEYS[field as keyof typeof DISPLAY_PATCH_KEYS]);
    }
  }
  return PERMISSION_KEYS.filter((key) => needed.has(key));
}

/** media: write → content.write, delete → content.delete; display: both → screen.setup. */
export function tagScopeKey(scope: TagScope, action: 'write' | 'delete'): PermissionKey {
  if (scope === 'display') return 'screen.setup';
  return action === 'write' ? 'content.write' : 'content.delete';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Narrow an any-of rule from the parsed (not yet validated) body. Null keeps the any-of
 * requirement; validation then answers 400, or the handler checks the stored row.
 */
export const REFINES: {
  readonly [N in RefineName]: (body: unknown) => readonly PermissionKey[] | null;
} = Object.freeze({
  // Unknown fields map to nothing (.strict() answers 400); {} gives [] (400 follows).
  displayPatchFields: (body: unknown) =>
    isPlainObject(body) ? displayPatchKeys(Object.keys(body)) : null,
  tagScopeFromBody: (body: unknown) => {
    if (!isPlainObject(body)) return null;
    const scope = body['scope'];
    return scope === 'media' || scope === 'display' ? [tagScopeKey(scope, 'write')] : null;
  },
  // The scope is known only after the handler reads the tag (routes/tags.ts).
  tagScopeFromRow: () => null,
});

// ------------------------------------------------------------------------ the test

export function parseRole(value: string): Role | null {
  const parsed = RoleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The test of a requirement against a key set; `meets` calls it with the role's keys. */
export function meetsKeys(held: ReadonlySet<PermissionKey>, required: Requirement): boolean {
  return 'all' in required
    ? required.all.every((key) => held.has(key))
    : required.any.some((key) => held.has(key));
}

export function meets(role: Role, required: Requirement): boolean {
  return meetsKeys(new Set(permissionsOf(role)), required);
}

function keysOf(required: Requirement | RouteRule): readonly PermissionKey[] {
  return 'all' in required ? required.all : required.any;
}

// ------------------------------------------------------------------- start-up check

/** Problems with the table against the registered routes (empty = fine). Pure. */
export function checkRouteTable(
  registered: ReadonlySet<string>,
  table: Readonly<Record<string, RouteRule>> = ROUTE_PERMISSIONS,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const route of registered) {
    const space = route.indexOf(' ');
    const key = space < 0 ? route : routeKey(route.slice(0, space), route.slice(space + 1));
    seen.add(key);
    if (ruleOf(key, table) === undefined) problems.push(`no permission entry for ${route}`);
  }
  for (const [key, rule] of Object.entries(table)) {
    if (!seen.has(key)) problems.push(`permission entry ${key} matches no registered route`);
    if ('refine' in rule && !Object.hasOwn(REFINES, rule.refine)) {
      problems.push(`permission entry ${key} names an unknown refine ${String(rule.refine)}`);
    }
  }
  return problems;
}

/** Collects the operator routes as they are registered and checks them against the table. */
export function createRouteCheck(): {
  readonly onRoute: (route: RouteOptions) => void;
  readonly assertComplete: () => void;
} {
  const registered = new Set<string>();
  return {
    // Called once per method: the 59 routes and the HEAD twin of every GET.
    onRoute: (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) registered.add(`${String(method)} ${route.url}`);
    },
    assertComplete: () => {
      const problems = checkRouteTable(registered);
      if (problems.length > 0) {
        throw new Error(`the operator route table is incomplete: ${problems.join('; ')}`);
      }
    },
  };
}

// --------------------------------------------------------------------------- refusals

export const forbidden = (): HttpError =>
  new HttpError(403, 'forbidden', "Your role doesn't allow this.");

/** A refusal by role found inside a transaction or by a people-route rule. Carries what the audit row needs. */
export class PermissionDeniedError extends HttpError {
  readonly record: DenialRecord;
  constructor(record: DenialRecord) {
    super(403, 'forbidden', "Your role doesn't allow this.");
    this.name = 'PermissionDeniedError';
    this.record = record;
  }
}

/**
 * Throws PermissionDeniedError unless the role meets the requirement. `reason` defaults to
 * `role`; refusals by role and by a changed role are throttled, the people routes' are not.
 */
export function requirePermission(
  role: Role,
  required: Requirement,
  reason: DenialReason = 'role',
): void {
  if (meets(role, required)) return;
  throw new PermissionDeniedError({
    keys: keysOf(required),
    reason,
    always: reason !== 'role' && reason !== 'role_changed',
  });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Ends a request whose body is still arriving: the client may still be sending. The rest of
 * the body is discarded (never stored) for a short time so the client can read the error,
 * then the connection is closed.
 */
export function abandonBody(request: FastifyRequest, reply: FastifyReply): void {
  void reply.header('connection', 'close');
  request.raw.resume();
  const timer = setTimeout(() => request.raw.destroy(), 2_000);
  timer.unref();
  request.raw.once('end', () => clearTimeout(timer));
}

/**
 * preHandler after `requireOperator`: refuses a request whose role lacks the route's keys
 * (403, decided before any lookup) and records what the write must check again.
 */
export function permissionGuard(
  ctx: AppContext,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function permissionGuardHook(request, reply): Promise<void> {
    const session = operatorOf(request);
    const key = routeKey(request.method, request.routeOptions.url ?? '');
    const rule = ruleOf(key, ROUTE_PERMISSIONS);
    const role = parseRole(session.role);
    let required: Requirement | null = null;
    let failed: readonly PermissionKey[] = [];
    if (rule === undefined) {
      // The start-up check makes this unreachable; fail closed if it ever is not.
      request.log.error({ route: key }, 'operator route without a permission entry');
    } else if (role === null) {
      request.log.error('session with an unknown role');
      failed = keysOf(rule);
    } else if ('all' in rule) {
      if (meets(role, rule)) required = { all: rule.all };
      else failed = rule.all;
    } else if (!meets(role, { any: rule.any })) {
      failed = rule.any;
    } else {
      const keys = REFINES[rule.refine](request.body);
      const candidate: Requirement = keys === null ? { any: rule.any } : { all: keys };
      if (meets(role, candidate)) required = candidate;
      else failed = keysOf(candidate);
    }

    if (required !== null) {
      request.permission = { required };
      return;
    }
    if (!SAFE_METHODS.has(request.method)) {
      await recordPermissionDenied(ctx, request, session, {
        keys: failed,
        reason: 'role',
        always: false,
      });
    }
    // A Viewer's upload is refused before any byte reaches storage.
    if (key === `POST ${ROUTES.media}`) abandonBody(request, reply);
    throw forbidden();
  };
}

// --------------------------------------------------------------- the check in a write

/**
 * First statement of every write transaction: re-reads the member row FOR SHARE (it waits for
 * a member change that is committing) and checks the role against the requirement the guard
 * resolved. Returns the role it read. Removed, gone or cut off (the session's sessions were
 * ended): 401. Role lacks the keys: 403 (reason `role_changed`).
 */
export async function assertStillAllowed(
  tx: Tx,
  session: OperatorSession,
  required: Requirement,
): Promise<Role> {
  const row = await membershipForCheck(tx, session.membershipId, session.createdAt);
  if (row === null || row.removedAt !== null || row.cutOff) {
    throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  }
  const role = parseRole(row.role);
  if (role === null || !meets(role, required)) {
    throw new PermissionDeniedError({
      keys: keysOf(required),
      reason: 'role_changed',
      always: false,
    });
  }
  return role;
}

/** SQLSTATE lock_not_available: `lock_timeout` (5 s for tinnox_app) ran out. */
const LOCK_NOT_AVAILABLE = '55P03';

function requirementOf(
  request: FastifyRequest,
  options: { readonly required?: Requirement } | undefined,
): Requirement {
  const required = options?.required ?? request.permission?.required;
  if (required === undefined) {
    throw new Error('a write ran outside the permission guard');
  }
  return required;
}

/** Records a role refusal and maps a lock timeout; anything else passes unchanged. */
async function settle(
  ctx: AppContext,
  request: FastifyRequest,
  session: OperatorSession,
  error: unknown,
): Promise<unknown> {
  if (error instanceof PermissionDeniedError) {
    await recordPermissionDenied(ctx, request, session, error.record);
    return error;
  }
  if (pgErrorCode(error) === LOCK_NOT_AVAILABLE) {
    request.log.warn({ pgCode: LOCK_NOT_AVAILABLE }, 'a write waited too long for a lock');
    return new HttpError(
      503,
      'service_unavailable',
      'Another change is being saved. Try again in a moment.',
      { headers: { 'retry-after': '2' } },
    );
  }
  return error;
}

/**
 * withOrg for writes: [lockOrgMembership when lockMembership] → assertStillAllowed → fn(tx, role).
 * A PermissionDeniedError thrown anywhere inside rolls back, is recorded with
 * recordPermissionDenied in its own transaction, and is rethrown. A lock timeout (55P03)
 * raised anywhere inside (membership lock, actor row, target row, any other lock) becomes
 * 503 service_unavailable with retry-after 2.
 */
export async function withOrgAllowed<T>(
  ctx: AppContext,
  request: FastifyRequest,
  fn: (tx: Tx, role: Role) => Promise<T>,
  options?: { readonly required?: Requirement; readonly lockMembership?: boolean },
): Promise<T> {
  const session = operatorOf(request);
  const required = requirementOf(request, options);
  try {
    return await withOrg(ctx.pool, session.orgId, async (tx) => {
      if (options?.lockMembership === true) await lockOrgMembership(tx);
      const role = await assertStillAllowed(tx, session, required);
      return fn(tx, role);
    });
  } catch (error) {
    throw await settle(ctx, request, session, error);
  }
}

/** The same around withOrgDecision: commits a refusal's trace, then throws the refusal. */
export async function withOrgDecisionAllowed<T>(
  ctx: AppContext,
  request: FastifyRequest,
  fn: (tx: Tx, role: Role) => Promise<Decision<T>>,
  options?: { readonly required?: Requirement; readonly lockMembership?: boolean },
): Promise<T> {
  const decision = await withOrgAllowed(ctx, request, fn, options);
  if (!decision.ok) throw decision.error;
  return decision.value;
}
