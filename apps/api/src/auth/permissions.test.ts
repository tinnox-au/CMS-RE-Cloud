import { DisplayPatchSchema, ROUTES, type PermissionKey } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  checkRouteTable,
  DISPLAY_PATCH_KEYS,
  displayPatchKeys,
  meets,
  meetsKeys,
  parseRole,
  PermissionDeniedError,
  REFINES,
  requirePermission,
  ROUTE_PERMISSIONS,
  routeKey,
  tagScopeKey,
  type RouteRule,
} from './permissions.ts';

/** The 59 rows of docs/portal-v2/stage-c.md section 6.1, written out. */
const EXPECTED_ROUTES = [
  'GET /api/sites',
  'GET /api/displays',
  'POST /api/displays',
  'GET /api/displays/status',
  'GET /api/displays/:id',
  'PATCH /api/displays/:id',
  'POST /api/displays/:id/claim',
  'POST /api/displays/:id/revoke-player',
  'GET /api/displays/:id/status',
  'GET /api/media',
  'POST /api/media',
  'GET /api/media/:id',
  'PATCH /api/media/:id',
  'DELETE /api/media/:id',
  'GET /api/media/:id/preview',
  'GET /api/media/:id/thumbnail',
  'GET /api/media/:id/usage',
  'GET /api/apps',
  'POST /api/apps',
  'GET /api/apps/:id',
  'PATCH /api/apps/:id',
  'DELETE /api/apps/:id',
  'GET /api/schedules',
  'POST /api/schedules',
  'GET /api/schedules/:id',
  'PUT /api/schedules/:id',
  'DELETE /api/schedules/:id',
  'GET /api/layouts',
  'POST /api/layouts',
  'GET /api/layouts/:id',
  'PUT /api/layouts/:id',
  'DELETE /api/layouts/:id',
  'GET /api/tags',
  'POST /api/tags',
  'PATCH /api/tags/:id',
  'DELETE /api/tags/:id',
  'GET /api/folders',
  'POST /api/folders',
  'PATCH /api/folders/:id',
  'DELETE /api/folders/:id',
  'GET /api/playlists',
  'POST /api/playlists',
  'GET /api/playlists/:id',
  'PUT /api/playlists/:id',
  'DELETE /api/playlists/:id',
  'POST /api/playlists/:id/duplicate',
  'POST /api/playlists/:id/publish',
  'GET /api/push',
  'POST /api/push',
  'GET /api/overview',
  'GET /api/audit',
  'GET /api/members',
  'GET /api/members/names',
  'PATCH /api/members/:id',
  'POST /api/members/:id/remove',
  'POST /api/members/:id/sign-out',
  'GET /api/invites',
  'POST /api/invites',
  'POST /api/invites/:id/cancel',
];

