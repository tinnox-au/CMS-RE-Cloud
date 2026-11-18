import { ABSOLUTE, LayoutInputSchema, type LayoutBox, type LayoutDto } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import type { CanvasPreviewShape } from './displayForm.ts';
import {
  BAND_PERCENT,
  bandLabel,
  bandPercentOf,
  bandPercentValue,
  bandZones,
  DEFAULT_LAYOUT_SORT,
  draftZones,
  filterLayoutList,
  LAYOUT_SORT_ACCESSORS,
  layoutDraftFromDto,
  layoutErrorEntries,
  layoutErrorsFromApi,
  layoutIsDirty,
  layoutSummaryLabel,
  NO_LAYOUT_ERRORS,
  validateLayoutDraft,
  withoutLayoutError,
  zoneLabel,
  zoneSizes,
  zoneSizeSentence,
} from './layouts.ts';
import { sortRows } from './listView.ts';
import { ID } from './mediaLibrary.test-support.ts';
import { descriptionProblem } from './playlistEditor.ts';

const T = '2026-11-18T03:00:00.000Z';
const MAIN = ID(1);
const BAND = ID(2);
const CLOCK = ID(3);

const BAND_PROBLEM = 'Enter a whole number from 5 to 50.';

function zone(playlistId: string, name: string, box: LayoutBox): LayoutDto['zones'][number] {
  return { playlist: { id: playlistId, name }, ...box };
}

function layout(n: number, change: Partial<LayoutDto> = {}): LayoutDto {
  return {
    id: ID(n),
    name: `Layout ${String(n)}`,
    description: null,
    zones: [
      zone(MAIN, 'Menu', { x: 0, y: 0, width: 10_000, height: 8500 }),
      zone(BAND, 'Specials ticker', { x: 0, y: 8500, width: 10_000, height: 1500 }),
    ],
    assignedDisplayCount: 0,
    createdAt: T,
    updatedAt: T,
    ...change,
  };
}

/** Three zones side by side along the top, set outside the editor. */
const CUSTOM_ZONES = [
  zone(MAIN, 'Menu', { x: 0, y: 0, width: 5000, height: 8000 }),
  zone(BAND, 'Specials ticker', { x: 5000, y: 0, width: 5000, height: 8000 }),
  zone(CLOCK, 'Clock', { x: 0, y: 8000, width: 10_000, height: 2000 }),
];

function shape(
  width: number,
  height: number,
  contentRect: CanvasPreviewShape['contentRect'] = null,
): CanvasPreviewShape {
  return { canvas: { width, height }, contentRect, contentRectOutOfBounds: false };
}

describe('the preset', () => {
  it('builds a main zone over a band and reads the band height back', () => {
    expect(bandZones(15, MAIN, BAND)).toEqual([
      { playlistId: MAIN, x: 0, y: 0, width: 10_000, height: 8500 },
      { playlistId: BAND, x: 0, y: 8500, width: 10_000, height: 1500 },
    ]);
    for (const percent of [5, 15, 50]) {
      const zones = bandZones(percent, MAIN, BAND);
      expect(bandPercentOf(zones), String(percent)).toBe(percent);
      expect(LayoutInputSchema.safeParse({ name: 'Band', zones }).success).toBe(true);
    }
  });

  it('reads no band height from zones that are not the preset', () => {
    const [main, band] = bandZones(15, MAIN, BAND);
    if (main === undefined || band === undefined) throw new Error('two zones expected');
    expect(bandPercentOf(CUSTOM_ZONES)).toBeNull();
    // The band at the top.
    expect(
      bandPercentOf([
        { ...main, y: 1500 },
        { ...band, y: 0 },
      ]),
    ).toBeNull();
    expect(bandPercentOf(bandZones(4, MAIN, BAND))).toBeNull();
    expect(bandPercentOf(bandZones(51, MAIN, BAND))).toBeNull();
    expect(bandPercentOf(bandZones(12.5, MAIN, BAND))).toBeNull();
    // A band that does not span the whole width.
    expect(bandPercentOf([main, { ...band, width: 9000 }])).toBeNull();
    expect(bandPercentOf([main])).toBeNull();
  });

  it('reads the Stepper text as a whole number from 5 to 50', () => {
    expect(bandPercentValue('15')).toBe(15);
    expect(bandPercentValue(' 5 ')).toBe(5);
    expect(bandPercentValue('50')).toBe(50);
    for (const text of ['4', '51', '12.5', '', 'ten']) {
      expect(bandPercentValue(text), text).toBeNull();
    }
    expect(BAND_PERCENT).toEqual({ min: 5, max: 50, initial: 15 });
  });

  it('names the zones', () => {
    expect(zoneLabel(0, true)).toBe('Main zone');
    expect(zoneLabel(1, true)).toBe('Band');
    expect(zoneLabel(0, false)).toBe('Main zone');
    expect(zoneLabel(1, false)).toBe('Zone 2');
    expect(zoneLabel(2, true)).toBe('Zone 3');
  });
});

