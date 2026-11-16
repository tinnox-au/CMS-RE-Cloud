import type { FolderDto } from '@tinnox/contracts';
import { useState, type FormEvent } from 'react';
import { api } from '../../../api/index.ts';
import { countOf } from '../../../lib/bulkOutcome.ts';
import { folderNameProblem } from '../../../lib/folderChoice.ts';
import {
  Button,
  ConfirmDialog,
  Dialog,
  ErrorNotice,
  Field,
  TextInput,
  useToast,
} from '../../../ui/index.ts';
import type { FoldersResource } from '../../shared/index.ts';
import './mediaLibrary.css';

/** What the folder name dialog is doing: making a folder, or renaming one. */
export type FolderNameTarget =
  { readonly mode: 'create' } | { readonly mode: 'rename'; readonly folder: FolderDto };

export interface FolderNameDialogProps {
  /** Null keeps the dialog closed. */
  readonly target: FolderNameTarget | null;
  readonly folders: FoldersResource;
  readonly onClose: () => void;
  /** The folder as the API stored it, after it was created or renamed. */
  readonly onDone: (folder: FolderDto, mode: FolderNameTarget['mode']) => void;
}

/**
 * Asks for the name of a new folder, or a new name for a folder. The name is checked as the
 * API will check it (empty, too long, characters, already used) before it is sent; a refusal
 * by the server is shown in the dialog with its error code.
 */
export function FolderNameDialog({ target, folders, onClose, onDone }: FolderNameDialogProps) {
  const toast = useToast();
  const open = target !== null;
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<FolderNameTarget | null>(target);
  if (open && target !== held) {
    setHeld(target);
    setName(target.mode === 'rename' ? target.folder.name : '');
    setProblem(null);
    setError(null);
    setBusy(false);
  }
  const current = target ?? held;
  const renaming = current?.mode === 'rename' ? current.folder : null;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || current === null) return;
    const others = folders.folders.filter((folder) => folder.id !== renaming?.id);
    const found = folderNameProblem(name, others);
    setProblem(found);
    if (found !== null) return;
    const trimmed = name.trim();
    if (renaming !== null && trimmed === renaming.name) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const folder =
        renaming === null
          ? await folders.createFolder(trimmed)
          : await api.renameFolder(renaming.id, trimmed);
      if (renaming !== null) folders.reload();
      setBusy(false);
      onClose();
      onDone(folder, current.mode);
      toast.success(
        renaming === null ? `Folder ${folder.name} created` : `Folder renamed to ${folder.name}`,
      );
    } catch (thrown) {
      setBusy(false);
      setError(thrown);
    }
  };

  const formId = 'tx-media-library-folder-form';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      busy={busy}
      title={renaming === null ? 'New folder' : 'Rename folder'}
      description={
        renaming === null
          ? 'Folders keep the library in order. A file is in one folder at a time.'
          : undefined
      }
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
            data-testid="media-library-folder-save"
          >
            {renaming === null ? 'Create folder' : 'Rename folder'}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate className="tx-stack" onSubmit={(event) => void submit(event)}>
        <Field label="Folder name" error={problem ?? undefined} required>
          {(control) => (
            <TextInput
              {...control}
              value={name}
              maxLength={200}
              autoComplete="off"
              data-autofocus
              data-testid="media-library-folder-name"
              onChange={(event) => {
                setName(event.target.value);
                if (problem !== null) setProblem(null);
              }}
            />
          )}
        </Field>
        {error !== null && (
          <ErrorNotice
            error={error}
            title={renaming === null ? 'The folder was not created' : 'The folder was not renamed'}
          />
        )}
      </form>
    </Dialog>
  );
}

export interface DeleteFolderDialogProps {
  readonly folder: FolderDto | null;
  readonly folders: FoldersResource;
  readonly onClose: () => void;
  readonly onDeleted: (folder: FolderDto) => void;
}

/**
 * Confirms deleting a folder. The files in it are not deleted: the server moves them to the
 * library root. A refusal is shown in the dialog with its error code.
 */
export function DeleteFolderDialog({
  folder,
  folders,
  onClose,
  onDeleted,
}: DeleteFolderDialogProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [held, setHeld] = useState<FolderDto | null>(folder);
  if (folder !== null && folder !== held) {
    setHeld(folder);
    setBusy(false);
    setError(null);
  }
  const shown = folder ?? held;

  const confirm = async () => {
    if (busy || folder === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteFolder(folder.id);
      folders.reload();
      setBusy(false);
      onClose();
      onDeleted(folder);
      toast.success(`Folder ${folder.name} deleted`);
    } catch (thrown) {
      setBusy(false);
      setError(thrown);
      // It may have been deleted elsewhere; show the list as the server has it.
      folders.reload();
    }
  };

  return (
    <ConfirmDialog
      open={folder !== null}
      title="Delete this folder?"
      confirmLabel="Delete folder"
      tone="danger"
      busy={busy}
      onConfirm={() => {
        void confirm();
      }}
      onCancel={onClose}
    >
      <div className="tx-stack" data-testid="media-library-folder-delete">
        <p className="tx-break">
          <strong>{shown?.name}</strong> will be deleted.{' '}
          {shown === null || shown.itemCount === 0
            ? 'It holds no files.'
            : `The ${countOf(shown.itemCount, 'file')} in it ${shown.itemCount === 1 ? 'moves' : 'move'} to the library root; no file is deleted.`}
        </p>
        {error !== null && <ErrorNotice error={error} title="The folder was not deleted" />}
      </div>
    </ConfirmDialog>
  );
}
