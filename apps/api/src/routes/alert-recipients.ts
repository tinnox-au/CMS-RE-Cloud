/**
 * The organisation's alert addresses (CMS-15, docs/portal-v2/stage-c-alerts.md section 4). The
 * list routes need `alerts.manage` (Admin and up): the list holds personal data. The confirm
 * route is public: the link is opened by the address's owner, who has no session.
 * Audit rows carry the recipient id, never the address.
 */
import {
  ALERT_CONFIRM_TTL_DAYS,
  AlertRecipientConfirmSchema,
  AlertRecipientCreateSchema,
  AlertRecipientStatusSchema,
  IdParamSchema,
  MAX_ALERT_RECIPIENTS,
  ROUTES,
  type AlertRecipientDto,
  type AlertRecipientListResponse,
} from '@tinnox/contracts';
import {
  alertRecipientByTokenHash,
  auditScoped,
  sha256,
  withOrg,
  withResolvedOrg,
} from '@tinnox/db';
import type { FastifyInstance } from 'fastify';
import { confirmationEmail, mailErrorCode } from '../alerts.ts';
import { withOrgAllowed } from '../auth/permissions.ts';
import { operatorOf } from '../auth/session.ts';
import { perMinute, type AppContext } from '../context.ts';
import { iso } from '../db-helpers.ts';
import { HttpError, notFound, parseInput } from '../errors.ts';
import { randomToken } from '../security.ts';

interface RecipientRow {
  id: string;
  email: string;
  status: string;
  created_at: Date;
}

// The status by the database clock, the one the expiry was set with.
const RECIPIENT_COLUMNS = `id, email, created_at,
  CASE WHEN confirmed_at IS NOT NULL THEN 'confirmed'
       WHEN confirm_expires_at > now() THEN 'waiting'
       ELSE 'expired' END AS status`;

function toDto(row: RecipientRow): AlertRecipientDto {
  return {
    id: row.id,
    email: row.email,
    status: AlertRecipientStatusSchema.parse(row.status),
    createdAt: iso(row.created_at),
  };
}

