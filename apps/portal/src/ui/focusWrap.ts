/**
 * Where Tab goes inside an open modal dialog. `showModal()` makes the page inert, but from
 * the last control the browser still moves focus out of the dialog (to the document, then
 * the browser's own controls) before it comes back (FCU-06 in
 * docs/reviews/2026-11-17-frontend-round-2). The dialog therefore wraps focus itself.
 *
 * Returns the element to focus, or null to let the browser move focus as usual.
 */
export function wrapFocusTarget<T>(
  focusable: readonly T[],
  active: T | null,
  backwards: boolean,
): T | null {
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) return null;
  const index = active === null ? -1 : focusable.indexOf(active);
  // Focus on the dialog itself, or on something outside the list: enter at the near end.
  if (index === -1) return backwards ? last : first;
  if (backwards && index === 0) return last;
  if (!backwards && index === focusable.length - 1) return first;
  return null;
}

const TABBABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** The controls Tab can reach in `root`, in order: enabled, and not hidden by layout. */
function tabbable(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) => element.getClientRects().length > 0 && element.closest('[inert]') === null,
  );
}

/** keydown handler for a modal `<dialog>`: keeps Tab and Shift+Tab inside it. */
export function keepTabInside(event: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly currentTarget: Element;
  preventDefault(): void;
}): void {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const target = wrapFocusTarget(tabbable(event.currentTarget), active, event.shiftKey);
  if (target === null) return;
  event.preventDefault();
  target.focus();
}
