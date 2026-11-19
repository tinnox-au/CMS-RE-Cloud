/**
 * Roles enforced by the API (CMS-13, docs/portal-v2/stage-c.md 6.2 to 6.6): the session
 * document, the activity filter of the audit log, the route guard and its audit rows, and the
 * role check inside every write when a role or a session is taken away while a request is on
 * its way. The route-by-role matrix is tests/integration/roles-matrix.test.ts.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { auditCategoryOf, ROLES, SessionResponseSchema, type Role } from '@tinnox/contracts';
import { sessionRevokeMembership, withOrg } from '@tinnox/db';
import { ACTIVITY_CATEGORIES, permissionsOf } from '@tinnox/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  asMigratorIn,
  assignPlaylist,
  auditEvents,
  createDisplay,
  createOrg,
  createPlaylist,
  desiredPublicationId,
  imageItem,
  isRoleCheck,
  listDir,
  pngBytes,
  push,
  readyImage,
  signIn,
  startTestApp,
  statementHolds,
  uploadBytes,
  type AuditEntry,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

const FORBIDDEN = "Your role doesn't allow this.";

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  return ((await response.json()) as { error: { code: string; message: string } }).error;
}

/** The security.permission_denied rows of the organisation, newest first (read by an Owner). */
async function denials(owner: Operator, actorId?: string): Promise<AuditEntry[]> {
  const rows = await auditEvents(owner, '&category=security');
  return rows.filter(
    (row) =>
      row.action === 'security.permission_denied' &&
      (actorId === undefined || row.actorId === actorId),
  );
}

