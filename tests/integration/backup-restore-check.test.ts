/**
 * The backup and restore exercise (`npm run backup:verify`, scripts/backup-restore-check.sh)
 * run for real: pg_dump, pg_restore and tar inside and next to the compose PostgreSQL.
 *
 * Each case builds a database in its own `_test` database (never the development one and
 * never the shared integration-test database), with media files under a temporary media
 * root, and runs the unchanged script against it through its BACKUP_* overrides. Manifests
 * are built by the domain's `buildManifest`, so each publication has the version the API
 * would write. It covers the valid shapes that used to fail (backend review round 1, CU-01:
 * no ready media; and no publications yet), backups that must still fail (a changed or
 * missing file, a missing thumbnail, an empty database) and restored controls that must
 * still be checked (the publication triggers, forced row-level security, tenant isolation).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppContent } from '@tinnox/contracts';
import { resetTestDatabase, runMigrations } from '@tinnox/db';
import { buildManifest, type ResolvedItem, type ResolvedMediaItem } from '@tinnox/domain';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixturesDir, repoRoot } from './support.ts';

const SOURCE_DB = 'tinnox_backupcheck_test';
const RESTORE_DB = 'tinnox_backupcheck_restore_test';
const SCRIPT = join(repoRoot, 'scripts', 'backup-restore-check.sh');
const RUN_TIMEOUT_MS = 180_000;

const COMPOSE = [
  'compose',
  '--env-file',
  join(repoRoot, '.env'),
  '-f',
  join(repoRoot, 'infra', 'docker-compose.yml'),
];

/** Runs a PostgreSQL client tool inside the compose container as the superuser. */
function inPostgres(...args: string[]): void {
  execFileSync('docker', [...COMPOSE, 'exec', '-T', 'postgres', ...args], { stdio: 'pipe' });
}

function dropTestDatabases(): void {
  for (const db of [RESTORE_DB, SOURCE_DB]) {
    inPostgres('dropdb', '-U', 'postgres', '--if-exists', '--force', db);
  }
}

function sourceUrl(): string {
  const value = process.env['TEST_DATABASE_MIGRATOR_URL'];
  if (value === undefined || value === '') throw new Error('TEST_DATABASE_MIGRATOR_URL is not set');
  const url = new URL(value);
  url.pathname = `/${SOURCE_DB}`;
  return url.toString();
}

let work: string;
let mediaRoot: string;

interface Run {
  readonly status: number | null;
  readonly output: string;
}

