import type { DisplayDto, PlaylistSummaryDto, ScheduleSummaryDto } from '@tinnox/contracts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../api/index.ts';
import { formatTimestamp } from '../../../lib/format.ts';
import { pushRowFor } from '../../../lib/screenDetail.ts';
import { assignedDetail, SCHEDULE_REPLACED_NOTE } from '../../../lib/screensList.ts';
import { presentPushState } from '../../../lib/screenStatusPush.ts';
import {
  CalendarDays,
  ChevronDown,
  ExternalLink,
  ListVideo,
  ListX,
  RefreshCw,
} from '../../../ui/icons.ts';
import {
  Button,
  ButtonLink,
  Card,
  CardHeader,
  ErrorNotice,
  Icon,
  Menu,
  MenuItem,
  MenuSeparator,
  Skeleton,
  SkeletonGroup,
  useToast,
} from '../../../ui/index.ts';
import { usePush } from '../../push/PushContext.tsx';
import {
  PlaylistMosaic,
  PlaylistPickerDialog,
  PushStatePill,
  SchedulePickerDialog,
} from '../../shared/index.ts';
import { apiErrorCode, apiErrorMessage } from './errors.ts';
import type { AssignedPlaylistState } from './useAssignedPlaylist.ts';

export interface ContentCardProps {
  readonly display: DisplayDto;
  readonly assigned: AssignedPlaylistState;
  readonly onReloadAssigned: () => void;
  readonly onAssigned: (display: DisplayDto) => void;
}

/** What is being changed: a picker is open, or "Remove content" is being saved. */
interface AssignState {
  readonly kind: 'playlist' | 'schedule' | 'remove';
  readonly busy: boolean;
  readonly error: unknown;
}

/**
 * What is assigned to the screen (decision P2-05: assign, then push) and where the screen
 * stands between what is assigned and what it was last given. A screen has a playlist or a
 * schedule, never both: assigning one takes the place of the other.
 */
