/**
 * Stage B, slice 2 in the real portal (docs/portal-v2/stage-b.md, slice 2, sections 8 and 9):
 * an operator creates apps through the UI only, sees them drawn by the player's own renderer
 * in the editor's preview, adds one to a playlist from the Apps chip, pushes it, and cannot
 * delete it while a playlist holds it. Screens and playlists are set up through the API.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import {
  addAppToPlaylist,
  createAppInPortal,
  cspViolations,
  expectNoWebStorage,
  openScreenPage,
  pageHeading,
  pushFromHeader,
  saveApp,
  savePlaylistDraft,
  scrollsSideways,
  watchCspViolations,
} from './support/portal.ts';
import { PORTAL_URL } from './support/stack.ts';

test.describe.configure({ mode: 'serial' });

const runId = randomUUID().slice(0, 8);
const clockName = `ZZ clock ${runId}`;
const playlistName = `ZZ apps ${runId}`;

let operator: OperatorSession;
let clockId = '';
let displayId = '';
let playlistId = '';

interface StoredApp {
  name: string;
  content: { type: string; settings: Record<string, string | boolean> };
}

async function storedApp(id: string): Promise<StoredApp> {
  const response = await operator.api.get(`/api/apps/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as StoredApp;
}

test.beforeAll(async ({ browser }) => {
  operator = await operatorSession(browser, 'operator');
  await watchCspViolations(operator.page);
});
test.afterAll(async () => {
  await operator.context.close();
});

test('a Clock is created by keyboard and its preview follows 24-hour and seconds', async () => {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/apps`);
  await expect(pageHeading(page, 'Apps')).toBeVisible();

  await page.getByTestId('apps-create').focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId('apps-create-dialog');
  await expect(dialog).toBeVisible();
  const clock = dialog.getByRole('radio', { name: /^Clock\b/ });
  const name = dialog.getByLabel('Name', { exact: true });
  // Focus starts on the chosen card; the arrow keys move the choice, and the name follows it.
  await expect(clock).toBeFocused();
  await expect(clock).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio', { name: /^Date\b/ })).toBeChecked();
  await expect(name).toHaveValue('Date');
  await page.keyboard.press('ArrowLeft');
  await expect(clock).toBeChecked();
  // Enter on a card picks it and does not submit the form.
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue('Clock');
  await page.keyboard.press('Tab');
  await expect(name).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(clockName);
  await page.keyboard.press('Enter');

  await page.waitForURL(/\/apps\/[0-9a-f-]{36}$/);
  clockId = page.url().split('/').pop() ?? '';
  await expect(page.getByText('App created')).toBeVisible();
  await expect(pageHeading(page, clockName)).toBeVisible();

  const preview = page.getByTestId('app-preview');
  await expect(preview).toHaveAttribute('data-app-type', 'clock');
  await expect(preview).toHaveText(/^\d{1,2}:\d{2}\s?(am|pm)$/i);
  await expect(page.getByText(/Times in this preview use this computer’s time zone/)).toBeVisible();

  await page
    .getByRole('radiogroup', { name: 'Time format' })
    .getByRole('radio', { name: '24-hour' })
    .check();
  await page.getByRole('switch', { name: 'Show seconds' }).check();
  await expect(preview).toHaveText(/^\d{1,2}:\d{2}:\d{2}$/);
  await expect(page.getByTestId('app-editor-save-state')).toHaveText('Unsaved changes');
});

test('poor contrast is a warning only, and the app saves', async () => {
  const page = operator.page;
  await expect(page.getByTestId('app-editor-contrast')).toHaveCount(0);
  await page.getByLabel('Text colour').fill('#333333');
  await expect(page.getByTestId('app-editor-contrast')).toContainText(
    /hard to tell apart \(\d\.\d:1\)/,
  );
  await saveApp(page);
  await expect(page.getByText('App saved')).toBeVisible();
  expect((await storedApp(clockId)).content).toEqual({
    type: 'clock',
    settings: {
      hourCycle: '24',
      showSeconds: true,
      textColour: '#333333',
      backgroundColour: '#000000',
    },
  });
  await page.reload();
  await expect(page.getByTestId('app-preview')).toHaveText(/^\d{1,2}:\d{2}:\d{2}$/);
});

test('the Apps chip adds the app to a playlist, and a push brings the screen up to date', async () => {
  const page = operator.page;
  const display = await operator.api.createDisplay({
    name: `ZZ apps screen ${runId}`,
    canvas: { width: 1920, height: 1080 },
  });
  displayId = display.id;
  playlistId = (await operator.api.createPlaylist(playlistName)).id;
  const assigned = await operator.api.patch(`/api/displays/${displayId}`, {
    assignedPlaylistId: playlistId,
  });
  expect(assigned.status(), await assigned.text()).toBe(200);

  await page.goto(`${PORTAL_URL}/playlists/${playlistId}`);
  const library = page.getByTestId('playlist-editor-library');
  await expect(library.getByRole('heading', { level: 2, name: 'Add media or apps' })).toBeVisible();
  await addAppToPlaylist(page, clockName);
  await expect(library.getByRole('button', { name: 'Apps', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const item = page.getByTestId('playlist-editor-item');
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute('data-app-id', clockId);
  await expect(item.getByTestId('playlist-editor-item-fit')).toHaveCount(0);
  await expect(item.getByTestId('playlist-editor-item-duration')).toHaveValue('10');
  await savePlaylistDraft(page);

  // The editors have no push button; the list page's header does.
  await page.goto(`${PORTAL_URL}/apps`);
  expect(await pushFromHeader(page, [displayId])).toMatch(/Pushed to 1 screen/);
  await openScreenPage(page, displayId);
  const pushState = page.getByTestId('screen-detail-push-state');
  await expect(pushState).toHaveAttribute('data-state', 'up_to_date');
  // The screen's preview draws the app with the shared renderer.
  await expect(page.getByTestId('app-preview')).toHaveAttribute('data-app-type', 'clock');

  // Changing the app's settings changes what the screen would be pushed.
  await page.goto(`${PORTAL_URL}/apps/${clockId}`);
  await page.getByRole('switch', { name: 'Show seconds' }).uncheck();
  await saveApp(page);
  await openScreenPage(page, displayId);
  await expect(pushState).toHaveAttribute('data-state', 'changes');
});

test('an app in a playlist cannot be deleted; once removed from it, it can', async () => {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/apps`);
  const row = page.getByTestId(`apps-row-${clockId}`);
  await expect(row).toContainText('1 playlist');
  await page.getByRole('button', { name: `Actions for ${clockName}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete ${clockName}?` });
  await expect(dialog).toBeVisible();
  await page.getByTestId('apps-delete-dialog-confirm').click();
  await expect(dialog.getByTestId('apps-delete-playlists')).toContainText(playlistName);
  await expect(dialog.getByText('app_in_use')).toBeVisible();
  await page.getByTestId('apps-delete-dialog-cancel').click();
  await expect(dialog).toBeHidden();
  await storedApp(clockId);

  await page.goto(`${PORTAL_URL}/playlists/${playlistId}`);
  await page.getByRole('button', { name: `Remove ${clockName} from position 1` }).click();
  await savePlaylistDraft(page);

  await page.goto(`${PORTAL_URL}/apps/${clockId}`);
  await page.getByRole('button', { name: `More actions for ${clockName}` }).click();
  await page.getByRole('menuitem', { name: 'Delete app' }).click();
  await page.getByTestId('apps-delete-dialog-confirm').click();
  await page.waitForURL(/\/apps$/);
  await expect(page.getByText(`${clockName} deleted`)).toBeVisible();
  await expect(page.getByTestId(`apps-row-${clockId}`)).toHaveCount(0);
  expect((await operator.api.get(`/api/apps/${clockId}`)).status()).toBe(404);
});

test('the ticker preview scrolls, and stands still under reduced motion', async () => {
  const page = operator.page;
  await createAppInPortal(page, 'ticker', `ZZ ticker ${runId}`);
  const preview = page.getByTestId('app-preview');
  await expect(preview).toHaveAttribute('data-app-type', 'ticker');
  await expect(preview).toContainText('Welcome to TINNOX');
  const running = () =>
    preview.evaluate(
      (element) =>
        element.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length,
    );
  await expect.poll(running).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(running).toBe(0);
  await expect(preview).toContainText('Welcome to TINNOX');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('the apps pages fit a phone without sideways scrolling', async () => {
  const page = operator.page;
  const editor = page.url();
  try {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${PORTAL_URL}/apps`);
      await expect(pageHeading(page, 'Apps')).toBeVisible();
      expect(await scrollsSideways(page), `apps list at ${width}`).toBe(false);
      await page.goto(editor);
      await expect(page.getByTestId('app-preview')).toBeVisible();
      expect(await scrollsSideways(page), `app editor at ${width}`).toBe(false);
    }
  } finally {
    await page.setViewportSize({ width: 1280, height: 900 });
  }
});

test('no CSP violation and no web storage on the apps pages', async () => {
  await expectNoWebStorage(operator.page);
  expect(await cspViolations(operator.page)).toEqual([]);
});
