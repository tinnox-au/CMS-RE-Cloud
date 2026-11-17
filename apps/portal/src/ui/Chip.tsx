import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { Check, X, type IconComponent } from './icons.ts';

/** The tag colours the API knows. */
export type TagColour = 'teal' | 'sky' | 'slate' | 'green' | 'amber' | 'red' | 'violet' | 'pink';

export const TAG_COLOURS: readonly TagColour[] = [
  'teal',
  'sky',
  'slate',
  'green',
  'amber',
  'red',
  'violet',
  'pink',
];

export interface ChipProps {
  readonly children: ReactNode;
  /** Shows a colour dot before the label: a tag. */
  readonly colour?: TagColour;
  readonly icon?: IconComponent;
  /** 28 px (default) or 24 px for table cells. */
  readonly size?: 'sm' | 'md';
  /**
   * Makes the chip a toggle button (a filter). `selected` is then its pressed state; a
   * selected chip is filled and gains a tick, so the state does not rest on colour alone.
   */
  readonly onToggle?: (selected: boolean) => void;
  readonly selected?: boolean;
  /** Adds a close button. `removeLabel` names it: "Remove tag Foyer". */
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  /**
   * The full label for a pointer when the chip cuts it short. A plain text label is used by
   * default; pass it when the label is not plain text (a name with a count).
   */
  readonly title?: string;
}

/**
 * A pill for tags and filters. Plain by default; a toggle with `onToggle`; removable with
 * `onRemove` (not both at once).
 */
export function Chip({
  children,
  colour,
  icon,
  size = 'md',
  onToggle,
  selected = false,
  onRemove,
  removeLabel,
  disabled = false,
  className,
  title,
}: ChipProps) {
  const classes = cx(
    'tx-chip',
    size === 'sm' && 'tx-chip--sm',
    colour !== undefined && `tx-chip--${colour}`,
    onRemove !== undefined && 'tx-chip--removable',
    className,
  );
  const content = (
    <>
      {onToggle !== undefined && selected && (
        <Icon icon={Check} size={14} className="tx-chip__check" />
      )}
      {colour !== undefined && <span className="tx-chip__dot" aria-hidden="true" />}
      {icon !== undefined && <Icon icon={icon} size={14} className="tx-chip__icon" />}
      {/* The label is cut short at its maximum width; `title` lets a pointer read the rest. */}
      <span
        className="tx-chip__label"
        title={title ?? (typeof children === 'string' ? children : undefined)}
      >
        {children}
      </span>
    </>
  );

  if (onToggle !== undefined) {
    return (
      <button
        type="button"
        className={classes}
        aria-pressed={selected}
        disabled={disabled}
        onClick={() => {
          onToggle(!selected);
        }}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={classes}>
      {content}
      {onRemove !== undefined && (
        <button
          type="button"
          className="tx-chip__remove"
          aria-label={removeLabel ?? 'Remove'}
          disabled={disabled}
          onClick={onRemove}
        >
          <Icon icon={X} size={14} />
        </button>
      )}
    </span>
  );
}

const REMOVE_SELECTOR = '.tx-chip__remove';

/**
 * Lays chips out in a wrapping row, as a list for assistive technology.
 *
 * Removing a chip takes away the button that was just pressed. So that keyboard focus is not
 * dropped to the top of the page, the list hands it to the remove button now in that place
 * (the next chip, else the last one), or to the list itself when no removable chip is left.
 */
export function ChipList({
  label,
  children,
}: {
  /** Accessible name of the list: "Tags". */
  readonly label: string;
  /** Each child is one chip; wrap each in `<li>`. */
  readonly children: ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  /** The remove button that was last pressed and its place among the list's remove buttons. */
  const pressed = useRef<{ readonly button: Element; readonly index: number } | null>(null);

  const removeButtons = (): HTMLElement[] =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>(REMOVE_SELECTOR) ?? []);

  // After every render: has the pressed button left the document, taking focus with it?
  useLayoutEffect(() => {
    const last = pressed.current;
    if (last === null || last.button.isConnected) return;
    pressed.current = null;
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) return;
    const buttons = removeButtons();
    (buttons[Math.min(last.index, buttons.length - 1)] ?? listRef.current)?.focus();
  });

  return (
    <ul
      ref={listRef}
      className="tx-chip-list"
      role="list"
      aria-label={label}
      tabIndex={-1}
      onClickCapture={(event) => {
        const button =
          event.target instanceof Element ? event.target.closest(REMOVE_SELECTOR) : null;
        pressed.current =
          button === null
            ? null
            : { button, index: removeButtons().findIndex((other) => other === button) };
      }}
    >
      {children}
    </ul>
  );
}
