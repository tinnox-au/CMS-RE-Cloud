/**
 * Stage B, slice 1 in the real browser player and the real portal (docs/portal-v2/stage-b.md,
 * sections 7 and 8): fade and cut, shuffle rounds, working hours and availability windows on
 * one paired player; then the portal forms for playback options, availability windows,
 * working hours and rotation. Rotation on the player is covered by 02-canvases.
 *
 * The player corrects its clock from the server's time, so a faked browser clock would not
 * move it: working hours are set relative to today in the site's zone instead.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encodePng } from '../support/png.ts';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import type { MediaItem } from './support/operator.ts';
import { openScreenPage } from './support/portal.ts';
import { activeLayer, expectPhase, openPlayer, pairingCode, readRecord } from './support/player.ts';
import { PORTAL_URL } from './support/stack.ts';

test.describe.configure({ mode: 'serial' });

const runId = randomUUID().slice(0, 8);
const SITE_ZONE = 'Australia/Melbourne';
const ALL_DAY = { start: '00:00', end: '24:00' };

let operator: OperatorSession;
let playerContext: BrowserContext;
let player: Page;
let displayId = '';
/** Eight small images with bytes unique to this run. */
let images: MediaItem[] = [];

interface Shown {
  readonly assetId: string;
  readonly fadeIn: boolean;
  /** The layer fading out when this one was revealed, if any. */
  readonly leaving: string | null;
}

/** Starts (or restarts) a log of every item the player reveals, read from the real DOM. */
async function startLayerLog(): Promise<void> {
  await player.evaluate(() => {
    const store = window as unknown as { __shown?: Shown[]; __shownObserver?: MutationObserver };
    store.__shownObserver?.disconnect();
    const log: Shown[] = [];
    store.__shown = log;
    // The presenter sets data-testid="active-layer" when it reveals a layer, and marks the
    // previous one fade-out in the same task, so both are visible to this callback.
    store.__shownObserver = new MutationObserver((records) => {
      for (const record of records) {
        const layer = record.target as HTMLElement;
        if (layer.getAttribute('data-testid') !== 'active-layer') continue;
        if (record.oldValue === 'active-layer') continue;
        log.push({
          assetId: layer.dataset['assetId'] ?? '',
          fadeIn: layer.classList.contains('fade-in'),
          leaving:
            document.querySelector<HTMLElement>('.layer.fade-out')?.dataset['assetId'] ?? null,
        });
      }
    });
    store.__shownObserver.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-testid'],
      attributeOldValue: true,
    });
  });
}

function layerLog(): Promise<Shown[]> {
  return player.evaluate(() => (window as unknown as { __shown?: Shown[] }).__shown ?? []);
}

/** Waits until the log holds at least `count` items and returns it. */
async function waitForShown(count: number, timeout = 60_000): Promise<Shown[]> {
  await expect
    .poll(async () => (await layerLog()).length, { timeout })
    .toBeGreaterThanOrEqual(count);
  return layerLog();
}

interface StoredManifest {
  readonly manifest: {
    readonly publicationId: string;
    readonly schemaVersion: number;
    readonly assets: readonly { assetId: string }[];
  };
}

/** Pushes a playlist to the paired screen and waits until the player has adopted it. */
async function pushAndAdopt(playlistId: string): Promise<StoredManifest['manifest']> {
  const { publicationId } = await operator.api.publish(playlistId, displayId);
  await expect
    .poll(
      async () =>
        (await readRecord<StoredManifest>(player, 'activeVersion'))?.manifest.publicationId,
      { timeout: 90_000 },
    )
    .toBe(publicationId);
  const stored = await readRecord<StoredManifest>(player, 'activeVersion');
  if (stored === null) throw new Error('the player holds no active version');
  return stored.manifest;
}

async function playlistOf(
  label: string,
  media: readonly MediaItem[],
  playback: { transition?: 'cut' | 'fade'; shuffle?: boolean } = {},
): Promise<string> {
  const name = `ZZ sb ${label} ${runId}`;
  const { id } = await operator.api.createPlaylist(name);
  const items = media.map((item) => ({ mediaId: item.id, durationMs: 1000, fit: null }));
  await operator.api.savePlaylist(id, name, items, playback);
  return id;
}

