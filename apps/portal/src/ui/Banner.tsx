import type { ReactNode, Ref } from 'react';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';
import {
  CircleCheck,
  CircleExclamationPoint,
  Info,
  TriangleExclamationPoint,
  X,
  type IconComponent,
} from './icons.ts';

export type BannerTone = 'info' | 'ok' | 'warn' | 'danger';

export interface BannerProps {
  readonly tone?: BannerTone;
  readonly title?: string;
  /** The message. Text, a paragraph, or a short list (an error summary with links to fields). */
  readonly children?: ReactNode;
  /** One or two small buttons at the right: "Try again", "Review". */
  readonly actions?: ReactNode;
  /** Adds a close button. */
  readonly onDismiss?: () => void;
  /**
   * Whether the banner is announced when it appears. `assertive` (role alert) is for an
   * error the person must hear now; `polite` (role status) for the result of an action.
   * A banner that is simply part of the page stays `off`.
   */
  readonly live?: 'off' | 'polite' | 'assertive';
  /** Replaces the tone's icon. */
  readonly icon?: IconComponent;
  /** To move focus to the banner, for example an error summary after a failed save. */
  readonly ref?: Ref<HTMLDivElement>;
  readonly tabIndex?: number;
  readonly className?: string;
}

const TONE_ICON: { readonly [K in BannerTone]: IconComponent } = {
  info: Info,
  ok: CircleCheck,
  warn: TriangleExclamationPoint,
  danger: CircleExclamationPoint,
};

const LIVE_ROLE = { off: undefined, polite: 'status', assertive: 'alert' } as const;

/** An inline notice with a tone, an icon and optional actions. It replaces the M0 `Notice`. */
export function Banner({
  tone = 'info',
  title,
  children,
  actions,
  onDismiss,
  live = 'off',
  icon,
  ref,
  tabIndex,
  className,
}: BannerProps) {
  return (
    <div
      ref={ref}
      className={cx('tx-banner', tone !== 'info' && `tx-banner--${tone}`, className)}
      role={LIVE_ROLE[live]}
      tabIndex={tabIndex}
    >
      <Icon icon={icon ?? TONE_ICON[tone]} className="tx-banner__icon" />
      <div className="tx-banner__body">
        {title !== undefined && <p className="tx-banner__title">{title}</p>}
        {children}
      </div>
      {(actions !== undefined || onDismiss !== undefined) && (
        <div className="tx-banner__actions">
          {actions}
          {onDismiss !== undefined && (
            <IconButton icon={X} size="sm" label="Dismiss" tooltip={false} onClick={onDismiss} />
          )}
        </div>
      )}
    </div>
  );
}
