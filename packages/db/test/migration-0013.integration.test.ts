/**
 * Migration 0013, roles and members (CMS-13, docs/portal-v2/stage-c.md section 9.3).
 *
 * This file rebuilds the test database at migration 0012, leaves members as the code before
 * 0013 created them (no role named, so the default 'operator') with the session rows their
 * sign-ins wrote, then applies 0013 with the real
 * migration runner and checks the upgrade, then what the migration enforces: the four roles,
 * names, the last active Owner, final removals, the session cut-off, removed members in the
 * sec.* functions, and invite requests.
 *
 * It resets the shared integration-test database. Integration files run one at a time and each
 * arranges its own data, so the others are unaffected; `afterAll` always leaves the database at
 * the newest migration.
 *
 * Every migrator write to membership or member_invite runs with app.org_id set to the row's
 * organisation: row-level security binds the owner, and membership_guard refuses a change made
 * outside the row's organisation.
 */
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  lockOrgMembership,
  membershipByOidcSub,
  membershipForCheck,
  pairingClaim,
  pairingComplete,
  pairingCreate,
  poolAsTx,
  resetTestDatabase,
  runMigrations,
  sessionByIdHash,
  sessionCreate,
  sessionRevokeMembership,
  sha256,
  withOrg,
  withoutOrg,
  type MigrationResult,
  type Pool,
  type SessionCreateResult,
  type Tx,
} from '../src/index.ts';
import {
  appPool,
  asDefiner,
  asSuperuser,
  createOrg,
  hash,
  migratorClient,
  migratorUrl,
  pairingCode,
  PG,
  pgCode,
  pgViolation,
  stillWaiting,
  twoTransactions,
  type TestOrg,
} from './support.ts';

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'db',
  'migrations',
);
const TARGET = '0013_roles_and_members.sql';

type Role = 'owner' | 'admin' | 'editor' | 'viewer';

interface Legacy {
  readonly orgId: string;
  readonly memberIds: readonly string[];
}
interface Member {
  readonly id: string;
  readonly oidcSub: string;
}

let scratch: string | undefined;
let migrator: pg.Client | undefined;
let pool: Pool | undefined;
let db: Tx;
let upgrade: MigrationResult;
/** Two members, as the code before 0013 created them. */
let legacyA: Legacy;
/** One member, as the code before 0013 created it. */
let legacyB: Legacy;
/** The sign-ins of the legacy members before 0013. legacyA's second member never signed in. */
let legacySignIns: {
  /** legacyA's first member: a session that ended days ago, then one that is still live. */
  readonly a0First: Date;
  readonly a0Live: Buffer;
  /** legacyB's member: one live session. */
  readonly b0First: Date;
};

const HOUR_MS = 3_600_000;

function clients(): { migrator: pg.Client; pool: Pool } {
  if (migrator === undefined || pool === undefined) throw new Error('beforeAll did not finish');
  return { migrator, pool };
}

/** Runs `work` as the migrator in one transaction with `orgId` as the organisation context. */
async function asMigratorIn<T>(orgId: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const { migrator: client } = clients();
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** One statement as tinnox_app inside `withOrg`. */
const asApp = (orgId: string, text: string, values: readonly unknown[] = []) =>
  withOrg(clients().pool, orgId, (tx) => tx.query(text, values));

/** One statement as the owner of the sec.* functions (BYPASSRLS). */
const asDefinerRows = <R extends pg.QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
) => asDefiner<R>(clients().migrator, text, values);

/** An organisation and its members, inserted as the code before 0013 did: no role named. */
async function legacyOrg(name: string, members: number): Promise<Legacy> {
  const orgId = randomUUID();
  const memberIds = Array.from({ length: members }, () => randomUUID());
  await asMigratorIn(orgId, async (client) => {
    await client.query('INSERT INTO organization (id, name) VALUES ($1, $2)', [orgId, name]);
    for (const id of memberIds) {
      await client.query('INSERT INTO membership (id, org_id, oidc_sub) VALUES ($1, $2, $3)', [
        id,
        orgId,
        `legacy-${id}`,
      ]);
    }
  });
  return { orgId, memberIds };
}

/**
 * A session row as sec.session_create wrote it before 0013 (the definer is the only writer).
 * A live one was last seen now and lasts 8 hours; an ended one was revoked an hour after it began.
 */
async function legacySession(
  legacy: Legacy,
  memberId: string,
  createdAt: Date,
  state: 'live' | 'ended',
): Promise<Buffer> {
  const idHash = sha256(`legacy-cookie-${randomUUID()}`);
  await asDefinerRows(
    `INSERT INTO public.session (id_hash, membership_id, org_id, oidc_sub, csrf_token, created_at,
                                 last_seen_at, expires_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz,
             CASE WHEN $7::boolean THEN now() ELSE $6::timestamptz END,
             $6::timestamptz + interval '8 hours',
             CASE WHEN $7::boolean THEN NULL ELSE $6::timestamptz + interval '1 hour' END)`,
    [
      idHash,
      memberId,
      legacy.orgId,
      `legacy-${memberId}`,
      'c'.repeat(43),
      createdAt,
      state === 'live',
    ],
  );
  return idHash;
}

async function addMember(
  orgId: string,
  role: Role,
  displayName: string | null = null,
): Promise<Member> {
  const id = randomUUID();
  const oidcSub = `m13-${id}`;
  await asMigratorIn(orgId, (client) =>
    client.query(
      'INSERT INTO membership (id, org_id, oidc_sub, role, display_name) VALUES ($1, $2, $3, $4, $5)',
      [id, orgId, oidcSub, role, displayName],
    ),
  );
  return { id, oidcSub };
}

