import type { DeliveryStatusView, DeliverySummary, PlayerState } from '@tinnox/contracts';
import { formatAge } from './format.ts';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad';

export type ReportBadge = 'none' | 'stale' | 'no_report';

export interface StatusPresentation {
  readonly headline: string;
  readonly tone: Tone;
  readonly explanation: string;
  /** `stale` and `no_report` both come from the API's `stale` flag, never from a local guess. */
  readonly reportBadge: ReportBadge;
  readonly heartbeatAgeSeconds: number | null;
  readonly heartbeatText: string;
  /** Null when either side is unknown. */
  readonly downloadedMatchesDesired: boolean | null;
  readonly activeMatchesDesired: boolean | null;
  /** 1-based position in the published manifest, as reported by the player. */
  readonly activeItemNumber: number | null;
  readonly playerStateLabel: string;
  readonly stagingText: string | null;
}

interface SummaryText {
  readonly headline: string;
  readonly tone: Tone;
  readonly explanation: string;
}

const SUMMARY_TEXT: { readonly [K in DeliverySummary]: SummaryText } = {
  unpaired: {
    headline: 'No player paired',
    tone: 'neutral',
    explanation: 'No player holds a credential for this screen. Pair one to deliver content.',
  },
  nothing_published: {
    headline: 'Nothing published',
    tone: 'neutral',
    explanation: 'A player is paired, but nothing has been published to this screen yet.',
  },
  awaiting_player: {
    headline: 'Waiting for the first report',
    tone: 'warn',
    explanation:
      'A player is paired but has not reported since it was registered. Nothing is known about what it shows.',
  },
  stale: {
    headline: 'Last report is stale',
    tone: 'warn',
    explanation:
      'The player has not reported recently. The values below are its last known report and may no longer be true.',
  },
  updating: {
    headline: 'Player has not switched to the desired publication',
    tone: 'warn',
    explanation:
      'The player reports a different publication, or none, as active. It keeps its previous complete version until the new one is fully downloaded and verified.',
  },
  error: {
    headline: 'Player reports an error',
    tone: 'bad',
    explanation: 'The player software reported an error state. See the delivery errors below.',
  },
  standing_by: {
    headline: 'Standing by',
    tone: 'neutral',
    explanation: 'Has the latest push; nothing in it is due to show right now.',
  },
  in_sync: {
    headline: 'Player reports the desired publication is playing',
    tone: 'good',
    explanation:
      'This is a recent report from the player software. It is not proof of what a physical screen shows.',
  },
};

const PLAYER_STATE_LABELS: { readonly [K in PlayerState]: string } = {
  idle: 'Idle (nothing playing)',
  playing: 'Playing',
  error: 'Error',
};

const STAGING_PHASE_LABELS = {
  downloading: 'downloading',
  verifying: 'verifying',
  ready: 'ready to activate at the next item boundary',
  failed: 'failed; the previous version is kept',
} as const;

/**
 * Maps the API's status view to text an operator reads. Nothing here upgrades the picture:
 * a "good" tone needs the API to say `in_sync` and not stale at the same time.
 *
 * `elapsedSinceFetchMs` is how long ago this browser received the view. The age of
 * the last report is measured on the server clock (`asOf` minus `lastHeartbeatAt`)
 * and then advanced by that local elapsed time, so a wrong workstation clock does
 * not distort it.
 */
export function presentStatus(
  view: DeliveryStatusView,
  elapsedSinceFetchMs: number,
): StatusPresentation {
  const base = SUMMARY_TEXT[view.summary];
  let tone = base.tone;
  let headline = base.headline;
  let explanation = base.explanation;
  if (view.summary === 'in_sync' && (view.stale || !view.paired)) {
    // Contradictory data must never read as healthy.
    tone = 'warn';
    headline = 'Status is inconsistent';
    explanation =
      'The server reported an in-sync summary together with a stale or unpaired state. Treat the screen as unverified.';
  }

  let heartbeatAgeSeconds: number | null = null;
  let heartbeatText = 'No report received';
  if (view.lastHeartbeatAt !== null) {
    const serverAgeMs = Date.parse(view.asOf) - Date.parse(view.lastHeartbeatAt);
    if (Number.isFinite(serverAgeMs)) {
      heartbeatAgeSeconds = Math.max(0, (serverAgeMs + Math.max(0, elapsedSinceFetchMs)) / 1000);
      heartbeatText = formatAge(heartbeatAgeSeconds);
    } else {
      heartbeatText = 'Unknown';
    }
  }

  let reportBadge: ReportBadge = 'none';
  if (view.stale) reportBadge = view.lastHeartbeatAt === null ? 'no_report' : 'stale';

  const desiredId = view.desired?.publicationId ?? null;
  const downloadedId = view.downloaded?.publicationId ?? null;
  const activeId = view.active?.publicationId ?? null;

  let stagingText: string | null = null;
  if (view.staging !== null) {
    stagingText = `${view.staging.assetsDone} of ${view.staging.assetsTotal} files, ${STAGING_PHASE_LABELS[view.staging.phase]}`;
  }

  return {
    headline,
    tone,
    explanation,
    reportBadge,
    heartbeatAgeSeconds,
    heartbeatText,
    downloadedMatchesDesired:
      desiredId === null || downloadedId === null ? null : desiredId === downloadedId,
    activeMatchesDesired: desiredId === null || activeId === null ? null : desiredId === activeId,
    activeItemNumber: view.active === null ? null : view.active.itemIndex + 1,
    playerStateLabel:
      view.playerState === null ? 'Not reported' : PLAYER_STATE_LABELS[view.playerState],
    stagingText,
  };
}
