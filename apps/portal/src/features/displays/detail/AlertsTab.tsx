import { alertDelayText, type DisplayDto } from '@tinnox/contracts';
import { Link } from 'react-router-dom';
import { api } from '../../../api/index.ts';
import { ALERT_DELAY_PRESETS, alertsDirty, type AlertsDraft } from '../../../lib/screenDetail.ts';
import { useCan } from '../../../session/AuthenticatedSession.tsx';
import { Button, Checkbox, ErrorNotice, Field, Select, useToast } from '../../../ui/index.ts';
import { ReadOnlyNote } from '../../shared/ReadOnlyNote.tsx';
import type { SectionSave } from './types.ts';

export interface AlertsTabProps {
  readonly display: DisplayDto;
  /** The settings as edited; null while they are as stored. Kept by the page across tabs. */
  readonly draft: AlertsDraft | null;
  readonly onDraft: (draft: AlertsDraft | null) => void;
  readonly onSaved: (display: DisplayDto) => void;
  /** Kept by the page so a save outlives the tab (FCX-03). */
  readonly save: SectionSave;
  /** The role may not change alerts (`screen.alerts`): the settings are shown and nothing is sent. */
  readonly readOnly: boolean;
}

/**
 * When to e-mail the organisation's alert addresses about this screen. Alerts change nothing on
 * the player, so a save does not refresh the push state.
 */
export function AlertsTab({
  display,
  draft,
  onDraft,
  onSaved,
  save: saveState,
  readOnly,
}: AlertsTabProps) {
  const toast = useToast();
  const canManageAddresses = useCan('alerts.manage');
  const value = draft ?? {
    alertOfflineMinutes: display.alertOfflineMinutes,
    alertBackOnline: display.alertBackOnline,
  };
  const dirty = draft !== null && alertsDirty(draft, display);
  const { saving, error: saveError, setSaving, setError: setSaveError } = saveState;
  const locked = saving || readOnly;
  const minutes = value.alertOfflineMinutes;
  // A delay set through the API that is not a preset still shows as it is, and stays a choice
  // after another one is picked.
  const delays = [
    ...new Set<number>([
      ...ALERT_DELAY_PRESETS,
      ...[display.alertOfflineMinutes, minutes].filter((m) => m !== null),
    ]),
  ].sort((a, b) => a - b);

  const change = (next: AlertsDraft) => {
    if (!locked) onDraft(next);
  };

  const save = () => {
    if (readOnly || saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    api
      .patchDisplay(display.id, value)
      .then((saved) => {
        setSaving(false);
        onDraft(null);
        onSaved(saved);
        toast.success('Alerts saved');
      })
      .catch((error: unknown) => {
        setSaving(false);
        setSaveError(error);
      });
  };

  return (
    <div className="tx-screen-detail-alerts" data-testid="screen-detail-alerts">
      {readOnly && <ReadOnlyNote>Editors change this screen’s alerts.</ReadOnlyNote>}
      <p className="tx-screen-detail-note">
        Alerts go to every confirmed address on the organisation’s alert list.{' '}
        {canManageAddresses ? (
          <Link to="/settings/alerts" data-testid="screen-detail-alerts-addresses">
            Alert addresses
          </Link>
        ) : (
          'An Admin or Owner chooses who receives them.'
        )}
      </p>
      {saveError !== null && (
        <ErrorNotice
          error={saveError}
          title="The alerts were not saved"
          onDismiss={() => {
            setSaveError(null);
          }}
        />
      )}
      <Field
        label="E-mail when this screen stops reporting"
        hint="The delay counts only time inside the screen’s working hours; closed hours pause it."
      >
        {(control) => (
          <Select
            {...control}
            width="md"
            value={minutes === null ? 'off' : String(minutes)}
            disabled={locked}
            data-testid="screen-detail-alert-delay"
            onChange={(event) => {
              const next = event.target.value;
              change({ ...value, alertOfflineMinutes: next === 'off' ? null : Number(next) });
            }}
          >
            <option value="off">Off</option>
            {delays.map((delay) => (
              <option key={delay} value={String(delay)}>
                {alertDelayText(delay)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {minutes !== null && (
        <Checkbox
          label="Also e-mail when it reports again"
          checked={value.alertBackOnline}
          disabled={locked}
          data-testid="screen-detail-alert-back"
          onChange={(alertBackOnline) => {
            change({ ...value, alertBackOnline });
          }}
        />
      )}
      {!readOnly && (
        <div className="tx-screen-detail-form__actions">
          <Button
            variant="primary"
            busy={saving}
            aria-disabled={!dirty || undefined}
            onClick={save}
            data-testid="screen-detail-alerts-save"
          >
            Save alerts
          </Button>
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                onDraft(null);
                setSaveError(null);
              }}
            >
              Discard changes
            </Button>
          )}
          {dirty && <span className="tx-screen-detail-unsaved">Unsaved changes</span>}
        </div>
      )}
    </div>
  );
}
