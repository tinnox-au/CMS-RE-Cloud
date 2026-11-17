import type { PlaylistSummaryDto } from '@tinnox/contracts';
import { WEEKDAYS } from '../../lib/screenDetail.ts';
import {
  endsNextDay,
  type ScheduleEventDraft,
  type ScheduleEventErrors,
} from '../../lib/schedules.ts';
import { ArrowDown, ArrowUp, CircleExclamationPoint, ExternalLink, Trash } from '../../ui/icons.ts';
import {
  ButtonLink,
  Checkbox,
  Field,
  Icon,
  IconButton,
  Select,
  TextInput,
  type FieldControlProps,
} from '../../ui/index.ts';
import './schedules.css';

export interface PlaylistSelectProps {
  /** The ids and ARIA attributes a `Field` hands to its control. */
  readonly control: FieldControlProps;
  /** The chosen playlist id; '' while none is chosen. */
  readonly value: string;
  /** Every playlist, by name. */
  readonly playlists: readonly PlaylistSummaryDto[];
  /** Names of playlists the schedule uses, for one that is not in `playlists`. */
  readonly knownNames: ReadonlyMap<string, string>;
  readonly disabled: boolean;
  readonly testId: string;
  /** The "Open playlist" link's test id. */
  readonly openTestId: string;
  readonly onChange: (playlistId: string) => void;
}

/**
 * A native select of every playlist with, beside it, a link to the chosen one. The link is
 * how an operator reaches the playlist a push issue names; the leave guard covers unsaved
 * changes.
 */
// shortcut: native selects list every playlist; switch to PlaylistPickerDialog when organisations have hundreds of playlists.
export function PlaylistSelect({
  control,
  value,
  playlists,
  knownNames,
  disabled,
  testId,
  openTestId,
  onChange,
}: PlaylistSelectProps) {
  const listed = value === '' || playlists.some((playlist) => playlist.id === value);
  return (
    <div className="tx-schedule-pick">
      <Select
        {...control}
        value={value}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <option value="">Choose a playlist</option>
        {/* The list is capped; a playlist the schedule already uses stays choosable. */}
        {!listed && <option value={value}>{knownNames.get(value) ?? 'Unknown playlist'}</option>}
        {playlists.map((playlist) => (
          <option key={playlist.id} value={playlist.id}>
            {playlist.name}
          </option>
        ))}
      </Select>
      {value !== '' && (
        <ButtonLink
          size="sm"
          variant="ghost"
          icon={ExternalLink}
          to={`/playlists/${value}`}
          data-testid={openTestId}
        >
          Open playlist
        </ButtonLink>
      )}
    </div>
  );
}

export interface ScheduleEventRowProps {
  /** Position in the list, from 0. The event reads "Event {index + 1}". */
  readonly index: number;
  /** How many events the list holds. */
  readonly count: number;
  readonly event: ScheduleEventDraft;
  readonly errors: ScheduleEventErrors | undefined;
  readonly playlists: readonly PlaylistSummaryDto[];
  readonly knownNames: ReadonlyMap<string, string>;
  /** A save is running: nothing can be changed. */
  readonly disabled: boolean;
  /** `slot` is the message the change makes stale. */
  readonly onChange: (change: Partial<ScheduleEventDraft>, slot: keyof ScheduleEventErrors) => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onRemove: () => void;
}

function ErrorText({ id, message }: { readonly id: string; readonly message: string }) {
  return (
    <p id={id} className="tx-field__error">
      <Icon icon={CircleExclamationPoint} size={16} />
      <span>{message}</span>
    </p>
  );
}

/**
 * One weekly event of the schedule editor: a fieldset named "Event N", so every control in it
 * has a name of its own however many events the page holds. In tab order: the playlist and
 * the link to it, the days, start and end, then move up, move down and remove.
 */
