/**
 * Stage B, slice 4 in the real portal (docs/portal-v2/stage-b.md, slice 4, sections 7 and 8):
 * an operator creates a layout through the UI only, by keyboard, sets its band height and sees
 * the zones' pixel sizes on several screen shapes, assigns it on a screen's page, pushes it, and
 * is told why a layout in use and a playlist a layout uses cannot be deleted. Playlists, the
 * Ticker app and the screens are set up through the API. What a player does with the layout is
 * the journey of 13.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import {
  assignLayoutOnScreenPage,
  cspViolations,
  expectNoWebStorage,
  notifications,
  openScreenPage,
  pageHeading,
  pushFromHeader,
  pushRow,
  saveLayout,
  scrollsSideways,
  watchCspViolations,
} from './support/portal.ts';
import { PORTAL_URL } from './support/stack.ts';

test.describe.configure({ mode: 'serial' });

const runId = randomUUID().slice(0, 8);
const layoutName = `ZZ layout ${runId}`;
const mainName = `ZZ layout main ${runId}`;
const bandName = `ZZ layout band ${runId}`;
const screenName = `ZZ layout screen ${runId}`;
const smallName = `ZZ layout small ${runId}`;

let operator: OperatorSession;
let layoutId = '';
let mainId = '';
let bandId = '';
let displayId = '';

interface StoredLayout {
  name: string;
  zones: { playlist: { id: string }; x: number; y: number; width: number; height: number }[];
}

async function storedLayout(id: string): Promise<StoredLayout> {
  const response = await operator.api.get(`/api/layouts/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as StoredLayout;
}

/** The preset's two zones as the API stores them: the main zone over a band of `percent`. */
function presetZones(percent: number): StoredLayout['zones'] {
  const band = percent * 100;
  return [
    { playlist: { id: mainId }, x: 0, y: 0, width: 10_000, height: 10_000 - band },
    { playlist: { id: bandId }, x: 0, y: 10_000 - band, width: 10_000, height: band },
  ];
}

