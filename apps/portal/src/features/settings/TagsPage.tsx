import type { TagDto, TagScope } from '@tinnox/contracts';
import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import {
  applyListView,
  countLabel,
  DEFAULT_PAGE_SIZE,
  type SortState,
} from '../../lib/listView.ts';
import {
  parseTagScope,
  tagItemsPath,
  tagScopeWords,
  tagsOfScope,
  tagUsageLabel,
} from '../../lib/settingsView.ts';
import { tagColourLabel } from '../../lib/tagColours.ts';
import { elementByTestId, rowByTestId } from '../shared/index.ts';
import { useCan } from '../../session/AuthenticatedSession.tsx';
import { Page } from '../../shell/Page.tsx';
import {
  Ellipsis,
  Images,
  Monitor,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  SearchX,
  Tags,
  Trash,
} from '../../ui/icons.ts';
import {
  Breadcrumb,
  Button,
  Card,
  Chip,
  cx,
  DataTable,
  EmptyState,
  ErrorNotice,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Pagination,
  SearchField,
  TabPanel,
  Tabs,
  type DataTableColumn,
  type TabItem,
} from '../../ui/index.ts';
import { DeleteTagDialog } from './DeleteTagDialog.tsx';
import { FoldersOverview } from './FoldersOverview.tsx';
import { TagFormDialog, type TagFormTarget } from './TagFormDialog.tsx';
import './settings.css';

const DEFAULT_SORT: SortState = { columnId: 'name', direction: 'asc' };

const SORT_ACCESSORS = {
  name: (tag: TagDto) => tag.name,
  colour: (tag: TagDto) => tagColourLabel(tag.colour),
  usage: (tag: TagDto) => tag.usageCount,
};

/**
 * Tags (docs/portal-v2/stage-a.md, section 3.10): media tags and screen tags on two tabs
 * (`?scope=media` or `?scope=display`), each a list with the tag in its colour and how many
 * items carry it. Tags are created, renamed, recoloured and deleted here. Folders are
 * managed in the media library and listed below, read-only, with their file counts.
 */
