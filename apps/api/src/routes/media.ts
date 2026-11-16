/**
 * Private media: streamed upload into quarantine, listing, authorised preview
 * and deletion. Files reach the library only after the isolated worker accepts
 * them (media/pipeline.ts).
 */
import {
  ABSOLUTE,
  IdParamSchema,
  MEDIA_KIND_BY_MIME,
  MEDIA_UPLOAD_FIELD,
  MediaErrorCodeSchema,
  MediaMimeTypeSchema,
  MediaPatchSchema,
  ROUTES,
  type MediaDto,
  type MediaListResponse,
  type MediaUploadResponse,
  type MediaUsageResponse,
} from '@tinnox/contracts';
import { auditScoped, STAGE_A_CONSTRAINTS, violatedConstraint, withOrg, type Tx } from '@tinnox/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { operatorOf, type OperatorSession } from '../auth/session.ts';
import { perMinute, type AppContext } from '../context.ts';
import { accept, bigintToNumber, iso, refuse, withOrgDecision } from '../db-helpers.ts';
import { HttpError, notFound, parseInput, pgErrorCode } from '../errors.ts';
import { serveObject } from '../media/serve.ts';
import { sniffMediaType } from '../media/sniff.ts';
import { isUnknownTag, replaceTags } from './tags.ts';