/** Removal as the people route does it (tinnox_app), by another member of the organisation. */
const REMOVE = 'UPDATE membership SET removed_at = now(), removed_by = $2 WHERE id = $1';
const SET_ROLE = 'UPDATE membership SET role = $2 WHERE id = $1';
const SET_NAME = 'UPDATE membership SET display_name = $2 WHERE id = $1';

async function signIn(
  oidcSub: string,
  authTime: Date | null = new Date(),
  idHash: Buffer = sha256(`cookie-${randomUUID()}`),
): Promise<SessionCreateResult & { idHash: Buffer }> {
  const result = await sessionCreate(db, {
    idHash,
    oidcSub,
    csrfToken: 'c'.repeat(43),
    ttlSeconds: 3600,
    idToken: null,
    authTime,
  });
  return { ...result, idHash };
}

/** One column of a member row, read as the definer (no organisation context needed). */
async function memberColumn(id: string, column: string): Promise<unknown> {
  const rows = await asDefinerRows<{ value: unknown }>(
    `SELECT ${column} AS value FROM public.membership WHERE id = $1`,
    [id],
  );
  return rows[0]?.value;
}

beforeAll(async () => {
  const names = (await readdir(MIGRATIONS)).filter((n) => n.endsWith('.sql')).sort();
  const before = names.filter((n) => n < TARGET);
  expect(names).toContain(TARGET);
  expect(before).toHaveLength(12);
  scratch = await mkdtemp(join(tmpdir(), 'tinnox-migration-0013-'));
  for (const name of before) await copyFile(join(MIGRATIONS, name), join(scratch, name));

  await resetTestDatabase(migratorUrl());
  await runMigrations({ connectionString: migratorUrl(), directory: scratch });

  migrator = await migratorClient();
  pool = appPool(4);
  db = poolAsTx(pool);
  legacyA = await legacyOrg('Legacy A', 2);
  legacyB = await legacyOrg('Legacy B', 1);
  const [a0] = legacyA.memberIds;
  const [b0] = legacyB.memberIds;
  if (a0 === undefined || b0 === undefined) throw new Error('legacy members missing');
  const now = Date.now();
  const a0First = new Date(now - 72 * HOUR_MS);
  const b0First = new Date(now - 2 * HOUR_MS);
  await legacySession(legacyA, a0, a0First, 'ended');
  const a0Live = await legacySession(legacyA, a0, new Date(now - HOUR_MS), 'live');
  await legacySession(legacyB, b0, b0First, 'live');
  legacySignIns = { a0First, a0Live, b0First };

  upgrade = await runMigrations({ connectionString: migratorUrl(), directory: MIGRATIONS });
});

afterAll(async () => {
  await pool?.end();
  await migrator?.end();
  // Whatever happened above, leave the shared test database at the newest migration.
  await runMigrations({ connectionString: migratorUrl(), directory: MIGRATIONS });
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
});

describe('migration 0013 on a database that already holds members', () => {
  it('is applied on top of 0012, once', async () => {
    const later = (await readdir(MIGRATIONS)).filter((n) => n.endsWith('.sql') && n > TARGET);
    expect(upgrade.alreadyApplied).toHaveLength(12);
    expect(upgrade.applied).toEqual([TARGET, ...later.sort()]);
    const again = await runMigrations({ connectionString: migratorUrl(), directory: MIGRATIONS });
    expect(again.applied).toEqual([]);
    expect(again.alreadyApplied).toContain(TARGET);
  });

  it('makes every existing member an Owner, in every organisation (D4 a)', async () => {
    const rows = await asDefinerRows<{ id: string; org_id: string; role: string }>(
      'SELECT id, org_id, role FROM public.membership WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[...legacyA.memberIds, ...legacyB.memberIds]],
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.role === 'owner')).toBe(true);
    expect(new Set(rows.map((r) => r.org_id))).toEqual(new Set([legacyA.orgId, legacyB.orgId]));
  });

  it('records a first sign-in for every member with a session row, from the earliest one', async () => {
    const [a0, a1] = legacyA.memberIds;
    const [b0] = legacyB.memberIds;
    const rows = await asDefinerRows<{ id: string; first_signed_in_at: Date | null }>(
      'SELECT id, first_signed_in_at FROM public.membership WHERE id = ANY($1::uuid[])',
      [[...legacyA.memberIds, ...legacyB.memberIds]],
    );
    expect(new Map(rows.map((r) => [r.id, r.first_signed_in_at]))).toEqual(
      new Map([
        [a0, legacySignIns.a0First],
        [a1, null],
        [b0, legacySignIns.b0First],
      ]),
    );
  });

  it('keeps a session from before the upgrade live, now as an Owner', async () => {
    expect(await sessionByIdHash(db, legacySignIns.a0Live, 1800)).toMatchObject({
      membershipId: legacyA.memberIds[0],
      orgId: legacyA.orgId,
      role: 'owner',
    });
  });

  it('forces row-level security on membership and session again: the owner without a context sees no rows', async () => {
    const { migrator: client } = clients();
    const { rows } = await client.query<{ name: string; enabled: boolean; forced: boolean }>(
      `SELECT relname AS name, relrowsecurity AS enabled, relforcerowsecurity AS forced
       FROM pg_class WHERE oid IN ('public.membership'::regclass, 'public.session'::regclass)
       ORDER BY 1`,
    );
    expect(rows).toEqual([
      { name: 'membership', enabled: true, forced: true },
      { name: 'session', enabled: true, forced: true },
    ]);
    const seen = await client.query<{ n: string }>('SELECT count(*) AS n FROM membership');
    expect(seen.rows[0]?.n).toBe('0');
    const sessions = await client.query<{ n: string }>('SELECT count(*) AS n FROM session');
    expect(sessions.rows[0]?.n).toBe('0');
  });
});

