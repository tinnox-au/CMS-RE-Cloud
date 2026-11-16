/**
 * Player protocol v1 (D8, D9, D13). See docs/player-protocol-v1.md.
 *
 * Players are untrusted clients. A device credential identifies exactly one
 * registration, which is bound to one display of one organisation; everything a
 * player may read or report is limited to that display. Nothing a player sends
 * can authorise an operator action.
 *
 * Registered under the prefix /player with CORS limited to the player origin (D7).
 */
import { createHash } from 'node:crypto';
import cors from '@fastify/cors';
import {
  ABSOLUTE,
  IdParamSchema,
  ManifestSchema,
  MediaIdSchema,
  MediaMimeTypeSchema,
  MediaUrlQuerySchema,
  MediaUrlsRequestSchema,
  OpaqueTokenSchema,
  PLAYER_PREFIX,
  ROUTES,
  manifestEtag,
  publicationIdFromEtag,
  type HeartbeatResponse,
  type ManifestResponse,
  type MediaUrlsResponse,
  type PairingCreateResponse,
  type PairingPollResponse,
} from '@tinnox/contracts';
import {
  auditScoped,
  auditUnscoped,
  deviceByTokenHash,
  pairingComplete,
  pairingCreate,
  pairingPoll,
  poolAsTx,
  sha256,
  withOrg,
  withResolvedOrg,
  type DeviceLookup,
} from '@tinnox/db';
import { heartbeatRejection, reduceHeartbeat } from '@tinnox/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthFailureGuard, clientKeyOf } from '../auth/failure-guard.ts';
import { perMinute, type AppContext } from '../context.ts';
import { HttpError, notFound, parseInput } from '../errors.ts';
import { serveObject } from '../media/serve.ts';
import {
  buildMediaUrl,
  clientFingerprint,
  pairingClientKey,
  randomPairingCode,
  randomToken,
  verifyMediaUrl,
} from '../security.ts';
import { contentRectOf, DELIVERY_COLUMNS, reportedStateOf, type DeliveryRow } from './displays.ts';

const PAIRING_POLL_INTERVAL_MS = 2_000;
/** Failed device-credential lookups allowed per client address per window (scaled in tests). */
const AUTH_FAILURES_PER_WINDOW = 30;
const AUTH_FAILURE_WINDOW_MS = 10 * 60 * 1000;
/** At most one stored heartbeat per display in this many seconds. */
const HEARTBEAT_LOG_SAMPLE_SECONDS = 10;
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

/** Path of a contract route relative to the /player prefix. */
function local(path: string): string {
  if (!path.startsWith(PLAYER_PREFIX)) throw new Error(`${path} is not a player route`);
  return path.slice(PLAYER_PREFIX.length);
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || header.length > 100) return null;
  const match = BEARER.exec(header);
  const token = match?.[1];
  return token !== undefined && OpaqueTokenSchema.safeParse(token).success ? token : null;
}

/**
 * Rate-limit key for credentialed player routes: the credential (hashed), else the address.
 * An invented credential gets its own bucket here; failed lookups are throttled per
 * address by the AuthFailureGuard in authenticate(), before the database is asked.
 */
function playerKey(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (typeof header === 'string' && header.length <= 100) {
    return `cred:${createHash('sha256').update(header).digest('base64url').slice(0, 22)}`;
  }
  return `ip:${request.ip}`;
}

