import { isApiRequestError } from '../../api/client.ts';
import { toggleOne } from '../../lib/selection.ts';
import { ChevronDown, RefreshCw } from '../../ui/icons.ts';
import { Button, Chip, cx, Menu, MenuItem, Skeleton, SkeletonGroup } from '../../ui/index.ts';
import './shared.css';
import type { TagsResource } from './useTags.ts';

export interface TagFilterProps {
  /** The page's tags, from `useTags(scope)`. */
  readonly tags: TagsResource;
  /** The ids of the tags that are filtered on. */
  readonly selected: ReadonlySet<string>;
  readonly onChange: (selected: ReadonlySet<string>) => void;
  /** Accessible name of the group. Default "Filter by tag". */
  readonly label?: string;
  /** How many tags are shown as chips before the rest move into a "More tags" menu. Default 6. */
  readonly max?: number;
  /** Default `shared-tag-filter`. */
  readonly testId?: string;
  readonly className?: string;
}

/**
 * Filter chips for a list page, one per tag, any number selected. Put it in the filter row
 * and test rows with `matchesTagFilter(row.tagIds, selected)` from `lib/tagColours.ts`.
 *
 * With no tags it renders nothing. Past `max` tags the rest are in a "More tags" menu; a
 * selected tag is always shown as a chip, so what is filtered on is never hidden. If the
 * tags cannot be loaded it says so, with the API error code and a way to try again.
 */
export function TagFilter({
  tags,
  selected,
  onChange,
  label = 'Filter by tag',
  max = 6,
  testId = 'shared-tag-filter',
  className,
}: TagFilterProps) {
  if (tags.status === 'loading') {
    return (
      <SkeletonGroup label="Loading tags" className={cx('tx-shared-tagfilter', className)}>
        <Skeleton variant="pill" width="72px" height="28px" />
        <Skeleton variant="pill" width="88px" height="28px" />
        <Skeleton variant="pill" width="64px" height="28px" />
      </SkeletonGroup>
    );
  }
  if (tags.status === 'error') {
    return (
      <div className={cx('tx-shared-tagfilter', className)} role="alert" data-testid={testId}>
        <span className="tx-small tx-muted">
          The tags could not be loaded.{' '}
          {isApiRequestError(tags.error) && <span className="tx-code">{tags.error.code}</span>}
        </span>
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={tags.reload}>
          Try again
        </Button>
      </div>
    );
  }
  if (tags.tags.length === 0) return null;

  const limit = Math.max(1, Math.floor(max));
  const inline = tags.tags.filter((tag, index) => index < limit || selected.has(tag.id));
  const overflow = tags.tags.filter((tag, index) => index >= limit && !selected.has(tag.id));
  const toggle = (id: string) => {
    onChange(toggleOne(selected, id));
  };
  return (
    <div
      className={cx('tx-shared-tagfilter', className)}
      role="group"
      aria-label={label}
      data-testid={testId}
    >
      {inline.map((tag) => (
        <Chip
          key={tag.id}
          colour={tag.colour}
          selected={selected.has(tag.id)}
          onToggle={() => {
            toggle(tag.id);
          }}
        >
          {tag.name}
        </Chip>
      ))}
      {overflow.length > 0 && (
        <Menu
          label="More tags"
          trigger={(props) => (
            <Button {...props} size="sm" variant="ghost" trailingIcon={ChevronDown}>
              More tags ({overflow.length})
            </Button>
          )}
        >
          {overflow.map((tag) => (
            <MenuItem
              key={tag.id}
              type="checkbox"
              checked={false}
              onSelect={() => {
                toggle(tag.id);
              }}
            >
              {tag.name}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  );
}
