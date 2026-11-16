/**
 * Upgrading an M0 installation to portal v2, seen through the API.
 *
 * `packages/db/test/migration-0005.integration.test.ts` proves the backfill at the
 * database. This file proves what an operator gets after the upgrade: the test
 * database is rebuilt at migration 0004 and filled the way M0 left one (displays
 * that were published to, with full version 1 manifests), then every later
 * migration is applied with the real runner and the real application is started
 * on top. Each display must come up with the playlist it was last given assigned,
 * and "push to displays" must agree with what the displays already have.
 *
 * It resets the shared integration-test database. Integration files run one at a
 * time and arrange their own data; `afterAll` leaves the database at the newest
 * migration whatever happened.
 */
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DisplayListResponseSchema,
  MediaListResponseSchema,
  MediaUsageResponseSchema,
  OverviewResponseSchema,
  PlaylistListResponseSchema,
  PushPlanResponseSchema,
  PushResponseSchema,
  type ManifestV1,
} from '@tinnox/contracts';
import { resetTestDatabase, runMigrations } from '@tinnox/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  repoRoot,
  signIn,
  startTestApp,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

const MIGRATIONS = join(repoRoot, 'db', 'migrations');
/** The last migration of M0; everything after it is the upgrade under test. */
const LAST_M0_MIGRATION = '0004_review_hardening.sql';

function migratorUrl(): string {
  const value = process.env['TEST_DATABASE_MIGRATOR_URL'];
  if (value === undefined || value === '') {
    throw new Error('TEST_DATABASE_MIGRATOR_URL is not set');
  }
  return value;
}

interface LegacyOrg extends TestOrg {
  readonly mediaId: string;
  /** Published to `current`; its items are what was published. */
  readonly steadyPlaylistId: string;
  /** Published to `edited`, then changed: its items differ from what was published. */
  readonly editedPlaylistId: string;
  readonly displays: {
    /** Given the steady playlist as it is now. */
    readonly current: string;
    /** Given the edited playlist as it was before the edit. */
    readonly edited: string;
    /** Never published to. */
    readonly never: string;
  };
  readonly publications: { readonly current: string; readonly edited: string };
}

const SHA256 = 'c0'.repeat(32);

