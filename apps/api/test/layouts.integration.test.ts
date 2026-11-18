/**
 * Stage B, slice 4: layouts. A layout is two to four zones, each a rectangle in basis
 * points with its own playlist, zone 0 the main zone; a display has one of a playlist,
 * a schedule or a layout assigned. Pushing a layout is tested in push.integration.test.ts,
 * beside the helpers it needs.
 */
import { randomUUID } from 'node:crypto';
import {
  DisplayDtoSchema,
  LayoutDtoSchema,
  LayoutListResponseSchema,
  type DisplayDto,
  type LayoutDto,
  type LayoutZoneInput,
} from '@tinnox/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assignLayout,
  assignPlaylist,
  assignSchedule,
  auditEvents,
  createDisplay,
  createLayout,
  createOrg,
  createPlaylist,
  createSchedule,
  imageItem,
  layoutZones,
  readyImage,
  signIn,
  startTestApp,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

interface ErrorBody {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
}

const upper = (id: string): string => id.toUpperCase();
/** Each zone as [playlist id, x, y, width, height]. */
const geometry = (dto: LayoutDto): [string, number, number, number, number][] =>
  dto.zones.map((zone) => [zone.playlist.id, zone.x, zone.y, zone.width, zone.height]);

describe('layouts', () => {
  let t: TestApp;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let alice: Operator;
  let bob: Operator;
  /** Playlists of organisation A that no test deletes. */
  let mainLoop: string;
  let bandLoop: string;

  beforeAll(async () => {
    t = await startTestApp();
    orgA = await createOrg('Layouts A');
    orgB = await createOrg('Layouts B');
    alice = await signIn(t, orgA);
    bob = await signIn(t, orgB);
    const image = (await readyImage(t, alice)).id;
    mainLoop = await createPlaylist(alice, 'Main loop', [imageItem(image)]);
    bandLoop = await createPlaylist(alice, 'Band loop', [imageItem(image)]);
  });
  afterAll(async () => {
    await t.close();
  });

  async function getLayout(operator: Operator, id: string): Promise<LayoutDto> {
    const response = await operator.fetch(`/api/layouts/${id}`);
    expect(response.status).toBe(200);
    return LayoutDtoSchema.parse(await response.json());
  }

  async function listLayouts(operator: Operator): Promise<LayoutDto[]> {
    const response = await operator.fetch('/api/layouts');
    expect(response.status).toBe(200);
    return LayoutListResponseSchema.parse(await response.json()).items;
  }

  function putLayout(operator: Operator, id: string, json: unknown): Promise<Response> {
    return operator.fetch(`/api/layouts/${id}`, { method: 'PUT', json });
  }

  async function getDisplay(operator: Operator, id: string): Promise<DisplayDto> {
    const response = await operator.fetch(`/api/displays/${id}`);
    expect(response.status).toBe(200);
    return DisplayDtoSchema.parse(await response.json());
  }

  function patchDisplay(operator: Operator, id: string, json: unknown): Promise<Response> {
    return operator.fetch(`/api/displays/${id}`, { method: 'PATCH', json });
  }

  /** The detail of the newest `display.update` event of the display. */
  async function lastDisplayUpdate(displayId: string): Promise<Record<string, unknown> | null> {
    const [event] = (await auditEvents(alice, '&category=display')).filter(
      (e) => e.action === 'display.update' && e.objectId === displayId,
    );
    if (event === undefined) throw new Error('the display has no update event');
    return event.detail;
  }

  describe('create, read, replace and delete', () => {
    it('creates a layout, lists it by name, reads it, replaces it whole and deletes it, with one audit event each', async () => {
      const zulu = await createLayout(alice, 'zulu layout', layoutZones(mainLoop, bandLoop));
      const response = await alice.fetch('/api/layouts', {
        method: 'POST',
        json: {
          name: 'Alpha layout',
          description: 'Front window',
          zones: layoutZones(mainLoop, bandLoop, 20),
        },
      });
      expect(response.status).toBe(201);
      const alpha = LayoutDtoSchema.parse(await response.json());
      expect(alpha).toMatchObject({
        name: 'Alpha layout',
        description: 'Front window',
        zones: [
          { playlist: { id: mainLoop, name: 'Main loop' }, x: 0, y: 0, width: 10000, height: 8000 },
          {
            playlist: { id: bandLoop, name: 'Band loop' },
            x: 0,
            y: 8000,
            width: 10000,
            height: 2000,
          },
        ],
        assignedDisplayCount: 0,
      });
      expect(zulu.description).toBeNull();

      // By name without regard to case; the list carries the same DTO as the detail.
      const mine = (await listLayouts(alice)).filter(
        (item) => item.id === alpha.id || item.id === zulu.id,
      );
      expect(mine).toEqual([alpha, zulu]);
      // An upper-case id in the address reads the same layout.
      expect(await getLayout(alice, upper(alpha.id))).toEqual(alpha);

      // A replacement without a description keeps it; the zones are replaced as a set,
      // in the order sent: three side by side, the main zone on the right.
      const three: LayoutZoneInput[] = [
        { playlistId: bandLoop, x: 5000, y: 0, width: 5000, height: 10000 },
        { playlistId: mainLoop, x: 0, y: 0, width: 2500, height: 10000 },
        { playlistId: bandLoop, x: 2500, y: 0, width: 2500, height: 10000 },
      ];
      const replaced = await putLayout(alice, alpha.id, { name: 'Alpha layout two', zones: three });
      expect(replaced.status).toBe(200);
      const after = LayoutDtoSchema.parse(await replaced.json());
      expect(after).toMatchObject({
        id: alpha.id,
        name: 'Alpha layout two',
        description: 'Front window',
      });
      expect(geometry(after)).toEqual([
        [bandLoop, 5000, 0, 5000, 10000],
        [mainLoop, 0, 0, 2500, 10000],
        [bandLoop, 2500, 0, 2500, 10000],
      ]);
      expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(alpha.updatedAt));
      expect(await getLayout(alice, alpha.id)).toEqual(after);

      // A change of zones alone still moves updatedAt.
      const zonesOnly = await putLayout(alice, alpha.id, {
        name: 'Alpha layout two',
        zones: layoutZones(mainLoop, bandLoop, 30),
      });
      expect(zonesOnly.status).toBe(200);
      const moved = LayoutDtoSchema.parse(await zonesOnly.json());
      expect(Date.parse(moved.updatedAt)).toBeGreaterThan(Date.parse(after.updatedAt));
      expect(geometry(moved)).toEqual([
        [mainLoop, 0, 0, 10000, 7000],
        [bandLoop, 0, 7000, 10000, 3000],
      ]);
      // Null clears the description.
      const cleared = await putLayout(alice, alpha.id, {
        name: 'Alpha layout two',
        description: null,
        zones: layoutZones(mainLoop, bandLoop, 30),
      });
      expect(LayoutDtoSchema.parse(await cleared.json()).description).toBeNull();

      expect((await alice.fetch(`/api/layouts/${alpha.id}`, { method: 'DELETE' })).status).toBe(
        204,
      );
      expect((await alice.fetch(`/api/layouts/${alpha.id}`)).status).toBe(404);
      expect((await listLayouts(alice)).map((item) => item.id)).not.toContain(alpha.id);

      // Ids and counts only: never a name or a description.
      const events = (await auditEvents(alice, '&category=layout')).filter(
        (e) => e.objectId === alpha.id,
      );
      expect(events.map((e) => [e.action, e.result, e.objectType, e.detail])).toEqual([
        ['layout.delete', 'success', 'layout', { zoneCount: 2 }],
        ['layout.update', 'success', 'layout', { mainPlaylistId: mainLoop, zoneCount: 2 }],
        ['layout.update', 'success', 'layout', { mainPlaylistId: mainLoop, zoneCount: 2 }],
        ['layout.update', 'success', 'layout', { mainPlaylistId: bandLoop, zoneCount: 3 }],
        ['layout.create', 'success', 'layout', { mainPlaylistId: mainLoop, zoneCount: 2 }],
      ]);
      expect(events.every((e) => e.actorId === orgA.membershipId)).toBe(true);
      expect(JSON.stringify(events)).not.toContain('Front window');
    });

    it('accepts ids in upper case and answers and records them in lower case', async () => {
      const created = await alice.fetch('/api/layouts', {
        method: 'POST',
        json: { name: 'Upper', zones: layoutZones(upper(mainLoop), upper(bandLoop)) },
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const dto = LayoutDtoSchema.parse(await created.json());
      expect(dto.zones.map((zone) => zone.playlist.id)).toEqual([mainLoop, bandLoop]);

      const replaced = await putLayout(alice, upper(dto.id), {
        name: 'Upper',
        zones: layoutZones(upper(bandLoop), upper(mainLoop)),
      });
      expect(replaced.status, await replaced.clone().text()).toBe(200);
      const after = LayoutDtoSchema.parse(await replaced.json());
      expect(after.id).toBe(dto.id);
      expect(after.zones.map((zone) => zone.playlist.id)).toEqual([bandLoop, mainLoop]);

      const events = (await auditEvents(alice, '&category=layout')).filter(
        (e) => e.objectId === dto.id,
      );
      expect(events.map((e) => [e.action, e.detail])).toEqual([
        ['layout.update', { mainPlaylistId: bandLoop, zoneCount: 2 }],
        ['layout.create', { mainPlaylistId: mainLoop, zoneCount: 2 }],
      ]);
    });

    it('answers 404 for an unknown layout and for a layout of another organisation', async () => {
      const theirLoop = await createPlaylist(bob, 'Their loop');
      const foreign = await createLayout(bob, 'Theirs', layoutZones(theirLoop, theirLoop));
      for (const id of [randomUUID(), foreign.id]) {
        const read = await alice.fetch(`/api/layouts/${id}`);
        expect(read.status).toBe(404);
        expect(((await read.json()) as ErrorBody).error.message).toBe('The layout was not found.');
        const replace = await putLayout(alice, id, {
          name: 'Taken',
          zones: layoutZones(mainLoop, bandLoop),
        });
        expect(replace.status).toBe(404);
        expect((await alice.fetch(`/api/layouts/${id}`, { method: 'DELETE' })).status).toBe(404);
      }
      expect(await getLayout(bob, foreign.id)).toEqual(foreign);
      // Neither list shows the other organisation's layouts.
      expect((await listLayouts(alice)).map((item) => item.id)).not.toContain(foreign.id);
      expect((await listLayouts(bob)).map((item) => item.id)).toEqual([foreign.id]);
    });
  });

  describe('refusals', () => {
    it('names every zone an unknown, deleted or foreign playlist is in, with dotted paths', async () => {
      const deleted = await createPlaylist(alice, 'Gone', []);
      expect((await alice.fetch(`/api/playlists/${deleted}`, { method: 'DELETE' })).status).toBe(
        204,
      );
      const foreign = await createPlaylist(bob, 'Their loop', []);
      const kept = await createLayout(alice, 'Kept', layoutZones(mainLoop, bandLoop));

      for (const missing of [randomUUID(), deleted, foreign]) {
        const cases: [unknown, string[]][] = [
          [{ name: 'Bad', zones: layoutZones(mainLoop, missing) }, ['zones.1.playlistId']],
          // Every zone that uses it is named, counting from 0.
          [
            { name: 'Bad', zones: layoutZones(missing, missing) },
            ['zones.0.playlistId', 'zones.1.playlistId'],
          ],
        ];
        for (const [json, paths] of cases) {
          for (const response of [
            await alice.fetch('/api/layouts', { method: 'POST', json }),
            await putLayout(alice, kept.id, json),
          ]) {
            expect(response.status).toBe(400);
            const body = (await response.json()) as ErrorBody;
            expect(body.error).toMatchObject({
              code: 'validation_failed',
              message: 'A playlist in this layout does not exist or was deleted.',
            });
            expect(body.error.details).toEqual(
              paths.map((path) => ({ path, message: 'The playlist was not found.' })),
            );
          }
        }
      }
      // Nothing was created and the refused replacements changed nothing.
      expect((await listLayouts(alice)).map((item) => item.name)).not.toContain('Bad');
      expect(await getLayout(alice, kept.id)).toEqual(kept);
    });

    it('names the field of a body the schema refuses, with dots', async () => {
      const [main, band] = layoutZones(mainLoop, bandLoop);
      if (main === undefined || band === undefined) throw new Error('two zones expected');
      const strips = (count: number): LayoutZoneInput[] =>
        Array.from({ length: count }, (_, n) => ({
          playlistId: mainLoop,
          x: 0,
          y: n * 2000,
          width: 10000,
          height: 2000,
        }));
      const cases: [string, unknown][] = [
        ['zones', { name: 'Refused', zones: [main] }],
        ['zones', { name: 'Refused', zones: strips(5) }],
        ['zones.1', { name: 'Refused', zones: [main, { ...band, y: 8000 }] }],
        ['zones.1.width', { name: 'Refused', zones: [main, { ...band, x: 1, width: 10000 }] }],
        ['zones.1.height', { name: 'Refused', zones: [main, { ...band, height: 1501 }] }],
        ['zones.1.width', { name: 'Refused', zones: [main, { ...band, width: 0 }] }],
        ['zones.1.x', { name: 'Refused', zones: [main, { ...band, x: -1 }] }],
        ['zones.0.playlistId', { name: 'Refused', zones: [{ ...main, playlistId: 'main' }, band] }],
        ['description', { name: 'Refused', description: 'a\tb', zones: [main, band] }],
        ['name', { name: ' ', zones: [main, band] }],
      ];
      for (const [path, json] of cases) {
        const response = await alice.fetch('/api/layouts', { method: 'POST', json });
        expect(response.status, path).toBe(400);
        const body = (await response.json()) as ErrorBody;
        expect(body.error.code, path).toBe('validation_failed');
        expect(
          body.error.details?.map((detail) => detail.path),
          path,
        ).toContain(path);
      }
      // An unknown key, such as an organisation id, is refused too.
      const planted = await alice.fetch('/api/layouts', {
        method: 'POST',
        json: { name: 'Refused', zones: [main, band], orgId: orgB.orgId },
      });
      expect(planted.status).toBe(400);
      // Four zones, and zones that only touch, are taken.
      expect((await createLayout(alice, 'Four strips', strips(4))).zones).toHaveLength(4);
      expect((await listLayouts(alice)).map((item) => item.name)).not.toContain('Refused');
    });

    it('refuses to delete a layout a screen has assigned, naming the screens, then deletes it once unassigned', async () => {
      const layout = await createLayout(alice, 'Held', layoutZones(mainLoop, bandLoop));
      const zulu = await createDisplay(alice, orgA, 'zulu screen');
      const alpha = await createDisplay(alice, orgA, 'Alpha screen');
      await assignLayout(alice, zulu.id, layout.id);
      await assignLayout(alice, alpha.id, layout.id);
      expect((await getLayout(alice, layout.id)).assignedDisplayCount).toBe(2);

      const refused = await alice.fetch(`/api/layouts/${layout.id}`, { method: 'DELETE' });
      expect(refused.status).toBe(409);
      const body = (await refused.json()) as ErrorBody;
      expect(body.error.code).toBe('layout_in_use');
      expect(body.error.message).toBe(
        'This layout is assigned to a screen. Assign other content to the screen first.',
      );
      expect(body.error.details).toEqual([
        { path: 'display', message: 'Alpha screen' },
        { path: 'display', message: 'zulu screen' },
      ]);
      // A refusal writes nothing.
      expect(
        (await auditEvents(alice, '&category=layout')).filter(
          (e) => e.objectId === layout.id && e.action === 'layout.delete',
        ),
      ).toEqual([]);

      // Assigning a playlist, or removing the layout, frees it.
      await assignPlaylist(alice, zulu.id, mainLoop);
      await assignLayout(alice, alpha.id, null);
      expect((await getLayout(alice, layout.id)).assignedDisplayCount).toBe(0);
      expect((await alice.fetch(`/api/layouts/${layout.id}`, { method: 'DELETE' })).status).toBe(
        204,
      );
      const [event] = (await auditEvents(alice, '&category=layout')).filter(
        (e) => e.objectId === layout.id,
      );
      expect(event).toMatchObject({ action: 'layout.delete', detail: { zoneCount: 2 } });
    });
  });

  describe('assigning to a screen', () => {
    it('takes a playlist or a schedule off the screen, and either takes the layout off, saying so in the trail', async () => {
      const layout = await createLayout(alice, 'Shop split', layoutZones(mainLoop, bandLoop));
      const schedule = await createSchedule(alice, 'Shop week', mainLoop);
      const display = await createDisplay(alice, orgA, 'Shop window');
      await assignPlaylist(alice, display.id, bandLoop);

      // A layout in place of the playlist.
      const assigned = await patchDisplay(alice, display.id, {
        assignedLayoutId: upper(layout.id),
      });
      expect(assigned.status).toBe(200);
      const dto = DisplayDtoSchema.parse(await assigned.json());
      expect(dto.assignedPlaylist).toBeNull();
      expect(dto.assignedSchedule).toBeNull();
      // The main zone's playlist travels with it, for the preview on the screen's page.
      expect(dto.assignedLayout).toEqual({
        id: layout.id,
        name: 'Shop split',
        mainPlaylist: { id: mainLoop, name: 'Main loop' },
      });
      const listed = (await (await alice.fetch('/api/displays')).json()) as { items: DisplayDto[] };
      expect(listed.items.find((item) => item.id === display.id)).toEqual(dto);
      expect(await lastDisplayUpdate(display.id)).toEqual({
        fields: ['assignedLayoutId'],
        assignedLayoutId: layout.id,
        assignedPlaylistId: null,
      });

      // A name-only change keeps the layout (the UPDATE writes every assignment column).
      expect((await patchDisplay(alice, display.id, { name: 'Shop window two' })).status).toBe(200);
      expect(await getDisplay(alice, display.id)).toMatchObject({
        name: 'Shop window two',
        assignedLayout: { id: layout.id },
      });
      expect(await lastDisplayUpdate(display.id)).toEqual({ fields: ['name'] });
      // Null on another kind clears that kind only: the layout stays.
      expect((await patchDisplay(alice, display.id, { assignedScheduleId: null })).status).toBe(
        200,
      );
      expect((await getDisplay(alice, display.id)).assignedLayout?.id).toBe(layout.id);

      // A playlist in place of the layout, as every caller that assigns a playlist does.
      await assignPlaylist(alice, display.id, mainLoop);
      expect(await getDisplay(alice, display.id)).toMatchObject({
        assignedPlaylist: { id: mainLoop },
        assignedLayout: null,
      });
      expect(await lastDisplayUpdate(display.id)).toEqual({
        fields: ['assignedPlaylistId'],
        assignedPlaylistId: mainLoop,
        assignedLayoutId: null,
      });

      // A layout in place of a schedule, and a schedule in place of the layout.
      await assignSchedule(alice, display.id, schedule.id);
      await assignLayout(alice, display.id, layout.id);
      expect(await getDisplay(alice, display.id)).toMatchObject({
        assignedSchedule: null,
        assignedLayout: { id: layout.id },
      });
      expect(await lastDisplayUpdate(display.id)).toEqual({
        fields: ['assignedLayoutId'],
        assignedLayoutId: layout.id,
        assignedScheduleId: null,
      });
      await assignSchedule(alice, display.id, schedule.id);
      expect(await getDisplay(alice, display.id)).toMatchObject({
        assignedSchedule: { id: schedule.id },
        assignedLayout: null,
      });
      expect(await lastDisplayUpdate(display.id)).toEqual({
        fields: ['assignedScheduleId'],
        assignedScheduleId: schedule.id,
        assignedLayoutId: null,
      });

      // All three null removes all content.
      await assignLayout(alice, display.id, layout.id);
      const emptied = await patchDisplay(alice, display.id, {
        assignedPlaylistId: null,
        assignedScheduleId: null,
        assignedLayoutId: null,
      });
      expect(emptied.status).toBe(200);
      expect(DisplayDtoSchema.parse(await emptied.json())).toMatchObject({
        assignedPlaylist: null,
        assignedSchedule: null,
        assignedLayout: null,
      });
      expect(await lastDisplayUpdate(display.id)).toEqual({
        fields: ['assignedLayoutId', 'assignedPlaylistId', 'assignedScheduleId'],
        assignedPlaylistId: null,
        assignedScheduleId: null,
        assignedLayoutId: null,
      });
    });

    it('refuses a layout with a playlist or a schedule in one patch, and an unknown or foreign layout', async () => {
      const layout = await createLayout(alice, 'Either', layoutZones(mainLoop, bandLoop));
      const schedule = await createSchedule(alice, 'Either week', mainLoop);
      const theirLoop = await createPlaylist(bob, 'Their loop');
      const foreign = await createLayout(bob, 'Theirs', layoutZones(theirLoop, theirLoop));
      const display = await createDisplay(alice, orgA, 'One of three');
      await assignPlaylist(alice, display.id, bandLoop);

      for (const other of [{ assignedPlaylistId: mainLoop }, { assignedScheduleId: schedule.id }]) {
        const both = await patchDisplay(alice, display.id, {
          ...other,
          assignedLayoutId: layout.id,
        });
        expect(both.status).toBe(400);
        expect(((await both.json()) as ErrorBody).error.details).toEqual([
          { path: 'assignedLayoutId', message: 'assign one of a playlist, a schedule or a layout' },
        ]);
      }

      for (const id of [randomUUID(), foreign.id]) {
        const response = await patchDisplay(alice, display.id, {
          name: 'Renamed',
          assignedLayoutId: id,
        });
        expect(response.status).toBe(404);
        expect(((await response.json()) as ErrorBody).error.message).toBe(
          'The layout was not found.',
        );
      }
      // Nothing of the refused patches was saved: the playlist is still there.
      expect(await getDisplay(alice, display.id)).toMatchObject({
        name: 'One of three',
        assignedPlaylist: { id: bandLoop },
        assignedLayout: null,
      });
      expect((await getLayout(bob, foreign.id)).assignedDisplayCount).toBe(0);
    });
  });
});
