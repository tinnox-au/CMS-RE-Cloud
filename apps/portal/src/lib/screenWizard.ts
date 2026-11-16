import {
  DEV_PORTS,
  DisplayIdSchema,
  type PlaylistSummaryDto,
  type PushPlanRow,
} from '@tinnox/contracts';
import type {
  CanvasPreviewShape,
  DisplayFormErrors,
  DisplayFormField,
  DisplayFormValues,
} from './displayForm.ts';

/**
 * Pure logic of the Add screen wizard (docs/portal-v2/stage-a.md, section 3.7): where the
 * wizard is, what the step indicator says, the canvas presets, the pairing code field and
 * the wording that goes with them. No DOM and no requests.
 *
 * An operator reads "screen" everywhere; the code keeps the M0 name `display`.
 */

export const WIZARD_STEPS = ['details', 'pair', 'content'] as const;
export type WizardStepId = (typeof WIZARD_STEPS)[number];

/** The address of the wizard. The screen's id is added once the screen exists. */
export const WIZARD_PATH = '/screens/new';

const SCREEN_PARAM = 'screen';
const STEP_PARAM = 'step';

export interface WizardLocation {
  /** The id of the screen the wizard has created, or null before the first step is done. */
  readonly displayId: string | null;
  readonly step: WizardStepId;
}

function isWizardStep(value: string | null): value is WizardStepId {
  return (WIZARD_STEPS as readonly string[]).includes(value ?? '');
}

/**
 * Reads the wizard's place from the query string. Without a well-formed screen id the
 * wizard is always on its first step, whatever the address says: the later steps act on a
 * screen that exists. With an id and no usable step it resumes at pairing.
 */
export function parseWizardLocation(search: string): WizardLocation {
  const params = new URLSearchParams(search);
  const id = DisplayIdSchema.safeParse((params.get(SCREEN_PARAM) ?? '').toLowerCase());
  if (!id.success) return { displayId: null, step: 'details' };
  const step = params.get(STEP_PARAM);
  return { displayId: id.data, step: isWizardStep(step) ? step : 'pair' };
}

/** The address of a step. Keeping the screen's id in it makes a reload resume, not start over. */
export function wizardPath(displayId: string | null, step: WizardStepId): string {
  if (displayId === null) return WIZARD_PATH;
  const params = new URLSearchParams({ [SCREEN_PARAM]: displayId, [STEP_PARAM]: step });
  return `${WIZARD_PATH}?${params.toString()}`;
}

/* ---------- Step indicator ---------- */

export interface WizardProgress {
  readonly step: WizardStepId;
  /** The name of the created screen, or null while it does not exist yet. */
  readonly screenName: string | null;
  /** A player holds a credential for the screen. */
  readonly paired: boolean;
  /** The name of the assigned playlist, or null. */
  readonly assignedPlaylistName: string | null;
  /** The details of an existing screen were edited and not saved yet. */
  readonly detailsDirty: boolean;
}

export interface WizardStepView {
  readonly id: WizardStepId;
  /** 1 to 3. */
  readonly number: number;
  readonly label: string;
  /** The second line: what the step is for, or what it resulted in. */
  readonly note: string;
  readonly current: boolean;
  readonly complete: boolean;
  /** The operator may jump to this step from the indicator. */
  readonly reachable: boolean;
  /** For assistive technology: "Step 2 of 3, completed". */
  readonly position: string;
}

const STEP_LABELS: { readonly [K in WizardStepId]: string } = {
  details: 'Details',
  pair: 'Pair',
  content: 'Content',
};

function stepNote(id: WizardStepId, progress: WizardProgress): string {
  switch (id) {
    case 'details':
      return progress.screenName ?? 'Name and canvas';
    case 'pair':
      if (progress.paired) return 'Player paired';
      return progress.step === 'content' ? 'Skipped for now' : 'Enter the player code';
    case 'content':
      return progress.assignedPlaylistName ?? 'Choose a playlist';
  }
}

function stepComplete(id: WizardStepId, progress: WizardProgress): boolean {
  switch (id) {
    case 'details':
      return progress.screenName !== null;
    case 'pair':
      return progress.paired;
    case 'content':
      return progress.assignedPlaylistName !== null;
  }
}

/**
 * The three steps as the indicator shows them. A step can be jumped to only once the screen
 * exists, and not while edits to its details are unsaved: those would be lost silently.
 */
export function wizardStepViews(progress: WizardProgress): readonly WizardStepView[] {
  const created = progress.screenName !== null;
  return WIZARD_STEPS.map((id, index) => {
    const current = id === progress.step;
    const complete = stepComplete(id, progress);
    const state = current ? 'current step' : complete ? 'completed' : 'not completed';
    return {
      id,
      number: index + 1,
      label: STEP_LABELS[id],
      note: stepNote(id, progress),
      current,
      complete,
      reachable: !current && created && !progress.detailsDirty,
      position: `Step ${index + 1} of ${WIZARD_STEPS.length}, ${state}`,
    };
  });
}

