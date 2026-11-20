/** The role tables of docs/portal-v2/stage-c.md section 1, written out here rather than derived. */
import { describe, expect, it } from 'vitest';
import {
  AUDIT_CATEGORIES,
  PERMISSION_KEYS,
  ROLES,
  type PermissionKey,
  type Role,
} from '@tinnox/contracts';
import {
  ACTIVITY_CATEGORIES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLE_RANK,
  can,
  canManage,
  grantableRoles,
  isDemotion,
  permissionsOf,
  visibleAuditCategories,
} from './permissions.ts';

/** Section 1.3, column order viewer, editor, admin, owner. */
const TABLE: Readonly<Record<PermissionKey, readonly [boolean, boolean, boolean, boolean]>> = {
  'org.read': [true, true, true, true],
  'activity.read': [true, true, true, true],
  'content.write': [false, true, true, true],
  'content.delete': [false, true, true, true],
  'media.delete': [false, true, true, true],
  'screen.assign': [false, true, true, true],
  'push.publish': [false, true, true, true],
  'screen.details': [false, true, true, true],
  'screen.hours': [false, true, true, true],
  'screen.setup': [false, true, true, true],
  'screen.pair': [false, true, true, true],
  'audit.read': [false, false, true, true],
  'member.read': [false, false, true, true],
  'member.manage': [false, false, true, true],
};
const COLUMN: Readonly<Record<Role, number>> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
const holds = (role: Role, key: PermissionKey) => TABLE[key][COLUMN[role]];
const LOWER: Readonly<Record<Role, Role | null>> = {
  owner: 'admin',
  admin: 'editor',
  editor: 'viewer',
  viewer: null,
};

describe('ROLE_PERMISSIONS', () => {
  it('equals the table of section 1.3', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...PERMISSION_KEYS].sort());
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES)
      expect([...ROLE_PERMISSIONS[role]].sort(), role).toEqual(
        PERMISSION_KEYS.filter((key) => holds(role, key)).sort(),
      );
  });

  it('gives each role every key of the role below it', () => {
    for (const role of ROLES) {
      const lower = LOWER[role];
      if (lower === null) continue;
      for (const key of ROLE_PERMISSIONS[lower])
        expect(ROLE_PERMISSIONS[role], `${role} ${key}`).toContain(key);
    }
  });

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
    for (const role of ROLES) expect(Object.isFrozen(ROLE_PERMISSIONS[role]), role).toBe(true);
  });
});

describe('can', () => {
  it('answers all 56 role and key pairs from the table', () => {
    let pairs = 0;
    for (const role of ROLES)
      for (const key of PERMISSION_KEYS) {
        expect(can(role, key), `${role} ${key}`).toBe(holds(role, key));
        pairs += 1;
      }
    expect(pairs).toBe(56);
  });

  it('refuses a value that is not a role', () => {
    expect(can('operator' as Role, 'org.read')).toBe(false);
    expect(can('constructor' as Role, 'org.read')).toBe(false);
  });
});

describe('permissionsOf', () => {
  it('lists the role keys in PERMISSION_KEYS order', () => {
    expect(permissionsOf('viewer')).toEqual(['org.read', 'activity.read']);
    expect(permissionsOf('owner')).toEqual([...PERMISSION_KEYS]);
    for (const role of ROLES)
      expect(permissionsOf(role), role).toEqual(PERMISSION_KEYS.filter((key) => holds(role, key)));
  });
});

describe('rank rule', () => {
  it('ranks and labels the roles', () => {
    expect(ROLE_RANK).toEqual({ owner: 3, admin: 2, editor: 1, viewer: 0 });
    expect(ROLE_LABELS).toEqual({
      owner: 'Owner',
      admin: 'Admin',
      editor: 'Editor',
      viewer: 'Viewer',
    });
    for (const label of Object.values(ROLE_LABELS))
      expect(label.toLowerCase()).not.toContain('operator');
  });

  it('answers canManage for all 16 pairs', () => {
    const MANAGES: Readonly<Record<Role, readonly Role[]>> = {
      owner: ['owner', 'admin', 'editor', 'viewer'],
      admin: ['editor', 'viewer'],
      editor: [],
      viewer: [],
    };
    for (const actor of ROLES)
      for (const target of ROLES)
        expect(canManage(actor, target), `${actor} ${target}`).toBe(
          MANAGES[actor].includes(target),
        );
    expect(canManage('operator' as Role, 'viewer')).toBe(false);
  });

  it('gives the roles of section 1.4', () => {
    const GRANTS: Readonly<Record<Role, { invite: readonly Role[]; change: readonly Role[] }>> = {
      owner: {
        invite: ['admin', 'editor', 'viewer'],
        change: ['owner', 'admin', 'editor', 'viewer'],
      },
      admin: { invite: ['editor', 'viewer'], change: ['editor', 'viewer'] },
      editor: { invite: [], change: [] },
      viewer: { invite: [], change: [] },
    };
    for (const actor of ROLES) {
      expect(grantableRoles(actor, 'invite'), `${actor} invite`).toEqual(GRANTS[actor].invite);
      expect(grantableRoles(actor, 'change'), `${actor} change`).toEqual(GRANTS[actor].change);
    }
    expect(grantableRoles('operator' as Role, 'change')).toEqual([]);
  });

  it('calls a lower rank a demotion, both ways', () => {
    expect(isDemotion('owner', 'admin')).toBe(true);
    expect(isDemotion('admin', 'viewer')).toBe(true);
    expect(isDemotion('editor', 'viewer')).toBe(true);
    expect(isDemotion('viewer', 'editor')).toBe(false);
    expect(isDemotion('admin', 'owner')).toBe(false);
    for (const role of ROLES) expect(isDemotion(role, role), role).toBe(false);
  });
});

describe('activity categories', () => {
  it('are the 11 of section 1.5, all real categories, none of the full-log ones', () => {
    expect(ACTIVITY_CATEGORIES).toEqual([
      'display',
      'pairing',
      'player',
      'media',
      'tag',
      'folder',
      'app',
      'playlist',
      'schedule',
      'layout',
      'publication',
    ]);
    for (const category of ACTIVITY_CATEGORIES) expect(AUDIT_CATEGORIES).toContain(category);
    for (const excluded of ['auth', 'security', 'invite', 'membership'] as const) {
      expect(AUDIT_CATEGORIES).toContain(excluded);
      expect(ACTIVITY_CATEGORIES).not.toContain(excluded);
    }
  });

  it('shows every category with the full log and the activity ones without', () => {
    expect(visibleAuditCategories(true)).toEqual(AUDIT_CATEGORIES);
    expect(visibleAuditCategories(false)).toEqual(ACTIVITY_CATEGORIES);
  });
});
