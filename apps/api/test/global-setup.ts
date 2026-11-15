import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '@tinnox/db';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Applies pending migrations to the integration-test database. Never drops anything. */
export default async function setup(): Promise<void> {
  const envFile = join(repoRoot, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const migratorUrl = process.env['TEST_DATABASE_MIGRATOR_URL'];
  if (migratorUrl === undefined || migratorUrl === '') {
    throw new Error(
      'TEST_DATABASE_MIGRATOR_URL is not set; run "npm run setup" and "npm run infra:up"',
    );
  }
  if (!new URL(migratorUrl).pathname.endsWith('_test')) {
    throw new Error('integration tests only run against a *_test database');
  }
  await runMigrations({
    connectionString: migratorUrl,
    directory: join(repoRoot, 'db', 'migrations'),
  });
}
