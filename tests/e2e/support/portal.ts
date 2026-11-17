/**
 * Portal-side steps of the end-to-end journeys, against the portal v2 screens
 * (docs/portal-v2/stage-a.md, sections 3 and 8). Locators are roles, labels and the
 * `data-testid` hooks the portal keeps for tests; never CSS classes. Each helper drives the
 * real UI and waits for the portal's own confirmation, so a spec reads as the operator's
 * steps. The API client in operator.ts checks what the server stored.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { PORTAL_URL } from './stack.ts';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** The page `h1`. */
export function pageHeading(page: Page, name: string | RegExp): Locator {
  return page.getByRole('heading', { level: 1, name });
}

// ---------------------------------------------------------------------------
// Standing rules checked on every journey

const consoleViolations = new WeakMap<Page, string[]>();

/**
 * Collects Content-Security-Policy violations on the portal for the whole life of the page:
 * the `securitypolicyviolation` events of the current document, and the browser's console
 * reports of every document since (a navigation ends a document and its listener). Call
 * once per page, before the first navigation.
 */
export async function watchCspViolations(page: Page): Promise<void> {
  const seen: string[] = [];
  consoleViolations.set(page, seen);
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) seen.push(message.text());
  });
  await page.addInitScript(() => {
    const store = window as unknown as { __tinnoxCsp?: string[] };
    store.__tinnoxCsp = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      store.__tinnoxCsp?.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
}

/** Every violation seen so far on this page (an empty list when there were none). */
export async function cspViolations(page: Page): Promise<string[]> {
  const seen = consoleViolations.get(page);
  if (seen === undefined) return ['watchCspViolations was not called for this page'];
  const current = await page.evaluate(
    () => (window as unknown as { __tinnoxCsp?: string[] }).__tinnoxCsp ?? [],
  );
  return [...seen, ...current];
}

/** Asserts that the portal keeps nothing in web storage on its origin. */
export async function expectNoWebStorage(page: Page): Promise<void> {
  const stored = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(stored).toEqual({ local: [], session: [] });
}

/** Opens the account menu and signs out. */
export async function signOutFromAccountMenu(page: Page): Promise<void> {
  await page.getByTestId('account-menu').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
}

// ---------------------------------------------------------------------------
// Screens

/**
 * Adds a screen through the wizard's first step and returns its id. The wizard stays on
 * its pairing step (`?screen=<id>&step=pair`).
 */
export async function createScreenInWizard(
  page: Page,
  input: { name: string; width: number; height: number },
): Promise<string> {
  await page.goto(`${PORTAL_URL}/screens`);
  await page.getByRole('link', { name: 'Add screen' }).first().click();
  await page.waitForURL(/\/screens\/new/);
  await page.getByLabel('Name', { exact: true }).fill(input.name);
  await page.getByLabel('Width (px)').fill(String(input.width));
  await page.getByLabel('Height (px)').fill(String(input.height));
  await page.getByRole('button', { name: 'Create screen' }).click();
  await page.waitForURL(/[?&]step=pair/);
  const id = new URL(page.url()).searchParams.get('screen') ?? '';
  expect(id).toMatch(UUID);
  return id;
}

/** On the wizard's pairing step: enters the player's code and waits for the API to accept it. */
export async function pairInWizard(page: Page, code: string): Promise<void> {
  await page.getByLabel('Pairing code shown on the player').fill(code);
  await page.getByRole('button', { name: 'Pair player' }).click();
  await expect(page.getByText('Code accepted')).toBeVisible();
}

/** Leaves the wizard from the pairing step without choosing content; lands on the screen page. */
export async function finishWizardWithoutContent(page: Page, screenId: string): Promise<void> {
  await page.getByTestId('screen-wizard-pair-next').click();
  await page.getByTestId('screen-wizard-skip-finish').click();
  await page.waitForURL(new RegExp(`/screens/${screenId}(\\?.*)?$`));
}

/** Opens a screen's page and waits for its status headline (the M0 `status-*` hooks). */
export async function openScreenPage(page: Page, screenId: string, tab?: string): Promise<void> {
  await page.goto(`${PORTAL_URL}/screens/${screenId}${tab === undefined ? '' : `?tab=${tab}`}`);
  await expect(page.getByTestId('screen-detail')).toBeVisible();
}

/** On a screen's page: revokes the paired player through the confirmation dialog. */
export async function revokePlayer(page: Page, screenId: string): Promise<void> {
  await openScreenPage(page, screenId, 'pairing');
  await page.getByTestId('screen-detail-revoke').click();
  const dialog = page.getByRole('dialog', { name: 'Revoke this player?' });
  await dialog.getByRole('button', { name: 'Revoke player' }).click();
  await expect(page.getByText('The player credential was revoked.')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Media

/** Every body row of the media library table (`media-library-row-<id>`). */
export function mediaRows(page: Page): Locator {
  return page.locator('[data-row][data-testid^="media-library-row-"]');
}

/** A row of the media library table, found by the file's name. */
export function mediaRow(page: Page, name: string): Locator {
  return mediaRows(page).filter({ hasText: name });
}

/** The status pill of a library row: its `data-status` is the API's status. */
export function mediaStatus(row: Locator): Locator {
  return row.getByTestId('media-library-status');
}

/**
 * Uploads files from the media library's "Add media" dialog and closes it once every file
 * has been sent. The verdicts of the validation worker arrive later, in the table.
 */
export async function uploadInLibrary(
  page: Page,
  files: readonly { name: string; mimeType: string; buffer: Buffer }[],
): Promise<void> {
  await page.goto(`${PORTAL_URL}/media`);
  await page.getByTestId('media-library-add').click();
  const dialog = page.getByTestId('media-library-add-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('media-library-file-input').setInputFiles([...files]);
  const rows = dialog.getByTestId('media-library-upload-row');
  await expect(rows).toHaveCount(files.length);
  for (const file of files) {
    await expect(rows.filter({ hasText: file.name })).not.toHaveAttribute(
      'data-status',
      /^(queued|uploading)$/,
      { timeout: 60_000 },
    );
  }
}

/** Closes the "Add media" dialog. */
export async function closeAddMedia(page: Page): Promise<void> {
  await page
    .getByTestId('media-library-add-dialog')
    .getByRole('button', { name: 'Close' })
    .first()
    .click();
  await expect(page.getByTestId('media-library-add-dialog')).toBeHidden();
}

/** Opens a library row's menu and asks to delete the file; returns the dialog. */
export async function askToDeleteMedia(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this file?' });
  await expect(dialog).toBeVisible();
  return dialog;
}

// ---------------------------------------------------------------------------
// Playlists

/** A library card in the playlist editor: "Add <name>, <type and size>…", named by its content. */
function libraryButtonName(name: string): RegExp {
  return new RegExp(`^Add ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`);
}

/** Creates a playlist from the Playlists page and returns its id; lands in its editor. */
export async function createPlaylistInPortal(page: Page, name: string): Promise<string> {
  await page.goto(`${PORTAL_URL}/playlists`);
  await page.getByTestId('playlists-new').click();
  await page.getByTestId('playlists-new-name').fill(name);
  await page.getByTestId('playlists-new-submit').click();
  await page.waitForURL(/\/playlists\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('playlist-editor')).toBeVisible();
  return page.url().split('/').pop() ?? '';
}

/** In the playlist editor: adds a ready file from "Add media or apps" to the end. */
export async function addToPlaylist(page: Page, mediaName: string): Promise<void> {
  const library = page.getByTestId('playlist-editor-library');
  await library.getByRole('searchbox', { name: 'Search media and apps' }).fill(mediaName);
  await library.getByRole('button', { name: libraryButtonName(mediaName) }).click();
}

/** In the playlist editor: chooses the Apps chip and adds an app to the end of the sequence. */
export async function addAppToPlaylist(page: Page, appName: string): Promise<void> {
  const library = page.getByTestId('playlist-editor-library');
  await library.getByRole('button', { name: 'Apps', exact: true }).click();
  await library.getByRole('searchbox', { name: 'Search media and apps' }).fill(appName);
  await library.getByRole('button', { name: libraryButtonName(appName) }).click();
}

/** In the playlist editor: saves the draft and waits for "Saved". */
export async function savePlaylistDraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('playlist-editor-save-state')).toHaveText('Saved');
}

// ---------------------------------------------------------------------------
// Apps

/**
 * Creates an app through the Apps page's "Create app" dialog and lands in its editor;
 * returns its id. `type` is the API's type ("clock", "ticker", "qr").
 */
export async function createAppInPortal(page: Page, type: string, name: string): Promise<string> {
  await page.goto(`${PORTAL_URL}/apps`);
  await page.getByTestId('apps-create').click();
  const dialog = page.getByTestId('apps-create-dialog');
  await dialog.getByTestId(`apps-create-type-${type}`).click();
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create app' }).click();
  await page.waitForURL(/\/apps\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('app-editor')).toBeVisible();
  return page.url().split('/').pop() ?? '';
}

/** In the app editor: saves and waits for "Saved". */
export async function saveApp(page: Page): Promise<void> {
  await page.getByTestId('app-editor-save').click();
  await expect(page.getByTestId('app-editor-save-state')).toHaveText('Saved');
}

// ---------------------------------------------------------------------------
// Schedules

/**
 * Creates a schedule through the Schedules page's "Create schedule" dialog and lands in its
 * editor; returns its id. The default playlist is chosen by its name.
 */
export async function createScheduleInPortal(
  page: Page,
  name: string,
  defaultPlaylistName: string,
): Promise<string> {
  await page.goto(`${PORTAL_URL}/schedules`);
  await page.getByTestId('schedules-create').click();
  const dialog = page.getByTestId('schedule-create-dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Default playlist').selectOption({ label: defaultPlaylistName });
  await dialog.getByRole('button', { name: 'Create schedule' }).click();
  await page.waitForURL(/\/schedules\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('schedule-editor')).toBeVisible();
  return page.url().split('/').pop() ?? '';
}

/** In the schedule editor: saves and waits for "Saved". */
export async function saveSchedule(page: Page): Promise<void> {
  await page.getByTestId('schedule-save').click();
  await expect(page.getByTestId('schedule-save-state')).toHaveText('Saved');
}

/**
 * On a screen's page: assigns a schedule through the schedule picker. A screen that has
 * content offers it in the "Change" menu; one with nothing assigned has an "Assign schedule"
 * button. Waits for the portal's confirmation; nothing is pushed.
 */
export async function assignScheduleOnScreenPage(
  page: Page,
  screenId: string,
  scheduleName: string,
): Promise<void> {
  await openScreenPage(page, screenId);
  const change = page.getByTestId('screen-detail-change-content');
  const assign = page.getByTestId('screen-detail-choose-schedule');
  await expect(change.or(assign)).toBeVisible();
  if ((await change.count()) > 0) {
    await change.click();
    await page.getByRole('menuitem', { name: 'Choose a schedule…' }).click();
  } else {
    await assign.click();
  }
  const picker = page.getByTestId('screen-detail-schedule-picker');
  await expect(picker).toBeVisible();
  await picker.getByTestId('screen-detail-schedule-picker-search').fill(scheduleName);
  await picker.getByRole('radio', { name: scheduleName }).check();
  await picker.getByTestId('screen-detail-schedule-picker-confirm').click();
  await expect(picker).toBeHidden();
  await expect(notifications(page).getByText(`${scheduleName} assigned`)).toBeVisible();
}

/**
 * The toast stack. A toast's words are also copied, 150 ms later, into a visually hidden live
 * region, so an unscoped `getByText` would match twice.
 */
export function notifications(page: Page): Locator {
  return page.getByRole('region', { name: 'Notifications' });
}

/** True when the page scrolls sideways (content wider than the viewport). */
export function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

// ---------------------------------------------------------------------------
// Playlist assignment

/** In the playlist editor: assigns the playlist to one screen through the screen picker. */
export async function assignFromEditor(page: Page, screenName: string): Promise<void> {
  await page.getByRole('button', { name: 'Assign to screens', exact: true }).click();
  const picker = page.getByTestId('playlist-editor-assign-picker');
  await expect(picker).toBeVisible();
  await picker.getByTestId('playlist-editor-assign-picker-search').fill(screenName);
  await picker.getByRole('checkbox', { name: screenName }).check();
  await picker.getByTestId('playlist-editor-assign-picker-confirm').click();
  await expect(picker).toBeHidden();
}

// ---------------------------------------------------------------------------
// Push

/**
 * Pushes from the header's "Push to screens" button to exactly the given screens: the
 * dialog's default ticks are cleared first, then only these screens are ticked. Waits for
 * the dialog's summary and closes it; returns the summary's text.
 */
export async function pushFromHeader(page: Page, screenIds: readonly string[]): Promise<string> {
  await page.getByTestId('push-button').click();
  const body = page.getByTestId('push-dialog-body');
  await expect(body).toBeVisible();
  await expect(body.getByTestId('push-loading')).toHaveCount(0);
  const ticked = body.locator('[data-testid^="push-row-check-"]:checked');
  while ((await ticked.count()) > 0) await ticked.first().uncheck();
  for (const id of screenIds) await body.getByTestId(`push-row-check-${id}`).check();
  await page.getByTestId('push-submit').click();
  const summary = body.getByTestId('push-summary');
  await expect(summary).toBeVisible({ timeout: 90_000 });
  const text = (await summary.textContent()) ?? '';
  await page.getByTestId('push-done').click();
  await expect(body).toBeHidden();
  return text;
}

/** Opens the push dialog from the header and returns one screen's row, without pushing. */
export async function pushRow(page: Page, screenId: string): Promise<Locator> {
  await page.getByTestId('push-button').click();
  const body = page.getByTestId('push-dialog-body');
  await expect(body).toBeVisible();
  await expect(body.getByTestId('push-loading')).toHaveCount(0);
  const showAll = body.getByTestId('push-show-all');
  if ((await showAll.count()) > 0) await showAll.click();
  const row = body.getByTestId(`push-row-${screenId}`);
  await expect(row).toBeVisible();
  return row;
}

// ---------------------------------------------------------------------------
// Tags

/** Creates a media tag on Settings, Tags. */
export async function createMediaTag(page: Page, name: string): Promise<void> {
  await page.goto(`${PORTAL_URL}/settings/tags?scope=media`);
  await page.getByTestId('settings-tags-new').click();
  await page.getByTestId('settings-tag-form-name').fill(name);
  await page.getByTestId('settings-tag-form-save').click();
  await expect(page.getByTestId('settings-tag-form')).toBeHidden();
  await expect(
    page.getByTestId('settings-tags-page').getByText(name, { exact: true }),
  ).toBeVisible();
}

/** In the media library: gives one file one tag through its row menu's tags dialog. */
export async function tagMedia(page: Page, mediaName: string, tagName: string): Promise<void> {
  await page.getByRole('button', { name: `Actions for ${mediaName}` }).click();
  await page.getByRole('menuitem', { name: 'Edit tags' }).click();
  const dialog = page.getByTestId('media-library-tags-dialog');
  await expect(dialog).toBeVisible();
  const option = dialog.getByRole('option', { name: tagName });
  await option.click();
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await dialog.getByTestId('media-library-tags-dialog-save').click();
  await expect(dialog).toBeHidden();
}

/** In the media library: filters the table by one tag. */
export async function filterLibraryByTag(page: Page, tagName: string): Promise<void> {
  const filter = page.getByTestId('media-library-tag-filter');
  const chip = filter.getByRole('button', { name: tagName, exact: true });
  if ((await chip.count()) === 0) await filter.getByRole('button', { name: /^More tags/ }).click();
  await filter.getByRole('button', { name: tagName, exact: true }).click();
}
