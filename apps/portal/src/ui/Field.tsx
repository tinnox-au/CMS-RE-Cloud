import { useId, type ReactNode } from 'react';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { CircleExclamationPoint } from './icons.ts';

/** Spread these on the control inside a Field. */
export interface FieldControlProps {
  readonly id: string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': true | undefined;
  readonly 'aria-required': true | undefined;
}

export interface FieldProps {
  readonly label: string;
  /** Help that is always visible under the control. */
  readonly hint?: ReactNode;
  /** A validation message. Its presence marks the control invalid. */
  readonly error?: string | undefined;
  /** Adds "Optional" after the label. */
  readonly optional?: boolean;
  /** Marks the control required for assistive technology. The page still validates. */
  readonly required?: boolean;
  /** Receives the ids and ARIA attributes for the control: `{(control) => <TextInput {...control} />}`. */
  readonly children: (control: FieldControlProps) => ReactNode;
  readonly className?: string;
}

function FieldMessages({
  hint,
  hintId,
  error,
  errorId,
}: {
  readonly hint: ReactNode;
  readonly hintId: string;
  readonly error: string | undefined;
  readonly errorId: string;
}) {
  return (
    <>
      {hint !== undefined && (
        <p id={hintId} className="tx-field__hint">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="tx-field__error">
          <Icon icon={CircleExclamationPoint} size={16} />
          <span>{error}</span>
        </p>
      )}
    </>
  );
}

function describedBy(...ids: readonly (string | false)[]): string | undefined {
  const present = ids.filter((id) => id !== false);
  return present.length === 0 ? undefined : present.join(' ');
}

/**
 * A labelled control: label above, hint below, error text with an icon. The label, hint
 * and error are tied to the control through `for`, `aria-describedby` and `aria-invalid`.
 */
export function Field({
  label,
  hint,
  error,
  optional = false,
  required = false,
  children,
  className,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={cx('tx-field', className)}>
      <label className="tx-field__label" htmlFor={id}>
        {label}
        {optional && (
          <span className="tx-field__optional">
            {/* Keeps the label and the word apart in the control's name: "Description, Optional". */}
            <span className="tx-visually-hidden">, </span>
            Optional
          </span>
        )}
      </label>
      <div className="tx-field__control">
        {children({
          id,
          'aria-describedby': describedBy(
            hint !== undefined && hintId,
            error !== undefined && errorId,
          ),
          'aria-invalid': error !== undefined ? true : undefined,
          'aria-required': required ? true : undefined,
        })}
      </div>
      <FieldMessages hint={hint} hintId={hintId} error={error} errorId={errorId} />
    </div>
  );
}

export interface FieldGroupProps {
  /** The group's name, read before each control inside it. */
  readonly legend: string;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  /** Fields, checkboxes or radio buttons that answer one question together. */
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * One label for several controls, for example "Canvas" over width and height. Renders a
 * fieldset with a legend, styled like a Field.
 */
export function FieldGroup({ legend, hint, error, children, className }: FieldGroupProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <fieldset
      className={cx('tx-field', className)}
      aria-describedby={describedBy(hint !== undefined && hintId, error !== undefined && errorId)}
    >
      <legend className="tx-field__label">{legend}</legend>
      <div className="tx-field-group__controls">{children}</div>
      <FieldMessages hint={hint} hintId={hintId} error={error} errorId={errorId} />
    </fieldset>
  );
}

export interface FormSectionProps {
  /** Caption-style group title. */
  readonly title: string;
  readonly description?: ReactNode;
  /** `rows` puts each label to the left of its control from 900 px up (the editor page pattern). */
  readonly layout?: 'stack' | 'rows';
  readonly children: ReactNode;
}

/** A titled group of fields with a hairline above it. Stack several inside one card. */
export function FormSection({ title, description, layout = 'stack', children }: FormSectionProps) {
  const titleId = useId();
  return (
    <section
      className={cx('tx-form-section', layout === 'rows' && 'tx-form-section--rows')}
      aria-labelledby={titleId}
    >
      <div>
        <h3 id={titleId} className="tx-form-section__title">
          {title}
        </h3>
        {description !== undefined && <p className="tx-form-section__description">{description}</p>}
      </div>
      <div className="tx-form-section__fields">{children}</div>
    </section>
  );
}
