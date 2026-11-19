/**
 * scripts/provision-member.ts (docs/portal-v2/stage-c.md section 8.2): TINNOX's provisioning
 * commands against the real schema, as tinnox_migrator, with a fake identity-provider reader.
 *
 * Arranging writes run as the migrator with app.org_id set (row-level security binds the
 * table owner too). An expired invite is made by inserting one that expires in a second and
 * waiting; the trigger is never disabled.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { inviteReference } from '@tinnox/contracts';
import { withOrg, withoutOrg } from '@tinnox/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IdpAccount, IdpDirectory } from '../../scripts/lib/idp.ts';
import {
  RefusedError,
  fulfil,
  mfaReset,
  orgCreate,
  pending,
  restoreOwner,
  setName,
} from '../../scripts/lib/provision.ts';
import {
  addMember,
  createOrg,
  repoRoot,
  signIn,
  startTestApp,
  type TestApp,
  type TestOrg,
} from './support.ts';

const STAFF = 'sam.staff';
const APPROVAL = { requestRef: 'REQ-40', executedBy: STAFF, approvedBy: 'lee.staff' } as const;

let t: TestApp;
/** The provisioning connection, as the CLI opens it. */
let pool: pg.Pool;

beforeAll(async () => {
  t = await startTestApp();
  pool = new pg.Pool({
    connectionString: process.env['TEST_DATABASE_MIGRATOR_URL'],
    application_name: 'tinnox-provision',
    max: 1,
  });
});
afterAll(async () => {
  await pool.end();
  await t.close();
});

/** A fake identity-provider reader that counts its reads. */
function directory(accounts: Readonly<Record<string, IdpAccount>> = {}): IdpDirectory & {
  reads: number;
} {
  const idp = {
    reads: 0,
    findByUsername(username: string): Promise<IdpAccount | null> {
      idp.reads += 1;
      return Promise.resolve(
        Object.hasOwn(accounts, username) ? (accounts[username] ?? null) : null,
      );
    },
  };
  return idp;
}

function account(email: string | null, subject = `provision-test-${randomUUID()}`): IdpAccount {
  return { subject, email, enabled: true };
}

/** Runs a command that must refuse; returns the message. */
async function refusal(work: () => Promise<unknown>): Promise<string> {
  const error = await work().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(RefusedError);
  return (error as Error).message;
}

async function invite(
  org: TestOrg,
  fixture: {
    readonly name: string;
    readonly email: string;
    readonly invitedBy: string;
    readonly role?: 'admin' | 'editor' | 'viewer';
    readonly seconds?: number;
  },
): Promise<string> {
  return withOrg(pool, org.orgId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO member_invite (org_id, role, name, email, invited_by, expires_at)
       VALUES (app_org_id(), $1, $2, $3, $4, now() + make_interval(secs => $5)) RETURNING id`,
      [
        fixture.role ?? 'editor',
        fixture.name,
        fixture.email,
        fixture.invitedBy,
        fixture.seconds ?? 7 * 86_400,
      ],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('no invite');
    return row.id;
  });
}

async function waitUntilExpired(org: TestOrg, inviteId: string): Promise<void> {
  for (;;) {
    const passed = await withOrg(pool, org.orgId, async (tx) => {
      const { rows } = await tx.query<{ passed: boolean }>(
        'SELECT expires_at <= now() AS passed FROM member_invite WHERE id = $1',
        [inviteId],
      );
      return rows[0]?.passed === true;
    });
    if (passed) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

interface InviteRow {
  readonly status: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly closed: boolean;
  readonly fulfilled_membership_id: string | null;
}

async function inviteRow(org: TestOrg, inviteId: string): Promise<InviteRow | undefined> {
  return withOrg(pool, org.orgId, async (tx) => {
    const { rows } = await tx.query<InviteRow>(
      `SELECT status, name, email, closed_at IS NOT NULL AS closed, fulfilled_membership_id
       FROM member_invite WHERE id = $1`,
      [inviteId],
    );
    return rows[0];
  });
}

interface MemberRow {
  readonly id: string;
  readonly oidc_sub: string;
  readonly role: string;
  readonly display_name: string | null;
  readonly removed: boolean;
  readonly removed_by: string | null;
  readonly signed_in: boolean;
  readonly cut_off: Date | null;
}

async function members(orgId: string): Promise<MemberRow[]> {
  return withOrg(pool, orgId, async (tx) => {
    const { rows } = await tx.query<MemberRow>(
      `SELECT id, oidc_sub, role, display_name, removed_at IS NOT NULL AS removed, removed_by,
              first_signed_in_at IS NOT NULL AS signed_in, sessions_valid_after AS cut_off
       FROM membership WHERE org_id = app_org_id() ORDER BY created_at, id`,
    );
    return rows;
  });
}

async function member(orgId: string, membershipId: string): Promise<MemberRow> {
  const row = (await members(orgId)).find((m) => m.id === membershipId);
  if (row === undefined) throw new Error(`no member ${membershipId}`);
  return row;
}

async function audits(orgId: string, action: string): Promise<unknown[]> {
  return withOrg(pool, orgId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT actor_type, actor_id, object_type, object_id, result, detail FROM audit_event
       WHERE org_id = app_org_id() AND action = $1 ORDER BY id`,
      [action],
    );
    return rows;
  });
}

