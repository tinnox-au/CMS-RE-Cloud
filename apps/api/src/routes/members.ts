/**
 * People routes (CMS-13, docs/portal-v2/stage-c.md section 6.7): the members of the caller's
 * organisation, their roles and names, and the invite requests TINNOX completes.
 *
 * Every write runs in withOrgAllowed with the membership lock, so the order is always
 * membership lock → actor row FOR SHARE (role re-read) → target row → change → audit, all on
 * one transaction (6.8). The route guard has already required `member.manage`; the rank rule,
 * self-actions and the roles an actor may grant are decided here, after the target is read.
 * Members never carry an e-mail address (D3 a): only a pending invite holds one.
 */
import {
  ABSOLUTE,
  IdParamSchema,
  InviteCreateSchema,
  InviteRoleSchema,
  MemberPatchSchema,
  RoleSchema,
  ROUTES,
  type ApiErrorDetail,
  type InviteDto,
  type InviteListResponse,
  type MemberChangeResponse,
  type MemberDto,
  type MemberListResponse,
  type MemberNameListResponse,
  type MemberSignOutResponse,
  type Role,
} from '@tinnox/contracts';
import { canManage, grantableRoles, isDemotion } from '@tinnox/domain';
import {
  auditScoped,
  sessionRevokeMembership,
  STAGE_C_CONSTRAINTS,
  violatedConstraint,
  withOrg,
  type Tx,
} from '@tinnox/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { recordPermissionDenied, type DenialReason } from '../auth/permission-audit.ts';
import { parseRole, PermissionDeniedError, withOrgAllowed } from '../auth/permissions.ts';
import { operatorOf, type OperatorSession } from '../auth/session.ts';
import { perMinute, type AppContext } from '../context.ts';
import { bigintToNumber, iso, isoOrNull } from '../db-helpers.ts';
import { HttpError, notFound, parseInput, pgErrorCode } from '../errors.ts';

interface MemberRow {
  id: string;
  display_name: string | null;
  role: string;
  first_signed_in_at: Date | null;
  removed_at: Date | null;
}

const MEMBER_COLUMNS = 'id, display_name, role, first_signed_in_at, removed_at';

function toMemberDto(row: MemberRow): MemberDto {
  return {
    id: row.id,
    displayName: row.display_name,
    role: RoleSchema.parse(row.role),
    firstSignedInAt: isoOrNull(row.first_signed_in_at),
    removedAt: isoOrNull(row.removed_at),
  };
}

interface InviteRow {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  invited_by: string;
  created_at: Date;
  expires_at: Date;
}

const INVITE_COLUMNS = 'id, name, email, role, invited_by, created_at, expires_at';

function toInviteDto(row: InviteRow): InviteDto {
  // A pending invite always has both (member_invite_open).
  if (row.name === null || row.email === null) throw new Error('pending invite without details');
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: InviteRoleSchema.parse(row.role),
    invitedBy: row.invited_by,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  };
}

/** A role read from the database; the CHECK constraints make anything else a fault. */
function storedRole(value: string): Role {
  const role = parseRole(value);
  if (role === null) throw new Error('membership or invite with an unknown role');
  return role;
}

/** A refusal by the people-route rules: always written as security.permission_denied (6.4). */
function refused(
  reason: DenialReason,
  object: { type: 'membership' | 'invite'; id: string } | null,
): PermissionDeniedError {
  return new PermissionDeniedError({
    keys: ['member.manage'],
    reason,
    always: true,
    ...(object === null ? {} : { object }),
  });
}

/**
 * A 409 that is also a refusal by rule (last Owner, Owner before a first sign-in). The change
 * rolled back, so it is recorded after the transaction, as withOrgAllowed records a 403.
 */
class RefusedConflict extends HttpError {
  readonly reason: DenialReason;
  constructor(
    reason: DenialReason,
    code: 'conflict' | 'last_owner',
    message: string,
    details?: ApiErrorDetail[],
  ) {
    super(409, code, message, details === undefined ? {} : { details });
    this.reason = reason;
  }
}

