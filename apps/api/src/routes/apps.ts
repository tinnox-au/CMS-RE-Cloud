/**
 * Built-in apps (stage B, slice 2): Clock, Date, Countdown, Ticker, QR code and
 * Text. An app is a row whose settings are always validated by the contract
 * schema before they are written; its type is fixed for life. Publishing copies
 * the settings into the manifest, so editing or deleting an app never changes a
 * publication.
 */
import {
  ABSOLUTE,
  AppContentSchema,
  AppCreateSchema,
  AppPatchSchema,
  IdParamSchema,
  ROUTES,
  type AppDto,
  type AppListResponse,
} from '@tinnox/contracts';
import { auditScoped, withOrg, type Tx } from '@tinnox/db';
import type { FastifyInstance } from 'fastify';
import { operatorOf } from '../auth/session.ts';
import type { AppContext } from '../context.ts';
import { bigintToNumber, iso } from '../db-helpers.ts';
import { HttpError, notFound, parseInput, pgErrorCode } from '../errors.ts';

export interface AppRow {
  id: string;
  type: string;
  name: string;
  description: string | null;
  settings: unknown;
  created_at: Date;
  updated_at: Date;
  usage_count: string;
}

/** Select list for `app a`; the usage count is the number of live playlists containing it. */
export const APP_COLUMNS = `a.id, a.type, a.name, a.description, a.settings, a.created_at, a.updated_at,
  (SELECT count(DISTINCT i.playlist_id) FROM playlist_item i
   JOIN playlist p ON p.id = i.playlist_id AND p.org_id = i.org_id
   WHERE i.app_id = a.id AND i.org_id = a.org_id AND p.deleted_at IS NULL) AS usage_count`;

/** Stored settings were validated on write, so a failure here is a server fault and throws. */
export function toAppDto(row: AppRow): AppDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: AppContentSchema.parse({ type: row.type, settings: row.settings }),
    usageCount: bigintToNumber(row.usage_count),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function loadApp(tx: Tx, id: string): Promise<AppDto | null> {
  const { rows } = await tx.query<AppRow>(
    `SELECT ${APP_COLUMNS} FROM app a WHERE a.id = $1 AND a.org_id = app_org_id()`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toAppDto(row);
}

const appInUse = (message: string, details?: { path: string; message: string }[]): HttpError =>
  new HttpError(409, 'app_in_use', message, details === undefined ? {} : { details });

export function registerAppRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { pool } = ctx;

  app.get(ROUTES.apps, async (request): Promise<AppListResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<AppRow>(
        `SELECT ${APP_COLUMNS} FROM app a
         WHERE a.org_id = app_org_id()
         ORDER BY lower(a.name), a.id
         LIMIT $1`,
        [ABSOLUTE.maxListItems],
      );
      return { items: rows.map(toAppDto) };
    });
  });

  app.post(ROUTES.apps, async (request, reply): Promise<AppDto> => {
    const session = operatorOf(request);
    const input = parseInput(AppCreateSchema, request.body, 'app');
    const dto = await withOrg(pool, session.orgId, async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO app (org_id, type, name, description, settings)
         VALUES (app_org_id(), $1, $2, $3, $4::jsonb) RETURNING id`,
        [
          input.content.type,
          input.name,
          input.description ?? null,
          JSON.stringify(input.content.settings),
        ],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) throw new Error('app insert returned no row');
      await auditScoped(tx, {
        actorType: 'operator',
        actorId: session.membershipId,
        action: 'app.create',
        objectType: 'app',
        objectId: id,
        result: 'success',
        detail: { type: input.content.type },
      });
      const created = await loadApp(tx, id);
      if (created === null) throw new Error('created app is not visible');
      return created;
    });
    void reply.code(201);
    return dto;
  });

  app.get(ROUTES.appPattern, async (request): Promise<AppDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    return withOrg(pool, session.orgId, async (tx) => {
      const dto = await loadApp(tx, id);
      if (dto === null) throw notFound('The app');
      return dto;
    });
  });

  app.patch(ROUTES.appPattern, async (request): Promise<AppDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    const patch = parseInput(AppPatchSchema, request.body, 'app');
    return withOrg(pool, session.orgId, async (tx) => {
      const locked = await tx.query<{ type: string }>(
        'SELECT type FROM app WHERE id = $1 AND org_id = app_org_id() FOR UPDATE',
        [id],
      );
      const current = locked.rows[0];
      if (current === undefined) throw notFound('The app');
      if (patch.content !== undefined && patch.content.type !== current.type) {
        throw new HttpError(400, 'validation_failed', "An app's type cannot be changed.", {
          details: [{ path: 'content.type', message: `must be ${current.type}` }],
        });
      }
      await tx.query(
        `UPDATE app
         SET name = COALESCE($2, name),
             description = CASE WHEN $3::boolean THEN $4::text ELSE description END,
             settings = COALESCE($5::jsonb, settings)
         WHERE id = $1 AND org_id = app_org_id()`,
        [
          id,
          patch.name ?? null,
          patch.description !== undefined,
          patch.description ?? null,
          patch.content === undefined ? null : JSON.stringify(patch.content.settings),
        ],
      );
      await auditScoped(tx, {
        actorType: 'operator',
        actorId: session.membershipId,
        action: 'app.update',
        objectType: 'app',
        objectId: id,
        result: 'success',
        // Field names only: settings hold operator text.
        detail: { fields: Object.keys(patch).sort() },
      });
      const dto = await loadApp(tx, id);
      if (dto === null) throw new Error('updated app is not visible');
      return dto;
    });
  });

  // Refused while a live playlist contains the app. Publications hold a copy of
  // the settings, so they are not affected.
  app.delete(ROUTES.appPattern, async (request, reply) => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    try {
      await withOrg(pool, session.orgId, async (tx) => {
        const locked = await tx.query<{ type: string }>(
          'SELECT type FROM app WHERE id = $1 AND org_id = app_org_id() FOR UPDATE',
          [id],
        );
        const current = locked.rows[0];
        if (current === undefined) throw notFound('The app');
        const used = await tx.query<{ name: string }>(
          `SELECT p.name FROM playlist p
           WHERE p.org_id = app_org_id() AND p.deleted_at IS NULL
             AND EXISTS (SELECT 1 FROM playlist_item i
                         WHERE i.playlist_id = p.id AND i.org_id = p.org_id AND i.app_id = $1)
           ORDER BY lower(p.name), p.id LIMIT 5`,
          [id],
        );
        if (used.rows.length > 0) {
          throw appInUse(
            'This app is used in a playlist. Remove it from the playlist first.',
            used.rows.map((r) => ({ path: 'playlist', message: r.name.slice(0, 200) })),
          );
        }
        await tx.query('DELETE FROM app WHERE id = $1 AND org_id = app_org_id()', [id]);
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'app.delete',
          objectType: 'app',
          objectId: id,
          result: 'success',
          detail: { type: current.type },
        });
      });
    } catch (error) {
      // A playlist took the app between the check above and the delete.
      if (pgErrorCode(error) === '23503') {
        throw appInUse('This app has just been added to a playlist. Try again.');
      }
      throw error;
    }
    return reply.code(204).send();
  });
}
