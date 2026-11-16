/**
 * Keyboard movement inside composite widgets (menus, tab lists). Pure functions, no DOM:
 * the components translate a key press into an index and then move focus themselves.
 */

export type NavAction = 'next' | 'previous' | 'first' | 'last';

export type NavOrientation = 'vertical' | 'horizontal';

/** Maps `KeyboardEvent.key` to a movement, or null when the key is not a navigation key. */
export function navActionForKey(key: string, orientation: NavOrientation): NavAction | null {
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  if (orientation === 'vertical') {
    if (key === 'ArrowDown') return 'next';
    if (key === 'ArrowUp') return 'previous';
    return null;
  }
  if (key === 'ArrowRight') return 'next';
  if (key === 'ArrowLeft') return 'previous';
  return null;
}

/**
 * The index focus should move to. Movement wraps around the ends and steps over items
 * that `isDisabled` rejects. `current` may be -1 (nothing focused yet). Returns -1 when
 * there is no item to land on.
 */
export function moveIndex(
  current: number,
  count: number,
  action: NavAction,
  isDisabled: (index: number) => boolean = () => false,
): number {
  if (count <= 0) return -1;
  const step = action === 'next' || action === 'first' ? 1 : -1;
  let index: number;
  if (action === 'first') index = 0;
  else if (action === 'last') index = count - 1;
  else if (current < 0 || current >= count) index = step === 1 ? 0 : count - 1;
  else index = (current + step + count) % count;
  for (let tried = 0; tried < count; tried += 1) {
    if (!isDisabled(index)) return index;
    index = (index + step + count) % count;
  }
  return -1;
}

function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Type-ahead in a menu. `query` is what was typed within the type-ahead window.
 * - One letter, or the same letter repeated, cycles through the items that start with it,
 *   beginning after the current item.
 * - Several different letters match the start of a label, beginning at the current item.
 * Returns the index of the match, or -1.
 */
export function typeaheadMatch(
  labels: readonly string[],
  query: string,
  current: number,
  isDisabled: (index: number) => boolean = () => false,
): number {
  const typed = fold(query);
  if (typed === '' || labels.length === 0) return -1;
  const letters = Array.from(typed);
  const repeated = letters.every((letter) => letter === letters[0]);
  const needle = repeated ? (letters[0] ?? '') : typed;
  const start = repeated ? current + 1 : Math.max(0, current);
  for (let offset = 0; offset < labels.length; offset += 1) {
    const index = (((start + offset) % labels.length) + labels.length) % labels.length;
    const label = labels[index];
    if (label !== undefined && !isDisabled(index) && fold(label).startsWith(needle)) return index;
  }
  return -1;
}

/** True for a key press that should feed type-ahead: one printable character, no modifier. */
export function isTypeaheadKey(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return Array.from(event.key).length === 1 && event.key !== ' ';
}
