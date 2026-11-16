/**
 * Built-in apps in the portal (docs/portal-v2/stage-b.md, slice 2, section 8). Pure functions,
 * no DOM: the words for each type, the content of a new app, the editor's draft, what differs
 * from the saved app, the `PATCH /api/apps/:id` body for exactly those differences, the checks
 * that mirror `AppPatchSchema` in plain words, the contrast warning and the preview shapes.
 * The API stays the authority.
 */
import {
  AppPatchSchema,
  type ApiErrorDetail,
  type AppContent,
  type AppDto,
  type AppPatch,
  type AppType,
  type DisplayDto,
} from '@tinnox/contracts';
import { contrastRatio, parseColour } from './contrast.ts';
import type { CanvasPreviewShape } from './displayForm.ts';
import { shapeOfDisplay } from './screenDetailCanvas.ts';
import { matchesSearch, type SortAccessors, type SortState } from './listView.ts';

export const APP_TYPE_LABELS: { readonly [K in AppType]: string } = {
  clock: 'Clock',
  date: 'Date',
  countdown: 'Countdown',
  ticker: 'Ticker',
  qr: 'QR code',
  text: 'Text',
};

export const APP_TYPE_DESCRIPTIONS: { readonly [K in AppType]: string } = {
  clock: "The current time at the screen's site.",
  date: "Today's date at the screen's site.",
  countdown: 'Time left until a date and time you choose.',
  ticker: 'A line of text that scrolls across the screen.',
  qr: 'A code people scan with a phone camera.',
  text: 'A heading and a short message.',
};

/** The types whose preview depends on this computer's time zone. */
export function isTimeBased(type: AppType): boolean {
  return type === 'clock' || type === 'date' || type === 'countdown';
}

/** Said next to every preview of a time-based app; `zone` is this computer's time zone. */
export function previewZoneNote(zone: string): string {
  return `Times in this preview use this computer’s time zone (${zone}). Each screen uses its site’s time zone.`;
}

const two = (n: number): string => String(n).padStart(2, '0');

/** A local wall-clock time as `datetime-local` writes it: 'YYYY-MM-DDTHH:mm'. */
export function localDateTimeText(date: Date): string {
  return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** The content of a new app: white on black (black is "off" on LED), every field filled. */
export function defaultContent(type: AppType, nowMs: number): AppContent {
  const style = { textColour: '#ffffff', backgroundColour: '#000000' };
  switch (type) {
    case 'clock':
      return { type, settings: { hourCycle: '12', showSeconds: false, ...style } };
    case 'date':
      return { type, settings: { format: 'long', ...style } };
    case 'countdown': {
      const target = new Date(nowMs);
      target.setDate(target.getDate() + 7);
      target.setHours(9, 0, 0, 0);
      return {
        type,
        settings: {
          target: localDateTimeText(target),
          label: 'Opening in',
          finishedText: 'Now open',
          showSeconds: true,
          ...style,
        },
      };
    }
    case 'ticker':
      return { type, settings: { text: 'Welcome to TINNOX', speed: 'medium', ...style } };
    case 'qr':
      return { type, settings: { content: 'https://tinnox.com.au', caption: 'Scan me', ...style } };
    case 'text':
      return { type, settings: { heading: 'Welcome', body: '', ...style } };
  }
}

/** The label of each date format: today's date written that way (the renderer's options). */
export function dateFormatLabel(format: 'long' | 'short' | 'numeric', nowMs: number): string {
  const options: Intl.DateTimeFormatOptions =
    format === 'long'
      ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      : format === 'short'
        ? { weekday: 'short', day: 'numeric', month: 'short' }
        : { day: '2-digit', month: '2-digit', year: 'numeric' };
  return new Intl.DateTimeFormat('en-AU', options).format(nowMs);
}

/** True when a countdown target (this computer's zone) is not in the future. */
export function countdownPassed(target: string, nowMs: number): boolean {
  const at = new Date(target).getTime();
  return !Number.isNaN(at) && at <= nowMs;
}

// ---------------------------------------------------------------------------
// The editor's draft

/**
 * What the form holds, as typed. `content.settings.target` may be `INCOMPLETE_DATE_TIME`
 * (lib/mediaDetailDraft.ts), which fails the date check like any malformed value.
 */
export interface AppDraft {
  readonly name: string;
  readonly description: string;
  readonly content: AppContent;
}

export function appDraftFromDto(app: AppDto): AppDraft {
  return { name: app.name, description: app.description ?? '', content: app.content };
}

function descriptionToSave(text: string): string | null {
  const trimmed = text.replace(/\r\n?/g, '\n').trim();
  return trimmed === '' ? null : trimmed;
}

function settingValue(value: string | boolean): string | boolean {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : value;
}

/** Settings are flat (strings and booleans), so a key-by-key comparison is exact. */
function sameContent(a: AppContent, b: AppContent): boolean {
  if (a.type !== b.type) return false;
  const left: Readonly<Record<string, string | boolean>> = a.settings;
  const right: Readonly<Record<string, string | boolean>> = b.settings;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => {
      const value = right[key];
      return value !== undefined && settingValue(value) === settingValue(left[key] ?? '');
    })
  );
}

