/**
 * Stage B, slice 3 in the real browser player (docs/portal-v2/stage-b.md, slice 3, sections 6
 * and 8): a schedule with a default playlist and one weekly event, pushed as manifest v4 to one
 * paired player, which picks the playlist itself.
 *
 * The player corrects its clock from the server's time, so a faked browser clock would not move
 * it (see the header of 06): the events here either cover every moment or a weekday three days
 * away in the site's zone (Australia/Melbourne), so no case can flip at midnight. The crossing
 * of an event edge is unit-tested only (apps/player-web/src/core/playback.test.ts). Schedules
 * are made through the API here; the portal journey (09) makes them through the UI.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encodePng } from '../support/png.ts';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import type { MediaItem, ScheduleInput } from './support/operator.ts';
import {
  expectPhase,
  observePlayback,
  openPlayer,
  pairingCode,
  readRecord,
  waitForLayer,
} from './support/player.ts';
import { cspViolations, watchCspViolations } from './support/portal.ts';

test.describe.configure({ mode: 'serial' });

const runId = randomUUID().slice(0, 8);
const SITE_ZONE = 'Australia/Melbourne';
const EVERY_DAY = [true, true, true, true, true, true, true];
const SCHEDULE_NAME = `ZZ sched ${runId}`;

let operator: OperatorSession;
let playerContext: BrowserContext;
let player: Page;
let displayId = '';
let scheduleId = '';
/** Playlist A (the default) holds image A; playlist B (the event's) holds image B. */
let imageA: MediaItem;
let imageB: MediaItem;
let playlistA = '';
let playlistB = '';

interface StoredManifest {
  readonly manifest: {
    readonly publicationId: string;
    readonly schemaVersion: number;
    readonly assets: readonly { kind: string; assetId?: string }[];
    readonly schedule?: {
      readonly playlists: readonly { count: number }[];
      readonly events: readonly { playlist: number; days: boolean[]; start: string; end: string }[];
    };
  };
}

async function playlistOf(label: string, media: MediaItem): Promise<string> {
  const name = `ZZ sched ${label} ${runId}`;
  const { id } = await operator.api.createPlaylist(name);
  await operator.api.savePlaylist(id, name, [{ mediaId: media.id, durationMs: 2_000, fit: null }]);
  return id;
}

function scheduleWith(events: ScheduleInput['events']): ScheduleInput {
  return { name: SCHEDULE_NAME, defaultPlaylistId: playlistA, events };
}

/** Pushes the screen's assigned content and waits until the player has adopted the publication. */
async function pushAndAdopt(): Promise<StoredManifest['manifest']> {
  const response = await operator.api.post(
    '/api/push',
    { displayIds: [displayId] },
    { 'idempotency-key': randomUUID() },
  );
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as {
    results: { outcome: string; publicationId: string | null }[];
  };
  expect(body.results[0]?.outcome).toBe('published');
  const publicationId = body.results[0]?.publicationId;
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

/** Waits for `expected` on screen, then watches: nothing else and no blank moment for a while. */
async function expectOnly(expected: MediaItem, what: string): Promise<void> {
  await waitForLayer(player, what, (info) => info.assetId === expected.id);
  const watched = await observePlayback(player, 6_000);
  expect(watched.sequence, what).toEqual([expected.id]);
  expect(watched.blankSamples, `blank samples of ${watched.samples}`).toBe(0);
}

/**
 * Opens the player's diagnostics panel ("d"), reads the value of one row and closes it again.
 * The panel refreshes every second, so the value is polled until it is `expected`.
 */
async function expectDiagnostics(label: string, expected: string | RegExp): Promise<void> {
  const panel = player.getByTestId('diagnostics');
  await player.keyboard.press('d');
  await expect(panel).toBeVisible();
  await expect(panel.locator(`dt:text-is("${label}") + dd`)).toHaveText(expected);
  await player.keyboard.press('d');
  await expect(panel).toBeHidden();
}

/** The weekday (0 is Monday) `daysAhead` days from today on the site's wall clock. */
function siteWeekday(daysAhead: number): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: SITE_ZONE, weekday: 'short' }).format(
    Date.now(),
  );
  const today = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(short);
  expect(today, `weekday ${short}`).toBeGreaterThanOrEqual(0);
  return (today + daysAhead) % 7;
}