async function assignedContent(): Promise<{
  assignedPlaylist: { id: string } | null;
  assignedSchedule: { id: string } | null;
  assignedLayout: { id: string; mainPlaylist: { id: string } } | null;
}> {
  const response = await operator.api.get(`/api/displays/${displayId}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as Awaited<ReturnType<typeof assignedContent>>;
}

test.beforeAll(async ({ browser }) => {
  operator = await operatorSession(browser, 'operator');
  await watchCspViolations(operator.page);
  // Two playlists that can be pushed: a clock for the main zone, a ticker for the band.
  const clock = await operator.api.createApp({
    name: `ZZ layout clock ${runId}`,
    content: {
      type: 'clock',
      settings: {
        hourCycle: '24',
        showSeconds: false,
        textColour: '#ffffff',
        backgroundColour: '#000000',
      },
    },
  });
  const ticker = await operator.api.createApp({
    name: `ZZ layout ticker ${runId}`,
    content: {
      type: 'ticker',
      settings: {
        text: 'Welcome to TINNOX. Opening hours today: 9 am to 5 pm.',
        speed: 'medium',
        textColour: '#ffffff',
        backgroundColour: '#000000',
      },
    },
  });
  mainId = (await operator.api.createPlaylist(mainName)).id;
  bandId = (await operator.api.createPlaylist(bandName)).id;
  await operator.api.savePlaylist(mainId, mainName, [{ appId: clock.id, durationMs: 10_000 }]);
  await operator.api.savePlaylist(bandId, bandName, [{ appId: ticker.id, durationMs: 10_000 }]);
  displayId = (
    await operator.api.createDisplay({ name: screenName, canvas: { width: 1920, height: 1080 } })
  ).id;
  // A small LED screen, for the zone size warning; nothing is assigned to it.
  await operator.api.createDisplay({ name: smallName, canvas: { width: 192, height: 96 } });
});
test.afterAll(async () => {
  await operator.context.close();
});

test('a layout is created through the dialog by keyboard', async () => {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/layouts`);
  await expect(pageHeading(page, 'Layouts')).toBeVisible();
  // Layouts is a built section now: the sidebar entry carries no "Planned" pill.
  await expect(page.getByRole('link', { name: 'Layouts', exact: true }).first()).toBeVisible();

  // The list layout shows while loading; an empty list then swaps in its own empty state, with
  // a new create button. Focus is put on the button of the layout that stays.
  await expect(
    page
      .getByTestId('layouts-empty')
      .or(page.getByTestId('layouts-count').filter({ hasNotText: 'Loading layouts' })),
  ).toBeAttached();
  await page.getByTestId('layouts-create').focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId('layout-create-dialog');
  await expect(dialog).toBeVisible();
  const name = dialog.getByLabel('Name', { exact: true });
  const main = dialog.getByLabel('Main zone playlist');
  const band = dialog.getByLabel('Band playlist');
  // The form arrives once the playlists are read; focus then goes to the name.
  await expect(name).toBeFocused();

  // Enter with nothing filled in: every field says what it needs, and the first takes focus.
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('Enter a name.')).toBeVisible();
  await expect(dialog.getByText('Choose a playlist for the main zone.')).toBeVisible();
  await expect(dialog.getByText('Choose a playlist for the band.')).toBeVisible();
  await expect(name).toBeFocused();

  await page.keyboard.type(layoutName);
  await page.keyboard.press('Tab');
  await expect(main).toBeFocused();
  // A native select is the platform's own control and its keys differ by platform, so the
  // choice is set directly; everything around it is done with the keyboard.
  await main.selectOption({ label: mainName });
  await page.keyboard.press('Tab');
  await expect(band).toBeFocused();
  await band.selectOption({ label: bandName });
  await expect(band).toHaveValue(bandId);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(name).toBeFocused();
  await page.keyboard.press('Enter');

  await page.waitForURL(/\/layouts\/[0-9a-f-]{36}$/);
  layoutId = page.url().split('/').pop() ?? '';
  await expect(notifications(page).getByText('Layout created')).toBeVisible();
  await expect(pageHeading(page, layoutName)).toBeVisible();
  await expect(page.getByLabel('Band height (%)')).toHaveValue('15');
  await expect(page.getByTestId('layout-zone-0-playlist')).toHaveValue(mainId);
  await expect(page.getByTestId('layout-zone-1-playlist')).toHaveValue(bandId);
  await expect(page.getByTestId('layout-save-state')).toHaveText('Saved');
  expect(await storedLayout(layoutId)).toMatchObject({ name: layoutName, zones: presetZones(15) });
});

