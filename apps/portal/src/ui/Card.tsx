import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx.ts';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** The element to render. `section` suits a card with a CardHeader. */
  readonly as?: 'div' | 'section' | 'article' | 'aside';
  /** Drops the 24 px padding, for content that runs edge to edge (a list, a preview). */
  readonly flush?: boolean;
}

/** A surface with a hairline border and a 20 px radius. Cards have no shadow. */
export function Card({ as: Element = 'div', flush = false, className, ...rest }: CardProps) {
  return <Element {...rest} className={cx('tx-card', flush && 'tx-card--flush', className)} />;
}

export interface CardHeaderProps {
  readonly title: string;
  /** Heading level of the title in the page outline. Default 2. */
  readonly level?: 2 | 3 | 4;
  /**
   * `caption` (default) is the quiet 12 px label of the specification; `title` is the 15 px
   * card title, for a card whose heading should carry more weight.
   */
  readonly size?: 'caption' | 'title';
  readonly description?: ReactNode;
  /** Controls at the right: a count, a button, a menu. */
  readonly actions?: ReactNode;
  /** Id for the heading, to label the card with `aria-labelledby`. */
  readonly id?: string;
}

export function CardHeader({
  title,
  level = 2,
  size = 'caption',
  description,
  actions,
  id,
}: CardHeaderProps) {
  const Heading = `h${level}` as const;
  return (
    <div className="tx-card__header">
      <div className="tx-card__heading">
        <Heading
          id={id}
          className={cx('tx-card__title', size === 'title' && 'tx-card__title--strong')}
        >
          {title}
        </Heading>
        {description !== undefined && <p className="tx-card__description">{description}</p>}
      </div>
      {actions !== undefined && <div className="tx-card__actions">{actions}</div>}
    </div>
  );
}
