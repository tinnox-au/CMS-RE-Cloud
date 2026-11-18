import {
  DEFAULT_LIMITS,
  PlaylistReplaceSchema,
  type MediaDto,
  type PlaylistDto,
  type PushPlanResponse,
  type PushPlanRow,
  type PushState,
} from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { app } from './mediaLibrary.test-support.ts';
import { itemRefId, removeItem, updateItem } from './playlistDraft.ts';
import {
  addedAnnouncement,
  addEntry,
  appMetaLabel,
  ALL_FOLDERS,
  assignConfirmLabel,
  assignedMessage,
  capacityMessage,
  carryItemKeys,
  descriptionProblem,
  draftAfterSave,
  dropSlotAt,
  durationRuleText,
  durationStepperBounds,
  edgeScrollSpeed,
  editorDraftFromPlaylist,
  editorIsDirty,
  filterApps,
  filterLibrary,
  FIT_CHOICES,
  fitLabel,
  hasProblems,
  indexAfterSlotMove,
  initialDurationText,
  invalidDurationSummary,
  itemNotReadyMessage,
  keptAnnouncement,
  libraryCountLabel,
  libraryFiltersActive,
  libraryMetaLabel,
  listProblems,
  loopLengthLabel,
  movedAnnouncement,
  moveItemToSlot,
  nameProblem,
  NO_EDITOR_ERRORS,
  NO_LIBRARY_FILTERS,
  notReadyNote,
  pushHoldReason,
  pushSummary,
  readyMedia,
  remainingCapacity,
  removedAnnouncement,
  ROOT_FOLDER,
  rowsForPlaylist,
  sequenceCountLabel,
  slotKeepsPlace,
  usageInDraft,
  usageLabel,
  validateEditorDraft,
  videoLengthLabel,
  waitingCount,
  withCurrentMedia,
  type EditorDraft,
  type LibraryFilters,
} from './playlistEditor.ts';

const ID = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const T = '2026-11-14T03:00:00.000Z';

function media(n: number, kind: 'image' | 'video', change: Partial<MediaDto> = {}): MediaDto {
  return {
    id: ID(n),
    kind,
    status: 'ready',
    name: `file-${n}.${kind === 'image' ? 'png' : 'mp4'}`,
    originalName: `file-${n}.${kind === 'image' ? 'png' : 'mp4'}`,
    description: null,
    defaultDurationMs: null,
    availableFrom: null,
    availableUntil: null,
    folderId: null,
    tagIds: [],
    usageCount: 0,
    mimeType: kind === 'image' ? 'image/png' : 'video/mp4',
    bytes: 1000,
    sha256: 'a'.repeat(64),
    width: 1920,
    height: 1080,
    durationMs: kind === 'video' ? 12_500 : null,
    codec: kind === 'video' ? 'h264' : null,
    errorCode: null,
    errorDetail: null,
    createdAt: T,
    updatedAt: T,
    ...change,
  };
}

function playlist(change: Partial<PlaylistDto> = {}): PlaylistDto {
  return {
    id: ID(9),
    name: 'Lobby loop',
    description: 'Plays in the foyer.',
    transition: 'cut',
    shuffle: false,
    createdAt: T,
    updatedAt: T,
    items: [
      {
        id: ID(5),
        position: 0,
        mediaId: ID(1),
        durationMs: 8_000,
        fit: null,
        media: media(1, 'image'),
      },
      {
        id: ID(6),
        position: 1,
        mediaId: ID(2),
        durationMs: null,
        fit: 'cover',
        media: media(2, 'video'),
      },
      {
        id: ID(7),
        position: 2,
        mediaId: ID(3),
        durationMs: 5_000,
        fit: 'contain',
        media: media(3, 'image'),
      },
    ],
    ...change,
  };
}

function draft(change: Partial<PlaylistDto> = {}): EditorDraft {
  return editorDraftFromPlaylist(playlist(change));
}

const keys = (value: EditorDraft) => value.items.map((item) => item.key);

const addMedia = (
  value: EditorDraft,
  item: MediaDto,
  key: string,
  limits: Parameters<typeof addEntry>[3],
  slot?: number,
) => addEntry(value, { kind: 'media', media: item }, key, limits, slot);

/* ---------- draft, dirty check, keys ---------- */

