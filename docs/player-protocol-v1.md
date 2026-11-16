# Player protocol v1

Date: 2026-11-14. Status: implemented in `apps/api` (prototype M0), exercised by `apps/api/test/*.integration.test.ts` and `apps/api/scripts/live-check.mjs`. Schemas are the zod definitions in `packages/contracts`; this page explains how they are used on the wire. Where this page and the schemas disagree, the schemas win.

The protocol is plain HTTPS polling (plain HTTP only on loopback in development). There is no push channel. A player is an **untrusted client**: nothing it sends authorises an operator action, and a report is evidence of what the player software believes, not proof of what a panel shows.

## 1. Transport rules

| Topic | Rule |
|---|---|
| Base URL | `API_PUBLIC_ORIGIN` (development: `http://localhost:4000`). All paths start with `/player`. |
| Bodies | JSON, `Content-Type: application/json`, UTF-8. Unknown fields are rejected (strict schemas). |
| Body size | 256 KiB at most; `POST /player/heartbeat` 16 KiB at most. Larger: `413 payload_too_large`. |
| CORS | `Access-Control-Allow-Origin` is sent only when `Origin` equals `PLAYER_ORIGIN`, and only for `/player/*`. No credentials mode. Allowed methods: GET, HEAD, POST, DELETE. Allowed request headers: `Authorization`, `Content-Type`, `If-None-Match`, `Range`, `If-Range`. Exposed response headers: `ETag`, `Content-Range`, `Accept-Ranges`, `Content-Length`, `Retry-After`. |
| Caching | Every JSON response is `Cache-Control: no-store`, except the manifest (`private, no-cache`). Media is `private, max-age=31536000, immutable`. |
| Errors | Every non-2xx response is `{"error":{"code","message","details"?,"requestId"}}` (`ApiErrorSchema`). Act on `code`; `message` is for people. |
| Request id | Every response carries `X-Request-Id`. |
| Time | All timestamps are ISO 8601 UTC. The server never trusts the player clock. |

## 2. Credentials

Three separate secrets exist. All are 32 random bytes, base64url (43 characters, `OpaqueTokenSchema`).

| Secret | Who holds it | Sent as | Lifetime |
|---|---|---|---|
| Polling token | The player, during pairing only | `Authorization: Bearer` on `GET /player/pairing/:id` | Until the pairing session completes or expires (10 minutes) |
| Device token | The player, in IndexedDB | `Authorization: Bearer` on manifest, media-urls, heartbeat, registration | Until revoked. Never expires by itself in M0. |
| Media URL signature | Inside a URL issued to the player | Query parameter `sig` | 300 seconds by default (`LIMIT_MEDIA_URL_TTL_SECONDS`) |

The server stores only the SHA-256 of the polling token and of the device token. A device token is bound to one registration, which is bound to one display of one organisation. It is not a session cookie and gives no access to `/api/*`; an operator session gives no access to `/player/*`.

A device token is lost if the single response that carries it is lost. The player then pairs again.

Exposure limits: the token lives in the browser profile of the player origin. Anyone with access to that profile, or script running on the player origin, can read it. It can fetch only the current publication of its own display and post reports for that display. Revocation is the remedy.

## 3. Pairing

```
player                      API                          operator (portal)
  | POST /player/pairing     |                               |
  |------------------------->| creates session, code         |
  |<-- 201 pairingId, code, pollingToken, expiresAt          |
  | shows the code on screen |                               |
  | GET /player/pairing/:id  |                               |
  |------------------------->|  200 {status:"pending"}       |
  |                          |<-- POST /api/displays/:id/claim {code}
  |                          |    atomic claim, old player revoked
  | GET /player/pairing/:id  |                               |
  |------------------------->| creates the registration, stores the token hash
  |<-- 200 {status:"claimed", deviceToken, registrationId, orgId, display}
  | GET again -> {status:"consumed"}                         |
```

### `POST /player/pairing`

No body, no credential. Response `201` (`PairingCreateResponseSchema`):

```json
{ "pairingId": "uuid", "code": "K7M2QX4D", "pollingToken": "43 chars",
  "expiresAt": "2026-11-14T06:47:00.000Z", "expiresInSeconds": 600, "pollIntervalMs": 2000 }
```

- `expiresAt` is server time. A player must **not** compare it with its own clock: a device whose clock runs ten minutes fast would treat every fresh code as expired. Count down from `expiresInSeconds`, measured from when the response arrived, and let the poll answer (`expired`, `consumed`, `404`) decide that a code is gone. The browser player gives up on its own only when its local deadline has passed by 30 s and the server cannot be reached. (`expiresInSeconds` was added on 2026-11-14 after a review found that a fast clock prevented pairing.)