describe('roles enforced by the API', () => {
  const holds = statementHolds();
  let t: TestApp;
  let org: TestOrg;
  let owner: Operator;

  beforeAll(async () => {
    t = await startTestApp({}, 1000, { wrapPool: holds.wrapPool });
    org = await createOrg('Roles');
    owner = await signIn(t, org);
  });
  afterAll(async () => {
    await t.close();
  });

  const member = async (role: Role, name: string | null = null): Promise<[TestOrg, Operator]> => {
    const m = await addMember(org, role, name);
    return [m, await signIn(t, m)];
  };

  describe('GET /api/session', () => {
    it('answers each role with its id, its keys and its name', async () => {
      for (const role of ROLES) {
        const [m, operator] = await member(role);
        const session = SessionResponseSchema.parse(
          await (await operator.fetch('/api/session')).json(),
        );
        expect(session.authenticated).toBe(true);
        if (!session.authenticated) continue;
        expect(session.user).toEqual({
          membershipId: m.membershipId,
          displayName: null,
          role,
          permissions: permissionsOf(role),
        });
        expect(session.organization.id).toBe(org.orgId);

        const name = `Roles ${role} ${randomUUID().slice(0, 8)}`;
        await asMigratorIn(org.orgId, (c) =>
          c.query('UPDATE membership SET display_name = $2 WHERE id = $1', [m.membershipId, name]),
        );
        const named = SessionResponseSchema.parse(
          await (await operator.fetch('/api/session')).json(),
        );
        expect(named.authenticated && named.user.displayName).toBe(name);
      }
    });

    it('reads the role live from the member row', async () => {
      const [m, operator] = await member('editor');
      await asMigratorIn(org.orgId, (c) =>
        c.query("UPDATE membership SET role = 'viewer' WHERE id = $1", [m.membershipId]),
      );
      const session = SessionResponseSchema.parse(
        await (await operator.fetch('/api/session')).json(),
      );
      expect(session.authenticated && session.user.role).toBe('viewer');
      expect(session.authenticated && session.user.permissions).toEqual([
        'org.read',
        'activity.read',
      ]);
    });
  });

  describe('GET /api/audit', () => {
    let editor: Operator;
    let viewer: Operator;

    beforeAll(async () => {
      [, editor] = await member('editor');
      [, viewer] = await member('viewer');
      // Activity: content and screen events.
      for (let i = 0; i < 4; i += 1) {
        const folder = await owner.fetch('/api/folders', {
          method: 'POST',
          json: { name: `Audit folder ${i} ${randomUUID().slice(0, 6)}` },
        });
        expect(folder.status).toBe(201);
        await createDisplay(owner, org, `Audit screen ${i}`);
      }
      await readyImage(t, owner);
      // Full log only: a sign-out (auth) and a refusal (security), between the activity.
      const leaving = await signIn(t, org);
      expect((await leaving.fetch('/api/auth/logout', { method: 'POST' })).status).toBe(200);
      expect(
        (await viewer.fetch('/api/folders', { method: 'POST', json: { name: 'Nope' } })).status,
      ).toBe(403);
    });

    const categories = (rows: readonly AuditEntry[]): Set<string> =>
      new Set(rows.map((row) => auditCategoryOf(row.action)));
    // Written out, not read from the domain's list, so a wrong list cannot test itself.
    const FULL_LOG_ONLY = ['auth', 'security', 'invite', 'membership'] as const;

    it('gives the Owner the full log', async () => {
      const seen = categories(await auditEvents(owner));
      expect(seen.has('auth')).toBe(true);
      expect(seen.has('security')).toBe(true);
      expect(seen.has('folder')).toBe(true);
    });

    it('gives Editors and Viewers the activity categories only', async () => {
      const activity: readonly string[] = ACTIVITY_CATEGORIES;
      for (const operator of [editor, viewer]) {
        const rows = await auditEvents(operator);
        expect(rows.length).toBeGreaterThan(5);
        const seen = categories(rows);
        for (const category of seen) expect(activity).toContain(category);
        for (const category of FULL_LOG_ONLY) expect(seen.has(category), category).toBe(false);
        expect(seen.has('folder')).toBe(true);
        expect(seen.has('display')).toBe(true);
      }
    });

    it('answers an empty page for a category outside the activity', async () => {
      for (const operator of [editor, viewer]) {
        for (const category of FULL_LOG_ONLY) {
          const response = await operator.fetch(`/api/audit?category=${category}`);
          expect(response.status, category).toBe(200);
          expect(await response.json()).toEqual({ items: [], nextBefore: null });
        }
        const media = await auditEvents(operator, '&category=media');
        expect(media.length).toBeGreaterThan(0);
        expect(categories(media)).toEqual(new Set(['media']));
      }
    });

    it('keeps the filter while paging with before', async () => {
      const everything = (await (await editor.fetch('/api/audit?limit=200')).json()) as {
        items: { id: string }[];
      };
      const paged: string[] = [];
      let before: string | null = null;
      for (let page = 0; page < 200; page += 1) {
        const response = await editor.fetch(
          `/api/audit?limit=2${before === null ? '' : `&before=${before}`}`,
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          items: { id: string; action: string }[];
          nextBefore: string | null;
        };
        for (const item of body.items) {
          expect(ACTIVITY_CATEGORIES as readonly string[]).toContain(auditCategoryOf(item.action));
          paged.push(item.id);
        }
        before = body.nextBefore;
        if (before === null) break;
      }
      expect(paged.length).toBeGreaterThan(5);
      expect(paged).toEqual(everything.items.map((row) => row.id));
    });
  });

  describe('the route guard', () => {
    it('refuses a Viewer’s write with 403 and records it once; a refused read writes nothing', async () => {
      const [m, viewer] = await member('viewer');
      const response = await viewer.fetch('/api/playlists', {
        method: 'POST',
        json: { name: 'Viewer playlist' },
      });
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ code: 'forbidden', message: FORBIDDEN });

      const read = await viewer.fetch('/api/members');
      expect(read.status).toBe(403);
      expect((await errorOf(read)).code).toBe('forbidden');

      const rows = await denials(owner, m.membershipId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        result: 'denied',
        objectType: 'route',
        objectId: 'POST /api/playlists',
        detail: {
          permission: ['content.write'],
          method: 'POST',
          route: '/api/playlists',
          reason: 'role',
          refusalsInWindow: 1,
          throttled: false,
        },
      });
      // Nothing was created.
      const lists = (await (await owner.fetch('/api/playlists')).json()) as {
        items: { name: string }[];
      };
      expect(lists.items.map((p) => p.name)).not.toContain('Viewer playlist');
    });

    it('answers HEAD like GET for a Viewer, and 401 without a session', async () => {
      const [, viewer] = await member('viewer');
      expect((await viewer.fetch('/api/displays', { method: 'HEAD' })).status).toBe(200);
      expect((await fetch(`${t.url}/api/displays`, { method: 'HEAD' })).status).toBe(401);
    });

    it('lets an Editor change and delete media tags and screen tags', async () => {
      const [, editor] = await member('editor');
      for (const scope of ['media', 'display'] as const) {
        const created = await editor.fetch('/api/tags', {
          method: 'POST',
          json: { scope, name: `Editor ${scope} ${randomUUID().slice(0, 6)}` },
        });
        expect(created.status, scope).toBe(201);
        const { id } = (await created.json()) as { id: string };
        const renamed = await editor.fetch(`/api/tags/${id}`, {
          method: 'PATCH',
          json: { name: `Renamed ${scope} ${randomUUID().slice(0, 6)}` },
        });
        expect(renamed.status, scope).toBe(200);
        const deleted = await editor.fetch(`/api/tags/${id}`, { method: 'DELETE' });
        expect(deleted.status, scope).toBe(204);
      }
    });
  });

  describe('a role or a session taken away during a write', () => {
    let playlistId: string;

    beforeAll(async () => {
      const image = await readyImage(t, owner);
      playlistId = await createPlaylist(owner, 'Roles loop', [imageItem(image.id)]);
    });

    /** Three screens with the playlist assigned and nothing pushed yet. */
    async function newScreens(): Promise<string[]> {
      const ids: string[] = [];
      for (const name of ['first', 'second', 'third']) {
        const { id } = await createDisplay(owner, org, `Roles ${name}`);
        await assignPlaylist(owner, id, playlistId);
        ids.push(id);
      }
      return ids;
    }

    /** Holds the push of `operator` at the role check of the second screen, runs `meanwhile`, releases. */
    async function pushWith(
      operator: Operator,
      screens: readonly string[],
      meanwhile: () => Promise<unknown>,
    ): Promise<Response> {
      let checks = 0;
      const held = holds.hold((text) => isRoleCheck(text) && ++checks === 2);
      const pushing = push(operator, screens);
      await held.reached;
      try {
        await meanwhile();
      } finally {
        held.release();
      }
      return pushing;
    }

    const published = async (screens: readonly string[]): Promise<(string | null)[]> =>
      Promise.all(screens.map((id) => desiredPublicationId(owner, id)));

    it('refuses the rest of a push with 403 when the role is lowered part-way', async () => {
      const screens = await newScreens();
      const [m, editor] = await member('editor');
      const response = await pushWith(editor, screens, () =>
        asMigratorIn(org.orgId, (c) =>
          c.query("UPDATE membership SET role = 'viewer' WHERE id = $1", [m.membershipId]),
        ),
      );
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error).toMatchObject({ code: 'forbidden', message: FORBIDDEN });
      expect(body).not.toHaveProperty('results');

      // The first screen keeps what was pushed to it; the others were not pushed.
      const after = await published(screens);
      expect(after[0]).not.toBeNull();
      expect(after.slice(1)).toEqual([null, null]);

      const rows = await denials(owner, m.membershipId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        objectType: 'route',
        objectId: 'POST /api/push',
        detail: { permission: ['push.publish'], reason: 'role_changed', method: 'POST' },
      });
    });

    it('answers 401 when the member is removed during a write', async () => {
      const [m, editor] = await member('editor');
      const name = `Removed meanwhile ${randomUUID().slice(0, 6)}`;
      const held = holds.hold(isRoleCheck);
      const creating = editor.fetch('/api/folders', { method: 'POST', json: { name } });
      await held.reached;
      try {
        await asMigratorIn(org.orgId, (c) =>
          c.query('UPDATE membership SET removed_at = now() WHERE id = $1', [m.membershipId]),
        );
      } finally {
        held.release();
      }
      const response = await creating;
      expect(response.status).toBe(401);
      expect((await errorOf(response)).code).toBe('unauthenticated');
      const folders = (await (await owner.fetch('/api/folders')).json()) as {
        items: { name: string }[];
      };
      expect(folders.items.map((f) => f.name)).not.toContain(name);
      // A 401 is not a role refusal: the removal is what the log records.
      expect(await denials(owner, m.membershipId)).toEqual([]);
    });

    it('answers 401 when the member is signed out everywhere during a push', async () => {
      const screens = await newScreens();
      const [m, editor] = await member('editor');
      const response = await pushWith(editor, screens, () =>
        withOrg(t.ctx.pool, org.orgId, (tx) => sessionRevokeMembership(tx, m.membershipId)),
      );
      expect(response.status).toBe(401);
      expect((await errorOf(response)).code).toBe('unauthenticated');
      const after = await published(screens);
      expect(after[0]).not.toBeNull();
      expect(after.slice(1)).toEqual([null, null]);
      // The session stays ended.
      expect((await editor.fetch('/api/displays')).status).toBe(401);
    });

    it('answers 401 and keeps nothing when the member is signed out everywhere during an upload', async () => {
      const [m, editor] = await member('editor');
      const count = async (): Promise<number> =>
        withOrg(t.ctx.pool, org.orgId, async (tx) => {
          const { rows } = await tx.query<{ n: string }>('SELECT count(*) AS n FROM media');
          return Number(rows[0]?.n ?? 0);
        });
      const media = await count();
      const inbox = join(t.jobsDir, 'inbox');
      const files = await listDir(inbox);
      const held = holds.hold(isRoleCheck);
      const uploading = uploadBytes(editor, await pngBytes());
      await held.reached;
      try {
        await withOrg(t.ctx.pool, org.orgId, (tx) => sessionRevokeMembership(tx, m.membershipId));
      } finally {
        held.release();
      }
      const response = await uploading;
      expect(response.status).toBe(401);
      expect(await count()).toBe(media);
      // The received file was discarded.
      expect((await listDir(inbox)).sort()).toEqual(files.sort());
    });

    it('answers 503 with retry-after when the member row stays locked past lock_timeout', async () => {
      const [m, editor] = await member('editor');
      const migrator = new pg.Client({
        connectionString: process.env['TEST_DATABASE_MIGRATOR_URL'],
      });
      await migrator.connect();
      try {
        await migrator.query('BEGIN');
        await migrator.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
        await migrator.query('UPDATE membership SET role = role WHERE id = $1', [m.membershipId]);
        const started = Date.now();
        const response = await editor.fetch('/api/folders', {
          method: 'POST',
          json: { name: `Locked out ${randomUUID().slice(0, 6)}` },
        });
        expect(Date.now() - started).toBeGreaterThanOrEqual(4_500);
        expect(response.status).toBe(503);
        expect(response.headers.get('retry-after')).toBe('2');
        expect((await errorOf(response)).code).toBe('service_unavailable');
      } finally {
        await migrator.query('ROLLBACK');
        await migrator.end();
      }
      // Once the lock is gone, the same write goes through.
      const retried = await editor.fetch('/api/folders', {
        method: 'POST',
        json: { name: `After the lock ${randomUUID().slice(0, 6)}` },
      });
      expect(retried.status).toBe(201);
    });
  });
});

