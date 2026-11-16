/**
 * Test harness: the real application (buildApp) on a real listener, against the
 * integration-test PostgreSQL database as the runtime role tinnox_app.
 *
 * Two things are substituted, and only here in test code:
 *  - Sign-in. Tests do not drive the identity provider; `signIn` creates a session
 *    row through the same sec.session_create function the callback uses. The real
 *    OIDC flow is exercised by scripts/live-check.mjs against Keycloak.
 *  - The validation worker. `actAsWorker` writes a verdict file into the outbox the
 *    way the worker container does; the API's ingestion code is the real one.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MediaJobResult, PlaylistItemInput } from '@tinnox/contracts';
import { createPool, poolAsTx, sessionCreate, sha256, withOrg, type Pool } from '@tinnox/db';
import { createDeliveryRegistry } from '@tinnox/delivery';
import { LocalObjectStorage } from '@tinnox/storage';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import sharp from 'sharp';
import { buildApp } from '../src/app.ts';
import { IdentityProviderError, type IdentityProvider } from '../src/auth/oidc.ts';
import { loadConfig, type AppConfig } from '../src/config.ts';
import type { AppContext } from '../src/context.ts';
import { MediaPipeline } from '../src/media/pipeline.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const envFile = join(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set; run "npm run setup" and "npm run infra:up"`);
  }
  return value;
}

export const PORTAL_ORIGIN = 'http://localhost:5173';
export const PLAYER_ORIGIN = 'http://localhost:5174';

/** Sign-in is not under test here; any attempt to use the provider fails loudly. */
const noIdentityProvider: IdentityProvider = {
  beginLogin: () =>
    Promise.reject(new IdentityProviderError('unavailable', 'not available in tests')),
  completeLogin: () =>
    Promise.reject(new IdentityProviderError('unavailable', 'not available in tests')),
  endSessionUrl: () => Promise.resolve(null),
  check: () => Promise.resolve(false),
};

export interface TestApp {
  readonly app: FastifyInstance;
  readonly ctx: AppContext;
  readonly config: AppConfig;
  readonly pool: Pool;
  readonly url: string;
  readonly jobsDir: string;
  readonly mediaRoot: string;
  /** Moves the application clock forward (signed URL expiry, staleness, job deadlines). */
  advanceClock(ms: number): void;
  close(): Promise<void>;
}

export async function startTestApp(
  limitOverrides: Record<string, string> = {},
  rateLimitScale = 1000,
): Promise<TestApp> {
  const scratch = await mkdtemp(join(tmpdir(), 'tinnox-api-test-'));
  const jobsDir = join(scratch, 'jobs');
  const mediaRoot = join(scratch, 'media');
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: need('TEST_DATABASE_URL'),
    API_HOST: '127.0.0.1',
    API_PORT: '4000',
    API_PUBLIC_ORIGIN: 'http://localhost:4000',
    PORTAL_ORIGIN,
    PLAYER_ORIGIN,
    // Random per run: tests never depend on the development secrets.
    SESSION_SECRET: randomBytes(32).toString('base64url'),
    MEDIA_URL_HMAC_SECRET: randomBytes(32).toString('base64url'),
    PAIRING_CLIENT_KEY_SECRET: randomBytes(32).toString('base64url'),
    OIDC_ISSUER: 'http://localhost:8080/realms/tinnox-dev',
    OIDC_CLIENT_ID: 'tinnox-portal-bff',
    OIDC_CLIENT_SECRET: randomBytes(24).toString('base64url'),
    OIDC_REDIRECT_URI: `${PORTAL_ORIGIN}/api/auth/callback`,
    OIDC_POST_LOGOUT_REDIRECT_URI: `${PORTAL_ORIGIN}/`,
    MEDIA_ROOT: mediaRoot,
    MEDIA_JOBS_DIR: jobsDir,
    LIMIT_PAIRING_MAX_SESSIONS_PER_IP: '100000',
    ...limitOverrides,
  });
  let offsetMs = 0;
  const now = (): Date => new Date(Date.now() + offsetMs);
  const pool = createPool({
    connectionString: config.databaseUrl,
    applicationName: 'tinnox-api-test',
    max: 12,
  });
  const storage = await LocalObjectStorage.create({ root: mediaRoot });
  const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const media = new MediaPipeline({
    jobsDir,
    pool,
    storage,
    limits: config.limits,
    logger: silent,
    now,
  });
  await media.prepare();
  const ctx: AppContext = {
    config,
    pool,
    storage,
    delivery: createDeliveryRegistry({
      browser: {
        maxAssetBytes: config.limits.maxUploadBytes,
        maxItems: config.limits.maxPlaylistItems,
        maxVideoWidthPx: config.limits.maxVideoWidthPx,
        maxVideoHeightPx: config.limits.maxVideoHeightPx,
      },
    }),
    idp: noIdentityProvider,
    media,
    now,
    rateLimitScale,
  };
  const app = await buildApp(ctx, { logger: false });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as AddressInfo;
  return {
    app,
    ctx,
    config,
    pool,
    url: `http://127.0.0.1:${address.port}`,
    jobsDir,
    mediaRoot,
    advanceClock(ms: number): void {
      offsetMs += ms;
    },
    async close(): Promise<void> {
      await app.close();
      await media.stop();
      await pool.end();
      await rm(scratch, { recursive: true, force: true });
    },
  };
}