export function TagsPage() {
  const [params, setParams] = useSearchParams();
  const scope = parseTagScope(params.get('scope'));
  const words = tagScopeWords(scope);
  // Media tags are content (content.write, content.delete); screen tags are screen set-up.
  const canWriteContent = useCan('content.write');
  const canDeleteContent = useCan('content.delete');
  const canSetUpScreens = useCan('screen.setup');
  const canEdit = scope === 'media' ? canWriteContent : canSetUpScreens;
  const canDelete = scope === 'media' ? canDeleteContent : canSetUpScreens;

  const loadTags = useCallback((signal: AbortSignal) => api.listTags(undefined, signal), []);
  const { state, reload } = useLoad<TagDto[]>(loadTags);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [formTarget, setFormTarget] = useState<TagFormTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TagDto | null>(null);

  const allTags = useMemo(() => (state.status === 'ready' ? state.data : []), [state]);
  const scopeTags = useMemo(() => tagsOfScope(allTags, scope), [allTags, scope]);
  const list = applyListView(scopeTags, {
    search: { query, texts: (tag) => [tag.name, tagColourLabel(tag.colour)] },
    sort,
    accessors: SORT_ACCESSORS,
    page,
    pageSize,
  });

  const changeScope = (next: TagScope) => {
    if (next === scope) return;
    setQuery('');
    setPage(1);
    setSort(DEFAULT_SORT);
    setParams(
      () => {
        // The address as it is now: React Router's `previous` is the last rendered one.
        const nextParams = new URLSearchParams(window.location.search);
        nextParams.set('scope', next);
        return nextParams;
      },
      { replace: true },
    );
  };

  const counts = (target: TagScope): string | undefined =>
    state.status === 'ready' ? String(tagsOfScope(allTags, target).length) : undefined;
  const tabs: readonly TabItem<TagScope>[] = [
    { id: 'media', label: 'Media tags', icon: Images, note: counts('media') },
    { id: 'display', label: 'Screen tags', icon: Monitor, note: counts('display') },
  ];

  const openCreate = () => {
    setFormTarget({ mode: 'create', scope });
  };

  const newButton = (size: 'md' | 'lg') => (
    <Button
      variant="primary"
      size={size}
      icon={Plus}
      onClick={openCreate}
      data-testid="settings-tags-new"
    >
      New tag
    </Button>
  );

  const columns: readonly DataTableColumn<TagDto>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      grow: true,
      cell: (tag) => (
        <span className="tx-settings-tags__name">
          <Chip colour={tag.colour} className="tx-settings-tags__chip">
            {tag.name}
          </Chip>
        </span>
      ),
    },
    {
      id: 'colour',
      header: 'Colour',
      sortable: true,
      width: '140px',
      priority: 3,
      cell: (tag) => (
        <span className={cx('tx-settings-tags__colour', `tx-settings-colour--${tag.colour}`)}>
          <span className="tx-settings-dot" aria-hidden="true" />
          {tagColourLabel(tag.colour)}
        </span>
      ),
    },
    {
      id: 'usage',
      header: 'Used on',
      sortable: true,
      numeric: true,
      align: 'end',
      width: '140px',
      priority: 2,
      cell: (tag) => {
        const label = tagUsageLabel(tag.scope, tag.usageCount);
        const path = tagItemsPath(tag);
        if (tag.usageCount === 0) return <span className="tx-settings-tags__unused">{label}</span>;
        return path === null ? (
          label
        ) : (
          <Link to={path} data-testid="settings-tag-usage-link">
            {label}
            <span className="tx-visually-hidden"> with the tag {tag.name}</span>
          </Link>
        );
      },
    },
  ];

  const rowActions = (tag: TagDto) => {
    const path = tagItemsPath(tag);
    const showFiles = path !== null && tag.usageCount > 0;
    if (!canEdit && !canDelete && !showFiles) return null;
    return (
      <Menu
        placement="bottom-end"
        trigger={(props) => (
          <IconButton
            {...props}
            icon={Ellipsis}
            label={`Actions for tag ${tag.name}`}
            data-testid="settings-tag-actions"
          />
        )}
      >
        {canEdit && (
          <MenuItem
            icon={Pencil}
            onSelect={() => {
              setFormTarget({ mode: 'edit', tag, focus: 'name' });
            }}
          >
            Rename
          </MenuItem>
        )}
        {canEdit && (
          <MenuItem
            icon={Palette}
            onSelect={() => {
              setFormTarget({ mode: 'edit', tag, focus: 'colour' });
            }}
          >
            Change colour
          </MenuItem>
        )}
        {showFiles && path !== null && (
          <MenuItem icon={Images} to={path}>
            Show files
          </MenuItem>
        )}
        {canDelete && (canEdit || showFiles) && <MenuSeparator />}
        {canDelete && (
          <MenuItem
            icon={Trash}
            tone="danger"
            onSelect={() => {
              setDeleteTarget(tag);
            }}
          >
            Delete
          </MenuItem>
        )}
      </Menu>
    );
  };

  const noMatch = (
    <EmptyState
      variant="inline"
      icon={SearchX}
      title={`No ${words.tag} matches`}
      action={
        <Button
          onClick={() => {
            setQuery('');
            setPage(1);
          }}
        >
          Clear search
        </Button>
      }
    >
      No {words.tag} has those words in its name or colour.
    </EmptyState>
  );

  let panel;
  if (state.status === 'error') {
    panel = (
      <ErrorNotice error={state.error} title="The tags could not be loaded" onRetry={reload} />
    );
  } else if (state.status === 'ready' && scopeTags.length === 0) {
    panel = (
      <Card flush>
        <EmptyState
          icon={Tags}
          title={`No ${words.tag}s yet`}
          action={canEdit ? newButton('lg') : undefined}
          level={3}
        >
          {!canEdit
            ? 'An editor adds tags.'
            : scope === 'media'
              ? 'Media tags label files in the library, so they can be found and filtered.'
              : 'Screen tags label screens, so a group of them can be found and filtered.'}
        </EmptyState>
      </Card>
    );
  } else {
    const searching = query.trim() !== '';
    panel = (
      <div className="tx-stack">
        <div className="tx-filter-row">
          <div className="tx-filter-row__filters">
            <SearchField
              label={`Search ${words.tag}s`}
              value={query}
              onChange={(next) => {
                setQuery(next);
                setPage(1);
              }}
              data-testid="settings-tags-search"
            />
          </div>
          {canEdit && <div className="tx-filter-row__end">{newButton('md')}</div>}
        </div>
        <div className="tx-toolbar">
          <p className="tx-toolbar__count" aria-live="polite" data-testid="settings-tags-count">
            {state.status === 'ready'
              ? searching
                ? `${list.matched.length} of ${countLabel(scopeTags.length, 'tag')}`
                : countLabel(scopeTags.length, 'tag')
              : ''}
          </p>
          <div className="tx-toolbar__end">
            <IconButton
              icon={RefreshCw}
              label="Refresh tags"
              onClick={reload}
              data-testid="settings-tags-refresh"
            />
          </div>
        </div>
        <DataTable
          caption={words.title}
          columns={columns}
          rows={list.rows}
          rowId={(tag) => tag.id}
          sort={sort}
          onSortChange={(next) => {
            setSort(next);
            setPage(1);
          }}
          // Screen tags have no "Show files": without the scope's keys there is no menu at all.
          rowActions={canEdit || canDelete || scope === 'media' ? rowActions : undefined}
          loading={state.status === 'loading'}
          loadingRows={4}
          empty={noMatch}
          rowTestId={(tag) => `settings-tag-row-${tag.id}`}
          footer={
            list.matched.length > DEFAULT_PAGE_SIZE ? (
              <Pagination
                info={list.info}
                label={`${words.title} pages`}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            ) : undefined
          }
          density="compact"
          className="tx-settings-tags__table"
        />
      </div>
    );
  }

  return (
    <Page title="Tags">
      <div className="tx-settings-tags" data-testid="settings-tags-page">
        <Breadcrumb items={[{ label: 'Settings', to: '/settings' }, { label: 'Tags' }]} />
        {state.status === 'ready' && state.refreshError !== null && (
          <ErrorNotice
            error={state.refreshError}
            title="The tags could not be refreshed"
            onRetry={reload}
          />
        )}
        <div>
          <Tabs
            id="settings-tags"
            label="Kinds of tag"
            tabs={tabs}
            value={scope}
            onChange={changeScope}
            className="tx-settings-tags__tabs"
          />
          <TabPanel tabs="settings-tags" tab={scope} className="tx-settings-tags__panel">
            {/* The panel's section heading, so its h3s nest under it rather than under the h1. */}
            <h2 className="tx-visually-hidden">{words.title}</h2>
            {panel}
          </TabPanel>
        </div>
        <FoldersOverview />
      </div>
      <TagFormDialog
        target={formTarget}
        tags={allTags}
        onClose={() => {
          setFormTarget(null);
        }}
        onSaved={reload}
      />
      <DeleteTagDialog
        tag={deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
        }}
        onDeleted={reload}
        rowFocus={{
          mode: 'row',
          order: list.rows.map((tag) => tag.id),
          row: rowByTestId('settings-tag-row-'),
          primary: elementByTestId('settings-tags-new'),
        }}
      />
    </Page>
  );
}
