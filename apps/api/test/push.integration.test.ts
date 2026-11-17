/**
 * Portal v2, stage A: assign, then push (decision P2-05).
 *
 * Assigning a playlist and editing it change nothing on a display. The push plan
 * says what a push would do for each display, and a push builds one immutable
 * publication per chosen display through the same code as publishing.
 */
import { randomUUID } from 'node:crypto';
import {
  ABSOLUTE,
  DisplayDtoSchema,
  ManifestSchema,
  PushPlanResponseSchema,
  PushResponseSchema,
  isMediaItem,
  type DisplayDto,
  type Manifest,
  type PushPlanResponse,
  type PushPlanRow,
  type PushResult,
} from '@tinnox/contracts';
import { withOrg } from '@tinnox/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MANIFEST_BATCH_SIZE } from '../src/publishing.ts';
import {
  CLOCK,
  appItem,
  assignPlaylist,
  assignSchedule,
  auditEvents,
  createApp,
  createDisplay,
  createOrg,
  createPlaylist,
  createSchedule,
  desiredPublicationId,
  imageItem,
  pairPlayer,
  pngBytes,
  push,
  readyImage,
  scheduleEvent,
  signIn,
  startTestApp,
  uploadBytes,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

interface ErrorBody {
  error: { code: string; message: string; details?: { path: string; code?: string }[] };
}

describe('assign, then push', () => {
  let t: TestApp;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let alice: Operator;
  let bob: Operator;
  /** Ready images of organisation A, reused by tests that do not delete them. */
  let imageA: string;
  let imageB: string;

  beforeAll(async () => {
    t = await startTestApp();
    orgA = await createOrg('Push A');
    orgB = await createOrg('Push B');
    alice = await signIn(t, orgA);
    bob = await signIn(t, orgB);
    imageA = (await readyImage(t, alice)).id;
    imageB = (await readyImage(t, alice, { width: 20, height: 40 })).id;
  });
  afterAll(async () => {
    await t.close();
  });

  async function plan(operator: Operator): Promise<PushPlanResponse> {
    const response = await operator.fetch('/api/push');
    expect(response.status).toBe(200);
    return PushPlanResponseSchema.parse(await response.json());
  }

  async function planRow(operator: Operator, displayId: string): Promise<PushPlanRow> {
    const row = (await plan(operator)).items.find((item) => item.display.id === displayId);
    if (row === undefined) throw new Error('the display is not in the push plan');
    return row;
  }

  async function pushed(
    operator: Operator,
    displayIds: readonly string[],
    key?: string,
  ): Promise<PushResult[]> {
    const response = await push(operator, displayIds, key);
    expect(response.status, await response.clone().text()).toBe(200);
    return PushResponseSchema.parse(await response.json()).results;
  }

  async function publications(
    org: TestOrg,
    displayId: string,
  ): Promise<{ id: string; playlistId: string; manifest: Manifest }[]> {
    return withOrg(t.pool, org.orgId, async (tx) => {
      const { rows } = await tx.query<{ id: string; playlist_id: string; manifest: unknown }>(
        'SELECT id, playlist_id, manifest FROM publication WHERE display_id = $1 ORDER BY created_at',
        [displayId],
      );
      return rows.map((row) => ({
        id: row.id,
        playlistId: row.playlist_id,
        manifest: ManifestSchema.parse(row.manifest),
      }));
    });
  }

  async function getDisplay(operator: Operator, id: string): Promise<DisplayDto> {
    const response = await operator.fetch(`/api/displays/${id}`);
    expect(response.status).toBe(200);
    return DisplayDtoSchema.parse(await response.json());
  }

  function savePlaylist(
    operator: Operator,
    id: string,
    items: readonly unknown[],
    name = 'Loop',
  ): Promise<Response> {
    return operator.fetch(`/api/playlists/${id}`, { method: 'PUT', json: { name, items } });
  }

  /** A display with a publishable playlist assigned to it. Nothing is pushed. */
  async function assigned(
    operator: Operator,
    org: TestOrg,
    mediaIds: readonly string[],
    name = 'Assigned display',
  ): Promise<{ displayId: string; playlistId: string }> {
    const display = await createDisplay(operator, org, name);
    const playlistId = await createPlaylist(
      operator,
      'Loop',
      mediaIds.map((id) => imageItem(id)),
    );
    await assignPlaylist(operator, display.id, playlistId);
    return { displayId: display.id, playlistId };
  }

  describe('assigning', () => {
    it('records the playlist on the display and changes nothing on the display itself', async () => {
      const display = await createDisplay(alice, orgA, 'Reception');
      const player = await pairPlayer(t, alice, display.id);
      const playlistId = await createPlaylist(alice, 'Reception loop', [imageItem(imageA)]);
      expect((await getDisplay(alice, display.id)).assignedPlaylist).toBeNull();

      const response = await alice.fetch(`/api/displays/${display.id}`, {
        method: 'PATCH',
        json: { assignedPlaylistId: playlistId, description: 'Front desk, left of the door' },
      });
      expect(response.status).toBe(200);
      const dto = DisplayDtoSchema.parse(await response.json());
      expect(dto.assignedPlaylist).toEqual({ id: playlistId, name: 'Reception loop' });
      expect(dto.description).toBe('Front desk, left of the door');
      const listed = (await (await alice.fetch('/api/displays')).json()) as { items: DisplayDto[] };
      expect(listed.items.find((item) => item.id === display.id)).toEqual(dto);

      // Nothing was published: the display has no desired publication and its player gets none.
      expect(await desiredPublicationId(alice, display.id)).toBeNull();
      expect(await publications(orgA, display.id)).toEqual([]);
      expect((await fetch(`${t.url}/player/manifest`, { headers: player.headers })).status).toBe(
        204,
      );
      expect(await planRow(alice, display.id)).toEqual({
        display: { id: display.id, name: 'Reception' },
        playlist: { id: playlistId, name: 'Reception loop' },
        schedule: null,
        state: 'never_pushed',
        issues: [],
        lastPushedAt: null,
      });

      const [event] = (await auditEvents(alice, '&category=display')).filter(
        (e) => e.action === 'display.update' && e.objectId === display.id,
      );
      expect(event?.detail).toEqual({
        fields: ['assignedPlaylistId', 'description'],
        assignedPlaylistId: playlistId,
      });

      // Removing the assignment is as quiet.
      await assignPlaylist(alice, display.id, null);
      expect((await getDisplay(alice, display.id)).assignedPlaylist).toBeNull();
      expect((await planRow(alice, display.id)).state).toBe('nothing_assigned');
    });

    it('answers 404 for an unknown playlist and for a playlist of another organisation', async () => {
      const display = await createDisplay(alice, orgA, 'Unassigned');
      const foreign = await createPlaylist(bob, 'Theirs');
      for (const playlistId of [randomUUID(), foreign]) {
        const response = await alice.fetch(`/api/displays/${display.id}`, {
          method: 'PATCH',
          json: { name: 'Renamed', assignedPlaylistId: playlistId },
        });
        expect(response.status).toBe(404);
        expect(((await response.json()) as ErrorBody).error.message).toBe(
          'The playlist was not found.',
        );
      }
      // The rename sent with the refused assignment was not saved.
      expect(await getDisplay(alice, display.id)).toMatchObject({
        name: 'Unassigned',
        assignedPlaylist: null,
      });
    });

    it('sets a description and display tags, refuses media tags, and leaves updatedAt alone for tags', async () => {
      const display = await createDisplay(alice, orgA, 'Tagged');
      const tag = async (scope: string, name: string): Promise<string> =>
        (
          (await (
            await alice.fetch('/api/tags', {
              method: 'POST',
              json: { scope, name: `${name} ${randomUUID().slice(0, 8)}` },
            })
          ).json()) as { id: string }
        ).id;
      const floor = await tag('display', 'Ground floor');
      const mediaTag = await tag('media', 'Campaign');
      const before = await getDisplay(alice, display.id);
      expect(before).toMatchObject({ description: null, tagIds: [] });

      const tagged = await alice.fetch(`/api/displays/${display.id}`, {
        method: 'PATCH',
        json: { tagIds: [floor] },
      });
      const afterTags = DisplayDtoSchema.parse(await tagged.json());
      expect(afterTags.tagIds).toEqual([floor]);
      expect(afterTags.updatedAt).toBe(before.updatedAt);

      for (const [what, tagIds] of [
        ['a media tag', [floor, mediaTag]],
        ['an unknown tag', [randomUUID()]],
      ] as const) {
        const response = await alice.fetch(`/api/displays/${display.id}`, {
          method: 'PATCH',
          json: { description: 'Changed', tagIds },
        });
        expect(response.status, what).toBe(404);
        expect(((await response.json()) as ErrorBody).error.message).toBe('The tag was not found.');
      }
      expect(await getDisplay(alice, display.id)).toMatchObject({
        description: null,
        tagIds: [floor],
      });

      const cleared = await alice.fetch(`/api/displays/${display.id}`, {
        method: 'PATCH',
        json: { description: '', tagIds: [] },
      });
      expect(DisplayDtoSchema.parse(await cleared.json())).toMatchObject({
        description: null,
        tagIds: [],
      });
      const tooLong = await alice.fetch(`/api/displays/${display.id}`, {
        method: 'PATCH',
        json: { description: 'd'.repeat(501) },
      });
      expect(tooLong.status).toBe(400);
    });

    it('round-trips rotation and working hours, keeps them when absent, and clears hours with null', async () => {
      const display = await createDisplay(alice, orgA, 'Turned');
      expect(await getDisplay(alice, display.id)).toMatchObject({
        rotation: 0,
        workingHours: null,
      });
      const hours = [
        { start: '09:00', end: '17:00' },
        null,
        null,
        null,
        null,
        null,
        { start: '10:00', end: '24:00' },
      ];
      const patch = (json: unknown): Promise<Response> =>
        alice.fetch(`/api/displays/${display.id}`, { method: 'PATCH', json });

      const set = await patch({ rotation: 90, workingHours: hours });
      expect(set.status).toBe(200);
      expect(DisplayDtoSchema.parse(await set.json())).toMatchObject({
        rotation: 90,
        workingHours: hours,
      });
      await patch({ name: 'Turned, renamed' });
      expect(await getDisplay(alice, display.id)).toMatchObject({
        rotation: 90,
        workingHours: hours,
      });
      const cleared = await patch({ workingHours: null });
      expect(DisplayDtoSchema.parse(await cleared.json())).toMatchObject({
        rotation: 90,
        workingHours: null,
      });
      for (const bad of [{ rotation: 45 }, { workingHours: Array<null>(7).fill(null) }]) {
        expect((await patch(bad)).status, JSON.stringify(bad)).toBe(400);
      }
    });
  });

  describe('GET /api/push', () => {
    it('reports where every display stands, in display order, with the pending count', async () => {
      const org = await createOrg('Push plan');
      const carol = await signIn(t, org);
      const image = (await readyImage(t, carol)).id;
      const upload = await uploadBytes(carol, await pngBytes());
      const processing = ((await upload.json()) as { media: { id: string } }).media.id;

      const nothing = await createDisplay(carol, org, 'Nothing assigned');
      const never = await assigned(carol, org, [image], 'Never pushed');
      const current = await assigned(carol, org, [image], 'Up to date');
      const changed = await assigned(carol, org, [image], 'Changes waiting');
      const empty = await assigned(carol, org, [], 'Blocked, empty');
      const stuck = await assigned(carol, org, [image], 'Blocked, was pushed');
      await pushed(carol, [current.displayId, changed.displayId, stuck.displayId]);
      await savePlaylist(carol, changed.playlistId, [imageItem(image, 9)]);
      await savePlaylist(carol, stuck.playlistId, [imageItem(image), imageItem(processing)]);

      const result = await plan(carol);
      expect(result.items.map((row) => [row.display.name, row.state])).toEqual([
        ['Nothing assigned', 'nothing_assigned'],
        ['Never pushed', 'never_pushed'],
        ['Up to date', 'up_to_date'],
        ['Changes waiting', 'changes'],
        ['Blocked, empty', 'blocked'],
        ['Blocked, was pushed', 'blocked'],
      ]);
      // Pending is what a push would act on: never pushed and changes. Blocked is not.
      expect(result.pendingCount).toBe(2);

      const row = (displayId: string): PushPlanRow | undefined =>
        result.items.find((item) => item.display.id === displayId);
      expect(row(nothing.id)).toMatchObject({ playlist: null, issues: [], lastPushedAt: null });
      expect(row(never.displayId)).toMatchObject({
        playlist: { id: never.playlistId, name: 'Loop' },
        issues: [],
        lastPushedAt: null,
      });
      expect(row(current.displayId)?.lastPushedAt).not.toBeNull();
      expect(row(changed.displayId)?.lastPushedAt).not.toBeNull();
      // The same shape as the details of a refused publish.
      expect(row(empty.displayId)).toMatchObject({
        issues: [{ path: 'playlist', code: 'playlist_empty' }],
        lastPushedAt: null,
      });
      expect(row(stuck.displayId)?.issues).toEqual([
        expect.objectContaining({ path: 'items[1]', code: 'media_not_ready' }),
      ]);
      expect(row(stuck.displayId)?.lastPushedAt).not.toBeNull();

      // The plan is a read: asking for it wrote nothing.
      expect(await desiredPublicationId(carol, never.displayId)).toBeNull();
      expect(await publications(org, never.displayId)).toEqual([]);
    });

    it('compares content, not timestamps: a change shows up and a reverted change goes away', async () => {
      const { displayId, playlistId } = await assigned(alice, orgA, [imageA, imageB], 'Compared');
      const original = [imageItem(imageA), imageItem(imageB)];
      await pushed(alice, [displayId]);
      const state = async (): Promise<string> => (await planRow(alice, displayId)).state;
      expect(await state()).toBe('up_to_date');
      const patch = (json: unknown): Promise<Response> =>
        alice.fetch(`/api/displays/${displayId}`, { method: 'PATCH', json });

      const playlistChanges: [string, unknown[]][] = [
        ['a different duration', [imageItem(imageA, 6), imageItem(imageB)]],
        ['a different order', [imageItem(imageB), imageItem(imageA)]],
        ['one item fewer', [imageItem(imageA)]],
        ['one item more', [...original, imageItem(imageA)]],
        ['another fit', [{ ...imageItem(imageA), fit: 'cover' }, imageItem(imageB)]],
      ];
      for (const [what, items] of playlistChanges) {
        expect((await savePlaylist(alice, playlistId, items)).status, what).toBe(200);
        expect(await state(), what).toBe('changes');
        await savePlaylist(alice, playlistId, original);
        expect(await state(), `${what}, reverted`).toBe('up_to_date');
      }

      const displayChanges: [string, unknown, unknown][] = [
        ['another default fit', { defaultFit: 'cover' }, { defaultFit: 'contain' }],
        [
          'another canvas',
          { canvas: { width: 1920, height: 1080 } },
          { canvas: { width: 640, height: 360 } },
        ],
        [
          'a content rectangle',
          { contentRect: { x: 0, y: 0, width: 320, height: 180 } },
          { contentRect: null },
        ],
      ];
      for (const [what, change, revert] of displayChanges) {
        expect((await patch(change)).status, what).toBe(200);
        expect(await state(), what).toBe('changes');
        await patch(revert);
        expect(await state(), `${what}, reverted`).toBe('up_to_date');
      }

      // What a player is not given is not a change: names, descriptions, an explicit
      // fit equal to the default, tags.
      await savePlaylist(
        alice,
        playlistId,
        [{ ...imageItem(imageA), fit: 'contain' }, imageItem(imageB)],
        'Renamed loop',
      );
      await patch({ name: 'Renamed display', description: 'Moved to the foyer' });
      expect(await planRow(alice, displayId)).toMatchObject({
        state: 'up_to_date',
        display: { name: 'Renamed display' },
        playlist: { name: 'Renamed loop' },
      });

      // Another playlist with different content is a change; with the same content it is not.
      const different = await createPlaylist(alice, 'Different', [imageItem(imageB, 7)]);
      const twin = await createPlaylist(alice, 'Twin', original);
      await assignPlaylist(alice, displayId, different);
      expect(await state()).toBe('changes');
      await assignPlaylist(alice, displayId, twin);
      expect(await state()).toBe('up_to_date');
      await assignPlaylist(alice, displayId, null);
      const unassigned = await planRow(alice, displayId);
      expect(unassigned.state).toBe('nothing_assigned');
      // It still has the publication it was given.
      expect(unassigned.lastPushedAt).not.toBeNull();
      expect(await publications(orgA, displayId)).toHaveLength(1);
    });

    it('sees an app settings edit as a change, pushes it once, and offers a push back when the app is removed', async () => {
      const app = await createApp(alice, CLOCK, 'Push clock');
      const display = await createDisplay(alice, orgA, 'Clock display');
      const playlistId = await createPlaylist(alice, 'Clock loop', [
        appItem(app.id),
        imageItem(imageA),
      ]);
      await assignPlaylist(alice, display.id, playlistId);
      const state = async (): Promise<string> => (await planRow(alice, display.id)).state;
      expect(await state()).toBe('never_pushed');
      await pushed(alice, [display.id]);
      expect((await publications(orgA, display.id))[0]?.manifest.schemaVersion).toBe(3);
      expect(await state()).toBe('up_to_date');

      const settings = { ...CLOCK.settings, showSeconds: false };
      const edit = await alice.fetch(`/api/apps/${app.id}`, {
        method: 'PATCH',
        json: { content: { type: 'clock', settings } },
      });
      expect(edit.status).toBe(200);
      expect(await state()).toBe('changes');
      const [result] = await pushed(alice, [display.id]);
      expect(result?.outcome).toBe('published');
      expect(await state()).toBe('up_to_date');
      const latest = (await publications(orgA, display.id)).at(-1)?.manifest;
      expect(latest?.assets[0]).toMatchObject({ kind: 'app', content: { settings } });
      // Pushing again changes nothing.
      expect((await pushed(alice, [display.id]))[0]?.outcome).toBe('unchanged');
      expect(await publications(orgA, display.id)).toHaveLength(2);

      // Without the app the draft is v1 again: a change, then up to date.
      expect((await savePlaylist(alice, playlistId, [imageItem(imageA)])).status).toBe(200);
      expect(await state()).toBe('changes');
      await pushed(alice, [display.id]);
      expect((await publications(orgA, display.id)).at(-1)?.manifest.schemaVersion).toBe(1);
      expect(await state()).toBe('up_to_date');
    });

    it('sees rotation, working hours, transition and a media window as changes', async () => {
      const image = (await readyImage(t, alice)).id;
      const { displayId, playlistId } = await assigned(alice, orgA, [image], 'Playback options');
      await pushed(alice, [displayId]);
      // A publication made at the default options is v1, and it matches them.
      expect((await publications(orgA, displayId))[0]?.manifest.schemaVersion).toBe(1);
      const state = async (): Promise<string> => (await planRow(alice, displayId)).state;
      expect(await state()).toBe('up_to_date');
      const hours = [{ start: '08:00', end: '18:00' }, null, null, null, null, null, null];

      const changes: [string, () => Promise<Response>, () => Promise<Response>][] = [
        [
          'a rotation',
          () =>
            alice.fetch(`/api/displays/${displayId}`, { method: 'PATCH', json: { rotation: 180 } }),
          () =>
            alice.fetch(`/api/displays/${displayId}`, { method: 'PATCH', json: { rotation: 0 } }),
        ],
        [
          'working hours',
          () =>
            alice.fetch(`/api/displays/${displayId}`, {
              method: 'PATCH',
              json: { workingHours: hours },
            }),
          () =>
            alice.fetch(`/api/displays/${displayId}`, {
              method: 'PATCH',
              json: { workingHours: null },
            }),
        ],
        [
          'a transition',
          () =>
            alice.fetch(`/api/playlists/${playlistId}`, {
              method: 'PUT',
              json: { name: 'Loop', transition: 'fade', items: [imageItem(image)] },
            }),
          () =>
            alice.fetch(`/api/playlists/${playlistId}`, {
              method: 'PUT',
              json: { name: 'Loop', transition: 'cut', items: [imageItem(image)] },
            }),
        ],
        [
          'a media window',
          () =>
            alice.fetch(`/api/media/${image}`, {
              method: 'PATCH',
              json: { availableFrom: '2026-12-01T09:00', availableUntil: null },
            }),
          () =>
            alice.fetch(`/api/media/${image}`, {
              method: 'PATCH',
              json: { availableFrom: null, availableUntil: null },
            }),
        ],
      ];
      for (const [what, change, revert] of changes) {
        expect((await change()).status, what).toBe(200);
        expect(await state(), what).toBe('changes');
        expect((await revert()).status, `${what}, reverted`).toBe(200);
        expect(await state(), `${what}, reverted`).toBe('up_to_date');
      }

      // Pushed with hours, the display is up to date against its v2 publication.
      await alice.fetch(`/api/displays/${displayId}`, {
        method: 'PATCH',
        json: { workingHours: hours },
      });
      const [result] = await pushed(alice, [displayId]);
      expect(result?.outcome).toBe('published');
      const stored = (await publications(orgA, displayId)).at(-1)?.manifest;
      expect(stored).toMatchObject({ schemaVersion: 2, workingHours: hours });
      expect(await state()).toBe('up_to_date');
    });

    it('assesses more displays than one batch of manifests, each against its own publication', async () => {
      // The plan compares in batches so that it never holds every manifest at once
      // (publishing.ts). Two full batches and a part of a third: every third display
      // has nothing assigned, the others alternate between two playlists.
      const org = await createOrg('Push batches');
      const dana = await signIn(t, org);
      const image = (await readyImage(t, dana)).id;
      const loops = [
        await createPlaylist(dana, 'Loop one', [imageItem(image, 4)]),
        await createPlaylist(dana, 'Loop two', [imageItem(image, 6)]),
      ] as const;
      const total = MANIFEST_BATCH_SIZE * 2 + 5;
      expect(total).toBeLessThanOrEqual(ABSOLUTE.maxPushDisplays * 2);
      await withOrg(t.pool, org.orgId, (tx) =>
        tx.query(
          `INSERT INTO display (org_id, site_id, name, canvas_width, canvas_height, assigned_playlist_id)
           SELECT app_org_id(), $1, 'Batch ' || g, 640, 360,
                  CASE WHEN g % 3 = 0 THEN NULL WHEN g % 2 = 0 THEN $2::uuid ELSE $3::uuid END
           FROM generate_series(1, $4::int) g`,
          [org.siteId, loops[0], loops[1], total],
        ),
      );
      const listed = (await (await dana.fetch('/api/displays')).json()) as { items: DisplayDto[] };
      expect(listed.items).toHaveLength(total);
      const expectedLoop = (display: DisplayDto): string | null =>
        display.assignedPlaylist?.id ?? null;
      const assignedCount = listed.items.filter((d) => expectedLoop(d) !== null).length;
      expect(assignedCount).toBeGreaterThan(MANIFEST_BATCH_SIZE);

      const before = await plan(dana);
      expect(before.items.map((row) => row.display.id)).toEqual(listed.items.map((d) => d.id));
      expect(before.items.map((row) => row.state)).toEqual(
        listed.items.map((d) => (expectedLoop(d) === null ? 'nothing_assigned' : 'never_pushed')),
      );
      expect(before.pendingCount).toBe(assignedCount);

      // Push everything, at most 200 displays a request.
      const ids = listed.items.map((d) => d.id);
      const results: PushResult[] = [];
      for (let start = 0; start < ids.length; start += ABSOLUTE.maxPushDisplays) {
        results.push(...(await pushed(dana, ids.slice(start, start + ABSOLUTE.maxPushDisplays))));
      }
      expect(results.map((r) => r.outcome)).toEqual(
        listed.items.map((d) => (expectedLoop(d) === null ? 'skipped' : 'published')),
      );

      const after = await plan(dana);
      expect(
        after.items.map((row) => [row.display.id, row.playlist?.id ?? null, row.state]),
      ).toEqual(
        listed.items.map((d) => [
          d.id,
          expectedLoop(d),
          expectedLoop(d) === null ? 'nothing_assigned' : 'up_to_date',
        ]),
      );
      expect(after.pendingCount).toBe(0);

      // Change one of the two playlists: exactly its displays have changes, in every batch.
      await savePlaylist(dana, loops[1], [imageItem(image, 7)], 'Loop two');
      const changed = await plan(dana);
      expect(changed.items.map((row) => row.state)).toEqual(
        listed.items.map((d) =>
          expectedLoop(d) === null
            ? 'nothing_assigned'
            : expectedLoop(d) === loops[1]
              ? 'changes'
              : 'up_to_date',
        ),
      );
      const waiting = listed.items.filter((d) => expectedLoop(d) === loops[1]).length;
      expect(waiting).toBeGreaterThan(MANIFEST_BATCH_SIZE / 2);
      expect(changed.pendingCount).toBe(waiting);
      const overview = (await (await dana.fetch('/api/overview')).json()) as {
        pendingPushCount: number;
      };
      expect(overview.pendingPushCount).toBe(waiting);
    });

    it('lists only the displays of the caller’s organisation', async () => {
      const mine = await assigned(alice, orgA, [imageA], 'Mine');
      const theirs = await createDisplay(bob, orgB, 'Theirs');
      const text = await (await bob.fetch('/api/push')).text();
      expect(text).toContain(theirs.id);
      expect(text).not.toContain(mine.displayId);
      expect(text).not.toContain(mine.playlistId);
      expect((await plan(alice)).items.map((row) => row.display.id)).not.toContain(theirs.id);
    });
  });

  describe('POST /api/push', () => {
    it('publishes the assigned playlist, makes it desired, and answers unchanged the next time', async () => {
      const display = await createDisplay(alice, orgA, 'Lobby');
      await alice.fetch(`/api/displays/${display.id}`, {
        method: 'PATCH',
        json: { defaultFit: 'cover' },
      });
      const playlistId = await createPlaylist(alice, 'Lobby loop', [
        imageItem(imageA, 4),
        { mediaId: imageB, durationMs: 9000, fit: 'contain' },
      ]);
      await assignPlaylist(alice, display.id, playlistId);
      const player = await pairPlayer(t, alice, display.id);

      const [first] = await pushed(alice, [display.id]);
      expect(first).toMatchObject({ displayId: display.id, outcome: 'published', issues: [] });
      const publicationId = first?.publicationId;
      expect(await desiredPublicationId(alice, display.id)).toBe(publicationId);

      // One publication, of the assigned playlist, built as publishing builds it.
      const stored = await publications(orgA, display.id);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ id: publicationId, playlistId });
      expect(stored[0]?.manifest).toMatchObject({
        publicationId,
        displayId: display.id,
        canvas: { width: 640, height: 360 },
        contentRect: null,
        muted: true,
      });
      expect(
        stored[0]?.manifest.assets
          .filter(isMediaItem)
          .map((asset) => [asset.assetId, asset.durationMs, asset.fit]),
      ).toEqual([
        [imageA, 4000, 'cover'],
        [imageB, 9000, 'contain'],
      ]);
      // The player is served it.
      const manifest = await fetch(`${t.url}/player/manifest`, { headers: player.headers });
      expect(((await manifest.json()) as { manifest: unknown }).manifest).toEqual(
        stored[0]?.manifest,
      );

      const events = (await auditEvents(alice, '&category=publication')).filter(
        (e) => e.objectId === publicationId,
      );
      expect(events).toEqual([
        expect.objectContaining({
          action: 'publication.create',
          result: 'success',
          actorId: orgA.membershipId,
          objectType: 'publication',
          detail: { displayId: display.id, playlistId, items: 2, route: 'browser', via: 'push' },
        }),
      ]);
      expect(await planRow(alice, display.id)).toMatchObject({ state: 'up_to_date' });

      // A new push, with a new key, has nothing to do: no second publication.
      const [second] = await pushed(alice, [display.id]);
      expect(second).toEqual({
        displayId: display.id,
        outcome: 'unchanged',
        publicationId,
        issues: [],
      });
      expect(await publications(orgA, display.id)).toHaveLength(1);
      expect(await desiredPublicationId(alice, display.id)).toBe(publicationId);
    });

    it('creates nothing new when a push is repeated with the same Idempotency-Key', async () => {
      const one = await assigned(alice, orgA, [imageA], 'Replay one');
      const two = await assigned(alice, orgA, [imageB], 'Replay two');
      const ids = [one.displayId, two.displayId];
      const key = randomUUID();

      const first = await pushed(alice, ids, key);
      expect(first.map((r) => r.outcome)).toEqual(['published', 'published']);
      const replay = await pushed(alice, ids, key);
      expect(replay).toEqual(first);

      // Even after the playlist changed, the repeat answers with what the first call made.
      await savePlaylist(alice, one.playlistId, [imageItem(imageA, 30)]);
      expect((await planRow(alice, one.displayId)).state).toBe('changes');
      const late = await pushed(alice, ids, key);
      expect(late).toEqual(first);
      for (const [index, displayId] of ids.entries()) {
        const stored = await publications(orgA, displayId);
        expect(stored.map((p) => p.id)).toEqual([first[index]?.publicationId]);
        expect(await desiredPublicationId(alice, displayId)).toBe(first[index]?.publicationId);
      }
      const created = (await auditEvents(alice, '&category=publication')).filter(
        (e) => e.result === 'success' && ids.includes(String(e.detail?.['displayId'])),
      );
      expect(created).toHaveLength(2);

      // The waiting change goes out with a new key, and only for the display that has one.
      const next = await pushed(alice, ids);
      expect(next.map((r) => r.outcome)).toEqual(['published', 'unchanged']);
      expect(next[0]?.publicationId).not.toBe(first[0]?.publicationId);
      expect(next[1]?.publicationId).toBe(first[1]?.publicationId);
      expect(await publications(orgA, one.displayId)).toHaveLength(2);
      expect(await publications(orgA, two.displayId)).toHaveLength(1);
    });

    it('creates one publication per display for many concurrent pushes with the same key', async () => {
      const one = await assigned(alice, orgA, [imageA], 'Burst one');
      const two = await assigned(alice, orgA, [imageA, imageB], 'Burst two');
      const ids = [one.displayId, two.displayId];
      const key = randomUUID();
      const responses = await Promise.all(Array.from({ length: 8 }, () => push(alice, ids, key)));
      expect(responses.map((r) => r.status)).toEqual(Array<number>(8).fill(200));
      const bodies = await Promise.all(
        responses.map(async (r) => PushResponseSchema.parse(await r.json()).results),
      );
      for (const results of bodies) expect(results).toEqual(bodies[0]);
      expect(bodies[0]?.map((r) => r.outcome)).toEqual(['published', 'published']);
      for (const displayId of ids) expect(await publications(orgA, displayId)).toHaveLength(1);
    });

    it('reports rejected for a blocked display and leaves its previous publication desired', async () => {
      const { displayId, playlistId } = await assigned(alice, orgA, [imageA], 'Was fine');
      const player = await pairPlayer(t, alice, displayId);
      const [first] = await pushed(alice, [displayId]);
      const previous = first?.publicationId;
      expect(previous).not.toBeNull();

      // The playlist can no longer be published.
      await savePlaylist(alice, playlistId, []);
      expect((await planRow(alice, displayId)).state).toBe('blocked');
      const key = randomUUID();
      const [rejected] = await pushed(alice, [displayId], key);
      expect(rejected).toEqual({
        displayId,
        outcome: 'rejected',
        publicationId: null,
        issues: [expect.objectContaining({ path: 'playlist', code: 'playlist_empty' })],
      });

      // Nothing changed for the display or its player.
      expect(await desiredPublicationId(alice, displayId)).toBe(previous);
      expect((await publications(orgA, displayId)).map((p) => p.id)).toEqual([previous]);
      const manifest = await fetch(`${t.url}/player/manifest`, { headers: player.headers });
      expect(
        ((await manifest.json()) as { manifest: { publicationId: string } }).manifest.publicationId,
      ).toBe(previous);
      // The assignment is still there for the operator to fix.
      expect((await getDisplay(alice, displayId)).assignedPlaylist?.id).toBe(playlistId);

      const [event] = (await auditEvents(alice, '&category=publication&result=failure')).filter(
        (e) => e.objectId === playlistId,
      );
      expect(event).toMatchObject({
        action: 'publication.create',
        result: 'failure',
        objectType: 'playlist',
        detail: { displayId, reasons: ['playlist_empty'], via: 'push' },
      });

      // Once the playlist is fixed, the same key that was rejected can publish.
      await savePlaylist(alice, playlistId, [imageItem(imageB)]);
      const [fixed] = await pushed(alice, [displayId], key);
      expect(fixed?.outcome).toBe('published');
      expect(await desiredPublicationId(alice, displayId)).toBe(fixed?.publicationId);
    });

    it('answers per display, in request order, when the outcomes differ', async () => {
      const blocked = await assigned(alice, orgA, [], 'Mixed blocked');
      const unassigned = await createDisplay(alice, orgA, 'Mixed unassigned');
      const fresh = await assigned(alice, orgA, [imageA], 'Mixed fresh');
      const done = await assigned(alice, orgA, [imageB], 'Mixed done');
      const [already] = await pushed(alice, [done.displayId]);

      const results = await pushed(alice, [
        blocked.displayId,
        unassigned.id,
        fresh.displayId,
        done.displayId,
      ]);
      expect(results.map((r) => [r.displayId, r.outcome])).toEqual([
        [blocked.displayId, 'rejected'],
        [unassigned.id, 'skipped'],
        [fresh.displayId, 'published'],
        [done.displayId, 'unchanged'],
      ]);
      expect(results[1]).toMatchObject({ publicationId: null, issues: [] });
      expect(results[3]?.publicationId).toBe(already?.publicationId);
      // The rejection in front did not stop the display behind it.
      expect(await desiredPublicationId(alice, fresh.displayId)).toBe(results[2]?.publicationId);
      expect(await desiredPublicationId(alice, blocked.displayId)).toBeNull();
      expect(await desiredPublicationId(alice, unassigned.id)).toBeNull();
    });

    it('answers 404 for the whole request when a display is unknown or belongs to another organisation, and writes nothing', async () => {
      const mine = await assigned(alice, orgA, [imageA], 'Not pushed');
      const imageOfB = (await readyImage(t, bob)).id;
      const theirs = await assigned(bob, orgB, [imageOfB], 'Foreign');
      const auditBefore = (await auditEvents(alice, '&category=publication')).length;

      for (const [what, other] of [
        ['an unknown display', randomUUID()],
        ['a display of another organisation', theirs.displayId],
      ] as const) {
        for (const ids of [
          [mine.displayId, other],
          [other, mine.displayId],
        ]) {
          const response = await push(alice, ids);
          expect(response.status, what).toBe(404);
          const body = (await response.json()) as ErrorBody;
          expect(body.error.code).toBe('not_found');
          expect(body.error.message).toBe('The screen was not found.');
        }
      }
      expect(await publications(orgA, mine.displayId)).toEqual([]);
      expect(await desiredPublicationId(alice, mine.displayId)).toBeNull();
      expect(await publications(orgB, theirs.displayId)).toEqual([]);
      expect(await desiredPublicationId(bob, theirs.displayId)).toBeNull();
      expect(await auditEvents(alice, '&category=publication')).toHaveLength(auditBefore);
      expect((await planRow(bob, theirs.displayId)).state).toBe('never_pushed');
    });

    it('requires an Idempotency-Key and a list of 1 to 200 different displays', async () => {
      const { displayId } = await assigned(alice, orgA, [imageA], 'Validated');
      const send = (json: unknown, headers: Record<string, string>): Promise<Response> =>
        alice.fetch('/api/push', { method: 'POST', json, headers });
      const key = (): Record<string, string> => ({ 'idempotency-key': randomUUID() });

      const withoutKey = await send({ displayIds: [displayId] }, {});
      expect(withoutKey.status).toBe(400);
      expect(((await withoutKey.json()) as ErrorBody).error.code).toBe('bad_request');
      const shortKey = await send({ displayIds: [displayId] }, { 'idempotency-key': 'short' });
      expect(shortKey.status).toBe(400);

      const bodies: [string, unknown][] = [
        ['no list', {}],
        ['an empty list', { displayIds: [] }],
        ['the same display twice', { displayIds: [displayId, displayId.toUpperCase()] }],
        ['an id that is not a UUID', { displayIds: ['all'] }],
        ['201 displays', { displayIds: Array.from({ length: 201 }, () => randomUUID()) }],
        ['an unknown field', { displayIds: [displayId], playlistId: randomUUID() }],
      ];
      for (const [what, body] of bodies) {
        const response = await send(body, key());
        expect(response.status, what).toBe(400);
        expect(((await response.json()) as ErrorBody).error.code, what).toBe('validation_failed');
      }
      expect(await publications(orgA, displayId)).toEqual([]);
      // An id in upper case is the same display.
      const [result] = await pushed(alice, [displayId.toUpperCase()]);
      expect(result).toMatchObject({ displayId, outcome: 'published' });
    });
  });

  describe('POST /api/playlists/:id/publish', () => {
    function publish(playlistId: string, displayId: string, key = randomUUID()): Promise<Response> {
      return alice.fetch(`/api/playlists/${playlistId}/publish`, {
        method: 'POST',
        json: { displayId },
        headers: { 'idempotency-key': key },
      });
    }

    it('assigns the playlist to the display in the same step', async () => {
      const display = await createDisplay(alice, orgA, 'Published to');
      const first = await createPlaylist(alice, 'First', [imageItem(imageA)]);
      const second = await createPlaylist(alice, 'Second', [imageItem(imageB)]);

      const key = randomUUID();
      const response = await publish(first, display.id, key);
      expect(response.status).toBe(201);
      const { publicationId } = (await response.json()) as { publicationId: string };
      expect((await getDisplay(alice, display.id)).assignedPlaylist).toEqual({
        id: first,
        name: 'First',
      });
      // Published and assigned agree, so there is nothing waiting.
      expect(await planRow(alice, display.id)).toMatchObject({ state: 'up_to_date' });
      const [unchanged] = await pushed(alice, [display.id]);
      expect(unchanged).toMatchObject({ outcome: 'unchanged', publicationId });
      const [event] = (await auditEvents(alice, '&category=publication')).filter(
        (e) => e.objectId === publicationId,
      );
      expect(event?.detail).toMatchObject({ via: 'publish', playlistId: first });
      // The display had no schedule, so the event says nothing about one.
      expect(event?.detail).not.toHaveProperty('assignedScheduleId');
      expect(event?.detail).not.toHaveProperty('scheduleId');

      // Publishing another playlist moves the assignment with it.
      expect((await publish(second, display.id)).status).toBe(201);
      expect((await getDisplay(alice, display.id)).assignedPlaylist?.id).toBe(second);
      expect(await planRow(alice, display.id)).toMatchObject({ state: 'up_to_date' });

      // A repeat of the first publish answers as before and assigns nothing.
      const replay = await publish(first, display.id, key);
      expect(replay.status).toBe(200);
      expect(((await replay.json()) as { replayed: boolean }).replayed).toBe(true);
      expect((await getDisplay(alice, display.id)).assignedPlaylist?.id).toBe(second);
    });

    it('takes a schedule off the display it publishes a playlist to', async () => {
      const display = await createDisplay(alice, orgA, 'Scheduled, then published to');
      const usual = await createPlaylist(alice, 'Usual', [imageItem(imageA)]);
      const other = await createPlaylist(alice, 'Other', [imageItem(imageB)]);
      const schedule = await createSchedule(alice, 'Week', usual, [scheduleEvent(other)]);
      await assignSchedule(alice, display.id, schedule.id);
      expect((await pushed(alice, [display.id]))[0]?.outcome).toBe('published');

      const published = await publish(other, display.id);
      expect(published.status).toBe(201);
      const { publicationId } = (await published.json()) as { publicationId: string };
      expect(await getDisplay(alice, display.id)).toMatchObject({
        assignedPlaylist: { id: other, name: 'Other' },
        assignedSchedule: null,
      });
      // One event for the publish, and it says the schedule was taken off.
      const events = (await auditEvents(alice, '&category=publication')).filter(
        (e) => e.objectId === publicationId,
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.detail).toMatchObject({
        via: 'publish',
        playlistId: other,
        assignedScheduleId: null,
      });
      expect(events[0]?.detail).not.toHaveProperty('scheduleId');
      // The playlist is what the display has now, so nothing is waiting.
      expect(await planRow(alice, display.id)).toMatchObject({
        playlist: { id: other },
        schedule: null,
        state: 'up_to_date',
      });
      expect((await publications(orgA, display.id)).map((p) => p.manifest.schemaVersion)).toEqual([
        4, 1,
      ]);
      // And the schedule is free to be deleted.
      expect(
        (await alice.fetch(`/api/schedules/${schedule.id}`, { method: 'DELETE' })).status,
      ).toBe(204);
    });

    it('keeps the assignment and the desired publication in step under concurrent publishes', async () => {
      // Two playlists published to one display at the same moment, with a push in between.
      // Whichever order they commit in, none fails on a lock, and the playlist the display
      // ends up assigned is the playlist of the publication it ends up with.
      const display = await createDisplay(alice, orgA, 'Contended');
      const first = await createPlaylist(alice, 'Contender one', [imageItem(imageA)]);
      const second = await createPlaylist(alice, 'Contender two', [imageItem(imageB)]);
      for (let round = 0; round < 5; round += 1) {
        const responses = await Promise.all([
          publish(first, display.id),
          publish(second, display.id),
          push(alice, [display.id]),
          publish(first, display.id),
          publish(second, display.id),
        ]);
        expect(
          responses.map((r) => r.status),
          `round ${round}`,
        ).toEqual([201, 201, 200, 201, 201]);
        const desired = await desiredPublicationId(alice, display.id);
        const stored = await publications(orgA, display.id);
        const last = stored.find((p) => p.id === desired);
        expect(last).toBeDefined();
        expect((await getDisplay(alice, display.id)).assignedPlaylist?.id).toBe(last?.playlistId);
        expect((await planRow(alice, display.id)).state).toBe('up_to_date');
      }
    });

    it('does not assign a playlist whose publish is refused', async () => {
      const { displayId, playlistId } = await assigned(alice, orgA, [imageA], 'Keeps assignment');
      const empty = await createPlaylist(alice, 'Empty');
      const refused = await publish(empty, displayId);
      expect(refused.status).toBe(422);
      expect(((await refused.json()) as ErrorBody).error.code).toBe('publication_rejected');
      expect((await getDisplay(alice, displayId)).assignedPlaylist?.id).toBe(playlistId);
      expect(await desiredPublicationId(alice, displayId)).toBeNull();
    });

    it('shares its Idempotency-Key space with push, per display', async () => {
      // A key used to publish to a display names that publication for a push as well.
      const { displayId, playlistId } = await assigned(alice, orgA, [imageA], 'Shared key');
      const key = randomUUID();
      const response = await publish(playlistId, displayId, key);
      const { publicationId } = (await response.json()) as { publicationId: string };
      await savePlaylist(alice, playlistId, [imageItem(imageA, 20)]);
      const [result] = await pushed(alice, [displayId], key);
      expect(result).toMatchObject({ outcome: 'published', publicationId });
      expect(await publications(orgA, displayId)).toHaveLength(1);
    });

    it('does not replay a pushed schedule as a publish of its default playlist', async () => {
      const display = await createDisplay(alice, orgA, 'Scheduled key');
      const usual = await createPlaylist(alice, 'Usual key', [imageItem(imageA)]);
      const other = await createPlaylist(alice, 'Other key', [imageItem(imageB)]);
      const week = await createSchedule(alice, 'Week key', usual, [scheduleEvent(other)]);
      await assignSchedule(alice, display.id, week.id);
      const key = randomUUID();
      expect((await pushed(alice, [display.id], key))[0]?.outcome).toBe('published');
      // The publication records the default playlist, but it can play another one.
      const refused = await publish(usual, display.id, key);
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as ErrorBody).error.code).toBe('idempotency_conflict');
      expect((await getDisplay(alice, display.id)).assignedSchedule?.id).toBe(week.id);
      expect(await publications(orgA, display.id)).toHaveLength(1);

      // A schedule that can only play its default is that playlist's publication: it replays.
      const plain = await createDisplay(alice, orgA, 'Collapsed key');
      const quiet = await createSchedule(alice, 'Quiet key', usual, []);
      await assignSchedule(alice, plain.id, quiet.id);
      const again = randomUUID();
      const [result] = await pushed(alice, [plain.id], again);
      expect(result?.outcome).toBe('published');
      const replay = await publish(usual, plain.id, again);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({
        publicationId: result?.publicationId,
        replayed: true,
      });
    });
  });

  /**
   * The locks of publishing.ts, tested by holding the other side of each one open. A
   * concurrent edit is started in a transaction and left uncommitted; a push to the display
   * must then wait for it (a lock request that is not granted shows in `pg_locks`) and, once
   * the edit commits, build its publication from the committed state. Without the lock the
   * push reads the old row from its snapshot and publishes what was there before the edit.
   */
  describe('publishing locks', () => {
    async function pushAgainstHeldEdit(
      displayId: string,
      edit: (tx: {
        query: (text: string, values?: unknown[]) => Promise<unknown>;
      }) => Promise<void>,
    ): Promise<{ waited: boolean; results: PushResult[] }> {
      const started: { push?: Promise<Response> } = {};
      let waited = false;
      await withOrg(t.pool, orgA.orgId, async (tx) => {
        await edit(tx);
        const pushing = push(alice, [displayId]);
        started.push = pushing;
        let settled = false;
        void pushing.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        const deadline = Date.now() + 5000;
        while (!settled && Date.now() < deadline) {
          const { rows } = await t.pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted',
          );
          if ((rows[0]?.n ?? 0) > 0) {
            waited = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        // Returning commits the edit and lets the push go on.
      });
      if (started.push === undefined) throw new Error('the push was not started');
      const response = await started.push;
      expect(response.status, await response.clone().text()).toBe(200);
      return { waited, results: PushResponseSchema.parse(await response.json()).results };
    }

    it('holds the display row, so a canvas edit cannot change under the plan', async () => {
      const { displayId } = await assigned(alice, orgA, [imageA], 'Canvas under push');
      // As PATCH /api/displays/:id does: lock the row, then change the canvas.
      const { waited, results } = await pushAgainstHeldEdit(displayId, async (tx) => {
        await tx.query('SELECT 1 FROM display WHERE id = $1 AND org_id = app_org_id() FOR UPDATE', [
          displayId,
        ]);
        await tx.query(
          'UPDATE display SET canvas_width = 1280, canvas_height = 720 WHERE id = $1 AND org_id = app_org_id()',
          [displayId],
        );
      });
      expect(waited).toBe(true);
      expect(results[0]?.outcome).toBe('published');
      const [publication] = await publications(orgA, displayId);
      expect(publication?.id).toBe(results[0]?.publicationId);
      expect(publication?.manifest.canvas).toEqual({ width: 1280, height: 720 });
    });

    it('holds the playlist, so its items cannot change between reading the row and the items', async () => {
      const { displayId, playlistId } = await assigned(alice, orgA, [imageA], 'Items under push');
      // As PUT /api/playlists/:id does: lock the playlist, then replace its items.
      const { waited, results } = await pushAgainstHeldEdit(displayId, async (tx) => {
        await tx.query(
          'SELECT 1 FROM playlist WHERE id = $1 AND org_id = app_org_id() AND deleted_at IS NULL FOR UPDATE',
          [playlistId],
        );
        await tx.query(
          'DELETE FROM playlist_item WHERE playlist_id = $1 AND org_id = app_org_id()',
          [playlistId],
        );
        await tx.query(
          `INSERT INTO playlist_item (org_id, playlist_id, position, media_id, duration_ms, fit)
           VALUES (app_org_id(), $1, 0, $2, 7000, NULL), (app_org_id(), $1, 1, $3, 4000, NULL)`,
          [playlistId, imageB, imageA],
        );
      });
      expect(waited).toBe(true);
      expect(results[0]?.outcome).toBe('published');
      const [publication] = await publications(orgA, displayId);
      expect(
        publication?.manifest.assets.filter(isMediaItem).map((asset) => asset.assetId),
      ).toEqual([imageB, imageA]);
      expect(publication?.manifest.assets.map((asset) => asset.durationMs)).toEqual([7000, 4000]);
    });

    it('holds the schedule, so its events cannot change between reading the row and the events', async () => {
      const display = await createDisplay(alice, orgA, 'Schedule under push');
      const usual = await createPlaylist(alice, 'Usual', [imageItem(imageA)]);
      const other = await createPlaylist(alice, 'Other', [imageItem(imageB)]);
      const schedule = await createSchedule(alice, 'Before the edit', usual, [
        scheduleEvent(other, '09:00', '17:00'),
      ]);
      await assignSchedule(alice, display.id, schedule.id);
      const weekend = [false, false, false, false, false, true, true];
      // As PUT /api/schedules/:id does: lock the schedule, replace its events, then
      // write the row. A push that read the schedule and its events in one locking
      // statement would publish the new name's schedule with the old events.
      const { waited, results } = await pushAgainstHeldEdit(display.id, async (tx) => {
        await tx.query(
          'SELECT 1 FROM schedule WHERE id = $1 AND org_id = app_org_id() FOR UPDATE',
          [schedule.id],
        );
        await tx.query(
          'DELETE FROM schedule_event WHERE schedule_id = $1 AND org_id = app_org_id()',
          [schedule.id],
        );
        await tx.query(
          `INSERT INTO schedule_event
             (schedule_id, position, org_id, playlist_id, days, start_time, end_time)
           VALUES ($1, 0, app_org_id(), $2, $3, '10:00', '11:00'),
                  ($1, 1, app_org_id(), $2, $3, '20:00', '02:00')`,
          [schedule.id, other, weekend],
        );
        await tx.query(
          "UPDATE schedule SET name = 'After the edit' WHERE id = $1 AND org_id = app_org_id()",
          [schedule.id],
        );
      });
      expect(waited).toBe(true);
      expect(results[0]?.outcome).toBe('published');
      const [publication] = await publications(orgA, display.id);
      expect(publication?.id).toBe(results[0]?.publicationId);
      const manifest = publication?.manifest;
      if (manifest?.schemaVersion !== 4) throw new Error('expected a version 4 manifest');
      expect(manifest.schedule.events).toEqual([
        { playlist: 1, days: weekend, start: '10:00', end: '11:00' },
        { playlist: 1, days: weekend, start: '20:00', end: '02:00' },
      ]);
      // What was published is what the plan now compares with: the committed schedule.
      expect(await planRow(alice, display.id)).toMatchObject({
        schedule: { id: schedule.id, name: 'After the edit' },
        state: 'up_to_date',
      });
    });
  });
});

describe('push rate limit at its real value', () => {
  it('answers 429 after 30 pushes a minute', async () => {
    const t = await startTestApp({}, 1);
    try {
      const org = await createOrg('Push rate limit');
      const operator = await signIn(t, org);
      const statuses: number[] = [];
      for (let i = 0; i < 33; i += 1) {
        const response = await push(operator, [randomUUID()]);
        statuses.push(response.status);
        if (response.status === 429) {
          const body = (await response.json()) as ErrorBody;
          expect(body.error.code).toBe('rate_limited');
          expect(response.headers.get('retry-after')).not.toBeNull();
        }
      }
      expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
      expect(statuses.slice(30).every((s) => s === 429)).toBe(true);
      // Reading the plan is not held to the push limit.
      expect((await operator.fetch('/api/push')).status).toBe(200);
    } finally {
      await t.close();
    }
  });
});
