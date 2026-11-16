import type { Ref, SelectHTMLAttributes } from 'react';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { ChevronDown } from './icons.ts';
import type { ControlWidth } from './TextInput.tsx';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** `sm` is 32 px tall and as wide as its content, for toolbars and pagination. */
  readonly size?: 'sm' | 'md';
  readonly width?: ControlWidth;
  readonly ref?: Ref<HTMLSelectElement>;
}

/**
 * The native select with the house chevron. Native keeps the platform's own picker, which
 * is the most accessible one on every device. Pass `<option>` elements as children.
 */
export function Select({
  size = 'md',
  width = 'full',
  className,
  children,
  ref,
  ...rest
}: SelectProps) {
  return (
    <span
      className={cx(
        'tx-select',
        size === 'sm' && 'tx-select--sm',
        width !== 'full' && `tx-w-${width}`,
        className,
      )}
    >
      <select {...rest} ref={ref} className="tx-select__control">
        {children}
      </select>
      <Icon icon={ChevronDown} size={16} className="tx-select__chevron" />
    </span>
  );
}
