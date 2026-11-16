/**
 * Stage B, slice 2 in the real browser player (docs/portal-v2/stage-b.md, slice 2, sections 7
 * and 9): built-in apps drawn by the player itself. One paired player; the screen's canvas is
 * changed between tests and pushed again, so rotation-free geometry, the content rectangle and
 * every app are checked on the same page, which must never report a CSP violation.
 *
 * The player context runs in UTC, so a clock that matches the site's zone (Australia/Melbourne)
 * proves the manifest zone is used and not the device's. Apps are created through the API here;
 * the portal journey (08) creates them through the UI.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encodePng } from '../support/png.ts';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import type { MediaItem } from './support/operator.ts';
import { elementBox, expectPhase, openPlayer, pairingCode, readRecord } from './support/player.ts';
import { cspViolations, watchCspViolations } from './support/portal.ts';

test.describe.configure({ mode: 'serial' });

const runId = randomUUID().slice(0, 8);
const SITE_ZONE = 'Australia/Melbourne';
const VIEWPORT = { width: 1280, height: 720 };
const STYLE = { textColour: '#ffffff', backgroundColour: '#000000' };

let operator: OperatorSession;
let playerContext: BrowserContext;
let player: Page;
let displayId = '';
let images: MediaItem[] = [];

interface Shown {
  readonly kind: string;
  readonly appType: string | null;
  readonly assetId: string | null;
}

interface LayerLog {
  readonly shown: Shown[];
  /** Moments with no revealed layer on the stage. */
  readonly gaps: string[];
}

/** Starts (or restarts) a log of every item the player reveals and every blank moment. */
async function startLayerLog(): Promise<void> {
  await player.evaluate(() => {
    const store = window as unknown as { __log?: LayerLog; __logObserver?: MutationObserver };
    store.__logObserver?.disconnect();
    const log: LayerLog = { shown: [], gaps: [] };
    store.__log = log;
    store.__logObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type !== 'attributes' || record.attributeName !== 'data-testid') continue;
        const layer = record.target as HTMLElement;
        if (layer.getAttribute('data-testid') !== 'active-layer') continue;
        if (record.oldValue === 'active-layer') continue;
        log.shown.push({
          kind: layer.dataset['kind'] ?? '',
          appType: layer.dataset['appType'] ?? null,
          assetId: layer.dataset['assetId'] ?? null,
        });
      }
      const shown = document.querySelector('[data-testid="active-layer"]');
      if (shown === null || shown.classList.contains('pending')) {
        log.gaps.push(`blank at ${performance.now()}`);
      }
    });
    store.__logObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-testid', 'class', 'hidden'],
      attributeOldValue: true,
    });
  });
}

function layerLog(): Promise<LayerLog> {
  return player.evaluate(
    () => (window as unknown as { __log?: LayerLog }).__log ?? { shown: [], gaps: [] },
  );
}

/** Waits until the log holds at least `count` reveals and returns it. */
async function waitForShown(count: number, timeout = 90_000): Promise<LayerLog> {
  await expect
    .poll(async () => (await layerLog()).shown.length, { timeout })
    .toBeGreaterThanOrEqual(count);
  return layerLog();
}

/** The revealed layer of one app type (matches only while that app is on screen). */
function appLayer(type: string) {
  return player.locator(`[data-testid="active-layer"][data-app-type="${type}"]`);
}

interface StoredManifest {
  readonly manifest: {
    readonly publicationId: string;
    readonly schemaVersion: number;
    readonly assets: readonly { kind: string; assetId?: string; appId?: string }[];
  };
}

type Item =
  { mediaId: string; durationMs: number; fit: null } | { appId: string; durationMs: number };

async function playlistOf(label: string, items: readonly Item[]): Promise<string> {
  const name = `ZZ apps ${label} ${runId}`;
  const { id } = await operator.api.createPlaylist(name);
  await operator.api.savePlaylist(id, name, items);
  return id;
}

async function app(
  type: string,
  settings: Record<string, string | boolean>,
): Promise<{ id: string }> {
  return operator.api.createApp({
    name: `ZZ apps ${type} ${runId}`,
    content: { type, settings: { ...settings, ...STYLE } },
  });
}

