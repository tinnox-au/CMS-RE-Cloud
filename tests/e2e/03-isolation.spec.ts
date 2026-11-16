/**
 * A second organisation with its own user and its own real session (Keycloak sign-in with
 * its own TOTP secret) cannot see or touch the first organisation's objects, in the portal
 * or through direct API requests with known ids.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { encodePng } from '../support/png.ts';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import { PORTAL_URL } from './support/stack.ts';

const runId = randomUUID().slice(0, 8);
let first: OperatorSession;
let second: OperatorSession;

test.beforeAll(async ({ browser }) => {
  first = await operatorSession(browser, 'operator');
  second = await operatorSession(browser, 'secondOrgOperator', { fresh: true });
});

test.afterAll(async () => {
  await first.context.close();
  await second.context.close();
});

test('the second organisation sees none of the first organisation’s objects and cannot reach them by id', async () => {
  const display = await first.api.createDisplay({
    name: `E2E isolation ${runId}`,
    canvas: { width: 640, height: 360 },
  });
  const media = await first.api.uploadReady(
    `isolation-${runId}.png`,
    'image/png',
    encodePng(64, 36, (x, y) => [x * 3, y * 5, runId.charCodeAt(0)]),
  );
  const playlist = await first.api.createPlaylist(`E2E isolation ${runId}`);
  await first.api.savePlaylist(playlist.id, `E2E isolation ${runId}`, [
    { mediaId: media.id, durationMs: 3000, fit: null },
  ]);
  const published = await first.api.publish(playlist.id, display.id);

  const session = await second.api.session();
  expect(session.organization?.name).toBe('Isolation Test Organisation');
  const firstOrgId = (await first.api.session()).organization?.id;
  expect(session.organization?.id).not.toBe(firstOrgId);

  // Lists contain nothing from the first organisation.
  for (const path of ['/api/displays', '/api/media', '/api/playlists', '/api/audit?limit=200']) {
    const text = await (await second.api.get(path)).text();
    for (const id of [display.id, media.id, playlist.id, published.publicationId]) {
      expect(text, `${path} must not mention ${id}`).not.toContain(id);
    }
  }

  // Direct requests with the real ids answer exactly like unknown ids.
  const reads = [
    `/api/displays/${display.id}`,
    `/api/displays/${display.id}/status`,
    `/api/media/${media.id}`,
    `/api/media/${media.id}/preview`,
    `/api/media/${media.id}/thumbnail`,
    `/api/playlists/${playlist.id}`,
  ];
  for (const path of reads) {
    expect((await second.api.get(path)).status(), `GET ${path}`).toBe(404);
  }
  expect(
    (await second.api.post(`/api/displays/${display.id}/claim`, { code: 'ABCD2345' })).status(),
  ).toBe(404);
  expect((await second.api.post(`/api/displays/${display.id}/revoke-player`)).status()).toBe(404);
  expect(
    (await second.api.put(`/api/playlists/${playlist.id}`, { name: 'taken', items: [] })).status(),
  ).toBe(404);
  // Publishing another organisation's playlist, or to another organisation's display.
  expect(
    (
      await second.api.post(
        `/api/playlists/${playlist.id}/publish`,
        { displayId: display.id },
        { 'idempotency-key': randomUUID() },
      )
    ).status(),
  ).toBe(404);

  // Nothing changed for the first organisation.
  const after = (await (await first.api.get(`/api/playlists/${playlist.id}`)).json()) as {
    name: string;
    items: unknown[];
  };
  expect(after.name).toBe(`E2E isolation ${runId}`);
  expect(after.items).toHaveLength(1);
  expect((await first.api.status(display.id)).desired?.publicationId).toBe(published.publicationId);

  // And the portal of the second organisation shows only its own (empty) world.
  await second.page.goto(`${PORTAL_URL}/screens`);
  await expect(second.page.getByText('Isolation Test Organisation').first()).toBeVisible();
  await expect(second.page.getByText(`E2E isolation ${runId}`)).toHaveCount(0);
  await second.page.goto(`${PORTAL_URL}/screens/${display.id}`);
  await expect(second.page.getByTestId('screen-detail-missing')).toContainText(
    'This screen could not be loaded',
  );
});
