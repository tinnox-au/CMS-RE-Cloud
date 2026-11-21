import type {
  DisplayDto,
  PlaylistDto,
  PlaylistMediaItemDto,
  PushPlanResponse,
} from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { app } from './mediaLibrary.test-support.ts';
import {
  AssignedReadError,
  assignedContent,
  assignedPlaylistStateOf,
  descriptionCountLabel,
  pairingAcceptedText,
  pairingHelp,
  pairingHint,
  pairingStateText,
  pairingTtlMinutes,
  APP_PREVIEW_DISCLAIMER,
  PREVIEW_DISCLAIMER,
  previewCaption,
  previewStateOf,
  pushRowFor,
  REPORTED_FACTS_NOTE,
  endPairingWords,
  revokeOutcomeText,
  sameTagIds,
  SCREEN_DETAIL_TABS,
  SCREEN_STATUS_POLL_MS,
  screenDetailSearch,
  screenDetailsDirty,
  screenDetailTabOf,
  plannedTabReason,
  STATUS_DISCLAIMER,
  tagsSavedText,
  validateScreenDetails,
  validateWorkingHours,
  workingHoursDirty,
  workingHoursDraftOf,
  type PreviewState,
} from './screenDetail.ts';

const stored: Pick<DisplayDto, 'name' | 'description'> = { name: 'Foyer', description: null };

type Item = PlaylistMediaItemDto;

function firstMedia(content: ReturnType<typeof assignedContent>) {
  const first = content.first;
  return first === null || 'app' in first ? null : first;
}
function item(
  position: number,
  mediaId: string,
  kind: 'image' | 'video',
  extra: Partial<Item> = {},
): Item {
  return {
    id: `00000000-0000-4000-8000-00000000000${position}`,
    position,
    mediaId,
    durationMs: kind === 'image' ? 10_000 : null,
    fit: null,
    media: {
      id: mediaId,
      kind,
      status: 'ready',
      name: `file ${mediaId.slice(-1)}`,
      originalName: `file ${mediaId.slice(-1)}`,
      description: null,
      defaultDurationMs: null,
      availableFrom: null,
      availableUntil: null,
      folderId: null,
      tagIds: [],
      usageCount: 1,
      mimeType: null,
      bytes: null,
      sha256: null,
      width: null,
      height: null,
      durationMs: kind === 'video' ? 5000 : null,
      codec: null,
      errorCode: null,
      errorDetail: null,
      createdAt: '2026-11-15T00:00:00.000Z',
      updatedAt: '2026-11-15T00:00:00.000Z',
    },
    ...extra,
  };
}

const M1 = '10000000-0000-4000-8000-000000000001';
const M2 = '10000000-0000-4000-8000-000000000002';
const M3 = '10000000-0000-4000-8000-000000000003';
const CLOCK = app(7);
const ID_APP_ITEM = '00000000-0000-4000-8000-000000000009';

function playlist(items: PlaylistDto['items']): PlaylistDto {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Reception loop',
    description: null,
    transition: 'cut',
    shuffle: false,
    items,
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z',
  };
}

describe('tabs', () => {
  it('opens a known tab from ?tab= and falls back to the overview', () => {
    expect(screenDetailTabOf('canvas')).toBe('canvas');
    expect(screenDetailTabOf('pairing')).toBe('pairing');
    expect(screenDetailTabOf('tags')).toBe('tags');
    expect(screenDetailTabOf(null)).toBe('overview');
    expect(screenDetailTabOf('alerts')).toBe('alerts');
    expect(screenDetailTabOf('advanced')).toBe('overview');
    expect(screenDetailTabOf('nonsense')).toBe('overview');
  });

  it('keeps other parameters and drops tab for the overview', () => {
    expect(screenDetailSearch('a=1', 'canvas')).toBe('?a=1&tab=canvas');
    expect(screenDetailSearch('tab=canvas', 'overview')).toBe('');
    expect(screenDetailSearch('tab=canvas&a=1', 'overview')).toBe('?a=1');
  });

  it('lists the planned tabs with their stage', () => {
    const planned = SCREEN_DETAIL_TABS.filter((tab) => tab.plannedStage !== null);
    expect(planned.map((tab) => tab.label)).toEqual(['Advanced']);
    expect(screenDetailTabOf('working-hours')).toBe('working-hours');
    expect(plannedTabReason('B')).toBe('Planned for stage B');
  });

  it('polls the status every 5 s as M0 did', () => {
    expect(SCREEN_STATUS_POLL_MS).toBe(5000);
  });
});