function runCheck(env: Record<string, string> = {}): Run {
  const result = spawnSync('bash', [SCRIPT], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    env: {
      ...process.env,
      BACKUP_SOURCE_DB: SOURCE_DB,
      BACKUP_RESTORE_DB: RESTORE_DB,
      BACKUP_MEDIA_ROOT: mediaRoot,
      BACKUP_ROOT: join(work, 'backups'),
      ...env,
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** Runs `build` in one transaction as tinnox_migrator, the owner of every table. */
async function arrange<T>(build: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    connectionString: sourceUrl(),
    application_name: 'tinnox-test-backup',
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const result = await build(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

interface Org {
  readonly orgId: string;
  readonly membershipId: string;
  readonly displayId: string;
  readonly playlistId: string;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly timeZone: string;
}

/** An organisation with a site, an operator, one screen and one playlist (as the API makes them). */
async function createOrg(
  c: pg.Client,
  input: {
    name: string;
    site: string;
    timeZone: string;
    display: string;
    width: number;
    height: number;
  },
): Promise<Org> {
  const org = {
    orgId: randomUUID(),
    membershipId: randomUUID(),
    displayId: randomUUID(),
    playlistId: randomUUID(),
    canvas: { width: input.width, height: input.height },
    timeZone: input.timeZone,
  };
  const siteId = randomUUID();
  // Every tenant table forces row-level security, the owner included.
  await c.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
  await c.query('INSERT INTO organization (id, name) VALUES ($1, $2)', [org.orgId, input.name]);
  await c.query('INSERT INTO site (id, org_id, name, timezone) VALUES ($1, $2, $3, $4)', [
    siteId,
    org.orgId,
    input.site,
    input.timeZone,
  ]);
  await c.query('INSERT INTO membership (id, org_id, oidc_sub) VALUES ($1, $2, $3)', [
    org.membershipId,
    org.orgId,
    `test-sub-${randomUUID()}`,
  ]);
  await c.query(
    'INSERT INTO display (id, org_id, site_id, name, canvas_width, canvas_height) VALUES ($1, $2, $3, $4, $5, $6)',
    [org.displayId, org.orgId, siteId, input.display, input.width, input.height],
  );
  await c.query('INSERT INTO playlist (id, org_id, name) VALUES ($1, $2, $3)', [
    org.playlistId,
    org.orgId,
    `${input.display} loop`,
  ]);
  await c.query('UPDATE display SET assigned_playlist_id = $2 WHERE id = $1', [
    org.displayId,
    org.playlistId,
  ]);
  return org;
}

async function addApp(
  c: pg.Client,
  org: Org,
  name: string,
  content: AppContent,
  durationMs: number,
): Promise<ResolvedItem> {
  const appId = randomUUID();
  await c.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
  await c.query('INSERT INTO app (id, org_id, type, name, settings) VALUES ($1, $2, $3, $4, $5)', [
    appId,
    org.orgId,
    content.type,
    name,
    JSON.stringify(content.settings),
  ]);
  return { kind: 'app', appId, content, durationMs };
}

interface StoredImage {
  readonly item: ResolvedMediaItem;
  /** Absolute paths of the stored object and its thumbnail under the media root. */
  readonly file: string;
  readonly thumbnail: string;
}

/** A validated image as the worker leaves it: the object, a JPEG thumbnail and a ready row. */
async function addReadyImage(c: pg.Client, org: Org, originalName: string): Promise<StoredImage> {
  const data = readFileSync(join(fixturesDir, 'landscape.jpg'));
  const mediaId = randomUUID();
  const key = `${org.orgId}/${randomUUID()}`;
  const thumbKey = `${org.orgId}/${randomUUID()}`;
  mkdirSync(join(mediaRoot, 'objects', org.orgId), { recursive: true });
  const file = join(mediaRoot, 'objects', key);
  const thumbnail = join(mediaRoot, 'objects', thumbKey);
  writeFileSync(file, data);
  // The row stores no thumbnail hash; the check only needs a non-empty file.
  writeFileSync(thumbnail, data);
  const sha256 = createHash('sha256').update(data).digest('hex');
  await c.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
  await c.query(
    `INSERT INTO media (id, org_id, kind, status, mime_type, bytes, sha256, width, height,
                        storage_key, thumb_storage_key, original_name, created_by)
     VALUES ($1, $2, 'image', 'ready', 'image/jpeg', $3, $4, 640, 360, $5, $6, $7, $8)`,
    [mediaId, org.orgId, data.byteLength, sha256, key, thumbKey, originalName, org.membershipId],
  );
  return {
    file,
    thumbnail,
    item: {
      assetId: mediaId,
      kind: 'image',
      mediaType: 'image/jpeg',
      codec: null,
      bytes: data.byteLength,
      sha256,
      durationMs: 10_000,
      fit: 'contain',
      width: 640,
      height: 360,
      availableFrom: null,
      availableUntil: null,
    },
  };
}

/** Puts `items` in the screen's playlist and publishes it, with the manifest the API would build. */
async function publish(c: pg.Client, org: Org, items: readonly ResolvedItem[]): Promise<void> {
  const publicationId = randomUUID();
  await c.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
  for (const [position, item] of items.entries()) {
    const media = item.kind !== 'app';
    await c.query(
      'INSERT INTO playlist_item (org_id, playlist_id, position, media_id, app_id, duration_ms, fit) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        org.orgId,
        org.playlistId,
        position,
        media ? item.assetId : null,
        media ? null : item.appId,
        item.durationMs,
        media ? item.fit : null,
      ],
    );
  }
  const manifest = buildManifest(
    {
      displayId: org.displayId,
      canvas: org.canvas,
      contentRect: null,
      audio: false,
      items,
      transition: 'cut',
      shuffle: false,
      rotation: 0,
      workingHours: null,
      timeZone: org.timeZone,
      schedule: null,
      zones: null,
    },
    { publicationId, createdAt: new Date() },
  );
  await c.query(
    'INSERT INTO publication (id, org_id, display_id, playlist_id, manifest, idempotency_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [
      publicationId,
      org.orgId,
      org.displayId,
      org.playlistId,
      JSON.stringify(manifest),
      randomBytes(16).toString('hex'),
      org.membershipId,
    ],
  );
  for (const [position, item] of items.entries()) {
    if (item.kind === 'app') continue;
    await c.query(
      'INSERT INTO publication_asset (publication_id, position, org_id, media_id) VALUES ($1, $2, $3, $4)',
      [publicationId, position, org.orgId, item.assetId],
    );
  }
  await c.query(
    'INSERT INTO display_delivery (display_id, org_id, desired_publication_id, desired_at) VALUES ($1, $2, $3, now())',
    [org.displayId, org.orgId, publicationId],
  );
}

const NAVY = { textColour: '#ffffff', backgroundColour: '#0b1f3a' };

function melbourne(c: pg.Client): Promise<Org> {
  return createOrg(c, {
    name: 'TINNOX Internal',
    site: 'Melbourne Workshop',
    timeZone: 'Australia/Melbourne',
    display: 'Reception welcome screen',
    width: 1920,
    height: 1080,
  });
}

function sydney(c: pg.Client): Promise<Org> {
  return createOrg(c, {
    name: 'Harbour Dental',
    site: 'Sydney clinic',
    timeZone: 'Australia/Sydney',
    display: 'Waiting room screen',
    width: 1080,
    height: 1920,
  });
}

async function welcomeApps(c: pg.Client, org: Org): Promise<ResolvedItem[]> {
  return [
    await addApp(
      c,
      org,
      'Reception welcome message',
      {
        type: 'text',
        settings: { heading: 'Welcome', body: 'Please sign in at the front desk.', ...NAVY },
      },
      12_000,
    ),
    await addApp(
      c,
      org,
      'Local time',
      { type: 'clock', settings: { hourCycle: '12', showSeconds: false, ...NAVY } },
      8_000,
    ),
  ];
}

/** One organisation with a published image and two published apps. */
async function publishedImage(): Promise<StoredImage> {
  return arrange(async (c) => {
    const a = await melbourne(c);
    const image = await addReadyImage(c, a, 'showroom-banner.jpg');
    await publish(c, a, [...(await welcomeApps(c, a)), image.item]);
    return image;
  });
}

/** Changes the source database's schema as its owner, after the data is in place. */
async function alterSource(statement: string): Promise<void> {
  await arrange(async (c) => {
    await c.query(statement);
  });
}

/** A media root as the API leaves it on start: `objects` exists even before the first upload. */
function freshMediaRoot(): string {
  const root = join(work, `media-${randomUUID()}`);
  mkdirSync(join(root, 'objects'), { recursive: true });
  return root;
}

const ISOLATION_LINE =
  /rows visible to tinnox_app with no organisation context: 0 of [1-9]\d* in the [1-9]\d* tables it may read/;

beforeAll(() => {
  if (!existsSync(join(fixturesDir, 'landscape.jpg'))) {
    throw new Error('sample media are missing; run "npm run fixtures" first');
  }
  work = mkdtempSync(join(tmpdir(), 'tinnox-backup-check-'));
  dropTestDatabases();
  inPostgres('createdb', '-U', 'postgres', '-O', 'tinnox_migrator', SOURCE_DB);
});

afterAll(() => {
  try {
    dropTestDatabases();
  } finally {
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  await resetTestDatabase(sourceUrl());
  await runMigrations({
    connectionString: sourceUrl(),
    directory: join(repoRoot, 'db', 'migrations'),
  });
  mediaRoot = freshMediaRoot();
});

describe('backup and restore check: valid databases pass', () => {
  it(
    'passes when no organisation has ready media and every publication is apps only (CU-01)',
    async () => {
      await arrange(async (c) => {
        const a = await melbourne(c);
        await publish(c, a, await welcomeApps(c, a));
        const b = await sydney(c);
        await publish(c, b, await welcomeApps(c, b));
      });
      const run = runCheck();
      expect(run.output).toContain('media (status ready)|0');
      expect(run.output).toContain('counts match');
      expect(run.output).toContain('media rows: none ready, nothing to check');
      expect(run.output).toContain(
        'publication assets: no media items to check (every item is an app)',
      );
      expect(run.output).toContain('publications: 2; media items: 0; app items (no file): 4');
      expect(run.output).toContain(
        'note: no ready media and no published media item, so no file was compared',
      );
      expect(run.output).toMatch(ISOLATION_LINE);
      expect(run.output).toContain('publication update refused by trigger: yes');
      expect(run.output).toContain('publication truncate refused by trigger: yes');
      expect(run.output).toContain('RESULT: restore verified');
      expect(run.status, run.output).toBe(0);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'passes when media is uploaded but nothing is published yet',
    async () => {
      await arrange(async (c) => {
        const a = await melbourne(c);
        await addReadyImage(c, a, 'showroom-banner.jpg');
        await welcomeApps(c, a);
      });
      const run = runCheck();
      expect(run.output).toContain('media (status ready)|1');
      expect(run.output).toContain(
        'media rows: checked 1; missing 0; hash mismatches 0; size mismatches 0',
      );
      expect(run.output).toContain('thumbnails: checked 1; missing or empty 0');
      expect(run.output).toContain('publication assets: no publications to check');
      expect(run.output).toContain(
        'publication update: not tried (no publications); its trigger is present and enabled',
      );
      expect(run.output).toContain('publication truncate refused by trigger: yes');
      expect(run.output).toContain('RESULT: restore verified');
      expect(run.status, run.output).toBe(0);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'passes an organisation that has apps but has published nothing and uploaded nothing',
    async () => {
      await arrange(async (c) => {
        const a = await melbourne(c);
        await welcomeApps(c, a);
      });
      const run = runCheck();
      expect(run.output).toContain('counts match');
      expect(run.output).toContain('publication assets: no publications to check');
      expect(run.output).toContain(
        'note: no ready media and no published media item, so no file was compared',
      );
      expect(run.output).toMatch(ISOLATION_LINE);
      expect(run.output).toContain('RESULT: restore verified');
      expect(run.status, run.output).toBe(0);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'checks every file of a database with media, apps and two organisations',
    async () => {
      await arrange(async (c) => {
        const a = await melbourne(c);
        const banner = await addReadyImage(c, a, 'showroom-banner.jpg');
        // Media only: the API writes this as a version 1 manifest.
        await publish(c, a, [banner.item]);
        const b = await sydney(c);
        const poster = await addReadyImage(c, b, 'opening-hours.jpg');
        await publish(c, b, [...(await welcomeApps(c, b)), poster.item]);
      });
      const run = runCheck();
      expect(run.output).toContain('media (status ready)|2');
      expect(run.output).toContain(
        'media rows: checked 2; missing 0; hash mismatches 0; size mismatches 0',
      );
      expect(run.output).toContain('thumbnails: checked 2; missing or empty 0');
      expect(run.output).toContain(
        'publication assets: checked 2; missing 0; hash mismatches 0; size mismatches 0',
      );
      expect(run.output).toContain('publications: 2; media items: 2; app items (no file): 2');
      expect(run.output).not.toContain(
        'note: no ready media and no published media item, so no file was compared',
      );
      expect(run.output).toMatch(ISOLATION_LINE);
      expect(run.output).toContain('RESULT: restore verified');
      expect(run.status, run.output).toBe(0);
    },
    RUN_TIMEOUT_MS,
  );
});

describe('backup and restore check: broken backups fail', () => {
  it(
    'fails when a stored file no longer has its recorded hash',
    async () => {
      const banner = await publishedImage();
      // Same length, different content: only the hash can tell.
      const data = readFileSync(banner.file);
      data[data.length - 1] = (data.at(-1) ?? 0) ^ 0xff;
      writeFileSync(banner.file, data);
      const run = runCheck();
      expect(run.output).toContain(
        'media rows: checked 1; missing 0; hash mismatches 1; size mismatches 0',
      );
      expect(run.output).toContain(
        'publication assets: checked 1; missing 0; hash mismatches 1; size mismatches 0',
      );
      expect(run.output).toContain('RESULT: FAILED');
      expect(run.status, run.output).toBe(1);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'fails when a published file is missing from the media backup',
    async () => {
      const banner = await publishedImage();
      rmSync(banner.file);
      const run = runCheck();
      expect(run.output).toContain('media rows: checked 1; missing 1');
      expect(run.output).toContain('publication assets: checked 1; missing 1');
      expect(run.output).toContain('RESULT: FAILED');
      expect(run.status, run.output).toBe(1);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'fails when a thumbnail is missing',
    async () => {
      const banner = await publishedImage();
      rmSync(banner.thumbnail);
      const run = runCheck();
      expect(run.output).toContain('thumbnails: checked 1; missing or empty 1');
      expect(run.output).toContain('RESULT: FAILED');
      expect(run.status, run.output).toBe(1);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'fails an empty database: there is no organisation, so nothing was verified',
    async () => {
      const run = runCheck();
      expect(run.output).toContain('counts match');
      expect(run.output).toContain(
        'NOTHING TO VERIFY: the database has no organisation (empty database?)',
      );
      expect(run.output).toContain('RESULT: FAILED');
      expect(run.status, run.output).toBe(1);
    },
    RUN_TIMEOUT_MS,
  );
});

describe('backup and restore check: restored controls are verified', () => {
  it(
    'fails when publications can be updated',
    async () => {
      await publishedImage();
      await alterSource('DROP TRIGGER publication_immutable ON publication');
      const run = runCheck();
      expect(run.output).toContain('PUBLICATION update WAS ALLOWED');
      expect(run.output).toContain('RESULT: FAILED');
      expect(run.status, run.output).toBe(1);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'fails when the publication update trigger is gone and there are no publications to try',
    async () => {
      await arrange(async (c) => {
        const a = await melbourne(c);
        await addReadyImage(c, a, 'showroom-banner.jpg');
      });
      await alterSource('DROP TRIGGER publication_immutable ON publication');
      const run = runCheck();
      expect(run.output).toContain('PUBLICATION UPDATE TRIGGER MISSING OR DISABLED');
      expect(run.output).toContain('RESULT: FAILED');
      expect(run.status, run.output).toBe(1);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "fails when only publication_asset's trigger refuses the truncate",
    async () => {
      await publishedImage();
      await alterSource('DROP TRIGGER publication_no_truncate ON publication');
      const run = runCheck();
      expect(run.output).toContain('publication update refused by trigger: yes');
      expect(run.output).toContain('PUBLICATION truncate NOT REFUSED BY ITS TRIGGER');
      expect(run.output).toContain('RESULT: FAILED');
      expect(run.status, run.output).toBe(1);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'fails when a table no longer forces row-level security',
    async () => {
      await publishedImage();
      await alterSource('ALTER TABLE media NO FORCE ROW LEVEL SECURITY');
      const run = runCheck();
      expect(run.output).toMatch(
        /data tables in public: (\d+); with forced row-level security: (?!\1;)\d+;/,
      );
      expect(run.output).toContain('RESULT: FAILED');
      expect(run.status, run.output).toBe(1);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'fails when the runtime role can read rows without an organisation context',
    async () => {
      // An app-only database: media is empty, so only the wider probe can see the leak.
      await arrange(async (c) => {
        const a = await melbourne(c);
        await publish(c, a, await welcomeApps(c, a));
      });
      await alterSource('CREATE POLICY leak ON app FOR SELECT TO tinnox_app USING (true)');
      const run = runCheck();
      expect(run.output).toMatch(
        /rows visible to tinnox_app with no organisation context: [1-9]\d* of/,
      );
      expect(run.output).toContain('RESULT: FAILED');
      expect(run.status, run.output).toBe(1);
    },
    RUN_TIMEOUT_MS,
  );
});

describe('backup and restore check: overrides cannot point the restore at the source', () => {
  it('refuses a restore database name that is not a scratch name', () => {
    const run = runCheck({ BACKUP_RESTORE_DB: SOURCE_DB });
    expect(run.output).toContain('BACKUP_RESTORE_DB must end in _restore or _restore_test');
    expect(run.status).toBe(2);
  });

  it('refuses a restore database that is the source', () => {
    const run = runCheck({
      BACKUP_SOURCE_DB: 'tinnox_restore',
      BACKUP_RESTORE_DB: 'tinnox_restore',
    });
    expect(run.output).toContain('the restore database must differ from the source');
    expect(run.status).toBe(2);
  });

  it('refuses a database name that is not a plain identifier', () => {
    const run = runCheck({ BACKUP_SOURCE_DB: 'tinnox; DROP DATABASE tinnox' });
    expect(run.output).toContain('invalid database name');
    expect(run.status).toBe(2);
  });

  it('refuses a name PostgreSQL would truncate onto another database', () => {
    // 63 bytes is the limit; a longer restore name could resolve to the 63-byte source.
    const source = 'a'.repeat(63);
    const run = runCheck({ BACKUP_SOURCE_DB: source, BACKUP_RESTORE_DB: `${source}_restore` });
    // The 63-byte source itself is valid; only the longer restore name is refused.
    expect(run.output).toContain(`invalid database name: ${source}_restore`);
    expect(run.output).not.toContain(`invalid database name: ${source}\n`);
    expect(run.status).toBe(2);
  });
});
