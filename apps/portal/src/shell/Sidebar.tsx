import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon, IconButton, Menu, MenuItem, MenuLabel, Tooltip, cx } from '../ui/index.ts';
import { ChevronDown, PanelLeftClose, PanelLeftOpen, X } from '../ui/icons.ts';
import {
  FOOTER_NAV,
  HOME_PATH,
  PRIMARY_NAV,
  activeGroupId,
  activeNavId,
  navItemName,
  type NavGroupItem,
  type NavLinkItem,
} from './nav.ts';
import { Wordmark } from './Wordmark.tsx';

export interface SidebarProps {
  /** Under 900 px: the sidebar is an overlay drawer instead of a column. */
  readonly drawer: boolean;
  /** Whether the drawer is showing. Ignored outside drawer mode. */
  readonly open: boolean;
  /** The person asked to close the drawer: its close button, Escape, or the backdrop. */
  readonly onClose: () => void;
  /** Icons only, with tooltips. Ignored in drawer mode. */
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  /** A navigation link was pressed. The shell closes the drawer and moves focus to the page. */
  readonly onNavigate: (to: string) => void;
}

interface RowContext {
  readonly activeId: string | null;
  /** Icons only: labels are kept for assistive technology and shown as tooltips. */
  readonly compact: boolean;
  readonly onNavigate: (to: string) => void;
}

function NavLinkRow({
  item,
  sub = false,
  context,
}: {
  readonly item: NavLinkItem;
  readonly sub?: boolean;
  readonly context: RowContext;
}) {
  return (
    <Tooltip content={navItemName(item)} placement="right" disabled={!context.compact}>
      <Link
        to={item.to}
        className={cx('tx-nav__item', sub && 'tx-nav__item--sub')}
        aria-current={context.activeId === item.id ? 'page' : undefined}
        onClick={() => {
          context.onNavigate(item.to);
        }}
      >
        <Icon icon={item.icon} size={sub ? 16 : 18} className="tx-nav__icon" />
        <span className="tx-nav__label">{item.label}</span>
        {item.planned === true && (
          <span className="tx-nav__planned">
            {/* Keeps the label and the pill apart in the link's accessible name. */}
            <span className="tx-visually-hidden">, </span>
            Planned
          </span>
        )}
      </Link>
    </Tooltip>
  );
}

/** A disclosure group: a button that shows or hides the links under it. */
function NavGroup({
  item,
  open,
  onToggle,
  context,
}: {
  readonly item: NavGroupItem;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly context: RowContext;
}) {
  const listId = useId();
  const holdsCurrent = item.children.some((child) => child.id === context.activeId);
  return (
    <li>
      <button
        type="button"
        className={cx('tx-nav__item', holdsCurrent && !open && 'tx-nav__item--holds-current')}
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
      >
        <Icon icon={item.icon} size={18} className="tx-nav__icon" />
        <span className="tx-nav__label">{item.label}</span>
        <Icon icon={ChevronDown} size={16} className="tx-nav__chevron" />
      </button>
      <ul id={listId} className="tx-nav__sub" role="list" hidden={!open}>
        {item.children.map((child) => (
          <li key={child.id}>
            <NavLinkRow item={child} sub context={context} />
          </li>
        ))}
      </ul>
    </li>
  );
}

/** The same group in the collapsed sidebar: one icon that opens its links as a menu. */
function NavGroupMenu({
  item,
  context,
}: {
  readonly item: NavGroupItem;
  readonly context: RowContext;
}) {
  const holdsCurrent = item.children.some((child) => child.id === context.activeId);
  return (
    <li>
      <Menu
        placement="right-start"
        trigger={(props) => (
          <Tooltip content={item.label} placement="right" disabled={props['aria-expanded']}>
            <button
              {...props}
              type="button"
              className={cx('tx-nav__item', holdsCurrent && 'tx-nav__item--holds-current')}
            >
              <Icon icon={item.icon} size={18} className="tx-nav__icon" />
              <span className="tx-nav__label">{item.label}</span>
            </button>
          </Tooltip>
        )}
      >
        <MenuLabel>{item.label}</MenuLabel>
        {item.children.map((child) => (
          <MenuItem
            key={child.id}
            icon={child.icon}
            to={child.to}
            hint={child.planned === true ? 'Planned' : undefined}
          >
            {child.label}
          </MenuItem>
        ))}
      </Menu>
    </li>
  );
}

