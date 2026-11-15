/**
 * Sites, displays, pairing claim, player revocation and delivery status.
 * Every query runs inside withOrg with the organisation of the verified session.
 */
import {
  CanvasSpecSchema,
  DisplayCreateSchema,
  DisplayPatchSchema,
  IdParamSchema,
  PairingClaimRequestSchema,
  PlayerErrorSchema,
  PlayerStateSchema,
  ROUTES,
  StagingPhaseSchema,
  type Canvas,
  type DeliveryStatusView,
  type DisplayDto,
  type DisplayListResponse,
  type Limits,
  type PairingClaimResponse,
  type Rect,
  type RevokePlayerResponse,
  type SiteListResponse,
} from '@tinnox/contracts';
import { auditScoped, pairingClaim, withOrg, type Tx } from '@tinnox/db';
import { buildDeliveryStatusView, type ReportedState } from '@tinnox/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { operatorOf } from '../auth/session.ts';
import { perMinute, type AppContext } from '../context.ts';
import { accept, bigintToNumber, iso, isoOrNull, refuse, withOrgDecision } from '../db-helpers.ts';
import { HttpError, notFound, parseInput } from '../errors.ts';

interface DisplayRow {
  id: string;
  site_id: string;
  name: string;
  canvas_width: number;
  canvas_height: number;
  content_x: number | null;
  content_y: number | null;
  content_width: number | null;
  content_height: number | null;
  default_fit: 'contain' | 'cover';
  route: 'browser';
  created_at: Date;
  updated_at: Date;
  registration_id: string | null;
  registered_at: Date | null;
}

const DISPLAY_SELECT = `
  SELECT d.id, d.site_id, d.name, d.canvas_width, d.canvas_height,
         d.content_x, d.content_y, d.content_width, d.content_height,
         d.default_fit, d.route, d.created_at, d.updated_at,
         pr.id AS registration_id, pr.created_at AS registered_at
  FROM display d
  LEFT JOIN player_registration pr
    ON pr.display_id = d.id AND pr.org_id = d.org_id AND pr.revoked_at IS NULL
  WHERE d.org_id = app_org_id()`;

export function contentRectOf(row: {
  content_x: number | null;
  content_y: number | null;
  content_width: number | null;
  content_height: number | null;
}): Rect | null {
  if (
    row.content_x === null ||
    row.content_y === null ||
    row.content_width === null ||
    row.content_height === null
  ) {
    return null;
  }
  return {
    x: row.content_x,
    y: row.content_y,
    width: row.content_width,
    height: row.content_height,
  };
}

