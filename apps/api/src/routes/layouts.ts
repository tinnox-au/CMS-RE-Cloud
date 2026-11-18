/**
 * Layouts (stage B, slice 4): a named split of a screen into two to four zones, each a
 * rectangle in basis points of the screen's content area with its own playlist; zone 0
 * is the main zone. A layout is an editable draft, as a playlist is: a push copies every
 * zone into an immutable publication (../publishing.ts, manifest version 5), so editing
 * or deleting a layout never changes what a display is playing.
 */
import {
  ABSOLUTE,
  IdParamSchema,
  LayoutInputSchema,
  ROUTES,
  type LayoutDto,
  type LayoutInput,
  type LayoutListResponse,
} from '@tinnox/contracts';
import { auditScoped, withOrg, type Tx } from '@tinnox/db';
import type { FastifyInstance } from 'fastify';
import { operatorOf, type OperatorSession } from '../auth/session.ts';
import type { AppContext } from '../context.ts';
import { bigintToNumber, iso } from '../db-helpers.ts';
import { HttpError, notFound, parseInput, pgErrorCode } from '../errors.ts';

interface LayoutZoneRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  assigned_display_count: string;
  playlist_id: string;
  playlist_name: string;
  x_bp: number;
  y_bp: number;
  width_bp: number;
  height_bp: number;
}

/**
 * Every layout of the organisation (`id` null) or one, with its zones, in one statement:
 * one snapshot, so the DTO never sees a zone set half replaced by a PUT. Inner joins: a
 * layout written through the API always has two to four zones and a zone's playlist cannot
 * be deleted; a layout without zones (direct SQL only) is left out.
 */
async function loadLayouts(tx: Tx, id: string | null): Promise<LayoutDto[]> {
  const { rows } = await tx.query<LayoutZoneRow>(
    `WITH l AS (
       SELECT l.id, l.name, l.description, l.created_at, l.updated_at,
              (SELECT count(*) FROM display d
               WHERE d.assigned_layout_id = l.id AND d.org_id = l.org_id) AS assigned_display_count
       FROM layout l
       WHERE l.org_id = app_org_id() AND ($2::uuid IS NULL OR l.id = $2::uuid)
       ORDER BY lower(l.name), l.id
       LIMIT $1
     )
     SELECT l.id, l.name, l.description, l.created_at, l.updated_at, l.assigned_display_count,
            p.id AS playlist_id, p.name AS playlist_name, z.x_bp, z.y_bp, z.width_bp, z.height_bp
     FROM l
     JOIN layout_zone z ON z.layout_id = l.id AND z.org_id = app_org_id()
     JOIN playlist p ON p.id = z.playlist_id AND p.org_id = z.org_id
     ORDER BY lower(l.name), l.id, z.position`,
    [ABSOLUTE.maxListItems, id],
  );
  const layouts: LayoutDto[] = [];
  for (const row of rows) {
    const zone = {
      playlist: { id: row.playlist_id, name: row.playlist_name },
      x: row.x_bp,
      y: row.y_bp,
      width: row.width_bp,
      height: row.height_bp,
    };
    const last = layouts.at(-1);
    if (last?.id === row.id) {
      last.zones.push(zone);
    } else {
      layouts.push({
        id: row.id,
        name: row.name,
        description: row.description,
        zones: [zone],
        assignedDisplayCount: bigintToNumber(row.assigned_display_count),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      });
    }
  }
  return layouts;
}

/**
 * Writes the whole layout: a new one (`id` null) or a replacement of `id`.
 * Returns null when the layout to replace does not exist.
 */