describe('roles', () => {
  it('replaces the operator CHECK with the four roles and drops the default', async () => {
    const { migrator: client } = clients();
    const constraints = await client.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'public.membership'::regclass AND conname LIKE 'membership_role%'
       ORDER BY 1`,
    );
    expect(constraints.rows.map((r) => r.conname)).toEqual(['membership_role_known']);
    expect(constraints.rows[0]?.def).toMatch(/owner.*admin.*editor.*viewer/);
    const column = await client.query<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'membership' AND column_name = 'role'`,
    );
    expect(column.rows).toEqual([{ column_default: null }]);
  });

  it('refuses a member without a role, and the old operator role', async () => {
    const insert = (role: string | undefined) =>
      asMigratorIn(legacyA.orgId, (client) =>
        role === undefined
          ? client.query('INSERT INTO membership (org_id, oidc_sub) VALUES ($1, $2)', [
              legacyA.orgId,
              `no-role-${randomUUID()}`,
            ])
          : client.query('INSERT INTO membership (org_id, oidc_sub, role) VALUES ($1, $2, $3)', [
              legacyA.orgId,
              `role-${randomUUID()}`,
              role,
            ]),
      );
    expect(await pgCode(insert(undefined))).toBe(PG.notNull);
    expect(await pgViolation(insert('operator'))).toEqual({
      code: PG.check,
      constraint: 'membership_role_known',
    });
    for (const role of ['owner', 'admin', 'editor', 'viewer']) {
      expect(await pgCode(insert(role)), role).toBe('no error');
    }
  });
});

describe('grants', () => {
  const tablePrivileges = async (table: string, grantee: string) => {
    const { rows } = await clients().migrator.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.table_privileges
       WHERE table_schema = 'public' AND table_name = $1 AND grantee = $2
       ORDER BY 1`,
      [table, grantee],
    );
    return rows.map((r) => r.privilege_type);
  };
  const columns = async (table: string, grantee: string, privilege: string) => {
    const { rows } = await clients().migrator.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE table_schema = 'public' AND table_name = $1 AND grantee = $2 AND privilege_type = $3
       ORDER BY 1`,
      [table, grantee, privilege],
    );
    return rows.map((r) => r.column_name);
  };

  it('give tinnox_app an update of four membership columns and no insert', async () => {
    expect(await tablePrivileges('membership', 'tinnox_app')).toEqual(['SELECT']);
    expect(await columns('membership', 'tinnox_app', 'UPDATE')).toEqual([
      'display_name',
      'removed_at',
      'removed_by',
      'role',
    ]);
    expect(await columns('membership', 'tinnox_app', 'INSERT')).toEqual([]);
  });

  it('give tinnox_definer an update of the two columns its functions write', async () => {
    expect(await tablePrivileges('membership', 'tinnox_definer')).toEqual(['SELECT']);
    expect(await columns('membership', 'tinnox_definer', 'UPDATE')).toEqual([
      'first_signed_in_at',
      'sessions_valid_after',
    ]);
  });

  it('give tinnox_app select, insert and a status update on member_invite, and no delete', async () => {
    expect(await tablePrivileges('member_invite', 'tinnox_app')).toEqual(['INSERT', 'SELECT']);
    expect(await columns('member_invite', 'tinnox_app', 'UPDATE')).toEqual(['closed_by', 'status']);
  });

  it("give tinnox_definer the scripts' read of nine invite columns and a status update", async () => {
    expect(await tablePrivileges('member_invite', 'tinnox_definer')).toEqual([]);
    expect(await columns('member_invite', 'tinnox_definer', 'SELECT')).toEqual([
      'created_at',
      'email',
      'expires_at',
      'id',
      'invited_by',
      'name',
      'org_id',
      'role',
      'status',
    ]);
    expect(await columns('member_invite', 'tinnox_definer', 'UPDATE')).toEqual(['status']);
  });

  it('leave audit_event append-only for tinnox_app', async () => {
    expect(await tablePrivileges('audit_event', 'tinnox_app')).toEqual(['INSERT', 'SELECT']);
  });
});

