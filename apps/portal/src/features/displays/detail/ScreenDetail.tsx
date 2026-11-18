import type { DeliveryStatusView, DisplayDto, Rotation } from '@tinnox/contracts';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../../api/index.ts';
import { useLoad } from '../../../hooks/useLoad.ts';
import { displayFormFromDto, type DisplayFormValues } from '../../../lib/displayForm.ts';
import {
  endPairingWords,
  revokeOutcomeText,
  sameTagIds,
  SCREEN_STATUS_POLL_MS,
  screenDetailSearch,
  screenDetailsDirty,
  screenDetailTabOf,
  workingHoursDirty,
  type ScreenDetailOpenTabId,
  type ScreenDetailsValues,
  type WorkingHoursDraft,
} from '../../../lib/screenDetail.ts';
import { canvasFormDirty } from '../../../lib/screenDetailCanvas.ts';
import { EditorPage } from '../../../shell/EditorPage.tsx';
import { ConfirmDialog, ErrorNotice } from '../../../ui/index.ts';
import { usePush } from '../../push/PushContext.tsx';
import { useLeaveGuard, useTags } from '../../shared/index.ts';
import { ContentCard } from './ContentCard.tsx';
import { DetailsCard } from './DetailsCard.tsx';
import { ScreenTabs } from './ScreenTabs.tsx';
import { SummaryCard } from './SummaryCard.tsx';
import type { RevokeOrigin, RevokeState, ScreenDetailData } from './types.ts';
import { useAssignedPlaylist } from './useAssignedPlaylist.ts';
import { useSectionSave } from './useSectionSave.ts';
import './screenDetail.css';

export type { ScreenDetailData } from './types.ts';

export interface ScreenDetailProps {
  readonly data: ScreenDetailData;
  /** Set when reading the screen again failed; `data` is then the last good answer. */
  readonly refreshError: unknown;
  readonly back: { readonly to: string; readonly label: string };
  /** Reads the screen again. */
  readonly onReload: () => void;
  /** Replaces the screen with what a save answered. */
  readonly onChanged: (data: ScreenDetailData) => void;
}

