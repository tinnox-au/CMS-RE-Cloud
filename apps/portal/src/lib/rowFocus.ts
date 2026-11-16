/**
 * Where focus goes after rows have been deleted from a list (WCAG 2.4.3). The control that
 * opened the delete dialog (a row's "Actions" button, the selection bar) has usually gone
 * by then, so the dialog hands focus to a neighbour instead. Pure functions, no DOM: the
 * page reads the row order when the dialog opens, and `features/shared/useRowFocusReturn.ts`
 * looks the candidates up on the page when the dialog closes.
 */

/**
 * `row`: one item was deleted from its row menu. `bulk`: the ticked items were deleted from
 * the selection bar.
 */
export type RowDeleteMode = 'row' | 'bulk';

/**
 * The row ids to try, best first, once `deleted` have left a list shown as `order`.
 *
 * - `row`: the rows after the deleted one, nearest first, then the rows before it, nearest
 *   first. If the deleted row is not in `order`, the remaining rows from the top.
 * - `bulk`: the remaining rows from the top.
 *
 * The deleted ids never appear. An empty answer means the page's own fallback applies: the
 * primary add or new button for `row`, the select-all checkbox for `bulk`.
 */
export function rowFocusCandidates(
  order: readonly string[],
  deleted: readonly string[],
  mode: RowDeleteMode,
): string[] {
  const gone = new Set(deleted);
  const remaining = order.filter((id) => !gone.has(id));
  const target = deleted.length === 1 ? deleted[0] : undefined;
  if (mode === 'bulk' || target === undefined) return remaining;
  const index = order.indexOf(target);
  if (index === -1) return remaining;
  const after = order.slice(index + 1).filter((id) => !gone.has(id));
  const before = order
    .slice(0, index)
    .filter((id) => !gone.has(id))
    .reverse();
  return [...after, ...before];
}
