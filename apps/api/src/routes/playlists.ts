/**
 * Playlists (one level, ordered) and publishing (D12).
 *
 * A playlist is an editable draft. Publishing copies everything a player needs
 * into an immutable `publication` row, so later edits to the playlist or the
 * display never change what was published.
 */
import { randomUUID } from 'node:crypto';
import {
  HEADERS,
  IdParamSchema,
  IdempotencyKeySchema,
  ManifestV1Schema,
  MediaMimeTypeSchema,
  PlaylistCreateSchema,
  PlaylistReplaceSchema,
  PublishRequestSchema,
  ROUTES,
  type ApiErrorDetail,
  type FitMode,
  type ManifestV1,
  type PlaylistDto,
  type PlaylistListResponse,
  type PublishResponse,
} from '@tinnox/contracts';
import { auditScoped, withOrg, type Tx } from '@tinnox/db';
import {
  buildManifest,
  planPublication,
  validatePlaylist,
  type DraftItem,
  type MediaRecord,
  type PublishIssue,
} from '@tinnox/domain';
import type { FastifyInstance } from 'fastify';
import { operatorOf } from '../auth/session.ts';
import { perMinute, type AppContext } from '../context.ts';
import { accept, bigintToNumber, iso, refuse, withOrgDecision } from '../db-helpers.ts';
import { HttpError, notFound, parseInput, pgErrorCode } from '../errors.ts';
import { contentRectOf } from './displays.ts';
import { MEDIA_COLUMNS, toMediaDto, type MediaRow } from './media.ts';

interface PlaylistRow {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

interface ItemRow {
  item_id: string;
  position: number;
  media_id: string;
  item_duration_ms: number | null;
  fit: FitMode | null;
}

function toMediaRecord(row: MediaRow): MediaRecord {
  const mime = MediaMimeTypeSchema.safeParse(row.mime_type);
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    mimeType: mime.success ? mime.data : null,
    bytes: row.bytes === null ? null : bigintToNumber(row.bytes),
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    codec: row.codec,
  };
}

function issueDetails(issues: readonly PublishIssue[]): ApiErrorDetail[] {
  return issues.slice(0, 100).map((issue) => ({
    path: issue.index === null ? 'playlist' : `items[${issue.index}]`,
    message: issue.message.slice(0, 500),
    code: issue.code,
  }));
}

