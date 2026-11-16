import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { computePosition, type Placement } from '../lib/positioner.ts';

export interface PopoverOptions {
  readonly open: boolean;
  /** The element the popover is attached to. */
  readonly anchorRef: RefObject<Element | null>;
  /** The `.tx-popover` wrapper. It must be rendered only while `open` is true. */
  readonly popoverRef: RefObject<HTMLElement | null>;
  readonly placement: Placement;
  readonly gap?: number;
  /**
   * Called when the anchor is no longer on screen: scrolled out of the viewport, or hidden.
   * The owner closes the popover, which would otherwise stay pinned to the viewport's edge
   * with nothing beside it to say what it belongs to.
   */
  readonly onAnchorHidden?: () => void;
}

function showInTopLayer(element: HTMLElement): void {
  if (typeof element.showPopover !== 'function') return;
  try {
    element.showPopover();
  } catch {
    // Already showing, or no longer in the document: nothing to do.
  }
}

function hideFromTopLayer(element: HTMLElement): void {
  if (typeof element.hidePopover !== 'function') return;
  try {
    element.hidePopover();
  } catch {
    // Not showing: nothing to do.
  }
}

/**
 * Shows a `.tx-popover` wrapper and keeps it attached to its anchor.
 *
 * With the native Popover API (`popover="manual"`) the wrapper is promoted to the browser's
 * top layer, above dialogs and outside every clipping ancestor. Without it the wrapper is a
 * plain fixed-position element; the measurement below then also corrects for an ancestor
 * that establishes its own containing block (a transform or a backdrop filter).
 *
 * The geometry lives in lib/positioner.ts. Coordinates are written as CSS custom
 * properties through the CSSOM, which the Content-Security-Policy allows.
 */
export function usePopover({
  open,
  anchorRef,
  popoverRef,
  placement,
  gap,
  onAnchorHidden,
}: PopoverOptions): void {
  const applied = useRef({ x: 0, y: 0 });
  // The newest callback, without restarting the placement effect when its identity changes.
  const anchorHidden = useRef(onAnchorHidden);
  useEffect(() => {
    anchorHidden.current = onAnchorHidden;
  }, [onAnchorHidden]);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!open || popover === null) return;
    applied.current = { x: 0, y: 0 };
    showInTopLayer(popover);

    const place = (): void => {
      const anchor = anchorRef.current;
      if (anchor === null || !popover.isConnected) return;
      const box = popover.getBoundingClientRect();
      // Where the wrapper's containing block starts: the viewport in the top layer.
      const originX = box.left - applied.current.x;
      const originY = box.top - applied.current.y;
      const content =
        popover.firstElementChild instanceof HTMLElement ? popover.firstElementChild : null;
      // The content may already be height-limited and scrolling; scrollHeight is its natural height.
      const naturalHeight =
        content === null
          ? popover.offsetHeight
          : content.scrollHeight + (content.offsetHeight - content.clientHeight);
      const root = document.documentElement;
      const viewport = { width: root.clientWidth, height: root.clientHeight };
      const anchorBox = anchor.getBoundingClientRect();
      if (
        anchorBox.bottom <= 0 ||
        anchorBox.right <= 0 ||
        anchorBox.top >= viewport.height ||
        anchorBox.left >= viewport.width
      ) {
        anchorHidden.current?.();
        return;
      }
      const position = computePosition({
        anchor: anchorBox,
        popover: { width: popover.offsetWidth, height: naturalHeight },
        viewport,
        placement,
        ...(gap === undefined ? {} : { gap }),
      });
      applied.current = { x: position.x - originX, y: position.y - originY };
      popover.style.setProperty('--tx-pop-x', `${applied.current.x}px`);
      popover.style.setProperty('--tx-pop-y', `${applied.current.y}px`);
      popover.style.setProperty('--tx-pop-max-w', `${position.maxWidth}px`);
      popover.style.setProperty('--tx-pop-max-h', `${position.maxHeight}px`);
      popover.dataset.side = position.side;
      popover.dataset.placed = '';
    };

    place();

    let frame = 0;
    const schedule = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(popover);
    if (anchorRef.current !== null) observer?.observe(anchorRef.current);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, { capture: true });
      observer?.disconnect();
      hideFromTopLayer(popover);
    };
  }, [open, anchorRef, popoverRef, placement, gap]);
}