describe('the draft', () => {
  it('holds a stored preset with its band height as text', () => {
    expect(layoutDraftFromDto(layout(5, { description: 'Lunch menu' }))).toEqual({
      name: 'Layout 5',
      description: 'Lunch menu',
      bandPercent: '15',
      zones: [
        { playlistId: MAIN, x: 0, y: 0, width: 10_000, height: 8500 },
        { playlistId: BAND, x: 0, y: 8500, width: 10_000, height: 1500 },
      ],
    });
  });

  it('holds a custom layout without a band height', () => {
    const draft = layoutDraftFromDto(layout(5, { zones: CUSTOM_ZONES }));
    expect(draft.bandPercent).toBeNull();
    expect(draft.zones).toHaveLength(3);
    expect(draft.zones[2]).toEqual({
      playlistId: CLOCK,
      x: 0,
      y: 8000,
      width: 10_000,
      height: 2000,
    });
  });

  it('is dirty only when it differs from the saved layout', () => {
    const saved = layout(5);
    const draft = layoutDraftFromDto(saved);
    expect(layoutIsDirty(saved, draft)).toBe(false);
    expect(layoutIsDirty(saved, { ...draft, name: '  Layout 5 ' })).toBe(false);
    expect(layoutIsDirty(saved, { ...draft, description: '   ' })).toBe(false);
    expect(layoutIsDirty(saved, { ...draft, name: 'Lobby' })).toBe(true);
    expect(layoutIsDirty(saved, { ...draft, description: 'Lunch' })).toBe(true);
    expect(layoutIsDirty(saved, { ...draft, bandPercent: '20' })).toBe(true);
    expect(
      layoutIsDirty(saved, {
        ...draft,
        zones: draft.zones.map((z, index) => (index === 1 ? { ...z, playlistId: CLOCK } : z)),
      }),
    ).toBe(true);
  });

  it('stands for the preset at the typed height, or the saved geometry', () => {
    const draft = layoutDraftFromDto(layout(5));
    expect(draftZones({ ...draft, bandPercent: '20' })).toEqual(bandZones(20, MAIN, BAND));
    expect(draftZones({ ...draft, bandPercent: '12.5' })).toBeNull();
    const custom = layoutDraftFromDto(layout(5, { zones: CUSTOM_ZONES }));
    expect(draftZones(custom)).toEqual(custom.zones);
  });
});

