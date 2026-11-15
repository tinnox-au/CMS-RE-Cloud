// Global setup for `npm run test:integration`: rebuilds the integration-test database
// (name must end in _test) from the migrations, so every run starts from a known schema.
import { join } from 'node:path';
import { resetTestDatabase, runMigrations } from '@tinnox/db';
import { loadEnv, repoRoot, requireEnv } from './lib/env.ts';

export default async function setup(): Promise<void> {
  loadEnv();
  const migratorUrl = requireEnv('TEST_DATABASE_MIGRATOR_URL');
  requireEnv('TEST_DATABASE_URL');
  await resetTestDatabase(migratorUrl);
  await runMigrations({
    connectionString: migratorUrl,
    directory: join(repoRoot, 'db', 'migrations'),
  });
}
