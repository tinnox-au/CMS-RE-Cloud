/**
 * The e-mail alert check (CMS-15, docs/portal-v2/stage-c-alerts.md sections 1, 4 and 5). Run about
 * every minute by main.ts, once by alerts-once.ts (a cloud scheduler), and directly by tests.
 *
 * Safe with several runners: a session advisory lock makes a second run skip, and each transition
 * is claimed with a conditional statement on display_alert, so it is recorded and mailed once.
 * The claim and its audit row commit together; e-mail goes out after the commit, so delivery is
 * at most once per transition.
 */
import { alertDelayText, type WorkingHours } from '@tinnox/contracts';
import { auditScoped, displayAlertOrgs, poolAsTx, withOrg, type Pool, type Tx } from '@tinnox/db';
import { offlineDue } from '@tinnox/domain';
import type { MailMessage, Mailer } from './mail.ts';

const LOCK_KEY = 'tinnox.display_alerts';

export interface DisplayAlertDeps {
  readonly pool: Pool;
  readonly now: Date;
  readonly mail: Mailer;
  readonly portalOrigin: string;
  readonly logger: { error(obj: object, msg: string): void };
  /**
   * Checked before each organisation is claimed: true stops the run there (shutdown), so no new
   * transition is claimed that the process may not live to mail. Claimed ones are still mailed.
   */
  readonly shouldStop?: () => boolean;
}

export interface DisplayAlertResult {
  /** Another runner held the lock; nothing was done. */
  readonly skipped: boolean;
  readonly offline: number;
  readonly online: number;
  /** Episodes closed without an e-mail: unpaired, re-paired, alerts or back-online e-mail off. */
  readonly closed: number;
  /** E-mails the server refused, and organisations whose check failed. */
  readonly failed: number;
}

interface CandidateRow {
  id: string;
  name: string;
  site_name: string;
  timezone: string;
  working_hours: WorkingHours | null;
  alert_offline_minutes: number | null;
  alert_back_online: boolean;
  /** The latest report of the active registration; null when unpaired or re-paired since. */
  last_report_at: Date | null;
  offline_since: Date | null;
}

interface OrgOutcome {
  readonly offline: number;
  readonly online: number;
  readonly closed: number;
  readonly outbox: readonly { readonly displayId: string; readonly message: MailMessage }[];
}

/** Runs the check once over every organisation. */
export async function runDisplayAlerts(deps: DisplayAlertDeps): Promise<DisplayAlertResult> {
  const counts = { offline: 0, online: 0, closed: 0, failed: 0 };
  // A dedicated connection with no transaction open: the pool's transaction timeouts do not
  // apply while the run holds the lock, and a dropped connection releases it.
  const client = await deps.pool.connect();
  let broken: Error | undefined;
  const onLost = (error: Error): void => {
    broken = error;
  };
  client.on('error', onLost);
  try {
    const locked = await client.query<{ ok: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok',
      [LOCK_KEY],
    );
    if (locked.rows[0]?.ok !== true) return { skipped: true, ...counts };
    try {
      for (const orgId of await displayAlertOrgs(poolAsTx(deps.pool))) {
        if (deps.shouldStop?.() === true) break;
        let outcome: OrgOutcome;
        try {
          outcome = await withOrg(deps.pool, orgId, (tx) => claimTransitions(tx, deps));
        } catch (error) {
          counts.failed += 1;
          deps.logger.error(
            { err: error, orgId },
            'display alert check failed for an organisation',
          );
          continue;
        }
        counts.offline += outcome.offline;
        counts.online += outcome.online;
        counts.closed += outcome.closed;
        // shortcut: one e-mail at a time and no retry; queue and retry when a provider's limits or outages bite.
        for (const { displayId, message } of outcome.outbox) {
          try {
            await deps.mail.send(message);
          } catch (error) {
            counts.failed += 1;
            // Never the address or the server's reply, which may quote it.
            deps.logger.error(
              { orgId, displayId, ...mailErrorCode(error) },
              'display alert e-mail was not sent',
            );
          }
        }
      }
    } finally {
      // Destroying the connection releases the lock. An unlock that answers false (the lock was
      // taken on another backend, as behind a transaction-mode pooler) is treated the same way.
      await client
        .query<{ ok: boolean }>('SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS ok', [
          LOCK_KEY,
        ])
        .then(
          (unlocked) => {
            if (unlocked.rows[0]?.ok !== true) broken = new Error('advisory lock was not held');
          },
          (error: unknown) => {
            broken = error instanceof Error ? error : new Error('advisory unlock failed');
          },
        );
    }
    return { skipped: false, ...counts };
  } finally {
    client.removeListener('error', onLost);
    client.release(broken);
  }
}