describe('working hours', () => {
  const closed = { open: false, start: '09:00', end: '17:00' };

  it('starts from Monday to Friday 09:00 to 17:00 and saves always on as null', () => {
    const draft = workingHoursDraftOf(null);
    expect(draft.alwaysOn).toBe(true);
    expect(draft.days.map((day) => day.open)).toEqual([true, true, true, true, true, false, false]);
    expect(validateWorkingHours(draft)).toEqual({ ok: true, value: null });
    expect(workingHoursDirty(draft, null)).toBe(false);
    const on = { ...draft, alwaysOn: false };
    expect(workingHoursDirty(on, null)).toBe(true);
    const week = validateWorkingHours(on);
    expect(week.ok && week.value).toEqual([
      ...Array.from({ length: 5 }, () => ({ start: '09:00', end: '17:00' })),
      null,
      null,
    ]);
  });

  it('saves an end of 00:00 as 24:00 and shows 24:00 as 00:00', () => {
    const days = [
      { open: true, start: '18:00', end: '00:00' },
      ...Array.from({ length: 6 }, () => closed),
    ];
    const result = validateWorkingHours({ alwaysOn: false, days });
    expect(result.ok && result.value?.[0]).toEqual({ start: '18:00', end: '24:00' });
    const stored = result.ok ? result.value : null;
    expect(workingHoursDraftOf(stored).days[0]).toEqual(days[0]);
    expect(workingHoursDirty({ alwaysOn: false, days }, stored)).toBe(false);
  });

  it('needs the end after the start, and at least one day', () => {
    const days = [
      { open: true, start: '17:00', end: '09:00' },
      ...Array.from({ length: 6 }, () => closed),
    ];
    const result = validateWorkingHours({ alwaysOn: false, days });
    expect(result.ok ? null : result.errors.days[0]).toBe('End must be after start.');
    const none = validateWorkingHours({
      alwaysOn: false,
      days: Array.from({ length: 7 }, () => closed),
    });
    expect(none.ok ? null : none.errors.form).toBe(
      'Choose at least one day, or turn on Always on.',
    );
  });
});

describe('name and description', () => {
  it('builds a patch of the changed fields only', () => {
    expect(validateScreenDetails({ name: ' Lobby ', description: '' }, stored)).toEqual({
      ok: true,
      patch: { name: 'Lobby' },
    });
    expect(
      validateScreenDetails({ name: 'Foyer', description: ' Left\r\nof lifts ' }, stored),
    ).toEqual({
      ok: true,
      patch: { description: 'Left\nof lifts' },
    });
    expect(validateScreenDetails({ name: 'Foyer ', description: '  ' }, stored)).toEqual({
      ok: true,
      patch: null,
    });
    expect(
      validateScreenDetails(
        { name: 'Foyer', description: '' },
        { name: 'Foyer', description: 'Old' },
      ),
    ).toEqual({ ok: true, patch: { description: null } });
  });

  it('refuses an empty, long or control-character name and a long description', () => {
    const empty = validateScreenDetails({ name: '  ', description: '' }, stored);
    expect(empty.ok ? null : empty.errors.name).toBe('Enter a name.');
    const long = validateScreenDetails({ name: 'x'.repeat(121), description: '' }, stored);
    expect(long.ok ? null : long.errors.name).toMatch(/at most 120/);
    const tab = validateScreenDetails({ name: 'a\tb', description: '' }, stored);
    expect(tab.ok ? null : tab.errors.name).toMatch(/control characters/);
    const desc = validateScreenDetails({ name: 'Foyer', description: 'x'.repeat(501) }, stored);
    expect(desc.ok ? null : desc.errors.description).toMatch(/at most 500/);
    const descTab = validateScreenDetails({ name: 'Foyer', description: 'a\tb' }, stored);
    expect(descTab.ok ? null : descTab.errors.description).toMatch(/no tabs/);
  });

  it('knows when the form differs from what is stored', () => {
    expect(screenDetailsDirty({ name: 'Foyer', description: '' }, stored)).toBe(false);
    expect(screenDetailsDirty({ name: 'Foyer2', description: '' }, stored)).toBe(true);
    expect(descriptionCountLabel(' abc \r\n')).toBe('3 of 500 characters');
  });
});

