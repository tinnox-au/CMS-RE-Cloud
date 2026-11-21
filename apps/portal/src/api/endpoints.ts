import {
  AlertRecipientDtoSchema,
  AlertRecipientListResponseSchema,
  AppDtoSchema,
  AppListResponseSchema,
  AuditListResponseSchema,
  DeliveryStatusListResponseSchema,
  DeliveryStatusViewSchema,
  DisplayDtoSchema,
  DisplayListResponseSchema,
  FolderDtoSchema,
  FolderListResponseSchema,
  HEADERS,
  InviteDtoSchema,
  InviteListResponseSchema,
  LayoutDtoSchema,
  LayoutListResponseSchema,
  LogoutResponseSchema,
  MediaDtoSchema,
  MediaListResponseSchema,
  MediaUsageResponseSchema,
  MemberChangeResponseSchema,
  MemberListResponseSchema,
  MemberNameListResponseSchema,
  MemberSignOutResponseSchema,
  OverviewResponseSchema,
  PairingClaimResponseSchema,
  PlaylistDtoSchema,
  PlaylistDuplicateResponseSchema,
  PlaylistListResponseSchema,
  PlaylistSummaryDtoSchema,
  PublishResponseSchema,
  PushPlanResponseSchema,
  PushResponseSchema,
  RevokePlayerResponseSchema,
  ROUTES,
  ScheduleDtoSchema,
  ScheduleListResponseSchema,
  SiteListResponseSchema,
  TagDtoSchema,
  TagListResponseSchema,
  type AlertRecipientDto,
  type AppCreate,
  type AppDto,
  type AppPatch,
  type AuditCategory,
  type AuditListResponse,
  type AuditResult,
  type DeliveryStatusView,
  type DisplayCreateInput,
  type DisplayDto,
  type DisplayPatch,
  type FolderDto,
  type InviteCreate,
  type InviteDto,
  type LayoutDto,
  type LayoutInput,
  type LogoutResponse,
  type MediaDto,
  type MediaListResponse,
  type MediaPatch,
  type MediaUsageResponse,
  type MemberChangeResponse,
  type MemberDto,
  type MemberNameDto,
  type MemberPatch,
  type MemberSignOutResponse,
  type OverviewResponse,
  type PairingClaimResponse,
  type PlaylistDto,
  type PlaylistReplace,
  type PlaylistSummaryDto,
  type PublishResponse,
  type PushPlanResponse,
  type PushResponse,
  type RevokePlayerResponse,
  type ScheduleDto,
  type ScheduleInput,
  type ScheduleSummaryDto,
  type SiteDto,
  type TagCreateInput,
  type TagDto,
  type TagPatch,
  type TagScope,
} from '@tinnox/contracts';
import { z } from 'zod';
import type { ApiClient } from './client.ts';

/** `POST /api/playlists` may answer with the full playlist or its summary; only the id is used. */
const CreatedPlaylistSchema = z.union([PlaylistDtoSchema, PlaylistSummaryDtoSchema]);

/** Query of `GET /api/audit`. The filters combine, and paging with `before` keeps them. */
export interface AuditQuery {
  readonly limit: number;
  readonly before?: string;
  /** Only events of this category: the part of the action before the first dot. */
  readonly category?: AuditCategory;
  readonly result?: AuditResult;
}

/**
 * One method per API call. Every answer is checked against the shared schema
 * before it is returned; an answer that does not match fails with `invalid_response`.
 */
export interface Endpoints {
  listSites(signal?: AbortSignal): Promise<SiteDto[]>;

  listDisplays(signal?: AbortSignal): Promise<DisplayDto[]>;
  getDisplay(id: string, signal?: AbortSignal): Promise<DisplayDto>;
  createDisplay(input: DisplayCreateInput): Promise<DisplayDto>;
  /**
   * Also sets the description, the tags (the complete new set) and the assigned playlist,
   * schedule or layout: a display has at most one, so assigning one clears the others.
   * Assigning changes nothing on the display until a push.
   */
  patchDisplay(id: string, patch: DisplayPatch): Promise<DisplayDto>;
  claimPairing(displayId: string, code: string): Promise<PairingClaimResponse>;
  revokePlayer(displayId: string): Promise<RevokePlayerResponse>;
  getDisplayStatus(displayId: string, signal?: AbortSignal): Promise<DeliveryStatusView>;
  /** The status of every display in one call, in the order of `listDisplays`. */
  listDisplayStatuses(signal?: AbortSignal): Promise<DeliveryStatusView[]>;

