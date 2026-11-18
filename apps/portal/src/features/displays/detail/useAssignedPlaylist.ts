import type { DisplayDto } from '@tinnox/contracts';
import { useCallback, useMemo } from 'react';
import { isAbort } from '../../../api/client.ts';
import { api } from '../../../api/index.ts';
import { useLoad } from '../../../hooks/useLoad.ts';
import {
  AssignedReadError,
  assignedPlaylistStateOf,
  type AssignedPlaylistState,
  type AssignedRead,
} from '../../../lib/screenDetail.ts';

export type { AssignedPlaylistState };

export interface AssignedPlaylist {
  readonly state: AssignedPlaylistState;
  readonly reload: () => void;
}

/**
 * The playlist assigned to a screen, the default playlist of its schedule or the main zone's
 * playlist of its layout, read in full so
 * the page can show its first item and its length. Read again whenever the assignment
 * changes. Every answer and every failure carries the id it was read for, so a failed read of
 * a new assignment shows its error and retry instead of waiting behind the previous
 * assignment's answer.
 */
export function useAssignedPlaylist(
  display: Pick<
    DisplayDto,
    'assignedPlaylist' | 'assignedSchedule' | 'assignedLayout' | 'defaultFit'
  >,
): AssignedPlaylist {
  // shortcut: with a schedule the preview shows the default playlist only; add a "what plays at" preview (SCH-08) with the week view.
  // shortcut: with a layout the preview shows the main zone's playlist only; draw the zones on the screen page if operators ask.
  const playlistId =
    display.assignedPlaylist?.id ??
    display.assignedSchedule?.defaultPlaylist.id ??
    display.assignedLayout?.mainPlaylist.id ??
    null;
  const load = useCallback(
    async (signal: AbortSignal): Promise<AssignedRead | null> => {
      if (playlistId === null) return null;
      try {
        return { playlistId, playlist: await api.getPlaylist(playlistId, signal) };
      } catch (error) {
        if (isAbort(error)) throw error;
        throw new AssignedReadError(playlistId, error);
      }
    },
    [playlistId],
  );
  const { state, reload } = useLoad(load);
  const defaultFit = display.defaultFit;

  const result = useMemo(
    () => assignedPlaylistStateOf(playlistId, state, defaultFit),
    [playlistId, state, defaultFit],
  );

  return { state: result, reload };
}
