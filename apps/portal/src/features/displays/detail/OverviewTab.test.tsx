import type { DeliveryStatusView } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { WithSession } from '../../../session/session.test-support.tsx';
import { OverviewTab } from './OverviewTab.tsx';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-11-14T03:00:00.000Z';

const VIEW: DeliveryStatusView = {
  displayId: ID(1),
  paired: true,
  registrationId: ID(2),
  desired: { publicationId: ID(3), publishedAt: T },
  downloaded: { publicationId: ID(3) },
  active: { publicationId: ID(3), itemIndex: 0 },
  playerState: 'playing',
  staging: null,
  lastHeartbeatAt: T,
  stale: false,
  staleAfterSeconds: 60,
  errors: [],
  summary: 'in_sync',
  asOf: T,
};

describe('OverviewTab', () => {
  it('says what was set in TINNOX CMS, never "the operator", to every role', async () => {
    const screen = await render(
      <WithSession role="viewer">
        <OverviewTab
          status={{ status: 'ready', data: VIEW, refreshError: null, fetchedAt: performance.now() }}
          onReload={() => undefined}
          contentKind={null}
        />
      </WithSession>,
    );
    await expect.element(screen.getByRole('heading', { name: 'Set in TINNOX CMS' })).toBeVisible();
    await expect
      .element(screen.getByRole('heading', { name: 'Reported by player software' }))
      .toBeVisible();
    expect(screen.getByTestId('screen-detail-overview').element().textContent).not.toMatch(
      /operator/i,
    );
  });
});
