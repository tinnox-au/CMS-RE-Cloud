import { describe, expect, it } from 'vitest';
import { meterFraction, meterPercentLabel, meterTone } from './meter.ts';

describe('meter', () => {
  it('gives the used share, clamped to the range', () => {
    expect(meterFraction(1, 4)).toBe(0.25);
    expect(meterFraction(9, 4)).toBe(1);
    expect(meterFraction(-1, 4)).toBe(0);
  });

  it('reads a missing or zero limit as empty', () => {
    expect(meterFraction(1, 0)).toBe(0);
    expect(meterFraction(Number.NaN, 4)).toBe(0);
    expect(meterFraction(1, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('turns to attention at 80 per cent and danger at 95 per cent', () => {
    expect(meterTone(0)).toBe('ok');
    expect(meterTone(0.79)).toBe('ok');
    expect(meterTone(0.8)).toBe('warn');
    expect(meterTone(0.949)).toBe('warn');
    expect(meterTone(0.95)).toBe('danger');
    expect(meterTone(1)).toBe('danger');
  });

  it('never rounds a little to nothing or nearly full to full', () => {
    expect(meterPercentLabel(0)).toBe('0%');
    expect(meterPercentLabel(0.001)).toBe('1%');
    expect(meterPercentLabel(0.374)).toBe('37%');
    expect(meterPercentLabel(0.999)).toBe('99%');
    expect(meterPercentLabel(1)).toBe('100%');
  });
});
