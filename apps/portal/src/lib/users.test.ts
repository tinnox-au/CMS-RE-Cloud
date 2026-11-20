import { ROLES, type InviteDto, type MemberDto, type Role } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../api/client.ts';
import {
  formatDate,
  inviteCountLabel,
  invitesCancelledBy,
  inviteEmailProblem,
  inviteExpired,
  inviteNameProblem,
  inviteRequestedLabel,
  inviteRoleChoices,
  managedByOwner,
  memberActions,
  memberLabel,
  memberName,
  memberNameProblem,
  memberRefusal,
  peopleCountLabel,
  removeConsequence,
  ROLE_DESCRIPTIONS,
  roleChangeConsequence,
  roleChoices,
  roleWithArticle,
  sessionsEndedLabel,
} from './users.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-11-14T03:00:00.000Z';
const ACTOR_ID = ID(1);

function member(n: number, role: Role, change: Partial<MemberDto> = {}): MemberDto {
  return {
    id: ID(n),
    displayName: `Person ${String(n)}`,
    role,
    firstSignedInAt: T,
    removedAt: null,
    ...change,
  };
}

function invite(n: number, change: Partial<InviteDto> = {}): InviteDto {
  return {
    id: ID(n),
    name: `Invitee ${String(n)}`,
    email: `invitee${String(n)}@example.com`,
    role: 'viewer',
    invitedBy: ACTOR_ID,
    createdAt: T,
    expiresAt: '2026-11-28T03:00:00.000Z',
    ...change,
  };
}

function refusal(
  code: ApiRequestError['code'],
  details: ApiRequestError['details'] = [],
  message = 'Refused by the API.',
): ApiRequestError {
  return new ApiRequestError({ status: 409, code, message, details, fromApi: true });
}

/** Who may act on whom (section 1.4), written out rather than derived. */
const MANAGES: { readonly [R in Role]: readonly Role[] } = {
  owner: ['owner', 'admin', 'editor', 'viewer'],
  admin: ['editor', 'viewer'],
  editor: [],
  viewer: [],
};

describe('memberActions', () => {
  it('follows the rank rule for every actor and target role', () => {
    for (const actorRole of ROLES) {
      for (const targetRole of ROLES) {
        const actions = memberActions({ id: ACTOR_ID, role: actorRole }, member(2, targetRole));
        const expected = MANAGES[actorRole].includes(targetRole)
          ? ['role', 'name', 'signOut', 'remove']
          : [];
        expect(actions, `${actorRole} on ${targetRole}`).toEqual(expected);
        expect(managedByOwner({ id: ACTOR_ID, role: actorRole }, member(2, targetRole))).toBe(
          expected.length === 0,
        );
      }
    }
  });

  it('offers nothing on the actor’s own row, whatever the case of the id', () => {
    const self = member(1, 'owner', { id: ACTOR_ID.toUpperCase() });
    expect(memberActions({ id: ACTOR_ID, role: 'owner' }, self)).toEqual([]);
    expect(managedByOwner({ id: ACTOR_ID, role: 'owner' }, self)).toBe(false);
  });

  it('offers nothing on a removed row', () => {
    const removed = member(2, 'viewer', { removedAt: T });
    expect(memberActions({ id: ACTOR_ID, role: 'owner' }, removed)).toEqual([]);
    expect(managedByOwner({ id: ACTOR_ID, role: 'admin' }, removed)).toBe(false);
  });
});

describe('roleChoices', () => {
  it('offers an Owner every role, with Owner disabled before a first sign-in', () => {
    const fresh = member(2, 'editor', { firstSignedInAt: null });
    expect(roleChoices('owner', fresh)).toEqual([
      { role: 'owner', current: false, disabledReason: 'Available after their first sign-in.' },
      { role: 'admin', current: false, disabledReason: null },
      { role: 'editor', current: true, disabledReason: null },
      { role: 'viewer', current: false, disabledReason: null },
    ]);
    expect(roleChoices('owner', member(2, 'editor')).every((c) => c.disabledReason === null)).toBe(
      true,
    );
  });

  it('offers an Admin Editor and Viewer only', () => {
    expect(roleChoices('admin', member(2, 'viewer')).map((choice) => choice.role)).toEqual([
      'editor',
      'viewer',
    ]);
  });

  it('offers Editors and Viewers nothing', () => {
    expect(roleChoices('editor', member(2, 'viewer'))).toEqual([]);
    expect(roleChoices('viewer', member(2, 'viewer'))).toEqual([]);
  });
});

