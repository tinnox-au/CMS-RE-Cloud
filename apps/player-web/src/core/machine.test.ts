import { describe, expect, it, vi } from 'vitest';
import {
  heartbeatStateFor,
  isRegisteredPhase,
  PLAYER_PHASES,
  PlayerMachine,
  transition,
  type PlayerEvent,
  type PlayerPhase,
} from './machine.ts';

const ALL_EVENTS: PlayerEvent['type'][] = [
  'LEADERSHIP_WAITING',
  'NO_REGISTRATION',
  'REGISTRATION_LOADED',
  'REVOKED_REGISTRATION_LOADED',
  'PAIRING_CODE_ISSUED',
  'PAIRING_LOST',
  'PAIRED',
  'ITEM_STARTED',
  'NO_CONTENT',
  'PLAYBACK_FAILED',
  'REVOKED',
  'RESET_REQUESTED',
];

function run(start: PlayerPhase, ...events: PlayerEvent['type'][]): PlayerPhase {
  let phase = start;
  for (const type of events) {
    const result = transition(phase, { type });
    expect(result.valid, `${type} in ${phase}`).toBe(true);
    phase = result.phase;
  }
  return phase;
}

describe('player state machine', () => {
  it('walks the first-run journey: unpaired, pairing, idle, playing', () => {
    expect(run('booting', 'NO_REGISTRATION')).toBe('unpaired');
    expect(run('unpaired', 'PAIRING_CODE_ISSUED')).toBe('pairing');
    expect(run('pairing', 'PAIRED')).toBe('idle');
    expect(run('idle', 'ITEM_STARTED')).toBe('playing');
    expect(run('booting', 'NO_REGISTRATION', 'PAIRING_CODE_ISSUED', 'PAIRED', 'ITEM_STARTED')).toBe(
      'playing',
    );
  });

  it('requests a new code when the old one is lost, and can replace a code in place', () => {
    expect(run('pairing', 'PAIRING_LOST')).toBe('unpaired');
    expect(run('pairing', 'PAIRING_LOST', 'PAIRING_CODE_ISSUED')).toBe('pairing');
    expect(transition('pairing', { type: 'PAIRING_CODE_ISSUED' })).toEqual({
      phase: 'pairing',
      valid: true,
      changed: false,
    });
  });

  it('resumes from storage straight into idle, or into revoked', () => {
    expect(run('booting', 'REGISTRATION_LOADED')).toBe('idle');
    expect(run('booting', 'REVOKED_REGISTRATION_LOADED')).toBe('revoked');
    expect(run('booting', 'LEADERSHIP_WAITING', 'REGISTRATION_LOADED')).toBe('idle');
  });

  it('reports a fully failed playlist as faulted and recovers when an item plays', () => {
    expect(run('playing', 'PLAYBACK_FAILED')).toBe('faulted');
    expect(run('faulted', 'ITEM_STARTED')).toBe('playing');
    expect(run('faulted', 'NO_CONTENT')).toBe('idle');
    expect(run('idle', 'PLAYBACK_FAILED')).toBe('faulted');
  });

  it('enters revoked from every registered phase and only a reset leaves it', () => {
    for (const phase of ['idle', 'playing', 'faulted'] as const) {
      expect(run(phase, 'REVOKED')).toBe('revoked');
    }
    for (const type of ALL_EVENTS) {
      const result = transition('revoked', { type });
      if (type === 'RESET_REQUESTED') expect(result.phase).toBe('resetting');
      else expect(result.phase).toBe('revoked');
    }
  });

  it('cannot be revoked or start playing before it is registered', () => {
    for (const phase of ['booting', 'standby', 'unpaired', 'pairing'] as const) {
      expect(transition(phase, { type: 'REVOKED' }).valid).toBe(false);
      expect(transition(phase, { type: 'ITEM_STARTED' }).valid).toBe(false);
    }
    expect(transition('unpaired', { type: 'PAIRED' }).valid).toBe(false);
  });

  it('allows a local reset from every phase in which this tab runs the player', () => {
    for (const phase of ['unpaired', 'pairing', 'idle', 'playing', 'faulted', 'revoked'] as const) {
      expect(run(phase, 'RESET_REQUESTED')).toBe('resetting');
    }
    expect(transition('standby', { type: 'RESET_REQUESTED' }).valid).toBe(false);
    expect(transition('booting', { type: 'RESET_REQUESTED' }).valid).toBe(false);
  });

  it('treats resetting as terminal', () => {
    for (const type of ALL_EVENTS) {
      expect(transition('resetting', { type })).toEqual({
        phase: 'resetting',
        valid: false,
        changed: false,
      });
    }
  });

  it('never changes phase on an invalid event, for every phase and event', () => {
    for (const phase of PLAYER_PHASES) {
      for (const type of ALL_EVENTS) {
        const result = transition(phase, { type });
        if (!result.valid) expect(result).toEqual({ phase, valid: false, changed: false });
        expect(PLAYER_PHASES).toContain(result.phase);
      }
    }
  });

  it('maps phases to heartbeat states and sends none when not registered', () => {
    expect(heartbeatStateFor('idle')).toBe('idle');
    expect(heartbeatStateFor('playing')).toBe('playing');
    expect(heartbeatStateFor('faulted')).toBe('error');
    for (const phase of [
      'booting',
      'standby',
      'unpaired',
      'pairing',
      'revoked',
      'resetting',
    ] as const) {
      expect(heartbeatStateFor(phase)).toBeNull();
      expect(isRegisteredPhase(phase)).toBe(false);
    }
  });

  it('PlayerMachine notifies only real changes and reports ignored events', () => {
    const onChange = vi.fn();
    const onInvalid = vi.fn();
    const machine = new PlayerMachine(onChange, onInvalid);
    expect(machine.dispatch({ type: 'REGISTRATION_LOADED' })).toBe(true);
    expect(machine.dispatch({ type: 'ITEM_STARTED' })).toBe(true);
    expect(machine.dispatch({ type: 'ITEM_STARTED' })).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(machine.dispatch({ type: 'PAIRED' })).toBe(false);
    expect(onInvalid).toHaveBeenCalledWith('playing', { type: 'PAIRED' });
    expect(machine.phase).toBe('playing');
  });
});
