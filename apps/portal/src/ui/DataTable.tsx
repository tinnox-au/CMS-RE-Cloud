import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link } from 'react-router-dom';
import { nextSort, type SortState } from '../lib/listView.ts';
import { selectRange, summariseSelection, toggleAll, toggleOne } from '../lib/selection.ts';
import { Checkbox } from './Checkbox.tsx';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { ArrowDown, ArrowUp, ChevronsUpDown } from './icons.ts';
import { Skeleton } from './Skeleton.tsx';

export interface DataTableColumn<T> {
  readonly id: string;
  /** Header text. */
  readonly header: string;
  /** Keeps the header for assistive technology only. */
  readonly headerHidden?: boolean;
  readonly cell: (row: T) => ReactNode;
  /**
   * Makes the header a sort button. The table only reports the request through
   * `onSortChange`; the page sorts the rows (lib/listView.ts).
   */
  readonly sortable?: boolean;
  readonly align?: 'start' | 'center' | 'end';
  /** Tabular digits on one line: sizes, counts, durations, dates. */
  readonly numeric?: boolean;
  readonly nowrap?: boolean;
  /** Takes the spare width and shortens its text. Give it to the name column. */
  readonly grow?: boolean;
  /**
   * A CSS width for the column, for example "160px". It is also the least the column gets,
   * which keeps wrapping content (a row of tag chips) from being squeezed by the `grow` column.
   */
  readonly width?: string;
  /**
   * How long the column survives when the table runs out of width. 1 (default) always shows.
   * When the columns no longer fit, every column of priority 4 leaves first, then 3, then 2;
   * they come back as soon as there is room. Only then does the table scroll sideways.
   */
  readonly priority?: 1 | 2 | 3 | 4;
}

export interface DataTableSelection<T> {
  readonly selected: ReadonlySet<string>;
  readonly onChange: (selected: ReadonlySet<string>) => void;
  /** Names a row for its checkbox: "Foyer loop" gives "Select Foyer loop". */
  readonly rowLabel: (row: T) => string;
  /** Rows that cannot be selected get no checkbox. Default: every row can. */
  readonly isSelectable?: (row: T) => boolean;
}

export interface DataTableProps<T> {
  /** Names the table for assistive technology: "Media", "Screens". */
  readonly caption: string;
  readonly columns: readonly DataTableColumn<T>[];
  /** The rows to show, already filtered, sorted and paged. */
  readonly rows: readonly T[];
  readonly rowId: (row: T) => string;
  readonly sort?: SortState | null;
  readonly onSortChange?: (sort: SortState) => void;
  /** Adds the checkbox column with a "select all" box that shows the mixed state. */
  readonly selection?: DataTableSelection<T>;
  /** Content of the last column, usually a Menu behind a three-dot IconButton. */
  readonly rowActions?: (row: T) => ReactNode;
  /** Shows skeleton rows while there are no rows yet; with rows it only marks the table busy. */
  readonly loading?: boolean;
  readonly loadingRows?: number;
  /** Shown instead of rows when there are none: an EmptyState with `variant="inline"`. */
  readonly empty?: ReactNode;
  /** Sits under the rows inside the same surface: the Pagination. */
  readonly footer?: ReactNode;
  /** 64 px rows (default) or 48 px. */
  readonly density?: 'default' | 'compact';
  /** `data-testid` for each body row. */
  readonly rowTestId?: (row: T) => string;
  readonly className?: string;
}

const SKELETON_WIDTHS = ['62%', '44%', '70%', '36%', '54%'] as const;

/** How many priority steps can be dropped: 1 hides priority 4, 2 also 3, 3 also 2. */
const MAX_DROP = 3;

/**
 * Fits the columns to the width there is. While the table is wider than its scroller, the
 * lowest priority step still showing is dropped (`data-drop` on the table; the rules are in
 * styles/table.css), and a step returns as soon as the table fits with it. `scrolls` is true
 * when even the columns that always stay do not fit, so the scroller scrolls sideways.
 *
 * The fit is measured, not guessed from breakpoints, because what fits depends on the
 * content: the same columns need more room with long dates or four tags in a cell.
 * `data-drop` is written straight to the element: React does not render that attribute, and
 * a fit must finish before the browser paints, with no frame showing the wrong columns.
 */
