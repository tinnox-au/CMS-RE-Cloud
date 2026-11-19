/**
 * Every write transaction of an operator route checks the member's role again first
 * (withOrgAllowed, withOrgDecisionAllowed; stage-c.md 6.3). This counts the plain withOrg and
 * withOrgDecision calls left in each route file against a list of the reads and audit-only
 * transactions, so a new write that uses plain withOrg fails here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES_DIR = join(import.meta.dirname, '..', 'routes');

/** Not operator routes: sign-in (before the role is known), health checks, the player protocol. */
const OUTSIDE_OPERATOR_API = new Set(['auth.ts', 'ops.ts', 'player.ts']);

/**
 * Plain withOrg calls allowed per file: reads, plus the audit-only transactions of media.ts
 * (auditUpload) and the quota read before an upload streams. Add a read here; a write goes
 * through withOrgAllowed.
 */
const READS: Readonly<Record<string, number>> = {
  'apps.ts': 2,
  'audit.ts': 1,
  'displays.ts': 5,
  'folders.ts': 1,
  'layouts.ts': 2,
  'media.ts': 6,
  'members.ts': 3,
  'overview.ts': 1,
  'playlists.ts': 2,
  'push.ts': 2,
  'schedules.ts': 2,
  'tags.ts': 1,
};

// The word boundary leaves out withOrgAllowed and withOrgDecisionAllowed; import lines have
// neither "(" nor "<" after the name.
const count = (source: string, pattern: RegExp): number => source.match(pattern)?.length ?? 0;

describe('write transactions of the operator routes', () => {
  const files = readdirSync(ROUTES_DIR).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !OUTSIDE_OPERATOR_API.has(name),
  );

  it('finds the route files', () => {
    expect(files.sort()).toEqual(Object.keys(READS).sort());
  });

  it.each(files)('%s uses plain withOrg only for its reads', (name) => {
    const source = readFileSync(join(ROUTES_DIR, name), 'utf8');
    expect(count(source, /\bwithOrg\s*[<(]/g)).toBe(READS[name] ?? 0);
  });

  it.each(files)('%s never uses withOrgDecision', (name) => {
    const source = readFileSync(join(ROUTES_DIR, name), 'utf8');
    expect(count(source, /\bwithOrgDecision\s*[<(]/g)).toBe(0);
  });
});
