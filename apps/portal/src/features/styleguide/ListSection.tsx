import { useState } from 'react';
import { formatBytes, formatDurationMs } from '../../lib/format.ts';
import {
  applyListView,
  countLabel,
  DEFAULT_PAGE_SIZE,
  type SortAccessors,
  type SortState,
} from '../../lib/listView.ts';
import {
  Button,
  Chip,
  DataTable,
  EmptyState,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Meter,
  NameCell,
  Pagination,
  SearchField,
  Segmented,
  SelectionBar,
  SkeletonGroup,
  StatusPill,
  Thumb,
  Tile,
  TileGrid,
  TileSkeleton,
  useToast,
  VisuallyHidden,
  type DataTableColumn,
  type StatusTone,
} from '../../ui/index.ts';
import {
  Ellipsis,
  Eye,
  Film,
  FolderInput,
  Image,
  Images,
  LayoutGrid,
  List,
  ListPlus,
  Plus,
  RefreshCw,
  SearchX,
  Tags,
  Trash,
} from '../../ui/icons.ts';
import {
  DEMO_MEDIA,
  DEMO_STORAGE,
  DEMO_TAGS,
  useDemoArt,
  type DemoMedia,
  type DemoMediaStatus,
} from './demoData.ts';
import { Demo, Section } from './Section.tsx';

type DemoState = 'rows' | 'loading' | 'empty';
type View = 'list' | 'grid';

const STATUSES: readonly DemoMediaStatus[] = ['ready', 'processing', 'failed'];

const STATUS_LABEL: { readonly [K in DemoMediaStatus]: string } = {
  ready: 'Ready',
  processing: 'Processing',
  failed: 'Failed',
};

const STATUS_TONE: { readonly [K in DemoMediaStatus]: StatusTone } = {
  ready: 'ok',
  processing: 'warn',
  failed: 'danger',
};

const FILTER_TAGS = DEMO_TAGS.slice(0, 5);
const TAG_BY_ID = new Map(DEMO_TAGS.map((tag) => [tag.id, tag]));

const SORT_ACCESSORS: SortAccessors<DemoMedia> = {
  name: (item) => item.name,
  size: (item) => item.bytes,
  modified: (item) => new Date(item.modifiedAt),
};

const modifiedFormat = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

function dimensions(item: DemoMedia): string {
  return `${item.width} × ${item.height}`;
}

