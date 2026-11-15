import {
  AuditListResponseSchema,
  DisplayDtoSchema,
  DisplayListResponseSchema,
  DeliveryStatusViewSchema,
  HEADERS,
  LogoutResponseSchema,
  MediaListResponseSchema,
  PairingClaimResponseSchema,
  PlaylistDtoSchema,
  PlaylistListResponseSchema,
  PlaylistSummaryDtoSchema,
  PublishResponseSchema,
  RevokePlayerResponseSchema,
  ROUTES,
  SiteListResponseSchema,
  type AuditListResponse,
  type DeliveryStatusView,
  type DisplayCreateInput,
  type DisplayDto,
  type DisplayPatch,
  type LogoutResponse,
  type MediaListResponse,
  type PairingClaimResponse,
  type PlaylistDto,
  type PlaylistReplace,
  type PublishResponse,
  type RevokePlayerResponse,
  type SiteDto,
  type PlaylistSummaryDto,
} from '@tinnox/contracts';
import { z } from 'zod';
import type { ApiClient } from './client.ts';

/** `POST /api/playlists` may answer with the full playlist or its summary; only the id is used. */
const CreatedPlaylistSchema = z.union([PlaylistDtoSchema, PlaylistSummaryDtoSchema]);

export interface Endpoints {
  listSites(signal?: AbortSignal): Promise<SiteDto[]>;
  listDisplays(signal?: AbortSignal): Promise<DisplayDto[]>;
  getDisplay(id: string, signal?: AbortSignal): Promise<DisplayDto>;
  createDisplay(input: DisplayCreateInput): Promise<DisplayDto>;
  patchDisplay(id: string, patch: DisplayPatch): Promise<DisplayDto>;
  claimPairing(displayId: string, code: string): Promise<PairingClaimResponse>;
  revokePlayer(displayId: string): Promise<RevokePlayerResponse>;
  getDisplayStatus(displayId: string, signal?: AbortSignal): Promise<DeliveryStatusView>;
  listMedia(signal?: AbortSignal): Promise<MediaListResponse>;
  deleteMedia(id: string): Promise<void>;
  listPlaylists(signal?: AbortSignal): Promise<PlaylistSummaryDto[]>;
  createPlaylist(name: string): Promise<{ id: string }>;
  getPlaylist(id: string, signal?: AbortSignal): Promise<PlaylistDto>;
  replacePlaylist(id: string, body: PlaylistReplace): Promise<PlaylistDto>;
  publish(playlistId: string, displayId: string, idempotencyKey: string): Promise<PublishResponse>;
  listAudit(
    query: { limit: number; before?: string },
    signal?: AbortSignal,
  ): Promise<AuditListResponse>;
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
    listMedia(signal) {
      return client.request(get(ROUTES.media, signal), MediaListResponseSchema);
    },
    deleteMedia(id) {
      return client.requestNoContent({ method: 'DELETE', path: ROUTES.mediaItem(id) });
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
    listAudit(query, signal) {
      const params = new URLSearchParams({ limit: String(query.limit) });
      if (query.before !== undefined) params.set('before', query.before);
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
