/**
 * CMS-13 people routes (docs/portal-v2/stage-c.md sections 6.7 and 9.4): members, roles,
 * names, removal, sign out everywhere and invite requests, through the real API.
 *
 * One organisation holds an Owner, a second Owner, an Admin, an Editor and a Viewer. A case
 * that changes a member adds its own, so no case depends on what an earlier one changed. The
 * invite cap and the removed-name case each have an organisation of their own.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  InviteDtoSchema,
  InviteListResponseSchema,
  MemberChangeResponseSchema,
  MemberListResponseSchema,
  MemberNameListResponseSchema,
  MemberSignOutResponseSchema,
  type Role,
} from '@tinnox/contracts';
import { poolAsTx, sessionCreate, sha256, withOrg, type Pool } from '@tinnox/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  auditEvents,
  createOrg,
  signIn,
  startTestApp,
  type AuditEntry,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

/** Arranging only: one statement as the migrator inside the organisation's context. */
async function asMigrator(orgId: string, text: string, values: unknown[]): Promise<void> {
  const client = new pg.Client({ connectionString: need('TEST_DATABASE_MIGRATOR_URL') });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    await client.query(text, values);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string; code?: string }[];
  };
}

/** The outcome sec.session_create gives a new sign-in of the member, authenticated at `authTime`. */
async function signInOutcome(t: TestApp, member: TestOrg, authTime: Date): Promise<string> {
  const created = await sessionCreate(poolAsTx(t.pool), {
    idHash: sha256(randomBytes(32).toString('base64url')),
    oidcSub: member.oidcSub,
    csrfToken: randomBytes(32).toString('base64url'),
    ttlSeconds: 3600,
    idToken: null,
    authTime,
  });
  return created.outcome;
}

const patch = (body: unknown): RequestInit & { json: unknown } => ({ method: 'PATCH', json: body });
const post = (body?: unknown): RequestInit & { json?: unknown } =>
  body === undefined ? { method: 'POST' } : { method: 'POST', json: body };

