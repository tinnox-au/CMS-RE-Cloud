/**
 * Stage B, slice 3: schedules. A schedule is a default playlist plus weekly
 * events in priority order; a display has a playlist or a schedule assigned,
 * never both; a push copies every playlist of the schedule into one immutable
 * publication (manifest version 4 when an event uses another playlist).
 */
import { randomUUID } from 'node:crypto';
import {
  ABSOLUTE,
  DisplayDtoSchema,
  ManifestSchema,
  PushPlanResponseSchema,
  PushResponseSchema,
  ScheduleDtoSchema,
  ScheduleListResponseSchema,
  type DisplayDto,
  type Manifest,
  type PushPlanRow,
  type PushResult,
  type ScheduleDto,
} from '@tinnox/contracts';
import { withOrg } from '@tinnox/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
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
  push,
  readyImage,
  scheduleEvent,
  signIn,
  startTestApp,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

interface ErrorBody {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
}

const EVERY_DAY = [true, true, true, true, true, true, true];
const WEEKDAYS = [true, true, true, true, true, false, false];
const upper = (id: string): string => id.toUpperCase();

describe('schedules', () => {
  let t: TestApp;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let alice: Operator;
  let bob: Operator;
  /** Ready images of organisation A. */
  let imageA: string;
  let imageB: string;
  /** Publishable playlists of organisation A that no test deletes. */
  let dayLoop: string;
  let lunchLoop: string;

  beforeAll(async () => {
    t = await startTestApp();
    orgA = await createOrg('Schedules A');
    orgB = await createOrg('Schedules B');
    alice = await signIn(t, orgA);
    bob = await signIn(t, orgB);
    imageA = (await readyImage(t, alice)).id;
    imageB = (await readyImage(t, alice, { width: 20, height: 40 })).id;
    dayLoop = await createPlaylist(alice, 'Day loop', [imageItem(imageA)]);
    lunchLoop = await createPlaylist(alice, 'Lunch loop', [imageItem(imageB)]);
  });
  afterAll(async () => {
    await t.close();
  });

  async function getSchedule(operator: Operator, id: string): Promise<ScheduleDto> {
    const response = await operator.fetch(`/api/schedules/${id}`);
    expect(response.status).toBe(200);
    return ScheduleDtoSchema.parse(await response.json());
  }

  function putSchedule(operator: Operator, id: string, json: unknown): Promise<Response> {
    return operator.fetch(`/api/schedules/${id}`, { method: 'PUT', json });
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

  async function planRow(operator: Operator, displayId: string): Promise<PushPlanRow> {
    const response = await operator.fetch('/api/push');
    expect(response.status).toBe(200);
    // The strict parse of the whole answer is what the portal does.
    const row = PushPlanResponseSchema.parse(await response.json()).items.find(
      (item) => item.display.id === displayId,
    );
    if (row === undefined) throw new Error('the display is not in the push plan');
    return row;
  }

  async function pushed(operator: Operator, displayIds: readonly string[]): Promise<PushResult[]> {
    const response = await push(operator, displayIds);
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

  describe('create, read, replace and delete', () => {
    it('creates a schedule, lists it by name, reads it, replaces it whole and deletes it, with one audit event each', async () => {
      const lunch = scheduleEvent(lunchLoop, '11:30', '14:00', WEEKDAYS);
      const night = scheduleEvent(dayLoop, '22:00', '02:00');
      const zulu = await createSchedule(alice, 'zulu week', dayLoop);
      const response = await alice.fetch('/api/schedules', {
        method: 'POST',
        json: {
          name: 'Alpha week',
          description: 'Front of house',
          defaultPlaylistId: dayLoop,
          events: [lunch, night],
        },
      });
      expect(response.status).toBe(201);
      const alpha = ScheduleDtoSchema.parse(await response.json());
      expect(alpha).toMatchObject({
        name: 'Alpha week',
        description: 'Front of house',
        defaultPlaylist: { id: dayLoop, name: 'Day loop' },
        // In the order sent: the order is the priority.
        events: [
          {
            playlist: { id: lunchLoop, name: 'Lunch loop' },
            days: WEEKDAYS,
            start: '11:30',
            end: '14:00',
          },
          {
            playlist: { id: dayLoop, name: 'Day loop' },
            days: EVERY_DAY,
            start: '22:00',
            end: '02:00',
          },
        ],
        assignedDisplayCount: 0,
      });
      expect(zulu).toMatchObject({ description: null, events: [] });

      const list = await alice.fetch('/api/schedules');
      expect(list.status).toBe(200);
      const items = ScheduleListResponseSchema.parse(await list.json()).items;
      const mine = items.filter((item) => item.id === alpha.id || item.id === zulu.id);
      // By name without regard to case, with the number of events in place of the events.
      expect(mine.map((item) => [item.name, item.eventCount])).toEqual([
        ['Alpha week', 2],
        ['zulu week', 0],
      ]);
      expect(mine[0]).toEqual({ ...alpha, events: undefined, eventCount: 2 });
      expect(mine[0]).not.toHaveProperty('events');
      // An upper-case id in the address reads the same schedule.
      expect(await getSchedule(alice, upper(alpha.id))).toEqual(alpha);

      // A replacement without a description keeps it; the events are replaced as a set.
      const late = scheduleEvent(lunchLoop, '18:00', '24:00', [
        false,
        false,
        false,
        false,
        false,
        true,
        true,
      ]);
      const replaced = await putSchedule(alice, alpha.id, {
        name: 'Alpha week two',
        defaultPlaylistId: lunchLoop,
        events: [night, late, lunch],
      });
      expect(replaced.status).toBe(200);
      const after = ScheduleDtoSchema.parse(await replaced.json());
      expect(after).toMatchObject({
        id: alpha.id,
        name: 'Alpha week two',
        description: 'Front of house',
        defaultPlaylist: { id: lunchLoop, name: 'Lunch loop' },
      });
      expect(after.events.map((e) => [e.playlist.id, e.start, e.end, e.days])).toEqual([
        [dayLoop, '22:00', '02:00', EVERY_DAY],
        [lunchLoop, '18:00', '24:00', late.days],
        [lunchLoop, '11:30', '14:00', WEEKDAYS],
      ]);
      expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(alpha.updatedAt));
      expect(await getSchedule(alice, alpha.id)).toEqual(after);
      // Null clears the description; no events is a schedule that plays its default all week.
      const cleared = await putSchedule(alice, alpha.id, {
        name: 'Alpha week two',
        description: null,
        defaultPlaylistId: lunchLoop,
        events: [],
      });
      expect(ScheduleDtoSchema.parse(await cleared.json())).toMatchObject({
        description: null,
        events: [],
      });

      expect((await alice.fetch(`/api/schedules/${alpha.id}`, { method: 'DELETE' })).status).toBe(
        204,
      );
      expect((await alice.fetch(`/api/schedules/${alpha.id}`)).status).toBe(404);

      // Ids and counts only: never a name or a description.
      const events = (await auditEvents(alice, '&category=schedule')).filter(
        (e) => e.objectId === alpha.id,
      );
      expect(events.map((e) => [e.action, e.result, e.objectType, e.detail])).toEqual([
        ['schedule.delete', 'success', 'schedule', { eventCount: 0 }],
        ['schedule.update', 'success', 'schedule', { defaultPlaylistId: lunchLoop, eventCount: 0 }],
        ['schedule.update', 'success', 'schedule', { defaultPlaylistId: lunchLoop, eventCount: 3 }],
        ['schedule.create', 'success', 'schedule', { defaultPlaylistId: dayLoop, eventCount: 2 }],
      ]);
      expect(events.every((e) => e.actorId === orgA.membershipId)).toBe(true);
      expect(JSON.stringify(events)).not.toContain('Front of house');
    });

    it('accepts overlapping events: the order of the list decides', async () => {
      const schedule = await createSchedule(alice, 'Overlap', dayLoop, [
        scheduleEvent(lunchLoop, '09:00', '17:00'),
        scheduleEvent(dayLoop, '00:00', '24:00'),
        scheduleEvent(lunchLoop, '09:00', '17:00'),
      ]);
      expect(schedule.events.map((e) => e.playlist.id)).toEqual([lunchLoop, dayLoop, lunchLoop]);
    });

    it('accepts ids in upper case and answers and records them in lower case', async () => {
      const created = await alice.fetch('/api/schedules', {
        method: 'POST',
        json: {
          name: 'Upper',
          defaultPlaylistId: upper(dayLoop),
          events: [scheduleEvent(upper(lunchLoop))],
        },
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const dto = ScheduleDtoSchema.parse(await created.json());
      expect(dto.defaultPlaylist.id).toBe(dayLoop);
      expect(dto.events.map((e) => e.playlist.id)).toEqual([lunchLoop]);

      const replaced = await putSchedule(alice, upper(dto.id), {
        name: 'Upper',
        defaultPlaylistId: upper(lunchLoop),
        events: [scheduleEvent(upper(dayLoop)), scheduleEvent(upper(lunchLoop), '18:00', '19:00')],
      });
      expect(replaced.status, await replaced.clone().text()).toBe(200);
      const after = ScheduleDtoSchema.parse(await replaced.json());
      expect(after.id).toBe(dto.id);
      expect(after.defaultPlaylist.id).toBe(lunchLoop);
      expect(after.events.map((e) => e.playlist.id)).toEqual([dayLoop, lunchLoop]);

      const events = (await auditEvents(alice, '&category=schedule')).filter(
        (e) => e.objectId === dto.id,
      );
      expect(events.map((e) => [e.action, e.detail])).toEqual([
        ['schedule.update', { defaultPlaylistId: lunchLoop, eventCount: 2 }],
        ['schedule.create', { defaultPlaylistId: dayLoop, eventCount: 1 }],
      ]);
    });

    it('answers 404 for an unknown schedule and for a schedule of another organisation', async () => {
      const foreign = await createSchedule(
        bob,
        'Theirs',
        await createPlaylist(bob, 'Their loop', []),
      );
      for (const id of [randomUUID(), foreign.id]) {
        const read = await alice.fetch(`/api/schedules/${id}`);
        expect(read.status).toBe(404);
        expect(((await read.json()) as ErrorBody).error.message).toBe(
          'The schedule was not found.',
        );
        const replace = await putSchedule(alice, id, {
          name: 'Taken',
          defaultPlaylistId: dayLoop,
          events: [],
        });
        expect(replace.status).toBe(404);
        expect((await alice.fetch(`/api/schedules/${id}`, { method: 'DELETE' })).status).toBe(404);
      }
      expect(await getSchedule(bob, foreign.id)).toEqual(foreign);
      // Neither list shows the other organisation's schedules.
      const mine = ScheduleListResponseSchema.parse(
        await (await alice.fetch('/api/schedules')).json(),
      );
      expect(mine.items.map((item) => item.id)).not.toContain(foreign.id);
    });
  });

  describe('refusals', () => {
    it('names every place an unknown, deleted or foreign playlist is used, with dotted paths', async () => {
      const deleted = await createPlaylist(alice, 'Gone', []);
      expect((await alice.fetch(`/api/playlists/${deleted}`, { method: 'DELETE' })).status).toBe(
        204,
      );
      const foreign = await createPlaylist(bob, 'Their loop', []);
      const kept = await createSchedule(alice, 'Kept', dayLoop, [scheduleEvent(lunchLoop)]);

      for (const missing of [randomUUID(), deleted, foreign]) {
        const bodies = [
          // As the default playlist.
          { name: 'Bad', defaultPlaylistId: missing, events: [scheduleEvent(lunchLoop)] },
          // In events: every place is named, counting from 0.
          {
            name: 'Bad',
            defaultPlaylistId: dayLoop,
            events: [
              scheduleEvent(lunchLoop),
              scheduleEvent(missing),
              scheduleEvent(missing, '18:00', '19:00'),
            ],
          },
        ];
        const paths = [['defaultPlaylistId'], ['events.1.playlistId', 'events.2.playlistId']];
        for (const [index, json] of bodies.entries()) {
          for (const response of [
            await alice.fetch('/api/schedules', { method: 'POST', json }),
            await putSchedule(alice, kept.id, json),
          ]) {
            expect(response.status).toBe(400);
            const body = (await response.json()) as ErrorBody;
            expect(body.error).toMatchObject({
              code: 'validation_failed',
              message: 'A playlist in this schedule does not exist or was deleted.',
            });
            expect(body.error.details).toEqual(
              paths[index]?.map((path) => ({ path, message: 'The playlist was not found.' })),
            );
          }
        }
      }
      // Nothing was created and the refused replacements changed nothing.
      const list = ScheduleListResponseSchema.parse(
        await (await alice.fetch('/api/schedules')).json(),
      );
      expect(list.items.map((item) => item.name)).not.toContain('Bad');
      expect(await getSchedule(alice, kept.id)).toEqual(kept);
    });

    it('names the field of a body the schema refuses, with dots, and takes at most 50 events', async () => {
      const event = scheduleEvent(lunchLoop);
      const base = { name: 'Refused', defaultPlaylistId: dayLoop };
      const cases: [string, unknown][] = [
        ['events.0.days', { ...base, events: [{ ...event, days: EVERY_DAY.slice(1) }] }],
        ['events.0.days', { ...base, events: [{ ...event, days: EVERY_DAY.map(() => false) }] }],
        ['events.1.start', { ...base, events: [event, { ...event, start: '24:00' }] }],
        ['events.1.end', { ...base, events: [event, { ...event, end: '00:00' }] }],
        ['events.0.end', { ...base, events: [{ ...event, start: '09:00', end: '09:00' }] }],
        ['events.0.playlistId', { ...base, events: [{ ...event, playlistId: 'lunch' }] }],
        ['description', { ...base, description: 'a\tb', events: [] }],
        ['name', { ...base, name: ' ', events: [] }],
        ['defaultPlaylistId', { name: 'Refused', events: [] }],
        [
          'events',
          {
            ...base,
            events: Array.from({ length: ABSOLUTE.maxScheduleEvents + 1 }, () => event),
          },
        ],
      ];
      for (const [path, json] of cases) {
        const response = await alice.fetch('/api/schedules', { method: 'POST', json });
        expect(response.status, path).toBe(400);
        const body = (await response.json()) as ErrorBody;
        expect(body.error.code, path).toBe('validation_failed');
        expect(
          body.error.details?.map((detail) => detail.path),
          path,
        ).toContain(path);
      }
      // An unknown key, such as an organisation id, is refused too.
      const planted = await alice.fetch('/api/schedules', {
        method: 'POST',
        json: { ...base, events: [], orgId: orgB.orgId },
      });
      expect(planted.status).toBe(400);
      // Exactly 50 events are taken.
      const full = await createSchedule(
        alice,
        'Full',
        dayLoop,
        Array.from({ length: ABSOLUTE.maxScheduleEvents }, () => event),
      );
      expect(full.events).toHaveLength(ABSOLUTE.maxScheduleEvents);
    });

    it('refuses to delete a schedule a screen has assigned, naming the screens, then deletes it once unassigned', async () => {
      const schedule = await createSchedule(alice, 'Held', dayLoop, [scheduleEvent(lunchLoop)]);
      const zulu = await createDisplay(alice, orgA, 'zulu screen');
      const alpha = await createDisplay(alice, orgA, 'Alpha screen');
      await assignSchedule(alice, zulu.id, schedule.id);
      await assignSchedule(alice, alpha.id, schedule.id);
      expect((await getSchedule(alice, schedule.id)).assignedDisplayCount).toBe(2);

      const refused = await alice.fetch(`/api/schedules/${schedule.id}`, { method: 'DELETE' });
      expect(refused.status).toBe(409);
      const body = (await refused.json()) as ErrorBody;
      expect(body.error.code).toBe('schedule_in_use');
      expect(body.error.message).toBe(
        'This schedule is assigned to a screen. Assign other content to the screen first.',
      );
      expect(body.error.details).toEqual([
        { path: 'display', message: 'Alpha screen' },
        { path: 'display', message: 'zulu screen' },
      ]);
      // A refusal writes nothing.
      expect(
        (await auditEvents(alice, '&category=schedule')).filter(
          (e) => e.objectId === schedule.id && e.action === 'schedule.delete',
        ),
      ).toEqual([]);

      // Assigning a playlist, or removing the schedule, frees it.
      await assignPlaylist(alice, zulu.id, dayLoop);
      await assignSchedule(alice, alpha.id, null);
      expect(
        (await alice.fetch(`/api/schedules/${schedule.id}`, { method: 'DELETE' })).status,
      ).toBe(204);
      const [event] = (await auditEvents(alice, '&category=schedule')).filter(
        (e) => e.objectId === schedule.id,
      );
      expect(event).toMatchObject({ action: 'schedule.delete', detail: { eventCount: 1 } });
    });
  });

  describe('assigning to a screen', () => {
    it('takes the playlist off the screen, and a playlist takes the schedule off, saying so in the trail', async () => {
      const schedule = await createSchedule(alice, 'Shop week', dayLoop, [
        scheduleEvent(lunchLoop),
      ]);
      const display = await createDisplay(alice, orgA, 'Shop window');
      await assignPlaylist(alice, display.id, lunchLoop);

      // A schedule in place of the playlist.
      const scheduled = await patchDisplay(alice, display.id, {
        assignedScheduleId: upper(schedule.id),
      });
      expect(scheduled.status).toBe(200);
      const dto = DisplayDtoSchema.parse(await scheduled.json());
      expect(dto.assignedPlaylist).toBeNull();
      // The default playlist travels with it, for the preview on the screen's page.
      expect(dto.assignedSchedule).toEqual({
        id: schedule.id,
        name: 'Shop week',
        defaultPlaylist: { id: dayLoop, name: 'Day loop' },
      });
      const listed = (await (await alice.fetch('/api/displays')).json()) as { items: DisplayDto[] };
      expect(listed.items.find((item) => item.id === display.id)).toEqual(dto);
      expect(await lastDisplayUpdate(display.id)).toEqual({
        fields: ['assignedScheduleId'],
        assignedScheduleId: schedule.id,
        assignedPlaylistId: null,
      });
      // Nothing was published.
      expect(await desiredPublicationId(alice, display.id)).toBeNull();

      // Null on the playlist side clears that side only: the schedule stays.
      expect((await patchDisplay(alice, display.id, { assignedPlaylistId: null })).status).toBe(
        200,
      );
      expect((await getDisplay(alice, display.id)).assignedSchedule?.id).toBe(schedule.id);
      expect(await lastDisplayUpdate(display.id)).toEqual({
        fields: ['assignedPlaylistId'],
        assignedPlaylistId: null,
      });

      // A playlist in place of the schedule, as every caller that assigns a playlist does.
      await assignPlaylist(alice, display.id, dayLoop);
      expect(await getDisplay(alice, display.id)).toMatchObject({
        assignedPlaylist: { id: dayLoop, name: 'Day loop' },
        assignedSchedule: null,
      });
      expect(await lastDisplayUpdate(display.id)).toEqual({
        fields: ['assignedPlaylistId'],
        assignedPlaylistId: dayLoop,
        assignedScheduleId: null,
      });

      // Both null removes all content, whichever side held it.
      for (const assign of [
        () => assignPlaylist(alice, display.id, dayLoop),
        () => assignSchedule(alice, display.id, schedule.id),
      ]) {
        await assign();
        const emptied = await patchDisplay(alice, display.id, {
          assignedPlaylistId: null,
          assignedScheduleId: null,
        });
        expect(emptied.status).toBe(200);
        expect(DisplayDtoSchema.parse(await emptied.json())).toMatchObject({
          assignedPlaylist: null,
          assignedSchedule: null,
        });
        expect(await lastDisplayUpdate(display.id)).toEqual({
          fields: ['assignedPlaylistId', 'assignedScheduleId'],
          assignedPlaylistId: null,
          assignedScheduleId: null,
        });
        expect((await planRow(alice, display.id)).state).toBe('nothing_assigned');
      }

      // On a screen with nothing assigned the detail has only the key the patch sent.
      await assignSchedule(alice, display.id, schedule.id);
      expect(await lastDisplayUpdate(display.id)).toEqual({
        fields: ['assignedScheduleId'],
        assignedScheduleId: schedule.id,
      });
      await assignSchedule(alice, display.id, null);
      await assignPlaylist(alice, display.id, dayLoop);
      expect(await lastDisplayUpdate(display.id)).toEqual({
        fields: ['assignedPlaylistId'],
        assignedPlaylistId: dayLoop,
      });
      // A change that names neither side leaves both and records neither.
      expect((await patchDisplay(alice, display.id, { name: 'Shop window two' })).status).toBe(200);
      expect((await getDisplay(alice, display.id)).assignedPlaylist?.id).toBe(dayLoop);
      expect(await lastDisplayUpdate(display.id)).toEqual({ fields: ['name'] });
    });

    it('refuses a playlist and a schedule in one patch, and an unknown or foreign schedule', async () => {
      const schedule = await createSchedule(alice, 'Either', dayLoop);
      const foreign = await createSchedule(
        bob,
        'Theirs',
        await createPlaylist(bob, 'Their loop', []),
      );
      const display = await createDisplay(alice, orgA, 'One or the other');
      await assignPlaylist(alice, display.id, lunchLoop);

      const both = await patchDisplay(alice, display.id, {
        assignedPlaylistId: dayLoop,
        assignedScheduleId: schedule.id,
      });
      expect(both.status).toBe(400);
      expect(((await both.json()) as ErrorBody).error.details).toEqual([
        { path: 'assignedScheduleId', message: 'assign one of a playlist, a schedule or a layout' },
      ]);

      for (const id of [randomUUID(), foreign.id]) {
        const response = await patchDisplay(alice, display.id, {
          name: 'Renamed',
          assignedScheduleId: id,
        });
        expect(response.status).toBe(404);
        expect(((await response.json()) as ErrorBody).error.message).toBe(
          'The schedule was not found.',
        );
      }
      // Nothing of the refused patches was saved: the playlist is still there.
      expect(await getDisplay(alice, display.id)).toMatchObject({
        name: 'One or the other',
        assignedPlaylist: { id: lunchLoop },
        assignedSchedule: null,
      });
    });
  });

  describe('push', () => {
    it('publishes every playlist of the schedule as one version 4 publication, then follows edits', async () => {
      const clock = await createApp(alice);
      const fallback = await createPlaylist(alice, 'Fallback', [imageItem(imageA, 4)]);
      // The image of the event playlist is in no other playlist of this schedule.
      const special = await createPlaylist(alice, 'Special', [
        appItem(clock.id),
        imageItem(imageB, 9),
      ]);
      const lunch = scheduleEvent(special, '11:30', '14:00', WEEKDAYS);
      const evening = scheduleEvent(upper(special), '18:00', '02:00');
      const schedule = await createSchedule(alice, 'Cafe week', fallback, [lunch, evening]);
      const display = await createDisplay(alice, orgA, 'Cafe');
      await assignSchedule(alice, display.id, schedule.id);

      // The row names the schedule, and its default playlist as the playlist.
      expect(await planRow(alice, display.id)).toEqual({
        display: { id: display.id, name: 'Cafe' },
        playlist: { id: fallback, name: 'Fallback' },
        schedule: { id: schedule.id, name: 'Cafe week' },
        layout: null,
        state: 'never_pushed',
        issues: [],
        lastPushedAt: null,
      });

      const [first] = await pushed(alice, [display.id]);
      expect(first).toMatchObject({ outcome: 'published', issues: [] });
      const publicationId = first?.publicationId;
      expect(await desiredPublicationId(alice, display.id)).toBe(publicationId);
      const [stored] = await publications(orgA, display.id);
      // The publication's playlist is the default playlist of the schedule.
      expect(stored).toMatchObject({ id: publicationId, playlistId: fallback });
      const manifest = stored?.manifest;
      if (manifest?.schemaVersion !== 4) throw new Error('expected a version 4 manifest');
      // One flat list, default playlist first; a playlist used by two events appears once.
      expect(manifest.assets.map((asset) => asset.durationMs)).toEqual([4000, 10000, 9000]);
      expect(manifest.schedule).toEqual({
        playlists: [
          { count: 1, transition: 'cut', shuffle: false },
          { count: 2, transition: 'cut', shuffle: false },
        ],
        events: [
          { playlist: 1, days: WEEKDAYS, start: '11:30', end: '14:00' },
          { playlist: 1, days: EVERY_DAY, start: '18:00', end: '02:00' },
        ],
      });
      // Media of every playlist is recorded at its position in the flat list; the app has no file.
      const files = await withOrg(t.pool, orgA.orgId, async (tx) => {
        const { rows } = await tx.query<{ position: number; media_id: string }>(
          'SELECT position, media_id FROM publication_asset WHERE publication_id = $1 ORDER BY position',
          [publicationId],
        );
        return rows.map((row) => [row.position, row.media_id]);
      });
      expect(files).toEqual([
        [0, imageA],
        [2, imageB],
      ]);
      const [created] = (await auditEvents(alice, '&category=publication')).filter(
        (e) => e.objectId === publicationId,
      );
      expect(created).toMatchObject({
        action: 'publication.create',
        result: 'success',
        objectType: 'publication',
        detail: {
          displayId: display.id,
          playlistId: fallback,
          scheduleId: schedule.id,
          items: 3,
          route: 'browser',
          via: 'push',
        },
      });

      // Equal to what would be built now: nothing to push.
      expect(await planRow(alice, display.id)).toMatchObject({ state: 'up_to_date' });
      expect((await pushed(alice, [display.id]))[0]).toMatchObject({
        outcome: 'unchanged',
        publicationId,
      });
      // A new name is not part of what a screen is given.
      const renamed = { name: 'Cafe week two', defaultPlaylistId: fallback };
      await putSchedule(alice, schedule.id, { ...renamed, events: [lunch, evening] });
      expect(await planRow(alice, display.id)).toMatchObject({
        schedule: { name: 'Cafe week two' },
        state: 'up_to_date',
      });

      // Editing an event's time is a change; pushing it publishes once.
      await putSchedule(alice, schedule.id, {
        ...renamed,
        events: [{ ...lunch, end: '15:00' }],
      });
      expect(await planRow(alice, display.id)).toMatchObject({ state: 'changes' });
      const [second] = await pushed(alice, [display.id]);
      expect(second?.outcome).toBe('published');
      const edited = (await publications(orgA, display.id))[1]?.manifest;
      if (edited?.schemaVersion !== 4) throw new Error('expected a version 4 manifest');
      expect(edited.schedule.events).toEqual([
        { playlist: 1, days: WEEKDAYS, start: '11:30', end: '15:00' },
      ]);
      // An edit inside an event playlist is a change too.
      await alice.fetch(`/api/playlists/${special}`, {
        method: 'PUT',
        json: { name: 'Special', items: [appItem(clock.id), imageItem(imageB, 12)] },
      });
      expect(await planRow(alice, display.id)).toMatchObject({ state: 'changes' });
      expect((await pushed(alice, [display.id]))[0]?.outcome).toBe('published');

      // Removing the last event offers a push back to a version every player takes.
      await putSchedule(alice, schedule.id, { ...renamed, events: [] });
      expect(await planRow(alice, display.id)).toMatchObject({ state: 'changes' });
      const [back] = await pushed(alice, [display.id]);
      expect(back?.outcome).toBe('published');
      const plain = (await publications(orgA, display.id)).at(-1);
      expect(plain?.id).toBe(back?.publicationId);
      expect(plain?.playlistId).toBe(fallback);
      expect(plain?.manifest.schemaVersion).toBe(1);
      expect(plain?.manifest).not.toHaveProperty('schedule');
      expect(plain?.manifest.assets).toHaveLength(1);
      // The schedule is still recorded as what was pushed.
      const [plainEvent] = (await auditEvents(alice, '&category=publication')).filter(
        (e) => e.objectId === back?.publicationId,
      );
      expect(plainEvent?.detail).toMatchObject({ playlistId: fallback, scheduleId: schedule.id });

      // An event that names the default playlist can only ever play the default: no change.
      const onDefault = await putSchedule(alice, schedule.id, {
        ...renamed,
        events: [scheduleEvent(upper(fallback), '08:00', '12:00')],
      });
      expect(onDefault.status).toBe(200);
      expect(
        ScheduleDtoSchema.parse(await onDefault.json()).events.map((e) => e.playlist.id),
      ).toEqual([fallback]);
      expect(await planRow(alice, display.id)).toMatchObject({ state: 'up_to_date' });
      expect((await pushed(alice, [display.id]))[0]?.outcome).toBe('unchanged');
      // On a screen that has nothing yet it publishes the default playlist, below version 4.
      const fresh = await createDisplay(alice, orgA, 'Cafe two');
      await assignSchedule(alice, fresh.id, schedule.id);
      expect((await pushed(alice, [fresh.id]))[0]?.outcome).toBe('published');
      const [only] = await publications(orgA, fresh.id);
      expect(only?.manifest.schemaVersion).toBe(1);
      expect(only?.manifest).not.toHaveProperty('schedule');
      expect(only?.playlistId).toBe(fallback);
    });

    it('keeps the default playlist version of a schedule without such an event (v2, v3)', async () => {
      const clock = await createApp(alice);
      const fading = await createPlaylist(alice, 'Fading', [imageItem(imageA)]);
      const saved = await alice.fetch(`/api/playlists/${fading}`, {
        method: 'PUT',
        json: { name: 'Fading', items: [imageItem(imageA)], transition: 'fade' },
      });
      expect(saved.status).toBe(200);
      const withApp = await createPlaylist(alice, 'With app', [appItem(clock.id)]);
      for (const [playlistId, version] of [
        [fading, 2],
        [withApp, 3],
      ] as const) {
        const schedule = await createSchedule(alice, `Plain v${version}`, playlistId);
        const display = await createDisplay(alice, orgA, `Plain v${version}`);
        await assignSchedule(alice, display.id, schedule.id);
        expect((await pushed(alice, [display.id]))[0]?.outcome).toBe('published');
        const [publication] = await publications(orgA, display.id);
        expect(publication?.manifest.schemaVersion).toBe(version);
        expect(publication?.manifest).not.toHaveProperty('schedule');
      }
    });

    it('reports a schedule that cannot be published as blocked, and a push of it as rejected', async () => {
      const empty = await createPlaylist(alice, 'Empty loop', []);
      const schedule = await createSchedule(alice, 'Blocked week', dayLoop, [
        scheduleEvent(empty),
        scheduleEvent(lunchLoop, '18:00', '20:00'),
      ]);
      const display = await createDisplay(alice, orgA, 'Blocked screen');
      await assignPlaylist(alice, display.id, dayLoop);
      const [before] = await pushed(alice, [display.id]);
      await assignSchedule(alice, display.id, schedule.id);

      const row = await planRow(alice, display.id);
      expect(row).toMatchObject({
        playlist: { id: dayLoop },
        schedule: { id: schedule.id },
        state: 'blocked',
      });
      // The issue says where the playlist is used and which playlist it is.
      expect(row.issues).toEqual([
        expect.objectContaining({ path: 'events[0].playlist', code: 'playlist_empty' }),
      ]);
      expect(row.issues[0]?.message).toMatch(/^In playlist "Empty loop": /);

      const [rejected] = await pushed(alice, [display.id]);
      expect(rejected).toEqual({
        displayId: display.id,
        outcome: 'rejected',
        publicationId: null,
        issues: row.issues,
      });
      // The screen keeps what it had, and the schedule stays assigned for the operator to fix.
      expect(await desiredPublicationId(alice, display.id)).toBe(before?.publicationId);
      expect(await publications(orgA, display.id)).toHaveLength(1);
      expect((await getDisplay(alice, display.id)).assignedSchedule?.id).toBe(schedule.id);
      // The failure is recorded against the schedule.
      const [event] = (await auditEvents(alice, '&category=publication&result=failure')).filter(
        (e) => e.objectId === schedule.id,
      );
      expect(event).toMatchObject({
        action: 'publication.create',
        result: 'failure',
        objectType: 'schedule',
        detail: { displayId: display.id, reasons: ['playlist_empty'], via: 'push' },
      });

      // Once the playlist has something to show, the schedule goes out.
      await alice.fetch(`/api/playlists/${empty}`, {
        method: 'PUT',
        json: { name: 'Empty loop', items: [imageItem(imageA)] },
      });
      expect((await planRow(alice, display.id)).state).toBe('changes');
      const [fixed] = await pushed(alice, [display.id]);
      expect(fixed?.outcome).toBe('published');
      expect((await publications(orgA, display.id)).at(-1)?.manifest.schemaVersion).toBe(4);
    });
  });
});

describe('the item total of a schedule', () => {
  it('blocks a schedule whose playlists together hold more items than the route takes', async () => {
    const t = await startTestApp({ LIMIT_MAX_PLAYLIST_ITEMS: '3' });
    try {
      const org = await createOrg('Schedule total');
      const operator = await signIn(t, org);
      const clock = await createApp(operator);
      // Each playlist fits on its own; the three items of the two do too.
      const two = await createPlaylist(operator, 'Two', [appItem(clock.id), appItem(clock.id)]);
      const one = await createPlaylist(operator, 'One', [appItem(clock.id)]);
      const schedule = await createSchedule(operator, 'Total', two, [scheduleEvent(one)]);
      const display = await createDisplay(operator, org, 'Total screen');
      await assignSchedule(operator, display.id, schedule.id);
      const plan = async (): Promise<PushPlanRow | undefined> =>
        PushPlanResponseSchema.parse(await (await operator.fetch('/api/push')).json()).items[0];
      expect(await plan()).toMatchObject({ state: 'never_pushed', issues: [] });

      const saved = await operator.fetch(`/api/playlists/${one}`, {
        method: 'PUT',
        json: { name: 'One', items: [appItem(clock.id), appItem(clock.id)] },
      });
      expect(saved.status).toBe(200);
      const row = await plan();
      expect(row?.state).toBe('blocked');
      expect(row?.issues).toEqual([
        expect.objectContaining({ path: 'schedule', code: 'too_many_items' }),
      ]);
      expect(row?.issues[0]?.message).toContain(
        'The playlists of this schedule hold 4 items in total',
      );
      const response = await push(operator, [display.id]);
      expect(PushResponseSchema.parse(await response.json()).results).toEqual([
        { displayId: display.id, outcome: 'rejected', publicationId: null, issues: row?.issues },
      ]);
    } finally {
      await t.close();
    }
  });
});
