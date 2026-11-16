import type { MediaDto, PlaylistSummaryDto } from '@tinnox/contracts';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/index.ts';
import { playlistFullReason, playlistWithMediaAppended } from '../../../lib/mediaLibraryActions.ts';
import { mediaDisplayName } from '../../../lib/mediaName.ts';
import { useSession } from '../../../session/SessionContext.tsx';
import { useToast } from '../../../ui/index.ts';
import { usePush } from '../../push/PushContext.tsx';
import { PlaylistPickerDialog } from '../../shared/index.ts';

export interface AddToPlaylistProps {
  /** The file to add; null keeps the dialog closed. */
  readonly media: MediaDto | null;
  readonly onClose: () => void;
  /** After the playlist was saved with the file in it (its usage count changed). */
  readonly onAdded: () => void;
}

/**
 * "Add to playlist": choose a playlist, then the file is appended at the end of it. The
 * playlist is read afresh and saved whole (`PUT`), with every item it had, in play order, and
 * the file last: an image with its own default duration or else 10 seconds, a video with its
 * natural length. Nothing changes on a screen until someone pushes.
 */
export function AddToPlaylist({ media, onClose, onAdded }: AddToPlaylistProps) {
  const { limits } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const push = usePush();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [held, setHeld] = useState<MediaDto | null>(media);
  if (media !== null && media !== held) {
    setHeld(media);
    setBusy(false);
    setError(null);
  }
  const shown = media ?? held;

  const add = async (playlist: PlaylistSummaryDto) => {
    if (busy || media === null) return;
    setBusy(true);
    setError(null);
    try {
      const current = await api.getPlaylist(playlist.id);
      const saved = await api.replacePlaylist(
        playlist.id,
        playlistWithMediaAppended(current, media, limits),
      );
      setBusy(false);
      onClose();
      onAdded();
      push.refresh();
      toast.success(`${mediaDisplayName(media)} added to ${saved.name}`, {
        detail: 'Screens with this playlist show it after the next push.',
        action: {
          label: 'Open playlist',
          onAction: () => {
            void navigate(`/playlists/${saved.id}`);
          },
        },
      });
    } catch (thrown) {
      setBusy(false);
      setError(thrown);
    }
  };

  return (
    <PlaylistPickerDialog
      open={media !== null}
      onClose={onClose}
      title="Add to playlist"
      description={
        shown === null ? undefined : (
          <>
            <span className="tx-strong">{mediaDisplayName(shown)}</span> is added at the end of the
            playlist you choose. Nothing changes on a screen until you push.
          </>
        )
      }
      confirmLabel="Add to playlist"
      busy={busy}
      error={error}
      errorTitle="The file was not added"
      disabledReason={(playlist) => playlistFullReason(playlist, limits)}
      testId="media-library-playlist-picker"
      onConfirm={(playlist) => {
        if (playlist !== null) void add(playlist);
      }}
    />
  );
}