describe('playlist editor draft', () => {
  it('carries the description and is clean at first', () => {
    const saved = playlist();
    const value = editorDraftFromPlaylist(saved);
    expect(value.description).toBe('Plays in the foyer.');
    expect(value.name).toBe('Lobby loop');
    expect(keys(value)).toEqual([ID(5), ID(6), ID(7)]);
    expect(editorIsDirty(value, saved)).toBe(false);
  });

  it('reads a missing description as an empty field', () => {
    const saved = playlist({ description: null });
    const value = editorDraftFromPlaylist(saved);
    expect(value.description).toBe('');
    expect(editorIsDirty(value, saved)).toBe(false);
    expect(editorIsDirty({ ...value, description: '   ' }, saved)).toBe(false);
  });

  it('becomes dirty when the description changes, and not for white space around it', () => {
    const saved = playlist();
    const value = editorDraftFromPlaylist(saved);
    expect(editorIsDirty({ ...value, description: 'Plays in the foyer' }, saved)).toBe(true);
    expect(editorIsDirty({ ...value, description: '' }, saved)).toBe(true);
    expect(editorIsDirty({ ...value, description: '  Plays in the foyer.\n' }, saved)).toBe(false);
  });

  it('carries the playback options and becomes dirty when either changes', () => {
    const saved = playlist({ transition: 'fade', shuffle: true });
    const value = editorDraftFromPlaylist(saved);
    expect([value.transition, value.shuffle]).toEqual(['fade', true]);
    expect(editorIsDirty(value, saved)).toBe(false);
    expect(editorIsDirty({ ...value, transition: 'cut' }, saved)).toBe(true);
    expect(editorIsDirty({ ...value, shuffle: false }, saved)).toBe(true);
    const sent = validateEditorDraft(value, DEFAULT_LIMITS);
    expect(sent.ok && [sent.value.transition, sent.value.shuffle]).toEqual(['fade', true]);
  });

  it('keeps the playback options when items are added, moved or removed', () => {
    const value = { ...draft(), transition: 'fade', shuffle: true } as const;
    const added = addMedia(value, media(4, 'image'), 'k', DEFAULT_LIMITS);
    const results = [
      moveItemToSlot(value, 0, 3),
      { ...value, ...removeItem(value, ID(6)) },
      added.ok ? added.draft : value,
    ];
    for (const result of results) {
      expect([result.transition, result.shuffle]).toEqual(['fade', true]);
    }
    expect(added.ok).toBe(true);
  });

  it('compares line ends as the API stores them', () => {
    const saved = playlist({ description: 'One\nTwo' });
    const value = editorDraftFromPlaylist(saved);
    expect(editorIsDirty({ ...value, description: 'One\r\nTwo' }, saved)).toBe(false);
  });

  it('still reports the M0 changes: name, order, durations and fit', () => {
    const saved = playlist();
    const value = editorDraftFromPlaylist(saved);
    expect(editorIsDirty({ ...value, name: 'Other' }, saved)).toBe(true);
    expect(editorIsDirty(moveItemToSlot(value, 0, 3), saved)).toBe(true);
    const longer = updateItem(value, ID(5), { durationText: '9' });
    expect(editorIsDirty({ ...value, ...longer }, saved)).toBe(true);
  });

  it('keeps the rendering keys across a save where the same media stays in place', () => {
    const before: EditorDraft = {
      name: 'Lobby loop',
      description: '',
      transition: 'cut',
      shuffle: false,
      items: [
        { source: 'media', key: 'local-a', media: media(1, 'image'), durationText: '8', fit: null },
        {
          source: 'media',
          key: 'local-b',
          media: media(2, 'video'),
          durationText: '',
          fit: 'cover',
        },
        {
          source: 'media',
          key: 'local-c',
          media: media(3, 'image'),
          durationText: '5.0',
          fit: 'contain',
        },
      ],
    };
    const after = carryItemKeys(draft(), before);
    expect(keys(after)).toEqual(['local-a', 'local-b', 'local-c']);
    // Everything but the key is what the server answered.
    expect(after.items[2]?.durationText).toBe('5');
    expect(after.description).toBe('Plays in the foyer.');
  });

  it('takes the server key where the media at a position differs or the lists differ in length', () => {
    const before: EditorDraft = {
      name: 'x',
      description: '',
      transition: 'cut',
      shuffle: false,
      items: [
        { source: 'media', key: 'local-a', media: media(4, 'image'), durationText: '8', fit: null },
        { source: 'media', key: 'local-b', media: media(2, 'video'), durationText: '', fit: null },
      ],
    };
    expect(keys(carryItemKeys(draft(), before))).toEqual([ID(5), 'local-b', ID(7)]);
  });

  it('never hands one key to two items', () => {
    const twice: EditorDraft = {
      name: 'x',
      description: '',
      transition: 'cut',
      shuffle: false,
      items: [
        { source: 'media', key: 'same', media: media(1, 'image'), durationText: '8', fit: null },
        { source: 'media', key: 'same', media: media(2, 'video'), durationText: '', fit: null },
      ],
    };
    const after = carryItemKeys(draft(), twice);
    expect(new Set(keys(after)).size).toBe(3);
  });
});

describe('the draft after a save is answered', () => {
  it('becomes the server answer, keeping the keys, when nothing was edited meanwhile', () => {
    const sent: EditorDraft = { ...draft(), name: 'Lobby loop 2' };
    const answer = playlist({ name: 'Lobby loop 2', updatedAt: '2026-11-14T04:00:00.000Z' });
    const after = draftAfterSave(sent, sent, answer);
    expect(after.settled).toBe(true);
    expect(after.draft.name).toBe('Lobby loop 2');
    expect(keys(after.draft)).toEqual(keys(sent));
    expect(editorIsDirty(after.draft, answer)).toBe(false);
  });

  it('keeps what was typed while the save was in flight, and stays unsaved', () => {
    const sent: EditorDraft = { ...draft(), name: 'ZZ Lost 1' };
    // Every edit makes a new draft object, as the editor's change() does.
    const typedMeanwhile: EditorDraft = { ...sent, name: 'ZZ Lost 2 typed during save' };
    const answer = playlist({ name: 'ZZ Lost 1' });
    const after = draftAfterSave(typedMeanwhile, sent, answer);
    expect(after.settled).toBe(false);
    expect(after.draft).toBe(typedMeanwhile);
    expect(editorIsDirty(after.draft, answer)).toBe(true);
  });

  it('keeps a sequence edit made meanwhile even when it equals what was sent in value', () => {
    const sent = draft();
    const removedThenRestored: EditorDraft = { ...sent, items: [...sent.items] };
    const after = draftAfterSave(removedThenRestored, sent, playlist());
    expect(after.settled).toBe(false);
    expect(after.draft).toBe(removedThenRestored);
    // Nothing differs from the stored playlist, so the page reads "Saved" again.
    expect(editorIsDirty(after.draft, playlist())).toBe(false);
  });
});

