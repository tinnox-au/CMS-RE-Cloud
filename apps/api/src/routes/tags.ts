/**
 * Tags for media and for displays (portal v2, stage A). A tag belongs to one
 * scope for life; the database refuses a display tag on media and the reverse.
 */
import {
  ABSOLUTE,
  IdParamSchema,
  ROUTES,
  TagColourSchema,
  TagCreateSchema,
  TagListQuerySchema,
  TagPatchSchema,
  TagScopeSchema,
  type TagDto,
  type TagListResponse,
  type TagScope,
} from '@tinnox/contracts';
import { auditScoped, STAGE_A_CONSTRAINTS, violatedConstraint, withOrg, type Tx } from '@tinnox/db';
import type { FastifyInstance } from 'fastify';
import { operatorOf } from '../auth/session.ts';
import type { AppContext } from '../context.ts';
import { bigintToNumber } from '../db-helpers.ts';
import { HttpError, notFound, parseInput, pgErrorCode } from '../errors.ts';

interface TagRow {
  id: string;
  scope: string;
  name: string;
  colour: string;
  usage_count: string;
}

/**
 * Select list for `tag t`. A media tag counts the media items that carry it and
 * are not deleted; a display tag counts the displays that carry it.
 */
const TAG_COLUMNS = `t.id, t.scope, t.name, t.colour,
  CASE t.scope
    WHEN 'media' THEN (
      SELECT count(*) FROM media_tag mt
      JOIN media m ON m.id = mt.media_id AND m.org_id = mt.org_id
      WHERE mt.tag_id = t.id AND mt.org_id = t.org_id AND m.deleted_at IS NULL)
    ELSE (
      SELECT count(*) FROM display_tag dt
      WHERE dt.tag_id = t.id AND dt.org_id = t.org_id)
  END AS usage_count`;

function toTagDto(row: TagRow): TagDto {
  return {
    id: row.id,
    scope: TagScopeSchema.parse(row.scope),
    name: row.name,
    colour: TagColourSchema.parse(row.colour),
    usageCount: bigintToNumber(row.usage_count),
  };
}

