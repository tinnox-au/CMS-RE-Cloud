/** Contract tests for roles and people (docs/portal-v2/stage-c.md sections 1 and 3, tests 9.2). */
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  AUDIT_ACTIONS,
  AUTH_ERROR_CODES,
  DEFAULT_LIMITS,
  INVITE_ROLES,
  InviteCreateSchema,
  MemberDtoSchema,
  MemberPatchSchema,
  PERMISSION_KEYS,
  ROLES,
  ROUTES,
  SessionResponseSchema,
  inviteReference,
} from './index.ts';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-11-19T00:00:00.000Z';
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;
const without = (value: Record<string, unknown>, key: string): Record<string, unknown> => {
  const { [key]: _removed, ...rest } = value;
  return rest;
};

describe('roles and permission keys', () => {
  it('lists the four roles, highest first', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'editor', 'viewer']);
  });

  it('lists exactly the 14 active keys and none of the reserved ones', () => {
    expect(PERMISSION_KEYS).toEqual([
      'org.read',
      'activity.read',
      'audit.read',
      'content.write',
      'content.delete',
      'media.delete',
      'screen.assign',
      'push.publish',
      'screen.details',
      'screen.hours',
      'screen.setup',
      'screen.pair',
      'member.read',
      'member.manage',
    ]);
    for (const reserved of ['org.rename', 'org.delete', 'site.manage', 'support.grant'])
      expect(PERMISSION_KEYS, reserved).not.toContain(reserved);
  });

  it('never invites an Owner', () => {
    expect(INVITE_ROLES).toEqual(['admin', 'editor', 'viewer']);
  });

  it('has a sign-in error for a failed forced re-login', () => {
    expect(AUTH_ERROR_CODES).toContain('reauth_failed');
  });
});

describe('SessionResponseSchema', () => {
  const user = (o: Record<string, unknown> = {}) => ({
    membershipId: U(1),
    displayName: 'Dev Owner',
    role: 'owner',
    permissions: ['org.read', 'activity.read', 'member.manage'],
    ...o,
  });
  const session = (u: unknown) => ({
    authenticated: true,
    user: u,
    organization: { id: U(2), name: 'Acme' },
    csrfToken: 'c'.repeat(32),
    expiresAt: NOW,
    limits: DEFAULT_LIMITS,
  });

  it('accepts the new user', () => {
    expect(ok(SessionResponseSchema, session(user()))).toBe(true);
    expect(ok(SessionResponseSchema, session(user({ displayName: null })))).toBe(true);
    expect(ok(SessionResponseSchema, session(user({ role: 'viewer', permissions: [] })))).toBe(
      true,
    );
    expect(ok(SessionResponseSchema, session(user({ permissions: [...PERMISSION_KEYS] })))).toBe(
      true,
    );
  });

  it('refuses the old role, unknown keys, a missing id, bad names and extra keys', () => {
    const bad = [
      user({ role: 'operator' }),
      user({ permissions: ['org.read', 'org.rename'] }),
      without(user(), 'membershipId'),
      user({ membershipId: 'not-a-uuid' }),
      user({ displayName: '' }),
      user({ displayName: 'x'.repeat(121) }),
      without(user(), 'permissions'),
      user({ email: 'owner@example.com' }),
    ];
    bad.forEach((u, i) => expect(ok(SessionResponseSchema, session(u)), `case ${i}`).toBe(false));
    expect(ok(SessionResponseSchema, session(user({ displayName: 'x'.repeat(120) })))).toBe(true);
  });
});

