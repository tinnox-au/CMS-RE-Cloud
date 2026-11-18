/**
 * Stage B, slice 4 in the real browser player (docs/portal-v2/stage-b.md, slice 4, sections 6
 * and 8; PL-04 at docs/acceptance-tests.md:77): a layout with a main zone (one image) and a band
 * along the bottom (one Ticker app), pushed as manifest v5 to one paired player. The screen's
 * canvas is changed between tests and pushed again, so every shape is checked on the same page,
 * which must never report a CSP violation.
 *
 * Geometry is computed here and not with the player's code: the zone rectangles are worked out
 * by hand, then scaled and turned as the page lays the canvas out. Layouts are made through the
 * API here; the portal journey (12) makes them through the UI.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encodePng } from '../support/png.ts';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import { bandLayout, type MediaItem } from './support/operator.ts';
import {
  expectPhase,
  openPlayer,
  pairingCode,
  readRecord,
  waitForLayer,
  zoneBox,
} from './support/player.ts';
import { cspViolations, watchCspViolations } from './support/portal.ts';

test.describe.configure({ mode: 'serial' });

const runId = randomUUID().slice(0, 8);
const VIEWPORT = { width: 1280, height: 720 };
const LAYOUT_NAME = `ZZ layout ${runId}`;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Shape {
  readonly canvas: { width: number; height: number };
  readonly contentRect: Rect | null;
  readonly rotation: 0 | 90;
}

interface Case extends Shape {
  readonly label: string;
  /** The two zones in canvas pixels with a 15 % band: edges rounded from basis points of the content area. */
  readonly main: Rect;
  readonly band: Rect;
}

const LANDSCAPE = { width: 1920, height: 1080 };
const PORTRAIT: Shape = { canvas: { width: 1080, height: 1920 }, contentRect: null, rotation: 0 };

const CASES: readonly Case[] = [
  {
    label: 'landscape 1920x1080',
    canvas: LANDSCAPE,
    contentRect: null,
    rotation: 0,
    // 1080 × 0.85 = 918.
    main: { x: 0, y: 0, width: 1920, height: 918 },
    band: { x: 0, y: 918, width: 1920, height: 162 },
  },
  {
    label: 'portrait 1080x1920',
    ...PORTRAIT,
    // 1920 × 0.85 = 1632.
    main: { x: 0, y: 0, width: 1080, height: 1632 },
    band: { x: 0, y: 1632, width: 1080, height: 288 },
  },
  {
    label: 'landscape 1920x1080 turned 90 degrees',
    canvas: LANDSCAPE,
    contentRect: null,
    rotation: 90,
    main: { x: 0, y: 0, width: 1920, height: 918 },
    band: { x: 0, y: 918, width: 1920, height: 162 },
  },
  {
    label: 'strip 3840x480 with a content rectangle',
    canvas: { width: 3840, height: 480 },
    contentRect: { x: 240, y: 30, width: 3360, height: 420 },
    rotation: 0,
    // Inside the content rectangle: 30 + round(420 × 0.85) = 387.
    main: { x: 240, y: 30, width: 3360, height: 357 },
    band: { x: 240, y: 387, width: 3360, height: 63 },
  },
];

let operator: OperatorSession;
let playerContext: BrowserContext;
let player: Page;
let displayId = '';
let layoutId = '';
let image: MediaItem;
let mainPlaylist = '';
let bandPlaylist = '';

interface StoredManifest {
  readonly manifest: {
    readonly publicationId: string;
    readonly schemaVersion: number;
    readonly assets: readonly { kind: string }[];
    readonly zones?: readonly { rect: Rect; count: number }[];
  };
}

/** Where a canvas rectangle lands in the window: scaled to fit and centred, turned for 90. */
function onScreen(shape: Shape, rect: Rect): Rect {
  const turned = shape.rotation === 90;
  // A screen on its side: the canvas is laid out in the turned frame, then turned clockwise.
  const frame = turned ? { width: VIEWPORT.height, height: VIEWPORT.width } : VIEWPORT;
  const { canvas } = shape;
  const scale = Math.min(frame.width / canvas.width, frame.height / canvas.height);
  const u = (frame.width - canvas.width * scale) / 2 + rect.x * scale;
  const v = (frame.height - canvas.height * scale) / 2 + rect.y * scale;
  const width = rect.width * scale;
  const height = rect.height * scale;
  // Clockwise about the top-left corner, then moved right by the window's width.
  return turned
    ? { x: VIEWPORT.width - v - height, y: u, width: height, height: width }
    : { x: u, y: v, width, height };
}

/** Waits until a zone's box is where `expected` says, within 1 px (a zone moves at its next item). */
async function expectZone(zone: number, expected: Rect, what: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const box = await zoneBox(player, zone).catch(() => null);
        if (box === null) return Number.POSITIVE_INFINITY;
        return Math.max(
          ...(['x', 'y', 'width', 'height'] as const).map((key) =>
            Math.abs(box[key] - expected[key]),
          ),
        );
      },
      { message: `${what} at ${JSON.stringify(expected)}`, timeout: 30_000 },
    )
    .toBeLessThanOrEqual(1);
}

