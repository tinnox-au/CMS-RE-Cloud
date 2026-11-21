/**
 * Process control for the end-to-end run. The API runs as a real process (the same entry
 * point as `npm run start -w @tinnox/api`) so a test can stop and start it; its pid lives
 * in tests/.run (gitignored). Portal and player are served by Playwright's `webServer`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { e2eMediaRoot, e2eUrls } from './database.ts';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const runDir = join(repoRoot, 'tests', '.run');
/**
 * Screenshots and measurements of this run. By default under tests/.run (gitignored), so a
 * run never overwrites the evidence cited in docs/prototype-validation.md. To refresh that
 * evidence deliberately: E2E_EVIDENCE_DIR=docs/evidence npm run test:e2e
 */
export const evidenceDir =
  process.env['E2E_EVIDENCE_DIR'] !== undefined && process.env['E2E_EVIDENCE_DIR'] !== ''
    ? resolve(repoRoot, process.env['E2E_EVIDENCE_DIR'])
    : join(runDir, 'evidence');
export const fixturesDir = join(repoRoot, 'apps', 'api', 'test-fixtures', 'out');

export const PORTAL_URL = 'http://localhost:5173';
export const PLAYER_URL = 'http://localhost:5174';
export const API_URL = 'http://localhost:4000';

const pidFile = join(runDir, 'api.pid');
const apiLog = join(runDir, 'api.log');

function composeArgs(...rest: string[]): string[] {
  return [
    'compose',
    '--env-file',
    join(repoRoot, '.env'),
    '-f',
    join(repoRoot, 'infra', 'docker-compose.yml'),
    '--profile',
    'worker',
    ...rest,
  ];
}

async function apiReady(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/readyz`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: string };
    return body.status === 'ready';
  } catch {
    return false;
  }
}

async function apiListening(): Promise<boolean> {
  try {
    await fetch(`${API_URL}/healthz`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

export async function waitFor(
  what: string,
  check: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Starts the API from source with the repository .env. Fails if something already listens on its port. */
export async function startApi(): Promise<void> {
  mkdirSync(runDir, { recursive: true });
  if (await apiListening()) {
    throw new Error(
      'something already listens on port 4000; stop it (npm run dev?) before the E2E run',
    );
  }
  const out = openSync(apiLog, 'a');
  const child = spawn(
    process.execPath,
    ['--env-file=../../.env', '--import', 'tsx', 'src/main.ts'],
    {
      cwd: join(repoRoot, 'apps', 'api'),
      detached: true,
      stdio: ['ignore', out, out],
      env: {
        ...process.env,
        // Its own database and media directory (support/database.ts). Variables set here
        // win over ../../.env, which Node's --env-file never overrides.
        DATABASE_URL: e2eUrls().app,
        MEDIA_ROOT: e2eMediaRoot,
        // One address creates every pairing session in this run; the limit itself is
        // covered by the integration tests.
        LIMIT_PAIRING_MAX_SESSIONS_PER_IP: '500',
        // Always the local Mailpit (15-alerts.spec.ts reads it), whatever .env or the shell
        // says. The empty values blank out inherited credentials (loadConfig treats '' as unset).
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        SMTP_SECURE: 'false',
        SMTP_USER: '',
        SMTP_PASSWORD: '',
        MAIL_FROM: 'alerts@tinnox-dev.invalid',
      },
    },
  );
  child.unref();
  if (child.pid === undefined) throw new Error('the API process did not start');
  writeFileSync(pidFile, String(child.pid));
  await waitFor('the API to report ready', apiReady, 60_000);
}

export async function stopApi(): Promise<void> {
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, 'utf8'));
  rmSync(pidFile, { force: true });
  if (!Number.isInteger(pid) || pid <= 1) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  await waitFor('the API to stop', async () => !(await apiListening()), 20_000);
}

/**
 * Restarts the PostgreSQL container and waits until it is healthy again. This is the
 * shared development container: anything else connected to it is disconnected too.
 */
export function restartDatabase(): void {
  execFileSync('docker', composeArgs('restart', 'postgres'), { stdio: 'ignore' });
  execFileSync('docker', composeArgs('up', '-d', '--wait', 'postgres'), { stdio: 'ignore' });
}

export function requireInfrastructure(): void {
  const names = execFileSync('docker', composeArgs('ps', '--status', 'running', '--services'), {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((line) => line !== '');
  for (const service of ['postgres', 'keycloak', 'media-worker', 'mailpit']) {
    if (!names.includes(service)) {
      throw new Error(`docker service "${service}" is not running; run "npm run infra:up" first`);
    }
  }
}
