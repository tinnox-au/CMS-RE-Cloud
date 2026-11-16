import { initials } from '../lib/initials.ts';
import { cx } from './cx.ts';

export interface AvatarProps {
  /** The name the initials are taken from. */
  readonly name: string;
  /** 28, 36 (default) and 44 px. */
  readonly size?: 'sm' | 'md' | 'lg';
  /**
   * Decorative by default, for use next to the written name or inside a labelled button.
   * Set to expose the name to assistive technology instead.
   */
  readonly labelled?: boolean;
  readonly className?: string;
}

/** A circle with up to two initials. The portal stores no profile pictures. */
export function Avatar({ name, size = 'md', labelled = false, className }: AvatarProps) {
  return (
    <span
      className={cx('tx-avatar', size !== 'md' && `tx-avatar--${size}`, className)}
      {...(labelled ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true })}
    >
      {initials(name)}
    </span>
  );
}
