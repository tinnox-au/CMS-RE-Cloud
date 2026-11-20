import { usePush } from '../features/push/PushContext.tsx';
import { useCan } from '../session/AuthenticatedSession.tsx';
import { Badge, Button, ButtonLink } from '../ui/index.ts';
import { Clock, Send } from '../ui/icons.ts';
import { HOME_PATH } from './nav.ts';

/** "3 screens have changes waiting", for the badge on the button. */
function pendingLabel(count: number): string {
  return count === 1 ? '1 screen has changes waiting' : `${count} screens have changes waiting`;
}

/**
 * The header's one primary action. It opens the push dialog and shows how many screens have
 * changes waiting; both come from `PushContext` (features/push/PushContext.tsx). Without
 * `push.publish` it is a link to the dashboard's list of waiting screens instead, and nothing
 * while no screen waits.
 */
export function PushButton() {
  const { pendingCount, openPush } = usePush();
  const canPush = useCan('push.publish');
  if (!canPush) {
    if (pendingCount === null || pendingCount === 0) return null;
    // "3 screens waiting"; on a phone the words are visually hidden like the push button's, so
    // the header's second line keeps its room.
    return (
      <ButtonLink size="sm" icon={Clock} to={HOME_PATH} data-testid="push-waiting">
        <span className="tx-num">{pendingCount}</span>
        <span className="tx-push-button__text">
          {' '}
          {pendingCount === 1 ? 'screen' : 'screens'} waiting
        </span>
      </ButtonLink>
    );
  }
  return (
    <Button
      variant="primary"
      icon={Send}
      className="tx-push-button"
      data-testid="push-button"
      onClick={() => {
        openPush();
      }}
    >
      <span className="tx-push-button__text">Push to screens</span>
      {pendingCount !== null && (
        <Badge count={pendingCount} variant="inverse" label={pendingLabel(pendingCount)} />
      )}
    </Button>
  );
}
