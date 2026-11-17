import type { DisplayDto, SiteDto } from '@tinnox/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../api/index.ts';
import {
  validateWorkingHours,
  WEEKDAYS,
  workingHoursDirty,
  workingHoursDraftOf,
  type WorkingDayDraft,
  type WorkingHoursDraft,
} from '../../../lib/screenDetail.ts';
import { CircleExclamationPoint } from '../../../ui/icons.ts';
import {
  Button,
  Checkbox,
  ErrorNotice,
  FieldGroup,
  Icon,
  Switch,
  TextInput,
  useToast,
} from '../../../ui/index.ts';
import { usePush } from '../../push/PushContext.tsx';
import type { SectionSave } from './types.ts';

const FORM_ERROR_ID = 'screen-detail-hours-form-error';

export interface WorkingHoursTabProps {
  readonly display: DisplayDto;
  /** Null when the screen's site is not among the organisation's sites. */
  readonly site: SiteDto | null;
  /** The hours as edited; null while they are as stored. Kept by the page across tabs. */
  readonly draft: WorkingHoursDraft | null;
  readonly onDraft: (draft: WorkingHoursDraft | null) => void;
  readonly onSaved: (display: DisplayDto) => void;
  /** Kept by the page so a save outlives the tab (FCX-03). */
  readonly save: SectionSave;
}

/** When the screen shows content: always, or on chosen days between two times. */
export function WorkingHoursTab({
  display,
  site,
  draft,
  onDraft,
  onSaved,
  save: saveState,
}: WorkingHoursTabProps) {
  const toast = useToast();
  const push = usePush();
  const value = draft ?? workingHoursDraftOf(display.workingHours);
  const dirty = draft !== null && workingHoursDirty(draft, display.workingHours);
  const [attempted, setAttempted] = useState(false);
  const { saving, error: saveError, setSaving, setError: setSaveError } = saveState;
  const rootRef = useRef<HTMLDivElement>(null);
  const result = validateWorkingHours(value);
  const errors = attempted && !result.ok ? result.errors : null;
  const formError = errors?.form ?? null;

  const change = (next: WorkingHoursDraft) => {
    if (!saving) onDraft(next);
  };
  const changeDay = (index: number, day: Partial<WorkingDayDraft>) => {
    change({
      ...value,
      days: value.days.map((current, at) => (at === index ? { ...current, ...day } : current)),
    });
  };

  const save = () => {
    if (saving || !dirty) return;
    setAttempted(true);
    if (!result.ok) {
      // Once the messages have rendered, take focus to the first problem so it is read.
      window.requestAnimationFrame(() => {
        const root = rootRef.current;
        (
          root?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
          root?.querySelector<HTMLElement>('.tx-screen-detail-hours__day input')
        )?.focus();
      });
      return;
    }
    setSaving(true);
    setSaveError(null);
    api
      .patchDisplay(display.id, { workingHours: result.value })
      .then((saved) => {
        setSaving(false);
        setAttempted(false);
        onDraft(null);
        onSaved(saved);
        toast.success('Working hours saved');
        push.refresh();
      })
      .catch((error: unknown) => {
        setSaving(false);
        setSaveError(error);
      });
  };

  return (
    <div ref={rootRef} className="tx-screen-detail-hours" data-testid="screen-detail-working-hours">
      {saveError !== null && (
        <ErrorNotice
          error={saveError}
          title="The working hours were not saved"
          onDismiss={() => {
            setSaveError(null);
          }}
        />
      )}
      <Switch
        label="Always on"
        checked={value.alwaysOn}
        data-testid="screen-detail-always-on"
        onChange={(alwaysOn) => {
          change({ ...value, alwaysOn });
        }}
      />
      {!value.alwaysOn && (
        <FieldGroup
          legend="Hours"
          hint={`Times are in ${site?.timezone ?? "the screen's site time zone"}. Outside these hours the screen shows black.`}
        >
          {WEEKDAYS.map((name, index) => {
            const day = value.days[index];
            if (day === undefined) return null;
            const error = errors?.days[index] ?? null;
            const errorId = `screen-detail-hours-${String(index)}-error`;
            return (
              <div key={name} className="tx-screen-detail-hours__day">
                <Checkbox
                  label={name}
                  checked={day.open}
                  // Save focuses Monday when no day is chosen; this makes the message read.
                  aria-describedby={index === 0 && formError !== null ? FORM_ERROR_ID : undefined}
                  onChange={(open) => {
                    changeDay(index, { open });
                  }}
                />
                <div className="tx-screen-detail-pair">
                  <TextInput
                    type="time"
                    width="sm"
                    aria-label={`${name} start`}
                    value={day.start}
                    disabled={!day.open}
                    readOnly={saving}
                    aria-invalid={error !== null || undefined}
                    aria-describedby={error === null ? undefined : errorId}
                    onChange={(event) => {
                      changeDay(index, { start: event.target.value });
                    }}
                  />
                  <TextInput
                    type="time"
                    width="sm"
                    aria-label={`${name} end`}
                    value={day.end}
                    disabled={!day.open}
                    readOnly={saving}
                    aria-invalid={error !== null || undefined}
                    aria-describedby={error === null ? undefined : errorId}
                    onChange={(event) => {
                      changeDay(index, { end: event.target.value });
                    }}
                  />
                </div>
                {error !== null && (
                  <p id={errorId} className="tx-field__error">
                    <Icon icon={CircleExclamationPoint} size={16} />
                    <span>{error}</span>
                  </p>
                )}
              </div>
            );
          })}
          {formError !== null && (
            <p id={FORM_ERROR_ID} className="tx-field__error">
              <Icon icon={CircleExclamationPoint} size={16} />
              <span>{formError}</span>
            </p>
          )}
        </FieldGroup>
      )}
      <div className="tx-screen-detail-form__actions">
        <Button
          variant="primary"
          busy={saving}
          aria-disabled={!dirty || undefined}
          onClick={save}
          data-testid="screen-detail-working-hours-save"
        >
          Save working hours
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => {
              onDraft(null);
              setAttempted(false);
              setSaveError(null);
            }}
          >
            Discard changes
          </Button>
        )}
        {dirty && <span className="tx-screen-detail-unsaved">Unsaved changes</span>}
      </div>
    </div>
  );
}