- The code is 8 symbols from `23456789ABCDEFGHJKMNPQRSTVWXYZ`, chosen with a CSPRNG. Show it as `K7M2-QX4D` (`formatPairingCode`).
- Limit: 10 pairing sessions per client address per 10 minutes (stored as a keyed hash of the address, never the address). Over the limit: `429 rate_limited` with `Retry-After`.
- A code alone gives nothing: claiming needs a signed-in operator, and collecting the credential needs the polling token, which never leaves the player.

### `GET /player/pairing/:id`

`Authorization: Bearer <pollingToken>`. Poll every `pollIntervalMs`.

| Response | Meaning | Player action |
|---|---|---|
| `200 {"status":"pending","expiresAt"}` | Not claimed yet | Keep polling |
| `200 {"status":"claimed", deviceToken, registrationId, orgId, display:{id,name,canvas,contentRect}}` | Claimed. **Returned exactly once.** | Store the token, registration id, org id and display; start syncing |
| `200 {"status":"consumed"}` | The token was already handed out | If the player has no token, start a new pairing |
| `200 {"status":"expired"}` | The code expired unclaimed | Start a new pairing |
| `404 not_found` | Unknown id, wrong polling token, missing header, or locked session. Deliberately indistinguishable. | Start a new pairing |

Five wrong polling tokens lock a session permanently. Five wrong codes by one operator within 10 minutes block that operator's claims (`429 pairing_locked` on the portal side).

Claiming a display that already has a player revokes the previous registration (reason `replaced`).

## 4. Registration lifecycle

```
(none) --pairing completed--> active --operator revoke--------> revoked (operator)
                                 |-----new player paired------> revoked (replaced)
                                 |-----DELETE /player/registration--> revoked (player_reset)
```

Revocation is permanent. A revoked or unknown device token gets `401 device_revoked` on every credentialed route; a missing or malformed header gets `401 unauthenticated`. Failed lookups are counted per client address: after 30 in 10 minutes, credentialed requests from that address get `429 rate_limited` (with `Retry-After`) without a database lookup, unless they carry a credential the server verified recently. Real players behind one address are therefore not blocked by an attacker sharing it, but a player paired during such a block must wait. Signed media URLs issued earlier stop working at the same moment (`401 device_revoked`), because the registration is looked up on every media request.

Revocation stops **future** server access. It cannot erase a device that is offline; that device keeps playing what it has cached until it next contacts the server, sees `401`, and must then stop and clear its cache.

### `DELETE /player/registration`

Player-initiated reset. `Authorization: Bearer <deviceToken>`. Response `204`. The registration is revoked with reason `player_reset`. The player should call this before deleting its local state when it is online; when offline it clears locally and the operator revokes from the portal. (This route is not in `ROUTES` of `packages/contracts`.)

A player that is paired to a display of another organisation must first delete every cached asset and all state of the previous registration. Cache names must include the organisation id and registration id from the `claimed` response.

## 5. Manifest

### `GET /player/manifest`

`Authorization: Bearer <deviceToken>`, optional `If-None-Match`.

| Response | Meaning |
|---|---|
| `204` | Nothing is published to this display |
| `200 {"manifest": Manifest}` with `ETag: "<publicationId>"` | The current (desired) publication, version 1 or 2 (below) |
| `304` with the same `ETag` | `If-None-Match` named the current publication |
| `401` | Credential revoked or invalid |

ETag rules: the ETag is the publication id in double quotes (`manifestEtag`). `If-None-Match` may carry one value or a comma-separated list; weak validators (`W/"..."`) are accepted. A publication never changes, so the same ETag always means byte-identical content. A new publish produces a new id and therefore a new ETag.

`ManifestV1` (`ManifestV1Schema`):

```json
{
  "schemaVersion": 1,
  "publicationId": "uuid",
  "displayId": "uuid",
  "createdAt": "2026-11-14T06:37:12.345Z",
  "canvas": { "width": 1920, "height": 320 },
  "contentRect": { "x": 64, "y": 0, "width": 1792, "height": 320 },
  "muted": true,
  "assets": [
    { "assetId": "uuid", "mediaType": "image/jpeg", "kind": "image", "bytes": 7320,
      "sha256": "64 hex", "durationMs": 5000, "fit": "cover", "width": 640, "height": 360 }
  ]
}
```

