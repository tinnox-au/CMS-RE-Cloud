/**
 * Runs the e-mail alert check once and exits: `npm run alerts:once -w @tinnox/api`, for a cloud
 * scheduler after deployment. Same configuration and role as the API (config.ts). Exits non-zero
 * when the configuration is refused, e-mail is not configured, the run fails or an e-mail is
 * refused. Safe beside running API instances (alerts.ts).
 */
import { assertConnectionRole, createPool } from '@tinnox/db';
import { runDisplayAlerts } from './alerts.ts';
import { ConfigError, loadConfig } from './config.ts';
import { createLogger } from './logger.ts';
import { createMailer } from './mail.ts';

async function main(): Promise<number> {
  let config;
  try {
    config = loadConfig(process.env);
    assertConnectionRole(config.databaseUrl, 'tinnox_app');
  } catch (error) {
    // Problem text names variables only, never values.
    const problems = error instanceof ConfigError ? error.problems : [(error as Error).message];
    console.error('TINNOX alert check configuration is not acceptable:');
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  const logger = createLogger(config.logLevel, false);
  const mail = createMailer(config.mail);
  if (mail === null) {
    logger.error('SMTP_HOST is not set: e-mail alerts are off');
    return 1;
  }
  const pool = createPool({
    connectionString: config.databaseUrl,
    applicationName: 'tinnox-alerts-once',
    max: 2,
  });
  try {
    const result = await runDisplayAlerts({
      pool,
      now: new Date(),
      mail,
      portalOrigin: config.portalOrigin,
      logger,
    });
    logger.info(result, 'display alert check finished');
    return result.failed > 0 ? 1 : 0;
  } catch (error) {
    logger.error({ err: error }, 'display alert check failed');
    return 1;
  } finally {
    await pool.end();
  }
}

void main().then((code) => process.exit(code));
