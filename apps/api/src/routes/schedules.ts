/**
 * Schedules (stage B, slice 3): a named timetable with a default playlist and an
 * ordered list of weekly events. A schedule is an editable draft, as a playlist
 * is: a push copies everything a player needs into an immutable publication
 * (../publishing.ts), so editing or deleting a schedule never changes what a
 * display is playing.
 *
 * Events are checked from the top and the first one that covers a moment wins,
 * so overlapping events are allowed: the order of the list decides.
 */
import {
  ABSOLUTE,
  IdParamSchema,
  ROUTES,
  ScheduleInputSchema,
  type ScheduleDto,
  type ScheduleInput,
  type ScheduleListResponse,
  type ScheduleSummaryDto,
} from '@tinnox/contracts';
import { auditScoped, withOrg, type Tx } from '@tinnox/db';
import type { FastifyInstance } from 'fastify';
import { operatorOf, type OperatorSession } from '../auth/session.ts';
import type { AppContext } from '../context.ts';
import { bigintToNumber, iso } from '../db-helpers.ts';
import { HttpError, notFound, parseInput, pgErrorCode } from '../errors.ts';

interface ScheduleRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  default_playlist_id: string;
  default_playlist_name: string;
  event_count: string;
  assigned_display_count: string;
}

/** Select list for `SCHEDULE_FROM`. A playlist that a schedule uses cannot be deleted (0008). */
const SCHEDULE_COLUMNS = `s.id, s.name, s.description, s.created_at, s.updated_at,
  dp.id AS default_playlist_id, dp.name AS default_playlist_name,
  (SELECT count(*) FROM schedule_event e
   WHERE e.schedule_id = s.id AND e.org_id = s.org_id) AS event_count,
  (SELECT count(*) FROM display d
   WHERE d.assigned_schedule_id = s.id AND d.org_id = s.org_id) AS assigned_display_count`;

const SCHEDULE_FROM = `schedule s
  JOIN playlist dp ON dp.id = s.default_playlist_id AND dp.org_id = s.org_id`;

/** The fields a schedule and its list row share. */
function scheduleFacts(row: ScheduleRow): Omit<ScheduleSummaryDto, 'eventCount'> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    defaultPlaylist: { id: row.default_playlist_id, name: row.default_playlist_name },
    assignedDisplayCount: bigintToNumber(row.assigned_display_count),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function loadScheduleDto(tx: Tx, id: string): Promise<ScheduleDto | null> {
  const schedule = await tx.query<ScheduleRow>(
    `SELECT ${SCHEDULE_COLUMNS} FROM ${SCHEDULE_FROM}
     WHERE s.id = $1 AND s.org_id = app_org_id()`,
    [id],
  );
  const row = schedule.rows[0];
  if (row === undefined) return null;
  // node-postgres returns boolean[] as a JavaScript array.
  const events = await tx.query<{
    playlist_id: string;
    playlist_name: string;
    days: boolean[];
    start_time: string;
    end_time: string;
  }>(
    `SELECT e.playlist_id, p.name AS playlist_name, e.days, e.start_time, e.end_time
     FROM schedule_event e
     JOIN playlist p ON p.id = e.playlist_id AND p.org_id = e.org_id
     WHERE e.schedule_id = $1 AND e.org_id = app_org_id()
     ORDER BY e.position`,
    [id],
  );
  return {
    ...scheduleFacts(row),
    events: events.rows.map((event) => ({
      playlist: { id: event.playlist_id, name: event.playlist_name },
      days: event.days,
      start: event.start_time,
      end: event.end_time,
    })),
  };
}

/**
 * Writes the whole schedule: a new one (`id` null) or a replacement of `id`.
 * Returns null when the schedule to replace does not exist.
 */
