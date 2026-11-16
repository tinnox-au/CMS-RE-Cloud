import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Link } from 'react-router-dom';
import { isTypeaheadKey, moveIndex, navActionForKey, typeaheadMatch } from '../lib/keyboardNav.ts';
import type { Placement } from '../lib/positioner.ts';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { Check, type IconComponent } from './icons.ts';
import { usePopover } from './usePopover.ts';

/** Spread these on the element that opens the menu (a Button or an IconButton). */
export interface MenuTriggerProps {
  readonly ref: Ref<HTMLButtonElement>;
  readonly id: string;
  readonly 'aria-haspopup': 'menu';
  readonly 'aria-expanded': boolean;
  readonly 'aria-controls': string | undefined;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export interface MenuProps {
  /** Renders the button that opens the menu. */
  readonly trigger: (props: MenuTriggerProps) => ReactNode;
  /** MenuItem, MenuSeparator, MenuLabel and MenuHeader elements. */
  readonly children: ReactNode;
  /**
   * Accessible name of the menu when it should differ from the trigger's own name.
   * By default the menu is named by its trigger.
   */
  readonly label?: string;
  readonly placement?: Placement;
  readonly onOpenChange?: (open: boolean) => void;
}

interface MenuContextValue {
  /** Closes the menu and returns focus to the trigger. */
  readonly close: () => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

const ITEM_SELECTOR = '[role^="menuitem"]';
const TYPEAHEAD_RESET_MS = 600;

type FocusTarget = 'first' | 'last' | 'menu';

/**
 * A menu button following the ARIA menu-button pattern.
 *
 * Keyboard: Enter, Space or Arrow Down on the trigger opens the menu on its first item,
 * Arrow Up on its last. Inside: arrows move (wrapping, skipping disabled items), Home and
 * End jump, letters jump to the next matching item, Enter or Space activates, Escape closes
 * and returns focus to the trigger, Tab closes and moves on.
 */
export function Menu({
  trigger,
  children,
  label,
  placement = 'bottom-start',
  onOpenChange,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const focusOnOpen = useRef<FocusTarget>('menu');
  const typed = useRef({ text: '', at: 0 });
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const menuId = `${baseId}-menu`;

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const openMenu = useCallback(
    (focus: FocusTarget) => {
      focusOnOpen.current = focus;
      typed.current = { text: '', at: 0 };
      setOpenState(true);
    },
    [setOpenState],
  );

  const close = useCallback(() => {
    // Focus first: the item that has focus is about to leave the document.
    triggerRef.current?.focus();
    setOpenState(false);
  }, [setOpenState]);

  // The trigger was scrolled off the screen: the menu goes with it. Focus returns to the
  // trigger without scrolling it back into view, which would undo what the person just did.
  const closeDetached = useCallback(() => {
    triggerRef.current?.focus({ preventScroll: true });
    setOpenState(false);
  }, [setOpenState]);

  usePopover({
    open,
    anchorRef: triggerRef,
    popoverRef,
    placement,
    onAnchorHidden: closeDetached,
  });

  const items = useCallback((): HTMLElement[] => {
    const menu = menuRef.current;
    return menu === null ? [] : Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
  }, []);

  // Move focus into the menu once it is in the document.
  useEffect(() => {
    if (!open) return;
    const all = items();
    const disabled = (index: number) => all[index]?.getAttribute('aria-disabled') === 'true';
    const target = focusOnOpen.current;
    const index =
      target === 'menu'
        ? -1
        : moveIndex(-1, all.length, target === 'first' ? 'next' : 'previous', disabled);
    (all[index] ?? menuRef.current)?.focus({ preventScroll: true });
  }, [open, items]);

  // A press anywhere else closes the menu and leaves focus where the press put it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target) === true) return;
      if (triggerRef.current?.contains(target) === true) return;
      setOpenState(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, setOpenState]);

  const onTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (open) {
      setOpenState(false);
      return;
    }
    // detail 0 means the click came from the keyboard (Enter or Space).
    openMenu(event.detail === 0 ? 'first' : 'menu');
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(event.key === 'ArrowDown' ? 'first' : 'last');
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpenState(false);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') {
      // Hand focus back to the trigger and let the browser move on from there.
      close();
      return;
    }
    if (event.key === ' ') {
      // Space activates a button item natively. A link item needs help: on a link the
      // browser would scroll the page instead.
      const focused = document.activeElement;
      if (focused instanceof HTMLAnchorElement && menuRef.current?.contains(focused) === true) {
        event.preventDefault();
        focused.click();
      }
      return;
    }
    const all = items();
    const current = all.indexOf(document.activeElement as HTMLElement);
    const disabled = (index: number) => all[index]?.getAttribute('aria-disabled') === 'true';
    const action = navActionForKey(event.key, 'vertical');
    if (action !== null) {
      event.preventDefault();
      all[moveIndex(current, all.length, action, disabled)]?.focus();
      return;
    }
    if (isTypeaheadKey(event)) {
      event.preventDefault();
      const now = performance.now();
      const text = now - typed.current.at > TYPEAHEAD_RESET_MS ? '' : typed.current.text;
      typed.current = { text: text + event.key, at: now };
      const labels = all.map((item) => item.dataset.label ?? item.textContent ?? '');
      all[typeaheadMatch(labels, typed.current.text, current, disabled)]?.focus();
    }
  };

