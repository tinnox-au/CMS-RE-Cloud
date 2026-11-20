/**
 * Security review round 3, SCX-06: rotating SESSION_SECRET does not end established
 * sessions; scripts/revoke-all-sessions.sql, the incident runbook's global sign-out
 * (docs/security/operations-and-release-checklist.md section 1.3), does. The runbook's
 * sign-out of one operator, scripts/revoke-subject-sessions.sql, is checked first; since 0013
 * it also sets the member's cut-off (docs/portal-v2/stage-c.md section 8.3), so a browser still
 * signed in at the identity provider must enter the password and one-time code again.
 *
 * In a file of its own because it ends every session in the test database. Files run one
 * at a time, and every other file signs in again in its own beforeAll.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrg,
  repoRoot,
  signIn,
  startTestApp,
  type TestApp,
  type TestOrg,
} from './support.ts';

/** One connection as the database administrator, as in the runbook. */
async function superuserClient(): Promise<pg.Client> {
  const url = new URL(process.env['TEST_DATABASE_MIGRATOR_URL'] ?? '');
  url.username = 'postgres';
  url.password = encodeURIComponent(process.env['POSTGRES_SUPERUSER_PASSWORD'] ?? '');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

async function asSuperuser<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await superuserClient();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Waits, at most ten seconds, until backend `pid` waits for a lock. */
async function waitForLockWait(pid: number): Promise<void> {
  // A superuser sees every role's backends; outside a transaction each poll reads afresh.
  await asSuperuser(async (client) => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const { rows } = await client.query<{ waiting: boolean }>(
        "SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1",
        [pid],
      );
      if (rows[0]?.waiting === true) return;
      if (Date.now() > deadline) throw new Error(`backend ${pid} never waited for a lock`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
}

/** A runbook script as psql would run it, with its `-v name=value` variables filled in. */
async function runScript(
  client: pg.Client,
  name: string,
  variables: Record<string, string> = {},
): Promise<void> {
  let script = await readFile(join(repoRoot, 'scripts', name), 'utf8');
  for (const [variable, value] of Object.entries(variables)) {
    const placeholder = `:'${variable}'`;
    if (!script.includes(placeholder)) throw new Error(`${name} has no ${placeholder}`);
    script = script.split(placeholder).join(client.escapeLiteral(value));
  }
  await client.query(script);
}

/** The member's cut-off and the membership.sessions_end rows of the incident script. */
async function cutOff(org: TestOrg): Promise<{ cutOff: Date | null; events: unknown[] }> {
  return asSuperuser(async (client) => {
    const member = await client.query<{ sessions_valid_after: Date | null }>(
      'SELECT sessions_valid_after FROM public.membership WHERE id = $1',
      [org.membershipId],
    );
    const events = await client.query(
      `SELECT actor_type, actor_id, object_type, object_id, result, detail FROM public.audit_event
       WHERE action = 'membership.sessions_end' AND org_id = $1`,
      [org.orgId],
    );
    return { cutOff: member.rows[0]?.sessions_valid_after ?? null, events: events.rows };
  });
}

const incidentCutOff = (org: TestOrg) => ({
  actor_type: 'system',
  actor_id: null,
  object_type: 'membership',
  object_id: org.membershipId,
  result: 'success',
  detail: { reason: 'incident_revocation' },
});

describe('signing every operator out', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it("the runbook's sign-out of one operator ends only that operator's sessions, and audits it", async () => {
    const suspect = await createOrg('Revoke one');
    const colleague = await createOrg('Revoke one, other');
    const first = await signIn(t, suspect);
    const second = await signIn(t, suspect);
    const other = await signIn(t, colleague);

    await asSuperuser((client) =>
      runScript(client, 'revoke-subject-sessions.sql', { subject: suspect.oidcSub }),
    );

    expect((await first.fetch('/api/displays')).status).toBe(401);
    expect((await second.fetch('/api/displays')).status).toBe(401);
    expect((await other.fetch('/api/displays')).status).toBe(200);
    const events = await asSuperuser(async (client) => {
      const { rows } = await client.query<{
        actor_type: string;
        object_type: string;
        object_id: string;
        detail: { reason: string; sessions: number };
      }>(
        `SELECT actor_type, object_type, object_id, detail FROM public.audit_event
         WHERE action = 'auth.logout' AND org_id = $1`,
        [suspect.orgId],
      );
      return rows;
    });
    expect(events).toEqual([
      {
        actor_type: 'system',
        object_type: 'membership',
        object_id: suspect.membershipId,
        detail: { reason: 'incident_revocation', sessions: 2 },
      },
    ]);
    // The cut-off, audited once for the member; the colleague in another organisation keeps none.
    const suspectCut = await cutOff(suspect);
    expect(suspectCut.cutOff).toBeInstanceOf(Date);
    expect(suspectCut.events).toEqual([incidentCutOff(suspect)]);
    expect(await cutOff(colleague)).toEqual({ cutOff: null, events: [] });
  });

  it('the sign-out of one operator also cuts off a member with no live session, and audits it', async () => {
    const idle = await createOrg('Revoke one, no session');

    await asSuperuser((client) =>
      runScript(client, 'revoke-subject-sessions.sql', { subject: idle.oidcSub }),
    );

    const cut = await cutOff(idle);
    expect(cut.cutOff).toBeInstanceOf(Date);
    expect(cut.events).toEqual([incidentCutOff(idle)]);
    const logouts = await asSuperuser(async (client) => {
      const { rows } = await client.query(
        "SELECT 1 FROM public.audit_event WHERE action = 'auth.logout' AND org_id = $1",
        [idle.orgId],
      );
      return rows.length;
    });
    expect(logouts).toBe(0);
    // A browser still signed in at the identity provider cannot sign straight back in: a
    // sign-in authenticated before the cut-off is refused (the API then asks for prompt=login).
    await expect(signIn(t, idle, { authTime: new Date(Date.now() - 60_000) })).rejects.toThrow(
      /reauth/,
    );
    expect((await (await signIn(t, idle)).fetch('/api/displays')).status).toBe(200);

    // The script never moves a later cut-off back.
    const later = new Date(Date.now() + 3_600_000);
    await asSuperuser(async (client) => {
      await client.query('UPDATE public.membership SET sessions_valid_after = $2 WHERE id = $1', [
        idle.membershipId,
        later,
      ]);
      await runScript(client, 'revoke-subject-sessions.sql', { subject: idle.oidcSub });
    });
    const again = await cutOff(idle);
    expect(again.cutOff).toEqual(later);
    expect(again.events).toEqual([incidentCutOff(idle), incidentCutOff(idle)]);
  });

  it("the incident script's cut-off is taken after it waits for the member row", async () => {
    const suspect = await createOrg('Revoke one, row held');
    const holder = await superuserClient();
    const script = await superuserClient();
    let running: Promise<void> | undefined;
    try {
      // The suspect's own write (assertStillAllowed) only locks the row FOR SHARE. A holder that
      // changed the row would make PostgreSQL recompute the cut-off and hide the defect.
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM public.membership WHERE id = $1 FOR SHARE', [
        suspect.membershipId,
      ]);
      const pid = (await script.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]
        ?.pid;
      if (pid === undefined) throw new Error('no backend pid');
      // Sent as one message, where every statement shares one statement_timestamp().
      running = runScript(script, 'revoke-subject-sessions.sql', { subject: suspect.oidcSub });
      await waitForLockWait(pid);
      // Past a whole second, so a cut-off stamped when the script started is an earlier second.
      await new Promise((resolve) => setTimeout(resolve, 2_200));
      const t1 = (await holder.query<{ t1: Date }>('SELECT clock_timestamp() AS t1')).rows[0]?.t1;
      if (t1 === undefined) throw new Error('no clock');
      await holder.query('ROLLBACK');
      await running;

      const cut = await cutOff(suspect);
      expect(cut.cutOff?.getTime()).toBeGreaterThanOrEqual(t1.getTime());
      expect(cut.events).toEqual([incidentCutOff(suspect)]);
      // A sign-in authenticated at the identity provider while the script waited is refused.
      const duringWait = new Date(Math.floor(t1.getTime() / 1000) * 1000);
      await expect(signIn(t, suspect, { authTime: duringWait })).rejects.toThrow(/reauth/);
    } finally {
      // Ending the holder releases the row, so the script finishes before its client ends.
      await holder.end();
      await running?.catch(() => undefined);
      await script.end();
    }
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

    await asSuperuser((client) => runScript(client, 'revoke-all-sessions.sql'));

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