export function ContentCard({ display, assigned, onReloadAssigned, onAssigned }: ContentCardProps) {
  const toast = useToast();
  const push = usePush();
  const [assign, setAssign] = useState<AssignState | null>(null);
  const playlist = display.assignedPlaylist;
  const schedule = display.assignedSchedule;
  const hasContent = playlist !== null || schedule !== null;

  // With nothing assigned the card offers two buttons, with content one "Change" menu. When
  // a save swaps one for the other, the control that was used is gone: focus moves to the
  // first button that took its place, so it never falls to the document.
  const actionsRef = useRef<HTMLDivElement>(null);
  const focusActions = useRef(false);
  useEffect(() => {
    if (!focusActions.current) return;
    focusActions.current = false;
    actionsRef.current?.querySelector('button')?.focus();
  }, [hasContent]);

  const save = (
    kind: AssignState['kind'],
    patch: {
      readonly assignedPlaylistId?: string | null;
      readonly assignedScheduleId?: string | null;
    },
    done: string,
    detail: string,
  ) => {
    if (assign?.busy === true) return;
    setAssign({ kind, busy: true, error: null });
    api
      .patchDisplay(display.id, patch)
      .then((saved) => {
        const savedHasContent = saved.assignedPlaylist !== null || saved.assignedSchedule !== null;
        focusActions.current = savedHasContent !== hasContent;
        setAssign(null);
        onAssigned(saved);
        push.refresh();
        toast.success(done, { detail });
      })
      .catch((error: unknown) => {
        setAssign({ kind, busy: false, error });
      });
  };

  const assignPlaylist = (chosen: PlaylistSummaryDto | null) => {
    if (chosen === null || chosen.id === playlist?.id) {
      setAssign(null);
      return;
    }
    // A playlist id alone also clears a schedule (the display patch contract).
    save(
      'playlist',
      { assignedPlaylistId: chosen.id },
      `${chosen.name} assigned`,
      assignedDetail(chosen.name, 1),
    );
  };

  const assignSchedule = (chosen: ScheduleSummaryDto) => {
    if (chosen.id === schedule?.id) {
      setAssign(null);
      return;
    }
    save(
      'schedule',
      { assignedScheduleId: chosen.id },
      `${chosen.name} assigned`,
      assignedDetail(chosen.name, 1),
    );
  };

  // Removing clears the assignment only: the screen keeps what it was last given.
  const removeContent = () => {
    save(
      'remove',
      { assignedPlaylistId: null, assignedScheduleId: null },
      'Content removed',
      assignedDetail(null, 1),
    );
  };

  const openPicker = (kind: 'playlist' | 'schedule') => {
    if (assign?.busy === true) return;
    setAssign({ kind, busy: false, error: null });
  };
  const clearAssign = () => {
    setAssign(null);
  };
  const removing = assign?.kind === 'remove' ? assign : null;

  return (
    <Card as="section" aria-labelledby="screen-detail-content-title">
      <CardHeader
        id="screen-detail-content-title"
        title="Content"
        size="title"
        description="Assigning changes nothing on the screen until you push."
      />
      <div className="tx-screen-detail-content">
        <div className="tx-screen-detail-playlist" data-testid="screen-detail-playlist">
          <PlaylistVisual assigned={assigned} />
          <div className="tx-screen-detail-playlist__text">
            {schedule !== null ? (
              <>
                <span className="tx-screen-detail-caption">Schedule</span>
                <span className="tx-screen-detail-playlist__name">{schedule.name}</span>
                <span
                  className="tx-screen-detail-note"
                  data-testid="screen-detail-default-playlist"
                >
                  Default playlist: {schedule.defaultPlaylist.name}
                </span>
                <PlaylistMeta assigned={assigned} onRetry={onReloadAssigned} />
              </>
            ) : playlist !== null ? (
              <>
                <span className="tx-screen-detail-caption">Playlist</span>
                <span className="tx-screen-detail-playlist__name">{playlist.name}</span>
                <PlaylistMeta assigned={assigned} onRetry={onReloadAssigned} />
              </>
            ) : (
              <>
                <span className="tx-screen-detail-playlist__name">Nothing assigned</span>
                <span className="tx-screen-detail-note">
                  Choose a playlist or a schedule for this screen, then push it.
                </span>
              </>
            )}
          </div>
          <div className="tx-screen-detail-playlist__actions" ref={actionsRef}>
            {hasContent ? (
              <Menu
                placement="bottom-end"
                trigger={(props) => (
                  <Button
                    {...props}
                    size="sm"
                    trailingIcon={ChevronDown}
                    busy={removing?.busy}
                    // A busy button ignores clicks; Arrow keys must not open the menu either.
                    onKeyDown={removing?.busy === true ? undefined : props.onKeyDown}
                    data-testid="screen-detail-change-content"
                  >
                    Change
                    <span className="tx-visually-hidden"> content</span>
                  </Button>
                )}
              >
                <MenuItem
                  icon={ListVideo}
                  onSelect={() => {
                    openPicker('playlist');
                  }}
                >
                  Choose a playlist…
                </MenuItem>
                <MenuItem
                  icon={CalendarDays}
                  onSelect={() => {
                    openPicker('schedule');
                  }}
                >
                  Choose a schedule…
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={ListX} onSelect={removeContent}>
                  Remove content
                </MenuItem>
              </Menu>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  icon={ListVideo}
                  onClick={() => {
                    openPicker('playlist');
                  }}
                  data-testid="screen-detail-choose-playlist"
                >
                  Assign playlist
                </Button>
                <Button
                  size="sm"
                  icon={CalendarDays}
                  onClick={() => {
                    openPicker('schedule');
                  }}
                  data-testid="screen-detail-choose-schedule"
                >
                  Assign schedule
                </Button>
              </>
            )}
            {schedule !== null ? (
              <ButtonLink
                size="sm"
                variant="ghost"
                icon={ExternalLink}
                to={`/schedules/${schedule.id}`}
                data-testid="screen-detail-open-schedule"
              >
                Open schedule
              </ButtonLink>
            ) : (
              playlist !== null && (
                <ButtonLink
                  size="sm"
                  variant="ghost"
                  icon={ExternalLink}
                  to={`/playlists/${playlist.id}`}
                  data-testid="screen-detail-open-playlist"
                >
                  Open playlist
                </ButtonLink>
              )
            )}
          </div>
        </div>

        {removing !== null && removing.error !== null && (
          <ErrorNotice
            error={removing.error}
            title="The content was not removed"
            onDismiss={clearAssign}
          />
        )}

        <PushStatePart displayId={display.id} />
      </div>

      <PlaylistPickerDialog
        open={assign?.kind === 'playlist'}
        onClose={clearAssign}
        title="Assign content"
        description={`Choose the playlist for ${display.name}. Nothing changes on the screen until you push.${
          schedule === null ? '' : ` ${SCHEDULE_REPLACED_NOTE}`
        }`}
        confirmLabel="Assign playlist"
        currentId={playlist?.id ?? null}
        busy={assign?.kind === 'playlist' && assign.busy}
        error={assign?.kind === 'playlist' ? assign.error : null}
        errorTitle="The playlist was not assigned"
        onConfirm={assignPlaylist}
        testId="screen-detail-playlist-picker"
      />

      <SchedulePickerDialog
        open={assign?.kind === 'schedule'}
        onClose={clearAssign}
        title="Assign content"
        description={`Choose the schedule for ${display.name}. Nothing changes on the screen until you push. Screens need player 0.4.0 or later to play a schedule's events.`}
        confirmLabel="Assign schedule"
        currentId={schedule?.id ?? null}
        busy={assign?.kind === 'schedule' && assign.busy}
        error={assign?.kind === 'schedule' ? assign.error : null}
        errorTitle="The schedule was not assigned"
        onConfirm={assignSchedule}
        testId="screen-detail-schedule-picker"
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
