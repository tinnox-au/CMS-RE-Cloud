import { usePush } from '../features/push/PushContext.tsx';
import { Badge, Button } from '../ui/index.ts';
import { Send } from '../ui/icons.ts';

/** "3 screens have changes waiting", for the badge on the button. */
function pendingLabel(count: number): string {
  return count === 1 ? '1 screen has changes waiting' : `${count} screens have changes waiting`;
}

/**
 * The header's one primary action. It opens the push dialog and shows how many screens have
 * changes waiting; both come from `PushContext` (features/push/PushContext.tsx).
 */
export function PushButton() {
  const { pendingCount, openPush } = usePush();
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