function toDisplayDto(row: DisplayRow): DisplayDto {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    canvas: { width: row.canvas_width, height: row.canvas_height },
    contentRect: contentRectOf(row),
    defaultFit: row.default_fit,
    route: row.route,
    player:
      row.registration_id === null || row.registered_at === null
        ? null
        : { registrationId: row.registration_id, registeredAt: iso(row.registered_at) },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function loadDisplay(tx: Tx, id: string): Promise<DisplayRow | null> {
  const { rows } = await tx.query<DisplayRow>(`${DISPLAY_SELECT} AND d.id = $1`, [id]);
  return rows[0] ?? null;
}

/** Configured limits may be tighter than the schema's absolute bounds. */
function assertCanvasWithinLimits(canvas: Canvas, limits: Limits): void {
  for (const [side, value] of [
    ['width', canvas.width],
    ['height', canvas.height],
  ] as const) {
    if (value < limits.minCanvasSidePx || value > limits.maxCanvasSidePx) {
      throw new HttpError(
        400,
        'validation_failed',
        'The canvas size is outside the allowed range.',
        {
          details: [
            {
              path: `canvas.${side}`,
              message: `must be between ${limits.minCanvasSidePx} and ${limits.maxCanvasSidePx} pixels`,
            },
          ],
        },
      );
    }
  }
}

const StoredStagingSchema = z
  .object({
    publicationId: z.uuid(),
    phase: StagingPhaseSchema,
    assetsDone: z.number().int().nonnegative(),
    assetsTotal: z.number().int().nonnegative(),
  })
  .strict();

interface DeliveryRow {
  desired_publication_id: string | null;
  desired_at: Date | null;
  reporting_registration_id: string | null;
  last_seq: string | null;
  downloaded_publication_id: string | null;
  active_publication_id: string | null;
  active_item_index: number | null;
  player_state: string | null;
  staging: unknown;
  last_errors: unknown;
  last_heartbeat_at: Date | null;
}

export const DELIVERY_COLUMNS = `desired_publication_id, desired_at, reporting_registration_id, last_seq,
  downloaded_publication_id, active_publication_id, active_item_index, player_state, staging,
  last_errors, last_heartbeat_at`;

/** Maps a display_delivery row onto the domain's ReportedState, re-validating stored JSON. */
export function reportedStateOf(row: DeliveryRow | undefined): ReportedState {
  if (row === undefined) {
    return {
      registrationId: null,
      lastSeq: null,
      downloadedPublicationId: null,
      activePublicationId: null,
      activeItemIndex: null,
      playerState: null,
      staging: null,
      errors: [],
      lastHeartbeatAt: null,
    };
  }
  const staging = StoredStagingSchema.safeParse(row.staging);
  const errors = z.array(PlayerErrorSchema).safeParse(row.last_errors);
  const state = PlayerStateSchema.safeParse(row.player_state);
  return {
    registrationId: row.reporting_registration_id,
    lastSeq: row.last_seq === null ? null : bigintToNumber(row.last_seq),
    downloadedPublicationId: row.downloaded_publication_id,
    activePublicationId: row.active_publication_id,
    activeItemIndex: row.active_item_index,
    playerState: state.success ? state.data : null,
    staging: staging.success ? staging.data : null,
    errors: errors.success ? errors.data : [],
    lastHeartbeatAt: isoOrNull(row.last_heartbeat_at),
  };
}

export type { DeliveryRow };

export function registerDisplayRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { pool, config } = ctx;

  app.get(ROUTES.sites, async (request): Promise<SiteListResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<{ id: string; name: string; timezone: string }>(
        'SELECT id, name, timezone FROM site WHERE org_id = app_org_id() ORDER BY name, id',
      );
      return { items: rows.map((r) => ({ id: r.id, name: r.name, timezone: r.timezone })) };
    });
  });

  app.get(ROUTES.displays, async (request): Promise<DisplayListResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<DisplayRow>(`${DISPLAY_SELECT} ORDER BY d.created_at, d.id`);
      return { items: rows.map(toDisplayDto) };
    });
  });

  app.post(ROUTES.displays, async (request, reply): Promise<DisplayDto> => {
    const session = operatorOf(request);
    const input = parseInput(DisplayCreateSchema, request.body, 'display');
    assertCanvasWithinLimits(input.canvas, config.limits);
    const created = await withOrg(pool, session.orgId, async (tx) => {
      const site = await tx.query('SELECT 1 FROM site WHERE id = $1 AND org_id = app_org_id()', [
        input.siteId,
      ]);
      if (site.rowCount !== 1) throw notFound('The site');
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO display (org_id, site_id, name, canvas_width, canvas_height,
                              content_x, content_y, content_width, content_height, default_fit)
         VALUES (app_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          input.siteId,
          input.name,
          input.canvas.width,
          input.canvas.height,
          input.contentRect?.x ?? null,
          input.contentRect?.y ?? null,
          input.contentRect?.width ?? null,
          input.contentRect?.height ?? null,
          input.defaultFit,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) throw new Error('display insert returned no row');
      await auditScoped(tx, {
        actorType: 'operator',
        actorId: session.membershipId,
        action: 'display.create',
        objectType: 'display',
        objectId: id,
        result: 'success',
        detail: { canvas: input.canvas, contentRect: input.contentRect },
      });
      const row = await loadDisplay(tx, id);
      if (row === null) throw new Error('created display is not visible');
      return toDisplayDto(row);
    });
    void reply.code(201);
    return created;
  });

  app.get(ROUTES.displayPattern, async (request): Promise<DisplayDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    return withOrg(pool, session.orgId, async (tx) => {
      const row = await loadDisplay(tx, id);
      if (row === null) throw notFound('The display');
      return toDisplayDto(row);
    });
  });

  app.patch(ROUTES.displayPattern, async (request): Promise<DisplayDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    const patch = parseInput(DisplayPatchSchema, request.body, 'display');
    return withOrg(pool, session.orgId, async (tx) => {
      const locked = await tx.query<DisplayRow>(
        `SELECT d.id, d.site_id, d.name, d.canvas_width, d.canvas_height,
                d.content_x, d.content_y, d.content_width, d.content_height,
                d.default_fit, d.route, d.created_at, d.updated_at,
                NULL::uuid AS registration_id, NULL::timestamptz AS registered_at
         FROM display d WHERE d.id = $1 AND d.org_id = app_org_id() FOR UPDATE`,
        [id],
      );
      const current = locked.rows[0];
      if (current === undefined) throw notFound('The display');
      // The combined result is re-checked: a canvas change can push an existing rectangle out of bounds.
      const spec = parseInput(
        CanvasSpecSchema,
        {
          canvas: patch.canvas ?? { width: current.canvas_width, height: current.canvas_height },
          contentRect: patch.contentRect === undefined ? contentRectOf(current) : patch.contentRect,
        },
        'display',
      );
      assertCanvasWithinLimits(spec.canvas, config.limits);
      await tx.query(
        `UPDATE display
         SET name = $2, canvas_width = $3, canvas_height = $4,
             content_x = $5, content_y = $6, content_width = $7, content_height = $8, default_fit = $9
         WHERE id = $1 AND org_id = app_org_id()`,
        [
          id,
          patch.name ?? current.name,
          spec.canvas.width,
          spec.canvas.height,
          spec.contentRect?.x ?? null,
          spec.contentRect?.y ?? null,
          spec.contentRect?.width ?? null,
          spec.contentRect?.height ?? null,
          patch.defaultFit ?? current.default_fit,
        ],
      );
      await auditScoped(tx, {
        actorType: 'operator',
        actorId: session.membershipId,
        action: 'display.update',
        objectType: 'display',
        objectId: id,
        result: 'success',
        detail: { fields: Object.keys(patch).sort() },
      });
      const row = await loadDisplay(tx, id);
      if (row === null) throw new Error('updated display is not visible');
      return toDisplayDto(row);
    });
  });

  // D9: the operator claims a pairing code for one of the organisation's displays.
  app.post(
    ROUTES.displayClaimPattern,
    { config: { rateLimit: perMinute(ctx, 20) } },
    async (request): Promise<PairingClaimResponse> => {
      const session = operatorOf(request);
      const { id } = parseInput(IdParamSchema, request.params, 'address');
      const { code } = parseInput(PairingClaimRequestSchema, request.body, 'pairing code');
      return withOrgDecision(pool, session.orgId, async (tx) => {
        const result = await pairingClaim(tx, {
          code,
          displayId: id,
          membershipId: session.membershipId,
          maxFailures: config.limits.pairingMaxWrongAttempts,
          windowSeconds: config.limits.pairingSessionWindowSeconds,
        });
        if (result.outcome === 'display_not_found') throw notFound('The display');
        if (result.outcome === 'claimed') {
          await auditScoped(tx, {
            actorType: 'operator',
            actorId: session.membershipId,
            action: 'pairing.claim',
            objectType: 'display',
            objectId: id,
            result: 'success',
            detail: { pairingId: result.pairingId },
          });
          if (result.replacedRegistrationId !== null) {
            await auditScoped(tx, {
              actorType: 'operator',
              actorId: session.membershipId,
              action: 'player.revoke',
              objectType: 'player_registration',
              objectId: result.replacedRegistrationId,
              result: 'success',
              detail: { reason: 'replaced', displayId: id },
            });
          }
          return accept({
            displayId: id,
            pairingId: result.pairingId,
            replacedRegistrationId: result.replacedRegistrationId,
          });
        }
        // The code itself is never written to the audit trail.
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'pairing.claim',
          objectType: 'display',
          objectId: id,
          result: 'denied',
          detail: { reason: result.outcome },
        });
        if (result.outcome === 'rate_limited') {
          return refuse(
            new HttpError(
              429,
              'pairing_locked',
              'Too many incorrect pairing codes. Wait a few minutes before trying again.',
            ),
          );
        }
        return refuse(
          new HttpError(
            400,
            'pairing_code_invalid',
            'That pairing code is not valid. It may have expired or already been used; ask the player for a new code.',
          ),
        );
      });
    },
  );

  app.post(ROUTES.displayRevokePlayerPattern, async (request): Promise<RevokePlayerResponse> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    return withOrg(pool, session.orgId, async (tx) => {
      const display = await tx.query(
        'SELECT 1 FROM display WHERE id = $1 AND org_id = app_org_id() FOR UPDATE',
        [id],
      );
      if (display.rowCount !== 1) throw notFound('The display');
      const revoked = await tx.query<{ id: string }>(
        `UPDATE player_registration
         SET revoked_at = now(), revoked_reason = 'operator'
         WHERE display_id = $1 AND org_id = app_org_id() AND revoked_at IS NULL
         RETURNING id`,
        [id],
      );
      const registrationId = revoked.rows[0]?.id ?? null;
      await auditScoped(tx, {
        actorType: 'operator',
        actorId: session.membershipId,
        action: 'player.revoke',
        objectType: registrationId === null ? 'display' : 'player_registration',
        objectId: registrationId ?? id,
        result: 'success',
        detail: {
          reason: 'operator',
          displayId: id,
          hadActiveRegistration: registrationId !== null,
        },
      });
      return { revokedRegistrationId: registrationId };
    });
  });

  // Desired vs downloaded vs reported-playing. Built from stored facts and the clock only.
  app.get(ROUTES.displayStatusPattern, async (request): Promise<DeliveryStatusView> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    return withOrg(pool, session.orgId, async (tx) => {
      const display = await loadDisplay(tx, id);
      if (display === null) throw notFound('The display');
      const delivery = await tx.query<DeliveryRow>(
        `SELECT ${DELIVERY_COLUMNS} FROM display_delivery
         WHERE display_id = $1 AND org_id = app_org_id()`,
        [id],
      );
      const row = delivery.rows[0];
      return buildDeliveryStatusView({
        displayId: id,
        activeRegistrationId: display.registration_id,
        desired:
          row === undefined || row.desired_publication_id === null || row.desired_at === null
            ? null
            : { publicationId: row.desired_publication_id, publishedAt: iso(row.desired_at) },
        reported: reportedStateOf(row),
        now: ctx.now(),
        staleAfterSeconds: config.limits.heartbeatStaleAfterSeconds,
      });
    });
  });
}