function useColumnFit(): {
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly tableRef: RefObject<HTMLTableElement | null>;
  readonly scrolls: boolean;
} {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [scrolls, setScrolls] = useState(false);

  const fit = useCallback(() => {
    const scroller = scrollRef.current;
    const table = tableRef.current;
    if (scroller === null || table === null) return;
    const overflows = (): boolean => scroller.scrollWidth > scroller.clientWidth + 1;
    const apply = (level: number): void => {
      if (level === 0) delete table.dataset.drop;
      else table.dataset.drop = String(level);
    };
    let level = Math.min(MAX_DROP, Math.max(0, Number(table.dataset.drop ?? 0) || 0));
    while (level < MAX_DROP && overflows()) {
      level += 1;
      apply(level);
    }
    while (level > 0) {
      apply(level - 1);
      if (overflows()) {
        apply(level);
        break;
      }
      level -= 1;
    }
    setScrolls(overflows());
  }, []);

  // After every render: new rows or columns may change what fits.
  useLayoutEffect(fit);

  // And when the width changes without a render: the window, the sidebar, a late font.
  useEffect(() => {
    const scroller = scrollRef.current;
    const table = tableRef.current;
    if (scroller === null || table === null || typeof ResizeObserver !== 'function') return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      // Not inside the observer's own delivery: a fit resizes the table it observes.
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        fit();
      });
    });
    observer.observe(scroller);
    observer.observe(table);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fit]);

  return { scrollRef, tableRef, scrolls };
}

