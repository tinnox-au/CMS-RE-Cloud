/**
 * Portrait and unusual LED-shaped canvases, in software only. One browser player is paired
 * with three displays in turn; between displays it is reset locally, which is also the
 * test that a reset removes the credential and every cached file before the next pairing.
 *
 * Geometry is checked two ways, both computed here and not with the player's own code:
 * the rectangles of the real elements, and the colours of real screen pixels.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encodePng, type Rgb } from '../support/png.ts';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import {
  capturePixels,
  elementBox,
  expectPhase,
  localReset,
  mediaCaches,
  openPlayer,
  pairingCode,
  playerFetch,
  readRecord,
  waitForLayer,
  type Registration,
} from './support/player.ts';
import { evidenceDir } from './support/stack.ts';

test.describe.configure({ mode: 'serial' });

const runId = randomUUID().slice(0, 8);
const VIEWPORT = { width: 1000, height: 700 };
const SOURCE = { width: 600, height: 200 };
const RED: Rgb = [220, 30, 30];
const GREEN: Rgb = [30, 180, 60];
const BLUE: Rgb = [40, 60, 220];
const BLACK: Rgb = [0, 0, 0];
const BANDS = [RED, GREEN, BLUE] as const;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Case {
  readonly label: string;
  readonly canvas: { width: number; height: number };
  readonly contentRect: Rect | null;
}

const CASES: readonly Case[] = [
  { label: 'portrait 1080x1920', canvas: { width: 1080, height: 1920 }, contentRect: null },
  { label: 'tall strip 640x1344', canvas: { width: 640, height: 1344 }, contentRect: null },
  {
    label: 'wide panel 768x448 with a content rectangle',
    canvas: { width: 768, height: 448 },
    contentRect: { x: 64, y: 32, width: 640, height: 320 },
  },
];

let operator: OperatorSession;
let playerContext: BrowserContext;
let player: Page;
let playlistId = '';
let previousToken: string | null = null;

/** Three vertical bands: red, green, blue. Which bands are visible proves the crop. */
function tricolour(): Buffer {
  // The last row carries the run id so the bytes (and the SHA-256) are new every run.
  const mark = Buffer.from(runId, 'utf8');
  return encodePng(SOURCE.width, SOURCE.height, (x, y) => {
    if (y === SOURCE.height - 1 && x < mark.length) return [mark[x] ?? 0, 0, 0];
    return BANDS[Math.min(2, Math.floor((x * 3) / SOURCE.width))] ?? BLACK;
  });
}

function expectedGeometry(testCase: Case, fit: 'contain' | 'cover') {
  const { canvas } = testCase;
  const scale = Math.min(VIEWPORT.width / canvas.width, VIEWPORT.height / canvas.height);
  const canvasBox: Rect = {
    x: (VIEWPORT.width - canvas.width * scale) / 2,
    y: (VIEWPORT.height - canvas.height * scale) / 2,
    width: canvas.width * scale,
    height: canvas.height * scale,
  };
  const rect = testCase.contentRect ?? { x: 0, y: 0, ...canvas };
  const contentBox: Rect = {
    x: canvasBox.x + rect.x * scale,
    y: canvasBox.y + rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
  const ratioX = contentBox.width / SOURCE.width;
  const ratioY = contentBox.height / SOURCE.height;
  const k = fit === 'contain' ? Math.min(ratioX, ratioY) : Math.max(ratioX, ratioY);
  const picture: Rect = {
    x: contentBox.x + (contentBox.width - SOURCE.width * k) / 2,
    y: contentBox.y + (contentBox.height - SOURCE.height * k) / 2,
    width: SOURCE.width * k,
    height: SOURCE.height * k,
  };
  return { canvasBox, contentBox, picture, k };
}

function expectBox(actual: Rect, expected: Rect, what: string): void {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual[key] - expected[key]), `${what} ${key}`).toBeLessThanOrEqual(1);
  }
}

function expectColour(actual: Rgb, expected: Rgb, what: string): void {
  for (let channel = 0; channel < 3; channel += 1) {
    expect(
      Math.abs((actual[channel] ?? 0) - (expected[channel] ?? 0)),
      `${what}: got rgb(${actual.join(',')}), expected rgb(${expected.join(',')})`,
    ).toBeLessThanOrEqual(40);
  }
}

/** Colour the screen must have at a point, from the independent geometry above. */
function colourAt(geometry: ReturnType<typeof expectedGeometry>, x: number, y: number): Rgb {
  const { contentBox, picture, k } = geometry;
  const inside = (box: Rect): boolean =>
    x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
  if (!inside(contentBox) || !inside(picture)) return BLACK;
  const sourceX = (x - picture.x) / k;
  return BANDS[Math.min(2, Math.floor((sourceX * 3) / SOURCE.width))] ?? BLACK;
}

