/** Pure rules for the accessible name of a tab. No DOM. */

/**
 * True when a disabled tab's reason already starts with its note, as in the note "Planned"
 * and the reason "Planned for stage B". The tab's name then leaves the note out, so a
 * screen reader says "Working hours. Planned for stage B" rather than "Working hours,
 * Planned. Planned for stage B". The note is still drawn. Case is ignored; the note must
 * end at a word boundary ("Plan" does not repeat "Planned").
 */
export function reasonRepeatsNote(note: string | undefined, reason: string | undefined): boolean {
  if (note === undefined || reason === undefined) return false;
  const start = note.trim().toLocaleLowerCase('en-AU');
  const text = reason.trim().toLocaleLowerCase('en-AU');
  if (start === '' || !text.startsWith(start)) return false;
  const next = text.charAt(start.length);
  return next === '' || !/[\p{L}\p{N}]/u.test(next);
}