/**
 * The SMTP failure code for a log line, never the address or the server's reply, which may quote
 * it. Logged as `errorCode`: `code` is a redacted log field (logger.ts).
 */
export function mailErrorCode(error: unknown): { errorCode: string | null } {
  const code = (error as { code?: unknown } | null)?.code;
  return { errorCode: typeof code === 'string' ? code.slice(0, 64) : null };
}

/** Decides and claims the transitions of the organisation of `tx`; returns the e-mails to send. */
async function claimTransitions(tx: Tx, deps: DisplayAlertDeps): Promise<OrgOutcome> {
  const org = await tx.query<{ name: string }>(
    'SELECT name FROM organization WHERE id = app_org_id()',
  );
  const orgName = org.rows[0]?.name ?? '';
  // shortcut: at most MAX_ALERT_RECIPIENTS (20) rows, so no LIMIT.
  const recipients = await tx.query<{ email: string }>(
    `SELECT email FROM alert_recipient
     WHERE org_id = app_org_id() AND confirmed_at IS NOT NULL ORDER BY email`,
  );
  const to = recipients.rows.map((r) => r.email);
  // The report counts only when it came from the active registration, as the status view says.
  // Report times are read, compared and stored at millisecond precision, the precision of a
  // JavaScript Date, so the exact comparisons in the claims hold whoever wrote the time.
  // shortcut: every display of the organisation in one query; page it at thousands of screens.
  const { rows } = await tx.query<CandidateRow>(
    `SELECT d.id, d.name, s.name AS site_name, s.timezone, d.working_hours,
            d.alert_offline_minutes, d.alert_back_online,
            date_trunc('milliseconds', dd.last_heartbeat_at) AS last_report_at, da.offline_since
     FROM display d
     JOIN site s ON s.id = d.site_id AND s.org_id = d.org_id
     LEFT JOIN player_registration pr
       ON pr.display_id = d.id AND pr.org_id = d.org_id AND pr.revoked_at IS NULL
     LEFT JOIN display_delivery dd
       ON dd.display_id = d.id AND dd.org_id = d.org_id AND dd.reporting_registration_id = pr.id
     LEFT JOIN display_alert da ON da.display_id = d.id AND da.org_id = d.org_id
     WHERE d.org_id = app_org_id()
       AND (da.display_id IS NOT NULL
            OR (d.alert_offline_minutes IS NOT NULL AND dd.last_heartbeat_at IS NOT NULL))
     ORDER BY d.id`,
  );

  let offline = 0;
  let online = 0;
  let closed = 0;
  const outbox: { displayId: string; message: MailMessage }[] = [];
  const audit = (action: string, displayId: string) =>
    auditScoped(tx, {
      actorType: 'system',
      actorId: null,
      action,
      objectType: 'display',
      objectId: displayId,
      result: 'success',
      detail: { recipients: to.length },
    });
  const mailAll = (displayId: string, message: Omit<MailMessage, 'to'>) => {
    for (const address of to) outbox.push({ displayId, message: { ...message, to: address } });
  };

  for (const row of rows) {
    const screen = { ...row, orgName, portalOrigin: deps.portalOrigin };
    const minutes = row.alert_offline_minutes;
    const last = row.last_report_at;
    if (row.offline_since === null) {
      if (minutes === null || last === null) continue;
      if (!offlineDue(last, deps.now, minutes, row.working_hours, row.timezone)) continue;
      // Claimed only while the stale report is still the latest: a report that arrived since
      // the read above cancels the alert.
      const opened = await tx.query(
        `INSERT INTO display_alert (display_id, org_id, offline_since)
         SELECT dd.display_id, dd.org_id, date_trunc('milliseconds', dd.last_heartbeat_at)
         FROM display_delivery dd
         WHERE dd.display_id = $1 AND dd.org_id = app_org_id()
           AND date_trunc('milliseconds', dd.last_heartbeat_at) = $2
         ON CONFLICT (display_id) DO NOTHING
         RETURNING display_id`,
        [row.id, last],
      );
      if (opened.rowCount !== 1) continue;
      await audit('display.offline_alert', row.id);
      offline += 1;
      mailAll(row.id, offlineEmail(screen, last, minutes));
      continue;
    }
    const eligible = minutes !== null && last !== null;
    const back = eligible && last.getTime() > row.offline_since.getTime();
    if (eligible && !back) continue;
    const deleted = await tx.query(
      `DELETE FROM display_alert
       WHERE display_id = $1 AND org_id = app_org_id() AND offline_since = $2
       RETURNING display_id`,
      [row.id, row.offline_since],
    );
    if (deleted.rowCount !== 1) continue;
    if (back && row.alert_back_online) {
      await audit('display.online_alert', row.id);
      online += 1;
      mailAll(row.id, onlineEmail(screen, last));
    } else {
      closed += 1;
    }
  }
  return { offline, online, closed, outbox };
}