function toggled(set: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

function RowMenu({ item }: { readonly item: DemoMedia }) {
  const toast = useToast();
  const sample = (action: string) => () => {
    toast.info(`Style guide only: "${action}" does nothing here.`);
  };
  return (
    <Menu
      placement="bottom-end"
      trigger={(props) => (
        <IconButton {...props} icon={Ellipsis} label={`Actions for ${item.name}`} />
      )}
    >
      <MenuItem icon={Eye} onSelect={sample('Open')}>
        Open
      </MenuItem>
      <MenuItem
        icon={ListPlus}
        onSelect={sample('Add to playlist')}
        disabled={item.status !== 'ready'}
      >
        Add to playlist
      </MenuItem>
      <MenuItem icon={FolderInput} onSelect={sample('Move to folder')}>
        Move to folder
      </MenuItem>
      <MenuItem icon={Tags} onSelect={sample('Edit tags')}>
        Edit tags
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={Trash} tone="danger" onSelect={sample('Delete')}>
        Delete
      </MenuItem>
    </Menu>
  );
}

function TagChips({ item }: { readonly item: DemoMedia }) {
  if (item.tagIds.length === 0) return <span className="tx-muted">None</span>;
  return (
    <span className="tx-cluster">
      {item.tagIds.map((id) => {
        const tag = TAG_BY_ID.get(id);
        return tag === undefined ? null : (
          <Chip key={id} size="sm" colour={tag.colour}>
            {tag.name}
          </Chip>
        );
      })}
    </span>
  );
}

export function ListSection() {
  const toast = useToast();
  const art = useDemoArt(DEMO_MEDIA.length);
  const [demoState, setDemoState] = useState<DemoState>('rows');
  const [view, setView] = useState<View>('list');
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<ReadonlySet<string>>(new Set());
  const [tags, setTags] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<SortState | null>({ columnId: 'modified', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const loading = demoState === 'loading';
  const source = demoState === 'rows' ? DEMO_MEDIA : [];
  const filtering = query.trim() !== '' || statuses.size > 0 || tags.size > 0;

  const list = applyListView(source, {
    search: { query, texts: (item) => [item.name, item.fileName] },
    filters: [
      (item) => statuses.size === 0 || statuses.has(item.status),
      (item) => tags.size === 0 || item.tagIds.some((id) => tags.has(id)),
    ],
    sort,
    accessors: SORT_ACCESSORS,
    page,
    pageSize,
  });

  const clearFilters = () => {
    setQuery('');
    setStatuses(new Set());
    setTags(new Set());
    setPage(1);
  };

  const preview = (item: DemoMedia): string | null =>
    item.status === 'ready' ? (art[item.art] ?? null) : null;

  const columns: readonly DataTableColumn<DemoMedia>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      grow: true,
      cell: (item) => (
        <NameCell
          name={item.name}
          to={`/media/${item.id}`}
          meta={item.fileName}
          media={<Thumb size="sm" kind={item.kind} src={preview(item)} />}
        />
      ),
    },
    {
      id: 'kind',
      header: 'Kind',
      priority: 2,
      nowrap: true,
      cell: (item) => (
        <>
          <Icon icon={item.kind === 'video' ? Film : Image} size={16} />{' '}
          {item.kind === 'video' ? 'Video' : 'Image'}
        </>
      ),
    },
    {
      id: 'details',
      header: 'Details',
      priority: 3,
      numeric: true,
      cell: (item) => (
        <>
          {dimensions(item)}
          {item.durationMs !== null && (
            <span className="tx-muted">, {formatDurationMs(item.durationMs)}</span>
          )}
        </>
      ),
    },
    {
      id: 'size',
      header: 'Size',
      sortable: true,
      numeric: true,
      align: 'end',
      priority: 4,
      cell: (item) => formatBytes(item.bytes),
    },
    {
      id: 'tags',
      header: 'Tags',
      priority: 3,
      width: '168px',
      cell: (item) => <TagChips item={item} />,
    },
    {
      id: 'modified',
      header: 'Modified',
      sortable: true,
      numeric: true,
      priority: 2,
      cell: (item) => modifiedFormat.format(new Date(item.modifiedAt)),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (item) => (
        <StatusPill tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</StatusPill>
      ),
    },
  ];

  const empty = filtering ? (
    <EmptyState
      variant="inline"
      icon={SearchX}
      title="Nothing matches"
      action={
        <Button variant="secondary" onClick={clearFilters}>
          Clear filters
        </Button>
      }
    >
      No media fits the search and filters that are set.
    </EmptyState>
  ) : (
    <EmptyState
      variant="inline"
      icon={Images}
      title="No media yet"
      action={
        <Button variant="primary" icon={Plus}>
          Add media
        </Button>
      }
    >
      Upload images and videos to build playlists from them.
    </EmptyState>
  );

  const pagination = (
    <Pagination
      info={list.info}
      onPageChange={setPage}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
    />
  );

  const bulk = (action: string) => () => {
    toast.info(`Style guide only: "${action}" was not applied to ${countLabel(selected.size)}.`);
  };

  return (
    <Section
      id="lists"
      title="List page"
      lead="Every list uses the same parts, top to bottom: a filter row with the create button at its end, a toolbar, one table surface with hairline rows, and pagination. Ticking rows brings up the selection bar."
    >
      <Demo
        title="The pattern, with 23 synthetic rows"
        layout="page"
        note="Columns leave by priority when they no longer fit, before the table scrolls sideways: Size first, then Details and Tags, then Kind and Modified. Widen or narrow the window to see it. Shift-click a checkbox to select a range."
      >
        <div className="tx-cluster">
          <Segmented
            label="State shown"
            size="sm"
            value={demoState}
            onChange={(next) => {
              setDemoState(next);
              setSelected(new Set());
              setPage(1);
            }}
            options={[
              { value: 'rows', label: 'With rows' },
              { value: 'loading', label: 'Loading' },
              { value: 'empty', label: 'Empty' },
            ]}
          />
        </div>

        <div className="tx-filter-row">
          <div className="tx-filter-row__filters">
            <SearchField
              label="Search media"
              value={query}
              onChange={(next) => {
                setQuery(next);
                setPage(1);
              }}
            />
            <div className="tx-cluster" role="group" aria-label="Status">
              {STATUSES.map((status) => (
                <Chip
                  key={status}
                  selected={statuses.has(status)}
                  onToggle={(on) => {
                    setStatuses(toggled(statuses, status, on));
                    setPage(1);
                  }}
                >
                  {STATUS_LABEL[status]}
                </Chip>
              ))}
            </div>
            <div className="tx-cluster" role="group" aria-label="Tags">
              {FILTER_TAGS.map((tag) => (
                <Chip
                  key={tag.id}
                  colour={tag.colour}
                  selected={tags.has(tag.id)}
                  onToggle={(on) => {
                    setTags(toggled(tags, tag.id, on));
                    setPage(1);
                  }}
                >
                  {tag.name}
                </Chip>
              ))}
            </div>
          </div>
          <div className="tx-filter-row__end">
            <Button variant="primary" icon={Plus}>
              Add media
            </Button>
          </div>
        </div>

        <div className="tx-toolbar">
          <span className="tx-toolbar__count" aria-live="polite">
            {loading
              ? 'Loading'
              : filtering
                ? `${list.matched.length} of ${countLabel(list.total)}`
                : countLabel(list.total)}
          </span>
          <div className="tx-toolbar__end">
            <Meter
              variant="inline"
              label="Storage"
              value={DEMO_STORAGE.usedBytes}
              max={DEMO_STORAGE.limitBytes}
              valueText={`${formatBytes(DEMO_STORAGE.usedBytes)} of ${formatBytes(DEMO_STORAGE.limitBytes)}`}
            />
            <Segmented
              label="View"
              iconOnly
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: 'List', icon: List },
                { value: 'grid', label: 'Grid', icon: LayoutGrid },
              ]}
            />
            <IconButton
              icon={RefreshCw}
              label="Refresh"
              onClick={() => {
                toast.info('Style guide only: there is nothing to refresh.');
              }}
            />
          </div>
        </div>

        {view === 'list' ? (
          <DataTable
            caption="Media"
            columns={columns}
            rows={list.rows}
            rowId={(item) => item.id}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            selection={{
              selected,
              onChange: setSelected,
              rowLabel: (item) => item.name,
            }}
            rowActions={(item) => <RowMenu item={item} />}
            loading={loading}
            empty={empty}
            footer={list.matched.length > 0 ? pagination : undefined}
          />
        ) : loading ? (
          <SkeletonGroup label="Loading media">
            <TileGrid label="Media">
              {Array.from({ length: 8 }, (_, index) => (
                <TileSkeleton key={index} />
              ))}
            </TileGrid>
          </SkeletonGroup>
        ) : list.rows.length === 0 ? (
          <div className="tx-card tx-card--flush">{empty}</div>
        ) : (
          <>
            <TileGrid label="Media">
              {list.rows.map((item) => (
                <Tile
                  key={item.id}
                  name={item.name}
                  to={`/media/${item.id}`}
                  media={<Thumb kind={item.kind} src={preview(item)} />}
                  meta={
                    <>
                      <span className="tx-num">{formatBytes(item.bytes)}</span>
                      {item.status !== 'ready' && (
                        <StatusPill tone={STATUS_TONE[item.status]}>
                          {STATUS_LABEL[item.status]}
                        </StatusPill>
                      )}
                    </>
                  }
                  actions={<RowMenu item={item} />}
                  selection={{
                    selected: selected.has(item.id),
                    label: item.name,
                    onChange: (on) => {
                      setSelected(toggled(selected, item.id, on));
                    },
                  }}
                />
              ))}
            </TileGrid>
            {pagination}
          </>
        )}

        <SelectionBar
          count={selected.size}
          onClear={() => {
            setSelected(new Set());
          }}
        >
          <Button variant="ghost" size="sm" icon={FolderInput} onClick={bulk('Move to folder')}>
            Move to folder
          </Button>
          <Button variant="ghost" size="sm" icon={Tags} onClick={bulk('Add tags')}>
            Add tags
          </Button>
          <Button variant="danger" size="sm" icon={Trash} onClick={bulk('Delete')}>
            Delete
          </Button>
        </SelectionBar>
      </Demo>

      <Demo
        title="Compact density"
        layout="page"
        note="48 px rows, for the audit log and for tables inside dialogs."
      >
        <DataTable
          caption="Recent activity"
          density="compact"
          columns={[
            {
              id: 'time',
              header: 'Time',
              numeric: true,
              cell: (item: DemoMedia) => modifiedFormat.format(new Date(item.modifiedAt)),
            },
            {
              id: 'action',
              header: 'Action',
              grow: true,
              cell: (item: DemoMedia) => (
                <>
                  Media uploaded: {item.name} <VisuallyHidden>,</VisuallyHidden>{' '}
                  <span className="tx-mono tx-muted">media.create</span>
                </>
              ),
            },
            {
              id: 'result',
              header: 'Result',
              cell: (item: DemoMedia) => (
                <StatusPill tone={item.status === 'failed' ? 'danger' : 'ok'}>
                  {item.status === 'failed' ? 'Refused' : 'Done'}
                </StatusPill>
              ),
            },
          ]}
          rows={DEMO_MEDIA.slice(8, 12)}
          rowId={(item) => item.id}
        />
      </Demo>
    </Section>
  );
}