/* ---------- validation ---------- */

describe('playlist editor validation', () => {
  it('builds the replacement body with the description', () => {
    const result = validateEditorDraft(draft(), DEFAULT_LIMITS);
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Lobby loop',
        description: 'Plays in the foyer.',
        items: [
          { mediaId: ID(1), durationMs: 8_000, fit: null },
          { mediaId: ID(2), durationMs: null, fit: 'cover' },
          { mediaId: ID(3), durationMs: 5_000, fit: 'contain' },
        ],
        transition: 'cut',
        shuffle: false,
      },
    });
    if (result.ok) expect(PlaylistReplaceSchema.safeParse(result.value).success).toBe(true);
  });

  it('sends null for an empty description, so clearing the field clears it', () => {
    const result = validateEditorDraft({ ...draft(), description: '  \n ' }, DEFAULT_LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toBeNull();
  });

  it('trims the description and keeps its line breaks', () => {
    const result = validateEditorDraft(
      { ...draft(), description: '  Morning\r\nEvening  ' },
      DEFAULT_LIMITS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toBe('Morning\nEvening');
  });

  it('refuses a description over 500 characters or with control characters', () => {
    expect(descriptionProblem('a'.repeat(500))).toBeNull();
    expect(descriptionProblem('a'.repeat(501))).toBe('Use at most 500 characters (now 501).');
    expect(descriptionProblem('tab\there')).toBe('Remove the tabs or other control characters.');
    expect(descriptionProblem('line\nbreak')).toBeNull();
    expect(descriptionProblem('')).toBeNull();
    const result = validateEditorDraft(
      { ...draft(), description: 'a'.repeat(501) },
      DEFAULT_LIMITS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.description).toContain('at most 500');
      expect(result.errors.name).toBeNull();
    }
  });

  it('requires a name, as M0 does, and bounds it', () => {
    expect(nameProblem('  ')).toBe('Enter a name.');
    expect(nameProblem('a'.repeat(120))).toBeNull();
    expect(nameProblem('a'.repeat(121))).toBe('Use at most 120 characters (now 121).');
    expect(nameProblem('two\nlines')).toBe('Remove the line breaks or tabs from the name.');
    const result = validateEditorDraft({ ...draft(), name: ' ' }, DEFAULT_LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBe('Enter a name.');
  });

  it('reports every kind of error at once', () => {
    const base = draft();
    const broken: EditorDraft = {
      ...base,
      ...updateItem(base, ID(5), { durationText: '0' }),
      name: '',
      description: 'a'.repeat(600),
    };
    const result = validateEditorDraft(broken, DEFAULT_LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toBe('Enter a name.');
      expect(result.errors.description).toContain('at most 500');
      expect(result.errors.items[ID(5)]).toBe('Must be at least 1 s.');
      expect(hasProblems(result.errors)).toBe(true);
    }
  });

  it('enforces the item limit with the M0 message', () => {
    const result = validateEditorDraft(draft(), { ...DEFAULT_LIMITS, maxPlaylistItems: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.form).toBe('A playlist can hold at most 2 items.');
  });

  it('allows an empty playlist to be saved', () => {
    expect(validateEditorDraft({ ...draft(), items: [] }, DEFAULT_LIMITS).ok).toBe(true);
  });

  it('knows when there is nothing to report', () => {
    expect(hasProblems(NO_EDITOR_ERRORS)).toBe(false);
    expect(hasProblems({ ...NO_EDITOR_ERRORS, description: 'x' })).toBe(true);
    expect(hasProblems({ ...NO_EDITOR_ERRORS, form: 'x' })).toBe(true);
  });

  it('summarises invalid durations in the words of M0', () => {
    expect(invalidDurationSummary(0)).toBeNull();
    expect(invalidDurationSummary(1)).toBe('One item has an invalid duration.');
    expect(invalidDurationSummary(3)).toBe('3 items have an invalid duration.');
  });

  it('lists the problems in page order, each with where it leads', () => {
    const value = draft();
    const problems = listProblems(value, {
      name: 'Enter a name.',
      description: 'Too long.',
      form: 'A playlist can hold at most 2 items.',
      items: { [ID(7)]: 'Must be at least 1 s.', [ID(5)]: 'Enter a duration in seconds.' },
    });
    expect(problems.map((problem) => problem.label)).toEqual([
      'Playlist name',
      'Description',
      'Sequence',
      'Item 1, file-1.png',
      'Item 3, file-3.png',
    ]);
    expect(problems.map((problem) => problem.target)).toEqual([
      { kind: 'name' },
      { kind: 'description' },
      null,
      { kind: 'item', key: ID(5) },
      { kind: 'item', key: ID(7) },
    ]);
    expect(new Set(problems.map((problem) => problem.id)).size).toBe(5);
    expect(listProblems(value, NO_EDITOR_ERRORS)).toEqual([]);
  });

  it('ignores an error left over for an item that is no longer in the draft', () => {
    expect(listProblems(draft(), { ...NO_EDITOR_ERRORS, items: { gone: 'x' } })).toEqual([]);
  });
});

/* ---------- adding ---------- */

describe('adding media to the sequence', () => {
  it('starts an image at its own default duration, else at 10 seconds; a video has none', () => {
    expect(initialDurationText(media(1, 'image'))).toBe('10');
    expect(initialDurationText(media(1, 'image', { defaultDurationMs: 15_000 }))).toBe('15');
    expect(initialDurationText(media(1, 'image', { defaultDurationMs: 7_500 }))).toBe('7.5');
    expect(initialDurationText(media(2, 'video'))).toBe('');
  });

  it('appends at the end with the default duration and no fit of its own', () => {
    const result = addMedia(
      draft(),
      media(4, 'image', { defaultDurationMs: 20_000 }),
      'k',
      DEFAULT_LIMITS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.index).toBe(3);
    expect(keys(result.draft)).toEqual([ID(5), ID(6), ID(7), 'k']);
    expect(result.draft.items[3]).toMatchObject({ durationText: '20', fit: null });
    expect(result.draft.description).toBe('Plays in the foyer.');
    const saved = validateEditorDraft(result.draft, DEFAULT_LIMITS);
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value.items[3]).toEqual({ mediaId: ID(4), durationMs: 20_000, fit: null });
    }
  });

  it('inserts at a drop position and clamps a position outside the strip', () => {
    const first = addMedia(draft(), media(4, 'video'), 'k', DEFAULT_LIMITS, 0);
    expect(first.ok && keys(first.draft)).toEqual(['k', ID(5), ID(6), ID(7)]);
    expect(first.ok && first.index).toBe(0);
    const middle = addMedia(draft(), media(4, 'video'), 'k', DEFAULT_LIMITS, 2);
    expect(middle.ok && keys(middle.draft)).toEqual([ID(5), ID(6), 'k', ID(7)]);
    const beyond = addMedia(draft(), media(4, 'video'), 'k', DEFAULT_LIMITS, 99);
    expect(beyond.ok && keys(beyond.draft)).toEqual([ID(5), ID(6), ID(7), 'k']);
    const before = addMedia(draft(), media(4, 'video'), 'k', DEFAULT_LIMITS, -3);
    expect(before.ok && before.index).toBe(0);
  });

  it('allows the same media twice', () => {
    const result = addMedia(draft(), media(1, 'image'), 'again', DEFAULT_LIMITS);
    expect(result.ok && result.draft.items.map(itemRefId)).toEqual([ID(1), ID(2), ID(3), ID(1)]);
  });

  it('refuses media that is not ready', () => {
    const value = draft();
    expect(
      addMedia(value, media(4, 'image', { status: 'processing' }), 'k', DEFAULT_LIMITS),
    ).toEqual({ ok: false, reason: 'not_ready' });
    expect(addMedia(value, media(4, 'image', { status: 'failed' }), 'k', DEFAULT_LIMITS)).toEqual({
      ok: false,
      reason: 'not_ready',
    });
  });

  it('refuses to go past the item limit and says how many fit', () => {
    const limits = { ...DEFAULT_LIMITS, maxPlaylistItems: 3 };
    expect(remainingCapacity(draft(), limits)).toBe(0);
    expect(remainingCapacity(draft(), DEFAULT_LIMITS)).toBe(197);
    expect(remainingCapacity(draft(), { ...DEFAULT_LIMITS, maxPlaylistItems: 1 })).toBe(0);
    expect(addMedia(draft(), media(4, 'image'), 'k', limits)).toEqual({
      ok: false,
      reason: 'full',
    });
    expect(capacityMessage(limits)).toBe(
      'A playlist can hold at most 3 items. Remove an item before adding another.',
    );
    expect(capacityMessage({ ...limits, maxPlaylistItems: 1 })).toContain('at most 1 item.');
  });
});

