import type { DeliveryStatusView, DisplayDto } from '@tinnox/contracts';
import { useId, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api/index.ts';
import { isAbort, isApiRequestError } from '../../api/client.ts';
import { assignedContent } from '../../lib/assignedContent.ts';
import { countOf } from '../../lib/bulkOutcome.ts';
import { matchesSearch } from '../../lib/listView.ts';
import { setMany, summariseSelection, toggleOne } from '../../lib/selection.ts';
import { Monitor, SearchX } from '../../ui/icons.ts';
import {
  Banner,
  Button,
  ButtonLink,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorNotice,
  Icon,
  SearchField,
  SkeletonGroup,
} from '../../ui/index.ts';
import { PickRow, PickRowSkeletons } from './PickRow.tsx';
import { ScreenStatusPill } from './ScreenStatusPill.tsx';
import './shared.css';
import { useLoadWhileOpen } from './useLoadWhileOpen.ts';
import { useSettledFocus } from './useSettledFocus.ts';

export interface ScreenPickerDialogProps {
  readonly open: boolean;
  /** Cancel, Escape and the close button. The caller also closes it after a successful save. */
  readonly onClose: () => void;
  /**
   * The primary button, with the chosen screens (one with `multiple` off). The dialog does
   * not save and does not close itself: do the work, show `busy` meanwhile, then close it,
   * or pass what went wrong as `error`.
   */
  readonly onConfirm: (displays: readonly DisplayDto[]) => void;
  /** Any number of screens (checkboxes) instead of one (radio buttons). Default false. */
  readonly multiple?: boolean;
  /** Default "Choose a screen" or "Choose screens". */
  readonly title?: string;
  /**
   * A function gets the screens that are chosen now, for a sentence that depends on them:
   * "A screen that has a schedule or a layout gets this playlist instead."
   */
  readonly description?: ReactNode | ((chosen: readonly DisplayDto[]) => ReactNode);
  /**
   * Default "Choose screen" or "Choose N screens". A function gets the number chosen:
   * `(count) => \`Assign to ${count} screens\``.
   */
  readonly confirmLabel?: string | ((count: number) => string);
  /** Display ids that are ticked when the dialog opens. */
  readonly initialSelectedIds?: readonly string[];
  /** A reason a screen cannot be chosen here, or null. The row is shown but disabled. */
  readonly disabledReason?: (display: DisplayDto) => string | null;
  /** The caller is saving: the dialog cannot be dismissed and the button shows it. */
  readonly busy?: boolean;
  /** What the caller's save threw. Shown in the dialog with the API error code. */
  readonly error?: unknown;
  /** Title of that error: "The playlist was not assigned". */
  readonly errorTitle?: string;
  /** Default `shared-screen-picker`. */
  readonly testId?: string;
}

interface ScreensData {
  readonly displays: readonly DisplayDto[];
  /** Null when the statuses could not be read; the screens are still listed. */
  readonly statusById: ReadonlyMap<string, DeliveryStatusView> | null;
  readonly statusError: unknown;
}

async function loadScreens(signal: AbortSignal): Promise<ScreensData> {
  const statuses = api.listDisplayStatuses(signal).then(
    (items) => ({ items, error: null as unknown }),
    (error: unknown) => ({ items: null, error }),
  );
  const displays = await api.listDisplays(signal);
  const status = await statuses;
  if (status.items === null) {
    if (isAbort(status.error)) throw status.error;
    return { displays, statusById: null, statusError: status.error };
  }
  return {
    displays,
    statusById: new Map(status.items.map((view) => [view.displayId, view])),
    statusError: null,
  };
}

/** "Assigned: Reception loop", "Assigned: schedule Weekdays", "Assigned: layout Foyer band". */
function contentLabel(display: DisplayDto): string {
  const content = assignedContent(display);
  if (content === null) return 'Nothing assigned';
  return content.kind === 'playlist'
    ? `Assigned: ${content.name}`
    : `Assigned: ${content.kind} ${content.name}`;
}

/**
 * Chooses one screen or several: a searchable list with each screen's status pill (what its
 * player last reported, and when) and the playlist, schedule or layout assigned to it. Screens and statuses are
 * loaded afresh each time the dialog opens. If only the statuses cannot be read, the screens
 * are still listed and a notice says so.
 */
export function ScreenPickerDialog({
  open,
  onClose,
  onConfirm,
  multiple = false,
  title,
  description,
  confirmLabel,
  initialSelectedIds,
  disabledReason,
  busy = false,
  error = null,
  errorTitle = 'The change was not saved',
  testId = 'shared-screen-picker',
}: ScreenPickerDialogProps) {
  const groupName = useId();
  const { state, reload } = useLoadWhileOpen(open, loadScreens);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(initialSelectedIds ?? []),
  );
  const [query, setQuery] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected(new Set(initialSelectedIds ?? []));
      setQuery('');
    }
  }

  const bodyRef = useRef<HTMLDivElement>(null);
  useSettledFocus(bodyRef, state.status);

  const displays = state.status === 'ready' ? state.data.displays : [];
  const reasonFor = (display: DisplayDto) => disabledReason?.(display) ?? null;
  const shown = displays.filter((display) =>
    matchesSearch(
      [
        display.name,
        display.assignedPlaylist?.name,
        display.assignedSchedule?.name,
        display.assignedLayout?.name,
        display.description,
      ],
      query,
    ),
  );
  // Only screens that still exist and may be chosen count, whatever was ticked before.
  const chosen = displays.filter(
    (display) => selected.has(display.id) && reasonFor(display) === null,
  );
  const selectableShownIds = shown.filter((d) => reasonFor(d) === null).map((d) => d.id);
  const shownSummary = summariseSelection(selectableShownIds, selected);
  const canConfirm = state.status === 'ready' && chosen.length > 0;
  const searching = query.trim() !== '';

  const confirm = () => {
    if (!canConfirm || busy) return;
    onConfirm(chosen);
  };

  let label: string;
  if (typeof confirmLabel === 'function') label = confirmLabel(chosen.length);
  else if (confirmLabel !== undefined) label = confirmLabel;
  else if (!multiple) label = 'Choose screen';
  else
    label = chosen.length === 0 ? 'Choose screens' : `Choose ${countOf(chosen.length, 'screen')}`;

  return (
    <Dialog
      testId={testId}
      open={open}
      onClose={onClose}
      title={title ?? (multiple ? 'Choose screens' : 'Choose a screen')}
      description={typeof description === 'function' ? description(chosen) : description}
      size="md"
      busy={busy}
      footerStart={
        multiple && state.status === 'ready' && displays.length > 0 ? (
          <span aria-live="polite" data-testid={`${testId}-count`}>
            {chosen.length} of {countOf(displays.length, 'screen')} chosen
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
            aria-disabled={!canConfirm || undefined}
            onClick={confirm}
            data-testid={`${testId}-confirm`}
          >
            {label}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="tx-stack">
        {error !== null && error !== undefined && <ErrorNotice error={error} title={errorTitle} />}
        {(state.status === 'loading' || displays.length > 0) && (
          <SearchField
            className="tx-shared-picker-search"
            label="Search screens"
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
          <SkeletonGroup label="Loading screens" className="tx-shared-picklist">
            <PickRowSkeletons />
          </SkeletonGroup>
        )}
        {state.status === 'error' && (
          <ErrorNotice
            error={state.error}
            title="The screens could not be loaded"
            onRetry={reload}
          />
        )}
        {state.status === 'ready' && displays.length === 0 && (
          <EmptyState
            variant="inline"
            level={3}
            icon={Monitor}
            title="No screens yet"
            action={
              <ButtonLink variant="secondary" to="/screens/new">
                Add screen
              </ButtonLink>
            }
          >
            Add a screen first, then come back to choose it.
          </EmptyState>
        )}
        {state.status === 'ready' && displays.length > 0 && (
          <>
            {state.data.statusById === null && (
              <Banner
                tone="warn"
                title="The status of the screens could not be loaded"
                actions={
                  <Button size="sm" onClick={reload}>
                    Try again
                  </Button>
                }
              >
                <ErrorText error={state.data.statusError} /> You can still choose a screen.
              </Banner>
            )}
            {multiple && selectableShownIds.length > 1 && (
              <div className="tx-shared-picklist__all">
                <Checkbox
                  checked={shownSummary === 'all'}
                  mixed={shownSummary === 'some'}
                  disabled={busy}
                  label={searching ? 'All screens found' : 'All screens'}
                  data-testid={`${testId}-all`}
                  onChange={() => {
                    setSelected(setMany(selected, selectableShownIds, shownSummary !== 'all'));
                  }}
                />
              </div>
            )}
            <div
              className="tx-shared-picklist"
              role={multiple ? 'group' : 'radiogroup'}
              aria-label="Screens"
              onKeyDown={(event) => {
                if (
                  !multiple &&
                  event.key === 'Enter' &&
                  event.target instanceof HTMLInputElement
                ) {
                  event.preventDefault();
                  confirm();
                }
              }}
            >
              {shown.map((display) => {
                const reason = reasonFor(display);
                const view = state.data.statusById?.get(display.id);
                return (
                  <PickRow
                    key={display.id}
                    type={multiple ? 'checkbox' : 'radio'}
                    name={groupName}
                    value={display.id}
                    checked={reason === null && selected.has(display.id)}
                    disabled={busy || reason !== null}
                    disabledReason={reason ?? undefined}
                    media={
                      <span className="tx-shared-pickrow__icon">
                        <Icon icon={Monitor} />
                      </span>
                    }
                    title={display.name}
                    meta={contentLabel(display)}
                    end={
                      state.data.statusById === null ? undefined : (
                        <ScreenStatusPill view={view} fetchedAt={state.fetchedAt} detail="below" />
                      )
                    }
                    testId={`${testId}-option`}
                    onChange={() => {
                      setSelected(
                        multiple ? toggleOne(selected, display.id) : new Set([display.id]),
                      );
                    }}
                  />
                );
              })}
            </div>
            {searching && shown.length === 0 && (
              <EmptyState
                variant="inline"
                level={3}
                icon={SearchX}
                title="No screen matches"
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

function ErrorText({ error }: { readonly error: unknown }) {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  return (
    <>
      {message} {isApiRequestError(error) && <span className="tx-code">{error.code}</span>}
    </>
  );
}
