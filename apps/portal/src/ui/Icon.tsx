import { cx } from './cx.ts';
import type { IconComponent } from './icons.ts';

export interface IconProps {
  /** An icon exported by `ui/icons.ts`. */
  readonly icon: IconComponent;
  /** Pixel size of the square. 20 is the standard; 16 suits pills, chips and small buttons. */
  readonly size?: number;
  /** Set only when the icon stands alone as content; otherwise the icon is decorative. */
  readonly label?: string;
  readonly className?: string | undefined;
}

/**
 * Draws a lucide icon in the house style: 20 px, 1.75 stroke (2 at 16 px and below so the
 * line does not thin out). Decorative unless `label` is given.
 */
export function Icon({ icon: Glyph, size = 20, label, className }: IconProps) {
  return (
    <Glyph
      className={cx('tx-icon', className)}
      size={size}
      strokeWidth={size <= 16 ? 2 : 1.75}
      focusable={false}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    />
  );
}