/* ---------- moving ---------- */

describe('moving an item to a drop position', () => {
  it('moves forwards and backwards, counting slots as gaps between tiles', () => {
    const value = draft();
    expect(keys(moveItemToSlot(value, 0, 3))).toEqual([ID(6), ID(7), ID(5)]);
    expect(keys(moveItemToSlot(value, 0, 2))).toEqual([ID(6), ID(5), ID(7)]);
    expect(keys(moveItemToSlot(value, 2, 0))).toEqual([ID(7), ID(5), ID(6)]);
    expect(keys(moveItemToSlot(value, 2, 1))).toEqual([ID(5), ID(7), ID(6)]);
    expect(moveItemToSlot(value, 0, 3).description).toBe('Plays in the foyer.');
  });

  it('returns the same draft for the gaps on either side of the item and for impossible moves', () => {
    const value = draft();
    expect(moveItemToSlot(value, 1, 1)).toBe(value);
    expect(moveItemToSlot(value, 1, 2)).toBe(value);
    expect(moveItemToSlot(value, 1, 4)).toBe(value);
    expect(moveItemToSlot(value, 1, -1)).toBe(value);
    expect(moveItemToSlot(value, 7, 0)).toBe(value);
    expect(moveItemToSlot(value, 1, 1.5)).toBe(value);
  });

  it('tells where a drop lands and which slots keep the place', () => {
    expect(indexAfterSlotMove(0, 3)).toBe(2);
    expect(indexAfterSlotMove(2, 0)).toBe(0);
    expect(indexAfterSlotMove(1, 1)).toBe(1);
    expect(indexAfterSlotMove(1, 2)).toBe(1);
    expect(slotKeepsPlace(1, 1)).toBe(true);
    expect(slotKeepsPlace(1, 2)).toBe(true);
    expect(slotKeepsPlace(1, 0)).toBe(false);
    expect(slotKeepsPlace(1, 3)).toBe(false);
  });
});