  listMedia(signal?: AbortSignal): Promise<MediaListResponse>;
  getMedia(id: string, signal?: AbortSignal): Promise<MediaDto>;
  /** Name, description, default duration (images only), folder and tags (the complete new set). */
  patchMedia(id: string, patch: MediaPatch): Promise<MediaDto>;
  /** The playlists that contain a media item and the displays currently given it. */
  getMediaUsage(id: string, signal?: AbortSignal): Promise<MediaUsageResponse>;
  deleteMedia(id: string): Promise<void>;

  /** Without `scope`, the tags of both scopes. */
  listTags(scope?: TagScope, signal?: AbortSignal): Promise<TagDto[]>;
  createTag(input: TagCreateInput): Promise<TagDto>;
  patchTag(id: string, patch: TagPatch): Promise<TagDto>;
  deleteTag(id: string): Promise<void>;

  listFolders(signal?: AbortSignal): Promise<FolderDto[]>;
  createFolder(name: string): Promise<FolderDto>;
  renameFolder(id: string, name: string): Promise<FolderDto>;
  /** The media in the folder moves to the root of the library. */
  deleteFolder(id: string): Promise<void>;

  listApps(signal?: AbortSignal): Promise<AppDto[]>;
  getApp(id: string, signal?: AbortSignal): Promise<AppDto>;
  createApp(input: AppCreate): Promise<AppDto>;
  /** `content.type` must be the app's own type. */
  patchApp(id: string, patch: AppPatch): Promise<AppDto>;
  /** 409 `app_in_use` while a live playlist contains the app. */
  deleteApp(id: string): Promise<void>;

  listPlaylists(signal?: AbortSignal): Promise<PlaylistSummaryDto[]>;
  createPlaylist(name: string): Promise<{ id: string }>;
  getPlaylist(id: string, signal?: AbortSignal): Promise<PlaylistDto>;
  /** Leaving `description` out keeps the stored one; null clears it. */
  replacePlaylist(id: string, body: PlaylistReplace): Promise<PlaylistDto>;
  duplicatePlaylist(id: string): Promise<PlaylistDto>;
  /**
   * Refused with `playlist_in_use` while a display has the playlist assigned or a schedule or
   * a layout uses it.
   */
  deletePlaylist(id: string): Promise<void>;
  /** Publishes to one display and assigns the playlist to it. */
  publish(playlistId: string, displayId: string, idempotencyKey: string): Promise<PublishResponse>;

  listSchedules(signal?: AbortSignal): Promise<ScheduleSummaryDto[]>;
  getSchedule(id: string, signal?: AbortSignal): Promise<ScheduleDto>;
  createSchedule(input: ScheduleInput): Promise<ScheduleDto>;
  /** The whole schedule. Leaving `description` out keeps the stored one; null clears it. */
  replaceSchedule(id: string, input: ScheduleInput): Promise<ScheduleDto>;
  /** 409 `schedule_in_use` while a display has the schedule assigned. */
  deleteSchedule(id: string): Promise<void>;

  listLayouts(signal?: AbortSignal): Promise<LayoutDto[]>;
  getLayout(id: string, signal?: AbortSignal): Promise<LayoutDto>;
  createLayout(input: LayoutInput): Promise<LayoutDto>;
  /** The whole layout. Leaving `description` out keeps the stored one; null clears it. */
  replaceLayout(id: string, input: LayoutInput): Promise<LayoutDto>;
  /** 409 `layout_in_use` while a display has the layout assigned. */
  deleteLayout(id: string): Promise<void>;

