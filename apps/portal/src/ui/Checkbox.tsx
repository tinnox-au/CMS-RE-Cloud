import {
  useEffect,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { Check, Minus } from './icons.ts';

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'checked' | 'onChange' | 'children'
> {
  readonly checked: boolean;
  /**
   * Shows the mixed state (a dash), which assistive technology reads as "mixed": some, but
   * not all, of the things this box stands for are selected. A press then selects all.
   */
  readonly mixed?: boolean;
  /** The second argument is the browser event, for example to read `shiftKey` for a range. */
  readonly onChange: (checked: boolean, event: ChangeEvent<HTMLInputElement>) => void;
  /** Visible label. Without one, pass `aria-label` ("Select Foyer loop"). */
  readonly label?: ReactNode;
  readonly hint?: ReactNode;
  readonly className?: string;
}

/** An 18 px box inside a 24 px target. Supports the mixed state used by "select all". */
export function Checkbox({
  checked,
  mixed = false,
  onChange,
  label,
  hint,
  className,
  ...rest
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  // `indeterminate` exists only as a DOM property; there is no attribute for it.
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = mixed && !checked;
  }, [mixed, checked]);

  return (
    <label className={cx('tx-check', className)}>
      <span className="tx-check__control">
        <input
          {...rest}
          ref={ref}
          type="checkbox"
          className="tx-check__input"
          checked={checked}
          onChange={(event) => {
            onChange(event.target.checked, event);
          }}
        />
        <Icon icon={Check} size={14} className="tx-check__mark" />
        <Icon icon={Minus} size={14} className="tx-check__dash" />
      </span>
      {(label !== undefined || hint !== undefined) && (
        <span className="tx-check__text">
          {label !== undefined && <span className="tx-check__label">{label}</span>}
          {hint !== undefined && <span className="tx-check__hint">{hint}</span>}
        </span>
      )}
    </label>
  );
}
