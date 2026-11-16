import type { ReactNode } from 'react';
import { cx } from './cx.ts';

export interface FactsProps {
  /** Fact elements. */
  readonly children: ReactNode;
  /** Label above value instead of beside it, for narrow columns. */
  readonly stacked?: boolean;
  readonly className?: string;
}

/** A list of label and value pairs (kind, dimensions, size ...), as a definition list. */
export function Facts({ children, stacked = false, className }: FactsProps) {
  return <dl className={cx('tx-facts', stacked && 'tx-facts--stacked', className)}>{children}</dl>;
}

export interface FactProps {
  readonly label: string;
  readonly children: ReactNode;
  /** `data-testid` for the value. */
  readonly testId?: string;
}

export function Fact({ label, children, testId }: FactProps) {
  return (
    <>
      <dt>{label}</dt>
      <dd data-testid={testId}>{children}</dd>
    </>
  );
}