describe('people routes', () => {
  let t: TestApp;
  let org: TestOrg;
  let admin: TestOrg;
  let editor: TestOrg;
  let asOwner: Operator;
  let asOwner2: Operator;
  let asAdmin: Operator;
  let asEditor: Operator;
  let asViewer: Operator;

  beforeAll(async () => {
    t = await startTestApp();
    org = await createOrg('People', { displayName: 'Olive Owner' });
    const owner2 = await addMember(org, 'owner', 'Oscar Owner');
    admin = await addMember(org, 'admin', 'Ada Admin');
    editor = await addMember(org, 'editor', 'Ed Editor');
    const viewer = await addMember(org, 'viewer', 'Val Viewer');
    asOwner = await signIn(t, org);
    asOwner2 = await signIn(t, owner2);
    asAdmin = await signIn(t, admin);
    asEditor = await signIn(t, editor);
    asViewer = await signIn(t, viewer);
  });
  afterAll(async () => {
    await t.close();
  });

  const member = (role: Role, name: string | null = null): Promise<TestOrg> =>
    addMember(org, role, name);

  async function events(category: string): Promise<AuditEntry[]> {
    return auditEvents(asOwner, `&category=${category}`);
  }

  async function denials(): Promise<AuditEntry[]> {
    return (await events('security')).filter((e) => e.action === 'security.permission_denied');
  }

  /**
   * Sends a change the people rules refuse, checks the answer, and checks that it wrote exactly
   * one security.permission_denied row naming the actor, the reason and the object.
   */
  async function refused(
    send: () => Promise<Response>,
    expected: {
      status: number;
      reason: string;
      actor: TestOrg;
      object: { type: 'membership' | 'invite'; id: string } | { route: string };
    },
  ): Promise<ErrorBody> {
    const before = (await denials()).length;
    const response = await send();
    const body = (await response.json()) as ErrorBody;
    expect(response.status, JSON.stringify(body)).toBe(expected.status);
    const after = await denials();
    expect(after.length - before).toBe(1);
    expect(after[0]).toMatchObject({
      actorId: expected.actor.membershipId,
      result: 'denied',
      ...('route' in expected.object
        ? { objectType: 'route', objectId: expected.object.route }
        : { objectType: expected.object.type, objectId: expected.object.id }),
      detail: { permission: ['member.manage'], reason: expected.reason },
    });
    return body;
  }

  async function expectForbidden(response: Response): Promise<void> {
    expect(response.status).toBe(403);
    const body = (await response.json()) as ErrorBody;
    expect(body.error).toMatchObject({
      code: 'forbidden',
      message: "Your role doesn't allow this.",
    });
  }

  async function invite(
    operator: Operator,
    name: string,
    email: string,
    role: string,
  ): Promise<string> {
    const response = await operator.fetch('/api/invites', post({ name, email, role }));
    const text = await response.text();
    expect(response.status, text).toBe(201);
    return InviteDtoSchema.parse(JSON.parse(text)).id;
  }

  async function inviteRow(id: string): Promise<Record<string, unknown> | undefined> {
    return withOrg(t.pool, org.orgId, async (tx) => {
      const { rows } = await tx.query(
        `SELECT status, name, email, closed_by, closed_at IS NOT NULL AS closed
         FROM member_invite WHERE id = $1`,
        [id],
      );
      return rows[0];
    });
  }

  it('lists every member, removed ones included and without an e-mail address, to Owners and Admins only', async () => {
    const gone = await member('viewer', 'Gone Person');
    expect((await asOwner.fetch(`/api/members/${gone.membershipId}/remove`, post())).status).toBe(
      200,
    );
    for (const operator of [asOwner, asAdmin]) {
      const response = await operator.fetch('/api/members');
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toMatch(/e-?mail/i);
      const { items } = MemberListResponseSchema.parse(JSON.parse(text));
      const ids = items.map((item) => item.id);
      expect(ids).toEqual(expect.arrayContaining([org.membershipId, admin.membershipId]));
      expect(items.find((item) => item.id === admin.membershipId)).toMatchObject({
        displayName: 'Ada Admin',
        role: 'admin',
        removedAt: null,
      });
      expect(items.find((item) => item.id === gone.membershipId)?.removedAt).not.toBeNull();
      // Removed members come last.
      expect(items.findIndex((item) => item.removedAt !== null)).toBeGreaterThan(
        items.findLastIndex((item) => item.removedAt === null),
      );
    }
    // Refused reads answer 403 and are not recorded.
    const before = (await denials()).length;
    await expectForbidden(await asEditor.fetch('/api/members'));
    await expectForbidden(await asViewer.fetch('/api/members'));
    expect((await denials()).length).toBe(before);
  });

  it('gives every role the member names, removed ones included, and marks a rename', async () => {
    const named = await member('viewer', 'Nora Named');
    const gone = await member('viewer');
    expect((await asOwner.fetch(`/api/members/${gone.membershipId}/remove`, post())).status).toBe(
      200,
    );
    for (const operator of [asOwner, asOwner2, asAdmin, asEditor, asViewer]) {
      const response = await operator.fetch('/api/members/names');
      expect(response.status).toBe(200);
      const { items } = MemberNameListResponseSchema.parse(await response.json());
      expect(items.find((item) => item.id === named.membershipId)).toEqual({
        id: named.membershipId,
        displayName: 'Nora Named',
        removed: false,
        renamedAt: null,
      });
      expect(items.find((item) => item.id === gone.membershipId)?.removed).toBe(true);
    }
    const renamed = await asAdmin.fetch(
      `/api/members/${named.membershipId}`,
      patch({ displayName: 'Nora Renamed' }),
    );
    expect(renamed.status).toBe(200);
    const { items } = MemberNameListResponseSchema.parse(
      await (await asViewer.fetch('/api/members/names')).json(),
    );
    const after = items.find((item) => item.id === named.membershipId);
    expect(after?.displayName).toBe('Nora Renamed');
    expect(after?.renamedAt).not.toBeNull();
  });

  it('takes invite requests within the rank rule and shows the address to Owners and Admins only', async () => {
    const viewerInvite = await invite(asAdmin, 'Ivy Invitee', 'ivy@example.com', 'viewer');
    const editorInvite = await invite(asAdmin, 'Ian Invitee', 'ian@example.com', 'editor');
    const adminInvite = await invite(asOwner, 'Abe Invitee', 'abe@example.com', 'admin');
    const created = (await events('invite')).filter((e) => e.action === 'invite.create');
    for (const [id, role, actor] of [
      [viewerInvite, 'viewer', admin],
      [editorInvite, 'editor', admin],
      [adminInvite, 'admin', org],
    ] as const) {
      expect(created.find((e) => e.objectId === id)).toMatchObject({
        actorId: actor.membershipId,
        objectType: 'invite',
        result: 'success',
        detail: { role },
      });
    }
    // The audit trail never holds the person's name or address.
    expect(JSON.stringify(created)).not.toMatch(/Invitee|example\.com/);

    await refused(
      () =>
        asAdmin.fetch(
          '/api/invites',
          post({ name: 'Al Invitee', email: 'al@example.com', role: 'admin' }),
        ),
      { status: 403, reason: 'grant', actor: admin, object: { route: 'POST /api/invites' } },
    );
    const asOwnerRole = await asOwner.fetch(
      '/api/invites',
      post({ name: 'Ollie Invitee', email: 'ollie@example.com', role: 'owner' }),
    );
    expect(asOwnerRole.status).toBe(400);

    const clash = async (body: object, path: string): Promise<void> => {
      const response = await asAdmin.fetch('/api/invites', post(body));
      const answer = (await response.json()) as ErrorBody;
      expect(response.status, JSON.stringify(answer)).toBe(409);
      expect(answer.error.code).toBe('conflict');
      expect(answer.error.details?.[0]?.path).toBe(path);
    };
    await clash({ name: 'Ivy Two', email: 'IVY@Example.COM', role: 'viewer' }, 'email');
    await clash({ name: 'ada admin', email: 'ada2@example.com', role: 'viewer' }, 'name');
    await clash({ name: 'IVY INVITEE', email: 'ivy2@example.com', role: 'viewer' }, 'name');

    await expectForbidden(await asEditor.fetch('/api/invites'));
    await expectForbidden(await asViewer.fetch('/api/invites'));
    const list = InviteListResponseSchema.parse(await (await asAdmin.fetch('/api/invites')).json());
    expect(list.items.map((item) => item.email)).toEqual(
      expect.arrayContaining(['ivy@example.com', 'ian@example.com', 'abe@example.com']),
    );
  });

  it('allows a removed member’s name on a new invite', async () => {
    const own = await createOrg('Returning people');
    const leaver = await addMember(own, 'editor', 'Ron Returning');
    const operator = await signIn(t, own);
    expect(
      (await operator.fetch(`/api/members/${leaver.membershipId}/remove`, post())).status,
    ).toBe(200);
    const response = await operator.fetch(
      '/api/invites',
      post({ name: 'Ron Returning', email: 'ron@example.com', role: 'editor' }),
    );
    expect(response.status).toBe(201);
  });

  it('refuses a pending invite past the hundredth', async () => {
    const own = await createOrg('Busy people');
    await asMigrator(
      own.orgId,
      `INSERT INTO member_invite (org_id, role, name, email, invited_by, expires_at)
       SELECT $1, 'viewer', 'Waiting ' || n, 'waiting' || n || '@example.com', $2,
              now() + interval '14 days'
       FROM generate_series(1, 100) AS n`,
      [own.orgId, own.membershipId],
    );
    const operator = await signIn(t, own);
    const response = await operator.fetch(
      '/api/invites',
      post({ name: 'One Too Many', email: 'late@example.com', role: 'viewer' }),
    );
    const body = (await response.json()) as ErrorBody;
    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({ code: 'conflict' });
    expect(body.error.message).toContain('100 invites');
    const list = InviteListResponseSchema.parse(
      await (await operator.fetch('/api/invites')).json(),
    );
    expect(list.items).toHaveLength(100);
  });

  it('lists an expired invite until TINNOX closes it', async () => {
    const own = await createOrg('Late people');
    // The guard refuses an invite that has already expired, so it expires a second after it is made.
    await asMigrator(
      own.orgId,
      `INSERT INTO member_invite (org_id, role, name, email, invited_by, expires_at)
       VALUES ($1, 'viewer', 'Eve Expired', 'eve@example.com', $2, now() + interval '1 second')`,
      [own.orgId, own.membershipId],
    );
    const expired = (): Promise<boolean> =>
      withOrg(t.pool, own.orgId, async (tx) => {
        const { rows } = await tx.query<{ past: boolean }>(
          'SELECT bool_and(expires_at < now()) AS past FROM member_invite',
        );
        return rows[0]?.past === true;
      });
    // Waits on the database clock.
    while (!(await expired())) await new Promise((resolve) => setTimeout(resolve, 100));
    const operator = await signIn(t, own);
    const list = InviteListResponseSchema.parse(
      await (await operator.fetch('/api/invites')).json(),
    );
    expect(list.items).toEqual([
      expect.objectContaining({ name: 'Eve Expired', email: 'eve@example.com', role: 'viewer' }),
    ]);
  });

  it('cancels an invite within the rank rule and deletes the person’s details', async () => {
    const id = await invite(asAdmin, 'Cal Cancelled', 'cal@example.com', 'editor');
    expect((await asAdmin.fetch(`/api/invites/${id}/cancel`, post())).status).toBe(204);
    expect(await inviteRow(id)).toEqual({
      status: 'cancelled',
      name: null,
      email: null,
      closed_by: admin.membershipId,
      closed: true,
    });
    expect(
      (await events('invite')).find((e) => e.action === 'invite.cancel' && e.objectId === id),
    ).toMatchObject({
      actorId: admin.membershipId,
      result: 'success',
      detail: { role: 'editor', reason: 'cancelled' },
    });

    const owners = await invite(asOwner, 'Amy Invitee', 'amy@example.com', 'admin');
    await refused(() => asAdmin.fetch(`/api/invites/${owners}/cancel`, post()), {
      status: 403,
      reason: 'rank',
      actor: admin,
      object: { type: 'invite', id: owners },
    });
    expect((await inviteRow(owners))?.['status']).toBe('pending');

    const again = await asAdmin.fetch(`/api/invites/${id}/cancel`, post());
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorBody).error.code).toBe('conflict');
    expect((await asAdmin.fetch(`/api/invites/${randomUUID()}/cancel`, post())).status).toBe(404);
  });

  it('changes roles within the rank rule and ends the sessions of a demoted member', async () => {
    const target = await member('viewer');
    const asTarget = await signIn(t, target);
    const promoted = await asAdmin.fetch(
      `/api/members/${target.membershipId}`,
      patch({ role: 'editor' }),
    );
    expect(promoted.status).toBe(200);
    expect(MemberChangeResponseSchema.parse(await promoted.json())).toMatchObject({
      member: { id: target.membershipId, role: 'editor' },
      sessionsEnded: 0,
      invitesCancelled: 0,
    });
    // A promotion ends no session.
    expect((await asTarget.fetch('/api/members/names')).status).toBe(200);

    const demoted = await asAdmin.fetch(
      `/api/members/${target.membershipId}`,
      patch({ role: 'viewer' }),
    );
    expect(demoted.status).toBe(200);
    const change = MemberChangeResponseSchema.parse(await demoted.json());
    expect(change.member.role).toBe('viewer');
    expect(change.sessionsEnded).toBeGreaterThanOrEqual(1);
    expect((await asTarget.fetch('/api/members/names')).status).toBe(401);
    const changes = (await events('membership')).filter(
      (e) => e.action === 'membership.role_change' && e.objectId === target.membershipId,
    );
    expect(changes.map((e) => e.detail)).toEqual([
      { from: 'editor', to: 'viewer', sessionsEnded: change.sessionsEnded, invitesCancelled: 0 },
      { from: 'viewer', to: 'editor', sessionsEnded: 0, invitesCancelled: 0 },
    ]);
    expect(changes.every((e) => e.actorId === admin.membershipId)).toBe(true);

    // The rank rule: an Admin manages Editors and Viewers only.
    const otherAdmin = await member('admin');
    for (const victim of [org, otherAdmin]) {
      await refused(
        () => asAdmin.fetch(`/api/members/${victim.membershipId}`, patch({ role: 'viewer' })),
        {
          status: 403,
          reason: 'rank',
          actor: admin,
          object: { type: 'membership', id: victim.membershipId },
        },
      );
    }
    // An Admin cannot make anyone an Admin.
    await refused(
      () => asAdmin.fetch(`/api/members/${editor.membershipId}`, patch({ role: 'admin' })),
      {
        status: 403,
        reason: 'grant',
        actor: admin,
        object: { type: 'membership', id: editor.membershipId },
      },
    );
    // Nobody changes themselves (D7).
    await refused(
      () => asAdmin.fetch(`/api/members/${admin.membershipId}`, patch({ role: 'viewer' })),
      {
        status: 403,
        reason: 'self',
        actor: admin,
        object: { type: 'membership', id: admin.membershipId },
      },
    );
    await refused(
      () => asOwner.fetch(`/api/members/${org.membershipId}`, patch({ displayName: 'Olive O' })),
      {
        status: 403,
        reason: 'self',
        actor: org,
        object: { type: 'membership', id: org.membershipId },
      },
    );

    // Owner only after a first sign-in.
    const newcomer = await member('editor');
    const early = await refused(
      () => asOwner.fetch(`/api/members/${newcomer.membershipId}`, patch({ role: 'owner' })),
      {
        status: 409,
        reason: 'not_signed_in',
        actor: org,
        object: { type: 'membership', id: newcomer.membershipId },
      },
    );
    expect(early.error.code).toBe('conflict');
    expect(early.error.details?.[0]).toMatchObject({ path: 'role', code: 'not_signed_in_yet' });
    await signIn(t, newcomer);
    const owner = await asOwner.fetch(
      `/api/members/${newcomer.membershipId}`,
      patch({ role: 'owner' }),
    );
    expect(owner.status).toBe(200);
    expect(MemberChangeResponseSchema.parse(await owner.json()).member.role).toBe('owner');

    expect(
      (await asOwner.fetch(`/api/members/${randomUUID()}`, patch({ role: 'viewer' }))).status,
    ).toBe(404);
  });

  it('answers a last-Owner refusal of the database with 409 last_owner and records it', async () => {
    // Under the lock order the API never reaches the trigger (the actor is an Owner too), so
    // the trigger's answer is injected on the UPDATE.
    const bound = <T extends object>(target: T, key: string | symbol): unknown => {
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    };
    let armed = false;
    const injecting = (real: Pool): Pool =>
      new Proxy(real, {
        get(target, key) {
          if (key !== 'connect') return bound(target, key);
          return async () => {
            const client = await target.connect();
            return new Proxy(client, {
              get(realClient, name) {
                if (name !== 'query') return bound(realClient, name);
                return async (text: unknown, values?: unknown[]) => {
                  if (
                    armed &&
                    typeof text === 'string' &&
                    /^UPDATE membership SET role\b/.test(text)
                  ) {
                    armed = false;
                    throw Object.assign(
                      new Error('an organisation keeps at least one active owner'),
                      {
                        code: '23001',
                        constraint: 'membership_last_owner',
                      },
                    );
                  }
                  return realClient.query(text as string, values);
                };
              },
            });
          };
        },
      });
    // The throttle at its default (scale 1), and one refusal first: the last-Owner row is then
    // not the first of this app's window, so only `always` writes it.
    const faulty = await startTestApp({}, 1, { wrapPool: injecting });
    try {
      const target = await member('owner');
      const operator = await signIn(faulty, org);
      expect(
        (await operator.fetch(`/api/members/${org.membershipId}`, patch({ displayName: 'Self' })))
          .status,
      ).toBe(403);
      armed = true;
      const body = await refused(
        () => operator.fetch(`/api/members/${target.membershipId}`, patch({ role: 'admin' })),
        {
          status: 409,
          reason: 'last_owner',
          actor: org,
          object: { type: 'membership', id: target.membershipId },
        },
      );
      expect(armed).toBe(false);
      expect(body.error).toEqual({
        code: 'last_owner',
        message:
          'An organisation always keeps at least one Owner. Make someone else an Owner first.',
        requestId: expect.any(String) as unknown,
      });
      const { items } = MemberListResponseSchema.parse(
        await (await asOwner.fetch('/api/members')).json(),
      );
      expect(items.find((item) => item.id === target.membershipId)?.role).toBe('owner');
    } finally {
      await faulty.close();
    }
  });

  it('cancels the invites a demoted member can no longer give', async () => {
    const inviter = await member('owner', 'Opal Owner');
    const asInviter = await signIn(t, inviter);
    const adminInvite = await invite(asInviter, 'Ann Invitee', 'ann@example.com', 'admin');
    const editorInvite = await invite(asInviter, 'Eli Invitee', 'eli@example.com', 'editor');
    const response = await asOwner.fetch(
      `/api/members/${inviter.membershipId}`,
      patch({ role: 'admin' }),
    );
    expect(response.status).toBe(200);
    const change = MemberChangeResponseSchema.parse(await response.json());
    expect(change).toMatchObject({ member: { role: 'admin' }, invitesCancelled: 1 });
    expect(change.sessionsEnded).toBeGreaterThanOrEqual(1);

    // The Admin invite is closed by nobody's choice: closed_by stays empty.
    expect(await inviteRow(adminInvite)).toEqual({
      status: 'cancelled',
      name: null,
      email: null,
      closed_by: null,
      closed: true,
    });
    expect((await inviteRow(editorInvite))?.['status']).toBe('pending');
    expect(
      (await events('invite')).find(
        (e) => e.action === 'invite.cancel' && e.objectId === adminInvite,
      ),
    ).toMatchObject({
      actorId: org.membershipId,
      result: 'success',
      detail: { role: 'admin', reason: 'inviter_demoted' },
    });
    expect(
      (await events('membership')).find(
        (e) => e.action === 'membership.role_change' && e.objectId === inviter.membershipId,
      )?.detail,
    ).toEqual({
      from: 'owner',
      to: 'admin',
      sessionsEnded: change.sessionsEnded,
      invitesCancelled: 1,
    });
  });

  it('corrects a name, changes nothing for the same name and refuses one another member has', async () => {
    const target = await member('editor', 'Nick Name');
    const changed = await asAdmin.fetch(
      `/api/members/${target.membershipId}`,
      patch({ displayName: 'Nick Corrected' }),
    );
    expect(changed.status).toBe(200);
    expect(MemberChangeResponseSchema.parse(await changed.json())).toMatchObject({
      member: { displayName: 'Nick Corrected', role: 'editor' },
      sessionsEnded: 0,
      invitesCancelled: 0,
    });
    const updates = (): Promise<AuditEntry[]> =>
      events('membership').then((all) =>
        all.filter((e) => e.action === 'membership.update' && e.objectId === target.membershipId),
      );
    expect((await updates()).map((e) => e.detail)).toEqual([{ fields: ['displayName'] }]);

    const same = await asAdmin.fetch(
      `/api/members/${target.membershipId}`,
      patch({ displayName: 'Nick Corrected', role: 'editor' }),
    );
    expect(same.status).toBe(200);
    expect(MemberChangeResponseSchema.parse(await same.json())).toMatchObject({
      sessionsEnded: 0,
      invitesCancelled: 0,
    });
    expect(await updates()).toHaveLength(1);

    const taken = await asAdmin.fetch(
      `/api/members/${target.membershipId}`,
      patch({ displayName: 'ed editor' }),
    );
    const body = (await taken.json()) as ErrorBody;
    expect(taken.status).toBe(409);
    expect(body.error.code).toBe('conflict');
    expect(body.error.details?.[0]?.path).toBe('displayName');
  });

  it('removes a member, ends their sessions and cancels the invites they sent', async () => {
    const leaver = await member('admin', 'Ari Admin');
    const asLeaver = await signIn(t, leaver);
    const pending = await invite(asLeaver, 'Vic Invitee', 'vic@example.com', 'viewer');

    const response = await asOwner.fetch(`/api/members/${leaver.membershipId}/remove`, post());
    expect(response.status).toBe(200);
    const change = MemberChangeResponseSchema.parse(await response.json());
    expect(change).toMatchObject({
      member: { id: leaver.membershipId, role: 'admin' },
      invitesCancelled: 1,
    });
    expect(change.member.removedAt).not.toBeNull();
    expect(change.sessionsEnded).toBeGreaterThanOrEqual(1);
    expect((await asLeaver.fetch('/api/members')).status).toBe(401);

    expect(await inviteRow(pending)).toMatchObject({ status: 'cancelled', closed_by: null });
    expect(
      (await events('invite')).find((e) => e.action === 'invite.cancel' && e.objectId === pending),
    ).toMatchObject({
      actorId: org.membershipId,
      detail: { role: 'viewer', reason: 'inviter_removed' },
    });
    expect(
      (await events('membership')).find(
        (e) => e.action === 'membership.remove' && e.objectId === leaver.membershipId,
      ),
    ).toMatchObject({
      actorId: org.membershipId,
      result: 'success',
      detail: { previousRole: 'admin', sessionsEnded: change.sessionsEnded, invitesCancelled: 1 },
    });
    // A removed member cannot sign in again, however fresh the sign-in.
    expect(await signInOutcome(t, leaver, new Date(Date.now() + 60_000))).toBe('no_membership');

    const again = await asOwner.fetch(`/api/members/${leaver.membershipId}/remove`, post());
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorBody).error.code).toBe('conflict');
    await refused(() => asAdmin.fetch(`/api/members/${org.membershipId}/remove`, post()), {
      status: 403,
      reason: 'rank',
      actor: admin,
      object: { type: 'membership', id: org.membershipId },
    });
  });

  it('signs a member out everywhere and asks for a fresh sign-in', async () => {
    const target = await member('editor');
    const asTarget = await signIn(t, target);
    const response = await asAdmin.fetch(`/api/members/${target.membershipId}/sign-out`, post());
    expect(response.status).toBe(200);
    const { sessionsEnded } = MemberSignOutResponseSchema.parse(await response.json());
    expect(sessionsEnded).toBeGreaterThanOrEqual(1);
    expect((await asTarget.fetch('/api/members/names')).status).toBe(401);
    // A sign-in authenticated before the sign-out must enter the password and code again.
    expect(await signInOutcome(t, target, new Date(Date.now() - 60_000))).toBe('reauth');
    expect(
      (await events('membership')).find(
        (e) => e.action === 'membership.sessions_end' && e.objectId === target.membershipId,
      ),
    ).toMatchObject({ actorId: admin.membershipId, detail: { sessions: sessionsEnded } });

    await refused(() => asAdmin.fetch(`/api/members/${admin.membershipId}/sign-out`, post()), {
      status: 403,
      reason: 'self',
      actor: admin,
      object: { type: 'membership', id: admin.membershipId },
    });
  });
});