const lastOwner = (): RefusedConflict =>
  new RefusedConflict(
    'last_owner',
    'last_owner',
    'An organisation always keeps at least one Owner. Make someone else an Owner first.',
  );

const NOT_SIGNED_IN_YET = 'Only someone who has signed in at least once can be made an Owner.';

const fieldConflict = (path: string, message: string): HttpError =>
  new HttpError(409, 'conflict', message, { details: [{ path, message }] });

const memberNameTaken = (): HttpError =>
  fieldConflict('displayName', 'Another person in this organisation has, or had, this name.');
const inviteNameTaken = (): HttpError =>
  fieldConflict('name', 'Another person in this organisation has this name.');
const inviteEmailTaken = (): HttpError =>
  fieldConflict('email', 'An invite for this address is already waiting.');

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return pgErrorCode(error) === '23505' && violatedConstraint(error) === constraint;
}

/**
 * Records a refused change that answered 409 and rethrows the answer. Every other error is
 * rethrown as it is; a last-Owner refusal from the database trigger becomes 409 `last_owner`.
 */
async function answerRefusal(
  ctx: AppContext,
  request: FastifyRequest,
  session: OperatorSession,
  targetId: string,
  error: unknown,
): Promise<never> {
  const refusal =
    pgErrorCode(error) === '23001' && violatedConstraint(error) === STAGE_C_CONSTRAINTS.lastOwner
      ? lastOwner()
      : error;
  if (refusal instanceof RefusedConflict) {
    await recordPermissionDenied(ctx, request, session, {
      keys: ['member.manage'],
      reason: refusal.reason,
      always: true,
      object: { type: 'membership', id: targetId },
    });
  }
  throw refusal;
}

/**
 * Shared first steps of the three member writes: the target row, locked against other
 * changes, then the self and rank rules. A removed member cannot be changed (the database
 * agrees: membership_removed_final).
 */
