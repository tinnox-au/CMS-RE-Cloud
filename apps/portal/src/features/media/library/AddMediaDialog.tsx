import { MEDIA_MIME_TYPES, type MediaDto } from '@tinnox/contracts';
import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { formatBytes } from '../../../lib/format.ts';
import {
  summariseUploads,
  uploadFooterText,
  uploadPercent,
  uploadProgressText,
  uploadVerdict,
} from '../../../lib/mediaLibraryUploads.ts';
import { isFinished, type UploadEntry } from '../../../lib/uploadQueue.ts';
import { CloudUpload, RotateCcw, Upload, X } from '../../../ui/icons.ts';
import {
  Button,
  cx,
  Dialog,
  ErrorNotice,
  Icon,
  Spinner,
  StatusPill,
  TabPanel,
  Tabs,
  VisuallyHidden,
  type TabItem,
} from '../../../ui/index.ts';
import { MediaFailureNote } from './MediaParts.tsx';
import './mediaLibrary.css';
import type { UploadQueue } from './useUploadQueue.ts';

type AddTab = 'upload' | 'stock' | 'web' | 'document' | 'audio';

const TABS: readonly TabItem<AddTab>[] = [
  { id: 'upload', label: 'Upload' },
  {
    id: 'stock',
    label: 'Stock',
    disabled: true,
    disabledReason: 'Planned. Stock libraries wait for a decision by TINNOX',
    note: 'Planned',
  },
  {
    id: 'web',
    label: 'Web page',
    disabled: true,
    disabledReason: 'Planned for stage C, after a security review',
    note: 'Planned',
  },
  {
    id: 'document',
    label: 'Document',
    disabled: true,
    disabledReason: 'Planned for stage C: PDF documents',
    note: 'Planned',
  },
  {
    id: 'audio',
    label: 'Audio',
    disabled: true,
    disabledReason: 'Planned for stage C',
    note: 'Planned',
  },
];

export interface AddMediaDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly queue: UploadQueue;
  /** The library list as last read, by id: where an uploaded file's check is followed. */
  readonly listed: ReadonlyMap<string, MediaDto>;
  readonly maxUploadBytes: number;
  /** True while files from the computer are dragged over the window. */
  readonly dragging: boolean;
}

/**
 * Add media: tabs for the ways content will arrive (only Upload exists in stage A; the others
 * are shown and marked Planned), a drop zone and a file button, and the M0 upload queue: one
 * file at a time, each row with its progress, a Cancel, and then the server's verdict. The
 * browser never judges a file's type; the server inspects the content.
 */
export function AddMediaDialog({
  open,
  onClose,
  queue,
  listed,
  maxUploadBytes,
  dragging,
}: AddMediaDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<AddTab>('upload');
  const summary = summariseUploads(queue.entries);
  const footer = uploadFooterText(summary);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    queue.addFiles(Array.from(event.target.files ?? []));
    // Allow choosing the same file again later.
    event.target.value = '';
  };

  // Once files are queued the drop zone shrinks to one row and the rules move under the
  // queue, so each file's progress and the server's verdict are what shows first.
  const compact = queue.entries.length > 0;
  const help = (
    <p className="tx-small tx-muted">
      JPEG and PNG images and MP4 video (H.264), up to {formatBytes(maxUploadBytes)} per file. Every
      file is inspected by the server before it can be used; video plays muted. Uploads carry on
      while you stay in the media library.
    </p>
  );

  return (
    <Dialog
      testId="media-library-add-dialog"
      open={open}
      onClose={onClose}
      size="md"
      title="Add media"
      className="tx-media-library__add"
      footerStart={
        footer === null ? undefined : (
          <span
            className="tx-media-library__progress-note"
            role="status"
            data-testid="media-library-upload-summary"
          >
            {footer}
          </span>
        )
      }
      footer={
        <>
          {queue.entries.some(isFinished) && (
            <Button
              variant="ghost"
              onClick={queue.clearFinished}
              data-testid="media-library-upload-clear"
            >
              Clear finished
            </Button>
          )}
          <Button variant="primary" onClick={onClose} data-testid="media-library-upload-done">
            Done
          </Button>
        </>
      }
    >
      <div className="tx-stack">
        <Tabs
          id="tx-add-media"
          label="Ways to add media"
          tabs={TABS}
          value={tab}
          onChange={setTab}
        />
        <TabPanel tabs="tx-add-media" tab={tab}>
          <div className="tx-stack">
            <div
              className={cx(
                'tx-media-library__dropzone',
                compact && 'tx-media-library__dropzone--compact',
                dragging && 'is-dragging',
              )}
              data-testid="media-library-dropzone"
            >
              {!compact && (
                <span className="tx-media-library__dropzone-icon" aria-hidden="true">
                  <Icon icon={CloudUpload} size={28} />
                </span>
              )}
              <p className="tx-media-library__dropzone-title">
                {dragging
                  ? 'Drop the files to upload them'
                  : compact
                    ? 'Drag more files here, or'
                    : 'Drag files here to upload them'}
              </p>
              {!compact && <p className="tx-small tx-muted">or</p>}
              <Button
                variant="secondary"
                size={compact ? 'sm' : 'md'}
                icon={Upload}
                data-autofocus
                data-testid="media-library-choose-files"
                onClick={() => {
                  inputRef.current?.click();
                }}
              >
                Choose files
              </Button>
              <input
                ref={inputRef}
                className="tx-visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
                type="file"
                multiple
                accept={MEDIA_MIME_TYPES.join(',')}
                data-testid="media-library-file-input"
                onChange={choose}
              />
            </div>
            {!compact && help}
            {compact && (
              <ul
                className="tx-media-library__uploads"
                aria-label="Uploads"
                data-testid="media-library-uploads"
              >
                {queue.entries.map((entry) => (
                  <UploadRow
                    key={entry.id}
                    entry={entry}
                    uploaded={queue.uploaded.get(entry.id)}
                    listed={listed}
                    onCancel={queue.cancel}
                    onRetry={queue.retry}
                    onOpen={onClose}
                  />
                ))}
              </ul>
            )}
            {compact && help}
          </div>
        </TabPanel>
      </div>
    </Dialog>
  );
}