describe('inviteRoleChoices', () => {
  it('never offers Owner, and an Admin no Admin', () => {
    expect(inviteRoleChoices('owner')).toEqual(['admin', 'editor', 'viewer']);
    expect(inviteRoleChoices('admin')).toEqual(['editor', 'viewer']);
    expect(inviteRoleChoices('editor')).toEqual([]);
    expect(inviteRoleChoices('viewer')).toEqual([]);
  });
});

describe('roleChangeConsequence', () => {
  it('says a promotion keeps the person signed in', () => {
    for (const [from, to] of [
      ['viewer', 'editor'],
      ['editor', 'admin'],
      ['admin', 'owner'],
      ['viewer', 'owner'],
    ] as const) {
      const text = roleChangeConsequence('Dana', from, to, 0);
      expect(text, `${from} to ${to}`).toContain(`Dana becomes ${roleWithArticle(to)}.`);
      expect(text).toContain('stay signed in');
      expect(text).not.toContain('signed out');
    }
    expect(roleChangeConsequence('Dana', 'admin', 'owner', 0)).toContain(
      'change and remove Admins and Owners',
    );
  });

  it('says a demotion signs the person out, with the invites it cancels', () => {
    for (const [from, to] of [
      ['owner', 'admin'],
      ['owner', 'viewer'],
      ['admin', 'editor'],
      ['editor', 'viewer'],
    ] as const) {
      const text = roleChangeConsequence('Dana', from, to, 0);
      expect(text, `${from} to ${to}`).toContain(
        `Dana becomes ${roleWithArticle(to)} and is signed out everywhere now.`,
      );
      expect(text).not.toContain('cancelled');
    }
    expect(roleChangeConsequence('Dana', 'owner', 'admin', 1)).toContain(
      '1 invite they requested is cancelled, because an Admin cannot invite that role.',
    );
    expect(roleChangeConsequence('Dana', 'admin', 'viewer', 3)).toContain(
      '3 invites they requested are cancelled, because a Viewer cannot invite those roles.',
    );
  });

  it('says nothing changes for the current role', () => {
    expect(roleChangeConsequence('Dana', 'editor', 'editor', 0)).toBe(
      'Dana is an Editor now. Choose another role to change it.',
    );
  });
});

describe('invitesCancelledBy', () => {
  const invites = [
    invite(10, { role: 'admin' }),
    invite(11, { role: 'editor' }),
    invite(12, { role: 'viewer' }),
    invite(13, { role: 'viewer', invitedBy: ID(2) }),
  ];

  it('counts the member’s invites their new role cannot send', () => {
    expect(invitesCancelledBy(invites, ACTOR_ID, 'owner')).toBe(0);
    expect(invitesCancelledBy(invites, ACTOR_ID, 'admin')).toBe(1);
    expect(invitesCancelledBy(invites, ACTOR_ID, 'editor')).toBe(3);
    expect(invitesCancelledBy(invites, ACTOR_ID, 'viewer')).toBe(3);
  });

  it('counts all of them on removal, and only theirs', () => {
    expect(invitesCancelledBy(invites, ACTOR_ID, null)).toBe(3);
    expect(invitesCancelledBy(invites, ID(2), null)).toBe(1);
    expect(invitesCancelledBy(invites, ID(3), null)).toBe(0);
  });
});