  const context = useMemo<MenuContextValue>(() => ({ close }), [close]);

  return (
    <>
      {trigger({
        ref: triggerRef,
        id: triggerId,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        onClick: onTriggerClick,
        onKeyDown: onTriggerKeyDown,
      })}
      {open && (
        <span ref={popoverRef} className="tx-popover" popover="manual">
          <span
            ref={menuRef}
            id={menuId}
            className="tx-menu"
            role="menu"
            tabIndex={-1}
            {...(label === undefined ? { 'aria-labelledby': triggerId } : { 'aria-label': label })}
            onKeyDown={onMenuKeyDown}
          >
            <MenuContext value={context}>{children}</MenuContext>
          </span>
        </span>
      )}
    </>
  );
}

export interface MenuItemProps {
  readonly children: ReactNode;
  readonly icon?: IconComponent;
  /** Destructive items are red and belong after a MenuSeparator, at the end. */
  readonly tone?: 'default' | 'danger';
  readonly disabled?: boolean;
  /** Runs after the menu has closed and focus is back on the trigger. */
  readonly onSelect?: () => void;
  /** Makes the item a link to an in-app route. */
  readonly to?: string;
  /** Short text at the end of the row, for example a count. */
  readonly hint?: string;
  /**
   * For choices: `radio` for one of several, `checkbox` for an independent setting.
   * The item then reports `checked` and shows a tick.
   */
  readonly type?: 'item' | 'radio' | 'checkbox';
  readonly checked?: boolean;
}

const ITEM_ROLE = {
  item: 'menuitem',
  radio: 'menuitemradio',
  checkbox: 'menuitemcheckbox',
} as const;

export function MenuItem({
  children,
  icon,
  tone = 'default',
  disabled = false,
  onSelect,
  to,
  hint,
  type = 'item',
  checked = false,
}: MenuItemProps) {
  const menu = useContext(MenuContext);
  if (menu === null) throw new Error('MenuItem must be rendered inside a Menu');

  const className = cx('tx-menu__item', tone === 'danger' && 'tx-menu__item--danger');
  const content = (
    <>
      {icon !== undefined && <Icon icon={icon} size={18} className="tx-menu__item-icon" />}
      <span className="tx-menu__item-label">{children}</span>
      {hint !== undefined && (
        <span className="tx-menu__item-hint">
          {/* Keeps the label and the hint apart in the item's accessible name. */}
          <span className="tx-visually-hidden">, </span>
          {hint}
        </span>
      )}
      {type !== 'item' && <Icon icon={Check} size={16} className="tx-menu__item-check" />}
    </>
  );
  const shared = {
    className,
    role: ITEM_ROLE[type],
    tabIndex: -1,
    'aria-disabled': disabled || undefined,
    'aria-checked': type === 'item' ? undefined : checked,
  };
  const activate = (event: MouseEvent<HTMLElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    menu.close();
    onSelect?.();
  };

  if (to !== undefined && !disabled) {
    return (
      <Link {...shared} to={to} onClick={activate}>
        {content}
      </Link>
    );
  }
  return (
    <button {...shared} type="button" onClick={activate}>
      {content}
    </button>
  );
}

/** A hairline between groups of items. */
export function MenuSeparator() {
  return <span className="tx-menu__separator" role="separator" />;
}

/** A caption above a group of items. */
export function MenuLabel({ children }: { readonly children: ReactNode }) {
  return (
    <span className="tx-menu__label" role="presentation">
      {children}
    </span>
  );
}

/** Free content at the top of a menu, for example the signed-in name in the account menu. */
export function MenuHeader({ children }: { readonly children: ReactNode }) {
  return (
    <span className="tx-menu__header" role="presentation">
      {children}
    </span>
  );
}
