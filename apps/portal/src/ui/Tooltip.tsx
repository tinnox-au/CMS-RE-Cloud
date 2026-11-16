import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { Placement } from '../lib/positioner.ts';
import { usePopover } from './usePopover.ts';

export interface TooltipProps {
  /** Short plain text. A tooltip is never the only place a label exists. */
  readonly content: string;
  /** Exactly one element: the control the tooltip belongs to. */
  readonly children: ReactElement<{ 'aria-describedby'?: string | undefined }>;
  readonly placement?: Placement;
  /**
   * Set when the text adds information to the control (a reason, a consequence). It is then
   * also exposed to assistive technology as the control's description. Leave unset when the
   * text only repeats the control's accessible name, as on an IconButton.
   */
  readonly describe?: boolean;
  readonly disabled?: boolean;
}

const SHOW_DELAY_MS = 400;
/** Long enough to move the pointer from the control onto the tooltip without it closing. */
const HIDE_DELAY_MS = 120;

/**
 * Shows on hover and on keyboard focus after 400 ms. Escape and a press dismiss it, and the
 * pointer can move onto the tooltip without it closing (WCAG 1.4.13).
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  describe = false,
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<Element | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const descriptionId = useId();

  const clearTimer = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const show = useCallback(
    (delay: number) => {
      clearTimer();
      timer.current = window.setTimeout(() => {
        anchorRef.current = wrapperRef.current?.firstElementChild ?? null;
        setOpen(anchorRef.current !== null);
      }, delay);
    },
    [clearTimer],
  );

  const hide = useCallback(
    (delay: number) => {
      clearTimer();
      if (delay === 0) setOpen(false);
      else {
        timer.current = window.setTimeout(() => {
          setOpen(false);
        }, delay);
      }
    },
    [clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  const visible = open && !disabled && content !== '';
  const hideNow = useCallback(() => {
    hide(0);
  }, [hide]);
  usePopover({
    open: visible,
    anchorRef,
    popoverRef,
    placement,
    gap: 8,
    onAnchorHidden: hideNow,
  });

  return (
    <span
      ref={wrapperRef}
      className="tx-tooltip-anchor"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') show(SHOW_DELAY_MS);
      }}
      onPointerLeave={() => {
        hide(HIDE_DELAY_MS);
      }}
      onPointerDown={() => {
        hide(0);
      }}
      onFocus={(event) => {
        if (event.target.matches(':focus-visible')) show(SHOW_DELAY_MS);
      }}
      onBlur={() => {
        hide(0);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !visible) return;
        // The first Escape dismisses only the tooltip (WCAG 1.4.13). Without this a tooltip
        // inside a dialog would take the dialog with it: preventing the default stops the
        // browser's `cancel` on the native <dialog>, and stopping propagation keeps a menu
        // or another Escape handler further up from acting on the same press.
        event.preventDefault();
        event.stopPropagation();
        hide(0);
      }}
    >
      {describe ? cloneElement(children, { 'aria-describedby': descriptionId }) : children}
      {describe && (
        <span id={descriptionId} className="tx-visually-hidden">
          {content}
        </span>
      )}
      {visible && (
        <span
          ref={popoverRef}
          className="tx-popover tx-popover--tooltip"
          popover="manual"
          aria-hidden="true"
        >
          <span className="tx-tooltip">{content}</span>
        </span>
      )}
    </span>
  );
}
