import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { prepareE2eDatabase } from './support/database.ts';
import {
  evidenceDir,
  fixturesDir,
  repoRoot,
  requireInfrastructure,
  startApi,
  stopApi,
} from './support/stack.ts';

/**
 * Checks the containers, rebuilds the E2E database, makes the sample media if needed and
 * starts the API process.
 */
export default async function globalSetup(): Promise<void> {
  if (!existsSync(join(repoRoot, '.env'))) {
    throw new Error('.env is missing; run "npm run setup" first');
  }
  process.loadEnvFile(join(repoRoot, '.env'));
  requireInfrastructure();
  // Stop an API left behind by an interrupted run before its database is rebuilt.
  await stopApi();
  await prepareE2eDatabase();
  if (
    !existsSync(join(fixturesDir, 'h264.mp4')) ||
    !existsSync(join(fixturesDir, 'landscape.jpg'))
  ) {
    execFileSync(
      process.execPath,
      [join(repoRoot, 'apps', 'api', 'test-fixtures', 'generate.mjs')],
      {
        stdio: 'inherit',
      },
    );
  }
  mkdirSync(evidenceDir, { recursive: true });
  await startApi();
}