/** Publishes a playlist to the paired screen and waits until the player has adopted it. */
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
  expect(stored.manifest.schemaVersion).toBe(3);
  return stored.manifest;
}

async function setCanvas(
  canvas: { width: number; height: number },
  contentRect: { x: number; y: number; width: number; height: number } | null,
): Promise<void> {
  const response = await operator.api.patch(`/api/displays/${displayId}`, {
    canvas,
    contentRect,
  });
  expect(response.status(), await response.text()).toBe(200);
}

function expectBox(
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number },
  what: string,
): void {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual[key] - expected[key]), `${what} ${key}: ${actual[key]}`).toBeLessThan(
      1.5,
    );
  }
}

/** The running animations inside the ticker on screen, and where its track is now and 500 ms later. */
function tickerMotion(): Promise<{
  running: number;
  track: { top: number; bottom: number; x: number } | null;
  laterX: number | null;
}> {
  return player.evaluate(async () => {
    const layer = document.querySelector('[data-testid="active-layer"][data-app-type="ticker"]');
    if (layer === null) return { running: 0, track: null, laterX: null };
    const animated = [...layer.querySelectorAll<HTMLElement>('*')].filter((el) =>
      el.getAnimations().some((animation) => animation.playState === 'running'),
    );
    // The scrolling track, or (still ticker) the text block.
    const line =
      animated[0] ??
      [...layer.querySelectorAll<HTMLElement>('div')].find(
        (el) => el.childElementCount === 0 && (el.textContent ?? '') !== '',
      );
    if (line === undefined) return { running: animated.length, track: null, laterX: null };
    const first = line.getBoundingClientRect();
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      running: animated.length,
      track: { top: first.top, bottom: first.bottom, x: first.x },
      laterX: line.isConnected ? line.getBoundingClientRect().x : null,
    };
  });
}

