import type { ReactNode } from 'react';
import { Checkbox, cx } from '../../ui/index.ts';
import './shared.css';

export interface PickRowProps {
  /** `radio` for one of several (give every row of the list the same `name`), `checkbox` for any number. */
  readonly type: 'radio' | 'checkbox';
  /** Radio group name. */
  readonly name?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** The row cannot be chosen; `disabledReason` says why, in place of `meta`. */
  readonly disabled?: boolean;
  readonly disabledReason?: string | undefined;
  /** A thumbnail, a mosaic or an icon. */
  readonly media?: ReactNode;
  /** The first line: what the row is. */
  readonly title: string;
  /** The second line. */
  readonly meta?: ReactNode;
  /** Something at the far end, for example a status pill. */
  readonly end?: ReactNode;
  readonly testId?: string;
  /** Read by tests and by the owner's key handling. */
  readonly value?: string;
}

function RowContent({
  media,
  title,
  meta,
  end,
  disabled,
  disabledReason,
}: Pick<PickRowProps, 'media' | 'title' | 'meta' | 'end' | 'disabled' | 'disabledReason'>) {
  const second = disabled === true && disabledReason !== undefined ? disabledReason : meta;
  return (
    <span className="tx-shared-pickrow__content">
      {media !== undefined && <span className="tx-shared-pickrow__media">{media}</span>}
      <span className="tx-shared-pickrow__text">
        <span className="tx-shared-pickrow__title">{title}</span>
        {second !== undefined && second !== null && second !== '' && (
          <span className="tx-shared-pickrow__meta">{second}</span>
        )}
      </span>
      {end !== undefined && <span className="tx-shared-pickrow__end">{end}</span>}
    </span>
  );
}

/**
 * One choosable row of a picker list: the whole row is the label of a native radio button
 * or checkbox, so a press anywhere on it chooses it and the keyboard works as the platform
 * does (arrow keys within a radio group, Space on a checkbox).
 */
export function PickRow(props: PickRowProps) {
  const { type, name, checked, onChange, disabled = false, testId, value } = props;
  const content = <RowContent {...props} />;
  if (type === 'checkbox') {
    return (
      <Checkbox
        className={cx('tx-shared-pickrow', disabled && 'tx-shared-pickrow--disabled')}
        checked={checked}
        disabled={disabled}
        value={value}
        data-testid={testId}
        onChange={(next) => {
          onChange(next);
        }}
        label={content}
      />
    );
  }
  return (
    <label className={cx('tx-shared-pickrow', disabled && 'tx-shared-pickrow--disabled')}>
      <span className="tx-shared-radio">
        <input
          type="radio"
          className="tx-shared-radio__input"
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          data-testid={testId}
          onChange={(event) => {
            if (event.target.checked) onChange(true);
          }}
        />
        <span className="tx-shared-radio__dot" aria-hidden="true" />
      </span>
      {content}
    </label>
  );
}

/** Rows that stand in for a picker list while it loads. */
export function PickRowSkeletons({ rows = 4 }: { readonly rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <span
          key={index}
          className="tx-shared-pickrow tx-shared-pickrow--skeleton"
          aria-hidden="true"
        >
          <span className="tx-skeleton tx-skeleton--circle tx-shared-pickrow__skeleton-mark" />
          <span className="tx-skeleton tx-skeleton--block tx-shared-pickrow__skeleton-media" />
          <span className="tx-shared-pickrow__text">
            <span className="tx-skeleton tx-shared-pickrow__skeleton-line" />
            <span className="tx-skeleton tx-shared-pickrow__skeleton-line tx-shared-pickrow__skeleton-line--short" />
          </span>
        </span>
      ))}
    </>
  );
}
