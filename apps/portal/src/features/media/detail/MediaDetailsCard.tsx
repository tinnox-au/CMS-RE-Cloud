import type { MediaDto, MediaUsageResponse } from '@tinnox/contracts';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LoadState } from '../../../hooks/useLoad.ts';
import { formatTimestamp } from '../../../lib/format.ts';
import { countLabel } from '../../../lib/listView.ts';
import {
  codecLabel,
  mediaKindFact,
  shortHash,
  usageSummary,
  videoLengthFact,
} from '../../../lib/mediaDetailFacts.ts';
import { formatDimensions, mediaSizeLabel } from '../../../lib/mediaName.ts';
import { Copy, ListPlus, ListVideo, Monitor, type IconComponent } from '../../../ui/icons.ts';
import {
  Button,
  Card,
  ErrorNotice,
  Fact,
  Facts,
  Icon,
  IconButton,
  Skeleton,
  SkeletonGroup,
  useToast,
} from '../../../ui/index.ts';
import './media-detail.css';
import { MediaPreview } from './MediaPreview.tsx';

/** How many links of one kind show before the rest fold behind "Show all". */
const USAGE_PREVIEW_COUNT = 6;

function CopyValue({
  value,
  shown,
  what,
  testId,
}: {
  /** What is copied. */
  readonly value: string;
  /** What is shown; the whole value is in the tooltip of the text. */
  readonly shown: string;
  /** Names the value in the button and the confirmation: "SHA-256", "ID". */
  readonly what: string;
  readonly testId: string;
}) {
  const toast = useToast();
  const copy = () => {
    // The Clipboard API needs a secure context; a refusal is reported, never hidden.
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    const written =
      clipboard === undefined
        ? Promise.reject(new Error('no clipboard'))
        : clipboard.writeText(value);
    written.then(
      () => {
        toast.success(`${what} copied`);
      },
      () => {
        toast.error(`The ${what} could not be copied`, {
          detail: 'The browser did not allow access to the clipboard.',
        });
      },
    );
  };
  return (
    <span className="tx-media-detail-copy">
      <span className="tx-media-detail-copy__value" title={shown === value ? undefined : value}>
        {shown}
      </span>
      <IconButton
        icon={Copy}
        size="sm"
        label={`Copy ${what}`}
        data-testid={`${testId}-copy`}
        onClick={copy}
      />
    </span>
  );
}

function MediaFacts({ media }: { readonly media: MediaDto }) {
  const dimensions = formatDimensions(media.width, media.height);
  const length = media.kind === 'video' ? videoLengthFact(media.durationMs) : null;
  const codec = codecLabel(media.codec);
  const size = mediaSizeLabel(media);
  return (
    <Facts className="tx-media-detail-facts">
      <Fact label="File name" testId="media-detail-fact-file-name">
        {media.originalName === '' ? 'Not recorded' : media.originalName}
      </Fact>
      <Fact label="Kind" testId="media-detail-fact-kind">
        {mediaKindFact(media)}
      </Fact>
      {dimensions !== null && (
        <Fact label="Dimensions" testId="media-detail-fact-dimensions">
          <span className="tx-num">{dimensions}</span>
        </Fact>
      )}
      {length !== null && (
        <Fact label="Length" testId="media-detail-fact-length">
          <span className="tx-num">{length}</span>
        </Fact>
      )}
      {codec !== null && (
        <Fact label="Codec" testId="media-detail-fact-codec">
          {codec}
        </Fact>
      )}
      {size !== null && (
        <Fact label="Size" testId="media-detail-fact-size">
          <span className="tx-num">{size}</span>
        </Fact>
      )}
      <Fact label="Uploaded" testId="media-detail-fact-uploaded">
        {formatTimestamp(media.createdAt)}
      </Fact>
      {media.sha256 !== null && (
        <Fact label="SHA-256" testId="media-detail-fact-sha256">
          <CopyValue
            value={media.sha256}
            shown={shortHash(media.sha256)}
            what="SHA-256"
            testId="media-detail-fact-sha256"
          />
        </Fact>
      )}
      <Fact label="ID" testId="media-detail-fact-id">
        <CopyValue value={media.id} shown={media.id} what="ID" testId="media-detail-fact-id" />
      </Fact>
    </Facts>
  );
}