- `assets` is the ordered play list. The same `assetId` may appear more than once; it then has identical `bytes`, `sha256` and `mediaType`.
- `durationMs` is the time on screen. For video it is the natural duration measured at validation.
- `fit` is already resolved (`contain` or `cover`); the display's default was applied at publish time.
- `contentRect` null means the whole canvas. Content is drawn only inside the rectangle; the rest of the frame stays black.
- The manifest contains no URLs. A player must reject a manifest whose `schemaVersion` it does not know (`parseManifest` distinguishes "unsupported version" from "malformed") and keep playing the previous version.

### Manifest v2 (stage B, slice 1)

`ManifestV2Schema` is the v1 document with `schemaVersion: 2` and these fields added. Every field is required; none has a default.

| Field | Meaning |
|---|---|
| `timeZone` | The IANA zone of the screen's site, for example `Australia/Melbourne`. The contract only checks its length (1 to 64); the server checks the zone when it builds the manifest. |
| `transition` | `cut` or `fade`. Fade is 500 ms and only from one image to the next image; the first item and anything with a video cut. |
| `shuffle` | `true` plays every item once per round in a new order each round. |
| `rotation` | `0`, `90`, `180` or `270`, clockwise. The canvas keeps its size; the player turns the picture. |
| `workingHours` | `null` (always on) or 7 entries, index 0 = Monday. Each is `null` (closed all day) or `{start, end}` as `HH:mm`, with `start < end`; `24:00` is the only way to say midnight at the end of a day. At least one day is open. |
| `assets[].availableFrom`, `assets[].availableUntil` | `null` or a wall-clock `YYYY-MM-DDTHH:mm` (year 1000 or later) in `timeZone`. From is inclusive, until is exclusive; when both are set, from is before until. |

`assets` stays a flat top-level list with `assetId`, and `activeItemIndex` in the heartbeat stays an index into `assets`, also under shuffle.

Time rules (required player behaviour, `apps/player-web/src/core/time-rules.ts`):

- Rules are evaluated with the player's clock corrected by the server: offset = `serverTime` of the last heartbeat reply minus the local clock.
- The local wall clock in `timeZone` decides. Outside working hours (the day is `null`, or the time is not `start <= time < end`) nothing is shown: the stage is black, no slate, and the player reports `state: idle` with `activePublicationId: null`.
- Inside working hours an item plays when `availableFrom <= now < availableUntil` (a `null` side is no limit).
- Fail open: when the corrected clock is more than 5 minutes before the publication's `createdAt`, or the browser does not know `timeZone`, every item plays. A screen never goes blank because of a dead real-time clock or an old time zone database.
- Rules are checked at item boundaries, so an item may run past an edge by up to its own length. An edge inside the repeated hour of a daylight-saving fall-back is ambiguous.
- When at least one item is playable but every playable item fails, the player reports a playback fault as in v1; a window cannot hide a broken publication behind "nothing is due".

The portal shows a screen whose player holds the desired publication, is idle and shows nothing as `standing_by` ("Standing by"), in the in-sync group.

## 6. Media download

### `POST /player/media-urls`

`Authorization: Bearer <deviceToken>`. Body (`MediaUrlsRequestSchema`): `{ "publicationId": "uuid", "assetIds": ["uuid", ...] }` (1 to 500 ids).

Response `200` (`MediaUrlsResponseSchema`): `{ "publicationId", "urls": [{ "assetId", "url", "expiresAt" }] }`, one entry per distinct asset id.

`404 not_found` when the publication is not the **current** publication of this display, or when any asset is not part of it. A player that gets `404` here fetches the manifest again. A player can therefore never obtain URLs for another display's content, even inside its own organisation.

### Signed URL format

```
<API_PUBLIC_ORIGIN>/player/media/<assetId>?pub=<publicationId>&reg=<registrationId>&exp=<unix seconds>&sig=<43 chars>
```

`sig` is base64url of `HMAC-SHA256(MEDIA_URL_HMAC_SECRET, "tinnox-media-url-v1\n" + reg + "\n" + pub + "\n" + assetId + "\n" + exp)`. Query parameters are exactly `pub`, `reg`, `exp`, `sig` (`MediaUrlQuerySchema`); any other parameter makes the URL invalid.

Treat the URL as a secret for its lifetime. Never log it, never put it in a heartbeat error message.

### `GET /player/media/:assetId`

No `Authorization` header is needed; the signature is the authorisation, so a service worker or a media element can fetch it. The server checks, in this order:

1. shape of the path and query, then the signature in constant time: `403 url_signature_invalid`;
2. expiry against the server clock: `403 url_expired` (request new URLs);
3. the registration named by `reg` is still active: `401 device_revoked`;
4. the asset belongs to publication `pub`, and `pub` belongs to the display of that registration: `404 not_found`.

