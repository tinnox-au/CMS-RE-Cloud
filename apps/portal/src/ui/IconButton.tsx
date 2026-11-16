import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react';
import type { Placement } from '../lib/positioner.ts';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import type { IconComponent } from './icons.ts';
import { Tooltip } from './Tooltip.tsx';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'children' | 'aria-label'
> {
  readonly icon: IconComponent;
  /** The accessible name, also shown as the tooltip. Name the object: "Actions for Foyer loop". */
  readonly label: string;
  /** 28, 36 (default) and 44 px circles. */
  readonly size?: 'sm' | 'md' | 'lg';
  readonly variant?: 'ghost' | 'secondary' | 'primary' | 'danger';
  /** Pass false to drop the tooltip, for example when a visible label sits next to the button. */
  readonly tooltip?: boolean;
  readonly tooltipPlacement?: Placement;
  readonly ref?: Ref<HTMLButtonElement>;
}

/** A round, icon-only button. It always has an accessible name and, by default, a tooltip. */
export function IconButton({
  icon,
  label,
  size = 'md',
  variant = 'ghost',
  tooltip = true,
  tooltipPlacement = 'top',
  className,
  onClick,
  ref,
  ...rest
}: IconButtonProps) {
  // `aria-disabled` keeps the button focusable and its tooltip readable, but it must not act.
  const softDisabled = rest['aria-disabled'] === true || rest['aria-disabled'] === 'true';
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (softDisabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <Tooltip
      content={label}
      placement={tooltipPlacement}
      // An open menu already covers the spot where the tooltip would be.
      disabled={!tooltip || rest['aria-expanded'] === true}
    >
      <button
        {...rest}
        ref={ref}
        type="button"
        className={cx(
          'tx-icon-button',
          size !== 'md' && `tx-icon-button--${size}`,
          variant !== 'ghost' && `tx-icon-button--${variant}`,
          className,
        )}
        aria-label={label}
        onClick={handleClick}
      >
        <Icon icon={icon} size={size === 'sm' ? 16 : 20} />
      </button>
    </Tooltip>
  );
}