async function lockTarget(
  tx: Tx,
  session: OperatorSession,
  role: Role,
  id: string,
): Promise<{ row: MemberRow; role: Role }> {
  const { rows } = await tx.query<MemberRow>(
    `SELECT ${MEMBER_COLUMNS} FROM membership
     WHERE id = $1 AND org_id = app_org_id() FOR NO KEY UPDATE`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw notFound('The person');
  if (row.removed_at !== null) {
    throw new HttpError(
      409,
      'conflict',
      'This person was removed. Invite them again to bring them back.',
    );
  }
  const object = { type: 'membership', id: row.id } as const;
  // D7: nobody changes, renames, removes or signs out themselves.
  if (row.id === session.membershipId) throw refused('self', object);
  const targetRole = storedRole(row.role);
  if (!canManage(role, targetRole)) throw refused('rank', object);
  return { row, role: targetRole };
}

/**
 * Cancels the pending invites the member sent whose role is not in `keep` (all of them for a
 * removal). The actor is the person whose change caused it; closed_by stays NULL because
 * nobody chose to cancel these invites. One invite.cancel row per invite.
 */
async function cancelInvitesOf(
  tx: Tx,
  session: OperatorSession,
  inviterId: string,
  keep: readonly Role[],
  reason: 'inviter_demoted' | 'inviter_removed',
): Promise<number> {
  const { rows } = await tx.query<{ id: string; role: string }>(
    `UPDATE member_invite SET status = 'cancelled'
     WHERE org_id = app_org_id() AND invited_by = $1 AND status = 'pending'
       AND NOT (role = ANY($2::text[]))
     RETURNING id, role`,
    [inviterId, [...keep]],
  );
  for (const invite of rows) {
    await auditScoped(tx, {
      actorType: 'operator',
      actorId: session.membershipId,
      action: 'invite.cancel',
      objectType: 'invite',
      objectId: invite.id,
      result: 'success',
      detail: { role: invite.role, reason },
    });
  }
  return rows.length;
}

export function registerMemberRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { pool } = ctx;
  const writeLimit = { config: { rateLimit: perMinute(ctx, 30) } };

  app.get(ROUTES.members, async (request): Promise<MemberListResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => {
      // shortcut: at most ABSOLUTE.maxListItems members are listed; page the list if an organisation gets near it.
      const { rows } = await tx.query<MemberRow>(
        `SELECT ${MEMBER_COLUMNS} FROM membership
         WHERE org_id = app_org_id()
         ORDER BY removed_at IS NOT NULL, lower(display_name) NULLS LAST, created_at, id
         LIMIT $1`,
        [ABSOLUTE.maxListItems],
      );
      return { items: rows.map(toMemberDto) };
    });
  });

  app.get(ROUTES.memberNames, async (request): Promise<MemberNameListResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => {
      // shortcut: at most ABSOLUTE.maxListItems names are returned (a later one shows as "Person");
      // page the list if an organisation gets near it.
      const { rows } = await tx.query<{
        id: string;
        display_name: string | null;
        removed: boolean;
        display_name_changed_at: Date | null;
      }>(
        `SELECT id, display_name, removed_at IS NOT NULL AS removed, display_name_changed_at
         FROM membership WHERE org_id = app_org_id()
         ORDER BY id
         LIMIT $1`,
        [ABSOLUTE.maxListItems],
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
          displayName: row.display_name,
          removed: row.removed,
          renamedAt: isoOrNull(row.display_name_changed_at),
        })),
      };
    });
  });

  app.patch(ROUTES.memberPattern, writeLimit, async (request): Promise<MemberChangeResponse> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    const patch = parseInput(MemberPatchSchema, request.body, 'change');
    try {
      return await withOrgAllowed(
        ctx,
        request,
        async (tx, role) => {
          const target = await lockTarget(tx, session, role, id);
          const object = { type: 'membership', id: target.row.id } as const;
          const to = patch.role !== undefined && patch.role !== target.role ? patch.role : null;
          const name =
            patch.displayName !== undefined && patch.displayName !== target.row.display_name
              ? patch.displayName
              : null;
          if (to !== null) {
            if (!grantableRoles(role, 'change').includes(to)) throw refused('grant', object);
            if (to === 'owner' && target.row.first_signed_in_at === null) {
              throw new RefusedConflict('not_signed_in', 'conflict', NOT_SIGNED_IN_YET, [
                { path: 'role', code: 'not_signed_in_yet', message: NOT_SIGNED_IN_YET },
              ]);
            }
          }
          if (to === null && name === null) {
            return { member: toMemberDto(target.row), sessionsEnded: 0, invitesCancelled: 0 };
          }

          // Only the named, changed columns; fixed text, every value a parameter.
          const values: unknown[] = [target.row.id];
          const sets: string[] = [];
          if (to !== null) sets.push(`role = $${values.push(to)}`);
          if (name !== null) sets.push(`display_name = $${values.push(name)}`);
          const updated = await tx.query<MemberRow>(
            `UPDATE membership SET ${sets.join(', ')}
             WHERE id = $1 AND org_id = app_org_id()
             RETURNING ${MEMBER_COLUMNS}`,
            values,
          );
          const row = updated.rows[0];
          if (row === undefined) throw new Error('locked member was not updated');

          let sessionsEnded = 0;
          let invitesCancelled = 0;
          if (to !== null && isDemotion(target.role, to)) {
            // Its own statement, after the target row is locked: the cut-off is its start.
            sessionsEnded = await sessionRevokeMembership(tx, target.row.id);
            invitesCancelled = await cancelInvitesOf(
              tx,
              session,
              target.row.id,
              grantableRoles(to, 'invite'),
              'inviter_demoted',
            );
          }
          if (to !== null) {
            await auditScoped(tx, {
              actorType: 'operator',
              actorId: session.membershipId,
              action: 'membership.role_change',
              objectType: 'membership',
              objectId: target.row.id,
              result: 'success',
              detail: { from: target.role, to, sessionsEnded, invitesCancelled },
            });
          }
          if (name !== null) {
            await auditScoped(tx, {
              actorType: 'operator',
              actorId: session.membershipId,
              action: 'membership.update',
              objectType: 'membership',
              objectId: target.row.id,
              result: 'success',
              detail: { fields: ['displayName'] },
            });
          }
          return { member: toMemberDto(row), sessionsEnded, invitesCancelled };
        },
        { lockMembership: true },
      );
    } catch (error) {
      if (isUniqueViolation(error, STAGE_C_CONSTRAINTS.memberNameTaken)) throw memberNameTaken();
      return answerRefusal(ctx, request, session, id, error);
    }
  });

  app.post(
    ROUTES.memberRemovePattern,
    writeLimit,
    async (request): Promise<MemberChangeResponse> => {
      const session = operatorOf(request);
      const { id } = parseInput(IdParamSchema, request.params, 'address');
      try {
        return await withOrgAllowed(
          ctx,
          request,
          async (tx, role) => {
            const target = await lockTarget(tx, session, role, id);
            const updated = await tx.query<MemberRow>(
              `UPDATE membership SET removed_at = now(), removed_by = $2
               WHERE id = $1 AND org_id = app_org_id()
               RETURNING ${MEMBER_COLUMNS}`,
              [target.row.id, session.membershipId],
            );
            const row = updated.rows[0];
            if (row === undefined) throw new Error('locked member was not removed');
            const sessionsEnded = await sessionRevokeMembership(tx, target.row.id);
            const invitesCancelled = await cancelInvitesOf(
              tx,
              session,
              target.row.id,
              [],
              'inviter_removed',
            );
            await auditScoped(tx, {
              actorType: 'operator',
              actorId: session.membershipId,
              action: 'membership.remove',
              objectType: 'membership',
              objectId: target.row.id,
              result: 'success',
              detail: { previousRole: target.role, sessionsEnded, invitesCancelled },
            });
            return { member: toMemberDto(row), sessionsEnded, invitesCancelled };
          },
          { lockMembership: true },
        );
      } catch (error) {
        return answerRefusal(ctx, request, session, id, error);
      }
    },
  );

  // Also sets the member's cut-off, so their next sign-in asks for the password and code again.
  app.post(
    ROUTES.memberSignOutPattern,
    writeLimit,
    async (request): Promise<MemberSignOutResponse> => {
      const session = operatorOf(request);
      const { id } = parseInput(IdParamSchema, request.params, 'address');
      return withOrgAllowed(
        ctx,
        request,
        async (tx, role) => {
          const target = await lockTarget(tx, session, role, id);
          const sessionsEnded = await sessionRevokeMembership(tx, target.row.id);
          await auditScoped(tx, {
            actorType: 'operator',
            actorId: session.membershipId,
            action: 'membership.sessions_end',
            objectType: 'membership',
            objectId: target.row.id,
            result: 'success',
            detail: { sessions: sessionsEnded },
          });
          return { sessionsEnded };
        },
        { lockMembership: true },
      );
    },
  );

  // Pending invites, expired ones included until TINNOX's daily run closes them.
  app.get(ROUTES.invites, async (request): Promise<InviteListResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<InviteRow>(
        `SELECT ${INVITE_COLUMNS} FROM member_invite
         WHERE org_id = app_org_id() AND status = 'pending'
         ORDER BY created_at, id
         LIMIT $1`,
        [ABSOLUTE.maxPendingInvites],
      );
      return { items: rows.map(toInviteDto) };
    });
  });

  app.post(ROUTES.invites, writeLimit, async (request, reply): Promise<InviteDto> => {
    const session = operatorOf(request);
    const input = parseInput(InviteCreateSchema, request.body, 'invite');
    let created: InviteDto;
    try {
      created = await withOrgAllowed(
        ctx,
        request,
        async (tx, role) => {
          if (!grantableRoles(role, 'invite').includes(input.role)) throw refused('grant', null);
          // shortcut: 100 pending invites per organisation, counted under the membership lock;
          // raise ABSOLUTE.maxPendingInvites (and page the list) when self-service sign-up (CMS-20) lands.
          const pending = await tx.query<{ n: string }>(
            "SELECT count(*) AS n FROM member_invite WHERE org_id = app_org_id() AND status = 'pending'",
          );
          if (bigintToNumber(pending.rows[0]?.n ?? 0) >= ABSOLUTE.maxPendingInvites) {
            throw new HttpError(
              409,
              'conflict',
              `The organisation already has ${ABSOLUTE.maxPendingInvites} invites waiting for TINNOX. Cancel ones that are no longer needed.`,
            );
          }
          // A removed member's name is allowed: a person who comes back keeps their row and name.
          const nameUsed = await tx.query(
            `SELECT 1 FROM membership
             WHERE org_id = app_org_id() AND lower(display_name) = lower($1) AND removed_at IS NULL
             UNION ALL
             SELECT 1 FROM member_invite
             WHERE org_id = app_org_id() AND status = 'pending' AND lower(name) = lower($1)
             LIMIT 1`,
            [input.name],
          );
          if (nameUsed.rows.length > 0) throw inviteNameTaken();
          const emailUsed = await tx.query(
            `SELECT 1 FROM member_invite
             WHERE org_id = app_org_id() AND status = 'pending' AND lower(email) = lower($1)
             LIMIT 1`,
            [input.email],
          );
          if (emailUsed.rows.length > 0) throw inviteEmailTaken();
          const inserted = await tx.query<InviteRow>(
            `INSERT INTO member_invite (org_id, role, name, email, invited_by, expires_at)
             VALUES (app_org_id(), $1, $2, $3, $4, now() + interval '14 days')
             RETURNING ${INVITE_COLUMNS}`,
            [input.role, input.name, input.email, session.membershipId],
          );
          const row = inserted.rows[0];
          if (row === undefined) throw new Error('invite insert returned no row');
          await auditScoped(tx, {
            actorType: 'operator',
            actorId: session.membershipId,
            action: 'invite.create',
            objectType: 'invite',
            objectId: row.id,
            result: 'success',
            detail: { role: input.role },
          });
          return toInviteDto(row);
        },
        { lockMembership: true },
      );
    } catch (error) {
      // A race past the checks above (the membership lock makes it unlikely).
      if (isUniqueViolation(error, STAGE_C_CONSTRAINTS.inviteEmailTaken)) throw inviteEmailTaken();
      if (isUniqueViolation(error, STAGE_C_CONSTRAINTS.inviteNameTaken)) throw inviteNameTaken();
      throw error;
    }
    void reply.code(201);
    return created;
  });

  app.post(ROUTES.inviteCancelPattern, writeLimit, async (request, reply) => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    await withOrgAllowed(
      ctx,
      request,
      async (tx, role) => {
        const { rows } = await tx.query<{ id: string; role: string; status: string }>(
          `SELECT id, role, status FROM member_invite
           WHERE id = $1 AND org_id = app_org_id() FOR UPDATE`,
          [id],
        );
        const invite = rows[0];
        if (invite === undefined) throw notFound('The invite');
        if (invite.status !== 'pending') {
          throw new HttpError(
            409,
            'conflict',
            'This invite is no longer waiting. TINNOX may have just set the person up.',
          );
        }
        if (!canManage(role, storedRole(invite.role))) {
          throw refused('rank', { type: 'invite', id: invite.id });
        }
        // The guard clears the name and e-mail address and stamps closed_at.
        await tx.query(
          `UPDATE member_invite SET status = 'cancelled', closed_by = $2
           WHERE id = $1 AND org_id = app_org_id()`,
          [invite.id, session.membershipId],
        );
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'invite.cancel',
          objectType: 'invite',
          objectId: invite.id,
          result: 'success',
          detail: { role: invite.role, reason: 'cancelled' },
        });
      },
      { lockMembership: true },
    );
    return reply.code(204).send();
  });
}