  /** Where every display stands between its assigned content and what it was last given. */
  getPushPlan(signal?: AbortSignal): Promise<PushPlanResponse>;
  /**
   * Pushes to the chosen displays. Use one key per intent and repeat it only for the same
   * displays while the outcome is unknown (`keyForPush` in lib/pushDialog.ts). A repeat
   * returns the same publication for every display that got one under the key; a display
   * that stored nothing under it (unchanged, skipped, rejected, not reached) is decided
   * again and may be published by the repeat. See `PushResponseSchema`.
   */
  push(displayIds: readonly string[], idempotencyKey: string): Promise<PushResponse>;

  getOverview(signal?: AbortSignal): Promise<OverviewResponse>;

  listAudit(query: AuditQuery, signal?: AbortSignal): Promise<AuditListResponse>;

  /** Every member of the organisation, removed ones included. Never an e-mail address. */
  listMembers(signal?: AbortSignal): Promise<MemberDto[]>;
  /** Id and name of every member, removed ones included: what activity needs to name actors. */
  listMemberNames(signal?: AbortSignal): Promise<MemberNameDto[]>;
  /** Invites waiting for TINNOX, expired ones included until TINNOX closes them. */
  listInvites(signal?: AbortSignal): Promise<InviteDto[]>;
  /** Requests an invite; TINNOX sets the person up. The inviter comes from the session. */
  createInvite(input: InviteCreate): Promise<InviteDto>;
  /** Deletes the person's name and work e-mail address from the invite. */
  cancelInvite(id: string): Promise<void>;
  /**
   * Changes the role or corrects the name. A demotion ends the person's sessions and cancels
   * the invites they sent that their new role could not send. 409 `last_owner` when it would
   * leave no active Owner.
   */
  patchMember(id: string, patch: MemberPatch): Promise<MemberChangeResponse>;
  /** Ends the person's sessions and cancels their pending invites. Final: invite them again. */
  removeMember(id: string): Promise<MemberChangeResponse>;
  /** Ends every session the person has open; their next sign-in asks for the one-time code. */
  signOutMember(id: string): Promise<MemberSignOutResponse>;

  /** The organisation's alert addresses with their status (`alerts.manage`). */
  listAlertRecipients(signal?: AbortSignal): Promise<AlertRecipientDto[]>;
  /** Adds an address and sends it the confirmation e-mail. 503 when e-mail is not set up. */
  addAlertRecipient(email: string): Promise<AlertRecipientDto>;
  removeAlertRecipient(id: string): Promise<void>;
  /** Public: the confirmation page posts the token from its link. 404 for any link not valid. */
  confirmAlertRecipient(token: string): Promise<void>;

  logout(): Promise<LogoutResponse>;
}

function get(path: string, signal: AbortSignal | undefined) {
  return signal === undefined ? { path } : { path, signal };
}

