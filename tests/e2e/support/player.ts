/** Player-side helpers. They only observe the page: DOM, IndexedDB, Cache Storage, pixels. */
import { expect, type Locator, type Page } from '@playwright/test';
import { decodePng, type Rgb } from '../../support/png.ts';
import { API_URL, PLAYER_URL } from './stack.ts';

export async function openPlayer(page: Page): Promise<void> {
  await page.goto(`${PLAYER_URL}/`);
}

export function phase(page: Page): Promise<string | null> {
  return page.locator('html').getAttribute('data-player-phase');
}

export async function expectPhase(page: Page, expected: string, timeout = 60_000): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-player-phase', expected, { timeout });
}

/** The 8-character code on screen, without the separator. */
export async function pairingCode(page: Page): Promise<string> {
  const element = page.getByTestId('pairing-code');
  await expect(element).toBeVisible({ timeout: 30_000 });
  const text = (await element.textContent()) ?? '';
  const code = text.replace(/[^A-Za-z0-9]/g, '');
  expect(code).toHaveLength(8);
  return code;
}

/** Reads one record of the player's IndexedDB key-value store (null when absent). */
export function readRecord<T>(page: Page, key: string): Promise<T | null> {
  return page.evaluate(
    (recordKey) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('tinnox-player');
        open.onerror = () => {
          reject(new Error('IndexedDB could not be opened'));
        };
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('kv')) {
            db.close();
            resolve(null);
            return;
          }
          const request = db.transaction('kv', 'readonly').objectStore('kv').get(recordKey);
          request.onsuccess = () => {
            db.close();
            resolve(request.result ?? null);
          };
          request.onerror = () => {
            db.close();
            reject(new Error('record could not be read'));
          };
        };
      }),
    key,
  ) as Promise<T | null>;
}

export interface Registration {
  readonly registrationId: string;
  readonly orgId: string;
  readonly deviceToken: string | null;
  readonly revokedAt: string | null;
}

export interface ActiveVersion {
  readonly manifest: {
    readonly publicationId: string;
    readonly assets: readonly { assetId: string; sha256: string; kind: string; fit: string }[];
  };
}

/** Media caches of the player origin with the number of entries in each. */
export function mediaCaches(page: Page): Promise<{ name: string; entries: number }[]> {
  return page.evaluate(async () => {
    const out: { name: string; entries: number }[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith('tinnox-media')) continue;
      const cache = await caches.open(name);
      out.push({ name, entries: (await cache.keys()).length });
    }
    return out;
  });
}

export function activeLayer(page: Page): Locator {
  return page.getByTestId('active-layer');
}

export interface LayerInfo {
  readonly assetId: string | null;
  readonly kind: string | null;
  readonly fit: string | null;
  readonly tag: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly currentTime: number;
  readonly paused: boolean;
  readonly objectFit: string;
  readonly box: { x: number; y: number; width: number; height: number };
}

/** What is on screen right now, read from the real element (null when nothing is shown). */
export function layerInfo(page: Page): Promise<LayerInfo | null> {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>('[data-testid="active-layer"]');
    const media = layer?.firstElementChild;
    if (layer === null || layer === undefined || media === null || media === undefined) return null;
    const rect = media.getBoundingClientRect();
    const style = getComputedStyle(media);
    const visible = style.visibility === 'visible' && rect.width > 0 && rect.height > 0;
    if (!visible) return null;
    const isVideo = media instanceof HTMLVideoElement;
    const isImage = media instanceof HTMLImageElement;
    return {
      assetId: layer.dataset['assetId'] ?? null,
      kind: layer.dataset['kind'] ?? null,
      fit: layer.dataset['fit'] ?? null,
      tag: media.tagName.toLowerCase(),
      naturalWidth: isVideo ? media.videoWidth : isImage ? media.naturalWidth : 0,
      naturalHeight: isVideo ? media.videoHeight : isImage ? media.naturalHeight : 0,
      currentTime: isVideo ? media.currentTime : 0,
      paused: isVideo ? media.paused : false,
      objectFit: style.objectFit,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
}

/** Waits until an item matching `accept` is on screen and returns what was observed. */
export async function waitForLayer(
  page: Page,
  what: string,
  accept: (info: LayerInfo) => boolean,
  timeoutMs = 60_000,
): Promise<LayerInfo> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const info = await layerInfo(page);
    if (info !== null && accept(info)) return info;
    if (Date.now() > deadline) {
      throw new Error(`the player never showed ${what}; last: ${JSON.stringify(info)}`);
    }
    await page.waitForTimeout(100);
  }
}

/**
 * Watches the screen for `durationMs` and returns the sequence of distinct items shown
 * (asset ids, in order, consecutive repeats collapsed) plus how many samples had nothing on screen.
 */
export async function observePlayback(
  page: Page,
  durationMs: number,
): Promise<{ sequence: string[]; blankSamples: number; samples: number }> {
  const sequence: string[] = [];
  let blankSamples = 0;
  let samples = 0;
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    const info = await layerInfo(page);
    samples += 1;
    if (info === null || info.assetId === null) blankSamples += 1;
    else if (sequence[sequence.length - 1] !== info.assetId) sequence.push(info.assetId);
    await page.waitForTimeout(200);
  }
  return { sequence, blankSamples, samples };
}

export function elementBox(
  page: Page,
  testId: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate((id) => {
    const element = document.querySelector(`[data-testid="${id}"]`);
    if (element === null) throw new Error(`no element ${id}`);
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, testId);
}

/** Screenshot of the player window decoded for pixel sampling (CSS pixel coordinates). */
export async function capturePixels(page: Page): Promise<(x: number, y: number) => Rgb> {
  const png = decodePng(await page.screenshot({ scale: 'css' }));
  return (x, y) => png.pixel(x, y);
}

/** Calls a bearer-authenticated player endpoint from outside the browser. */
export function playerFetch(
  path: string,
  deviceToken: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${deviceToken}`);
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

/** Opens the diagnostics panel and confirms the two-step local reset. */
export async function localReset(page: Page): Promise<void> {
  await page.keyboard.press('d');
  const button = page.getByTestId('diagnostics-reset');
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toContainText('Confirm');
  await button.click();
}