describe('people refusals with the permission-denied throttle at its default', () => {
  let t: TestApp;

  beforeAll(async () => {
    // Rate limits and the throttle as in the running service (scale 1).
    t = await startTestApp({}, 1);
  });
  afterAll(async () => {
    await t.close();
  });

  it('records every refused member change, past the throttle, and no refused read', async () => {
    const org = await createOrg('Refusals');
    const admin = await addMember(org, 'admin');
    const editor = await addMember(org, 'editor');
    const asOwner = await signIn(t, org);
    const asAdmin = await signIn(t, admin);
    const asEditor = await signIn(t, editor);
    const owners = (await (
      await asOwner.fetch(
        '/api/invites',
        post({ name: 'Throttle Invitee', email: 'throttle@example.com', role: 'admin' }),
      )
    ).json()) as { id: string };
    const attempts = [
      () => asAdmin.fetch(`/api/members/${org.membershipId}`, patch({ role: 'viewer' })),
      () => asAdmin.fetch(`/api/members/${org.membershipId}/remove`, post()),
      () => asAdmin.fetch(`/api/members/${org.membershipId}/sign-out`, post()),
      () => asAdmin.fetch(`/api/members/${admin.membershipId}`, patch({ displayName: 'Me' })),
      () => asAdmin.fetch(`/api/invites/${owners.id}/cancel`, post()),
      () =>
        asAdmin.fetch(
          '/api/invites',
          post({ name: 'Grant Invitee', email: 'grant@example.com', role: 'admin' }),
        ),
    ];
    // More than PERMISSION_DENIALS_PER_WINDOW (20), at most 5 per route (the write limit is 30).
    const total = 30;
    for (let i = 0; i < total; i += 1) {
      const attempt = attempts[i % attempts.length];
      if (attempt === undefined) throw new Error('no attempt');
      const response = await attempt();
      expect(response.status).toBe(403);
    }
    for (const path of ['/api/members', '/api/invites', '/api/members', '/api/invites']) {
      expect((await asEditor.fetch(path)).status).toBe(403);
    }
    const rows = (await auditEvents(asOwner, '&category=security')).filter(
      (e) => e.action === 'security.permission_denied',
    );
    expect(rows.filter((e) => e.actorId === admin.membershipId)).toHaveLength(total);
    expect(rows.filter((e) => e.actorId === editor.membershipId)).toHaveLength(0);
    expect(new Set(rows.map((e) => (e.detail as { reason?: string } | null)?.reason))).toEqual(
      new Set(['rank', 'self', 'grant']),
    );
  });
});
