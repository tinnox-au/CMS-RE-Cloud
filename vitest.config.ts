import { defineConfig } from 'vitest/config';

/**
 * Two projects:
 * - unit: pure tests, no services. `npm test`
 * - integration: needs PostgreSQL from infra/docker-compose.yml. `npm run test:integration`
 *   Files run one at a time because they share one test database.
 * Browser end-to-end tests are Playwright tests under tests/e2e (`npm run test:e2e`).
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'packages/*/src/**/*.test.ts',
            'packages/*/test/**/*.test.ts',
            'apps/*/src/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: [
            'packages/*/test/**/*.integration.test.ts',
            'apps/*/test/**/*.integration.test.ts',
            'tests/integration/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**'],
          globalSetup: ['./scripts/vitest-integration-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
