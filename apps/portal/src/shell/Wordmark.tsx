import { Link } from 'react-router-dom';
import { cx } from '../ui/index.ts';

export interface WordmarkProps {
  /** In-app route the mark links to. Without it the mark is plain text. */
  readonly to?: string;
  /** Shows the square "T" mark only; the name stays available to assistive technology. */
  readonly compact?: boolean;
  /** `lg` is for the sign-in screen. */
  readonly size?: 'md' | 'lg';
  /** Runs when the linked mark is pressed, for example to close the navigation drawer. */
  readonly onClick?: () => void;
  readonly className?: string;
}

/**
 * The text brand mark (docs/portal-v2/design-system.md, section 6), used until TINNOX
 * supplies official logo files: "TINNOX" with "CMS" in a small pill; compact, a rounded
 * square with a "T".
 */
export function Wordmark({ to, compact = false, size = 'md', onClick, className }: WordmarkProps) {
  const classes = cx(
    'tx-wordmark',
    compact && 'tx-wordmark--compact',
    size === 'lg' && 'tx-wordmark--lg',
    className,
  );
  const content = (
    <>
      <span className="tx-wordmark__mark" aria-hidden="true">
        T
      </span>
      <span className="tx-wordmark__text">
        <span className="tx-wordmark__name">TINNOX</span>{' '}
        <span className="tx-wordmark__tag">CMS</span>
      </span>
    </>
  );
  if (to !== undefined) {
    return (
      <Link to={to} className={classes} onClick={onClick}>
        {content}
      </Link>
    );
  }
  return <span className={classes}>{content}</span>;
}
