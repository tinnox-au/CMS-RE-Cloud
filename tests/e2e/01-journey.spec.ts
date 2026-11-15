/**
 * The first user journey of prototype M0, end to end, with nothing simulated:
 * Keycloak sign-in with TOTP, the real API process, the real validation worker
 * container, production builds of the portal and the player in separate browser
 * contexts. The tests run in order and share one display and one player.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { encodePng } from '../support/png.ts';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import type { MediaItem, StatusView } from './support/operator.ts';
import {
  activeLayer,
  expectPhase,
  layerInfo,
  mediaCaches,
  observePlayback,
  openPlayer,
  pairingCode,
  playerFetch,
  readRecord,
  waitForLayer,
  type ActiveVersion,
  type Registration,
} from './support/player.ts';
import {
  API_URL,
  evidenceDir,
  fixturesDir,
  PORTAL_URL,
  restartDatabase,
  startApi,
  stopApi,
} from './support/stack.ts';

test.describe.configure({ mode: 'serial' });

const runId = randomUUID().slice(0, 8);
const displayName = `E2E Lobby ${runId}`;
const playlistName = `E2E Loop ${runId}`;
const SAMPLES = [
  { name: `landscape-${runId}.jpg`, mimeType: 'image/jpeg', source: 'landscape.jpg' },
  { name: `clip-${runId}.mp4`, mimeType: 'video/mp4', source: 'h264.mp4' },
  { name: `portrait-${runId}.png`, mimeType: 'image/png', source: 'portrait.png' },
] as const;
const MEDIA_ROUTE = /\/player\/media\/[0-9a-f-]{36}\?/;

let operator: OperatorSession;
let playerContext: BrowserContext;
let player: Page;
let displayId = '';
let playlistId = '';
let v1 = '';
let v2 = '';
let v4 = '';
let v2Assets: string[] = [];
const measurements: Record<string, unknown> = { runId, startedAt: new Date().toISOString() };

function shot(name: string): string {
  return join(evidenceDir, name);
}

function solidPng(seed: number): Buffer {
  // Unique bytes per run, so the player cannot already hold this asset.
  const tint = createHash('sha256').update(`${runId}:${seed}`).digest();
  return encodePng(320, 180, (x, y) => [
    (tint[0] ?? 0) ^ (x & 0x3f),
    (tint[1] ?? 0) ^ (y & 0x3f),
    tint[2] ?? 0,
  ]);
}

async function activePublication(): Promise<string | null> {
  return (await readRecord<ActiveVersion>(player, 'activeVersion'))?.manifest.publicationId ?? null;
}

async function deviceToken(): Promise<string> {
  const registration = await readRecord<Registration>(player, 'registration');
  if (registration === null || registration.deviceToken === null)
    throw new Error('the player holds no device token');
  return registration.deviceToken;
}

async function openDisplayPage(): Promise<void> {
  await operator.page.goto(`${PORTAL_URL}/displays/${displayId}`);
  await expect(operator.page.getByTestId('status-headline')).toBeVisible();
}

function inSyncWith(publicationId: string): (view: StatusView) => boolean {
  return (view) =>
    view.summary === 'in_sync' &&
    !view.stale &&
    view.desired?.publicationId === publicationId &&
    view.downloaded?.publicationId === publicationId &&
    view.active?.publicationId === publicationId &&
    view.playerState === 'playing';
}

test.beforeAll(async ({ browser }) => {
  playerContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  player = await playerContext.newPage();
  operator = await operatorSession(browser, 'operator', { fresh: true });
});

test.afterAll(async () => {
  measurements['finishedAt'] = new Date().toISOString();
  writeFileSync(shot('e2e-measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`);
  await playerContext.close();
  await operator.context.close();
});

test('operator is signed in through the identity provider (password and one-time code)', async () => {
  // beforeAll performed the real sign-in; here we check what the server says about the session.
  const session = await operator.api.session();
  expect(session.authenticated).toBe(true);
  expect(session.organization?.name).toBe('TINNOX Internal');
  await expect(operator.page.getByText('TINNOX Internal')).toBeVisible();
  const cookies = await operator.context.cookies(PORTAL_URL);
  const sessionCookie = cookies.find((cookie) => cookie.name === 'tinnox_session');
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe('Lax');
  // Nothing about the operator session is kept in script-readable storage.
  const stored = await operator.page.evaluate(() => ({
    local: Object.keys(localStorage).length,
    session: Object.keys(sessionStorage).length,
  }));
  expect(stored).toEqual({ local: 0, session: 0 });
});

test('operator creates a display with a canvas', async () => {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/displays`);
  await page.getByRole('link', { name: 'New display' }).click();
  await page.getByLabel('Name').fill(displayName);
  await page.getByLabel('Width (px)').fill('1280');
  await page.getByLabel('Height (px)').fill('720');
  await page.getByRole('button', { name: 'Create display' }).click();
  await page.waitForURL(/\/displays\/[0-9a-f-]{36}$/);
  displayId = page.url().split('/').pop() ?? '';
  await expect(page.getByRole('heading', { level: 1, name: displayName })).toBeVisible();
  await expect(page.getByTestId('status-headline')).toHaveAttribute('data-summary', 'unpaired');
  await page.screenshot({ path: shot('01-portal-display-created.png') });
});

test('player shows a pairing code; the operator claims it; the player registers', async () => {
  await openPlayer(player);
  const code = await pairingCode(player);
  await expectPhase(player, 'pairing');
  await player.screenshot({ path: shot('02-player-pairing-code.png') });

  const page = operator.page;
  await page.getByLabel('Pairing code shown on the player').fill(code);
  await page.getByRole('button', { name: 'Pair player' }).click();
  await expect(page.getByText('Code accepted')).toBeVisible();

  await expectPhase(player, 'idle');
  await expect(player.getByTestId('slate-display-name')).toHaveText(displayName);
  const registration = await readRecord<Registration>(player, 'registration');
  expect(registration?.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // The code is single use: a second claim of the same code is refused.
  const again = await operator.api.claim(displayId, code);
  expect(again.status()).toBeGreaterThanOrEqual(400);

  const view = await operator.api.waitForStatus(
    displayId,
    'a first report from the paired player',
    (status) => status.paired && status.lastHeartbeatAt !== null,
  );
  expect(view.summary).toBe('nothing_published');
  expect(view.registrationId).toBe(registration?.registrationId);
});

test('operator uploads JPEG, PNG and MP4; the isolated worker validates them', async () => {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/media`);
  // File names are unique to this run, so a "Ready" chip can only belong to these uploads.
  await page.locator('input[type="file"]').setInputFiles(
    SAMPLES.map((sample) => ({
      name: sample.name,
      mimeType: sample.mimeType,
      buffer: readFileSync(join(fixturesDir, sample.source)),
    })),
  );
  for (const sample of SAMPLES) {
    const card = page.locator('.media-card', { hasText: sample.name });
    await expect(card).toHaveCount(1);
    await expect(card.getByText('Ready', { exact: true })).toBeVisible({ timeout: 90_000 });
  }
  // The previews are served from private storage through the session, and really decode.
  const thumb = page.locator('.media-card', { hasText: SAMPLES[0].name }).locator('img').first();
  await expect(thumb).toBeVisible();
  await expect
    .poll(async () => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await page.screenshot({ path: shot('03-portal-media-ready.png') });
});

test('operator builds a playlist and publishes it to the display', async () => {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/playlists`);
  await page.getByLabel('Name').fill(playlistName);
  await page.getByRole('button', { name: 'Create playlist' }).click();
  await page.waitForURL(/\/playlists\/[0-9a-f-]{36}$/);
  playlistId = page.url().split('/').pop() ?? '';

  for (const { name } of SAMPLES) {
    await page.locator('.add-row', { hasText: name }).getByRole('button', { name: /^Add/ }).click();
  }
  const durations = page.getByLabel('Seconds on screen');
  await expect(durations).toHaveCount(2);
  await durations.nth(0).fill('3');
  await durations.nth(1).fill('3');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.getByLabel('Display', { exact: true }).selectOption(displayId);
  await page.getByRole('button', { name: 'Publish to display' }).click();
  await expect(page.getByText('Publication created')).toBeVisible();
  await page.screenshot({ path: shot('04-portal-published.png') });

  const view = await operator.api.status(displayId);
  v1 = view.desired?.publicationId ?? '';
  expect(v1).toMatch(/^[0-9a-f-]{36}$/);
});

test('player downloads, verifies and really renders the image and the video', async () => {
  await expectPhase(player, 'playing', 90_000);
  expect(await activePublication()).toBe(v1);
  const caches = await mediaCaches(player);
  expect(caches).toHaveLength(1);
  expect(caches[0]?.entries).toBe(3);

  const image = await waitForLayer(player, 'a decoded image', (info) => info.tag === 'img');
  expect(image.naturalWidth).toBeGreaterThan(0);
  expect(image.naturalHeight).toBeGreaterThan(0);
  await expect(activeLayer(player)).toBeVisible();
  await player.screenshot({ path: shot('05-player-playing-image.png') });

  const video = await waitForLayer(
    player,
    'a playing video',
    (info) => info.tag === 'video' && info.currentTime > 0.2,
  );
  expect(video.naturalWidth).toBe(320);
  expect(video.naturalHeight).toBe(240);
  expect(video.paused).toBe(false);
  const later = await waitForLayer(
    player,
    'the video advancing',
    (info) => info.tag === 'video' && info.currentTime > video.currentTime + 0.3,
    10_000,
  );
  expect(later.currentTime).toBeGreaterThan(video.currentTime);
  await player.screenshot({ path: shot('06-player-playing-video.png') });

  // All three items come round, in the published order, with never an empty screen.
  const watched = await observePlayback(player, 12_000);
  expect(new Set(watched.sequence).size).toBe(3);
  expect(watched.blankSamples).toBe(0);
});

test('portal shows desired = downloaded = active from real player reports', async () => {
  const view = await operator.api.waitForStatus(displayId, 'in sync with v1', inSyncWith(v1));
  expect(view.errors).toHaveLength(0);
  await openDisplayPage();
  const page = operator.page;
  await expect(page.getByTestId('status-headline')).toHaveAttribute('data-summary', 'in_sync');
  await expect(page.getByTestId('status-headline')).toHaveAttribute('data-stale', 'false');
  await expect(page.getByTestId('status-desired')).toContainText(v1);
  await expect(page.getByTestId('status-downloaded')).toContainText(v1);
  await expect(page.getByTestId('status-downloaded')).toContainText('matches desired');
  await expect(page.getByTestId('status-active')).toContainText(v1);
  await expect(page.getByTestId('status-active')).toContainText('matches desired');
  await expect(page.getByTestId('status-player-state')).toHaveText('Playing');
  await expect(page.getByTestId('status-no-errors')).toBeVisible();
  await page.screenshot({ path: shot('07-portal-status-in-sync.png'), fullPage: true });
});

test('editing the draft does not change the live publication', async () => {
  const token = await deviceToken();
  const before = await playerFetch('/player/manifest', token);
  expect(before.status).toBe(200);
  const beforeText = await before.text();
  const etag = before.headers.get('etag');

  const page = operator.page;
  await page.goto(`${PORTAL_URL}/playlists/${playlistId}`);
  await page
    .getByRole('button', { name: /^Remove/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const draft = (await (await operator.api.get(`/api/playlists/${playlistId}`)).json()) as {
    items: unknown[];
  };
  expect(draft.items).toHaveLength(2);

  // Longer than one manifest poll (15 s +/- 20 %): the player must still be on v1.
  await player.waitForTimeout(20_000);
  const after = await playerFetch('/player/manifest', token);
  expect(after.headers.get('etag')).toBe(etag);
  expect(await after.text()).toBe(beforeText);
  const unchanged = await playerFetch('/player/manifest', token, {
    headers: { 'if-none-match': etag ?? '' },
  });
  expect(unchanged.status).toBe(304);
  const active = await readRecord<ActiveVersion>(player, 'activeVersion');
  expect(active?.manifest.publicationId).toBe(v1);
  expect(active?.manifest.assets).toHaveLength(3);
  expect((await operator.api.status(displayId)).desired?.publicationId).toBe(v1);
});

test('publishing a second version switches the player over', async () => {
  const page = operator.page;
  await page.getByLabel('Display', { exact: true }).selectOption(displayId);
  await page.getByRole('button', { name: 'Publish to display' }).click();
  await expect(page.getByText('Publication created')).toBeVisible();
  const desired = (await operator.api.status(displayId)).desired?.publicationId ?? '';
  expect(desired).not.toBe(v1);
  v2 = desired;

  await operator.api.waitForStatus(displayId, 'in sync with v2', inSyncWith(v2));
  const active = await readRecord<ActiveVersion>(player, 'activeVersion');
  expect(active?.manifest.publicationId).toBe(v2);
  v2Assets = active?.manifest.assets.map((asset) => asset.assetId) ?? [];
  expect(v2Assets).toHaveLength(2);
  const watched = await observePlayback(player, 8_000);
  expect(watched.blankSamples).toBe(0);
  for (const assetId of watched.sequence) expect(v2Assets).toContain(assetId);
  // The asset only v1 used is garbage-collected once the renderer has switched.
  await expect
    .poll(async () => (await mediaCaches(player))[0]?.entries, { timeout: 30_000 })
    .toBe(2);
});

async function publishWithExtraImage(seed: number): Promise<{ id: string; extra: MediaItem }> {
  const extra = await operator.api.uploadReady(
    `extra-${runId}-${seed}.png`,
    'image/png',
    solidPng(seed),
  );
  const playlist = (await (await operator.api.get(`/api/playlists/${playlistId}`)).json()) as {
    name: string;
    items: { mediaId: string; durationMs: number | null; fit: 'contain' | 'cover' | null }[];
  };
  const kept = playlist.items
    .filter((item) => v2Assets.includes(item.mediaId))
    .map((item) => ({ mediaId: item.mediaId, durationMs: item.durationMs, fit: item.fit }));
  await operator.api.savePlaylist(playlistId, playlist.name, [
    ...kept,
    { mediaId: extra.id, durationMs: 3000, fit: null },
  ]);
  const published = await operator.api.publish(playlistId, displayId);
  return { id: published.publicationId, extra };
}

test('a corrupt download is rejected: the previous version keeps playing and the portal shows the error', async () => {
  let corrupted = 0;
  const corrupt = async (route: Route): Promise<void> => {
    const response = await route.fetch();
    const body = await response.body();
    // Same length, one byte changed: only the SHA-256 check can catch it.
    const at = body.length >> 1;
    body[at] = (body[at] ?? 0) ^ 0xff;
    corrupted += 1;
    await route.fulfill({ response, body });
  };
  await playerContext.route(MEDIA_ROUTE, corrupt);
  const { id: v3 } = await publishWithExtraImage(3);

  const view = await operator.api.waitForStatus(
    displayId,
    'an integrity error for v3',
    (status) =>
      status.errors.some(
        (error) => error.code === 'integrity_mismatch' && error.publicationId === v3,
      ),
    120_000,
  );
  expect(corrupted).toBeGreaterThan(0);
  expect(view.desired?.publicationId).toBe(v3);
  expect(view.active?.publicationId).toBe(v2);
  expect(view.downloaded?.publicationId).toBe(v2);
  expect(view.summary).toBe('updating');
  expect(await activePublication()).toBe(v2);
  const watched = await observePlayback(player, 8_000);
  expect(watched.blankSamples).toBe(0);
  expect(watched.sequence.length).toBeGreaterThan(1);
  for (const assetId of watched.sequence) expect(v2Assets).toContain(assetId);

  await openDisplayPage();
  const page = operator.page;
  await expect(page.getByTestId('status-errors')).toContainText('integrity_mismatch');
  await expect(page.getByTestId('status-active')).toContainText('differs from desired');
  await expect(page.getByTestId('status-headline')).toHaveAttribute('data-summary', 'updating');
  await page.screenshot({ path: shot('08-portal-delivery-error.png'), fullPage: true });
  await playerContext.unroute(MEDIA_ROUTE, corrupt);
});

test('an interrupted download keeps the previous version; the update completes once the network recovers', async () => {
  test.setTimeout(480_000);
  let cut = 0;
  const interrupt = async (route: Route): Promise<void> => {
    cut += 1;
    if (route.request().headers()['range'] !== undefined) {
      await route.abort('connectionreset');
      return;
    }
    // The transfer ends after half of the bytes.
    const response = await route.fetch();
    const body = await response.body();
    const headers = { ...response.headers() };
    delete headers['content-length'];
    await route.fulfill({ status: 200, headers, body: body.subarray(0, body.length >> 1) });
  };
  await playerContext.route(MEDIA_ROUTE, interrupt);
  const published = await publishWithExtraImage(4);
  v4 = published.id;

  const view = await operator.api.waitForStatus(
    displayId,
    'a download error for v4',
    (status) =>
      status.errors.some(
        (error) =>
          error.publicationId === v4 &&
          ['download_failed', 'size_mismatch', 'network_error'].includes(error.code),
      ),
    180_000,
  );
  measurements['interruptedDownloadErrorCodes'] = view.errors
    .filter((error) => error.publicationId === v4)
    .map((error) => error.code);
  expect(cut).toBeGreaterThan(1);
  expect(view.active?.publicationId).toBe(v2);
  expect(await activePublication()).toBe(v2);
  const watched = await observePlayback(player, 6_000);
  expect(watched.blankSamples).toBe(0);
  for (const assetId of watched.sequence) expect(v2Assets).toContain(assetId);

  // Network healthy again: the player retries by itself and activates the complete version.
  await playerContext.unroute(MEDIA_ROUTE, interrupt);
  const recoveryStarted = Date.now();
  await operator.api.waitForStatus(
    displayId,
    'in sync with v4 after recovery',
    inSyncWith(v4),
    240_000,
  );
  measurements['recoveryAfterInterruptedDownloadSeconds'] = Math.round(
    (Date.now() - recoveryStarted) / 1000,
  );
  expect(await activePublication()).toBe(v4);
  const active = await readRecord<ActiveVersion>(player, 'activeVersion');
  expect(active?.manifest.assets.map((asset) => asset.assetId)).toContain(published.extra.id);
  // Once v4 is active, the delivery errors it (and the abandoned v3) caused are resolved:
  // the player stops reporting them and the portal no longer lists them.
  const cleared = await operator.api.waitForStatus(
    displayId,
    'resolved delivery errors no longer reported',
    (status) =>
      status.errors.every(
        (error) =>
          error.code !== 'network_error' &&
          !['download_failed', 'size_mismatch', 'integrity_mismatch'].includes(error.code),
      ),
    60_000,
  );
  measurements['errorsReportedAfterRecovery'] = cleared.errors.map((error) => error.code);
});

test('playback continues through a network outage, survives an offline reload, and reports again afterwards', async () => {
  test.setTimeout(420_000);
  const OUTAGE_MS = 100_000;
  await operator.api.waitForStatus(displayId, 'in sync before the outage', inSyncWith(v4));
  await openDisplayPage();

  await playerContext.setOffline(true);
  const wentOffline = Date.now();
  expect(await player.evaluate(() => navigator.onLine)).toBe(false);

  // Watch the screen for the whole outage.
  const watched = await observePlayback(player, OUTAGE_MS);
  expect(watched.blankSamples).toBe(0);
  // Three items of at most 3 s each: well over 20 changes are expected in 100 s.
  expect(watched.sequence.length).toBeGreaterThan(20);
  expect(new Set(watched.sequence).size).toBe(3);
  expect(await activePublication()).toBe(v4);

  // The portal must not keep calling this healthy: the report is older than 60 s.
  const staleView = await operator.api.waitForStatus(
    displayId,
    'a stale report',
    (status) => status.stale && status.summary === 'stale',
    30_000,
  );
  expect(staleView.active?.publicationId).toBe(v4);
  await expect(operator.page.getByTestId('status-headline')).toHaveAttribute('data-stale', 'true');
  await expect(operator.page.getByTestId('status-last-report')).toContainText('STALE');
  await operator.page.screenshot({ path: shot('09-portal-status-stale.png'), fullPage: true });

  // Offline reload: shell from the service worker, state from IndexedDB, media from Cache Storage.
  await player.reload();
  await expectPhase(player, 'playing', 30_000);
  const afterReload = await waitForLayer(player, 'content after the offline reload', () => true);
  expect(afterReload.naturalWidth).toBeGreaterThan(0);
  expect(await player.evaluate(() => navigator.onLine)).toBe(false);
  expect(await player.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const afterReloadWatch = await observePlayback(player, 10_000);
  expect(new Set(afterReloadWatch.sequence).size).toBeGreaterThan(1);
  await player.screenshot({ path: shot('10-player-offline-reload.png') });

  const reconnected = Date.now();
  await playerContext.setOffline(false);
  measurements['offlineSeconds'] = Math.round((reconnected - wentOffline) / 1000);
  measurements['offlineItemChangesObserved'] = watched.sequence.length;
  measurements['offlineSamples'] = watched.samples;

  const fresh = await operator.api.waitForStatus(
    displayId,
    'a fresh in-sync report after reconnecting',
    (status) =>
      inSyncWith(v4)(status) &&
      status.lastHeartbeatAt !== null &&
      Date.parse(status.lastHeartbeatAt) >= reconnected - 1000,
    120_000,
  );
  measurements['secondsFromReconnectToFreshReport'] = Math.round(
    (Date.parse(fresh.lastHeartbeatAt ?? '') - reconnected) / 1000,
  );
  await expect(operator.page.getByTestId('status-headline')).toHaveAttribute(
    'data-stale',
    'false',
    {
      timeout: 30_000,
    },
  );
});

test('data, media and the player survive a restart of the API and of the database', async () => {
  test.setTimeout(420_000);
  const mediaBefore = (await (await operator.api.get('/api/media')).json()) as {
    items: MediaItem[];
  };
  const image = mediaBefore.items.find((item) => item.originalName === SAMPLES[2].name);
  if (image === undefined || image.sha256 === null) throw new Error('sample image is missing');
  const token = await deviceToken();
  const manifestBefore = await (await playerFetch('/player/manifest', token)).text();

  await stopApi();
  await expect(fetch(`${API_URL}/healthz`)).rejects.toThrow();
  const duringOutage = await observePlayback(player, 8_000);
  expect(duringOutage.blankSamples).toBe(0);
  expect(new Set(duringOutage.sequence).size).toBeGreaterThan(1);
  restartDatabase();
  await startApi();
  const restartedAt = Date.now();

  // Same session row, same data.
  expect((await operator.api.session()).authenticated).toBe(true);
  const mediaAfter = (await (await operator.api.get('/api/media')).json()) as {
    items: MediaItem[];
  };
  expect(mediaAfter.items.map((item) => item.id).sort()).toEqual(
    mediaBefore.items.map((item) => item.id).sort(),
  );
  const preview = await operator.api.get(`/api/media/${image.id}/preview`);
  expect(preview.status()).toBe(200);
  expect(
    createHash('sha256')
      .update(await preview.body())
      .digest('hex'),
  ).toBe(image.sha256);
  expect(await (await playerFetch('/player/manifest', token)).text()).toBe(manifestBefore);

  // The player picks up where it was and reports to the restarted API.
  const view = await operator.api.waitForStatus(
    displayId,
    'a report received after the restart',
    (status) =>
      inSyncWith(v4)(status) &&
      status.lastHeartbeatAt !== null &&
      Date.parse(status.lastHeartbeatAt) > restartedAt,
    180_000,
  );
  measurements['secondsFromApiRestartToReport'] = Math.round(
    (Date.parse(view.lastHeartbeatAt ?? '') - restartedAt) / 1000,
  );
  expect(await activePublication()).toBe(v4);
});

test('revoking the player stops its access; it shows the unregistered screen and removes its content', async () => {
  const token = await deviceToken();
  const urlsBefore = await playerFetch('/player/media-urls', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicationId: v4, assetIds: [v2Assets[0]] }),
  });
  expect(urlsBefore.status).toBe(200);
  const signed = (await urlsBefore.json()) as { urls: { url: string }[] };
  const signedUrl = signed.urls[0]?.url ?? '';
  expect((await fetch(signedUrl)).status).toBe(200);

  await openDisplayPage();
  const page = operator.page;
  await page.getByRole('button', { name: 'Revoke player' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke player' }).click();
  await expect(page.getByText('The player credential was revoked.')).toBeVisible();

  // Server side, at once: the credential and even the unexpired signed URL are dead.
  expect((await playerFetch('/player/manifest', token)).status).toBe(401);
  expect(
    (
      await playerFetch('/player/media-urls', token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicationId: v4, assetIds: [v2Assets[0]] }),
      })
    ).status,
  ).toBe(401);
  expect([401, 403, 404, 410]).toContain((await fetch(signedUrl)).status);

  // Player side, at its next contact.
  await expect(player.getByTestId('revoked-title')).toBeVisible({ timeout: 60_000 });
  await expectPhase(player, 'revoked');
  expect(await layerInfo(player)).toBeNull();
  await expect.poll(async () => await mediaCaches(player), { timeout: 15_000 }).toEqual([]);
  const registration = await readRecord<Registration>(player, 'registration');
  expect(registration?.deviceToken ?? null).toBeNull();
  expect(await readRecord(player, 'activeVersion')).toBeNull();
  await player.screenshot({ path: shot('11-player-unregistered.png') });

  const view = await operator.api.status(displayId);
  expect(view.paired).toBe(false);
  expect(view.summary).toBe('unpaired');

  // A reload stays unregistered; only the reset leaves this screen.
  await player.reload();
  await expect(player.getByTestId('revoked-title')).toBeVisible({ timeout: 30_000 });
  await player.getByTestId('reset-player').click();
  const newCode = await pairingCode(player);
  expect(newCode).toHaveLength(8);
  expect(await readRecord(player, 'registration')).toBeNull();
  expect(await mediaCaches(player)).toEqual([]);
});

test('the audit trail records the journey without secrets', async () => {
  const body = (await (await operator.api.get('/api/audit?limit=200')).json()) as {
    items: { action: string; result: string; at?: string }[];
  };
  const actions = new Set(body.items.map((item) => item.action));
  for (const expected of [
    'auth.login',
    'display.create',
    'pairing.claim',
    'media.upload',
    'publication.create',
    'player.revoke',
  ]) {
    expect([...actions], `audit action ${expected}`).toContain(expected);
  }
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/sig=|Bearer |tinnox_session/);
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/audit`);
  await expect(page.getByRole('heading', { level: 1, name: 'Audit' })).toBeVisible();
  await expect(page.getByText('publication.create').first()).toBeVisible();
  await page.screenshot({ path: shot('12-portal-audit.png') });
  // Sign-out ends the server session.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect
    .poll(async () => (await operator.api.session()).authenticated, { timeout: 30_000 })
    .toBe(false);
});
