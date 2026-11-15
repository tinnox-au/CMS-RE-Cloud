import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: real Keycloak sign-in, real API process, real media worker
 * container, production builds of the portal and the player (the player's service
 * worker only exists in a build). Needs `npm run infra:up`, `db:migrate`, `db:seed -- --second-org`.
 * The API, portal (5173) and player (5174) are started here and must not already run.
 *
 * Traces and videos are off: they would record the sign-in form.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['json', { outputFile: './.run/e2e-results.json' }]],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run build -w @tinnox/portal && npm run preview -w @tinnox/portal',
      cwd: '..',
      url: 'http://localhost:5173/',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run build -w @tinnox/player-web && npm run preview -w @tinnox/player-web',
      cwd: '..',
      url: 'http://localhost:5174/',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
