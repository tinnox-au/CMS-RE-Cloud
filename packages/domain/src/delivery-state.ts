import type {
  DeliveryStatusView,
  DeliverySummary,
  HeartbeatV1,
  PlayerError,
  PlayerState,
  StagingPhase,
} from '@tinnox/contracts';

export interface StagingState {
  readonly publicationId: string;
  readonly phase: StagingPhase;
  readonly assetsDone: number;
  readonly assetsTotal: number;
}

/** What the server remembers about a display's player reports (table display_delivery). */
export interface ReportedState {
  /** Registration that produced the stored report. */
  readonly registrationId: string | null;
  readonly lastSeq: number | null;
  readonly downloadedPublicationId: string | null;
  readonly activePublicationId: string | null;
  readonly activeItemIndex: number | null;
  readonly playerState: PlayerState | null;
  readonly staging: StagingState | null;
  readonly errors: readonly PlayerError[];
  /** Server receive time (ISO 8601 UTC) of the last accepted report. */
  readonly lastHeartbeatAt: string | null;
}

export const EMPTY_REPORTED_STATE: ReportedState = Object.freeze({
  registrationId: null,
  lastSeq: null,
  downloadedPublicationId: null,
  activePublicationId: null,
  activeItemIndex: null,
  playerState: null,
  staging: null,
  errors: Object.freeze<PlayerError[]>([]),
  lastHeartbeatAt: null,
});

export interface HeartbeatEvent {
  /** Registration authenticated by the device credential, never taken from the body. */
  readonly registrationId: string;
  readonly report: HeartbeatV1;
  /** Server clock at receipt. */
  readonly receivedAt: Date;
}

export type ReduceResult =
  | { readonly accepted: true; readonly ignoredReason: null; readonly state: ReportedState }
  | {
      readonly accepted: false;
      readonly ignoredReason: 'stale_seq';
      readonly state: ReportedState;
    };

/**
 * Applies a player report to the stored state.
 * - A report whose seq is not greater than the stored seq of the same registration is ignored,
 *   so a delayed or replayed report can never overwrite newer state.
 * - A report from a different registration (a newly paired player) starts a new sequence.
 * The function never mutates its input.
 */
export function reduceHeartbeat(current: ReportedState, event: HeartbeatEvent): ReduceResult {
  const sameRegistration = current.registrationId === event.registrationId;
  if (sameRegistration && current.lastSeq !== null && event.report.seq <= current.lastSeq) {
    return { accepted: false, ignoredReason: 'stale_seq', state: current };
  }
  const r = event.report;
  return {
    accepted: true,
    ignoredReason: null,
    state: {
      registrationId: event.registrationId,
      lastSeq: r.seq,
      downloadedPublicationId: r.downloadedPublicationId,
      activePublicationId: r.activePublicationId,
      activeItemIndex: r.activeItemIndex,
      playerState: r.playerState,
      staging: r.staging === null ? null : { ...r.staging },
      errors: r.errors.map((e) => ({ ...e })),
      lastHeartbeatAt: event.receivedAt.toISOString(),
    },
  };
}

export interface HeartbeatContext {
  /** Display bound to the device credential. */
  readonly displayId: string;
  /** Returns true when the publication exists and was published to this display. */
  readonly isPublicationOfDisplay: (publicationId: string) => boolean;
}

/**
 * Checks claims in a report that a player could forge. Returns a reason to
 * reject the whole report (HTTP 4xx), or null when it is consistent.
 */
export function heartbeatRejection(report: HeartbeatV1, context: HeartbeatContext): string | null {
  if (report.displayId !== context.displayId) {
    return 'report names a display other than the one this credential is registered to';
  }
  const named = new Set<string>();
  if (report.downloadedPublicationId !== null) named.add(report.downloadedPublicationId);
  if (report.activePublicationId !== null) named.add(report.activePublicationId);
  if (report.staging !== null) named.add(report.staging.publicationId);
  for (const error of report.errors) {
    if (error.publicationId !== null) named.add(error.publicationId);
  }
  for (const id of named) {
    if (!context.isPublicationOfDisplay(id)) {
      return 'report names a publication that was not published to this display';
    }
  }
  return null;
}

/**
 * True when there is no report or the last one is older than the threshold.
 * A timestamp in the future (clock adjustment) is treated as fresh.
 */
export function isStale(
  lastHeartbeatAt: string | null,
  now: Date,
  staleAfterSeconds: number,
): boolean {
  if (!Number.isFinite(staleAfterSeconds) || staleAfterSeconds <= 0) {
    throw new RangeError('staleAfterSeconds must be positive');
  }
  if (lastHeartbeatAt === null) return true;
  const last = Date.parse(lastHeartbeatAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last > staleAfterSeconds * 1000;
}

export interface StatusViewInput {
  readonly displayId: string;
  /** Currently active (not revoked) registration, or null when unpaired. */
  readonly activeRegistrationId: string | null;
  readonly desired: { readonly publicationId: string; readonly publishedAt: string } | null;
  readonly reported: ReportedState;
  readonly now: Date;
  readonly staleAfterSeconds: number;
}

/**
 * Builds the portal's delivery view from stored facts only. Reports that came
 * from a registration that is no longer the active one are not shown as current.
 */
export function buildDeliveryStatusView(input: StatusViewInput): DeliveryStatusView {
  const paired = input.activeRegistrationId !== null;
  const reportIsCurrent = paired && input.reported.registrationId === input.activeRegistrationId;
  const reported = reportIsCurrent ? input.reported : EMPTY_REPORTED_STATE;
  const stale = isStale(reported.lastHeartbeatAt, input.now, input.staleAfterSeconds);

  let summary: DeliverySummary;
  if (!paired) summary = 'unpaired';
  else if (reported.lastHeartbeatAt === null)
    summary = input.desired === null ? 'nothing_published' : 'awaiting_player';
  else if (stale) summary = 'stale';
  else if (input.desired === null) summary = 'nothing_published';
  else if (reported.playerState === 'error') summary = 'error';
  // shortcut: also true for a moment between activation and the first item; a heartbeat v2 state would make it exact.
  else if (
    reported.playerState === 'idle' &&
    reported.activePublicationId === null &&
    reported.downloadedPublicationId === input.desired.publicationId
  )
    summary = 'standing_by';
  else if (
    reported.playerState === 'playing' &&
    reported.activePublicationId === input.desired.publicationId
  )
    summary = 'in_sync';
  else summary = 'updating';

  return {
    displayId: input.displayId,
    paired,
    registrationId: input.activeRegistrationId,
    desired: input.desired === null ? null : { ...input.desired },
    downloaded:
      reported.downloadedPublicationId === null
        ? null
        : { publicationId: reported.downloadedPublicationId },
    active:
      reported.activePublicationId === null || reported.activeItemIndex === null
        ? null
        : { publicationId: reported.activePublicationId, itemIndex: reported.activeItemIndex },
    playerState: reported.playerState,
    staging: reported.staging === null ? null : { ...reported.staging },
    lastHeartbeatAt: reported.lastHeartbeatAt,
    stale,
    staleAfterSeconds: input.staleAfterSeconds,
    errors: reported.errors.map((e) => ({ ...e })),
    summary,
    asOf: input.now.toISOString(),
  };
}