/** Inserts one organisation using only what exists at migration 0004. */
async function createLegacyOrg(migrator: pg.Client, name: string): Promise<LegacyOrg> {
  const orgId = randomUUID();
  const siteId = randomUUID();
  const membershipId = randomUUID();
  const oidcSub = `legacy-sub-${randomUUID()}`;
  const mediaId = randomUUID();
  const steady = randomUUID();
  const edited = randomUUID();

  const display = async (label: string): Promise<string> => {
    const id = randomUUID();
    await migrator.query(
      `INSERT INTO display (id, org_id, site_id, name, canvas_width, canvas_height, default_fit)
       VALUES ($1, $2, $3, $4, 640, 360, 'contain')`,
      [id, orgId, siteId, `${name} ${label}`],
    );
    return id;
  };
  const playlist = async (id: string, label: string, durationMs: number): Promise<void> => {
    await migrator.query('INSERT INTO playlist (id, org_id, name) VALUES ($1, $2, $3)', [
      id,
      orgId,
      `${name} ${label}`,
    ]);
    await migrator.query(
      `INSERT INTO playlist_item (org_id, playlist_id, position, media_id, duration_ms, fit)
       VALUES ($1, $2, 0, $3, $4, NULL)`,
      [orgId, id, mediaId, durationMs],
    );
  };
  /** A publication as M0 made it: a full version 1 manifest, its asset row, made desired. */
  const publish = async (
    displayId: string,
    playlistId: string,
    durationMs: number,
  ): Promise<string> => {
    const id = randomUUID();
    const manifest: ManifestV1 = {
      schemaVersion: 1,
      publicationId: id,
      displayId,
      createdAt: '2026-11-10T02:00:00.000Z',
      canvas: { width: 640, height: 360 },
      contentRect: null,
      muted: true,
      assets: [
        {
          assetId: mediaId,
          mediaType: 'image/png',
          kind: 'image',
          bytes: 1234,
          sha256: SHA256,
          durationMs,
          fit: 'contain',
          width: 64,
          height: 36,
        },
      ],
    };
    await migrator.query(
      `INSERT INTO publication (id, org_id, display_id, playlist_id, manifest, idempotency_key, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        orgId,
        displayId,
        playlistId,
        JSON.stringify(manifest),
        `legacy-${randomUUID()}`,
        membershipId,
        manifest.createdAt,
      ],
    );
    await migrator.query(
      'INSERT INTO publication_asset (publication_id, position, org_id, media_id) VALUES ($1, 0, $2, $3)',
      [id, orgId, mediaId],
    );
    await migrator.query(
      `INSERT INTO display_delivery (display_id, org_id, desired_publication_id, desired_at)
       VALUES ($1, $2, $3, $4)`,
      [displayId, orgId, id, manifest.createdAt],
    );
    return id;
  };

  await migrator.query('BEGIN');
  try {
    // Forced row-level security binds the table owner too.
    await migrator.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    await migrator.query('INSERT INTO organization (id, name) VALUES ($1, $2)', [orgId, name]);
    await migrator.query(
      "INSERT INTO site (id, org_id, name, timezone) VALUES ($1, $2, $3, 'Australia/Melbourne')",
      [siteId, orgId, `${name} site`],
    );
    await migrator.query('INSERT INTO membership (id, org_id, oidc_sub) VALUES ($1, $2, $3)', [
      membershipId,
      orgId,
      oidcSub,
    ]);
    await migrator.query(
      `INSERT INTO media (id, org_id, kind, status, mime_type, bytes, sha256, width, height, storage_key, original_name)
       VALUES ($1, $2, 'image', 'ready', 'image/png', 1234, $3, 64, 36, $4, 'legacy poster.png')`,
      [mediaId, orgId, SHA256, `${orgId}/${randomUUID()}`],
    );
    await playlist(steady, 'steady loop', 5000);
    // Saved with 9 s after it was published with 5 s.
    await playlist(edited, 'edited loop', 9000);

    const current = await display('current');
    const editedDisplay = await display('edited');
    const never = await display('never');
    const publications = {
      current: await publish(current, steady, 5000),
      edited: await publish(editedDisplay, edited, 5000),
    };
    await migrator.query('COMMIT');
    return {
      orgId,
      siteId,
      membershipId,
      oidcSub,
      mediaId,
      steadyPlaylistId: steady,
      editedPlaylistId: edited,
      displays: { current, edited: editedDisplay, never },
      publications,
    };
  } catch (error) {
    await migrator.query('ROLLBACK');
    throw error;
  }
}

describe('an M0 database upgraded to portal v2, through the API', () => {
  let scratch: string | undefined;
  let t: TestApp | undefined;
  let app: TestApp;
  let a: LegacyOrg;
  let b: LegacyOrg;
  let alice: Operator;
  let bob: Operator;

  beforeAll(async () => {
    const names = (await readdir(MIGRATIONS)).filter((n) => n.endsWith('.sql')).sort();
    const m0 = names.filter((n) => n <= LAST_M0_MIGRATION);
    expect(m0).toHaveLength(4);
    expect(names.length).toBeGreaterThan(m0.length);
    scratch = await mkdtemp(join(tmpdir(), 'tinnox-upgrade-'));
    for (const name of m0) await copyFile(join(MIGRATIONS, name), join(scratch, name));

    await resetTestDatabase(migratorUrl());
    await runMigrations({ connectionString: migratorUrl(), directory: scratch });
    const migrator = new pg.Client({ connectionString: migratorUrl() });
    await migrator.connect();
    try {
      a = await createLegacyOrg(migrator, 'Legacy A');
      b = await createLegacyOrg(migrator, 'Legacy B');
    } finally {
      await migrator.end();
    }
    // The upgrade: every migration after M0, with the real runner.
    const upgrade = await runMigrations({ connectionString: migratorUrl(), directory: MIGRATIONS });
    expect(upgrade.applied).toEqual(names.filter((n) => n > LAST_M0_MIGRATION));

    t = await startTestApp();
    app = t;
    alice = await signIn(app, a);
    bob = await signIn(app, b);
  });

  afterAll(async () => {
    await t?.close();
    await runMigrations({ connectionString: migratorUrl(), directory: MIGRATIONS });
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  });

  it('shows each display with the playlist it was last given assigned', async () => {
    for (const [operator, org] of [
      [alice, a],
      [bob, b],
    ] as const) {
      const response = await operator.fetch('/api/displays');
      expect(response.status).toBe(200);
      const { items } = DisplayListResponseSchema.parse(await response.json());
      expect(items).toHaveLength(3);
      const assignedTo = (id: string): string | null | undefined =>
        items.find((item) => item.id === id)?.assignedPlaylist?.id ?? null;
      expect(assignedTo(org.displays.current)).toBe(org.steadyPlaylistId);
      expect(assignedTo(org.displays.edited)).toBe(org.editedPlaylistId);
      expect(assignedTo(org.displays.never)).toBeNull();
      // The new fields of the old rows are empty, not missing.
      for (const item of items) expect(item).toMatchObject({ description: null, tagIds: [] });
    }
  });

  it('gives the old media and playlists the new fields', async () => {
    const media = MediaListResponseSchema.parse(await (await alice.fetch('/api/media')).json());
    expect(media.items).toHaveLength(1);
    expect(media.items[0]).toMatchObject({
      id: a.mediaId,
      name: 'legacy poster.png',
      originalName: 'legacy poster.png',
      description: null,
      defaultDurationMs: null,
      folderId: null,
      tagIds: [],
      usageCount: 2,
    });
    const playlists = PlaylistListResponseSchema.parse(
      await (await alice.fetch('/api/playlists')).json(),
    );
    expect(
      playlists.items.map((p) => [p.id, p.assignedDisplayCount, p.totalDurationMs, p.description]),
    ).toEqual(
      expect.arrayContaining([
        [a.steadyPlaylistId, 1, 5000, null],
        [a.editedPlaylistId, 1, 9000, null],
      ]),
    );
    expect(playlists.items).toHaveLength(2);
    // The displays that hold the item are found through their M0 publications.
    const usage = MediaUsageResponseSchema.parse(
      await (await alice.fetch(`/api/media/${a.mediaId}/usage`)).json(),
    );
    expect(usage.displays.map((d) => d.id).sort()).toEqual(
      [a.displays.current, a.displays.edited].sort(),
    );
  });

  it('compares the M0 publications with the playlists as they are now', async () => {
    const plan = PushPlanResponseSchema.parse(await (await alice.fetch('/api/push')).json());
    const stateOf = (id: string): string | undefined =>
      plan.items.find((row) => row.display.id === id)?.state;
    // Published as it still is: nothing to do. Edited after publishing: a change is waiting.
    expect(stateOf(a.displays.current)).toBe('up_to_date');
    expect(stateOf(a.displays.edited)).toBe('changes');
    expect(stateOf(a.displays.never)).toBe('nothing_assigned');
    expect(plan.pendingCount).toBe(1);
    const row = plan.items.find((item) => item.display.id === a.displays.current);
    expect(row?.lastPushedAt).toBe('2026-11-10T02:00:00.000Z');
    const overview = OverviewResponseSchema.parse(
      await (await alice.fetch('/api/overview')).json(),
    );
    expect(overview).toMatchObject({
      displays: { total: 3, paired: 0 },
      media: { total: 1, ready: 1, usedBytes: 1234 },
      playlists: { total: 2 },
      pendingPushCount: 1,
    });
  });

  it('protects a backfilled assignment: the playlist cannot be deleted while a display has it', async () => {
    const response = await alice.fetch(`/api/playlists/${a.steadyPlaylistId}`, {
      method: 'DELETE',
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'playlist_in_use',
    );
  });

  it('pushes only the display whose content changed, and keeps the organisations apart', async () => {
    const ids = [a.displays.current, a.displays.edited, a.displays.never];
    const response = await alice.fetch('/api/push', {
      method: 'POST',
      json: { displayIds: ids },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(response.status).toBe(200);
    const { results } = PushResponseSchema.parse(await response.json());
    expect(results.map((r) => r.outcome)).toEqual(['unchanged', 'published', 'skipped']);
    // The display that was up to date keeps its M0 publication.
    expect(results[0]?.publicationId).toBe(a.publications.current);
    expect(results[1]?.publicationId).not.toBe(a.publications.edited);

    const after = PushPlanResponseSchema.parse(await (await alice.fetch('/api/push')).json());
    expect(after.pendingCount).toBe(0);

    // The other organisation was upgraded the same way and is untouched by this push.
    const theirs = PushPlanResponseSchema.parse(await (await bob.fetch('/api/push')).json());
    expect(theirs.items.map((row) => row.state).sort()).toEqual(
      ['changes', 'nothing_assigned', 'up_to_date'].sort(),
    );
    expect(theirs.pendingCount).toBe(1);
    const foreign = await bob.fetch('/api/push', {
      method: 'POST',
      json: { displayIds: [a.displays.never] },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(foreign.status).toBe(404);
  });
});