/** The loaded screen page. `DisplayDetailPage` renders it once the screen has been read. */
export function ScreenDetail({ data, refreshError, back, onReload, onChanged }: ScreenDetailProps) {
  const { display, site } = data;
  const push = usePush();
  const tags = useTags('display');
  const assigned = useAssignedPlaylist(display);
  const [params, setParams] = useSearchParams();
  const tab = screenDetailTabOf(params.get('tab'));

  const selectTab = (next: ScreenDetailOpenTabId) => {
    setParams(new URLSearchParams(screenDetailSearch(window.location.search.slice(1), next)), {
      replace: true,
      preventScrollReset: true,
    });
  };

  // ---- Status, read every 5 s so the stale flag flips without a reload ----
  const [statusKey, setStatusKey] = useState(0);
  const loadStatus = useCallback(
    (signal: AbortSignal): Promise<DeliveryStatusView> => {
      // statusKey changes after pairing or revoking, so the status is read at once.
      void statusKey;
      return api.getDisplayStatus(display.id, signal);
    },
    [display.id, statusKey],
  );
  const status = useLoad(loadStatus, SCREEN_STATUS_POLL_MS);
  const reloadStatus = status.reload;

  // ---- Drafts, kept here so switching tabs keeps them; null means "as stored" ----
  const [detailsDraft, setDetailsDraft] = useState<ScreenDetailsValues | null>(null);
  const [canvasDraft, setCanvasDraft] = useState<DisplayFormValues | null>(null);
  const [rotationDraft, setRotationDraft] = useState<Rotation | null>(null);
  const [tagsDraft, setTagsDraft] = useState<readonly string[] | null>(null);
  const [workingHoursDraft, setWorkingHoursDraft] = useState<WorkingHoursDraft | null>(null);
  // Save state too: a save outlives its tab, so its answer cannot clear newer input (FCX-03).
  const canvasSave = useSectionSave();
  const tagsSave = useSectionSave();
  const workingHoursSave = useSectionSave();
  const saving = canvasSave.saving || tagsSave.saving || workingHoursSave.saving;

  const dirty =
    (detailsDraft !== null && screenDetailsDirty(detailsDraft, display)) ||
    ((canvasDraft !== null || rotationDraft !== null) &&
      canvasFormDirty(
        canvasDraft ?? displayFormFromDto(display),
        display,
        rotationDraft ?? display.rotation,
      )) ||
    (tagsDraft !== null && !sameTagIds(tagsDraft, display.tagIds)) ||
    (workingHoursDraft !== null && workingHoursDirty(workingHoursDraft, display.workingHours));

  const leaveGuard = useLeaveGuard(dirty, display.name, saving);

  const changed = (next: DisplayDto) => {
    onChanged({ display: next, site });
  };

  // ---- Pairing and revoking change the player, so the status is read at once ----
  const afterPlayerChange = useCallback(() => {
    onReload();
    setStatusKey((value) => value + 1);
  }, [onReload]);

  // With no player paired, the same request cancels a pairing code accepted but not yet collected.
  const paired = display.player !== null;
  const endPairing = endPairingWords(paired);
  const [revoke, setRevoke] = useState<RevokeState | null>(null);
  const askRevoke = (origin: RevokeOrigin) => {
    setRevoke({ origin, confirming: true, busy: false, error: null, result: null });
  };
  const runRevoke = () => {
    if (revoke === null || revoke.busy) return;
    const origin = revoke.origin;
    setRevoke({ origin, confirming: true, busy: true, error: null, result: null });
    api
      .revokePlayer(display.id)
      .then((result) => {
        setRevoke({
          origin,
          confirming: false,
          busy: false,
          error: null,
          result: revokeOutcomeText(result.revokedRegistrationId, result.cancelledPairingCount),
        });
        afterPlayerChange();
      })
      .catch((error: unknown) => {
        setRevoke({ origin, confirming: false, busy: false, error, result: null });
      });
  };
  const dismissRevoke = () => {
    setRevoke((current) => (current === null || current.busy ? current : null));
  };

  return (
    <EditorPage
      title={display.name}
      back={back}
      status={
        dirty ? (
          <span role="status" data-testid="screen-detail-unsaved">
            Unsaved changes
          </span>
        ) : undefined
      }
    >
      <div className="tx-stack">
        {refreshError !== null && (
          <ErrorNotice error={refreshError} title="The screen could not be refreshed" />
        )}
        <div className="tx-editor tx-screen-detail" data-testid="screen-detail">
          <div className="tx-screen-detail__aside">
            <SummaryCard
              display={display}
              assigned={assigned.state}
              status={status.state}
              onReloadStatus={reloadStatus}
              onPush={() => {
                push.openDialog({ only: [display.id] });
              }}
              onRevoke={() => {
                askRevoke('summary');
              }}
              onShowPairing={() => {
                selectTab('pairing');
              }}
              revoke={revoke?.origin === 'summary' ? revoke : null}
              onDismissRevoke={dismissRevoke}
            />
          </div>
          <div className="tx-screen-detail__column">
            <DetailsCard
              display={display}
              site={site}
              draft={detailsDraft}
              onDraft={setDetailsDraft}
              onSaved={(next) => {
                setDetailsDraft(null);
                changed(next);
              }}
            />
            <ContentCard
              display={display}
              assigned={assigned.state}
              onReloadAssigned={assigned.reload}
              onAssigned={changed}
            />
          </div>
          <div className="tx-screen-detail__tabs">
            <ScreenTabs
              tab={tab}
              onTab={selectTab}
              display={display}
              site={site}
              status={status.state}
              onReloadStatus={reloadStatus}
              canvasDraft={canvasDraft}
              onCanvasDraft={setCanvasDraft}
              rotationDraft={rotationDraft}
              onRotationDraft={setRotationDraft}
              tags={tags}
              tagsDraft={tagsDraft}
              onTagsDraft={setTagsDraft}
              workingHoursDraft={workingHoursDraft}
              onWorkingHoursDraft={setWorkingHoursDraft}
              onSaved={changed}
              saves={{ canvas: canvasSave, tags: tagsSave, workingHours: workingHoursSave }}
              onPaired={afterPlayerChange}
              onRevoke={() => {
                askRevoke('pairing');
              }}
              revoke={revoke?.origin === 'pairing' ? revoke : null}
              onDismissRevoke={dismissRevoke}
            />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={revoke?.confirming === true}
        title={endPairing.dialogTitle}
        confirmLabel={endPairing.confirmLabel}
        cancelLabel={endPairing.cancelLabel}
        tone={paired ? 'danger' : 'default'}
        busy={revoke?.busy === true}
        onConfirm={runRevoke}
        onCancel={dismissRevoke}
      >
        {paired ? (
          <p>
            The player paired with <strong>{display.name}</strong> will lose access immediately. To
            use it again it must be paired with a new code. Content it already cached stays on the
            device until it is reset there. Every pairing code accepted for this screen that no
            player has collected yet is cancelled too.
          </p>
        ) : (
          <p>
            This applies to the whole screen: every pairing code accepted for{' '}
            <strong>{display.name}</strong> that no player has collected yet will stop working. If a
            player has collected its credential in the meantime, that credential is revoked. To pair
            a player afterwards, enter the code it shows then.
          </p>
        )}
      </ConfirmDialog>

      {leaveGuard.dialog}
    </EditorPage>
  );
}
