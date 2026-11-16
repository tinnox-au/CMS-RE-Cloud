import { TAG_COLOURS, type TagColour } from '@tinnox/contracts';
import { useId } from 'react';
import { tagColourLabel } from '../../lib/tagColours.ts';
import { Check } from '../../ui/icons.ts';
import { cx, Icon } from '../../ui/index.ts';
import './settings.css';

export interface ColourSwatchesProps {
  readonly value: TagColour;
  readonly onChange: (colour: TagColour) => void;
  readonly disabled?: boolean;
  /** Puts first focus of a dialog on the chosen swatch ("Change colour"). */
  readonly autoFocus?: boolean;
  readonly testId?: string;
}

/**
 * The eight tag colours as a radio group: native radio buttons, so Tab reaches the group
 * once and the arrow keys move the choice. Each is named by its colour ("Teal"), and the
 * chosen one carries a tick and a ring as well as its colour.
 */
export function ColourSwatches({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  testId = 'settings-tag-form-colours',
}: ColourSwatchesProps) {
  const name = useId();
  const legendId = useId();
  return (
    <fieldset
      className="tx-settings-swatches"
      role="radiogroup"
      aria-labelledby={legendId}
      disabled={disabled}
      data-testid={testId}
    >
      <legend id={legendId} className="tx-settings-swatches__legend">
        Colour{' '}
        <span className="tx-settings-swatches__chosen" aria-hidden="true">
          {tagColourLabel(value)}
        </span>
      </legend>
      <div className="tx-settings-swatches__row">
        {TAG_COLOURS.map((colour) => (
          <label
            key={colour}
            className={cx('tx-settings-swatch', `tx-settings-colour--${colour}`)}
            title={tagColourLabel(colour)}
          >
            <input
              type="radio"
              className="tx-settings-swatch__input"
              name={name}
              value={colour}
              checked={value === colour}
              aria-label={tagColourLabel(colour)}
              data-autofocus={autoFocus && value === colour ? '' : undefined}
              data-testid={`${testId}-${colour}`}
              onChange={() => {
                onChange(colour);
              }}
            />
            <span className="tx-settings-swatch__dot" aria-hidden="true">
              <Icon icon={Check} size={14} />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