export interface MediaRow {
  id: string;
  kind: 'image' | 'video';
  status: 'processing' | 'ready' | 'failed';
  error_code: string | null;
  error_detail: string | null;
  mime_type: string | null;
  bytes: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  codec: string | null;
  storage_key: string | null;
  original_name: string;
  /** The operator's name for the item, or else the file name supplied at upload. */
  name: string;
  description: string | null;
  default_duration_ms: number | null;
  folder_id: string | null;
  tag_ids: string[];
  usage_count: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Select list for `media m` that yields a `MediaRow`. `usage_count` is the
 * number of live playlists that contain the item at least once.
 */
export const MEDIA_COLUMNS = `m.id, m.kind, m.status, m.error_code, m.error_detail, m.mime_type,
  m.bytes, m.sha256, m.width, m.height, m.duration_ms, m.codec, m.storage_key, m.original_name,
  COALESCE(m.name, m.original_name) AS name, m.description, m.default_duration_ms, m.folder_id,
  ARRAY(SELECT mt.tag_id FROM media_tag mt
        WHERE mt.media_id = m.id AND mt.org_id = m.org_id
        ORDER BY mt.created_at, mt.tag_id)::text[] AS tag_ids,
  (SELECT count(DISTINCT i.playlist_id) FROM playlist_item i
   JOIN playlist p ON p.id = i.playlist_id AND p.org_id = i.org_id
   WHERE i.media_id = m.id AND i.org_id = m.org_id AND p.deleted_at IS NULL) AS usage_count,
  m.created_at, m.updated_at`;

export function toMediaDto(row: MediaRow): MediaDto {
  const mime = MediaMimeTypeSchema.safeParse(row.mime_type);
  const errorCode = MediaErrorCodeSchema.safeParse(row.error_code);
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    name: row.name,
    originalName: row.original_name,
    description: row.description,
    defaultDurationMs: row.default_duration_ms,
    folderId: row.folder_id,
    tagIds: row.tag_ids.slice(0, ABSOLUTE.maxTagsPerItem),
    usageCount: bigintToNumber(row.usage_count),
    mimeType: mime.success ? mime.data : null,
    bytes: row.bytes === null ? null : bigintToNumber(row.bytes),
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    codec: row.codec,
    errorCode:
      row.status !== 'failed' ? null : errorCode.success ? errorCode.data : 'inspection_failed',
    errorDetail: row.status === 'failed' ? row.error_detail : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** One live media item of the caller's organisation, or null. */
async function loadMediaRow(tx: Tx, id: string): Promise<MediaRow | null> {
  const { rows } = await tx.query<MediaRow>(
    `SELECT ${MEDIA_COLUMNS} FROM media m
     WHERE m.id = $1 AND m.org_id = app_org_id() AND m.deleted_at IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

/** Bytes that count against the organisation's quota: everything queued or stored. */
export async function usedBytes(tx: Tx): Promise<number> {
  const { rows } = await tx.query<{ used: string }>(
    `SELECT coalesce(sum(bytes), 0)::bigint AS used FROM media
     WHERE org_id = app_org_id() AND status IN ('processing', 'ready')`,
  );
  return bigintToNumber(rows[0]?.used ?? '0');
}

/**
 * Turns the client's file name into a display label: no path, no control or
 * formatting characters, bounded length. It is never used to build a path or a command.
 */
export function displayNameFromUpload(filename: unknown): string {
  if (typeof filename !== 'string') return 'upload';
  const base = filename.normalize('NFC').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- removing control characters is the purpose
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '')
    .trim();
  const clipped = Array.from(cleaned).slice(0, ABSOLUTE.maxOriginalNameLength).join('');
  return clipped === '' ? 'upload' : clipped.slice(0, ABSOLUTE.maxOriginalNameLength);
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function registerMediaRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { pool, config } = ctx;
  const limits = config.limits;

  async function auditUpload(
    session: OperatorSession,
    result: 'failure' | 'denied',
    detail: Record<string, unknown>,
  ): Promise<void> {
    await withOrg(pool, session.orgId, (tx) =>
      auditScoped(tx, {
        actorType: 'operator',
        actorId: session.membershipId,
        action: 'media.upload',
        objectType: 'media',
        objectId: null,
        result,
        detail,
      }),
    );
  }

  /**
   * Ends an over-limit upload: the client may still be sending. The rest of the
   * body is discarded (never stored) for a short time so the client can read the
   * error, then the connection is closed.
   */
  function abandonBody(request: FastifyRequest, reply: FastifyReply): void {
    void reply.header('connection', 'close');
    request.raw.resume();
    const timer = setTimeout(() => request.raw.destroy(), 2_000);
    timer.unref();
    request.raw.once('end', () => clearTimeout(timer));
  }

  app.get(ROUTES.media, async (request): Promise<MediaListResponse> => {
    const session = operatorOf(request);
    return withOrg(pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<MediaRow>(
        `SELECT ${MEDIA_COLUMNS} FROM media m
         WHERE m.org_id = app_org_id() AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC, m.id`,
      );
      return {
        items: rows.map(toMediaDto),
        storage: { usedBytes: await usedBytes(tx), limitBytes: limits.maxOrgStorageBytes },
      };
    });
  });

  app.post(
    ROUTES.media,
    { config: { rateLimit: perMinute(ctx, 60) } },
    async (request, reply): Promise<MediaUploadResponse> => {
      const session = operatorOf(request);
      if (!request.isMultipart()) {
        throw new HttpError(
          415,
          'unsupported_media_type',
          `Send the file as multipart/form-data in a field named "${MEDIA_UPLOAD_FIELD}".`,
        );
      }

      const used = await withOrg(pool, session.orgId, usedBytes);
      const remaining = limits.maxOrgStorageBytes - used;
      if (remaining <= 0) {
        await auditUpload(session, 'denied', { reason: 'storage_quota_exceeded' });
        abandonBody(request, reply);
        throw new HttpError(
          413,
          'storage_quota_exceeded',
          `The organisation's storage is full (${megabytes(limits.maxOrgStorageBytes)}). Delete unused media first.`,
        );
      }
      // The hard limit for this request: the per-file limit, or less when little quota is left.
      const cap = Math.min(limits.maxUploadBytes, remaining);
      const quotaBound = cap < limits.maxUploadBytes;
      const tooLarge = (): HttpError =>
        quotaBound
          ? new HttpError(
              413,
              'storage_quota_exceeded',
              `The file does not fit in the remaining storage (${megabytes(remaining)} free).`,
            )
          : new HttpError(
              413,
              'payload_too_large',
              `The file is larger than the upload limit of ${megabytes(limits.maxUploadBytes)}.`,
            );

      // A declared length far above the limit is refused before any byte is read.
      const declared = Number(request.headers['content-length']);
      if (Number.isFinite(declared) && declared > cap + 1024 * 1024) {
        await auditUpload(session, 'denied', { reason: 'too_large', declaredBytes: declared });
        abandonBody(request, reply);
        throw tooLarge();
      }

      const part = await request.file({
        limits: { fileSize: cap, files: 1, fields: 4, fieldSize: 1024, headerPairs: 50 },
        throwFileSizeLimit: false,
      });
      if (part === undefined || part.fieldname !== MEDIA_UPLOAD_FIELD) {
        part?.file.resume();
        throw new HttpError(
          400,
          'bad_request',
          `The upload must contain one file in a field named "${MEDIA_UPLOAD_FIELD}".`,
        );
      }
      const originalName = displayNameFromUpload(part.filename);

      const received = await ctx.media.receive(part.file, cap);
      if (received.truncated) {
        await auditUpload(session, 'denied', {
          reason: quotaBound ? 'storage_quota_exceeded' : 'too_large',
        });
        abandonBody(request, reply);
        throw tooLarge();
      }
      if (received.bytes === 0) {
        await ctx.media.discard(received.jobId);
        await auditUpload(session, 'failure', { reason: 'empty_file' });
        throw new HttpError(400, 'bad_request', 'The file is empty.');
      }
      const mimeType = sniffMediaType(received.head);
      if (mimeType === null) {
        await ctx.media.discard(received.jobId);
        await auditUpload(session, 'failure', {
          reason: 'unrecognised_type',
          bytes: received.bytes,
        });
        throw new HttpError(
          415,
          'unsupported_media_type',
          'The file content is not a JPEG, PNG or MP4 file. The file name and extension are ignored; only the content counts.',
        );
      }

      let media: MediaDto;
      try {
        media = await withOrgDecision(pool, session.orgId, async (tx) => {
          // Serialise uploads per organisation so concurrent requests cannot pass the quota together.
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('tinnox.media_quota:' || app_org_id()::text, 0))",
          );
          const usedNow = await usedBytes(tx);
          if (usedNow + received.bytes > limits.maxOrgStorageBytes) {
            await auditScoped(tx, {
              actorType: 'operator',
              actorId: session.membershipId,
              action: 'media.upload',
              objectType: 'media',
              objectId: null,
              result: 'denied',
              detail: { reason: 'storage_quota_exceeded', bytes: received.bytes },
            });
            return refuse(
              new HttpError(
                413,
                'storage_quota_exceeded',
                `The file does not fit in the remaining storage (${megabytes(Math.max(0, limits.maxOrgStorageBytes - usedNow))} free).`,
              ),
            );
          }
          const inserted = await tx.query<MediaRow>(
            `INSERT INTO media AS m
               (id, org_id, kind, status, mime_type, bytes, sha256, original_name, created_by)
             VALUES ($1, app_org_id(), $2, 'processing', $3, $4, $5, $6, $7)
             RETURNING ${MEDIA_COLUMNS}`,
            [
              received.jobId,
              MEDIA_KIND_BY_MIME[mimeType],
              mimeType,
              received.bytes,
              received.sha256,
              originalName,
              session.membershipId,
            ],
          );
          const row = inserted.rows[0];
          if (row === undefined) throw new Error('media insert returned no row');
          await auditScoped(tx, {
            actorType: 'operator',
            actorId: session.membershipId,
            action: 'media.upload',
            objectType: 'media',
            objectId: row.id,
            result: 'success',
            detail: { bytes: received.bytes, sniffedType: mimeType },
          });
          return accept(toMediaDto(row));
        });
      } catch (error) {
        await ctx.media.discard(received.jobId).catch(() => undefined);
        throw error;
      }

      try {
        await ctx.media.enqueue(received.jobId);
      } catch (error) {
        // The row is committed as "processing"; the pipeline re-queues or fails it on a later scan.
        request.log.error(
          { err: error, mediaId: media.id },
          'could not queue media for validation',
        );
      }
      void reply.code(201);
      return { media };
    },
  );

  app.get(ROUTES.mediaItemPattern, async (request): Promise<MediaDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    return withOrg(pool, session.orgId, async (tx) => {
      const row = await loadMediaRow(tx, id);
      if (row === null) throw notFound('The media item');
      return toMediaDto(row);
    });
  });

  /**
   * Changes what an operator may say about a media item: its name, description,
   * default time on screen (images only), folder and tags. The file itself and
   * the worker's verdict are never changed here.
   */
  app.patch(ROUTES.mediaItemPattern, async (request): Promise<MediaDto> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    const patch = parseInput(MediaPatchSchema, request.body, 'media item');
    try {
      return await withOrg(pool, session.orgId, async (tx) => {
        const locked = await tx.query<{
          kind: 'image' | 'video';
          name: string | null;
          description: string | null;
          default_duration_ms: number | null;
          folder_id: string | null;
        }>(
          `SELECT kind, name, description, default_duration_ms, folder_id FROM media
           WHERE id = $1 AND org_id = app_org_id() AND deleted_at IS NULL FOR NO KEY UPDATE`,
          [id],
        );
        const current = locked.rows[0];
        if (current === undefined) throw notFound('The media item');

        const duration = patch.defaultDurationMs;
        if (duration !== undefined && duration !== null) {
          if (current.kind !== 'image') {
            throw new HttpError(
              400,
              'validation_failed',
              'Only images have a default duration; a video plays for its own length.',
              {
                details: [{ path: 'defaultDurationMs', message: 'must be null for a video' }],
              },
            );
          }
          if (
            duration < limits.minImageItemDurationMs ||
            duration > limits.maxImageItemDurationMs
          ) {
            throw new HttpError(
              400,
              'validation_failed',
              'The default duration is outside the allowed range.',
              {
                details: [
                  {
                    path: 'defaultDurationMs',
                    message: `must be between ${limits.minImageItemDurationMs} and ${limits.maxImageItemDurationMs} milliseconds`,
                  },
                ],
              },
            );
          }
        }
        if (patch.folderId !== undefined && patch.folderId !== null) {
          const folder = await tx.query(
            'SELECT 1 FROM folder WHERE id = $1 AND org_id = app_org_id()',
            [patch.folderId],
          );
          if (folder.rowCount !== 1) throw notFound('The folder');
        }

        // A change of tags alone leaves the row, and so its updated_at, as it is.
        if (
          patch.name !== undefined ||
          patch.description !== undefined ||
          patch.defaultDurationMs !== undefined ||
          patch.folderId !== undefined
        ) {
          await tx.query(
            `UPDATE media
             SET name = $2, description = $3, default_duration_ms = $4, folder_id = $5
             WHERE id = $1 AND org_id = app_org_id()`,
            [
              id,
              patch.name === undefined ? current.name : patch.name,
              patch.description === undefined ? current.description : patch.description,
              duration === undefined ? current.default_duration_ms : duration,
              patch.folderId === undefined ? current.folder_id : patch.folderId,
            ],
          );
        }
        if (patch.tagIds !== undefined) await replaceTags(tx, 'media', id, patch.tagIds);

        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'media.update',
          objectType: 'media',
          objectId: id,
          result: 'success',
          detail: { fields: Object.keys(patch).sort() },
        });
        const row = await loadMediaRow(tx, id);
        if (row === null) throw new Error('updated media item is not visible');
        return toMediaDto(row);
      });
    } catch (error) {
      // The folder or a tag was deleted between the check above and the write.
      if (
        pgErrorCode(error) === '23503' &&
        violatedConstraint(error) === STAGE_A_CONSTRAINTS.mediaFolder
      ) {
        throw notFound('The folder');
      }
      if (isUnknownTag(error)) throw notFound('The tag');
      throw error;
    }
  });

  /**
   * Where a media item is used: the live playlists that contain it, and the
   * displays whose current publication contains it (whatever was edited since).
   */
  app.get(ROUTES.mediaUsagePattern, async (request): Promise<MediaUsageResponse> => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    return withOrg(pool, session.orgId, async (tx) => {
      const media = await tx.query(
        'SELECT 1 FROM media WHERE id = $1 AND org_id = app_org_id() AND deleted_at IS NULL',
        [id],
      );
      if (media.rowCount !== 1) throw notFound('The media item');
      const playlists = await tx.query<{ id: string; name: string }>(
        `SELECT p.id, p.name FROM playlist p
         WHERE p.org_id = app_org_id() AND p.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM playlist_item i
                       WHERE i.playlist_id = p.id AND i.org_id = p.org_id AND i.media_id = $1)
         ORDER BY lower(p.name), p.id
         LIMIT $2`,
        [id, ABSOLUTE.maxListItems],
      );
      const displays = await tx.query<{ id: string; name: string }>(
        `SELECT d.id, d.name FROM display d
         JOIN display_delivery dd ON dd.display_id = d.id AND dd.org_id = d.org_id
         WHERE d.org_id = app_org_id()
           AND EXISTS (SELECT 1 FROM publication_asset pa
                       WHERE pa.publication_id = dd.desired_publication_id
                         AND pa.org_id = dd.org_id AND pa.media_id = $1)
         ORDER BY lower(d.name), d.id
         LIMIT $2`,
        [id, ABSOLUTE.maxListItems],
      );
      return {
        playlists: playlists.rows.map((r) => ({ id: r.id, name: r.name })),
        displays: displays.rows.map((r) => ({ id: r.id, name: r.name })),
      };
    });
  });

  app.get(ROUTES.mediaPreviewPattern, async (request, reply) => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    const row = await withOrg(pool, session.orgId, async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        status: string;
        storage_key: string | null;
        sha256: string | null;
        mime_type: string | null;
      }>(
        `SELECT id, status, storage_key, sha256, mime_type FROM media
         WHERE id = $1 AND org_id = app_org_id() AND deleted_at IS NULL`,
        [id],
      );
      return rows[0];
    });
    if (row === undefined) throw notFound('The media item');
    const mime = MediaMimeTypeSchema.safeParse(row.mime_type);
    if (
      row.status !== 'ready' ||
      row.storage_key === null ||
      row.sha256 === null ||
      !mime.success
    ) {
      throw new HttpError(
        409,
        'media_not_ready',
        'This file has no preview because it is not ready.',
      );
    }
    return serveObject(request, reply, {
      storage: ctx.storage,
      orgId: session.orgId,
      storageKey: row.storage_key,
      mimeType: mime.data,
      sha256: row.sha256,
      mediaId: row.id,
      cacheControl: 'private, max-age=300',
    });
  });

  /**
   * Deleting media:
   *  - refused while a playlist still uses it (the operator edits the playlist first);
   *    a deleted playlist uses nothing;
   *  - refused while it is being validated;
   *  - if a publication references it, the row is hidden (deleted_at) but the bytes
   *    stay, because published snapshots are immutable and players may still need them;
   *  - otherwise the row and the stored bytes are removed.
   */
  app.delete(ROUTES.mediaItemPattern, async (request, reply) => {
    const session = operatorOf(request);
    const { id } = parseInput(IdParamSchema, request.params, 'address');
    let storageKeyToRemove: string | null;
    try {
      storageKeyToRemove = await withOrg(pool, session.orgId, async (tx) => {
        const { rows } = await tx.query<{ status: string; storage_key: string | null }>(
          `SELECT status, storage_key FROM media
           WHERE id = $1 AND org_id = app_org_id() AND deleted_at IS NULL FOR UPDATE`,
          [id],
        );
        const row = rows[0];
        if (row === undefined) throw notFound('The media item');
        if (row.status === 'processing') {
          throw new HttpError(
            409,
            'conflict',
            'This file is still being checked. Delete it once the check has finished.',
          );
        }
        // Only live playlists count. Deleting a playlist removes its items, so a deleted
        // playlist never holds media back (routes/playlists.ts).
        const used = await tx.query<{ name: string }>(
          `SELECT DISTINCT p.name FROM playlist_item i
           JOIN playlist p ON p.id = i.playlist_id AND p.org_id = i.org_id
           WHERE i.media_id = $1 AND i.org_id = app_org_id() AND p.deleted_at IS NULL
           ORDER BY p.name LIMIT 5`,
          [id],
        );
        if (used.rows.length > 0) {
          throw new HttpError(
            409,
            'media_in_use',
            'This file is used in a playlist. Remove it from the playlist first.',
            {
              details: used.rows.map((r) => ({ path: 'playlist', message: r.name.slice(0, 200) })),
            },
          );
        }
        const published = await tx.query(
          'SELECT 1 FROM publication_asset WHERE media_id = $1 AND org_id = app_org_id() LIMIT 1',
          [id],
        );
        const retained = published.rows.length > 0;
        if (retained) {
          await tx.query(
            'UPDATE media SET deleted_at = now() WHERE id = $1 AND org_id = app_org_id()',
            [id],
          );
        } else {
          await tx.query('DELETE FROM media WHERE id = $1 AND org_id = app_org_id()', [id]);
        }
        await auditScoped(tx, {
          actorType: 'operator',
          actorId: session.membershipId,
          action: 'media.delete',
          objectType: 'media',
          objectId: id,
          result: 'success',
          detail: { bytesRetainedForPublications: retained },
        });
        return retained ? null : row.storage_key;
      });
    } catch (error) {
      // A publish or playlist edit referenced the row between the checks and the DELETE.
      if (pgErrorCode(error) === '23503') {
        throw new HttpError(
          409,
          'media_in_use',
          'This file has just been used elsewhere. Try again.',
        );
      }
      throw error;
    }
    if (storageKeyToRemove !== null) {
      try {
        await ctx.storage.delete(storageKeyToRemove);
      } catch (error) {
        request.log.error({ err: error, mediaId: id }, 'media row deleted but stored bytes remain');
      }
    }
    return reply.code(204).send();
  });
}
