import type { DisplayDto, Role } from '@tinnox/contracts';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import type { AlertsDraft } from '../../../lib/screenDetail.ts';
import { WithSession } from '../../../session/session.test-support.tsx';
import { ToastProvider } from '../../../ui/index.ts';
import { AlertsTab } from './AlertsTab.tsx';
import { useSectionSave } from './useSectionSave.ts';

const { patchDisplay } = vi.hoisted(() => ({
  patchDisplay: vi.fn<(id: string, patch: unknown) => Promise<DisplayDto>>(),
}));
vi.mock('../../../api/index.ts', () => ({ api: { patchDisplay } }));

const T = '2026-11-14T03:00:00.000Z';

const DISPLAY: DisplayDto = {
  id: '00000000-0000-4000-8000-000000000001',
  siteId: '00000000-0000-4000-8000-000000000900',
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
  assignedSchedule: null,
  assignedLayout: null,
  createdAt: T,
  updatedAt: T,
};

/** The page's part: it keeps the draft and the save state. */
function Harness({
  display,
  readOnly,
  onSaved,
}: {
  readonly display: DisplayDto;
  readonly readOnly: boolean;
  readonly onSaved: (display: DisplayDto) => void;
}) {
  const [draft, setDraft] = useState<AlertsDraft | null>(null);
  const save = useSectionSave();
  return (
    <AlertsTab
      display={display}
      draft={draft}
      onDraft={setDraft}
      onSaved={onSaved}
      save={save}
      readOnly={readOnly}
    />
  );
}

function renderTab(role: Role, display = DISPLAY, onSaved = vi.fn()) {
  return render(
    <WithSession role={role}>
      <ToastProvider>
        <MemoryRouter>
          <Harness display={display} readOnly={role === 'viewer'} onSaved={onSaved} />
        </MemoryRouter>
      </ToastProvider>
    </WithSession>,
  );
}

afterEach(() => {
  patchDisplay.mockReset();
});

describe('AlertsTab', () => {
  it('shows a Viewer the settings without a way to change them', async () => {
    const screen = await renderTab('viewer');
    await expect.element(screen.getByText('Editors change this screen’s alerts.')).toBeVisible();
    const delay = screen.getByLabelText('E-mail when this screen stops reporting');
    await expect.element(delay).toBeDisabled();
    await expect.element(delay).toHaveValue('30');
    await expect.element(screen.getByLabelText('Also e-mail when it reports again')).toBeDisabled();
    await expect.element(screen.getByTestId('screen-detail-alerts-save')).not.toBeInTheDocument();
    expect(patchDisplay).not.toHaveBeenCalled();
  });

  it('saves a new delay and the back-online choice for an Editor', async () => {
    const onSaved = vi.fn();
    const saved = { ...DISPLAY, alertOfflineMinutes: 120, alertBackOnline: false };
    patchDisplay.mockResolvedValue(saved);
    const screen = await renderTab('editor', DISPLAY, onSaved);

    await screen.getByLabelText('E-mail when this screen stops reporting').selectOptions('2 hours');
    await screen.getByLabelText('Also e-mail when it reports again').click();
    await expect.element(screen.getByText('Unsaved changes')).toBeVisible();
    await screen.getByTestId('screen-detail-alerts-save').click();

    expect(patchDisplay).toHaveBeenCalledWith(DISPLAY.id, {
      alertOfflineMinutes: 120,
      alertBackOnline: false,
    });
    await expect
      .element(screen.getByRole('region', { name: 'Notifications' }).getByText('Alerts saved'))
      .toBeVisible();
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it('turns alerts off, which hides the back-online choice', async () => {
    patchDisplay.mockResolvedValue({ ...DISPLAY, alertOfflineMinutes: null });
    const screen = await renderTab('editor');
    await screen.getByLabelText('E-mail when this screen stops reporting').selectOptions('Off');
    await expect
      .element(screen.getByLabelText('Also e-mail when it reports again'))
      .not.toBeInTheDocument();
    await screen.getByTestId('screen-detail-alerts-save').click();
    expect(patchDisplay).toHaveBeenCalledWith(DISPLAY.id, {
      alertOfflineMinutes: null,
      alertBackOnline: true,
    });
  });

  it('shows a stored delay that is not one of the choices, and keeps it a choice', async () => {
    const screen = await renderTab('editor', { ...DISPLAY, alertOfflineMinutes: 90 });
    const delay = screen.getByLabelText('E-mail when this screen stops reporting');
    await expect.element(delay).toHaveValue('90');
    await expect
      .element(screen.getByRole('option', { name: '1 hour 30 minutes' }))
      .toBeInTheDocument();
    await delay.selectOptions('1 hour');
    await expect
      .element(screen.getByRole('option', { name: '1 hour 30 minutes' }))
      .toBeInTheDocument();
    await delay.selectOptions('1 hour 30 minutes');
    await expect.element(delay).toHaveValue('90');
    await expect.element(screen.getByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('ties the working-hours rule to the select, and tells an Editor who chooses the addresses', async () => {
    const editor = await renderTab('editor');
    await expect
      .element(editor.getByLabelText('E-mail when this screen stops reporting'))
      .toHaveAccessibleDescription(
        'The delay counts only time inside the screen’s working hours; closed hours pause it.',
      );
    await expect
      .element(editor.getByText('An Admin or Owner chooses who receives them.', { exact: false }))
      .toBeVisible();
    await expect
      .element(editor.getByTestId('screen-detail-alerts-addresses'))
      .not.toBeInTheDocument();
  });

  it('links an Admin to the address list', async () => {
    const admin = await renderTab('admin');
    await expect
      .element(admin.getByRole('link', { name: 'Alert addresses' }))
      .toHaveAttribute('href', '/settings/alerts');
  });
});