test('a zone without a playlist is refused, and the summary leads to its select', async () => {
  const page = operator.page;
  // Every control of a zone is named by its group.
  await expect(page.getByRole('group', { name: 'Main zone' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Band' })).toBeVisible();
  const bandSelect = page.getByTestId('layout-zone-1-playlist');
  await bandSelect.selectOption({ label: 'Choose a playlist' });
  await expect(page.getByTestId('layout-zone-1-open')).toHaveCount(0);
  await expect(page.getByTestId('layout-save-state')).toHaveText('Unsaved changes');

  await page.getByTestId('layout-save').click();
  const summary = page.getByTestId('layout-error-summary');
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('Band: Choose a playlist.');
  await summary.getByRole('link', { name: 'Band: Choose a playlist.' }).click();
  await expect(bandSelect).toBeFocused();
  await expect(bandSelect).toHaveAttribute('aria-invalid', 'true');

  await bandSelect.selectOption({ label: bandName });
  await expect(page.getByTestId('layout-zone-1-open')).toHaveAttribute(
    'href',
    `/playlists/${bandId}`,
  );
  await expect(summary).toHaveCount(0);
  await expect(page.getByTestId('layout-save-state')).toHaveText('Saved');
  // Nothing was sent.
  expect(await storedLayout(layoutId)).toMatchObject({ zones: presetZones(15) });
});

test('the band height is raised by keyboard, and the preview gives the pixel sizes', async () => {
  const page = operator.page;
  const height = page.getByLabel('Band height (%)');
  await height.focus();
  for (let step = 0; step < 5; step += 1) await page.keyboard.press('ArrowUp');
  await expect(height).toHaveValue('20');

  const shape = page.getByTestId('layout-preview-shape');
  const frame = page.getByTestId('layout-preview');
  await expect(shape).toHaveValue('landscape');
  await expect(frame).toHaveAttribute(
    'aria-label',
    /On 1920 × 1080: main zone 1920 × 864 px, band 1920 × 216 px\./,
  );
  await expect(page.getByTestId('layout-preview-zone-0')).toContainText(`Main zone: ${mainName}`);
  await expect(page.getByTestId('layout-preview-zone-1')).toContainText(`Band: ${bandName}`);
  await shape.selectOption({ label: 'Portrait 1080 × 1920' });
  await expect(frame).toHaveAttribute(
    'aria-label',
    /On 1080 × 1920: main zone 1080 × 1536 px, band 1080 × 384 px\./,
  );

  await saveLayout(page);
  await expect(notifications(page).getByText('Layout saved')).toBeVisible();
  expect(await storedLayout(layoutId)).toMatchObject({ zones: presetZones(20) });

  // The list shows it with its main zone's playlist and its band height.
  await page.goto(`${PORTAL_URL}/layouts`);
  const row = page.getByTestId(`layouts-row-${layoutId}`);
  await expect(row).toContainText(mainName);
  await expect(row).toContainText('20%');
  await expect(row).toContainText('Not assigned');
});

test('a band too thin for a small screen is named in a warning', async () => {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/layouts/${layoutId}`);
  await page.getByTestId('layout-preview-shape').selectOption({ label: `${smallName} · 192 × 96` });
  const height = page.getByLabel('Band height (%)');
  await height.fill('5');
  const warning = page.getByTestId('layout-preview-warning');
  await expect(warning).toContainText(`On ${smallName} · 192 × 96, the band is 192 × 5 px.`);
  await expect(warning).toContainText('A zone needs at least 16 px each way');

  // Back to the saved height: the warning goes and nothing is left to save.
  await height.fill('20');
  await expect(warning).toHaveCount(0);
  await expect(page.getByTestId('layout-save-state')).toHaveText('Saved');
});

test('the layout is assigned on the screen page, and a push brings the screen up to date', async () => {
  const page = operator.page;
  // Nothing is assigned yet, so the screen page offers "Assign layout".
  await assignLayoutOnScreenPage(page, displayId, layoutName);
  await expect(page.getByTestId('screen-detail-open-layout')).toHaveAttribute(
    'href',
    `/layouts/${layoutId}`,
  );
  await expect(page.getByTestId('screen-detail-main-playlist')).toHaveText(
    `Main zone: ${mainName}`,
  );
  expect(await assignedContent()).toMatchObject({
    assignedPlaylist: null,
    assignedSchedule: null,
    assignedLayout: { id: layoutId, mainPlaylist: { id: mainId } },
  });

  // The screen page has its own push control; the header button is on the list pages.
  await page.goto(`${PORTAL_URL}/layouts`);
  const before = await pushRow(page, displayId);
  await expect(before).toContainText(`Layout: ${layoutName}`);
  await page.getByTestId('push-cancel').click();
  await expect(page.getByTestId('push-dialog-body')).toBeHidden();

  expect(await pushFromHeader(page, [displayId])).toMatch(/Pushed to 1 screen/);
  const after = await pushRow(page, displayId);
  await expect(after).toHaveAttribute('data-state', 'up_to_date');
  await expect(after.getByTestId('push-row-state')).toContainText('Up to date');
  await page.getByTestId('push-cancel').click();
  await expect(page.getByTestId('push-dialog-body')).toBeHidden();
});

test('a layout on a screen, and a playlist in a layout, cannot be deleted', async () => {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/layouts`);
  await expect(page.getByTestId(`layouts-row-${layoutId}`)).toContainText('1 screen');
  await page.getByRole('button', { name: `Actions for ${layoutName}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete ${layoutName}?` });
  await expect(dialog).toBeVisible();
  await page.getByTestId('layouts-delete-dialog-confirm').click();
  await expect(dialog.getByTestId('layouts-delete-screens')).toContainText(screenName);
  await expect(dialog.getByText('layout_in_use')).toBeVisible();
  await page.getByTestId('layouts-delete-dialog-cancel').click();
  await expect(dialog).toBeHidden();
  await storedLayout(layoutId);

  // The band's playlist: the refusal names the layout and is not offered again.
  await page.goto(`${PORTAL_URL}/playlists`);
  await page.getByTestId('playlists-search').fill(bandName);
  await page.getByRole('button', { name: `Actions for ${bandName}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByTestId('playlists-delete-confirm').click();
  const failures = page.getByTestId('playlists-delete-failures');
  await expect(failures).toContainText(`Used by the layout ${layoutName}.`);
  await expect(failures).toContainText('playlist_in_use');
  await expect(failures).toContainText(
    'Choose another playlist in that layout, then delete the playlist.',
  );
  await expect(page.getByRole('link', { name: 'Go to Layouts' })).toHaveAttribute(
    'href',
    '/layouts',
  );
  await expect(page.getByTestId('playlists-delete-retry')).toHaveCount(0);
  await page.getByTestId('playlists-delete-cancel').click();
  expect((await operator.api.get(`/api/playlists/${bandId}`)).status()).toBe(200);
});

test('assigning a playlist to the screen replaces its layout, and the dialog says so', async () => {
  const page = operator.page;
  await openScreenPage(page, displayId);
  await page.getByTestId('screen-detail-change-content').click();
  await page.getByRole('menuitem', { name: 'Choose a playlist…' }).click();
  const picker = page.getByTestId('screen-detail-playlist-picker');
  await expect(picker).toBeVisible();
  await expect(picker).toContainText(
    'A screen that has a schedule or a layout gets this playlist instead.',
  );
  await picker.getByTestId('screen-detail-playlist-picker-search').fill(mainName);
  await picker.getByRole('radio', { name: mainName }).check();
  await picker.getByTestId('screen-detail-playlist-picker-confirm').click();
  await expect(picker).toBeHidden();
  await expect(notifications(page).getByText(`${mainName} assigned`)).toBeVisible();
  await expect(page.getByTestId('screen-detail-open-layout')).toHaveCount(0);
  expect(await assignedContent()).toMatchObject({
    assignedPlaylist: { id: mainId },
    assignedSchedule: null,
    assignedLayout: null,
  });

  // Free again: the editor says so.
  await page.goto(`${PORTAL_URL}/layouts/${layoutId}`);
  await expect(page.getByTestId('layout-fact-screens')).toHaveText('Not assigned');
});

test('the layouts pages fit a phone without sideways scrolling', async () => {
  const page = operator.page;
  try {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${PORTAL_URL}/layouts`);
      await expect(pageHeading(page, 'Layouts')).toBeVisible();
      await expect(page.getByTestId(`layouts-row-${layoutId}`)).toBeVisible();
      expect(await scrollsSideways(page), `layouts list at ${String(width)}`).toBe(false);
      await page.goto(`${PORTAL_URL}/layouts/${layoutId}`);
      await expect(page.getByTestId('layout-zone-1-playlist')).toBeVisible();
      await expect(page.getByTestId('layout-preview')).toBeVisible();
      expect(await scrollsSideways(page), `layout editor at ${String(width)}`).toBe(false);
    }
  } finally {
    await page.setViewportSize({ width: 1280, height: 900 });
  }
});

test('an unassigned layout is deleted from its editor', async () => {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/layouts/${layoutId}`);
  await page.getByRole('button', { name: `More actions for ${layoutName}` }).click();
  await page.getByRole('menuitem', { name: 'Delete layout' }).click();
  await page.getByTestId('layouts-delete-dialog-confirm').click();
  await page.waitForURL(/\/layouts$/);
  await expect(notifications(page).getByText(`${layoutName} deleted`)).toBeVisible();
  await expect(page.getByTestId(`layouts-row-${layoutId}`)).toHaveCount(0);
  expect((await operator.api.get(`/api/layouts/${layoutId}`)).status()).toBe(404);
});

test('no CSP violation and no web storage on the layouts pages', async () => {
  await expectNoWebStorage(operator.page);
  expect(await cspViolations(operator.page)).toEqual([]);
});
