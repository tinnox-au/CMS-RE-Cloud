/**
 * Every operator route under every role (CMS-13, DEC-35). The oracle is written here, from
 * the decision, and not read from the API's route table: a wrong table would otherwise test
 * itself (docs/portal-v2/stage-c.md 15, choice 17).
 *
 * - A Viewer may only read, except the people list and the invites.
 * - An Editor may do everything except the people and invite routes; the names of people
 *   (activity) are the one people route it may read.
 * - An Admin and an Owner may do everything; the rank rule is tested in
 *   apps/api/test/members.integration.test.ts.
 *
 * A refusal by role is decided before any lookup, so it is the same 403 for an unknown id and
 * for the caller's own objects.
 */
import { randomUUID } from 'node:crypto';
import { ROLES, type Role } from '@tinnox/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPERATOR_ROUTE_PATTERNS } from './routes.ts';
import {
  addMember,
  createDisplay,
  createOrg,
  createPlaylist,
  signIn,
  startTestApp,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

/** The people and invite routes an Editor may not use. */
const MEMBER_MANAGEMENT = new Set([
  'GET /api/members',
  'PATCH /api/members/:id',
  'POST /api/members/:id/remove',
  'POST /api/members/:id/sign-out',
  'GET /api/invites',
  'POST /api/invites',
  'POST /api/invites/:id/cancel',
]);

function allowed(role: Role, method: string, pattern: string): boolean {
  const route = `${method} ${pattern}`;
  switch (role) {
    case 'owner':
    case 'admin':
      return true;
    case 'editor':
      return !MEMBER_MANAGEMENT.has(route);
    case 'viewer':
      return method === 'GET' && !MEMBER_MANAGEMENT.has(route);
  }
}

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
}

/** The parts of a refusal that must not depend on the id: everything but the request id. */
async function refusal(
  response: Response,
): Promise<{ status: number; code: string; message: string; details: unknown }> {
  const body = (await response.json()) as ErrorBody;
  return {
    status: response.status,
    code: body.error.code,
    message: body.error.message,
    details: body.error.details,
  };
}

const FORBIDDEN = {
  status: 403,
  code: 'forbidden',
  message: "Your role doesn't allow this.",
  details: undefined,
};

describe('the role-by-route matrix', () => {
  let t: TestApp;
  let org: TestOrg;
  const operators = new Map<Role, Operator>();
  let ownDisplayId: string;
  let ownPlaylistId: string;

  beforeAll(async () => {
    t = await startTestApp();
    org = await createOrg('Roles matrix');
    const owner = await signIn(t, org);
    operators.set('owner', owner);
    for (const role of ROLES.filter((r) => r !== 'owner')) {
      operators.set(role, await signIn(t, await addMember(org, role)));
    }
    ownDisplayId = (await createDisplay(owner, org, 'Matrix screen')).id;
    ownPlaylistId = await createPlaylist(owner, 'Matrix playlist');
  });
  afterAll(async () => {
    await t.close();
  });

  const operator = (role: Role): Operator => {
    const found = operators.get(role);
    if (found === undefined) throw new Error(`no ${role}`);
    return found;
  };

  it('checks all 59 routes', () => {
    expect(OPERATOR_ROUTE_PATTERNS).toHaveLength(59);
  });

  it.each(ROLES)('answers every route as the oracle says for an %s', async (role) => {
    const id = randomUUID();
    const wrong: string[] = [];
    for (const [method, pattern] of OPERATOR_ROUTE_PATTERNS) {
      const what = `${method} ${pattern}`;
      const response = await operator(role).fetch(pattern.replace(':id', id), { method });
      if (allowed(role, method, pattern)) {
        if (response.status === 401 || response.status === 403) {
          wrong.push(`${what}: ${response.status}, expected to be allowed`);
        }
        await response.body?.cancel();
      } else {
        const answer = await refusal(response);
        if (JSON.stringify(answer) !== JSON.stringify(FORBIDDEN)) {
          wrong.push(`${what}: ${JSON.stringify(answer)}, expected the role refusal`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('refuses a write with the same 403 for an unknown id and for the caller’s own objects', async () => {
    for (const role of ROLES) {
      for (const [method, pattern] of OPERATOR_ROUTE_PATTERNS) {
        if (!pattern.includes(':id') || allowed(role, method, pattern)) continue;
        for (const id of [randomUUID(), ownDisplayId, ownPlaylistId]) {
          const response = await operator(role).fetch(pattern.replace(':id', id), { method });
          expect(await refusal(response), `${role} ${method} ${pattern} ${id}`).toEqual(FORBIDDEN);
        }
      }
    }
  });

  it('answers HEAD like GET for a Viewer', async () => {
    for (const path of ['/api/displays', `/api/displays/${ownDisplayId}`, '/api/playlists']) {
      const response = await operator('viewer').fetch(path, { method: 'HEAD' });
      expect(response.status, path).toBe(200);
    }
  });

  it('changed nothing through a refused request', async () => {
    const display = (await (
      await operator('owner').fetch(`/api/displays/${ownDisplayId}`)
    ).json()) as {
      name: string;
    };
    expect(display.name).toBe('Matrix screen');
    expect((await operator('owner').fetch(`/api/playlists/${ownPlaylistId}`)).status).toBe(200);
  });
});
