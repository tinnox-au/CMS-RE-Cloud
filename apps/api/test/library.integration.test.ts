/**
 * Portal v2, stage A: what an operator can say about media (name, description,
 * default duration, folder, tags), where media is used, and the tags and folders
 * themselves. Every answer is also checked against the shared schema the portal
 * validates with, so a field the API adds or drops fails here first.
 */
import { randomUUID } from 'node:crypto';
import {
  ABSOLUTE,
  FolderDtoSchema,
  FolderListResponseSchema,
  MediaDtoSchema,
  MediaListResponseSchema,
  MediaUsageResponseSchema,
  TagDtoSchema,
  TagListResponseSchema,
  type FolderDto,
  type MediaDto,
  type TagDto,
} from '@tinnox/contracts';
import { withOrg } from '@tinnox/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assignPlaylist,
  auditEvents,
  createDisplay,
  createOrg,
  createPlaylist,
  imageItem,
  publishImages,
  push,
  readyImage,
  readyVideo,
  signIn,
  startTestApp,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

interface ErrorBody {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
}

describe('media details, tags and folders', () => {
  let t: TestApp;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let alice: Operator;
  let bob: Operator;

  beforeAll(async () => {
    t = await startTestApp();
    orgA = await createOrg('Library A');
    orgB = await createOrg('Library B');
    alice = await signIn(t, orgA);
    bob = await signIn(t, orgB);
  });
  afterAll(async () => {
    await t.close();
  });

  const unique = (label: string): string => `${label} ${randomUUID().slice(0, 8)}`;

  async function getMedia(operator: Operator, id: string): Promise<MediaDto> {
    const response = await operator.fetch(`/api/media/${id}`);
    expect(response.status).toBe(200);
    return MediaDtoSchema.parse(await response.json());
  }

  function patchMedia(operator: Operator, id: string, json: unknown): Promise<Response> {
    return operator.fetch(`/api/media/${id}`, { method: 'PATCH', json });
  }

  async function createTag(
    operator: Operator,
    scope: 'media' | 'display',
    name: string,
    colour?: string,
  ): Promise<TagDto> {
    const response = await operator.fetch('/api/tags', {
      method: 'POST',
      json: { scope, name, ...(colour === undefined ? {} : { colour }) },
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return TagDtoSchema.parse(await response.json());
  }

  async function listTags(operator: Operator, query = ''): Promise<TagDto[]> {
    const response = await operator.fetch(`/api/tags${query}`);
    expect(response.status).toBe(200);
    return TagListResponseSchema.parse(await response.json()).items;
  }

  async function createFolder(operator: Operator, name: string): Promise<FolderDto> {
    const response = await operator.fetch('/api/folders', { method: 'POST', json: { name } });
    expect(response.status, await response.clone().text()).toBe(201);
    return FolderDtoSchema.parse(await response.json());
  }

  async function listFolders(operator: Operator): Promise<FolderDto[]> {
    const response = await operator.fetch('/api/folders');
    expect(response.status).toBe(200);
    return FolderListResponseSchema.parse(await response.json()).items;
  }

  async function errorOf(response: Response): Promise<ErrorBody['error']> {
    return ((await response.json()) as ErrorBody).error;
  }

  describe('PATCH /api/media/:id', () => {
    it('starts every media item with its file name, no description, folder or tags', async () => {
      const image = await readyImage(t, alice);
      const dto = await getMedia(alice, image.id);
      expect(dto).toMatchObject({
        name: 'sample.png',
        originalName: 'sample.png',
        description: null,
        defaultDurationMs: null,
        folderId: null,
        tagIds: [],
        usageCount: 0,
      });
      const list = MediaListResponseSchema.parse(await (await alice.fetch('/api/media')).json());
      expect(list.items.find((item) => item.id === image.id)).toEqual(dto);
    });

    it('sets name, description, default duration, folder and tags in one request', async () => {
      const image = await readyImage(t, alice);
      const folder = await createFolder(alice, unique('Posters'));
      const first = await createTag(alice, 'media', unique('Spring'));
      const second = await createTag(alice, 'media', unique('Lobby'), 'amber');

      const response = await patchMedia(alice, image.id, {
        name: '  Spring poster  ',
        description: 'Shown in the lobby.\nReplace in March.',
        defaultDurationMs: 12_000,
        folderId: folder.id,
        tagIds: [first.id, second.id],
      });
      expect(response.status).toBe(200);
      const dto = MediaDtoSchema.parse(await response.json());
      expect(dto).toMatchObject({
        name: 'Spring poster',
        originalName: 'sample.png',
        description: 'Shown in the lobby.\nReplace in March.',
        defaultDurationMs: 12_000,
        folderId: folder.id,
      });
      expect([...dto.tagIds].sort()).toEqual([first.id, second.id].sort());
      expect(await getMedia(alice, image.id)).toEqual(dto);

      const [event] = (await auditEvents(alice, '&category=media')).filter(
        (e) => e.action === 'media.update' && e.objectId === image.id,
      );
      expect(event).toMatchObject({
        result: 'success',
        actorId: orgA.membershipId,
        objectType: 'media',
        detail: { fields: ['defaultDurationMs', 'description', 'folderId', 'name', 'tagIds'] },
      });
      // The audit trail names the fields that changed, never their content.
      expect(JSON.stringify(event?.detail)).not.toContain('Spring poster');
    });

    it('changes only the fields that are sent, and clears with null or an empty string', async () => {
      const image = await readyImage(t, alice);
      const folder = await createFolder(alice, unique('Menus'));
      const tag = await createTag(alice, 'media', unique('Menu'));
      await patchMedia(alice, image.id, {
        name: 'Lunch menu',
        description: 'Weekdays',
        defaultDurationMs: 8000,
        folderId: folder.id,
        tagIds: [tag.id],
      });

      const renamed = MediaDtoSchema.parse(
        await (await patchMedia(alice, image.id, { name: 'Dinner menu' })).json(),
      );
      expect(renamed).toMatchObject({
        name: 'Dinner menu',
        description: 'Weekdays',
        defaultDurationMs: 8000,
        folderId: folder.id,
        tagIds: [tag.id],
      });

      const cleared = MediaDtoSchema.parse(
        await (
          await patchMedia(alice, image.id, {
            name: '',
            description: '   ',
            defaultDurationMs: null,
            folderId: null,
            tagIds: [],
          })
        ).json(),
      );
      // Without a name of its own the item shows its file name again.
      expect(cleared).toMatchObject({
        name: 'sample.png',
        description: null,
        defaultDurationMs: null,
        folderId: null,
        tagIds: [],
      });
      const viaNull = await patchMedia(alice, image.id, { name: null, description: null });
      expect(MediaDtoSchema.parse(await viaNull.json()).name).toBe('sample.png');
    });

    it('leaves updatedAt alone when only the tags change', async () => {
      const image = await readyImage(t, alice);
      const tag = await createTag(alice, 'media', unique('Quiet'));
      const before = await getMedia(alice, image.id);
      const after = MediaDtoSchema.parse(
        await (await patchMedia(alice, image.id, { tagIds: [tag.id] })).json(),
      );
      expect(after.tagIds).toEqual([tag.id]);
      expect(after.updatedAt).toBe(before.updatedAt);
    });

    it('refuses a request that changes nothing, has unknown fields or breaks a bound', async () => {
      const image = await readyImage(t, alice);
      const tag = await createTag(alice, 'media', unique('Twice'));
      const cases: [string, unknown][] = [
        ['no field', {}],
        ['an unknown field', { name: 'x', orgId: orgB.orgId }],
        ['a field the worker owns', { status: 'ready' }],
        ['a name of 121 characters', { name: 'n'.repeat(121) }],
        ['a name with a control character', { name: 'bad\u0007name' }],
        ['a name with a right-to-left override', { name: 'ZZ \u202Egpj.exe' }],
        ['a description with a direction override', { description: 'ZZ \u202Etxet' }],
        ['a description of 501 characters', { description: 'd'.repeat(501) }],
        ['a fractional duration', { defaultDurationMs: 1500.5 }],
        ['a duration of zero', { defaultDurationMs: 0 }],
        ['a folder id that is not a UUID', { folderId: 'root' }],
        ['the same tag twice', { tagIds: [tag.id, tag.id.toUpperCase()] }],
        ['51 tags', { tagIds: Array.from({ length: 51 }, () => randomUUID()) }],
      ];
      for (const [what, body] of cases) {
        const response = await patchMedia(alice, image.id, body);
        expect(response.status, what).toBe(400);
        expect((await errorOf(response)).code, what).toBe('validation_failed');
      }
      expect(await getMedia(alice, image.id)).toMatchObject({ name: 'sample.png', tagIds: [] });
    });

    it('allows a default duration on images only, within the configured image limits', async () => {
      const image = await readyImage(t, alice);
      const video = await readyVideo(t, alice);
      const { minImageItemDurationMs: min, maxImageItemDurationMs: max } = t.config.limits;

      for (const [what, value] of [
        ['below the minimum', min - 1],
        ['above the maximum', max + 1],
      ] as const) {
        const response = await patchMedia(alice, image.id, { defaultDurationMs: value });
        expect(response.status, what).toBe(400);
        const error = await errorOf(response);
        expect(error.code).toBe('validation_failed');
        expect(error.details?.[0]?.path).toBe('defaultDurationMs');
      }
      for (const value of [min, max]) {
        const response = await patchMedia(alice, image.id, { defaultDurationMs: value });
        expect(response.status).toBe(200);
        expect(MediaDtoSchema.parse(await response.json()).defaultDurationMs).toBe(value);
      }

      const onVideo = await patchMedia(alice, video.id, { defaultDurationMs: min });
      expect(onVideo.status).toBe(400);
      expect((await errorOf(onVideo)).details?.[0]?.path).toBe('defaultDurationMs');
      // Null is accepted for a video: there is nothing to clear, and nothing is set.
      const cleared = await patchMedia(alice, video.id, { defaultDurationMs: null, name: 'Clip' });
      expect(cleared.status).toBe(200);
      expect(MediaDtoSchema.parse(await cleared.json())).toMatchObject({
        kind: 'video',
        name: 'Clip',
        defaultDurationMs: null,
      });
    });

    it('answers 404 for an unknown folder or tag, a tag of the display scope and anything of another organisation, and changes nothing', async () => {
      const image = await readyImage(t, alice);
      const ownTag = await createTag(alice, 'media', unique('Own'));
      const displayTag = await createTag(alice, 'display', unique('Foyer'));
      const foreignTag = await createTag(bob, 'media', unique('Theirs'));
      const foreignFolder = await createFolder(bob, unique('Theirs'));
      const before = await getMedia(alice, image.id);

      const cases: [string, unknown][] = [
        ['an unknown folder', { name: 'Changed', folderId: randomUUID() }],
        ['a folder of another organisation', { name: 'Changed', folderId: foreignFolder.id }],
        ['an unknown tag', { name: 'Changed', tagIds: [ownTag.id, randomUUID()] }],
        ['a display tag', { name: 'Changed', tagIds: [displayTag.id] }],
        ['a tag of another organisation', { name: 'Changed', tagIds: [foreignTag.id] }],
      ];
      for (const [what, body] of cases) {
        const response = await patchMedia(alice, image.id, body);
        expect(response.status, what).toBe(404);
        expect((await errorOf(response)).code, what).toBe('not_found');
      }
      // The name sent with each refused request was not saved either.
      expect(await getMedia(alice, image.id)).toEqual(before);

      // Another organisation's media item answers like an unknown id, whatever is sent.
      for (const id of [image.id, randomUUID()]) {
        const response = await patchMedia(bob, id, { name: 'Taken' });
        expect(response.status).toBe(404);
        expect((await errorOf(response)).message).toBe('The media item was not found.');
      }
      expect((await getMedia(alice, image.id)).name).toBe('sample.png');
    });
  });

  describe('GET /api/media/:id/usage', () => {
    it('lists the live playlists that contain the item and the displays currently given it', async () => {
      const image = await readyImage(t, alice);
      const other = await readyImage(t, alice);
      const display = await createDisplay(alice, orgA, unique('Usage display'));
      const idle = await createDisplay(alice, orgA, unique('Idle display'));

      const zebra = await createPlaylist(alice, 'Zebra loop', [
        imageItem(image.id),
        imageItem(other.id),
        imageItem(image.id),
      ]);
      const apple = await createPlaylist(alice, 'apple loop', [imageItem(image.id)]);
      await createPlaylist(alice, 'Unrelated', [imageItem(other.id)]);
      await assignPlaylist(alice, display.id, zebra);
      // Assigned but not pushed: the display has not been given the item yet.
      await assignPlaylist(alice, idle.id, apple);
      expect((await push(alice, [display.id])).status).toBe(200);

      const usage = MediaUsageResponseSchema.parse(
        await (await alice.fetch(`/api/media/${image.id}/usage`)).json(),
      );
      // Each playlist once, ordered by name without regard to case.
      expect(usage.playlists).toEqual([
        { id: apple, name: 'apple loop' },
        { id: zebra, name: 'Zebra loop' },
      ]);
      expect(usage.displays.map((d) => d.id)).toEqual([display.id]);
      expect((await getMedia(alice, image.id)).usageCount).toBe(2);
      expect((await getMedia(alice, other.id)).usageCount).toBe(2);

      // Taking the item out of the playlist does not change what the display was given.
      await alice.fetch(`/api/playlists/${zebra}`, {
        method: 'PUT',
        json: { name: 'Zebra loop', items: [imageItem(other.id)] },
      });
      const edited = MediaUsageResponseSchema.parse(
        await (await alice.fetch(`/api/media/${image.id}/usage`)).json(),
      );
      expect(edited.playlists.map((p) => p.id)).toEqual([apple]);
      expect(edited.displays.map((d) => d.id)).toEqual([display.id]);

      // After the push of the edited playlist the display no longer holds it.
      expect((await push(alice, [display.id])).status).toBe(200);
      const pushed = MediaUsageResponseSchema.parse(
        await (await alice.fetch(`/api/media/${image.id}/usage`)).json(),
      );
      expect(pushed.displays).toEqual([]);
    });

    it('answers 404 for an unknown item and for an item of another organisation', async () => {
      const image = await readyImage(t, alice);
      expect((await alice.fetch(`/api/media/${image.id}/usage`)).status).toBe(200);
      const foreign = await bob.fetch(`/api/media/${image.id}/usage`);
      const unknown = await bob.fetch(`/api/media/${randomUUID()}/usage`);
      expect(foreign.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect((await errorOf(foreign)).message).toBe((await errorOf(unknown)).message);
    });
  });

  describe('tags', () => {
    it('creates tags per scope with a default colour and lists them by scope and name', async () => {
      const org = await createOrg('Tag listing');
      const carol = await signIn(t, org);
      const beta = await createTag(carol, 'media', 'beta');
      const alpha = await createTag(carol, 'media', 'Alpha', 'violet');
      const wall = await createTag(carol, 'display', 'Video wall');
      expect(beta).toMatchObject({ scope: 'media', name: 'beta', colour: 'teal', usageCount: 0 });
      expect(alpha.colour).toBe('violet');

      expect((await listTags(carol, '?scope=media')).map((tag) => tag.id)).toEqual([
        alpha.id,
        beta.id,
      ]);
      expect((await listTags(carol, '?scope=display')).map((tag) => tag.id)).toEqual([wall.id]);
      // Without a scope: display tags, then media tags, each by name.
      expect((await listTags(carol)).map((tag) => tag.id)).toEqual([wall.id, alpha.id, beta.id]);
      expect((await carol.fetch('/api/tags?scope=playlist')).status).toBe(400);
      expect((await carol.fetch('/api/tags?orgId=' + orgA.orgId)).status).toBe(400);

      const [event] = (await auditEvents(carol, '&category=tag')).filter(
        (e) => e.objectId === alpha.id,
      );
      expect(event).toMatchObject({
        action: 'tag.create',
        result: 'success',
        objectType: 'tag',
        detail: { scope: 'media', colour: 'violet' },
      });
    });

    it('refuses a name already used in the same scope, ignoring case, with 409 conflict', async () => {
      const name = unique('Seasonal');
      const original = await createTag(alice, 'media', name);
      for (const taken of [name, name.toUpperCase(), `  ${name}  `]) {
        const response = await alice.fetch('/api/tags', {
          method: 'POST',
          json: { scope: 'media', name: taken },
        });
        expect(response.status, taken).toBe(409);
        expect((await errorOf(response)).code).toBe('conflict');
      }
      // The same name is free in the other scope and in another organisation.
      await createTag(alice, 'display', name);
      await createTag(bob, 'media', name);
      expect((await listTags(alice, '?scope=media')).filter((tag) => tag.name === name)).toEqual([
        original,
      ]);
    });

    it('validates what a tag may be', async () => {
      const cases: [string, unknown][] = [
        ['no scope', { name: 'x' }],
        ['an unknown scope', { scope: 'playlist', name: 'x' }],
        ['a blank name', { scope: 'media', name: '   ' }],
        ['a name of 41 characters', { scope: 'media', name: 't'.repeat(41) }],
        ['an unknown colour', { scope: 'media', name: 'x', colour: 'magenta' }],
        ['an unknown field', { scope: 'media', name: 'x', usageCount: 5 }],
        ['a right-to-left override', { scope: 'media', name: 'ZZ \u202Egpj.exe' }],
        ['a direction isolate', { scope: 'display', name: 'ZZ \u2067x\u2069' }],
        ['a C1 control', { scope: 'display', name: 'ZZ c1\u0085x' }],
      ];
      for (const [what, body] of cases) {
        const response = await alice.fetch('/api/tags', { method: 'POST', json: body });
        expect(response.status, what).toBe(400);
      }
      const longest = await createTag(alice, 'media', `${randomUUID()}abcd`);
      expect(longest.name).toHaveLength(40);
    });

    it('renames and recolours a tag, never changes its scope, and keeps names unique', async () => {
      const tag = await createTag(alice, 'media', unique('Draft'));
      const taken = await createTag(alice, 'media', unique('Final'));

      const recoloured = await alice.fetch(`/api/tags/${tag.id}`, {
        method: 'PATCH',
        json: { colour: 'red' },
      });
      expect(TagDtoSchema.parse(await recoloured.json())).toEqual({ ...tag, colour: 'red' });
      const newName = unique('Approved');
      const renamed = await alice.fetch(`/api/tags/${tag.id}`, {
        method: 'PATCH',
        json: { name: newName },
      });
      expect(TagDtoSchema.parse(await renamed.json())).toEqual({
        ...tag,
        name: newName,
        colour: 'red',
      });
      // A change of letter case alone is a rename of the same tag, not a clash with itself.
      const recased = await alice.fetch(`/api/tags/${tag.id}`, {
        method: 'PATCH',
        json: { name: newName.toUpperCase() },
      });
      expect(recased.status).toBe(200);

      const clash = await alice.fetch(`/api/tags/${tag.id}`, {
        method: 'PATCH',
        json: { name: taken.name.toLowerCase() },
      });
      expect(clash.status).toBe(409);
      expect((await errorOf(clash)).code).toBe('conflict');
      for (const [what, body] of [
        ['a scope', { scope: 'display' }],
        ['nothing', {}],
      ] as const) {
        const response = await alice.fetch(`/api/tags/${tag.id}`, { method: 'PATCH', json: body });
        expect(response.status, what).toBe(400);
      }
      const stored = (await listTags(alice, '?scope=media')).find((item) => item.id === tag.id);
      expect(stored).toMatchObject({ scope: 'media', name: newName.toUpperCase(), colour: 'red' });
      expect(
        (await auditEvents(alice, '&category=tag')).filter(
          (e) => e.action === 'tag.update' && e.objectId === tag.id,
        ),
      ).toHaveLength(3);
    });

    it('counts the items that carry a tag, and removes it from all of them when it is deleted', async () => {
      const image = await readyImage(t, alice);
      const second = await readyImage(t, alice);
      const display = await createDisplay(alice, orgA, unique('Tagged display'));
      const mediaTag = await createTag(alice, 'media', unique('Campaign'));
      const displayTag = await createTag(alice, 'display', unique('Ground floor'));
      const kept = await createTag(alice, 'media', unique('Kept'));

      await patchMedia(alice, image.id, { tagIds: [mediaTag.id, kept.id] });
      await patchMedia(alice, second.id, { tagIds: [mediaTag.id] });
      const tagged = await alice.fetch(`/api/displays/${display.id}`, {
        method: 'PATCH',
        json: { tagIds: [displayTag.id] },
      });
      expect(tagged.status).toBe(200);
      const usage = async (id: string): Promise<number | undefined> =>
        (await listTags(alice)).find((tag) => tag.id === id)?.usageCount;
      expect(await usage(mediaTag.id)).toBe(2);
      expect(await usage(displayTag.id)).toBe(1);

      const removed = await alice.fetch(`/api/tags/${mediaTag.id}`, { method: 'DELETE' });
      expect(removed.status).toBe(204);
      expect((await getMedia(alice, image.id)).tagIds).toEqual([kept.id]);
      expect((await getMedia(alice, second.id)).tagIds).toEqual([]);
      expect(await usage(mediaTag.id)).toBeUndefined();
      const [event] = (await auditEvents(alice, '&category=tag')).filter(
        (e) => e.action === 'tag.delete' && e.objectId === mediaTag.id,
      );
      expect(event?.detail).toEqual({ scope: 'media', removedFrom: 2 });

      expect((await alice.fetch(`/api/tags/${displayTag.id}`, { method: 'DELETE' })).status).toBe(
        204,
      );
      const after = (await (await alice.fetch(`/api/displays/${display.id}`)).json()) as {
        tagIds: string[];
      };
      expect(after.tagIds).toEqual([]);
      // Deleting it again, or deleting what never existed, is 404.
      expect((await alice.fetch(`/api/tags/${displayTag.id}`, { method: 'DELETE' })).status).toBe(
        404,
      );
    });

    it('does not count media that was deleted but is kept for a publication', async () => {
      const image = await readyImage(t, alice);
      const display = await createDisplay(alice, orgA, unique('Retaining display'));
      const tag = await createTag(alice, 'media', unique('Retired'));
      const folder = await createFolder(alice, unique('Retired'));
      await patchMedia(alice, image.id, { tagIds: [tag.id], folderId: folder.id });
      const { playlistId } = await publishImages(alice, display.id, [image.id]);
      // Free the item from its playlist, then delete it: the publication keeps the row.
      await alice.fetch(`/api/playlists/${playlistId}`, {
        method: 'PUT',
        json: { name: 'Emptied', items: [] },
      });
      expect((await alice.fetch(`/api/media/${image.id}`, { method: 'DELETE' })).status).toBe(204);
      expect((await alice.fetch(`/api/media/${image.id}`)).status).toBe(404);

      expect((await listTags(alice)).find((item) => item.id === tag.id)?.usageCount).toBe(0);
      expect((await listFolders(alice)).find((item) => item.id === folder.id)?.itemCount).toBe(0);
    });

    it('gives no access to another organisation’s tags', async () => {
      const tag = await createTag(alice, 'media', unique('Private'));
      const unknown = randomUUID();
      for (const id of [tag.id, unknown]) {
        const patch = await bob.fetch(`/api/tags/${id}`, {
          method: 'PATCH',
          json: { name: 'Taken' },
        });
        const remove = await bob.fetch(`/api/tags/${id}`, { method: 'DELETE' });
        expect(patch.status).toBe(404);
        expect(remove.status).toBe(404);
        expect((await errorOf(patch)).message).toBe('The tag was not found.');
      }
      expect((await listTags(bob)).map((item) => item.id)).not.toContain(tag.id);
      expect((await listTags(alice)).find((item) => item.id === tag.id)).toEqual(tag);
    });
  });

  describe('folders', () => {
    it('creates, lists by name with item counts, and renames folders', async () => {
      const org = await createOrg('Folder listing');
      const carol = await signIn(t, org);
      const winter = await createFolder(carol, 'winter');
      const autumn = await createFolder(carol, '  Autumn  ');
      expect(autumn).toEqual({ id: autumn.id, name: 'Autumn', itemCount: 0 });
      const image = await readyImage(t, carol);
      await patchMedia(carol, image.id, { folderId: winter.id });

      expect(await listFolders(carol)).toEqual([
        { id: autumn.id, name: 'Autumn', itemCount: 0 },
        { id: winter.id, name: 'winter', itemCount: 1 },
      ]);

      const renamed = await carol.fetch(`/api/folders/${winter.id}`, {
        method: 'PATCH',
        json: { name: 'Winter 2027' },
      });
      expect(FolderDtoSchema.parse(await renamed.json())).toEqual({
        id: winter.id,
        name: 'Winter 2027',
        itemCount: 1,
      });
      const actions = (await auditEvents(carol, '&category=folder')).map((e) => e.action);
      expect(actions).toEqual(['folder.update', 'folder.create', 'folder.create']);
    });

    it('refuses a name already in use, ignoring case, and names outside the bounds', async () => {
      const name = unique('Brand');
      const folder = await createFolder(alice, name);
      const other = await createFolder(alice, unique('Other'));
      const duplicate = await alice.fetch('/api/folders', {
        method: 'POST',
        json: { name: name.toUpperCase() },
      });
      expect(duplicate.status).toBe(409);
      expect((await errorOf(duplicate)).code).toBe('conflict');
      const renameClash = await alice.fetch(`/api/folders/${other.id}`, {
        method: 'PATCH',
        json: { name },
      });
      expect(renameClash.status).toBe(409);
      // Another organisation may use the same name.
      await createFolder(bob, name);

      for (const [what, body] of [
        ['a blank name', { name: ' ' }],
        ['a name of 81 characters', { name: 'f'.repeat(81) }],
        ['no name', {}],
        ['an unknown field', { name: 'x', itemCount: 3 }],
        ['a right-to-left override', { name: 'ZZ \u202Efdp.exe' }],
        ['a left-to-right mark', { name: 'ZZ \u200Ename' }],
      ] as const) {
        expect(
          (await alice.fetch('/api/folders', { method: 'POST', json: body })).status,
          what,
        ).toBe(400);
        expect(
          (await alice.fetch(`/api/folders/${folder.id}`, { method: 'PATCH', json: body })).status,
          what,
        ).toBe(400);
      }
      expect((await createFolder(alice, 'g'.repeat(80))).name).toHaveLength(80);
    });

    it('moves the media of a deleted folder to the root', async () => {
      const folder = await createFolder(alice, unique('Temporary'));
      const first = await readyImage(t, alice);
      const second = await readyImage(t, alice);
      await patchMedia(alice, first.id, { folderId: folder.id, name: 'Stays named' });
      await patchMedia(alice, second.id, { folderId: folder.id });

      const removed = await alice.fetch(`/api/folders/${folder.id}`, { method: 'DELETE' });
      expect(removed.status).toBe(204);
      expect(await getMedia(alice, first.id)).toMatchObject({
        folderId: null,
        name: 'Stays named',
      });
      expect((await getMedia(alice, second.id)).folderId).toBeNull();
      expect((await listFolders(alice)).map((item) => item.id)).not.toContain(folder.id);
      const [event] = (await auditEvents(alice, '&category=folder')).filter(
        (e) => e.action === 'folder.delete' && e.objectId === folder.id,
      );
      expect(event?.detail).toEqual({ movedToRoot: 2 });
      expect((await alice.fetch(`/api/folders/${folder.id}`, { method: 'DELETE' })).status).toBe(
        404,
      );
    });

    it('gives no access to another organisation’s folders', async () => {
      const folder = await createFolder(alice, unique('Private'));
      for (const id of [folder.id, randomUUID()]) {
        const patch = await bob.fetch(`/api/folders/${id}`, {
          method: 'PATCH',
          json: { name: 'Taken' },
        });
        const remove = await bob.fetch(`/api/folders/${id}`, { method: 'DELETE' });
        expect(patch.status).toBe(404);
        expect(remove.status).toBe(404);
        expect((await errorOf(remove)).message).toBe('The folder was not found.');
      }
      expect((await listFolders(bob)).map((item) => item.id)).not.toContain(folder.id);
      expect((await listFolders(alice)).find((item) => item.id === folder.id)).toEqual(folder);
    });
  });

  /**
   * The portal refuses a list longer than `maxListItems`, so the API must never let an
   * organisation hold more tags or folders than that. The rows are inserted directly, as
   * the runtime role under the organisation's row-level security, to reach the ceiling.
   */
  describe('the ceiling on tags and folders per organisation', () => {
    it('refuses the tag after the last one allowed, in either scope, for that organisation only', async () => {
      const full = await createOrg('Library full of tags');
      const carol = await signIn(t, full);
      await withOrg(t.pool, full.orgId, async (tx) => {
        await tx.query(
          `INSERT INTO tag (org_id, scope, name, colour)
           SELECT app_org_id(), CASE WHEN g % 2 = 0 THEN 'media' ELSE 'display' END,
                  'bulk ' || g, 'teal'
           FROM generate_series(1, $1::int) AS g`,
          [ABSOLUTE.maxListItems - 1],
        );
      });
      // One below the ceiling: the last tag allowed is created.
      const last = await createTag(carol, 'media', unique('Last'));
      for (const scope of ['media', 'display'] as const) {
        const refused = await carol.fetch('/api/tags', {
          method: 'POST',
          json: { scope, name: unique('Over') },
        });
        expect(refused.status, scope).toBe(409);
        const error = await errorOf(refused);
        expect(error.code).toBe('conflict');
        expect(error.message).toContain(`${ABSOLUTE.maxListItems} tags`);
      }
      // Another organisation is not affected.
      await createTag(bob, 'media', unique('Elsewhere'));
      // Deleting one makes room for exactly one more.
      expect((await carol.fetch(`/api/tags/${last.id}`, { method: 'DELETE' })).status).toBe(204);
      await createTag(carol, 'display', unique('Again'));
      const over = await carol.fetch('/api/tags', {
        method: 'POST',
        json: { scope: 'media', name: unique('Over') },
      });
      expect(over.status).toBe(409);
    });

    it('refuses the folder after the last one allowed, for that organisation only', async () => {
      const full = await createOrg('Library full of folders');
      const dave = await signIn(t, full);
      await withOrg(t.pool, full.orgId, async (tx) => {
        await tx.query(
          `INSERT INTO folder (org_id, name)
           SELECT app_org_id(), 'bulk ' || g FROM generate_series(1, $1::int) AS g`,
          [ABSOLUTE.maxListItems - 1],
        );
      });
      const last = await createFolder(dave, unique('Last'));
      const refused = await dave.fetch('/api/folders', {
        method: 'POST',
        json: { name: unique('Over') },
      });
      expect(refused.status).toBe(409);
      const error = await errorOf(refused);
      expect(error.code).toBe('conflict');
      expect(error.message).toContain(`${ABSOLUTE.maxListItems} folders`);
      await createFolder(bob, unique('Elsewhere'));
      expect((await dave.fetch(`/api/folders/${last.id}`, { method: 'DELETE' })).status).toBe(204);
      await createFolder(dave, unique('Again'));
      expect(
        (await dave.fetch('/api/folders', { method: 'POST', json: { name: unique('Over') } }))
          .status,
      ).toBe(409);
    });
  });
});
