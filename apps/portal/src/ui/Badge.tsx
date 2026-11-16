import { cx } from './cx.ts';

export interface BadgeProps {
  readonly count: number;
  /** Counts above this show as "99+". */
  readonly max?: number;
  /**
   * What the number counts, for assistive technology: "3 changes waiting". Without it the
   * badge is hidden from assistive technology, for when nearby text already says the same.
   */
  readonly label?: string;
  /** `inverse` is for a badge sitting on a brand-filled button. */
  readonly variant?: 'brand' | 'inverse' | 'neutral' | 'danger';
  /** By default a count of zero renders nothing. */
  readonly showZero?: boolean;
  readonly className?: string;
}

/** A count in a small pill. */
export function Badge({
  count,
  max = 99,
  label,
  variant = 'brand',
  showZero = false,
  className,
}: BadgeProps) {
  if (count <= 0 && !showZero) return null;
  const text = count > max ? `${max}+` : String(Math.max(0, count));
  return (
    <span className={cx('tx-badge', variant !== 'brand' && `tx-badge--${variant}`, className)}>
      <span aria-hidden="true">{text}</span>
      {label !== undefined && <span className="tx-visually-hidden">{label}</span>}
    </span>
  );
}
