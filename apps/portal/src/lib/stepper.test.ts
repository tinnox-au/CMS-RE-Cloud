import { describe, expect, it } from 'vitest';
import {
  canStep,
  clampToBounds,
  formatStepperValue,
  parseStepperValue,
  stepValue,
} from './stepper.ts';

const SECONDS = { min: 1, max: 3600, step: 1 };

describe('parseStepperValue', () => {
  it('reads plain decimal numbers', () => {
    expect(parseStepperValue('10')).toBe(10);
    expect(parseStepperValue(' 2.5 ')).toBe(2.5);
    expect(parseStepperValue('.5')).toBe(0.5);
    expect(parseStepperValue('-3')).toBe(-3);
  });

  it('answers null for anything else', () => {
    for (const text of ['', ' ', 'ten', '1e3', '1,5', '0x10', '1.2.3', '--1']) {
      expect(parseStepperValue(text), text).toBeNull();
    }
  });
});

describe('stepValue', () => {
  it('steps up and down by one', () => {
    expect(stepValue('10', 1, SECONDS)).toBe('11');
    expect(stepValue('10', -1, SECONDS)).toBe('9');
  });

  it('stops at the bounds', () => {
    expect(stepValue('3600', 1, SECONDS)).toBe('3600');
    expect(stepValue('1', -1, SECONDS)).toBe('1');
    expect(stepValue('99999', -1, SECONDS)).toBe('3600');
    expect(stepValue('-5', 1, SECONDS)).toBe('1');
  });

  it('starts an empty or unreadable field at the minimum', () => {
    expect(stepValue('', 1, SECONDS)).toBe('1');
    expect(stepValue('abc', -1, SECONDS)).toBe('1');
  });

  it('moves a value between grid points to the next point in that direction', () => {
    expect(stepValue('4.5', 1, SECONDS)).toBe('5');
    expect(stepValue('4.5', -1, SECONDS)).toBe('4');
    const fives = { min: 0, max: 100, step: 5 };
    expect(stepValue('12', 1, fives)).toBe('15');
    expect(stepValue('12', -1, fives)).toBe('10');
    expect(stepValue('15', 1, fives)).toBe('20');
  });

  it('takes a larger stride for Page Up and Page Down', () => {
    expect(stepValue('10', 1, SECONDS, 10)).toBe('20');
    expect(stepValue('10', -1, SECONDS, 10)).toBe('1');
    expect(stepValue('4.5', 1, SECONDS, 10)).toBe('14');
  });

  it('keeps fractional steps free of floating-point dust', () => {
    const tenths = { min: 0, max: 1, step: 0.1 };
    expect(stepValue('0.2', 1, tenths)).toBe('0.3');
    expect(stepValue('0.7', 1, tenths)).toBe('0.8');
    expect(stepValue('0.3', -1, tenths)).toBe('0.2');
  });

  it('treats a non-positive step as one', () => {
    expect(stepValue('5', 1, { min: 0, max: 10, step: 0 })).toBe('6');
  });
});

describe('helpers', () => {
  it('formats without trailing zeros', () => {
    expect(formatStepperValue(0.30000000000000004, 0.1)).toBe('0.3');
    expect(formatStepperValue(12, 1)).toBe('12');
    expect(formatStepperValue(2.5, 0.25)).toBe('2.5');
  });

  it('clamps', () => {
    expect(clampToBounds(0, SECONDS)).toBe(1);
    expect(clampToBounds(5000, SECONDS)).toBe(3600);
    expect(clampToBounds(30, SECONDS)).toBe(30);
  });

  it('knows when a direction is exhausted', () => {
    expect(canStep('1', -1, SECONDS)).toBe(false);
    expect(canStep('1', 1, SECONDS)).toBe(true);
    expect(canStep('3600', 1, SECONDS)).toBe(false);
    expect(canStep('', -1, SECONDS)).toBe(true);
    expect(canStep('99999', 1, SECONDS)).toBe(false);
    expect(canStep('99999', -1, SECONDS)).toBe(true);
  });
});
