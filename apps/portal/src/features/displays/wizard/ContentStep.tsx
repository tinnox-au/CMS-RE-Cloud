import type { DisplayDto, PlaylistSummaryDto } from '@tinnox/contracts';
import { useCallback, useId, useMemo, useState } from 'react';
import { api } from '../../../api/index.ts';
import { useLoad } from '../../../hooks/useLoad.ts';
import { assignedContent } from '../../../lib/assignedContent.ts';
import { countLabel, matchesSearch } from '../../../lib/listView.ts';
import { playlistSummaryLabel } from '../../../lib/mediaName.ts';
import {
  ASSIGNED_NOTE,
  PLAYLIST_SEARCH_FROM,
  assignedPushBlock,
  contentStepAction,
  contentStepPlaylistMeta,
  contentStepPlaylists,
} from '../../../lib/screenWizard.ts';
import { ArrowLeft, Check, ListVideo, SearchX, Send } from '../../../ui/icons.ts';
import {
  Banner,
  Button,
  ButtonLink,
  EmptyState,
  ErrorNotice,
  SearchField,
  SkeletonGroup,
} from '../../../ui/index.ts';
import { usePush } from '../../push/PushContext.tsx';
import { PickRow, PickRowSkeletons } from '../../shared/PickRow.tsx';
import { PlaylistMosaic, PushStatePill } from '../../shared/index.ts';
import { StepFooter, StepPanel } from './StepPanel.tsx';
import './wizard.css';

export interface ContentStepProps {
  readonly display: DisplayDto;
  readonly focusHeading: boolean;
  /** The screen as `PATCH /api/displays/:id` answered after an assignment. */
  readonly onAssigned: (display: DisplayDto) => void;
  readonly onBack: () => void;
  /** Leave the wizard for the screen's page. */
  readonly onFinish: () => void;
}

/**
 * Step 3: assign a playlist to the screen, or skip. Assigning changes nothing on the screen
 * (P2-05): the step says so and offers the push dialog for this screen. "Finish" opens the
 * screen's page.
 */
