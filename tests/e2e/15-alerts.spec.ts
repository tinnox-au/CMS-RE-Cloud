/**
 * E-mail alerts for screens (CMS-15, docs/portal-v2/stage-c-alerts.md section 7; acceptance test
 * MON-07), with the seeded Owner, the API's own alert loop (every 60 s) and the local Mailpit as
 * the SMTP server. The Owner adds an address on Settings → Alerts; the confirmation e-mail is read
 * from Mailpit's HTTP API and its link opened in a browser with no session. The screen's delay is
 * set on its Alerts tab and its player is cut off from the network. No setting shortens the
 * 30-minute minimum: the test moves the stored report time back instead (a test-only update as
 * the runtime role), then expects the offline e-mail and, once the player reports again, the
 * reporting-again e-mail.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import { e2eUrls } from './support/database.ts';
import { expectPhase, openPlayer, pairingCode } from './support/player.ts';
import { notifications, openScreenPage, pageHeading } from './support/portal.ts';
import { PORTAL_URL } from './support/stack.ts';

test.describe.configure({ mode: 'serial' });

const runId = randomUUID().slice(0, 8);
// Mailpit is shared by every run on this machine: mail is found by this run's address.
const ADDRESS = `zz-alerts-${runId}@example.com`;
const SCREEN = `ZZ alerts player ${runId}`;
const MAILPIT_API = 'http://127.0.0.1:8025/api/v1';

let operator: OperatorSession;
let playerContext: BrowserContext;
let player: Page;
let displayId: string;
let orgId: string;

/** The plain-text bodies of the e-mails to this run's address with `subject`, oldest first. */
async function mailTo(subject: string): Promise<string[]> {
  const search = await fetch(
    `${MAILPIT_API}/search?query=${encodeURIComponent(`to:${ADDRESS}`)}&limit=50`,
  );
  expect(search.status).toBe(200);
  const { messages } = (await search.json()) as { messages: { ID: string; Subject: string }[] };
  const texts: string[] = [];
  for (const message of messages.filter((m) => m.Subject === subject).reverse()) {
    const full = await fetch(`${MAILPIT_API}/message/${message.ID}`);
    texts.push(((await full.json()) as { Text: string }).Text);
  }
  return texts;
}

/** Waits for the first e-mail with `subject`; the alert loop runs once a minute. */
async function waitForMail(subject: string, timeoutMs = 150_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [text] = await mailTo(subject);
    if (text !== undefined) return text;
    if (Date.now() > deadline) throw new Error(`no e-mail "${subject}" reached ${ADDRESS}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/** Test only: moves the screen's last report `minutes` back, as if it had been silent that long. */
async function backdateLastReport(minutes: number): Promise<void> {
  const client = new pg.Client({ connectionString: e2eUrls().app });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    // A JS Date, as the heartbeat route writes it: the check claims by exact report time.
    const updated = await client.query(
      'UPDATE display_delivery SET last_heartbeat_at = $2 WHERE display_id = $1',
      [displayId, new Date(Date.now() - minutes * 60_000)],
    );
    expect(updated.rowCount).toBe(1);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

test.beforeAll(async ({ browser }) => {
  operator = await operatorSession(browser, 'operator');
  const session = await operator.api.session();
  if (session.organization === undefined) throw new Error('the Owner has no organisation');
  orgId = session.organization.id;
  playerContext = await browser.newContext();
  player = await playerContext.newPage();
  displayId = (
    await operator.api.createDisplay({ name: SCREEN, canvas: { width: 1920, height: 1080 } })
  ).id;
  await openPlayer(player);
  expect((await operator.api.claim(displayId, await pairingCode(player))).status()).toBe(200);
  await expectPhase(player, 'idle');
});

test.afterAll(async () => {
  await playerContext.close();
  await operator.context.close();
});

test('the Owner adds an alert address and its owner confirms it from the e-mail link', async ({
  browser,
}) => {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/settings`);
  await page.getByTestId('settings-row-alerts').click();
  await expect(pageHeading(page, 'Alerts')).toBeVisible();

  await page.getByTestId('settings-alerts-add').click();
  const dialog = page.getByTestId('settings-alerts-add-dialog');
  await dialog.getByTestId('settings-alerts-add-email').fill(ADDRESS);
  await dialog.getByTestId('settings-alerts-add-submit').click();
  await expect(dialog).toBeHidden();
  const row = page
    .locator('[data-row][data-testid^="settings-alerts-row-"]')
    .filter({ hasText: ADDRESS });
  await expect(row).toContainText('Waiting for confirmation');

  const text = await waitForMail('Confirm alert e-mails from TINNOX CMS', 30_000);
  const link = /(\S+\/alerts\/confirm#\S+)/.exec(text)?.[1];
  expect(link?.startsWith(`${PORTAL_URL}/alerts/confirm#`)).toBe(true);

  // The address's owner has no session in the portal.
  const owner = await browser.newContext();
  try {
    const ownerPage = await owner.newPage();
    await ownerPage.goto(link ?? '');
    await expect(ownerPage.getByText('Alerts confirmed')).toBeVisible();
    // The token leaves the address bar (and history) once read.
    expect(ownerPage.url()).toBe(`${PORTAL_URL}/alerts/confirm`);
  } finally {
    await owner.close();
  }

  await page.reload();
  await expect(row).toContainText('Confirmed');
});

test('the screen’s alert delay is set on its Alerts tab', async () => {
  const page = operator.page;
  await openScreenPage(page, displayId, 'alerts');
  const delay = page.getByTestId('screen-detail-alert-delay');
  // Every screen starts at the default: 30 minutes, back-online e-mail on.
  await expect(delay).toHaveValue('30');
  await delay.selectOption('60');
  await expect(
    page.getByRole('checkbox', { name: 'Also e-mail when it reports again' }),
  ).toBeChecked();
  await page.getByTestId('screen-detail-alerts-save').click();
  await expect(notifications(page).getByText('Alerts saved')).toBeVisible();

  const stored = (await (await operator.api.get(`/api/displays/${displayId}`)).json()) as {
    alertOfflineMinutes: number | null;
    alertBackOnline: boolean;
  };
  expect(stored).toMatchObject({ alertOfflineMinutes: 60, alertBackOnline: true });
});

test('a screen that stops reporting e-mails the address once, and again when it reports', async () => {
  test.setTimeout(420_000);
  await playerContext.setOffline(true);
  // Let a report already on its way land before the stored time is moved back.
  await player.waitForTimeout(3000);
  await backdateLastReport(61);

  const offline = await waitForMail(`Screen not reporting: ${SCREEN}`);
  expect(offline).toContain(`Screen: ${SCREEN}`);
  expect(offline).toContain('This alert was sent because the screen has not reported for 1 hour.');
  expect(offline).toContain(`${PORTAL_URL}/screens/${displayId}`);
  expect(offline).toContain('To stop, ask an Admin of that organisation to remove it.');

  await playerContext.setOffline(false);
  await operator.api.waitForStatus(displayId, 'a fresh report', (view) => !view.stale);
  const back = await waitForMail(`Screen reporting again: ${SCREEN}`);
  expect(back).toContain(`Screen: ${SCREEN}`);
  expect(back).toContain(`${PORTAL_URL}/screens/${displayId}`);

  // One e-mail per transition, although the loop ran several times while the screen was silent.
  expect(await mailTo(`Screen not reporting: ${SCREEN}`)).toHaveLength(1);
});
