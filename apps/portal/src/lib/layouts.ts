/**
 * Layouts in the portal (docs/portal-v2/stage-b.md, slice 4, section 7). Pure functions, no
 * DOM: the one preset (a main zone and a band along the bottom), the editor's draft, what
 * differs from the saved layout, the body of `POST /api/layouts` and `PUT /api/layouts/:id`,
 * the checks in plain words, where a refusal's details belong, the zone sizes on a screen shape,
 * and the list's search, order and labels. The API stays the authority.
 */
import {
  ABSOLUTE,
  LAYOUT_UNITS,
  type ApiErrorDetail,
  type LayoutBox,
  type LayoutDto,
  type LayoutInput,
  type LayoutZoneInput,
  type Rect,
} from '@tinnox/contracts';
import { effectiveContentRect, zoneRect } from '@tinnox/domain';
import type { CanvasPreviewShape } from './displayForm.ts';
import { matchesSearch, type SortAccessors, type SortState } from './listView.ts';
import { descriptionProblem, nameProblem } from './playlistEditor.ts';
import { parseStepperValue } from './stepper.ts';

// ---------------------------------------------------------------------------
// The preset

// shortcut: one preset (bottom band); add numeric x/y/width/height fields per zone (the keyboard form of a free editor) and top/side presets when the client asks (question 1).
/** The band's height in per cent of each screen's content area. */
export const BAND_PERCENT = { min: 5, max: 50, initial: 15 } as const;

const UNITS_PER_PERCENT = LAYOUT_UNITS / 100;

/** The preset: a main zone on top and a band of `percent` per cent along the bottom. */
export function bandZones(
  percent: number,
  mainPlaylistId: string,
  bandPlaylistId: string,
): LayoutZoneInput[] {
  const band = percent * UNITS_PER_PERCENT;
  return [
    { playlistId: mainPlaylistId, x: 0, y: 0, width: LAYOUT_UNITS, height: LAYOUT_UNITS - band },
    { playlistId: bandPlaylistId, x: 0, y: LAYOUT_UNITS - band, width: LAYOUT_UNITS, height: band },
  ];
}

function sameBox(a: LayoutBox, b: LayoutBox): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** The band height in whole per cent when the zones are exactly the preset, else null. */
export function bandPercentOf(zones: readonly LayoutBox[]): number | null {
  const band = zones[1];
  if (zones.length !== 2 || band === undefined) return null;
  const percent = band.height / UNITS_PER_PERCENT;
  if (!Number.isInteger(percent) || percent < BAND_PERCENT.min || percent > BAND_PERCENT.max) {
    return null;
  }
  const preset = bandZones(percent, '', '');
  return zones.every((zone, index) => {
    const other = preset[index];
    return other !== undefined && sameBox(zone, other);
  })
    ? percent
    : null;
}

/** The band height the Stepper's text gives: a whole number from 5 to 50, else null. */
export function bandPercentValue(text: string): number | null {
  const value = parseStepperValue(text);
  return value !== null &&
    Number.isInteger(value) &&
    value >= BAND_PERCENT.min &&
    value <= BAND_PERCENT.max
    ? value
    : null;
}

/** "Main zone" for 0; "Band" for 1 with the preset; otherwise "Zone {index + 1}". */
export function zoneLabel(index: number, preset: boolean): string {
  if (index === 0) return 'Main zone';
  if (index === 1 && preset) return 'Band';
  return `Zone ${String(index + 1)}`;
}

// ---------------------------------------------------------------------------
// The editor's draft