describe('tags', () => {
  it('compares tag lists in any order', () => {
    expect(sameTagIds(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameTagIds(['a'], ['a', 'b'])).toBe(false);
    expect(sameTagIds(['a', 'c'], ['a', 'b'])).toBe(false);
    expect(tagsSavedText(0)).toBe('Tags removed from this screen');
    expect(tagsSavedText(1)).toBe('1 tag saved for this screen');
    expect(tagsSavedText(3)).toBe('3 tags saved for this screen');
  });
});

describe('pairing', () => {
  it('keeps the M0 help by error code', () => {
    expect(pairingTtlMinutes(600)).toBe(10);
    expect(pairingTtlMinutes(10)).toBe(1);
    expect(pairingHint(1)).toMatch(/lasts 1 minute\.$/);
    expect(pairingHelp('pairing_code_invalid', 10)).toMatch(/codes last 10 minutes/);
    expect(pairingHelp('not_found', 10)).toMatch(/not accepted/);
    expect(pairingHelp('pairing_expired', 10)).toMatch(/expired/);
    expect(pairingHelp('rate_limited', 10)).toMatch(/Too many wrong codes/);
    expect(pairingHelp('pairing_locked', 10)).toMatch(/Too many wrong codes/);
    expect(pairingHelp('internal', 10)).toBeNull();
    expect(pairingHelp(null, 10)).toBeNull();
  });

  it('says what happened', () => {
    expect(pairingAcceptedText(true)).toMatch(/previous player credential was revoked/);
    expect(pairingAcceptedText(false)).not.toMatch(/previous/);
    expect(revokeOutcomeText('30000000-0000-4000-8000-000000000001', 0)).toMatch(
      /^The player credential was revoked\.[^]*reset there\.$/,
    );
    expect(revokeOutcomeText(null, 0)).toMatch(/Nothing was changed/);
    // An accepted code that no player has collected yet is cancelled too (review round 3, SCX-01).
    expect(revokeOutcomeText(null, 1)).toBe(
      'This screen had no active player credential. A pairing code accepted for this screen but not yet collected by a player was cancelled.',
    );
    expect(revokeOutcomeText('30000000-0000-4000-8000-000000000001', 2)).toMatch(
      /revoked\.[^]* 2 pairing codes accepted for this screen but not yet collected by a player were cancelled\.$/,
    );
    // With no player paired the action is still offered, as cancelling a pending pairing.
    expect(endPairingWords(true)).toMatchObject({
      button: 'Revoke player',
      dialogTitle: 'Revoke this player?',
      cancelLabel: 'Cancel',
    });
    expect(endPairingWords(false)).toMatchObject({
      button: 'Cancel pending pairing',
      confirmLabel: 'Cancel pairing',
      cancelLabel: 'Keep it',
      errorTitle: 'The pending pairing was not cancelled',
    });
    // The request cancels every uncollected code of the screen, and the note says so.
    expect(endPairingWords(false).note).toMatch(/cancels every code accepted for this screen/);
    expect(pairingStateText(null)).toBe('No player is paired with this screen.');
    expect(pairingStateText('1 Jan')).toMatch(/since 1 Jan/);
  });
});

describe('assigned content', () => {
  it('summarises the playlist in play order', () => {
    const content = assignedContent(
      playlist([
        item(1, M2, 'video'),
        item(0, M1, 'image', { fit: 'cover' }),
        item(2, M1, 'image'),
        item(3, M3, 'image'),
      ]),
      'contain',
    );
    expect(content.itemCount).toBe(4);
    expect(content.loopMs).toBe(35_000);
    expect(content.summary).toBe('4 items · 0:35');
    expect(content.previewMediaIds).toEqual([M1, M2, M3]);
    expect(content.kinds).toEqual(['image', 'video']);
    expect(content.kindById.get(M2)).toBe('video');
    expect(firstMedia(content)?.media.id).toBe(M1);
    expect(firstMedia(content)?.fit).toBe('cover');
    expect(firstMedia(content)?.fitFromItem).toBe(true);
  });

  it('uses the screen default fit and handles an empty playlist', () => {
    const one = assignedContent(playlist([item(0, M1, 'image')]), 'contain');
    expect(firstMedia(one)?.fit).toBe('contain');
    expect(firstMedia(one)?.fitFromItem).toBe(false);
    const empty = assignedContent(playlist([]), 'cover');
    expect(empty.first).toBeNull();
    expect(empty.summary).toBe('No items');
  });

  it('counts an app item and draws an app first', () => {
    const content = assignedContent(
      playlist([
        { id: ID_APP_ITEM, position: 0, appId: CLOCK.id, durationMs: 20_000, app: CLOCK },
        item(1, M1, 'image'),
      ]),
      'contain',
    );
    expect(content.loopMs).toBe(30_000);
    expect(content.kinds).toEqual(['image', 'app']);
    expect(content.previewMediaIds).toEqual([M1]);
    expect(content.first).toEqual({ app: CLOCK, name: CLOCK.name });
    expect(previewStateOf(true, content)).toBe('ready');
  });

  it('says what the preview shows, and never calls the object a display', () => {
    const ready = assignedContent(playlist([item(0, M1, 'image')]), 'contain');
    expect(previewStateOf(false, 'loading')).toBe('nothing_assigned');
    expect(previewStateOf(true, 'loading')).toBe('loading');
    expect(previewStateOf(true, 'unavailable')).toBe('unavailable');
    expect(previewStateOf(true, ready)).toBe('ready');
    expect(previewStateOf(true, assignedContent(playlist([]), 'contain'))).toBe('empty_playlist');
    const processing = assignedContent(
      playlist([
        item(0, M1, 'image', { media: { ...item(0, M1, 'image').media, status: 'processing' } }),
      ]),
      'contain',
    );
    expect(previewStateOf(true, processing)).toBe('processing');
    const states: PreviewState[] = [
      'nothing_assigned',
      'loading',
      'unavailable',
      'empty_playlist',
      'processing',
      'failed',
      'ready',
    ];
    const texts = [
      ...states.map((s) => previewCaption(s, 'Loop', 'a.png')),
      ...states.map((s) => previewCaption(s, null, null)),
      ...states.map((s) => previewCaption(s, 'Loop', 'a.png', 'Week')),
      ...states.map((s) => previewCaption(s, 'Loop', 'a.png', null, 'Band')),
      PREVIEW_DISCLAIMER,
      APP_PREVIEW_DISCLAIMER,
      STATUS_DISCLAIMER,
      REPORTED_FACTS_NOTE,
      pairingStateText(null),
      revokeOutcomeText(null, 0),
      revokeOutcomeText(null, 2),
      pairingHint(10),
    ];
    for (const text of texts) expect(text).not.toMatch(/\b(display|online|offline)\b/i);
    expect(previewCaption('ready', 'Loop', 'a.png')).toBe('“a.png”, the first item of “Loop”.');
    expect(previewCaption('empty_playlist', null, null)).toMatch(
      /^The assigned playlist has no items/,
    );
  });

  it('says that nothing is assigned without assuming a playlist', () => {
    expect(previewCaption('nothing_assigned', null, null)).toBe(
      'No playlist, schedule or layout is assigned to this screen, so there is nothing to preview.',
    );
  });

  it('says that the preview of a schedule shows its default playlist', () => {
    expect(previewCaption('ready', 'Loop', 'a.png', 'Opening hours')).toBe(
      '“a.png”, the first item of “Loop”. This is the default playlist of the schedule “Opening hours”. Events may show other playlists.',
    );
    expect(previewCaption('empty_playlist', 'Loop', null, 'Opening hours')).toBe(
      '“Loop” has no items yet, so there is nothing to preview. This is the default playlist of the schedule “Opening hours”. Events may show other playlists.',
    );
    // Without a schedule, and with nothing assigned, the sentence is not added.
    expect(previewCaption('ready', 'Loop', 'a.png', null)).toBe(
      '“a.png”, the first item of “Loop”.',
    );
    expect(previewCaption('nothing_assigned', null, null, 'Opening hours')).not.toMatch(
      /default playlist/,
    );
  });

  it('says that the preview of a layout shows its main zone', () => {
    expect(previewCaption('ready', 'Loop', 'a.png', null, 'Foyer band')).toBe(
      '“a.png”, the first item of “Loop”. This is the main zone of the layout “Foyer band”.',
    );
    expect(previewCaption('nothing_assigned', null, null, null, 'Foyer band')).not.toMatch(
      /main zone/,
    );
  });
});

describe('assigned playlist state', () => {
  const PA = playlist([item(1, M1, 'image')]);
  const PB_ID = '20000000-0000-4000-8000-000000000002';
  const readA = { playlistId: PA.id, playlist: PA };
  const boom = new Error('503');

  it('says nothing is assigned without a playlist, and loading while the first read runs', () => {
    expect(assignedPlaylistStateOf(null, { status: 'loading' }, 'contain').status).toBe('none');
    expect(assignedPlaylistStateOf(PA.id, { status: 'loading' }, 'contain').status).toBe('loading');
  });

  it('shows the playlist read for the current assignment', () => {
    const state = assignedPlaylistStateOf(
      PA.id,
      { status: 'ready', data: readA, refreshError: null },
      'contain',
    );
    expect(state.status).toBe('ready');
    if (state.status === 'ready') {
      expect(state.playlist.id).toBe(PA.id);
      expect(state.refreshError).toBeNull();
    }
  });

  it('treats the previous assignment answer as loading while the new one is read', () => {
    expect(
      assignedPlaylistStateOf(
        PB_ID,
        { status: 'ready', data: readA, refreshError: null },
        'contain',
      ),
    ).toEqual({ status: 'loading' });
  });

  it('shows an error, not an endless skeleton, when the new assignment cannot be read', () => {
    expect(
      assignedPlaylistStateOf(
        PB_ID,
        { status: 'ready', data: readA, refreshError: new AssignedReadError(PB_ID, boom) },
        'contain',
      ),
    ).toEqual({ status: 'error', error: boom });
  });

  it('never blames the new assignment for a failure of the previous one', () => {
    const staleFailure = new AssignedReadError(PA.id, boom);
    expect(
      assignedPlaylistStateOf(
        PB_ID,
        { status: 'ready', data: readA, refreshError: staleFailure },
        'contain',
      ),
    ).toEqual({ status: 'loading' });
    expect(
      assignedPlaylistStateOf(PB_ID, { status: 'error', error: staleFailure }, 'contain'),
    ).toEqual({ status: 'loading' });
  });

  it('keeps the last good playlist and flags a failed refresh of the same assignment', () => {
    const state = assignedPlaylistStateOf(
      PA.id,
      { status: 'ready', data: readA, refreshError: new AssignedReadError(PA.id, boom) },
      'contain',
    );
    expect(state.status === 'ready' && state.refreshError).toBe(boom);
  });

  it('unwraps the failure of a first read so the page can explain it', () => {
    expect(
      assignedPlaylistStateOf(
        PB_ID,
        { status: 'error', error: new AssignedReadError(PB_ID, boom) },
        'contain',
      ),
    ).toEqual({ status: 'error', error: boom });
  });
});

describe('push row', () => {
  it('finds the row of a screen in any letter case', () => {
    const plan: PushPlanResponse = {
      items: [
        {
          display: { id: 'abcdef00-0000-4000-8000-000000000001', name: 'A' },
          playlist: null,
          schedule: null,
          layout: null,
          state: 'nothing_assigned',
          issues: [],
          lastPushedAt: null,
        },
      ],
      pendingCount: 0,
    };
    expect(pushRowFor(plan, 'ABCDEF00-0000-4000-8000-000000000001')?.display.name).toBe('A');
    expect(pushRowFor(plan, 'abcdef00-0000-4000-8000-000000000002')).toBeNull();
    expect(pushRowFor(null, 'x')).toBeNull();
  });
});
