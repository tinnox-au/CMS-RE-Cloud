/**
 * Stage B, slice 3 in the real portal (docs/portal-v2/stage-b.md, slice 3, sections 7 and 8):
 * an operator creates a schedule through the UI only, builds its events by keyboard, assigns
 * it on a screen's page, pushes it, and is told why a schedule in use and a playlist a
 * schedule uses cannot be deleted. Playlists, the app they hold and the screen are set up
 * through the API. What a player does with the schedule is the journey of 10.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Locator } from '@playwright/test';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import {
  assignScheduleOnScreenPage,
  createScheduleInPortal,
  cspViolations,
  expectNoWebStorage,
  notifications,
  openScreenPage,
  pageHeading,
  pushFromHeader,
  pushRow,
  saveSchedule,
  scrollsSideways,
  watchCspViolations,
} from './support/portal.ts';
import { PORTAL_URL } from './support/stack.ts';

test.describe.configure({ mode: 'serial' });

const runId = randomUUID().slice(0, 8);
const scheduleName = `ZZ schedule ${runId}`;
const defaultName = `ZZ sched default ${runId}`;
const lunchName = `ZZ sched lunch ${runId}`;
const screenName = `ZZ sched screen ${runId}`;

let operator: OperatorSession;
let scheduleId = '';
let defaultId = '';
let lunchId = '';
let displayId = '';

interface StoredSchedule {
  name: string;
  defaultPlaylist: { id: string };
  events: { playlist: { id: string }; days: boolean[]; start: string; end: string }[];
}

async function storedSchedule(id: string): Promise<StoredSchedule> {
  const response = await operator.api.get(`/api/schedules/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as StoredSchedule;
}

async function assignedContent(): Promise<{
  assignedPlaylist: { id: string } | null;
  assignedSchedule: { id: string } | null;
  assignedLayout: { id: string } | null;
}> {
  const response = await operator.api.get(`/api/displays/${displayId}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as Awaited<ReturnType<typeof assignedContent>>;
}

/** A control of event `n` (from 0) in the schedule editor, by the suffix of its test id. */
function eventControl(n: number, part: string): Locator {
  return operator.page.getByTestId(`schedule-event-${String(n)}-${part}`);
}

/** Fills event `n`: the playlist, Saturday and Sunday off, 22:00 to 02:00. */
async function fillOvernightEvent(n: number): Promise<void> {
  await eventControl(n, 'playlist').selectOption({ label: lunchName });
  await eventControl(n, 'day-5').uncheck();
  await eventControl(n, 'day-6').uncheck();
  await eventControl(n, 'start').fill('22:00');
  await eventControl(n, 'end').fill('02:00');
}

