/**
 * Push to displays (portal v2 decision P2-05: assign, then push).
 *
 * Editing a playlist, a schedule or a layout, or assigning one, changes nothing on a
 * display. A push builds one immutable publication per chosen display, through the
 * same code as `POST /api/playlists/:id/publish` (../publishing.ts), and only where the
 * publication that would be built differs from the one the display already has.
 */
import {
  ABSOLUTE,
  PushRequestSchema,
  ROUTES,
  isPushPending,
  type PushPlanResponse,
  type PushPlanRow,
  type PushResponse,
  type PushResult,
} from '@tinnox/contracts';
import { withOrg, type Tx } from '@tinnox/db';
import type { FastifyInstance } from 'fastify';
import { operatorOf, type OperatorSession } from '../auth/session.ts';
import { perMinute, type AppContext } from '../context.ts';
import { iso } from '../db-helpers.ts';
import { HttpError, notFound, parseInput, pgErrorCode } from '../errors.ts';
import {
  assessDisplays,
  auditRejectedPublication,
  createPublication,
  DISPLAY_PLAN_COLUMNS,
  findPublicationByKey,
  idempotencyKeyOf,
  issueDetails,
  lockDisplayForPublish,
  lockPublishKey,
  type DisplayAssessment,
  type DisplayPlanRow,
} from '../publishing.ts';

function toPlanRow(assessment: DisplayAssessment): PushPlanRow {
  return {
    display: { id: assessment.display.id, name: assessment.display.name },
    playlist: assessment.playlist,
    schedule: assessment.schedule,
    layout: assessment.layout,
    state: assessment.state,
    issues: issueDetails(assessment.issues),
    lastPushedAt: assessment.current === null ? null : iso(assessment.current.createdAt),
  };
}

/**
 * The push plan of the organisation: one assessment per display, in the order
 * of the display list. At most `ABSOLUTE.maxListItems` displays are assessed.
 */
export async function loadPushPlan(tx: Tx, ctx: AppContext): Promise<DisplayAssessment[]> {
  const { rows } = await tx.query<DisplayPlanRow>(
    `SELECT ${DISPLAY_PLAN_COLUMNS} FROM display d
     WHERE d.org_id = app_org_id()
     ORDER BY d.created_at, d.id
     LIMIT $1`,
    [ABSOLUTE.maxListItems],
  );
  return assessDisplays(tx, ctx, rows, { lock: false, keepDraft: false });
}

/** How many displays a push would act on: the rows in `never_pushed` or `changes`. */
export function pendingCount(assessments: readonly DisplayAssessment[]): number {
  return assessments.filter((assessment) => isPushPending(assessment.state)).length;
}

export function registerPushRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { pool } = ctx;

  app.get(ROUTES.push, async (request): Promise<PushPlanResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => {
      const assessments = await loadPushPlan(tx, ctx);
      return { items: assessments.map(toPlanRow), pendingCount: pendingCount(assessments) };
    });
  });

  /**
   * Pushes to one display, in its own transaction. The Idempotency-Key of the
   * request is reused per display under the same lock as publishing, so a
   * repeat of the request finds the publication it made and creates nothing.
   */
  function pushDisplay(
    session: OperatorSession,
    displayId: string,
    key: string,
  ): Promise<PushResult> {
    return withOrg(pool, session.orgId, async (tx): Promise<PushResult> => {
      await lockPublishKey(tx, displayId, key);
      // Checked before anything else, so a repeat answers as the first call did
      // even when the display would by now count as up to date.
      const previous = await findPublicationByKey(tx, displayId, key);
      if (previous !== null) {
        return { displayId, outcome: 'published', publicationId: previous.id, issues: [] };
      }
      const display = await lockDisplayForPublish(tx, displayId);
      if (display === null) throw notFound('The screen');
      const [assessment] = await assessDisplays(tx, ctx, [display], {
        lock: true,
        keepDraft: true,
      });
      if (assessment === undefined) throw new Error('a display was not assessed');

      // Still "nothing is assigned": a display with a schedule or a layout carries its
      // default or main-zone playlist here.
      if (assessment.playlist === null) {
        return { displayId, outcome: 'skipped', publicationId: null, issues: [] };
      }
      if (assessment.state === 'blocked') {
        // Nothing is written but the audit event: the display keeps the
        // publication it has, and what it is playing is not interrupted.
        await auditRejectedPublication(tx, {
          membershipId: session.membershipId,
          playlistId: assessment.playlist.id,
          scheduleId: assessment.schedule?.id ?? null,
          layoutId: assessment.layout?.id ?? null,
          displayId,
          issues: assessment.issues,
          via: 'push',
        });
        return {
          displayId,
          outcome: 'rejected',
          publicationId: null,
          issues: issueDetails(assessment.issues),
        };
      }
      if (assessment.state === 'up_to_date' && assessment.current !== null) {
        return {
          displayId,
          outcome: 'unchanged',
          publicationId: assessment.current.publicationId,
          issues: [],
        };
      }
      // Asked for above (`keepDraft`); without it nothing may be published.
      if (assessment.draft === null) throw new Error('a display was assessed without its draft');
      const row = await createPublication(tx, ctx, {
        display,
        playlistId: assessment.playlist.id,
        scheduleId: assessment.schedule?.id ?? null,
        layoutId: assessment.layout?.id ?? null,
        draft: assessment.draft,
        idempotencyKey: key,
        membershipId: session.membershipId,
        via: 'push',
      });
      return { displayId, outcome: 'published', publicationId: row.id, issues: [] };
    });
  }

  app.post(
    ROUTES.push,
    { config: { rateLimit: perMinute(ctx, 30) } },
    async (request): Promise<PushResponse> => {
      const session = operatorOf(request);
      const body = parseInput(PushRequestSchema, request.body, 'push request');
      const key = idempotencyKeyOf(request, 'push');
      // Identifiers compare without regard to letter case; the database returns lower case.
      const displayIds = body.displayIds.map((id) => id.toLowerCase());

      // Every id must be a display of this organisation before anything is written.
      // Another organisation's display is invisible here, so it answers like an unknown id.
      const known = await withOrg(pool, session.orgId, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          'SELECT id FROM display WHERE org_id = app_org_id() AND id = ANY($1::uuid[])',
          [displayIds],
        );
        return rows.length;
      });
      if (known !== displayIds.length) throw notFound('The screen');

      // One display after another: each is its own transaction on one connection, so a
      // large push cannot take the whole pool, and a rejection does not undo the others.
      const results: PushResult[] = [];
      for (const displayId of displayIds) {
        try {
          results.push(await pushDisplay(session, displayId, key));
        } catch (error) {
          const pg = pgErrorCode(error);
          if (pg === '23505') {
            // Lost a race the advisory lock should already prevent; the winner's row is returned.
            results.push(await pushDisplay(session, displayId, key));
          } else if (pg === '23503') {
            // Displays pushed so far keep their publications; a repeat with the same
            // Idempotency-Key returns them and carries on with the rest.
            throw new HttpError(
              409,
              'conflict',
              "Something used by a screen's assigned content changed meanwhile. Nothing is lost: try again.",
            );
          } else {
            throw error;
          }
        }
      }
      return { results };
    },
  );
}