/** True when a press on the dialog element landed outside its box, that is, on the backdrop. */
function isOnBackdrop(event: MouseEvent<HTMLDialogElement>): boolean {
  if (event.target !== event.currentTarget) return false;
  const box = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

/**
 * The drawer is a native modal `<dialog>`: the browser makes the page behind it inert, keeps
 * Tab inside, closes on Escape, and returns focus to the menu button that opened it.
 */
function NavDrawer({
  open,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closedByCode = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      closedByCode.current = true;
      dialog.close();
    }
  }, [open]);

  // Leaving drawer mode (the window grew) must not leave a modal behind.
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open === true) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="tx-drawer"
      aria-label="Navigation"
      onCancel={(event) => {
        // Escape. The shell owns `open`, so the element does not close itself.
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (closedByCode.current) {
          closedByCode.current = false;
          return;
        }
        // The browser closed it on its own (a second Escape in Chromium).
        if (open) onClose();
      }}
      onClick={(event) => {
        if (isOnBackdrop(event)) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

/**
 * The navigation sidebar (design-system.md, section 4): the wordmark with its "Prototype"
 * capsule, the sections from `nav.ts` with the Media disclosure group, Settings at the
 * bottom and a collapse button. It sits flat on the page grey with a hairline on its right.
 *
 * - The Media group opens on every navigation to a media route; it can be closed by hand.
 * - Collapsed, it shows icons with tooltips and Media opens as a menu. The choice is held
 *   in memory by `AppShell` for the page session (the portal uses no web storage).
 * - In drawer mode it is a modal dialog opened from the header's menu button.
 */
export function Sidebar({
  drawer,
  open,
  onClose,
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: SidebarProps) {
  const { pathname } = useLocation();
  const activeId = activeNavId(pathname);
  const activeGroup = activeGroupId(pathname);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(activeGroup === null ? [] : [activeGroup]),
  );
  // Open the group of the page just navigated to. Adjusting state while rendering (rather
  // than in an effect) avoids painting the closed group first.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (activeGroup !== null && !openGroups.has(activeGroup)) {
      setOpenGroups(new Set([...openGroups, activeGroup]));
    }
  }

  const toggleGroup = (id: string) => {
    const next = new Set(openGroups);
    if (!next.delete(id)) next.add(id);
    setOpenGroups(next);
  };

  const compact = collapsed && !drawer;
  const context: RowContext = { activeId, compact, onNavigate };

  const body = (
    <>
      <div className="tx-sidebar__head">
        <Wordmark
          to={HOME_PATH}
          compact={compact}
          tag
          onClick={() => {
            onNavigate(HOME_PATH);
          }}
        />
        {drawer && (
          <IconButton icon={X} label="Close navigation" tooltip={false} onClick={onClose} />
        )}
      </div>
      <nav className="tx-sidebar__nav" aria-label="Main">
        <div className="tx-sidebar__scroll">
          <ul className="tx-nav__list" role="list">
            {PRIMARY_NAV.map((item) =>
              item.kind === 'link' ? (
                <li key={item.id}>
                  <NavLinkRow item={item} context={context} />
                </li>
              ) : compact ? (
                <NavGroupMenu key={item.id} item={item} context={context} />
              ) : (
                <NavGroup
                  key={item.id}
                  item={item}
                  open={openGroups.has(item.id)}
                  onToggle={() => {
                    toggleGroup(item.id);
                  }}
                  context={context}
                />
              ),
            )}
          </ul>
        </div>
        <div className="tx-sidebar__foot">
          <ul className="tx-nav__list" role="list">
            {FOOTER_NAV.map((item) => (
              <li key={item.id}>
                <NavLinkRow item={item} context={context} />
              </li>
            ))}
          </ul>
        </div>
      </nav>
      {!drawer && (
        <div className="tx-sidebar__collapse">
          <Tooltip
            content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            placement="right"
            disabled={!collapsed}
          >
            <button type="button" className="tx-nav__item" onClick={onToggleCollapsed}>
              <Icon
                icon={collapsed ? PanelLeftOpen : PanelLeftClose}
                size={18}
                className="tx-nav__icon"
              />
              <span className="tx-nav__label">
                {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              </span>
            </button>
          </Tooltip>
        </div>
      )}
    </>
  );

  if (drawer) {
    return (
      <NavDrawer open={open} onClose={onClose}>
        <div className="tx-sidebar tx-sidebar--drawer">{body}</div>
      </NavDrawer>
    );
  }
  return <div className={cx('tx-sidebar', collapsed && 'tx-sidebar--collapsed')}>{body}</div>;
}