async function saveLayout(
  tx: Tx,
  session: OperatorSession,
  id: string | null,
  input: LayoutInput,
): Promise<LayoutDto | null> {
  if (id !== null) {
    // Held until commit. A push takes a share lock on the same row before it reads
    // the zones (loadLayoutDrafts), so it publishes this edit whole or not at all.
    const locked = await tx.query(
      'SELECT 1 FROM layout WHERE id = $1 AND org_id = app_org_id() FOR UPDATE',
      [id],
    );
    if (locked.rowCount !== 1) return null;
  }

  // Identifiers compare without regard to letter case and the database answers in
  // lower case. Lowered once here; only these values are used from here on.
  const zones = input.zones.map((zone) => ({ ...zone, playlistId: zone.playlistId.toLowerCase() }));

  // Every playlist must be live. Held until commit, so none can be deleted under the write.
  // Another organisation's playlist is invisible here, so it is answered as an unknown one.
  const live = await tx.query<{ id: string }>(
    `SELECT id FROM playlist
     WHERE org_id = app_org_id() AND deleted_at IS NULL AND id = ANY($1::uuid[]) FOR SHARE`,
    [[...new Set(zones.map((zone) => zone.playlistId))]],
  );
  const known = new Set(live.rows.map((row) => row.id));
  // Dotted paths, as parseInput names every other field of this body (LayoutInputSchema).
  const missing = zones.flatMap((zone, n) =>
    known.has(zone.playlistId) ? [] : [`zones.${n}.playlistId`],
  );
  if (missing.length > 0) {
    throw new HttpError(
      400,
      'validation_failed',
      'A playlist in this layout does not exist or was deleted.',
      { details: missing.map((path) => ({ path, message: 'The playlist was not found.' })) },
    );
  }

  let layoutId: string;
  if (id === null) {
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO layout (org_id, name, description)
       VALUES (app_org_id(), $1, $2) RETURNING id`,
      [input.name, input.description ?? null],
    );
    const created = inserted.rows[0]?.id;
    if (created === undefined) throw new Error('layout insert returned no row');
    layoutId = created;
  } else {
    layoutId = id;
    // Zone rows are replaced as a set: they have no UPDATE grant (migration 0011).
    await tx.query('DELETE FROM layout_zone WHERE layout_id = $1 AND org_id = app_org_id()', [id]);
    // Always touches the row, so updated_at reflects zone changes too.
    await tx.query(
      `UPDATE layout
       SET name = $2, description = CASE WHEN $3::boolean THEN $4::text ELSE description END
       WHERE id = $1 AND org_id = app_org_id()`,
      [id, input.name, input.description !== undefined, input.description ?? null],
    );
  }
  // Position 0 is the main zone.
  await tx.query(
    `INSERT INTO layout_zone (layout_id, position, org_id, playlist_id, x_bp, y_bp, width_bp, height_bp)
     SELECT $1, (t.ordinal - 1)::int, app_org_id(), t.playlist_id, t.x_bp, t.y_bp, t.width_bp, t.height_bp
     FROM unnest($2::uuid[], $3::int[], $4::int[], $5::int[], $6::int[])
          WITH ORDINALITY AS t(playlist_id, x_bp, y_bp, width_bp, height_bp, ordinal)`,
    [
      layoutId,
      zones.map((zone) => zone.playlistId),
      zones.map((zone) => zone.x),
      zones.map((zone) => zone.y),
      zones.map((zone) => zone.width),
      zones.map((zone) => zone.height),
    ],
  );
  await auditScoped(tx, {
    actorType: 'operator',
    actorId: session.membershipId,
    action: id === null ? 'layout.create' : 'layout.update',
    objectType: 'layout',
    objectId: layoutId,
    result: 'success',
    // Ids and a count, never names.
    detail: { mainPlaylistId: zones[0]?.playlistId ?? null, zoneCount: zones.length },
  });
  const [dto] = await loadLayouts(tx, layoutId);
  if (dto === undefined) throw new Error('saved layout is not visible');
  return dto;
}

/** A playlist went away between the check in `saveLayout` and the write: the database refuses. */
function playlistDeletedMeanwhile(error: unknown): HttpError | null {
  const pg = pgErrorCode(error);
  return pg === '23503' || pg === '23001'
    ? new HttpError(
        409,
        'conflict',
        'A playlist in this layout was deleted meanwhile. Reload and try again.',
      )
    : null;
}

const layoutInUse = (message: string, details?: { path: string; message: string }[]): HttpError =>
  new HttpError(409, 'layout_in_use', message, details === undefined ? {} : { details });

export function registerLayoutRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { pool } = ctx;

  // shortcut: no pagination, the list is capped at ABSOLUTE.maxListItems; page it when an organisation has more layouts than that.
  app.get(ROUTES.layouts, async (request): Promise<LayoutListResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => ({ items: await loadLayouts(tx, null) }));
  });

  app.post(ROUTES.layouts, async (request, reply): Promise<LayoutDto> => {
    const session = operatorOf(request);
    const input = parseInput(LayoutInputSchema, request.body, 'layout');
    try {
      const dto = await withOrg(pool, session.orgId, (tx) => saveLayout(tx, session, null, input));
      if (dto === null) throw new Error('created layout is not visible');
      void reply.code(201);
      return dto;
    } catch (error) {
      throw playlistDeletedMeanwhile(error) ?? error;
    }
  });

  app.get(ROUTES.layoutPattern, async (request): Promise<LayoutDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    return withOrg(pool, session.orgId, async (tx) => {
      const [dto] = await loadLayouts(tx, id);
      if (dto === undefined) throw notFound('The layout');
      return dto;
    });
  });

  // Replaces the whole document: the name and every zone, in one transaction. The
  // description is replaced only when the request carries it (null clears it), as the
  // schedule PUT does.
  app.put(ROUTES.layoutPattern, async (request): Promise<LayoutDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    const input = parseInput(LayoutInputSchema, request.body, 'layout');
    try {
      return await withOrg(pool, session.orgId, async (tx) => {
        const dto = await saveLayout(tx, session, id, input);
        if (dto === null) throw notFound('The layout');
        return dto;
      });
    } catch (error) {
      throw playlistDeletedMeanwhile(error) ?? error;
    }
  });

  // Refused while a display has the layout assigned: the operator assigns other
  // content first, so no display is left pointing at nothing by accident.
  // Publications hold a copy of everything, so they are not affected.
  app.delete(ROUTES.layoutPattern, async (request, reply) => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    try {
      await withOrg(pool, session.orgId, async (tx) => {
        const locked = await tx.query(
          'SELECT 1 FROM layout WHERE id = $1 AND org_id = app_org_id() FOR UPDATE',
          [id],
        );
        if (locked.rowCount !== 1) throw notFound('The layout');
        const assigned = await tx.query<{ name: string }>(
          `SELECT d.name FROM display d
           WHERE d.assigned_layout_id = $1 AND d.org_id = app_org_id()
           ORDER BY lower(d.name), d.id LIMIT 5`,
          [id],
        );
        if (assigned.rows.length > 0) {
          throw layoutInUse(
            'This layout is assigned to a screen. Assign other content to the screen first.',
            assigned.rows.map((r) => ({ path: 'display', message: r.name })),
          );
        }
        // Counted after the lock: a count read in the locking statement would be the one
        // from before a PUT this delete waited for.
        const zones = await tx.query(
          'DELETE FROM layout_zone WHERE layout_id = $1 AND org_id = app_org_id()',
          [id],
        );
        await tx.query('DELETE FROM layout WHERE id = $1 AND org_id = app_org_id()', [id]);
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'layout.delete',
          objectType: 'layout',
          objectId: id,
          result: 'success',
          detail: { zoneCount: zones.rowCount ?? 0 },
        });
      });
    } catch (error) {
      // A display took the layout between the check above and the delete.
      if (pgErrorCode(error) === '23503') {
        throw layoutInUse('This layout has just been assigned to a screen. Try again.');
      }
      throw error;
    }
    return reply.code(204).send();
  });
}
