import type { DisplayDto, PlaylistSummaryDto } from '@tinnox/contracts';
import { useState } from 'react';
import { api } from '../../../api/index.ts';
import { formatTimestamp } from '../../../lib/format.ts';
import { pushRowFor } from '../../../lib/screenDetail.ts';
import { assignedDetail } from '../../../lib/screensList.ts';
import { presentPushState } from '../../../lib/screenStatusPush.ts';
import { ExternalLink, ListVideo, RefreshCw } from '../../../ui/icons.ts';
import {
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Icon,
  Skeleton,
  SkeletonGroup,
  useToast,
} from '../../../ui/index.ts';
import { usePush } from '../../push/PushContext.tsx';
import { PlaylistMosaic, PlaylistPickerDialog, PushStatePill } from '../../shared/index.ts';
import { apiErrorCode, apiErrorMessage } from './errors.ts';
import type { AssignedPlaylistState } from './useAssignedPlaylist.ts';

export interface ContentCardProps {
  readonly display: DisplayDto;
  readonly assigned: AssignedPlaylistState;
  readonly onReloadAssigned: () => void;
  readonly onAssigned: (display: DisplayDto) => void;
}

interface AssignState {
  readonly busy: boolean;
  readonly error: unknown;
}

/**
 * What is assigned to the screen (decision P2-05: assign, then push) and where the screen
 * stands between what is assigned and what it was last given.
 */
export function ContentCard({ display, assigned, onReloadAssigned, onAssigned }: ContentCardProps) {
  const toast = useToast();
  const push = usePush();
  const [assign, setAssign] = useState<AssignState | null>(null);
  const playlist = display.assignedPlaylist;

  const assignPlaylist = (chosen: PlaylistSummaryDto | null) => {
    if ((chosen?.id ?? null) === (playlist?.id ?? null)) {
      setAssign(null);
      return;
    }
    setAssign({ busy: true, error: null });
    api
      .patchDisplay(display.id, { assignedPlaylistId: chosen?.id ?? null })
      .then((saved) => {
        setAssign(null);
        onAssigned(saved);
        push.refresh();
        // Unassigning clears the assignment only: the screen keeps what it was last given.
        toast.success(chosen === null ? 'Playlist unassigned' : `${chosen.name} assigned`, {
          detail: assignedDetail(chosen?.name ?? null, 1),
        });
      })
      .catch((error: unknown) => {
        setAssign({ busy: false, error });
      });
  };

  return (
    <Card as="section" aria-labelledby="screen-detail-content-title">
      <CardHeader
        id="screen-detail-content-title"
        title="Content"
        description="Assigning changes nothing on the screen until you push."
      />
      <div className="tx-screen-detail-content">
        <div className="tx-screen-detail-playlist" data-testid="screen-detail-playlist">
          <PlaylistVisual assigned={assigned} />
          <div className="tx-screen-detail-playlist__text">
            {playlist === null ? (
              <>
                <span className="tx-screen-detail-playlist__name">Nothing assigned</span>
                <span className="tx-screen-detail-note">
                  Choose a playlist for this screen, then push it.
                </span>
              </>
            ) : (
              <>
                <span className="tx-screen-detail-playlist__name">{playlist.name}</span>
                <PlaylistMeta assigned={assigned} onRetry={onReloadAssigned} />
              </>
            )}
          </div>
          <div className="tx-screen-detail-playlist__actions">
            <Button
              size="sm"
              variant={playlist === null ? 'primary' : 'secondary'}
              icon={ListVideo}
              onClick={() => {
                setAssign({ busy: false, error: null });
              }}
              data-testid="screen-detail-change-playlist"
            >
              {playlist === null ? 'Assign playlist' : 'Change'}
              {playlist !== null && <span className="tx-visually-hidden"> playlist</span>}
            </Button>
            {playlist !== null && (
              <ButtonLink
                size="sm"
                variant="ghost"
                icon={ExternalLink}
                to={`/playlists/${playlist.id}`}
                data-testid="screen-detail-open-playlist"
              >
                Open playlist
              </ButtonLink>
            )}
          </div>
        </div>

        <PushStatePart displayId={display.id} />
      </div>

      <PlaylistPickerDialog
        open={assign !== null}
        onClose={() => {
          setAssign(null);
        }}
        title="Assign content"
        description={`Choose what ${display.name} should play. Nothing changes on the screen until you push.`}
        confirmLabel="Assign playlist"
        currentId={playlist?.id ?? null}
        allowNone
        noneHint="The screen keeps what it was last given until the next push."
        busy={assign?.busy}
        error={assign?.error}
        errorTitle="The playlist was not assigned"
        onConfirm={assignPlaylist}
        testId="screen-detail-playlist-picker"
      />
    </Card>
  );
}

