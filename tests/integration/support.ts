/**
 * Support for the repository-level integration and security-boundary tests.
 * The application under test is the real one (apps/api buildApp on a real listener,
 * real PostgreSQL as the runtime role tinnox_app); the harness itself lives next to
 * the API (apps/api/test/support.ts) and is re-exported here.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { PairedPlayer, TestApp } from '../../apps/api/test/support.ts';

export * from '../../apps/api/test/support.ts';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const fixturesDir = join(repoRoot, 'apps', 'api', 'test-fixtures', 'out');
export const WORKER_IMAGE = process.env['TINNOX_WORKER_IMAGE'] ?? 'tinnox-cms-media-worker:m0';

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

/** One connection as the runtime role, with no organisation context unless a test sets one. */
export async function appClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: need('TEST_DATABASE_URL') });
  await client.connect();
  return client;
}

/** Arranging only: runs one statement as the owner of the security functions (bypasses row-level security). */
export async function arrangeAsDefiner(text: string, values: readonly unknown[]): Promise<void> {
  const client = new pg.Client({ connectionString: need('TEST_DATABASE_MIGRATOR_URL') });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE tinnox_definer');
    await client.query(text, [...values]);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

export interface Pairing {
  readonly pairingId: string;
  readonly code: string;
  readonly pollingToken: string;
  readonly expiresAt: string;
}

export async function newPairing(t: TestApp): Promise<Pairing> {
  const response = await fetch(`${t.url}/player/pairing`, { method: 'POST' });
  if (response.status !== 201) throw new Error(`pairing create failed: ${response.status}`);
  return (await response.json()) as Pairing;
}

export function pollPairing(t: TestApp, pairing: Pairing): Promise<Response> {
  return fetch(`${t.url}/player/pairing/${pairing.pairingId}`, {
    headers: { authorization: `Bearer ${pairing.pollingToken}` },
  });
}

export function heartbeatBody(
  displayId: string,
  seq: number,
  fields: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schemaVersion: 1,
    seq,
    sentAt: new Date().toISOString(),
    displayId,
    downloadedPublicationId: null,
    activePublicationId: null,
    activeItemIndex: null,
    playerState: 'idle',
    staging: null,
    errors: [],
    player: { version: 'integration-test', storagePersisted: null, online: true },
    ...fields,
  });
}

export function sendHeartbeat(t: TestApp, player: PairedPlayer, body: string): Promise<Response> {
  return fetch(`${t.url}/player/heartbeat`, {
    method: 'POST',
    headers: { ...player.headers, 'content-type': 'application/json' },
    body,
  });
}

export function requestMediaUrls(
  t: TestApp,
  player: PairedPlayer,
  publicationId: string,
  assetIds: readonly string[],
): Promise<Response> {
  return fetch(`${t.url}/player/media-urls`, {
    method: 'POST',
    headers: { ...player.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ publicationId, assetIds }),
  });
}

/**
 * Starts the real validation worker image on the test application's job directory, with
 * the same isolation as infra/docker-compose.yml. Returns a function that removes it.
 */
export function startWorkerContainer(t: TestApp): () => void {
  // mkdtemp makes the parent 0700; the worker (uid 10001) must be able to enter it on Linux.
  chmodSync(dirname(t.jobsDir), 0o755);
  chmodSync(t.jobsDir, 0o755);
  const id = execFileSync(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--user',
      '10001:10001',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--pids-limit',
      '128',
      '--memory',
      '768m',
      '--cpus',
      '1',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777',
      '--volume',
      `${t.jobsDir}:/jobs:rw`,
      WORKER_IMAGE,
    ],
    { encoding: 'utf8' },
  ).trim();
  return () => {
    execFileSync('docker', ['rm', '--force', id], { stdio: 'ignore' });
  };
}

/** Lets the API ingest worker verdicts until the media leaves `processing`. */
export async function waitForVerdict(
  t: TestApp,
  operator: { fetch(path: string): Promise<Response> },
  mediaId: string,
  timeoutMs = 60_000,
): Promise<{ status: string; errorCode: string | null; codec: string | null; kind: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await t.ctx.media.tick();
    const media = (await (await operator.fetch(`/api/media/${mediaId}`)).json()) as {
      status: string;
      errorCode: string | null;
      codec: string | null;
      kind: string;
    };
    if (media.status !== 'processing') return media;
    if (Date.now() > deadline) throw new Error(`media ${mediaId} is still processing`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
