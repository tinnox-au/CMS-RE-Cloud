import { useEffect, useRef, useState } from 'react';
import { LIBRARY_ROOT_LABEL } from '../../lib/folderChoice.ts';
import { FolderPlus } from '../../ui/icons.ts';
import { Button, cx, ErrorNotice, Select } from '../../ui/index.ts';
import { NewFolderForm } from './NewFolderForm.tsx';
import './shared.css';
import type { FoldersResource } from './useFolders.ts';

export interface FolderSelectProps {
  /** The page's folders, from `useFolders()`. */
  readonly folders: FoldersResource;
  /** The chosen folder id, or null for the root of the library. */
  readonly value: string | null;
  /** Nothing is saved: the page sends the choice with its own Save. */
  readonly onChange: (folderId: string | null) => void;
  readonly disabled?: boolean;
  /** Offers "New folder" beside the list. Default true. */
  readonly allowCreate?: boolean;
  /** Default `shared-folder-select`. */
  readonly testId?: string;
  /** From a `Field`: `{(control) => <FolderSelect {...control} … />}`. */
  readonly id?: string;
  readonly 'aria-describedby'?: string | undefined;
  readonly 'aria-invalid'?: true | undefined;
  readonly 'aria-required'?: true | undefined;
  /** Needed only outside a `Field`. */
  readonly 'aria-label'?: string;
  readonly className?: string;
}

const ROOT_VALUE = '';
const MISSING_LABEL = 'Folder not found';

/**
 * Chooses a folder, or the root of the library, from the native select, and can make a new
 * folder on the spot: the new folder becomes the choice. If the folders cannot be loaded it
 * says so with the API error code and a way to try again; the current choice is kept.
 */
export function FolderSelect({
  folders,
  value,
  onChange,
  disabled = false,
  allowCreate = true,
  testId = 'shared-folder-select',
  className,
  ...control
}: FolderSelectProps) {
  const [creating, setCreating] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const returnFocus = useRef(false);

  // After the small form closes, focus goes back to the list it sat under.
  useEffect(() => {
    if (!creating && returnFocus.current) {
      returnFocus.current = false;
      selectRef.current?.focus();
    }
  }, [creating]);

  const closeForm = () => {
    returnFocus.current = true;
    setCreating(false);
  };

  const loading = folders.status === 'loading';
  const known = value === null || folders.byId.has(value);
  return (
    <div className={cx('tx-shared-folderselect', className)} data-testid={testId}>
      <div className="tx-shared-folderselect__row">
        <Select
          {...control}
          ref={selectRef}
          width="md"
          value={value ?? ROOT_VALUE}
          disabled={disabled || loading || folders.status === 'error'}
          data-testid={`${testId}-control`}
          onChange={(event) => {
            onChange(event.target.value === ROOT_VALUE ? null : event.target.value);
          }}
        >
          {loading ? (
            <option value={value ?? ROOT_VALUE}>Loading folders</option>
          ) : (
            <>
              <option value={ROOT_VALUE}>{LIBRARY_ROOT_LABEL} (no folder)</option>
              {folders.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
              {value !== null && !known && <option value={value}>{MISSING_LABEL}</option>}
            </>
          )}
        </Select>
        {allowCreate && !creating && (
          <Button
            variant="ghost"
            icon={FolderPlus}
            disabled={disabled || folders.status !== 'ready'}
            data-testid={`${testId}-new`}
            onClick={() => {
              setCreating(true);
            }}
          >
            New folder
          </Button>
        )}
      </div>
      {folders.status === 'error' && (
        <ErrorNotice
          error={folders.error}
          title="The folders could not be loaded"
          onRetry={folders.reload}
        />
      )}
      {creating && (
        <NewFolderForm
          folders={folders}
          testId={`${testId}-form`}
          onCancel={closeForm}
          onCreated={(folder) => {
            onChange(folder.id);
            closeForm();
          }}
        />
      )}
    </div>
  );
}