/** Sample points well away from every edge and band boundary (scaling blurs those). */
function samplePoints(geometry: ReturnType<typeof expectedGeometry>): { x: number; y: number }[] {
  const { canvasBox, contentBox, picture, k } = geometry;
  const candidates: { x: number; y: number }[] = [];
  for (const fx of [0.04, 0.17, 0.3, 0.5, 0.7, 0.83, 0.96]) {
    for (const fy of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      candidates.push({
        x: contentBox.x + contentBox.width * fx,
        y: contentBox.y + contentBox.height * fy,
      });
      candidates.push({
        x: canvasBox.x + canvasBox.width * fx,
        y: canvasBox.y + canvasBox.height * fy,
      });
      candidates.push({ x: VIEWPORT.width * fx, y: VIEWPORT.height * fy });
    }
  }
  const margin = 5;
  const farFromEdges = (value: number, box: { start: number; size: number }): boolean =>
    Math.abs(value - box.start) > margin && Math.abs(value - (box.start + box.size)) > margin;
  return candidates.filter(({ x, y }) => {
    for (const box of [canvasBox, contentBox, picture]) {
      if (!farFromEdges(x, { start: box.x, size: box.width })) return false;
      if (!farFromEdges(y, { start: box.y, size: box.height })) return false;
    }
    for (const boundary of [SOURCE.width / 3, (SOURCE.width * 2) / 3]) {
      if (Math.abs(x - (picture.x + boundary * k)) <= margin) return false;
    }
    return x > 2 && y > 2 && x < VIEWPORT.width - 2 && y < VIEWPORT.height - 2;
  });
}

test.beforeAll(async ({ browser }) => {
  operator = await operatorSession(browser, 'operator');
  playerContext = await browser.newContext({ viewport: VIEWPORT });
  player = await playerContext.newPage();
  const media = await operator.api.uploadReady(`bands-${runId}.png`, 'image/png', tricolour());
  playlistId = (await operator.api.createPlaylist(`E2E canvases ${runId}`)).id;
  await operator.api.savePlaylist(playlistId, `E2E canvases ${runId}`, [
    { mediaId: media.id, durationMs: 4000, fit: 'contain' },
    { mediaId: media.id, durationMs: 4000, fit: 'cover' },
  ]);
});

test.afterAll(async () => {
  await playerContext.close();
  await operator.context.close();
});

for (const testCase of CASES) {
  test(`${testCase.label}: contain and cover are drawn where the geometry says`, async () => {
    const display = await operator.api.createDisplay({
      name: `E2E ${testCase.label} ${runId}`,
      canvas: testCase.canvas,
      contentRect: testCase.contentRect,
    });
    const published = await operator.api.publish(playlistId, display.id);

    if (previousToken === null) {
      await openPlayer(player);
    } else {
      // Local reset of the player that was paired with the previous display.
      const before = await mediaCaches(player);
      expect(before).toHaveLength(1);
      expect(before[0]?.entries).toBeGreaterThan(0);
      await localReset(player);
    }
    const code = await pairingCode(player);
    if (previousToken !== null) {
      // After the reset: no credential, no state, no cached media, and the old credential
      // was revoked on the server by the reset itself.
      expect(await readRecord(player, 'registration')).toBeNull();
      expect(await readRecord(player, 'activeVersion')).toBeNull();
      expect(await mediaCaches(player)).toEqual([]);
      expect((await playerFetch('/player/manifest', previousToken)).status).toBe(401);
    }
    expect((await operator.api.claim(display.id, code)).status()).toBe(200);

    await expectPhase(player, 'playing', 90_000);
    const registration = await readRecord<Registration>(player, 'registration');
    previousToken = registration?.deviceToken ?? null;
    expect(previousToken).not.toBeNull();
    // Exactly one media cache, named for this registration only.
    const caches = await mediaCaches(player);
    expect(caches).toHaveLength(1);
    expect(caches[0]?.name).toContain(registration?.registrationId ?? 'missing');

    for (const fit of ['contain', 'cover'] as const) {
      const layer = await waitForLayer(player, `the ${fit} item`, (info) => info.fit === fit);
      const pixel = await capturePixels(player);
      const geometry = expectedGeometry(testCase, fit);

      expect(layer.objectFit).toBe(fit);
      expect(layer.naturalWidth).toBe(SOURCE.width);
      expect(layer.naturalHeight).toBe(SOURCE.height);
      expectBox(await elementBox(player, 'canvas'), geometry.canvasBox, 'canvas');
      expectBox(await elementBox(player, 'content'), geometry.contentBox, 'content rectangle');
      expectBox(layer.box, geometry.contentBox, 'media element');

      const points = samplePoints(geometry);
      expect(points.length).toBeGreaterThan(30);
      const seen = new Set<string>();
      for (const point of points) {
        const expected = colourAt(geometry, point.x, point.y);
        seen.add(expected.join(','));
        expectColour(
          pixel(point.x, point.y),
          expected,
          `${fit} at (${point.x.toFixed(0)}, ${point.y.toFixed(0)})`,
        );
      }
      // The checks are not vacuous: black surround and picture were both sampled.
      expect(seen.has(BLACK.join(','))).toBe(true);
      expect(seen.size).toBeGreaterThan(1);

      const name = `canvas-${testCase.canvas.width}x${testCase.canvas.height}-${fit}.png`;
      // Take the evidence picture only while the same item is still on screen.
      const still = await waitForLayer(
        player,
        `the ${fit} item`,
        (info) => info.fit === fit,
        15_000,
      );
      expect(still.fit).toBe(fit);
      await player.screenshot({ path: join(evidenceDir, name) });
    }

    const view = await operator.api.waitForStatus(
      display.id,
      'in sync',
      (status) =>
        status.summary === 'in_sync' && status.active?.publicationId === published.publicationId,
    );
    expect(view.downloaded?.publicationId).toBe(published.publicationId);
  });
}