const systemRow = (objectType: string, objectId: string, detail: Record<string, unknown>) => ({
  actor_type: 'system',
  actor_id: null,
  object_type: objectType,
  object_id: objectId,
  result: 'success',
  detail,
});

/** Organisations with this name, in every organisation (the definer's read). */
async function organisationsNamed(name: string): Promise<number> {
  return withoutOrg(pool, async (tx) => {
    await tx.query('SET LOCAL ROLE tinnox_definer');
    const { rows } = await tx.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM organization WHERE name = $1',
      [name],
    );
    return rows[0]?.n ?? -1;
  });
}

/**
 * Removes a member as the API does (the removal, then the cut-off and the end of their
 * sessions), but leaves the invites they sent pending, as a change made in the database would.
 */
async function removeMember(org: TestOrg, gone: TestOrg): Promise<void> {
  await withOrg(pool, org.orgId, async (tx) => {
    await tx.query(
      'UPDATE membership SET removed_at = now(), removed_by = $2 WHERE id = $1 AND org_id = app_org_id()',
      [gone.membershipId, org.membershipId],
    );
    await tx.query('SET LOCAL ROLE tinnox_definer');
    await tx.query('SELECT sec.session_revoke_membership($1)', [gone.membershipId]);
    await tx.query('RESET ROLE');
  });
}

/** The provisioning connection, with `before` awaited ahead of every statement; a rejection fails it. */
function intercepted(
  real: pg.Pool,
  before: (text: string, values: readonly unknown[] | undefined) => Promise<void>,
): pg.Pool {
  const bound = <T extends object>(target: T, key: string | symbol): unknown => {
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  };
  return new Proxy(real, {
    get(target, key) {
      if (key !== 'connect') return bound(target, key);
      return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(inner, name) {
            if (name !== 'query') return bound(inner, name);
            return async (text: string, values?: unknown[]) => {
              await before(text, values);
              return inner.query(text, values);
            };
          },
        });
      };
    },
  });
}

/**
 * The provisioning connection, except that every audit insert fails, or only the insert of
 * `action` (auditScoped's third parameter), so the audit rows before it are written first. The
 * statements before the failing insert run.
 */
function failingAudit(real: pg.Pool, action?: string): pg.Pool {
  return intercepted(real, (text, values) =>
    /INSERT INTO (public\.)?audit_event/.test(text) &&
    (action === undefined || values?.[2] === action)
      ? Promise.reject(new Error('audit insert failed (test)'))
      : Promise.resolve(),
  );
}

