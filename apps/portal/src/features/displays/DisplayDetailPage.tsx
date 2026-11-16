import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { mediaLoadProblem as detailLoadProblem } from '../../lib/mediaDetailState.ts';
import { EditorPage } from '../../shell/EditorPage.tsx';
import { ArrowLeft, MonitorOff } from '../../ui/icons.ts';
import { ButtonLink, Card, EmptyState, ErrorNotice } from '../../ui/index.ts';
import { ScreenDetail, type ScreenDetailData } from './detail/ScreenDetail.tsx';
import { ScreenDetailSkeleton } from './detail/ScreenDetailSkeleton.tsx';
import './detail/screenDetail.css';

const BACK = { to: '/screens', label: 'All screens' } as const;

/**
 * A screen's page (docs/portal-v2/stage-a.md, section 3.8): the assigned content preview and
 * the status on the left; name, description, content and the tabs on the right. The
 * selected tab is kept in the address as `?tab=` (`/screens/:id/edit` lands on `?tab=canvas`).
 */
export function DisplayDetailPage() {
  const { id } = useParams();
  const displayId = id ?? '';
  const load = useCallback(
    async (signal: AbortSignal): Promise<ScreenDetailData> => {
      const [display, sites] = await Promise.all([
        api.getDisplay(displayId, signal),
        api.listSites(signal),
      ]);
      return { display, site: sites.find((site) => site.id === display.siteId) ?? null };
    },
    [displayId],
  );
  const { state, reload, setData } = useLoad(load);

  if (state.status === 'loading') {
    return (
      <EditorPage title="Screen" back={BACK}>
        <ScreenDetailSkeleton />
      </EditorPage>
    );
  }
  if (state.status === 'error') {
    const refusal = isApiRequestError(state.error) ? state.error : null;
    if (detailLoadProblem(refusal) === 'missing') {
      // A definite 404, or an address without a valid id: trying again cannot help, so the
      // page says so and leads back to the list, as the media details page does.
      return (
        <EditorPage title="Screen not found" back={BACK}>
          <Card className="tx-screen-detail-missing" data-testid="screen-detail-missing">
            <EmptyState
              variant="inline"
              level={2}
              icon={MonitorOff}
              title="This screen could not be loaded"
              action={
                <ButtonLink variant="primary" to="/screens" icon={ArrowLeft}>
                  Go to all screens
                </ButtonLink>
              }
            >
              It is not one of this organisation&rsquo;s screens. The address may be wrong.
            </EmptyState>
            {refusal !== null && (
              <p className="tx-screen-detail-missing__answer">
                Server answer: {refusal.message}{' '}
                <span className="tx-code" data-testid="screen-detail-missing-code">
                  {refusal.code}
                </span>
                {refusal.requestId !== null && (
                  <>
                    {' '}
                    · Request reference <span className="tx-mono">{refusal.requestId}</span>
                  </>
                )}
              </p>
            )}
          </Card>
        </EditorPage>
      );
    }
    return (
      <EditorPage title="Screen" back={BACK}>
        <div className="tx-screen-detail-failed" data-testid="screen-detail-load-error">
          <ErrorNotice
            error={state.error}
            title="The screen could not be loaded"
            onRetry={reload}
          />
        </div>
      </EditorPage>
    );
  }
  return (
    <ScreenDetail
      key={state.data.display.id}
      data={state.data}
      refreshError={state.refreshError}
      back={BACK}
      onReload={reload}
      onChanged={setData}
    />
  );
}
