import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { mediaLoadProblem as detailLoadProblem } from '../../lib/mediaDetailState.ts';
import { EditorPage } from '../../shell/EditorPage.tsx';
import { ArrowLeft, LayoutTemplate } from '../../ui/icons.ts';
import {
  ButtonLink,
  Card,
  EmptyState,
  ErrorNotice,
  Skeleton,
  SkeletonGroup,
} from '../../ui/index.ts';
import { LayoutEditor, LAYOUTS_BACK } from './LayoutEditor.tsx';
import './layouts.css';

/**
 * The layout editor page: loads the layout and the playlists its selects list, and keeps the
 * frame while it does; the editor itself is `LayoutEditor.tsx`, mounted afresh for each
 * layout. The screens for "Preview on" are read by the preview, so a failure there never
 * keeps the editor from opening.
 */
export function LayoutEditorPage() {
  const { id = '' } = useParams();
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [layout, playlists] = await Promise.all([
        api.getLayout(id, signal),
        api.listPlaylists(signal),
      ]);
      return { layout, playlists };
    },
    [id],
  );
  const { state, reload } = useLoad(load);

  if (state.status === 'ready') {
    return (
      <LayoutEditor
        key={state.data.layout.id}
        initial={state.data.layout}
        playlists={state.data.playlists}
      />
    );
  }

  if (state.status === 'error') {
    const refusal = isApiRequestError(state.error) ? state.error : null;
    if (detailLoadProblem(refusal) === 'missing') {
      return (
        <EditorPage title="Layout not found" back={LAYOUTS_BACK}>
          <Card data-testid="layout-editor-missing">
            <EmptyState
              variant="inline"
              level={2}
              icon={LayoutTemplate}
              title="This layout could not be loaded"
              action={
                <ButtonLink variant="primary" to="/layouts" icon={ArrowLeft}>
                  Go to all layouts
                </ButtonLink>
              }
            >
              It is not one of this organisation&rsquo;s layouts. It may have been deleted, or the
              address may be wrong.
            </EmptyState>
          </Card>
        </EditorPage>
      );
    }
    return (
      <EditorPage title="Layout" back={LAYOUTS_BACK}>
        <ErrorNotice error={state.error} title="The layout could not be loaded" onRetry={reload} />
      </EditorPage>
    );
  }

  return (
    <EditorPage title="Layout" back={LAYOUTS_BACK}>
      <SkeletonGroup label="Loading layout" className="tx-editor">
        <Skeleton variant="block" height="560px" />
        <Skeleton variant="block" height="480px" />
      </SkeletonGroup>
    </EditorPage>
  );
}
