/**
 * Sites, displays, pairing claim, player revocation and delivery status.
 * Every query runs inside withOrg with the organisation of the verified session.
 */
import {
  ABSOLUTE,
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
  type DeliveryStatusListResponse,
  type DeliveryStatusView,
  type DisplayDto,
  type DisplayListResponse,
  type Limits,
  type PairingClaimResponse,
  type Rect,
  type RevokePlayerResponse,
  type Rotation,
  type SiteListResponse,
  type WorkingHours,
} from '@tinnox/contracts';
import {
  auditScoped,
  pairingClaim,
  STAGE_A_CONSTRAINTS,
  violatedConstraint,
  withOrg,
  type Tx,
} from '@tinnox/db';
import { buildDeliveryStatusView, type ReportedState } from '@tinnox/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { operatorOf } from '../auth/session.ts';
import { perMinute, type AppContext } from '../context.ts';
import { accept, bigintToNumber, iso, isoOrNull, refuse, withOrgDecision } from '../db-helpers.ts';
import { HttpError, notFound, parseInput, pgErrorCode } from '../errors.ts';
import { isUnknownTag, replaceTags } from './tags.ts';

interface DisplayRow {
  id: string;
  site_id: string;
  name: string;
  description: string | null;
  canvas_width: number;
  canvas_height: number;
  content_x: number | null;
  content_y: number | null;
  content_width: number | null;
  content_height: number | null;
  default_fit: 'contain' | 'cover';
  route: 'browser';
  rotation: Rotation;
  working_hours: WorkingHours | null;
  created_at: Date;
  updated_at: Date;
  registration_id: string | null;
  registered_at: Date | null;
  tag_ids: string[];
  assigned_playlist_id: string | null;
  /** Null when nothing is assigned. A deleted playlist cannot be assigned. */
  assigned_playlist_name: string | null;
}

