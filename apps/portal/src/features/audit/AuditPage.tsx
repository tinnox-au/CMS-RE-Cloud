import type { AuditEventDto, AuditListResponse, AuditResult } from '@tinnox/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import {
  AUDIT_CATEGORY_OPTIONS,
  AUDIT_RESULT_OPTIONS,
  appendOlderAuditPage,
  auditActionLabel,
  auditActorLabel,
  auditAllTargets,
  auditCountLabel,
  auditDetailsButtonLabel,
  auditDetailSummary,
  auditDetailSummaryParts,
  auditFilterKey,
  auditSearchCountLabel,
  auditSearchTexts,
  auditSubject,
  auditTime,
  isAuditFiltered,
  parseAuditCategory,
  parseAuditResult,
  presentAuditResult,
  shortAuditId,
  type AuditFilter,
  type AuditOlderPages,
  type AuditTargetKind,
} from '../../lib/auditView.ts';
import { matchesSearch } from '../../lib/listView.ts';
import { Page } from '../../shell/Page.tsx';
import { ChevronDown, Eye, Funnel, RefreshCw, ScrollText, SearchX, X } from '../../ui/icons.ts';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorNotice,
  Icon,
  IconButton,
  SearchField,
  Segmented,
  Select,
  StatusPill,
  type DataTableColumn,
} from '../../ui/index.ts';
import { AuditDetailDialog } from './AuditDetailDialog.tsx';
import { AuditPlainObject, AuditTargetLine } from './AuditObject.tsx';
import { RESULT_ICONS } from './resultIcons.ts';
import { useAuditNames } from './useAuditNames.ts';
import './audit.css';

/** Events per request, as in M0. */
const PAGE_SIZE = 50;

type ResultChoice = 'all' | AuditResult;

const RESULT_CHOICES: readonly { value: ResultChoice; label: string }[] = [
  { value: 'all', label: 'All results' },
  ...AUDIT_RESULT_OPTIONS,
];

interface FirstPage {
  readonly key: string;
  readonly page: AuditListResponse;
}

type Older = AuditOlderPages<AuditEventDto>;

/**
 * The audit log (docs/portal-v2/stage-a.md, section 3.10): the organisation's security and
 * operational events, newest first, filtered by category and result (the API's `category`
 * and `result` parameters, kept in the address). Each row says what happened in plain words
 * and keeps the raw action as text. "Load older events" pages back with the API's cursor and
 * keeps the filter, as in M0. Records cannot be changed from the portal.
 */
