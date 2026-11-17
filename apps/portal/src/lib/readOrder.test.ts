import { describe, expect, it } from 'vitest';
import { createReadOrder } from './readOrder.ts';

describe('reads ordered against saves', () => {
  it('discards a read that began before the data was replaced', () => {
    const order = createReadOrder();
    const before = order.begin();
    order.invalidate();
    expect(order.isCurrent(before)).toBe(false);
  });

  it('keeps a read that began after the replacement, and one with no replacement at all', () => {
    const order = createReadOrder();
    const untouched = order.begin();
    expect(order.isCurrent(untouched)).toBe(true);
    order.invalidate();
    const after = order.begin();
    expect(order.isCurrent(after)).toBe(true);
  });

  it('discards every read that was in flight, however many replacements followed', () => {
    const order = createReadOrder();
    const first = order.begin();
    const second = order.begin();
    order.invalidate();
    order.invalidate();
    expect([order.isCurrent(first), order.isCurrent(second)]).toEqual([false, false]);
  });
});
