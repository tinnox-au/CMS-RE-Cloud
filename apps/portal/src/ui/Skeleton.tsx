import type { ReactNode } from 'react';
import { cssVars } from './cssVars.ts';
import { cx } from './cx.ts';

export interface SkeletonProps {
  /** Any CSS length. Default: the full width of the container. */
  readonly width?: string;
  /** Any CSS length. Default: 12 px, one line of small text. */
  readonly height?: string;
  /** `text` has a small radius; `block` suits thumbnails and cards; `pill` suits buttons and chips. */
  readonly variant?: 'text' | 'block' | 'circle' | 'pill';
  readonly className?: string;
}

/**
 * A shimmering neutral block that stands in for content that is loading. Decorative: wrap a
 * set of them in SkeletonGroup so assistive technology hears that something is loading.
 */
export function Skeleton({ width, height, variant = 'text', className }: SkeletonProps) {
  return (
    <span
      className={cx('tx-skeleton', variant !== 'text' && `tx-skeleton--${variant}`, className)}
      aria-hidden="true"
      style={cssVars({
        ...(width === undefined ? {} : { '--tx-skeleton-w': width }),
        ...(height === undefined ? {} : { '--tx-skeleton-h': height }),
      })}
    />
  );
}

/** Announces "Loading" once for the skeletons inside it. Whole pages load this way, not with a spinner. */
export function SkeletonGroup({
  label = 'Loading',
  children,
  className,
}: {
  readonly label?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={className} role="status" aria-busy="true">
      <span className="tx-visually-hidden">{label}</span>
      {children}
    </div>
  );
}
