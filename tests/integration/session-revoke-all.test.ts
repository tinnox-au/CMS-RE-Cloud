/**
 * Security review round 3, SCX-06: rotating SESSION_SECRET does not end established
 * sessions; scripts/revoke-all-sessions.sql, the incident runbook's global sign-out
 * (docs/security/operations-and-release-checklist.md section 1.3), does.
 *
 * In a file of its own because it ends every session in the test database. Files run one
 * at a time, and every other file signs in again in its own beforeAll.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, repoRoot, signIn, startTestApp, type TestApp } from './support.ts';

/** The database administrator, as in the runbook. */
async function asSuperuser<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = new URL(process.env['TEST_DATABASE_MIGRATOR_URL'] ?? '');
  url.username = 'postgres';
  url.password = encodeURIComponent(process.env['POSTGRES_SUPERUSER_PASSWORD'] ?? '');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

describe('signing every operator out', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('rotating the session secret signs nobody out; the runbook script signs everyone out and audits it', async () => {
    const orgA = await createOrg('Revoke all A');
    const orgB = await createOrg('Revoke all B');
    const a = await signIn(t, orgA);
    const b = await signIn(t, orgB);
    expect((await a.fetch('/api/displays')).status).toBe(200);
    expect((await b.fetch('/api/displays')).status).toBe(200);

    // An API started with another SESSION_SECRET still accepts the session: the stored
    // session is not keyed with it, so rotating it is not a sign-out.
    const rotated = await startTestApp();
    try {
      expect(rotated.config.sessionSecret).not.toBe(t.config.sessionSecret);
      const sameCookie = await fetch(`${rotated.url}/api/displays`, {
        headers: { cookie: a.cookie },
      });
      expect(sameCookie.status).toBe(200);
    } finally {
      await rotated.close();
    }

    const script = await readFile(join(repoRoot, 'scripts', 'revoke-all-sessions.sql'), 'utf8');
    await asSuperuser((client) => client.query(script));

    const live = await asSuperuser(async (client) => {
      const { rows } = await client.query<{ n: string }>(
        'SELECT count(*) AS n FROM public.session WHERE revoked_at IS NULL AND expires_at > now()',
      );
      return Number(rows[0]?.n);
    });
    expect(live).toBe(0);
    expect((await a.fetch('/api/displays')).status).toBe(401);
    expect((await b.fetch('/api/displays')).status).toBe(401);
    const session = await fetch(`${t.url}/api/session`, { headers: { cookie: b.cookie } });
    expect(((await session.json()) as { authenticated: boolean }).authenticated).toBe(false);

    // Each organisation's audit trail says why its operators were signed out.
    const events = await asSuperuser(async (client) => {
      const { rows } = await client.query<{
        org_id: string;
        actor_type: string;
        object_type: string;
        detail: { reason: string; sessions: number };
      }>(
        `SELECT org_id, actor_type, object_type, detail FROM public.audit_event
         WHERE action = 'auth.logout' AND detail->>'reason' = 'global_revocation'
           AND org_id = ANY($1::uuid[])`,
        [[orgA.orgId, orgB.orgId]],
      );
      return rows;
    });
    expect(events.map((event) => event.org_id).sort()).toEqual([orgA.orgId, orgB.orgId].sort());
    for (const event of events) {
      expect(event).toMatchObject({ actor_type: 'system', object_type: 'session' });
      expect(event.detail.sessions).toBeGreaterThanOrEqual(1);
    }
    const seen = (await (await (await signIn(t, orgA)).fetch('/api/audit?limit=50')).json()) as {
      items: { action: string; actorType: string; detail: Record<string, unknown> | null }[];
    };
    expect(
      seen.items.some(
        (item) =>
          item.action === 'auth.logout' &&
          item.actorType === 'system' &&
          item.detail?.['reason'] === 'global_revocation',
      ),
    ).toBe(true);

    // Signing in again works as usual.
    const again = await signIn(t, orgA);
    expect((await again.fetch('/api/displays')).status).toBe(200);
  });
});
