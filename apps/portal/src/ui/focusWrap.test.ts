import { describe, expect, it } from 'vitest';
import { wrapFocusTarget } from './focusWrap.ts';

describe('Tab inside an open dialog', () => {
  const controls = ['close', 'name', 'cancel', 'save'];

  it('goes from the last control back to the first, and Shift+Tab the other way', () => {
    expect(wrapFocusTarget(controls, 'save', false)).toBe('close');
    expect(wrapFocusTarget(controls, 'close', true)).toBe('save');
  });

  it('leaves Tab between two controls to the browser', () => {
    expect(wrapFocusTarget(controls, 'name', false)).toBeNull();
    expect(wrapFocusTarget(controls, 'cancel', true)).toBeNull();
  });

  it('enters at the near end when focus is on the dialog itself or has escaped it', () => {
    expect(wrapFocusTarget(controls, null, false)).toBe('close');
    expect(wrapFocusTarget(controls, 'body', false)).toBe('close');
    expect(wrapFocusTarget(controls, 'body', true)).toBe('save');
  });

  it('does nothing in a dialog without controls', () => {
    expect(wrapFocusTarget([], null, false)).toBeNull();
  });
});