async function setShape({ canvas, contentRect, rotation }: Shape): Promise<void> {
  const response = await operator.api.patch(`/api/displays/${displayId}`, {
    canvas,
    contentRect,
    rotation,
  });
  expect(response.status(), await response.text()).toBe(200);
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

/**
 * The moving ticker in the band: its font size, the size render.ts:238 gives its box
 * (min(0.6·h, 0.25·w) of the root's layout pixels less a 4 % gap), and whether the app fills
 * the band's box. Null while no moving ticker is on screen.
 */
function tickerFont(): Promise<{ font: number; expected: number; fills: boolean } | null> {
  return player.evaluate(() => {
    const band = document.querySelector<HTMLElement>('[data-testid="zone-1"]');
    const layer = document.querySelector<HTMLElement>(
      '[data-testid="zone-1-active-layer"][data-app-type="ticker"]',
    );
    const root = layer?.firstElementChild;
    const track = [...(layer?.querySelectorAll<HTMLElement>('div') ?? [])].find(
      (el) => el.getAnimations().length > 0,
    );
    if (band === null || !(root instanceof HTMLElement) || track === undefined) return null;
    const gap = Math.round(0.04 * Math.min(root.clientWidth, root.clientHeight));
    return {
      font: Number.parseFloat(getComputedStyle(track).fontSize),
      expected: Math.min(0.6 * (root.clientHeight - 2 * gap), 0.25 * (root.clientWidth - 2 * gap)),
      fills:
        Math.abs(root.clientWidth - band.clientWidth) <= 1 &&
        Math.abs(root.clientHeight - band.clientHeight) <= 1,
    };
  });
}

/** The ticker in the band: running animations, the line boxes of its text and the band's box. */
function tickerText(): Promise<{ running: number; lines: Rect[]; band: Rect } | null> {
  return player.evaluate(() => {
    const band = document.querySelector<HTMLElement>('[data-testid="zone-1"]');
    const layer = document.querySelector<HTMLElement>(
      '[data-testid="zone-1-active-layer"][data-app-type="ticker"]',
    );
    if (band === null || layer === null) return null;
    const running = [...layer.querySelectorAll('*')].filter((el) =>
      el.getAnimations().some((animation) => animation.playState === 'running'),
    ).length;
    const lines: Rect[] = [];
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if ((node.textContent ?? '').trim() === '') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        lines.push({ x: r.x, y: r.y, width: r.width, height: r.height });
      }
    }
    const b = band.getBoundingClientRect();
    return { running, lines, band: { x: b.x, y: b.y, width: b.width, height: b.height } };
  });
}

test.beforeAll(async ({ browser }) => {
  operator = await operatorSession(browser, 'operator');
  playerContext = await browser.newContext({
    viewport: VIEWPORT,
    reducedMotion: 'no-preference',
  });
  player = await playerContext.newPage();
  await watchCspViolations(player);

  const mark = Buffer.from(runId, 'utf8');
  const png = encodePng(64, 36, (x, y) =>
    y === 0 && x < mark.length ? [mark[x] ?? 0, 0, 0] : [160, 90, x * 3],
  );
  image = await operator.api.uploadReady(`ZZ layout ${runId}.png`, 'image/png', png);
  mainPlaylist = (await operator.api.createPlaylist(`ZZ layout main ${runId}`)).id;
  await operator.api.savePlaylist(mainPlaylist, `ZZ layout main ${runId}`, [
    { mediaId: image.id, durationMs: 4_000, fit: null },
  ]);
  const ticker = await operator.api.createApp({
    name: `ZZ layout ticker ${runId}`,
    content: {
      type: 'ticker',
      settings: {
        text: 'Welcome to TINNOX. Opening hours today: 9 am to 5 pm. The workshop starts at 2 pm in room 3.',
        speed: 'medium',
        textColour: '#ffffff',
        backgroundColour: '#000000',
      },
    },
  });
  bandPlaylist = (await operator.api.createPlaylist(`ZZ layout band ${runId}`)).id;
  await operator.api.savePlaylist(bandPlaylist, `ZZ layout band ${runId}`, [
    { appId: ticker.id, durationMs: 10_000 },
  ]);
  layoutId = (await operator.api.createLayout(bandLayout(LAYOUT_NAME, mainPlaylist, bandPlaylist)))
    .id;

  const display = await operator.api.createDisplay({
    name: `ZZ layout player ${runId}`,
    canvas: LANDSCAPE,
  });
  displayId = display.id;
  await openPlayer(player);
  expect((await operator.api.claim(displayId, await pairingCode(player))).status()).toBe(200);
  await expectPhase(player, 'idle');
  await operator.api.assignLayout(displayId, layoutId);
});