function UsageGroup({
  label,
  note,
  icon,
  items,
  to,
  noun,
  testId,
}: {
  readonly label: string;
  readonly note?: string;
  readonly icon: IconComponent;
  readonly items: readonly { readonly id: string; readonly name: string }[];
  readonly to: (id: string) => string;
  /** "playlist" or "screen", for the "Show all 12 playlists" button. */
  readonly noun: string;
  readonly testId: string;
}) {
  const labelId = useId();
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, USAGE_PREVIEW_COUNT);
  return (
    <div className="tx-media-detail-usage__group" data-testid={testId}>
      <h3 id={labelId} className="tx-media-detail-usage__label">
        {label}
      </h3>
      {note !== undefined && <p className="tx-media-detail-usage__note">{note}</p>}
      <ul className="tx-media-detail-usage__list" aria-labelledby={labelId}>
        {shown.map((item) => (
          <li key={item.id}>
            <Link
              className="tx-media-detail-usage__link"
              to={to(item.id)}
              data-testid={`${testId}-link`}
            >
              <Icon icon={icon} size={16} />
              <span className="tx-media-detail-usage__name">{item.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      {items.length > USAGE_PREVIEW_COUNT && (
        <Button
          size="sm"
          variant="ghost"
          className="tx-media-detail-usage__more"
          aria-expanded={all}
          onClick={() => {
            setAll(!all);
          }}
        >
          {all ? 'Show fewer' : `Show all ${countLabel(items.length, noun)}`}
        </Button>
      )}
    </div>
  );
}

function UsageBody({
  state,
  onRetry,
}: {
  readonly state: LoadState<MediaUsageResponse>;
  readonly onRetry: () => void;
}) {
  if (state.status === 'loading') {
    return (
      <SkeletonGroup label="Loading where this file is used" className="tx-media-detail-usage">
        <Skeleton width="55%" />
        <Skeleton width="80%" height="20px" />
        <Skeleton width="70%" height="20px" />
      </SkeletonGroup>
    );
  }
  if (state.status === 'error') {
    return (
      <ErrorNotice
        error={state.error}
        title="Where this file is used could not be loaded"
        onRetry={onRetry}
      />
    );
  }
  const usage = state.data;
  const unused = usage.playlists.length === 0 && usage.displays.length === 0;
  return (
    <div className="tx-media-detail-usage">
      {state.refreshError !== null && (
        <ErrorNotice
          error={state.refreshError}
          title="This list could not be refreshed"
          onRetry={onRetry}
        />
      )}
      <p className="tx-media-detail-usage__note" data-testid="media-detail-usage-summary">
        {unused
          ? 'Not in a playlist yet, and not part of what any screen was last pushed.'
          : usageSummary(usage)}
      </p>
      <UsageGroup
        label="Playlists"
        icon={ListVideo}
        items={usage.playlists}
        to={(id) => `/playlists/${id}`}
        noun="playlist"
        testId="media-detail-usage-playlists"
      />
      <UsageGroup
        label="Screens"
        note="Their last push contains this file, whatever was edited since."
        icon={Monitor}
        items={usage.displays}
        to={(id) => `/screens/${id}`}
        noun="screen"
        testId="media-detail-usage-screens"
      />
    </div>
  );
}

export interface MediaUsageProps {
  readonly state: LoadState<MediaUsageResponse>;
  readonly onRetry: () => void;
  /** Opens the playlist picker for the item as it is saved. */
  readonly onAddToPlaylist: () => void;
}

export interface MediaDetailsCardProps {
  readonly media: MediaDto;
  /** The name shown as the page title. */
  readonly name: string;
  /** Where the item is used. Left out for media that is not ready: it cannot be used yet. */
  readonly usage?: MediaUsageProps;
  /** Extra content under the preview, for example nothing at all. */
  readonly children?: ReactNode;
}

/**
 * The narrow "details" column of the editor page, as cards: the preview with the status in
 * words, the facts about the file, and where it is used, as links to the playlists and the
 * screens.
 */
export function MediaDetailsCard({ media, name, usage }: MediaDetailsCardProps) {
  const factsId = useId();
  const usageId = useId();
  return (
    <div className="tx-media-detail-aside" data-testid="media-detail-details">
      <Card className="tx-media-detail-part tx-media-detail-part--preview">
        <MediaPreview media={media} name={name} />
      </Card>
      <Card
        as="section"
        className="tx-media-detail-part tx-media-detail-part--facts"
        aria-labelledby={factsId}
      >
        <div className="tx-media-detail-part__head">
          <h2 id={factsId} className="tx-media-detail-part__title">
            File details
          </h2>
        </div>
        <MediaFacts media={media} />
      </Card>
      {usage !== undefined && (
        <Card
          as="section"
          className="tx-media-detail-part tx-media-detail-part--wide"
          aria-labelledby={usageId}
          data-testid="media-detail-usage"
          data-state={usage.state.status}
        >
          <div className="tx-media-detail-part__head">
            <h2 id={usageId} className="tx-media-detail-part__title">
              Used in
            </h2>
            <Button
              size="sm"
              variant="ghost"
              icon={ListPlus}
              data-testid="media-detail-add-to-playlist"
              onClick={usage.onAddToPlaylist}
            >
              Add to playlist
            </Button>
          </div>
          <UsageBody state={usage.state} onRetry={usage.onRetry} />
        </Card>
      )}
    </div>
  );
}