async function saveSchedule(
  tx: Tx,
  session: OperatorSession,
  id: string | null,
  input: ScheduleInput,
): Promise<ScheduleDto | null> {
  if (id !== null) {
    // Held until commit. A push takes a share lock on the same row before it reads
    // the events (loadScheduleDrafts), so it publishes this edit whole or not at all.
    const locked = await tx.query(
      'SELECT 1 FROM schedule WHERE id = $1 AND org_id = app_org_id() FOR UPDATE',
      [id],
    );
    if (locked.rowCount !== 1) return null;
  }

  // Identifiers compare without regard to letter case and the database answers in
  // lower case. Lowered once here; only these values are used from here on.
  const defaultPlaylistId = input.defaultPlaylistId.toLowerCase();
  const events = input.events.map((event) => ({
    ...event,
    playlistId: event.playlistId.toLowerCase(),
  }));

  // Every playlist must be live. Held until commit, so none can be deleted under the write.
  const live = await tx.query<{ id: string }>(
    `SELECT id FROM playlist
     WHERE org_id = app_org_id() AND deleted_at IS NULL AND id = ANY($1::uuid[]) FOR SHARE`,
    [[...new Set([defaultPlaylistId, ...events.map((event) => event.playlistId)])]],
  );
  const known = new Set(live.rows.map((row) => row.id));
  // Dotted paths, as parseInput names every other field of this body (ScheduleInputSchema).
  const missing = [
    ...(known.has(defaultPlaylistId) ? [] : ['defaultPlaylistId']),
    ...events.flatMap((event, n) =>
      known.has(event.playlistId) ? [] : [`events.${n}.playlistId`],
    ),
  ];
  if (missing.length > 0) {
    throw new HttpError(
      400,
      'validation_failed',
      'A playlist in this schedule does not exist or was deleted.',
      { details: missing.map((path) => ({ path, message: 'The playlist was not found.' })) },
    );
  }

  let scheduleId: string;
  if (id === null) {
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO schedule (org_id, name, description, default_playlist_id)
       VALUES (app_org_id(), $1, $2, $3) RETURNING id`,
      [input.name, input.description ?? null, defaultPlaylistId],
    );
    const created = inserted.rows[0]?.id;
    if (created === undefined) throw new Error('schedule insert returned no row');
    scheduleId = created;
  } else {
    scheduleId = id;
    // Event rows are replaced as a set: they have no UPDATE grant (migration 0008).
    await tx.query('DELETE FROM schedule_event WHERE schedule_id = $1 AND org_id = app_org_id()', [
      id,
    ]);
    // Always touches the row, so updated_at reflects event changes too.
    await tx.query(
      `UPDATE schedule
       SET name = $2, description = CASE WHEN $3::boolean THEN $4::text ELSE description END,
           default_playlist_id = $5
       WHERE id = $1 AND org_id = app_org_id()`,
      [
        id,
        input.name,
        input.description !== undefined,
        input.description ?? null,
        defaultPlaylistId,
      ],
    );
  }
  if (events.length > 0) {
    // A two-dimensional array cannot go through unnest, so the days travel as text literals.
    await tx.query(
      `INSERT INTO schedule_event
         (schedule_id, position, org_id, playlist_id, days, start_time, end_time)
       SELECT $1, (t.ordinal - 1)::int, app_org_id(), t.playlist_id, t.days::boolean[],
              t.start_time, t.end_time
       FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[])
            WITH ORDINALITY AS t(playlist_id, days, start_time, end_time, ordinal)`,
      [
        scheduleId,
        events.map((event) => event.playlistId),
        events.map((event) => `{${event.days.map((d) => (d ? 't' : 'f')).join(',')}}`),
        events.map((event) => event.start),
        events.map((event) => event.end),
      ],
    );
  }
  await auditScoped(tx, {
    actorType: 'operator',
    actorId: session.membershipId,
    action: id === null ? 'schedule.create' : 'schedule.update',
    objectType: 'schedule',
    objectId: scheduleId,
    result: 'success',
    // Ids and a count, never names.
    detail: { defaultPlaylistId, eventCount: events.length },
  });
  const dto = await loadScheduleDto(tx, scheduleId);
  if (dto === null) throw new Error('saved schedule is not visible');
  return dto;
}

/** A playlist went away between the check in `saveSchedule` and the write: the database refuses. */
function playlistDeletedMeanwhile(error: unknown): HttpError | null {
  const pg = pgErrorCode(error);
  return pg === '23503' || pg === '23001'
    ? new HttpError(
        409,
        'conflict',
        'A playlist in this schedule was deleted meanwhile. Reload and try again.',
      )
    : null;
}

const scheduleInUse = (message: string, details?: { path: string; message: string }[]): HttpError =>
  new HttpError(409, 'schedule_in_use', message, details === undefined ? {} : { details });

export function registerScheduleRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { pool } = ctx;

  // shortcut: no pagination, the list is capped at ABSOLUTE.maxListItems; page it when an organisation has more schedules than that.
  app.get(ROUTES.schedules, async (request): Promise<ScheduleListResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<ScheduleRow>(
        `SELECT ${SCHEDULE_COLUMNS} FROM ${SCHEDULE_FROM}
         WHERE s.org_id = app_org_id()
         ORDER BY lower(s.name), s.id
         LIMIT $1`,
        [ABSOLUTE.maxListItems],
      );
      return {
        items: rows.map((row) => ({
          ...scheduleFacts(row),
          eventCount: bigintToNumber(row.event_count),
        })),
      };
    });
  });

  app.post(ROUTES.schedules, async (request, reply): Promise<ScheduleDto> => {
    const session = operatorOf(request);
    const input = parseInput(ScheduleInputSchema, request.body, 'schedule');
    try {
      const dto = await withOrg(pool, session.orgId, (tx) =>
        saveSchedule(tx, session, null, input),
      );
      if (dto === null) throw new Error('created schedule is not visible');
      void reply.code(201);
      return dto;
    } catch (error) {
      throw playlistDeletedMeanwhile(error) ?? error;
    }
  });

  app.get(ROUTES.schedulePattern, async (request): Promise<ScheduleDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    return withOrg(pool, session.orgId, async (tx) => {
      const dto = await loadScheduleDto(tx, id);
      if (dto === null) throw notFound('The schedule');
      return dto;
    });
  });

  // Replaces the whole document: the name, the default playlist and every event, in
  // one transaction. The description is replaced only when the request carries it
  // (null clears it), as the playlist PUT does.
  app.put(ROUTES.schedulePattern, async (request): Promise<ScheduleDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    const input = parseInput(ScheduleInputSchema, request.body, 'schedule');
    try {
      return await withOrg(pool, session.orgId, async (tx) => {
        const dto = await saveSchedule(tx, session, id, input);
        if (dto === null) throw notFound('The schedule');
        return dto;
      });
    } catch (error) {
      throw playlistDeletedMeanwhile(error) ?? error;
    }
  });

  // Refused while a display has the schedule assigned: the operator assigns other
  // content first, so no display is left pointing at nothing by accident.
  // Publications hold a copy of everything, so they are not affected.
  app.delete(ROUTES.schedulePattern, async (request, reply) => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    try {
      await withOrg(pool, session.orgId, async (tx) => {
        const locked = await tx.query<{ event_count: string }>(
          `SELECT (SELECT count(*) FROM schedule_event e
                   WHERE e.schedule_id = s.id AND e.org_id = s.org_id) AS event_count
           FROM schedule s WHERE s.id = $1 AND s.org_id = app_org_id() FOR UPDATE`,
          [id],
        );
        const current = locked.rows[0];
        if (current === undefined) throw notFound('The schedule');
        const assigned = await tx.query<{ name: string }>(
          `SELECT d.name FROM display d
           WHERE d.assigned_schedule_id = $1 AND d.org_id = app_org_id()
           ORDER BY lower(d.name), d.id LIMIT 5`,
          [id],
        );
        if (assigned.rows.length > 0) {
          throw scheduleInUse(
            'This schedule is assigned to a screen. Assign other content to the screen first.',
            assigned.rows.map((r) => ({ path: 'display', message: r.name })),
          );
        }
        // The events go with it (ON DELETE CASCADE).
        await tx.query('DELETE FROM schedule WHERE id = $1 AND org_id = app_org_id()', [id]);
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'schedule.delete',
          objectType: 'schedule',
          objectId: id,
          result: 'success',
          detail: { eventCount: bigintToNumber(current.event_count) },
        });
      });
    } catch (error) {
      // A display took the schedule between the check above and the delete.
      if (pgErrorCode(error) === '23503') {
        throw scheduleInUse('This schedule has just been assigned to a screen. Try again.');
      }
      throw error;
    }
    return reply.code(204).send();
  });
}
