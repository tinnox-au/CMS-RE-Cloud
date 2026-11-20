import { useId, useState } from 'react';
import { isRoleRefusal } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import {
  bulkFailureTitle,
  countOf,
  mergeBulkOutcomes,
  runInSequence,
  type BulkOutcome,
} from '../../lib/bulkOutcome.ts';
import {
  folderLabel,
  itemsToMove,
  LIBRARY_ROOT_LABEL,
  searchFolders,
} from '../../lib/folderChoice.ts';
import { Folder, FolderOpen, FolderPlus } from '../../ui/icons.ts';
import {
  Button,
  Dialog,
  ErrorNotice,
  Icon,
  SearchField,
  SkeletonGroup,
  Spinner,
  useToast,
} from '../../ui/index.ts';
import { BulkFailures } from './BulkFailures.tsx';
import { NewFolderForm } from './NewFolderForm.tsx';
import { PickRow, PickRowSkeletons } from './PickRow.tsx';
import './shared.css';
import type { FoldersResource } from './useFolders.ts';

/** One media item to move (a `MediaDto` fits). */
export interface MoveToFolderItem {
  readonly id: string;
  readonly name: string;
  readonly folderId: string | null;
}

export interface MoveToFolderDialogProps {
  readonly open: boolean;
  /** Cancel, Escape, the close button, and after a move that fully succeeded. */
  readonly onClose: () => void;
  /** The media items to move, read when the dialog opens. */
  readonly items: readonly MoveToFolderItem[];
  /** The page's folders, from `useFolders()`. */
  readonly folders: FoldersResource;
  /**
   * Called once per attempt in which at least one item moved, with the ids of the moved
   * items and where they went (null is the root), before the dialog closes. Reload the list here.
   */
  readonly onMoved?: (movedIds: readonly string[], folderId: string | null) => void;
  /** False when the role may not create folders: no "New folder". Default true. */
  readonly allowCreate?: boolean;
  /** Default `shared-move-dialog`. */
  readonly testId?: string;
}

type Phase =
  | { readonly kind: 'choosing' }
  | { readonly kind: 'moving'; readonly finished: number; readonly total: number }
  | {
      readonly kind: 'failed';
      readonly outcome: BulkOutcome<MoveToFolderItem, unknown>;
      readonly total: number;
    };

interface Session {
  readonly items: readonly MoveToFolderItem[];
  /** `undefined` until a place is chosen; null is the root. */
  readonly target: string | null | undefined;
  readonly phase: Phase;
  readonly query: string;
  readonly creating: boolean;
}

/** More folders than this and the dialog offers a search field. */
const SEARCH_FROM = 8;
const ROOT_VALUE = 'root';

function startSession(items: readonly MoveToFolderItem[]): Session {
  // Everything in one place: start on it, so the dialog shows where the items are now.
  const first = items[0];
  const samePlace = first !== undefined && items.every((item) => item.folderId === first.folderId);
  return {
    items,
    target: samePlace ? first.folderId : undefined,
    phase: { kind: 'choosing' },
    query: '',
    creating: false,
  };
}

/**
 * Moves one or many media items to a folder or to the root of the library: one request per
 * item that is not there already, one after another. A new folder can be made in the dialog.
 *
 * When every item moved the dialog closes and reports with a toast. When some did not, it
 * stays open and lists each of them with the server's message and error code, and offers to
 * try those again. Needs the `ToastProvider` of the application shell above it.
 */