Response: `200` with the bytes, or `206` for a single `Range: bytes=a-b`, `a-` or `-n` request (`416 range_not_satisfiable` with `Content-Range: bytes */<size>` otherwise; multi-range requests get the whole object). Headers: `Content-Type` (`image/jpeg`, `image/png` or `video/mp4`, from validation, never from the upload), `Content-Length`, `Accept-Ranges: bytes`, `ETag: "<sha256>"`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline; filename="tinnox-<assetId>.<ext>"`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-site`. `If-None-Match` with the ETag gives `304`. `HEAD` is supported and reports the real `Content-Length` (it reported 0 before 2026-11-14).

The bytes behind an asset id never change. Media that an operator deletes from the library stays downloadable for as long as a publication references it.

## 7. Update and cache activation (required player behaviour)

The server cannot enforce this; it is the contract a v1 player implements (D14).

1. Poll `GET /player/manifest` with `If-None-Match` (suggested: with every heartbeat, and at once when a heartbeat response shows a different `desiredPublicationId`).
2. On a new manifest, **stage** it: request URLs, download every distinct asset into a staging set, and for each asset check that the byte count equals `bytes` and the SHA-256 equals `sha256`. Probe that the media decodes.
3. Only when every asset is verified, commit the new publication as the active version in one local transaction, and switch at the next item boundary.
4. On any failure (network, `size_mismatch`, `integrity_mismatch`, `quota_exceeded`, `unsupported_media`, `decode_failed`) keep the previous version playing, report the error in the next heartbeat, and retry later. Never show a partial version.
5. Garbage-collect only assets referenced by neither the active nor the staging version.
6. With no network, keep playing the active version from cache and keep increasing `seq`; report when the connection returns.

State as the server sees it (`display_delivery`):

```
desired      set by publish only
downloaded   last publication the player reported as fully downloaded and verified
active       publication and item index the player reported as rendering
staging      {publicationId, phase: downloading|verifying|ready|failed, assetsDone, assetsTotal} or null
```

## 8. Heartbeat

### `POST /player/heartbeat`

`Authorization: Bearer <deviceToken>`. Body `HeartbeatV1Schema`:

```json
{
  "schemaVersion": 1,
  "seq": 42,
  "sentAt": "2026-11-14T06:40:00.000Z",
  "displayId": "uuid",
  "downloadedPublicationId": "uuid or null",
  "activePublicationId": "uuid or null",
  "activeItemIndex": 1,
  "playerState": "idle | playing | error",
  "staging": null,
  "errors": [
    { "code": "integrity_mismatch", "message": "short text", "at": "2026-11-14T06:39:58.000Z",
      "publicationId": "uuid or null", "assetId": "uuid or null" }
  ],
  "player": { "version": "build id", "storagePersisted": true, "online": true }
}
```

Response `200` (`HeartbeatResponseSchema`):

```json
{ "accepted": true, "ignoredReason": null, "desiredPublicationId": "uuid or null",
  "serverTime": "2026-11-14T06:40:00.120Z", "nextHeartbeatInMs": 15000 }
```

Rules:

- **Sequence.** `seq` must increase with every report of one registration (persist it locally, so it survives a reload). A report whose `seq` is not greater than the stored one is answered `200 {"accepted": false, "ignoredReason": "stale_seq"}` and changes nothing. A delayed or replayed report therefore cannot overwrite newer state. The check and the update run under one row lock, so concurrent reports cannot interleave.
- **New registration, new sequence.** The stored sequence belongs to the registration that produced it. A newly paired player starts again from any number.
- **Display.** `displayId` must be the display of the credential: otherwise `403 forbidden`.
- **Publications.** Every publication id named anywhere in the report (downloaded, active, staging, errors) must be a publication of that display: otherwise `409 conflict`. This includes publications of another display of the same organisation.
- **Shape.** Schema violations (unknown fields, `playing` without an active publication, `activePublicationId` and `activeItemIndex` not both set, `assetsDone > assetsTotal`, more than 10 errors, messages over 300 characters): `400 validation_failed`.
- **Rejected reports change nothing** and are not stored.
- `errors` is the most recent problems, newest first, replaced as a whole by each accepted report. Messages must not contain URLs or tokens.
- Send every `nextHeartbeatInMs` (default 15 s). The portal marks a display stale when the last **accepted** report is older than 60 s (`LIMIT_HEARTBEAT_STALE_AFTER_SECONDS`), measured on the server clock at the time the status is read. Nothing stores an "online" flag. Raw reports are kept as diagnostic history only when accepted, at most one per display per 10 s, for `LIMIT_HEARTBEAT_LOG_RETENTION_HOURS` (default 24); ignored reports (stale `seq`) are not stored.
- Rate limit: 120 reports per minute per credential.

