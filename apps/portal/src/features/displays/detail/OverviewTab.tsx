import type { DeliveryStatusView } from '@tinnox/contracts';
import type { LoadState } from '../../../hooks/useLoad.ts';
import type { ContentKind } from '../../../lib/assignedContent.ts';
import { formatAge, formatTimestamp } from '../../../lib/format.ts';
import { REPORTED_FACTS_NOTE, SCREEN_STATUS_POLL_MS } from '../../../lib/screenDetail.ts';
import { presentStatus } from '../../../lib/status.ts';
import { CircleCheck, RefreshCw } from '../../../ui/icons.ts';
import {
  Button,
  ErrorNotice,
  Fact,
  Facts,
  Icon,
  Skeleton,
  SkeletonGroup,
  StatusPill,
} from '../../../ui/index.ts';
import { useNow } from '../../shared/index.ts';

export interface OverviewTabProps {
  readonly status: LoadState<DeliveryStatusView>;
  readonly onReload: () => void;
  /**
   * What the screen has assigned, or null. With a schedule the active item is counted across
   * its playlists; with a layout it is the item in the main zone.
   */
  readonly contentKind: ContentKind | null;
}

/** The M0 live status facts: what was set in TINNOX CMS, and what the player software reported. */
export function OverviewTab({ status, onReload, contentKind }: OverviewTabProps) {
  if (status.status === 'loading') {
    return (
      <SkeletonGroup label="Loading status" className="tx-screen-detail-skeleton">
        <Skeleton width="30%" height="16px" />
        <Skeleton width="100%" />
        <Skeleton width="90%" />
        <Skeleton width="30%" height="16px" />
        <Skeleton width="100%" />
        <Skeleton width="80%" />
      </SkeletonGroup>
    );
  }
  if (status.status === 'error') {
    return (
      <ErrorNotice error={status.error} title="The status could not be loaded" onRetry={onReload} />
    );
  }
  return (
    <StatusFacts
      view={status.data}
      fetchedAt={status.fetchedAt}
      refreshError={status.refreshError}
      onReload={onReload}
      contentKind={contentKind}
    />
  );
}

function MatchPill({ matches }: { readonly matches: boolean | null }) {
  if (matches === null) return null;
  return matches ? (
    <StatusPill tone="ok">matches desired</StatusPill>
  ) : (
    <StatusPill tone="warn">differs from desired</StatusPill>
  );
}

function Muted({ children }: { readonly children: string }) {
  return <span className="tx-muted">{children}</span>;
}

function Id({ value }: { readonly value: string }) {
  return <span className="tx-screen-detail-id">{value}</span>;
}