describe('names and addresses', () => {
  const members = [
    member(2, 'editor', { displayName: 'Dana Lee' }),
    member(3, 'viewer', { displayName: 'Sam Old', removedAt: T }),
    member(4, 'viewer', { displayName: null }),
  ];
  const invites = [invite(10, { name: 'Ari Park' })];

  it('calls a member without a name "Unnamed person"', () => {
    expect(memberName({ displayName: null })).toBe('Unnamed person');
    expect(memberName({ displayName: 'Dana Lee' })).toBe('Dana Lee');
  });

  it('tells unnamed members apart by their reference where it matters', () => {
    const a = '3f9a12c4-0000-4000-8000-000000000001';
    const b = '7c01d2e9-0000-4000-8000-000000000002';
    expect(memberLabel({ id: a, displayName: null })).toBe('Unnamed person 3F9A12C4');
    expect(memberLabel({ id: b, displayName: null })).toBe('Unnamed person 7C01D2E9');
    expect(memberLabel({ id: a, displayName: 'Dana Lee' })).toBe('Dana Lee');
    expect(
      inviteRequestedLabel(
        { invitedBy: a, createdAt: T },
        [{ id: a, displayName: null, role: 'owner', firstSignedInAt: null, removedAt: null }],
        'Australia/Sydney',
      ),
    ).toBe('by Unnamed person 3F9A12C4 · 14 Nov 2026');
  });

  it('checks an invite name like the API', () => {
    expect(inviteNameProblem('  ', members, invites)).toBe('Enter a name.');
    expect(inviteNameProblem('x'.repeat(121), members, invites)).toBe(
      'Use at most 120 characters (now 121).',
    );
    expect(inviteNameProblem('Dana\tLee', members, invites)).toMatch(/invisible characters/);
    expect(inviteNameProblem('Dana‮Lee', members, invites)).toMatch(/invisible characters/);
    expect(inviteNameProblem(' dana lee ', members, invites)).toBe(
      'Another person in this organisation has this name.',
    );
    expect(inviteNameProblem('ARI PARK', members, invites)).toBe(
      'Another person in this organisation has this name.',
    );
    // A removed member's name may come back with them.
    expect(inviteNameProblem('Sam Old', members, invites)).toBeNull();
    expect(inviteNameProblem('Mia Chen', members, invites)).toBeNull();
  });

  it('checks a corrected name against every other member, removed ones included', () => {
    expect(memberNameProblem('Sam Old', members, [], ID(2))).toBe(
      'Another person in this organisation has, or had, this name.',
    );
    expect(memberNameProblem('dana lee', members, [], ID(2))).toBeNull();
    expect(memberNameProblem('', members, [], ID(2))).toBe('Enter a name.');
    // A pending invite keeps its name until TINNOX closes it.
    expect(memberNameProblem(' ari park ', members, invites, ID(2))).toBe(
      'An invite waiting for TINNOX uses this name.',
    );
  });

  it('checks a work e-mail address with the contract’s own rules', () => {
    expect(inviteEmailProblem('dana@example.com')).toBeNull();
    expect(inviteEmailProblem('  dana@example.com  ')).toBeNull();
    expect(inviteEmailProblem('')).toBe('Enter the person’s work e-mail address.');
    expect(inviteEmailProblem('dana')).toBe('Enter an address like name@example.com.');
    expect(inviteEmailProblem('dana@example')).toBe('Enter an address like name@example.com.');
    expect(inviteEmailProblem(`${'a'.repeat(250)}@example.com`)).toBe(
      'Use at most 254 characters (now 262).',
    );
    expect(inviteEmailProblem('dana\u0000@example.com')).toMatch(/invisible characters/);
    expect(inviteEmailProblem('dana‮@example.com')).toMatch(/invisible characters/);
  });
});