test.afterAll(async () => {
  await playerContext.close();
  await operator.context.close();
});

for (const testCase of CASES) {
  test(`${testCase.label}: the band plays the ticker in its own box, from a version 5 manifest`, async () => {
    await setShape(testCase);
    const manifest = await pushAndAdopt();
    expect(manifest.schemaVersion).toBe(5);
    // One flat list, the main zone first.
    expect(manifest.assets.map((item) => item.kind)).toEqual(['image', 'app']);
    expect(manifest.zones).toEqual([
      { rect: testCase.main, count: 1, transition: 'cut', shuffle: false },
      { rect: testCase.band, count: 1, transition: 'cut', shuffle: false },
    ]);
    await expectPhase(player, 'playing');

    await expectZone(0, onScreen(testCase, testCase.main), 'the main zone');
    await expectZone(1, onScreen(testCase, testCase.band), 'the band');
    await expect(
      player.locator('[data-testid="zone-1-active-layer"][data-app-type="ticker"]'),
    ).toHaveCount(1, { timeout: 30_000 });
    // The ticker refits when its box changes, so the size is read until it settles.
    await expect
      .poll(
        async () => {
          const font = await tickerFont();
          return font === null || !font.fills
            ? Number.POSITIVE_INFINITY
            : Math.abs(font.font - font.expected);
        },
        { message: 'ticker font size against its band', timeout: 30_000 },
      )
      .toBeLessThanOrEqual(0.5);

    // The main zone speaks for the screen: its image is item 0 of the flat list.
    await operator.api.waitForStatus(
      displayId,
      "the main zone's image as the active item",
      (status) =>
        status.active?.publicationId === manifest.publicationId && status.active.itemIndex === 0,
    );
  });
}

test('with reduced motion the ticker stands still and wraps inside the band on a portrait screen', async () => {
  await setShape(PORTRAIT);
  await pushAndAdopt();
  // The next time the ticker is drawn, the player reads the media query again.
  await player.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await tickerText())?.running, { timeout: 60_000 }).toBe(0);
  const still = await tickerText();
  expect(still).not.toBeNull();
  const { lines, band } = still!;
  const tops = new Set(lines.map((line) => Math.round(line.y)));
  expect(tops.size, `line boxes ${JSON.stringify(lines)}`).toBeGreaterThanOrEqual(2);
  for (const line of lines) {
    expect(line.x).toBeGreaterThanOrEqual(band.x - 1);
    expect(line.y).toBeGreaterThanOrEqual(band.y - 1);
    expect(line.x + line.width).toBeLessThanOrEqual(band.x + band.width + 1);
    expect(line.y + line.height).toBeLessThanOrEqual(band.y + band.height + 1);
  }
  await player.emulateMedia({ reducedMotion: 'no-preference' });
});

test('a new band height moves the band, and the page never holds two canvases', async () => {
  // Every mutation from now on: the most canvases the page held at once.
  await player.evaluate(() => {
    const store = window as unknown as { __maxCanvases?: number };
    const count = (): number => document.querySelectorAll('[data-testid="canvas"]').length;
    store.__maxCanvases = count();
    new MutationObserver(() => {
      store.__maxCanvases = Math.max(store.__maxCanvases ?? 0, count());
    }).observe(document.documentElement, { subtree: true, childList: true });
  });
  await operator.api.replaceLayout(
    layoutId,
    bandLayout(LAYOUT_NAME, mainPlaylist, bandPlaylist, 20),
  );
  const manifest = await pushAndAdopt();
  // 1920 × 0.8 = 1536.
  const band = { x: 0, y: 1536, width: 1080, height: 384 };
  expect(manifest.zones?.map((zone) => zone.rect)).toEqual([
    { x: 0, y: 0, width: 1080, height: 1536 },
    band,
  ]);
  await expectZone(1, onScreen(PORTRAIT, band), 'the higher band');
  expect(
    await player.evaluate(() => (window as unknown as { __maxCanvases?: number }).__maxCanvases),
  ).toBe(1);
});

test("assigning the image's playlist instead gives version 1 and takes the band away", async () => {
  const response = await operator.api.patch(`/api/displays/${displayId}`, {
    assignedPlaylistId: mainPlaylist,
  });
  expect(response.status(), await response.text()).toBe(200);
  const manifest = await pushAndAdopt();
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.zones).toBeUndefined();

  await expect(player.getByTestId('zone-1')).toHaveCount(0, { timeout: 30_000 });
  await waitForLayer(player, 'the image', (info) => info.assetId === image.id);
  await expectZone(
    0,
    onScreen(PORTRAIT, { x: 0, y: 0, width: 1080, height: 1920 }),
    'the whole canvas',
  );
});

test('the player saw no Content-Security-Policy violation while playing a layout', async () => {
  expect(await cspViolations(player)).toEqual([]);
});