export interface TestOrg {
  readonly orgId: string;
  readonly siteId: string;
  readonly membershipId: string;
  readonly oidcSub: string;
}

/** Creates an organisation with one site and one member, as the migrator (arranging data only). */
export async function createOrg(name: string): Promise<TestOrg> {
  const org: TestOrg = {
    orgId: randomUUID(),
    siteId: randomUUID(),
    membershipId: randomUUID(),
    oidcSub: `api-test-${randomUUID()}`,
  };
  const client = new pg.Client({ connectionString: need('TEST_DATABASE_MIGRATOR_URL') });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
    await client.query('INSERT INTO organization (id, name) VALUES ($1, $2)', [org.orgId, name]);
    await client.query('INSERT INTO site (id, org_id, name, timezone) VALUES ($1, $2, $3, $4)', [
      org.siteId,
      org.orgId,
      `${name} site`,
      'Australia/Melbourne',
    ]);
    await client.query('INSERT INTO membership (id, org_id, oidc_sub) VALUES ($1, $2, $3)', [
      org.membershipId,
      org.orgId,
      org.oidcSub,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
  return org;
}

/** Adds a second member to an organisation. */
export async function addMember(org: TestOrg): Promise<TestOrg> {
  const member: TestOrg = {
    ...org,
    membershipId: randomUUID(),
    oidcSub: `api-test-${randomUUID()}`,
  };
  const client = new pg.Client({ connectionString: need('TEST_DATABASE_MIGRATOR_URL') });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
    await client.query('INSERT INTO membership (id, org_id, oidc_sub) VALUES ($1, $2, $3)', [
      member.membershipId,
      member.orgId,
      member.oidcSub,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
  return member;
}

export interface Operator {
  /** Sends a request as the signed-in operator; state-changing methods get Origin and the CSRF token. */
  fetch(path: string, init?: RequestInit & { json?: unknown }): Promise<Response>;
  readonly cookie: string;
  readonly csrfToken: string;
}

/** Creates a session for the member through sec.session_create and returns a client that uses it. */
export async function signIn(t: TestApp, org: TestOrg): Promise<Operator> {
  const sessionId = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const created = await sessionCreate(poolAsTx(t.pool), {
    idHash: sha256(sessionId),
    oidcSub: org.oidcSub,
    csrfToken,
    ttlSeconds: 3600,
    idToken: null,
  });
  if (created === null) throw new Error('test member has no membership');
  const cookie = `${t.config.sessionCookieName}=${sessionId}`;
  return {
    cookie,
    csrfToken,
    fetch(path, init = {}) {
      const { json, ...rest } = init;
      const method = (rest.method ?? 'GET').toUpperCase();
      const headers = new Headers(rest.headers);
      headers.set('cookie', cookie);
      if (method !== 'GET' && method !== 'HEAD') {
        if (!headers.has('origin')) headers.set('origin', PORTAL_ORIGIN);
        if (!headers.has('x-csrf-token')) headers.set('x-csrf-token', csrfToken);
      }
      if (json !== undefined) headers.set('content-type', 'application/json');
      return fetch(`${t.url}${path}`, {
        ...rest,
        method,
        headers,
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      });
    },
  };
}

export async function createDisplay(
  operator: Operator,
  org: TestOrg,
  name = 'Test display',
): Promise<{ id: string }> {
  const response = await operator.fetch('/api/displays', {
    method: 'POST',
    json: { siteId: org.siteId, name, canvas: { width: 640, height: 360 } },
  });
  if (response.status !== 201) throw new Error(`display create failed: ${response.status}`);
  return (await response.json()) as { id: string };
}

export async function pngBytes(width = 32, height = 16): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: randomBytes(1)[0] ?? 0, g: 80, b: 160 },
    },
  })
    .png()
    .toBuffer();
}

