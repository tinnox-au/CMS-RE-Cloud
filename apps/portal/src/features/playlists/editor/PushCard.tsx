import type { DisplayDto, PlaylistDto } from '@tinnox/contracts';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api/index.ts';
import { anyHasOtherContent, CONTENT_REPLACED_NOTE } from '../../../lib/assignedContent.ts';
import { bulkFailureTitle, runInSequence, type BulkFailure } from '../../../lib/bulkOutcome.ts';
import { formatTimestamp } from '../../../lib/format.ts';
import {
  assignConfirmLabel,
  assignedMessage,
  pushHoldReason,
  pushSummary,
  rowsForPlaylist,
} from '../../../lib/playlistEditor.ts';
import { Plus, Send } from '../../../ui/icons.ts';
import {
  Button,
  Card,
  CardHeader,
  ErrorNotice,
  Skeleton,
  SkeletonGroup,
  Tooltip,
  useToast,
} from '../../../ui/index.ts';
import { usePush } from '../../push/PushContext.tsx';
import { BulkFailures } from '../../shared/BulkFailures.tsx';
import { PushStatePill, ScreenPickerDialog } from '../../shared/index.ts';
import './playlistEditor.css';

export interface PushCardProps {
  /** The playlist as last saved: assigning and pushing act on it, not on the draft. */
  readonly playlist: PlaylistDto;
  readonly dirty: boolean;
}

/**
 * The screens that have this playlist assigned directly (not through a schedule or a layout), with where each stands between what is
 * assigned and what it was last given (`GET /api/push`, read through `usePush`). "Assign to
 * screens" assigns it to more screens, several at once, as the list's row menu does; "Push now" opens the push dialog on this playlist's
 * screens. Push is held while the draft has unsaved changes: only the saved playlist can be
 * pushed.
 */
export function PushCard({ playlist, dirty }: PushCardProps) {
  const push = usePush();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [failures, setFailures] = useState<{
    readonly title: string;
    readonly note: string | undefined;
    readonly failed: readonly BulkFailure<DisplayDto>[];
  } | null>(null);

  const rows = rowsForPlaylist(push.plan, playlist.id);
  const hold = pushHoldReason(dirty, rows);
  const planKnown = push.plan !== null;

  const assign = async (displays: readonly DisplayDto[]) => {
    if (assigning || displays.length === 0) return;
    setAssigning(true);
    setFailures(null);
    const outcome = await runInSequence(displays, (display) =>
      api.patchDisplay(display.id, { assignedPlaylistId: playlist.id }),
    );
    setAssigning(false);
    setPicking(false);
    if (outcome.done.length > 0) {
      push.refresh();
      toast.success(assignedMessage(outcome.done.map(({ item }) => item.name)), {
        detail: 'Nothing changes on a screen until you push.',
      });
    }
    if (outcome.failed.length > 0) {
      setFailures({
        title: bulkFailureTitle(outcome.failed.length, displays.length, 'screen', 'assigned'),
        note:
          outcome.done.length > 0
            ? `${assignedMessage(outcome.done.map(({ item }) => item.name))}.`
            : undefined,
        failed: outcome.failed,
      });
    }
  };

  const openPush = () => {
    if (hold !== null) return;
    push.openDialog({ only: rows.map((row) => row.display.id) });
  };

  const pushButton = (
    <Button
      variant="secondary"
      icon={Send}
      aria-disabled={hold !== null || undefined}
      onClick={openPush}
      data-testid="playlist-editor-push-now"
    >
      Push now
    </Button>
  );

  return (
    <Card
      as="section"
      aria-labelledby="tx-playlist-editor-push"
      className="tx-playlist-editor-push"
      data-testid="playlist-editor-push"
    >
      <CardHeader
        id="tx-playlist-editor-push"
        title="Push"
        size="title"
        description={
          planKnown ? (
            <span data-testid="playlist-editor-push-summary">{pushSummary(rows)}</span>
          ) : push.planError === null ? (
            'Checking which screens have this playlist.'
          ) : undefined
        }
      />

      <div className="tx-playlist-editor-push__body">
        {!planKnown && push.planError === null && (
          <SkeletonGroup label="Loading screens" className="tx-stack tx-stack--tight">
            <Skeleton variant="block" height="44px" />
            <Skeleton variant="block" height="44px" />
          </SkeletonGroup>
        )}
        {push.planError !== null && (
          <ErrorNotice
            error={push.planError}
            title={
              planKnown
                ? 'The push state could not be refreshed'
                : 'The push state could not be loaded'
            }
            onRetry={push.refresh}
          />
        )}

        {planKnown && rows.length > 0 && (
          <ul className="tx-playlist-editor-push__list" aria-label="Screens with this playlist">
            {rows.map((row) => (
              <li
                key={row.display.id}
                className="tx-playlist-editor-push__row"
                data-state={row.state}
                data-testid={`playlist-editor-push-row-${row.display.id}`}
              >
                <span className="tx-playlist-editor-push__text">
                  <Link
                    className="tx-playlist-editor-push__name tx-break"
                    to={`/screens/${row.display.id}`}
                  >
                    {row.display.name}
                  </Link>
                  <span className="tx-playlist-editor-push__meta">
                    {row.lastPushedAt === null
                      ? 'Never pushed'
                      : `Last pushed ${formatTimestamp(row.lastPushedAt)}`}
                  </span>
                </span>
                <span className="tx-playlist-editor-push__state">
                  <PushStatePill state={row.state} />
                </span>
                {row.state === 'blocked' && row.issues.length > 0 && (
                  <ul className="tx-playlist-editor-push__issues">
                    {row.issues.map((issue, index) => (
                      <li key={index}>
                        {issue.message} <span className="tx-code">{issue.code}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}

        {failures !== null && (
          <BulkFailures title={failures.title} note={failures.note} failures={failures.failed} />
        )}

        <div className="tx-playlist-editor-push__actions">
          <Button
            variant="secondary"
            icon={Plus}
            onClick={() => {
              setFailures(null);
              setPicking(true);
            }}
            data-testid="playlist-editor-assign"
          >
            Assign to screens
          </Button>
          {hold === null ? (
            pushButton
          ) : (
            <Tooltip content={hold} describe>
              {pushButton}
            </Tooltip>
          )}
        </div>
        {hold !== null && planKnown && (
          <p className="tx-small tx-muted" data-testid="playlist-editor-push-hold">
            {hold}
          </p>
        )}
      </div>

      <ScreenPickerDialog
        open={picking}
        onClose={() => {
          if (!assigning) setPicking(false);
        }}
        multiple
        title="Assign to screens"
        description={(chosen) => (
          <>
            <strong className="tx-break">{playlist.name}</strong>, as last saved, replaces the
            playlist each chosen screen has now. Nothing changes on a screen until you push.
            {anyHasOtherContent(chosen) && ` ${CONTENT_REPLACED_NOTE}`}
          </>
        )}
        confirmLabel={assignConfirmLabel}
        disabledReason={(display) =>
          display.assignedPlaylist?.id === playlist.id ? 'Already has this playlist' : null
        }
        busy={assigning}
        errorTitle="The playlist was not assigned"
        onConfirm={(displays) => {
          void assign(displays);
        }}
        testId="playlist-editor-assign-picker"
      />
    </Card>
  );
}
