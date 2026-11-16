import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx.ts';

export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'role' | 'checked' | 'onChange' | 'children'
> {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Visible label. Without one, pass `aria-label`. */
  readonly label?: ReactNode;
  /** A second line under the label saying what the setting does. */
  readonly hint?: ReactNode;
  readonly className?: string;
  readonly ref?: Ref<HTMLInputElement>;
}

/**
 * An on/off setting that takes effect at once. It is a real checkbox with `role="switch"`,
 * so Space toggles it and forms can read it. For a choice that is applied later by a Save
 * button, use Checkbox.
 */
export function Switch({ checked, onChange, label, hint, className, ref, ...rest }: SwitchProps) {
  return (
    <label className={cx('tx-switch', className)}>
      <span className="tx-switch__control">
        <input
          {...rest}
          ref={ref}
          type="checkbox"
          role="switch"
          className="tx-switch__input"
          checked={checked}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        <span className="tx-switch__thumb" aria-hidden="true" />
      </span>
      {(label !== undefined || hint !== undefined) && (
        <span className="tx-switch__text">
          {label !== undefined && <span className="tx-switch__label">{label}</span>}
          {hint !== undefined && <span className="tx-switch__hint">{hint}</span>}
        </span>
      )}
    </label>
  );
}
