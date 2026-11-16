import { describe, expect, it } from 'vitest';
import { DEFAULT_TOAST_DURATION_MS, pushToast, toastDuration } from './toastQueue.ts';

const toast = (id: string, sticky = false) => ({ id, sticky });
const ids = (toasts: readonly { readonly id: string }[]) => toasts.map((entry) => entry.id);

describe('toastDuration', () => {
  it('gives a message five seconds and keeps an error until it is dismissed', () => {
    expect(toastDuration(false, undefined)).toBe(DEFAULT_TOAST_DURATION_MS);
    expect(DEFAULT_TOAST_DURATION_MS).toBe(5000);
    expect(toastDuration(true, undefined)).toBeNull();
  });

  it('lets the caller decide either way', () => {
    expect(toastDuration(false, null)).toBeNull();
    expect(toastDuration(true, 8000)).toBe(8000);
    expect(toastDuration(false, 1200)).toBe(1200);
  });
});

describe('pushToast', () => {
  it('appends while there is room', () => {
    expect(ids(pushToast([], toast('a'), 3))).toEqual(['a']);
    expect(ids(pushToast([toast('a'), toast('b')], toast('c'), 3))).toEqual(['a', 'b', 'c']);
  });

  it('gives up the oldest toast when all of them leave by themselves', () => {
    const shown = [toast('a'), toast('b'), toast('c')];
    expect(ids(pushToast(shown, toast('d'), 3))).toEqual(['b', 'c', 'd']);
  });

  it('keeps an error on screen and gives up a passing toast instead', () => {
    const shown = [toast('error', true), toast('b'), toast('c')];
    expect(ids(pushToast(shown, toast('d'), 3))).toEqual(['error', 'c', 'd']);
  });

  it('keeps every error while a passing toast can go', () => {
    const shown = [toast('e1', true), toast('b'), toast('e2', true)];
    expect(ids(pushToast(shown, toast('d'), 3))).toEqual(['e1', 'e2', 'd']);
  });

  it('gives up the oldest error only when nothing else can go, never the new toast', () => {
    const shown = [toast('e1', true), toast('e2', true), toast('e3', true)];
    expect(ids(pushToast(shown, toast('d'), 3))).toEqual(['e2', 'e3', 'd']);
    expect(ids(pushToast(shown, toast('e4', true), 3))).toEqual(['e2', 'e3', 'e4']);
  });

  it('does not change the list it was given', () => {
    const shown = [toast('a'), toast('b'), toast('c')];
    pushToast(shown, toast('d'), 3);
    expect(ids(shown)).toEqual(['a', 'b', 'c']);
  });

  it('always shows the new toast, whatever the limit', () => {
    expect(ids(pushToast([toast('a')], toast('b'), 1))).toEqual(['b']);
    expect(ids(pushToast([toast('a')], toast('b'), 0))).toEqual(['b']);
  });
});