function StatusFacts({
  view,
  fetchedAt,
  refreshError,
  onReload,
  contentKind,
}: {
  readonly view: DeliveryStatusView;
  readonly fetchedAt: number;
  readonly refreshError: unknown;
  readonly onReload: () => void;
  readonly contentKind: ContentKind | null;
}) {
  const now = useNow();
  const elapsedMs = Math.max(0, now - fetchedAt);
  const p = presentStatus(view, elapsedMs);

  return (
    <div className="tx-screen-detail-overview" data-testid="screen-detail-overview">
      {refreshError !== null && (
        <ErrorNotice
          error={refreshError}
          title={`The status could not be refreshed. Showing what the server said ${formatAge(elapsedMs / 1000)}.`}
        />
      )}

      <section className="tx-screen-detail-section" aria-labelledby="screen-detail-set-title">
        <h3 id="screen-detail-set-title" className="tx-screen-detail-caption">
          Set in TINNOX CMS
        </h3>
        <Facts>
          <Fact label="Desired publication" testId="status-desired">
            {view.desired === null ? (
              <Muted>Nothing pushed</Muted>
            ) : (
              <>
                <Id value={view.desired.publicationId} />
                <span className="tx-screen-detail-block tx-screen-detail-note">
                  Pushed {formatTimestamp(view.desired.publishedAt)}
                </span>
              </>
            )}
          </Fact>
          <Fact label="Player credential">
            {view.paired && view.registrationId !== null ? (
              <>
                Active, registration <Id value={view.registrationId} />
              </>
            ) : (
              <Muted>No active credential</Muted>
            )}
          </Fact>
        </Facts>
      </section>

      <section className="tx-screen-detail-section" aria-labelledby="screen-detail-reported-title">
        <h3 id="screen-detail-reported-title" className="tx-screen-detail-caption">
          Reported by player software
        </h3>
        <p className="tx-screen-detail-note">{REPORTED_FACTS_NOTE}</p>
        <Facts>
          <Fact label="Last report received" testId="status-last-report">
            {view.lastHeartbeatAt === null ? (
              <Muted>No report received</Muted>
            ) : (
              <>
                {p.heartbeatText}{' '}
                <span className="tx-muted">({formatTimestamp(view.lastHeartbeatAt)})</span>
              </>
            )}{' '}
            {p.reportBadge === 'stale' && <span className="tx-screen-detail-badge">STALE</span>}
            <span className="tx-screen-detail-block tx-screen-detail-note">
              A report counts as stale after {view.staleAfterSeconds} s.
            </span>
          </Fact>
          <Fact label="Downloaded publication" testId="status-downloaded">
            {view.downloaded === null ? (
              <Muted>None reported</Muted>
            ) : (
              <span className="tx-screen-detail-pubrow">
                <Id value={view.downloaded.publicationId} />
                <MatchPill matches={p.downloadedMatchesDesired} />
              </span>
            )}
          </Fact>
          <Fact label="Active publication" testId="status-active">
            {view.active === null ? (
              <Muted>None reported</Muted>
            ) : (
              <span className="tx-screen-detail-pubrow">
                <Id value={view.active.publicationId} />
                <MatchPill matches={p.activeMatchesDesired} />
              </span>
            )}
          </Fact>
          <Fact label="Active item" testId="status-active-item">
            {p.activeItemNumber === null ? (
              <Muted>None reported</Muted>
            ) : (
              <>
                Item {p.activeItemNumber} of the active publication
                {contentKind === 'schedule' && (
                  <span className="tx-screen-detail-block tx-screen-detail-note">
                    With a schedule, items are counted across all of its playlists, default playlist
                    first.
                  </span>
                )}
                {contentKind === 'layout' && (
                  <span className="tx-screen-detail-block tx-screen-detail-note">
                    With a layout, this is the item in the main zone; other zones are not reported.
                  </span>
                )}
              </>
            )}
          </Fact>
          <Fact label="Player state" testId="status-player-state">
            {p.playerStateLabel}
          </Fact>
          <Fact label="Update in progress">
            {view.staging === null || p.stagingText === null ? (
              <Muted>None reported</Muted>
            ) : (
              <>
                <Id value={view.staging.publicationId} />
                <span className="tx-screen-detail-block">{p.stagingText}</span>
              </>
            )}
          </Fact>
        </Facts>
      </section>

      <section className="tx-screen-detail-section" aria-labelledby="screen-detail-errors-title">
        <h3 id="screen-detail-errors-title" className="tx-screen-detail-caption">
          Delivery errors reported by the player
        </h3>
        {view.errors.length === 0 ? (
          <p className="tx-screen-detail-noerrors" data-testid="status-no-errors">
            <Icon icon={CircleCheck} size={16} />
            None in the last report.
          </p>
        ) : (
          <ul className="tx-screen-detail-errors" data-testid="status-errors">
            {view.errors.map((error, index) => (
              <li key={index}>
                <span>
                  <span className="tx-code">{error.code}</span> {error.message}
                </span>
                {error.code === 'manifest_unsupported_version' && (
                  <span data-testid="status-error-reload-hint">
                    This player is older than these settings. Reload the player page on the screen
                    to update it.
                  </span>
                )}
                <span className="tx-screen-detail-errors__meta">
                  <span>{formatTimestamp(error.at)}</span>
                  {error.publicationId !== null && (
                    <span>
                      publication <Id value={error.publicationId} />
                    </span>
                  )}
                  {error.assetId !== null && (
                    <span>
                      media <Id value={error.assetId} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="tx-screen-detail-foot">
        <p className="tx-screen-detail-note">
          Server view computed {formatTimestamp(view.asOf)}. Refreshes every{' '}
          {SCREEN_STATUS_POLL_MS / 1000} s while this tab is visible.
        </p>
        <Button
          size="sm"
          icon={RefreshCw}
          onClick={onReload}
          data-testid="screen-detail-refresh-status"
        >
          Refresh now
        </Button>
      </div>
    </div>
  );
}