What the portal derives (`GET /api/displays/:id/status`, `DeliveryStatusViewSchema`): `summary` is `unpaired`, `nothing_published`, `awaiting_player`, `stale`, `updating`, `standing_by`, `error` or `in_sync`. `standing_by` means the player holds the desired publication and reports nothing is due to show now (idle, no active publication); it is also reported for a moment between activation and the first item. Reports from a registration that is no longer the active one are not shown as current.

## 9. Capability negotiation

M0 negotiates on the server, at publish time, not with each device.

- Every display has a `route` (only `browser` exists). Each route has a capability profile (`CapabilityProfileSchema`, `packages/delivery`). For the browser route, profile version 1: JPEG, PNG and MP4 with H.264 (8-bit 4:2:0); `contain` and `cover`; one full-frame region; muted; optional content rectangle; canvas up to 16384 px per side; video up to 3840x2160; assets up to the upload limit; up to 200 items.
- `POST /api/playlists/:id/publish` checks the playlist against the profile of the target display's route. A playlist the route cannot show is refused with `422 publication_rejected` and one readable reason per item (`PUBLISH_REJECTION_CODES`). Nothing unsupported reaches a manifest.
- A player declares nothing about itself except `player.version`. If a device cannot play an asset that the profile allows (for example a browser build without H.264), it reports `unsupported_media` or `decode_failed` in the heartbeat and keeps the previous version. Per-device capability reports are a later addition and would be a new field in a new heartbeat schema version.
- Version handling: `schemaVersion` is explicit in the manifest and the heartbeat. There is no per-player version negotiation. The server writes manifest v1 unless the publication needs v2: a transition other than `cut`, shuffle, a rotation other than 0, working hours, or an availability window on any item. So a screen whose settings did not change keeps getting the same kind of document. The ETag stays the publication id; there is no request header, `Vary` or down-conversion.
- A v1 player (before `player-web/0.2.0`) that receives v2 reports `manifest_unsupported_version` and keeps playing its last content. Nothing reloads a running player: it moves to v2 only when its page is reloaded. The portal says so under that error on the screen's Overview tab.
- Manifest v2 stays open while stage B is built: fields may still be added. It is frozen when stage B closes.

A later LED route (a dedicated player over HDMI, or controller-native playback) gets its own profile and its own `route` id. Nothing in this protocol claims compatibility with any LED controller.

## 10. Error codes a player must handle

| HTTP | `error.code` | Where | Player action |
|---|---|---|---|
| 400 | `validation_failed`, `bad_request` | any | Bug in the player or a corrupted request; log it, do not retry unchanged |
| 401 | `unauthenticated` | credentialed routes | No or malformed credential; pair |
| 401 | `device_revoked` | credentialed routes, media | Stop syncing, clear cache and registration, show the pairing screen |
| 403 | `forbidden` | heartbeat | The report names another display; local state is corrupt, reset |
| 403 | `url_signature_invalid` | media | Request new URLs |
| 403 | `url_expired` | media | Request new URLs |
| 404 | `not_found` | pairing poll | Start a new pairing |
| 404 | `not_found` | media-urls, media | The publication was superseded; fetch the manifest |
| 409 | `conflict` | heartbeat | The report names an unknown publication; drop that local state |
| 413 | `payload_too_large` | heartbeat | Shorten the error list |
| 416 | `range_not_satisfiable` | media | Restart the download from byte 0 |
| 429 | `rate_limited` | any | Wait for `Retry-After`, then continue |
| 5xx | `internal_error`, `service_unavailable` | any | Keep playing from cache; retry with backoff |

## 11. What was verified, and how

Run on 2026-11-14 against PostgreSQL 17 and the real application:

- `npm run test:integration -w @tinnox/api` (28 tests): one winner among eight concurrent claims across two organisations and exactly one token among six concurrent polls; lockouts; reset; stale and concurrent heartbeats; rejected reports; staleness from the clock; ETag and 304; signed URL tampering of every field, expiry, cross-display, cross-organisation and revocation; CORS.
- `node apps/api/scripts/live-check.mjs` (105 checks) through a real Keycloak sign-in with TOTP, the real worker container and real JPEG, PNG and H.264 files.

Not verified here: behaviour of a real browser player (owned by `apps/player-web` and the end-to-end tests), long outages, and anything on LED hardware.
