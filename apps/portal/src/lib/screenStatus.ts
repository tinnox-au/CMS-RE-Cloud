import type { DeliveryStatusView, DeliverySummary } from '@tinnox/contracts';
import { presentStatus, type ReportBadge } from './status.ts';

/**
 * Screen status for the portal v2 pills (docs/portal-v2/README.md, decision P2-04).
 *
 * The portal reports what the player software last said, in a fixed set of words, and always
 * says when the player last reported. It has no word for a screen being reachable. This module
 * builds on `presentStatus` in `status.ts` and keeps its guarantees:
 * - the healthy tone needs the API to say `in_sync`, paired and not stale, all three;
 * - "stale" comes only from the API's `stale` flag, never from a clock in the browser;
 * - the age of the last report is measured on the server clock and advanced by local time.
 */

/** The tones of the kit's `StatusPill`. */
export type ScreenStatusTone = 'ok' | 'warn' | 'danger' | 'neutral';

/** The states an operator can see, in the order filter chips and legends list them. */
export const SCREEN_STATUS_KINDS = [
  'in_sync',
  'standing_by',
  'updating',
  'not_reporting',
  'error',
  'waiting_for_player',
  'nothing_pushed',
  'not_paired',
] as const;
export type ScreenStatusKind = (typeof SCREEN_STATUS_KINDS)[number];

/** The approved wording. Nothing else may be shown as a screen's status. */
export const SCREEN_STATUS_LABELS: { readonly [K in ScreenStatusKind]: string } = {
  in_sync: 'In sync',
  standing_by: 'Standing by',
  updating: 'Updating',
  not_reporting: 'Not reporting',
  error: 'Error',
  waiting_for_player: 'Waiting for player',
  nothing_pushed: 'Nothing pushed',
  not_paired: 'Not paired',
};

const KIND_OF_SUMMARY: { readonly [K in DeliverySummary]: ScreenStatusKind } = {
  in_sync: 'in_sync',
  standing_by: 'standing_by',
  updating: 'updating',
  stale: 'not_reporting',
  error: 'error',
  awaiting_player: 'waiting_for_player',
  nothing_published: 'nothing_pushed',
  unpaired: 'not_paired',
};

const TONES: { readonly [K in ScreenStatusKind]: ScreenStatusTone } = {
  in_sync: 'ok',
  standing_by: 'neutral',
  updating: 'warn',
  not_reporting: 'warn',
  error: 'danger',
  waiting_for_player: 'warn',
  nothing_pushed: 'neutral',
  not_paired: 'neutral',
};

const EXPLANATIONS: { readonly [K in ScreenStatusKind]: string } = {
  in_sync:
    'This is a recent report from the player software. It is not proof of what the physical screen shows.',
  standing_by: 'Has the latest push; nothing in it is due to show right now.',
  updating:
    'The player reports a different publication, or none, as active. It keeps its previous complete version until the new one is fully downloaded and verified.',
  not_reporting:
    'The player has not reported recently. What is shown here is its last known report and may no longer be true.',
  error: 'The player software reported an error state. See the delivery errors for this screen.',
  waiting_for_player:
    'A player is paired but has not reported since it was registered. Nothing is known about what it shows.',
  nothing_pushed: 'A player is paired, but nothing has been pushed to this screen yet.',
  not_paired: 'No player holds a credential for this screen, so it receives no content.',
};

const INCONSISTENT_EXPLANATION =
  'The server reported an in-sync summary together with a stale or unpaired state. Treat this screen as unverified.';

/** The kind a summary from the API (or a counter of `GET /api/overview`) is shown as. */
export function screenStatusKindOf(summary: DeliverySummary): ScreenStatusKind {
  return KIND_OF_SUMMARY[summary];
}

/** The tone a kind is normally drawn in. `screenStatus` may lower it, never raise it. */
export function screenStatusTone(kind: ScreenStatusKind): ScreenStatusTone {
  return TONES[kind];
}

/**
 * The four counters of the dashboard and the status filter of the screens list:
 * `pending` is updating, waiting for the player's first report, or nothing pushed yet;
 * `attention` is an error or a player that stopped reporting.
 */
export type ScreenStatusGroup = 'in_sync' | 'pending' | 'attention' | 'not_paired';

const GROUPS: { readonly [K in ScreenStatusKind]: ScreenStatusGroup } = {
  in_sync: 'in_sync',
  standing_by: 'in_sync',
  updating: 'pending',
  waiting_for_player: 'pending',
  nothing_pushed: 'pending',
  not_reporting: 'attention',
  error: 'attention',
  not_paired: 'not_paired',
};

export function screenStatusGroup(kind: ScreenStatusKind): ScreenStatusGroup {
  return GROUPS[kind];
}

export interface ScreenStatus {
  readonly kind: ScreenStatusKind;
  /** For the kit's `StatusPill`. `ok` only for `in_sync` that is paired and not stale. */
  readonly tone: ScreenStatusTone;
  /** One of `SCREEN_STATUS_LABELS`. */
  readonly label: string;
  /** When the player last reported: "Last report 12 seconds ago" or "No report received". */
  readonly detail: string;
  /** One or two sentences that say what the status means and what it does not prove. */
  readonly explanation: string;
  /** The API's summary and stale flag, unchanged, for `data-summary` and `data-stale`. */
  readonly summary: DeliverySummary;
  readonly stale: boolean;
  /** `stale`: an old report exists; `no_report`: none was ever received. From the API's flag. */
  readonly reportBadge: ReportBadge;
  /** "12 seconds ago", "just now", or "No report received". */
  readonly lastReportText: string;
  /** Null when no report was received. */
  readonly lastReportAgeSeconds: number | null;
}

/**
 * Maps the API's status view to the pill an operator sees. `elapsedSinceFetchMs` is how long
 * ago this browser received the view (`performance.now() - state.fetchedAt` with `useLoad`).
 *
 * Contradictory data never reads as healthy: an `in_sync` summary that arrives with the stale
 * flag is shown as "Not reporting", and one that arrives unpaired as "Not paired", both in
 * the attention tone.
 */
export function screenStatus(view: DeliveryStatusView, elapsedSinceFetchMs: number): ScreenStatus {
  const report = presentStatus(view, elapsedSinceFetchMs);
  let kind = KIND_OF_SUMMARY[view.summary];
  let tone = TONES[kind];
  let explanation = EXPLANATIONS[kind];
  if (view.summary === 'in_sync' && (view.stale || !view.paired)) {
    kind = view.paired ? 'not_reporting' : 'not_paired';
    tone = 'warn';
    explanation = INCONSISTENT_EXPLANATION;
  }
  let lastReportText = report.heartbeatText;
  let detail = `Last report ${lastReportText}`;
  if (view.lastHeartbeatAt === null) {
    detail = 'No report received';
  } else if (report.heartbeatAgeSeconds === null) {
    // A report exists but its time could not be read.
    lastReportText = 'at an unknown time';
    detail = 'Last report at an unknown time';
  }
  return {
    kind,
    tone,
    label: SCREEN_STATUS_LABELS[kind],
    detail,
    explanation,
    summary: view.summary,
    stale: view.stale,
    reportBadge: report.reportBadge,
    lastReportText,
    lastReportAgeSeconds: report.heartbeatAgeSeconds,
  };
}
