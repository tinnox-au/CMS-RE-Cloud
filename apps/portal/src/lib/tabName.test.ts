import { describe, expect, it } from 'vitest';
import { reasonRepeatsNote } from './tabName.ts';

describe('reasonRepeatsNote', () => {
  it('finds a reason that starts with the note', () => {
    expect(reasonRepeatsNote('Planned', 'Planned for stage B')).toBe(true);
    expect(reasonRepeatsNote('Planned', 'Planned. Stock libraries wait for a decision')).toBe(true);
    expect(reasonRepeatsNote('Planned', 'planned for stage C, after a security review')).toBe(true);
    expect(reasonRepeatsNote(' Planned ', 'Planned')).toBe(true);
  });

  it('keeps the note when the reason says something else', () => {
    expect(reasonRepeatsNote('Planned', 'Stage B')).toBe(false);
    expect(reasonRepeatsNote('Plan', 'Planned for stage B')).toBe(false);
    expect(reasonRepeatsNote('3', 'Needs a paired player')).toBe(false);
    expect(reasonRepeatsNote(undefined, 'Planned for stage B')).toBe(false);
    expect(reasonRepeatsNote('Planned', undefined)).toBe(false);
    expect(reasonRepeatsNote('', 'Planned')).toBe(false);
  });
});