describe('provision-member fulfil', () => {
  it("adds the member with the invite's role and name, and deletes the invite's details", async () => {
    const org = await createOrg('Provision fulfil');
    const id = await invite(org, {
      name: 'Robin Example',
      email: 'robin@example.com',
      invitedBy: org.membershipId,
    });
    // The e-mail address is compared ignoring case and surrounding spaces.
    const robin = account(' Robin@Example.com ');
    const result = await fulfil(pool, directory({ robin }), {
      inviteId: id,
      username: 'robin',
      confirmedWith: 'TICKET-1',
      executedBy: STAFF,
    });

    expect(result).toMatchObject({ orgId: org.orgId, role: 'editor', reactivated: false });
    expect(await member(org.orgId, result.membershipId)).toMatchObject({
      oidc_sub: robin.subject,
      role: 'editor',
      display_name: 'Robin Example',
      removed: false,
      signed_in: false,
    });
    expect(await inviteRow(org, id)).toEqual({
      status: 'fulfilled',
      name: null,
      email: null,
      closed: true,
      fulfilled_membership_id: result.membershipId,
    });
    expect(await audits(org.orgId, 'membership.create')).toEqual([
      systemRow('membership', result.membershipId, {
        role: 'editor',
        inviteId: id,
        reactivated: false,
        requestRef: inviteReference(id),
        confirmedWith: 'TICKET-1',
        executedBy: STAFF,
      }),
    ]);
    expect(result.lines.join('\n')).not.toMatch(/example\.com/i);

    // The new Editor signs in.
    const robinSession = await signIn(t, {
      ...org,
      membershipId: result.membershipId,
      oidcSub: robin.subject,
    });
    expect((await robinSession.fetch('/api/displays')).status).toBe(200);
  });

  it('refuses, leaving the invite pending and writing nothing', async () => {
    const org = await createOrg('Provision refusals');
    const elsewhere = await createOrg('Provision refusals, elsewhere');
    const removedAdmin = await addMember(org, 'admin', 'Riley Admin');
    const demotedAdmin = await addMember(org, 'admin', 'Morgan Admin');
    const late = await invite(org, {
      name: 'Late Example',
      email: 'late@example.com',
      invitedBy: org.membershipId,
      seconds: 1,
    });
    const idp = directory({
      late: account('late@example.com'),
      differs: account('someone.else@example.com'),
      'no-email': account(null),
      elsewhere: account('elsewhere@example.com', elsewhere.oidcSub),
      'already-here': account('owner@example.com', org.oidcSub),
      'by-removed': account('by.removed@example.com'),
      'by-demoted': account('by.demoted@example.com'),
    });

    async function refused(
      username: string,
      fixture: { readonly name: string; readonly email: string },
      message: RegExp,
      inviteId?: string,
    ): Promise<void> {
      const id = inviteId ?? (await invite(org, { ...fixture, invitedBy: org.membershipId }));
      const before = await members(org.orgId);
      const created = await audits(org.orgId, 'membership.create');
      expect(
        await refusal(() =>
          fulfil(pool, idp, { inviteId: id, username, confirmedWith: 'T-2', executedBy: STAFF }),
        ),
      ).toMatch(message);
      expect(await inviteRow(org, id)).toEqual({
        status: 'pending',
        name: fixture.name,
        email: fixture.email,
        closed: false,
        fulfilled_membership_id: null,
      });
      expect(await members(org.orgId)).toEqual(before);
      expect(await audits(org.orgId, 'membership.create')).toEqual(created);
    }

    await refused(
      'differs',
      { name: 'Pat Example', email: 'pat@example.com' },
      /e-mail address differs/,
    );
    await refused('no-email', { name: 'Nell Example', email: 'nell@example.com' }, /no e-mail/);
    await refused(
      'elsewhere',
      { name: 'Ellis Elsewhere', email: 'elsewhere@example.com' },
      /another organisation/,
    );
    await refused(
      'already-here',
      { name: 'Owen Owner', email: 'owner@example.com' },
      /already an active member/,
    );

    const byRemoved = await invite(org, {
      name: 'Kai Example',
      email: 'by.removed@example.com',
      invitedBy: removedAdmin.membershipId,
    });
    await removeMember(org, removedAdmin);
    await refused(
      'by-removed',
      { name: 'Kai Example', email: 'by.removed@example.com' },
      /requested the invite was removed or can no longer give this role/,
      byRemoved,
    );

    // An Admin who invited an Editor, then became an Editor in the database (the API's
    // demotion would have cancelled the invite): an Editor gives no role.
    const byDemoted = await invite(org, {
      name: 'Lou Example',
      email: 'by.demoted@example.com',
      invitedBy: demotedAdmin.membershipId,
    });
    await withOrg(pool, org.orgId, (tx) =>
      tx.query("UPDATE membership SET role = 'editor' WHERE id = $1 AND org_id = app_org_id()", [
        demotedAdmin.membershipId,
      ]),
    );
    await refused(
      'by-demoted',
      { name: 'Lou Example', email: 'by.demoted@example.com' },
      /can no longer give this role/,
      byDemoted,
    );

    await waitUntilExpired(org, late);
    await refused('late', { name: 'Late Example', email: 'late@example.com' }, /expired/, late);
  });

  it('refuses when another run adds the same account elsewhere after its check', async () => {
    const org = await createOrg('Provision race');
    const elsewhere = await createOrg('Provision race, elsewhere');
    const id = await invite(org, {
      name: 'Quinn Example',
      email: 'quinn@example.com',
      invitedBy: org.membershipId,
    });
    const quinn = account('quinn@example.com');
    // The other run commits on its own connection between this run's definer read and its insert.
    const other = new pg.Pool({ connectionString: process.env['TEST_DATABASE_MIGRATOR_URL'] });
    let raced = false;
    const racing = intercepted(pool, async (text) => {
      if (raced || !/INSERT INTO membership/.test(text)) return;
      raced = true;
      await withOrg(other, elsewhere.orgId, (tx) =>
        tx.query(
          "INSERT INTO membership (org_id, oidc_sub, role) VALUES (app_org_id(), $1, 'viewer')",
          [quinn.subject],
        ),
      );
    });
    const before = await members(org.orgId);
    try {
      expect(
        await refusal(() =>
          fulfil(racing, directory({ quinn }), {
            inviteId: id,
            username: 'quinn',
            confirmedWith: 'T-4',
            executedBy: STAFF,
          }),
        ),
      ).toMatch(/already has a membership, removed or not/);
    } finally {
      await other.end();
    }
    expect(raced).toBe(true);
    expect(await members(org.orgId)).toEqual(before);
    expect(await audits(org.orgId, 'membership.create')).toEqual([]);
    expect(await inviteRow(org, id)).toMatchObject({ status: 'pending', closed: false });
  });

  it("brings a removed member back on their row with the invite's role; their old sessions stay ended", async () => {
    const org = await createOrg('Provision return');
    const casey = await addMember(org, 'admin', 'Casey Example');
    const old = await signIn(t, casey);
    expect((await old.fetch('/api/displays')).status).toBe(200);
    await removeMember(org, casey);
    expect((await old.fetch('/api/displays')).status).toBe(401);
    const before = await member(org.orgId, casey.membershipId);
    expect(before).toMatchObject({ removed: true, signed_in: true });
    const cutOff = before.cut_off;
    if (cutOff === null) throw new Error('the removal set no cut-off');

    const id = await invite(org, {
      role: 'viewer',
      name: 'Casey Returned',
      email: 'casey@example.com',
      invitedBy: org.membershipId,
    });
    const result = await fulfil(
      pool,
      directory({ casey: account('casey@example.com', casey.oidcSub) }),
      { inviteId: id, username: 'casey', confirmedWith: 'TICKET-3', executedBy: STAFF },
    );

    expect(result).toMatchObject({
      membershipId: casey.membershipId,
      role: 'viewer',
      reactivated: true,
    });
    expect(await member(org.orgId, casey.membershipId)).toMatchObject({
      role: 'viewer',
      display_name: 'Casey Returned',
      removed: false,
      removed_by: null,
      signed_in: false,
      cut_off: cutOff,
    });
    expect(await audits(org.orgId, 'membership.create')).toEqual([
      systemRow('membership', casey.membershipId, {
        role: 'viewer',
        inviteId: id,
        reactivated: true,
        requestRef: inviteReference(id),
        confirmedWith: 'TICKET-3',
        executedBy: STAFF,
      }),
    ]);
    // The old session stays ended, and so does a sign-in authenticated before the removal.
    expect((await old.fetch('/api/displays')).status).toBe(401);
    await expect(
      signIn(t, casey, { authTime: new Date(cutOff.getTime() - 60_000) }),
    ).rejects.toThrow(/reauth/);
    expect((await (await signIn(t, casey)).fetch('/api/displays')).status).toBe(200);
  });
});

