/**
 * Flat media folders (portal v2, stage A). A media item is in one folder or in
 * none; deleting a folder moves its media to the root of the library.
 */
import {
  ABSOLUTE,
  FolderCreateSchema,
  FolderPatchSchema,
  IdParamSchema,
  ROUTES,
  type FolderDto,
  type FolderListResponse,
} from '@tinnox/contracts';
import { auditScoped, STAGE_A_CONSTRAINTS, violatedConstraint, withOrg, type Tx } from '@tinnox/db';
import type { FastifyInstance } from 'fastify';
import { operatorOf } from '../auth/session.ts';
import type { AppContext } from '../context.ts';
import { bigintToNumber } from '../db-helpers.ts';
import { HttpError, notFound, parseInput, pgErrorCode } from '../errors.ts';

interface FolderRow {
  id: string;
  name: string;
  item_count: string;
}

/** Select list for `folder f`. Deleted media is not counted. */
const FOLDER_COLUMNS = `f.id, f.name,
  (SELECT count(*) FROM media m
   WHERE m.folder_id = f.id AND m.org_id = f.org_id AND m.deleted_at IS NULL) AS item_count`;

function toFolderDto(row: FolderRow): FolderDto {
  return { id: row.id, name: row.name, itemCount: bigintToNumber(row.item_count) };
}

async function loadFolder(tx: Tx, id: string): Promise<FolderDto | null> {
  const { rows } = await tx.query<FolderRow>(
    `SELECT ${FOLDER_COLUMNS} FROM folder f WHERE f.id = $1 AND f.org_id = app_org_id()`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toFolderDto(row);
}

const nameTaken = (): HttpError =>
  new HttpError(409, 'conflict', 'Another folder already has that name.');

function isNameTaken(error: unknown): boolean {
  return (
    pgErrorCode(error) === '23505' &&
    violatedConstraint(error) === STAGE_A_CONSTRAINTS.folderNameTaken
  );
}

export function registerFolderRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { pool } = ctx;

  app.get(ROUTES.folders, async (request): Promise<FolderListResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<FolderRow>(
        `SELECT ${FOLDER_COLUMNS} FROM folder f
         WHERE f.org_id = app_org_id()
         ORDER BY lower(f.name), f.id
         LIMIT $1`,
        [ABSOLUTE.maxListItems],
      );
      return { items: rows.map(toFolderDto) };
    });
  });

  app.post(ROUTES.folders, async (request, reply): Promise<FolderDto> => {
    const session = operatorOf(request);
    const input = parseInput(FolderCreateSchema, request.body, 'folder');
    let created: FolderDto;
    try {
      created = await withOrg(pool, session.orgId, async (tx) => {
        // One at a time per organisation, so the ceiling below cannot be passed by a burst.
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('tinnox.folder_count:' || app_org_id()::text, 0))",
        );
        const existing = await tx.query<{ n: string }>(
          'SELECT count(*) AS n FROM folder WHERE org_id = app_org_id()',
        );
        if (bigintToNumber(existing.rows[0]?.n ?? 0) >= ABSOLUTE.maxListItems) {
          throw new HttpError(
            409,
            'conflict',
            `The organisation already has ${ABSOLUTE.maxListItems} folders, which is the most it can have. Delete folders that are no longer used.`,
          );
        }
        const inserted = await tx.query<{ id: string }>(
          'INSERT INTO folder (org_id, name) VALUES (app_org_id(), $1) RETURNING id',
          [input.name],
        );
        const id = inserted.rows[0]?.id;
        if (id === undefined) throw new Error('folder insert returned no row');
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'folder.create',
          objectType: 'folder',
          objectId: id,
          result: 'success',
          detail: null,
        });
        const dto = await loadFolder(tx, id);
        if (dto === null) throw new Error('created folder is not visible');
        return dto;
      });
    } catch (error) {
      if (isNameTaken(error)) throw nameTaken();
      throw error;
    }
    void reply.code(201);
    return created;
  });

  app.patch(ROUTES.folderPattern, async (request): Promise<FolderDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    const patch = parseInput(FolderPatchSchema, request.body, 'folder');
    try {
      return await withOrg(pool, session.orgId, async (tx) => {
        const updated = await tx.query(
          'UPDATE folder SET name = $2 WHERE id = $1 AND org_id = app_org_id()',
          [id, patch.name],
        );
        if (updated.rowCount !== 1) throw notFound('The folder');
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'folder.update',
          objectType: 'folder',
          objectId: id,
          result: 'success',
          detail: { fields: ['name'] },
        });
        const dto = await loadFolder(tx, id);
        if (dto === null) throw new Error('updated folder is not visible');
        return dto;
      });
    } catch (error) {
      if (isNameTaken(error)) throw nameTaken();
      throw error;
    }
  });

  // The media in the folder moves to the root: the foreign key sets folder_id to NULL.
  app.delete(ROUTES.folderPattern, async (request, reply) => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    await withOrg(pool, session.orgId, async (tx) => {
      const current = await tx.query<FolderRow>(
        `SELECT ${FOLDER_COLUMNS} FROM folder f
         WHERE f.id = $1 AND f.org_id = app_org_id() FOR UPDATE OF f`,
        [id],
      );
      const row = current.rows[0];
      if (row === undefined) throw notFound('The folder');
      await tx.query('DELETE FROM folder WHERE id = $1 AND org_id = app_org_id()', [id]);
      await auditScoped(tx, {
        actorType: 'operator',
        actorId: session.membershipId,
        action: 'folder.delete',
        objectType: 'folder',
        objectId: id,
        result: 'success',
        detail: { movedToRoot: bigintToNumber(row.item_count) },
      });
    });
    return reply.code(204).send();
  });
}
