import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/index.ts';
import { Chip, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/common.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import { formatTimestamp } from '../lib/format.ts';

export function DisplaysPage() {
  const load = useCallback(async (signal: AbortSignal) => {
    const [displays, sites] = await Promise.all([api.listDisplays(signal), api.listSites(signal)]);
    return { displays, sites };
  }, []);
  const { state, reload } = useLoad(load);

  return (
    <>
      <PageHeader
        title="Displays"
        actions={
          <Link className="button button-primary" to="/displays/new">
            New display
          </Link>
        }
      >
        <p className="muted">
          A display is an output frame with a fixed canvas. Pair a player to it, then publish a
          playlist.
        </p>
      </PageHeader>
      {state.status === 'loading' && <Loading label="Loading displays…" />}
      {state.status === 'error' && (
        <ErrorNotice error={state.error} title="Displays could not be loaded" onRetry={reload} />
      )}
      {state.status === 'ready' && (
        <>
          {state.refreshError !== null && (
            <ErrorNotice error={state.refreshError} title="The list could not be refreshed" />
          )}
          {state.data.displays.length === 0 ? (
            <EmptyState title="No displays yet">
              <p>Create a display to define its canvas size, then pair a player.</p>
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Site</th>
                    <th scope="col">Canvas</th>
                    <th scope="col">Default fit</th>
                    <th scope="col">Player</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.displays.map((display) => {
                    const site = state.data.sites.find((s) => s.id === display.siteId);
                    return (
                      <tr key={display.id}>
                        <th scope="row">
                          <Link to={`/displays/${display.id}`}>{display.name}</Link>
                        </th>
                        <td>{site?.name ?? 'Unknown site'}</td>
                        <td className="nowrap">
                          {display.canvas.width} × {display.canvas.height} px
                        </td>
                        <td>{display.defaultFit}</td>
                        <td>
                          {display.player === null ? (
                            <Chip tone="neutral">Not paired</Chip>
                          ) : (
                            <>
                              <Chip tone="neutral">Paired</Chip>{' '}
                              <span className="small muted">
                                since {formatTimestamp(display.player.registeredAt)}
                              </span>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="small muted">
            &quot;Paired&quot; means a player holds a credential. Open a display to see what its
            player last reported.
          </p>
        </>
      )}
    </>
  );
}
