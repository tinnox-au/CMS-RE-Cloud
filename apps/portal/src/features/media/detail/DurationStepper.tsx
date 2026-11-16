import type { KeyboardEvent, MouseEvent } from 'react';
import { stepValue } from '../../../lib/stepper.ts';
import { Stepper, type FieldControlProps } from '../../../ui/index.ts';

export interface DurationStepperProps extends Partial<FieldControlProps> {
  /** Seconds as typed; empty means "no default of its own". */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly min: number;
  readonly max: number;
  /** The seconds that apply while the field is empty, shown as the placeholder. */
  readonly standardSeconds: number;
  readonly className?: string;
}

/**
 * The kit's Stepper for the default duration. The kit starts an empty field at its minimum
 * on the first step; here an empty field stands for the standard duration, so the first
 * press of plus or minus (or Arrow Up and Down) steps from that value instead of jumping to
 * one second.
 */
export function DurationStepper({
  value,
  onChange,
  min,
  max,
  standardSeconds,
  className,
  ...control
}: DurationStepperProps) {
  const bounds = { min, max, step: 1 };
  const empty = value.trim() === '';
  const start = String(Math.min(max, Math.max(min, standardSeconds)));

  const stepFromStandard = (direction: 1 | -1, multiplier = 1) => {
    onChange(stepValue(start, direction, bounds, multiplier));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!empty || event.altKey || event.ctrlKey || event.metaKey) return;
    const steps: Readonly<Record<string, readonly [1 | -1, number]>> = {
      ArrowUp: [1, 1],
      ArrowDown: [-1, 1],
      PageUp: [1, 10],
      PageDown: [-1, 10],
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    stepFromStandard(step[0], step[1]);
  };

  // The plus and minus buttons are the Stepper's own; while the field is empty their press is
  // taken here, before it reaches them.
  const onClickCapture = (event: MouseEvent<HTMLSpanElement>) => {
    if (!empty || !(event.target instanceof Element)) return;
    const button = event.target.closest('button');
    if (button === null || button.getAttribute('aria-disabled') === 'true') return;
    const label = button.getAttribute('aria-label') ?? '';
    const direction = label.startsWith('Increase') ? 1 : label.startsWith('Decrease') ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    event.stopPropagation();
    stepFromStandard(direction);
  };

  return (
    <span className="tx-media-detail-duration" onClickCapture={onClickCapture}>
      <Stepper
        {...control}
        className={className}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        min={min}
        max={max}
        unit="s"
        placeholder={String(standardSeconds)}
        stepLabel="default duration"
        data-testid="media-detail-duration"
      />
      {empty && (
        <span className="tx-media-detail-duration__note" aria-hidden="true">
          Standard, {standardSeconds} s
        </span>
      )}
    </span>
  );
}
