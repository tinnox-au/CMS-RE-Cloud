import { ABSOLUTE, type PlaylistSummaryDto, type ScheduleDto } from '@tinnox/contracts';
import { useId, useLayoutEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { formatTimestamp } from '../../lib/format.ts';
import { headerStatusLabel } from '../../lib/mediaDetailState.ts';
import { assignedScreensLabel } from '../../lib/playlistsList.ts';
import {
  MAX_SCHEDULE_EVENTS,
  moveEvent,
  newEventDraft,
  NO_SCHEDULE_ERRORS,
  playlistsByName,
  scheduleDraftFromDto,
  scheduleErrorEntries,
  scheduleErrorsFromApi,
  scheduleIsDirty,
  validateScheduleDraft,
  withoutEventError,
  withoutScheduleError,
  type ScheduleDraft,
  type ScheduleErrors,
  type ScheduleEventDraft,
  type ScheduleEventErrors,
} from '../../lib/schedules.ts';
import { useCan, useCanAtMount } from '../../session/AuthenticatedSession.tsx';
import { EditorPage } from '../../shell/EditorPage.tsx';
import { CircleCheck, CircleDashed, Ellipsis, Plus, Trash } from '../../ui/icons.ts';
import {
  Banner,
  Button,
  Card,
  CardHeader,
  ErrorNotice,
  Fact,
  Facts,
  Field,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  Textarea,
  TextInput,
  useToast,
} from '../../ui/index.ts';
import { usePush } from '../push/PushContext.tsx';
import { PlaylistSelect } from '../shared/index.ts';
import { ReadOnlyNote } from '../shared/ReadOnlyNote.tsx';
import { useLeaveGuard } from '../shared/useLeaveGuard.tsx';
import { DeleteScheduleDialog } from './DeleteScheduleDialog.tsx';
import { ScheduleEventRow } from './ScheduleEventRow.tsx';
import './schedules.css';

export const SCHEDULES_BACK = { to: '/schedules', label: 'Schedules' } as const;

export interface ScheduleEditorProps {
  readonly initial: ScheduleDto;
  /** Every playlist of the organisation, for the selects. */
  readonly playlists: readonly PlaylistSummaryDto[];
}

/** The names of the playlists a schedule uses, for a select whose list does not hold one. */
function usedPlaylistNames(schedule: ScheduleDto): ReadonlyMap<string, string> {
  return new Map(
    [schedule.defaultPlaylist, ...schedule.events.map((event) => event.playlist)].map(
      (playlist) => [playlist.id, playlist.name],
    ),
  );
}

/**
 * The editor of one schedule (docs/portal-v2/stage-b.md, slice 3, section 7): the name, the
 * description and the default playlist beside an ordered list of weekly events; Cancel and
 * Save in the header, Delete in its menu. Events are a plain list, not a grid and not a
 * dialog: the order is the priority, and "Move up" and "Move down" change it. The pure rules
 * (what changed, what is sent, the plain-words checks) are in `lib/schedules.ts`; the server
 * stays the authority. Without `content.write` (decided when the page opens) it is read-only:
 * no Cancel or Save, no adding, moving or removing events, nothing submits; Delete stays for a
 * role that holds `content.delete`.
 */
// shortcut: no warning for an event that can never play because events above it cover its times; add a week summary if operators report hidden events.
export function ScheduleEditor({ initial, playlists }: ScheduleEditorProps) {
  const toast = useToast();
  const push = usePush();
  const navigate = useNavigate();
  const baseId = useId();
  const readOnly = !useCanAtMount('content.write');
  const canDelete = useCan('content.delete');

  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<ScheduleDraft>(() => scheduleDraftFromDto(initial));
  const [errors, setErrors] = useState<ScheduleErrors>(NO_SCHEDULE_ERRORS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState<ScheduleDto | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  /** The test id of the control that takes the focus once the list has been drawn again. */
  const focusRequest = useRef<string | null>(null);

  const options = useMemo(() => playlistsByName(playlists), [playlists]);
  const knownNames = useMemo(() => usedPlaylistNames(saved), [saved]);

  const dirty = scheduleIsDirty(saved, draft);
  const guard = useLeaveGuard(dirty && !readOnly, saved.name);
  const locked = saving || readOnly;
  const entries = scheduleErrorEntries(errors, draft);
  const full = draft.events.length >= MAX_SCHEDULE_EVENTS;
  const limitHintId = `${baseId}-limit`;

  const focusControl = (testId: string) => {
    formRef.current?.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus();
  };

  // After an event was added, moved or removed, focus goes where the reader expects it and
  // never falls to the page.
  useLayoutEffect(() => {
    const testId = focusRequest.current;
    if (testId === null) return;
    focusRequest.current = null;
    focusControl(testId);
  });

  const focusSummary = () => {
    // After the summary has rendered.
    window.requestAnimationFrame(() => {
      summaryRef.current?.focus();
    });
  };

  const changeField = (
    field: 'name' | 'description' | 'defaultPlaylistId',
    change: Partial<ScheduleDraft>,
  ) => {
    if (locked) return;
    setDraft({ ...draft, ...change });
    setErrors(withoutScheduleError(errors, field));
  };

  const changeEvent = (
    key: string,
    change: Partial<ScheduleEventDraft>,
    slot: keyof ScheduleEventErrors,
  ) => {
    if (locked) return;
    setDraft({
      ...draft,
      events: draft.events.map((event) => (event.key === key ? { ...event, ...change } : event)),
    });
    setErrors(withoutEventError(errors, key, slot));
  };

  const addEvent = () => {
    if (full || locked) return;
    focusRequest.current = `schedule-event-${String(draft.events.length)}-playlist`;
    setDraft({ ...draft, events: [...draft.events, newEventDraft(crypto.randomUUID())] });
  };

  const moveEventBy = (index: number, delta: -1 | 1) => {
    const events = moveEvent(draft.events, index, delta);
    if (events === draft.events || locked) return;
    // The same button of the same event, at its new place.
    focusRequest.current = `schedule-event-${String(index + delta)}-${delta < 0 ? 'up' : 'down'}`;
    setDraft({ ...draft, events });
  };

  const removeEvent = (index: number) => {
    if (locked) return;
    const left = draft.events.length - 1;
    // The event that takes its place, else the one before it, else "Add event".
    focusRequest.current =
      left === 0
        ? 'schedule-add-event'
        : `schedule-event-${String(Math.min(index, left - 1))}-remove`;
    setDraft({ ...draft, events: draft.events.filter((_, at) => at !== index) });
  };

  const save = () => {
    if (readOnly || saving || !dirty) return;
    const result = validateScheduleDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      setSaveError(null);
      focusSummary();
      return;
    }
    setErrors(NO_SCHEDULE_ERRORS);
    setSaving(true);
    setSaveError(null);
    const sentFrom = draft;
    api.replaceSchedule(saved.id, result.value).then(
      (schedule) => {
        setSaved(schedule);
        // The rows keep their keys, so the list is not built again.
        setDraft(
          scheduleDraftFromDto(
            schedule,
            sentFrom.events.map((event) => event.key),
          ),
        );
        setSaving(false);
        toast.success('Schedule saved', {
          detail: 'Screens that use it show Changes waiting until you push.',
        });
        push.refresh();
      },
      (error: unknown) => {
        setSaving(false);
        setSaveError(error);
        if (
          isApiRequestError(error) &&
          error.code === 'validation_failed' &&
          error.details.length > 0
        ) {
          setErrors(scheduleErrorsFromApi(error.details, sentFrom));
          focusSummary();
        }
      },
    );
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (readOnly || saving) return;
    save();
  };

  return (
    <EditorPage
      title={draft.name.trim() === '' ? saved.name : draft.name.trim()}
      back={SCHEDULES_BACK}
      status={
        readOnly ? undefined : (
          <span className="tx-schedule-editor-status" data-state={dirty ? 'unsaved' : 'saved'}>
            <Icon icon={dirty ? CircleDashed : CircleCheck} size={16} />
            <span role="status" data-testid="schedule-save-state" data-dirty={dirty}>
              {headerStatusLabel(dirty)}
            </span>
          </span>
        )
      }
      actions={
        readOnly && !canDelete ? undefined : (
          <>
            {!readOnly && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void navigate('/schedules');
                  }}
                  data-testid="schedule-cancel"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  busy={saving}
                  aria-disabled={!dirty || undefined}
                  onClick={save}
                  data-testid="schedule-save"
                >
                  Save
                </Button>
              </>
            )}
            {canDelete && (
              <Menu
                placement="bottom-end"
                trigger={(props) => (
                  <IconButton
                    {...props}
                    icon={Ellipsis}
                    label={`More actions for ${saved.name}`}
                    data-testid="schedule-menu"
                  />
                )}
              >
                <MenuItem
                  icon={Trash}
                  tone="danger"
                  onSelect={() => {
                    setDeleting(saved);
                  }}
                >
                  Delete schedule
                </MenuItem>
              </Menu>
            )}
          </>
        )
      }
    >
      <form
        ref={formRef}
        noValidate
        className="tx-schedule-editor"
        onSubmit={submit}
        aria-busy={saving || undefined}
        data-testid="schedule-editor"
      >
        {readOnly && <ReadOnlyNote>You can view this schedule. Editors make changes.</ReadOnlyNote>}
        {saveError !== null && (
          <ErrorNotice
            error={saveError}
            title="The changes were not saved"
            onDismiss={() => {
              setSaveError(null);
            }}
          />
        )}
        {entries.length > 0 && (
          <div
            ref={summaryRef}
            tabIndex={-1}
            className="tx-schedule-editor-summary"
            data-testid="schedule-error-summary"
          >
            <Banner
              tone="danger"
              live="assertive"
              title={
                entries.length === 1
                  ? 'One field needs a change before saving'
                  : `${String(entries.length)} fields need a change before saving`
              }
            >
              <ul>
                {entries.map((entry) => (
                  <li key={entry.id}>
                    {entry.target === null ? (
                      entry.text
                    ) : (
                      <a
                        href={`#${entry.target}`}
                        onClick={(event) => {
                          event.preventDefault();
                          if (entry.target !== null) focusControl(entry.target);
                        }}
                      >
                        {entry.text}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Banner>
          </div>
        )}

        <div className="tx-editor">
          <div className="tx-schedule-editor__side">
            <Card as="section" aria-labelledby={`${baseId}-details`}>
              <CardHeader id={`${baseId}-details`} title="Details" size="title" />
              <div className="tx-schedule-editor__fields">
                <Field label="Name" error={errors.name} required>
                  {(control) => (
                    <TextInput
                      {...control}
                      width="full"
                      value={draft.name}
                      maxLength={ABSOLUTE.maxNameLength}
                      autoComplete="off"
                      readOnly={locked}
                      data-testid="schedule-name"
                      onChange={(event) => {
                        changeField('name', { name: event.target.value });
                      }}
                    />
                  )}
                </Field>
                <Field
                  label="Description"
                  optional
                  error={errors.description}
                  hint="A note for your team. Screens never show it."
                >
                  {(control) => (
                    <Textarea
                      {...control}
                      rows={3}
                      value={draft.description}
                      maxLength={ABSOLUTE.maxDescriptionLength}
                      readOnly={locked}
                      data-testid="schedule-description"
                      onChange={(event) => {
                        changeField('description', { description: event.target.value });
                      }}
                    />
                  )}
                </Field>
                <Facts className="tx-schedule-editor-facts">
                  <Fact label="Screens" testId="schedule-fact-screens">
                    {assignedScreensLabel(saved.assignedDisplayCount)}
                  </Fact>
                  <Fact label="Created">{formatTimestamp(saved.createdAt)}</Fact>
                  <Fact label="Updated">{formatTimestamp(saved.updatedAt)}</Fact>
                </Facts>
              </div>
            </Card>

            <Card as="section" aria-labelledby={`${baseId}-default`}>
              <CardHeader id={`${baseId}-default`} title="Default playlist" size="title" />
              <Field
                label="Default playlist"
                error={errors.defaultPlaylistId}
                // The advice is for whoever changes the playlist; read-only, only the fact stays.
                hint={
                  readOnly
                    ? 'Plays whenever no event applies.'
                    : 'Plays whenever no event applies. Keep at least one item in it that has no availability window, so the screen is never empty.'
                }
                required
              >
                {(control) => (
                  <PlaylistSelect
                    control={control}
                    value={draft.defaultPlaylistId}
                    playlists={options}
                    knownNames={knownNames}
                    disabled={locked}
                    testId="schedule-default-playlist"
                    openTestId="schedule-default-open"
                    onChange={(defaultPlaylistId) => {
                      changeField('defaultPlaylistId', { defaultPlaylistId });
                    }}
                  />
                )}
              </Field>
            </Card>
          </div>

          <Card as="section" aria-labelledby={`${baseId}-events`}>
            <CardHeader id={`${baseId}-events`} title="Events" size="title" />
            <div className="tx-schedule-editor__help">
              <p>
                Events are checked from the top. When two events overlap, the higher one plays. If
                its playlist has nothing to show at that moment, the next event that applies plays.
                When no event applies, the default playlist plays.
              </p>
              <p>
                Times follow each screen&rsquo;s site time zone. Images and apps change on the
                minute; a video finishes first. Nothing plays outside a screen&rsquo;s working
                hours.
              </p>
              <p>
                Screens need player 0.4.0 or later to play events. Reload the player page on each
                screen after this update; until then an older player keeps its last content and the
                screen&rsquo;s page says so.
              </p>
            </div>
            {draft.events.length === 0 ? (
              <p className="tx-schedule-editor__none" data-testid="schedule-no-events">
                No events yet. The default playlist plays all the time.
              </p>
            ) : (
              <ol className="tx-schedule-events" aria-label="Events, highest priority first">
                {draft.events.map((event, index) => (
                  <ScheduleEventRow
                    key={event.key}
                    index={index}
                    count={draft.events.length}
                    event={event}
                    errors={errors.events.get(event.key)}
                    playlists={options}
                    knownNames={knownNames}
                    disabled={locked}
                    readOnly={readOnly}
                    onChange={(change, slot) => {
                      changeEvent(event.key, change, slot);
                    }}
                    onMove={(delta) => {
                      moveEventBy(index, delta);
                    }}
                    onRemove={() => {
                      removeEvent(index);
                    }}
                  />
                ))}
              </ol>
            )}
            {!readOnly && (
              <div className="tx-schedule-editor__add">
                <Button
                  icon={Plus}
                  aria-disabled={full || saving || undefined}
                  aria-describedby={full ? limitHintId : undefined}
                  onClick={addEvent}
                  data-testid="schedule-add-event"
                >
                  Add event
                </Button>
                {full && (
                  <p id={limitHintId} className="tx-field__hint">
                    A schedule holds at most {MAX_SCHEDULE_EVENTS} events. Remove one to add
                    another.
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      </form>
      {guard.dialog}
      <DeleteScheduleDialog
        schedule={deleting}
        onClose={() => {
          setDeleting(null);
        }}
        onDeleted={(schedule) => {
          guard.release();
          void navigate('/schedules');
          toast.success(`${schedule.name} deleted`);
        }}
      />
    </EditorPage>
  );
}