export function ScheduleEventRow({
  index,
  count,
  event,
  errors,
  playlists,
  knownNames,
  disabled,
  onChange,
  onMove,
  onRemove,
}: ScheduleEventRowProps) {
  const number = index + 1;
  const testId = `schedule-event-${String(index)}`;
  // The key is unique on the page and stays with the event when it moves.
  const daysErrorId = `${testId}-${event.key}-days-error`;
  const timeErrorId = `${testId}-${event.key}-time-error`;
  const nextDayId = `${testId}-${event.key}-next-day`;
  const nextDay = endsNextDay(event);
  const timeInvalid = errors?.time !== undefined || undefined;
  return (
    <li className="tx-schedule-event">
      <fieldset className="tx-schedule-event__fields" data-testid={testId}>
        <legend className="tx-schedule-event__legend">Event {number}</legend>

        <Field label="Playlist" error={errors?.playlistId}>
          {(control) => (
            <PlaylistSelect
              control={control}
              value={event.playlistId}
              playlists={playlists}
              knownNames={knownNames}
              disabled={disabled}
              testId={`${testId}-playlist`}
              openTestId={`${testId}-open`}
              onChange={(playlistId) => {
                onChange({ playlistId }, 'playlistId');
              }}
            />
          )}
        </Field>

        <fieldset className="tx-field tx-schedule-event__days">
          <legend className="tx-field__label">Days</legend>
          <div className="tx-field-group__controls">
            {WEEKDAYS.map((name, day) => (
              <Checkbox
                key={name}
                // The short form is what is seen; the full name is what is read out.
                label={
                  <>
                    <span aria-hidden="true">{name.slice(0, 3)}</span>
                    <span className="tx-visually-hidden">{name}</span>
                  </>
                }
                checked={event.days[day] === true}
                disabled={disabled}
                aria-invalid={errors?.days !== undefined || undefined}
                aria-describedby={errors?.days !== undefined ? daysErrorId : undefined}
                data-testid={`${testId}-day-${String(day)}`}
                onChange={(checked) => {
                  onChange(
                    { days: event.days.map((on, at) => (at === day ? checked : on)) },
                    'days',
                  );
                }}
              />
            ))}
          </div>
          {errors?.days !== undefined && <ErrorText id={daysErrorId} message={errors.days} />}
        </fieldset>

        <div className="tx-schedule-event__row">
          <div className="tx-schedule-event__times">
            <Field label="Start">
              {(control) => (
                <TextInput
                  {...control}
                  aria-invalid={timeInvalid}
                  type="time"
                  width="sm"
                  value={event.start}
                  readOnly={disabled}
                  aria-describedby={errors?.time !== undefined ? timeErrorId : undefined}
                  data-testid={`${testId}-start`}
                  onChange={(change) => {
                    onChange({ start: change.target.value }, 'time');
                  }}
                />
              )}
            </Field>
            <Field label="End">
              {(control) => (
                <TextInput
                  {...control}
                  aria-invalid={timeInvalid}
                  type="time"
                  width="sm"
                  value={event.end}
                  readOnly={disabled}
                  aria-describedby={
                    errors?.time !== undefined ? timeErrorId : nextDay ? nextDayId : undefined
                  }
                  data-testid={`${testId}-end`}
                  onChange={(change) => {
                    onChange({ end: change.target.value }, 'time');
                  }}
                />
              )}
            </Field>
          </div>
          <div className="tx-schedule-event__actions">
            <IconButton
              icon={ArrowUp}
              label={`Move event ${String(number)} up`}
              aria-disabled={index === 0 || disabled || undefined}
              data-testid={`${testId}-up`}
              onClick={() => {
                onMove(-1);
              }}
            />
            <IconButton
              icon={ArrowDown}
              label={`Move event ${String(number)} down`}
              aria-disabled={index === count - 1 || disabled || undefined}
              data-testid={`${testId}-down`}
              onClick={() => {
                onMove(1);
              }}
            />
            <IconButton
              icon={Trash}
              label={`Remove event ${String(number)}`}
              aria-disabled={disabled || undefined}
              data-testid={`${testId}-remove`}
              onClick={onRemove}
            />
          </div>
        </div>
        {nextDay && (
          <p id={nextDayId} className="tx-field__hint" data-testid={`${testId}-next-day`}>
            Ends the next day.
          </p>
        )}
        {/* 00:00 to 00:00 is the whole day; a time field cannot say so by itself. */}
        {event.start === '00:00' && event.end === '00:00' && (
          <p className="tx-field__hint" data-testid={`${testId}-all-day`}>
            The whole day.
          </p>
        )}
        {errors?.time !== undefined && <ErrorText id={timeErrorId} message={errors.time} />}
      </fieldset>
    </li>
  );
}