interface UploadRowProps {
  readonly entry: UploadEntry;
  readonly uploaded: MediaDto | undefined;
  readonly listed: ReadonlyMap<string, MediaDto>;
  readonly onCancel: (id: string) => void;
  readonly onRetry: (id: string) => void;
  /** Following the link to an uploaded file closes the dialog first. */
  readonly onOpen: () => void;
}

/** One file of the queue: name, size, where it is, and what can be done with it. */
function UploadRow({ entry, uploaded, listed, onCancel, onRetry, onOpen }: UploadRowProps) {
  const percent = uploadPercent(entry);
  const verdict =
    entry.status === 'done' && uploaded !== undefined
      ? uploadVerdict(uploaded, listed.get(uploaded.id))
      : null;

  return (
    <li
      className="tx-media-library__upload"
      data-testid="media-library-upload-row"
      data-status={entry.status}
      data-verdict={verdict?.kind}
    >
      <div className="tx-media-library__upload-head">
        <div className="tx-media-library__upload-name">
          <span className="tx-strong tx-truncate" title={entry.name}>
            {entry.name}
          </span>
          <span className="tx-small tx-muted tx-num">{formatBytes(entry.size)}</span>
        </div>
        <div className="tx-media-library__upload-state">
          {entry.status === 'queued' && <StatusPill tone="neutral">Waiting</StatusPill>}
          {entry.status === 'uploading' && (
            <span className="tx-small tx-num" aria-hidden="true">
              {uploadProgressText(entry)}
            </span>
          )}
          {entry.status === 'cancelled' && <StatusPill tone="neutral">Cancelled</StatusPill>}
          {entry.status === 'rejected' && <StatusPill tone="danger">Not sent</StatusPill>}
          {entry.status === 'failed' && <StatusPill tone="danger">Upload failed</StatusPill>}
          {verdict?.kind === 'checking' && (
            <Spinner label="Uploaded, being checked" className="tx-media-library__checking" />
          )}
          {verdict?.kind === 'ready' && <StatusPill tone="ok">Ready</StatusPill>}
          {verdict?.kind === 'failed' && <StatusPill tone="danger">Failed</StatusPill>}
          {entry.status === 'done' && verdict === null && (
            <StatusPill tone="neutral">Uploaded</StatusPill>
          )}
          {(entry.status === 'queued' || entry.status === 'uploading') && (
            <Button
              size="sm"
              variant="ghost"
              icon={X}
              data-testid="media-library-upload-cancel"
              onClick={() => {
                onCancel(entry.id);
              }}
            >
              Cancel<VisuallyHidden> upload of {entry.name}</VisuallyHidden>
            </Button>
          )}
          {(entry.status === 'failed' || entry.status === 'cancelled') && (
            <Button
              size="sm"
              variant="ghost"
              icon={RotateCcw}
              data-testid="media-library-upload-retry"
              onClick={() => {
                onRetry(entry.id);
              }}
            >
              Try again<VisuallyHidden> for {entry.name}</VisuallyHidden>
            </Button>
          )}
          {verdict !== null && verdict.kind !== 'checking' && (
            <Link
              className="tx-media-library__upload-open"
              to={`/media/${verdict.media.id}`}
              onClick={onOpen}
            >
              Open<VisuallyHidden> {entry.name}</VisuallyHidden>
            </Link>
          )}
        </div>
      </div>
      {entry.status === 'uploading' && (
        <progress
          className="tx-media-library__bar"
          max={100}
          value={percent}
          aria-label={`Upload progress for ${entry.name}`}
          aria-valuetext={uploadProgressText(entry)}
        />
      )}
      {entry.status === 'rejected' && (
        <p className="tx-media-library__upload-note tx-media-library__failure">
          Not sent. {entry.localMessage}
        </p>
      )}
      {entry.status === 'failed' && <ErrorNotice error={entry.error} title="Upload failed" />}
      {verdict?.kind === 'failed' && (
        <p className="tx-media-library__upload-note">
          <MediaFailureNote media={verdict.media} />
        </p>
      )}
    </li>
  );
}
