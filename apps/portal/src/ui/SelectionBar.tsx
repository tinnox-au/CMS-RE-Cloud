import type { ReactNode } from 'react';
import { Button } from './Button.tsx';

export interface SelectionBarProps {
  /** How many rows are ticked. The bar shows only above zero. */
  readonly count: number;
  readonly onClear: () => void;
  /** The bulk actions: small ghost Buttons ("Move to folder", "Add tags", "Delete"). */
  readonly children?: ReactNode;
  /** Accessible name of the bar. */
  readonly label?: string;
}

/**
 * The floating pill at the bottom centre of a list page: "3 selected", the bulk actions,
 * Clear. It replaces a permanently disabled Actions button. The count is announced
 * politely as it changes; render the bar after the list so Tab reaches it next.
 */
export function SelectionBar({
  count,
  onClear,
  children,
  label = 'Selected items',
}: SelectionBarProps) {
  const text = `${count} selected`;
  return (
    <>
      <span className="tx-visually-hidden" aria-live="polite" aria-atomic="true">
        {count > 0 ? text : ''}
      </span>
      {count > 0 && (
        <div className="tx-selection-bar" role="region" aria-label={label}>
          <span className="tx-selection-bar__count" aria-hidden="true">
            {text}
          </span>
          <div className="tx-selection-bar__actions">{children}</div>
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        </div>
      )}
    </>
  );
}