/* ---------- drag geometry ---------- */

describe('drag geometry', () => {
  const tiles = [
    { start: 0, end: 200 },
    { start: 212, end: 412 },
    { start: 424, end: 624 },
  ];

  it('finds the slot from the middle of each tile', () => {
    expect(dropSlotAt(tiles, -50)).toBe(0);
    expect(dropSlotAt(tiles, 99)).toBe(0);
    expect(dropSlotAt(tiles, 101)).toBe(1);
    expect(dropSlotAt(tiles, 311)).toBe(1);
    expect(dropSlotAt(tiles, 313)).toBe(2);
    expect(dropSlotAt(tiles, 600)).toBe(3);
    expect(dropSlotAt(tiles, 5000)).toBe(3);
    expect(dropSlotAt([], 40)).toBe(0);
  });

  it('does not scroll while the pointer is in the middle of the strip', () => {
    expect(edgeScrollSpeed(500, 100, 900)).toBe(0);
    expect(edgeScrollSpeed(172, 100, 900)).toBe(0);
    expect(edgeScrollSpeed(828, 100, 900)).toBe(0);
  });

  it('scrolls faster the closer the pointer is to an edge, and at full speed beyond it', () => {
    const near = edgeScrollSpeed(160, 100, 900);
    const nearer = edgeScrollSpeed(110, 100, 900);
    expect(near).toBeLessThan(0);
    expect(nearer).toBeLessThan(near);
    expect(edgeScrollSpeed(100, 100, 900)).toBe(-18);
    expect(edgeScrollSpeed(40, 100, 900)).toBe(-18);
    expect(edgeScrollSpeed(840, 100, 900)).toBeGreaterThan(0);
    expect(edgeScrollSpeed(900, 100, 900)).toBe(18);
    expect(edgeScrollSpeed(990, 100, 900)).toBe(18);
  });

  it('keeps a quiet middle in a narrow strip and survives odd input', () => {
    // 150 px wide: each edge zone is a third, so the middle third never scrolls.
    expect(edgeScrollSpeed(75, 0, 150)).toBe(0);
    expect(edgeScrollSpeed(10, 0, 150)).toBeLessThan(0);
    expect(edgeScrollSpeed(140, 0, 150)).toBeGreaterThan(0);
    expect(edgeScrollSpeed(10, 0, 0)).toBe(0);
    expect(edgeScrollSpeed(Number.NaN, 0, 500)).toBe(0);
  });
});

/* ---------- words of the sequence ---------- */

