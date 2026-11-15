/**
 * API entry point. Start with `npm run dev -w @tinnox/api` (or `npm run start`),
 * which load ../../.env. Refuses to start on unsafe configuration (config.ts).
 */
import { assertConnectionRole, createPool } from '@tinnox/db';
import { createDeliveryRegistry } from '@tinnox/delivery';
import { LocalObjectStorage } from '@tinnox/storage';
import { buildApp } from './app.ts';
import { createIdentityProvider } from './auth/oidc.ts';
import { ConfigError, loadConfig, type AppConfig } from './config.ts';
import type { AppContext } from './context.ts';
import { runHousekeeping } from './housekeeping.ts';
import { createLogger } from './logger.ts';
import { MediaPipeline } from './media/pipeline.ts';

const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig(process.env);
    assertConnectionRole(config.databaseUrl, 'tinnox_app');
  } catch (error) {
    // Problem text names variables only, never values.
    const problems = error instanceof ConfigError ? error.problems : [(error as Error).message];
    console.error('TINNOX API configuration is not acceptable:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const logger = createLogger(
    config.logLevel,
    config.nodeEnv === 'development' && process.stdout.isTTY === true,
  );
  const pool = createPool({
    connectionString: config.databaseUrl,
    applicationName: 'tinnox-api',
    max: 15,
  });
  const storage = await LocalObjectStorage.create({ root: config.mediaRoot });
  const limits = config.limits;
  const delivery = createDeliveryRegistry({
    browser: {
      maxAssetBytes: limits.maxUploadBytes,
      maxItems: limits.maxPlaylistItems,
      maxVideoWidthPx: limits.maxVideoWidthPx,
      maxVideoHeightPx: limits.maxVideoHeightPx,
    },
  });
  const media = new MediaPipeline({
    jobsDir: config.mediaJobsDir,
    pool,
    storage,
    limits,
    logger: logger.child({ module: 'media-pipeline' }),
  });
  const ctx: AppContext = {
    config,
    pool,
    storage,
    delivery,
    idp: createIdentityProvider(config),
    media,
    now: () => new Date(),
  };

  const app = await buildApp(ctx, { logger });

  const housekeeping = async (): Promise<void> => {
    try {
      const result = await runHousekeeping({ pool, storage, media, limits });
      logger.info(result, 'housekeeping finished');
    } catch (error) {
      logger.error({ err: error }, 'housekeeping failed');
    }
  };
  const housekeepingTimer = setInterval(() => void housekeeping(), HOUSEKEEPING_INTERVAL_MS);
  housekeepingTimer.unref();

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    clearInterval(housekeepingTimer);
    // Do not wait for ever on open connections.
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await app.close();
      await media.stop();
      await pool.end();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    // State is unknown after an uncaught exception: log and let the supervisor restart the process.
    logger.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
  });

  // The media pipeline starts before the listener: jobs left by a previous run are picked up first.
  await media.start();
  await app.listen({ host: config.host, port: config.port });
  void housekeeping();
  if (config.nodeEnv !== 'production') {
    logger.warn('development configuration: plain http on loopback, development identity realm');
  }
}

void main().catch((error: unknown) => {
  console.error('TINNOX API failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
