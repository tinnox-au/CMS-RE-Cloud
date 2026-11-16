/**
 * Playlists (one level, ordered) and publishing (D12).
 *
 * A playlist is an editable draft. Publishing copies everything a player needs
 * into an immutable `publication` row, so later edits to the playlist or the
 * display never change what was published.
 *
 * A deleted playlist keeps its row (`deleted_at`), because its publications
 * refer to it for good, but nothing else: its items are removed with it, so it
 * no longer uses any media, and every query below leaves deleted rows out.
 */
import {
  IdParamSchema,
  ManifestSchema,
  MEDIA_KINDS,
  PLAYLIST_PREVIEW_COUNT,
  PlaylistCreateSchema,
  PlaylistReplaceSchema,
  PublishRequestSchema,
  ROUTES,
  duplicatePlaylistName,
  type FitMode,
  type MediaKind,
  type PlaylistDto,
  type PlaylistDuplicateResponse,
  type PlaylistListResponse,
  type PublishResponse,
  type Transition,
} from '@tinnox/contracts';
import { auditScoped, STAGE_A_CONSTRAINTS, violatedConstraint, withOrg, type Tx } from '@tinnox/db';
import { validatePlaylist } from '@tinnox/domain';
import type { FastifyInstance } from 'fastify';
import { operatorOf } from '../auth/session.ts';
import { perMinute, type AppContext } from '../context.ts';
import { accept, bigintToNumber, iso, refuse, withOrgDecision } from '../db-helpers.ts';
import { HttpError, notFound, parseInput, pgErrorCode } from '../errors.ts';
import {
  auditRejectedPublication,
  createPublication,
  findPublicationByKey,
  idempotencyKeyOf,
  issueDetails,
  loadMediaRecords,
  loadPlaylistDrafts,
  lockDisplayForPublish,
  lockPublishKey,
  planDraft,
  publicationRejected,
  type PublicationRow,
} from '../publishing.ts';
import { MEDIA_COLUMNS, toMediaDto, type MediaRow } from './media.ts';

interface PlaylistRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

interface SummaryRow extends PlaylistRow {
  item_count: string;
  total_duration_ms: string;
  has_image: boolean;
  has_video: boolean;
  preview_media_ids: string[];
  assigned_display_count: string;
}

interface ItemRow {
  item_id: string;
  position: number;
  media_id: string;
  item_duration_ms: number | null;
  fit: FitMode | null;
}