/** One zone as the form holds it; the geometry is in basis points (LAYOUT_UNITS). */
export interface LayoutZoneDraft {
  /** '' while no playlist is chosen. */
  readonly playlistId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutDraft {
  readonly name: string;
  readonly description: string;
  /** The Stepper's text; null when the saved zones match no preset (their sizes are kept). */
  readonly bandPercent: string | null;
  /** Position order: [0] is the main zone. */
  readonly zones: readonly LayoutZoneDraft[];
}

export function layoutDraftFromDto(layout: LayoutDto): LayoutDraft {
  const percent = bandPercentOf(layout.zones);
  return {
    name: layout.name,
    description: layout.description ?? '',
    bandPercent: percent === null ? null : String(percent),
    zones: layout.zones.map((zone) => ({
      playlistId: zone.playlist.id,
      x: zone.x,
      y: zone.y,
      width: zone.width,
      height: zone.height,
    })),
  };
}

// The rule of the playlist editor's private `descriptionToSave` (lib/playlistEditor.ts).
function descriptionToSave(text: string): string | null {
  const trimmed = text.replace(/\r\n?/g, '\n').trim();
  return trimmed === '' ? null : trimmed;
}

/** True when the draft holds something other than the saved layout. */
export function layoutIsDirty(saved: LayoutDto, draft: LayoutDraft): boolean {
  const stored = layoutDraftFromDto(saved);
  return (
    draft.name.trim() !== stored.name ||
    descriptionToSave(draft.description) !== saved.description ||
    draft.bandPercent !== stored.bandPercent ||
    draft.zones.length !== stored.zones.length ||
    draft.zones.some((zone, index) => {
      const other = stored.zones[index];
      return other === undefined || zone.playlistId !== other.playlistId || !sameBox(zone, other);
    })
  );
}

/**
 * The zones the draft stands for: the preset at the typed band height, or the saved geometry
 * when there is no preset, each with its chosen playlist ('' while none is chosen). Null while
 * the band height is not a whole number from 5 to 50. The editor never replaces zones silently.
 */
export function draftZones(draft: LayoutDraft): LayoutZoneInput[] | null {
  if (draft.bandPercent === null) {
    return draft.zones.map((zone) => ({
      playlistId: zone.playlistId,
      x: zone.x,
      y: zone.y,
      width: zone.width,
      height: zone.height,
    }));
  }
  const percent = bandPercentValue(draft.bandPercent);
  if (percent === null) return null;
  return bandZones(percent, draft.zones[0]?.playlistId ?? '', draft.zones[1]?.playlistId ?? '');
}

// ---------------------------------------------------------------------------
// Checks

/** The message of one zone, under its playlist select. */
export interface LayoutZoneErrors {
  readonly playlistId?: string;
}

export interface LayoutErrors {
  readonly name?: string;
  readonly description?: string;
  readonly bandPercent?: string;
  /** A message that belongs to no control; shown in the error summary only. */
  readonly form?: string;
  /** By the zone's position, from 0. */
  readonly zones: ReadonlyMap<number, LayoutZoneErrors>;
}

export const NO_LAYOUT_ERRORS: LayoutErrors = Object.freeze({ zones: new Map() });

export type LayoutDraftResult =
  | { readonly ok: true; readonly value: LayoutInput }
  | { readonly ok: false; readonly errors: LayoutErrors };

const BAND_PERCENT_PROBLEM = `Enter a whole number from ${String(BAND_PERCENT.min)} to ${String(BAND_PERCENT.max)}.`;

/**
 * Checks the draft and builds the whole layout for the API, or every message to show. The
 * description is always sent (the trimmed text, or null when blank), so clearing the field
 * clears it.
 */
export function validateLayoutDraft(draft: LayoutDraft): LayoutDraftResult {
  const top: { name?: string; description?: string; bandPercent?: string } = {};
  const name = nameProblem(draft.name);
  if (name !== null) top.name = name;
  const description = descriptionProblem(draft.description);
  if (description !== null) top.description = description;
  const zones = draftZones(draft);
  if (zones === null) top.bandPercent = BAND_PERCENT_PROBLEM;
  const zoneErrors = new Map<number, LayoutZoneErrors>();
  draft.zones.forEach((zone, index) => {
    if (zone.playlistId === '') zoneErrors.set(index, { playlistId: 'Choose a playlist.' });
  });
  if (zones === null || Object.keys(top).length > 0 || zoneErrors.size > 0) {
    return { ok: false, errors: { ...top, zones: zoneErrors } };
  }
  return {
    ok: true,
    value: { name: draft.name.trim(), description: descriptionToSave(draft.description), zones },
  };
}

/**
 * A refusal's field details as messages at the controls. The API names the fields of this
 * body with dots (`LayoutInputSchema`): `name`, `description` and `zones.1.playlistId` have a
 * control; anything else (`zones`, `zones.1`, `zones.1.width`, an index with no zone, an
 * unknown path) goes to `form`. The first message per slot wins.
 */
export function layoutErrorsFromApi(
  details: readonly ApiErrorDetail[],
  draft: LayoutDraft,
): LayoutErrors {
  const top: { name?: string; description?: string; form?: string } = {};
  const zones = new Map<number, LayoutZoneErrors>();
  for (const detail of details) {
    const parts = detail.path.split('.');
    const [first, second, third] = parts;
    const text = detail.message.trim();
    const message =
      text === '' ? 'The server refused this value.' : `The server refused this value: ${text}`;
    if (parts.length === 1 && (first === 'name' || first === 'description')) {
      top[first] ??= message;
      continue;
    }
    const index = Number(second);
    if (
      parts.length === 3 &&
      first === 'zones' &&
      second !== undefined &&
      /^\d+$/.test(second) &&
      draft.zones[index] !== undefined &&
      third === 'playlistId'
    ) {
      if (!zones.has(index)) zones.set(index, { playlistId: message });
      continue;
    }
    top.form ??= message;
  }
  return { ...top, zones };
}

/** The errors without the message of one field (or of zone `n`'s playlist); the same object when it had none. */
export function withoutLayoutError(
  errors: LayoutErrors,
  slot: 'name' | 'description' | 'bandPercent' | number,
): LayoutErrors {
  if (typeof slot === 'number') {
    if (!errors.zones.has(slot)) return errors;
    const zones = new Map(errors.zones);
    zones.delete(slot);
    return { ...errors, zones };
  }
  if (errors[slot] === undefined) return errors;
  const { [slot]: _removed, ...rest } = errors;
  return rest;
}

/** One line of the editor's error summary. */
export interface LayoutErrorEntry {
  /** Unique within the summary. */
  readonly id: string;
  /** "Band: Choose a playlist." */
  readonly text: string;
  /** The test id of the control the line's link focuses; null for a message with no control. */
  readonly target: string | null;
}

/** The error summary, top to bottom in the order of the form. */
export function layoutErrorEntries(
  errors: LayoutErrors,
  draft: LayoutDraft,
): readonly LayoutErrorEntry[] {
  const entries: LayoutErrorEntry[] = [];
  if (errors.name !== undefined) {
    entries.push({ id: 'name', text: `Name: ${errors.name}`, target: 'layout-name' });
  }
  if (errors.description !== undefined) {
    entries.push({
      id: 'description',
      text: `Description: ${errors.description}`,
      target: 'layout-description',
    });
  }
  if (errors.bandPercent !== undefined) {
    entries.push({
      id: 'bandPercent',
      text: `Band height: ${errors.bandPercent}`,
      target: 'layout-band-percent',
    });
  }
  const preset = draft.bandPercent !== null;
  draft.zones.forEach((_zone, index) => {
    const message = errors.zones.get(index)?.playlistId;
    if (message === undefined) return;
    entries.push({
      id: `zone-${String(index)}`,
      text: `${zoneLabel(index, preset)}: ${message}`,
      target: `layout-zone-${String(index)}-playlist`,
    });
  });
  if (errors.form !== undefined) {
    entries.push({ id: 'form', text: `Layout: ${errors.form}`, target: null });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Zone sizes on a screen shape

export interface ZoneSize {
  /** In canvas pixels, as a push would resolve it. */
  readonly rect: Rect;
  /** A side is under 16 px: a push to a screen of this shape is refused with `zone_too_small`. */
  readonly tooSmall: boolean;
}

/** Each zone in canvas pixels on the shape, by the planner's own rounding (`zoneRect`). */
export function zoneSizes(
  shape: CanvasPreviewShape,
  zones: readonly LayoutBox[],
): readonly ZoneSize[] {
  const area = effectiveContentRect(
    shape.canvas,
    shape.contentRectOutOfBounds ? null : shape.contentRect,
  );
  return zones.map((zone) => {
    const rect = zoneRect(area, zone);
    return {
      rect,
      tooSmall: rect.width < ABSOLUTE.minCanvasSidePx || rect.height < ABSOLUTE.minCanvasSidePx,
    };
  });
}

/** "On 1080 × 1920: main zone 1080 × 1632 px, band 1080 × 288 px." `labels` by zone (`zoneLabel`). */
export function zoneSizeSentence(
  shape: CanvasPreviewShape,
  zones: readonly LayoutBox[],
  labels: readonly string[],
): string {
  const parts = zoneSizes(shape, zones).map(
    ({ rect }, index) =>
      `${(labels[index] ?? zoneLabel(index, false)).toLowerCase()} ${String(rect.width)} × ${String(rect.height)} px`,
  );
  return `On ${String(shape.canvas.width)} × ${String(shape.canvas.height)}: ${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// The list

/** "15%" for the preset, otherwise "Custom". */
export function bandLabel(layout: Pick<LayoutDto, 'zones'>): string {
  const percent = bandPercentOf(layout.zones);
  return percent === null ? 'Custom' : `${String(percent)}%`;
}

/** The second line of a layout in a picker: "Main zone: Menu · Band 15%" or "Main zone: Menu · 3 zones". */
export function layoutSummaryLabel(layout: Pick<LayoutDto, 'zones'>): string {
  const percent = bandPercentOf(layout.zones);
  const shape =
    percent === null ? `${String(layout.zones.length)} zones` : `Band ${String(percent)}%`;
  return `Main zone: ${layout.zones[0]?.playlist.name ?? ''} · ${shape}`;
}

export const LAYOUT_SORT_ACCESSORS: SortAccessors<LayoutDto> = {
  name: (layout) => layout.name,
  playlist: (layout) => layout.zones[0]?.playlist.name,
  // A custom layout has no band height; it sorts with the missing values.
  band: (layout) => bandPercentOf(layout.zones),
  screens: (layout) => layout.assignedDisplayCount,
  updated: (layout) => new Date(layout.updatedAt),
};

export const DEFAULT_LAYOUT_SORT: SortState = { columnId: 'name', direction: 'asc' };

/** What a search is matched against: the name, the description and every zone's playlist name. */
export function layoutSearchTexts(layout: LayoutDto): readonly (string | null)[] {
  return [layout.name, layout.description, ...layout.zones.map((zone) => zone.playlist.name)];
}

/** The layouts a search leaves. */
export function filterLayoutList(items: readonly LayoutDto[], query: string): readonly LayoutDto[] {
  return items.filter((layout) => matchesSearch(layoutSearchTexts(layout), query));
}
