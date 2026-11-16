import type { DeliveryStatusView } from '@tinnox/contracts';
import { screenStatus, type ScreenStatusKind } from '../../lib/screenStatus.ts';
import {
  CircleCheck,
  CircleDashed,
  CirclePause,
  CircleQuestionMark,
  CircleX,
  Clock,
  RefreshCw,
  Unlink,
  type IconComponent,
} from '../../ui/icons.ts';
import { cx, Skeleton, StatusPill, VisuallyHidden } from '../../ui/index.ts';
import './shared.css';
import { useNow } from './useNow.ts';

export interface ScreenStatusPillProps {
  /**
   * The status view of the screen, from `api.getDisplayStatus` or one item of
   * `api.listDisplayStatuses`. `undefined` or `null` while it is not known.
   */
  readonly view: DeliveryStatusView | null | undefined;
  /**
   * `state.fetchedAt` of the `useLoad` state that delivered `view`. With it the age of the
   * last report keeps counting between refreshes; without it the age is as of the fetch.
   */
  readonly fetchedAt?: number;
  /**
   * Where "Last report 12 seconds ago" is written: under the pill (`below`, the default),
   * after it on the same line (`inline`), or for assistive technology only (`hidden`, for a
   * place that already shows the time of the last report next to the pill).
   */
  readonly detail?: 'below' | 'inline' | 'hidden';
  /** Draws a skeleton instead of "Status not loaded" while `view` is missing. */
  readonly loading?: boolean;
  /** Default `shared-screen-status`. */
  readonly testId?: string;
  readonly className?: string;
}

/** The icon of each screen status, for any page that draws its own status headline. */
export const SCREEN_STATUS_ICONS: { readonly [K in ScreenStatusKind]: IconComponent } = {
  in_sync: CircleCheck,
  standing_by: CirclePause,
  updating: RefreshCw,
  not_reporting: CircleQuestionMark,
  error: CircleX,
  waiting_for_player: Clock,
  nothing_pushed: CircleDashed,
  not_paired: Unlink,
};

/**
 * What the player of a screen last reported, as a pill with the time of that report. The
 * wording and the tone come from `lib/screenStatus.ts`: the healthy tone needs the API to
 * say in sync, paired and not stale, and the portal has no word for a screen being reachable.
 * The element carries `data-summary` and `data-stale` exactly as the API sent them.
 */
export function ScreenStatusPill({
  view,
  fetchedAt,
  detail = 'below',
  loading = false,
  testId = 'shared-screen-status',
  className,
}: ScreenStatusPillProps) {
  const known = view !== null && view !== undefined;
  const now = useNow(known && fetchedAt !== undefined);
  const layout = cx(
    'tx-shared-status',
    detail === 'inline' && 'tx-shared-status--inline',
    className,
  );

  if (!known) {
    if (loading) {
      return (
        <span className={layout} data-testid={testId} data-loading="true">
          <Skeleton variant="pill" width="88px" height="24px" />
          <VisuallyHidden>Loading status</VisuallyHidden>
        </span>
      );
    }
    return (
      <span className={layout} data-testid={testId} data-summary="unknown">
        <StatusPill tone="neutral">Status not loaded</StatusPill>
      </span>
    );
  }

  const status = screenStatus(view, fetchedAt === undefined ? 0 : now - fetchedAt);
  return (
    <span
      className={layout}
      data-testid={testId}
      data-summary={status.summary}
      data-stale={status.stale ? 'true' : 'false'}
      data-kind={status.kind}
    >
      <StatusPill tone={status.tone}>{status.label}</StatusPill>
      {detail === 'hidden' ? (
        <VisuallyHidden>{status.detail}</VisuallyHidden>
      ) : (
        <span className="tx-shared-status__detail">{status.detail}</span>
      )}
    </span>
  );
}