describe('provision-member pending', () => {
  it('expires and audits the invites past their date in every organisation, and lists the rest', async () => {
    const a = await createOrg('Provision pending A');
    const b = await createOrg('Provision pending B');
    const expiredA = await invite(a, {
      role: 'viewer',
      name: 'Sky Example',
      email: 'sky@example.com',
      invitedBy: a.membershipId,
      seconds: 1,
    });
    const expiredB = await invite(b, {
      role: 'admin',
      name: 'Sky Example',
      email: 'sky@example.com',
      invitedBy: b.membershipId,
      seconds: 1,
    });
    const waiting = await invite(a, {
      name: 'Drew Example',
      email: 'drew@example.com',
      invitedBy: a.membershipId,
    });
    await waitUntilExpired(a, expiredA);
    await waitUntilExpired(b, expiredB);

    const idp = directory();
    const result = await pending(pool, idp, { executedBy: STAFF });

    expect(idp.reads).toBe(0);
    expect(result.expired).toBeGreaterThanOrEqual(2);
    for (const [org, id, role] of [
      [a, expiredA, 'viewer'],
      [b, expiredB, 'admin'],
    ] as const) {
      expect(await inviteRow(org, id)).toMatchObject({
        status: 'expired',
        name: null,
        email: null,
        closed: true,
      });
      expect(await audits(org.orgId, 'invite.cancel')).toEqual([
        systemRow('invite', id, { role, reason: 'expired', executedBy: STAFF }),
      ]);
    }
    expect(await inviteRow(a, waiting)).toMatchObject({ status: 'pending', name: 'Drew Example' });
    const listed = result.invites.map((item) => item.id);
    expect(listed).not.toContain(expiredA);
    expect(listed).not.toContain(expiredB);
    expect(result.invites.find((item) => item.id === waiting)).toMatchObject({
      reference: inviteReference(waiting),
      orgId: a.orgId,
      orgName: 'Provision pending A',
      role: 'editor',
      name: 'Drew Example',
      email: 'drew@example.com',
    });
    expect(
      result.lines.some(
        (line) => line.includes(inviteReference(waiting)) && line.includes('drew@example.com'),
      ),
    ).toBe(true);
  });
});