export function ContentStep({
  display,
  focusHeading,
  onAssigned,
  onBack,
  onFinish,
}: ContentStepProps) {
  const push = usePush();
  const load = useCallback((signal: AbortSignal) => api.listPlaylists(signal), []);
  const { state, reload } = useLoad(load);
  const assignedId = display.assignedPlaylist?.id ?? null;
  // A schedule or a layout that the playlist assigned here would replace.
  const replaced = assignedContent(display)?.kind;
  const [chosen, setChosen] = useState<string | null>(assignedId);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const groupName = useId();

  // Empty playlists can be assigned but not pushed: they come last and say so on their row.
  const playlists: readonly PlaylistSummaryDto[] = useMemo(
    () => (state.status === 'ready' ? contentStepPlaylists(state.data) : []),
    [state],
  );
  const searchable = playlists.length >= PLAYLIST_SEARCH_FROM;
  const searching = searchable && query.trim() !== '';
  const shown = searching
    ? playlists.filter((playlist) => matchesSearch([playlist.name, playlist.description], query))
    : playlists;
  const action = contentStepAction(chosen, assignedId);
  const pushRow = push.plan?.items.find((row) => row.display.id === display.id) ?? null;
  const pushBlock = assignedPushBlock(
    pushRow,
    playlists.find((playlist) => playlist.id === assignedId) ?? null,
  );

  const assign = () => {
    if (busy || chosen === null || action !== 'assign') return;
    setBusy(true);
    setError(null);
    api
      .patchDisplay(display.id, { assignedPlaylistId: chosen })
      .then((updated) => {
        push.refresh();
        onAssigned(updated);
      })
      .catch((reason: unknown) => {
        setError(reason);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <StepPanel
        step="content"
        title="Choose content"
        description="Assign a playlist to this screen. You can change it at any time from the screen’s page."
        focusHeading={focusHeading}
        narrow
      >
        {display.assignedPlaylist !== null && (
          <Banner
            tone={pushBlock === null ? 'ok' : 'warn'}
            live="polite"
            icon={pushBlock === null ? Check : undefined}
            title={`Assigned: ${display.assignedPlaylist.name}`}
            actions={
              pushBlock !== null ? (
                <ButtonLink
                  size="sm"
                  to={`/playlists/${display.assignedPlaylist.id}`}
                  data-testid="screen-wizard-open-playlist"
                >
                  Open playlist
                </ButtonLink>
              ) : (
                <Button
                  size="sm"
                  icon={Send}
                  onClick={() => {
                    push.openDialog({ only: [display.id] });
                  }}
                  data-testid="screen-wizard-push-now"
                >
                  Push now
                </Button>
              )
            }
          >
            <span className="tx-stack tx-stack--tight">
              <span data-testid="screen-wizard-assigned-note">{pushBlock ?? ASSIGNED_NOTE}</span>
              {pushRow !== null && (
                <span>
                  <PushStatePill state={pushRow.state} testId="screen-wizard-push-state" />
                </span>
              )}
            </span>
          </Banner>
        )}

        {(replaced === 'schedule' || replaced === 'layout') && (
          <Banner tone="info">
            <span data-testid={`screen-wizard-${replaced}-note`}>
              This screen has a {replaced}. It gets the playlist you assign here instead of its{' '}
              {replaced}.
            </span>
          </Banner>
        )}

        {error !== null && <ErrorNotice error={error} title="The playlist was not assigned" />}

        <section className="tx-screen-wizard__playlists" aria-labelledby={`${groupName}-title`}>
          <div className="tx-screen-wizard__playlists-head">
            <h3 id={`${groupName}-title`} className="tx-caption">
              {state.status === 'ready' && playlists.length > 0
                ? searching
                  ? `${shown.length} of ${countLabel(playlists.length, 'playlist')}`
                  : countLabel(playlists.length, 'playlist')
                : 'Playlists'}
            </h3>
            {searchable && (
              <SearchField
                label="Search playlists"
                value={query}
                onChange={setQuery}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault();
                }}
                data-testid="screen-wizard-playlist-search"
              />
            )}
          </div>

          {state.status === 'loading' && (
            <SkeletonGroup label="Loading playlists" className="tx-shared-picklist">
              <PickRowSkeletons rows={3} />
            </SkeletonGroup>
          )}
          {state.status === 'error' && (
            <ErrorNotice
              error={state.error}
              title="The playlists could not be loaded"
              onRetry={reload}
            />
          )}
          {state.status === 'ready' && playlists.length === 0 && (
            <EmptyState
              variant="inline"
              level={3}
              icon={ListVideo}
              title="No playlists yet"
              action={
                <ButtonLink to="/playlists" data-testid="screen-wizard-go-playlists">
                  Go to playlists
                </ButtonLink>
              }
            >
              Make a playlist first. The screen is saved, so you can assign one later from its page.
            </EmptyState>
          )}
          {state.status === 'ready' && shown.length > 0 && (
            <div
              className="tx-shared-picklist tx-screen-wizard__picklist"
              role="radiogroup"
              aria-labelledby={`${groupName}-title`}
              data-testid="screen-wizard-playlists"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
                  event.preventDefault();
                  assign();
                }
              }}
            >
              {shown.map((playlist) => (
                <PickRow
                  key={playlist.id}
                  type="radio"
                  name={groupName}
                  value={playlist.id}
                  checked={chosen === playlist.id}
                  disabled={busy}
                  media={
                    <PlaylistMosaic
                      size="md"
                      mediaIds={playlist.previewMediaIds}
                      kinds={playlist.kinds}
                    />
                  }
                  title={playlist.name}
                  meta={contentStepPlaylistMeta(
                    playlist,
                    playlistSummaryLabel(playlist),
                    assignedId,
                  )}
                  testId="screen-wizard-playlist-option"
                  onChange={() => {
                    setChosen(playlist.id);
                    setError(null);
                  }}
                />
              ))}
            </div>
          )}
          {searching && shown.length === 0 && (
            <EmptyState
              variant="inline"
              level={3}
              icon={SearchX}
              title="No playlist matches"
              action={
                <Button
                  onClick={() => {
                    setQuery('');
                  }}
                >
                  Clear search
                </Button>
              }
            >
              Try another name.
            </EmptyState>
          )}
        </section>
      </StepPanel>

      <StepFooter
        start={
          <Button
            variant="ghost"
            icon={ArrowLeft}
            onClick={onBack}
            data-testid="screen-wizard-content-back"
          >
            Back
          </Button>
        }
      >
        {action === 'assign' ? (
          <>
            <Button onClick={onFinish} data-testid="screen-wizard-skip-finish">
              {assignedId === null ? 'Skip and finish' : 'Finish'}
            </Button>
            <Button
              variant="primary"
              size="lg"
              busy={busy}
              onClick={assign}
              data-testid="screen-wizard-assign"
            >
              Assign playlist
            </Button>
          </>
        ) : assignedId === null && !(state.status === 'ready' && playlists.length === 0) ? (
          <>
            <Button onClick={onFinish} data-testid="screen-wizard-skip-finish">
              Skip and finish
            </Button>
            <Button
              variant="primary"
              size="lg"
              aria-disabled
              data-testid="screen-wizard-assign"
              aria-describedby={`${groupName}-hint`}
            >
              Assign playlist
            </Button>
            <span id={`${groupName}-hint`} className="tx-visually-hidden">
              Choose a playlist first.
            </span>
          </>
        ) : (
          <Button
            variant="primary"
            size="lg"
            icon={Check}
            onClick={onFinish}
            data-testid="screen-wizard-finish"
          >
            Finish
          </Button>
        )}
      </StepFooter>
    </>
  );
}
