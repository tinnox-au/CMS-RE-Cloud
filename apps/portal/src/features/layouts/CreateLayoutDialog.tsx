import { ABSOLUTE } from '@tinnox/contracts';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/index.ts';
import { BAND_PERCENT, bandZones } from '../../lib/layouts.ts';
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
import './layouts.css';

export interface CreateLayoutDialogProps {
  readonly open: boolean;
  /** Cancel, Escape and the close button. After a successful create the editor opens instead. */
  readonly onClose: () => void;
}

const loadPlaylists = (signal: AbortSignal) => api.listPlaylists(signal);

type ZoneField = 'main' | 'band';

/**
 * Asks for the name of a new layout and the playlists of its main zone and its band, creates
 * it with the preset band height and opens its editor, where the height is set. Every zone
 * needs a playlist, so with no playlist yet the dialog sends the operator to create one first.
 * The same playlist may be chosen for both zones.
 */
export function CreateLayoutDialog({ open, onClose }: CreateLayoutDialogProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const formId = useId();
  const { state, reload } = useLoadWhileOpen(open, loadPlaylists);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<Record<ZoneField, string>>({ main: '', band: '' });
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [zoneErrors, setZoneErrors] = useState<Partial<Record<ZoneField, string>>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Every opening starts afresh.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName('');
      setChosen({ main: '', band: '' });
      setNameError(undefined);
      setZoneErrors({});
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
    const invalidZones: Partial<Record<ZoneField, string>> = {};
    if (chosen.main === '') invalidZones.main = 'Choose a playlist for the main zone.';
    if (chosen.band === '') invalidZones.band = 'Choose a playlist for the band.';
    setNameError(invalidName ?? undefined);
    setZoneErrors(invalidZones);
    const firstInvalid =
      invalidName !== null
        ? 'layouts-create-name'
        : invalidZones.main !== undefined
          ? 'layouts-create-main'
          : invalidZones.band !== undefined
            ? 'layouts-create-band'
            : null;
    if (firstInvalid !== null) {
      // The first field that needs a change takes the focus; its message is tied to it.
      bodyRef.current?.querySelector<HTMLElement>(`[data-testid="${firstInvalid}"]`)?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    api
      .createLayout({
        name: name.trim(),
        zones: bandZones(BAND_PERCENT.initial, chosen.main, chosen.band),
      })
      .then(
        (created) => {
          // The page, and this dialog with it, is left for the editor.
          void navigate(`/layouts/${created.id}`);
          toast.success('Layout created');
        },
        (reason: unknown) => {
          setError(reason);
          setBusy(false);
        },
      );
  };

  const zoneSelect = (field: ZoneField, label: string, hint?: string) => (
    <Field label={label} hint={hint} error={zoneErrors[field]} required>
      {(control) => (
        <Select
          {...control}
          value={chosen[field]}
          disabled={busy}
          data-testid={`layouts-create-${field}`}
          onChange={(event) => {
            setChosen({ ...chosen, [field]: event.target.value });
            if (zoneErrors[field] !== undefined)
              setZoneErrors({ ...zoneErrors, [field]: undefined });
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
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title="Create layout"
      description="Name the layout and choose a playlist for the main zone and for the band along the bottom. You set the band height in the editor, which opens next."
      busy={busy}
      testId="layout-create-dialog"
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
              data-testid="layouts-create-submit"
            >
              Create layout
            </Button>
          )}
        </>
      }
    >
      <div ref={bodyRef} className="tx-stack">
        {state.status === 'loading' && (
          <SkeletonGroup label="Loading playlists" className="tx-stack">
            <Skeleton variant="block" height="68px" />
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
            Each zone of a layout plays a playlist.
          </EmptyState>
        )}
        {canCreate && (
          <form id={formId} className="tx-stack" noValidate onSubmit={submit}>
            {error !== null && <ErrorNotice error={error} title="The layout was not created" />}
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
                  data-testid="layouts-create-name"
                  onChange={(event) => {
                    setName(event.target.value);
                    if (nameError !== undefined) setNameError(undefined);
                  }}
                />
              )}
            </Field>
            {zoneSelect('main', 'Main zone playlist')}
            {zoneSelect(
              'band',
              'Band playlist',
              'Put a Ticker or Text app in this playlist; its text is sized to the band.',
            )}
          </form>
        )}
      </div>
    </Dialog>
  );
}
