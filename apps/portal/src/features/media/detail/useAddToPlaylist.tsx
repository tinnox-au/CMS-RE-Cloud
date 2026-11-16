import type { Limits, MediaDto, PlaylistSummaryDto } from '@tinnox/contracts';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/index.ts';
import { durationFieldText } from '../../../lib/duration.ts';
import { appendToPlaylistBody, STANDARD_IMAGE_DURATION_MS } from '../../../lib/mediaDetailDraft.ts';
import { addedToPlaylistMessage } from '../../../lib/mediaDetailState.ts';
import { useToast } from '../../../ui/index.ts';
import { usePush } from '../../push/PushContext.tsx';
import { PlaylistPickerDialog } from '../../shared/index.ts';

interface PickerState {
  readonly busy: boolean;
  readonly error: unknown;
}

export interface AddToPlaylist {
  /** Opens the playlist picker. */
  readonly open: () => void;
  /** The picker; render it always. */
  readonly dialog: ReactNode;
}

export interface UseAddToPlaylistOptions {
  /** The item as saved: what is added is what the server holds, not the draft. */
  readonly media: MediaDto;
  readonly limits: Pick<Limits, 'maxPlaylistItems'>;
  /** True while the form holds changes that are not part of what would be added. */
  readonly unsaved: boolean;
  /** After an addition, for example to read again where the file is used. */
  readonly onAdded?: (playlist: PlaylistSummaryDto) => void;
}

/** What the picker says about the time an image gets in the playlist. */
function durationNote(media: MediaDto): string {
  if (media.kind === 'video') return 'The video plays for its own length.';
  const ms = media.defaultDurationMs ?? STANDARD_IMAGE_DURATION_MS;
  return `The image is added at the end with ${durationFieldText(ms)} seconds on screen.`;
}

/**
 * Adds the file at the end of a playlist chosen in the shared picker. The API has no append
 * call: the playlist is read, the item appended, and the whole list saved again. Nothing
 * changes on a screen until the next push; the push count is read again afterwards.
 */
export function useAddToPlaylist({
  media,
  limits,
  unsaved,
  onAdded,
}: UseAddToPlaylistOptions): AddToPlaylist {
  const [picker, setPicker] = useState<PickerState | null>(null);
  const toast = useToast();
  const push = usePush();
  const navigate = useNavigate();

  const add = async (playlist: PlaylistSummaryDto) => {
    setPicker({ busy: true, error: null });
    try {
      const current = await api.getPlaylist(playlist.id);
      const body = appendToPlaylistBody(current, media, limits);
      if (!body.ok) throw new Error(body.message);
      await api.replacePlaylist(playlist.id, body.body);
      setPicker(null);
      toast.success(addedToPlaylistMessage(current.name), {
        detail: 'Nothing changes on a screen until you push.',
        action: {
          label: 'Open playlist',
          onAction: () => {
            void navigate(`/playlists/${playlist.id}`);
          },
        },
      });
      push.refresh();
      onAdded?.(playlist);
    } catch (error) {
      setPicker({ busy: false, error });
    }
  };

  const dialog = (
    <PlaylistPickerDialog
      open={picker !== null}
      onClose={() => {
        setPicker(null);
      }}
      title="Add to playlist"
      description={
        <>
          {durationNote(media)}
          {unsaved ? ' Changes that are not saved yet are not part of it.' : ''} Nothing changes on
          a screen until you push.
        </>
      }
      confirmLabel="Add to playlist"
      busy={picker?.busy}
      error={picker?.error}
      errorTitle="The file was not added"
      disabledReason={(playlist) =>
        playlist.itemCount >= limits.maxPlaylistItems
          ? `Full: a playlist holds at most ${limits.maxPlaylistItems} items`
          : null
      }
      testId="media-detail-playlist-picker"
      onConfirm={(playlist) => {
        if (playlist !== null) void add(playlist);
      }}
    />
  );

  return {
    open: () => {
      setPicker({ busy: false, error: null });
    },
    dialog,
  };
}