const DISPLAY_SELECT = `
  SELECT d.id, d.site_id, d.name, d.description, d.canvas_width, d.canvas_height,
         d.content_x, d.content_y, d.content_width, d.content_height,
         d.default_fit, d.route, d.rotation, d.working_hours, d.created_at, d.updated_at,
         pr.id AS registration_id, pr.created_at AS registered_at,
         ARRAY(SELECT dt.tag_id FROM display_tag dt
               WHERE dt.display_id = d.id AND dt.org_id = d.org_id
               ORDER BY dt.created_at, dt.tag_id)::text[] AS tag_ids,
         ap.id AS assigned_playlist_id, ap.name AS assigned_playlist_name
  FROM display d
  LEFT JOIN player_registration pr
    ON pr.display_id = d.id AND pr.org_id = d.org_id AND pr.revoked_at IS NULL
  LEFT JOIN playlist ap
    ON ap.id = d.assigned_playlist_id AND ap.org_id = d.org_id AND ap.deleted_at IS NULL
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
    description: row.description,
    canvas: { width: row.canvas_width, height: row.canvas_height },
    contentRect: contentRectOf(row),
    defaultFit: row.default_fit,
    rotation: row.rotation,
    workingHours: row.working_hours,
    route: row.route,
    player:
      row.registration_id === null || row.registered_at === null
        ? null
        : { registrationId: row.registration_id, registeredAt: iso(row.registered_at) },
    tagIds: row.tag_ids.slice(0, ABSOLUTE.maxTagsPerItem),
    assignedPlaylist:
      row.assigned_playlist_id === null || row.assigned_playlist_name === null
        ? null
        : { id: row.assigned_playlist_id, name: row.assigned_playlist_name },
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

type StatusRow = DeliveryRow & { display_id: string; registration_id: string | null };

/**
 * The delivery status view of one display (`displayId`) or of every display of
 * the organisation (null), in the order of the display list. One query either
 * way; a display that never had a publication or a report simply has no
 * delivery columns. At most `ABSOLUTE.maxListItems` displays are returned.
 */
export async function loadStatusViews(
  tx: Tx,
  ctx: AppContext,
  displayId: string | null,
): Promise<DeliveryStatusView[]> {
  const { rows } = await tx.query<StatusRow>(
    `SELECT d.id AS display_id, pr.id AS registration_id,
            dd.desired_publication_id, dd.desired_at, dd.reporting_registration_id, dd.last_seq,
            dd.downloaded_publication_id, dd.active_publication_id, dd.active_item_index,
            dd.player_state, dd.staging, dd.last_errors, dd.last_heartbeat_at
     FROM display d
     LEFT JOIN player_registration pr
       ON pr.display_id = d.id AND pr.org_id = d.org_id AND pr.revoked_at IS NULL
     LEFT JOIN display_delivery dd ON dd.display_id = d.id AND dd.org_id = d.org_id
     WHERE d.org_id = app_org_id() AND ($1::uuid IS NULL OR d.id = $1::uuid)
     ORDER BY d.created_at, d.id
     LIMIT $2`,
    [displayId, ABSOLUTE.maxListItems],
  );
  const now = ctx.now();
  return rows.map((row) =>
    buildDeliveryStatusView({
      displayId: row.display_id,
      activeRegistrationId: row.registration_id,
      desired:
        row.desired_publication_id === null || row.desired_at === null
          ? null
          : { publicationId: row.desired_publication_id, publishedAt: iso(row.desired_at) },
      reported: reportedStateOf(row),
      now,
      staleAfterSeconds: ctx.config.limits.heartbeatStaleAfterSeconds,
    }),
  );
}

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
      if (row === null) throw notFound('The screen');
      return toDisplayDto(row);
    });
  });

  /**
   * Partial update. Assigning a playlist changes nothing on the display: what
   * it plays stays its current publication until a push (decision P2-05).
   */
  app.patch(ROUTES.displayPattern, async (request): Promise<DisplayDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    const patch = parseInput(DisplayPatchSchema, request.body, 'display');
    try {
      return await withOrg(pool, session.orgId, async (tx) => {
        const locked = await tx.query<{
          name: string;
          description: string | null;
          canvas_width: number;
          canvas_height: number;
          content_x: number | null;
          content_y: number | null;
          content_width: number | null;
          content_height: number | null;
          default_fit: 'contain' | 'cover';
          assigned_playlist_id: string | null;
          rotation: Rotation;
          working_hours: WorkingHours | null;
        }>(
          `SELECT d.name, d.description, d.canvas_width, d.canvas_height,
                  d.content_x, d.content_y, d.content_width, d.content_height,
                  d.default_fit, d.assigned_playlist_id, d.rotation, d.working_hours
           FROM display d WHERE d.id = $1 AND d.org_id = app_org_id() FOR UPDATE`,
          [id],
        );
        const current = locked.rows[0];
        if (current === undefined) throw notFound('The screen');
        // The combined result is re-checked: a canvas change can push an existing rectangle out of bounds.
        const spec = parseInput(
          CanvasSpecSchema,
          {
            canvas: patch.canvas ?? { width: current.canvas_width, height: current.canvas_height },
            contentRect:
              patch.contentRect === undefined ? contentRectOf(current) : patch.contentRect,
          },
          'display',
        );
        assertCanvasWithinLimits(spec.canvas, config.limits);

        const assign = patch.assignedPlaylistId;
        if (assign !== undefined && assign !== null) {
          // Held until commit, so the playlist cannot be deleted under the assignment.
          const playlist = await tx.query(
            `SELECT 1 FROM playlist
             WHERE id = $1 AND org_id = app_org_id() AND deleted_at IS NULL FOR SHARE`,
            [assign],
          );
          if (playlist.rowCount !== 1) throw notFound('The playlist');
        }

        // A change of tags alone leaves the row, and so its updated_at, as it is.
        const { tagIds, ...columns } = patch;
        if (Object.keys(columns).length > 0) {
          // Stringified, as node-postgres would send a JS array as a PostgreSQL
          // array; null stays SQL NULL (always on), never the jsonb 'null'.
          const hours =
            patch.workingHours === undefined ? current.working_hours : patch.workingHours;
          await tx.query(
            `UPDATE display
             SET name = $2, canvas_width = $3, canvas_height = $4,
                 content_x = $5, content_y = $6, content_width = $7, content_height = $8,
                 default_fit = $9, description = $10, assigned_playlist_id = $11,
                 rotation = $12, working_hours = $13::jsonb
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
              patch.description === undefined ? current.description : patch.description,
              assign === undefined ? current.assigned_playlist_id : assign,
              patch.rotation ?? current.rotation,
              hours === null ? null : JSON.stringify(hours),
            ],
          );
        }
        if (tagIds !== undefined) await replaceTags(tx, 'display', id, tagIds);

        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'display.update',
          objectType: 'display',
          objectId: id,
          result: 'success',
          detail: {
            fields: Object.keys(patch).sort(),
            // Lower case, as the database stores it: one spelling per object in the trail.
            ...(assign === undefined ? {} : { assignedPlaylistId: assign?.toLowerCase() ?? null }),
          },
        });
        const row = await loadDisplay(tx, id);
        if (row === null) throw new Error('updated display is not visible');
        return toDisplayDto(row);
      });
    } catch (error) {
      // The playlist or a tag went away between the check above and the write. The
      // database refuses in both cases; the answer is the same as for an unknown id.
      const constraint = violatedConstraint(error);
      const pg = pgErrorCode(error);
      if (
        (pg === '23503' && constraint === STAGE_A_CONSTRAINTS.displayAssignedPlaylist) ||
        (pg === '23001' && constraint === STAGE_A_CONSTRAINTS.assignedPlaylistDeleted)
      ) {
        throw notFound('The playlist');
      }
      if (isUnknownTag(error)) throw notFound('The tag');
      throw error;
    }
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
        if (result.outcome === 'display_not_found') throw notFound('The screen');
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
      if (display.rowCount !== 1) throw notFound('The screen');
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
      const [view] = await loadStatusViews(tx, ctx, id);
      if (view === undefined) throw notFound('The screen');
      return view;
    });
  });

  // The same view for every display, in the order of the display list, in one query.
  app.get(ROUTES.displaysStatus, async (request): Promise<DeliveryStatusListResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => ({
      items: await loadStatusViews(tx, ctx, null),
    }));
  });
}
