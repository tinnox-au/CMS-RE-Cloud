import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { mediaLoadProblem as detailLoadProblem } from '../../lib/mediaDetailState.ts';
import { EditorPage } from '../../shell/EditorPage.tsx';
import { ArrowLeft, CalendarDays } from '../../ui/icons.ts';
import {
  ButtonLink,
  Card,
  EmptyState,
  ErrorNotice,
  Skeleton,
  SkeletonGroup,
} from '../../ui/index.ts';
import { ScheduleEditor, SCHEDULES_BACK } from './ScheduleEditor.tsx';
import './schedules.css';

/**
 * The schedule editor page: loads the schedule and the playlists its selects list, and keeps
 * the frame while it does; the editor itself is `ScheduleEditor.tsx`, mounted afresh for each
 * schedule.
 */
export function ScheduleEditorPage() {
  const { id = '' } = useParams();
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [schedule, playlists] = await Promise.all([
        api.getSchedule(id, signal),
        api.listPlaylists(signal),
      ]);
      return { schedule, playlists };
    },
    [id],
  );
  const { state, reload } = useLoad(load);

  if (state.status === 'ready') {
    return (
      <ScheduleEditor
        key={state.data.schedule.id}
        initial={state.data.schedule}
        playlists={state.data.playlists}
      />
    );
  }

  if (state.status === 'error') {
    const refusal = isApiRequestError(state.error) ? state.error : null;
    if (detailLoadProblem(refusal) === 'missing') {
      return (
        <EditorPage title="Schedule not found" back={SCHEDULES_BACK}>
          <Card data-testid="schedule-editor-missing">
            <EmptyState
              variant="inline"
              level={2}
              icon={CalendarDays}
              title="This schedule could not be loaded"
              action={
                <ButtonLink variant="primary" to="/schedules" icon={ArrowLeft}>
                  Go to all schedules
                </ButtonLink>
              }
            >
              It is not one of this organisation&rsquo;s schedules. It may have been deleted, or the
              address may be wrong.
            </EmptyState>
          </Card>
        </EditorPage>
      );
    }
    return (
      <EditorPage title="Schedule" back={SCHEDULES_BACK}>
        <ErrorNotice
          error={state.error}
          title="The schedule could not be loaded"
          onRetry={reload}
        />
      </EditorPage>
    );
  }

  return (
    <EditorPage title="Schedule" back={SCHEDULES_BACK}>
      <SkeletonGroup label="Loading schedule" className="tx-editor">
        <Skeleton variant="block" height="420px" />
        <Skeleton variant="block" height="560px" />
      </SkeletonGroup>
    </EditorPage>
  );
}