function PlaylistVisual({ assigned }: { readonly assigned: AssignedPlaylistState }) {
  if (assigned.status === 'ready') {
    const { content } = assigned;
    return (
      <PlaylistMosaic
        size="md"
        mediaIds={content.previewMediaIds}
        kinds={content.kinds}
        kindOf={(id) => content.kindById.get(id)}
        className="tx-screen-detail-playlist__mosaic"
      />
    );
  }
  if (assigned.status === 'loading') {
    return <Skeleton variant="block" width="72px" height="41px" />;
  }
  return (
    <span className="tx-screen-detail-playlist__empty" aria-hidden="true">
      <Icon icon={ListVideo} />
    </span>
  );
}

function PlaylistMeta({
  assigned,
  onRetry,
}: {
  readonly assigned: AssignedPlaylistState;
  readonly onRetry: () => void;
}) {
  switch (assigned.status) {
    case 'none':
      return null;
    case 'loading':
      return (
        <SkeletonGroup label="Loading playlist">
          <Skeleton width="96px" />
        </SkeletonGroup>
      );
    case 'error': {
      const code = apiErrorCode(assigned.error);
      return (
        <span className="tx-screen-detail-note" role="alert">
          Its items could not be loaded. {apiErrorMessage(assigned.error)}{' '}
          {code !== null && <span className="tx-code">{code}</span>}{' '}
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onRetry}>
            Try again
          </Button>
        </span>
      );
    }
    case 'ready':
      return (
        <span className="tx-screen-detail-note tx-num" data-testid="screen-detail-playlist-summary">
          {assigned.content.summary}
        </span>
      );
  }
}

function PushStatePart({ displayId }: { readonly displayId: string }) {
  const { plan, planError, refresh } = usePush();
  const row = pushRowFor(plan, displayId);

  let body;
  if (row !== null) {
    const presentation = presentPushState(row.state);
    body = (
      <>
        <p className="tx-screen-detail-pushstate__line">
          <PushStatePill state={row.state} testId="screen-detail-push-state" />
          {row.lastPushedAt !== null && (
            <span className="tx-screen-detail-note">
              Last pushed {formatTimestamp(row.lastPushedAt)}
            </span>
          )}
        </p>
        <p className="tx-screen-detail-note">{presentation.detail}</p>
        {row.issues.length > 0 && (
          <ul className="tx-screen-detail-issues" data-testid="screen-detail-push-issues">
            {row.issues.map((issue, index) => (
              <li key={index}>
                {issue.message} <span className="tx-code">{issue.code}</span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  } else if (planError !== null) {
    const code = apiErrorCode(planError);
    body = (
      <p className="tx-screen-detail-note" data-testid="screen-detail-push-state-error">
        The push state could not be read. {apiErrorMessage(planError)}{' '}
        {code !== null && <span className="tx-code">{code}</span>}{' '}
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={refresh}>
          Try again
        </Button>
      </p>
    );
  } else if (plan === null) {
    body = (
      <SkeletonGroup label="Loading push state" className="tx-stack tx-stack--tight">
        <Skeleton variant="pill" width="120px" height="24px" />
        <Skeleton width="80%" />
      </SkeletonGroup>
    );
  } else {
    // The plan was read before this screen existed; the next read lists it.
    body = (
      <p className="tx-screen-detail-note">
        This screen is not in the push plan yet.{' '}
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={refresh}>
          Check again
        </Button>
      </p>
    );
  }

  return (
    <div className="tx-screen-detail-pushstate">
      <h3 className="tx-screen-detail-caption">Push state</h3>
      {body}
    </div>
  );
}