describe('provision-member set-name and mfa-reset', () => {
  it('set-name names an active member by membership id or username, and refuses a taken name or a removed member', async () => {
    const org = await createOrg('Provision names');
    const editor = await addMember(org, 'editor');
    const gone = await addMember(org, 'viewer');
    await removeMember(org, gone);
    const idp = directory({ 'org-owner': account('owner@example.com', org.oidcSub) });
    const args = { requestRef: 'REQ-7', executedBy: STAFF };

    expect(
      await setName(pool, idp, {
        ...args,
        target: { membershipId: editor.membershipId },
        name: 'Jordan Example',
      }),
    ).toMatchObject({ membershipId: editor.membershipId });
    await setName(pool, idp, {
      ...args,
      requestRef: 'REQ-8',
      target: { username: 'org-owner' },
      name: 'Taylor Example',
    });

    // A repeated run (after "outcome unknown", say) changes nothing and writes no audit row.
    const again = await setName(pool, idp, {
      ...args,
      requestRef: 'REQ-7B',
      target: { membershipId: editor.membershipId },
      name: 'Jordan Example',
    });
    expect(again).toMatchObject({ membershipId: editor.membershipId });
    expect(again.lines.join('\n')).toMatch(/nothing changed/);

    expect((await member(org.orgId, editor.membershipId)).display_name).toBe('Jordan Example');
    expect((await member(org.orgId, org.membershipId)).display_name).toBe('Taylor Example');
    expect(await audits(org.orgId, 'membership.update')).toEqual([
      systemRow('membership', editor.membershipId, {
        fields: ['displayName'],
        requestRef: 'REQ-7',
        executedBy: STAFF,
      }),
      systemRow('membership', org.membershipId, {
        fields: ['displayName'],
        requestRef: 'REQ-8',
        executedBy: STAFF,
      }),
    ]);
    expect(
      await refusal(() =>
        setName(pool, idp, {
          ...args,
          target: { membershipId: editor.membershipId },
          name: 'taylor example',
        }),
      ),
    ).toMatch(/Name in use/);
    expect(
      await refusal(() =>
        setName(pool, idp, {
          ...args,
          target: { membershipId: gone.membershipId },
          name: 'Gone Example',
        }),
      ),
    ).toMatch(/removed/);
    // A pending invite's name is taken until TINNOX fulfils or closes the invite.
    await invite(org, {
      name: 'Riley Waiting',
      email: 'riley@example.com',
      invitedBy: org.membershipId,
    });
    expect(
      await refusal(() =>
        setName(pool, idp, {
          ...args,
          target: { membershipId: editor.membershipId },
          name: 'riley waiting',
        }),
      ),
    ).toMatch(/invite waiting for TINNOX uses this name/);
    expect((await member(org.orgId, editor.membershipId)).display_name).toBe('Jordan Example');
    expect(await audits(org.orgId, 'membership.update')).toHaveLength(2);
  });

  it('mfa-reset ends the sessions and sets the cut-off; with another active Owner it needs --confirmed-with', async () => {
    const org = await createOrg('Provision mfa');
    const second = await addMember(org, 'owner');
    const lone = await createOrg('Provision mfa, alone');
    const session = await signIn(t, second);
    const idp = directory({
      'second-owner': account('second@example.com', second.oidcSub),
      'lone-owner': account('lone@example.com', lone.oidcSub),
    });
    const args = { username: 'second-owner', requestRef: 'REQ-9', executedBy: STAFF };

    expect(await refusal(() => mfaReset(pool, idp, { ...args, confirmedWith: null }))).toMatch(
      /--confirmed-with/,
    );
    expect((await session.fetch('/api/displays')).status).toBe(200);
    expect((await member(org.orgId, second.membershipId)).cut_off).toBeNull();

    const result = await mfaReset(pool, idp, { ...args, confirmedWith: 'CALL-1' });
    expect(result).toMatchObject({ membershipId: second.membershipId, sessionsEnded: 1 });
    expect((await session.fetch('/api/displays')).status).toBe(401);
    expect((await member(org.orgId, second.membershipId)).cut_off).toBeInstanceOf(Date);
    expect(await audits(org.orgId, 'membership.mfa_reset')).toEqual([
      systemRow('membership', second.membershipId, {
        requestRef: 'REQ-9',
        executedBy: STAFF,
        confirmedWith: 'CALL-1',
        sessionsEnded: 1,
      }),
    ]);
    // A browser still signed in at the identity provider must sign in again.
    await expect(signIn(t, second, { authTime: new Date(Date.now() - 60_000) })).rejects.toThrow(
      /reauth/,
    );

    // Nobody else in the organisation to ask: no confirmation.
    expect(
      await mfaReset(pool, idp, {
        username: 'lone-owner',
        requestRef: 'REQ-10',
        executedBy: STAFF,
        confirmedWith: null,
      }),
    ).toMatchObject({ membershipId: lone.membershipId, sessionsEnded: 0 });
  });
});

