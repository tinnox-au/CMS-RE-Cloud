import type { FolderDto } from '@tinnox/contracts';
import { useId, useState } from 'react';
import { folderNameProblem } from '../../lib/folderChoice.ts';
import { CircleExclamationPoint } from '../../ui/icons.ts';
import { Button, ErrorNotice, Icon, TextInput } from '../../ui/index.ts';
import './shared.css';
import type { FoldersResource } from './useFolders.ts';

export interface NewFolderFormProps {
  readonly folders: FoldersResource;
  /** The folder as the API stored it. */
  readonly onCreated: (folder: FolderDto) => void;
  readonly onCancel: () => void;
  readonly testId: string;
}

/**
 * A name field with Create and Cancel, for making a folder without leaving the place where
 * one is being chosen. Not a `<form>`: it is used inside pages' own forms and inside dialogs,
 * so Enter in the field creates the folder and never submits anything around it.
 */
export function NewFolderForm({ folders, onCreated, onCancel, testId }: NewFolderFormProps) {
  const inputId = useId();
  const problemId = `${inputId}-problem`;
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const create = async () => {
    if (busy) return;
    const found = folderNameProblem(name, folders.folders);
    setProblem(found);
    if (found !== null) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await folders.createFolder(name.trim()));
    } catch (thrown) {
      setError(thrown);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tx-shared-newfolder" data-testid={testId}>
      <label className="tx-field__label" htmlFor={inputId}>
        Name of the new folder
      </label>
      <div className="tx-shared-newfolder__row">
        <TextInput
          id={inputId}
          value={name}
          maxLength={200}
          autoComplete="off"
          autoFocus
          aria-invalid={problem !== null ? true : undefined}
          aria-describedby={problem !== null ? problemId : undefined}
          data-testid={`${testId}-name`}
          onChange={(event) => {
            setName(event.target.value);
            if (problem !== null) setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void create();
            } else if (event.key === 'Escape') {
              // Close the small form only; a dialog around it stays open.
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
        />
        <Button
          variant="secondary"
          busy={busy}
          data-testid={`${testId}-create`}
          onClick={() => {
            void create();
          }}
        >
          Create folder
        </Button>
        <Button variant="ghost" aria-disabled={busy || undefined} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {problem !== null && (
        <p id={problemId} className="tx-field__error" role="alert">
          <Icon icon={CircleExclamationPoint} size={16} />
          <span>{problem}</span>
        </p>
      )}
      {error !== null && (
        <ErrorNotice
          error={error}
          title="The folder was not created"
          onDismiss={() => {
            setError(null);
          }}
        />
      )}
    </div>
  );
}
