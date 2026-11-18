/**
 * Review findings of 2026-11-14 checked in a real browser: a player with a wrong clock can
 * pair, and the portal and player pages cannot be framed by another site. Also, from the
 * feedback on security review round 3: an operator can cancel a pairing code that was
 * accepted for a screen before any player collects its credential.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import { expectPhase, openPlayer, pairingCode, playerFetch } from './support/player.ts';
import { openScreenPage } from './support/portal.ts';
import { API_URL, PLAYER_URL, PORTAL_URL } from './support/stack.ts';

const runId = randomUUID().slice(0, 8);
const CLOCK_OFFSET_MS = 11 * 60 * 1000;
let operator: OperatorSession;

test.beforeAll(async ({ browser }) => {
  operator = await operatorSession(browser, 'operator');
});

test.afterAll(async () => {
  await operator.context.close();
});

test('a player whose clock is 11 minutes fast shows one pairing code, keeps it and pairs', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  // Every Date in the player page runs 11 minutes ahead of the server.
  await context.addInitScript({
    content: `(() => {
      const offset = ${CLOCK_OFFSET_MS};
      const Real = Date;
      class Skewed extends Real {
        constructor(...args) { if (args.length === 0) { super(Real.now() + offset); } else { super(...args); } }
        static now() { return Real.now() + offset; }
      }
      globalThis.Date = Skewed;
    })();`,
  });
  let pairingRequests = 0;
  context.on('request', (request) => {
    if (request.method() === 'POST' && request.url() === `${API_URL}/player/pairing`) {
      pairingRequests += 1;
    }
  });
  const page = await context.newPage();
  try {
    await openPlayer(page);
    const skew = (await page.evaluate(() => Date.now())) - Date.now();
    expect(skew).toBeGreaterThan(CLOCK_OFFSET_MS - 5_000);
    const code = await pairingCode(page);
    // Before the fix the player judged the server's expiry by its own clock, saw every code
    // as expired before showing it, and kept requesting new ones.
    await page.waitForTimeout(15_000);
    expect(pairingRequests).toBe(1);
    expect(await pairingCode(page)).toBe(code);

    const display = await operator.api.createDisplay({
      name: `E2E skewed clock ${runId}`,
      canvas: { width: 640, height: 360 },
    });
    expect((await operator.api.claim(display.id, code)).status()).toBe(200);
    // Registered; nothing is published to this display, so it waits in "idle".
    await expectPhase(page, 'idle', 30_000);
    expect(pairingRequests).toBe(1);
  } finally {
    await context.close();
  }
});

test('portal and player pages refuse to be framed and are not content-sniffed', async ({
  request,
}) => {
  for (const url of [`${PORTAL_URL}/`, `${PORTAL_URL}/displays`, `${PLAYER_URL}/`]) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(200);
    const headers = response.headers();
    expect(headers['content-security-policy'], url).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options'], url).toBe('DENY');
    expect(headers['x-content-type-options'], url).toBe('nosniff');
  }
});

test('an accepted pairing code can be cancelled from the screen page before a player collects it', async () => {
  const page = operator.page;
  const { id } = await operator.api.createDisplay({
    name: `E2E cancel pairing ${runId}`,
    canvas: { width: 1920, height: 1080 },
  });
  // A player that shows a code and then does not check in again.
  const created = await fetch(`${API_URL}/player/pairing`, { method: 'POST' });
  expect(created.status).toBe(201);
  const pairing = (await created.json()) as {
    pairingId: string;
    code: string;
    pollingToken: string;
  };
  const poll = async (): Promise<unknown> =>
    (await playerFetch(`/player/pairing/${pairing.pairingId}`, pairing.pollingToken)).json();

  await openScreenPage(page, id, 'pairing');
  await page.getByTestId('screen-detail-pairing-code').fill(pairing.code);
  await page.getByTestId('screen-detail-pair').click();
  await expect(page.getByText('Code accepted')).toBeVisible();

  // No player holds a credential yet, and the action is offered all the same.
  const cancel = page.getByTestId('screen-detail-revoke');
  await expect(cancel).toHaveText('Cancel pending pairing');
  await expect(cancel).toBeEnabled();
  await cancel.click();
  const dialog = page.getByRole('dialog', { name: 'Cancel the pending pairing?' });
  // It says that every uncollected code of the screen is cancelled, not only the last one.
  await expect(dialog).toContainText('This applies to the whole screen');
  await dialog.getByRole('button', { name: 'Cancel pairing' }).click();
  await expect(
    page.getByText(
      'A pairing code accepted for this screen but not yet collected by a player was cancelled.',
    ),
  ).toBeVisible();
  // The earlier banner said a player was about to collect its credential; that is over.
  // (Exact: the sentence above also contains the words "code accepted".)
  await expect(page.getByText('Code accepted', { exact: true })).toBeHidden();

  // The player that held the code is told to start again; it gets no credential.
  expect(await poll()).toEqual({ status: 'expired' });
  const stored = await operator.context.request.get(`${PORTAL_URL}/api/displays/${id}`);
  expect(((await stored.json()) as { player: unknown }).player).toBeNull();
});
