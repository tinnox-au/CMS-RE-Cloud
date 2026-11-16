/**
 * Row selection for list pages. Pure functions over an immutable set of row ids.
 * Every function returns a new set (or the same instance when nothing changed), so the
 * result can go straight into React state.
 */

export type SelectionSummary = 'none' | 'some' | 'all';

/** State of the "select all" checkbox for the given rows: `some` renders as mixed. */
export function summariseSelection(
  ids: readonly string[],
  selected: ReadonlySet<string>,
): SelectionSummary {
  if (ids.length === 0) return 'none';
  let count = 0;
  for (const id of ids) if (selected.has(id)) count += 1;
  if (count === 0) return 'none';
  return count === ids.length ? 'all' : 'some';
}

export function toggleOne(selected: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

export function setMany(
  selected: ReadonlySet<string>,
  ids: readonly string[],
  on: boolean,
): ReadonlySet<string> {
  const next = new Set(selected);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/**
 * The header checkbox: when every given row is selected it clears them, otherwise it
 * selects them all. Rows outside `ids` (other pages) keep their state.
 */
export function toggleAll(
  ids: readonly string[],
  selected: ReadonlySet<string>,
): ReadonlySet<string> {
  return setMany(selected, ids, summariseSelection(ids, selected) !== 'all');
}

/**
 * Shift-click: selects every row between the anchor and the target, in display order.
 * Falls back to selecting only the target when the anchor is not on screen.
 */
export function selectRange(
  orderedIds: readonly string[],
  selected: ReadonlySet<string>,
  anchorId: string | null,
  targetId: string,
): ReadonlySet<string> {
  const to = orderedIds.indexOf(targetId);
  if (to === -1) return selected;
  const from = anchorId === null ? -1 : orderedIds.indexOf(anchorId);
  if (from === -1) return setMany(selected, [targetId], true);
  return setMany(selected, orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1), true);
}

/**
 * Drops ids that no longer exist, for example after a delete or a refresh.
 * Returns the same set when nothing had to go, so it is safe to call in an effect.
 */
export function pruneSelection(
  selected: ReadonlySet<string>,
  existingIds: Iterable<string>,
): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const existing = new Set(existingIds);
  let changed = false;
  const next = new Set<string>();
  for (const id of selected) {
    if (existing.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : selected;
}

/** The selected rows, in the order of `rows`. */
export function selectedRows<T>(
  rows: readonly T[],
  selected: ReadonlySet<string>,
  rowId: (row: T) => string,
): T[] {
  return rows.filter((row) => selected.has(rowId(row)));
}