async function setHours(hours: readonly ({ start: string; end: string } | null)[] | null) {
  const response = await operator.api.patch(`/api/displays/${displayId}`, { workingHours: hours });
  expect(response.status(), await response.text()).toBe(200);
}

async function setWindow(media: MediaItem, from: string | null, until: string | null) {
  const response = await operator.api.patch(`/api/media/${media.id}`, {
    availableFrom: from,
    availableUntil: until,
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** The player shows a black stage: nothing on screen and no slate. */
async function expectBlackStage(): Promise<void> {
  await expectPhase(player, 'idle');
  await expect(activeLayer(player)).toHaveCount(0);
  await expect(player.getByTestId('slate-display-name')).toBeHidden();
  await expect(player.getByText('Waiting for content')).toBeHidden();
}

/** The portal's screen page shows this delivery status (it polls every 5 s). */
async function expectPortalStatus(summary: string, label: string): Promise<void> {
  const page = operator.page;
  await openScreenPage(page, displayId);
  const headline = page.getByTestId('status-headline');
  await expect(headline).toHaveAttribute('data-summary', summary, { timeout: 90_000 });
  await expect(headline).toContainText(label);
}

/** A screen with a one-image playlist assigned and pushed (so its push state is up to date). */
async function pushedScreen(label: string): Promise<{ displayId: string; playlistId: string }> {
  const display = await operator.api.createDisplay({
    name: `ZZ sb ${label} ${runId}`,
    canvas: { width: 1920, height: 1080 },
  });
  const playlistId = await playlistOf(label, images.slice(0, 1));
  const assigned = await operator.api.patch(`/api/displays/${display.id}`, {
    assignedPlaylistId: playlistId,
  });
  expect(assigned.status(), await assigned.text()).toBe(200);
  const pushed = await operator.api.post(
    '/api/push',
    { displayIds: [display.id] },
    { 'idempotency-key': randomUUID() },
  );
  const body = (await pushed.json()) as { results: { outcome: string }[] };
  expect(body.results[0]?.outcome).toBe('published');
  return { displayId: display.id, playlistId };
}

/** On a screen's page: the push state pill. */
function pushState(page: Page) {
  return page.getByTestId('screen-detail-push-state');
}

test.beforeAll(async ({ browser }) => {
  operator = await operatorSession(browser, 'operator');
  playerContext = await browser.newContext({ viewport: { width: 640, height: 360 } });
  player = await playerContext.newPage();
  images = [];
  for (let index = 0; index < 8; index += 1) {
    const mark = Buffer.from(`${runId}${index}`, 'utf8');
    const png = encodePng(64, 36, (x, y) =>
      y === 0 && x < mark.length ? [mark[x] ?? 0, 0, 0] : [index * 30, 200 - index * 20, x * 3],
    );
    images.push(await operator.api.uploadReady(`ZZ sb ${index} ${runId}.png`, 'image/png', png));
  }
  const display = await operator.api.createDisplay({
    name: `ZZ sb player ${runId}`,
    canvas: { width: 1280, height: 720 },
  });
  displayId = display.id;
  await openPlayer(player);
  expect((await operator.api.claim(displayId, await pairingCode(player))).status()).toBe(200);
  await expectPhase(player, 'idle');
});

test.afterAll(async () => {
  await playerContext.close();
  await operator.context.close();
});

test('fade: the incoming image fades in over the outgoing one; cut has neither class', async () => {
  const [a, b] = images as [MediaItem, MediaItem];
  const playlistId = await playlistOf('fade', [a, b], { transition: 'fade' });

  const faded = await pushAndAdopt(playlistId);
  expect(faded.schemaVersion).toBe(2);
  await expectPhase(player, 'playing');
  await startLayerLog();
  for (const shown of (await waitForShown(3)).slice(0, 3)) {
    expect(shown.fadeIn, JSON.stringify(shown)).toBe(true);
    expect(shown.leaving, 'the outgoing image is still there, fading out').not.toBeNull();
    expect(shown.leaving).not.toBe(shown.assetId);
  }

  // The same playlist with Transition = Cut: every option at its default, so manifest v1.
  await operator.api.savePlaylist(
    playlistId,
    `ZZ sb fade ${runId}`,
    [a, b].map((item) => ({ mediaId: item.id, durationMs: 1000, fit: null })),
    { transition: 'cut' },
  );
  const cut = await pushAndAdopt(playlistId);
  expect(cut.schemaVersion).toBe(1);
  // Past the item that was on screen when the new version was adopted.
  await player.waitForTimeout(1500);
  await startLayerLog();
  for (const shown of (await waitForShown(3)).slice(0, 3)) {
    expect(shown, 'a cut neither fades in nor keeps the old layer').toMatchObject({
      fadeIn: false,
      leaving: null,
    });
  }
  await expect(player.locator('.layer.fade-in, .layer.fade-out')).toHaveCount(0);
});

test('shuffle: each round plays every item once, with no repeat across a round boundary', async () => {
  const media = images.slice(2, 6);
  const playlistId = await playlistOf('shuffle', media, { shuffle: true });
  const ids = new Set(media.map((item) => item.id));
  // Logged from before the push: the first item of the new publication starts round one.
  await startLayerLog();
  const manifest = await pushAndAdopt(playlistId);
  expect(manifest.schemaVersion).toBe(2);
  expect(new Set(manifest.assets.map((asset) => asset.assetId))).toEqual(ids);

  const rounds = 3;
  await expect
    .poll(async () => (await layerLog()).filter((shown) => ids.has(shown.assetId)).length, {
      timeout: 60_000,
    })
    .toBeGreaterThanOrEqual(rounds * ids.size);
  const sequence = (await layerLog())
    .map((shown) => shown.assetId)
    .filter((assetId) => ids.has(assetId));
  for (let round = 0; round < rounds; round += 1) {
    const items = sequence.slice(round * ids.size, (round + 1) * ids.size);
    expect(new Set(items), `round ${round + 1}: ${items.join(' ')}`).toEqual(ids);
    if (round > 0) {
      expect(items[0], `round ${round + 1} starts with the last item of the round before`).not.toBe(
        sequence[round * ids.size - 1],
      );
    }
  }
});

test('working hours: closed today shows a black stage and "Standing by"; open plays again', async () => {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: SITE_ZONE,
    weekday: 'short',
  }).format(new Date());
  const today = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday);
  expect(today).toBeGreaterThanOrEqual(0);
  // Closed today and tomorrow (so a run across midnight stays closed), open the day after.
  const hours = Array.from({ length: 7 }, (_, day) => (day === (today + 2) % 7 ? ALL_DAY : null));
  const playlistId = await playlistOf('hours', images.slice(0, 2));

  await setHours(hours);
  expect((await pushAndAdopt(playlistId)).schemaVersion).toBe(2);
  await expectBlackStage();
  await expectPortalStatus('standing_by', 'Standing by');

  await setHours(null);
  await pushAndAdopt(playlistId);
  await expectPhase(player, 'playing');
  await expect(activeLayer(player)).toBeVisible();
  await expectPortalStatus('in_sync', 'In sync');
});

