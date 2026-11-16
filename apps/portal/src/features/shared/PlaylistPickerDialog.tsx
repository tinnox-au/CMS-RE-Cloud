import type { PlaylistSummaryDto } from '@tinnox/contracts';
import { useId, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api/index.ts';
import { countLabel, matchesSearch } from '../../lib/listView.ts';
import { playlistSummaryLabel } from '../../lib/mediaName.ts';
import { CircleDashed, ListVideo, SearchX } from '../../ui/icons.ts';
import {
  Button,
  ButtonLink,
  Dialog,
  EmptyState,
  ErrorNotice,
  Icon,
  SearchField,
  SkeletonGroup,
} from '../../ui/index.ts';
import { PickRow, PickRowSkeletons } from './PickRow.tsx';
import { PlaylistMosaic } from './PlaylistMosaic.tsx';
import './shared.css';
import { useLoadWhileOpen } from './useLoadWhileOpen.ts';
import { useSettledFocus } from './useSettledFocus.ts';

export interface PlaylistPickerDialogProps {
  readonly open: boolean;
  /** Cancel, Escape and the close button. The caller also closes it after a successful save. */
  readonly onClose: () => void;
  /**
   * The primary button. `null` means "No playlist" and is only ever passed with `allowNone`.
   * The dialog does not save and does not close itself: do the work, show `busy` meanwhile,
   * then close it, or pass what went wrong as `error`.
   */
  readonly onConfirm: (playlist: PlaylistSummaryDto | null) => void;
  /** Default "Choose a playlist". */
  readonly title?: string;
  readonly description?: ReactNode;
  /** Default "Choose playlist". Say what happens: "Assign playlist", "Add to playlist". */
  readonly confirmLabel?: string;
  /**
   * The playlist that is chosen when the dialog opens, for example the one assigned now.
   * With `allowNone`, null starts on "No playlist".
   */
  readonly currentId?: string | null;
  /** Offers "No playlist" as the first choice. Default false. */
  readonly allowNone?: boolean;
  /** The second line of "No playlist": what choosing it means here. */
  readonly noneHint?: string;
  /** The caller is saving: the dialog cannot be dismissed and the button shows it. */
  readonly busy?: boolean;
  /** What the caller's save threw. Shown in the dialog with the API error code. */
  readonly error?: unknown;
  /** Title of that error: "The playlist was not assigned". */
  readonly errorTitle?: string;
  /** A reason a playlist cannot be chosen here, or null. The row is shown but disabled. */
  readonly disabledReason?: (playlist: PlaylistSummaryDto) => string | null;
  /** Default `shared-playlist-picker`. */
  readonly testId?: string;
}

/** `undefined`: nothing chosen yet. `null`: "No playlist". */
type Choice = string | null | undefined;

function loadPlaylists(signal: AbortSignal): Promise<PlaylistSummaryDto[]> {
  return api.listPlaylists(signal);
}

/**
 * Chooses one playlist: a searchable list with each playlist's thumbnail mosaic, item count
 * and loop length. The list is loaded afresh each time the dialog opens. "No playlist" is
 * offered only when the caller allows it.
 */
export function PlaylistPickerDialog({
  open,
  onClose,
  onConfirm,
  title = 'Choose a playlist',
  description,
  confirmLabel = 'Choose playlist',
  currentId = null,
  allowNone = false,
  noneHint,
  busy = false,
  error = null,
  errorTitle = 'The change was not saved',
  disabledReason,
  testId = 'shared-playlist-picker',
}: PlaylistPickerDialogProps) {
  const groupName = useId();
  const { state, reload } = useLoadWhileOpen(open, loadPlaylists);
  const [choice, setChoice] = useState<Choice>(currentId ?? (allowNone ? null : undefined));
  const [query, setQuery] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChoice(currentId ?? (allowNone ? null : undefined));
      setQuery('');
    }
  }

  const bodyRef = useRef<HTMLDivElement>(null);
  useSettledFocus(bodyRef, state.status);

  const playlists = state.status === 'ready' ? state.data : [];
  const shown = playlists.filter((playlist) =>
    matchesSearch([playlist.name, playlist.description], query),
  );
  const chosen = typeof choice === 'string' ? playlists.find((p) => p.id === choice) : undefined;
  const canConfirm =
    state.status === 'ready' &&
    (chosen !== undefined
      ? (disabledReason?.(chosen) ?? null) === null
      : choice === null && allowNone);

  const confirm = () => {
    if (!canConfirm || busy) return;
    onConfirm(chosen ?? null);
  };

  const searching = query.trim() !== '';
  return (
    <Dialog
      testId={testId}
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="md"
      busy={busy}
      footerStart={
        state.status === 'ready' && playlists.length > 0 ? (
          <span aria-live="polite">
            {searching
              ? `${shown.length} of ${countLabel(playlists.length, 'playlist')}`
              : countLabel(playlists.length, 'playlist')}
          </span>
        ) : undefined
      }
      footer={
        <>
          <Button onClick={onClose} aria-disabled={busy || undefined}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            aria-disabled={!canConfirm || undefined}
            onClick={confirm}
            data-testid={`${testId}-confirm`}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="tx-stack">
        {error !== null && error !== undefined && <ErrorNotice error={error} title={errorTitle} />}
        {(state.status === 'loading' || playlists.length > 0) && (
          <SearchField
            className="tx-shared-picker-search"
            label="Search playlists"
            value={query}
            onChange={setQuery}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
            data-autofocus
            data-testid={`${testId}-search`}
          />
        )}
        {state.status === 'loading' && (
          <SkeletonGroup label="Loading playlists" className="tx-shared-picklist">
            <PickRowSkeletons />
          </SkeletonGroup>
        )}
        {state.status === 'error' && (
          <ErrorNotice
            error={state.error}
            title="The playlists could not be loaded"
            onRetry={reload}
          />
        )}
        {state.status === 'ready' && playlists.length === 0 && !allowNone && (
          <EmptyState
            variant="inline"
            level={3}
            icon={ListVideo}
            title="No playlists yet"
            action={
              <ButtonLink variant="secondary" to="/playlists">
                Go to playlists
              </ButtonLink>
            }
          >
            Create a playlist first, then come back to choose it.
          </EmptyState>
        )}
        {state.status === 'ready' && (playlists.length > 0 || allowNone) && (
          <>
            <div
              className="tx-shared-picklist"
              role="radiogroup"
              aria-label="Playlists"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
                  event.preventDefault();
                  confirm();
                }
              }}
            >
              {allowNone && !searching && (
                <PickRow
                  type="radio"
                  name={groupName}
                  value="none"
                  checked={choice === null}
                  disabled={busy}
                  media={
                    <span className="tx-shared-pickrow__icon tx-shared-pickrow__icon--wide">
                      <Icon icon={CircleDashed} />
                    </span>
                  }
                  title="No playlist"
                  meta={noneHint}
                  testId={`${testId}-none`}
                  onChange={() => {
                    setChoice(null);
                  }}
                />
              )}
              {shown.map((playlist) => {
                const reason = disabledReason?.(playlist) ?? null;
                return (
                  <PickRow
                    key={playlist.id}
                    type="radio"
                    name={groupName}
                    value={playlist.id}
                    checked={choice === playlist.id}
                    disabled={busy || reason !== null}
                    disabledReason={reason ?? undefined}
                    media={
                      <PlaylistMosaic
                        size="md"
                        mediaIds={playlist.previewMediaIds}
                        kinds={playlist.kinds}
                      />
                    }
                    title={playlist.name}
                    meta={playlistSummaryLabel(playlist)}
                    testId={`${testId}-option`}
                    onChange={() => {
                      setChoice(playlist.id);
                    }}
                  />
                );
              })}
            </div>
            {allowNone && playlists.length === 0 && (
              <p className="tx-small tx-muted">There are no playlists yet.</p>
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
          </>
        )}
      </div>
    </Dialog>
  );
}
