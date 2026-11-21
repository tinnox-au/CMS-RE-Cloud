import { useCallback, useState } from 'react';
import { rowFocusCandidates, type RowDeleteMode } from '../../lib/rowFocus.ts';

/**
 * What a delete dialog needs from its list page to put focus back on a neighbour once rows
 * have gone (ui/README.md, Dialog `returnFocus`). Read when the dialog opens.
 */
export interface RowFocusSource {
  /** `row` when the delete came from a row menu, `bulk` when from the selection bar. */
  readonly mode: RowDeleteMode;
  /** The ids of the rows or tiles on view, in the order shown. */
  readonly order: readonly string[];
  /** The row or tile that shows this id, if it is on the page. */
  readonly row: (id: string) => Element | null;
  /** The page's primary add or new button. */
  readonly primary: () => HTMLElement | null;
  /** The control in a row to focus, as a selector; the row's "Actions for …" button by default. */
  readonly button?: string;
}

interface Snapshot {
  readonly candidates: readonly string[];
  readonly source: RowFocusSource;
}

const ACTIONS_BUTTON = 'button[aria-label^="Actions for "]';
const SELECT_ALL = 'input[type="checkbox"][aria-label="Select all rows on this page"]';

/** A finder for `RowFocusSource.row` that looks rows and tiles up by their test id prefixes. */
export function rowByTestId(...prefixes: readonly string[]): (id: string) => Element | null {
  return (id) => {
    for (const prefix of prefixes) {
      const found = document.querySelector(`[data-testid="${CSS.escape(prefix + id)}"]`);
      if (found !== null) return found;
    }
    return null;
  };
}

/** A finder for `RowFocusSource.primary`: the first element with this test id. */
export function elementByTestId(testId: string): () => HTMLElement | null {
  return () => document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`);
}

function selectAllCheckbox(): HTMLElement | null {
  const box = document.querySelector<HTMLInputElement>(`#main ${SELECT_ALL}`);
  return box !== null && !box.disabled ? box : null;
}

function focusTarget(snapshot: Snapshot): HTMLElement | null {
  const { candidates, source } = snapshot;
  for (const id of candidates) {
    const button =
      source.row(id)?.querySelector<HTMLElement>(source.button ?? ACTIONS_BUTTON) ?? null;
    if (button?.isConnected === true) return button;
  }
  if (source.mode === 'bulk') return selectAllCheckbox() ?? source.primary();
  return source.primary();
}

/**
 * The `returnFocus` of a delete dialog: remembers the neighbouring rows when the dialog
 * opens, and on close names the "Actions for …" button (or `source.button`) of the row after
 * the deleted one, else the row before, else the page's primary button. After a bulk delete it names the
 * first remaining row's actions button, else the select-all checkbox. The dialog only asks
 * when the control that opened it has gone (`ui/focusReturn.ts`).
 */
export function useRowFocusReturn(
  open: boolean,
  deletedIds: readonly string[],
  source: RowFocusSource | undefined,
): (() => HTMLElement | null) | undefined {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSnapshot(
        source === undefined
          ? null
          : { candidates: rowFocusCandidates(source.order, deletedIds, source.mode), source },
      );
    }
  }
  const returnFocus = useCallback(
    () => (snapshot === null ? null : focusTarget(snapshot)),
    [snapshot],
  );
  return snapshot === null ? undefined : returnFocus;
}
