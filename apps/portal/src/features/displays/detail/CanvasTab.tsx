import { FIT_MODES, type DisplayDto } from '@tinnox/contracts';
import { useRef, useState, type FormEvent } from 'react';
import { api } from '../../../api/index.ts';
import {
  displayFormFromDto,
  previewShape,
  validateDisplayForm,
  type DisplayFormErrors,
  type DisplayFormField,
  type DisplayFormValues,
} from '../../../lib/displayForm.ts';
import {
  attentionTitle,
  CANVAS_PRESETS,
  canvasErrorItems,
  canvasFormDirty,
  canvasFormForValidation,
  canvasShapeCaption,
  CONTENT_RECT_OUT_OF_BOUNDS,
  DEFAULT_FIT_OPTION_LABELS,
  defaultFitHint,
  toCanvasPatch,
} from '../../../lib/screenDetailCanvas.ts';
import { useSession } from '../../../session/SessionContext.tsx';
import { Check } from '../../../ui/icons.ts';
import {
  Banner,
  Button,
  Checkbox,
  ErrorNotice,
  Field,
  FieldGroup,
  Select,
  TextInput,
  useToast,
} from '../../../ui/index.ts';
import { usePush } from '../../push/PushContext.tsx';
import { CanvasFrame } from './CanvasFrame.tsx';

type PixelField = 'width' | 'height' | 'rectX' | 'rectY' | 'rectWidth' | 'rectHeight';

const RECT_FIELDS: readonly (readonly [PixelField, string])[] = [
  ['rectX', 'Left offset (px)'],
  ['rectY', 'Top offset (px)'],
  ['rectWidth', 'Content width (px)'],
  ['rectHeight', 'Content height (px)'],
];

/** The control an entry of the error summary moves focus to. Name and site are not on this tab. */
const FOCUS_TARGET: Partial<Record<DisplayFormField, DisplayFormField>> = {
  width: 'width',
  height: 'height',
  rectX: 'rectX',
  rectY: 'rectY',
  rectWidth: 'rectWidth',
  rectHeight: 'rectHeight',
  contentRect: 'rectX',
  defaultFit: 'defaultFit',
};

export interface CanvasTabProps {
  readonly display: DisplayDto;
  /** The form as typed; null while it shows what is stored. Kept by the page across tabs. */
  readonly draft: DisplayFormValues | null;
  readonly onDraft: (draft: DisplayFormValues | null) => void;
  readonly onSaved: (display: DisplayDto) => void;
}

/**
 * The M0 canvas form: canvas size with presets, the optional content rectangle and the
 * default fit, with the M0 validation rules and messages (`lib/displayForm.ts`). The name and
 * the site are not part of it: the name is edited above and the site cannot change.
 */
