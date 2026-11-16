/**
 * Stage B, slice 2: built-in apps. Create, read, change and delete, the fixed
 * type, the refusal while a playlist uses an app, and the audit trail.
 */
import { randomUUID } from 'node:crypto';
import { AppDtoSchema, AppListResponseSchema, type AppContent } from '@tinnox/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLOCK,
  appItem,
  auditEvents,
  createApp,
  createOrg,
  createPlaylist,
  signIn,
  startTestApp,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

interface ErrorBody {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
}

const TICKER: AppContent = {
  type: 'ticker',
  settings: {
    text: 'Secret sale text',
    speed: 'fast',
    textColour: '#ffff00',
    backgroundColour: '#000000',
  },
};

describe('apps', () => {
  let t: TestApp;
  let org: TestOrg;
  let alice: Operator;

  beforeAll(async () => {
    t = await startTestApp();
    org = await createOrg('Apps A');
    alice = await signIn(t, org);
  });
  afterAll(async () => {
    await t.close();
  });

  it('creates, lists by name, reads and changes an app', async () => {
    const zulu = await createApp(alice, TICKER, 'zulu ticker');
    const alpha = await createApp(alice, CLOCK, 'Alpha clock');
    expect(alpha).toMatchObject({
      name: 'Alpha clock',
      description: null,
      content: CLOCK,
      usageCount: 0,
    });

    const list = await alice.fetch('/api/apps');
    expect(list.status).toBe(200);
    const items = AppListResponseSchema.parse(await list.json()).items;
    expect(items.map((a) => a.id)).toEqual([alpha.id, zulu.id]);

    const read = await alice.fetch(`/api/apps/${alpha.id.toUpperCase()}`);
    expect(read.status).toBe(200);
    expect(AppDtoSchema.parse(await read.json())).toEqual(alpha);

    const settings = { ...CLOCK.settings, hourCycle: '12', showSeconds: false };
    const patched = await alice.fetch(`/api/apps/${alpha.id}`, {
      method: 'PATCH',
      json: { description: 'Front desk', content: { type: 'clock', settings } },
    });
    expect(patched.status).toBe(200);
    const after = AppDtoSchema.parse(await patched.json());
    expect(after).toMatchObject({
      name: 'Alpha clock',
      description: 'Front desk',
      content: { type: 'clock', settings },
    });

    // A name alone leaves the rest; an empty description clears it.
    const renamed = await alice.fetch(`/api/apps/${alpha.id}`, {
      method: 'PATCH',
      json: { name: 'Desk clock', description: '' },
    });
    expect(AppDtoSchema.parse(await renamed.json())).toMatchObject({
      name: 'Desk clock',
      description: null,
      content: { type: 'clock', settings },
    });
  });

  it('refuses settings outside the contract and fields it does not know', async () => {
    const bad = [
      {
        name: 'x',
        content: { type: 'clock', settings: { ...CLOCK.settings, textColour: '#FFFFFF' } },
      },
      { name: 'x', content: { type: 'clock', settings: TICKER.settings } },
      {
        name: 'x',
        content: {
          type: 'text',
          settings: { heading: '', body: '', textColour: '#ffffff', backgroundColour: '#000000' },
        },
      },
      { name: 'x', content: CLOCK, orgId: randomUUID() },
      { name: ' ', content: CLOCK },
    ];
    for (const json of bad) {
      const response = await alice.fetch('/api/apps', { method: 'POST', json });
      expect(response.status, JSON.stringify(json)).toBe(400);
      expect(((await response.json()) as ErrorBody).error.code).toBe('validation_failed');
    }
    const empty = await alice.fetch(`/api/apps/${(await createApp(alice)).id}`, {
      method: 'PATCH',
      json: {},
    });
    expect(empty.status).toBe(400);
  });

  it("refuses to change an app's type", async () => {
    const clock = await createApp(alice);
    const response = await alice.fetch(`/api/apps/${clock.id}`, {
      method: 'PATCH',
      json: { content: TICKER },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as ErrorBody;
    expect(body.error).toMatchObject({
      code: 'validation_failed',
      message: "An app's type cannot be changed.",
    });
    expect(body.error.details?.[0]?.path).toBe('content.type');
    const read = AppDtoSchema.parse(await (await alice.fetch(`/api/apps/${clock.id}`)).json());
    expect(read.content).toEqual(CLOCK);
  });

  it('answers 404 for an unknown app', async () => {
    const id = randomUUID();
    expect((await alice.fetch(`/api/apps/${id}`)).status).toBe(404);
    const patch = await alice.fetch(`/api/apps/${id}`, { method: 'PATCH', json: { name: 'x' } });
    expect(patch.status).toBe(404);
    expect(((await patch.json()) as ErrorBody).error.message).toBe('The app was not found.');
    expect((await alice.fetch(`/api/apps/${id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('refuses to delete an app a playlist uses, naming the playlists, then deletes it once removed', async () => {
    const app = await createApp(alice, TICKER, 'Sale ticker');
    const first = await createPlaylist(alice, 'Window loop', [appItem(app.id)]);
    const second = await createPlaylist(alice, 'Counter loop', [appItem(app.id), appItem(app.id)]);
    const used = AppDtoSchema.parse(await (await alice.fetch(`/api/apps/${app.id}`)).json());
    expect(used.usageCount).toBe(2);

    const refused = await alice.fetch(`/api/apps/${app.id}`, { method: 'DELETE' });
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as ErrorBody;
    expect(body.error.code).toBe('app_in_use');
    expect(body.error.message).toBe(
      'This app is used in a playlist. Remove it from the playlist first.',
    );
    expect(body.error.details).toEqual([
      { path: 'playlist', message: 'Counter loop' },
      { path: 'playlist', message: 'Window loop' },
    ]);

    // A deleted playlist no longer counts (its items go with it), nor one that dropped the app.
    expect((await alice.fetch(`/api/playlists/${first}`, { method: 'DELETE' })).status).toBe(204);
    const cleared = await alice.fetch(`/api/playlists/${second}`, {
      method: 'PUT',
      json: { name: 'Counter loop', items: [] },
    });
    expect(cleared.status).toBe(200);

    expect((await alice.fetch(`/api/apps/${app.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await alice.fetch(`/api/apps/${app.id}`)).status).toBe(404);
  });

  it('records create, update and delete with the type and field names only', async () => {
    const app = await createApp(alice, TICKER, 'Audited ticker');
    await alice.fetch(`/api/apps/${app.id}`, {
      method: 'PATCH',
      json: { name: 'Audited ticker 2', content: TICKER },
    });
    // A refused change writes nothing.
    await alice.fetch(`/api/apps/${app.id}`, { method: 'PATCH', json: { content: CLOCK } });
    await alice.fetch(`/api/apps/${app.id}`, { method: 'DELETE' });

    const events = (await auditEvents(alice, '&category=app')).filter((e) => e.objectId === app.id);
    expect(events.map((e) => [e.action, e.result, e.objectType, e.detail])).toEqual([
      ['app.delete', 'success', 'app', { type: 'ticker' }],
      ['app.update', 'success', 'app', { fields: ['content', 'name'] }],
      ['app.create', 'success', 'app', { type: 'ticker' }],
    ]);
    expect(JSON.stringify(events)).not.toContain('Secret sale text');
  });
});
