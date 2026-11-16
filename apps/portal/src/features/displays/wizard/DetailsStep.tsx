import { FIT_MODES, type DisplayDto, type SiteDto } from '@tinnox/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { isOutcomeUnknown } from '../../../api/client.ts';
import { api } from '../../../api/index.ts';
import {
  parsePixels,
  previewShape,
  toDisplayPatch,
  validateDisplayForm,
  type DisplayFormErrors,
  type DisplayFormField,
  type DisplayFormValues,
} from '../../../lib/displayForm.ts';
import {
  CANVAS_PRESETS,
  displayFormProblems,
  matchingPreset,
  presetGlyph,
  presetSizeLabel,
  problemCountLabel,
} from '../../../lib/screenWizard.ts';
import { useSession } from '../../../session/SessionContext.tsx';
import { ArrowRight, Check } from '../../../ui/icons.ts';
import {
  Banner,
  Button,
  ButtonLink,
  Checkbox,
  ErrorNotice,
  Field,
  FieldGroup,
  FormSection,
  Icon,
  Select,
  TextInput,
  useToast,
} from '../../../ui/index.ts';
import { usePush } from '../../push/PushContext.tsx';
import { DEFAULT_FIT_OPTION_LABELS, defaultFitHint } from '../../../lib/screenDetailCanvas.ts';
import { CanvasShapePreview } from './CanvasShapePreview.tsx';
import { StepFooter, StepPanel } from './StepPanel.tsx';
import './wizard.css';

/** The side of the square a preset's shape is drawn in. */
const GLYPH_SIDE = 28;

/** The control that takes focus for each kind of problem. */
type FocusTarget = Exclude<DisplayFormField, 'contentRect' | 'form'>;

const FOCUS_TARGET: { readonly [K in DisplayFormField]: FocusTarget | null } = {
  name: 'name',
  siteId: 'siteId',
  width: 'width',
  height: 'height',
  rectX: 'rectX',
  rectY: 'rectY',
  rectWidth: 'rectWidth',
  rectHeight: 'rectHeight',
  contentRect: 'rectX',
  defaultFit: 'defaultFit',
  form: null,
};

export interface DetailsStepProps {
  readonly sites: readonly SiteDto[];
  /** The screen this wizard has created, or null on the first pass through the step. */
  readonly created: DisplayDto | null;
  /** The form as typed. It lives in the wizard so it survives a visit to another step. */
  readonly values: DisplayFormValues;
  readonly onChange: (values: DisplayFormValues) => void;
  /** The form differs from the created screen. Always false before the screen exists. */
  readonly dirty: boolean;
  /** Puts the saved values of the created screen back. */
  readonly onDiscard: () => void;
  readonly focusHeading: boolean;
  /** The screen was created by `POST /api/displays`. */
  readonly onCreated: (display: DisplayDto) => void;
  /** The created screen was changed by `PATCH /api/displays/:id`. */
  readonly onSaved: (display: DisplayDto) => void;
  /** Nothing to save: go on to pairing. */
  readonly onContinue: () => void;
}

/**
 * Step 1: name, site, canvas, optional content rectangle and default fit, with a live
 * drawing of the canvas shape. The M0 validation rules and messages apply
 * (lib/displayForm.ts). "Create screen" creates the screen once; coming back to this step
 * edits that screen, it never creates a second one.
 */
