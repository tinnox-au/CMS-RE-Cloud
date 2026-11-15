// Applies pending migrations from db/migrations as role tinnox_migrator.
//   npm run db:migrate            development database (DATABASE_MIGRATOR_URL)
//   npm run db:migrate -- --test  integration-test database (TEST_DATABASE_MIGRATOR_URL)
import { join } from 'node:path';
import { runMigrations } from '@tinnox/db';
import { loadEnv, repoRoot, requireEnv } from './lib/env.ts';

loadEnv();
const useTest = process.argv.includes('--test');
const connectionString = requireEnv(
  useTest ? 'TEST_DATABASE_MIGRATOR_URL' : 'DATABASE_MIGRATOR_URL',
);

try {
  const result = await runMigrations({
    connectionString,
    directory: join(repoRoot, 'db', 'migrations'),
    log: (message) => console.log(message),
  });
  console.log(
    result.applied.length === 0
      ? `Database is up to date (${result.alreadyApplied.length} migrations already applied).`
      : `Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