export async function uploadBytes(
  operator: Operator,
  bytes: Uint8Array,
  name = 'sample.png',
): Promise<Response> {
  const body = new FormData();
  body.set('file', new Blob([Uint8Array.from(bytes)]), name);
  return operator.fetch('/api/media', { method: 'POST', body });
}

/** Writes a verdict into the outbox exactly as the worker container does (temp file, then rename). */
export async function actAsWorker(
  t: TestApp,
  result: MediaJobResult | string,
  jobId?: string,
): Promise<void> {
  const id = typeof result === 'string' ? jobId : result.jobId;
  if (id === undefined) throw new Error('job id is required for a raw verdict');
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  await writeFile(join(t.jobsDir, 'outbox', `${id}.json`), text);
}

/** Uploads a PNG, lets the "worker" accept it and has the API ingest the verdict. Returns the ready media. */
export async function readyImage(
  t: TestApp,
  operator: Operator,
  size: { width: number; height: number } = { width: 32, height: 16 },
): Promise<{ id: string; bytes: number; sha256: string }> {
  const upload = await uploadBytes(operator, await pngBytes(size.width, size.height));
  if (upload.status !== 201)
    throw new Error(`upload failed: ${upload.status} ${await upload.text()}`);
  const { media } = (await upload.json()) as { media: { id: string } };
  await actAsWorker(t, {
    schemaVersion: 1,
    jobId: media.id,
    outcome: 'accepted',
    kind: 'image',
    mimeType: 'image/png',
    width: size.width,
    height: size.height,
    durationMs: null,
    codec: null,
  });
  await t.ctx.media.tick();
  const after = await operator.fetch(`/api/media/${media.id}`);
  const dto = (await after.json()) as { id: string; status: string; bytes: number; sha256: string };
  if (dto.status !== 'ready') throw new Error(`media did not become ready: ${JSON.stringify(dto)}`);
  return dto;
}

export interface PairedPlayer {
  readonly deviceToken: string;
  readonly registrationId: string;
  readonly headers: Record<string, string>;
}

