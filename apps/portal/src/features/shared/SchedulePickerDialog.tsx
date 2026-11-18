import type { ScheduleSummaryDto } from '@tinnox/contracts';
import { api } from '../../api/index.ts';
import { scheduleSummaryLabel } from '../../lib/schedules.ts';
import { CalendarDays } from '../../ui/icons.ts';
import { LibraryPickerDialog, type LibraryPickerProps } from './LibraryPickerDialog.tsx';

/**
 * Defaults: title "Choose a schedule", confirmLabel "Choose schedule", testId
 * `shared-schedule-picker`, errorTitle "The change was not saved".
 */
export type SchedulePickerDialogProps = LibraryPickerProps<ScheduleSummaryDto>;

function loadSchedules(signal: AbortSignal): Promise<ScheduleSummaryDto[]> {
  return api.listSchedules(signal);
}

function scheduleSearchTexts(schedule: ScheduleSummaryDto): readonly (string | null)[] {
  return [schedule.name, schedule.description, schedule.defaultPlaylist.name];
}

const SCHEDULES = { singular: 'schedule', plural: 'schedules', href: '/schedules' } as const;

/**
 * Chooses one schedule: a searchable list with each schedule's default playlist and number
 * of events. The list is loaded afresh each time the dialog opens. There is no "none" here:
 * content is removed from a screen on the screen's page.
 */
export function SchedulePickerDialog({
  title = 'Choose a schedule',
  confirmLabel = 'Choose schedule',
  testId = 'shared-schedule-picker',
  ...props
}: SchedulePickerDialogProps) {
  return (
    <LibraryPickerDialog
      {...props}
      title={title}
      confirmLabel={confirmLabel}
      testId={testId}
      load={loadSchedules}
      meta={scheduleSummaryLabel}
      searchTexts={scheduleSearchTexts}
      icon={CalendarDays}
      noun={SCHEDULES}
    />
  );
}
