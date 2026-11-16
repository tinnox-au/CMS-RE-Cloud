import { useId, type ReactNode } from 'react';
import { meterFraction, meterTone } from '../lib/meter.ts';
import { cssVars } from './cssVars.ts';
import { cx } from './cx.ts';

export interface MeterProps {
  /** What is measured: "Storage". */
  readonly label: string;
  readonly value: number;
  readonly max: number;
  /** The reading in words, shown next to the bar and read out: "1.2 GB of 5 GB used". */
  readonly valueText: string;
  /** `inline` puts label, bar and value on one line, for a toolbar. */
  readonly variant?: 'stacked' | 'inline';
  /** A line under the bar, for example what to do when it is nearly full. */
  readonly note?: ReactNode;
  readonly className?: string;
}

/**
 * A bar for a known amount out of a limit (storage). The bar turns to the attention colour
 * from 80 per cent and to the danger colour from 95 per cent; the reading is always written
 * out as text, so the colour is never the only signal.
 */
export function Meter({
  label,
  value,
  max,
  valueText,
  variant = 'stacked',
  note,
  className,
}: MeterProps) {
  const labelId = useId();
  const fraction = meterFraction(value, max);
  return (
    <div
      className={cx('tx-meter', variant === 'inline' && 'tx-meter--inline', className)}
      data-tone={meterTone(fraction)}
    >
      <div className="tx-meter__head">
        <span id={labelId} className="tx-meter__label">
          {label}
        </span>
        <span className="tx-meter__value" aria-hidden="true">
          {valueText}
        </span>
      </div>
      <div
        className="tx-meter__track"
        role="meter"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={max > 0 ? max : 0}
        aria-valuenow={Math.min(Math.max(0, value), Math.max(0, max))}
        aria-valuetext={valueText}
      >
        <div className="tx-meter__fill" style={cssVars({ '--tx-meter': fraction })} />
      </div>
      {note !== undefined && <p className="tx-meter__note">{note}</p>}
    </div>
  );
}
