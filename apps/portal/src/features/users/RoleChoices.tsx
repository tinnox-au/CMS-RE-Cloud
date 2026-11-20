import type { Role } from '@tinnox/contracts';
import { ROLE_LABELS } from '@tinnox/domain';
import { useId, type ReactNode } from 'react';
import { ROLE_DESCRIPTIONS, type RoleChoice } from '../../lib/users.ts';
import { StatusPill } from '../../ui/index.ts';
import './users.css';

export interface RoleChoicesProps {
  readonly choices: readonly RoleChoice[];
  readonly value: Role;
  readonly onChange: (role: Role) => void;
  /** The form is saving. */
  readonly disabled?: boolean;
  /** Each card gets `<testIdPrefix><role>`. */
  readonly testIdPrefix: string;
  /** A line under the cards. */
  readonly note?: ReactNode;
}

/**
 * The roles as a group of native radio buttons drawn as cards (as `CreateAppDialog`): one tab
 * stop, the arrow keys move the choice, Space or Enter picks the focused card. Each card
 * carries the role's one line; a role that cannot be given yet stays visible, disabled, with
 * its reason. The current role is marked "Current".
 */
export function RoleChoices({
  choices,
  value,
  onChange,
  disabled = false,
  testIdPrefix,
  note,
}: RoleChoicesProps) {
  const name = useId();
  return (
    <fieldset className="tx-users-roles">
      <legend className="tx-field__label">Role</legend>
      <div className="tx-users-roles__grid">
        {choices.map((choice) => {
          const id = `${name}-${choice.role}`;
          // The label wraps the card for clicks; the name is the role (and "Current"), the
          // description its line and any reason, so nothing is read twice.
          const labelIds = choice.current ? `${id}-label ${id}-current` : `${id}-label`;
          const describedBy =
            choice.disabledReason === null ? `${id}-text` : `${id}-text ${id}-reason`;
          return (
            <label
              key={choice.role}
              className="tx-users-role"
              data-testid={`${testIdPrefix}${choice.role}`}
            >
              <input
                type="radio"
                name={name}
                value={choice.role}
                className="tx-visually-hidden"
                checked={value === choice.role}
                disabled={disabled || choice.disabledReason !== null}
                // The dialog opens on the chosen role, never on a role one key press away.
                data-autofocus={value === choice.role || undefined}
                aria-labelledby={labelIds}
                aria-describedby={describedBy}
                onChange={() => {
                  onChange(choice.role);
                }}
                onKeyDown={(event) => {
                  // Enter picks the card instead of submitting the form.
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  onChange(choice.role);
                }}
              />
              <span id={`${id}-label`} className="tx-users-role__label">
                {ROLE_LABELS[choice.role]}
              </span>
              {choice.current && (
                <span id={`${id}-current`} className="tx-users-role__current">
                  <StatusPill tone="neutral">Current</StatusPill>
                </span>
              )}
              <span id={`${id}-text`} className="tx-users-role__text">
                {ROLE_DESCRIPTIONS[choice.role]}
              </span>
              {choice.disabledReason !== null && (
                <span id={`${id}-reason`} className="tx-users-role__reason">
                  {choice.disabledReason}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {note !== undefined && <p className="tx-users__note">{note}</p>}
    </fieldset>
  );
}
