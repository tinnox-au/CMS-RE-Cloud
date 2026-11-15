/**
 * Portal paths the main journey does not click: actionable upload failures, media
 * deletion rules, editing a display, and a refused publish. Every answer shown here
 * comes from the real API and the real validation worker.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { encodePng } from '../support/png.ts';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import { evidenceDir, fixturesDir, PORTAL_URL } from './support/stack.ts';

test.describe.configure({ mode: 'serial' });

const runId = randomUUID().slice(0, 8);
let operator: OperatorSession;

test.beforeAll(async ({ browser }) => {
  operator = await operatorSession(browser, 'operator');
});
test.afterAll(async () => {
  await operator.context.close();
});

test('upload failures are shown with a reason the operator can act on', async () => {
  const page = operator.page;
  await page.goto(`${PORTAL_URL}/media`);
  const hevc = `clip-hevc-${runId}.mp4`;
  const disguised = `notes-${runId}.jpg`;
  await page.locator('input[type="file"]').setInputFiles([
    { name: hevc, mimeType: 'video/mp4', buffer: readFileSync(join(fixturesDir, 'hevc.mp4')) },
    {
      name: disguised,
      mimeType: 'image/jpeg',
      buffer: readFileSync(join(fixturesDir, 'text-renamed.jpg')),
    },
  ]);
  // Plain text called .jpg is refused while uploading; nothing reaches the library.
  const row = page.locator('.upload-row', { hasText: disguised });
  await expect(row.getByText('Upload failed')).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText('unsupported_media_type')).toBeVisible();
  await expect(page.locator('.media-card', { hasText: disguised })).toHaveCount(0);
  // An MP4 with an unsupported codec is uploaded, inspected by the worker, and fails with the reason.
  const card = page.locator('.media-card', { hasText: hevc });
  await expect(card.getByText('Failed', { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(card.getByText('unsupported_codec')).toBeVisible();
  await expect(card.getByText(/Re-encode the video as H\.264/)).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidenceDir, '13-portal-upload-rejected.png') });

  // A failed file cannot be added to a playlist.
  const playlist = await operator.api.createPlaylist(`E2E details ${runId}`);
  await page.goto(`${PORTAL_URL}/playlists/${playlist.id}`);
  await expect(page.getByRole('heading', { level: 2, name: 'Add ready media' })).toBeVisible();
  await expect(page.locator('.add-row', { hasText: hevc })).toHaveCount(0);
});

test('media in a playlist cannot be deleted; unused media can', async () => {
  const page = operator.page;
  const used = await operator.api.uploadReady(
    `kept-${runId}.png`,
    'image/png',
    encodePng(48, 27, (x, y) => [x * 5, y * 9, 77]),
  );
  const unused = await operator.api.uploadReady(
    `spare-${runId}.png`,
    'image/png',
    encodePng(48, 27, (x, y) => [y * 9, x * 5, 99]),
  );
  const playlist = await operator.api.createPlaylist(`E2E in use ${runId}`);
  await operator.api.savePlaylist(playlist.id, `E2E in use ${runId}`, [
    { mediaId: used.id, durationMs: 3000, fit: null },
  ]);

  await page.goto(`${PORTAL_URL}/media`);
  const usedCard = page.locator('.media-card', { hasText: used.originalName });
  await usedCard.getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete file' }).click();
  await expect(page.getByText('The file was not deleted')).toBeVisible();
  await expect(page.getByText('media_in_use')).toBeVisible();
  await expect(usedCard).toHaveCount(1);

  const unusedCard = page.locator('.media-card', { hasText: unused.originalName });
  await unusedCard.getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete file' }).click();
  await expect(unusedCard).toHaveCount(0);
  expect((await operator.api.get(`/api/media/${unused.id}`)).status()).toBe(404);
  expect((await operator.api.get(`/api/media/${unused.id}/preview`)).status()).toBe(404);
});

test('a display can be edited and invalid canvas input is refused in the form', async () => {
  const page = operator.page;
  const display = await operator.api.createDisplay({
    name: `E2E editable ${runId}`,
    canvas: { width: 1920, height: 1080 },
  });
  await page.goto(`${PORTAL_URL}/displays/${display.id}/edit`);
  await page.getByLabel('Name').fill(`E2E edited ${runId}`);
  await page.getByLabel('Width (px)').fill('4');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel('Width (px)').fill('3840');
  await page.getByLabel('Height (px)').fill('480');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForURL(new RegExp(`/displays/${display.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: `E2E edited ${runId}` })).toBeVisible();
  await expect(page.getByText('3840 × 480 px').first()).toBeVisible();
  const saved = (await (await operator.api.get(`/api/displays/${display.id}`)).json()) as {
    name: string;
    canvas: { width: number; height: number };
  };
  expect(saved).toMatchObject({
    name: `E2E edited ${runId}`,
    canvas: { width: 3840, height: 480 },
  });
});

test('publishing an empty playlist is refused and says nothing was published', async () => {
  const page = operator.page;
  const display = await operator.api.createDisplay({
    name: `E2E refused ${runId}`,
    canvas: { width: 640, height: 360 },
  });
  const playlist = await operator.api.createPlaylist(`E2E empty ${runId}`);
  await page.goto(`${PORTAL_URL}/playlists/${playlist.id}`);
  await page.getByLabel('Display', { exact: true }).selectOption(display.id);
  await page.getByRole('button', { name: 'Publish to display' }).click();
  await expect(page.getByText('Publishing was refused')).toBeVisible();
  await expect(page.getByText('Nothing was published.')).toBeVisible();
  await expect(page.getByText('playlist_empty')).toBeVisible();
  expect((await operator.api.status(display.id)).desired).toBeNull();
});