describe('provision-member org-create', () => {
  it('makes the organisation, its site and its Owners, and refuses an account that already has a membership', async () => {
    const existing = await createOrg('Provision org-create, existing');
    const avery = account('avery@example.com');
    const blake = account('blake@example.com');
    const idp = directory({
      avery,
      blake,
      taken: account('taken@example.com', existing.oidcSub),
      disabled: { ...account('off@example.com'), enabled: false },
    });
    const orgName = `Provisioned ${randomUUID().slice(0, 8)}`;
    const args = {
      orgName,
      timezone: 'Australia/Perth',
      siteName: 'Main site',
      owners: [
        { username: 'avery', name: 'Avery Example' },
        { username: 'blake', name: 'Blake Example' },
      ],
      requestRef: 'REQ-11',
      executedBy: STAFF,
    };

    const result = await orgCreate(pool, idp, args);

    const site = await withOrg(pool, result.orgId, (tx) =>
      tx.query(
        `SELECT o.name AS org_name, s.name, s.timezone
         FROM site s JOIN organization o ON o.id = s.org_id WHERE s.id = $1`,
        [result.siteId],
      ),
    );
    expect(site.rows).toEqual([
      { org_name: orgName, name: 'Main site', timezone: 'Australia/Perth' },
    ]);
    const owners = await members(result.orgId);
    expect(owners).toHaveLength(2);
    for (const [index, person] of [avery, blake].entries()) {
      expect(owners.find((m) => m.id === result.ownerIds[index])).toMatchObject({
        oidc_sub: person.subject,
        role: 'owner',
        display_name: args.owners[index]?.name,
      });
    }
    expect(await audits(result.orgId, 'membership.create')).toEqual(
      result.ownerIds.map((id) =>
        systemRow('membership', id, {
          role: 'owner',
          inviteId: null,
          reactivated: false,
          requestRef: 'REQ-11',
          executedBy: STAFF,
          reason: 'org_create',
        }),
      ),
    );
    const owner = await signIn(t, {
      orgId: result.orgId,
      siteId: result.siteId,
      membershipId: result.ownerIds[0] ?? '',
      oidcSub: avery.subject,
    });
    expect((await owner.fetch('/api/members')).status).toBe(200);

    const never = `Never made ${randomUUID().slice(0, 8)}`;
    for (const [username, message] of [
      ['taken', /already has a membership/],
      ['disabled', /disabled/],
      ['nobody', /no identity-provider account/],
      // One organisation per person: a second run with the same accounts is refused.
      ['avery', /already has a membership/],
    ] as const) {
      expect(
        await refusal(() =>
          orgCreate(pool, idp, {
            ...args,
            orgName: never,
            owners: [{ username, name: 'Never Example' }],
          }),
        ),
      ).toMatch(message);
    }
    expect(await organisationsNamed(never)).toBe(0);
  });
});