test('availability windows: an item not yet available never shows; none available is standing by', async () => {
  const [later, now] = images.slice(6, 8) as [MediaItem, MediaItem];
  const playlistId = await playlistOf('windows', [later, now]);

  await setWindow(later, '2999-01-01T00:00', null);
  await pushAndAdopt(playlistId);
  await player.waitForTimeout(1500);
  await startLayerLog();
  const shown = await waitForShown(4);
  expect(new Set(shown.map((item) => item.assetId))).toEqual(new Set([now.id]));

  await setWindow(now, '2999-01-01T00:00', '2999-12-31T00:00');
  await pushAndAdopt(playlistId);
  await expectBlackStage();
  await expectPortalStatus('standing_by', 'Standing by');

  await setWindow(later, null, null);
  await setWindow(now, null, null);
  // Every option is at its default again (Always on, no windows, cut, in order): v1.
  expect((await pushAndAdopt(playlistId)).schemaVersion).toBe(1);
  await expectPhase(player, 'playing');
  await startLayerLog();
  const both = await waitForShown(4);
  expect(new Set(both.map((item) => item.assetId))).toEqual(new Set([later.id, now.id]));
});

test('playlist editor: Fade and Shuffle persist, give changes waiting and can be discarded', async () => {
  const page = operator.page;
  const screen = await pushedScreen('editor');
  await page.goto(`${PORTAL_URL}/playlists/${screen.playlistId}`);
  const transition = page.getByRole('radiogroup', { name: 'Transition' });
  const shuffle = page.getByRole('switch', { name: 'Shuffle' });
  await expect(transition.getByRole('radio', { name: 'Cut' })).toBeChecked();
  await expect(shuffle).not.toBeChecked();
  await transition.getByRole('radio', { name: 'Fade' }).check();
  await shuffle.check();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('playlist-editor-save-state')).toHaveText('Saved');

  await page.reload();
  await expect(transition.getByRole('radio', { name: 'Fade' })).toBeChecked();
  await expect(shuffle).toBeChecked();
  const stored = (await (await operator.api.get(`/api/playlists/${screen.playlistId}`)).json()) as {
    transition: string;
    shuffle: boolean;
  };
  expect(stored).toMatchObject({ transition: 'fade', shuffle: true });

  // Unsaved edits go back to what was saved.
  await transition.getByRole('radio', { name: 'Cut' }).check();
  await shuffle.uncheck();
  await page.getByTestId('playlist-editor-discard').click();
  await page
    .getByRole('dialog', { name: 'Discard your changes?' })
    .getByRole('button', { name: 'Discard changes' })
    .click();
  await expect(transition.getByRole('radio', { name: 'Fade' })).toBeChecked();
  await expect(shuffle).toBeChecked();

  await openScreenPage(page, screen.displayId);
  await expect(pushState(page)).toHaveAttribute('data-state', 'changes');
  await expect(pushState(page)).toHaveText('Changes waiting');
});

