import type { ReactNode } from 'react';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { Inbox, type IconComponent } from './icons.ts';

export interface EmptyStateProps {
  readonly title: string;
  /** One sentence: what will be here, or why there is nothing. */
  readonly children?: ReactNode;
  readonly icon?: IconComponent;
  /** One primary Button or ButtonLink; a "no results" state offers "Clear filters". */
  readonly action?: ReactNode;
  /** `page` fills a page with a display-size heading; `inline` sits inside a card or table. */
  readonly variant?: 'page' | 'inline';
  /** Heading level of the title in the page outline. Default 2. */
  readonly level?: 2 | 3;
  readonly className?: string;
}

/** A centred icon in a soft circle, a heading, one sentence and one action. */
export function EmptyState({
  title,
  children,
  icon = Inbox,
  action,
  variant = 'page',
  level = 2,
  className,
}: EmptyStateProps) {
  const Heading = `h${level}` as const;
  return (
    <div className={cx('tx-empty', variant === 'inline' && 'tx-empty--inline', className)}>
      <span className="tx-empty__icon">
        <Icon icon={icon} size={variant === 'inline' ? 24 : 28} />
      </span>
      <Heading className="tx-empty__title">{title}</Heading>
      {children !== undefined && <p className="tx-empty__text">{children}</p>}
      {action !== undefined && <div className="tx-empty__action">{action}</div>}
    </div>
  );
}
