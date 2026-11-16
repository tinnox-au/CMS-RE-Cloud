import { DELIVERY_SUMMARIES, PUSH_STATES, type DeliveryStatusView } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  SCREEN_STATUS_KINDS,
  SCREEN_STATUS_LABELS,
  screenStatus,
  screenStatusGroup,
  screenStatusKindOf,
  screenStatusTone,
} from './screenStatus.ts';
import { presentPushState, PUSH_STATE_PRESENTATIONS } from './screenStatusPush.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-11-14T03:00:00.000Z';

function view(change: Partial<DeliveryStatusView> = {}): DeliveryStatusView {
  return {
    displayId: ID(1),
    paired: true,
    registrationId: ID(2),
    desired: { publicationId: ID(3), publishedAt: T },
    downloaded: { publicationId: ID(3) },
    active: { publicationId: ID(3), itemIndex: 0 },
    playerState: 'playing',
    staging: null,
    lastHeartbeatAt: '2026-11-14T03:09:50.000Z',
    stale: false,
    staleAfterSeconds: 60,
    errors: [],
    summary: 'in_sync',
    asOf: '2026-11-14T03:10:00.000Z',
    ...change,
  };
}

/** Every combination the API could send, sensible or not. */
function everyView(): DeliveryStatusView[] {
  const views: DeliveryStatusView[] = [];
  for (const summary of DELIVERY_SUMMARIES) {
    for (const stale of [true, false]) {
      for (const paired of [true, false]) {
        for (const lastHeartbeatAt of ['2026-11-14T03:09:50.000Z', null]) {
          views.push(
            view({
              summary,
              stale,
              paired,
              registrationId: paired ? ID(2) : null,
              lastHeartbeatAt,
            }),
          );
        }
      }
    }
  }
  return views;
}

function everyText(status: ReturnType<typeof screenStatus>): string {
  return `${status.label} ${status.detail} ${status.explanation} ${status.lastReportText}`;
}

