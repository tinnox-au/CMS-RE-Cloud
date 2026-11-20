import type { MediaDto } from '@tinnox/contracts';
import { mediaFailureText } from '../../../lib/mediaLibraryList.ts';
import { mediaKindLabel, presentMediaStatus } from '../../../lib/mediaName.ts';
import { CircleDashed, Film, Image } from '../../../ui/icons.ts';
import { cx, Icon, StatusPill } from '../../../ui/index.ts';
import './mediaLibrary.css';

/**
 * An API error code as text that keeps whole where it fits and, only where it cannot, breaks
 * after an underscore ("unsupported_" then "codec") rather than in the middle of a word.
 */
export function ErrorCodeText({ code }: { readonly code: string }) {
  const parts = code.split('_');
  return (
    <span className="tx-media-library__failure-code">
      {parts.map((part, index) =>
        index < parts.length - 1 ? (
          <span key={index}>
            {part}_<wbr />
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </span>
  );
}

/**
 * Why a file failed the server's check, as M0's `MediaFailure` says it: the explanation from
 * the shared message table on one caption line in the danger colour, then a quieter line with
 * the API error code as text and what the inspection added. Renders nothing for a file that
 * has not failed.
 *
 * `compact` is for a grid tile: the explanation is cut to two lines on screen (assistive
 * technology still reads all of it), the code keeps its own line and the inspection detail is
 * left to the list row and the details page. One failed tile then no longer stretches every
 * tile of its row.
 *
 * `readOnly` (a role that cannot upload) keeps what went wrong and drops what to do next.
 */
export function MediaFailureNote({
  media,
  className,
  compact = false,
  readOnly = false,
}: {
  readonly media: Pick<MediaDto, 'status' | 'errorCode' | 'errorDetail'>;
  readonly className?: string;
  readonly compact?: boolean;
  readonly readOnly?: boolean;
}) {
  const failure = mediaFailureText(media, readOnly);
  if (failure === null) return null;
  const detail = compact ? null : failure.detail;
  return (
    <span
      className={cx(
        'tx-media-library__failure',
        compact && 'tx-media-library__failure--compact',
        className,
      )}
      data-testid="media-library-failure"
    >
      <span className="tx-media-library__failure-message">{failure.message}</span>
      {(failure.code !== null || detail !== null) && (
        <span className="tx-media-library__failure-meta">
          {failure.code !== null && (
            // The dot stays with the code, so a wrapped detail never starts with it.
            <span className="tx-media-library__failure-group">
              {' '}
              <ErrorCodeText code={failure.code} />
              {detail !== null && (
                <span className="tx-media-library__failure-dot" aria-hidden="true">
                  {' ·'}
                </span>
              )}
            </span>
          )}
          {detail !== null && <span className="tx-media-library__failure-detail"> {detail}</span>}
        </span>
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
