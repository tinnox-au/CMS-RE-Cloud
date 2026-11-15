import type { DisplayDto, FitMode, SiteDto } from '@tinnox/contracts';
import { FIT_MODES } from '@tinnox/contracts';
import { useCallback, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/index.ts';
import { CanvasPreview } from '../components/CanvasPreview.tsx';
import { ErrorNotice, Field, Loading, PageHeader } from '../components/common.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import {
  displayFormFromDto,
  EMPTY_DISPLAY_FORM,
  previewShape,
  toDisplayPatch,
  validateDisplayForm,
  type DisplayFormErrors,
  type DisplayFormValues,
} from '../lib/displayForm.ts';
import { useSession } from '../session/SessionContext.tsx';

const PRESETS: readonly { label: string; width: string; height: string }[] = [
  { label: 'Landscape 1920 × 1080', width: '1920', height: '1080' },
  { label: 'Portrait 1080 × 1920', width: '1080', height: '1920' },
  { label: 'Wide strip 3840 × 480', width: '3840', height: '480' },
  { label: 'Tall column 640 × 1344', width: '640', height: '1344' },
];

const FIT_DESCRIPTIONS: Readonly<Record<FitMode, string>> = {
  contain: 'Contain: show the whole item, with black bars where the shape differs',
  cover: 'Cover: fill the area, cropping the item equally on both sides',
};

