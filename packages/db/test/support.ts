import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createPool, violatedConstraint, type Pool } from '../src/index.ts';

const envFile = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '')
    throw new Error(`${name} is not set; run "npm run setup" and "npm run infra:up"`);
  return value;
}

/** Pool connected as the runtime role tinnox_app to the integration-test database. */
export function appPool(max = 4): Pool {
  return createPool({
    connectionString: need('TEST_DATABASE_URL'),
    applicationName: 'tinnox-test-app',
    max,
  });
}

/** Connection string of the integration-test database for role tinnox_migrator. */
export function migratorUrl(): string {
  return need('TEST_DATABASE_MIGRATOR_URL');
}

/** Single connection as tinnox_migrator, for arranging test data. */
export async function migratorClient(): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: migratorUrl(),
    application_name: 'tinnox-test-arrange',
  });
  await client.connect();
  return client;
}

export interface TestOrg {
  orgId: string;
  siteId: string;
  membershipId: string;
  oidcSub: string;
  displayId: string;
  mediaId: string;
  playlistId: string;
  publicationId: string;
  folderId: string;
  /** A tag of scope `media`, put on the media item. */
  mediaTagId: string;
  /** A tag of scope `display`, put on the display. */
  displayTagId: string;
}

export const hash = (): Buffer => randomBytes(32);

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export function pairingCode(): string {
  return Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/**
 * Creates a complete organisation as the migrator: site, member, display, ready media in a
 * folder, playlist (assigned to the display), publication, audit row, and one tag of each
 * scope put on the media item and on the display. Every tenant table that the runtime role
 * writes directly gets exactly one row, except `tag`, which gets two.
 */
export async function createOrg(migrator: pg.Client, name: string): Promise<TestOrg> {
  const o: TestOrg = {
    orgId: randomUUID(),
    siteId: randomUUID(),
    membershipId: randomUUID(),
    oidcSub: `test-sub-${randomUUID()}`,
    displayId: randomUUID(),
    mediaId: randomUUID(),
    playlistId: randomUUID(),
    publicationId: randomUUID(),
    folderId: randomUUID(),
    mediaTagId: randomUUID(),
    displayTagId: randomUUID(),
  };
  const manifest = {
    schemaVersion: 1,
    publicationId: o.publicationId,
    displayId: o.displayId,
    createdAt: new Date().toISOString(),
    canvas: { width: 640, height: 1344 },
    contentRect: null,
    muted: true,
    assets: [
      {
        assetId: o.mediaId,
        mediaType: 'image/png',
        kind: 'image',
        bytes: 10,
        sha256: 'ab'.repeat(32),
        durationMs: 5000,
        fit: 'contain',
        width: 4,
        height: 4,
      },
    ],
  };
  await migrator.query('BEGIN');
  try {
    await migrator.query("SELECT set_config('app.org_id', $1, true)", [o.orgId]);
    await migrator.query('INSERT INTO organization (id, name) VALUES ($1, $2)', [o.orgId, name]);
    await migrator.query('INSERT INTO site (id, org_id, name, timezone) VALUES ($1, $2, $3, $4)', [
      o.siteId,
      o.orgId,
      `${name} site`,
      'Australia/Melbourne',
    ]);
    await migrator.query('INSERT INTO membership (id, org_id, oidc_sub) VALUES ($1, $2, $3)', [
      o.membershipId,
      o.orgId,
      o.oidcSub,
    ]);
    await migrator.query(
      'INSERT INTO display (id, org_id, site_id, name, canvas_width, canvas_height) VALUES ($1, $2, $3, $4, 640, 1344)',
      [o.displayId, o.orgId, o.siteId, `${name} display`],
    );
    await migrator.query('INSERT INTO folder (id, org_id, name) VALUES ($1, $2, $3)', [
      o.folderId,
      o.orgId,
      `${name} folder`,
    ]);
    await migrator.query(
      `INSERT INTO tag (id, org_id, scope, name) VALUES ($1, $3, 'media', $4), ($2, $3, 'display', $5)`,
      [o.mediaTagId, o.displayTagId, o.orgId, `${name} media tag`, `${name} display tag`],
    );
    await migrator.query(
      `INSERT INTO media (id, org_id, kind, status, mime_type, bytes, sha256, width, height, storage_key, original_name, folder_id)
       VALUES ($1, $2, 'image', 'ready', 'image/png', 10, $3, 4, 4, $4, 'pixel.png', $5)`,
      [o.mediaId, o.orgId, 'ab'.repeat(32), `${o.orgId}/${randomUUID()}`, o.folderId],
    );
    await migrator.query('INSERT INTO media_tag (media_id, tag_id, org_id) VALUES ($1, $2, $3)', [
      o.mediaId,
      o.mediaTagId,
      o.orgId,
    ]);
    await migrator.query(
      'INSERT INTO display_tag (display_id, tag_id, org_id) VALUES ($1, $2, $3)',
      [o.displayId, o.displayTagId, o.orgId],
    );
    await migrator.query('INSERT INTO playlist (id, org_id, name) VALUES ($1, $2, $3)', [
      o.playlistId,
      o.orgId,
      `${name} playlist`,
    ]);
    await migrator.query('UPDATE display SET assigned_playlist_id = $2 WHERE id = $1', [
      o.displayId,
      o.playlistId,
    ]);
    await migrator.query(
      'INSERT INTO playlist_item (org_id, playlist_id, position, media_id, duration_ms) VALUES ($1, $2, 0, $3, 5000)',
      [o.orgId, o.playlistId, o.mediaId],
    );
    await migrator.query(
      'INSERT INTO publication (id, org_id, display_id, playlist_id, manifest, idempotency_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        o.publicationId,
        o.orgId,
        o.displayId,
        o.playlistId,
        JSON.stringify(manifest),
        `seed-${randomUUID()}`,
        o.membershipId,
      ],
    );
    await migrator.query(
      'INSERT INTO publication_asset (publication_id, position, org_id, media_id) VALUES ($1, 0, $2, $3)',
      [o.publicationId, o.orgId, o.mediaId],
    );
    await migrator.query(
      'INSERT INTO display_delivery (display_id, org_id, desired_publication_id, desired_at) VALUES ($1, $2, $3, now())',
      [o.displayId, o.orgId, o.publicationId],
    );
    await migrator.query(
      `INSERT INTO audit_event (org_id, actor_type, actor_id, action, object_type, object_id, result)
       VALUES ($1, 'operator', $2, 'publication.create', 'publication', $3, 'success')`,
      [o.orgId, o.membershipId, o.publicationId],
    );
    await migrator.query('COMMIT');
  } catch (error) {
    await migrator.query('ROLLBACK');
    throw error;
  }
  return o;
}

/** Resolves to the PostgreSQL error code of a rejected promise, or 'no error'. */
export async function pgCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no error';
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string'
      ? code
      : `non-pg error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Resolves to the error code and the constraint name of a rejected promise, or null when it resolved. */
export async function pgViolation(
  promise: Promise<unknown>,
): Promise<{ code: string | null; constraint: string | null } | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return { code: typeof code === 'string' ? code : null, constraint: violatedConstraint(error) };
  }
}

export const PG = {
  insufficientPrivilege: '42501',
  rlsViolation: '42501',
  foreignKey: '23503',
  unique: '23505',
  check: '23514',
  restrict: '23001',
  invalidText: '22P02',
} as const;