export function createEndpoints(client: ApiClient): Endpoints {
  return {
    async listSites(signal) {
      return (await client.request(get(ROUTES.sites, signal), SiteListResponseSchema)).items;
    },

    async listDisplays(signal) {
      return (await client.request(get(ROUTES.displays, signal), DisplayListResponseSchema)).items;
    },
    getDisplay(id, signal) {
      return client.request(get(ROUTES.display(id), signal), DisplayDtoSchema);
    },
    createDisplay(input) {
      return client.request(
        { method: 'POST', path: ROUTES.displays, body: input },
        DisplayDtoSchema,
      );
    },
    patchDisplay(id, patch) {
      return client.request(
        { method: 'PATCH', path: ROUTES.display(id), body: patch },
        DisplayDtoSchema,
      );
    },
    claimPairing(displayId, code) {
      return client.request(
        { method: 'POST', path: ROUTES.displayClaim(displayId), body: { code } },
        PairingClaimResponseSchema,
      );
    },
    revokePlayer(displayId) {
      return client.request(
        { method: 'POST', path: ROUTES.displayRevokePlayer(displayId) },
        RevokePlayerResponseSchema,
      );
    },
    getDisplayStatus(displayId, signal) {
      return client.request(get(ROUTES.displayStatus(displayId), signal), DeliveryStatusViewSchema);
    },
    async listDisplayStatuses(signal) {
      return (
        await client.request(get(ROUTES.displaysStatus, signal), DeliveryStatusListResponseSchema)
      ).items;
    },

    listMedia(signal) {
      return client.request(get(ROUTES.media, signal), MediaListResponseSchema);
    },
    getMedia(id, signal) {
      return client.request(get(ROUTES.mediaItem(id), signal), MediaDtoSchema);
    },
    patchMedia(id, patch) {
      return client.request(
        { method: 'PATCH', path: ROUTES.mediaItem(id), body: patch },
        MediaDtoSchema,
      );
    },
    getMediaUsage(id, signal) {
      return client.request(get(ROUTES.mediaUsage(id), signal), MediaUsageResponseSchema);
    },
    deleteMedia(id) {
      return client.requestNoContent({ method: 'DELETE', path: ROUTES.mediaItem(id) });
    },

    async listTags(scope, signal) {
      const path =
        scope === undefined
          ? ROUTES.tags
          : `${ROUTES.tags}?${new URLSearchParams({ scope }).toString()}`;
      return (await client.request(get(path, signal), TagListResponseSchema)).items;
    },
    createTag(input) {
      return client.request({ method: 'POST', path: ROUTES.tags, body: input }, TagDtoSchema);
    },
    patchTag(id, patch) {
      return client.request({ method: 'PATCH', path: ROUTES.tag(id), body: patch }, TagDtoSchema);
    },
    deleteTag(id) {
      return client.requestNoContent({ method: 'DELETE', path: ROUTES.tag(id) });
    },

    async listFolders(signal) {
      return (await client.request(get(ROUTES.folders, signal), FolderListResponseSchema)).items;
    },
    createFolder(name) {
      return client.request(
        { method: 'POST', path: ROUTES.folders, body: { name } },
        FolderDtoSchema,
      );
    },
    renameFolder(id, name) {
      return client.request(
        { method: 'PATCH', path: ROUTES.folder(id), body: { name } },
        FolderDtoSchema,
      );
    },
    deleteFolder(id) {
      return client.requestNoContent({ method: 'DELETE', path: ROUTES.folder(id) });
    },

    async listApps(signal) {
      return (await client.request(get(ROUTES.apps, signal), AppListResponseSchema)).items;
    },
    getApp(id, signal) {
      return client.request(get(ROUTES.app(id), signal), AppDtoSchema);
    },
    createApp(input) {
      return client.request({ method: 'POST', path: ROUTES.apps, body: input }, AppDtoSchema);
    },
    patchApp(id, patch) {
      return client.request({ method: 'PATCH', path: ROUTES.app(id), body: patch }, AppDtoSchema);
    },
    deleteApp(id) {
      return client.requestNoContent({ method: 'DELETE', path: ROUTES.app(id) });
    },

    async listPlaylists(signal) {
      return (await client.request(get(ROUTES.playlists, signal), PlaylistListResponseSchema))
        .items;
    },
    async createPlaylist(name) {
      const created = await client.request(
        { method: 'POST', path: ROUTES.playlists, body: { name } },
        CreatedPlaylistSchema,
      );
      return { id: created.id };
    },
    getPlaylist(id, signal) {
      return client.request(get(ROUTES.playlist(id), signal), PlaylistDtoSchema);
    },
    replacePlaylist(id, body) {
      return client.request({ method: 'PUT', path: ROUTES.playlist(id), body }, PlaylistDtoSchema);
    },
    duplicatePlaylist(id) {
      return client.request(
        { method: 'POST', path: ROUTES.playlistDuplicate(id) },
        PlaylistDuplicateResponseSchema,
      );
    },
    deletePlaylist(id) {
      return client.requestNoContent({ method: 'DELETE', path: ROUTES.playlist(id) });
    },
    publish(playlistId, displayId, idempotencyKey) {
      return client.request(
        {
          method: 'POST',
          path: ROUTES.playlistPublish(playlistId),
          body: { displayId },
          headers: { [HEADERS.idempotencyKey]: idempotencyKey },
        },
        PublishResponseSchema,
      );
    },

    async listSchedules(signal) {
      return (await client.request(get(ROUTES.schedules, signal), ScheduleListResponseSchema))
        .items;
    },
    getSchedule(id, signal) {
      return client.request(get(ROUTES.schedule(id), signal), ScheduleDtoSchema);
    },
    createSchedule(input) {
      return client.request(
        { method: 'POST', path: ROUTES.schedules, body: input },
        ScheduleDtoSchema,
      );
    },
    replaceSchedule(id, input) {
      return client.request(
        { method: 'PUT', path: ROUTES.schedule(id), body: input },
        ScheduleDtoSchema,
      );
    },
    deleteSchedule(id) {
      return client.requestNoContent({ method: 'DELETE', path: ROUTES.schedule(id) });
    },

    async listLayouts(signal) {
      return (await client.request(get(ROUTES.layouts, signal), LayoutListResponseSchema)).items;
    },
    getLayout(id, signal) {
      return client.request(get(ROUTES.layout(id), signal), LayoutDtoSchema);
    },
    createLayout(input) {
      return client.request({ method: 'POST', path: ROUTES.layouts, body: input }, LayoutDtoSchema);
    },
    replaceLayout(id, input) {
      return client.request(
        { method: 'PUT', path: ROUTES.layout(id), body: input },
        LayoutDtoSchema,
      );
    },
    deleteLayout(id) {
      return client.requestNoContent({ method: 'DELETE', path: ROUTES.layout(id) });
    },

    getPushPlan(signal) {
      return client.request(get(ROUTES.push, signal), PushPlanResponseSchema);
    },
    push(displayIds, idempotencyKey) {
      return client.request(
        {
          method: 'POST',
          path: ROUTES.push,
          body: { displayIds: [...displayIds] },
          headers: { [HEADERS.idempotencyKey]: idempotencyKey },
        },
        PushResponseSchema,
      );
    },

    getOverview(signal) {
      return client.request(get(ROUTES.overview, signal), OverviewResponseSchema);
    },

    listAudit(query, signal) {
      const params = new URLSearchParams({ limit: String(query.limit) });
      if (query.before !== undefined) params.set('before', query.before);
      if (query.category !== undefined) params.set('category', query.category);
      if (query.result !== undefined) params.set('result', query.result);
      return client.request(
        get(`${ROUTES.audit}?${params.toString()}`, signal),
        AuditListResponseSchema,
      );
    },

    async listMembers(signal) {
      return (await client.request(get(ROUTES.members, signal), MemberListResponseSchema)).items;
    },
    async listMemberNames(signal) {
      return (await client.request(get(ROUTES.memberNames, signal), MemberNameListResponseSchema))
        .items;
    },
    async listInvites(signal) {
      return (await client.request(get(ROUTES.invites, signal), InviteListResponseSchema)).items;
    },
    createInvite(input) {
      return client.request({ method: 'POST', path: ROUTES.invites, body: input }, InviteDtoSchema);
    },
    cancelInvite(id) {
      return client.requestNoContent({ method: 'POST', path: ROUTES.inviteCancel(id) });
    },
    patchMember(id, patch) {
      return client.request(
        { method: 'PATCH', path: ROUTES.member(id), body: patch },
        MemberChangeResponseSchema,
      );
    },
    removeMember(id) {
      return client.request(
        { method: 'POST', path: ROUTES.memberRemove(id) },
        MemberChangeResponseSchema,
      );
    },
    signOutMember(id) {
      return client.request(
        { method: 'POST', path: ROUTES.memberSignOut(id) },
        MemberSignOutResponseSchema,
      );
    },

    async listAlertRecipients(signal) {
      return (
        await client.request(get(ROUTES.alertRecipients, signal), AlertRecipientListResponseSchema)
      ).items;
    },
    addAlertRecipient(email) {
      return client.request(
        { method: 'POST', path: ROUTES.alertRecipients, body: { email } },
        AlertRecipientDtoSchema,
      );
    },
    removeAlertRecipient(id) {
      return client.requestNoContent({ method: 'DELETE', path: ROUTES.alertRecipient(id) });
    },
    confirmAlertRecipient(token) {
      return client.requestNoContent({
        method: 'POST',
        path: ROUTES.alertRecipientConfirm,
        body: { token },
      });
    },

    logout() {
      return client.request({ method: 'POST', path: ROUTES.authLogout }, LogoutResponseSchema);
    },
  };
}
