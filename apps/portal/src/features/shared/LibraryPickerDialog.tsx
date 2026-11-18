import { useId, useRef, useState, type ReactNode } from 'react';
import { countLabel, matchesSearch } from '../../lib/listView.ts';
import { SearchX, type IconComponent } from '../../ui/icons.ts';
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

/** The props a thin picker (schedules, layouts) passes on unchanged. */
export interface LibraryPickerProps<T> {
  readonly open: boolean;
  /** Cancel, Escape and the close button. The caller also closes it after a successful save. */
  readonly onClose: () => void;
  /**
   * The primary button. The dialog does not save and does not close itself: do the work, show
   * `busy` meanwhile, then close it, or pass what went wrong as `error`.
   */
  readonly onConfirm: (item: T) => void;
  readonly title?: string;
  readonly description?: ReactNode;
  /** Say what happens: "Assign schedule". */
  readonly confirmLabel?: string;
  /** The item that is chosen when the dialog opens, for example the one assigned now. */
  readonly currentId?: string | null;
  /** The caller is saving: the dialog cannot be dismissed and the button shows it. */
  readonly busy?: boolean;
  /** What the caller's save threw. Shown in the dialog with the API error code. */
  readonly error?: unknown;
  /** Title of that error: "The schedule was not assigned". */
  readonly errorTitle?: string;
  readonly testId?: string;
}

export interface LibraryPickerDialogProps<
  T extends { id: string; name: string },
> extends LibraryPickerProps<T> {
  readonly title: string;
  readonly confirmLabel: string;
  readonly testId: string;
  /** Loads the items. A module-level function, so the loader stays the same between renders. */
  readonly load: (signal: AbortSignal) => Promise<T[]>;
  /** The second line of a row. */
  readonly meta: (item: T) => string;
  /** What the search field is matched against. */
  readonly searchTexts: (item: T) => readonly (string | null)[];
  readonly icon: IconComponent;
  /** What the dialog's texts call an item, and the library page to create one on. */
  readonly noun: { readonly singular: string; readonly plural: string; readonly href: string };
}

/**
 * Chooses one item of a library (a schedule, a layout): a searchable list loaded afresh each
 * time the dialog opens. There is no "none" here: content is removed from a screen on the
 * screen's page.
 */
export function LibraryPickerDialog<T extends { id: string; name: string }>({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  currentId = null,
  busy = false,
  error = null,
  errorTitle = 'The change was not saved',
  testId,
  load,
  meta,
  searchTexts,
  icon,
  noun,
}: LibraryPickerDialogProps<T>) {
  const groupName = useId();
  const { state, reload } = useLoadWhileOpen(open, load);
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

  const items = state.status === 'ready' ? state.data : [];
  const shown = items.filter((item) => matchesSearch(searchTexts(item), query));
  const chosen = choice === null ? undefined : items.find((item) => item.id === choice);

  const confirm = () => {
    if (chosen === undefined || busy) return;
    onConfirm(chosen);
  };

  const count = (n: number) => countLabel(n, noun.singular, noun.plural);
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
        state.status === 'ready' && items.length > 0 ? (
          <span aria-live="polite">
            {searching ? `${String(shown.length)} of ${count(items.length)}` : count(items.length)}
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
        {(state.status === 'loading' || items.length > 0) && (
          <SearchField
            className="tx-shared-picker-search"
            label={`Search ${noun.plural}`}
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
          <SkeletonGroup label={`Loading ${noun.plural}`} className="tx-shared-picklist">
            <PickRowSkeletons />
          </SkeletonGroup>
        )}
        {state.status === 'error' && (
          <ErrorNotice
            error={state.error}
            title={`The ${noun.plural} could not be loaded`}
            onRetry={reload}
          />
        )}
        {state.status === 'ready' && items.length === 0 && (
          <EmptyState
            variant="inline"
            level={3}
            icon={icon}
            title={`No ${noun.plural} yet`}
            action={
              <ButtonLink variant="secondary" to={noun.href}>
                Go to {noun.plural}
              </ButtonLink>
            }
          >
            Create a {noun.singular} first, then come back to choose it.
          </EmptyState>
        )}
        {state.status === 'ready' && items.length > 0 && (
          <>
            <div
              className="tx-shared-picklist"
              role="radiogroup"
              aria-label={noun.plural.charAt(0).toUpperCase() + noun.plural.slice(1)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
                  event.preventDefault();
                  confirm();
                }
              }}
            >
              {shown.map((item) => (
                <PickRow
                  key={item.id}
                  type="radio"
                  name={groupName}
                  value={item.id}
                  checked={choice === item.id}
                  disabled={busy}
                  media={
                    <span className="tx-shared-pickrow__icon">
                      <Icon icon={icon} />
                    </span>
                  }
                  title={item.name}
                  meta={meta(item)}
                  testId={`${testId}-option`}
                  onChange={() => {
                    setChoice(item.id);
                  }}
                />
              ))}
            </div>
            {searching && shown.length === 0 && (
              <EmptyState
                variant="inline"
                level={3}
                icon={SearchX}
                title={`No ${noun.singular} matches`}
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