/**
 * The list of a list page: one surface, hairline-separated rows, typed columns.
 *
 * - Sortable headers are buttons; the sorted column carries `aria-sort`.
 * - With `selection`, each row has a checkbox and the header box selects the page, showing
 *   the mixed state when only some rows are ticked. Shift-click selects a range.
 * - When the columns do not fit, they leave by `priority` before the table scrolls sideways;
 *   when it does scroll, the scrolling area becomes focusable so arrow keys can pan it.
 * - Every control inside is a native button, link or checkbox, in reading order.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowId,
  sort = null,
  onSortChange,
  selection,
  rowActions,
  loading = false,
  loadingRows = 5,
  empty,
  footer,
  density = 'default',
  rowTestId,
  className,
}: DataTableProps<T>) {
  const captionId = useId();
  const { scrollRef, tableRef, scrolls } = useColumnFit();
  const lastToggled = useRef<string | null>(null);

  const columnCount =
    columns.length + (selection === undefined ? 0 : 1) + (rowActions === undefined ? 0 : 1);
  const showSkeleton = loading && rows.length === 0;
  const showEmpty = !loading && rows.length === 0;

  const selectableIds =
    selection === undefined
      ? []
      : rows.filter((row) => selection.isSelectable?.(row) ?? true).map(rowId);
  const summary =
    selection === undefined ? 'none' : summariseSelection(selectableIds, selection.selected);

  const cellClass = (column: DataTableColumn<T>): string =>
    cx(
      column.align === 'end' && 'tx-table__cell--end',
      column.align === 'center' && 'tx-table__cell--center',
      column.numeric === true && 'tx-table__cell--numeric',
      column.nowrap === true && 'tx-table__cell--nowrap',
      column.grow === true && 'tx-table__cell--grow',
    );

  const priorityOf = (column: DataTableColumn<T>): number | undefined =>
    column.priority === undefined || column.priority === 1 ? undefined : column.priority;

  return (
    <div className={cx('tx-table-card', className)}>
      <div
        ref={scrollRef}
        className="tx-table-scroll"
        {...(scrolls ? { tabIndex: 0, role: 'region', 'aria-labelledby': captionId } : {})}
      >
        <table
          ref={tableRef}
          className={cx('tx-table', density === 'compact' && 'tx-table--compact')}
          aria-busy={loading || undefined}
        >
          <caption id={captionId} className="tx-visually-hidden">
            {caption}
          </caption>
          <thead>
            <tr>
              {selection !== undefined && (
                <th scope="col" className="tx-table__cell--select">
                  <Checkbox
                    checked={summary === 'all'}
                    mixed={summary === 'some'}
                    disabled={selectableIds.length === 0}
                    aria-label="Select all rows on this page"
                    onChange={() => {
                      selection.onChange(toggleAll(selectableIds, selection.selected));
                    }}
                  />
                </th>
              )}
              {columns.map((column) => {
                const sorted = sort !== null && sort.columnId === column.id ? sort.direction : null;
                const canSort = column.sortable === true && onSortChange !== undefined;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    className={cellClass(column) || undefined}
                    data-priority={priorityOf(column)}
                    aria-sort={
                      sorted === null ? undefined : sorted === 'asc' ? 'ascending' : 'descending'
                    }
                    style={
                      column.width === undefined
                        ? undefined
                        : { width: column.width, minWidth: column.width }
                    }
                  >
                    {canSort ? (
                      <button
                        type="button"
                        className="tx-table__sort"
                        onClick={() => {
                          onSortChange(nextSort(sort, column.id));
                        }}
                      >
                        {column.header}
                        <Icon
                          icon={
                            sorted === null
                              ? ChevronsUpDown
                              : sorted === 'asc'
                                ? ArrowUp
                                : ArrowDown
                          }
                          size={14}
                          className="tx-table__sort-icon"
                        />
                      </button>
                    ) : column.headerHidden === true ? (
                      <span className="tx-visually-hidden">{column.header}</span>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
              {rowActions !== undefined && (
                <th scope="col" className="tx-table__cell--actions">
                  <span className="tx-visually-hidden">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {showSkeleton &&
              Array.from({ length: loadingRows }, (_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`} aria-hidden="true">
                  {selection !== undefined && <td className="tx-table__cell--select" />}
                  {columns.map((column, columnIndex) => (
                    <td
                      key={column.id}
                      className={cellClass(column) || undefined}
                      data-priority={priorityOf(column)}
                    >
                      <Skeleton
                        width={SKELETON_WIDTHS[(rowIndex + columnIndex) % SKELETON_WIDTHS.length]}
                      />
                    </td>
                  ))}
                  {rowActions !== undefined && <td className="tx-table__cell--actions" />}
                </tr>
              ))}
            {showEmpty && empty !== undefined && (
              <tr>
                <td className="tx-table__empty" colSpan={columnCount}>
                  {empty}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const id = rowId(row);
              const selected = selection?.selected.has(id) ?? false;
              const selectable = selection?.isSelectable?.(row) ?? true;
              return (
                <tr
                  key={id}
                  data-row=""
                  data-selected={selected ? '' : undefined}
                  data-testid={rowTestId?.(row)}
                >
                  {selection !== undefined && (
                    <td className="tx-table__cell--select">
                      {selectable && (
                        <Checkbox
                          checked={selected}
                          aria-label={`Select ${selection.rowLabel(row)}`}
                          onChange={(_checked, event) => {
                            const native: Event = event.nativeEvent;
                            const range = 'shiftKey' in native && native.shiftKey === true;
                            selection.onChange(
                              range
                                ? selectRange(
                                    selectableIds,
                                    selection.selected,
                                    lastToggled.current,
                                    id,
                                  )
                                : toggleOne(selection.selected, id),
                            );
                            lastToggled.current = id;
                          }}
                        />
                      )}
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cellClass(column) || undefined}
                      data-priority={priorityOf(column)}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                  {rowActions !== undefined && (
                    <td className="tx-table__cell--actions">{rowActions(row)}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {showSkeleton && (
          <span className="tx-visually-hidden" role="status">
            Loading {caption}
          </span>
        )}
      </div>
      {footer !== undefined && <div className="tx-table__footer">{footer}</div>}
    </div>
  );
}

export interface NameCellProps {
  /** The object's name: the row's link when `to` is set. */
  readonly name: string;
  /** In-app route of the object. */
  readonly to?: string;
  /** A Thumb with `size="sm"`, or another 44 px lead element. */
  readonly media?: ReactNode;
  /** A second, quieter line: a description, a file name, a site. */
  readonly meta?: ReactNode;
}

/** The first data cell of a row: thumbnail, the name as the row's link, an optional second line. */
export function NameCell({ name, to, media, meta }: NameCellProps) {
  return (
    <div className="tx-namecell">
      {media}
      <div className="tx-namecell__text">
        {to === undefined ? (
          <span className="tx-namecell__name" title={name}>
            {name}
          </span>
        ) : (
          <Link className="tx-namecell__name" to={to} title={name}>
            {name}
          </Link>
        )}
        {meta !== undefined && (
          // A plain-text second line (a description) is cut short too; give it the same `title`.
          <span className="tx-namecell__meta" title={typeof meta === 'string' ? meta : undefined}>
            {meta}
          </span>
        )}
      </div>
    </div>
  );
}
