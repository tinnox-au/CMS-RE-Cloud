import { useRef, type InputHTMLAttributes } from 'react';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { Search, X } from './icons.ts';

export interface SearchFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'aria-label'
> {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The accessible name; say what is searched: "Search media". */
  readonly label: string;
  readonly className?: string;
}

/**
 * A pill-shaped search input with a leading icon and a clear button. Escape clears it.
 * It filters as the person types; there is no submit step.
 */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className,
  ...rest
}: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const clear = () => {
    onChange('');
    inputRef.current?.focus();
  };
  return (
    <span className={cx('tx-search', className)}>
      <Icon icon={Search} size={18} className="tx-search__icon" />
      <input
        {...rest}
        ref={inputRef}
        type="search"
        className="tx-search__input"
        aria-label={label}
        placeholder={placeholder ?? label}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          rest.onKeyDown?.(event);
          if (event.key === 'Escape' && value !== '') {
            // Escape first clears the query; only an empty field lets it reach a dialog.
            event.preventDefault();
            event.stopPropagation();
            onChange('');
          }
        }}
      />
      {value !== '' && (
        <button
          type="button"
          className="tx-search__clear"
          aria-label="Clear search"
          onClick={clear}
        >
          <Icon icon={X} size={14} />
        </button>
      )}
    </span>
  );
}