/** The fields of the form, by the key an error is stored under. */
export type AppErrors = Readonly<Record<string, string>>;

export const NO_APP_ERRORS: AppErrors = Object.freeze({});

/** What an operator reads for each field, for the error summary. */
export const APP_FIELD_LABELS: Readonly<Record<string, string>> = {
  name: 'Name',
  description: 'Description',
  target: 'Counts down to',
  label: 'Label',
  finishedText: 'When it ends, show',
  text: 'Text',
  content: 'Content',
  caption: 'Caption',
  heading: 'Heading',
  body: 'Message',
  textColour: 'Text colour',
  backgroundColour: 'Background colour',
  form: 'App',
};

/** The fields in the order of the form, so the summary reads top to bottom. */
const FIELD_ORDER = Object.keys(APP_FIELD_LABELS);

export function appErrorFields(errors: AppErrors): readonly string[] {
  return FIELD_ORDER.filter((field) => errors[field] !== undefined);
}

function changes(draft: AppDraft, saved: AppDto): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (draft.name.trim() !== saved.name) patch['name'] = draft.name;
  if (descriptionToSave(draft.description) !== saved.description) {
    patch['description'] = draft.description;
  }
  if (!sameContent(draft.content, saved.content)) patch['content'] = draft.content;
  return patch;
}

export function appIsDirty(draft: AppDraft, saved: AppDto): boolean {
  return Object.keys(changes(draft, saved)).length > 0;
}

const REQUIRED: Readonly<Record<string, string>> = {
  name: 'Enter a name.',
  text: 'Enter the text to scroll.',
  content: 'Enter what the code should hold, such as a web address.',
  finishedText: 'Enter what to show when the countdown ends.',
};
const DATE_MESSAGE = 'Enter a full date and time, year 1000 or later.';

/** The field an issue or a server detail belongs to: `content.settings.text` is `text`. */
function fieldOf(path: readonly PropertyKey[]): string {
  const [first, second, third] = path;
  if (first === 'name' || first === 'description') return first;
  if (first === 'content' && second === 'settings' && typeof third === 'string') return third;
  return 'form';
}

export type AppDraftResult =
  | { readonly ok: true; readonly value: AppPatch | null }
  | { readonly ok: false; readonly errors: AppErrors };

/**
 * Checks the draft and builds the body for `PATCH /api/apps/:id` from the fields that changed
 * (null when nothing did). Messages are the plain words of the spec, not the schema's.
 */