describe('the in-write role check', () => {
  it('lets tinnox_app share-lock its own member row, waiting for a change that holds it', async () => {
    const org = await createOrg(clients().migrator, 'For share');
    const FOR_SHARE =
      'SELECT role FROM membership WHERE id = $1 AND org_id = app_org_id() FOR SHARE';
    expect((await asApp(org.orgId, FOR_SHARE, [org.membershipId])).rows).toEqual([
      { role: 'owner' },
    ]);

    const { migrator: client } = clients();
    await client.query('BEGIN');
    try {
      await client.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
      await client.query("UPDATE membership SET display_name = 'Held' WHERE id = $1", [
        org.membershipId,
      ]);
      const check = asApp(org.orgId, FOR_SHARE, [org.membershipId]);
      expect(await stillWaiting(check)).toBe(true);
      await client.query('COMMIT');
      expect((await check).rows).toEqual([{ role: 'owner' }]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
});

describe('display names', () => {
  let org: TestOrg;
  beforeAll(async () => {
    org = await createOrg(clients().migrator, 'Display names');
  });

  it('are 1 to 120 characters, trimmed', async () => {
    const named = (name: string) =>
      pgViolation(asApp(org.orgId, SET_NAME, [org.membershipId, name]));
    expect(await named('')).toEqual({
      code: PG.check,
      constraint: 'membership_display_name_length',
    });
    expect(await named('x'.repeat(121))).toEqual({
      code: PG.check,
      constraint: 'membership_display_name_length',
    });
    expect(await named(' x')).toEqual({
      code: PG.check,
      constraint: 'membership_display_name_trimmed',
    });
    expect(await named('x'.repeat(120))).toBeNull();
  });

  it('are unique per organisation ignoring case, removed members included; NULLs never collide', async () => {
    await asApp(org.orgId, SET_NAME, [org.membershipId, 'Dana Owner']);
    const editor = await addMember(org.orgId, 'editor');
    const taken = { code: PG.unique, constraint: 'membership_org_display_name_key' };
    expect(await pgViolation(asApp(org.orgId, SET_NAME, [editor.id, 'DANA OWNER']))).toEqual(taken);

    const gone = await addMember(org.orgId, 'viewer', 'Gone Person');
    await asApp(org.orgId, REMOVE, [gone.id, org.membershipId]);
    expect(await pgViolation(asApp(org.orgId, SET_NAME, [editor.id, 'gone person']))).toEqual(
      taken,
    );

    const other = await createOrg(clients().migrator, 'Display names, other');
    expect(
      await pgViolation(asApp(other.orgId, SET_NAME, [other.membershipId, 'Dana Owner'])),
    ).toBe(null);

    await addMember(org.orgId, 'viewer');
    const unnamed = await asApp(
      org.orgId,
      'SELECT count(*) AS n FROM membership WHERE display_name IS NULL',
    );
    expect(unnamed.rows).toEqual([{ n: '2' }]);
  });

  it('records when a set name changes, not when a member is named for the first time', async () => {
    const member = await addMember(org.orgId, 'viewer');
    const stamp = async () =>
      (
        await asApp(
          org.orgId,
          'SELECT display_name_changed_at AS at FROM membership WHERE id = $1',
          [member.id],
        )
      ).rows[0] as { at: Date | null };
    await asApp(org.orgId, SET_NAME, [member.id, 'First Name']);
    expect((await stamp()).at).toBeNull();
    await asApp(org.orgId, SET_NAME, [member.id, 'Second Name']);
    expect((await stamp()).at).toBeInstanceOf(Date);
    expect(
      await pgCode(
        asApp(org.orgId, 'UPDATE membership SET display_name_changed_at = now() WHERE id = $1', [
          member.id,
        ]),
      ),
    ).toBe(PG.insufficientPrivilege);
  });
});

describe('the last active Owner', () => {
  const lastOwner = { code: PG.restrict, constraint: 'membership_last_owner' };

  it('cannot be demoted or removed, one change or several, concurrent or not', async () => {
    const org = await createOrg(clients().migrator, 'Last owner');
    const first = org.membershipId;
    const editor = await addMember(org.orgId, 'editor');

    expect(await pgViolation(asApp(org.orgId, SET_ROLE, [first, 'admin']))).toEqual(lastOwner);
    expect(await pgViolation(asApp(org.orgId, REMOVE, [first, editor.id]))).toEqual(lastOwner);

    const second = (await addMember(org.orgId, 'owner')).id;
    expect(await pgViolation(asApp(org.orgId, SET_ROLE, [first, 'admin']))).toBeNull();
    expect(await pgViolation(asApp(org.orgId, SET_ROLE, [second, 'admin']))).toEqual(lastOwner);
    await asApp(org.orgId, SET_ROLE, [first, 'owner']);

    // One statement over both Owners: the second row sees the first one's change.
    expect(
      await pgViolation(
        asApp(org.orgId, "UPDATE membership SET role = 'admin' WHERE role = 'owner'"),
      ),
    ).toEqual(lastOwner);

    // Two demotions at once: the second waits for the first, then counts its commit.
    await twoTransactions(clients().pool, org.orgId, async (one, two) => {
      await one.query(SET_ROLE, [first, 'admin']);
      const late = pgViolation(two.query(SET_ROLE, [second, 'admin']));
      expect(await stillWaiting(late)).toBe(true);
      await one.query('COMMIT');
      expect(await late).toEqual(lastOwner);
    });
    expect(await memberColumn(first, 'role')).toBe('admin');
    expect(await memberColumn(second, 'role')).toBe('owner');

    // The table owner too, inside the organisation.
    expect(
      await pgViolation(
        asMigratorIn(org.orgId, (client) =>
          client.query('DELETE FROM membership WHERE id = $1', [second]),
        ),
      ),
    ).toEqual(lastOwner);
  });

  it('fails closed outside the row organisation, and outside READ COMMITTED', async () => {
    const org = await createOrg(clients().migrator, 'Guard context');
    const editor = await addMember(org.orgId, 'editor');
    const second = await addMember(org.orgId, 'owner');

    // A superuser bypasses row-level security, but not the guard: any guarded change needs
    // the row's organisation as the context.
    expect(
      await asSuperuser((client) =>
        pgCode(
          client.query("UPDATE public.membership SET role = 'viewer' WHERE id = $1", [editor.id]),
        ),
      ),
    ).toBe(PG.insufficientPrivilege);
    expect(await memberColumn(editor.id, 'role')).toBe('editor');

    const client = await clients().pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
      expect(await pgCode(client.query(SET_ROLE, [second.id, 'admin']))).toBe('25000');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});

describe('a removal', () => {
  let org: TestOrg;
  let other: TestOrg;
  beforeAll(async () => {
    org = await createOrg(clients().migrator, 'Removal');
    other = await createOrg(clients().migrator, 'Removal, other');
  });

  it('is final for tinnox_app; only the migrator reactivates', async () => {
    const editor = await addMember(org.orgId, 'editor');
    await asApp(org.orgId, REMOVE, [editor.id, org.membershipId]);
    const final = { code: PG.restrict, constraint: 'membership_removed_final' };
    for (const [sql, values] of [
      ['UPDATE membership SET removed_at = NULL WHERE id = $1', [editor.id]],
      ['UPDATE membership SET removed_by = NULL WHERE id = $1', [editor.id]],
      [SET_ROLE, [editor.id, 'viewer']],
    ] as const) {
      expect(await pgViolation(asApp(org.orgId, sql, values)), sql).toEqual(final);
    }

    await asMigratorIn(org.orgId, (client) =>
      client.query(
        "UPDATE membership SET removed_at = NULL, removed_by = NULL, role = 'viewer' WHERE id = $1",
        [editor.id],
      ),
    );
    expect(await memberColumn(editor.id, 'role')).toBe('viewer');
    expect(await memberColumn(editor.id, 'removed_at')).toBeNull();
  });

  it('names its remover consistently: never alone, never the member, never another organisation', async () => {
    const viewer = await addMember(org.orgId, 'viewer');
    expect(
      await pgViolation(
        asApp(org.orgId, 'UPDATE membership SET removed_by = $2 WHERE id = $1', [
          viewer.id,
          org.membershipId,
        ]),
      ),
    ).toEqual({ code: PG.check, constraint: 'membership_removed_pair' });
    expect(await pgViolation(asApp(org.orgId, REMOVE, [viewer.id, viewer.id]))).toEqual({
      code: PG.check,
      constraint: 'membership_not_removed_by_self',
    });
    expect(await pgViolation(asApp(org.orgId, REMOVE, [viewer.id, other.membershipId]))).toEqual({
      code: PG.foreignKey,
      constraint: 'membership_removed_by_fk',
    });
    expect(await memberColumn(viewer.id, 'removed_at')).toBeNull();
  });
});

describe('sessions and the cut-off', () => {
  let org: TestOrg;
  let other: TestOrg;
  beforeAll(async () => {
    org = await createOrg(clients().migrator, 'Sessions');
    other = await createOrg(clients().migrator, 'Sessions, other');
  });

  it('sec.session_create records the first sign-in once and refuses unknown and removed members', async () => {
    const member = await addMember(org.orgId, 'editor');
    expect(await signIn(member.oidcSub)).toMatchObject({
      outcome: 'created',
      membershipId: member.id,
      orgId: org.orgId,
      role: 'editor',
    });
    const firstAt = await memberColumn(member.id, 'first_signed_in_at');
    expect(firstAt).toBeInstanceOf(Date);
    expect((await signIn(member.oidcSub)).outcome).toBe('created');
    expect(await memberColumn(member.id, 'first_signed_in_at')).toEqual(firstAt);

    expect((await signIn(`unknown-${randomUUID()}`)).outcome).toBe('no_membership');

    const removed = await addMember(org.orgId, 'viewer');
    await asApp(org.orgId, REMOVE, [removed.id, org.membershipId]);
    const refused = await signIn(removed.oidcSub);
    expect(refused).toEqual({ outcome: 'no_membership', idHash: refused.idHash });
    expect(await sessionByIdHash(db, refused.idHash, 1800)).toBeNull();
  });

  it('sec.session_create asks for a new sign-in unless it was authenticated a whole second after the cut-off', async () => {
    const member = await addMember(org.orgId, 'viewer');
    const [cut] = await asDefinerRows<{ at: Date }>(
      `UPDATE public.membership SET sessions_valid_after = now() - interval '1 hour'
       WHERE id = $1 RETURNING sessions_valid_after AS at`,
      [member.id],
    );
    if (cut === undefined) throw new Error('no cut-off set');
    const second = new Date(Math.floor(cut.at.getTime() / 1000) * 1000);
    const reauth = { outcome: 'reauth', membershipId: member.id, orgId: org.orgId };

    const missing = await signIn(member.oidcSub, null);
    expect(missing).toEqual({ ...reauth, idHash: missing.idHash });
    const sameSecond = await signIn(member.oidcSub, second);
    expect(sameSecond).toEqual({ ...reauth, idHash: sameSecond.idHash });
    expect(await sessionByIdHash(db, sameSecond.idHash, 1800)).toBeNull();
    const next = await signIn(member.oidcSub, new Date(second.getTime() + 1000));
    expect(next.outcome).toBe('created');
    expect(await sessionByIdHash(db, next.idHash, 1800)).not.toBeNull();
  });

  it('sec.session_by_id_hash refuses sessions from before the cut-off and of removed members', async () => {
    const member = await addMember(org.orgId, 'editor');
    const before = await signIn(member.oidcSub);
    expect(await sessionByIdHash(db, before.idHash, 1800)).toMatchObject({ role: 'editor' });
    await asDefinerRows('UPDATE public.membership SET sessions_valid_after = now() WHERE id = $1', [
      member.id,
    ]);
    expect(await sessionByIdHash(db, before.idHash, 1800)).toBeNull();
    const after = await signIn(member.oidcSub, new Date(Date.now() + 60_000));
    expect(after.outcome).toBe('created');
    expect(await sessionByIdHash(db, after.idHash, 1800)).toMatchObject({
      membershipId: member.id,
      orgId: org.orgId,
    });

    const leaver = await addMember(org.orgId, 'viewer');
    const live = await signIn(leaver.oidcSub);
    expect(await sessionByIdHash(db, live.idHash, 1800)).not.toBeNull();
    expect(await membershipByOidcSub(db, leaver.oidcSub)).toMatchObject({
      membershipId: leaver.id,
    });
    await asApp(org.orgId, REMOVE, [leaver.id, org.membershipId]);
    expect(await sessionByIdHash(db, live.idHash, 1800)).toBeNull();
    expect(await membershipByOidcSub(db, leaver.oidcSub)).toBeNull();
  });

  it('a sign-in waits for a revocation that is committing, then asks for a new sign-in', async () => {
    const member = await addMember(org.orgId, 'editor');
    const revoker = await clients().pool.connect();
    try {
      await revoker.query('BEGIN');
      await revoker.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
      await revoker.query('SELECT sec.session_revoke_membership($1)', [member.id]);
      const signing = signIn(member.oidcSub, new Date(Date.now() - 60_000));
      expect(await stillWaiting(signing)).toBe(true);
      await revoker.query('COMMIT');
      const result = await signing;
      expect(result).toEqual({
        outcome: 'reauth',
        membershipId: member.id,
        orgId: org.orgId,
        idHash: result.idHash,
      });
    } finally {
      await revoker.query('ROLLBACK').catch(() => undefined);
      revoker.release();
    }
  });

  it('the cut-off is the call, not the start of a revoking transaction that waited for locks', async () => {
    const member = await addMember(org.orgId, 'editor');
    const revoker = await clients().pool.connect();
    let began: Date;
    try {
      await revoker.query('BEGIN');
      await revoker.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
      const { rows } = await revoker.query<{ at: Date }>('SELECT now() AS at');
      if (rows[0] === undefined) throw new Error('no transaction start');
      began = rows[0].at;
      // As the people routes wait for the membership lock and the member row first.
      await revoker.query('SELECT pg_sleep(1.2)');
      await revoker.query('SELECT sec.session_revoke_membership($1)', [member.id]);
      await revoker.query('COMMIT');
    } finally {
      await revoker.query('ROLLBACK').catch(() => undefined);
      revoker.release();
    }
    const cutOff = (await memberColumn(member.id, 'sessions_valid_after')) as Date;
    expect(cutOff.getTime()).toBeGreaterThanOrEqual(began.getTime() + 1200);
    // Authenticated at the identity provider during the wait, a whole second after the
    // transaction began: a cut-off at the transaction's start would let it in.
    const duringWait = new Date(Math.floor(began.getTime() / 1000) * 1000 + 1000);
    const late = await signIn(member.oidcSub, duringWait);
    expect(late).toEqual({
      outcome: 'reauth',
      membershipId: member.id,
      orgId: org.orgId,
      idHash: late.idHash,
    });
  });

  it('never moves the cut-off back', async () => {
    const member = await addMember(org.orgId, 'editor');
    const [ahead] = await asDefinerRows<{ at: Date }>(
      `UPDATE public.membership SET sessions_valid_after = now() + interval '1 hour'
       WHERE id = $1 RETURNING sessions_valid_after AS at`,
      [member.id],
    );
    await withOrg(clients().pool, org.orgId, (tx) => sessionRevokeMembership(tx, member.id));
    expect(await memberColumn(member.id, 'sessions_valid_after')).toEqual(ahead?.at);
  });

  it('a revocation ends a sign-in that committed first', async () => {
    const member = await addMember(org.orgId, 'editor');
    const session = await signIn(member.oidcSub);
    expect(session.outcome).toBe('created');
    expect(
      await withOrg(clients().pool, org.orgId, (tx) => sessionRevokeMembership(tx, member.id)),
    ).toBe(1);
    expect(await sessionByIdHash(db, session.idHash, 1800)).toBeNull();
  });

  it('sec.session_revoke_membership ends one member of the current organisation only', async () => {
    const member = await addMember(org.orgId, 'editor');
    const colleague = await addMember(org.orgId, 'editor');
    const mine = [await signIn(member.oidcSub), await signIn(member.oidcSub)];
    const theirs = await signIn(colleague.oidcSub);
    // Past its expiry but not yet purged: no longer live, so it is not counted as ended.
    const expired = await signIn(member.oidcSub);
    await asDefinerRows(
      "UPDATE public.session SET expires_at = now() - interval '1 minute' WHERE id_hash = $1",
      [expired.idHash],
    );

    expect(
      await withOrg(clients().pool, org.orgId, (tx) => sessionRevokeMembership(tx, member.id)),
    ).toBe(2);
    for (const s of mine) expect(await sessionByIdHash(db, s.idHash, 1800)).toBeNull();
    expect(await memberColumn(member.id, 'sessions_valid_after')).toBeInstanceOf(Date);
    expect(await sessionByIdHash(db, theirs.idHash, 1800)).not.toBeNull();
    expect(await memberColumn(colleague.id, 'sessions_valid_after')).toBeNull();

    expect(
      await pgCode(
        withOrg(clients().pool, other.orgId, (tx) => sessionRevokeMembership(tx, colleague.id)),
      ),
    ).toBe(PG.insufficientPrivilege);
    expect(
      await pgCode(withoutOrg(clients().pool, (tx) => sessionRevokeMembership(tx, colleague.id))),
    ).toBe(PG.insufficientPrivilege);
    expect(await sessionByIdHash(db, theirs.idHash, 1800)).not.toBeNull();
    expect(await memberColumn(colleague.id, 'sessions_valid_after')).toBeNull();
  });
});

describe('pairing by a removed member', () => {
  let org: TestOrg;
  beforeAll(async () => {
    org = await createOrg(clients().migrator, 'Pairing');
  });

  async function newPairing() {
    const pollingTokenHash = hash();
    const code = pairingCode();
    const created = await pairingCreate(db, {
      code,
      pollingTokenHash,
      clientKey: `client-${code}`,
      ttlSeconds: 600,
      maxSessionsPerClient: 10,
      windowSeconds: 600,
    });
    if (created.outcome !== 'created') throw new Error(`pairing not created: ${created.outcome}`);
    return { code, pollingTokenHash, pairingId: created.pairingId };
  }
  const claim = (code: string, membershipId: string) =>
    withOrg(clients().pool, org.orgId, (tx) =>
      pairingClaim(tx, {
        code,
        displayId: org.displayId,
        membershipId,
        maxFailures: 5,
        windowSeconds: 600,
      }),
    );

  it('cannot claim a code', async () => {
    const member = await addMember(org.orgId, 'editor');
    await asApp(org.orgId, REMOVE, [member.id, org.membershipId]);
    const p = await newPairing();
    expect(await pgCode(claim(p.code, member.id))).toBe(PG.insufficientPrivilege);
  });

  it('leaves a claim that no player can collect any more', async () => {
    const member = await addMember(org.orgId, 'editor');
    const p = await newPairing();
    expect((await claim(p.code, member.id)).outcome).toBe('claimed');
    await asApp(org.orgId, REMOVE, [member.id, org.membershipId]);
    expect(
      await pairingComplete(db, {
        pairingId: p.pairingId,
        pollingTokenHash: p.pollingTokenHash,
        deviceTokenHash: hash(),
      }),
    ).toEqual({ outcome: 'not_claimable' });
    expect(
      await asDefinerRows('SELECT status FROM public.pairing_session WHERE id = $1', [p.pairingId]),
    ).toEqual([{ status: 'expired' }]);
  });
});

describe('member_invite', () => {
  let org: TestOrg;
  let other: TestOrg;
  beforeAll(async () => {
    org = await createOrg(clients().migrator, 'Invites');
    other = await createOrg(clients().migrator, 'Invites, other');
  });

  interface Invite {
    id: string;
    role: string;
    name: string | null;
    email: string | null;
    invitedBy: string;
    expiresIn: string;
    status: string;
  }
  const INSERT_INVITE = `INSERT INTO member_invite (id, org_id, role, name, email, invited_by, expires_at, status)
     VALUES ($1, app_org_id(), $2, $3, $4, $5, now() + $6::interval, $7)`;
  function invite(from: TestOrg, overrides: Partial<Invite> = {}): Invite {
    const id = randomUUID();
    const tag = id.slice(0, 8);
    return {
      id,
      role: 'editor',
      name: `Invitee ${tag}`,
      email: `invitee-${tag}@example.com`,
      invitedBy: from.membershipId,
      expiresIn: '14 days',
      status: 'pending',
      ...overrides,
    };
  }
  const values = (i: Invite) => [i.id, i.role, i.name, i.email, i.invitedBy, i.expiresIn, i.status];
  const insertAsMigrator = (orgId: string, i: Invite) =>
    asMigratorIn(orgId, (client) => client.query(INSERT_INVITE, values(i)));
  const insertAsApp = (orgId: string, i: Invite) => asApp(orgId, INSERT_INVITE, values(i));
  const updateAsMigrator = (orgId: string, sql: string, params: readonly unknown[]) =>
    asMigratorIn(orgId, (client) => client.query(sql, [...params]));
  const guard = { code: PG.restrict, constraint: 'member_invite_guard' };

  it('checks role, status, name and e-mail address', async () => {
    expect(await pgViolation(insertAsMigrator(org.orgId, invite(org, { role: 'owner' })))).toEqual({
      code: PG.check,
      constraint: 'member_invite_role_known',
    });
    expect(await pgViolation(insertAsMigrator(org.orgId, invite(org, { email: null })))).toEqual({
      code: PG.check,
      constraint: 'member_invite_open',
    });
    expect(
      await pgViolation(insertAsMigrator(org.orgId, invite(org, { email: 'nobody.example.com' }))),
    ).toEqual({ code: PG.check, constraint: 'member_invite_email_shape' });
    // On an insert the guard answers first.
    expect(
      await pgViolation(insertAsMigrator(org.orgId, invite(org, { status: 'bogus' }))),
    ).toEqual(guard);
    const pending = invite(org);
    await insertAsMigrator(org.orgId, pending);
    expect(
      await pgViolation(
        updateAsMigrator(org.orgId, "UPDATE member_invite SET status = 'bogus' WHERE id = $1", [
          pending.id,
        ]),
      ),
    ).toEqual({ code: PG.check, constraint: 'member_invite_status_known' });
  });

  it('starts pending and expires within 14 days', async () => {
    for (const overrides of [
      { expiresIn: '-1 minute' },
      { expiresIn: '15 days' },
      { status: 'cancelled', name: null, email: null },
      { status: 'fulfilled', name: null, email: null },
    ]) {
      expect(
        await pgViolation(insertAsMigrator(org.orgId, invite(org, overrides))),
        JSON.stringify(overrides),
      ).toEqual(guard);
    }
  });

  it('is cancelled by tinnox_app, which deletes the name and e-mail address', async () => {
    const pending = invite(org);
    await insertAsApp(org.orgId, pending);
    const { rows } = await asApp(
      org.orgId,
      `UPDATE member_invite SET status = 'cancelled', closed_by = $2 WHERE id = $1
       RETURNING status, name, email, closed_at, closed_by, created_at`,
      [pending.id, org.membershipId],
    );
    expect(rows[0]).toMatchObject({
      status: 'cancelled',
      name: null,
      email: null,
      closed_by: org.membershipId,
    });
    expect((rows[0] as { closed_at: unknown }).closed_at).toBeInstanceOf(Date);
  });

  it('is fulfilled or expired only by TINNOX, and the request never changes', async () => {
    const pending = invite(org);
    await insertAsApp(org.orgId, pending);
    for (const status of ['fulfilled', 'expired']) {
      expect(
        await pgViolation(
          asApp(org.orgId, 'UPDATE member_invite SET status = $2 WHERE id = $1', [
            pending.id,
            status,
          ]),
        ),
        status,
      ).toEqual(guard);
    }
    for (const sql of [
      "UPDATE member_invite SET role = 'viewer' WHERE id = $1",
      "UPDATE member_invite SET name = 'Someone Else' WHERE id = $1",
    ]) {
      expect(await pgViolation(updateAsMigrator(org.orgId, sql, [pending.id])), sql).toEqual(guard);
      expect(await pgCode(asApp(org.orgId, sql, [pending.id])), sql).toBe(PG.insufficientPrivilege);
    }

    // TINNOX fulfils: only with the member it created.
    expect(
      await pgViolation(
        updateAsMigrator(org.orgId, "UPDATE member_invite SET status = 'fulfilled' WHERE id = $1", [
          pending.id,
        ]),
      ),
    ).toEqual({ code: PG.check, constraint: 'member_invite_fulfilled' });
    const joined = await addMember(org.orgId, 'editor');
    const fulfilled = await updateAsMigrator(
      org.orgId,
      `UPDATE member_invite SET status = 'fulfilled', fulfilled_membership_id = $2 WHERE id = $1
       RETURNING status, name, email, closed_at`,
      [pending.id, joined.id],
    );
    expect(fulfilled.rows[0]).toMatchObject({ status: 'fulfilled', name: null, email: null });

    // A closed invite never changes again.
    expect(
      await pgViolation(
        updateAsMigrator(org.orgId, "UPDATE member_invite SET status = 'pending' WHERE id = $1", [
          pending.id,
        ]),
      ),
    ).toEqual(guard);
    expect(
      await pgViolation(
        asApp(org.orgId, 'UPDATE member_invite SET closed_by = $2 WHERE id = $1', [
          pending.id,
          org.membershipId,
        ]),
      ),
    ).toEqual(guard);
  });

  it('is expired across organisations by the migrator as the definer, in one statement', async () => {
    const mine = invite(org);
    const theirs = invite(other);
    await insertAsMigrator(org.orgId, mine);
    await insertAsMigrator(other.orgId, theirs);
    const rows = await asDefinerRows<{ org_id: string; status: string; name: null; email: null }>(
      `UPDATE public.member_invite SET status = 'expired' WHERE id = ANY($1::uuid[])
       RETURNING org_id, status, name, email`,
      [[mine.id, theirs.id]],
    );
    expect(rows.sort((x, y) => x.org_id.localeCompare(y.org_id))).toEqual(
      [org.orgId, other.orgId]
        .sort()
        .map((orgId) => ({ org_id: orgId, status: 'expired', name: null, email: null })),
    );
  });

  it('allows one pending invite per address and per name, ignoring case', async () => {
    const first = invite(org);
    await insertAsMigrator(org.orgId, first);
    const sameEmail = invite(org, { email: first.email?.toUpperCase() ?? null });
    const sameName = invite(org, { name: first.name?.toUpperCase() ?? null });
    expect(await pgViolation(insertAsApp(org.orgId, sameEmail))).toEqual({
      code: PG.unique,
      constraint: 'member_invite_pending_email_key',
    });
    expect(await pgViolation(insertAsApp(org.orgId, sameName))).toEqual({
      code: PG.unique,
      constraint: 'member_invite_pending_name_key',
    });
    await asApp(org.orgId, "UPDATE member_invite SET status = 'cancelled' WHERE id = $1", [
      first.id,
    ]);
    expect(await pgViolation(insertAsApp(org.orgId, sameEmail))).toBeNull();
    expect(await pgViolation(insertAsApp(org.orgId, sameName))).toBeNull();
  });

  it('refuses an inviter from another organisation', async () => {
    expect(
      await pgViolation(
        insertAsMigrator(org.orgId, invite(org, { invitedBy: other.membershipId })),
      ),
    ).toEqual({ code: PG.foreignKey, constraint: 'member_invite_invited_by_fk' });
  });
});

describe('the shared member SQL (packages/db/src/members.ts)', () => {
  it('lockOrgMembership takes the lock the trigger takes, and refuses without an organisation', async () => {
    const org = await createOrg(clients().migrator, 'Membership lock');
    const second = await addMember(org.orgId, 'owner');
    await expect(withoutOrg(clients().pool, (tx) => lockOrgMembership(tx))).rejects.toThrow(
      /organisation context/,
    );

    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = (): void => undefined;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = withOrg(clients().pool, org.orgId, async (tx) => {
      await lockOrgMembership(tx);
      locked();
      await held;
    });
    await isLocked;
    const demotion = pgViolation(asApp(org.orgId, SET_ROLE, [second.id, 'admin']));
    expect(await stillWaiting(demotion)).toBe(true);
    release();
    await holder;
    expect(await demotion).toBeNull();
  });

  it("membershipForCheck reads a member of this organisation: role, removal and the session's cut-off", async () => {
    const org = await createOrg(clients().migrator, 'Membership check');
    const other = await createOrg(clients().migrator, 'Membership check, other');
    const member = await addMember(org.orgId, 'editor');
    const { idHash } = await signIn(member.oidcSub);
    const session = await sessionByIdHash(db, idHash, 1800);
    if (session === null) throw new Error('no session');
    const check = (orgId: string) =>
      withOrg(clients().pool, orgId, (tx) => membershipForCheck(tx, member.id, session.createdAt));

    expect(await check(org.orgId)).toEqual({ role: 'editor', removedAt: null, cutOff: false });
    expect(await check(other.orgId)).toBeNull();
    await withOrg(clients().pool, org.orgId, (tx) => sessionRevokeMembership(tx, member.id));
    expect(await check(org.orgId)).toEqual({ role: 'editor', removedAt: null, cutOff: true });
    await asApp(org.orgId, REMOVE, [member.id, org.membershipId]);
    expect(await check(org.orgId)).toMatchObject({ removedAt: expect.any(String) as string });
  });
});

describe('the script exemption', () => {
  it('rests on session_user: under SET LOCAL ROLE tinnox_definer it is still tinnox_migrator', async () => {
    expect(await asDefinerRows('SELECT session_user, current_user')).toEqual([
      { session_user: 'tinnox_migrator', current_user: 'tinnox_definer' },
    ]);
  });
});