describe('the permission-denied throttle', () => {
  let t: TestApp;
  let org: TestOrg;
  let owner: Operator;

  beforeAll(async () => {
    t = await startTestApp({}, 1);
    org = await createOrg('Roles throttle');
    owner = await signIn(t, org);
  });
  afterAll(async () => {
    await t.close();
  });

  it('writes the first refusal and the 20th of a window per member', async () => {
    const first = await addMember(org, 'viewer');
    const viewer = await signIn(t, first);
    for (let i = 0; i < 25; i += 1) {
      const response = await viewer.fetch('/api/folders', {
        method: 'POST',
        json: { name: `Throttled ${i}` },
      });
      expect(response.status).toBe(403);
    }
    const rows = (await denials(owner, first.membershipId)).reverse();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.detail).toMatchObject({ refusalsInWindow: 1, throttled: false });
    expect(rows[1]?.detail).toMatchObject({ refusalsInWindow: 20, throttled: true });

    const second = await addMember(org, 'viewer');
    const other = await signIn(t, second);
    expect(
      (await other.fetch('/api/folders', { method: 'POST', json: { name: 'x' } })).status,
    ).toBe(403);
    const own = await denials(owner, second.membershipId);
    expect(own).toHaveLength(1);
    expect(own[0]?.detail).toMatchObject({ refusalsInWindow: 1, throttled: false });
  });
});
