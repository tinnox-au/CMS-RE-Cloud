/**
 * Arithmetic for the Stepper control (durations, sizes). Pure functions, no DOM.
 * The control keeps its value as text, exactly as typed, so a half-typed or invalid
 * entry is never silently rewritten; these helpers only act on a step.
 */

export interface StepperBounds {
  readonly min: number;
  readonly max: number;
  /** Size of one step. Values are kept on the grid `min + n * step`. */
  readonly step: number;
}

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Reads a plain decimal number. Anything else, including an empty field, answers null. */
export function parseStepperValue(text: string): number | null {
  const trimmed = text.trim();
  if (!NUMBER.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function decimals(step: number): number {
  const text = String(step);
  const point = text.indexOf('.');
  return point === -1 ? 0 : text.length - point - 1;
}

/** Text for a stepped value, without floating-point dust ("0.3", not "0.30000000000000004"). */
export function formatStepperValue(value: number, step: number): string {
  return String(Number(value.toFixed(Math.min(6, decimals(step)))));
}

export function clampToBounds(value: number, bounds: StepperBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/**
 * The value after one press of plus (`direction` 1) or minus (-1).
 * - A value between two grid points moves to the next grid point in that direction.
 * - An empty or unreadable field starts at the minimum.
 * - `multiplier` gives Page Up and Page Down a larger stride.
 */
export function stepValue(
  text: string,
  direction: 1 | -1,
  bounds: StepperBounds,
  multiplier = 1,
): string {
  const step = bounds.step > 0 ? bounds.step : 1;
  const current = parseStepperValue(text);
  if (current === null) return formatStepperValue(bounds.min, step);
  const position = (current - bounds.min) / step;
  // A tolerance keeps 0.1 + 0.2 from counting as "between two grid points".
  const epsilon = 1e-9;
  const onGrid = Math.abs(position - Math.round(position)) < epsilon;
  const stride = Math.max(1, Math.floor(multiplier));
  let target: number;
  if (onGrid) target = Math.round(position) + direction * stride;
  else if (direction === 1) target = Math.ceil(position) + (stride - 1);
  else target = Math.floor(position) - (stride - 1);
  return formatStepperValue(clampToBounds(bounds.min + target * step, bounds), step);
}

/** Whether a press in that direction would change the value. Drives the buttons' disabled state. */
export function canStep(text: string, direction: 1 | -1, bounds: StepperBounds): boolean {
  const current = parseStepperValue(text);
  if (current === null) return true;
  return direction === 1 ? current < bounds.max : current > bounds.min;
}