describe('members and invites', () => {
  const member = (o: Record<string, unknown> = {}) => ({
    id: U(1),
    displayName: 'Ann',
    role: 'editor',
    firstSignedInAt: null,
    removedAt: null,
    ...o,
  });

  it('never carries an e-mail address in a member', () => {
    expect(ok(MemberDtoSchema, member())).toBe(true);
    expect(ok(MemberDtoSchema, member({ email: 'ann@example.com' }))).toBe(false);
  });

  it('validates an invite request', () => {
    const invite = (o: Record<string, unknown> = {}) => ({
      name: 'Ann Lee',
      email: 'ann@example.com',
      role: 'editor',
      ...o,
    });
    expect(
      InviteCreateSchema.parse(invite({ name: '  Ann Lee ', email: ' ann@example.com ' })),
    ).toEqual({ name: 'Ann Lee', email: 'ann@example.com', role: 'editor' });
    expect(ok(InviteCreateSchema, invite({ name: 'x' }))).toBe(true);
    expect(ok(InviteCreateSchema, invite({ name: 'x'.repeat(120) }))).toBe(true);
    for (const role of INVITE_ROLES) expect(ok(InviteCreateSchema, invite({ role }))).toBe(true);
    const local = 'a'.repeat(254 - '@example.com'.length);
    expect(ok(InviteCreateSchema, invite({ email: `${local}@example.com` }))).toBe(true);
    expect(ok(InviteCreateSchema, invite({ email: 'zoë@exämple.de' }))).toBe(true);

    const bad = [
      invite({ name: '' }),
      invite({ name: '   ' }),
      invite({ name: 'x'.repeat(121) }),
      invite({ email: 'ann.example.com' }),
      invite({ email: 'ann@example' }),
      invite({ email: `a${local}@example.com` }),
      // PostgreSQL text cannot hold NUL; the others hide or reorder the address shown to staff.
      invite({ email: 'ann\u0000@example.com' }),
      invite({ email: 'ann\u0007@example.com' }),
      invite({ email: 'ann\u0085@example.com' }),
      invite({ email: 'ann\u202e@example.com' }),
      invite({ email: 'ann@example.com\u2066' }),
      invite({ role: 'owner' }),
      invite({ role: 'operator' }),
      invite({ orgId: U(9) }),
    ];
    bad.forEach((b, i) => expect(ok(InviteCreateSchema, b), `case ${i}`).toBe(false));
  });

  it('needs a role or a display name in a member change', () => {
    const empty = MemberPatchSchema.safeParse({});
    expect(empty.success).toBe(false);
    expect(empty.error?.issues.map((issue) => issue.message)).toEqual([
      'name a role or a display name to change',
    ]);
    expect(MemberPatchSchema.parse({ role: 'admin' })).toEqual({ role: 'admin' });
    expect(MemberPatchSchema.parse({ displayName: ' Ann ' })).toEqual({ displayName: 'Ann' });
    expect(ok(MemberPatchSchema, { role: 'operator' })).toBe(false);
    expect(ok(MemberPatchSchema, { role: 'viewer', removedAt: NOW })).toBe(false);
  });

  it('quotes an invite by the first 8 hex digits of its id, upper case', () => {
    expect(inviteReference('3f9a12c4-5b6d-4e7f-8a9b-0c1d2e3f4a5b')).toBe('3F9A12C4');
  });
});

describe('member routes', () => {
  it('encodes the id in every member and invite path', () => {
    expect(ROUTES.member('../x')).toBe('/api/members/..%2Fx');
    expect(ROUTES.memberRemove('../x')).toBe('/api/members/..%2Fx/remove');
    expect(ROUTES.memberSignOut('../x')).toBe('/api/members/..%2Fx/sign-out');
    expect(ROUTES.inviteCancel('../x')).toBe('/api/invites/..%2Fx/cancel');
  });
});

describe('error codes and audit actions', () => {
  it('has a code for keeping the last Owner', () => {
    expect(API_ERROR_CODES).toContain('last_owner');
  });

  it('names the nine new actions', () => {
    for (const action of [
      'invite.create',
      'invite.cancel',
      'membership.create',
      'membership.role_change',
      'membership.update',
      'membership.remove',
      'membership.sessions_end',
      'membership.mfa_reset',
      'security.permission_denied',
    ])
      expect(AUDIT_ACTIONS, action).toContain(action);
  });
});
