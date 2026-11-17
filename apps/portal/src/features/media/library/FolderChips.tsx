import type { FolderDto } from '@tinnox/contracts';
import { isApiRequestError } from '../../../api/client.ts';
import { LIBRARY_ROOT_FILTER } from '../../../lib/mediaLibraryQuery.ts';
import type { FolderCounts } from '../../../lib/mediaLibraryList.ts';
import {
  ChevronDown,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash,
} from '../../../ui/icons.ts';
import {
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Skeleton,
  SkeletonGroup,
  VisuallyHidden,
} from '../../../ui/index.ts';
import type { FoldersResource } from '../../shared/index.ts';
import './mediaLibrary.css';

/** Folder chips shown before the rest move into the "More folders" menu. */
const MAX_INLINE_FOLDERS = 8;

export interface FolderChipsProps {
  readonly folders: FoldersResource;
  /** As in `LibraryQuery.folder`: null is every folder, `LIBRARY_ROOT_FILTER` no folder. */
  readonly value: string | null;
  readonly onChange: (folder: string | null) => void;
  /** Files of this page's kind per folder, for the numbers on the chips. */
  readonly counts: FolderCounts | null;
  readonly onCreate: () => void;
  readonly onRename: (folder: FolderDto) => void;
  readonly onDelete: (folder: FolderDto) => void;
}

/**
 * A folder chip's label: the name, which alone is cut short with an ellipsis when the row is
 * narrow, and the number of files, which always stays in view. The label of the kit's Chip is
 * itself a clipping box; mediaLibrary.css turns it into a row of these two parts and makes it
 * the positioning box of the visually hidden word, so that word cannot escape the clip and
 * widen the page.
 */
function ChipLabel({ name, count }: { readonly name: string; readonly count: number | undefined }) {
  return (
    <>
      <span className="tx-media-library__chip-name">{name}</span>
      {count !== undefined && (
        <span className="tx-media-library__chip-count">
          <VisuallyHidden> </VisuallyHidden>
          {count}
          <VisuallyHidden> {count === 1 ? 'file' : 'files'}</VisuallyHidden>
        </span>
      )}
    </>
  );
}

/**
 * The folder filter: All, "Not in a folder" and one chip per folder, the chosen one with a
 * small menu to rename or delete it, and "New folder". Folders past the first eight are in a
 * "More folders" menu; the chosen folder always shows as a chip.
 */
export function FolderChips({
  folders,
  value,
  onChange,
  counts,
  onCreate,
  onRename,
  onDelete,
}: FolderChipsProps) {
  const newFolder = (
    <Button
      variant="ghost"
      size="sm"
      icon={FolderPlus}
      onClick={onCreate}
      data-testid="media-library-folder-new"
    >
      New folder
    </Button>
  );

  if (folders.status === 'loading') {
    return (
      <SkeletonGroup label="Loading folders" className="tx-media-library__folders">
        <Skeleton variant="pill" width="64px" height="28px" />
        <Skeleton variant="pill" width="112px" height="28px" />
        <Skeleton variant="pill" width="96px" height="28px" />
      </SkeletonGroup>
    );
  }

  if (folders.status === 'error') {
    return (
      <div className="tx-media-library__folders" role="alert" data-testid="media-library-folders">
        <span className="tx-small tx-muted">
          The folders could not be loaded.{' '}
          {isApiRequestError(folders.error) && (
            <span className="tx-code">{folders.error.code}</span>
          )}
        </span>
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={folders.reload}>
          Try again
        </Button>
      </div>
    );
  }

  const list = folders.folders;
  const chosen =
    value !== null && value !== LIBRARY_ROOT_FILTER ? folders.byId.get(value) : undefined;
  const inline = list.filter((folder, index) => index < MAX_INLINE_FOLDERS || folder.id === value);
  const overflow = list.filter(
    (folder, index) => index >= MAX_INLINE_FOLDERS && folder.id !== value,
  );
  const pick = (next: string | null) => {
    onChange(next === value ? null : next);
  };

  return (
    <div
      className="tx-media-library__folders"
      role="group"
      aria-label="Folder"
      data-testid="media-library-folders"
    >
      <span className="tx-media-library__chip" data-testid="media-library-folder-all">
        <Chip
          icon={FolderOpen}
          selected={value === null}
          onToggle={() => {
            onChange(null);
          }}
        >
          <ChipLabel name="All" count={counts?.all} />
        </Chip>
      </span>
      {list.length > 0 && (
        <span className="tx-media-library__chip" data-testid="media-library-folder-root">
          <Chip
            selected={value === LIBRARY_ROOT_FILTER}
            onToggle={() => {
              pick(LIBRARY_ROOT_FILTER);
            }}
          >
            <ChipLabel name="Not in a folder" count={counts?.root} />
          </Chip>
        </span>
      )}
      {inline.map((folder) => (
        <span
          key={folder.id}
          className="tx-media-library__chip"
          data-testid="media-library-folder"
          data-folder-id={folder.id}
        >
          <Chip
            icon={Folder}
            title={folder.name}
            selected={value === folder.id}
            onToggle={() => {
              pick(folder.id);
            }}
          >
            <ChipLabel name={folder.name} count={counts?.byFolder.get(folder.id) ?? 0} />
          </Chip>
        </span>
      ))}
      {overflow.length > 0 && (
        <Menu
          label="More folders"
          trigger={(props) => (
            <Button
              {...props}
              size="sm"
              variant="ghost"
              trailingIcon={ChevronDown}
              data-testid="media-library-folder-more"
            >
              More folders ({overflow.length})
            </Button>
          )}
        >
          {overflow.map((folder) => (
            <MenuItem
              key={folder.id}
              icon={Folder}
              hint={String(counts?.byFolder.get(folder.id) ?? 0)}
              onSelect={() => {
                onChange(folder.id);
              }}
            >
              {folder.name}
            </MenuItem>
          ))}
        </Menu>
      )}
      {/*
        "New folder" follows the chips in the same wrapping row. The chosen folder's menu comes
        last, in a slot of fixed width that is empty while no folder is chosen, so choosing one
        moves nothing.
      */}
      {newFolder}
      <span className="tx-media-library__folder-actions">
        {chosen !== undefined && (
          <Menu
            placement="bottom-end"
            trigger={(props) => (
              <IconButton
                {...props}
                size="sm"
                icon={Ellipsis}
                label={`Actions for folder ${chosen.name}`}
                data-testid="media-library-folder-actions"
              />
            )}
          >
            <MenuItem
              icon={Pencil}
              onSelect={() => {
                onRename(chosen);
              }}
            >
              Rename folder
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={Trash}
              tone="danger"
              onSelect={() => {
                onDelete(chosen);
              }}
            >
              Delete folder
            </MenuItem>
          </Menu>
        )}
      </span>
    </div>
  );
}
