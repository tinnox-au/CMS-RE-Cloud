/**
 * Assembles the HTTP application: hardening, error envelope, and the three
 * route groups (operations, operator portal API, player protocol).
 */
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ABSOLUTE, PLAYER_PREFIX } from '@tinnox/contracts';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { createRouteCheck, permissionGuard } from './auth/permissions.ts';
import { requireOperator } from './auth/session.ts';
import { perMinute, type AppContext } from './context.ts';
import { HttpError, registerErrorHandling, sendFrameworkError } from './errors.ts';
import { registerAppRoutes } from './routes/apps.ts';
import { registerAuditRoutes } from './routes/audit.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerDisplayRoutes } from './routes/displays.ts';
import { registerFolderRoutes } from './routes/folders.ts';
import { registerLayoutRoutes } from './routes/layouts.ts';
import { registerMediaRoutes } from './routes/media.ts';
import { registerMemberRoutes } from './routes/members.ts';
import { registerOpsRoutes } from './routes/ops.ts';
import { registerOverviewRoutes } from './routes/overview.ts';
import { registerPlaylistRoutes } from './routes/playlists.ts';
import { registerPlayerRoutes } from './routes/player.ts';
import { registerPushRoutes } from './routes/push.ts';
import { registerScheduleRoutes } from './routes/schedules.ts';
import { registerTagRoutes } from './routes/tags.ts';

export interface BuildAppOptions {
  /** A pino logger, or false for silence (tests). */
  readonly logger: FastifyBaseLogger | false;
}

export async function buildApp(
  ctx: AppContext,
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({
    ...(options.logger === false ? { logger: false } : { loggerInstance: options.logger }),
    genReqId: () => randomUUID(),
    // JSON bodies are small; the upload route streams and has its own byte limit.
    bodyLimit: ABSOLUTE.maxJsonBodyBytes,
    trustProxy: config.trustProxy,
    // Slow or stalled clients are cut off; an upload must finish within this time.
    requestTimeout: 15 * 60 * 1000,
    keepAliveTimeout: 65_000,
    // Every path parameter is a 36-character UUID. A longer one is refused by the router
    // before any hook runs; frameworkErrors answers it with the normal envelope and headers.
    routerOptions: { maxParamLength: 100 },
    frameworkErrors: sendFrameworkError,
  });

  registerErrorHandling(app);
  app.decorateRequest('operator', null);
  app.decorateRequest('permission', null);
  // Only JSON and multipart bodies are accepted anywhere.
  app.removeContentTypeParser('text/plain');

  await app.register(helmet, {
    // API responses are data, never documents: nothing may load, frame or submit.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    // HSTS only makes sense (and is only honoured) over https.
    strictTransportSecurity: config.secureCookies
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
    xFrameOptions: { action: 'deny' },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    ...perMinute(ctx, 600),
    errorResponseBuilder: (_request, context) =>
      new HttpError(429, 'rate_limited', `Too many requests. Try again in ${context.after}.`),
  });
  await app.register(multipart, {
    limits: {
      fileSize: config.limits.maxUploadBytes,
      files: 1,
      fields: 4,
      fieldSize: 1024,
      headerPairs: 50,
    },
    throwFileSizeLimit: false,
  });

  registerOpsRoutes(app, ctx);
  registerAuthRoutes(app, ctx);

  // Operator API: every route below requires a session; state-changing ones also
  // require the portal Origin and the CSRF token (auth/session.ts). Then the session's role
  // must hold the route's permission keys (auth/permissions.ts); a route without an entry in
  // the table stops the start-up.
  const routeCheck = createRouteCheck();
  await app.register(async (api) => {
    // Before any route is registered, so it sees exactly the operator routes.
    api.addHook('onRoute', routeCheck.onRoute);
    api.addHook('preHandler', requireOperator(ctx));
    api.addHook('preHandler', permissionGuard(ctx));
    api.addHook('onSend', async (_request, reply) => {
      if (reply.getHeader('cache-control') === undefined)
        void reply.header('cache-control', 'no-store');
    });
    registerDisplayRoutes(api, ctx);
    registerMediaRoutes(api, ctx);
    registerAppRoutes(api, ctx);
    registerScheduleRoutes(api, ctx);
    registerLayoutRoutes(api, ctx);
    registerPlaylistRoutes(api, ctx);
    registerTagRoutes(api, ctx);
    registerFolderRoutes(api, ctx);
    registerPushRoutes(api, ctx);
    registerOverviewRoutes(api, ctx);
    registerAuditRoutes(api, ctx);
    registerMemberRoutes(api, ctx);
  });
  routeCheck.assertComplete();

  await app.register((player) => registerPlayerRoutes(player, ctx), { prefix: PLAYER_PREFIX });

  return app;
}
