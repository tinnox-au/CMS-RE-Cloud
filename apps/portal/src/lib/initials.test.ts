import { describe, expect, it } from 'vitest';
import { initials } from './initials.ts';

describe('initials', () => {
  it('takes the first letters of the first and last words', () => {
    expect(initials('Operator')).toBe('O');
    expect(initials('Mia Chen')).toBe('MC');
    expect(initials('mia van der berg')).toBe('MB');
    expect(initials('  Workshop   Operator  ')).toBe('WO');
  });

  it('splits sign-in names and skips punctuation', () => {
    expect(initials('second-operator')).toBe('SO');
    expect(initials('ops.team@example.test')).toBe('OT');
    expect(initials('(TINNOX) Internal')).toBe('TI');
  });

  it('handles accents, digits and nothing at all', () => {
    expect(initials('élodie Ångström')).toBe('ÉÅ');
    expect(initials('Display 7')).toBe('D7');
    expect(initials('')).toBe('?');
    expect(initials(' - ')).toBe('?');
  });
});
