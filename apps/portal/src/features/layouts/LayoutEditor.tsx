import { ABSOLUTE, type LayoutDto, type PlaylistSummaryDto } from '@tinnox/contracts';
import { useId, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { formatTimestamp } from '../../lib/format.ts';
import {
  BAND_PERCENT,
  draftZones,
  layoutDraftFromDto,
  layoutErrorEntries,
  layoutErrorsFromApi,
  layoutIsDirty,
  NO_LAYOUT_ERRORS,
  validateLayoutDraft,
  withoutLayoutError,
  zoneLabel,
  type LayoutDraft,
  type LayoutErrors,
} from '../../lib/layouts.ts';
import { headerStatusLabel } from '../../lib/mediaDetailState.ts';
import { assignedScreensLabel } from '../../lib/playlistsList.ts';
import { playlistsByName } from '../../lib/schedules.ts';
import { EditorPage } from '../../shell/EditorPage.tsx';
import { CircleCheck, CircleDashed, Ellipsis, Trash } from '../../ui/icons.ts';
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
  Stepper,
  Textarea,
  TextInput,
  useToast,
} from '../../ui/index.ts';
import { usePush } from '../push/PushContext.tsx';
import { useLeaveGuard } from '../shared/useLeaveGuard.tsx';
import { DeleteLayoutDialog } from './DeleteLayoutDialog.tsx';
import { LayoutPreview } from './LayoutPreview.tsx';
import { LayoutZoneFields } from './LayoutZoneFields.tsx';
import './layouts.css';

export const LAYOUTS_BACK = { to: '/layouts', label: 'Layouts' } as const;

export interface LayoutEditorProps {
  readonly initial: LayoutDto;
  /** Every playlist of the organisation, for the selects. */
  readonly playlists: readonly PlaylistSummaryDto[];
}

/** The names of the playlists a layout uses, for a select whose list does not hold one. */
function usedPlaylistNames(layout: LayoutDto): ReadonlyMap<string, string> {
  return new Map(layout.zones.map((zone) => [zone.playlist.id, zone.playlist.name]));
}

/**
 * The editor of one layout (docs/portal-v2/stage-b.md, slice 4, section 7): the name and the
 * description, the band height of the preset and a playlist per zone, beside a preview of the
 * zones on a screen shape; Cancel and Save in the header, Delete in its menu. A layout whose
 * zones match no preset keeps their sizes, and only its playlists can be changed. The pure
 * rules (what changed, what is sent, the plain-words checks) are in `lib/layouts.ts`, which
 * also holds the one-preset shortcut; the server stays the authority.
 */