// ---------------------------------------------------------------------- e-mail texts

interface ScreenFacts {
  readonly id: string;
  readonly name: string;
  readonly site_name: string;
  readonly timezone: string;
  readonly orgName: string;
  readonly portalOrigin: string;
}

/** A time in the site's zone, for example "21 Nov 2026, 3:04 pm (Australia/Melbourne)". */
export function siteTime(at: Date, timeZone: string): string {
  try {
    const text = new Intl.DateTimeFormat('en-AU', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(at);
    return `${text} (${timeZone})`;
  } catch {
    // A zone this runtime does not know.
    return at.toISOString();
  }
}

const footer = (orgName: string): string =>
  `You receive this because this address is on the alert list of ${orgName} in TINNOX CMS. ` +
  'To stop, ask an Admin of that organisation to remove it.';

const screenLink = (s: ScreenFacts): string =>
  `${s.portalOrigin}/screens/${encodeURIComponent(s.id)}`;

// Wording says "not reporting", never "offline" or "online" (DEC-33).
export function offlineEmail(
  s: ScreenFacts,
  lastReportAt: Date,
  minutes: number,
): Omit<MailMessage, 'to'> {
  return {
    subject: `Screen not reporting: ${s.name}`,
    text: [
      `Screen: ${s.name}`,
      `Site: ${s.site_name}`,
      `Organisation: ${s.orgName}`,
      `Last report: ${siteTime(lastReportAt, s.timezone)}`,
      '',
      `This alert was sent because the screen has not reported for ${alertDelayText(minutes)}.`,
      '',
      `Open the screen: ${screenLink(s)}`,
      '',
      footer(s.orgName),
      '',
    ].join('\n'),
  };
}

export function onlineEmail(s: ScreenFacts, reportedAt: Date): Omit<MailMessage, 'to'> {
  return {
    subject: `Screen reporting again: ${s.name}`,
    text: [
      `Screen: ${s.name}`,
      `Site: ${s.site_name}`,
      `Reported again: ${siteTime(reportedAt, s.timezone)}`,
      '',
      `Open the screen: ${screenLink(s)}`,
      '',
      footer(s.orgName),
      '',
    ].join('\n'),
  };
}

/** Who added the address is not named. The token travels in the fragment, never to a server log. */
export function confirmationEmail(
  orgName: string,
  portalOrigin: string,
  token: string,
  days: number,
): Omit<MailMessage, 'to'> {
  return {
    subject: 'Confirm alert e-mails from TINNOX CMS',
    text: [
      `${orgName} asked to send screen alerts to this address. To agree, open this link within ${days} days:`,
      '',
      `${portalOrigin}/alerts/confirm#${token}`,
      '',
      'If you did not expect this, ignore this e-mail and nothing more will be sent.',
      '',
    ].join('\n'),
  };
}