export function registerAlertRecipientRoutes(app: FastifyInstance, ctx: AppContext): void {
  const writeLimit = { config: { rateLimit: perMinute(ctx, 30) } };

  app.get(ROUTES.alertRecipients, async (request): Promise<AlertRecipientListResponse> => {
    const session = operatorOf(request);
    return withOrg(ctx.pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<RecipientRow>(
        `SELECT ${RECIPIENT_COLUMNS} FROM alert_recipient
         WHERE org_id = app_org_id() ORDER BY created_at, id LIMIT $1`,
        [MAX_ALERT_RECIPIENTS],
      );
      return { items: rows.map(toDto) };
    });
  });

  app.post(
    ROUTES.alertRecipients,
    writeLimit,
    async (request, reply): Promise<AlertRecipientDto> => {
      const session = operatorOf(request);
      const { email: address } = parseInput(AlertRecipientCreateSchema, request.body, 'address');
      const mail = ctx.mail;
      if (mail === null) {
        throw new HttpError(
          503,
          'mail_not_configured',
          'E-mail is not set up on this server yet, so alert addresses cannot be added.',
        );
      }
      const token = randomToken();
      const { recipient, orgName } = await withOrgAllowed(ctx, request, async (tx) => {
        // Serialises additions per organisation, so the count and the duplicate check hold.
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('tinnox.alert_recipient_count:' || app_org_id()::text, 0))",
        );
        const listed = await tx.query<{ n: number; taken: boolean }>(
          `SELECT count(*)::int AS n, coalesce(bool_or(email = $1), false) AS taken
         FROM alert_recipient WHERE org_id = app_org_id()`,
          [address],
        );
        if (listed.rows[0]?.taken === true) {
          throw new HttpError(409, 'conflict', 'This address is already on the alert list.', {
            details: [{ path: 'email', message: 'This address is already on the alert list.' }],
          });
        }
        if ((listed.rows[0]?.n ?? 0) >= MAX_ALERT_RECIPIENTS) {
          throw new HttpError(
            409,
            'conflict',
            `The alert list already has ${MAX_ALERT_RECIPIENTS} addresses. Remove one first.`,
          );
        }
        const inserted = await tx.query<RecipientRow>(
          `INSERT INTO alert_recipient (org_id, email, created_by, confirm_token_hash, confirm_expires_at)
         VALUES (app_org_id(), $1, $2, $3, now() + make_interval(days => $4))
         RETURNING ${RECIPIENT_COLUMNS}`,
          [address, session.membershipId, sha256(token), ALERT_CONFIRM_TTL_DAYS],
        );
        const row = inserted.rows[0];
        if (row === undefined) throw new Error('alert recipient insert returned no row');
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'alert_recipient.add',
          objectType: 'alert_recipient',
          objectId: row.id,
          result: 'success',
          detail: null,
        });
        const org = await tx.query<{ name: string }>(
          'SELECT name FROM organization WHERE id = app_org_id()',
        );
        return { recipient: toDto(row), orgName: org.rows[0]?.name ?? '' };
      });
      try {
        await mail.send({
          to: address,
          ...confirmationEmail(orgName, ctx.config.portalOrigin, token, ALERT_CONFIRM_TTL_DAYS),
        });
      } catch (error) {
        request.log.error(mailErrorCode(error), 'alert confirmation e-mail was not sent');
        throw new HttpError(
          503,
          'confirmation_not_sent',
          'The address was added, but the confirmation e-mail could not be sent. Remove the address and add it again later.',
        );
      }
      void reply.code(201);
      return recipient;
    },
  );

  app.delete(ROUTES.alertRecipientPattern, writeLimit, async (request, reply) => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    await withOrgAllowed(ctx, request, async (tx) => {
      const deleted = await tx.query(
        'DELETE FROM alert_recipient WHERE id = $1 AND org_id = app_org_id() RETURNING id',
        [id],
      );
      if (deleted.rowCount !== 1) throw notFound('The address');
      await auditScoped(tx, {
        actorType: 'operator',
        actorId: session.membershipId,
        action: 'alert_recipient.remove',
        objectType: 'alert_recipient',
        objectId: id,
        result: 'success',
        detail: null,
      });
    });
    return reply.code(204).send();
  });
}

/**
 * Public: the confirmation link's page posts the token from its fragment. Unknown, used and
 * expired tokens all get the same 404. Rate-limited per client address.
 */
export function registerAlertConfirmRoute(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    ROUTES.alertRecipientConfirm,
    { config: { rateLimit: perMinute(ctx, 10) } },
    async (request, reply) => {
      const { token } = parseInput(AlertRecipientConfirmSchema, request.body, 'link');
      const tokenHash = sha256(token);
      const confirmed = await withResolvedOrg(ctx.pool, async (tx, enterOrg) => {
        const found = await alertRecipientByTokenHash(tx, tokenHash);
        if (found === null) return false;
        await enterOrg(found.orgId);
        // Conditional, so two clicks at once confirm (and audit) once.
        const updated = await tx.query(
          `UPDATE alert_recipient
           SET confirmed_at = now(), confirm_token_hash = NULL, confirm_expires_at = NULL
           WHERE id = $1 AND org_id = app_org_id() AND confirm_token_hash = $2
             AND confirm_expires_at > now()
           RETURNING id`,
          [found.recipientId, tokenHash],
        );
        if (updated.rowCount !== 1) return false;
        await auditScoped(tx, {
          actorType: 'anonymous',
          actorId: null,
          action: 'alert_recipient.confirm',
          objectType: 'alert_recipient',
          objectId: found.recipientId,
          result: 'success',
          detail: null,
        });
        return true;
      });
      if (!confirmed) throw new HttpError(404, 'not_found', 'This link is not valid any more.');
      return reply.code(204).send();
    },
  );
}