async function loadTag(tx: Tx, id: string): Promise<TagDto | null> {
  const { rows } = await tx.query<TagRow>(
    `SELECT ${TAG_COLUMNS} FROM tag t WHERE t.id = $1 AND t.org_id = app_org_id()`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toTagDto(row);
}

const nameTaken = (): HttpError =>
  new HttpError(409, 'conflict', 'Another tag of this kind already has that name.');

function isNameTaken(error: unknown): boolean {
  return (
    pgErrorCode(error) === '23505' && violatedConstraint(error) === STAGE_A_CONSTRAINTS.tagNameTaken
  );
}

/** The join table of each scope. Fixed text: nothing here comes from a request. */
const TAG_JOIN = {
  media: { table: 'media_tag', target: 'media_id', tagForeignKey: STAGE_A_CONSTRAINTS.mediaTagTag },
  display: {
    table: 'display_tag',
    target: 'display_id',
    tagForeignKey: STAGE_A_CONSTRAINTS.displayTagTag,
  },
} as const satisfies Record<TagScope, unknown>;

/** True when the error says a tag put on something does not exist in this organisation and scope. */
export function isUnknownTag(error: unknown): boolean {
  if (pgErrorCode(error) !== '23503') return false;
  const constraint = violatedConstraint(error);
  return (
    constraint === TAG_JOIN.media.tagForeignKey || constraint === TAG_JOIN.display.tagForeignKey
  );
}

/**
 * Makes `tagIds` the complete set of tags of one media item or one display, in
 * the caller's transaction. The caller has locked the item. A tag that does not
 * exist in this organisation, or belongs to the other scope, answers 404, the
 * same as an id that was never issued.
 */
export async function replaceTags(
  tx: Tx,
  scope: TagScope,
  targetId: string,
  tagIds: readonly string[],
): Promise<void> {
  const join = TAG_JOIN[scope];
  if (tagIds.length > 0) {
    const known = await tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM tag
       WHERE org_id = app_org_id() AND scope = $1 AND id = ANY($2::uuid[])`,
      [scope, tagIds],
    );
    if (bigintToNumber(known.rows[0]?.n ?? 0) !== tagIds.length) throw notFound('The tag');
  }
  await tx.query(
    `DELETE FROM ${join.table}
     WHERE ${join.target} = $1 AND org_id = app_org_id() AND NOT (tag_id = ANY($2::uuid[]))`,
    [targetId, tagIds],
  );
  if (tagIds.length > 0) {
    await tx.query(
      `INSERT INTO ${join.table} (${join.target}, tag_id, org_id)
       SELECT $1, t.tag_id, app_org_id() FROM unnest($2::uuid[]) AS t(tag_id)
       ON CONFLICT DO NOTHING`,
      [targetId, tagIds],
    );
  }
}

export function registerTagRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { pool } = ctx;

  app.get(ROUTES.tags, async (request): Promise<TagListResponse> => {
    const session = operatorOf(request);
    const query = parseInput(TagListQuerySchema, request.query, 'query');
    return withOrg(pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<TagRow>(
        `SELECT ${TAG_COLUMNS} FROM tag t
         WHERE t.org_id = app_org_id() AND ($1::text IS NULL OR t.scope = $1)
         ORDER BY t.scope, lower(t.name), t.id
         LIMIT $2`,
        [query.scope ?? null, ABSOLUTE.maxListItems],
      );
      return { items: rows.map(toTagDto) };
    });
  });

  app.post(ROUTES.tags, async (request, reply): Promise<TagDto> => {
    const session = operatorOf(request);
    const input = parseInput(TagCreateSchema, request.body, 'tag');
    let created: TagDto;
    try {
      created = await withOrg(pool, session.orgId, async (tx) => {
        // One at a time per organisation, so the ceiling below cannot be passed by a burst.
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('tinnox.tag_count:' || app_org_id()::text, 0))",
        );
        const existing = await tx.query<{ n: string }>(
          'SELECT count(*) AS n FROM tag WHERE org_id = app_org_id()',
        );
        if (bigintToNumber(existing.rows[0]?.n ?? 0) >= ABSOLUTE.maxListItems) {
          throw new HttpError(
            409,
            'conflict',
            `The organisation already has ${ABSOLUTE.maxListItems} tags, which is the most it can have. Delete tags that are no longer used.`,
          );
        }
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO tag (org_id, scope, name, colour) VALUES (app_org_id(), $1, $2, $3)
           RETURNING id`,
          [input.scope, input.name, input.colour],
        );
        const id = inserted.rows[0]?.id;
        if (id === undefined) throw new Error('tag insert returned no row');
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'tag.create',
          objectType: 'tag',
          objectId: id,
          result: 'success',
          detail: { scope: input.scope, colour: input.colour },
        });
        const dto = await loadTag(tx, id);
        if (dto === null) throw new Error('created tag is not visible');
        return dto;
      });
    } catch (error) {
      if (isNameTaken(error)) throw nameTaken();
      throw error;
    }
    void reply.code(201);
    return created;
  });

  app.patch(ROUTES.tagPattern, async (request): Promise<TagDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    const patch = parseInput(TagPatchSchema, request.body, 'tag');
    try {
      return await withOrg(pool, session.orgId, async (tx) => {
        const updated = await tx.query(
          `UPDATE tag SET name = COALESCE($2, name), colour = COALESCE($3, colour)
           WHERE id = $1 AND org_id = app_org_id()`,
          [id, patch.name ?? null, patch.colour ?? null],
        );
        if (updated.rowCount !== 1) throw notFound('The tag');
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'tag.update',
          objectType: 'tag',
          objectId: id,
          result: 'success',
          detail: { fields: Object.keys(patch).sort() },
        });
        const dto = await loadTag(tx, id);
        if (dto === null) throw new Error('updated tag is not visible');
        return dto;
      });
    } catch (error) {
      if (isNameTaken(error)) throw nameTaken();
      throw error;
    }
  });

  // Removes the tag from everything that carried it (the join rows cascade).
  app.delete(ROUTES.tagPattern, async (request, reply) => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    await withOrg(pool, session.orgId, async (tx) => {
      const current = await tx.query<TagRow>(
        `SELECT ${TAG_COLUMNS} FROM tag t
         WHERE t.id = $1 AND t.org_id = app_org_id() FOR UPDATE OF t`,
        [id],
      );
      const row = current.rows[0];
      if (row === undefined) throw notFound('The tag');
      await tx.query('DELETE FROM tag WHERE id = $1 AND org_id = app_org_id()', [id]);
      await auditScoped(tx, {
        actorType: 'operator',
        actorId: session.membershipId,
        action: 'tag.delete',
        objectType: 'tag',
        objectId: id,
        result: 'success',
        detail: { scope: row.scope, removedFrom: bigintToNumber(row.usage_count) },
      });
    });
    return reply.code(204).send();
  });
}
