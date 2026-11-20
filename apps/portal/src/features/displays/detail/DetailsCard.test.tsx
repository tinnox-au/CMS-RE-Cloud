import type { DisplayDto } from '@tinnox/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { WithSession } from '../../../session/session.test-support.tsx';
import { ToastProvider } from '../../../ui/index.ts';
import { DetailsCard } from './DetailsCard.tsx';

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
  assignedSchedule: null,
  assignedLayout: null,
  createdAt: T,
  updatedAt: T,
};

afterEach(() => {
  patchDisplay.mockReset();
});

describe('DetailsCard: as a Viewer', () => {
  it('sends nothing on Enter in the name field and has no Save', async () => {
    const screen = await render(
      <WithSession role="viewer">
        <ToastProvider>
          <DetailsCard
            display={DISPLAY}
            site={null}
            readOnly
            // A changed draft: without the read-only guard, Enter would send it.
            draft={{ name: 'Foyer', description: '' }}
            onDraft={() => undefined}
            onSaved={() => undefined}
          />
        </ToastProvider>
      </WithSession>,
    );
    await expect
      .element(screen.getByText('Editors change the screen’s name and description.'))
      .toBeVisible();
    const name = screen.getByTestId('screen-detail-name');
    await expect.element(name).toHaveAttribute('readonly');

    // Scoped to the field: `userEvent.keyboard` first finds the test frame by name, which can
    // still be the previous file's frame as it goes away ("Frame was detached").
    await userEvent.type(name, '{Enter}');
    // Give a request that wrongly starts the time to be made.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(patchDisplay).not.toHaveBeenCalled();
    await expect.element(screen.getByTestId('screen-detail-details-save')).not.toBeInTheDocument();
  });
});
