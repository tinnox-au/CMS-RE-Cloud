import type { DeliveryStatusView, DisplayDto } from '@tinnox/contracts';
import type { LoadState } from '../../../hooks/useLoad.ts';
import { STATUS_DISCLAIMER } from '../../../lib/screenDetail.ts';
import { useCan } from '../../../session/AuthenticatedSession.tsx';
import { Ellipsis, KeyRound, RefreshCw, Send, Unlink } from '../../../ui/icons.ts';
import {
  Banner,
  Button,
  Card,
  ErrorNotice,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Skeleton,
  SkeletonGroup,
} from '../../../ui/index.ts';
import { AssignedPreview } from './AssignedPreview.tsx';
import type { RevokeState } from './types.ts';
import { StatusHeadline } from './StatusHeadline.tsx';
import type { AssignedPlaylistState } from './useAssignedPlaylist.ts';
import { apiErrorCode, apiErrorMessage } from './errors.ts';

export interface SummaryCardProps {
  readonly display: DisplayDto;
  readonly assigned: AssignedPlaylistState;
  readonly status: LoadState<DeliveryStatusView>;
  readonly onReloadStatus: () => void;
  readonly onPush: () => void;
  readonly onRevoke: () => void;
  readonly onShowPairing: () => void;
  /**
   * The role may pair and revoke (`screen.pair`), decided when the page opened, like the
   * Pairing tab that "Pair player" opens.
   */
  readonly canPair: boolean;
  /** The revocation started from this card, while its outcome is shown. */
  readonly revoke: RevokeState | null;
  readonly onDismissRevoke: () => void;
}

/**
 * The left card: what is assigned, drawn in the shape of the canvas; what the player last
 * reported; and the two actions that act on the screen as a whole. "Push to this screen" needs
 * `push.publish`, pairing and revoking `screen.pair`; "Refresh status" is for everyone.
 */
export function SummaryCard({
  display,
  assigned,
  status,
  onReloadStatus,
  onPush,
  onRevoke,
  onShowPairing,
  canPair,
  revoke,
  onDismissRevoke,
}: SummaryCardProps) {
  const paired = display.player !== null;
  const canPush = useCan('push.publish');
  return (
    <Card
      as="section"
      className="tx-screen-detail-summary"
      aria-label="Preview and status"
      data-testid="screen-detail-summary"
    >
      <div className="tx-screen-detail-summary__grid">
        <AssignedPreview display={display} assigned={assigned} />

        <div className="tx-screen-detail-summary__part">
          <h2 className="tx-screen-detail-caption" id="screen-detail-status-title">
            Status
          </h2>
          <StatusPart status={status} onReload={onReloadStatus} />
          <p className="tx-screen-detail-note">{STATUS_DISCLAIMER}</p>

          <div className="tx-screen-detail-summary__actions">
            {canPush && (
              <Button
                variant="primary"
                icon={Send}
                onClick={onPush}
                data-testid="screen-detail-push"
              >
                Push to this screen
              </Button>
            )}
            <Menu
              placement="bottom-end"
              trigger={(props) => (
                <IconButton
                  {...props}
                  icon={Ellipsis}
                  variant="secondary"
                  label={`More actions for ${display.name}`}
                  data-testid="screen-detail-menu"
                />
              )}
            >
              <MenuItem icon={RefreshCw} onSelect={onReloadStatus}>
                Refresh status
              </MenuItem>
              {canPair && (
                <>
                  <MenuItem icon={KeyRound} onSelect={onShowPairing}>
                    {paired ? 'Pair a different player' : 'Pair player'}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    icon={Unlink}
                    tone="danger"
                    disabled={!paired}
                    hint={paired ? undefined : 'Not paired'}
                    onSelect={onRevoke}
                  >
                    Revoke player
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>

          {revoke !== null && revoke.result !== null && (
            <Banner tone="ok" live="polite" onDismiss={onDismissRevoke}>
              {revoke.result}
            </Banner>
          )}
          {revoke !== null && revoke.error !== null && (
            <ErrorNotice
              error={revoke.error}
              title="The player was not revoked"
              onDismiss={onDismissRevoke}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

function StatusPart({
  status,
  onReload,
}: {
  readonly status: LoadState<DeliveryStatusView>;
  readonly onReload: () => void;
}) {
  if (status.status === 'loading') {
    return (
      <SkeletonGroup label="Loading status" className="tx-stack tx-stack--tight">
        <Skeleton variant="pill" width="120px" height="24px" />
        <Skeleton width="100%" />
        <Skeleton width="70%" />
      </SkeletonGroup>
    );
  }
  if (status.status === 'error') {
    // The Overview tab shows the full error with its details; this is the short form.
    const code = apiErrorCode(status.error);
    return (
      <div className="tx-screen-detail-headline" data-testid="screen-detail-status-error">
        <p className="tx-screen-detail-headline__text">
          The status could not be loaded. {apiErrorMessage(status.error)}{' '}
          {code !== null && <span className="tx-code">{code}</span>}
        </p>
        <Button size="sm" icon={RefreshCw} onClick={onReload}>
          Try again
        </Button>
      </div>
    );
  }
  return <StatusHeadline view={status.data} fetchedAt={status.fetchedAt} />;
}
