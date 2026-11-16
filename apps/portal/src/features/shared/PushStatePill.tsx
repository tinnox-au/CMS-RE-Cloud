import type { PushState } from '@tinnox/contracts';
import { presentPushState } from '../../lib/screenStatusPush.ts';
import { Check, CircleDashed, Lock, Send, type IconComponent } from '../../ui/icons.ts';
import { cx, StatusPill } from '../../ui/index.ts';
import './shared.css';

export interface PushStatePillProps {
  /** `state` of a row of `api.getPushPlan()`. */
  readonly state: PushState;
  /** Default `shared-push-state`. */
  readonly testId?: string;
  readonly className?: string;
}

const ICONS: { readonly [K in PushState]: IconComponent } = {
  nothing_assigned: CircleDashed,
  never_pushed: Send,
  changes: Send,
  up_to_date: Check,
  blocked: Lock,
};

/**
 * Where a screen stands between what is assigned to it and what it was last given:
 * Nothing assigned, Not pushed yet, Changes waiting, Up to date or Blocked. "Up to date" is
 * neutral on purpose: it is about what was pushed, not about what the player reports.
 */
export function PushStatePill({
  state,
  testId = 'shared-push-state',
  className,
}: PushStatePillProps) {
  const presentation = presentPushState(state);
  return (
    <span className={cx('tx-shared-push', className)} data-testid={testId} data-state={state}>
      <StatusPill tone={presentation.tone} icon={ICONS[state]}>
        {presentation.label}
      </StatusPill>
    </span>
  );
}