test.beforeAll(async ({ browser }) => {
  operator = await operatorSession(browser, 'operator');
  const sites = (await (await operator.api.get('/api/sites')).json()) as {
    items: { timezone: string }[];
  };
  expect(sites.items[0]?.timezone, 'the seeded site is in Melbourne').toBe(SITE_ZONE);

  playerContext = await browser.newContext({
    viewport: VIEWPORT,
    timezoneId: 'UTC',
    reducedMotion: 'no-preference',
  });
  player = await playerContext.newPage();
  await watchCspViolations(player);
  images = [];
  for (let index = 0; index < 2; index += 1) {
    const mark = Buffer.from(`${runId}${index}`, 'utf8');
    const png = encodePng(64, 36, (x, y) =>
      y === 0 && x < mark.length ? [mark[x] ?? 0, 0, 0] : [40 + index * 120, 90, x * 3],
    );
    images.push(await operator.api.uploadReady(`ZZ apps ${index} ${runId}.png`, 'image/png', png));
  }
  const display = await operator.api.createDisplay({
    name: `ZZ apps player ${runId}`,
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

test("a Clock shows the site's time between two images, and the player reports the app's index", async () => {
  const [a, b] = images as [MediaItem, MediaItem];
  const clock = await app('clock', { hourCycle: '12', showSeconds: false });
  const playlistId = await playlistOf('clock', [
    { mediaId: a.id, durationMs: 4_000, fit: null },
    // Longer than the 15 s heartbeat, so one heartbeat is sent while the app is on screen.
    { appId: clock.id, durationMs: 20_000 },
    { mediaId: b.id, durationMs: 4_000, fit: null },
  ]);
  const manifest = await pushAndAdopt(playlistId);
  expect(manifest.assets.map((item) => item.kind)).toEqual(['image', 'app', 'image']);
  await expectPhase(player, 'playing');
  await startLayerLog();

  const layer = appLayer('clock');
  await expect(layer).toHaveCount(1, { timeout: 60_000 });
  // Normalise the (narrow) no-break spaces ICU puts before am/pm.
  const text = ((await layer.textContent()) ?? '').replace(/\s/g, ' ').trim();
  expect(text).toMatch(/^\d{1,2}:\d{2} (am|pm)$/);
  const zoneClock = new Intl.DateTimeFormat('en-AU', {
    timeZone: SITE_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  });
  const now = Date.now();
  const expected = [now - 60_000, now, now + 60_000].map((t) =>
    zoneClock.format(t).replace(/\s/g, ' '),
  );
  expect(expected, `the clock shows ${text}`).toContain(text);

  // On screen: image, then the app, then the other image, with no blank moment between.
  // Five reveals hold image, app, image in order wherever the log started.
  const log = await waitForShown(5);
  const sequence = log.shown.map((shown) => shown.appType ?? shown.assetId);
  const order = [manifest.assets[0]?.assetId, 'clock', manifest.assets[2]?.assetId];
  const start = sequence.findIndex((_, i) => order.every((id, k) => sequence[i + k] === id));
  expect(start, `sequence ${JSON.stringify(sequence)}`).toBeGreaterThanOrEqual(0);
  expect(log.gaps).toEqual([]);

  // The player's own report: the app's position in the playlist.
  await operator.api.waitForStatus(
    displayId,
    'the app as the active item',
    (status) =>
      status.active?.publicationId === manifest.publicationId && status.active.itemIndex === 1,
  );
});

test('a Countdown with a past target shows the finished text; a QR code is drawn as SVG', async () => {
  const countdown = await app('countdown', {
    target: '2025-01-01T09:00',
    label: 'Doors open in',
    finishedText: 'Doors are open',
    showSeconds: true,
  });
  const qr = await app('qr', { content: 'https://tinnox.com.au', caption: 'Scan me' });
  const playlistId = await playlistOf('countdown qr', [
    { appId: countdown.id, durationMs: 5_000 },
    { appId: qr.id, durationMs: 5_000 },
  ]);
  await pushAndAdopt(playlistId);

  const finished = appLayer('countdown');
  await expect(finished).toHaveText('Doors are open', { timeout: 30_000 });
  await expect(finished).not.toContainText('Doors open in');

  const code = appLayer('qr');
  await expect(code.locator('svg[aria-hidden="true"] path')).toHaveCount(1, { timeout: 30_000 });
  expect(await code.locator('svg path').getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/);
  await expect(code).toContainText('Scan me');
});

test('on a 3840x480 strip the ticker runs inside the content rectangle, and stands still with reduced motion', async () => {
  // Viewport 1280x720: the canvas is drawn at a third, 1280x160 at (0, 280).
  const contentRect = { x: 240, y: 30, width: 3360, height: 420 };
  await setCanvas({ width: 3840, height: 480 }, contentRect);
  const ticker = await app('ticker', {
    text: 'Welcome to TINNOX. Opening hours today: 9 am to 5 pm.',
    speed: 'medium',
  });
  const playlistId = await playlistOf('ticker', [{ appId: ticker.id, durationMs: 10_000 }]);
  await pushAndAdopt(playlistId);
  await expect(appLayer('ticker')).toHaveCount(1, { timeout: 60_000 });

  const content = { x: 80, y: 290, width: 1120, height: 140 };
  expectBox(
    await elementBox(player, 'canvas'),
    { x: 0, y: 280, width: 1280, height: 160 },
    'canvas',
  );
  expectBox(await elementBox(player, 'content'), content, 'content rectangle');
  expectBox(await elementBox(player, 'active-layer'), content, 'ticker layer');

  let moving = await tickerMotion();
  // The 10 s item may end between the two readings; read again on the next one.
  if (moving.laterX === null) moving = await tickerMotion();
  expect(moving.running).toBe(1);
  expect(moving.track).not.toBeNull();
  expect(moving.track!.top).toBeGreaterThanOrEqual(content.y - 1);
  expect(moving.track!.bottom).toBeLessThanOrEqual(content.y + content.height + 1);
  // It moves (a loop restart may move it right once, so the direction is not checked).
  expect(Math.abs((moving.laterX ?? moving.track!.x) - moving.track!.x)).toBeGreaterThan(5);

  // The next time the ticker is drawn, the player reads the media query again.
  await player.emulateMedia({ reducedMotion: 'reduce' });
  await startLayerLog();
  await waitForShown(1, 30_000);
  const still = await tickerMotion();
  expect(still.running).toBe(0);
  expect(still.track).not.toBeNull();
  expect(still.laterX).toBe(still.track!.x);
  expect(still.track!.top).toBeGreaterThanOrEqual(content.y - 1);
  expect(still.track!.bottom).toBeLessThanOrEqual(content.y + content.height + 1);
  await player.emulateMedia({ reducedMotion: 'no-preference' });
});

test('on a 1376x774 canvas the Text app fits without overflow', async () => {
  await setCanvas({ width: 1376, height: 774 }, null);
  const text = await app('text', {
    heading: 'Welcome to the showroom',
    body: 'Coffee and tea are on the ground floor.\nThe workshop starts at 2 pm in room 3.',
  });
  const playlistId = await playlistOf('text', [{ appId: text.id, durationMs: 10_000 }]);
  await pushAndAdopt(playlistId);
  const layer = appLayer('text');
  await expect(layer).toContainText('Welcome to the showroom', { timeout: 60_000 });

  const fit = await layer.evaluate((holder) => {
    const box = holder.getBoundingClientRect();
    const lines = [...holder.querySelectorAll<HTMLElement>('div')].filter(
      (el) => el.childElementCount === 0 && (el.textContent ?? '') !== '',
    );
    return {
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      lines: lines.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
        };
      }),
    };
  });
  expect(fit.lines).toHaveLength(2);
  for (const line of fit.lines) {
    expect(line.clipped, JSON.stringify(line)).toBe(false);
    expect(line.left).toBeGreaterThanOrEqual(fit.box.left - 1);
    expect(line.top).toBeGreaterThanOrEqual(fit.box.top - 1);
    expect(line.right).toBeLessThanOrEqual(fit.box.right + 1);
    expect(line.bottom).toBeLessThanOrEqual(fit.box.bottom + 1);
  }
});

test('on a screen rotated 90 degrees the ticker travels one whole copy at its speed', async () => {
  // A portrait canvas turned clockwise by a CSS transform: measurements taken after transforms
  // would see each copy's height instead of its width.
  const patched = await operator.api.patch(`/api/displays/${displayId}`, {
    canvas: { width: 1080, height: 1920 },
    contentRect: null,
    rotation: 90,
  });
  expect(patched.status(), await patched.text()).toBe(200);
  const ticker = await app('ticker', {
    text: 'Welcome to the annual general meeting of members, in the main hall at 6 pm.',
    speed: 'medium',
  });
  const playlistId = await playlistOf('ticker rotated', [{ appId: ticker.id, durationMs: 10_000 }]);
  await pushAndAdopt(playlistId);
  const layer = appLayer('ticker');
  await expect(layer).toHaveCount(1, { timeout: 60_000 });

  const motion = await layer.evaluate((holder) => {
    const track = [...holder.querySelectorAll<HTMLElement>('div')].find(
      (el) => el.getAnimations().length > 0,
    );
    const animation = track?.getAnimations()[0];
    const copy = track?.firstElementChild;
    if (animation === undefined || !(copy instanceof HTMLElement)) return null;
    const effect = animation.effect as KeyframeEffect;
    const end = String(effect.getKeyframes()[1]?.['transform'] ?? '');
    return {
      distance: -Number(/translateX\((-?[\d.]+)px\)/.exec(end)?.[1] ?? 'NaN'),
      copyWidth: copy.offsetWidth,
      shortSide: Math.min(
        (holder as HTMLElement).offsetWidth,
        (holder as HTMLElement).offsetHeight,
      ),
      fontPx: Number.parseFloat(getComputedStyle(track!).fontSize),
      duration: Number(effect.getTiming().duration),
    };
  });
  expect(motion, 'the ticker track is animated').not.toBeNull();
  const { distance, copyWidth, shortSide, fontPx, duration } = motion!;
  expect(Math.abs(distance - copyWidth), `distance ${distance}, copy ${copyWidth}`).toBeLessThan(1);
  expect(distance, `short side ${shortSide}`).toBeGreaterThan(3 * shortSide);
  // Medium is 3 character heights per second.
  const expected = (copyWidth / (3 * fontPx)) * 1000;
  expect(Math.abs(duration - expected), `duration ${duration}, expected ${expected}`).toBeLessThan(
    expected * 0.01,
  );
});

test('the player saw no Content-Security-Policy violation while drawing apps', async () => {
  expect(await cspViolations(player)).toEqual([]);
});