test.beforeAll(async ({ browser }) => {
  operator = await operatorSession(browser, 'operator');
  await watchCspViolations(operator.page);
  // Two playlists that can be pushed (each holds one app), and a screen that has the first.
  const clock = await operator.api.createApp({
    name: `ZZ sched clock ${runId}`,
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
  defaultId = (await operator.api.createPlaylist(defaultName)).id;
  lunchId = (await operator.api.createPlaylist(lunchName)).id;
  for (const [id, name] of [
    [defaultId, defaultName],
    [lunchId, lunchName],
  ] as const) {
    await operator.api.savePlaylist(id, name, [{ appId: clock.id, durationMs: 10_000 }]);
  }
  displayId = (
    await operator.api.createDisplay({ name: screenName, canvas: { width: 1920, height: 1080 } })
  ).id;
  const assigned = await operator.api.patch(`/api/displays/${displayId}`, {
    assignedPlaylistId: defaultId,
  });
  expect(assigned.status(), await assigned.text()).toBe(200);
});
test.afterAll(async () => {
  await operator.context.close();
});

test('a schedule is created through the dialog by keyboard', async () => {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/schedules`);
  await expect(pageHeading(page, 'Schedules')).toBeVisible();
  // Schedules is a built section now: the sidebar entry carries no "Planned" pill.
  await expect(page.getByRole('link', { name: 'Schedules', exact: true }).first()).toBeVisible();

  // The list layout shows while loading; an empty list then swaps in its own empty state, with
  // a new create button. Focus is put on the button of the layout that stays.
  await expect(
    page
      .getByTestId('schedules-empty')
      .or(page.getByTestId('schedules-count').filter({ hasNotText: 'Loading schedules' })),
  ).toBeAttached();
  await page.getByTestId('schedules-create').focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId('schedule-create-dialog');
  await expect(dialog).toBeVisible();
  const name = dialog.getByLabel('Name', { exact: true });
  const playlist = dialog.getByLabel('Default playlist');
  // The form arrives once the playlists are read; focus then goes to the name.
  await expect(name).toBeFocused();

  // Enter with nothing filled in: both fields say what they need, and the first takes focus.
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('Enter a name.')).toBeVisible();
  await expect(dialog.getByText('Choose a default playlist.')).toBeVisible();
  await expect(name).toBeFocused();

  await page.keyboard.type(scheduleName);
  await page.keyboard.press('Tab');
  await expect(playlist).toBeFocused();
  // A native select is the platform's own control and its keys differ by platform, so the
  // choice is set directly; everything around it is done with the keyboard.
  await playlist.selectOption({ label: defaultName });
  await expect(playlist).toHaveValue(defaultId);
  await expect(playlist).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(name).toBeFocused();
  await page.keyboard.press('Enter');

  await page.waitForURL(/\/schedules\/[0-9a-f-]{36}$/);
  scheduleId = page.url().split('/').pop() ?? '';
  await expect(notifications(page).getByText('Schedule created')).toBeVisible();
  await expect(pageHeading(page, scheduleName)).toBeVisible();
  await expect(page.getByTestId('schedule-default-playlist')).toHaveValue(defaultId);
  await expect(page.getByTestId('schedule-save-state')).toHaveText('Saved');
  await expect(page.getByTestId('schedule-no-events')).toBeVisible();
  expect((await storedSchedule(scheduleId)).events).toEqual([]);
});

test('an event with no playlist is refused, and the summary leads to its field', async () => {
  const page = operator.page;
  await page.getByTestId('schedule-add-event').click();
  await expect(eventControl(0, 'playlist')).toBeFocused();
  // Every control of the event is named by its group.
  await expect(page.getByRole('group', { name: 'Event 1' })).toBeVisible();
  await expect(eventControl(0, 'open')).toHaveCount(0);
  await expect(page.getByTestId('schedule-save-state')).toHaveText('Unsaved changes');

  await page.getByTestId('schedule-save').click();
  const summary = page.getByTestId('schedule-error-summary');
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('Event 1: Choose a playlist.');
  await expect(summary).toContainText('Event 1: Enter a start and an end time.');
  await summary.getByRole('link', { name: 'Event 1: Choose a playlist.' }).click();
  await expect(eventControl(0, 'playlist')).toBeFocused();
  await expect(eventControl(0, 'playlist')).toHaveAttribute('aria-invalid', 'true');
  await summary.getByRole('link', { name: 'Event 1: Enter a start and an end time.' }).click();
  await expect(eventControl(0, 'start')).toBeFocused();
  // Nothing was sent.
  expect((await storedSchedule(scheduleId)).events).toEqual([]);
});

test('events are filled in, reordered and removed, with focus kept in the list', async () => {
  const page = operator.page;
  await fillOvernightEvent(0);
  await expect(eventControl(0, 'open')).toHaveAttribute('href', `/playlists/${lunchId}`);
  await expect(eventControl(0, 'next-day')).toHaveText('Ends the next day.');
  await expect(page.getByTestId('schedule-error-summary')).toHaveCount(0);

  // A second event; the first moves under it and back, and the pressed button keeps focus.
  await page.getByTestId('schedule-add-event').click();
  await expect(eventControl(1, 'playlist')).toBeFocused();
  await expect(eventControl(0, 'up')).toHaveAttribute('aria-disabled', 'true');
  await expect(eventControl(1, 'down')).toHaveAttribute('aria-disabled', 'true');
  await eventControl(0, 'down').click();
  await expect(eventControl(1, 'down')).toBeFocused();
  await expect(eventControl(1, 'playlist')).toHaveValue(lunchId);
  await expect(eventControl(0, 'playlist')).toHaveValue('');
  await eventControl(1, 'up').click();
  await expect(eventControl(0, 'up')).toBeFocused();
  await expect(eventControl(0, 'playlist')).toHaveValue(lunchId);

  // Removing the second event: focus lands on the first event's Remove button.
  await page.getByRole('button', { name: 'Remove event 2' }).click();
  await expect(page.getByRole('group', { name: 'Event 2' })).toHaveCount(0);
  await expect(eventControl(0, 'remove')).toBeFocused();
  // Removing the last one: focus lands on "Add event".
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('schedule-no-events')).toBeVisible();
  await expect(page.getByTestId('schedule-add-event')).toBeFocused();

  // Added again and saved.
  await page.keyboard.press('Enter');
  await expect(eventControl(0, 'playlist')).toBeFocused();
  await fillOvernightEvent(0);
  await saveSchedule(page);
  await expect(notifications(page).getByText('Schedule saved')).toBeVisible();
  expect(await storedSchedule(scheduleId)).toMatchObject({
    name: scheduleName,
    defaultPlaylist: { id: defaultId },
    events: [
      {
        playlist: { id: lunchId },
        days: [true, true, true, true, true, false, false],
        start: '22:00',
        end: '02:00',
      },
    ],
  });

  // The list shows it with its default playlist and its one event.
  await page.goto(`${PORTAL_URL}/schedules`);
  const row = page.getByTestId(`schedules-row-${scheduleId}`);
  await expect(row).toContainText(defaultName);
  await expect(row).toContainText('1 event');
  await expect(row).toContainText('Not assigned');
});

test('the schedule is assigned on the screen page, and a push brings the screen up to date', async () => {
  const page = operator.page;
  // The screen has a playlist, so the schedule is chosen from the "Change" menu.
  await assignScheduleOnScreenPage(page, displayId, scheduleName);
  await expect(page.getByTestId('screen-detail-open-schedule')).toHaveAttribute(
    'href',
    `/schedules/${scheduleId}`,
  );
  await expect(page.getByTestId('screen-detail-default-playlist')).toHaveText(
    `Default playlist: ${defaultName}`,
  );
  expect(await assignedContent()).toMatchObject({
    assignedPlaylist: null,
    assignedSchedule: { id: scheduleId },
    assignedLayout: null,
  });

  // The screen page has its own push control; the header button is on the list pages.
  await page.goto(`${PORTAL_URL}/schedules`);
  const row = await pushRow(page, displayId);
  await expect(row).toContainText(`Schedule: ${scheduleName}`);
  await page.getByTestId('push-cancel').click();
  await expect(page.getByTestId('push-dialog-body')).toBeHidden();

  expect(await pushFromHeader(page, [displayId])).toMatch(/Pushed to 1 screen/);
  await openScreenPage(page, displayId);
  await expect(page.getByTestId('screen-detail-push-state')).toHaveAttribute(
    'data-state',
    'up_to_date',
  );
});

test('a schedule on a screen, and a playlist in a schedule, cannot be deleted', async () => {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/schedules`);
  await expect(page.getByTestId(`schedules-row-${scheduleId}`)).toContainText('1 screen');
  await page.getByRole('button', { name: `Actions for ${scheduleName}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete ${scheduleName}?` });
  await expect(dialog).toBeVisible();
  await page.getByTestId('schedules-delete-dialog-confirm').click();
  await expect(dialog.getByTestId('schedules-delete-screens')).toContainText(screenName);
  await expect(dialog.getByText('schedule_in_use')).toBeVisible();
  await page.getByTestId('schedules-delete-dialog-cancel').click();
  await expect(dialog).toBeHidden();
  await storedSchedule(scheduleId);

  // The event's playlist: the refusal names the schedule and is not offered again.
  await page.goto(`${PORTAL_URL}/playlists`);
  await page.getByTestId('playlists-search').fill(lunchName);
  await page.getByRole('button', { name: `Actions for ${lunchName}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByTestId('playlists-delete-confirm').click();
  const failures = page.getByTestId('playlists-delete-failures');
  await expect(failures).toContainText(`Used by the schedule ${scheduleName}.`);
  await expect(failures).toContainText('playlist_in_use');
  await expect(failures).toContainText(
    'Choose another playlist in that schedule, then delete the playlist.',
  );
  await expect(page.getByTestId('playlists-delete-retry')).toHaveCount(0);
  await page.getByTestId('playlists-delete-cancel').click();
  expect((await operator.api.get(`/api/playlists/${lunchId}`)).status()).toBe(200);
});

test('assigning a playlist to the screen replaces its schedule, and the dialog says so', async () => {
  const page = operator.page;
  await openScreenPage(page, displayId);
  await page.getByTestId('screen-detail-change-content').click();
  await page.getByRole('menuitem', { name: 'Choose a playlist…' }).click();
  const picker = page.getByTestId('screen-detail-playlist-picker');
  await expect(picker).toBeVisible();
  await expect(picker).toContainText(
    'A screen that has a schedule or a layout gets this playlist instead.',
  );
  await picker.getByTestId('screen-detail-playlist-picker-search').fill(lunchName);
  await picker.getByRole('radio', { name: lunchName }).check();
  await picker.getByTestId('screen-detail-playlist-picker-confirm').click();
  await expect(picker).toBeHidden();
  await expect(notifications(page).getByText(`${lunchName} assigned`)).toBeVisible();
  await expect(page.getByTestId('screen-detail-open-schedule')).toHaveCount(0);
  expect(await assignedContent()).toMatchObject({
    assignedPlaylist: { id: lunchId },
    assignedSchedule: null,
    assignedLayout: null,
  });

  // Free again, the schedule can be deleted from its editor.
  await page.goto(`${PORTAL_URL}/schedules/${scheduleId}`);
  await expect(page.getByTestId('schedule-fact-screens')).toHaveText('Not assigned');
});

test('the schedules pages fit a phone without sideways scrolling', async () => {
  const page = operator.page;
  try {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${PORTAL_URL}/schedules`);
      await expect(pageHeading(page, 'Schedules')).toBeVisible();
      await expect(page.getByTestId(`schedules-row-${scheduleId}`)).toBeVisible();
      expect(await scrollsSideways(page), `schedules list at ${String(width)}`).toBe(false);
      await page.goto(`${PORTAL_URL}/schedules/${scheduleId}`);
      await expect(eventControl(0, 'playlist')).toBeVisible();
      expect(await scrollsSideways(page), `schedule editor at ${String(width)}`).toBe(false);
    }
  } finally {
    await page.setViewportSize({ width: 1280, height: 900 });
  }
});

