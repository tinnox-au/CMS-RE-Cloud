import type { DisplayCreate, DisplayDto, DisplayPatch, FitMode, Rotation } from '@tinnox/contracts';
import {
  displayFormFromDto,
  type CanvasPreviewShape,
  type DisplayFormErrors,
  type DisplayFormField,
  type DisplayFormValues,
} from './displayForm.ts';

/**
 * Pure logic of the Canvas tab of the screen details page and of the canvas-shaped frames
 * drawn on it. The form itself (its values, validation and messages) is the M0 form of
 * `displayForm.ts`; this module adds what the tab needs around it. No DOM.
 */

export interface CanvasPreset {
  readonly label: string;
  readonly width: string;
  readonly height: string;
}

/** The M0 presets. */
export const CANVAS_PRESETS: readonly CanvasPreset[] = [
  { label: 'Landscape 1920 × 1080', width: '1920', height: '1080' },
  { label: 'Portrait 1080 × 1920', width: '1080', height: '1920' },
  { label: 'Wide strip 3840 × 480', width: '3840', height: '480' },
  { label: 'Tall column 640 × 1344', width: '640', height: '1344' },
];

const SHAPE_FIELDS = ['width', 'height', 'useContentRect', 'defaultFit'] as const;
const RECT_FIELDS = ['rectX', 'rectY', 'rectWidth', 'rectHeight'] as const;

/**
 * True when the canvas part of the form or the rotation differs from what is stored. The
 * name and the site are not part of the Canvas tab. The four rectangle fields count only
 * while the rectangle is switched on: what was typed into them before it was switched off
 * is not a change.
 */
export function canvasFormDirty(
  values: DisplayFormValues,
  display: DisplayDto,
  rotation: Rotation,
): boolean {
  if (rotation !== display.rotation) return true;
  const stored = displayFormFromDto(display);
  if (SHAPE_FIELDS.some((field) => values[field] !== stored[field])) return true;
  return values.useContentRect && RECT_FIELDS.some((field) => values[field] !== stored[field]);
}

/**
 * The form values to validate: the canvas fields as typed, with the name and the site as
 * they are stored, because `validateDisplayForm` checks the whole screen.
 */
export function canvasFormForValidation(
  values: DisplayFormValues,
  display: Pick<DisplayDto, 'name' | 'siteId'>,
): DisplayFormValues {
  return { ...values, name: display.name, siteId: display.siteId };
}

/** Body of `PATCH /api/displays/:id` for the Canvas tab: the canvas fields and the rotation. */
export function toCanvasPatch(value: DisplayCreate, rotation: Rotation): DisplayPatch {
  return {
    canvas: value.canvas,
    contentRect: value.contentRect,
    defaultFit: value.defaultFit,
    rotation,
  };
}

/** The options of the "Rotation" select, clockwise as the player turns the picture. */
export const ROTATION_LABELS: Readonly<Record<Rotation, string>> = {
  0: 'None',
  90: '90° clockwise',
  180: 'Upside down (180°)',
  270: '90° counter-clockwise',
};

/** The fields of the Canvas tab in reading order, with the labels they carry on the page. */
const CANVAS_FIELD_LABELS: readonly (readonly [DisplayFormField, string])[] = [
  ['width', 'Width (px)'],
  ['height', 'Height (px)'],
  ['rectX', 'Left offset (px)'],
  ['rectY', 'Top offset (px)'],
  ['rectWidth', 'Content width (px)'],
  ['rectHeight', 'Content height (px)'],
  ['contentRect', 'Content rectangle'],
  ['defaultFit', 'Default fit'],
  // Not fields of this tab; listed so that no message of the validator can go unseen.
  ['name', 'Name'],
  ['siteId', 'Site'],
  ['form', 'Screen'],
];

export interface CanvasErrorItem {
  readonly field: DisplayFormField;
  readonly label: string;
  readonly message: string;
}

/** The validation messages in reading order, for the summary at the top of the form. */
export function canvasErrorItems(errors: DisplayFormErrors): readonly CanvasErrorItem[] {
  const items: CanvasErrorItem[] = [];
  for (const [field, label] of CANVAS_FIELD_LABELS) {
    const message = errors[field];
    if (message !== undefined) items.push({ field, label, message });
  }
  return items;
}