describe('screen status', () => {
  it('uses the approved wording for each summary of the API', () => {
    const labels = Object.fromEntries(
      DELIVERY_SUMMARIES.map((summary) => [
        summary,
        screenStatus(view({ summary, stale: summary === 'stale' }), 0).label,
      ]),
    );
    expect(labels).toEqual({
      unpaired: 'Not paired',
      nothing_published: 'Nothing pushed',
      awaiting_player: 'Waiting for player',
      stale: 'Not reporting',
      updating: 'Updating',
      error: 'Error',
      standing_by: 'Standing by',
      in_sync: 'In sync',
    });
  });

  it('shows the healthy tone only for in_sync that is paired and not stale', () => {
    const healthy = screenStatus(view(), 0);
    expect(healthy.tone).toBe('ok');
    expect(healthy.kind).toBe('in_sync');
    for (const candidate of everyView()) {
      const status = screenStatus(candidate, 0);
      const mayBeHealthy = candidate.summary === 'in_sync' && candidate.paired && !candidate.stale;
      expect(status.tone === 'ok').toBe(mayBeHealthy);
    }
  });

  it('never presents contradictory in_sync data as healthy or as in sync', () => {
    const stale = screenStatus(view({ stale: true }), 0);
    expect(stale.tone).toBe('warn');
    expect(stale.label).toBe('Not reporting');
    expect(stale.explanation).toContain('unverified');

    const unpaired = screenStatus(view({ paired: false, registrationId: null }), 0);
    expect(unpaired.tone).toBe('warn');
    expect(unpaired.label).toBe('Not paired');
    expect(unpaired.explanation).toContain('unverified');
  });

  it('never uses a banned word, and never calls the object a display', () => {
    for (const candidate of everyView()) {
      const text = everyText(screenStatus(candidate, 0)).toLowerCase();
      expect(text).not.toContain('online');
      expect(text).not.toContain('offline');
      expect(text).not.toContain('display');
    }
    for (const label of Object.values(SCREEN_STATUS_LABELS)) {
      expect(label.toLowerCase()).not.toMatch(/online|offline|display/);
    }
  });

  it('shows only labels from the approved set', () => {
    const approved = new Set(Object.values(SCREEN_STATUS_LABELS));
    expect(approved).toEqual(
      new Set([
        'In sync',
        'Standing by',
        'Updating',
        'Not reporting',
        'Error',
        'Waiting for player',
        'Nothing pushed',
        'Not paired',
      ]),
    );
    for (const candidate of everyView()) {
      expect(approved.has(screenStatus(candidate, 0).label)).toBe(true);
    }
  });

  it('takes the stale flag from the API and never derives it from the age of a report', () => {
    const old = screenStatus(view({ lastHeartbeatAt: '2026-11-13T03:00:00.000Z' }), 0);
    expect(old.stale).toBe(false);
    expect(old.reportBadge).toBe('none');
    expect(old.kind).toBe('in_sync');
    expect(old.tone).toBe('ok');

    const flagged = screenStatus(view({ summary: 'stale', stale: true }), 0);
    expect(flagged.stale).toBe(true);
    expect(flagged.reportBadge).toBe('stale');
    expect(flagged.kind).toBe('not_reporting');

    // A long time since the fetch does not change the kind either.
    expect(screenStatus(view(), 3_600_000).kind).toBe('in_sync');
  });

  it('always says when the player last reported', () => {
    expect(screenStatus(view(), 0).detail).toBe('Last report 10 seconds ago');
    expect(screenStatus(view(), 5_000).detail).toBe('Last report 15 seconds ago');
    expect(screenStatus(view(), 5_000).lastReportAgeSeconds).toBe(15);
    expect(screenStatus(view({ asOf: '2026-11-14T03:09:51.000Z' }), 0).detail).toBe(
      'Last report just now',
    );
    // A workstation clock that runs backwards cannot make a report younger.
    expect(screenStatus(view(), -60_000).lastReportAgeSeconds).toBe(10);
    for (const candidate of everyView()) {
      expect(screenStatus(candidate, 0).detail).not.toBe('');
    }
  });

  it('distinguishes no report at all from an old report', () => {
    const none = screenStatus(
      view({ summary: 'awaiting_player', stale: true, lastHeartbeatAt: null }),
      0,
    );
    expect(none.detail).toBe('No report received');
    expect(none.lastReportAgeSeconds).toBeNull();
    expect(none.reportBadge).toBe('no_report');
    expect(none.label).toBe('Waiting for player');
  });

  it('says so when the time of the last report cannot be read', () => {
    const odd = screenStatus(view({ lastHeartbeatAt: 'not a time' }), 0);
    expect(odd.detail).toBe('Last report at an unknown time');
    expect(odd.lastReportAgeSeconds).toBeNull();
  });

  it('passes the summary through unchanged for data attributes', () => {
    for (const summary of DELIVERY_SUMMARIES) {
      expect(screenStatus(view({ summary }), 0).summary).toBe(summary);
    }
  });

  it('gives an error the danger tone and nothing else', () => {
    for (const candidate of everyView()) {
      const status = screenStatus(candidate, 0);
      expect(status.tone === 'danger').toBe(candidate.summary === 'error');
    }
  });

  it('shows standing_by as Standing by, neutral, counted with in sync', () => {
    const status = screenStatus(view({ summary: 'standing_by' }), 0);
    expect(status.label).toBe('Standing by');
    expect(status.tone).toBe('neutral');
    expect(status.explanation).toBe('Has the latest push; nothing in it is due to show right now.');
    expect(screenStatusGroup(status.kind)).toBe('in_sync');
  });

  it('maps every summary to a kind, a tone and a counter group', () => {
    const kinds = new Set(DELIVERY_SUMMARIES.map(screenStatusKindOf));
    expect(kinds).toEqual(new Set(SCREEN_STATUS_KINDS));
    expect(screenStatusTone('in_sync')).toBe('ok');
    for (const kind of SCREEN_STATUS_KINDS) {
      if (kind !== 'in_sync') expect(screenStatusTone(kind)).not.toBe('ok');
    }
    expect(SCREEN_STATUS_KINDS.map(screenStatusGroup)).toEqual([
      'in_sync',
      'in_sync',
      'pending',
      'attention',
      'attention',
      'pending',
      'pending',
      'not_paired',
    ]);
  });
});

describe('push state wording', () => {
  it('has a label and a sentence for every state of the contract', () => {
    expect(PUSH_STATE_PRESENTATIONS.map((p) => [p.state, p.label, p.tone])).toEqual([
      ['nothing_assigned', 'Nothing assigned', 'neutral'],
      ['never_pushed', 'Not pushed yet', 'warn'],
      ['changes', 'Changes waiting', 'warn'],
      ['up_to_date', 'Up to date', 'neutral'],
      ['blocked', 'Blocked', 'danger'],
    ]);
    for (const state of PUSH_STATES) {
      expect(presentPushState(state).detail.endsWith('.')).toBe(true);
    }
  });

  it('never borrows the healthy tone, which belongs to a player that reports in sync', () => {
    for (const state of PUSH_STATES) expect(presentPushState(state).tone).not.toBe('ok');
  });

  it('never uses a banned word, and never calls the object a display', () => {
    for (const state of PUSH_STATES) {
      const p = presentPushState(state);
      expect(`${p.label} ${p.detail}`.toLowerCase()).not.toMatch(/online|offline|display/);
    }
  });
});