export async function registerPlayerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, config } = ctx;
  const limits = config.limits;
  const unscoped = poolAsTx(pool);

  // D7: exactly the player origin, only under /player, no credentials (the device token
  // travels in the Authorization header, never in a cookie).
  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, origin === config.playerOrigin);
    },
    methods: ['GET', 'HEAD', 'POST', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'if-none-match', 'range', 'if-range'],
    exposedHeaders: ['etag', 'content-range', 'accept-ranges', 'content-length', 'retry-after'],
    credentials: false,
    maxAge: 600,
    strictPreflight: true,
  });

  app.addHook('onSend', async (_request, reply) => {
    if (reply.getHeader('cache-control') === undefined)
      void reply.header('cache-control', 'no-store');
    // Cross-origin by design: the player origin reads these responses through CORS.
    void reply.header('cross-origin-resource-policy', 'same-site');
  });

  // Failed lookups are counted per client address. An address over its budget is refused
  // before the database is asked, and the audit trail gets one row when an address starts
  // failing and one when it is throttled, never one row per invented token.
  const failures = new AuthFailureGuard({
    maxFailures: Math.ceil(AUTH_FAILURES_PER_WINDOW * (ctx.rateLimitScale ?? 1)),
    windowMs: AUTH_FAILURE_WINDOW_MS,
    now: () => ctx.now().getTime(),
  });
  async function auditRejected(
    request: FastifyRequest,
    record: { count: number; crossedLimit: boolean },
  ): Promise<void> {
    await auditUnscoped(unscoped, {
      actorType: 'player',
      actorId: null,
      action: 'player.auth_rejected',
      objectType: null,
      objectId: null,
      result: 'denied',
      detail: {
        route: request.routeOptions.url ?? 'unknown',
        client: clientFingerprint(config.pairingClientKeySecret, clientKeyOf(request.ip)),
        failuresInWindow: record.count,
        throttled: record.crossedLimit,
      },
    });
  }

  /** Resolves the device credential. Unknown and revoked credentials are indistinguishable (401). */
  async function authenticate(request: FastifyRequest): Promise<DeviceLookup> {
    const token = bearerToken(request);
    if (token === null) {
      throw new HttpError(401, 'unauthenticated', 'A device credential is required.', {
        headers: { 'www-authenticate': 'Bearer' },
      });
    }
    const tokenHash = sha256(token);
    const credential = tokenHash.toString('base64url');
    if (failures.isBlocked(request.ip, credential)) {
      throw new HttpError(
        429,
        'rate_limited',
        'Too many requests with invalid device credentials. Wait and try again.',
        { headers: { 'retry-after': String(failures.retryAfterSeconds(request.ip)) } },
      );
    }
    const device = await deviceByTokenHash(unscoped, tokenHash);
    if (device === null) {
      const record = failures.recordFailure(request.ip, credential);
      if (record.first || record.crossedLimit) {
        await auditRejected(request, record).catch((error: unknown) =>
          request.log.error({ err: error }, 'failed to audit rejected credential'),
        );
      }
      throw new HttpError(
        401,
        'device_revoked',
        'This device credential is not valid. It may have been revoked; pair the player again.',
        { headers: { 'www-authenticate': 'Bearer error="invalid_token"' } },
      );
    }
    failures.recordSuccess(credential);
    return device;
  }

  const credentialLimit = (max: number) => ({
    rateLimit: { ...perMinute(ctx, max), keyGenerator: playerKey },
  });

  /* ------------------------------------------------------------- pairing */

  app.post(
    local(ROUTES.playerPairing),
    { config: { rateLimit: perMinute(ctx, 30) } },
    async (request, reply): Promise<PairingCreateResponse> => {
      const pollingToken = randomToken();
      const clientKey = pairingClientKey(config.pairingClientKeySecret, request.ip);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomPairingCode();
        const result = await pairingCreate(unscoped, {
          code,
          pollingTokenHash: sha256(pollingToken),
          clientKey,
          ttlSeconds: limits.pairingCodeTtlSeconds,
          maxSessionsPerClient: limits.pairingMaxSessionsPerIp,
          windowSeconds: limits.pairingSessionWindowSeconds,
        });
        if (result.outcome === 'rate_limited') {
          throw new HttpError(
            429,
            'rate_limited',
            'Too many pairing codes were requested from this network. Wait a few minutes and try again.',
            {
              headers: { 'retry-after': String(Math.min(limits.pairingSessionWindowSeconds, 600)) },
            },
          );
        }
        if (result.outcome === 'code_collision') continue;
        await auditUnscoped(unscoped, {
          actorType: 'anonymous',
          actorId: null,
          action: 'pairing.create',
          objectType: 'pairing_session',
          objectId: result.pairingId,
          result: 'success',
          detail: null,
        });
        void reply.code(201);
        return {
          pairingId: result.pairingId,
          code,
          pollingToken,
          expiresAt: result.expiresAt,
          expiresInSeconds: limits.pairingCodeTtlSeconds,
          pollIntervalMs: PAIRING_POLL_INTERVAL_MS,
        };
      }
      throw new HttpError(
        503,
        'service_unavailable',
        'A pairing code could not be created. Try again.',
      );
    },
  );

  app.get(
    local(ROUTES.playerPairingPollPattern),
    { config: { rateLimit: perMinute(ctx, 120) } },
    async (request): Promise<PairingPollResponse> => {
      const { id } = parseInput(IdParamSchema, request.params, 'address');
      // Every way of not having a valid pairing session looks the same from outside.
      const gone = (): HttpError => notFound('The pairing session');
      const pollingToken = bearerToken(request);
      if (pollingToken === null) throw gone();
      const pollingTokenHash = sha256(pollingToken);

      const poll = await pairingPoll(unscoped, {
        pairingId: id,
        pollingTokenHash,
        maxWrongAttempts: limits.pairingMaxWrongAttempts,
      });
      switch (poll.outcome) {
        case 'pending':
          if (poll.expiresAt === null) throw new Error('pending pairing session without expiry');
          return { status: 'pending', expiresAt: poll.expiresAt };
        case 'expired':
          return { status: 'expired' };
        case 'completed':
          return { status: 'consumed' };
        case 'locked':
        case 'not_found':
        case 'wrong_token':
          throw gone();
        case 'claimed':
          break;
      }

      // The device token exists in clear only in this response; the database gets its hash.
      // One transaction: the registration and its audit event commit together, and a failure
      // leaves the pairing claimed, so the player's next poll can still collect.
      const deviceToken = randomToken();
      const paired = await withResolvedOrg(pool, async (tx, enterOrg) => {
        const done = await pairingComplete(tx, {
          pairingId: id,
          pollingTokenHash,
          deviceTokenHash: sha256(deviceToken),
        });
        if (done.outcome !== 'completed') return null;
        await enterOrg(done.orgId);
        const { rows } = await tx.query<{
          id: string;
          name: string;
          canvas_width: number;
          canvas_height: number;
          content_x: number | null;
          content_y: number | null;
          content_width: number | null;
          content_height: number | null;
        }>(
          `SELECT id, name, canvas_width, canvas_height, content_x, content_y, content_width, content_height
           FROM display WHERE id = $1 AND org_id = app_org_id()`,
          [done.displayId],
        );
        const row = rows[0];
        if (row === undefined) throw new Error('display of a completed pairing is not visible');
        await auditScoped(tx, {
          actorType: 'player',
          actorId: done.registrationId,
          action: 'pairing.complete',
          objectType: 'player_registration',
          objectId: done.registrationId,
          result: 'success',
          detail: { displayId: done.displayId, pairingId: id },
        });
        return { done, display: row };
      });
      if (paired === null) return { status: 'consumed' };
      const { done, display } = paired;
      return {
        status: 'claimed',
        deviceToken,
        registrationId: done.registrationId,
        orgId: done.orgId,
        display: {
          id: display.id,
          name: display.name,
          canvas: { width: display.canvas_width, height: display.canvas_height },
          contentRect: contentRectOf(display),
        },
      };
    },
  );

  /* -------------------------------------------------------- registration */

  // Player-initiated reset: the player gives up its own credential. Not part of
  // packages/contracts ROUTES; documented in docs/player-protocol-v1.md.
  app.delete('/registration', { config: credentialLimit(30) }, async (request, reply) => {
    const device = await authenticate(request);
    await withOrg(pool, device.orgId, async (tx) => {
      const revoked = await tx.query(
        `UPDATE player_registration SET revoked_at = now(), revoked_reason = 'player_reset'
         WHERE id = $1 AND org_id = app_org_id() AND revoked_at IS NULL`,
        [device.registrationId],
      );
      if (revoked.rowCount === 1) {
        await auditScoped(tx, {
          actorType: 'player',
          actorId: device.registrationId,
          action: 'player.revoke',
          objectType: 'player_registration',
          objectId: device.registrationId,
          result: 'success',
          detail: { reason: 'player_reset', displayId: device.displayId },
        });
      }
    });
    return reply.code(204).send();
  });

  /* ------------------------------------------------------------ manifest */

  app.get(
    local(ROUTES.playerManifest),
    { config: credentialLimit(240) },
    async (request, reply): Promise<ManifestResponse | undefined> => {
      const device = await authenticate(request);
      const row = await withOrg(pool, device.orgId, async (tx) => {
        const { rows } = await tx.query<{ id: string; manifest: unknown }>(
          `SELECT p.id, p.manifest
           FROM display_delivery dd
           JOIN publication p
             ON p.id = dd.desired_publication_id AND p.org_id = dd.org_id AND p.display_id = dd.display_id
           WHERE dd.display_id = $1 AND dd.org_id = app_org_id()`,
          [device.displayId],
        );
        return rows[0];
      });
      void reply.header('cache-control', 'private, no-cache');
      if (row === undefined) {
        void reply.code(204);
        return undefined;
      }
      const etag = manifestEtag(row.id);
      void reply.header('etag', etag);
      const ifNoneMatch = request.headers['if-none-match'];
      if (
        typeof ifNoneMatch === 'string' &&
        ifNoneMatch.length <= 1000 &&
        ifNoneMatch.split(',').some((value) => publicationIdFromEtag(value) === row.id)
      ) {
        void reply.code(304);
        return undefined;
      }
      const manifest = ManifestSchema.safeParse(row.manifest);
      if (!manifest.success) throw new Error('stored manifest failed schema validation');
      return { manifest: manifest.data };
    },
  );

  /* ---------------------------------------------------------- media URLs */

  app.post(
    local(ROUTES.playerMediaUrls),
    { config: credentialLimit(120) },
    async (request): Promise<MediaUrlsResponse> => {
      const device = await authenticate(request);
      const input = parseInput(MediaUrlsRequestSchema, request.body, 'request');
      const wanted = [...new Set(input.assetIds)];
      const found = await withOrg(pool, device.orgId, async (tx) => {
        // Only the publication currently assigned to this credential's display.
        const current = await tx.query(
          `SELECT 1 FROM display_delivery
           WHERE display_id = $1 AND org_id = app_org_id() AND desired_publication_id = $2`,
          [device.displayId, input.publicationId],
        );
        if (current.rowCount !== 1) return null;
        const { rows } = await tx.query<{ media_id: string }>(
          `SELECT DISTINCT pa.media_id
           FROM publication_asset pa
           JOIN publication p ON p.id = pa.publication_id AND p.org_id = pa.org_id
           WHERE pa.publication_id = $1 AND pa.org_id = app_org_id()
             AND p.display_id = $2 AND pa.media_id = ANY($3::uuid[])`,
          [input.publicationId, device.displayId, wanted],
        );
        return new Set(rows.map((r) => r.media_id));
      });
      if (found === null) {
        throw new HttpError(
          404,
          'not_found',
          'That publication is not the current publication of this display. Fetch the manifest again.',
        );
      }
      if (wanted.some((assetId) => !found.has(assetId))) {
        throw new HttpError(404, 'not_found', 'An asset is not part of that publication.');
      }
      const expiresAtSeconds = Math.floor(ctx.now().getTime() / 1000) + limits.mediaUrlTtlSeconds;
      const expiresAt = new Date(expiresAtSeconds * 1000).toISOString();
      return {
        publicationId: input.publicationId,
        urls: wanted.map((assetId) => ({
          assetId,
          url: buildMediaUrl(config.apiPublicOrigin, config.mediaUrlHmacSecret, {
            registrationId: device.registrationId,
            publicationId: input.publicationId,
            assetId,
            expiresAtSeconds,
          }),
          expiresAt,
        })),
      };
    },
  );

  /* --------------------------------------------------------------- media */

  // Authorised by the signed URL alone (no bearer header), so the bytes can be
  // fetched by a service worker or a media element. The signature binds the
  // registration, the publication, the asset and the expiry; the registration is
  // looked up again on every request, so revocation takes effect immediately.
  app.get(
    local(ROUTES.playerMediaPattern),
    { config: { rateLimit: perMinute(ctx, 900) } },
    async (request, reply) => {
      const forbidden = (): HttpError =>
        new HttpError(403, 'url_signature_invalid', 'This media address is not valid.');
      const params = z.object({ assetId: MediaIdSchema }).strict().safeParse(request.params);
      const query = MediaUrlQuerySchema.safeParse(request.query);
      if (!params.success || !query.success) throw forbidden();
      const claims = {
        registrationId: query.data.reg,
        publicationId: query.data.pub,
        assetId: params.data.assetId,
        expiresAtSeconds: Number(query.data.exp),
      };
      const check = verifyMediaUrl(
        config.mediaUrlHmacSecret,
        claims,
        query.data.sig,
        Math.floor(ctx.now().getTime() / 1000),
      );
      if (check === 'bad_signature') throw forbidden();
      if (check === 'expired') {
        throw new HttpError(
          403,
          'url_expired',
          'This media address has expired. Request a new one.',
        );
      }

      const { rows: devices } = await unscoped.query<{ org_id: string; display_id: string }>(
        'SELECT org_id, display_id FROM sec.device_by_registration_id($1)',
        [claims.registrationId],
      );
      const device = devices[0];
      if (device === undefined) {
        throw new HttpError(401, 'device_revoked', 'This device registration is no longer valid.');
      }

      const asset = await withOrg(pool, device.org_id, async (tx) => {
        const { rows } = await tx.query<{
          storage_key: string | null;
          mime_type: string | null;
          sha256: string | null;
        }>(
          `SELECT m.storage_key, m.mime_type, m.sha256
           FROM publication p
           JOIN publication_asset pa ON pa.publication_id = p.id AND pa.org_id = p.org_id
           JOIN media m ON m.id = pa.media_id AND m.org_id = pa.org_id
           WHERE p.id = $1 AND p.org_id = app_org_id() AND p.display_id = $2 AND pa.media_id = $3
           LIMIT 1`,
          [claims.publicationId, device.display_id, claims.assetId],
        );
        return rows[0];
      });
      const mime = MediaMimeTypeSchema.safeParse(asset?.mime_type);
      if (
        asset === undefined ||
        asset.storage_key === null ||
        asset.sha256 === null ||
        !mime.success
      ) {
        throw notFound('The media file');
      }
      return serveObject(request, reply, {
        storage: ctx.storage,
        orgId: device.org_id,
        storageKey: asset.storage_key,
        mimeType: mime.data,
        sha256: asset.sha256,
        mediaId: claims.assetId,
        // The bytes behind an asset id never change.
        cacheControl: 'private, max-age=31536000, immutable',
      });
    },
  );

  /* ----------------------------------------------------------- heartbeat */

  app.post(
    local(ROUTES.playerHeartbeat),
    { bodyLimit: ABSOLUTE.maxHeartbeatBodyBytes, config: credentialLimit(120) },
    async (request): Promise<HeartbeatResponse> => {
      const device = await authenticate(request);
      const receivedAt = ctx.now();

      return withOrg(pool, device.orgId, async (tx) => {
        const displays = await tx.query<{ route: 'browser' }>(
          'SELECT route FROM display WHERE id = $1 AND org_id = app_org_id()',
          [device.displayId],
        );
        const display = displays.rows[0];
        if (display === undefined) throw notFound('The display');

        // The display's delivery route validates and normalises the untrusted report.
        const normalized = ctx.delivery.get(display.route).normalizeStatus(request.body);
        if (!normalized.ok) {
          throw new HttpError(400, 'validation_failed', 'The report is not valid.', {
            details: [{ path: 'report', message: normalized.message.slice(0, 500) }],
          });
        }
        const report = normalized.report;

        if (report.displayId !== device.displayId) {
          throw new HttpError(403, 'forbidden', 'This credential cannot report for that display.');
        }
        const named = new Set<string>();
        if (report.downloadedPublicationId !== null) named.add(report.downloadedPublicationId);
        if (report.activePublicationId !== null) named.add(report.activePublicationId);
        if (report.staging !== null) named.add(report.staging.publicationId);
        for (const e of report.errors) if (e.publicationId !== null) named.add(e.publicationId);
        const known = new Set<string>();
        if (named.size > 0) {
          const { rows } = await tx.query<{ id: string }>(
            `SELECT id FROM publication
             WHERE org_id = app_org_id() AND display_id = $1 AND id = ANY($2::uuid[])`,
            [device.displayId, [...named]],
          );
          for (const r of rows) known.add(r.id);
        }
        const rejection = heartbeatRejection(report, {
          displayId: device.displayId,
          isPublicationOfDisplay: (id) => known.has(id),
        });
        if (rejection !== null) {
          throw new HttpError(
            409,
            'conflict',
            'The report names a publication that was not published to this display.',
          );
        }

        // One row per display; the row lock serialises concurrent reports so the
        // sequence check and the update are atomic.
        await tx.query(
          `INSERT INTO display_delivery (display_id, org_id) VALUES ($1, app_org_id())
           ON CONFLICT (display_id) DO NOTHING`,
          [device.displayId],
        );
        const current = await tx.query<DeliveryRow>(
          `SELECT ${DELIVERY_COLUMNS} FROM display_delivery
           WHERE display_id = $1 AND org_id = app_org_id() FOR UPDATE`,
          [device.displayId],
        );
        const row = current.rows[0];
        if (row === undefined) throw new Error('delivery row is missing after upsert');

        const reduced = reduceHeartbeat(reportedStateOf(row), {
          registrationId: device.registrationId,
          report,
          receivedAt,
        });
        if (reduced.accepted) {
          const s = reduced.state;
          await tx.query(
            `UPDATE display_delivery
             SET reporting_registration_id = $2, last_seq = $3, downloaded_publication_id = $4,
                 active_publication_id = $5, active_item_index = $6, player_state = $7,
                 staging = $8::jsonb, last_errors = $9::jsonb, last_heartbeat_at = $10
             WHERE display_id = $1 AND org_id = app_org_id()`,
            [
              device.displayId,
              s.registrationId,
              s.lastSeq,
              s.downloadedPublicationId,
              s.activePublicationId,
              s.activeItemIndex,
              s.playerState,
              s.staging === null ? null : JSON.stringify(s.staging),
              JSON.stringify(s.errors),
              receivedAt,
            ],
          );
        }
        // History is diagnostic only. Ignored reports (stale or replayed seq) are not kept,
        // and accepted ones are sampled to at most one row per display per interval, so a
        // player cannot grow the table faster than that. Housekeeping removes rows older
        // than the retention period by time; nothing depends on values the player sends.
        if (reduced.accepted) {
          await tx.query(
            `INSERT INTO heartbeat_log (org_id, display_id, registration_id, seq, accepted, received_at, payload)
             SELECT app_org_id(), $1, $2, $3, true, $4, $5::jsonb
             WHERE NOT EXISTS (
               SELECT 1 FROM heartbeat_log
               WHERE org_id = app_org_id() AND display_id = $1
                 AND received_at > $4::timestamptz - make_interval(secs => $6)
             )`,
            [
              device.displayId,
              device.registrationId,
              report.seq,
              receivedAt,
              JSON.stringify(report),
              HEARTBEAT_LOG_SAMPLE_SECONDS,
            ],
          );
        }
        return {
          accepted: reduced.accepted,
          ignoredReason: reduced.ignoredReason,
          desiredPublicationId: row.desired_publication_id,
          serverTime: receivedAt.toISOString(),
          nextHeartbeatInMs: limits.heartbeatIntervalSeconds * 1000,
        };
      });
    },
  );
}
