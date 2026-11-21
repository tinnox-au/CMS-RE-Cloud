/**
 * E-mail alerts for screens (CMS-15, docs/portal-v2/stage-c-alerts.md section 7): the check
 * (runDisplayAlerts) against real heartbeats and a moved application clock, the alert address
 * routes and the public confirmation route. E-mail goes to the recording mailer of the test app.
 *
 * The check runs over every organisation in the shared test database, so each case reads only
 * its own screens' e-mails (by screen name) and its own organisation's audit rows.
 */
import { randomBytes } from 'node:crypto';
import { localWallClock, type AlertRecipientDto } from '@tinnox/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  appClient,
  asMigratorIn,
  auditEvents,
  checkAlerts,
  createDisplay,
  createOrg,
  heartbeatBody,
  pairPlayer,
  PORTAL_ORIGIN,
  sendHeartbeat,
  signIn,
  startTestApp,
  type Operator,
  type PairedPlayer,
  type TestApp,
  type TestOrg,
} from './support.ts';

const DELAY_MS = 31 * 60 * 1000;

describe('e-mail alerts for screens', () => {
  let t: TestApp;
  let org: TestOrg;
  let owner: Operator;
  let seq = 1;

  beforeAll(async () => {
    t = await startTestApp();
    org = await createOrg('Alerts');
    owner = await signIn(t, org);
    await addConfirmed(t, owner, 'ops@example.com');
    // Waiting for confirmation: receives nothing.
    expect((await addAddress(owner, 'waiting@example.com')).status).toBe(201);
  });
  afterAll(async () => {
    await t.close();
  });

  /** A paired screen that has just reported. */
  async function reportingScreen(
    name: string,
    operator = owner,
  ): Promise<{ id: string; player: PairedPlayer }> {
    const display = await createDisplay(operator, org, name);
    const player = await pairPlayer(t, operator, display.id);
    await report(display.id, player);
    return { id: display.id, player };
  }
  async function report(displayId: string, player: PairedPlayer): Promise<void> {
    seq += 1;
    expect((await sendHeartbeat(t, player, heartbeatBody(displayId, seq))).status).toBe(200);
  }
  const mailFor = (name: string) => t.sentMail.filter((m) => m.subject.endsWith(`: ${name}`));
  async function later<T>(work: () => Promise<T>): Promise<T> {
    t.advanceClock(DELAY_MS);
    try {
      return await work();
    } finally {
      t.advanceClock(-DELAY_MS);
    }
  }
  async function check(): Promise<void> {
    expect((await checkAlerts(t)).failed).toBe(0);
  }
  const openEpisodes = async (displayId: string) => {
    const client = await appClient();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
      const { rowCount } = await client.query('SELECT 1 FROM display_alert WHERE display_id = $1', [
        displayId,
      ]);
      await client.query('COMMIT');
      return rowCount;
    } finally {
      await client.end();
    }
  };

  it('sends one offline e-mail per confirmed address after the delay, once, then one when it reports again', async () => {
    const screen = await reportingScreen('Alert foyer');
    await check();
    expect(mailFor('Alert foyer')).toEqual([]);

    await later(async () => {
      await check();
      expect(mailFor('Alert foyer')).toEqual([
        expect.objectContaining({
          to: 'ops@example.com',
          subject: 'Screen not reporting: Alert foyer',
        }),
      ]);
      expect(mailFor('Alert foyer')[0]?.text).toContain(`${PORTAL_ORIGIN}/screens/${screen.id}`);
      // A second run finds the episode claimed and sends nothing.
      await check();
      expect(mailFor('Alert foyer')).toHaveLength(1);

      await report(screen.id, screen.player);
      await check();
      expect(mailFor('Alert foyer').map((m) => [m.to, m.subject])).toEqual([
        ['ops@example.com', 'Screen not reporting: Alert foyer'],
        ['ops@example.com', 'Screen reporting again: Alert foyer'],
      ]);
    });
    expect(await openEpisodes(screen.id)).toBe(0);
    const audit = (await auditEvents(owner, '&category=display')).filter(
      (e) => e.objectId === screen.id && e.action !== 'display.create',
    );
    expect(audit.map((e) => [e.action, e.actorId, e.detail])).toEqual([
      ['display.online_alert', null, { recipients: 1 }],
      ['display.offline_alert', null, { recipients: 1 }],
    ]);
  });

  it('does not alert outside working hours', async () => {
    const screen = await reportingScreen('Alert closed');
    // Open only on a day three days from now (site zone): closed for the whole check.
    const today = localWallClock(t.ctx.now().getTime(), 'Australia/Melbourne')?.day ?? 0;
    const hours = Array.from({ length: 7 }, (_, day) =>
      day === (today + 3) % 7 ? { start: '00:00', end: '24:00' } : null,
    );
    const saved = await owner.fetch(`/api/displays/${screen.id}`, {
      method: 'PATCH',
      json: { workingHours: hours },
    });
    expect(saved.status).toBe(200);
    await later(check);
    expect(mailFor('Alert closed')).toEqual([]);
    expect(await openEpisodes(screen.id)).toBe(0);
  });

  it('closes the episode of a re-paired screen without an e-mail, and does not alert on its old report', async () => {
    const screen = await reportingScreen('Alert repaired');
    await later(async () => {
      await check();
      expect(mailFor('Alert repaired')).toHaveLength(1);
      await pairPlayer(t, owner, screen.id);
      await check();
    });
    expect(mailFor('Alert repaired')).toHaveLength(1);
    expect(await openEpisodes(screen.id)).toBe(0);
    // The new player has not reported yet: still nothing, however long it stays silent.
    t.advanceClock(2 * DELAY_MS);
    try {
      await check();
    } finally {
      t.advanceClock(-2 * DELAY_MS);
    }
    expect(mailFor('Alert repaired')).toHaveLength(1);
  });

  it('lets an Editor turn alerts off, which sends nothing and closes an open episode silently', async () => {
    const editor = await signIn(t, await addMember(org, 'editor'));
    const screen = await reportingScreen('Alert off', editor);
    await later(async () => {
      await check();
      expect(mailFor('Alert off')).toHaveLength(1);
      const off = await editor.fetch(`/api/displays/${screen.id}`, {
        method: 'PATCH',
        json: { alertOfflineMinutes: null, alertBackOnline: false },
      });
      expect(off.status).toBe(200);
      expect(await off.json()).toMatchObject({ alertOfflineMinutes: null, alertBackOnline: false });
      await check();
      await report(screen.id, screen.player);
      await check();
    });
    expect(mailFor('Alert off')).toHaveLength(1);
    expect(await openEpisodes(screen.id)).toBe(0);
    const update = (await auditEvents(owner, '&category=display')).find(
      (e) => e.objectId === screen.id && e.action === 'display.update',
    );
    expect(update?.detail).toEqual({ fields: ['alertBackOnline', 'alertOfflineMinutes'] });
  });

  it('refuses an offline delay outside 30 minutes to 48 hours in half hours', async () => {
    const display = await createDisplay(owner, org, 'Alert bounds');
    for (const minutes of [0, 15, 45, 2910]) {
      const response = await owner.fetch(`/api/displays/${display.id}`, {
        method: 'PATCH',
        json: { alertOfflineMinutes: minutes },
      });
      expect(response.status, String(minutes)).toBe(400);
    }
    const saved = await owner.fetch(`/api/displays/${display.id}`, {
      method: 'PATCH',
      json: { alertOfflineMinutes: 120 },
    });
    expect(await saved.json()).toMatchObject({ alertOfflineMinutes: 120, alertBackOnline: true });
  });

  it('records the transition with no confirmed address, and a later confirmation does not send it', async () => {
    const quiet = await createOrg('Alerts without addresses');
    const quietOwner = await signIn(t, quiet);
    const display = await createDisplay(quietOwner, quiet, 'Quiet screen');
    const player = await pairPlayer(t, quietOwner, display.id);
    seq += 1;
    expect((await sendHeartbeat(t, player, heartbeatBody(display.id, seq))).status).toBe(200);
    await later(async () => {
      await check();
      await addConfirmed(t, quietOwner, 'late@example.com');
      await check();
    });
    expect(mailFor('Quiet screen')).toEqual([]);
    const audit = (await auditEvents(quietOwner, '&category=display')).filter(
      (e) => e.action === 'display.offline_alert',
    );
    expect(audit.map((e) => [e.objectId, e.detail])).toEqual([[display.id, { recipients: 0 }]]);
  });

  it('claims and closes a report time with microseconds, compared at millisecond precision', async () => {
    const screen = await reportingScreen('Alert micro');
    // Any writer other than the heartbeat route (SQL now(), say) can store microseconds.
    await asMigratorIn(org.orgId, (client) =>
      client.query(
        "UPDATE display_delivery SET last_heartbeat_at = last_heartbeat_at + interval '123 microseconds' WHERE display_id = $1",
        [screen.id],
      ),
    );
    await later(async () => {
      await check();
      expect(mailFor('Alert micro').map((m) => m.subject)).toEqual([
        'Screen not reporting: Alert micro',
      ]);
      await report(screen.id, screen.player);
      await check();
    });
    expect(mailFor('Alert micro').map((m) => m.subject)).toEqual([
      'Screen not reporting: Alert micro',
      'Screen reporting again: Alert micro',
    ]);
    expect(await openEpisodes(screen.id)).toBe(0);
  });

  it('records a refused send as failed and does not resend it; a stopping run claims nothing', async () => {
    const screen = await reportingScreen('Alert bounce');
    const refusing = {
      send: () => Promise.reject(Object.assign(new Error('421'), { code: 'ECONNECTION' })),
    };
    await later(async () => {
      // Shutting down: stops before the first organisation, so nothing is claimed.
      expect(await checkAlerts(t, { shouldStop: () => true })).toMatchObject({
        skipped: false,
        offline: 0,
        failed: 0,
      });
      expect(await openEpisodes(screen.id)).toBe(0);

      const refused = await checkAlerts(t, { mail: refusing });
      expect(refused.offline).toBeGreaterThanOrEqual(1);
      expect(refused.failed).toBeGreaterThanOrEqual(1);
      expect(await openEpisodes(screen.id)).toBe(1);
      // At most once: the claimed transition is not mailed again by a later run.
      await check();
    });
    expect(mailFor('Alert bounce')).toEqual([]);
    const audit = (await auditEvents(owner, '&category=display')).filter(
      (e) => e.objectId === screen.id && e.action === 'display.offline_alert',
    );
    expect(audit.map((e) => e.detail)).toEqual([{ recipients: 1 }]);
  });

  it('skips while another runner holds the lock, and two runs at once send once', async () => {
    const screen = await reportingScreen('Alert race');
    const holder = await appClient();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtextextended('tinnox.display_alerts', 0))");
      expect(await later(() => checkAlerts(t))).toMatchObject({ skipped: true, offline: 0 });
      await holder.query("SELECT pg_advisory_unlock(hashtextextended('tinnox.display_alerts', 0))");
    } finally {
      await holder.end();
    }
    expect(mailFor('Alert race')).toEqual([]);
    const results = await later(() => Promise.all([checkAlerts(t), checkAlerts(t)]));
    expect(results.map((r) => r.failed)).toEqual([0, 0]);
    expect(mailFor('Alert race')).toHaveLength(1);
    expect(await openEpisodes(screen.id)).toBe(1);
  });
});

