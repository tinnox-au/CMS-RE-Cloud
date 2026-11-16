import type { ReactNode } from 'react';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import type { IconComponent } from './icons.ts';

export type StatusTone = 'ok' | 'warn' | 'danger' | 'neutral';

export interface StatusPillProps {
  readonly tone: StatusTone;
  /** The status in words. Always present: colour alone never carries the meaning. */
  readonly children: ReactNode;
  /** Replaces the leading dot. */
  readonly icon?: IconComponent;
  readonly className?: string;
}

/**
 * A status: a leading 8 px dot (or an icon) and the words in the tone's colour at weight 500. Screen status wording follows the rule in
 * docs/portal-v2/README.md (P2-04): report what the player software last said.
 */
export function StatusPill({ tone, children, icon, className }: StatusPillProps) {
  return (
    <span className={cx('tx-pill', tone !== 'neutral' && `tx-pill--${tone}`, className)}>
      {icon === undefined ? (
        <span className="tx-pill__dot" aria-hidden="true" />
      ) : (
        <Icon icon={icon} size={14} className="tx-pill__icon" />
      )}
      <span className="tx-pill__label">{children}</span>
    </span>
  );
}