describe('provision-member restore-owner', () => {
  it('refuses equal staff ids with exit 2, before it reads anything', async () => {
    const outcome = await promisify(execFile)(
      join(repoRoot, 'node_modules', '.bin', 'tsx'),
      [
        'scripts/provision-member.ts',
        'restore-owner',
        '--request-ref',
        'REQ-12',
        '--executed-by',
        STAFF,
        '--approved-by',
        STAFF,
        '--promote',
        randomUUID(),
      ],
      { cwd: repoRoot, env: { ...process.env, DATABASE_MIGRATOR_URL: '' } },
    ).then(
      () => ({ code: 0, stderr: '' }),
      (error: { code?: number; stderr?: string }) => ({
        code: error.code,
        stderr: error.stderr ?? '',
      }),
    );
    expect(outcome.code).toBe(2);
    expect(outcome.stderr).toMatch(/second person/);
  });

  it('--promote makes a signed-in member an Owner, and refuses one who never signed in', async () => {
    const org = await createOrg('Provision promote');
    const admin = await addMember(org, 'admin', 'Harper Admin');
    const promote = () =>
      restoreOwner(pool, directory(), {
        ...APPROVAL,
        mode: 'promote',
        membershipId: admin.membershipId,
      });

    expect(await refusal(promote)).toMatch(/signed in at least once/);
    expect((await member(org.orgId, admin.membershipId)).role).toBe('admin');

    await signIn(t, admin);
    expect(await promote()).toMatchObject({ ownerId: admin.membershipId, removedId: null });
    expect((await member(org.orgId, admin.membershipId)).role).toBe('owner');
    expect(await audits(org.orgId, 'membership.role_change')).toEqual([
      systemRow('membership', admin.membershipId, {
        from: 'admin',
        to: 'owner',
        sessionsEnded: 0,
        invitesCancelled: 0,
        reason: 'owner_recovery',
        ...APPROVAL,
      }),
    ]);
  });

  it('--successor leaves exactly one active Owner, the successor', async () => {
    const org = await createOrg('Provision successor');
    const gone = await addMember(org, 'editor');
    await removeMember(org, gone);
    const old = await signIn(t, org);
    const request = await invite(org, {
      role: 'admin',
      name: 'Old Request',
      email: 'old.request@example.com',
      invitedBy: org.membershipId,
    });
    const quinn = account('quinn@example.com');
    const rowan = account('rowan@example.com');
    const idp = directory({ quinn, rowan });

    const result = await restoreOwner(pool, idp, {
      ...APPROVAL,
      mode: 'successor',
      successor: { username: 'quinn', name: 'Quinn Example' },
      replaces: org.membershipId,
    });

    expect(result).toMatchObject({
      removedId: org.membershipId,
      sessionsEnded: 1,
      invitesCancelled: 1,
    });
    const all = await members(org.orgId);
    expect(all.filter((m) => !m.removed)).toMatchObject([
      { id: result.ownerId, oidc_sub: quinn.subject, role: 'owner', display_name: 'Quinn Example' },
    ]);
    expect(all.find((m) => m.id === org.membershipId)).toMatchObject({
      role: 'owner',
      removed: true,
      removed_by: null,
    });
    expect((await old.fetch('/api/displays')).status).toBe(401);
    expect(await inviteRow(org, request)).toMatchObject({
      status: 'cancelled',
      name: null,
      email: null,
    });
    expect(await audits(org.orgId, 'invite.cancel')).toEqual([
      systemRow('invite', request, { role: 'admin', reason: 'inviter_removed', executedBy: STAFF }),
    ]);
    expect(await audits(org.orgId, 'membership.create')).toEqual([
      systemRow('membership', result.ownerId, {
        role: 'owner',
        inviteId: null,
        reactivated: false,
        reason: 'owner_recovery',
        ...APPROVAL,
      }),
    ]);
    expect(await audits(org.orgId, 'membership.remove')).toEqual([
      systemRow('membership', org.membershipId, {
        previousRole: 'owner',
        sessionsEnded: 1,
        invitesCancelled: 1,
        reason: 'owner_recovery',
        ...APPROVAL,
      }),
    ]);
    const successor = await signIn(t, {
      ...org,
      membershipId: result.ownerId,
      oidcSub: quinn.subject,
    });
    expect((await successor.fetch('/api/members')).status).toBe(200);

    // Someone else is still active: promote them instead.
    const busy = await createOrg('Provision successor, busy');
    await addMember(busy, 'viewer');
    expect(
      await refusal(() =>
        restoreOwner(pool, idp, {
          ...APPROVAL,
          mode: 'successor',
          successor: { username: 'rowan', name: 'Rowan Example' },
          replaces: busy.membershipId,
        }),
      ),
    ).toMatch(/only active member/);
    expect((await members(busy.orgId)).filter((m) => !m.removed)).toHaveLength(2);
  });
});

