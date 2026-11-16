import {
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
  LogoutResponseSchema,
  MediaDtoSchema,
  MediaListResponseSchema,
  MediaUsageResponseSchema,
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
  SiteListResponseSchema,
  TagDtoSchema,
  TagListResponseSchema,
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
  type LogoutResponse,
  type MediaDto,
  type MediaListResponse,
  type MediaPatch,
  type MediaUsageResponse,
  type OverviewResponse,
  type PairingClaimResponse,
  type PlaylistDto,
  type PlaylistReplace,
  type PlaylistSummaryDto,
  type PublishResponse,
  type PushPlanResponse,
  type PushResponse,
  type RevokePlayerResponse,
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
   * Also sets the description, the tags (the complete new set) and the assigned
   * playlist. Assigning changes nothing on the display until a push.
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
  /** Refused with `playlist_in_use` while a display has the playlist assigned. */
  deletePlaylist(id: string): Promise<void>;
  /** Publishes to one display and assigns the playlist to it. */
  publish(playlistId: string, displayId: string, idempotencyKey: string): Promise<PublishResponse>;

  /** Where every display stands between its assigned playlist and what it was last given. */
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
    logout() {
      return client.request({ method: 'POST', path: ROUTES.authLogout }, LogoutResponseSchema);
    },
  };
}
