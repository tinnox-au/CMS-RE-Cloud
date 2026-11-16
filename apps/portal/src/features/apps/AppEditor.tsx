import {
  ABSOLUTE,
  APP_TEXT_LIMITS,
  AppContentSchema,
  DATE_FORMATS,
  TICKER_SPEEDS,
  type AppContent,
  type AppDto,
} from '@tinnox/contracts';
import { useCallback, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import {
  APP_FIELD_LABELS,
  APP_TYPE_LABELS,
  appDraftFromDto,
  appErrorFields,
  appErrorsFromApi,
  appIsDirty,
  contrastWarning,
  countdownPassed,
  dateFormatLabel,
  isTimeBased,
  previewZoneNote,
  NO_APP_ERRORS,
  previewShapes,
  usedInLabel,
  validateAppDraft,
  type AppDraft,
  type AppErrors,
} from '../../lib/apps.ts';
import { formatTimestamp } from '../../lib/format.ts';
import { INCOMPLETE_DATE_TIME } from '../../lib/mediaDetailDraft.ts';
import { headerStatusLabel } from '../../lib/mediaDetailState.ts';
import { EditorPage } from '../../shell/EditorPage.tsx';
import { CircleCheck, CircleDashed, Ellipsis, Trash } from '../../ui/icons.ts';
import {
  Banner,
  Button,
  Card,
  ErrorNotice,
  Fact,
  Facts,
  Field,
  FormSection,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  Segmented,
  Select,
  Switch,
  Textarea,
  TextInput,
  useToast,
} from '../../ui/index.ts';
import { CanvasFrame } from '../displays/detail/CanvasFrame.tsx';
import { usePush } from '../push/PushContext.tsx';
import { useLeaveGuard } from '../shared/useLeaveGuard.tsx';
import { AppPreview } from './AppPreview.tsx';
import { DeleteAppDialog } from './DeleteAppDialog.tsx';
import './apps.css';

export const APPS_BACK = { to: '/apps', label: 'Apps' } as const;

const loadDisplays = (signal: AbortSignal) => api.listDisplays(signal);

/** The content with some settings changed, keeping its type. */
function withSettings<C extends AppContent>(content: C, change: Partial<C['settings']>): C {
  return { ...content, settings: { ...content.settings, ...change } };
}

function fieldClass(field: string): string {
  return `tx-app-field tx-app-field--${field}`;
}

export interface AppEditorProps {
  readonly initial: AppDto;
}

/**
 * The editor of one app (docs/portal-v2/stage-b.md, slice 2, section 8): the live preview,
 * drawn by the player's own renderer, and the facts on the left; the name, the type's
 * settings and the colours on the right; Cancel and Save in the header, Delete in its menu.
 * The pure rules (what changed, what is sent, the plain-words checks) are in `lib/apps.ts`;
 * the server stays the authority.
 */
export function AppEditor({ initial }: AppEditorProps) {
  const toast = useToast();
  const push = usePush();
  const navigate = useNavigate();
  const shapeId = useId();

  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<AppDraft>(() => appDraftFromDto(initial));
  const [errors, setErrors] = useState<AppErrors>(NO_APP_ERRORS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [overflow, setOverflow] = useState(false);
  const [shapeValue, setShapeValue] = useState('landscape');
  const [deleting, setDeleting] = useState<AppDto | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  // The preview keeps the last content that would pass the checks, so a half-typed date or
  // an emptied field never reaches the renderer.
  const [shown, setShown] = useState<AppContent>(initial.content);
  if (shown !== draft.content && AppContentSchema.safeParse(draft.content).success) {
    setShown(draft.content);
  }

  const displays = useLoad(loadDisplays);
  const shapes = previewShapes(displays.state.status === 'ready' ? displays.state.data : []);
  const shape = shapes.find((option) => option.value === shapeValue) ?? shapes[0];

  const dirty = appIsDirty(draft, saved);
  const guard = useLeaveGuard(dirty && !saving, saved.name);
  const invalid = appErrorFields(errors);
  const { content } = draft;
  const nowMs = Date.now();
  const contrast = contrastWarning(content.settings.textColour, content.settings.backgroundColour);

  /** A field changed: its message goes (a Text message also clears the heading's). */
  const change = (field: string, next: AppDraft) => {
    setDraft(next);
    const fixed = field === 'body' ? [field, 'heading'] : [field];
    if (fixed.some((key) => errors[key] !== undefined)) {
      const rest: Record<string, string> = { ...errors };
      for (const key of fixed) delete rest[key];
      setErrors(rest);
    }
  };
  const setContent = (field: string, next: AppContent) => {
    change(field, { ...draft, content: next });
  };

  const focusField = (field: string) => {
    formRef.current
      ?.querySelector<HTMLElement>(`.tx-app-field--${field} :is(input, textarea, select)`)
      ?.focus();
  };

  const save = () => {
    if (saving || !dirty) return;
    const result = validateAppDraft(draft, saved);
    if (!result.ok) {
      setErrors(result.errors);
      setSaveError(null);
      // After the summary has rendered.
      window.requestAnimationFrame(() => {
        summaryRef.current?.focus();
      });
      return;
    }
    setErrors(NO_APP_ERRORS);
    if (result.value === null) return;
    setSaving(true);
    setSaveError(null);
    api.patchApp(saved.id, result.value).then(
      (app) => {
        setSaved(app);
        setDraft(appDraftFromDto(app));
        setSaving(false);
        toast.success('App saved');
        // Playlists holding the app now differ from what their screens were pushed.
        push.refresh();
      },
      (error: unknown) => {
        setSaving(false);
        setSaveError(error);
        if (isApiRequestError(error) && error.details.length > 0) {
          setErrors(appErrorsFromApi(error.details));
        }
      },
    );
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    save();
  };

  // A partly filled field reports '' and fires no change while it stays partial, so it is
  // also read on blur, which comes before Save (as on the media details page).
  const typeTarget = (event: SyntheticEvent<HTMLInputElement>) => {
    if (content.type !== 'countdown') return;
    const input = event.currentTarget;
    const text = input.validity.badInput ? INCOMPLETE_DATE_TIME : input.value;
    if (text !== content.settings.target) {
      setContent('target', withSettings(content, { target: text }));
    }
  };

  const text = (
    field: string,
    label: string,
    value: string,
    max: number,
    onText: (value: string) => void,
    options: {
      readonly hint?: string;
      readonly optional?: boolean;
      readonly multiLine?: boolean;
    } = {},
  ) => (
    <Field
      className={fieldClass(field)}
      label={label}
      hint={options.hint}
      optional={options.optional}
      error={errors[field]}
    >
      {(control) =>
        options.multiLine === true ? (
          <Textarea
            {...control}
            rows={4}
            value={value}
            maxLength={max}
            readOnly={saving}
            data-testid={`app-editor-${field}`}
            onChange={(event) => {
              onText(event.target.value);
            }}
          />
        ) : (
          <TextInput
            {...control}
            value={value}
            maxLength={max}
            autoComplete="off"
            readOnly={saving}
            data-testid={`app-editor-${field}`}
            onChange={(event) => {
              onText(event.target.value);
            }}
          />
        )
      }
    </Field>
  );

  const showSeconds = (value: boolean, onToggle: (on: boolean) => void) => (
    <div className="tx-app-editor-note">
      <Switch
        checked={value}
        label="Show seconds"
        disabled={saving}
        data-testid="app-editor-show-seconds"
        onChange={onToggle}
      />
    </div>
  );

  const typeSettings = () => {
    switch (content.type) {
      case 'clock':
        return (
          <>
            <Field label="Time format">
              {(control) => (
                <div id={control.id}>
                  <Segmented
                    label="Time format"
                    value={content.settings.hourCycle}
                    options={[
                      { value: '12', label: '12-hour' },
                      { value: '24', label: '24-hour' },
                    ]}
                    onChange={(hourCycle) => {
                      if (!saving) setContent('hourCycle', withSettings(content, { hourCycle }));
                    }}
                  />
                </div>
              )}
            </Field>
            {showSeconds(content.settings.showSeconds, (on) => {
              setContent('showSeconds', withSettings(content, { showSeconds: on }));
            })}
          </>
        );
      case 'date':
        return (
          <Field label="Format">
            {/* A Select, not a Segmented: three full dates do not fit side by side in the field. */}
            {(control) => (
              <Select
                {...control}
                value={content.settings.format}
                disabled={saving}
                onChange={(event) => {
                  const format = DATE_FORMATS.find((f) => f === event.target.value);
                  if (format !== undefined) setContent('format', withSettings(content, { format }));
                }}
              >
                {DATE_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {dateFormatLabel(format, nowMs)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        );
      case 'countdown':
        return (
          <>
            <Field
              className={fieldClass('target')}
              label="Counts down to"
              hint="Local time at each screen's site."
              error={errors['target']}
            >
              {(control) => (
                <TextInput
                  {...control}
                  type="datetime-local"
                  width="md"
                  value={
                    content.settings.target === INCOMPLETE_DATE_TIME ? '' : content.settings.target
                  }
                  readOnly={saving}
                  data-testid="app-editor-target"
                  onChange={typeTarget}
                  onBlur={typeTarget}
                />
              )}
            </Field>
            {countdownPassed(content.settings.target, nowMs) && (
              <div className="tx-app-editor-note" data-testid="app-editor-passed">
                <Banner tone="info">This moment has passed; screens show the finished text.</Banner>
              </div>
            )}
            {text(
              'label',
              'Label',
              content.settings.label,
              APP_TEXT_LIMITS.countdownLabel,
              (label) => {
                setContent('label', withSettings(content, { label }));
              },
              { optional: true, hint: 'Shown above the time, for example “Sale ends in”.' },
            )}
            {text(
              'finishedText',
              'When it ends, show',
              content.settings.finishedText,
              APP_TEXT_LIMITS.finishedText,
              (finishedText) => {
                setContent('finishedText', withSettings(content, { finishedText }));
              },
            )}
            {showSeconds(content.settings.showSeconds, (on) => {
              setContent('showSeconds', withSettings(content, { showSeconds: on }));
            })}
          </>
        );
      case 'ticker':
        return (
          <>
            {text(
              'text',
              'Text',
              content.settings.text,
              APP_TEXT_LIMITS.tickerText,
              (value) => {
                setContent('text', withSettings(content, { text: value }));
              },
              {
                hint: 'Scrolls from right to left. Give the playlist item a duration long enough for the text to pass once.',
              },
            )}
            <Field label="Speed">
              {(control) => (
                <div id={control.id}>
                  <Segmented
                    label="Speed"
                    value={content.settings.speed}
                    options={TICKER_SPEEDS.map((speed) => ({
                      value: speed,
                      label: speed === 'slow' ? 'Slow' : speed === 'medium' ? 'Medium' : 'Fast',
                    }))}
                    onChange={(speed) => {
                      if (!saving) setContent('speed', withSettings(content, { speed }));
                    }}
                  />
                </div>
              )}
            </Field>
          </>
        );
      case 'qr':
        return (
          <>
            {text(
              'content',
              'Content',
              content.settings.content,
              APP_TEXT_LIMITS.qrContent,
              (value) => {
                setContent('content', withSettings(content, { content: value }));
              },
              {
                hint: 'A web address or any short text. Short content makes a code that is easier to scan from a distance.',
              },
            )}
            {text(
              'caption',
              'Caption (optional)',
              content.settings.caption,
              APP_TEXT_LIMITS.qrCaption,
              (caption) => {
                setContent('caption', withSettings(content, { caption }));
              },
            )}
          </>
        );
      case 'text':
        return (
          <>
            {text('heading', 'Heading', content.settings.heading, APP_TEXT_LIMITS.heading, (h) => {
              setContent('heading', withSettings(content, { heading: h }));
            })}
            {text(
              'body',
              'Message',
              content.settings.body,
              APP_TEXT_LIMITS.body,
              (body) => {
                setContent('body', withSettings(content, { body }));
              },
              { multiLine: true },
            )}
          </>
        );
    }
  };

  const colour = (field: 'textColour' | 'backgroundColour', label: string) => (
    <Field className={fieldClass(field)} label={label} error={errors[field]}>
      {(control) => (
        <TextInput
          {...control}
          type="color"
          width="xs"
          value={content.settings[field]}
          disabled={saving}
          data-testid={`app-editor-${field}`}
          onChange={(event) => {
            setContent(
              field,
              withSettings<AppContent>(content, { [field]: event.target.value.toLowerCase() }),
            );
          }}
        />
      )}
    </Field>
  );

  const onOverflow = useCallback((value: boolean) => {
    setOverflow(value);
  }, []);

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const canvas = shape?.shape.canvas;

  return (
    <EditorPage
      title={draft.name.trim() === '' ? saved.name : draft.name.trim()}
      back={APPS_BACK}
      status={
        <span className="tx-app-editor-status" data-state={dirty ? 'unsaved' : 'saved'}>
          <Icon icon={dirty ? CircleDashed : CircleCheck} size={16} />
          <span role="status" data-testid="app-editor-save-state" data-dirty={dirty}>
            {headerStatusLabel(dirty)}
          </span>
        </span>
      }
      actions={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              void navigate('/apps');
            }}
            data-testid="app-editor-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={saving}
            aria-disabled={!dirty || undefined}
            onClick={save}
            data-testid="app-editor-save"
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
                data-testid="app-editor-menu"
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
              Delete app
            </MenuItem>
          </Menu>
        </>
      }
    >
      <div className="tx-app-editor" data-testid="app-editor" data-app-type={content.type}>
        <div className="tx-editor">
          <Card as="section" className="tx-app-editor-aside" aria-labelledby={`${shapeId}-title`}>
            <h2 id={`${shapeId}-title`} className="tx-app-editor__title">
              Preview
            </h2>
            {shape !== undefined && canvas !== undefined && (
              <CanvasFrame
                shape={shape.shape}
                size="xl"
                description={`Preview of this app on a ${String(canvas.width)} × ${String(canvas.height)} canvas.`}
                testId="app-editor-preview"
              >
                <AppPreview content={shown} onOverflow={onOverflow} />
              </CanvasFrame>
            )}
            <Field label="Preview on">
              {(control) => (
                <Select
                  {...control}
                  value={shape?.value ?? 'landscape'}
                  data-testid="app-editor-preview-shape"
                  onChange={(event) => {
                    setShapeValue(event.target.value);
                  }}
                >
                  {shapes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {isTimeBased(content.type) && (
              <p className="tx-small tx-muted">{previewZoneNote(zone)}</p>
            )}
            {overflow && (
              <div data-testid="app-editor-overflow">
                <Banner tone="warn" live="polite">
                  Not all the text fits this screen shape. Shorten the text or preview another
                  shape.
                </Banner>
              </div>
            )}
            <Facts className="tx-app-editor-facts">
              <Fact label="Type" testId="app-editor-fact-type">
                {APP_TYPE_LABELS[content.type]}
              </Fact>
              <Fact label="Used in" testId="app-editor-fact-used">
                {usedInLabel(saved.usageCount)}
              </Fact>
              <Fact label="Created">{formatTimestamp(saved.createdAt)}</Fact>
              <Fact label="Updated">{formatTimestamp(saved.updatedAt)}</Fact>
            </Facts>
          </Card>

          <Card as="section" aria-labelledby={`${shapeId}-settings`}>
            {/* The outline heading of this column, so its section titles nest under it. */}
            <h2 id={`${shapeId}-settings`} className="tx-visually-hidden">
              Settings
            </h2>
            <form
              ref={formRef}
              noValidate
              className="tx-app-editor-form"
              onSubmit={submit}
              aria-busy={saving || undefined}
              data-testid="app-editor-form"
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
              {invalid.length > 0 && (
                <div
                  ref={summaryRef}
                  tabIndex={-1}
                  className="tx-app-editor-summary"
                  data-testid="app-editor-error-summary"
                >
                  <Banner
                    tone="danger"
                    live="assertive"
                    title={
                      invalid.length === 1
                        ? 'One field needs a change before saving'
                        : `${String(invalid.length)} fields need a change before saving`
                    }
                  >
                    <ul>
                      {invalid.map((field) => (
                        <li key={field}>
                          {field === 'form' ? (
                            APP_FIELD_LABELS[field]
                          ) : (
                            <a
                              href={`#${field}`}
                              onClick={(event) => {
                                event.preventDefault();
                                focusField(field);
                              }}
                            >
                              {APP_FIELD_LABELS[field]}
                            </a>
                          )}
                          : {errors[field]}
                        </li>
                      ))}
                    </ul>
                  </Banner>
                </div>
              )}

              <FormSection title="Details" layout="rows">
                {text('name', 'Name', draft.name, ABSOLUTE.maxNameLength, (name) => {
                  change('name', { ...draft, name });
                })}
                {text(
                  'description',
                  'Description',
                  draft.description,
                  ABSOLUTE.maxDescriptionLength,
                  (description) => {
                    change('description', { ...draft, description });
                  },
                  {
                    optional: true,
                    multiLine: true,
                    hint: 'A note for your team. Screens never show it.',
                  },
                )}
              </FormSection>

              <FormSection title={APP_TYPE_LABELS[content.type]} layout="rows">
                {typeSettings()}
              </FormSection>

              <FormSection title="Style" layout="rows">
                {colour('textColour', 'Text colour')}
                {colour('backgroundColour', 'Background colour')}
                {contrast !== null && (
                  <div className="tx-app-editor-note" data-testid="app-editor-contrast">
                    <Banner tone="warn" live="polite">
                      {contrast}
                    </Banner>
                  </div>
                )}
              </FormSection>
            </form>
          </Card>
        </div>
      </div>
      {guard.dialog}
      <DeleteAppDialog
        app={deleting}
        onClose={() => {
          setDeleting(null);
        }}
        onDeleted={(app) => {
          guard.release();
          void navigate('/apps');
          toast.success(`${app.name} deleted`);
        }}
      />
    </EditorPage>
  );
}
