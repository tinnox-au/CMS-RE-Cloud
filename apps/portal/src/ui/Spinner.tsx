import { cx } from './cx.ts';

export interface SpinnerProps {
  readonly size?: 'md' | 'lg';
  /**
   * What is happening, for example "Uploading". With a label the spinner is announced as a
   * status and the text is shown beside it; without one it is decoration for a parent that
   * already says what is busy.
   */
  readonly label?: string;
  /** Keeps the label for assistive technology only. */
  readonly labelHidden?: boolean;
  readonly className?: string;
}

/** A small ring for a control or a region that is working. Whole pages use Skeleton instead. */
export function Spinner({ size = 'md', label, labelHidden = false, className }: SpinnerProps) {
  const ring = (
    <span className={cx('tx-spinner', size === 'lg' && 'tx-spinner--lg')} aria-hidden="true" />
  );
  if (label === undefined) return <span className={className}>{ring}</span>;
  return (
    <span className={cx('tx-spinner-row', className)} role="status">
      {ring}
      <span className={labelHidden ? 'tx-visually-hidden' : undefined}>{label}</span>
    </span>
  );
}