/** The M0 summary line. */
export function attentionTitle(errorCount: number): string {
  return errorCount === 1 ? 'One field needs attention.' : `${errorCount} fields need attention.`;
}

/** "1920 × 1080 px". */
export function canvasSizeLabel(canvas: {
  readonly width: number;
  readonly height: number;
}): string {
  return `${canvas.width} × ${canvas.height} px`;
}

/** "Whole canvas", or "1000 × 400 px at (20, 40)". */
export function contentRectLabel(rect: DisplayDto['contentRect']): string {
  return rect === null
    ? 'Whole canvas'
    : `${rect.width} × ${rect.height} px at (${rect.x}, ${rect.y})`;
}

export function shapeOfDisplay(
  display: Pick<DisplayDto, 'canvas' | 'contentRect'>,
): CanvasPreviewShape {
  return {
    canvas: display.canvas,
    contentRect: display.contentRect,
    contentRectOutOfBounds: false,
  };
}

/** What a canvas-shaped frame says to assistive technology (the M0 wording). */
export function canvasShapeDescription(shape: CanvasPreviewShape): string {
  const { canvas, contentRect } = shape;
  return contentRect === null
    ? `Canvas ${canvas.width} by ${canvas.height} pixels. Content fills the whole canvas.`
    : `Canvas ${canvas.width} by ${canvas.height} pixels with a content rectangle of ${contentRect.width} by ${contentRect.height} pixels at ${contentRect.x}, ${contentRect.y}.`;
}

/** The line under a canvas-shaped frame. */
export function canvasShapeCaption(shape: CanvasPreviewShape): string {
  const { canvas, contentRect } = shape;
  const parts = [canvasSizeLabel(canvas)];
  if (contentRect !== null) {
    parts.push(
      `content ${contentRect.width} × ${contentRect.height} at (${contentRect.x}, ${contentRect.y})`,
    );
  }
  return parts.join(', ');
}

/**
 * The options of the "Default fit" select, short enough never to be cut off; what the chosen
 * fit does is said in the field's hint (`defaultFitHint`). The labels match the playlist
 * editor's fit menu.
 */
export const DEFAULT_FIT_OPTION_LABELS: Readonly<Record<FitMode, string>> = {
  contain: 'Contain',
  cover: 'Cover',
};

const FIT_EXPLANATIONS: Readonly<Record<FitMode, string>> = {
  contain: 'Contain shows the whole item, with black bars where the shape differs.',
  cover: 'Cover fills the area, cropping the item equally on both sides.',
};

/** The hint under "Default fit": what the chosen fit does, then when it applies. */
export function defaultFitHint(fit: FitMode): string {
  return `${FIT_EXPLANATIONS[fit]} Used for playlist items that do not choose their own fit.`;
}

export const CONTENT_RECT_OUT_OF_BOUNDS = 'The content rectangle does not fit inside the canvas.';

export interface FrameGeometry {
  /** Width divided by height of the canvas. */
  readonly ratio: number;
  /** Where content is drawn, in per cent of the canvas; the whole canvas without a rectangle. */
  readonly content: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  /** True when a content rectangle limits the content to part of the canvas. */
  readonly limited: boolean;
}

function percent(part: number, whole: number): number {
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

/**
 * The geometry of a canvas-shaped frame, as numbers a stylesheet can use. A rectangle that
 * reaches outside the canvas is cut at the edge; nothing is ever drawn outside the frame.
 */
export function frameGeometry(shape: CanvasPreviewShape): FrameGeometry {
  const { canvas, contentRect } = shape;
  const ratio = canvas.width / canvas.height;
  if (contentRect === null) {
    return { ratio, content: { left: 0, top: 0, width: 100, height: 100 }, limited: false };
  }
  const left = percent(contentRect.x, canvas.width);
  const top = percent(contentRect.y, canvas.height);
  return {
    ratio,
    content: {
      left,
      top,
      width: Math.min(100 - left, percent(contentRect.width, canvas.width)),
      height: Math.min(100 - top, percent(contentRect.height, canvas.height)),
    },
    limited: true,
  };
}
