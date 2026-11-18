/**
 * Automated accessibility checks (axe, WCAG 2.2 A and AA) on every main page of the portal and
 * its key dialogs, in light and dark. Fails on serious or critical problems only. This guards
 * what the pages already do; it does not replace a pass with a real screen reader.
 * Data is set up through the API: one image, one app, one playlist, one schedule, one layout,
 * one screen.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { encodePng } from '../support/png.ts';
import { expectAccessible } from './support/a11y.ts';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import { bandLayout } from './support/operator.ts';
import { pageHeading } from './support/portal.ts';
import { PORTAL_URL } from './support/stack.ts';

test.describe.configure({ mode: 'serial' });

const runId = randomUUID().slice(0, 8);
let operator: OperatorSession;
let mediaId = '';
let appId = '';
let playlistId = '';
let scheduleId = '';
let layoutId = '';
let displayId = '';

test.beforeAll(async ({ browser }) => {
  operator = await operatorSession(browser, 'operator');
  const png = encodePng(64, 36, (x, y) => [x * 4, y * 7, 120]);
  mediaId = (await operator.api.uploadReady(`ZZ a11y ${runId}.png`, 'image/png', png)).id;
  appId = (
    await operator.api.createApp({
      name: `ZZ a11y clock ${runId}`,
      content: {
        type: 'clock',
        settings: {
          hourCycle: '12',
          showSeconds: false,
          textColour: '#ffffff',
          backgroundColour: '#000000',
        },
      },
    })
  ).id;
  playlistId = (await operator.api.createPlaylist(`ZZ a11y playlist ${runId}`)).id;
  await operator.api.savePlaylist(playlistId, `ZZ a11y playlist ${runId}`, [
    { mediaId, durationMs: 8_000, fit: null },
    { appId, durationMs: 8_000 },
  ]);
  scheduleId = (
    await operator.api.createSchedule({
      name: `ZZ a11y schedule ${runId}`,
      defaultPlaylistId: playlistId,
      events: [
        {
          playlistId,
          days: [true, true, true, true, true, false, false],
          start: '22:00',
          end: '02:00',
        },
      ],
    })
  ).id;
  layoutId = (
    await operator.api.createLayout(bandLayout(`ZZ a11y layout ${runId}`, playlistId, playlistId))
  ).id;
  displayId = (
    await operator.api.createDisplay({
      name: `ZZ a11y screen ${runId}`,
      canvas: { width: 1920, height: 1080 },
    })
  ).id;
  await operator.api.assignSchedule(displayId, scheduleId);
});
test.afterAll(async () => {
  await operator.context.close();
});

/** Opens a page and waits until it has settled (heading shown, no loading skeletons). */
async function open(path: string, heading: string | RegExp): Promise<void> {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}${path}`);
  await expect(pageHeading(page, heading)).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

const PAGES: readonly (readonly [string, () => string, string | RegExp])[] = [
  ['dashboard', () => '/dashboard', 'Dashboard'],
  ['media library', () => '/media', /Media|All media/],
  ['media detail', () => `/media/${mediaId}`, `ZZ a11y ${runId}.png`],
  ['apps', () => '/apps', 'Apps'],
  ['app editor', () => `/apps/${appId}`, `ZZ a11y clock ${runId}`],
  ['playlists', () => '/playlists', 'Playlists'],
  ['playlist editor', () => `/playlists/${playlistId}`, `ZZ a11y playlist ${runId}`],
  ['schedules', () => '/schedules', 'Schedules'],
  ['schedule editor', () => `/schedules/${scheduleId}`, `ZZ a11y schedule ${runId}`],
  ['layouts', () => '/layouts', 'Layouts'],
  ['layout editor', () => `/layouts/${layoutId}`, `ZZ a11y layout ${runId}`],
  ['screens', () => '/screens', 'Screens'],
  ['screen page', () => `/screens/${displayId}`, `ZZ a11y screen ${runId}`],
  ['add screen', () => '/screens/new', /screen/i],
  ['settings', () => '/settings', 'Settings'],
  ['tags', () => '/settings/tags', /Tags/],
  ['audit', () => '/audit', /Activity|Audit/],
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} mode`, () => {
    test.beforeEach(async () => {
      await operator.page.emulateMedia({ colorScheme: scheme });
    });

    for (const [name, path, heading] of PAGES) {
      test(`${name} has no serious accessibility problem`, async () => {
        await open(path(), heading);
        await expectAccessible(operator.page, `${name} (${scheme})`);
      });
    }

    test('the schedule editor with errors, the create dialog and the push dialog', async () => {
      const page = operator.page;
      await open(`/schedules/${scheduleId}`, `ZZ a11y schedule ${runId}`);
      await page.getByTestId('schedule-add-event').click();
      await page.getByTestId('schedule-save').click();
      await expect(page.getByTestId('schedule-error-summary')).toBeVisible();
      await expectAccessible(page, `schedule editor with errors (${scheme})`);

      await open('/schedules', 'Schedules');
      await page.getByTestId('schedules-create').first().click();
      await expect(page.getByTestId('schedule-create-dialog')).toBeVisible();
      await expectAccessible(page, `create schedule dialog (${scheme})`);
      await page.keyboard.press('Escape');

      await page.getByTestId('push-button').click();
      const push = page.getByTestId('push-dialog-body');
      await expect(push).toBeVisible();
      await expect(push.getByTestId('push-loading')).toHaveCount(0);
      await expectAccessible(page, `push dialog (${scheme})`);
      await page.keyboard.press('Escape');
    });

    test('the screen page tabs and its Change menu', async () => {
      const page = operator.page;
      await open(`/screens/${displayId}`, `ZZ a11y screen ${runId}`);
      for (const tab of ['Canvas', 'Pairing', 'Working hours']) {
        await page.getByRole('tab', { name: tab }).click();
        await expectAccessible(page, `screen page, ${tab} tab (${scheme})`);
      }
      await page.getByTestId('screen-detail-change-content').click();
      await expect(page.getByRole('menuitem', { name: 'Remove content' })).toBeVisible();
      await expectAccessible(page, `screen page Change menu (${scheme})`);
      await page.keyboard.press('Escape');
    });
  });
}
