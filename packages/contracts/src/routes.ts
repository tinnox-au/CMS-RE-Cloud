/**
 * Route path constants shared by the API, the portal and the player.
 * `*_PATTERN` values use Fastify-style `:param` placeholders; the functions
 * build concrete paths and always percent-encode their arguments.
 */
const enc = encodeURIComponent;

export const API_PREFIX = '/api';
export const PLAYER_PREFIX = '/player';

export const ROUTES = Object.freeze({
  healthz: '/healthz',
  readyz: '/readyz',

  authLogin: '/api/auth/login',
  authCallback: '/api/auth/callback',
  authLogout: '/api/auth/logout',
  session: '/api/session',

  sites: '/api/sites',

  displays: '/api/displays',
  displayPattern: '/api/displays/:id',
  display: (id: string) => `/api/displays/${enc(id)}`,
  displayClaimPattern: '/api/displays/:id/claim',
  displayClaim: (id: string) => `/api/displays/${enc(id)}/claim`,
  displayRevokePlayerPattern: '/api/displays/:id/revoke-player',
  displayRevokePlayer: (id: string) => `/api/displays/${enc(id)}/revoke-player`,
  displayStatusPattern: '/api/displays/:id/status',
  displayStatus: (id: string) => `/api/displays/${enc(id)}/status`,
  /** GET: the status of every display in one call. A fixed path, registered beside `:id`. */
  displaysStatus: '/api/displays/status',

  media: '/api/media',
  /** GET, PATCH, DELETE. */
  mediaItemPattern: '/api/media/:id',
  mediaItem: (id: string) => `/api/media/${enc(id)}`,
  mediaPreviewPattern: '/api/media/:id/preview',
  mediaPreview: (id: string) => `/api/media/${enc(id)}/preview`,
  /** GET: a small JPEG for images that have one, otherwise the same bytes as the preview. */
  mediaThumbnailPattern: '/api/media/:id/thumbnail',
  mediaThumbnail: (id: string) => `/api/media/${enc(id)}/thumbnail`,
  /** GET: the playlists and displays that use a media item. */
  mediaUsagePattern: '/api/media/:id/usage',
  mediaUsage: (id: string) => `/api/media/${enc(id)}/usage`,

  /** GET (optional `?scope=`), POST. */
  tags: '/api/tags',
  /** PATCH, DELETE. */
  tagPattern: '/api/tags/:id',
  tag: (id: string) => `/api/tags/${enc(id)}`,

  /** GET, POST. */
  folders: '/api/folders',
  /** PATCH, DELETE. */
  folderPattern: '/api/folders/:id',
  folder: (id: string) => `/api/folders/${enc(id)}`,

  /** GET, POST. */
  apps: '/api/apps',
  /** GET, PATCH (the type never changes), DELETE (409 `app_in_use` while a live playlist has it). */
  appPattern: '/api/apps/:id',
  app: (id: string) => `/api/apps/${enc(id)}`,

  playlists: '/api/playlists',
  /** GET, PUT, DELETE (204, or 409 `playlist_in_use` while a display has it assigned or a schedule or a layout uses it). */
  playlistPattern: '/api/playlists/:id',
  playlist: (id: string) => `/api/playlists/${enc(id)}`,
  playlistPublishPattern: '/api/playlists/:id/publish',
  playlistPublish: (id: string) => `/api/playlists/${enc(id)}/publish`,
  /** POST: copy a playlist with its items. */
  playlistDuplicatePattern: '/api/playlists/:id/duplicate',
  playlistDuplicate: (id: string) => `/api/playlists/${enc(id)}/duplicate`,

  /** GET, POST. */
  schedules: '/api/schedules',
  /** GET, PUT, DELETE (409 `schedule_in_use` while a display has it assigned). */
  schedulePattern: '/api/schedules/:id',
  schedule: (id: string) => `/api/schedules/${enc(id)}`,

  /** GET, POST. */
  layouts: '/api/layouts',
  /** GET, PUT, DELETE (409 `layout_in_use` while a display has it assigned). */
  layoutPattern: '/api/layouts/:id',
  layout: (id: string) => `/api/layouts/${enc(id)}`,

  /** GET: the push plan. POST: push to the chosen displays (needs `Idempotency-Key`). */
  push: '/api/push',
  /** GET: the dashboard numbers. */
  overview: '/api/overview',

  audit: '/api/audit',

  /** GET: every member, removed ones included (member.read). */
  members: '/api/members',
  /** GET: id and name of every member (activity.read). A fixed path, registered beside `:id`. */
  memberNames: '/api/members/names',
  /** PATCH: role or display name. */
  memberPattern: '/api/members/:id',
  member: (id: string) => `/api/members/${enc(id)}`,
  memberRemovePattern: '/api/members/:id/remove',
  memberRemove: (id: string) => `/api/members/${enc(id)}/remove`,
  memberSignOutPattern: '/api/members/:id/sign-out',
  memberSignOut: (id: string) => `/api/members/${enc(id)}/sign-out`,
  /** GET: pending invites (member.read). POST: request an invite (member.manage). */
  invites: '/api/invites',
  inviteCancelPattern: '/api/invites/:id/cancel',
  inviteCancel: (id: string) => `/api/invites/${enc(id)}/cancel`,

  /** GET: the organisation's alert addresses. POST: add one and send its confirmation e-mail. */
  alertRecipients: '/api/alert-recipients',
  /** DELETE. */
  alertRecipientPattern: '/api/alert-recipients/:id',
  alertRecipient: (id: string) => `/api/alert-recipients/${enc(id)}`,
  /** POST `{ token }`: public, the confirmation link's page calls it. A fixed path beside `:id`. */
  alertRecipientConfirm: '/api/alert-recipients/confirm',

  playerPairing: '/player/pairing',
  playerPairingPollPattern: '/player/pairing/:id',
  playerPairingPoll: (id: string) => `/player/pairing/${enc(id)}`,
  playerManifest: '/player/manifest',
  playerMediaUrls: '/player/media-urls',
  playerMediaPattern: '/player/media/:assetId',
  playerMedia: (assetId: string) => `/player/media/${enc(assetId)}`,
  playerHeartbeat: '/player/heartbeat',
});

export const HEADERS = Object.freeze({
  csrf: 'x-csrf-token',
  idempotencyKey: 'idempotency-key',
  requestId: 'x-request-id',
});

/** Name of the opaque operator session cookie. The `__Host-` form is used outside loopback development. */
export const SESSION_COOKIE = Object.freeze({
  development: 'tinnox_session',
  secure: '__Host-tinnox_session',
});

/** Default local ports (prototype-m0.md D17). All bind to 127.0.0.1. */
export const DEV_PORTS = Object.freeze({
  api: 4000,
  portal: 5173,
  player: 5174,
  keycloak: 8080,
  postgres: 54329,
});
