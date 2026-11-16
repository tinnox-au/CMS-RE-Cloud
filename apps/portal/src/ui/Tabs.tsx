import { Fragment, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { moveIndex, navActionForKey } from '../lib/keyboardNav.ts';
import { reasonRepeatsNote } from '../lib/tabName.ts';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import type { IconComponent } from './icons.ts';
import { Tooltip } from './Tooltip.tsx';

export interface TabItem<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly icon?: IconComponent;
  /** A tab that cannot be opened yet. It stays focusable so `disabledReason` can be read. */
  readonly disabled?: boolean;
  /** Why the tab is disabled, shown as a tooltip and read with its name: "Planned for stage B". */
  readonly disabledReason?: string;
  /**
   * Small text after the label, for example "Planned" or a count. When the tab is disabled
   * and `disabledReason` starts with the same word, the note is drawn but left out of the
   * accessible name, so the word is read once.
   */
  readonly note?: string;
}

export interface TabsProps<T extends string> {
  /** Prefix for the element ids; TabPanel uses the same value to find its tab. */
  readonly id: string;
  /** Accessible name of the tab list. */
  readonly label: string;
  readonly tabs: readonly TabItem<T>[];
  readonly value: T;
  readonly onChange: (id: T) => void;
  readonly className?: string;
}

const tabId = (base: string, id: string): string => `${base}-tab-${id}`;
const panelId = (base: string): string => `${base}-panel`;

/**
 * Underline tabs following the ARIA tabs pattern with automatic activation: Tab reaches the
 * selected tab, Arrow Left and Right move to and select the neighbouring tab (wrapping),
 * Home and End go to the ends. Render one TabPanel with the same `id` for the content.
 */
export function Tabs<T extends string>({
  id,
  label,
  tabs,
  value,
  onChange,
  className,
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = navActionForKey(event.key, 'horizontal');
    if (action === null) return;
    event.preventDefault();
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = moveIndex(current, tabs.length, action);
    const tab = tabs[next];
    if (tab === undefined) return;
    buttons[next]?.focus();
    if (tab.disabled !== true) onChange(tab.id);
  };

  return (
    <div
      ref={listRef}
      className={cx('tx-tabs', className)}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        const disabled = tab.disabled === true;
        const reason = disabled ? tab.disabledReason : undefined;
        // "Planned" as the note and "Planned for stage B" as the reason: say it once.
        const noteInName = !reasonRepeatsNote(tab.note, reason);
        const button = (
          <button
            type="button"
            role="tab"
            id={tabId(id, tab.id)}
            className="tx-tab"
            aria-selected={selected}
            aria-controls={selected ? panelId(id) : undefined}
            aria-disabled={disabled || undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!disabled) onChange(tab.id);
            }}
          >
            {tab.icon !== undefined && <Icon icon={tab.icon} size={18} />}
            {tab.label}
            {tab.note !== undefined && (
              <span className="tx-tab__note" aria-hidden={noteInName ? undefined : true}>
                {/* Keeps the label and the note apart in the tab's accessible name. */}
                {noteInName && <span className="tx-visually-hidden">, </span>}
                {tab.note}
              </span>
            )}
            {reason !== undefined && <span className="tx-visually-hidden">. {reason}</span>}
          </button>
        );
        // The reason is part of the tab's name above; the tooltip is its visible form.
        return reason !== undefined ? (
          <Tooltip key={tab.id} content={reason} placement="bottom">
            {button}
          </Tooltip>
        ) : (
          <Fragment key={tab.id}>{button}</Fragment>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  /** The `id` given to Tabs. */
  readonly tabs: string;
  /** The id of the tab whose content this is: the currently selected one. */
  readonly tab: string;
  readonly children: ReactNode;
  readonly className?: string;
}

/** The content area of the selected tab. Render the content for `tab` as its children. */
export function TabPanel({ tabs, tab, children, className }: TabPanelProps) {
  return (
    <div
      id={panelId(tabs)}
      className={cx('tx-tab-panel', className)}
      role="tabpanel"
      aria-labelledby={tabId(tabs, tab)}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
