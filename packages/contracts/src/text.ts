import { z } from 'zod';
import { ABSOLUTE } from './limits.ts';

/**
 * No control characters at all: C0, DEL and C1 (U+0080 to U+009F, which upload file names
 * also lose), plus the line and paragraph separators. Single-line text, rendered as text only.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose of this pattern
const SINGLE_LINE = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]*$/;
/** As above, except that a line feed is allowed. */
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose of this pattern
const MULTI_LINE = /^[^\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]*$/;
/**
 * No invisible text-direction controls: the marks (U+200E, U+200F, U+061C), the embeddings
 * and overrides (U+202A to U+202E) and the isolates (U+2066 to U+2069). With them a name such
 * as "report\u202Egpj.exe" is shown as "reportexe.jpg" in every list, picker, error detail
 * and audit entry, so one operator could disguise an object for another. Upload file names
 * lose the same characters (`displayNameFromUpload`). Zero-width joiners stay allowed: emoji
 * sequences and several scripts need them.
 */
const NO_DIRECTION_CONTROLS = /^[^\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]*$/;

/**
 * A required single-line label in a request body: trimmed, 1 to `max` characters,
 * no control or text-direction characters. `what` starts the validation messages ("tag name is required").
 */
export function labelSchema(max: number, what: string) {
  return z
    .string()
    .trim()
    .min(1, `${what} is required`)
    .max(max)
    .regex(SINGLE_LINE, `${what} must not contain control characters`)
    .regex(NO_DIRECTION_CONTROLS, `${what} must not contain text-direction characters`);
}

/**
 * An optional single-line label in a request body: trimmed, at most `max` characters,
 * no control or text-direction characters. Null clears the stored value, and so does an empty or
 * blank string (it parses to null), so a form can send its field as it is.
 */
export function clearableLabelSchema(max: number, what: string) {
  return z
    .string()
    .trim()
    .max(max)
    .regex(SINGLE_LINE, `${what} must not contain control characters`)
    .regex(NO_DIRECTION_CONTROLS, `${what} must not contain text-direction characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable();
}

const WELL_FORMED = /^(?:[^\ud800-\udfff]|[\ud800-\udbff][\udc00-\udfff])*$/;

/**
 * Operator text inside a built-in app's settings: trimmed, at most `max` characters, no control
 * or text-direction characters (line feeds only when `multiLine`). An empty optional text stays
 * `''`: settings values are strings and booleans only (see app.ts).
 */
export function appTextSchema(
  max: number,
  what: string,
  { required = false, multiLine = false }: { required?: boolean; multiLine?: boolean } = {},
) {
  const trimmed = z.string().trim();
  return (
    (required ? trimmed.min(1, `${what} is required`) : trimmed)
      .max(max)
      .regex(multiLine ? MULTI_LINE : SINGLE_LINE, `${what} must not contain control characters`)
      .regex(NO_DIRECTION_CONTROLS, `${what} must not contain text-direction characters`)
      // A lone surrogate cannot be encoded as UTF-8, so the QR encoder would throw on the screen.
      .regex(WELL_FORMED, `${what} contains a broken character`)
  );
}

/** Name of a display, a playlist or a media item as sent by a client. */
export const NameSchema = labelSchema(ABSOLUTE.maxNameLength, 'name');

/** A stored description as it appears in a response: never empty (absent is null). */
export const DescriptionSchema = z.string().min(1).max(ABSOLUTE.maxDescriptionLength);
export type Description = z.infer<typeof DescriptionSchema>;

/**
 * A description in a request body: trimmed, at most 500 characters, line feeds
 * allowed, no other control characters. Null clears it, and so does an empty or
 * blank string (it parses to null). Shown as text only.
 */
export const DescriptionInputSchema = z
  .string()
  .trim()
  .max(ABSOLUTE.maxDescriptionLength)
  .regex(MULTI_LINE, 'description must not contain control characters other than line feeds')
  .regex(NO_DIRECTION_CONTROLS, 'description must not contain text-direction characters')
  .transform((value) => (value === '' ? null : value))
  .nullable();
export type DescriptionInput = z.infer<typeof DescriptionInputSchema>;