test('media details: availability window order, a valid pair, and a half-typed date', async () => {
  const page = operator.page;
  const media = images[1] as MediaItem;
  const stored = async () =>
    (await (await operator.api.get(`/api/media/${media.id}`)).json()) as {
      availableFrom: string | null;
      availableUntil: string | null;
    };
  await page.goto(`${PORTAL_URL}/media/${media.id}`);
  const form = page.getByTestId('media-detail-form');
  const from = page.getByLabel('Available from');
  const until = page.getByLabel('Available until');
  const save = page.getByRole('button', { name: 'Save', exact: true });

  await from.fill('2030-06-02T09:00');
  await until.fill('2030-06-01T09:00');
  await save.click();
  await expect(form.getByText('Must be after Available from.').first()).toBeVisible();
  expect(await stored()).toEqual(
    expect.objectContaining({ availableFrom: null, availableUntil: null }),
  );

  await until.fill('2030-06-03T09:00');
  await save.click();
  await expect(page.getByTestId('media-detail-save-state')).toHaveText('Saved');
  await page.reload();
  await expect(from).toHaveValue('2030-06-02T09:00');
  await expect(until).toHaveValue('2030-06-03T09:00');
  expect(await stored()).toMatchObject({
    availableFrom: '2030-06-02T09:00',
    availableUntil: '2030-06-03T09:00',
  });

  // Only the date part typed: the field reports '' (badInput), which must not mean "no limit".
  await until.fill('');
  await until.focus();
  await page.keyboard.type('07042031');
  expect(await until.evaluate((input: HTMLInputElement) => input.validity.badInput)).toBe(true);
  await save.click();
  await expect(
    form.getByText('Enter a full date and time, year 1000 or later.').first(),
  ).toBeVisible();
  expect(await stored()).toMatchObject({
    availableFrom: '2030-06-02T09:00',
    availableUntil: '2030-06-03T09:00',
  });
});

