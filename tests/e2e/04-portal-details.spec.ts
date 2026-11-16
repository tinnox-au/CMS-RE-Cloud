/**
 * Portal paths the main journey does not click: actionable upload failures, media
 * deletion rules, tags that filter the library, editing a screen, and a push the API
 * refuses. Every answer shown here comes from the real API and the real validation worker.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { encodePng } from '../support/png.ts';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import {
  askToDeleteMedia,
  closeAddMedia,
  createMediaTag,
  filterLibraryByTag,
  mediaRow,
  mediaRows,
  mediaStatus,
  openScreenPage,
  pageHeading,
  pushRow,
  tagMedia,
  uploadInLibrary,
} from './support/portal.ts';
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
  const hevc = `clip-hevc-${runId}.mp4`;
  const disguised = `notes-${runId}.jpg`;
  await uploadInLibrary(page, [
    { name: hevc, mimeType: 'video/mp4', buffer: readFileSync(join(fixturesDir, 'hevc.mp4')) },
    {
      name: disguised,
      mimeType: 'image/jpeg',
      buffer: readFileSync(join(fixturesDir, 'text-renamed.jpg')),
    },
  ]);
  // Plain text called .jpg is refused while uploading; nothing reaches the library.
  const upload = page
    .getByTestId('media-library-add-dialog')
    .getByTestId('media-library-upload-row')
    .filter({ hasText: disguised });
  await expect(upload).toHaveAttribute('data-status', 'failed');
  await expect(upload.getByText('Upload failed').first()).toBeVisible();
  await expect(upload.getByText('unsupported_media_type')).toBeVisible();
  await closeAddMedia(page);
  await expect(mediaRow(page, disguised)).toHaveCount(0);
  // An MP4 with an unsupported codec is uploaded, inspected by the worker, and fails with the reason.
  const row = mediaRow(page, hevc);
  await expect(mediaStatus(row)).toHaveAttribute('data-status', 'failed', { timeout: 90_000 });
  await expect(row.getByText('unsupported_codec')).toBeVisible();
  await expect(row.getByText(/Re-encode the video as H\.264/)).toBeVisible();
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidenceDir, '13-portal-upload-rejected.png') });

  // A failed file cannot be added to a playlist.
  const playlist = await operator.api.createPlaylist(`E2E details ${runId}`);
  await page.goto(`${PORTAL_URL}/playlists/${playlist.id}`);
  const library = page.getByTestId('playlist-editor-library');
  await expect(library.getByRole('heading', { level: 2, name: 'Add media or apps' })).toBeVisible();
  await library.getByRole('searchbox', { name: 'Search media and apps' }).fill(hevc);
  await expect(library.getByRole('button', { name: `Add ${hevc}` })).toHaveCount(0);
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
  const refused = await askToDeleteMedia(page, used.originalName);
  await refused.getByRole('button', { name: 'Delete file' }).click();
  await expect(refused.getByText('media_in_use')).toBeVisible();
  await refused.getByTestId('media-library-delete-cancel').click();
  await expect(mediaRow(page, used.originalName)).toHaveCount(1);

  const allowed = await askToDeleteMedia(page, unused.originalName);
  await allowed.getByRole('button', { name: 'Delete file' }).click();
  await expect(allowed).toBeHidden();
  await expect(mediaRow(page, unused.originalName)).toHaveCount(0);
  expect((await operator.api.get(`/api/media/${unused.id}`)).status()).toBe(404);
  expect((await operator.api.get(`/api/media/${unused.id}/preview`)).status()).toBe(404);
  expect((await operator.api.get(`/api/media/${unused.id}/thumbnail`)).status()).toBe(404);
});

test('a media tag can be created, given to a file and used to filter the library', async () => {
  const page = operator.page;
  const tagged = await operator.api.uploadReady(
    `tagged-${runId}.png`,
    'image/png',
    encodePng(48, 27, (x, y) => [x * 3, 120, y * 7]),
  );
  const other = await operator.api.uploadReady(
    `untagged-${runId}.png`,
    'image/png',
    encodePng(48, 27, (x, y) => [200, y * 7, x * 3]),
  );
  const tag = `E2E tag ${runId}`;
  await createMediaTag(page, tag);
  await page.goto(`${PORTAL_URL}/media`);
  await tagMedia(page, tagged.originalName, tag);
  await filterLibraryByTag(page, tag);
  await expect(page).toHaveURL(/[?&]tag=/);
  await expect(mediaRows(page)).toHaveCount(1);
  await expect(mediaRow(page, tagged.originalName)).toHaveCount(1);
  await expect(mediaRow(page, other.originalName)).toHaveCount(0);
  const stored = (await (await operator.api.get(`/api/media/${tagged.id}`)).json()) as {
    tagIds: string[];
  };
  expect(stored.tagIds).toHaveLength(1);
});

test('a screen can be edited and invalid canvas input is refused in the form', async () => {
  const page = operator.page;
  const display = await operator.api.createDisplay({
    name: `E2E editable ${runId}`,
    canvas: { width: 1920, height: 1080 },
  });
  // The M0 edit address now opens the screen's Canvas tab.
  await page.goto(`${PORTAL_URL}/displays/${display.id}/edit`);
  await expect(page).toHaveURL(new RegExp(`/screens/${display.id}\\?tab=canvas$`));
  await openScreenPage(page, display.id);
  await page.getByTestId('screen-detail-name').fill(`E2E edited ${runId}`);
  await page.getByTestId('screen-detail-details-save').click();
  await expect(pageHeading(page, `E2E edited ${runId}`)).toBeVisible();
  await page.getByRole('tab', { name: 'Canvas' }).click();
  await page.getByLabel('Width (px)').fill('4');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByTestId('screen-detail-canvas-form').getByRole('alert').first(),
  ).toBeVisible();
  await page.getByLabel('Width (px)').fill('3840');
  await page.getByLabel('Height (px)').fill('480');
  await page.getByRole('button', { name: 'Save changes' }).click();
  // The preview follows the draft as typed, so only the save's own confirmation says the
  // API has stored the new canvas.
  await expect(
    page.getByRole('region', { name: 'Notifications' }).getByText(/^Canvas saved/),
  ).toBeVisible();
  await expect(page).toHaveURL(/tab=canvas/);
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

test('a screen whose playlist is empty is blocked in the push dialog and nothing is pushed', async () => {
  const page = operator.page;
  const display = await operator.api.createDisplay({
    name: `E2E refused ${runId}`,
    canvas: { width: 640, height: 360 },
  });
  const playlist = await operator.api.createPlaylist(`E2E empty ${runId}`);
  const assigned = await operator.api.patch(`/api/displays/${display.id}`, {
    assignedPlaylistId: playlist.id,
  });
  expect(assigned.status(), await assigned.text()).toBe(200);
  await page.goto(`${PORTAL_URL}/dashboard`);
  const row = await pushRow(page, display.id);
  await expect(row.getByTestId('push-row-state')).toContainText('Blocked');
  await expect(row.getByTestId('push-row-issues')).toContainText('playlist_empty');
  // A blocked screen cannot be ticked.
  await expect(page.getByTestId(`push-row-check-${display.id}`)).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The API refuses it too: the push answers `rejected` and stores nothing.
  const pushed = await operator.api.post(
    '/api/push',
    { displayIds: [display.id] },
    { 'idempotency-key': randomUUID() },
  );
  expect(pushed.status()).toBe(200);
  const body = (await pushed.json()) as { results: { outcome: string }[] };
  expect(body.results[0]?.outcome).toBe('rejected');
  expect((await operator.api.status(display.id)).desired).toBeNull();
});
