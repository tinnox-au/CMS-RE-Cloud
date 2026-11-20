import { useId } from 'react';
import { cssVars } from './cssVars.ts';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import type { IconComponent } from './icons.ts';
import { Tooltip } from './Tooltip.tsx';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  /** Always required: it is the visible text, or the accessible name of an icon-only option. */
  readonly label: string;
  readonly icon?: IconComponent;
  readonly disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  /** Accessible name of the group: "View", "Media kind". */
  readonly label: string;
  /** Two to four options. */
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** Show icons only; each label becomes the option's accessible name and its tooltip. */
  readonly iconOnly?: boolean;
  readonly size?: 'sm' | 'md';
  /** Disables every option at once, for a form that is saving or read-only. */
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * An Apple-style segmented control for two to four exclusive choices. It is a group of
 * native radio buttons, so arrow keys move the choice and Tab enters and leaves in one stop.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  iconOnly = false,
  size = 'md',
  disabled = false,
  className,
}: SegmentedProps<T>) {
  const name = useId();
  const index = options.findIndex((option) => option.value === value);
  return (
    <span
      className={cx(
        'tx-segmented',
        size === 'sm' && 'tx-segmented--sm',
        iconOnly && 'tx-segmented--icons',
        className,
      )}
      role="radiogroup"
      aria-label={label}
      data-empty={index === -1 ? '' : undefined}
      // The sliding thumb is placed from these two numbers (styles/controls.css).
      style={cssVars({ '--tx-seg-count': options.length, '--tx-seg-index': Math.max(0, index) })}
    >
      {options.map((option) => {
        const segment = (
          <label className="tx-segmented__option">
            <input
              type="radio"
              className="tx-segmented__input"
              name={name}
              value={option.value}
              checked={option.value === value}
              disabled={disabled || option.disabled === true}
              aria-label={iconOnly ? option.label : undefined}
              onChange={() => {
                onChange(option.value);
              }}
            />
            {option.icon !== undefined && <Icon icon={option.icon} size={16} />}
            {!iconOnly && <span>{option.label}</span>}
          </label>
        );
        return (
          <Tooltip key={option.value} content={option.label} disabled={!iconOnly}>
            {segment}
          </Tooltip>
        );
      })}
    </span>
  );
}