async function loadPlaylistDto(tx: Tx, id: string): Promise<PlaylistDto | null> {
  const playlist = await tx.query<PlaylistRow>(
    'SELECT id, name, created_at, updated_at FROM playlist WHERE id = $1 AND org_id = app_org_id()',
    [id],
  );
  const row = playlist.rows[0];
  if (row === undefined) return null;
  const items = await tx.query<ItemRow & MediaRow>(
    `SELECT i.id AS item_id, i.position, i.media_id, i.duration_ms AS item_duration_ms, i.fit,
            m.id, m.kind, m.status, m.error_code, m.error_detail, m.mime_type, m.bytes, m.sha256,
            m.width, m.height, m.duration_ms, m.codec, m.storage_key, m.original_name,
            m.created_at, m.updated_at
     FROM playlist_item i
     JOIN media m ON m.id = i.media_id AND m.org_id = i.org_id
     WHERE i.playlist_id = $1 AND i.org_id = app_org_id()
     ORDER BY i.position`,
    [id],
  );
  return {
    id: row.id,
    name: row.name,
    items: items.rows.map((item) => ({
      id: item.item_id,
      position: item.position,
      mediaId: item.media_id,
      durationMs: item.item_duration_ms,
      fit: item.fit,
      media: toMediaDto(item),
    })),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** Loads the media rows for a set of ids; `lock` keeps them from being deleted until commit. */
async function loadMedia(
  tx: Tx,
  ids: readonly string[],
  lock: boolean,
): Promise<Map<string, MediaRecord>> {
  const byId = new Map<string, MediaRecord>();
  if (ids.length === 0) return byId;
  const { rows } = await tx.query<MediaRow>(
    `SELECT ${MEDIA_COLUMNS} FROM media
     WHERE org_id = app_org_id() AND deleted_at IS NULL AND id = ANY($1::uuid[])
     ${lock ? 'FOR KEY SHARE' : ''}`,
    [[...new Set(ids)]],
  );
  for (const row of rows) byId.set(row.id, toMediaRecord(row));
  return byId;
}

interface PublicationRow {
  id: string;
  display_id: string;
  playlist_id: string;
  manifest: unknown;
  created_at: Date;
}

function toPublishResponse(row: PublicationRow, replayed: boolean): PublishResponse {
  const manifest = ManifestV1Schema.safeParse(row.manifest);
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

  app.get(ROUTES.playlists, async (request): Promise<PlaylistListResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<PlaylistRow & { item_count: string }>(
        `SELECT p.id, p.name, p.created_at, p.updated_at,
                (SELECT count(*) FROM playlist_item i
                 WHERE i.playlist_id = p.id AND i.org_id = p.org_id) AS item_count
         FROM playlist p WHERE p.org_id = app_org_id()
         ORDER BY p.created_at, p.id`,
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          itemCount: bigintToNumber(r.item_count),
          createdAt: iso(r.created_at),
          updatedAt: iso(r.updated_at),
        })),
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

  // Replaces the name and the whole ordered item list in one transaction.
  app.put(ROUTES.playlistPattern, async (request): Promise<PlaylistDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    const input = parseInput(PlaylistReplaceSchema, request.body, 'playlist');
    try {
      return await withOrg(pool, session.orgId, async (tx) => {
        const locked = await tx.query(
          'SELECT 1 FROM playlist WHERE id = $1 AND org_id = app_org_id() FOR UPDATE',
          [id],
        );
        if (locked.rowCount !== 1) throw notFound('The playlist');

        const mediaById = await loadMedia(
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
        await tx.query('UPDATE playlist SET name = $2 WHERE id = $1 AND org_id = app_org_id()', [
          id,
          input.name,
        ]);
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'playlist.update',
          objectType: 'playlist',
          objectId: id,
          result: 'success',
          detail: { itemCount: input.items.length },
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
   * Publish. Idempotency: the key is unique per display. Concurrent requests with
   * the same key are serialised by a transaction-level advisory lock, so exactly
   * one creates the publication and the others return it with `replayed: true`.
   */
  app.post(
    ROUTES.playlistPublishPattern,
    { config: { rateLimit: perMinute(ctx, 60) } },
    async (request, reply): Promise<PublishResponse> => {
      const session = operatorOf(request);
      const { id: playlistId } = parseInput(IdParamSchema, request.params, 'address');
      const { displayId } = parseInput(PublishRequestSchema, request.body, 'publish request');
      const rawKey = request.headers[HEADERS.idempotencyKey];
      if (typeof rawKey !== 'string') {
        throw new HttpError(
          400,
          'bad_request',
          'The Idempotency-Key header is required to publish.',
        );
      }
      const key = parseInput(IdempotencyKeySchema, rawKey, 'Idempotency-Key header');

      const attempt = (): Promise<{ response: PublishResponse; created: boolean }> =>
        withOrgDecision<{ response: PublishResponse; created: boolean }>(
          pool,
          session.orgId,
          async (tx) => {
            await tx.query(
              "SELECT pg_advisory_xact_lock(hashtextextended('tinnox.publish:' || $1 || ':' || $2, 0))",
              [displayId, key],
            );
            const existing = await tx.query<PublicationRow>(
              `SELECT id, display_id, playlist_id, manifest, created_at FROM publication
             WHERE org_id = app_org_id() AND display_id = $1 AND idempotency_key = $2`,
              [displayId, key],
            );
            const previous = existing.rows[0];
            if (previous !== undefined) {
              if (previous.playlist_id !== playlistId) {
                return refuse(
                  new HttpError(
                    409,
                    'idempotency_conflict',
                    'This Idempotency-Key was already used to publish a different playlist to this display.',
                  ),
                );
              }
              return accept({ response: toPublishResponse(previous, true), created: false });
            }

            const displayResult = await tx.query<{
              id: string;
              canvas_width: number;
              canvas_height: number;
              content_x: number | null;
              content_y: number | null;
              content_width: number | null;
              content_height: number | null;
              default_fit: FitMode;
              route: 'browser';
            }>(
              `SELECT id, canvas_width, canvas_height, content_x, content_y, content_width, content_height,
                    default_fit, route
             FROM display WHERE id = $1 AND org_id = app_org_id() FOR SHARE`,
              [displayId],
            );
            const display = displayResult.rows[0];
            if (display === undefined) throw notFound('The display');
            const playlist = await tx.query(
              'SELECT 1 FROM playlist WHERE id = $1 AND org_id = app_org_id() FOR SHARE',
              [playlistId],
            );
            if (playlist.rowCount !== 1) throw notFound('The playlist');

            const itemRows = await tx.query<{
              media_id: string;
              duration_ms: number | null;
              fit: FitMode | null;
            }>(
              `SELECT media_id, duration_ms, fit FROM playlist_item
             WHERE playlist_id = $1 AND org_id = app_org_id() ORDER BY position`,
              [playlistId],
            );
            const items: DraftItem[] = itemRows.rows.map((r) => ({
              mediaId: r.media_id,
              durationMs: r.duration_ms,
              fit: r.fit,
            }));
            const mediaById = await loadMedia(
              tx,
              items.map((item) => item.mediaId),
              true,
            );

            // Domain rule plus the target route's capability profile (D12, D15).
            const route = ctx.delivery.get(display.route);
            const plan = planPublication({
              display: {
                id: display.id,
                canvas: { width: display.canvas_width, height: display.canvas_height },
                contentRect: contentRectOf(display),
                defaultFit: display.default_fit,
                route: display.route,
              },
              items,
              mediaById,
              limits,
              route,
            });
            if (!plan.ok) {
              await auditScoped(tx, {
                actorType: 'operator',
                actorId: session.membershipId,
                action: 'publication.create',
                objectType: 'playlist',
                objectId: playlistId,
                result: 'failure',
                detail: {
                  displayId,
                  reasons: [...new Set(plan.issues.map((i) => i.code))].slice(0, 20),
                },
              });
              const first = plan.issues[0];
              return refuse(
                new HttpError(
                  422,
                  'publication_rejected',
                  plan.issues.length === 1 && first !== undefined
                    ? first.message
                    : `The playlist cannot be published: ${plan.issues.length} problems were found.`,
                  { details: issueDetails(plan.issues) },
                ),
              );
            }

            const publicationId = randomUUID();
            const createdAt = ctx.now();
            const manifest: ManifestV1 = buildManifest(plan.draft, { publicationId, createdAt });
            // The browser route is pull-based: preparing has no side effect. A later
            // push route would hand `prepared` to its target after the commit.
            route.prepare(manifest);

            const inserted = await tx.query<PublicationRow>(
              `INSERT INTO publication (id, org_id, display_id, playlist_id, manifest, idempotency_key, created_by, created_at)
             VALUES ($1, app_org_id(), $2, $3, $4::jsonb, $5, $6, $7)
             RETURNING id, display_id, playlist_id, manifest, created_at`,
              [
                publicationId,
                displayId,
                playlistId,
                JSON.stringify(manifest),
                key,
                session.membershipId,
                createdAt,
              ],
            );
            const row = inserted.rows[0];
            if (row === undefined) throw new Error('publication insert returned no row');
            await tx.query(
              `INSERT INTO publication_asset (publication_id, position, org_id, media_id)
             SELECT $1, (t.ordinal - 1)::int, app_org_id(), t.media_id
             FROM unnest($2::uuid[]) WITH ORDINALITY AS t(media_id, ordinal)`,
              [publicationId, manifest.assets.map((asset) => asset.assetId)],
            );
            await tx.query(
              `INSERT INTO display_delivery (display_id, org_id, desired_publication_id, desired_at)
             VALUES ($1, app_org_id(), $2, $3)
             ON CONFLICT (display_id) DO UPDATE
               SET desired_publication_id = EXCLUDED.desired_publication_id,
                   desired_at = EXCLUDED.desired_at`,
              [displayId, publicationId, createdAt],
            );
            await auditScoped(tx, {
              actorType: 'operator',
              actorId: session.membershipId,
              action: 'publication.create',
              objectType: 'publication',
              objectId: publicationId,
              result: 'success',
              detail: {
                displayId,
                playlistId,
                items: manifest.assets.length,
                route: display.route,
              },
            });
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
            'A file or display used by this playlist changed meanwhile. Try again.',
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