describe('sequence wording', () => {
  it('offers the three fit choices with the screen default first', () => {
    expect(FIT_CHOICES.map((choice) => choice.label)).toEqual([
      'Screen default',
      'Contain',
      'Cover',
    ]);
    expect(FIT_CHOICES.map((choice) => choice.value)).toEqual([null, 'contain', 'cover']);
    expect(fitLabel(null)).toBe('Screen default');
    expect(fitLabel('contain')).toBe('Contain');
    expect(fitLabel('cover')).toBe('Cover');
  });

  it('counts the items and adds up the loop as minutes and seconds', () => {
    const value = draft();
    expect(sequenceCountLabel(value)).toBe('3 items');
    expect(sequenceCountLabel({ ...value, items: value.items.slice(0, 1) })).toBe('1 item');
    // 8 s + 12.5 s + 5 s
    expect(loopLengthLabel(value, DEFAULT_LIMITS)).toBe('Loop length 0:26');
    expect(loopLengthLabel({ ...value, items: [] }, DEFAULT_LIMITS)).toBe('Loop length 0:00');
    const long = updateItem(value, ID(5), { durationText: '3600' });
    expect(loopLengthLabel(long, DEFAULT_LIMITS)).toBe('Loop length 1:00:18');
  });

  it('says the loop length is not known rather than guessing', () => {
    const value = updateItem(draft(), ID(5), { durationText: 'abc' });
    expect(loopLengthLabel(value, DEFAULT_LIMITS)).toBe('Loop length not known');
  });

  it('shows the fixed length of a video', () => {
    expect(videoLengthLabel(media(2, 'video'))).toBe('0:13');
    expect(videoLengthLabel(media(2, 'video', { durationMs: 65_000 }))).toBe('1:05');
    expect(videoLengthLabel(media(2, 'video', { durationMs: null }))).toBe('Not known');
  });

  it('states the duration rule from the configured limits', () => {
    expect(durationRuleText(DEFAULT_LIMITS)).toBe(
      'Images stay on screen for 1 to 3600 seconds each, and so do apps. Videos play muted for their own length.',
    );
    expect(durationStepperBounds(DEFAULT_LIMITS)).toEqual({ min: 1, max: 3600 });
    expect(
      durationStepperBounds({ minImageItemDurationMs: 2_500, maxImageItemDurationMs: 60_500 }),
    ).toEqual({ min: 3, max: 60 });
    expect(
      durationStepperBounds({ minImageItemDurationMs: 500, maxImageItemDurationMs: 800 }),
    ).toEqual({ min: 1, max: 1 });
  });

  it('flags an item whose file is not ready', () => {
    expect(itemNotReadyMessage(media(1, 'image'))).toBeNull();
    expect(itemNotReadyMessage(media(1, 'image', { status: 'failed' }))).toBe(
      'This file is not ready, so the playlist cannot be pushed with it.',
    );
    expect(itemNotReadyMessage(media(1, 'image', { status: 'processing' }))).not.toBeNull();
  });

  it('shows an item with the media record the library holds now', () => {
    const [item] = draft().items;
    if (item?.source !== 'media') throw new Error('no item');
    const renamed = media(1, 'image', { name: 'Renamed' });
    expect(withCurrentMedia(item, new Map([[ID(1), renamed]]))).toMatchObject({
      media: { name: 'Renamed' },
    });
    expect(withCurrentMedia(item, new Map([[ID(1), renamed]])).key).toBe(item.key);
    expect(withCurrentMedia(item, new Map())).toBe(item);
    expect(withCurrentMedia(item, new Map([[ID(1), item.media]]))).toBe(item);
  });

  it('adds an app with 10 seconds and counts it as in the playlist', () => {
    const result = addEntry(draft(), { kind: 'app', app: app(8) }, 'k', DEFAULT_LIMITS, 1);
    expect(result.ok && result.draft.items[1]).toEqual({
      source: 'app',
      key: 'k',
      app: app(8),
      durationText: '10',
    });
    expect(result.ok && usageInDraft(result.draft).get(app(8).id)).toBe(1);
    const full = addEntry(draft(), { kind: 'app', app: app(8) }, 'k', {
      ...DEFAULT_LIMITS,
      maxPlaylistItems: 3,
    });
    expect(full).toEqual({ ok: false, reason: 'full' });
  });

  it('lists apps after media only without a folder or tag filter, and alone under Apps', () => {
    const apps = [app(1, { name: 'Lobby clock' }), app(2, { name: 'Sale countdown' })];
    expect(filterApps(apps, NO_LIBRARY_FILTERS)).toEqual(apps);
    expect(filterApps(apps, { ...NO_LIBRARY_FILTERS, query: 'sale' })).toEqual([apps[1]]);
    expect(filterApps(apps, { ...NO_LIBRARY_FILTERS, kind: 'image' })).toEqual([]);
    const inFolder: LibraryFilters = { ...NO_LIBRARY_FILTERS, folder: ROOT_FOLDER };
    expect(filterApps(apps, inFolder)).toEqual([]);
    expect(filterApps(apps, { ...inFolder, kind: 'app' })).toEqual(apps);
    expect(filterLibrary([media(1, 'image')], { ...NO_LIBRARY_FILTERS, kind: 'app' })).toEqual([]);
    expect(appMetaLabel(apps[0] ?? app(1))).toBe('Clock');
    expect(libraryCountLabel(2, 5, true, 'item')).toBe('2 of 5 items');
  });

  it('keeps the rendering key of an app that stays in place, never across a media item', () => {
    const saved = playlist({
      items: [{ id: ID(5), position: 0, appId: app(1).id, durationMs: 10_000, app: app(1) }],
    });
    const local: EditorDraft = {
      ...editorDraftFromPlaylist(saved),
      items: [{ source: 'app', key: 'mine', app: app(1), durationText: '10' }],
    };
    expect(keys(carryItemKeys(editorDraftFromPlaylist(saved), local))).toEqual(['mine']);
    const media1: EditorDraft = {
      ...local,
      items: [
        { source: 'media', key: 'mine', media: media(1, 'image'), durationText: '10', fit: null },
      ],
    };
    expect(keys(carryItemKeys(editorDraftFromPlaylist(saved), media1))).toEqual([ID(5)]);
  });

  it('announces what happened to which item and where it is now', () => {
    expect(addedAnnouncement('sunrise.jpg', 4)).toBe('Added sunrise.jpg at position 4.');
    expect(movedAnnouncement('sunrise.jpg', 2, 5)).toBe('Moved sunrise.jpg to position 2 of 5.');
    expect(removedAnnouncement('sunrise.jpg', 3)).toBe('Removed sunrise.jpg from position 3.');
    expect(keptAnnouncement('sunrise.jpg', 3)).toBe('sunrise.jpg stays at position 3.');
  });
});

/* ---------- library ---------- */