test('screen page, Working hours: defaults, errors, keyboard, save and 24:00', async () => {
  const page = operator.page;
  const screen = await pushedScreen('hours form');
  await openScreenPage(page, screen.displayId, 'working-hours');
  await expect(pushState(page)).toHaveAttribute('data-state', 'up_to_date');
  const alwaysOn = page.getByRole('switch', { name: 'Always on' });
  await expect(alwaysOn).toBeChecked();
  await alwaysOn.focus();
  await page.keyboard.press('Space');
  await expect(alwaysOn).not.toBeChecked();

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  for (const [index, day] of days.entries()) {
    const open = index < 5;
    await expect(page.getByRole('checkbox', { name: day, exact: true })).toBeChecked({
      checked: open,
    });
    await expect(page.getByLabel(`${day} start`, { exact: true })).toHaveValue('09:00');
    await expect(page.getByLabel(`${day} end`, { exact: true })).toHaveValue('17:00');
  }

  // Keyboard: Tab from Always on reaches every control in order (closed days' times are disabled).
  const reached: string[] = [];
  for (let step = 0; step < 60 && reached.at(-1) !== 'Save working hours'; step += 1) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(() => {
      const active = document.activeElement as HTMLInputElement | null;
      if (active === null) return '';
      return (
        active.getAttribute('aria-label') ??
        active.labels?.[0]?.textContent?.trim() ??
        active.textContent?.trim() ??
        ''
      );
    });
    if (name !== reached.at(-1)) reached.push(name);
  }
  const expected = [
    ...days.slice(0, 5).flatMap((day) => [day, `${day} start`, `${day} end`]),
    'Saturday',
    'Sunday',
    'Save working hours',
  ];
  expect(reached.filter((name) => expected.includes(name))).toEqual(expected);

  const saveHours = page.getByTestId('screen-detail-working-hours-save');
  await page.getByLabel('Monday end', { exact: true }).fill('08:00');
  await saveHours.click();
  await expect(page.getByText('End must be after start.')).toBeVisible();
  await page.getByLabel('Monday end', { exact: true }).fill('17:00');

  for (const day of days.slice(0, 5))
    await page.getByRole('checkbox', { name: day, exact: true }).uncheck();
  await saveHours.click();
  await expect(page.getByText('Choose at least one day, or turn on Always on.')).toBeVisible();

  for (const day of days.slice(0, 5))
    await page.getByRole('checkbox', { name: day, exact: true }).check();
  await page.getByLabel('Friday end', { exact: true }).fill('00:00');
  await saveHours.click();
  await expect(
    page.getByRole('region', { name: 'Notifications' }).getByText('Working hours saved'),
  ).toBeVisible();
  const saved = (await (await operator.api.get(`/api/displays/${screen.displayId}`)).json()) as {
    workingHours: ({ start: string; end: string } | null)[] | null;
  };
  expect(saved.workingHours).toEqual([
    ...Array.from({ length: 4 }, () => ({ start: '09:00', end: '17:00' })),
    { start: '09:00', end: '24:00' },
    null,
    null,
  ]);

  await page.reload();
  await expect(alwaysOn).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Saturday', exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Friday end', { exact: true })).toHaveValue('00:00');
  await expect(pushState(page)).toHaveAttribute('data-state', 'changes');
  await expect(pushState(page)).toHaveText('Changes waiting');
});

test('screen page, Canvas: rotation 90° clockwise persists and gives changes waiting', async () => {
  const page = operator.page;
  const screen = await pushedScreen('rotation');
  await openScreenPage(page, screen.displayId, 'canvas');
  await expect(pushState(page)).toHaveAttribute('data-state', 'up_to_date');
  const rotation = page.getByLabel('Rotation', { exact: true });
  await rotation.selectOption({ label: '90° clockwise' });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('region', { name: 'Notifications' }).getByText(/^Canvas saved/),
  ).toBeVisible();
  await page.reload();
  await expect(rotation).toHaveValue('90');
  const saved = (await (await operator.api.get(`/api/displays/${screen.displayId}`)).json()) as {
    rotation: number;
  };
  expect(saved.rotation).toBe(90);
  await expect(pushState(page)).toHaveAttribute('data-state', 'changes');
});
