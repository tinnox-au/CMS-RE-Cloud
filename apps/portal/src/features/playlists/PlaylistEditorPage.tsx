import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { mediaLoadProblem as detailLoadProblem } from '../../lib/mediaDetailState.ts';
import { EditorPage } from '../../shell/EditorPage.tsx';
import { ArrowLeft, ListX } from '../../ui/icons.ts';
import { ButtonLink, Card, EmptyState, ErrorNotice } from '../../ui/index.ts';
import { EditorSkeleton } from './editor/EditorSkeleton.tsx';
import './editor/playlistEditor.css';
import { PlaylistEditor, PLAYLIST_EDITOR_BACK } from './editor/PlaylistEditor.tsx';

/**
 * The playlist editor (docs/portal-v2/stage-a.md, 3.5): details, the sequence as a
 * filmstrip, the library to add from, and the screens that play the playlist.
 *
 * This component loads the playlist and keeps the frame while it does; the editor itself is
 * `editor/PlaylistEditor.tsx`, mounted afresh for each playlist.
 */
export function PlaylistEditorPage() {
  const { id } = useParams();
  const playlistId = id ?? '';
  const load = useCallback(
    (signal: AbortSignal) => api.getPlaylist(playlistId, signal),
    [playlistId],
  );
  const { state, reload } = useLoad(load);

  if (state.status === 'ready') {
    return <PlaylistEditor key={state.data.id} initial={state.data} />;
  }
  if (state.status === 'error') {
    const refusal = isApiRequestError(state.error) ? state.error : null;
    if (detailLoadProblem(refusal) === 'missing') {
      // A definite 404, or an address without a valid id: trying again cannot help, so the
      // page says so and leads back to the list, as the media and screen details pages do.
      return (
        <EditorPage title="Playlist not found" back={PLAYLIST_EDITOR_BACK}>
          <Card className="tx-playlist-editor-missing" data-testid="playlist-editor-missing">
            <EmptyState
              variant="inline"
              level={2}
              icon={ListX}
              title="This playlist could not be loaded"
              action={
                <ButtonLink variant="primary" to="/playlists" icon={ArrowLeft}>
                  Go to all playlists
                </ButtonLink>
              }
            >
              It is not one of this organisation&rsquo;s playlists. It may have been deleted, or the
              address may be wrong.
            </EmptyState>
            {refusal !== null && (
              <p className="tx-playlist-editor-missing__answer">
                Server answer: {refusal.message}{' '}
                <span className="tx-code" data-testid="playlist-editor-missing-code">
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
  }
  return (
    <EditorPage title="Playlist" back={PLAYLIST_EDITOR_BACK}>
      {state.status === 'loading' ? (
        <EditorSkeleton />
      ) : (
        <ErrorNotice
          error={state.error}
          title="The playlist could not be loaded"
          onRetry={reload}
        />
      )}
    </EditorPage>
  );
}
