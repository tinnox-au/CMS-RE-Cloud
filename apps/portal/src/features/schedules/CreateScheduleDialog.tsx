import { ABSOLUTE } from '@tinnox/contracts';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/index.ts';
import { nameProblem } from '../../lib/playlistEditor.ts';
import { playlistsByName } from '../../lib/schedules.ts';
import { ListVideo } from '../../ui/icons.ts';
import {
  Button,
  ButtonLink,
  Dialog,
  EmptyState,
  ErrorNotice,
  Field,
  Select,
  Skeleton,
  SkeletonGroup,
  TextInput,
  useToast,
} from '../../ui/index.ts';
import { useLoadWhileOpen } from '../shared/useLoadWhileOpen.ts';
import './schedules.css';

export interface CreateScheduleDialogProps {
  readonly open: boolean;
  /** Cancel, Escape and the close button. After a successful create the editor opens instead. */
  readonly onClose: () => void;
}

const loadPlaylists = (signal: AbortSignal) => api.listPlaylists(signal);

/**
 * Asks for the name and the default playlist of a new schedule, creates it without events
 * and opens its editor, where the events are added. A schedule needs a default playlist, so
 * with no playlist yet the dialog sends the operator to create one first.
 */
export function CreateScheduleDialog({ open, onClose }: CreateScheduleDialogProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const formId = useId();
  const { state, reload } = useLoadWhileOpen(open, loadPlaylists);
  const [name, setName] = useState('');
  const [playlistId, setPlaylistId] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [playlistError, setPlaylistError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Every opening starts afresh.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName('');
      setPlaylistId('');
      setNameError(undefined);
      setPlaylistError(undefined);
      setError(null);
      setBusy(false);
    }
  }

  const playlists = state.status === 'ready' ? playlistsByName(state.data) : [];
  const canCreate = state.status === 'ready' && playlists.length > 0;

  // The form arrives after the dialog opened (the playlists are read first), so the dialog's
  // own focus on open cannot reach the Name field.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (canCreate) bodyRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [canCreate]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !canCreate) return;
    const invalidName = nameProblem(name);
    const invalidPlaylist = playlistId === '' ? 'Choose a default playlist.' : null;
    setNameError(invalidName ?? undefined);
    setPlaylistError(invalidPlaylist ?? undefined);
    if (invalidName !== null || invalidPlaylist !== null) {
      // The first field that needs a change takes the focus; its message is tied to it.
      bodyRef.current
        ?.querySelector<HTMLElement>(
          `[data-testid="${invalidName !== null ? 'schedules-create-name' : 'schedules-create-playlist'}"]`,
        )
        ?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    api.createSchedule({ name: name.trim(), defaultPlaylistId: playlistId, events: [] }).then(
      (created) => {
        // The page, and this dialog with it, is left for the editor.
        void navigate(`/schedules/${created.id}`);
        toast.success('Schedule created');
      },
      (reason: unknown) => {
        setError(reason);
        setBusy(false);
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title="Create schedule"
      description="Name the schedule and choose its default playlist. You add the events in the editor, which opens next."
      busy={busy}
      testId="schedule-create-dialog"
      footer={
        <>
          <Button onClick={onClose} aria-disabled={busy || undefined}>
            Cancel
          </Button>
          {canCreate && (
            <Button
              variant="primary"
              type="submit"
              form={formId}
              busy={busy}
              data-testid="schedules-create-submit"
            >
              Create schedule
            </Button>
          )}
        </>
      }
    >
      <div ref={bodyRef} className="tx-stack">
        {state.status === 'loading' && (
          <SkeletonGroup label="Loading playlists" className="tx-stack">
            <Skeleton variant="block" height="68px" />
            <Skeleton variant="block" height="88px" />
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
            title="Create a playlist first"
            action={
              <ButtonLink variant="secondary" to="/playlists">
                Go to playlists
              </ButtonLink>
            }
          >
            A schedule needs a default playlist, which plays whenever no event applies.
          </EmptyState>
        )}
        {canCreate && (
          <form id={formId} className="tx-stack" noValidate onSubmit={submit}>
            {error !== null && <ErrorNotice error={error} title="The schedule was not created" />}
            <Field label="Name" error={nameError} required>
              {(control) => (
                <TextInput
                  {...control}
                  value={name}
                  width="full"
                  maxLength={ABSOLUTE.maxNameLength}
                  autoComplete="off"
                  readOnly={busy}
                  data-autofocus
                  data-testid="schedules-create-name"
                  onChange={(event) => {
                    setName(event.target.value);
                    if (nameError !== undefined) setNameError(undefined);
                  }}
                />
              )}
            </Field>
            <Field
              label="Default playlist"
              hint="Plays whenever no event applies."
              error={playlistError}
              required
            >
              {(control) => (
                <Select
                  {...control}
                  value={playlistId}
                  disabled={busy}
                  data-testid="schedules-create-playlist"
                  onChange={(event) => {
                    setPlaylistId(event.target.value);
                    if (playlistError !== undefined) setPlaylistError(undefined);
                  }}
                >
                  <option value="">Choose a playlist</option>
                  {playlists.map((playlist) => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </form>
        )}
      </div>
    </Dialog>
  );
}