/* ---------- Details ---------- */

export interface CanvasPreset {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** The M0 presets. Any other size is typed into the width and height fields. */
export const CANVAS_PRESETS: readonly CanvasPreset[] = [
  { id: 'landscape', name: 'Landscape', width: 1920, height: 1080 },
  { id: 'portrait', name: 'Portrait', width: 1080, height: 1920 },
  { id: 'wide-strip', name: 'Wide strip', width: 3840, height: 480 },
  { id: 'tall-column', name: 'Tall column', width: 640, height: 1344 },
];

/** "1920 × 1080" with the multiplication sign, as the screen pages write a canvas. */
export function presetSizeLabel(preset: Pick<CanvasPreset, 'width' | 'height'>): string {
  return `${preset.width} × ${preset.height}`;
}

/** The preset whose size is typed into the form right now, or null for a custom size. */
export function matchingPreset(
  values: Pick<DisplayFormValues, 'width' | 'height'>,
): CanvasPreset | null {
  const width = values.width.trim();
  const height = values.height.trim();
  return (
    CANVAS_PRESETS.find(
      (preset) => String(preset.width) === width && String(preset.height) === height,
    ) ?? null
  );
}

/**
 * The box a preset's glyph is drawn in: the canvas scaled so its longer side is `side`
 * units, never thinner than two units, so a wide strip still reads as a shape.
 */
export function presetGlyph(
  preset: Pick<CanvasPreset, 'width' | 'height'>,
  side: number,
): { readonly width: number; readonly height: number } {
  const scale = side / Math.max(preset.width, preset.height);
  return {
    width: Math.max(2, Math.round(preset.width * scale)),
    height: Math.max(2, Math.round(preset.height * scale)),
  };
}

/**
 * Whether two form states would save the same screen. The text is compared as typed, apart
 * from surrounding spaces; the rectangle fields count only while the rectangle is in use.
 */
export function sameDisplayForm(a: DisplayFormValues, b: DisplayFormValues): boolean {
  const same = (x: string, y: string) => x.trim() === y.trim();
  if (!same(a.name, b.name) || a.siteId !== b.siteId || a.defaultFit !== b.defaultFit) return false;
  if (!same(a.width, b.width) || !same(a.height, b.height)) return false;
  if (a.useContentRect !== b.useContentRect) return false;
  if (!a.useContentRect) return true;
  return (
    same(a.rectX, b.rectX) &&
    same(a.rectY, b.rectY) &&
    same(a.rectWidth, b.rectWidth) &&
    same(a.rectHeight, b.rectHeight)
  );
}

/** The order of the fields on the page, for the error summary. */
const FIELD_ORDER: readonly DisplayFormField[] = [
  'name',
  'siteId',
  'width',
  'height',
  'rectX',
  'rectY',
  'rectWidth',
  'rectHeight',
  'contentRect',
  'defaultFit',
  'form',
];

export interface DisplayFormProblem {
  readonly field: DisplayFormField;
  readonly message: string;
}

/** The validation messages in the order of the form. */
export function displayFormProblems(errors: DisplayFormErrors): readonly DisplayFormProblem[] {
  const problems: DisplayFormProblem[] = [];
  for (const field of FIELD_ORDER) {
    const message = errors[field];
    if (message !== undefined) problems.push({ field, message });
  }
  return problems;
}

/** The M0 heading of the error summary. */
export function problemCountLabel(count: number): string {
  return count === 1 ? 'One field needs attention.' : `${count} fields need attention.`;
}

/** What the canvas drawing shows, for assistive technology: the drawing is the screen page's. */
export { canvasShapeDescription } from './screenDetailCanvas.ts';

/** The line under the canvas drawing: "1920 × 1080 px, content 800 × 600 at (0, 0)". */
export function canvasShapeCaption(shape: CanvasPreviewShape): string {
  const { canvas, contentRect } = shape;
  const size = `${canvas.width} × ${canvas.height} px`;
  if (contentRect === null) return size;
  return `${size}, content ${contentRect.width} × ${contentRect.height} at (${contentRect.x}, ${contentRect.y})`;
}

/* ---------- Pairing ---------- */

/** Letters and digits of a code, without the dash. */
const CODE_SYMBOLS = 8;
const CODE_GROUP = 4;

function codeSymbols(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface PairingCodeEdit {
  /** The text to show: upper case, at most eight symbols, a dash after the fourth. */
  readonly text: string;
  /** Where the caret belongs in `text`, so typing in the middle does not jump to the end. */
  readonly caret: number;
}

/**
 * Formats what was typed or pasted into the pairing code field as `ABCD-EFGH`. It only
 * tidies the look: symbols a code never contains (0, 1, I, L, O, U) are kept, so the
 * operator sees what they typed and the check on submit can say what is wrong with it.
 */
export function formatPairingCodeInput(raw: string, caret: number = raw.length): PairingCodeEdit {
  const symbols = codeSymbols(raw).slice(0, CODE_SYMBOLS);
  const before = Math.min(codeSymbols(raw.slice(0, Math.max(0, caret))).length, symbols.length);
  const text =
    symbols.length > CODE_GROUP
      ? `${symbols.slice(0, CODE_GROUP)}-${symbols.slice(CODE_GROUP)}`
      : symbols;
  return { text, caret: before > CODE_GROUP ? before + 1 : before };
}

/** The M0 message for a code that is not eight valid symbols. */
export const PAIRING_CODE_FORMAT_PROBLEM =
  'A pairing code has 8 letters or digits, for example ABCD-2345. It never contains 0, 1, I, L, O or U.';

/** How long a code lasts, in whole minutes, for the explanation. */
export function pairingCodeMinutes(ttlSeconds: number): number {
  return Math.max(1, Math.round(ttlSeconds / 60));
}

export function minutesLabel(minutes: number): string {
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * What to do about a refused pairing, by API error code (the M0 advice). Null when the
 * code needs no advice beyond the server's own message.
 */
export function pairingRefusalAdvice(errorCode: string, ttlMinutes: number): string | null {
  switch (errorCode) {
    case 'pairing_code_invalid':
    case 'not_found':
      return `The code was not accepted: it is mistyped, has expired (codes last ${minutesLabel(ttlMinutes)}) or was already used. Read the code currently on the player and try again.`;
    case 'pairing_expired':
      return 'That code has expired. The player shows a new code; enter that one.';
    case 'pairing_locked':
    case 'rate_limited':
      return 'Too many wrong codes were entered. Wait a few minutes before trying again.';
    default:
      return null;
  }
}

/**
 * The address of the browser player when the portal runs on a development machine
 * (prototype-m0.md, D17: the player is served on its own local port). Null anywhere else:
 * the portal is not told the player address of a hosted installation.
 */
export function localPlayerAddress(portalHostname: string): string | null {
  const host = portalHostname.toLowerCase();
  const local =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
  // The player, like the portal, is addressed as `localhost`: its storage and the signed
  // media addresses belong to that name, not to 127.0.0.1.
  return local ? `http://localhost:${DEV_PORTS.player}` : null;
}

/* ---------- Content ---------- */

/** From this many playlists up, the content step offers a search field. */
export const PLAYLIST_SEARCH_FROM = 7;

/**
 * What the primary button of the content step does: assign the chosen playlist when it
 * differs from the one the screen has, otherwise finish the wizard.
 */
export function contentStepAction(
  chosenId: string | null,
  assignedId: string | null,
): 'assign' | 'finish' {
  return chosenId !== null && chosenId !== assignedId ? 'assign' : 'finish';
}

/** The explanation under an assignment: assigning alone changes nothing on the screen. */
export const ASSIGNED_NOTE =
  'Nothing changes on the screen until you push. Push now, or later from the screen’s page or the Push to screens button.';

/** The second line of an empty playlist in the content step: it can be assigned, not pushed. */
export const EMPTY_PLAYLIST_META = 'No items · Cannot be pushed until it has items';

/**
 * The playlists of the content step in the order they are offered: those with items first
 * and empty ones last, each group in the order the API listed them.
 */
export function contentStepPlaylists<T extends Pick<PlaylistSummaryDto, 'itemCount'>>(
  playlists: readonly T[],
): T[] {
  return [
    ...playlists.filter((playlist) => playlist.itemCount > 0),
    ...playlists.filter((playlist) => playlist.itemCount === 0),
  ];
}

/** The second line of a playlist row in the content step. */
export function contentStepPlaylistMeta(
  playlist: Pick<PlaylistSummaryDto, 'id' | 'itemCount'>,
  summary: string,
  assignedId: string | null,
): string {
  const base = playlist.itemCount === 0 ? EMPTY_PLAYLIST_META : summary;
  return playlist.id === assignedId ? `${base} · Assigned` : base;
}

/**
 * Why the playlist just assigned cannot be pushed yet, or null when nothing is known to stop
 * a push. The push plan's own reason wins; until the plan has the screen, an empty playlist
 * is enough to know. The wizard then offers no "Push now" that would only end in Blocked.
 */
export function assignedPushBlock(
  row: Pick<PushPlanRow, 'state' | 'issues'> | null,
  assigned: Pick<PlaylistSummaryDto, 'itemCount'> | null,
): string | null {
  if (row?.state === 'blocked') {
    const first = row.issues[0];
    return `It cannot be pushed yet. ${first?.message ?? 'Fix the playlist, then push.'}`;
  }
  if (row === null && assigned?.itemCount === 0) {
    return 'It cannot be pushed yet. The playlist has no items: add some, then push.';
  }
  return null;
}

/* ---------- After creation ---------- */

/** Says that leaving the wizard loses nothing, and where the rest can be done. */
export function safeToLeaveNote(screenName: string): string {
  return `“${screenName}” is created and listed under Screens. You can leave now and finish pairing or content later from its page.`;
}
