import type { ReactNode } from 'react';
import { ChevronDown } from '../../../ui/icons.ts';
import { Button, cx, Menu, Tooltip } from '../../../ui/index.ts';

export interface SaveSplitProps {
  readonly onSave: () => void;
  /** MenuItem elements. */
  readonly menu: ReactNode;
  /** Shows Save soft-disabled, alone, with the reason as its description. */
  readonly unavailableReason: string | null;
  readonly busy: boolean;
}

/**
 * The kit's split button arrangement (`tx-split`), for a Save that can also be unavailable
 * (nothing to save). Unavailable, it is a single soft-disabled Save with the reason as its
 * description: no half-enabled pair. The menu (`menu`, extra save actions) is offered only
 * while Save itself can be used. The kit's `SplitButton` has no soft-disabled state.
 *
 * Save is the same element in both states, so it keeps keyboard focus when a save makes it
 * unavailable.
 */
export function SaveSplit({ onSave, menu, unavailableReason, busy }: SaveSplitProps) {
  const available = unavailableReason === null;
  return (
    <span
      className={cx('tx-media-detail-save', available && 'tx-split')}
      role={available ? 'group' : undefined}
      aria-label={available ? 'Save' : undefined}
    >
      <Tooltip
        content={unavailableReason ?? ''}
        describe={!available}
        disabled={available}
        placement="bottom"
      >
        <Button
          variant="primary"
          busy={busy}
          aria-disabled={!available || undefined}
          data-testid="media-detail-save"
          onClick={() => {
            if (available) onSave();
          }}
        >
          Save
        </Button>
      </Tooltip>
      {available && (
        <Menu
          placement="bottom-end"
          trigger={(props) => (
            <Button
              {...props}
              variant="primary"
              className="tx-split__toggle"
              aria-label="More save actions"
              disabled={busy}
              icon={ChevronDown}
              data-testid="media-detail-save-menu"
            >
              {null}
            </Button>
          )}
        >
          {menu}
        </Menu>
      )}
    </span>
  );
}
