import {
  DisplayCreateSchema,
  type DisplayCreate,
  type DisplayDto,
  type DisplayPatch,
  type FitMode,
  type Limits,
} from '@tinnox/contracts';

/** Raw form state: every numeric field is the text the operator typed. */
export interface DisplayFormValues {
  readonly name: string;
  readonly siteId: string;
  readonly width: string;
  readonly height: string;
  readonly useContentRect: boolean;
  readonly rectX: string;
  readonly rectY: string;
  readonly rectWidth: string;
  readonly rectHeight: string;
  readonly defaultFit: FitMode;
}

export type DisplayFormField =
  | 'name'
  | 'siteId'
  | 'width'
  | 'height'
  | 'rectX'
  | 'rectY'
  | 'rectWidth'
  | 'rectHeight'
  | 'contentRect'
  | 'defaultFit'
  | 'form';

export type DisplayFormErrors = Partial<Record<DisplayFormField, string>>;

export type DisplayFormResult =
  | { readonly ok: true; readonly value: DisplayCreate }
  | { readonly ok: false; readonly errors: DisplayFormErrors };

type CanvasLimits = Pick<Limits, 'minCanvasSidePx' | 'maxCanvasSidePx'>;

export const EMPTY_DISPLAY_FORM: DisplayFormValues = {
  name: '',
  siteId: '',
  width: '1920',
  height: '1080',
  useContentRect: false,
  rectX: '0',
  rectY: '0',
  rectWidth: '',
  rectHeight: '',
  defaultFit: 'contain',
};

export function displayFormFromDto(display: DisplayDto): DisplayFormValues {
  const rect = display.contentRect;
  return {
    name: display.name,
    siteId: display.siteId,
    width: String(display.canvas.width),
    height: String(display.canvas.height),
    useContentRect: rect !== null,
    rectX: rect === null ? '0' : String(rect.x),
    rectY: rect === null ? '0' : String(rect.y),
    rectWidth: rect === null ? '' : String(rect.width),
    rectHeight: rect === null ? '' : String(rect.height),
    defaultFit: display.defaultFit,
  };
}

/** Whole pixels only: no sign, decimals, exponent or units. Null when the text is not that. */
export function parsePixels(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[0-9]{1,6}$/.test(trimmed)) return null;
  return Number(trimmed);
}

function sideError(text: string, limits: CanvasLimits, label: string): string | null {
  const value = parsePixels(text);
  if (value === null) return `${label} must be a whole number of pixels.`;
  if (value < limits.minCanvasSidePx || value > limits.maxCanvasSidePx) {
    return `${label} must be between ${limits.minCanvasSidePx} and ${limits.maxCanvasSidePx} px.`;
  }
  return null;
}

function offsetError(text: string, label: string): string | null {
  return parsePixels(text) === null
    ? `${label} must be a whole number of pixels, 0 or more.`
    : null;
}

const FIELD_BY_PATH: Readonly<Record<string, DisplayFormField>> = {
  name: 'name',
  siteId: 'siteId',
  'canvas.width': 'width',
  'canvas.height': 'height',
  'contentRect.x': 'rectX',
  'contentRect.y': 'rectY',
  'contentRect.width': 'rectWidth',
  'contentRect.height': 'rectHeight',
  contentRect: 'contentRect',
  defaultFit: 'defaultFit',
};

/**
 * Checks the form the same way the API will: first the configured limits from the
 * session, then the shared `DisplayCreateSchema` (which includes the bounds check
 * of the content rectangle). The API remains the authority; this only saves a round trip.
 */
export function validateDisplayForm(
  values: DisplayFormValues,
  limits: CanvasLimits,
): DisplayFormResult {
  const errors: DisplayFormErrors = {};
  if (values.name.trim() === '') errors.name = 'Enter a name.';
  if (values.siteId === '') errors.siteId = 'Choose a site.';

  const widthError = sideError(values.width, limits, 'Width');
  if (widthError !== null) errors.width = widthError;
  const heightError = sideError(values.height, limits, 'Height');
  if (heightError !== null) errors.height = heightError;

  if (values.useContentRect) {
    const xError = offsetError(values.rectX, 'Left offset');
    if (xError !== null) errors.rectX = xError;
    const yError = offsetError(values.rectY, 'Top offset');
    if (yError !== null) errors.rectY = yError;
    const rectWidthError = sideError(values.rectWidth, limits, 'Content width');
    if (rectWidthError !== null) errors.rectWidth = rectWidthError;
    const rectHeightError = sideError(values.rectHeight, limits, 'Content height');
    if (rectHeightError !== null) errors.rectHeight = rectHeightError;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const candidate = {
    siteId: values.siteId,
    name: values.name,
    canvas: { width: parsePixels(values.width), height: parsePixels(values.height) },
    contentRect: values.useContentRect
      ? {
          x: parsePixels(values.rectX),
          y: parsePixels(values.rectY),
          width: parsePixels(values.rectWidth),
          height: parsePixels(values.rectHeight),
        }
      : null,
    defaultFit: values.defaultFit,
  };
  const parsed = DisplayCreateSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, value: parsed.data };

  for (const issue of parsed.error.issues) {
    const field = FIELD_BY_PATH[issue.path.map(String).join('.')] ?? 'form';
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Body of `PATCH /api/displays/:id`. The site of a display cannot be changed in M0. */
export function toDisplayPatch(value: DisplayCreate): DisplayPatch {
  return {
    name: value.name,
    canvas: value.canvas,
    contentRect: value.contentRect,
    defaultFit: value.defaultFit,
  };
}

export interface CanvasPreviewShape {
  readonly canvas: { readonly width: number; readonly height: number };
  readonly contentRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
  /** True when the content rectangle was typed but does not fit inside the canvas. */
  readonly contentRectOutOfBounds: boolean;
}

/** Best-effort shape for the live preview while the operator is still typing. Null when unusable. */
export function previewShape(values: DisplayFormValues): CanvasPreviewShape | null {
  const width = parsePixels(values.width);
  const height = parsePixels(values.height);
  if (width === null || height === null || width < 1 || height < 1) return null;
  if (!values.useContentRect) {
    return { canvas: { width, height }, contentRect: null, contentRectOutOfBounds: false };
  }
  const x = parsePixels(values.rectX);
  const y = parsePixels(values.rectY);
  const rectWidth = parsePixels(values.rectWidth);
  const rectHeight = parsePixels(values.rectHeight);
  if (x === null || y === null || rectWidth === null || rectHeight === null) {
    return { canvas: { width, height }, contentRect: null, contentRectOutOfBounds: false };
  }
  if (rectWidth < 1 || rectHeight < 1) {
    return { canvas: { width, height }, contentRect: null, contentRectOutOfBounds: false };
  }
  const outOfBounds = x + rectWidth > width || y + rectHeight > height;
  return {
    canvas: { width, height },
    contentRect: outOfBounds ? null : { x, y, width: rectWidth, height: rectHeight },
    contentRectOutOfBounds: outOfBounds,
  };
}
