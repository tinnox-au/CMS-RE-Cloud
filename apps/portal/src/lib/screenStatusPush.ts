import { PUSH_STATES, type PushState } from '@tinnox/contracts';
import type { ScreenStatusTone } from './screenStatus.ts';

/**
 * Wording for the push state of a screen (docs/portal-v2/README.md, decision P2-05: assign,
 * then push). A push state compares what is assigned with what the screen was last given.
 * It says nothing about what the player reports, so "Up to date" is drawn in the neutral
 * tone: the healthy tone stays reserved for a player that reports it is in sync.
 */
export interface PushStatePresentation {
  readonly state: PushState;
  readonly tone: ScreenStatusTone;
  /** The pill text. */
  readonly label: string;
  /** One sentence that says what the state means for this screen. */
  readonly detail: string;
}

const PRESENTATIONS: { readonly [K in PushState]: Omit<PushStatePresentation, 'state'> } = {
  nothing_assigned: {
    tone: 'neutral',
    label: 'Nothing assigned',
    detail: 'No playlist is assigned to this screen, so there is nothing to push.',
  },
  never_pushed: {
    tone: 'warn',
    label: 'Not pushed yet',
    detail: 'A playlist is assigned, but nothing has been pushed to this screen yet.',
  },
  changes: {
    tone: 'warn',
    label: 'Changes waiting',
    detail: 'What is assigned differs from what this screen was last given. Push to send it.',
  },
  up_to_date: {
    tone: 'neutral',
    label: 'Up to date',
    detail:
      'This screen was last given exactly what is assigned now. The screen status says what the player reports.',
  },
  blocked: {
    tone: 'danger',
    label: 'Blocked',
    detail: 'The assigned playlist cannot be pushed to this screen until its problems are fixed.',
  },
};

export function presentPushState(state: PushState): PushStatePresentation {
  return { state, ...PRESENTATIONS[state] };
}

/** Every push state with its wording, in the order of the contract. */
export const PUSH_STATE_PRESENTATIONS: readonly PushStatePresentation[] =
  PUSH_STATES.map(presentPushState);
