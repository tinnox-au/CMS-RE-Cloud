/**
 * Names of the constraints, unique indexes and guard triggers of
 * db/migrations/0005_portal_v2_stage_a.sql that a caller has to tell apart to
 * answer correctly (a taken name is a conflict; an unknown folder is not found).
 * PostgreSQL reports the name in the `constraint` field of the error.
 */
export const STAGE_A_CONSTRAINTS = Object.freeze({
  /** 23505: another tag of the same organisation and scope has this name, ignoring case. */
  tagNameTaken: 'tag_org_scope_name_key',
  /** 23505: another folder of the same organisation has this name, ignoring case. */
  folderNameTaken: 'folder_org_name_key',
  /** 23503: the folder does not exist in this organisation. */
  mediaFolder: 'media_folder_fk',
  /** 23503: the media item does not exist in this organisation. */
  mediaTagMedia: 'media_tag_media_fk',
  /** 23503: the tag does not exist in this organisation, or is not a media tag. */
  mediaTagTag: 'media_tag_tag_fk',
  /** 23503: the display does not exist in this organisation. */
  displayTagDisplay: 'display_tag_display_fk',
  /** 23503: the tag does not exist in this organisation, or is not a display tag. */
  displayTagTag: 'display_tag_tag_fk',
  /**
   * 23503: on a display, the playlist does not exist in this organisation; on a
   * playlist, a hard delete was attempted while a display has it assigned.
   */
  displayAssignedPlaylist: 'display_assigned_playlist_fk',
  /** 23001: the playlist being assigned to a display is deleted. */
  assignedPlaylistDeleted: 'display_assigned_playlist_guard',
  /** 23001: the playlist being deleted is assigned to a display. */
  playlistStillAssigned: 'playlist_delete_guard',
  /** 23514: a default duration was set on a media item that is not an image. */
  defaultDurationImagesOnly: 'media_default_duration_images_only',
});

export type StageAConstraint = (typeof STAGE_A_CONSTRAINTS)[keyof typeof STAGE_A_CONSTRAINTS];

/**
 * The names of db/migrations/0009_stage_b_schedules.sql and 0011_stage_b_layouts.sql
 * that a caller has to tell apart. Deleted playlists keep their stage A names:
 * `playlist_delete_guard` now also refuses while a schedule or a layout uses the playlist.
 */
export const STAGE_B_CONSTRAINTS = Object.freeze({
  /**
   * 23503: on a display, the schedule does not exist in this organisation; on a
   * schedule, a delete was attempted while a display has it assigned.
   */
  displayAssignedSchedule: 'display_assigned_schedule_fk',
  /**
   * 23503: on a display, the layout does not exist in this organisation; on a layout, a
   * delete was attempted while a display has it assigned.
   */
  displayAssignedLayout: 'display_assigned_layout_fk',
});

/** The names of db/migrations/0013_roles_and_members.sql that a caller has to tell apart. */
export const STAGE_C_CONSTRAINTS = Object.freeze({
  /** 23001: the change would leave the organisation without an active Owner. */
  lastOwner: 'membership_last_owner',
  /** 23001: a removed member's removal or role was changed (only TINNOX's scripts reactivate). */
  removedFinal: 'membership_removed_final',
  /** 23505: another member of the organisation has, or had, this name, ignoring case. */
  memberNameTaken: 'membership_org_display_name_key',
  /** 23505: a pending invite of the organisation has this e-mail address, ignoring case. */
  inviteEmailTaken: 'member_invite_pending_email_key',
  /** 23505: a pending invite of the organisation has this name, ignoring case. */
  inviteNameTaken: 'member_invite_pending_name_key',
  /** 23001: an invite change the guard refuses (closed, request changed, wrong status for the role). */
  inviteGuard: 'member_invite_guard',
});

/** The constraint a PostgreSQL error names, or null when it names none. */
export function violatedConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === 'string' && constraint !== '' ? constraint : null;
}
