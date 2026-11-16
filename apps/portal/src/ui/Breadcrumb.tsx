import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { ChevronLeft, ChevronRight } from './icons.ts';

export interface BackLinkProps {
  /** In-app route of the list this page belongs to. */
  readonly to: string;
  /** Names the destination: "All playlists". */
  readonly children: ReactNode;
  readonly className?: string;
}

/** The link above an editor page's title that leads back to its list. */
export function BackLink({ to, children, className }: BackLinkProps) {
  return (
    <Link to={to} className={cx('tx-backlink', className)}>
      <Icon icon={ChevronLeft} size={16} />
      {children}
    </Link>
  );
}

export interface BreadcrumbItem {
  readonly label: string;
  /** In-app route. The last item is the current page and needs none. */
  readonly to?: string;
}

export interface BreadcrumbProps {
  /** From the top of the hierarchy to the current page. */
  readonly items: readonly BreadcrumbItem[];
  readonly className?: string;
}

/** A trail for pages more than one level deep, for example Settings, then Tags. */
export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav className={cx('tx-breadcrumb', className)} aria-label="Breadcrumb">
      <ol className="tx-breadcrumb__list" role="list">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${index}-${item.label}`} className="tx-breadcrumb__item">
              {index > 0 && (
                <Icon icon={ChevronRight} size={14} className="tx-breadcrumb__separator" />
              )}
              {item.to !== undefined && !last ? (
                <Link to={item.to} className="tx-breadcrumb__link">
                  {item.label}
                </Link>
              ) : (
                <span className="tx-breadcrumb__current" aria-current={last ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