describe('provision-member, every command', () => {
  it('commits nothing when its audit insert fails', async () => {
    const broken = failingAudit(pool);
    const org = await createOrg('Provision audit failure');
    const id = await invite(org, {
      name: 'Ellis Example',
      email: 'ellis@example.com',
      invitedBy: org.membershipId,
    });
    const ellis = account('ellis@example.com');
    const before = await members(org.orgId);
    await expect(
      fulfil(broken, directory({ ellis }), {
        inviteId: id,
        username: 'ellis',
        confirmedWith: 'T-4',
        executedBy: STAFF,
      }),
    ).rejects.toThrow(/audit insert failed/);
    expect(await inviteRow(org, id)).toMatchObject({ status: 'pending', name: 'Ellis Example' });
    expect(await members(org.orgId)).toEqual(before);

    // The session end runs in the definer's function, inside the same transaction.
    const session = await signIn(t, org);
    await expect(
      mfaReset(broken, directory({ owner: account('owner@example.com', org.oidcSub) }), {
        username: 'owner',
        requestRef: 'REQ-13',
        executedBy: STAFF,
        confirmedWith: null,
      }),
    ).rejects.toThrow(/audit insert failed/);
    expect((await session.fetch('/api/displays')).status).toBe(200);
    expect((await member(org.orgId, org.membershipId)).cut_off).toBeNull();

    const unnamed = await members(org.orgId);
    await expect(
      setName(broken, directory(), {
        target: { membershipId: org.membershipId },
        name: 'Never Named',
        requestRef: 'REQ-16',
        executedBy: STAFF,
      }),
    ).rejects.toThrow(/audit insert failed/);
    expect(await members(org.orgId)).toEqual(unnamed);

    const admin = await addMember(org, 'admin', 'Harper Admin');
    await signIn(t, admin);
    const unpromoted = await members(org.orgId);
    await expect(
      restoreOwner(broken, directory(), {
        ...APPROVAL,
        mode: 'promote',
        membershipId: admin.membershipId,
      }),
    ).rejects.toThrow(/audit insert failed/);
    expect(await members(org.orgId)).toEqual(unpromoted);

    // --successor writes the most. Whichever of its audit rows fails, even the last one, the old
    // Owner stays, nobody is added, their invite stays pending and their session stays valid.
    const lost = await createOrg('Provision audit failure, successor');
    const oldSession = await signIn(t, lost);
    const request = await invite(lost, {
      role: 'admin',
      name: 'Old Request',
      email: 'old.request@example.com',
      invitedBy: lost.membershipId,
    });
    const unreplaced = await members(lost.orgId);
    const quinn = account('quinn@example.com');
    for (const action of ['invite.cancel', 'membership.create', 'membership.remove']) {
      await expect(
        restoreOwner(failingAudit(pool, action), directory({ quinn }), {
          ...APPROVAL,
          mode: 'successor',
          successor: { username: 'quinn', name: 'Quinn Example' },
          replaces: lost.membershipId,
        }),
      ).rejects.toThrow(/audit insert failed/);
      expect(await members(lost.orgId)).toEqual(unreplaced);
      expect(await inviteRow(lost, request)).toMatchObject({
        status: 'pending',
        name: 'Old Request',
      });
      expect((await oldSession.fetch('/api/displays')).status).toBe(200);
      for (const written of ['invite.cancel', 'membership.create', 'membership.remove']) {
        expect(await audits(lost.orgId, written)).toEqual([]);
      }
    }

    const orgName = `Never audited ${randomUUID().slice(0, 8)}`;
    await expect(
      orgCreate(broken, directory({ ellis }), {
        orgName,
        timezone: 'UTC',
        siteName: 'Main site',
        owners: [{ username: 'ellis', name: 'Ellis Example' }],
        requestRef: 'REQ-14',
        executedBy: STAFF,
      }),
    ).rejects.toThrow(/audit insert failed/);
    expect(await organisationsNamed(orgName)).toBe(0);
  });

  it('refuses the superuser and the runtime role before it reads the identity provider', async () => {
    const org = await createOrg('Provision wrong login');
    const superuserUrl = new URL(process.env['TEST_DATABASE_MIGRATOR_URL'] ?? '');
    superuserUrl.username = 'postgres';
    superuserUrl.password = encodeURIComponent(process.env['POSTGRES_SUPERUSER_PASSWORD'] ?? '');
    const logins = [
      new pg.Pool({ connectionString: superuserUrl.toString(), max: 1 }),
      new pg.Pool({ connectionString: process.env['TEST_DATABASE_URL'], max: 1 }),
    ];
    const idp = directory({ anyone: account('anyone@example.com', org.oidcSub) });
    try {
      for (const wrong of logins) {
        const commands = [
          () =>
            orgCreate(wrong, idp, {
              orgName: 'Never made',
              timezone: 'UTC',
              siteName: 'Main site',
              owners: [{ username: 'anyone', name: 'Anyone Example' }],
              requestRef: 'REQ-15',
              executedBy: STAFF,
            }),
          () => pending(wrong, idp, { executedBy: STAFF }),
          () =>
            fulfil(wrong, idp, {
              inviteId: randomUUID(),
              username: 'anyone',
              confirmedWith: 'T-5',
              executedBy: STAFF,
            }),
          () =>
            setName(wrong, idp, {
              target: { username: 'anyone' },
              name: 'Anyone Example',
              requestRef: 'REQ-15',
              executedBy: STAFF,
            }),
          () =>
            mfaReset(wrong, idp, {
              username: 'anyone',
              requestRef: 'REQ-15',
              executedBy: STAFF,
              confirmedWith: 'CALL-2',
            }),
          () =>
            restoreOwner(wrong, idp, {
              ...APPROVAL,
              mode: 'promote',
              membershipId: org.membershipId,
            }),
          () =>
            restoreOwner(wrong, idp, {
              ...APPROVAL,
              mode: 'successor',
              successor: { username: 'anyone', name: 'Anyone Example' },
              replaces: org.membershipId,
            }),
        ];
        for (const command of commands) {
          expect(await refusal(command)).toMatch(/only as role tinnox_migrator/);
        }
      }
    } finally {
      await Promise.all(logins.map((login) => login.end()));
    }
    expect(idp.reads).toBe(0);
  });
});
