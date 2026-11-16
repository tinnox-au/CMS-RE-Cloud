import type { MouseEvent, ReactNode } from 'react';
import { Button, type ButtonSize } from './Button.tsx';
import { cx } from './cx.ts';
import { ChevronDown, type IconComponent } from './icons.ts';
import { Menu } from './Menu.tsx';

export interface SplitButtonProps {
  /** Label of the main action. */
  readonly children: ReactNode;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Accessible name of the chevron segment, for example "More save actions". */
  readonly menuLabel: string;
  /** MenuItem elements for the related actions. */
  readonly menu: ReactNode;
  readonly variant?: 'primary' | 'secondary';
  readonly size?: ButtonSize;
  readonly icon?: IconComponent;
  readonly busy?: boolean;
  /** Disables both segments. */
  readonly disabled?: boolean;
  /** `submit` makes the main segment submit the surrounding form. */
  readonly type?: 'button' | 'submit';
  readonly className?: string;
}

/** A main action with a chevron segment that opens a menu of related actions. */
export function SplitButton({
  children,
  onClick,
  menuLabel,
  menu,
  variant = 'primary',
  size = 'md',
  icon,
  busy = false,
  disabled = false,
  type = 'button',
  className,
}: SplitButtonProps) {
  return (
    <span className={cx('tx-split', className)} role="group">
      <Button
        variant={variant}
        size={size}
        type={type}
        busy={busy}
        disabled={disabled}
        onClick={onClick}
        icon={icon}
      >
        {children}
      </Button>
      <Menu
        placement="bottom-end"
        trigger={(props) => (
          <Button
            {...props}
            variant={variant}
            size={size}
            className="tx-split__toggle"
            aria-label={menuLabel}
            disabled={disabled || busy}
            icon={ChevronDown}
          >
            {null}
          </Button>
        )}
      >
        {menu}
      </Menu>
    </span>
  );
}