describe('alert addresses', () => {
  let t: TestApp;
  let org: TestOrg;
  let owner: Operator;

  beforeAll(async () => {
    t = await startTestApp();
    org = await createOrg('Alert addresses');
    owner = await signIn(t, org);
  });
  afterAll(async () => {
    await t.close();
  });

  it('adds an address in lower case, sends the confirmation link, lists and removes it, never auditing the address', async () => {
    const added = await addAddress(owner, ' New.Person@Example.com ');
    expect(added.status).toBe(201);
    const dto = (await added.json()) as AlertRecipientDto;
    expect(dto).toMatchObject({ email: 'new.person@example.com', status: 'waiting' });
    const mail = t.sentMail.at(-1);
    expect(mail?.to).toBe('new.person@example.com');
    expect(mail?.subject).toBe('Confirm alert e-mails from TINNOX CMS');
    expect(mail?.text).toMatch(/http:\/\/localhost:5173\/alerts\/confirm#[A-Za-z0-9_-]{43}\n/);
    expect(mail?.text).toContain('Alert addresses asked to send screen alerts to this address.');

    const duplicate = await addAddress(owner, 'NEW.PERSON@example.com');
    expect(duplicate.status).toBe(409);
    const list = (await (await owner.fetch('/api/alert-recipients')).json()) as {
      items: AlertRecipientDto[];
    };
    expect(list.items).toEqual([dto]);

    expect(
      (await owner.fetch(`/api/alert-recipients/${dto.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
    expect(
      (await owner.fetch(`/api/alert-recipients/${dto.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
    const audit = (await auditEvents(owner, '&category=alert_recipient')).map((e) => [
      e.action,
      e.objectId,
      e.detail,
    ]);
    expect(audit).toEqual([
      ['alert_recipient.remove', dto.id, null],
      ['alert_recipient.add', dto.id, null],
    ]);
    expect(JSON.stringify(await auditEvents(owner))).not.toContain('new.person');
  });

  it('refuses an address that is not one, and unknown fields', async () => {
    expect((await addAddress(owner, 'not an address')).status).toBe(400);
    const planted = await owner.fetch('/api/alert-recipients', {
      method: 'POST',
      json: { email: 'a@example.com', orgId: org.orgId },
    });
    expect(planted.status).toBe(400);
  });

  it('keeps at most 20 addresses', async () => {
    const full = await createOrg('Full alert list');
    const fullOwner = await signIn(t, full);
    for (let i = 0; i < 20; i += 1) {
      expect((await addAddress(fullOwner, `person${i}@example.com`)).status).toBe(201);
    }
    const refused = await addAddress(fullOwner, 'one-more@example.com');
    expect(refused.status).toBe(409);
  });

  it('confirms once: used, unknown and expired links all answer the same 404', async () => {
    const id = await addConfirmed(t, owner, 'confirmed@example.com');
    const used = lastToken(t);
    const listed = (await (await owner.fetch('/api/alert-recipients')).json()) as {
      items: AlertRecipientDto[];
    };
    expect(listed.items.find((r) => r.id === id)?.status).toBe('confirmed');

    const expiredId = (
      (await (await addAddress(owner, 'late@example.com')).json()) as { id: string }
    ).id;
    const expired = lastToken(t);
    await asMigratorIn(org.orgId, (client) =>
      client.query(
        "UPDATE alert_recipient SET confirm_expires_at = now() - interval '1 second' WHERE id = $1",
        [expiredId],
      ),
    );
    const answers = [];
    for (const token of [used, expired, randomBytes(32).toString('base64url')]) {
      const response = await confirm(t, token);
      expect(response.status).toBe(404);
      answers.push(((await response.json()) as { error: { code: string; message: string } }).error);
    }
    expect(new Set(answers.map((a) => `${a.code} ${a.message}`))).toEqual(
      new Set(['not_found This link is not valid any more.']),
    );
    const after = (await (await owner.fetch('/api/alert-recipients')).json()) as {
      items: AlertRecipientDto[];
    };
    expect(after.items.find((r) => r.id === expiredId)?.status).toBe('expired');
    const audit = (await auditEvents(owner, '&category=alert_recipient')).filter(
      (e) => e.action === 'alert_recipient.confirm',
    );
    expect(audit.map((e) => [e.objectId, e.actorId])).toEqual([[id, null]]);
  });

  it('confirms only the organisation the link was made for, and hides one organisation’s addresses from another', async () => {
    const other = await createOrg('Other alert addresses');
    const otherOwner = await signIn(t, other);
    const theirs = (
      (await (await addAddress(otherOwner, 'theirs@example.com')).json()) as {
        id: string;
      }
    ).id;
    expect((await confirm(t, lastToken(t))).status).toBe(204);
    const mine = await (await owner.fetch('/api/alert-recipients')).text();
    expect(mine).not.toContain('theirs@example.com');
    expect(mine).not.toContain(theirs);
    // Another organisation's id answers like an unknown one.
    const foreign = await owner.fetch(`/api/alert-recipients/${theirs}`, { method: 'DELETE' });
    expect(foreign.status).toBe(404);
    const theirList = (await (await otherOwner.fetch('/api/alert-recipients')).json()) as {
      items: AlertRecipientDto[];
    };
    expect(theirList.items).toEqual([expect.objectContaining({ id: theirs, status: 'confirmed' })]);
  });

  it('adds nothing when e-mail is not set up, and keeps a waiting address when the confirmation e-mail fails', async () => {
    const noMail = await startTestApp({}, 1000, { mail: null });
    const failing = await startTestApp({}, 1000, {
      mail: { send: () => Promise.reject(new Error('550 mailbox unavailable')) },
    });
    try {
      const a = await signIn(noMail, await createOrg('No mail'));
      expect((await addAddress(a, 'nobody@example.com')).status).toBe(503);
      expect(await (await a.fetch('/api/alert-recipients')).json()).toEqual({ items: [] });

      const b = await signIn(failing, await createOrg('Failing mail'));
      expect((await addAddress(b, 'bounced@example.com')).status).toBe(503);
      expect(await (await b.fetch('/api/alert-recipients')).json()).toMatchObject({
        items: [{ email: 'bounced@example.com', status: 'waiting' }],
      });
    } finally {
      await noMail.close();
      await failing.close();
    }
  });
});

function addAddress(operator: Operator, email: string): Promise<Response> {
  return operator.fetch('/api/alert-recipients', { method: 'POST', json: { email } });
}

function confirm(t: TestApp, token: string): Promise<Response> {
  return fetch(`${t.url}/api/alert-recipients/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

/** The token of the newest confirmation e-mail. */
function lastToken(t: TestApp): string {
  const match = /\/alerts\/confirm#([A-Za-z0-9_-]{43})/.exec(t.sentMail.at(-1)?.text ?? '');
  if (match?.[1] === undefined) throw new Error('no confirmation e-mail');
  return match[1];
}

/** Adds an address and confirms it from its e-mail, as its owner would; returns its id. */
async function addConfirmed(t: TestApp, operator: Operator, email: string): Promise<string> {
  const added = await addAddress(operator, email);
  if (added.status !== 201) throw new Error(`adding an alert address failed: ${added.status}`);
  const confirmed = await confirm(t, lastToken(t));
  if (confirmed.status !== 204) throw new Error(`confirming failed: ${confirmed.status}`);
  return ((await added.json()) as { id: string }).id;
}
