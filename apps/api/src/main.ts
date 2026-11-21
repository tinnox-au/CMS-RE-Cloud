/**
 * API entry point. Start with `npm run dev -w @tinnox/api` (or `npm run start`),
 * which load ../../.env. Refuses to start on unsafe configuration (config.ts).
 */
import { assertConnectionRole, createPool } from '@tinnox/db';
import { createDeliveryRegistry } from '@tinnox/delivery';
import { LocalObjectStorage } from '@tinnox/storage';
import { runDisplayAlerts } from './alerts.ts';
import { buildApp } from './app.ts';
import { createIdentityProvider } from './auth/oidc.ts';
import { ConfigError, loadConfig, type AppConfig } from './config.ts';
import type { AppContext } from './context.ts';
import { runHousekeeping } from './housekeeping.ts';
import { createLogger } from './logger.ts';
import { createMailer, type Mailer } from './mail.ts';
import { MediaPipeline } from './media/pipeline.ts';

const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;
const ALERT_INTERVAL_MS = 60 * 1000;

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
    mail: createMailer(config.mail),
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

  // The e-mail alert check: a self-rescheduling loop, so runs never overlap in this process;
  // other instances and alerts-once skip on the database lock (alerts.ts).
  let closing = false;
  let alertTimer: NodeJS.Timeout | undefined;
  let alertRun: Promise<void> = Promise.resolve();
  let skippedInRow = 0;
  const alertLoop = (mail: Mailer): void => {
    alertRun = runDisplayAlerts({
      pool,
      now: ctx.now(),
      mail,
      portalOrigin: config.portalOrigin,
      logger,
      shouldStop: () => closing,
    }).then(
      (result) => {
        // Another runner holding the lock now and then is normal; every fifth skip in a row is
        // logged, so a lock that stays held (a hung run, or a pooler that lost the unlock) does
        // not stop alerts silently.
        skippedInRow = result.skipped ? skippedInRow + 1 : 0;
        if (skippedInRow > 0 && skippedInRow % 5 === 0) {
          logger.warn(
            { skippedInRow },
            'display alert check keeps skipping: another runner holds the lock',
          );
        } else if (result.offline + result.online + result.closed + result.failed > 0) {
          logger.info(result, 'display alert check finished');
        }
      },
      (error: unknown) => logger.error({ err: error }, 'display alert check failed'),
    );
    void alertRun.then(() => {
      if (closing) return;
      alertTimer = setTimeout(() => alertLoop(mail), ALERT_INTERVAL_MS);
      alertTimer.unref();
    });
  };

  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    clearInterval(housekeepingTimer);
    clearTimeout(alertTimer);
    // Do not wait for ever on open connections.
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      // The alert run stops claiming at its next organisation (shouldStop); the e-mails it has
      // already claimed get the shutdown budget alongside closing the server.
      await Promise.all([alertRun, app.close(), media.stop()]);
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
  if (ctx.mail === null) logger.warn('SMTP_HOST is not set: e-mail alerts are off');
  else alertLoop(ctx.mail);
  if (config.nodeEnv !== 'production') {
    logger.warn('development configuration: plain http on loopback, development identity realm');
  }
}

void main().catch((error: unknown) => {
  console.error('TINNOX API failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
