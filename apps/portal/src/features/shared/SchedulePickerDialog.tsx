import type { ScheduleSummaryDto } from '@tinnox/contracts';
import { useId, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api/index.ts';
import { countLabel, matchesSearch } from '../../lib/listView.ts';
import { scheduleSummaryLabel } from '../../lib/schedules.ts';
import { CalendarDays, SearchX } from '../../ui/icons.ts';
import {
  Button,
  ButtonLink,
  Dialog,
  EmptyState,
  ErrorNotice,
  Icon,
  SearchField,
  SkeletonGroup,
} from '../../ui/index.ts';
import { PickRow, PickRowSkeletons } from './PickRow.tsx';
import './shared.css';
import { useLoadWhileOpen } from './useLoadWhileOpen.ts';
import { useSettledFocus } from './useSettledFocus.ts';

export interface SchedulePickerDialogProps {
  readonly open: boolean;
  /** Cancel, Escape and the close button. The caller also closes it after a successful save. */
  readonly onClose: () => void;
  /**
   * The primary button. The dialog does not save and does not close itself: do the work, show
   * `busy` meanwhile, then close it, or pass what went wrong as `error`.
   */
  readonly onConfirm: (schedule: ScheduleSummaryDto) => void;
  /** Default "Choose a schedule". */
  readonly title?: string;
  readonly description?: ReactNode;
  /** Default "Choose schedule". Say what happens: "Assign schedule". */
  readonly confirmLabel?: string;
  /** The schedule that is chosen when the dialog opens, for example the one assigned now. */
  readonly currentId?: string | null;
  /** The caller is saving: the dialog cannot be dismissed and the button shows it. */
  readonly busy?: boolean;
  /** What the caller's save threw. Shown in the dialog with the API error code. */
  readonly error?: unknown;
  /** Title of that error: "The schedule was not assigned". */
  readonly errorTitle?: string;
  /** Default `shared-schedule-picker`. */
  readonly testId?: string;
}

function loadSchedules(signal: AbortSignal): Promise<ScheduleSummaryDto[]> {
  return api.listSchedules(signal);
}

/**
 * Chooses one schedule: a searchable list with each schedule's default playlist and number
 * of events. The list is loaded afresh each time the dialog opens. There is no "none" here:
 * content is removed from a screen on the screen's page.
 */
export function SchedulePickerDialog({
  open,
  onClose,
  onConfirm,
  title = 'Choose a schedule',
  description,
  confirmLabel = 'Choose schedule',
  currentId = null,
  busy = false,
  error = null,
  errorTitle = 'The change was not saved',
  testId = 'shared-schedule-picker',
}: SchedulePickerDialogProps) {
  const groupName = useId();
  const { state, reload } = useLoadWhileOpen(open, loadSchedules);
  const [choice, setChoice] = useState<string | null>(currentId);
  const [query, setQuery] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChoice(currentId);
      setQuery('');
    }
  }

  const bodyRef = useRef<HTMLDivElement>(null);
  useSettledFocus(bodyRef, state.status);

  const schedules = state.status === 'ready' ? state.data : [];
  const shown = schedules.filter((schedule) =>
    matchesSearch([schedule.name, schedule.description, schedule.defaultPlaylist.name], query),
  );
  const chosen = choice === null ? undefined : schedules.find((s) => s.id === choice);

  const confirm = () => {
    if (chosen === undefined || busy) return;
    onConfirm(chosen);
  };

  const searching = query.trim() !== '';
  return (
    <Dialog
      testId={testId}
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="md"
      busy={busy}
      footerStart={
        state.status === 'ready' && schedules.length > 0 ? (
          <span aria-live="polite">
            {searching
              ? `${String(shown.length)} of ${countLabel(schedules.length, 'schedule')}`
              : countLabel(schedules.length, 'schedule')}
          </span>
        ) : undefined
      }
      footer={
        <>
          <Button onClick={onClose} aria-disabled={busy || undefined}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            aria-disabled={chosen === undefined || undefined}
            onClick={confirm}
            data-testid={`${testId}-confirm`}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="tx-stack">
        {error !== null && error !== undefined && <ErrorNotice error={error} title={errorTitle} />}
        {(state.status === 'loading' || schedules.length > 0) && (
          <SearchField
            className="tx-shared-picker-search"
            label="Search schedules"
            value={query}
            onChange={setQuery}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
            data-autofocus
            data-testid={`${testId}-search`}
          />
        )}
        {state.status === 'loading' && (
          <SkeletonGroup label="Loading schedules" className="tx-shared-picklist">
            <PickRowSkeletons />
          </SkeletonGroup>
        )}
        {state.status === 'error' && (
          <ErrorNotice
            error={state.error}
            title="The schedules could not be loaded"
            onRetry={reload}
          />
        )}
        {state.status === 'ready' && schedules.length === 0 && (
          <EmptyState
            variant="inline"
            level={3}
            icon={CalendarDays}
            title="No schedules yet"
            action={
              <ButtonLink variant="secondary" to="/schedules">
                Go to schedules
              </ButtonLink>
            }
          >
            Create a schedule first, then come back to choose it.
          </EmptyState>
        )}
        {state.status === 'ready' && schedules.length > 0 && (
          <>
            <div
              className="tx-shared-picklist"
              role="radiogroup"
              aria-label="Schedules"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
                  event.preventDefault();
                  confirm();
                }
              }}
            >
              {shown.map((schedule) => (
                <PickRow
                  key={schedule.id}
                  type="radio"
                  name={groupName}
                  value={schedule.id}
                  checked={choice === schedule.id}
                  disabled={busy}
                  media={
                    <span className="tx-shared-pickrow__icon">
                      <Icon icon={CalendarDays} />
                    </span>
                  }
                  title={schedule.name}
                  meta={scheduleSummaryLabel(schedule)}
                  testId={`${testId}-option`}
                  onChange={() => {
                    setChoice(schedule.id);
                  }}
                />
              ))}
            </div>
            {searching && shown.length === 0 && (
              <EmptyState
                variant="inline"
                level={3}
                icon={SearchX}
                title="No schedule matches"
                action={
                  <Button
                    onClick={() => {
                      setQuery('');
                    }}
                  >
                    Clear search
                  </Button>
                }
              >
                Try another name.
              </EmptyState>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