export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const filter: AuditFilter = useMemo(
    () => ({
      category: parseAuditCategory(params.get('category')),
      result: parseAuditResult(params.get('result')),
    }),
    [params],
  );
  const key = auditFilterKey(filter);

  const load = useCallback(
    async (signal: AbortSignal): Promise<FirstPage> => {
      const page = await api.listAudit(
        {
          limit: PAGE_SIZE,
          ...(filter.category === null ? {} : { category: filter.category }),
          ...(filter.result === null ? {} : { result: filter.result }),
        },
        signal,
      );
      return { key: auditFilterKey(filter), page };
    },
    [filter],
  );
  const { state, reload } = useLoad(load);
  const [older, setOlder] = useState<Older | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<{ key: string; error: unknown } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [detail, setDetail] = useState<AuditEventDto | null>(null);
  const [query, setQuery] = useState('');
  // The first page that "Load older events" continues: every Refresh and filter change starts
  // a new one, and an older page read for an earlier one is dropped (appendOlderAuditPage).
  const pageGeneration = useRef(0);
  const moreRequest = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      moreRequest.current?.abort();
    },
    [],
  );

  // The first page shown belongs to the current filter only once it has arrived for it.
  const first = state.status === 'ready' && state.data.key === key ? state.data.page : null;
  const switching = state.status === 'ready' && state.data.key !== key;
  // Reading the events of a new filter failed: the events on screen belong to the old one.
  const switchError = switching && state.refreshError !== null ? state.refreshError : null;
  // A Refresh or filter change clears the older events at once (startNewFirstPage).
  const olderNow = older !== null && older.key === key ? older : null;
  const events = useMemo(
    () => (first === null ? [] : [...first.items, ...(olderNow?.items ?? [])]),
    [first, olderNow],
  );
  const nextBefore = olderNow !== null ? olderNow.nextBefore : (first?.nextBefore ?? null);

  const kinds = useMemo(() => {
    const needed = new Set<AuditTargetKind>();
    for (const event of events)
      for (const target of auditAllTargets(event)) needed.add(target.kind);
    return [...needed].sort();
  }, [events]);
  const kindsKey = kinds.join(',');
  // A stable array while the same kinds are needed, so the names are not asked for again.
  const stableKinds = useMemo(
    () => (kindsKey === '' ? [] : kindsKey.split(',')) as AuditTargetKind[],
    [kindsKey],
  );
  const names = useAuditNames(stableKinds, generation);

  const searching = query.trim() !== '';
  const shown = useMemo(
    () =>
      searching
        ? events.filter((event) => matchesSearch(auditSearchTexts(event, names), query))
        : events,
    [events, names, query, searching],
  );

  /** Forgets the older events: the next first page starts a new run of "Load older events". */
  const startNewFirstPage = () => {
    pageGeneration.current += 1;
    moreRequest.current?.abort();
    moreRequest.current = null;
    setOlder(null);
    setMoreBusy(false);
    setMoreError(null);
  };

  /** Changes the given filters only, on the address as it is now (not as last rendered). */
  const setFilter = (change: Partial<AuditFilter>) => {
    startNewFirstPage();
    setParams(
      () => {
        // The address as it is now: React Router's `previous` is the last rendered one.
        const nextParams = new URLSearchParams(window.location.search);
        for (const name of ['category', 'result'] as const) {
          if (!(name in change)) continue;
          const value = change[name];
          if (value === null || value === undefined) nextParams.delete(name);
          else nextParams.set(name, value);
        }
        return nextParams;
      },
      { replace: true },
    );
  };

  const refresh = () => {
    startNewFirstPage();
    setGeneration((value) => value + 1);
    reload();
  };

  const loadMore = () => {
    if (nextBefore === null || moreBusy) return;
    const request = { key, generation: pageGeneration.current };
    const controller = new AbortController();
    moreRequest.current = controller;
    const current = () => pageGeneration.current === request.generation;
    setMoreBusy(true);
    setMoreError(null);
    api
      .listAudit(
        {
          limit: PAGE_SIZE,
          before: nextBefore,
          ...(filter.category === null ? {} : { category: filter.category }),
          ...(filter.result === null ? {} : { result: filter.result }),
        },
        controller.signal,
      )
      .then((page) => {
        setOlder((previous) =>
          appendOlderAuditPage(previous, request, pageGeneration.current, page),
        );
      })
      .catch((error: unknown) => {
        if (current()) setMoreError({ key: request.key, error });
      })
      .finally(() => {
        if (!current()) return;
        moreRequest.current = null;
        setMoreBusy(false);
      });
  };

  const columns: readonly DataTableColumn<AuditEventDto>[] = [
    {
      id: 'time',
      header: 'Time',
      nowrap: true,
      cell: (event) => {
        const time = auditTime(event.occurredAt);
        return (
          <time
            className="tx-audit-time"
            dateTime={time.iso ?? undefined}
            title={`${time.utc}\n${time.local}`}
          >
            <span className="tx-audit-time__date">{time.date}</span>
            <span className="tx-audit-time__clock">{time.time}</span>
            <span className="tx-visually-hidden">, exactly {time.utc}</span>
          </time>
        );
      },
    },
    {
      id: 'action',
      header: 'Action',
      grow: true,
      cell: (event) => (
        <span className="tx-audit-action">
          <span className="tx-audit-action__words">{auditActionLabel(event)}</span>
          <code className="tx-audit-raw" data-testid="audit-raw-action">
            {event.action}
          </code>
        </span>
      ),
    },
    {
      id: 'result',
      header: 'Result',
      nowrap: true,
      cell: (event) => {
        const result = presentAuditResult(event.result);
        // On a phone the pill keeps its icon and its words for screen readers (audit.css).
        return (
          <StatusPill
            tone={result.tone}
            icon={RESULT_ICONS[event.result]}
            className="tx-audit-result"
          >
            <span className="tx-audit-result__label">{result.label}</span>
          </StatusPill>
        );
      },
    },
    {
      id: 'actor',
      header: 'Actor',
      width: '140px',
      priority: 3,
      cell: (event) => (
        <span className="tx-audit-object">
          <span className="tx-audit-object__name">{auditActorLabel(event.actorType)}</span>
          {event.actorId !== null && (
            <span className="tx-audit-object__meta">
              <span className="tx-mono" title={event.actorId}>
                {shortAuditId(event.actorId)}
              </span>
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'object',
      header: 'Object',
      width: '200px',
      priority: 2,
      cell: (event) => {
        const subject = auditSubject(event);
        return subject === null ? (
          <AuditPlainObject event={event} />
        ) : (
          <AuditTargetLine target={subject} names={names} event={event} />
        );
      },
    },
    {
      id: 'detail',
      header: 'Detail',
      width: '220px',
      priority: 4,
      cell: (event) => {
        const parts = auditDetailSummaryParts(event.detail, 120);
        return parts.length === 0 ? (
          <span className="tx-audit-none">
            <span aria-hidden="true">–</span>
            <span className="tx-visually-hidden">No detail</span>
          </span>
        ) : (
          <span className="tx-audit-summary" title={auditDetailSummary(event.detail, 120)}>
            {parts.map((part, index) => (
              // The separator ends the entry before it, so a line never starts with one.
              <span key={index}>
                {index > 0 && ' '}
                <span className="tx-audit-summary__pair">
                  {index < parts.length - 1 ? `${part} ·` : part}
                </span>
              </span>
            ))}
          </span>
        );
      },
    },
  ];

  const rowActions = (event: AuditEventDto) => (
    <IconButton
      icon={Eye}
      label={auditDetailsButtonLabel(event, names)}
      tooltip={false}
      onClick={() => {
        setDetail(event);
      }}
      data-testid="audit-row-details"
    />
  );

  const filtered = isAuditFiltered(filter);
  const clearFilters = () => {
    setFilter({ category: null, result: null });
  };

  const filters = (
    <div className="tx-filter-row">
      <div className="tx-filter-row__filters tx-audit-filters">
        <SearchField
          label="Search events"
          value={query}
          onChange={setQuery}
          data-testid="audit-search"
        />
        <label className="tx-audit-filter">
          <span className="tx-audit-filter__label">
            <Icon icon={Funnel} size={14} />
            Category
          </span>
          <Select
            size="sm"
            value={filter.category ?? ''}
            onChange={(event) => {
              setFilter({ category: parseAuditCategory(event.target.value) });
            }}
            data-testid="audit-filter-category"
          >
            <option value="">All categories</option>
            {AUDIT_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <div data-testid="audit-filter-result">
          <Segmented<ResultChoice>
            label="Result"
            size="sm"
            options={RESULT_CHOICES}
            value={filter.result ?? 'all'}
            onChange={(value) => {
              setFilter({ result: value === 'all' ? null : value });
            }}
          />
        </div>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            onClick={clearFilters}
            data-testid="audit-filter-clear"
          >
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );

  const loading = state.status === 'loading' || switching;

  let content;
  if (state.status === 'error' || switchError !== null) {
    content = (
      <ErrorNotice
        error={state.status === 'error' ? state.error : switchError}
        title="The audit log could not be loaded"
        onRetry={reload}
      />
    );
  } else if (!loading && !filtered && events.length === 0) {
    content = (
      <EmptyState icon={ScrollText} title="No events recorded yet" level={2}>
        Sign-ins, changes to screens, media and playlists, pushes and refused requests are recorded
        here as they happen.
      </EmptyState>
    );
  } else {
    content = (
      <>
        <div className="tx-toolbar">
          <p className="tx-toolbar__count" aria-live="polite" data-testid="audit-count">
            {loading
              ? ''
              : searching
                ? auditSearchCountLabel(shown.length, events.length, nextBefore !== null)
                : auditCountLabel(events.length, nextBefore !== null)}
          </p>
          <div className="tx-toolbar__end">
            <IconButton
              icon={RefreshCw}
              label="Refresh"
              onClick={refresh}
              data-testid="audit-refresh"
            />
          </div>
        </div>
        <DataTable
          caption="Audit events"
          columns={columns}
          rows={loading ? [] : shown}
          rowId={(event) => event.id}
          rowActions={rowActions}
          loading={loading}
          loadingRows={8}
          rowTestId={(event) => `audit-row-${event.id}`}
          empty={
            searching && events.length > 0 ? (
              <EmptyState
                variant="inline"
                icon={SearchX}
                title="No event matches this search"
                action={
                  <Button
                    onClick={() => {
                      setQuery('');
                    }}
                  >
                    Clear search
                  </Button>
                }
              >
                No event shown here has those words in its action, object, actor or detail
                {nextBefore === null ? '.' : '. Older events can be loaded below.'}
              </EmptyState>
            ) : (
              <EmptyState
                variant="inline"
                icon={Funnel}
                title="No event matches these filters"
                action={<Button onClick={clearFilters}>Clear filters</Button>}
              >
                No event of this kind has been recorded
                {nextBefore === null ? '.' : ' among the newest events.'}
              </EmptyState>
            )
          }
          className="tx-audit-table"
        />
        {moreError !== null && moreError.key === key && (
          <ErrorNotice
            error={moreError.error}
            title="Older events were not loaded"
            onRetry={loadMore}
          />
        )}
        {!loading && nextBefore !== null && (
          <div className="tx-audit-more">
            <Button
              icon={ChevronDown}
              busy={moreBusy}
              onClick={loadMore}
              data-testid="audit-load-older"
            >
              Load older events
            </Button>
          </div>
        )}
        {!loading && nextBefore === null && events.length > 0 && (
          <p className="tx-audit-end" data-testid="audit-end">
            {filtered
              ? 'No older events match these filters.'
              : 'This is the first recorded event.'}
          </p>
        )}
      </>
    );
  }

  return (
    <Page title="Audit log">
      <div className="tx-stack tx-audit" data-testid="audit-page">
        <p className="tx-audit-intro">
          Security and operational events for this organisation, newest first. Records cannot be
          edited or deleted through the application.
        </p>
        {state.status === 'ready' && !switching && state.refreshError !== null && (
          <ErrorNotice
            error={state.refreshError}
            title="The audit log could not be refreshed"
            onRetry={reload}
          />
        )}
        {filters}
        {content}
      </div>
      <AuditDetailDialog
        event={detail}
        names={names}
        onClose={() => {
          setDetail(null);
        }}
      />
    </Page>
  );
}
