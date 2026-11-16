import type { MediaDto } from '@tinnox/contracts';
import { mediaFailureText } from '../../../lib/mediaLibraryList.ts';
import { mediaKindLabel, presentMediaStatus } from '../../../lib/mediaName.ts';
import { CircleDashed, Film, Image } from '../../../ui/icons.ts';
import { cx, Icon, StatusPill } from '../../../ui/index.ts';
import './mediaLibrary.css';

/**
 * Why a file failed the server's check, as M0's `MediaFailure` says it: the explanation from
 * the shared message table, the API error code as text, and what the inspection added.
 * Renders nothing for a file that has not failed.
 *
 * `compact` is for a grid tile: the explanation is cut to two lines on screen (assistive
 * technology still reads all of it), the code keeps its own line and the inspection detail is
 * left to the list row and the details page. One failed tile then no longer stretches every
 * tile of its row.
 */
export function MediaFailureNote({
  media,
  className,
  compact = false,
}: {
  readonly media: Pick<MediaDto, 'status' | 'errorCode' | 'errorDetail'>;
  readonly className?: string;
  readonly compact?: boolean;
}) {
  const failure = mediaFailureText(media);
  if (failure === null) return null;
  if (compact) {
    return (
      <span
        className={cx('tx-media-library__failure', 'tx-media-library__failure--compact', className)}
        data-testid="media-library-failure"
      >
        <span className="tx-media-library__failure-message">{failure.message}</span>
        {failure.code !== null && (
          <>
            {' '}
            <span className="tx-code">{failure.code}</span>
          </>
        )}
      </span>
    );
  }
  return (
    <span
      className={cx('tx-media-library__failure', className)}
      data-testid="media-library-failure"
    >
      {failure.message}
      {failure.code !== null && (
        <>
          {' '}
          <span className="tx-code">{failure.code}</span>
        </>
      )}
      {failure.detail !== null && (
        <span className="tx-media-library__failure-detail"> {failure.detail}</span>
      )}
    </span>
  );
}

/** Ready, Processing or Failed, as a pill with words (never colour alone). */
export function MediaStatusPill({ media }: { readonly media: Pick<MediaDto, 'status'> }) {
  const status = presentMediaStatus(media.status);
  return (
    <StatusPill
      tone={status.tone}
      icon={media.status === 'processing' ? CircleDashed : undefined}
      className="tx-media-library__status"
    >
      <span data-testid="media-library-status" data-status={media.status}>
        {status.label}
      </span>
    </StatusPill>
  );
}

/** The kind with its icon: "Image", "Video". */
export function MediaKindLabel({ media }: { readonly media: Pick<MediaDto, 'kind'> }) {
  return (
    <span className="tx-media-library__kind">
      <Icon icon={media.kind === 'video' ? Film : Image} size={16} />
      {mediaKindLabel(media.kind)}
    </span>
  );
}
