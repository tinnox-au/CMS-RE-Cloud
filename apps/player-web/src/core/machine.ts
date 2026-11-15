import type { PlayerState } from '@tinnox/contracts';

/**
 * Player lifecycle. One phase at a time; every change goes through `transition`.
 *
 *   booting ──► standby (another tab holds the player lock)
 *      │           │
 *      ▼           ▼
 *   unpaired ◄─► pairing ──► idle ◄──► playing
 *                              ▲  ╲      │
 *                              │   ▼     ▼
 *                              └── faulted        any registered phase ──► revoked
 *   any leader phase ──► resetting (the page reloads into `booting`)
 */
export const PLAYER_PHASES = [
  'booting',
  'standby',
  'unpaired',
  'pairing',
  'idle',
  'playing',
  'faulted',
  'revoked',
  'resetting',
] as const;
export type PlayerPhase = (typeof PLAYER_PHASES)[number];

export type PlayerEvent =
  /** Another tab is running the player; this one waits. */
  | { readonly type: 'LEADERSHIP_WAITING' }
  /** Nothing stored: this browser profile is not registered. */
  | { readonly type: 'NO_REGISTRATION' }
  /** A usable registration was loaded from storage. */
  | { readonly type: 'REGISTRATION_LOADED' }
  /** A registration that the server had already rejected was loaded from storage. */
  | { readonly type: 'REVOKED_REGISTRATION_LOADED' }
  /** The server issued a pairing code (first or replacement). */
  | { readonly type: 'PAIRING_CODE_ISSUED' }
  /** The code expired, was consumed elsewhere, or the session is gone. */
  | { readonly type: 'PAIRING_LOST' }
  /** An operator claimed the code and the device credential was stored. */
  | { readonly type: 'PAIRED' }
  /** The renderer put an item on screen. */
  | { readonly type: 'ITEM_STARTED' }
  /** There is no complete publication to play. */
  | { readonly type: 'NO_CONTENT' }
  /** Every item of the active publication failed to play. */
  | { readonly type: 'PLAYBACK_FAILED' }
  /** The server answered 401 to a player call. */
  | { readonly type: 'REVOKED' }
  /** Someone at the device asked for a local reset. */
  | { readonly type: 'RESET_REQUESTED' };

export type PlayerEventType = PlayerEvent['type'];

const TABLE: { readonly [P in PlayerPhase]: { readonly [E in PlayerEventType]?: PlayerPhase } } = {
  booting: {
    LEADERSHIP_WAITING: 'standby',
    NO_REGISTRATION: 'unpaired',
    REGISTRATION_LOADED: 'idle',
    REVOKED_REGISTRATION_LOADED: 'revoked',
  },
  standby: {
    LEADERSHIP_WAITING: 'standby',
    NO_REGISTRATION: 'unpaired',
    REGISTRATION_LOADED: 'idle',
    REVOKED_REGISTRATION_LOADED: 'revoked',
  },
  unpaired: {
    PAIRING_CODE_ISSUED: 'pairing',
    RESET_REQUESTED: 'resetting',
  },
  pairing: {
    PAIRING_CODE_ISSUED: 'pairing',
    PAIRING_LOST: 'unpaired',
    PAIRED: 'idle',
    RESET_REQUESTED: 'resetting',
  },
  idle: {
    ITEM_STARTED: 'playing',
    NO_CONTENT: 'idle',
    PLAYBACK_FAILED: 'faulted',
    REVOKED: 'revoked',
    RESET_REQUESTED: 'resetting',
  },
  playing: {
    ITEM_STARTED: 'playing',
    NO_CONTENT: 'idle',
    PLAYBACK_FAILED: 'faulted',
    REVOKED: 'revoked',
    RESET_REQUESTED: 'resetting',
  },
  faulted: {
    ITEM_STARTED: 'playing',
    NO_CONTENT: 'idle',
    PLAYBACK_FAILED: 'faulted',
    REVOKED: 'revoked',
    RESET_REQUESTED: 'resetting',
  },
  revoked: {
    // A revoked player never resumes on its own; only a local reset leaves this phase.
    REVOKED: 'revoked',
    RESET_REQUESTED: 'resetting',
  },
  resetting: {},
};

export interface TransitionResult {
  readonly phase: PlayerPhase;
  /** False when the event is not allowed in this phase; the phase is then unchanged. */
  readonly valid: boolean;
  readonly changed: boolean;
}

export function transition(phase: PlayerPhase, event: PlayerEvent): TransitionResult {
  const next = TABLE[phase][event.type];
  if (next === undefined) return { phase, valid: false, changed: false };
  return { phase: next, valid: true, changed: next !== phase };
}

/** Phases in which the player holds a credential and may talk to the player API. */
export function isRegisteredPhase(phase: PlayerPhase): boolean {
  return phase === 'idle' || phase === 'playing' || phase === 'faulted';
}

/** Heartbeat `playerState` for a phase, or null when no heartbeat may be sent. */
export function heartbeatStateFor(phase: PlayerPhase): PlayerState | null {
  switch (phase) {
    case 'idle':
      return 'idle';
    case 'playing':
      return 'playing';
    case 'faulted':
      return 'error';
    default:
      return null;
  }
}

/** Small holder that applies events and tells a listener about real changes. */
export class PlayerMachine {
  #phase: PlayerPhase = 'booting';
  readonly #onChange: (phase: PlayerPhase, previous: PlayerPhase, event: PlayerEvent) => void;
  readonly #onInvalid: (phase: PlayerPhase, event: PlayerEvent) => void;

  constructor(
    onChange: (phase: PlayerPhase, previous: PlayerPhase, event: PlayerEvent) => void,
    onInvalid: (phase: PlayerPhase, event: PlayerEvent) => void = () => undefined,
  ) {
    this.#onChange = onChange;
    this.#onInvalid = onInvalid;
  }

  get phase(): PlayerPhase {
    return this.#phase;
  }

  /** Returns true when the event was allowed in the current phase. */
  dispatch(event: PlayerEvent): boolean {
    const previous = this.#phase;
    const result = transition(previous, event);
    if (!result.valid) {
      this.#onInvalid(previous, event);
      return false;
    }
    this.#phase = result.phase;
    if (result.changed) this.#onChange(result.phase, previous, event);
    return true;
  }
}