async function loadPlaylistDto(tx: Tx, id: string): Promise<PlaylistDto | null> {
  const playlist = await tx.query<PlaylistRow & { transition: Transition; shuffle: boolean }>(
    `SELECT id, name, description, transition, shuffle, created_at, updated_at FROM playlist
     WHERE id = $1 AND org_id = app_org_id() AND deleted_at IS NULL`,
    [id],
  );
  const row = playlist.rows[0];
  if (row === undefined) return null;
  const items = await tx.query<ItemRow & MediaRow>(
    `SELECT i.id AS item_id, i.position, i.media_id, i.duration_ms AS item_duration_ms, i.fit,
            ${MEDIA_COLUMNS}
     FROM playlist_item i
     JOIN media m ON m.id = i.media_id AND m.org_id = i.org_id
     WHERE i.playlist_id = $1 AND i.org_id = app_org_id()
     ORDER BY i.position`,
    [id],
  );
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    items: items.rows.map((item) => ({
      id: item.item_id,
      position: item.position,
      mediaId: item.media_id,
      durationMs: item.item_duration_ms,
      fit: item.fit,
      media: toMediaDto(item),
    })),
    transition: row.transition,
    shuffle: row.shuffle,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toPublishResponse(row: PublicationRow, replayed: boolean): PublishResponse {
  const manifest = ManifestSchema.safeParse(row.manifest);
  if (!manifest.success) throw new Error('stored manifest failed schema validation');
  return {
    publicationId: row.id,
    displayId: row.display_id,
    playlistId: row.playlist_id,
    createdAt: iso(row.created_at),
    replayed,
    manifest: manifest.data,
  };
}

export function registerPlaylistRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { pool, config } = ctx;
  const limits = config.limits;

  /**
   * One row per live playlist. The loop length adds each image's time on screen
   * and each video's own length; an item with no length yet counts as zero.
   */
  app.get(ROUTES.playlists, async (request): Promise<PlaylistListResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<SummaryRow>(
        `SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
                COALESCE(s.item_count, 0) AS item_count,
                COALESCE(s.total_duration_ms, 0) AS total_duration_ms,
                COALESCE(s.has_image, false) AS has_image,
                COALESCE(s.has_video, false) AS has_video,
                ARRAY(SELECT f.media_id
                      FROM (SELECT i.media_id, min(i.position) AS first_position
                            FROM playlist_item i
                            WHERE i.playlist_id = p.id AND i.org_id = p.org_id
                            GROUP BY i.media_id) f
                      ORDER BY f.first_position
                      LIMIT $1)::text[] AS preview_media_ids,
                (SELECT count(*) FROM display d
                 WHERE d.assigned_playlist_id = p.id AND d.org_id = p.org_id)
                  AS assigned_display_count
         FROM playlist p
         LEFT JOIN LATERAL (
           SELECT count(*) AS item_count,
                  sum(CASE WHEN m.kind = 'image' THEN COALESCE(i.duration_ms, 0)
                           ELSE COALESCE(m.duration_ms, 0) END) AS total_duration_ms,
                  bool_or(m.kind = 'image') AS has_image,
                  bool_or(m.kind = 'video') AS has_video
           FROM playlist_item i
           JOIN media m ON m.id = i.media_id AND m.org_id = i.org_id
           WHERE i.playlist_id = p.id AND i.org_id = p.org_id
         ) s ON true
         WHERE p.org_id = app_org_id() AND p.deleted_at IS NULL
         ORDER BY p.created_at, p.id`,
        [PLAYLIST_PREVIEW_COUNT],
      );
      return {
        items: rows.map((r) => {
          const present: Record<MediaKind, boolean> = { image: r.has_image, video: r.has_video };
          return {
            id: r.id,
            name: r.name,
            description: r.description,
            itemCount: bigintToNumber(r.item_count),
            totalDurationMs: bigintToNumber(r.total_duration_ms),
            kinds: MEDIA_KINDS.filter((kind) => present[kind]),
            previewMediaIds: r.preview_media_ids,
            assignedDisplayCount: bigintToNumber(r.assigned_display_count),
            createdAt: iso(r.created_at),
            updatedAt: iso(r.updated_at),
          };
        }),
      };
    });
  });

  app.post(ROUTES.playlists, async (request, reply): Promise<PlaylistDto> => {
    const session = operatorOf(request);
    const input = parseInput(PlaylistCreateSchema, request.body, 'playlist');
    const dto = await withOrg(pool, session.orgId, async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        'INSERT INTO playlist (org_id, name) VALUES (app_org_id(), $1) RETURNING id',
        [input.name],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) throw new Error('playlist insert returned no row');
      await auditScoped(tx, {
        actorType: 'operator',
        actorId: session.membershipId,
        action: 'playlist.create',
        objectType: 'playlist',
        objectId: id,
        result: 'success',
        detail: null,
      });
      const created = await loadPlaylistDto(tx, id);
      if (created === null) throw new Error('created playlist is not visible');
      return created;
    });
    void reply.code(201);
    return dto;
  });

  app.get(ROUTES.playlistPattern, async (request): Promise<PlaylistDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    return withOrg(pool, session.orgId, async (tx) => {
      const dto = await loadPlaylistDto(tx, id);
      if (dto === null) throw notFound('The playlist');
      return dto;
    });
  });

  // Replaces the name and the whole ordered item list in one transaction. The
  // description, transition and shuffle are replaced only when the request
  // carries them (a null description clears it).
  app.put(ROUTES.playlistPattern, async (request): Promise<PlaylistDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    const input = parseInput(PlaylistReplaceSchema, request.body, 'playlist');
    try {
      return await withOrg(pool, session.orgId, async (tx) => {
        const locked = await tx.query(
          `SELECT 1 FROM playlist
           WHERE id = $1 AND org_id = app_org_id() AND deleted_at IS NULL FOR UPDATE`,
          [id],
        );
        if (locked.rowCount !== 1) throw notFound('The playlist');

        const mediaById = await loadMediaRecords(
          tx,
          input.items.map((item) => item.mediaId),
          true,
        );
        const issues = validatePlaylist(input.items, mediaById, limits, { mode: 'draft' });
        if (issues.length > 0) {
          throw new HttpError(
            400,
            'validation_failed',
            'The playlist has items that cannot be saved.',
            {
              details: issueDetails(issues),
            },
          );
        }

        await tx.query(
          'DELETE FROM playlist_item WHERE playlist_id = $1 AND org_id = app_org_id()',
          [id],
        );
        if (input.items.length > 0) {
          await tx.query(
            `INSERT INTO playlist_item (org_id, playlist_id, position, media_id, duration_ms, fit)
             SELECT app_org_id(), $1, (t.ordinal - 1)::int, t.media_id, t.duration_ms, t.fit
             FROM unnest($2::uuid[], $3::int[], $4::text[])
                  WITH ORDINALITY AS t(media_id, duration_ms, fit, ordinal)`,
            [
              id,
              input.items.map((item) => item.mediaId),
              input.items.map((item) => item.durationMs),
              input.items.map((item) => item.fit),
            ],
          );
        }
        // Always touches the row, so updated_at reflects item changes too.
        await tx.query(
          `UPDATE playlist
           SET name = $2, description = CASE WHEN $3::boolean THEN $4::text ELSE description END,
               transition = COALESCE($5::text, transition), shuffle = COALESCE($6::boolean, shuffle)
           WHERE id = $1 AND org_id = app_org_id()`,
          [
            id,
            input.name,
            input.description !== undefined,
            input.description ?? null,
            input.transition ?? null,
            input.shuffle ?? null,
          ],
        );
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'playlist.update',
          objectType: 'playlist',
          objectId: id,
          result: 'success',
          // An option left out is undefined and so absent from the stored JSON.
          detail: {
            itemCount: input.items.length,
            transition: input.transition,
            shuffle: input.shuffle,
          },
        });
        const dto = await loadPlaylistDto(tx, id);
        if (dto === null) throw new Error('updated playlist is not visible');
        return dto;
      });
    } catch (error) {
      if (pgErrorCode(error) === '23503') {
        throw new HttpError(
          409,
          'conflict',
          'A file in this playlist was deleted meanwhile. Reload and try again.',
        );
      }
      throw error;
    }
  });

  /**
   * Copies a playlist: its description, playback options and every item, under the name "Copy of X".
   * The copy is assigned to no display.
   */
  app.post(
    ROUTES.playlistDuplicatePattern,
    async (request, reply): Promise<PlaylistDuplicateResponse> => {
      const session = operatorOf(request);
      const { id } = parseInput(IdParamSchema, request.params, 'address');
      const dto = await withOrg(pool, session.orgId, async (tx) => {
        // Held until commit, so the items copied below are the items of one moment.
        const source = await tx.query<{
          name: string;
          description: string | null;
          transition: Transition;
          shuffle: boolean;
        }>(
          `SELECT name, description, transition, shuffle FROM playlist
           WHERE id = $1 AND org_id = app_org_id() AND deleted_at IS NULL FOR SHARE`,
          [id],
        );
        const original = source.rows[0];
        if (original === undefined) throw notFound('The playlist');
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO playlist (org_id, name, description, transition, shuffle)
           VALUES (app_org_id(), $1, $2, $3, $4)
           RETURNING id`,
          [
            duplicatePlaylistName(original.name),
            original.description,
            original.transition,
            original.shuffle,
          ],
        );
        const copyId = inserted.rows[0]?.id;
        if (copyId === undefined) throw new Error('playlist insert returned no row');
        const copied = await tx.query(
          `INSERT INTO playlist_item (org_id, playlist_id, position, media_id, duration_ms, fit)
           SELECT app_org_id(), $2, i.position, i.media_id, i.duration_ms, i.fit
           FROM playlist_item i
           WHERE i.playlist_id = $1 AND i.org_id = app_org_id()`,
          [id, copyId],
        );
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'playlist.create',
          objectType: 'playlist',
          objectId: copyId,
          result: 'success',
          detail: { duplicatedFrom: id.toLowerCase(), itemCount: copied.rowCount ?? 0 },
        });
        const created = await loadPlaylistDto(tx, copyId);
        if (created === null) throw new Error('duplicated playlist is not visible');
        return created;
      });
      void reply.code(201);
      return dto;
    },
  );

  /**
   * Deletes a playlist. Refused while a display has it assigned: the operator
   * assigns something else first, so no display is left pointing at nothing by
   * accident. Otherwise the row is kept but hidden (`deleted_at`), because its
   * publications refer to it for good, and its items are removed, so the media
   * it used is free to be deleted. What displays are playing is not affected:
   * a publication is a snapshot.
   */
  app.delete(ROUTES.playlistPattern, async (request, reply) => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    const inUse = (details?: { path: string; message: string }[]): HttpError =>
      new HttpError(
        409,
        'playlist_in_use',
        'This playlist is assigned to a screen. Assign other content to the screen first.',
        details === undefined ? {} : { details },
      );
    try {
      await withOrg(pool, session.orgId, async (tx) => {
        const locked = await tx.query(
          `SELECT 1 FROM playlist
           WHERE id = $1 AND org_id = app_org_id() AND deleted_at IS NULL FOR UPDATE`,
          [id],
        );
        if (locked.rowCount !== 1) throw notFound('The playlist');
        const assigned = await tx.query<{ name: string }>(
          `SELECT d.name FROM display d
           WHERE d.assigned_playlist_id = $1 AND d.org_id = app_org_id()
           ORDER BY lower(d.name), d.id LIMIT 5`,
          [id],
        );
        if (assigned.rows.length > 0) {
          throw inUse(assigned.rows.map((r) => ({ path: 'display', message: r.name })));
        }
        const removed = await tx.query(
          'DELETE FROM playlist_item WHERE playlist_id = $1 AND org_id = app_org_id()',
          [id],
        );
        await tx.query(
          'UPDATE playlist SET deleted_at = now() WHERE id = $1 AND org_id = app_org_id()',
          [id],
        );
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'playlist.delete',
          objectType: 'playlist',
          objectId: id,
          result: 'success',
          detail: { itemCount: removed.rowCount ?? 0 },
        });
      });
    } catch (error) {
      // A display was given this playlist between the check above and the delete;
      // the database guard refuses, and the answer is the same.
      if (
        pgErrorCode(error) === '23001' &&
        violatedConstraint(error) === STAGE_A_CONSTRAINTS.playlistStillAssigned
      ) {
        throw inUse();
      }
      throw error;
    }
    return reply.code(204).send();
  });

  /**
   * Publish. Idempotency: the key is unique per display. Concurrent requests with
   * the same key are serialised by a transaction-level advisory lock, so exactly
   * one creates the publication and the others return it with `replayed: true`.
   *
   * Publishing a playlist to a display also assigns it to that display, in the
   * same transaction (decision P2-05), so "assigned" never lags behind what an
   * operator last published there.
   */
  app.post(
    ROUTES.playlistPublishPattern,
    { config: { rateLimit: perMinute(ctx, 60) } },
    async (request, reply): Promise<PublishResponse> => {
      const session = operatorOf(request);
      const params = parseInput(IdParamSchema, request.params, 'address');
      const body = parseInput(PublishRequestSchema, request.body, 'publish request');
      const key = idempotencyKeyOf(request, 'publish');
      // Identifiers compare without regard to letter case; the database returns lower case.
      const playlistId = params.id.toLowerCase();
      const displayId = body.displayId.toLowerCase();

      const attempt = (): Promise<{ response: PublishResponse; created: boolean }> =>
        withOrgDecision<{ response: PublishResponse; created: boolean }>(
          pool,
          session.orgId,
          async (tx) => {
            await lockPublishKey(tx, displayId, key);
            const previous = await findPublicationByKey(tx, displayId, key);
            if (previous !== null) {
              if (previous.playlist_id !== playlistId) {
                return refuse(
                  new HttpError(
                    409,
                    'idempotency_conflict',
                    'This Idempotency-Key was already used to publish a different playlist to this screen.',
                  ),
                );
              }
              return accept({ response: toPublishResponse(previous, true), created: false });
            }

            const display = await lockDisplayForPublish(tx, displayId);
            if (display === null) throw notFound('The screen');
            const playlist = (await loadPlaylistDrafts(tx, [playlistId], true)).get(playlistId);
            if (playlist === undefined) throw notFound('The playlist');
            const mediaById = await loadMediaRecords(
              tx,
              playlist.items.map((item) => item.mediaId),
              true,
            );

            const plan = planDraft(ctx, display, playlist, mediaById);
            if (!plan.ok) {
              await auditRejectedPublication(tx, {
                membershipId: session.membershipId,
                playlistId,
                displayId,
                issues: plan.issues,
                via: 'publish',
              });
              return refuse(publicationRejected(plan.issues));
            }

            const row = await createPublication(tx, ctx, {
              display,
              playlistId,
              draft: plan.draft,
              idempotencyKey: key,
              membershipId: session.membershipId,
              via: 'publish',
            });
            await tx.query(
              `UPDATE display SET assigned_playlist_id = $2::uuid
               WHERE id = $1 AND org_id = app_org_id()
                 AND assigned_playlist_id IS DISTINCT FROM $2::uuid`,
              [displayId, playlistId],
            );
            return accept({ response: toPublishResponse(row, false), created: true });
          },
        );

      let outcome;
      try {
        outcome = await attempt();
      } catch (error) {
        const pg = pgErrorCode(error);
        if (pg === '23505') {
          // Lost a race the advisory lock should already prevent; the winner's row is returned.
          outcome = await attempt();
        } else if (pg === '23503') {
          throw new HttpError(
            409,
            'conflict',
            'A file or screen used by this playlist changed meanwhile. Try again.',
          );
        } else {
          throw error;
        }
      }
      void reply.code(outcome.created ? 201 : 200);
      return outcome.response;
    },
  );
}
