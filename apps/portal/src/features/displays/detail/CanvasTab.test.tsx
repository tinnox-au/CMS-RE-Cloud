import type { DisplayDto } from '@tinnox/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { displayFormFromDto } from '../../../lib/displayForm.ts';
import { WithSession } from '../../../session/session.test-support.tsx';
import { ToastProvider } from '../../../ui/index.ts';
import { PushContext, type PushContextValue } from '../../push/PushContext.tsx';
import { CanvasTab } from './CanvasTab.tsx';
import type { SectionSave } from './types.ts';

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

const PUSH: PushContextValue = {
  plan: null,
  planError: null,
  pendingCount: null,
  refresh: () => undefined,
  openDialog: () => undefined,
  openPush: () => undefined,
  refreshPending: () => undefined,
};

const SAVE: SectionSave = {
  saving: false,
  error: null,
  setSaving: () => undefined,
  setError: () => undefined,
};

afterEach(() => {
  patchDisplay.mockReset();
});

describe('CanvasTab: as a Viewer', () => {
  it('sends nothing on Enter in Width and offers no size presets', async () => {
    const screen = await render(
      <WithSession role="viewer">
        <ToastProvider>
          <PushContext value={PUSH}>
            <CanvasTab
              display={DISPLAY}
              // A changed draft: the form has no dirty check, so only the read-only guard stops it.
              draft={{ ...displayFormFromDto(DISPLAY), width: '1280', height: '720' }}
              onDraft={() => undefined}
              rotationDraft={null}
              onRotationDraft={() => undefined}
              onSaved={() => undefined}
              save={SAVE}
              readOnly
            />
          </PushContext>
        </ToastProvider>
      </WithSession>,
    );
    await expect.element(screen.getByText('Editors change the canvas.')).toBeVisible();
    const width = screen.getByTestId('screen-detail-canvas-width');
    await expect.element(width).toHaveAttribute('readonly');

    // Scoped to the field: `userEvent.keyboard` first finds the test frame by name, which can
    // still be the previous file's frame as it goes away ("Frame was detached").
    await userEvent.type(width, '{Enter}');
    // The handler itself refuses too, however the form gets submitted.
    (screen.getByTestId('screen-detail-canvas-form').element() as HTMLFormElement).requestSubmit();
    // Give a request that wrongly starts the time to be made.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(patchDisplay).not.toHaveBeenCalled();

    expect(screen.getByRole('group', { name: 'Canvas size presets' }).elements()).toHaveLength(0);
    await expect.element(screen.getByTestId('screen-detail-canvas-save')).not.toBeInTheDocument();
    await expect.element(screen.getByTestId('screen-detail-canvas-fit')).toBeDisabled();
  });
});
