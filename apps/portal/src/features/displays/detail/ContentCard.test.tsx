import type { DisplayDto } from '@tinnox/contracts';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { ToastProvider } from '../../../ui/index.ts';
import { PushContext, type PushContextValue } from '../../push/PushContext.tsx';
import { ContentCard } from './ContentCard.tsx';

const { patchDisplay } = vi.hoisted(() => ({
  patchDisplay: vi.fn<(id: string, patch: unknown) => Promise<DisplayDto>>(),
}));
vi.mock('../../../api/index.ts', () => ({ api: { patchDisplay } }));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-11-14T03:00:00.000Z';

const DISPLAY: DisplayDto = {
  id: ID(1),
  siteId: ID(900),
  name: 'Lobby',
  description: null,
  canvas: { width: 1920, height: 1080 },
  contentRect: null,
  defaultFit: 'contain',
  rotation: 0,
  workingHours: null,
  route: 'browser',
  player: null,
  tagIds: [],
  assignedPlaylist: null,
  assignedSchedule: {
    id: ID(30),
    name: 'Shop week',
    defaultPlaylist: { id: ID(20), name: 'Loop' },
  },
  createdAt: T,
  updatedAt: T,
};

const PUSH: PushContextValue = {
  plan: null,
  planError: null,
  pendingCount: null,
  refresh: () => undefined,
  openDialog: () => undefined,
  openPush: () => undefined,
  refreshPending: () => undefined,
};

function renderCard() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PushContext value={PUSH}>
          <ContentCard
            display={DISPLAY}
            assigned={{ status: 'loading' }}
            onReloadAssigned={() => undefined}
            onAssigned={() => undefined}
          />
        </PushContext>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  patchDisplay.mockReset();
});

describe('ContentCard: the Change menu while "Remove content" is saved', () => {
  it('opens from the keyboard while nothing is being saved', async () => {
    const screen = await renderCard();
    const change = screen.getByTestId('screen-detail-change-content');
    (change.element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(screen.getByRole('menuitem', { name: 'Remove content' })).toBeVisible();
  });

  it('does not open from the keyboard, and saves once, while the removal is in flight', async () => {
    // The PATCH never answers, so the save stays in flight for the rest of the test.
    patchDisplay.mockReturnValue(new Promise(() => undefined));
    const screen = await renderCard();
    const change = screen.getByTestId('screen-detail-change-content');

    await change.click();
    await screen.getByRole('menuitem', { name: 'Remove content' }).click();
    expect(patchDisplay).toHaveBeenCalledTimes(1);
    expect(patchDisplay).toHaveBeenCalledWith(DISPLAY.id, {
      assignedPlaylistId: null,
      assignedScheduleId: null,
    });
    await expect.element(change).toHaveAttribute('aria-busy', 'true');

    // Each key on its own: Enter in an open menu would choose an item and close it again.
    for (const key of ['{ArrowDown}', '{ArrowUp}']) {
      (change.element() as HTMLElement).focus();
      await userEvent.keyboard(key);
      // Give a menu that wrongly opens the time to render before looking.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(screen.getByRole('menuitem').elements(), key).toHaveLength(0);
    }
    await userEvent.keyboard('{Enter}');
    await change.click({ force: true });
    expect(screen.getByRole('menuitem').elements()).toHaveLength(0);
    expect(patchDisplay).toHaveBeenCalledTimes(1);
  });
});