/** Runs the whole pairing flow over HTTP: player asks, operator claims, player collects. */
export async function pairPlayer(
  t: TestApp,
  operator: Operator,
  displayId: string,
): Promise<PairedPlayer> {
  const created = await fetch(`${t.url}/player/pairing`, { method: 'POST' });
  const pairing = (await created.json()) as {
    pairingId: string;
    code: string;
    pollingToken: string;
  };
  const claim = await operator.fetch(`/api/displays/${displayId}/claim`, {
    method: 'POST',
    json: { code: pairing.code },
  });
  if (claim.status !== 200) throw new Error(`claim failed: ${claim.status}`);
  const poll = await fetch(`${t.url}/player/pairing/${pairing.pairingId}`, {
    headers: { authorization: `Bearer ${pairing.pollingToken}` },
  });
  const body = (await poll.json()) as {
    status: string;
    deviceToken: string;
    registrationId: string;
  };
  if (body.status !== 'claimed') throw new Error(`pairing was not completed: ${body.status}`);
  return {
    deviceToken: body.deviceToken,
    registrationId: body.registrationId,
    headers: { authorization: `Bearer ${body.deviceToken}` },
  };
}

/** Creates a playlist with the given image ids (5 s each) and publishes it to the display. */
export async function publishImages(
  operator: Operator,
  displayId: string,
  mediaIds: readonly string[],
): Promise<{ publicationId: string; playlistId: string }> {
  const playlist = (await (
    await operator.fetch('/api/playlists', { method: 'POST', json: { name: 'Test playlist' } })
  ).json()) as { id: string };
  const put = await operator.fetch(`/api/playlists/${playlist.id}`, {
    method: 'PUT',
    json: {
      name: 'Test playlist',
      items: mediaIds.map((mediaId) => ({ mediaId, durationMs: 5000, fit: null })),
    },
  });
  if (put.status !== 200) throw new Error(`playlist save failed: ${put.status}`);
  const publish = await operator.fetch(`/api/playlists/${playlist.id}/publish`, {
    method: 'POST',
    json: { displayId },
    headers: { 'idempotency-key': randomUUID() },
  });
  if (publish.status !== 201)
    throw new Error(`publish failed: ${publish.status} ${await publish.text()}`);
  const body = (await publish.json()) as { publicationId: string };
  return { publicationId: body.publicationId, playlistId: playlist.id };
}

/**
 * Uploads bytes that begin like an MP4 file and lets the "worker" accept them as an
 * H.264 video. Nothing decodes the bytes here; the real worker is exercised by
 * tests/integration/media-worker.test.ts.
 */
