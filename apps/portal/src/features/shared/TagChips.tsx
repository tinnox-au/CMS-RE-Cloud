import { countOf } from '../../lib/bulkOutcome.ts';
import { resolveTags, summariseTags } from '../../lib/tagColours.ts';
import { Chip, cx, Skeleton, Tooltip, VisuallyHidden } from '../../ui/index.ts';
import './shared.css';
import type { TagsResource } from './useTags.ts';

export interface TagChipsProps {
  /** The page's tags, from `useTags(scope)`. */
  readonly tags: TagsResource;
  /** `tagIds` of the media item or the screen. */
  readonly tagIds: readonly string[];
  /** How many chips before the rest fold into "+N". Default 2 (a table cell). */
  readonly max?: number;
  /** 24 px chips (`sm`, the default, for table cells) or 28 px (`md`). */
  readonly size?: 'sm' | 'md';
  /** Accessible name of the list. Default "Tags". */
  readonly label?: string;
  /** Default `shared-tag-chips`. */
  readonly testId?: string;
  readonly className?: string;
}

/**
 * The tags of one thing, read-only, in their colours and in name order, folding into "+N"
 * past `max`. Renders nothing for an item without tags. While the tag list is loading it
 * shows a placeholder; if the list could not be loaded it shows how many tags there are.
 */
export function TagChips({
  tags,
  tagIds,
  max = 2,
  size = 'sm',
  label = 'Tags',
  testId = 'shared-tag-chips',
  className,
}: TagChipsProps) {
  if (tagIds.length === 0) return null;

  if (tags.status === 'loading') {
    return (
      <span className={cx('tx-shared-tagchips', className)} data-testid={testId}>
        <Skeleton variant="pill" width="64px" height={size === 'sm' ? '24px' : '28px'} />
        <VisuallyHidden>Loading tags</VisuallyHidden>
      </span>
    );
  }
  if (tags.status === 'error') {
    return (
      <span className={cx('tx-shared-tagchips', className)} data-testid={testId}>
        <Chip size={size}>{countOf(tagIds.length, 'tag')}</Chip>
      </span>
    );
  }

  const resolved = resolveTags(tagIds, tags.byId);
  if (resolved.length === 0) return null;
  const { shown, hidden } = summariseTags(resolved, max);
  const hiddenNames = hidden.map((tag) => tag.name).join(', ');
  return (
    <ul
      className={cx('tx-shared-tagchips', className)}
      role="list"
      aria-label={label}
      data-testid={testId}
    >
      {shown.map((tag) => (
        <li key={tag.id} className="tx-shared-tagchips__item">
          <Chip colour={tag.colour} size={size}>
            {tag.name}
          </Chip>
        </li>
      ))}
      {hidden.length > 0 && (
        <li className="tx-shared-tagchips__more">
          <Tooltip content={hiddenNames}>
            <span className={cx('tx-chip', size === 'sm' && 'tx-chip--sm')}>
              <span aria-hidden="true">+{hidden.length}</span>
              <VisuallyHidden>
                and {hidden.length} more: {hiddenNames}
              </VisuallyHidden>
            </span>
          </Tooltip>
        </li>
      )}
    </ul>
  );
}
