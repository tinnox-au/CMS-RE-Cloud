import type { DisplayDto, Role } from '@tinnox/contracts';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { WithSession } from '../../../session/session.test-support.tsx';
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
  alertOfflineMinutes: 30,
  alertBackOnline: true,
  route: 'browser',
  player: null,
  tagIds: [],
  assignedPlaylist: null,
  assignedSchedule: {
    id: ID(30),
    name: 'Shop week',
    defaultPlaylist: { id: ID(20), name: 'Loop' },
  },
  assignedLayout: null,
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

function renderCard(display: DisplayDto = DISPLAY, role: Role = 'owner') {
  return render(
    <MemoryRouter>
      <WithSession role={role}>
        <ToastProvider>
          <PushContext value={PUSH}>
            <ContentCard
              display={display}
              assigned={{ status: 'loading' }}
              onReloadAssigned={() => undefined}
              onAssigned={() => undefined}
            />
          </PushContext>
        </ToastProvider>
      </WithSession>
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
    // Scoped to the button: `userEvent.keyboard` first finds the test frame by name, which can
    // still be the previous file's frame as it goes away ("Frame was detached").
    await userEvent.type(change, '{ArrowDown}');
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
      assignedLayoutId: null,
    });
    await expect.element(change).toHaveAttribute('aria-busy', 'true');

    // Each key on its own: Enter in an open menu would choose an item and close it again.
    for (const key of ['{ArrowDown}', '{ArrowUp}']) {
      await userEvent.type(change, key);
      // Give a menu that wrongly opens the time to render before looking.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(screen.getByRole('menuitem').elements(), key).toHaveLength(0);
    }
    await userEvent.type(change, '{Enter}');
    await change.click({ force: true });
    expect(screen.getByRole('menuitem').elements()).toHaveLength(0);
    expect(patchDisplay).toHaveBeenCalledTimes(1);
  });
});

describe('ContentCard: layouts', () => {
  it('shows a layout with its main zone and a link to it', async () => {
    const screen = await renderCard({
      ...DISPLAY,
      assignedSchedule: null,
      assignedLayout: {
        id: ID(40),
        name: 'Foyer band',
        mainPlaylist: { id: ID(20), name: 'Loop' },
      },
    });
    const card = screen.getByTestId('screen-detail-playlist');
    await expect.element(card.getByText('Layout', { exact: true })).toBeVisible();
    await expect.element(card.getByText('Foyer band')).toBeVisible();
    await expect
      .element(screen.getByTestId('screen-detail-main-playlist'))
      .toHaveTextContent('Main zone: Loop');
    await expect
      .element(screen.getByTestId('screen-detail-open-layout'))
      .toHaveAttribute('href', `/layouts/${ID(40)}`);
    await expect
      .element(screen.getByTestId('screen-detail-open-layout'))
      .toHaveTextContent('Open layout');
  });

  it('offers a layout beside a playlist and a schedule when nothing is assigned', async () => {
    const screen = await renderCard({ ...DISPLAY, assignedSchedule: null });
    await expect.element(screen.getByTestId('screen-detail-choose-playlist')).toBeVisible();
    await expect.element(screen.getByTestId('screen-detail-choose-schedule')).toBeVisible();
    await expect
      .element(screen.getByTestId('screen-detail-choose-layout'))
      .toHaveTextContent('Assign layout');
    await expect
      .element(
        screen.getByText(
          'Choose a playlist, a schedule or a layout for this screen, then push it.',
        ),
      )
      .toBeVisible();
  });
});

describe('ContentCard: as a Viewer', () => {
  it('has no Change menu and keeps the link to the assigned playlist', async () => {
    const screen = await renderCard(
      { ...DISPLAY, assignedSchedule: null, assignedPlaylist: { id: ID(20), name: 'Loop' } },
      'viewer',
    );
    await expect
      .element(screen.getByTestId('screen-detail-open-playlist'))
      .toHaveTextContent('Open playlist');
    await expect
      .element(screen.getByTestId('screen-detail-change-content'))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText('Assigning changes nothing on the screen until you push.'))
      .not.toBeInTheDocument();
  });

  it('says an editor assigns content when nothing is assigned, with no buttons', async () => {
    const screen = await renderCard({ ...DISPLAY, assignedSchedule: null }, 'viewer');
    await expect.element(screen.getByText('An editor assigns content.')).toBeVisible();
    await expect
      .element(screen.getByTestId('screen-detail-choose-playlist'))
      .not.toBeInTheDocument();
    expect(patchDisplay).not.toHaveBeenCalled();
  });
});
