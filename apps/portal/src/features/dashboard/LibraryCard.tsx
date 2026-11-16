import type { OverviewResponse } from '@tinnox/contracts';
import { Link } from 'react-router-dom';
import type { LoadState } from '../../hooks/useLoad.ts';
import { formatCount, mediaStatusNotes } from '../../lib/dashboard.ts';
import { formatBytes } from '../../lib/format.ts';
import { meterFraction, meterTone } from '../../lib/meter.ts';
import { Card, CardHeader, Icon, Meter, StatusPill } from '../../ui/index.ts';
import {
  ArrowRight,
  CircleX,
  Images,
  ListVideo,
  RefreshCw,
  type IconComponent,
} from '../../ui/icons.ts';
import { CardSkeleton } from './parts.tsx';

interface LibraryCardProps {
  readonly overview: LoadState<OverviewResponse>;
}

/** The Library card: how much media and how many playlists there are, and the storage used. */
export function LibraryCard({ overview }: LibraryCardProps) {
  return (
    <Card
      as="section"
      aria-labelledby="dashboard-library-title"
      className="tx-dashboard-card tx-dashboard-card--library"
      data-testid="dashboard-library"
    >
      <CardHeader id="dashboard-library-title" title="Library" size="title" />
      {overview.status === 'loading' && <CardSkeleton label="Loading the library" lines={4} />}
      {overview.status === 'error' && (
        <p className="tx-dashboard-unavailable">The library figures are not available.</p>
      )}
      {overview.status === 'ready' && <LibraryFigures overview={overview.data} />}
    </Card>
  );
}

function LibraryFigures({ overview }: { readonly overview: OverviewResponse }) {
  const { media, playlists } = overview;
  const notes = mediaStatusNotes(media);
  const fraction = meterFraction(media.usedBytes, media.limitBytes);
  const tone = meterTone(fraction);
  return (
    <div className="tx-stack">
      <ul className="tx-dashboard-library" aria-label="Library contents">
        <LibraryStat
          to="/media"
          icon={Images}
          count={media.total}
          singular="media file"
          plural="media files"
          testId="dashboard-library-media"
        />
        <LibraryStat
          to="/playlists"
          icon={ListVideo}
          count={playlists.total}
          singular="playlist"
          plural="playlists"
          testId="dashboard-library-playlists"
        />
      </ul>
      {notes.length > 0 && (
        <ul className="tx-cluster tx-dashboard-notes" aria-label="Media that is not ready">
          {notes.map((note) => (
            <li key={note.status} data-testid={`dashboard-library-${note.status}`}>
              <StatusPill tone={note.tone} icon={note.status === 'failed' ? CircleX : RefreshCw}>
                {note.label}
              </StatusPill>
            </li>
          ))}
        </ul>
      )}
      <div data-testid="dashboard-storage">
        <Meter
          label="Storage"
          value={media.usedBytes}
          max={media.limitBytes}
          valueText={`${formatBytes(media.usedBytes)} of ${formatBytes(media.limitBytes)} used`}
          note={
            tone === 'danger'
              ? 'Storage is nearly full. Delete media you no longer use to make room for uploads.'
              : tone === 'warn'
                ? 'Storage is filling up. Delete media you no longer use before it runs out.'
                : undefined
          }
        />
      </div>
    </div>
  );
}

interface LibraryStatProps {
  readonly to: string;
  readonly icon: IconComponent;
  readonly count: number;
  readonly singular: string;
  readonly plural: string;
  readonly testId: string;
}

function LibraryStat({ to, icon, count, singular, plural, testId }: LibraryStatProps) {
  return (
    <li>
      <Link to={to} className="tx-dashboard-stat" data-testid={testId} data-count={count}>
        <span className="tx-dashboard-stat__icon" aria-hidden="true">
          <Icon icon={icon} />
        </span>
        <span className="tx-dashboard-stat__text">
          <span className="tx-dashboard-stat__count tx-num">{formatCount(count)}</span>
          <span className="tx-dashboard-stat__label">{count === 1 ? singular : plural}</span>
        </span>
        <Icon icon={ArrowRight} size={16} className="tx-dashboard-stat__arrow" />
      </Link>
    </li>
  );
}