describe('library filters', () => {
  const items = [
    media(1, 'image', { name: 'Sunrise', folderId: ID(7), tagIds: [ID(8)] }),
    media(2, 'video', { name: 'Promo reel', description: 'Summer sale', tagIds: [ID(8), ID(9)] }),
    media(3, 'image', { name: 'Menu board', originalName: 'IMG_0042.png' }),
    media(4, 'image', { name: 'Still processing', status: 'processing' }),
    media(5, 'video', { name: 'Broken', status: 'failed' }),
  ];
  const filter = (change: Partial<LibraryFilters>) =>
    filterLibrary(items, { ...NO_LIBRARY_FILTERS, ...change }).map((item) => item.name);

  it('lists only ready media, in the order given', () => {
    expect(readyMedia(items).map((item) => item.name)).toEqual([
      'Sunrise',
      'Promo reel',
      'Menu board',
    ]);
    expect(filter({})).toEqual(['Sunrise', 'Promo reel', 'Menu board']);
  });

  it('searches the name, the file name and the description, every word, without case', () => {
    expect(filter({ query: 'sun' })).toEqual(['Sunrise']);
    expect(filter({ query: 'img_0042' })).toEqual(['Menu board']);
    expect(filter({ query: 'SUMMER' })).toEqual(['Promo reel']);
    expect(filter({ query: 'promo sale' })).toEqual(['Promo reel']);
    expect(filter({ query: 'nothing like it' })).toEqual([]);
    expect(filter({ query: 'processing' })).toEqual([]);
  });

  it('filters by kind, folder and tag, and combines them', () => {
    expect(filter({ kind: 'image' })).toEqual(['Sunrise', 'Menu board']);
    expect(filter({ kind: 'video' })).toEqual(['Promo reel']);
    expect(filter({ folder: ID(7) })).toEqual(['Sunrise']);
    expect(filter({ folder: ROOT_FOLDER })).toEqual(['Promo reel', 'Menu board']);
    expect(filter({ folder: ALL_FOLDERS })).toHaveLength(3);
    expect(filter({ tags: new Set([ID(9)]) })).toEqual(['Promo reel']);
    expect(filter({ tags: new Set([ID(8), ID(9)]) })).toEqual(['Sunrise', 'Promo reel']);
    expect(filter({ tags: new Set([ID(8)]), kind: 'image', folder: ID(7) })).toEqual(['Sunrise']);
    expect(filter({ tags: new Set([ID(8)]), kind: 'image', folder: ROOT_FOLDER })).toEqual([]);
  });

  it('knows whether anything is filtered, to offer "Clear filters"', () => {
    expect(libraryFiltersActive(NO_LIBRARY_FILTERS)).toBe(false);
    expect(libraryFiltersActive({ ...NO_LIBRARY_FILTERS, query: '  ' })).toBe(false);
    expect(libraryFiltersActive({ ...NO_LIBRARY_FILTERS, query: 'a' })).toBe(true);
    expect(libraryFiltersActive({ ...NO_LIBRARY_FILTERS, kind: 'video' })).toBe(true);
    expect(libraryFiltersActive({ ...NO_LIBRARY_FILTERS, folder: ROOT_FOLDER })).toBe(true);
    expect(libraryFiltersActive({ ...NO_LIBRARY_FILTERS, tags: new Set(['x']) })).toBe(true);
  });

  it('words the count, the card line, the usage and the files that cannot be added', () => {
    expect(libraryCountLabel(12, 12, false)).toBe('12 files');
    expect(libraryCountLabel(1, 1, false)).toBe('1 file');
    expect(libraryCountLabel(4, 12, true)).toBe('4 of 12 files');
    expect(libraryCountLabel(12, 12, true)).toBe('12 files');
    expect(libraryCountLabel(0, 1, true)).toBe('0 of 1 file');
    expect(libraryMetaLabel(media(1, 'image'))).toBe('Image · 1920 × 1080 px');
    expect(libraryMetaLabel(media(2, 'video'))).toBe('Video · 1920 × 1080 px · 0:13');
    expect(libraryMetaLabel(media(1, 'image', { width: null, height: null }))).toBe('Image');
    expect(usageLabel(0)).toBeNull();
    expect(usageLabel(1)).toBe('In this playlist');
    expect(usageLabel(3)).toBe('In this playlist 3 times');
    expect(notReadyNote(0)).toBeNull();
    expect(notReadyNote(1)).toBe('1 file is still processing or failed and cannot be added.');
    expect(notReadyNote(4)).toBe('4 files are still processing or failed and cannot be added.');
  });

  it('counts how often each file sits in the draft', () => {
    const added = addMedia(draft(), media(1, 'image'), 'again', DEFAULT_LIMITS);
    if (!added.ok) throw new Error('not added');
    const usage = usageInDraft(added.draft);
    expect(usage.get(ID(1))).toBe(2);
    expect(usage.get(ID(2))).toBe(1);
    expect(usage.get(ID(4))).toBeUndefined();
  });
});

/* ---------- push card ---------- */

function row(n: number, state: PushState, playlistId: string | null = ID(9)): PushPlanRow {
  return {
    display: { id: ID(n), name: `Screen ${n}` },
    playlist:
      state === 'nothing_assigned' || playlistId === null
        ? null
        : { id: playlistId, name: 'Lobby loop' },
    schedule: null,
    layout: null,
    state,
    issues:
      state === 'blocked'
        ? [{ path: 'playlist', message: 'The playlist has no items.', code: 'playlist_empty' }]
        : [],
    lastPushedAt: state === 'changes' || state === 'up_to_date' ? T : null,
  };
}

function plan(items: readonly PushPlanRow[]): PushPlanResponse {
  return {
    items: [...items],
    pendingCount: items.filter((item) => item.state === 'changes' || item.state === 'never_pushed')
      .length,
  };
}

