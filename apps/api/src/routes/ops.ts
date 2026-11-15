import { ROUTES } from '@tinnox/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

/** The worker is reported as running when it touched its marker within this time. */
const WORKER_FRESH_MS = 30_000;

async function passes(check: () => Promise<unknown>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch {
    return false;
  }
}

/**
 * /healthz: the process is up. /readyz: its dependencies answer.
 * Neither reveals configuration, versions or error text.
 */
export function registerOpsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(ROUTES.healthz, { config: { rateLimit: false } }, async (_request, reply) => {
    void reply.header('cache-control', 'no-store');
    return { status: 'ok' };
  });

  app.get(ROUTES.readyz, async (_request, reply) => {
    const [database, storage, jobs, identityProvider, workerAge] = await Promise.all([
      passes(() => ctx.pool.query('SELECT 1')),
      passes(() => ctx.storage.check()),
      passes(() => ctx.media.check()),
      ctx.idp.check(),
      ctx.media.workerLastSeenMs().catch(() => null),
    ]);
    // Required to serve requests at all. The identity provider and the worker are
    // reported but do not make the API unready: existing sessions and players keep working.
    const ready = database && storage && jobs;
    void reply.code(ready ? 200 : 503).header('cache-control', 'no-store');
    return {
      status: ready ? 'ready' : 'not_ready',
      checks: {
        database,
        storage,
        mediaJobs: jobs,
        identityProvider,
        mediaWorker: workerAge !== null && workerAge <= WORKER_FRESH_MS,
      },
    };
  });
}