export function validateAppDraft(draft: AppDraft, saved: AppDto): AppDraftResult {
  const patch = changes(draft, saved);
  if (Object.keys(patch).length === 0) return { ok: true, value: null };
  const parsed = AppPatchSchema.safeParse(patch);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = fieldOf(issue.path);
    if (errors[field] !== undefined) continue;
    if (field === 'target') errors[field] = DATE_MESSAGE;
    else if (field === 'heading' && issue.code === 'custom') {
      errors[field] = 'Enter a heading or a message.';
    } else if (issue.code === 'too_small') {
      errors[field] = REQUIRED[field] ?? 'Enter a value.';
    } else if (issue.code === 'too_big' && 'maximum' in issue) {
      errors[field] = `Use at most ${String(issue.maximum)} characters.`;
    } else if (issue.code === 'invalid_format' && field.endsWith('Colour')) {
      errors[field] = 'Choose a colour.';
    } else if (issue.code === 'invalid_format' && issue.message.endsWith('broken character')) {
      errors[field] = 'Remove the broken character.';
    } else if (issue.code === 'invalid_format') {
      errors[field] = 'Remove the tabs, line breaks or hidden direction characters.';
    } else {
      errors[field] = issue.message;
    }
  }
  return { ok: false, errors };
}

/** A refusal's field details as messages at the fields; unknown paths go to `form`. */
export function appErrorsFromApi(details: readonly ApiErrorDetail[]): AppErrors {
  const errors: Record<string, string> = {};
  for (const detail of details) {
    const field = fieldOf(detail.path.split('.'));
    const message = detail.message.trim();
    errors[field] ??=
      message === ''
        ? 'The server refused this value.'
        : `The server refused this value: ${message}`;
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Style and preview

/** WCAG text contrast that reads well from a distance; under it the editor warns, never blocks. */
export const CONTRAST_THRESHOLD = 4.5;

export function contrastWarning(text: string, background: string): string | null {
  const a = parseColour(text);
  const b = parseColour(background);
  if (a === null || b === null) return null;
  const ratio = contrastRatio(a, b);
  if (ratio >= CONTRAST_THRESHOLD) return null;
  // Rounded down, so a ratio just under the threshold never reads as 4.5.
  const shown = (Math.floor(ratio * 10) / 10).toFixed(1);
  return `The text and background colours are hard to tell apart (${shown}:1). Choose colours with more contrast; 4.5:1 or more reads well from a distance.`;
}

export interface PreviewShapeOption {
  readonly value: string;
  readonly label: string;
  readonly shape: CanvasPreviewShape;
}

function whole(width: number, height: number): CanvasPreviewShape {
  return { canvas: { width, height }, contentRect: null, contentRectOutOfBounds: false };
}

/** The "Preview on" choices: landscape and portrait full HD, then each screen with its content rectangle. */
export function previewShapes(
  displays: readonly Pick<DisplayDto, 'id' | 'name' | 'canvas' | 'contentRect'>[],
): readonly PreviewShapeOption[] {
  return [
    { value: 'landscape', label: 'Landscape 1920 × 1080', shape: whole(1920, 1080) },
    { value: 'portrait', label: 'Portrait 1080 × 1920', shape: whole(1080, 1920) },
    ...displays.map((display) => ({
      value: display.id,
      label: `${display.name} · ${String(display.canvas.width)} × ${String(display.canvas.height)}`,
      shape: shapeOfDisplay(display),
    })),
  ];
}

/** "Used in 2 playlists", "Not used". */
export function usedInLabel(count: number): string {
  if (count === 0) return 'Not used';
  return count === 1 ? '1 playlist' : `${String(count)} playlists`;
}

// ---------------------------------------------------------------------------
// The list

export const APP_SORT_ACCESSORS: SortAccessors<AppDto> = {
  name: (app) => app.name,
  type: (app) => APP_TYPE_LABELS[app.content.type],
  used: (app) => app.usageCount,
  updated: (app) => new Date(app.updatedAt),
};

export const DEFAULT_APP_SORT: SortState = { columnId: 'name', direction: 'asc' };

/** The apps a search (name and description) and a type filter (null for all) leave. */
export function filterAppList(
  apps: readonly AppDto[],
  query: string,
  type: AppType | null,
): readonly AppDto[] {
  return apps.filter(
    (app) =>
      (type === null || app.content.type === type) &&
      matchesSearch([app.name, app.description], query),
  );
}

/** The playlist names a 409 `app_in_use` refusal lists in its details. */
export function inUsePlaylistNames(details: readonly ApiErrorDetail[]): readonly string[] {
  return details.filter((detail) => detail.path === 'playlist').map((detail) => detail.message);
}
