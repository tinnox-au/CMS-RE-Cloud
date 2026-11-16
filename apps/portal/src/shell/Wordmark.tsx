import { Link } from 'react-router-dom';
import { cx } from '../ui/index.ts';

/** What the "Prototype" capsule stands for. Also shown as a note on the sign-in screen. */
export const PROTOTYPE_NOTE = 'Internal engineering prototype. Synthetic data only.';

export interface WordmarkProps {
  /** In-app route the mark links to. Without it the mark is plain text. */
  readonly to?: string;
  /** Shows the square "T" mark only; the name stays available to assistive technology. */
  readonly compact?: boolean;
  /** `lg` is for the screens shown without the shell (sign-in). */
  readonly size?: 'md' | 'lg';
  /**
   * Shows the "Prototype" capsule beside the name. Its full meaning ({@link PROTOTYPE_NOTE})
   * is its pointer tooltip and is read by assistive technology. Outside the link, so the
   * link's name stays "TINNOX CMS".
   */
  readonly tag?: boolean;
  /** Runs when the linked mark is pressed, for example to close the navigation drawer. */
  readonly onClick?: () => void;
  readonly className?: string;
}

/**
 * The text brand mark (docs/portal-v2/design-system.md, section 6), used until TINNOX
 * supplies official logo files: "TINNOX" in tracked capitals and, in the shell, a small
 * "Prototype" capsule; compact, a rounded square with a "T".
 */
export function Wordmark({
  to,
  compact = false,
  size = 'md',
  tag = false,
  onClick,
  className,
}: WordmarkProps) {
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
      <span className="tx-wordmark__name">
        TINNOX<span className="tx-visually-hidden"> CMS</span>
      </span>
    </>
  );
  return (
    <span className={classes}>
      {to !== undefined ? (
        <Link to={to} className="tx-wordmark__link" onClick={onClick}>
          {content}
        </Link>
      ) : (
        <span className="tx-wordmark__link">{content}</span>
      )}
      {tag && (
        <span className="tx-wordmark__tag" title={PROTOTYPE_NOTE}>
          <span aria-hidden="true">Prototype</span>
          <span className="tx-visually-hidden">{PROTOTYPE_NOTE}</span>
        </span>
      )}
    </span>
  );
}