describe('ROUTE_PERMISSIONS', () => {
  it('has exactly the 59 routes of the build spec, each pattern a ROUTES value', () => {
    expect(EXPECTED_ROUTES).toHaveLength(59);
    expect(Object.keys(ROUTE_PERMISSIONS).sort()).toEqual([...EXPECTED_ROUTES].sort());
    const patterns = new Set<string>(Object.values(ROUTES).filter((v) => typeof v === 'string'));
    for (const key of Object.keys(ROUTE_PERMISSIONS)) {
      const [method, pattern] = key.split(' ');
      expect(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']).toContain(method);
      expect(patterns.has(pattern ?? '')).toBe(true);
    }
    const reads = Object.keys(ROUTE_PERMISSIONS).filter((key) => key.startsWith('GET '));
    expect(reads).toHaveLength(26);
  });

  it('gives every read org.read, activity.read or member.read and no write org.read', () => {
    for (const [key, rule] of Object.entries(ROUTE_PERMISSIONS)) {
      const keys = 'all' in rule ? rule.all : rule.any;
      const readKeys: PermissionKey[] = ['org.read', 'activity.read', 'member.read'];
      if (key.startsWith('GET ')) {
        expect(keys).toHaveLength(1);
        expect(readKeys).toContain(keys[0]);
      } else {
        for (const k of keys) expect(readKeys).not.toContain(k);
      }
    }
  });

  it('uses refines only on the display PATCH and the tag writes', () => {
    const refined = Object.entries(ROUTE_PERMISSIONS)
      .filter(([, rule]) => 'refine' in rule)
      .map(([key, rule]) => [key, 'refine' in rule ? rule.refine : null]);
    expect(Object.fromEntries(refined)).toEqual({
      'PATCH /api/displays/:id': 'displayPatchFields',
      'POST /api/tags': 'tagScopeFromBody',
      'PATCH /api/tags/:id': 'tagScopeFromRow',
      'DELETE /api/tags/:id': 'tagScopeFromRow',
    });
  });
});

describe('routeKey', () => {
  it('reads HEAD as GET and upper-cases the method', () => {
    expect(routeKey('HEAD', ROUTES.media)).toBe('GET /api/media');
    expect(routeKey('get', ROUTES.media)).toBe('GET /api/media');
    expect(routeKey('POST', ROUTES.media)).toBe('POST /api/media');
  });
});

describe('checkRouteTable', () => {
  const table: Record<string, RouteRule> = {
    'GET /api/media': { all: ['org.read'] },
    'POST /api/tags': { any: ['content.write', 'screen.setup'], refine: 'tagScopeFromBody' },
  };

  it('accepts a matching set, with HEAD twins read as GET', () => {
    expect(
      checkRouteTable(new Set(['GET /api/media', 'HEAD /api/media', 'POST /api/tags']), table),
    ).toEqual([]);
  });

  it('reports a registered route without an entry', () => {
    const problems = checkRouteTable(
      new Set(['GET /api/media', 'POST /api/tags', 'DELETE /api/media/:id']),
      table,
    );
    expect(problems).toEqual(['no permission entry for DELETE /api/media/:id']);
  });

  it('reports an entry without a registered route', () => {
    expect(checkRouteTable(new Set(['GET /api/media']), table)).toEqual([
      'permission entry POST /api/tags matches no registered route',
    ]);
  });

  it('reports an any entry with an unknown refine', () => {
    const broken = {
      'POST /api/tags': { any: ['content.write'], refine: 'guess' },
    } as unknown as Record<string, RouteRule>;
    expect(checkRouteTable(new Set(['POST /api/tags']), broken)).toEqual([
      'permission entry POST /api/tags names an unknown refine guess',
    ]);
  });

  it('reports every entry when nothing was registered', () => {
    expect(checkRouteTable(new Set())).toHaveLength(59);
  });
});

describe('display PATCH fields', () => {
  it('maps every field of the schema, and only those', () => {
    expect(Object.keys(DISPLAY_PATCH_KEYS).sort()).toEqual(
      Object.keys(DisplayPatchSchema.shape).sort(),
    );
    expect(Object.keys(DISPLAY_PATCH_KEYS)).toHaveLength(11);
    for (const field of Object.keys(DisplayPatchSchema.shape)) {
      expect(displayPatchKeys([field])).toHaveLength(1);
    }
  });

  it('maps fields to keys, unique and in PERMISSION_KEYS order', () => {
    expect(displayPatchKeys(['name', 'description', 'tagIds'])).toEqual(['screen.details']);
    expect(displayPatchKeys(['workingHours'])).toEqual(['screen.hours']);
    expect(displayPatchKeys(['rotation', 'canvas', 'contentRect', 'defaultFit'])).toEqual([
      'screen.setup',
    ]);
    expect(
      displayPatchKeys(['assignedLayoutId', 'assignedPlaylistId', 'assignedScheduleId']),
    ).toEqual(['screen.assign']);
    expect(displayPatchKeys(['rotation', 'name', 'assignedPlaylistId', 'workingHours'])).toEqual([
      'screen.assign',
      'screen.details',
      'screen.hours',
      'screen.setup',
    ]);
  });

  it('ignores unknown fields', () => {
    expect(displayPatchKeys(['orgId', 'constructor', '__proto__'])).toEqual([]);
    expect(displayPatchKeys(['name', 'orgId'])).toEqual(['screen.details']);
  });

  it('refines from the body: fields of an object, null for anything else', () => {
    expect(REFINES.displayPatchFields({ name: 'x', rotation: 90 })).toEqual([
      'screen.details',
      'screen.setup',
    ]);
    expect(REFINES.displayPatchFields({})).toEqual([]);
    expect(REFINES.displayPatchFields(null)).toBeNull();
    expect(REFINES.displayPatchFields(['name'])).toBeNull();
    expect(REFINES.displayPatchFields('name')).toBeNull();
  });
});

describe('tag scopes', () => {
  it('maps 2 scopes and 2 actions', () => {
    expect(tagScopeKey('media', 'write')).toBe('content.write');
    expect(tagScopeKey('media', 'delete')).toBe('content.delete');
    expect(tagScopeKey('display', 'write')).toBe('screen.setup');
    expect(tagScopeKey('display', 'delete')).toBe('screen.setup');
  });

  it('refines a new tag from its scope', () => {
    expect(REFINES.tagScopeFromBody({ scope: 'display', name: 'x' })).toEqual(['screen.setup']);
    expect(REFINES.tagScopeFromBody({ scope: 'media', name: 'x' })).toEqual(['content.write']);
    expect(REFINES.tagScopeFromBody({ scope: 'other' })).toBeNull();
    expect(REFINES.tagScopeFromBody({})).toBeNull();
    expect(REFINES.tagScopeFromBody('display')).toBeNull();
    expect(REFINES.tagScopeFromBody(null)).toBeNull();
    expect(REFINES.tagScopeFromRow({ scope: 'display' })).toBeNull();
  });

  // No real role holds content.write without screen.setup (stage-c.md 1.3), so a hypothetical
  // key set shows the refinement decides.
  it('refuses a display tag and allows a media tag for a key set with content.write only', () => {
    const held = new Set<PermissionKey>(['org.read', 'content.write']);
    const rule = ROUTE_PERMISSIONS['POST /api/tags'];
    expect(rule !== undefined && 'any' in rule && meetsKeys(held, { any: rule.any })).toBe(true);
    const display = REFINES.tagScopeFromBody({ scope: 'display' }) ?? [];
    const media = REFINES.tagScopeFromBody({ scope: 'media' }) ?? [];
    expect(meetsKeys(held, { all: display })).toBe(false);
    expect(meetsKeys(held, { all: media })).toBe(true);
  });
});

describe('meets', () => {
  it('needs every key of an all-of requirement', () => {
    expect(meets('editor', { all: ['content.write', 'push.publish'] })).toBe(true);
    expect(meets('editor', { all: ['content.write', 'audit.read'] })).toBe(false);
    expect(meets('viewer', { all: ['org.read'] })).toBe(true);
    expect(meets('viewer', { all: ['content.write'] })).toBe(false);
    expect(meets('admin', { all: ['member.manage'] })).toBe(true);
  });

  it('needs one key of an any-of requirement', () => {
    expect(meets('editor', { any: ['audit.read', 'screen.setup'] })).toBe(true);
    expect(meets('viewer', { any: ['content.write', 'screen.setup'] })).toBe(false);
    expect(meets('owner', { any: ['member.manage'] })).toBe(true);
  });

  it('fails closed for a value that is not a role', () => {
    expect(meets('operator' as never, { all: ['org.read'] })).toBe(false);
  });
});

describe('parseRole', () => {
  it('knows the four roles and nothing else', () => {
    expect(parseRole('owner')).toBe('owner');
    expect(parseRole('admin')).toBe('admin');
    expect(parseRole('editor')).toBe('editor');
    expect(parseRole('viewer')).toBe('viewer');
    expect(parseRole('operator')).toBeNull();
    expect(parseRole('Owner')).toBeNull();
    expect(parseRole('')).toBeNull();
  });
});

describe('requirePermission', () => {
  it('passes a role that meets the requirement', () => {
    expect(() => requirePermission('editor', { all: ['screen.setup'] })).not.toThrow();
  });

  it('throws a 403 that carries the audit record', () => {
    let caught: unknown;
    try {
      requirePermission('viewer', { all: ['content.delete'] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PermissionDeniedError);
    const denied = caught as PermissionDeniedError;
    expect(denied.statusCode).toBe(403);
    expect(denied.code).toBe('forbidden');
    expect(denied.message).toBe("Your role doesn't allow this.");
    expect(denied.record).toEqual({ keys: ['content.delete'], reason: 'role', always: false });
  });

  it('always records a refusal by a people-route rule', () => {
    try {
      requirePermission('viewer', { any: ['member.manage'] }, 'rank');
      expect.unreachable();
    } catch (error) {
      expect((error as PermissionDeniedError).record).toEqual({
        keys: ['member.manage'],
        reason: 'rank',
        always: true,
      });
    }
  });
});