test.beforeAll(async ({ browser }) => {
  operator = await operatorSession(browser, 'operator');
  const sites = (await (await operator.api.get('/api/sites')).json()) as {
    items: { timezone: string }[];
  };
  expect(sites.items[0]?.timezone, 'the seeded site is in Melbourne').toBe(SITE_ZONE);

  // The device is in UTC, so a rule that follows the site's zone is not the device's.
  playerContext = await browser.newContext({
    viewport: { width: 640, height: 360 },
    timezoneId: 'UTC',
  });
  player = await playerContext.newPage();
  await watchCspViolations(player);
  const uploaded: MediaItem[] = [];
  for (let index = 0; index < 2; index += 1) {
    const mark = Buffer.from(`${runId}${index}`, 'utf8');
    const png = encodePng(64, 36, (x, y) =>
      y === 0 && x < mark.length ? [mark[x] ?? 0, 0, 0] : [40 + index * 120, 90, x * 3],
    );
    uploaded.push(
      await operator.api.uploadReady(`ZZ sched ${index} ${runId}.png`, 'image/png', png),
    );
  }
  [imageA, imageB] = uploaded as [MediaItem, MediaItem];
  playlistA = await playlistOf('A', imageA);
  playlistB = await playlistOf('B', imageB);

  const display = await operator.api.createDisplay({
    name: `ZZ sched player ${runId}`,
    canvas: { width: 1920, height: 1080 },
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

test('an event that covers every moment plays its playlist, from a version 4 manifest', async () => {
  const schedule = await operator.api.createSchedule(
    scheduleWith([{ playlistId: playlistB, days: EVERY_DAY, start: '00:00', end: '24:00' }]),
  );
  scheduleId = schedule.id;
  await operator.api.assignSchedule(displayId, scheduleId);

  const manifest = await pushAndAdopt();
  expect(manifest.schemaVersion).toBe(4);
  // One flat list, the default playlist first; the event names the second playlist.
  expect(manifest.assets.map((item) => item.assetId)).toEqual([imageA.id, imageB.id]);
  expect(manifest.schedule?.playlists.map((playlist) => playlist.count)).toEqual([1, 1]);
  expect(manifest.schedule?.events).toEqual([
    { playlist: 1, days: EVERY_DAY, start: '00:00', end: '24:00' },
  ]);

  await expectPhase(player, 'playing');
  await expectOnly(imageB, "the event playlist's image");
  // The player's own report: the flat index, counted across both playlists.
  await operator.api.waitForStatus(
    displayId,
    "the event playlist's item as the active item",
    (status) =>
      status.active?.publicationId === manifest.publicationId && status.active.itemIndex === 1,
  );
  // What the events ask for at the player's corrected clock, and the build that can read them.
  await expectDiagnostics('Schedule picks', 'playlist 2 of 2');
  await expectDiagnostics('Build', /^player-web\/0\.4\.0/);
});

test('an event on another weekday leaves the default playlist on screen', async () => {
  const days = EVERY_DAY.map((_, day) => day === siteWeekday(3));
  await operator.api.replaceSchedule(
    scheduleId,
    scheduleWith([{ playlistId: playlistB, days, start: '00:00', end: '24:00' }]),
  );

  const manifest = await pushAndAdopt();
  // Still a schedule with a second playlist: both images were staged, the default one plays.
  expect(manifest.schemaVersion).toBe(4);
  expect(manifest.assets.map((item) => item.assetId)).toEqual([imageA.id, imageB.id]);
  expect(manifest.schedule?.events).toEqual([{ playlist: 1, days, start: '00:00', end: '24:00' }]);

  await expectOnly(imageA, "the default playlist's image");
  await operator.api.waitForStatus(
    displayId,
    "the default playlist's item as the active item",
    (status) =>
      status.active?.publicationId === manifest.publicationId && status.active.itemIndex === 0,
  );
  await expectDiagnostics('Schedule picks', 'default playlist');
});

test('a schedule without events is pushed as its default playlist, below version 4', async () => {
  await operator.api.replaceSchedule(scheduleId, scheduleWith([]));

  const manifest = await pushAndAdopt();
  expect(manifest.schemaVersion).toBeLessThan(4);
  expect(manifest.schedule).toBeUndefined();
  expect(manifest.assets.map((item) => item.assetId)).toEqual([imageA.id]);

  await expectOnly(imageA, "the default playlist's image");
  await expectDiagnostics('Schedule picks', '— (no schedule)');
});

test('the player saw no Content-Security-Policy violation while playing a schedule', async () => {
  expect(await cspViolations(player)).toEqual([]);
});
