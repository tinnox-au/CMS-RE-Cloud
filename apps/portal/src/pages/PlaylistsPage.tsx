import { PlaylistCreateSchema } from '@tinnox/contracts';
import { useCallback, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/index.ts';
import { EmptyState, ErrorNotice, Field, Loading, PageHeader } from '../components/common.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import { formatTimestamp } from '../lib/format.ts';

export function PlaylistsPage() {
  const navigate = useNavigate();
  const load = useCallback((signal: AbortSignal) => api.listPlaylists(signal), []);
  const { state, reload } = useLoad(load);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [createError, setCreateError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const create = (event: FormEvent) => {
    event.preventDefault();
    const parsed = PlaylistCreateSchema.safeParse({ name });
    if (!parsed.success) {
      setNameError(
        name.trim() === '' ? 'Enter a name.' : (parsed.error.issues[0]?.message ?? 'Invalid name.'),
      );
      return;
    }
    setNameError(undefined);
    setCreateError(null);
    setBusy(true);
    api
      .createPlaylist(parsed.data.name)
      .then((created) => navigate(`/playlists/${created.id}`))
      .catch((error: unknown) => {
        setCreateError(error);
        setBusy(false);
      });
  };

  return (
    <>
      <PageHeader title="Playlists">
        <p className="muted">
          A playlist is an ordered draft of images and videos. Publishing takes a snapshot of it for
          one display.
        </p>
      </PageHeader>

      <section className="panel" aria-labelledby="create-heading">
        <h2 id="create-heading">New playlist</h2>
        <form onSubmit={create} noValidate className="inline-form">
          <Field label="Name" error={nameError}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                type="text"
                value={name}
                maxLength={120}
                autoComplete="off"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </Field>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create playlist'}
          </button>
        </form>
        {createError !== null && (
          <ErrorNotice error={createError} title="The playlist was not created" />
        )}
      </section>

      {state.status === 'loading' && <Loading label="Loading playlists…" />}
      {state.status === 'error' && (
        <ErrorNotice error={state.error} title="Playlists could not be loaded" onRetry={reload} />
      )}
      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <EmptyState title="No playlists yet">
            <p>Create one above, then add media that is ready.</p>
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Items</th>
                  <th scope="col">Last changed</th>
                </tr>
              </thead>
              <tbody>
                {state.data.map((playlist) => (
                  <tr key={playlist.id}>
                    <th scope="row">
                      <Link to={`/playlists/${playlist.id}`}>{playlist.name}</Link>
                    </th>
                    <td>{playlist.itemCount}</td>
                    <td>{formatTimestamp(playlist.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </>
  );
}