export function DetailsStep({
  sites,
  created,
  values,
  onChange,
  dirty,
  onDiscard,
  focusHeading,
  onCreated,
  onSaved,
  onContinue,
}: DetailsStepProps) {
  const { limits } = useSession();
  const toast = useToast();
  const push = usePush();
  const [errors, setErrors] = useState<DisplayFormErrors>({});
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  /** Counts refused attempts, so focus moves to the summary each time. */
  const [refusals, setRefusals] = useState(0);

  const summaryRef = useRef<HTMLDivElement>(null);
  const controls = useRef<Partial<Record<FocusTarget, HTMLElement | null>>>({});

  useEffect(() => {
    if (refusals > 0) summaryRef.current?.focus();
  }, [refusals]);

  const set = <K extends keyof DisplayFormValues>(
    key: K,
    value: DisplayFormValues[K],
    ...clear: readonly DisplayFormField[]
  ) => {
    onChange({ ...values, [key]: value });
    // A problem is shown until the field it names is edited; the server has the last word.
    setErrors((previous) => {
      const next = { ...previous };
      for (const field of clear) delete next[field];
      return next;
    });
  };

  const setRef = (field: FocusTarget) => (element: HTMLElement | null) => {
    controls.current[field] = element;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (created !== null && !dirty) {
      onContinue();
      return;
    }
    const result = validateDisplayForm(values, limits);
    if (!result.ok) {
      setErrors(result.errors);
      setSubmitError(null);
      setRefusals((count) => count + 1);
      return;
    }
    setErrors({});
    setSubmitError(null);
    setBusy(true);
    if (created === null) {
      api
        .createDisplay(result.value)
        .then((display) => {
          toast.success('Screen created', { detail: display.name });
          // A screen without a playlist changes nothing that is waiting; the list of the
          // push dialog still gains a row.
          push.refresh();
          onCreated(display);
        })
        .catch((error: unknown) => {
          setSubmitError(error);
          setBusy(false);
        });
      return;
    }
    api
      .patchDisplay(created.id, toDisplayPatch(result.value))
      .then((display) => {
        toast.success('Screen saved', { detail: display.name });
        // A new canvas or content rectangle can change what is waiting to be pushed.
        push.refresh();
        onSaved(display);
      })
      .catch((error: unknown) => {
        setSubmitError(error);
        setBusy(false);
      });
  };

  const enableContentRect = (on: boolean) => {
    // Starting from the whole canvas shows the rectangle in the drawing at once.
    const width = parsePixels(values.width);
    const height = parsePixels(values.height);
    const prefill =
      on &&
      values.rectWidth.trim() === '' &&
      values.rectHeight.trim() === '' &&
      width !== null &&
      height !== null;
    onChange({
      ...values,
      useContentRect: on,
      ...(prefill ? { rectWidth: String(width), rectHeight: String(height) } : {}),
    });
    setErrors((previous) => {
      const next = { ...previous };
      for (const field of ['rectX', 'rectY', 'rectWidth', 'rectHeight', 'contentRect'] as const) {
        delete next[field];
      }
      return next;
    });
  };

  const problems = displayFormProblems(errors);
  const preset = matchingPreset(values);
  const shape = previewShape(values);
  const editing = created !== null;
  const primaryLabel = !editing ? 'Create screen' : dirty ? 'Save and continue' : 'Continue';

  const pixelField = (
    field: 'width' | 'height' | 'rectX' | 'rectY' | 'rectWidth' | 'rectHeight',
    label: string,
    ...alsoClears: readonly DisplayFormField[]
  ) => (
    <Field label={label} error={errors[field]}>
      {(control) => (
        <TextInput
          {...control}
          ref={setRef(field)}
          numeric
          inputMode="numeric"
          width="sm"
          autoComplete="off"
          maxLength={8}
          value={values[field]}
          data-testid={`screen-wizard-${field}`}
          onChange={(event) => {
            set(field, event.target.value, field, ...alsoClears);
          }}
        />
      )}
    </Field>
  );

  return (
    <form noValidate onSubmit={submit} data-testid="screen-wizard-details-form">
      <StepPanel
        step="details"
        title="Screen details"
        description={
          editing
            ? 'This screen already exists. Changes here are saved to it.'
            : 'Name the screen and describe the frame its player draws on.'
        }
        focusHeading={focusHeading}
      >
        {problems.length > 0 && (
          <Banner
            ref={summaryRef}
            tabIndex={-1}
            tone="danger"
            live="assertive"
            title={problemCountLabel(problems.length)}
            className="tx-screen-wizard__summary"
          >
            <ul>
              {problems.map((problem) => {
                const target = FOCUS_TARGET[problem.field];
                return (
                  <li key={problem.field}>
                    {target === null ? (
                      problem.message
                    ) : (
                      <button
                        type="button"
                        className="tx-screen-wizard__problem"
                        onClick={() => {
                          controls.current[target]?.focus();
                        }}
                      >
                        {problem.message}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Banner>
        )}
        {submitError !== null && (
          <div className="tx-stack tx-screen-wizard__summary">
            <ErrorNotice
              error={submitError}
              title={editing ? 'The screen was not saved' : 'The screen was not created'}
            />
            {!editing && isOutcomeUnknown(submitError) && (
              <Banner tone="warn" title="Check before you try again">
                The answer did not arrive, so the screen may exist already. Look for it under{' '}
                <Link to="/screens">Screens</Link> first: creating it again would make a second one.
              </Banner>
            )}
          </div>
        )}

        <FormSection title="Screen">
          <Field label="Name" error={errors.name} required>
            {(control) => (
              <TextInput
                {...control}
                ref={setRef('name')}
                width="lg"
                maxLength={120}
                autoComplete="off"
                value={values.name}
                data-testid="screen-wizard-name"
                onChange={(event) => {
                  set('name', event.target.value, 'name');
                }}
              />
            )}
          </Field>
          <Field
            label="Site"
            error={errors.siteId}
            required
            hint={editing ? 'The site of an existing screen cannot be changed.' : undefined}
          >
            {(control) => (
              <Select
                {...control}
                ref={setRef('siteId')}
                width="lg"
                value={values.siteId}
                disabled={editing}
                data-testid="screen-wizard-site"
                onChange={(event) => {
                  set('siteId', event.target.value, 'siteId');
                }}
              >
                <option value="">Choose a site</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name} ({site.timezone})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FormSection>

        <FormSection
          title="Canvas"
          description={`The output frame in pixels, between ${limits.minCanvasSidePx} and ${limits.maxCanvasSidePx} px per side.`}
        >
          <div className="tx-screen-wizard__canvas">
            <div className="tx-screen-wizard__canvas-fields">
              <div
                className="tx-screen-wizard__presets"
                role="group"
                aria-label="Canvas size presets"
              >
                {CANVAS_PRESETS.map((option) => {
                  const glyph = presetGlyph(option, GLYPH_SIDE);
                  const selected = preset?.id === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className="tx-screen-wizard__preset"
                      aria-pressed={selected}
                      data-testid={`screen-wizard-preset-${option.id}`}
                      onClick={() => {
                        onChange({
                          ...values,
                          width: String(option.width),
                          height: String(option.height),
                        });
                        setErrors((previous) => {
                          const next = { ...previous };
                          delete next.width;
                          delete next.height;
                          delete next.contentRect;
                          return next;
                        });
                      }}
                    >
                      <span className="tx-screen-wizard__preset-glyph" aria-hidden="true">
                        <svg
                          width={GLYPH_SIDE}
                          height={GLYPH_SIDE}
                          viewBox={`0 0 ${GLYPH_SIDE} ${GLYPH_SIDE}`}
                        >
                          <rect
                            x={(GLYPH_SIDE - glyph.width) / 2}
                            y={(GLYPH_SIDE - glyph.height) / 2}
                            width={glyph.width}
                            height={glyph.height}
                            rx={1.5}
                          />
                        </svg>
                      </span>
                      <span className="tx-screen-wizard__preset-text">
                        <span className="tx-screen-wizard__preset-name">{option.name}</span>
                        <span className="tx-screen-wizard__preset-size tx-num">
                          {presetSizeLabel(option)}
                        </span>
                      </span>
                      <Icon icon={Check} size={16} className="tx-screen-wizard__preset-tick" />
                    </button>
                  );
                })}
              </div>

              <FieldGroup
                legend="Canvas size"
                hint={
                  preset === null
                    ? 'A custom size.'
                    : `${preset.name} preset. Type another size for a custom canvas.`
                }
              >
                {pixelField('width', 'Width (px)', 'contentRect')}
                {pixelField('height', 'Height (px)', 'contentRect')}
              </FieldGroup>

              <Checkbox
                checked={values.useContentRect}
                onChange={enableContentRect}
                label="Limit content to a rectangle inside the canvas"
                hint="Optional. Content is drawn only inside this rectangle and the rest of the frame stays black. Leave it off to use the whole canvas."
                data-testid="screen-wizard-use-rect"
              />
              {values.useContentRect && (
                <FieldGroup
                  legend="Content rectangle"
                  error={errors.contentRect}
                  className="tx-screen-wizard__rect"
                >
                  {pixelField('rectX', 'Left offset (px)', 'contentRect')}
                  {pixelField('rectY', 'Top offset (px)', 'contentRect')}
                  {pixelField('rectWidth', 'Content width (px)', 'contentRect')}
                  {pixelField('rectHeight', 'Content height (px)', 'contentRect')}
                </FieldGroup>
              )}

              <Field
                label="Default fit"
                error={errors.defaultFit}
                hint={defaultFitHint(values.defaultFit)}
              >
                {(control) => (
                  <Select
                    {...control}
                    ref={setRef('defaultFit')}
                    value={values.defaultFit}
                    data-testid="screen-wizard-fit"
                    onChange={(event) => {
                      const fit = FIT_MODES.find((mode) => mode === event.target.value);
                      if (fit !== undefined) set('defaultFit', fit, 'defaultFit');
                    }}
                  >
                    {FIT_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {DEFAULT_FIT_OPTION_LABELS[mode]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {editing && (
                <p className="tx-small tx-muted">
                  Changing the canvas changes nothing on the screen until the next push.
                </p>
              )}
            </div>

            <aside className="tx-screen-wizard__canvas-aside" aria-label="Canvas preview">
              <h4 className="tx-caption">Canvas shape</h4>
              <CanvasShapePreview shape={shape} />
              <p className="tx-small tx-muted">Proportions only. Not a preview of content.</p>
            </aside>
          </div>
        </FormSection>
      </StepPanel>

      <StepFooter
        start={
          editing ? (
            dirty && (
              <Button
                variant="ghost"
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (busy) return;
                  setErrors({});
                  setSubmitError(null);
                  onDiscard();
                }}
                data-testid="screen-wizard-discard"
              >
                Discard changes
              </Button>
            )
          ) : (
            <ButtonLink variant="ghost" to="/screens" data-testid="screen-wizard-cancel">
              Cancel
            </ButtonLink>
          )
        }
      >
        <Button
          type="submit"
          variant="primary"
          size="lg"
          busy={busy}
          trailingIcon={editing ? ArrowRight : undefined}
          data-testid="screen-wizard-details-submit"
        >
          {primaryLabel}
        </Button>
      </StepFooter>
    </form>
  );
}