export function CanvasTab({ display, draft, onDraft, onSaved }: CanvasTabProps) {
  const { limits } = useSession();
  const toast = useToast();
  const push = usePush();
  const values = draft ?? displayFormFromDto(display);
  const dirty = draft !== null && canvasFormDirty(draft, display);
  const [errors, setErrors] = useState<DisplayFormErrors>({});
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const controls = useRef<Partial<Record<DisplayFormField, HTMLElement | null>>>({});

  // While a save runs the form takes no changes: its answer replaces the draft, so anything
  // changed meanwhile would be lost without a word (as the media details form does).
  const change = (next: DisplayFormValues) => {
    if (saving) return;
    onDraft(next);
  };
  const set = <K extends keyof DisplayFormValues>(key: K, value: DisplayFormValues[K]) => {
    change({ ...values, [key]: value });
  };

  const bind = (field: DisplayFormField) => (element: HTMLElement | null) => {
    controls.current[field] = element;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const result = validateDisplayForm(canvasFormForValidation(values, display), limits);
    if (!result.ok) {
      setErrors(result.errors);
      setSaveError(null);
      // Let the summary render, then take focus to it so it is read first.
      window.requestAnimationFrame(() => {
        summaryRef.current?.focus();
      });
      return;
    }
    setErrors({});
    setSaveError(null);
    setSaving(true);
    api
      .patchDisplay(display.id, toCanvasPatch(result.value))
      .then((saved) => {
        setSaving(false);
        onDraft(null);
        onSaved(saved);
        push.refresh();
        toast.success('Canvas saved', {
          detail: 'Push to this screen to deliver content for the new canvas.',
        });
      })
      .catch((error: unknown) => {
        setSaving(false);
        setSaveError(error);
      });
  };

  const discard = () => {
    onDraft(null);
    setErrors({});
    setSaveError(null);
  };

  const items = canvasErrorItems(errors);
  const shape = previewShape(values);

  const pixelInput = (field: PixelField, label: string) => (
    <Field key={field} label={label} error={errors[field]}>
      {(control) => (
        <TextInput
          {...control}
          ref={bind(field)}
          numeric
          inputMode="numeric"
          width="sm"
          autoComplete="off"
          value={values[field]}
          readOnly={saving}
          data-testid={`screen-detail-canvas-${field}`}
          onChange={(event) => {
            set(field, event.target.value);
          }}
        />
      )}
    </Field>
  );

  return (
    <form
      className="tx-screen-detail-canvas"
      noValidate
      onSubmit={submit}
      aria-label="Canvas"
      data-testid="screen-detail-canvas-form"
    >
      <div className="tx-screen-detail-canvas__form">
        {items.length > 0 && (
          <Banner
            ref={summaryRef}
            tabIndex={-1}
            tone="danger"
            live="assertive"
            title={attentionTitle(items.length)}
          >
            <ul className="tx-screen-detail-summary-list">
              {items.map((item) => {
                const target = FOCUS_TARGET[item.field];
                return (
                  <li key={item.field}>
                    {target === undefined ? (
                      <span>
                        {item.label}: {item.message}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="tx-screen-detail-link"
                        onClick={() => {
                          controls.current[target]?.focus();
                        }}
                      >
                        {item.label}: {item.message}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Banner>
        )}
        {saveError !== null && (
          <ErrorNotice
            error={saveError}
            title="The canvas was not saved"
            onDismiss={() => {
              setSaveError(null);
            }}
          />
        )}

        <FieldGroup
          legend="Canvas"
          hint={`The output frame in pixels, between ${limits.minCanvasSidePx} and ${limits.maxCanvasSidePx} px per side.`}
        >
          <div className="tx-screen-detail-pair">
            {pixelInput('width', 'Width (px)')}
            {pixelInput('height', 'Height (px)')}
          </div>
          <div className="tx-screen-detail-presets" role="group" aria-label="Canvas size presets">
            {CANVAS_PRESETS.map((preset) => {
              const current =
                values.width.trim() === preset.width && values.height.trim() === preset.height;
              return (
                <Button
                  key={preset.label}
                  size="sm"
                  variant="secondary"
                  icon={current ? Check : undefined}
                  aria-pressed={current}
                  onClick={() => {
                    change({ ...values, width: preset.width, height: preset.height });
                  }}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>
        </FieldGroup>

        <div className="tx-screen-detail-section">
          <Checkbox
            checked={values.useContentRect}
            label="Limit content to a rectangle inside the canvas"
            hint="Optional. Content is drawn only inside this rectangle and the rest of the frame stays black. Leave it off to use the whole canvas."
            data-testid="screen-detail-canvas-use-rect"
            onChange={(checked) => {
              set('useContentRect', checked);
            }}
          />
          {values.useContentRect && (
            <FieldGroup legend="Content rectangle" error={errors.contentRect}>
              <div className="tx-screen-detail-quad">
                {RECT_FIELDS.map(([field, label]) => pixelInput(field, label))}
              </div>
            </FieldGroup>
          )}
        </div>

        <Field
          label="Default fit"
          error={errors.defaultFit}
          hint={defaultFitHint(values.defaultFit)}
        >
          {(control) => (
            <Select
              {...control}
              ref={bind('defaultFit')}
              width="lg"
              value={values.defaultFit}
              data-testid="screen-detail-canvas-fit"
              onChange={(event) => {
                const fit = FIT_MODES.find((mode) => mode === event.target.value);
                if (fit !== undefined) set('defaultFit', fit);
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

        <p className="tx-screen-detail-note">
          Changing the canvas does not change what the screen is already showing. Push again to
          deliver content for the new canvas.
        </p>

        <div className="tx-screen-detail-form__actions">
          <Button
            type="submit"
            variant="primary"
            busy={saving}
            aria-disabled={!dirty || undefined}
            data-testid="screen-detail-canvas-save"
          >
            Save changes
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={discard} data-testid="screen-detail-canvas-discard">
              Discard changes
            </Button>
          )}
          {dirty && <span className="tx-screen-detail-unsaved">Unsaved changes</span>}
        </div>
      </div>

      <div className="tx-screen-detail-canvas__shape">
        <h3 className="tx-screen-detail-caption">Canvas shape</h3>
        <CanvasFrame shape={shape} size="sm" testId="screen-detail-canvas-preview" />
        {shape !== null && (
          <p className="tx-screen-detail-note tx-num">{canvasShapeCaption(shape)}</p>
        )}
        {shape?.contentRectOutOfBounds === true && (
          <p className="tx-screen-detail-note tx-screen-detail-warning">
            {CONTENT_RECT_OUT_OF_BOUNDS}
          </p>
        )}
        <p className="tx-screen-detail-note">Proportions only. Not a preview of content.</p>
      </div>
    </form>
  );
}
