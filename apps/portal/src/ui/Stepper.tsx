import type { InputHTMLAttributes, KeyboardEvent } from 'react';
import { canStep, parseStepperValue, stepValue, type StepperBounds } from '../lib/stepper.ts';
import { cssVars } from './cssVars.ts';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { Minus, Plus } from './icons.ts';

export interface StepperProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'min' | 'max' | 'step' | 'size'
> {
  /** The field's text, exactly as typed. The page parses and validates it. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  /** Shown after the number, for example "s". Part of the visible value, not of `value`. */
  readonly unit?: string;
  /** What the buttons act on, used in their names: "duration" gives "Decrease duration". */
  readonly stepLabel: string;
  readonly className?: string;
}

/**
 * Minus, a number, plus, in one pill. Arrow Up and Down step by one, Page Up and Page Down
 * by ten. Typing is free: the value is text, and nothing is rewritten until a step is
 * taken. Put it inside a Field so the input has a label.
 */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  stepLabel,
  disabled = false,
  className,
  onKeyDown,
  ...rest
}: StepperProps) {
  const bounds: StepperBounds = { min, max, step };
  const parsed = parseStepperValue(value);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    let next: string | null = null;
    if (event.key === 'ArrowUp') next = stepValue(value, 1, bounds);
    else if (event.key === 'ArrowDown') next = stepValue(value, -1, bounds);
    else if (event.key === 'PageUp') next = stepValue(value, 1, bounds, 10);
    else if (event.key === 'PageDown') next = stepValue(value, -1, bounds, 10);
    if (next === null) return;
    event.preventDefault();
    if (next !== value) onChange(next);
  };

  const chars = Math.max(2, String(max).length, value.length);
  // At a bound the button is soft-disabled, not `disabled`: stepping to the limit with the
  // keyboard must not throw focus away.
  const canDecrease = canStep(value, -1, bounds);
  const canIncrease = canStep(value, 1, bounds);

  return (
    <span className={cx('tx-stepper', className)} style={cssVars({ '--tx-stepper-chars': chars })}>
      <button
        type="button"
        className="tx-stepper__button"
        aria-label={`Decrease ${stepLabel}`}
        disabled={disabled}
        aria-disabled={!canDecrease || undefined}
        onClick={() => {
          if (canDecrease) onChange(stepValue(value, -1, bounds));
        }}
      >
        <Icon icon={Minus} size={16} />
      </button>
      <span className="tx-stepper__value">
        <input
          {...rest}
          type="text"
          inputMode={Number.isInteger(step) ? 'numeric' : 'decimal'}
          role="spinbutton"
          autoComplete="off"
          className="tx-stepper__input"
          disabled={disabled}
          value={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={parsed ?? undefined}
          aria-valuetext={
            parsed === null || unit === undefined ? undefined : `${value.trim()} ${unit}`
          }
          onChange={(event) => {
            onChange(event.target.value);
          }}
          onKeyDown={handleKeyDown}
        />
        <span className="tx-stepper__unit" aria-hidden="true">
          {unit}
        </span>
      </span>
      <button
        type="button"
        className="tx-stepper__button"
        aria-label={`Increase ${stepLabel}`}
        disabled={disabled}
        aria-disabled={!canIncrease || undefined}
        onClick={() => {
          if (canIncrease) onChange(stepValue(value, 1, bounds));
        }}
      >
        <Icon icon={Plus} size={16} />
      </button>
    </span>
  );
}
