import { defineConfig } from 'vitest/config';

/**
 * Integration tests of the API against real PostgreSQL (database tinnox_test, role
 * tinnox_app for the application, tinnox_migrator only to arrange organisations).
 *   npm run test:integration -w @tinnox/api
 * Unit tests in src/ run with the repository's `npm test`.
 * The global setup applies pending migrations but does not wipe the database, so this
 * suite can run next to the repository-level integration suite; every test creates its
 * own organisations with random ids.
 */
export default defineConfig({
  test: {
    name: 'api-integration',
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