describe('memberRefusal', () => {
  it('keeps the last Owner in words', () => {
    expect(memberRefusal(refusal('last_owner'))).toEqual({
      field: null,
      message: 'An organisation always keeps at least one Owner. Make someone else an Owner first.',
    });
  });

  it('puts a clash on its field', () => {
    expect(memberRefusal(refusal('conflict', [{ path: 'email', message: 'x' }]))).toEqual({
      field: 'email',
      message: 'An invite for this address is already waiting.',
    });
    expect(memberRefusal(refusal('conflict', [{ path: 'name', message: 'x' }]))).toEqual({
      field: 'name',
      message: 'Another person in this organisation has this name.',
    });
    expect(memberRefusal(refusal('conflict', [{ path: 'displayName', message: 'x' }]))).toEqual({
      field: 'displayName',
      message: 'Another person in this organisation has, or had, this name.',
    });
    expect(
      memberRefusal(refusal('validation_failed', [{ path: 'email', message: 'bad' }])).field,
    ).toBe('email');
  });

  it('explains an Owner for someone who never signed in', () => {
    const error = refusal('conflict', [
      { path: 'role', code: 'not_signed_in_yet', message: 'from the API' },
    ]);
    expect(memberRefusal(error)).toEqual({
      field: 'role',
      message: 'Only someone who has signed in at least once can be made an Owner.',
    });
  });

  it('leaves anything else to the dialog, with the API’s message', () => {
    expect(memberRefusal(refusal('conflict', [], 'This person was removed.'))).toEqual({
      field: null,
      message: 'This person was removed.',
    });
    expect(memberRefusal(refusal('forbidden', [], 'Your role doesn’t allow this.')).field).toBe(
      null,
    );
  });
});

describe('labels', () => {
  it('counts people, invites and sessions', () => {
    expect(peopleCountLabel(1)).toBe('1 person');
    expect(peopleCountLabel(3)).toBe('3 people');
    expect(inviteCountLabel(1)).toBe('1 invite waiting for TINNOX');
    expect(inviteCountLabel(2)).toBe('2 invites waiting for TINNOX');
    expect(sessionsEndedLabel(0)).toBe('No session was open');
    expect(sessionsEndedLabel(1)).toBe('1 session ended');
    expect(sessionsEndedLabel(4)).toBe('4 sessions ended');
  });

  it('dates and expiry', () => {
    expect(formatDate(T, 'Australia/Sydney')).toBe('14 Nov 2026');
    expect(formatDate('not a time')).toBe('not a time');
    expect(inviteExpired(invite(10), Date.parse('2026-11-28T02:59:59.000Z'))).toBe(false);
    expect(inviteExpired(invite(10), Date.parse('2026-11-28T03:00:00.000Z'))).toBe(true);
  });

  it('names who requested an invite once the people are known', () => {
    const inviter = member(1, 'admin', { displayName: 'Dana Lee' });
    expect(inviteRequestedLabel(invite(10), [inviter], 'Australia/Sydney')).toBe(
      'by Dana Lee · 14 Nov 2026',
    );
    expect(inviteRequestedLabel(invite(10), null, 'Australia/Sydney')).toBe('14 Nov 2026');
  });

  it('says what a removal does', () => {
    expect(removeConsequence('Dana', 'Acme', 0)).toBe(
      'Dana is signed out now and can no longer use TINNOX CMS for Acme. Their content and the activity history stay. To bring them back later, invite them again; they get the role on the new invite.',
    );
    expect(removeConsequence('Dana', 'Acme', 1)).toContain('Their pending invite is cancelled.');
    expect(removeConsequence('Dana', 'Acme', 2)).toContain(
      'Their 2 pending invites are cancelled.',
    );
  });

  it('never says "operator" or "display"', () => {
    const texts = [
      ...Object.values(ROLE_DESCRIPTIONS),
      ...ROLES.flatMap((from) => ROLES.map((to) => roleChangeConsequence('Dana', from, to, 2))),
      removeConsequence('Dana', 'Acme', 2),
      memberRefusal(refusal('last_owner')).message,
      inviteNameProblem('', [], []) ?? '',
      inviteEmailProblem('x') ?? '',
    ];
    for (const text of texts) {
      expect(text.toLowerCase()).not.toContain('operator');
      expect(text.toLowerCase()).not.toContain('display');
    }
  });
});