describe('push card', () => {
  it('lists the screens that have this playlist assigned, in plan order', () => {
    const thePlan = plan([
      row(1, 'changes'),
      row(2, 'up_to_date', ID(8)),
      row(3, 'nothing_assigned'),
      row(4, 'never_pushed'),
    ]);
    expect(rowsForPlaylist(thePlan, ID(9)).map((item) => item.display.name)).toEqual([
      'Screen 1',
      'Screen 4',
    ]);
    expect(rowsForPlaylist(thePlan, ID(9).toUpperCase())).toHaveLength(2);
    expect(rowsForPlaylist(thePlan, ID(7))).toEqual([]);
    expect(rowsForPlaylist(null, ID(9))).toEqual([]);
  });

  it('leaves out a screen that plays the playlist as the default of its schedule', () => {
    const scheduled: PushPlanRow = {
      ...row(2, 'changes'),
      schedule: { id: ID(60), name: 'Opening hours' },
    };
    const thePlan = plan([row(1, 'up_to_date'), scheduled]);
    expect(rowsForPlaylist(thePlan, ID(9)).map((item) => item.display.name)).toEqual(['Screen 1']);
    expect(rowsForPlaylist(plan([scheduled]), ID(9))).toEqual([]);
  });

  it('leaves out a screen that plays the playlist in the main zone of its layout', () => {
    const laidOut: PushPlanRow = {
      ...row(2, 'changes'),
      layout: { id: ID(70), name: 'Foyer band' },
    };
    const thePlan = plan([row(1, 'up_to_date'), laidOut]);
    expect(rowsForPlaylist(thePlan, ID(9)).map((item) => item.display.name)).toEqual(['Screen 1']);
  });

  it('counts the screens a push would act on', () => {
    expect(waitingCount([row(1, 'changes'), row(2, 'never_pushed'), row(3, 'up_to_date')])).toBe(2);
    expect(waitingCount([row(1, 'blocked'), row(2, 'up_to_date')])).toBe(0);
    expect(waitingCount([])).toBe(0);
  });

  it('summarises where the screens stand', () => {
    expect(pushSummary([])).toBe('No screen has this playlist assigned directly.');
    expect(pushSummary([row(1, 'changes')])).toBe(
      '1 screen has this playlist assigned. It has changes waiting.',
    );
    expect(pushSummary([row(1, 'changes'), row(2, 'never_pushed')])).toBe(
      '2 screens have this playlist assigned. All have changes waiting.',
    );
    expect(pushSummary([row(1, 'changes'), row(2, 'up_to_date'), row(3, 'up_to_date')])).toBe(
      '3 screens have this playlist assigned. 1 has changes waiting.',
    );
    expect(pushSummary([row(1, 'up_to_date')])).toBe(
      '1 screen has this playlist assigned. It is up to date.',
    );
    expect(pushSummary([row(1, 'up_to_date'), row(2, 'up_to_date')])).toBe(
      '2 screens have this playlist assigned. All are up to date.',
    );
    expect(pushSummary([row(1, 'blocked'), row(2, 'blocked')])).toBe(
      '2 screens have this playlist assigned. 2 are blocked.',
    );
    expect(pushSummary([row(1, 'changes'), row(2, 'blocked')])).toBe(
      '2 screens have this playlist assigned. 1 has changes waiting. 1 is blocked.',
    );
  });

  it('holds the push while there are unsaved changes, and when no screen has the playlist', () => {
    expect(pushHoldReason(true, [row(1, 'changes')])).toBe(
      'Save the draft first. Only the saved playlist can be pushed.',
    );
    expect(pushHoldReason(true, [])).toContain('Save the draft first');
    expect(pushHoldReason(false, [])).toBe(
      'No screen has this playlist assigned directly. Screens that play it through a schedule or a layout are pushed with Push to screens.',
    );
    expect(pushHoldReason(false, [row(1, 'up_to_date')])).toBeNull();
    // A blocked screen can still be opened in the push dialog, which shows the refusal in full.
    expect(pushHoldReason(false, [row(1, 'blocked')])).toBeNull();
  });

  it('words the assignment', () => {
    expect(assignedMessage(['Foyer wall'])).toBe('Playlist assigned to Foyer wall');
    expect(assignedMessage(['A', 'B', 'C'])).toBe('Playlist assigned to 3 screens');
    expect(assignConfirmLabel(0)).toBe('Assign to screens');
    expect(assignConfirmLabel(1)).toBe('Assign to 1 screen');
    expect(assignConfirmLabel(4)).toBe('Assign to 4 screens');
  });
});

/* ---------- wording rules ---------- */

describe('wording', () => {
  it('says "screen", never "display", and has no word for a screen being reachable', () => {
    const rows = [row(1, 'changes'), row(2, 'blocked'), row(3, 'up_to_date')];
    const texts = [
      ...FIT_CHOICES.flatMap((choice) => [choice.label, choice.hint]),
      pushSummary([]),
      pushSummary(rows),
      pushSummary([row(1, 'up_to_date')]),
      pushHoldReason(true, rows),
      pushHoldReason(false, []),
      assignedMessage(['A', 'B']),
      assignConfirmLabel(0),
      assignConfirmLabel(2),
      capacityMessage(DEFAULT_LIMITS),
      durationRuleText(DEFAULT_LIMITS),
      itemNotReadyMessage({ status: 'failed' }),
      notReadyNote(2),
      usageLabel(2),
      loopLengthLabel(draft(), DEFAULT_LIMITS),
      nameProblem(''),
      descriptionProblem('a'.repeat(600)),
      invalidDurationSummary(2),
      ...listProblems(draft(), { ...NO_EDITOR_ERRORS, name: 'x', form: 'y' }).map(
        (problem) => problem.label,
      ),
    ];
    for (const text of texts) {
      expect(text).not.toBeNull();
      expect((text ?? '').toLowerCase()).not.toMatch(/online|offline|display|publish/);
    }
  });
});