export async function readyVideo(
  t: TestApp,
  operator: Operator,
  durationMs = 8000,
): Promise<{ id: string }> {
  const head = Buffer.from([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const upload = await uploadBytes(operator, Buffer.concat([head, randomBytes(52)]), 'clip.mp4');
  if (upload.status !== 201)
    throw new Error(`upload failed: ${upload.status} ${await upload.text()}`);
  const { media } = (await upload.json()) as { media: { id: string } };
  await actAsWorker(t, {
    schemaVersion: 1,
    jobId: media.id,
    outcome: 'accepted',
    kind: 'video',
    mimeType: 'video/mp4',
    width: 1280,
    height: 720,
    durationMs,
    codec: 'h264',
  });
  await t.ctx.media.tick();
  const after = await operator.fetch(`/api/media/${media.id}`);
  const dto = (await after.json()) as { id: string; status: string };
  if (dto.status !== 'ready') throw new Error(`video did not become ready: ${JSON.stringify(dto)}`);
  return { id: dto.id };
}

/** Creates a playlist and, when items are given, saves them. Returns its id. */
export async function createPlaylist(
  operator: Operator,
  name: string,
  items: readonly PlaylistItemInput[] = [],
): Promise<string> {
  const created = await operator.fetch('/api/playlists', { method: 'POST', json: { name } });
  if (created.status !== 201) throw new Error(`playlist create failed: ${created.status}`);
  const { id } = (await created.json()) as { id: string };
  if (items.length > 0) {
    const saved = await operator.fetch(`/api/playlists/${id}`, {
      method: 'PUT',
      json: { name, items },
    });
    if (saved.status !== 200)
      throw new Error(`playlist save failed: ${saved.status} ${await saved.text()}`);
  }
  return id;
}

/** One image item of `seconds` seconds with the display's default fit. */
export function imageItem(mediaId: string, seconds = 5): PlaylistItemInput {
  return { mediaId, durationMs: seconds * 1000, fit: null };
}

/** Assigns a playlist to a display (null removes the assignment). Nothing is pushed. */
export async function assignPlaylist(
  operator: Operator,
  displayId: string,
  playlistId: string | null,
): Promise<void> {
  const response = await operator.fetch(`/api/displays/${displayId}`, {
    method: 'PATCH',
    json: { assignedPlaylistId: playlistId },
  });
  if (response.status !== 200)
    throw new Error(`assignment failed: ${response.status} ${await response.text()}`);
}

/** `POST /api/push` for the given displays; a fresh Idempotency-Key unless one is passed. */
export function push(
  operator: Operator,
  displayIds: readonly string[],
  key: string = randomUUID(),
): Promise<Response> {
  return operator.fetch('/api/push', {
    method: 'POST',
    json: { displayIds },
    headers: { 'idempotency-key': key },
  });
}

/** The publication a display is currently meant to play, as its status view reports it. */
export async function desiredPublicationId(
  operator: Operator,
  displayId: string,
): Promise<string | null> {
  const response = await operator.fetch(`/api/displays/${displayId}/status`);
  if (response.status !== 200) throw new Error(`status failed: ${response.status}`);
  const view = (await response.json()) as { desired: { publicationId: string } | null };
  return view.desired?.publicationId ?? null;
}

export interface AuditEntry {
  readonly action: string;
  readonly result: string;
  readonly actorId: string | null;
  readonly objectType: string | null;
  readonly objectId: string | null;
  readonly detail: Record<string, unknown> | null;
}

/** The newest audit events of the operator's organisation, newest first. */
export async function auditEvents(operator: Operator, filter = ''): Promise<AuditEntry[]> {
  const response = await operator.fetch(`/api/audit?limit=200${filter}`);
  if (response.status !== 200) throw new Error(`audit list failed: ${response.status}`);
  return ((await response.json()) as { items: AuditEntry[] }).items;
}

/**
 * Fails every media row that is still waiting for validation, in whatever
 * organisation, and returns how many there were.
 *
 * The pipeline has one queue for the whole database, oldest job first, and the
 * deadline of a job grows with every job ahead of it. A test file that finished
 * may have left rows in `processing` (an upload that was never given a verdict,
 * a media row inserted for a database test), and for 30 seconds nothing clears
 * them. A test that measures when a job times out calls this first, so that its
 * result does not depend on which file happened to run before it.
 */
export async function settleStrayMediaJobs(pool: Pool): Promise<number> {
  let settled = 0;
  for (;;) {
    const { rows } = await poolAsTx(pool).query<{ media_id: string; org_id: string }>(
      'SELECT media_id, org_id FROM sec.media_processing_jobs($1)',
      [5000],
    );
    if (rows.length === 0) return settled;
    const byOrg = new Map<string, string[]>();
    for (const row of rows) byOrg.set(row.org_id, [...(byOrg.get(row.org_id) ?? []), row.media_id]);
    let changed = 0;
    for (const [orgId, mediaIds] of byOrg) {
      changed += await withOrg(pool, orgId, async (tx) => {
        const done = await tx.query(
          `UPDATE media
           SET status = 'failed', error_code = 'inspection_timeout',
               error_detail = 'Left in processing by an earlier test file.'
           WHERE org_id = app_org_id() AND id = ANY($1::uuid[]) AND status = 'processing'`,
          [mediaIds],
        );
        return done.rowCount ?? 0;
      });
    }
    if (changed === 0) throw new Error('media rows in processing could not be settled');
    settled += changed;
  }
}

export async function listDir(path: string): Promise<string[]> {
  return (await readdir(path)).filter((name) => !name.startsWith('.worker-alive'));
}
