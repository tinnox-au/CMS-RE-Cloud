import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)';

/**
 * For a picker dialog whose list arrives after it opened. When the load settles:
 * - the choice that is already made is scrolled into view, so a long list does not hide it;
 * - if the control that had the focus has gone (the search field of a list that turned out
 *   empty), focus moves to the first control that is there now instead of falling to the page.
 */
export function useSettledFocus(
  bodyRef: RefObject<HTMLElement | null>,
  status: 'loading' | 'error' | 'ready',
): void {
  useEffect(() => {
    const body = bodyRef.current;
    if (status === 'loading' || body === null) return;
    body.querySelector('input:checked')?.scrollIntoView({ block: 'center' });
    const focused = document.activeElement;
    if (focused === null || focused === document.body) {
      body.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
  }, [bodyRef, status]);
}
