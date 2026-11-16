import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { mediaLoadProblem as detailLoadProblem } from '../../lib/mediaDetailState.ts';
import { EditorPage } from '../../shell/EditorPage.tsx';
import { ArrowLeft, Blocks } from '../../ui/icons.ts';
import {
  ButtonLink,
  Card,
  EmptyState,
  ErrorNotice,
  Skeleton,
  SkeletonGroup,
} from '../../ui/index.ts';
import { AppEditor, APPS_BACK } from './AppEditor.tsx';
import './apps.css';

/**
 * The app editor page: loads the app and keeps the frame while it does; the editor itself is
 * `AppEditor.tsx`, mounted afresh for each app.
 */
export function AppEditorPage() {
  const { id = '' } = useParams();
  const load = useCallback((signal: AbortSignal) => api.getApp(id, signal), [id]);
  const { state, reload } = useLoad(load);

  if (state.status === 'ready') return <AppEditor key={state.data.id} initial={state.data} />;

  if (state.status === 'error') {
    const refusal = isApiRequestError(state.error) ? state.error : null;
    if (detailLoadProblem(refusal) === 'missing') {
      return (
        <EditorPage title="App not found" back={APPS_BACK}>
          <Card data-testid="app-editor-missing">
            <EmptyState
              variant="inline"
              level={2}
              icon={Blocks}
              title="This app could not be loaded"
              action={
                <ButtonLink variant="primary" to="/apps" icon={ArrowLeft}>
                  Go to all apps
                </ButtonLink>
              }
            >
              It is not one of this organisation&rsquo;s apps. It may have been deleted, or the
              address may be wrong.
            </EmptyState>
          </Card>
        </EditorPage>
      );
    }
    return (
      <EditorPage title="App" back={APPS_BACK}>
        <ErrorNotice error={state.error} title="The app could not be loaded" onRetry={reload} />
      </EditorPage>
    );
  }

  return (
    <EditorPage title="App" back={APPS_BACK}>
      <SkeletonGroup label="Loading app" className="tx-editor">
        <Skeleton variant="block" height="420px" />
        <Skeleton variant="block" height="560px" />
      </SkeletonGroup>
    </EditorPage>
  );
}