export function LayoutEditor({ initial, playlists }: LayoutEditorProps) {
  const toast = useToast();
  const push = usePush();
  const navigate = useNavigate();
  const baseId = useId();

  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<LayoutDraft>(() => layoutDraftFromDto(initial));
  const [errors, setErrors] = useState<LayoutErrors>(NO_LAYOUT_ERRORS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState<LayoutDto | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => playlistsByName(playlists), [playlists]);
  const knownNames = useMemo(() => usedPlaylistNames(saved), [saved]);
  const playlistNames = useMemo(
    () => new Map([...knownNames, ...options.map((p) => [p.id, p.name] as const)]),
    [knownNames, options],
  );

  const dirty = layoutIsDirty(saved, draft);
  // Until the save answers, the changes are not safe: it can still fail (FCX-04).
  const guard = useLeaveGuard(dirty, saved.name, saving);
  const entries = layoutErrorEntries(errors, draft);
  const preset = draft.bandPercent !== null;

  const focusControl = (testId: string) => {
    formRef.current?.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus();
  };

  const focusSummary = () => {
    // After the summary has rendered.
    window.requestAnimationFrame(() => {
      summaryRef.current?.focus();
    });
  };

  const change = (slot: 'name' | 'description' | 'bandPercent' | number, next: LayoutDraft) => {
    setDraft(next);
    setErrors(withoutLayoutError(errors, slot));
  };

  const changeZone = (index: number, playlistId: string) => {
    change(index, {
      ...draft,
      zones: draft.zones.map((zone, at) => (at === index ? { ...zone, playlistId } : zone)),
    });
  };

  const save = () => {
    if (saving || !dirty) return;
    const result = validateLayoutDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      setSaveError(null);
      focusSummary();
      return;
    }
    setErrors(NO_LAYOUT_ERRORS);
    setSaving(true);
    setSaveError(null);
    const sentFrom = draft;
    api.replaceLayout(saved.id, result.value).then(
      (layout) => {
        setSaved(layout);
        setDraft(layoutDraftFromDto(layout));
        setSaving(false);
        toast.success('Layout saved', {
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
          setErrors(layoutErrorsFromApi(error.details, sentFrom));
          focusSummary();
        }
      },
    );
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    save();
  };

  return (
    <EditorPage
      title={draft.name.trim() === '' ? saved.name : draft.name.trim()}
      back={LAYOUTS_BACK}
      status={
        <span className="tx-layout-editor-status" data-state={dirty ? 'unsaved' : 'saved'}>
          <Icon icon={dirty ? CircleDashed : CircleCheck} size={16} />
          <span role="status" data-testid="layout-save-state" data-dirty={dirty}>
            {headerStatusLabel(dirty)}
          </span>
        </span>
      }
      actions={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              void navigate('/layouts');
            }}
            data-testid="layout-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={saving}
            aria-disabled={!dirty || undefined}
            onClick={save}
            data-testid="layout-save"
          >
            Save
          </Button>
          <Menu
            placement="bottom-end"
            trigger={(props) => (
              <IconButton
                {...props}
                icon={Ellipsis}
                label={`More actions for ${saved.name}`}
                data-testid="layout-menu"
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
              Delete layout
            </MenuItem>
          </Menu>
        </>
      }
    >
      <form
        ref={formRef}
        noValidate
        className="tx-layout-editor"
        onSubmit={submit}
        aria-busy={saving || undefined}
        data-testid="layout-editor"
      >
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
            className="tx-layout-editor-summary"
            data-testid="layout-error-summary"
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
          <div className="tx-layout-editor__side">
            <Card as="section" aria-labelledby={`${baseId}-details`}>
              <CardHeader id={`${baseId}-details`} title="Details" size="title" />
              <div className="tx-layout-editor__fields">
                <Field label="Name" error={errors.name} required>
                  {(control) => (
                    <TextInput
                      {...control}
                      width="full"
                      value={draft.name}
                      maxLength={ABSOLUTE.maxNameLength}
                      autoComplete="off"
                      readOnly={saving}
                      data-testid="layout-name"
                      onChange={(event) => {
                        change('name', { ...draft, name: event.target.value });
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
                      readOnly={saving}
                      data-testid="layout-description"
                      onChange={(event) => {
                        change('description', { ...draft, description: event.target.value });
                      }}
                    />
                  )}
                </Field>
                <Facts className="tx-layout-editor-facts">
                  <Fact label="Screens" testId="layout-fact-screens">
                    {assignedScreensLabel(saved.assignedDisplayCount)}
                  </Fact>
                  <Fact label="Created">{formatTimestamp(saved.createdAt)}</Fact>
                  <Fact label="Updated">{formatTimestamp(saved.updatedAt)}</Fact>
                </Facts>
              </div>
            </Card>

            <Card as="section" aria-labelledby={`${baseId}-zones`}>
              <CardHeader id={`${baseId}-zones`} title="Zones" size="title" />
              <div className="tx-layout-editor__fields">
                <p className="tx-layout-editor__help">
                  Screens need player 0.5.0 or later to show a layout. Reload the player page on
                  each screen after this update; until then an older player keeps its last content
                  and the screen&rsquo;s page says so.
                </p>
                {draft.bandPercent !== null ? (
                  <Field
                    label="Band height (%)"
                    error={errors.bandPercent}
                    hint="Part of the height of each screen’s content area. The main zone fills the rest."
                    required
                  >
                    {(control) => (
                      <Stepper
                        {...control}
                        value={draft.bandPercent ?? ''}
                        min={BAND_PERCENT.min}
                        max={BAND_PERCENT.max}
                        step={1}
                        unit="%"
                        stepLabel="band height"
                        disabled={saving}
                        data-testid="layout-band-percent"
                        onChange={(bandPercent) => {
                          change('bandPercent', { ...draft, bandPercent });
                        }}
                      />
                    )}
                  </Field>
                ) : (
                  <div data-testid="layout-custom-note">
                    <Banner tone="info">
                      These zones were set outside this editor; their sizes are kept.
                    </Banner>
                  </div>
                )}
                {draft.zones.map((zone, index) => (
                  <LayoutZoneFields
                    key={index}
                    index={index}
                    label={zoneLabel(index, preset)}
                    band={preset && index === 1}
                    playlistId={zone.playlistId}
                    error={errors.zones.get(index)?.playlistId}
                    playlists={options}
                    knownNames={knownNames}
                    disabled={saving}
                    onChange={(playlistId) => {
                      changeZone(index, playlistId);
                    }}
                  />
                ))}
              </div>
            </Card>
          </div>

          <LayoutPreview zones={draftZones(draft)} preset={preset} playlistNames={playlistNames} />
        </div>
      </form>
      {guard.dialog}
      <DeleteLayoutDialog
        layout={deleting}
        onClose={() => {
          setDeleting(null);
        }}
        onDeleted={(layout) => {
          guard.release();
          void navigate('/layouts');
          toast.success(`${layout.name} deleted`);
        }}
      />
    </EditorPage>
  );
}