test('an unassigned schedule is deleted, from the list and from its editor', async () => {
  const page = operator.page;
  const spareName = `ZZ schedule spare ${runId}`;
  const spareId = await createScheduleInPortal(page, spareName, defaultName);
  await page.goto(`${PORTAL_URL}/schedules`);
  await page.getByRole('button', { name: `Actions for ${spareName}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByTestId('schedules-delete-dialog-confirm').click();
  await expect(notifications(page).getByText(`${spareName} deleted`)).toBeVisible();
  await expect(page.getByTestId(`schedules-row-${spareId}`)).toHaveCount(0);
  expect((await operator.api.get(`/api/schedules/${spareId}`)).status()).toBe(404);

  await page.goto(`${PORTAL_URL}/schedules/${scheduleId}`);
  await page.getByRole('button', { name: `More actions for ${scheduleName}` }).click();
  await page.getByRole('menuitem', { name: 'Delete schedule' }).click();
  await page.getByTestId('schedules-delete-dialog-confirm').click();
  await page.waitForURL(/\/schedules$/);
  await expect(notifications(page).getByText(`${scheduleName} deleted`)).toBeVisible();
  await expect(page.getByTestId(`schedules-row-${scheduleId}`)).toHaveCount(0);
  expect((await operator.api.get(`/api/schedules/${scheduleId}`)).status()).toBe(404);
});

test('no CSP violation and no web storage on the schedules pages', async () => {
  await expectNoWebStorage(operator.page);
  expect(await cspViolations(operator.page)).toEqual([]);
});
