import {
  formatPairingCode,
  normalisePairingCode,
  type DeliveryStatusView,
  type DisplayDto,
} from '@tinnox/contracts';
import { useCallback, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { isApiRequestError } from '../api/client.ts';
import { api } from '../api/index.ts';
import { CanvasPreview } from '../components/CanvasPreview.tsx';
import {
  Chip,
  ConfirmDialog,
  ErrorNotice,
  Field,
  Id,
  Loading,
  Notice,
  PageHeader,
} from '../components/common.tsx';
import { useLoad, useTick } from '../hooks/useLoad.ts';
import { formatAge, formatTimestamp } from '../lib/format.ts';
import { presentStatus } from '../lib/status.ts';
import { useSession } from '../session/SessionContext.tsx';

const STATUS_POLL_MS = 5000;

function MatchChip({ matches }: { readonly matches: boolean | null }) {
  if (matches === null) return null;
  return matches ? (
    <Chip tone="good">matches desired</Chip>
  ) : (
    <Chip tone="warn">differs from desired</Chip>
  );
}

function StatusPanel({ displayId, refreshKey }: { displayId: string; refreshKey: number }) {
  const load = useCallback(
    (signal: AbortSignal) => {
      // refreshKey changes after pairing or revocation so the panel fetches at once.
      void refreshKey;
      return api.getDisplayStatus(displayId, signal);
    },
    [displayId, refreshKey],
  );
  const { state, reload } = useLoad<DeliveryStatusView>(load, STATUS_POLL_MS);
  const now = useTick(1000);

  return (
    <section className="panel" aria-labelledby="status-heading">
      <div className="panel-head">
        <h2 id="status-heading">Live status</h2>
        <button type="button" className="button button-small" onClick={reload}>
          Refresh now
        </button>
      </div>
      {state.status === 'loading' && <Loading label="Loading status…" />}
      {state.status === 'error' && (
        <ErrorNotice error={state.error} title="Status could not be loaded" onRetry={reload} />
      )}
      {state.status === 'ready' && (
        <StatusBody
          view={state.data}
          elapsedMs={Math.max(0, now - state.fetchedAt)}
          refreshError={state.refreshError}
        />
      )}
    </section>
  );
}

function StatusBody({
  view,
  elapsedMs,
  refreshError,
}: {
  readonly view: DeliveryStatusView;
  readonly elapsedMs: number;
  readonly refreshError: unknown;
}) {
  const p = presentStatus(view, elapsedMs);
  return (
    <>
      {refreshError !== null && (
        <ErrorNotice
          error={refreshError}
          title={`Status could not be refreshed. Showing what the server said ${formatAge(elapsedMs / 1000)}.`}
        />
      )}
      <div
        className={`status-headline status-${p.tone}`}
        data-testid="status-headline"
        data-summary={view.summary}
        data-stale={view.stale ? 'true' : 'false'}
      >
        <p className="status-title">
          {p.headline}
          {p.reportBadge === 'stale' && (
            <>
              {' '}
              <Chip tone="warn">STALE</Chip>
            </>
          )}
          {p.reportBadge === 'no_report' && (
            <>
              {' '}
              <Chip tone="warn">NO REPORT</Chip>
            </>
          )}
        </p>
        <p>{p.explanation}</p>
      </div>

      <h3>Set by the operator</h3>
      <dl className="facts">
        <dt>Desired publication</dt>
        <dd data-testid="status-desired">
          {view.desired === null ? (
            <span className="muted">None published</span>
          ) : (
            <>
              <Id value={view.desired.publicationId} />
              <span className="small muted">
                {' '}
                published {formatTimestamp(view.desired.publishedAt)}
              </span>
            </>
          )}
        </dd>
        <dt>Player credential</dt>
        <dd>
          {view.paired && view.registrationId !== null ? (
            <>
              Active, registration <Id value={view.registrationId} />
            </>
          ) : (
            <span className="muted">No active credential</span>
          )}
        </dd>
      </dl>

      <h3>Reported by player software</h3>
      <p className="small muted">
        These values are what the player program last told the server. They are evidence from
        software, not proof of what a physical screen is showing.
      </p>
      <dl className="facts">
        <dt>Last report received</dt>
        <dd data-testid="status-last-report">
          {view.lastHeartbeatAt === null ? (
            <span className="muted">No report received</span>
          ) : (
            <>
              {p.heartbeatText}
              <span className="small muted"> ({formatTimestamp(view.lastHeartbeatAt)})</span>
            </>
          )}{' '}
          {p.reportBadge === 'stale' && <Chip tone="warn">STALE</Chip>}
          <span className="small muted">
            {' '}
            A report counts as stale after {view.staleAfterSeconds} s.
          </span>
        </dd>
        <dt>Downloaded publication</dt>
        <dd data-testid="status-downloaded">
          {view.downloaded === null ? (
            <span className="muted">None reported</span>
          ) : (
            <>
              <Id value={view.downloaded.publicationId} />{' '}
              <MatchChip matches={p.downloadedMatchesDesired} />
            </>
          )}
        </dd>
        <dt>Active publication</dt>
        <dd data-testid="status-active">
          {view.active === null ? (
            <span className="muted">None reported</span>
          ) : (
            <>
              <Id value={view.active.publicationId} />{' '}
              <MatchChip matches={p.activeMatchesDesired} />
            </>
          )}
        </dd>
        <dt>Active item</dt>
        <dd data-testid="status-active-item">
          {p.activeItemNumber === null ? (
            <span className="muted">None reported</span>
          ) : (
            `Item ${p.activeItemNumber} of the active publication`
          )}
        </dd>
        <dt>Player state</dt>
        <dd data-testid="status-player-state">{p.playerStateLabel}</dd>
        <dt>Update in progress</dt>
        <dd>
          {view.staging === null || p.stagingText === null ? (
            <span className="muted">None reported</span>
          ) : (
            <>
              <Id value={view.staging.publicationId} />
              <span> — {p.stagingText}</span>
            </>
          )}
        </dd>
      </dl>

      <h3>Delivery errors reported by the player</h3>
      {view.errors.length === 0 ? (
        <p className="muted" data-testid="status-no-errors">
          None in the last report.
        </p>
      ) : (
        <ul className="error-list" data-testid="status-errors">
          {view.errors.map((error, index) => (
            <li key={index}>
              <code className="code-tag">{error.code}</code> {error.message}
              <span className="small muted"> — {formatTimestamp(error.at)}</span>
              {error.publicationId !== null && (
                <span className="small muted">
                  {' '}
                  publication <Id value={error.publicationId} />
                </span>
              )}
              {error.assetId !== null && (
                <span className="small muted">
                  {' '}
                  media <Id value={error.assetId} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">
        Server view computed {formatTimestamp(view.asOf)}. Refreshes every {STATUS_POLL_MS / 1000} s
        while this tab is visible.
      </p>
    </>
  );
}

function pairingHelp(error: unknown, ttlMinutes: number): string | null {
  if (!isApiRequestError(error)) return null;
  switch (error.code) {
    case 'pairing_code_invalid':
    case 'not_found':
      return `The code was not accepted: it is mistyped, has expired (codes last ${ttlMinutes} minutes) or was already used. Read the code currently on the player screen and try again.`;
    case 'pairing_expired':
      return 'That code has expired. The player shows a new code; enter that one.';
    case 'pairing_locked':
    case 'rate_limited':
      return 'Too many wrong codes were entered. Wait a few minutes before trying again.';
    default:
      return null;
  }
}

function PairingPanel({
  display,
  onChanged,
}: {
  readonly display: DisplayDto;
  readonly onChanged: () => void;
}) {
  const { limits } = useSession();
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState<{ replaced: boolean } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<unknown>(null);
  const [revokeResult, setRevokeResult] = useState<string | null>(null);
  const ttlMinutes = Math.round(limits.pairingCodeTtlSeconds / 60);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setClaimed(null);
    setError(null);
    setRevokeResult(null);
    const normalised = normalisePairingCode(code);
    if (normalised === null) {
      setFieldError(
        'A pairing code has 8 letters or digits, for example ABCD-2345. It never contains 0, 1, I, L, O or U.',
      );
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    api
      .claimPairing(display.id, normalised)
      .then((result) => {
        setClaimed({ replaced: result.replacedRegistrationId !== null });
        setCode('');
        onChanged();
      })
      .catch((reason: unknown) => {
        setError(reason);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const revoke = () => {
    setRevokeBusy(true);
    setRevokeError(null);
    setRevokeResult(null);
    setClaimed(null);
    api
      .revokePlayer(display.id)
      .then((result) => {
        setRevokeResult(
          result.revokedRegistrationId === null
            ? 'This display had no active player credential. Nothing was changed.'
            : 'The player credential was revoked. That player can no longer fetch manifests or media. Content it already cached stays on the device until it is reset there.',
        );
        setConfirmRevoke(false);
        onChanged();
      })
      .catch((reason: unknown) => {
        setRevokeError(reason);
        setConfirmRevoke(false);
      })
      .finally(() => {
        setRevokeBusy(false);
      });
  };

  const normalisedPreview = normalisePairingCode(code);
  const help = pairingHelp(error, ttlMinutes);

  return (
    <section className="panel" aria-labelledby="pairing-heading">
      <h2 id="pairing-heading">Player pairing</h2>
      {display.player === null ? (
        <p>No player is paired with this display.</p>
      ) : (
        <p>
          A player has held a credential since {formatTimestamp(display.player.registeredAt)}.
          Pairing another player replaces it and revokes the current credential.
        </p>
      )}

      <form onSubmit={submit} noValidate className="inline-form">
        <Field
          label="Pairing code shown on the player"
          error={fieldError}
          hint={`Open the player in a browser; it shows an 8-character code that works once and lasts ${ttlMinutes} minutes.`}
        >
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              type="text"
              className="input-code"
              value={code}
              maxLength={32}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
          )}
        </Field>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? 'Claiming…' : 'Pair player'}
        </button>
      </form>
      {normalisedPreview !== null && !busy && (
        <p className="small muted">
          Will be sent as <span className="mono">{formatPairingCode(normalisedPreview)}</span>
        </p>
      )}

      {claimed !== null && (
        <Notice tone="good" title="Code accepted" live>
          <p>
            The player collects its credential the next time it checks in, usually within a few
            seconds. {claimed.replaced && 'The previous player credential was revoked. '}
            The status panel shows the player once it sends its first report.
          </p>
        </Notice>
      )}
      {error !== null && (
        <>
          <ErrorNotice error={error} title="The player was not paired" />
          {help !== null && <p>{help}</p>}
        </>
      )}

      <h3>Revoke</h3>
      <p className="small muted">
        Revoking stops the paired player from fetching manifests and media. It cannot erase content
        already cached on a device that is offline.
      </p>
      <button
        type="button"
        className="button button-danger"
        disabled={display.player === null || revokeBusy}
        onClick={() => {
          setConfirmRevoke(true);
        }}
      >
        Revoke player
      </button>
      {display.player === null && (
        <span className="small muted"> There is no credential to revoke.</span>
      )}
      {revokeResult !== null && (
        <Notice tone="neutral" live>
          <p>{revokeResult}</p>
        </Notice>
      )}
      {revokeError !== null && (
        <ErrorNotice error={revokeError} title="The player was not revoked" />
      )}
      <ConfirmDialog
        open={confirmRevoke}
        title="Revoke this player?"
        confirmLabel="Revoke player"
        danger
        busy={revokeBusy}
        onConfirm={revoke}
        onCancel={() => {
          setConfirmRevoke(false);
        }}
      >
        <p>
          The player paired with “{display.name}” will lose access immediately. To use it again it
          must be paired with a new code.
        </p>
      </ConfirmDialog>
    </section>
  );
}

export function DisplayDetailPage() {
  const { id } = useParams();
  const displayId = id ?? '';
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [display, sites] = await Promise.all([
        api.getDisplay(displayId, signal),
        api.listSites(signal),
      ]);
      return { display, site: sites.find((site) => site.id === display.siteId) ?? null };
    },
    [displayId],
  );
  const { state, reload } = useLoad(load);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleChanged = useCallback(() => {
    reload();
    setRefreshKey((value) => value + 1);
  }, [reload]);

  if (state.status === 'loading') return <Loading label="Loading display…" />;
  if (state.status === 'error') {
    return (
      <>
        <PageHeader title="Display" />
        <ErrorNotice error={state.error} title="The display could not be loaded" onRetry={reload} />
        <p>
          <Link to="/displays">Back to displays</Link>
        </p>
      </>
    );
  }
  const { display, site } = state.data;
  return (
    <>
      <p className="breadcrumb">
        <Link to="/displays">Displays</Link> / <span>{display.name}</span>
      </p>
      <PageHeader
        title={display.name}
        actions={
          <Link className="button" to={`/displays/${display.id}/edit`}>
            Edit display
          </Link>
        }
      />
      {state.refreshError !== null && (
        <ErrorNotice error={state.refreshError} title="Display details could not be refreshed" />
      )}
      <div className="two-col">
        <section className="panel" aria-labelledby="config-heading">
          <h2 id="config-heading">Configuration</h2>
          <dl className="facts">
            <dt>Site</dt>
            <dd>{site === null ? 'Unknown site' : `${site.name} (${site.timezone})`}</dd>
            <dt>Canvas</dt>
            <dd>
              {display.canvas.width} × {display.canvas.height} px
            </dd>
            <dt>Content rectangle</dt>
            <dd>
              {display.contentRect === null
                ? 'Whole canvas'
                : `${display.contentRect.width} × ${display.contentRect.height} px at (${display.contentRect.x}, ${display.contentRect.y})`}
            </dd>
            <dt>Default fit</dt>
            <dd>{display.defaultFit}</dd>
            <dt>Delivery route</dt>
            <dd>{display.route === 'browser' ? 'Browser player' : display.route}</dd>
            <dt>Display ID</dt>
            <dd>
              <Id value={display.id} />
            </dd>
          </dl>
          <CanvasPreview
            shape={{
              canvas: display.canvas,
              contentRect: display.contentRect,
              contentRectOutOfBounds: false,
            }}
          />
        </section>
        <PairingPanel display={display} onChanged={handleChanged} />
      </div>
      <StatusPanel displayId={display.id} refreshKey={refreshKey} />
    </>
  );
}
