import { useId } from 'react';
import { PAGE_SIZE_OPTIONS, rangeLabel, type PageInfo } from '../lib/listView.ts';
import { cx } from './cx.ts';
import { IconButton } from './IconButton.tsx';
import { ChevronLeft, ChevronRight } from './icons.ts';
import { Select } from './Select.tsx';

export interface PaginationProps {
  /** From `pageInfo` or `applyListView` in lib/listView.ts. */
  readonly info: PageInfo;
  readonly onPageChange: (page: number) => void;
  /** Omit to hide the per-page select. */
  readonly onPageSizeChange?: (pageSize: number) => void;
  readonly pageSizeOptions?: readonly number[];
  /** Accessible name of the navigation, when a page has more than one. */
  readonly label?: string;
  readonly className?: string;
}

/** "1 to 10 of 42", a per-page select, and previous and next buttons. */
export function Pagination({
  info,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  label = 'Pagination',
  className,
}: PaginationProps) {
  const sizeId = useId();
  return (
    <nav className={cx('tx-pagination', className)} aria-label={label}>
      {onPageSizeChange !== undefined && (
        <span className="tx-pagination__size">
          <label htmlFor={sizeId}>Per page</label>
          <Select
            id={sizeId}
            size="sm"
            value={String(info.pageSize)}
            onChange={(event) => {
              onPageSizeChange(Number(event.target.value));
            }}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </span>
      )}
      <span className="tx-pagination__range" aria-live="polite">
        {rangeLabel(info)}
      </span>
      <span className="tx-pagination__buttons">
        <IconButton
          icon={ChevronLeft}
          label="Previous page"
          size="sm"
          // Not `disabled`: reaching the first page must not throw keyboard focus away.
          aria-disabled={!info.hasPrevious || undefined}
          onClick={() => {
            onPageChange(info.page - 1);
          }}
        />
        <IconButton
          icon={ChevronRight}
          label="Next page"
          size="sm"
          aria-disabled={!info.hasNext || undefined}
          onClick={() => {
            onPageChange(info.page + 1);
          }}
        />
      </span>
    </nav>
  );
}
