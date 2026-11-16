import { ABSOLUTE } from '@tinnox/contracts';
import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/index.ts';
import { checkPlaylistName } from '../../../lib/playlistsList.ts';
import { Button, Dialog, ErrorNotice, Field, TextInput } from '../../../ui/index.ts';

export interface NewPlaylistDialogProps {
  readonly open: boolean;
  /** Cancel, Escape and the close button. After a successful create the editor opens instead. */
  readonly onClose: () => void;
}

/**
 * Asks for the name of a new playlist, creates it and opens its editor. The name is checked
 * against the shared schema first; the API stays the authority, and a refusal is shown in
 * the dialog with its error code.
 */
export function NewPlaylistDialog({ open, onClose }: NewPlaylistDialogProps) {
  const navigate = useNavigate();
  const formId = useId();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Every opening starts with an empty field.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName('');
      setProblem(undefined);
      setError(null);
      setBusy(false);
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const checked = checkPlaylistName(name);
    if (!checked.ok) {
      setProblem(checked.problem);
      return;
    }
    setProblem(undefined);
    setError(null);
    setBusy(true);
    api.createPlaylist(checked.name).then(
      (created) => {
        // The page, and this dialog with it, is left for the editor.
        void navigate(`/playlists/${created.id}`);
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
      title="New playlist"
      description="Name it now. You add media to it in the editor, which opens next."
      busy={busy}
      footer={
        <>
          <Button onClick={onClose} aria-disabled={busy || undefined}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            busy={busy}
            data-testid="playlists-new-submit"
          >
            Create playlist
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="tx-stack"
        noValidate
        onSubmit={submit}
        data-testid="playlists-new-dialog"
      >
        {error !== null && <ErrorNotice error={error} title="The playlist was not created" />}
        <Field label="Name" error={problem} required>
          {(control) => (
            <TextInput
              {...control}
              value={name}
              width="full"
              maxLength={ABSOLUTE.maxNameLength}
              autoComplete="off"
              readOnly={busy}
              data-autofocus
              data-testid="playlists-new-name"
              onChange={(event) => {
                setName(event.target.value);
                if (problem !== undefined) setProblem(undefined);
              }}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