describe('validateLayoutDraft', () => {
  const draft = layoutDraftFromDto(layout(5));

  it('builds the whole layout from the preset at the typed height', () => {
    const result = validateLayoutDraft({
      ...draft,
      name: '  Menu board ',
      description: ' Lunch ',
      bandPercent: '20',
    });
    expect(result).toEqual({
      ok: true,
      value: { name: 'Menu board', description: 'Lunch', zones: bandZones(20, MAIN, BAND) },
    });
    if (result.ok) expect(LayoutInputSchema.parse(result.value)).toEqual(result.value);
  });

  it('sends a blank description as null, so saving clears it', () => {
    const result = validateLayoutDraft({ ...draft, description: '  ' });
    expect(result.ok && result.value.description).toBeNull();
  });

  it('keeps the geometry of a custom layout with the chosen playlists', () => {
    const custom = layoutDraftFromDto(layout(5, { zones: CUSTOM_ZONES }));
    const result = validateLayoutDraft({
      ...custom,
      zones: custom.zones.map((z, index) => (index === 2 ? { ...z, playlistId: MAIN } : z)),
    });
    expect(result.ok && result.value.zones).toEqual([
      { playlistId: MAIN, x: 0, y: 0, width: 5000, height: 8000 },
      { playlistId: BAND, x: 5000, y: 0, width: 5000, height: 8000 },
      { playlistId: MAIN, x: 0, y: 8000, width: 10_000, height: 2000 },
    ]);
  });

  it('refuses a missing name and a description that is too long', () => {
    const long = 'x'.repeat(ABSOLUTE.maxDescriptionLength + 1);
    const result = validateLayoutDraft({ ...draft, name: '  ', description: long });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBe('Enter a name.');
    expect(result.errors.description).toBe(descriptionProblem(long));
    expect(result.errors.zones.size).toBe(0);
  });

  it('refuses a band height that is not a whole number from 5 to 50', () => {
    for (const text of ['4', '51', '12.5', '']) {
      const result = validateLayoutDraft({ ...draft, bandPercent: text });
      expect(result.ok, text).toBe(false);
      if (!result.ok) expect(result.errors.bandPercent, text).toBe(BAND_PROBLEM);
    }
  });

  it('refuses a zone without a playlist', () => {
    const result = validateLayoutDraft({
      ...draft,
      zones: draft.zones.map((z, index) => (index === 1 ? { ...z, playlistId: '' } : z)),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect([...result.errors.zones]).toEqual([[1, { playlistId: 'Choose a playlist.' }]]);
    expect(result.errors.name).toBeUndefined();
  });
});

describe('errors', () => {
  const draft = layoutDraftFromDto(layout(5));

  it('puts the details of a refusal at their controls, the rest on the form', () => {
    const errors = layoutErrorsFromApi(
      [
        { path: 'name', message: 'too long' },
        { path: 'description', message: '' },
        { path: 'zones.1.playlistId', message: 'The playlist was not found.' },
        { path: 'zones.1.width', message: 'x + width must not exceed 10000' },
        { path: 'zones', message: 'too many' },
        { path: 'colour', message: 'unknown' },
      ],
      draft,
    );
    expect(errors.name).toBe('The server refused this value: too long');
    expect(errors.description).toBe('The server refused this value.');
    expect([...errors.zones]).toEqual([
      [1, { playlistId: 'The server refused this value: The playlist was not found.' }],
    ]);
    expect(errors.form).toBe('The server refused this value: x + width must not exceed 10000');
  });

  it('sends a zone the draft does not have, or a bare zone, to the form', () => {
    expect(layoutErrorsFromApi([{ path: 'zones.3.playlistId', message: 'gone' }], draft)).toEqual({
      form: 'The server refused this value: gone',
      zones: new Map(),
    });
    expect(
      layoutErrorsFromApi([{ path: 'zones.1', message: 'zone 2 overlaps zone 1' }], draft),
    ).toEqual({
      form: 'The server refused this value: zone 2 overlaps zone 1',
      zones: new Map(),
    });
  });

  it('removes one message at a time', () => {
    const errors = {
      name: 'Enter a name.',
      bandPercent: BAND_PROBLEM,
      zones: new Map([[1, { playlistId: 'Choose a playlist.' }]]),
    };
    expect(withoutLayoutError(errors, 'name')).toEqual({
      bandPercent: BAND_PROBLEM,
      zones: errors.zones,
    });
    expect(withoutLayoutError(errors, 1).zones.size).toBe(0);
    expect(withoutLayoutError(errors, 'description')).toBe(errors);
    expect(withoutLayoutError(errors, 0)).toBe(errors);
    expect(withoutLayoutError(NO_LAYOUT_ERRORS, 'bandPercent')).toBe(NO_LAYOUT_ERRORS);
  });

  it('lists the summary in the order of the form, each with its control', () => {
    const errors = {
      name: 'Enter a name.',
      description: 'Use at most 500 characters (now 501).',
      bandPercent: BAND_PROBLEM,
      form: 'The server refused this value: zone 2 overlaps zone 1',
      zones: new Map([
        [1, { playlistId: 'Choose a playlist.' }],
        [0, { playlistId: 'Choose a playlist.' }],
      ]),
    };
    expect(layoutErrorEntries(errors, draft)).toEqual([
      { id: 'name', text: 'Name: Enter a name.', target: 'layout-name' },
      {
        id: 'description',
        text: 'Description: Use at most 500 characters (now 501).',
        target: 'layout-description',
      },
      {
        id: 'bandPercent',
        text: `Band height: ${BAND_PROBLEM}`,
        target: 'layout-band-percent',
      },
      { id: 'zone-0', text: 'Main zone: Choose a playlist.', target: 'layout-zone-0-playlist' },
      { id: 'zone-1', text: 'Band: Choose a playlist.', target: 'layout-zone-1-playlist' },
      {
        id: 'form',
        text: 'Layout: The server refused this value: zone 2 overlaps zone 1',
        target: null,
      },
    ]);
    const custom = layoutDraftFromDto(layout(5, { zones: CUSTOM_ZONES }));
    expect(
      layoutErrorEntries({ zones: new Map([[1, { playlistId: 'Choose a playlist.' }]]) }, custom),
    ).toEqual([
      { id: 'zone-1', text: 'Zone 2: Choose a playlist.', target: 'layout-zone-1-playlist' },
    ]);
    expect(layoutErrorEntries(NO_LAYOUT_ERRORS, draft)).toEqual([]);
  });
});

describe('zone sizes', () => {
  const preset = bandZones(15, MAIN, BAND);
  const labels = ['Main zone', 'Band'];

  it('resolves the zones on a portrait screen', () => {
    expect(zoneSizes(shape(1080, 1920), preset)).toEqual([
      { rect: { x: 0, y: 0, width: 1080, height: 1632 }, tooSmall: false },
      { rect: { x: 0, y: 1632, width: 1080, height: 288 }, tooSmall: false },
    ]);
    expect(zoneSizeSentence(shape(1080, 1920), preset, labels)).toBe(
      'On 1080 × 1920: main zone 1080 × 1632 px, band 1080 × 288 px.',
    );
  });

  it('resolves the zones inside a content rectangle', () => {
    const led = shape(3840, 480, { x: 100, y: 40, width: 3600, height: 400 });
    expect(zoneSizes(led, preset)).toEqual([
      { rect: { x: 100, y: 40, width: 3600, height: 340 }, tooSmall: false },
      { rect: { x: 100, y: 380, width: 3600, height: 60 }, tooSmall: false },
    ]);
    expect(zoneSizeSentence(led, preset, labels)).toBe(
      'On 3840 × 480: main zone 3600 × 340 px, band 3600 × 60 px.',
    );
    // A content rectangle that does not fit is left out, as the canvas preview does.
    expect(zoneSizes({ ...led, contentRectOutOfBounds: true }, preset)[1]?.rect).toEqual({
      x: 0,
      y: 408,
      width: 3840,
      height: 72,
    });
  });

  it('marks a zone under 16 px', () => {
    expect(zoneSizes(shape(192, 96), bandZones(10, MAIN, BAND))).toEqual([
      { rect: { x: 0, y: 0, width: 192, height: 86 }, tooSmall: false },
      { rect: { x: 0, y: 86, width: 192, height: 10 }, tooSmall: true },
    ]);
    expect(zoneSizes(shape(192, 96), bandZones(20, MAIN, BAND))[1]?.tooSmall).toBe(false);
  });
});

describe('the list', () => {
  it('labels the band and the summary line', () => {
    expect(bandLabel(layout(5))).toBe('15%');
    expect(bandLabel(layout(5, { zones: CUSTOM_ZONES }))).toBe('Custom');
    expect(layoutSummaryLabel(layout(5))).toBe('Main zone: Menu · Band 15%');
    expect(layoutSummaryLabel(layout(5, { zones: CUSTOM_ZONES }))).toBe(
      'Main zone: Menu · 3 zones',
    );
  });

  it('searches the name, the description and every zone playlist', () => {
    const items = [
      layout(1, { name: 'Café board' }),
      layout(2, { name: 'Foyer', description: 'Lunch specials' }),
      layout(3, { name: 'Lobby', zones: CUSTOM_ZONES }),
    ];
    const names = (query: string) => filterLayoutList(items, query).map((item) => item.name);
    expect(names('')).toEqual(['Café board', 'Foyer', 'Lobby']);
    expect(names('lunch')).toEqual(['Foyer']);
    expect(names('clock')).toEqual(['Lobby']);
    expect(names('ticker')).toEqual(['Café board', 'Foyer', 'Lobby']);
  });

  it('sorts by name first, and by band height with custom layouts last', () => {
    const items = [
      layout(1, { name: 'b', zones: CUSTOM_ZONES }),
      layout(2, { name: 'c' }),
      layout(3, {
        name: 'a',
        zones: bandZones(30, MAIN, BAND).map(({ playlistId, ...box }) =>
          zone(playlistId, 'Menu', box),
        ),
      }),
    ];
    const order = (sort: typeof DEFAULT_LAYOUT_SORT) =>
      sortRows(items, sort, LAYOUT_SORT_ACCESSORS).map((item) => item.name);
    expect(order(DEFAULT_LAYOUT_SORT)).toEqual(['a', 'b', 'c']);
    expect(order({ columnId: 'band', direction: 'asc' })).toEqual(['c', 'a', 'b']);
  });
});