export function MoveToFolderDialog({
  open,
  onClose,
  items,
  folders,
  onMoved,
  allowCreate = true,
  testId = 'shared-move-dialog',
}: MoveToFolderDialogProps) {
  const toast = useToast();
  const groupName = useId();
  const [session, setSession] = useState<Session>(() => startSession(items));
  // Each opening starts from the items as they are then.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession(startSession(items));
  }

  const { target, phase, query, creating } = session;
  const moved = session.items;
  const single = moved.length === 1 ? moved[0] : undefined;
  const moving = phase.kind === 'moving';
  const toMove = target === undefined ? [] : itemsToMove(moved, target);
  const nothingToDo = target !== undefined && toMove.length === 0;
  const shown = searchFolders(folders.folders, query);
  const patch = (change: Partial<Session>) => {
    setSession((current) => ({ ...current, ...change }));
  };

  const run = async (
    jobs: readonly MoveToFolderItem[],
    folderId: string | null,
    earlier: BulkOutcome<MoveToFolderItem, unknown> | null,
  ) => {
    const already = earlier === null ? 0 : earlier.done.length;
    const total = already + jobs.length;
    patch({ phase: { kind: 'moving', finished: already, total } });
    const attempt = await runInSequence(
      jobs,
      (item) => api.patchMedia(item.id, { folderId }),
      (finished) => {
        patch({ phase: { kind: 'moving', finished: already + finished, total } });
      },
    );
    const outcome = earlier === null ? attempt : mergeBulkOutcomes(earlier, attempt);
    // Item counts changed, and a refusal may mean the folder is gone.
    folders.reload();
    if (attempt.done.length > 0) {
      onMoved?.(
        attempt.done.map((done) => done.item.id),
        folderId,
      );
    }
    if (outcome.failed.length === 0) {
      const place = folderId === null ? 'the library root' : folderLabel(folderId, folders.byId);
      onClose();
      toast.success(
        total === 1 && single !== undefined
          ? `${single.name} moved to ${place}`
          : `${countOf(total, 'file')} moved to ${place}`,
      );
      return;
    }
    patch({ phase: { kind: 'failed', outcome, total } });
  };

  const confirm = () => {
    if (target === undefined || moving) return;
    if (toMove.length === 0) {
      onClose();
      return;
    }
    void run(toMove, target, null);
  };

  // A refusal by role is the same for every item and every retry: only Close is left.
  const roleRefused =
    phase.kind === 'failed' && phase.outcome.failed.some((failure) => isRoleRefusal(failure.error));

  const retry = () => {
    if (phase.kind !== 'failed' || roleRefused || target === undefined) return;
    void run(
      phase.outcome.failed.map((failure) => failure.item),
      target,
      phase.outcome,
    );
  };

  let note: string | undefined;
  if (phase.kind === 'choosing' && nothingToDo) {
    note = single !== undefined ? 'Already in this place.' : 'All of them are already here.';
  } else if (phase.kind === 'choosing' && target !== undefined && toMove.length < moved.length) {
    note = `${countOf(toMove.length, 'file')} will move; the rest are already here.`;
  }

  return (
    <Dialog
      testId={testId}
      open={open}
      onClose={onClose}
      title={single !== undefined ? 'Move to folder' : `Move ${countOf(moved.length, 'file')}`}
      description={
        single !== undefined ? single.name : 'Choose a folder, or the library root for no folder.'
      }
      busy={moving}
      footerStart={
        moving ? (
          <Spinner
            label={`Moving ${Math.min(phase.finished + 1, phase.total)} of ${phase.total}`}
          />
        ) : (
          note
        )
      }
      footer={
        phase.kind === 'failed' ? (
          <>
            <Button onClick={onClose}>Close</Button>
            {!roleRefused && (
              <Button variant="primary" onClick={retry} data-testid={`${testId}-retry`}>
                Try again
              </Button>
            )}
          </>
        ) : (
          <>
            <Button onClick={onClose} aria-disabled={moving || undefined}>
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={moving}
              aria-disabled={target === undefined || nothingToDo || undefined}
              onClick={confirm}
              data-testid={`${testId}-confirm`}
            >
              Move here
            </Button>
          </>
        )
      }
    >
      <div className="tx-stack">
        {phase.kind === 'failed' && (
          <BulkFailures
            title={bulkFailureTitle(phase.outcome.failed.length, phase.total, 'file', 'moved')}
            failures={phase.outcome.failed.map((failure) => ({
              item: { name: failure.item.name },
              error: failure.error,
            }))}
            {...(phase.outcome.done.length > 0
              ? {
                  note: `${countOf(phase.outcome.done.length, 'file')} ${
                    phase.outcome.done.length === 1 ? 'was' : 'were'
                  } moved.`,
                }
              : {})}
          />
        )}
        {phase.kind !== 'failed' && folders.status === 'loading' && (
          <SkeletonGroup label="Loading folders" className="tx-shared-picklist">
            <PickRowSkeletons rows={3} />
          </SkeletonGroup>
        )}
        {phase.kind !== 'failed' && folders.status === 'error' && (
          <ErrorNotice
            error={folders.error}
            title="The folders could not be loaded"
            onRetry={folders.reload}
          />
        )}
        {phase.kind !== 'failed' && folders.status === 'ready' && (
          <>
            {folders.folders.length > SEARCH_FROM && (
              <SearchField
                className="tx-shared-picker-search"
                label="Search folders"
                value={query}
                onChange={(next) => {
                  patch({ query: next });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault();
                }}
                data-testid={`${testId}-search`}
              />
            )}
            <div
              className="tx-shared-picklist"
              role="radiogroup"
              aria-label="Where to move to"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
                  event.preventDefault();
                  confirm();
                }
              }}
            >
              {query.trim() === '' && (
                <PickRow
                  type="radio"
                  name={groupName}
                  value={ROOT_VALUE}
                  checked={target === null}
                  disabled={moving}
                  media={<Icon icon={FolderOpen} />}
                  title={LIBRARY_ROOT_LABEL}
                  meta="No folder"
                  testId={`${testId}-root`}
                  onChange={() => {
                    patch({ target: null });
                  }}
                />
              )}
              {shown.map((folder) => (
                <PickRow
                  key={folder.id}
                  type="radio"
                  name={groupName}
                  value={folder.id}
                  checked={target === folder.id}
                  disabled={moving}
                  media={<Icon icon={Folder} />}
                  title={folder.name}
                  meta={countOf(folder.itemCount, 'file')}
                  testId={`${testId}-folder`}
                  onChange={() => {
                    patch({ target: folder.id });
                  }}
                />
              ))}
            </div>
            {query.trim() !== '' && shown.length === 0 && (
              <p className="tx-small tx-muted">No folder matches the search.</p>
            )}
            {!allowCreate ? null : creating ? (
              <NewFolderForm
                folders={folders}
                testId={`${testId}-new-form`}
                onCancel={() => {
                  patch({ creating: false });
                }}
                onCreated={(folder) => {
                  patch({ creating: false, target: folder.id, query: '' });
                }}
              />
            ) : (
              <div>
                <Button
                  variant="ghost"
                  icon={FolderPlus}
                  aria-disabled={moving || undefined}
                  data-testid={`${testId}-new`}
                  onClick={() => {
                    patch({ creating: true });
                  }}
                >
                  New folder
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