function DisplayForm({
  sites,
  existing,
}: {
  readonly sites: readonly SiteDto[];
  readonly existing: DisplayDto | null;
}) {
  const { limits } = useSession();
  const navigate = useNavigate();
  const [values, setValues] = useState<DisplayFormValues>(() =>
    existing !== null
      ? displayFormFromDto(existing)
      : { ...EMPTY_DISPLAY_FORM, siteId: sites.length === 1 ? (sites[0]?.id ?? '') : '' },
  );
  const [errors, setErrors] = useState<DisplayFormErrors>({});
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof DisplayFormValues>(key: K, value: DisplayFormValues[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateDisplayForm(values, limits);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmitError(null);
    setBusy(true);
    const request =
      existing === null
        ? api.createDisplay(result.value)
        : api.patchDisplay(existing.id, toDisplayPatch(result.value));
    request
      .then((display) => navigate(`/displays/${display.id}`))
      .catch((error: unknown) => {
        setSubmitError(error);
        setBusy(false);
      });
  };

  const shape = previewShape(values);
  const errorCount = Object.keys(errors).length;

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <div className="form-main">
        {errorCount > 0 && (
          <div className="notice notice-bad" role="alert">
            <p className="notice-title">
              {errorCount === 1
                ? 'One field needs attention.'
                : `${errorCount} fields need attention.`}
            </p>
            {errors.form !== undefined && <p>{errors.form}</p>}
          </div>
        )}
        {submitError !== null && (
          <ErrorNotice error={submitError} title="The display was not saved" />
        )}

        <Field label="Name" error={errors.name}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              type="text"
              value={values.name}
              maxLength={120}
              autoComplete="off"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                set('name', event.target.value);
              }}
            />
          )}
        </Field>

        <Field
          label="Site"
          error={errors.siteId}
          hint={
            existing !== null ? 'The site of an existing display cannot be changed.' : undefined
          }
        >
          {({ id, describedBy, invalid }) => (
            <select
              id={id}
              value={values.siteId}
              disabled={existing !== null}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                set('siteId', event.target.value);
              }}
            >
              <option value="">Choose a site</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} ({site.timezone})
                </option>
              ))}
            </select>
          )}
        </Field>

        <fieldset>
          <legend>Canvas</legend>
          <p className="hint">
            The output frame in pixels, between {limits.minCanvasSidePx} and{' '}
            {limits.maxCanvasSidePx} px per side.
          </p>
          <div className="row">
            <Field label="Width (px)" error={errors.width}>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  type="text"
                  inputMode="numeric"
                  className="input-number"
                  value={values.width}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  onChange={(event) => {
                    set('width', event.target.value);
                  }}
                />
              )}
            </Field>
            <Field label="Height (px)" error={errors.height}>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  type="text"
                  inputMode="numeric"
                  className="input-number"
                  value={values.height}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  onChange={(event) => {
                    set('height', event.target.value);
                  }}
                />
              )}
            </Field>
          </div>
          <div className="preset-row" role="group" aria-label="Canvas size presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="button button-small"
                onClick={() => {
                  setValues((previous) => ({
                    ...previous,
                    width: preset.width,
                    height: preset.height,
                  }));
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Content rectangle</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={values.useContentRect}
              onChange={(event) => {
                set('useContentRect', event.target.checked);
              }}
            />
            Limit content to a rectangle inside the canvas
          </label>
          <p className="hint">
            Optional. Content is drawn only inside this rectangle and the rest of the frame stays
            black. Leave it off to use the whole canvas.
          </p>
          {values.useContentRect && (
            <>
              <div className="row">
                <Field label="Left offset (px)" error={errors.rectX}>
                  {({ id, describedBy, invalid }) => (
                    <input
                      id={id}
                      type="text"
                      inputMode="numeric"
                      className="input-number"
                      value={values.rectX}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      onChange={(event) => {
                        set('rectX', event.target.value);
                      }}
                    />
                  )}
                </Field>
                <Field label="Top offset (px)" error={errors.rectY}>
                  {({ id, describedBy, invalid }) => (
                    <input
                      id={id}
                      type="text"
                      inputMode="numeric"
                      className="input-number"
                      value={values.rectY}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      onChange={(event) => {
                        set('rectY', event.target.value);
                      }}
                    />
                  )}
                </Field>
                <Field label="Content width (px)" error={errors.rectWidth}>
                  {({ id, describedBy, invalid }) => (
                    <input
                      id={id}
                      type="text"
                      inputMode="numeric"
                      className="input-number"
                      value={values.rectWidth}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      onChange={(event) => {
                        set('rectWidth', event.target.value);
                      }}
                    />
                  )}
                </Field>
                <Field label="Content height (px)" error={errors.rectHeight}>
                  {({ id, describedBy, invalid }) => (
                    <input
                      id={id}
                      type="text"
                      inputMode="numeric"
                      className="input-number"
                      value={values.rectHeight}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      onChange={(event) => {
                        set('rectHeight', event.target.value);
                      }}
                    />
                  )}
                </Field>
              </div>
              {errors.contentRect !== undefined && (
                <p className="field-error" role="alert">
                  {errors.contentRect}
                </p>
              )}
            </>
          )}
        </fieldset>

        <Field
          label="Default fit"
          error={errors.defaultFit}
          hint="Used for playlist items that do not choose their own fit."
        >
          {({ id, describedBy, invalid }) => (
            <select
              id={id}
              value={values.defaultFit}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                const fit = FIT_MODES.find((mode) => mode === event.target.value);
                if (fit !== undefined) set('defaultFit', fit);
              }}
            >
              {FIT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {FIT_DESCRIPTIONS[mode]}
                </option>
              ))}
            </select>
          )}
        </Field>

        {existing !== null && (
          <p className="hint">
            Changing the canvas does not change a publication that is already live. Publish again to
            deliver content for the new canvas.
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Saving…' : existing === null ? 'Create display' : 'Save changes'}
          </button>
          <Link
            className="button"
            to={existing === null ? '/displays' : `/displays/${existing.id}`}
          >
            Cancel
          </Link>
        </div>
      </div>
      <aside className="form-aside" aria-label="Canvas preview">
        <h2 className="h3">Canvas shape</h2>
        <CanvasPreview shape={shape} />
        <p className="small muted">Proportions only. Not a preview of content.</p>
      </aside>
    </form>
  );
}

export function DisplayFormPage() {
  const { id } = useParams();
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [sites, existing] = await Promise.all([
        api.listSites(signal),
        id === undefined ? Promise.resolve(null) : api.getDisplay(id, signal),
      ]);
      return { sites, existing };
    },
    [id],
  );
  const { state, reload } = useLoad(load);

  return (
    <>
      <PageHeader title={id === undefined ? 'New display' : 'Edit display'} />
      {state.status === 'loading' && <Loading label="Loading…" />}
      {state.status === 'error' && (
        <ErrorNotice error={state.error} title="The form could not be loaded" onRetry={reload} />
      )}
      {state.status === 'ready' &&
        (state.data.sites.length === 0 ? (
          <ErrorNotice
            error={new Error('This organisation has no site. A site is created by the seed step.')}
            title="No site available"
          />
        ) : (
          <DisplayForm
            key={state.data.existing?.id ?? 'new'}
            sites={state.data.sites}
            existing={state.data.existing}
          />
        ))}
    </>
  );
}
