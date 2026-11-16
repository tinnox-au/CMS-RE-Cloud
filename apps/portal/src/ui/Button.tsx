import type { AnchorHTMLAttributes, ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { Link } from 'react-router-dom';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import type { IconComponent } from './icons.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';
/** 32, 40 and 44 px tall. `lg` is for the page's primary action and the sign-in screen. */
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonLook {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Leading icon from `ui/icons.ts`. */
  readonly icon?: IconComponent;
  readonly trailingIcon?: IconComponent;
  /** Stretch to the width of the container. */
  readonly block?: boolean;
}

export interface ButtonProps
  extends ButtonLook, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Defaults to `button`, so a Button never submits a form by accident. */
  readonly type?: 'button' | 'submit' | 'reset';
  /**
   * The action is running: a spinner replaces the label without changing the width, and
   * presses are ignored. The button keeps focus, unlike a disabled one.
   * (`aria-disabled` does the same without the spinner: it looks disabled, ignores presses
   * and stays focusable. Use it when disabling must not throw keyboard focus away.)
   */
  readonly busy?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
}

function buttonClass(look: ButtonLook, className: string | undefined): string {
  const { variant = 'secondary', size = 'md', block = false } = look;
  return cx(
    'tx-button',
    `tx-button--${variant}`,
    size !== 'md' && `tx-button--${size}`,
    block && 'tx-button--block',
    className,
  );
}

function ButtonContent({
  look,
  children,
}: {
  readonly look: ButtonLook;
  readonly children: ReactNode;
}) {
  const iconSize = look.size === 'sm' ? 16 : 18;
  return (
    <>
      {look.icon !== undefined && (
        <Icon icon={look.icon} size={iconSize} className="tx-button__icon" />
      )}
      {children !== null && children !== undefined && children !== false && (
        <span className="tx-button__label">{children}</span>
      )}
      {look.trailingIcon !== undefined && (
        <Icon icon={look.trailingIcon} size={iconSize} className="tx-button__icon" />
      )}
    </>
  );
}

export function Button({
  variant,
  size,
  icon,
  trailingIcon,
  block,
  busy = false,
  type = 'button',
  className,
  children,
  onClick,
  ref,
  ...rest
}: ButtonProps) {
  const look: ButtonLook = { variant, size, icon, trailingIcon, block };
  const softDisabled = rest['aria-disabled'] === true || rest['aria-disabled'] === 'true';
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy || softDisabled) {
      // Also stops a submit button from submitting again while the first attempt runs.
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={buttonClass(look, className)}
      onClick={handleClick}
      aria-busy={busy || undefined}
      aria-disabled={busy ? true : rest['aria-disabled']}
      data-busy={busy ? '' : undefined}
    >
      <ButtonContent look={look}>{children}</ButtonContent>
      {busy && (
        <span className="tx-button__spinner" aria-hidden="true">
          <span className="tx-spinner" />
        </span>
      )}
    </button>
  );
}

export interface ButtonLinkProps
  extends ButtonLook, Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** An in-app route. Rendered with the router's Link. */
  readonly to?: string;
  /** A full-page navigation, for example the sign-in address. Use one of `to` and `href`. */
  readonly href?: string;
}

/** A link that looks like a button, for navigation such as "Add screen". */
export function ButtonLink({
  variant,
  size,
  icon,
  trailingIcon,
  block,
  to,
  href,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const look: ButtonLook = { variant, size, icon, trailingIcon, block };
  const content = <ButtonContent look={look}>{children}</ButtonContent>;
  if (to !== undefined) {
    return (
      <Link {...rest} to={to} className={buttonClass(look, className)}>
        {content}
      </Link>
    );
  }
  return (
    <a {...rest} href={href} className={buttonClass(look, className)}>
      {content}
    </a>
  );
}
