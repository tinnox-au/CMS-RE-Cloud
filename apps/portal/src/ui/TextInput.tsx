import type { InputHTMLAttributes, Ref } from 'react';
import { cx } from './cx.ts';

export type ControlWidth = 'xs' | 'sm' | 'md' | 'lg' | 'full';

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  /** Monospace with wide tracking, for pairing codes, ids and hashes. */
  readonly mono?: boolean;
  /** Tabular digits, for pixel sizes and other numbers. Keep `type="text"` and set `inputMode`. */
  readonly numeric?: boolean;
  /** A fixed unit or symbol shown inside the field, before or after the value. */
  readonly prefix?: string;
  readonly suffix?: string;
  /** Caps the width: 96, 160, 320 or 480 px. Default: the full width of the container. */
  readonly width?: ControlWidth;
  readonly ref?: Ref<HTMLInputElement>;
}

/** A single-line text field, 36 px tall. Put it inside a Field so it has a label. */
export function TextInput({
  mono = false,
  numeric = false,
  prefix,
  suffix,
  width = 'full',
  type = 'text',
  className,
  ref,
  ...rest
}: TextInputProps) {
  const widthClass = width === 'full' ? undefined : `tx-w-${width}`;
  const input = (
    <input
      {...rest}
      ref={ref}
      type={type}
      className={cx(
        'tx-input',
        mono && 'tx-input--mono',
        numeric && 'tx-input--numeric',
        prefix === undefined && suffix === undefined && widthClass,
        className,
      )}
    />
  );
  if (prefix === undefined && suffix === undefined) return input;
  return (
    <span className={cx('tx-input-group', widthClass)}>
      {prefix !== undefined && (
        <span className="tx-input-group__affix" aria-hidden="true">
          {prefix}
        </span>
      )}
      {input}
      {suffix !== undefined && (
        <span className="tx-input-group__affix tx-input-group__affix--end" aria-hidden="true">
          {suffix}
        </span>
      )}
    </span>
  );
}
