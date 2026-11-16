# Prototype M0: browser-first TINNOX CMS

Date: 2026-11-14. Status: BUILT; the whole journey runs locally and was validated on 2026-11-14, again after the review fixes (`docs/prototype-validation.md`, sections 3 and 10). Not deployed anywhere; nothing committed yet. Scope source: `docs/first-prototype-agent-prompt.md` (the "brief"). Where this page and the brief disagree, the brief wins; record the difference in section 9.

This is an internal engineering prototype. It runs locally with synthetic data. It is not a production system, not certified, and not evidence of NovaStar or Huidu compatibility.

## 1. What M0 delivers

One journey: an operator signs in (with MFA), creates a display with a canvas, pairs a browser player by short code, uploads images and an MP4, builds a playlist, publishes an immutable snapshot, and watches real delivery and playback state. The player keeps playing from cache through an outage.

Originality rule: the product delivers the same kind of capability as existing signage CMS products, with original code, interface, names and text. Nothing is copied from Yodeck or any other product.

## 2. Architecture decisions (binding for all M0 code)

| # | Decision | Reason |
|---|---|---|
| D1 | npm workspaces monorepo, TypeScript strict, ES modules, Node 22 or newer (`engines`). Exact dependency versions pinned, lockfile committed. | pnpm is not installed on the dev machine; npm needs no extra tool |
| D2 | Modular monolith API: Fastify 5, `pg` with hand-written parameterised SQL, zod schemas from `packages/contracts`. No ORM. | Small surface, explicit SQL makes row-level security auditable |
| D3 | PostgreSQL 17 in Docker. Two roles: `tinnox_migrator` (owns schema, runs migrations) and `tinnox_app` (runtime; NOSUPERUSER, NOBYPASSRLS, not table owner). Every tenant table has `org_id`, `ENABLE` and `FORCE ROW LEVEL SECURITY`, and a policy on `current_setting('app.org_id', true)`. | Defence in depth for tenant isolation |
| D4 | All tenant queries run through one helper, `withOrg(orgId, fn)`: `BEGIN`, `SELECT set_config('app.org_id', $1, true)`, run on that same client, `COMMIT`. Player requests use `withOrg` with the org resolved from the device credential. Lookups that must happen before the org is known (session, device token, pairing code) go through narrow `SECURITY DEFINER` functions owned by the migrator. | Transaction-scoped context on one pooled connection |
| D5 | Identity: Keycloak in Docker with an imported realm `tinnox-dev`. The API is a confidential OIDC client (authorization code flow with PKCE) and acts as a backend-for-frontend: tokens stay on the server, the browser gets an opaque session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` outside loopback dev). Sessions are stored in PostgreSQL. TOTP is a required action for operators. The API maps the OIDC `sub` to a `membership` row; the org comes only from that row. | No custom password or MFA code; provider is replaceable |
| D6 | CSRF: state-changing portal requests need header `X-CSRF-Token` matching the per-session token from `GET /api/session`, plus an `Origin` allowlist check. | Cookie-authenticated API |
| D7 | Portal (`apps/portal`) and player (`apps/player-web`) are separate Vite apps on **separate origins**. In dev the portal proxies `/api` to the API so the session cookie is same-origin. The player calls the API cross-origin with a bearer device token; CORS allows exactly the player origin for `/player/*` and nothing else. | Player storage and service worker are isolated from operator sessions |
| D8 | Device credential: 256-bit random token, shown to the player once at claim time, stored only as SHA-256 in the database, sent as `Authorization: Bearer`. Stored by the player in IndexedDB. Revocable per registration. | Simple and reliable; exposure limits documented in the threat model |
| D9 | Pairing: the player asks for a pairing session and receives an 8-character code (unambiguous alphabet, CSPRNG) and a separate secret polling token. Codes expire after 10 minutes, are single-use, attempt-limited, and claimed atomically (`UPDATE ... WHERE status='pending' AND expires_at > now() RETURNING`). The player polls with its polling token and receives the device token exactly once. | Stolen code alone gives nothing without an authenticated operator; the token never passes through the operator's browser |
| D10 | Media storage: `packages/storage` interface with a local filesystem implementation under `MEDIA_ROOT` (default `./data/media`, outside any static or source directory). Object keys are server-generated (`<org>/<uuid>`), never derived from filenames. | Private, no path traversal |
| D11 | Media validation worker (`apps/media-worker`): a Docker container with **no network**, read-only root filesystem, non-root user, dropped capabilities, CPU, memory and PID limits, and no application secrets. It communicates only through a shared directory: the API writes `inbox/<jobId>` (the bytes) and `inbox/<jobId>.json` (limits); the worker inspects with magic-byte checks, `sharp` metadata for images and `ffprobe` for video under a timeout, and writes `outbox/<jobId>.json`. Since stage B slice 1 it also writes `outbox/<jobId>.thumb.jpg` for an accepted image: a JPEG of at most 480 px a side, made from the same single decode that proves the image is intact (no thumbnail for video). The API ingests results, moves accepted files into storage, and records SHA-256 and byte size (computed by the API, not trusted from the worker). The API never decodes a thumbnail: it accepts one only when the file is regular, owned by the same user as the verdict, 1 to 524288 bytes and starts like a JPEG, and otherwise logs a warning and stores none; a thumbnail problem never fails the media. | Untrusted files never run in the API process |
| D12 | Publication: `POST publish` validates the playlist against the target display's delivery capability profile, then writes an immutable `publication` row holding the manifest JSON (schema version, publication id, canvas, ordered assets with media type, bytes, SHA-256, duration, fit). An idempotency key makes retries safe. Database triggers reject `UPDATE` and `DELETE` on publications. | Draft edits never change what is live |
| D13 | Player protocol v1: HTTP polling. `GET /player/manifest` with `If-None-Match` (ETag is the publication id). Media through `GET /player/media/:assetId?exp=&sig=`, where the URL is HMAC-signed, short-lived, bound to the registration, and issued by `POST /player/media-urls`. `POST /player/heartbeat` carries a monotonically increasing `seq`; the server ignores reports with a lower `seq` than the last stored and rejects reports naming another display or an unknown publication. | Simple, cache-friendly, no extra infrastructure |
| D14 | Player runtime: plain TypeScript (no framework) with a service worker. Media bytes live in Cache Storage keyed by SHA-256; state lives in IndexedDB. Update is two-phase: download every asset into a staging set, verify SHA-256 and size, probe decodability, then atomically write `activeVersion` in one IndexedDB transaction and switch at the next item boundary. Any failure keeps the previous version. Garbage collection only removes assets referenced by neither the active nor the staging version. | "Never a partial version" |
| D15 | Delivery port (`packages/delivery`): `capabilities()`, `validate(publicationDraft)`, `prepare(publication)`, `normalizeStatus(report)`. Only the `browser` route is implemented. A test-only fake proves the domain does not depend on browser code. | Leaves room for HDMI-player and controller-native routes without inventing vendor methods |
| D16 | Audit: append-only `audit_event` table (actor, org, action, object, result, UTC time). The app role may `INSERT` and `SELECT` only. No file content, secrets or signed URLs in audit rows or logs; the logger redacts `authorization`, `cookie`, `sig`. | Evidence without leakage |
| D17 | Local ports, all bound to 127.0.0.1: API 4000, portal 5173, player 5174, Keycloak 8080, PostgreSQL 54329. (5000 and 7000 are taken by macOS.) | |
| D18 | No third-party analytics, remote fonts, CDNs or error reporting. Restrictive CSP on portal, player and API responses. | Australian data-flow hygiene; XSS containment |
| D19 | `NODE_ENV=production` start-up refuses to run with development secrets, `http://` issuer or cookie settings, or the dev realm. | Brief section 6 |

## 3. Repository layout

```
apps/api            Fastify API (modules: auth, orgs, displays, pairing, media, playlists, publishing, player, status, audit)
apps/media-worker   Isolated validation worker (Docker)
apps/portal         Operator UI (React + Vite)
apps/player-web     Browser player (TypeScript + Vite + service worker)
packages/contracts  zod schemas and types: API DTOs, manifest v1, heartbeat v1, capability profile
packages/domain     Pure rules: playlist validation, canvas and fit maths, publication building, delivery-state reduction
packages/delivery   Delivery port interface, browser route, test fake
packages/storage    Storage interface and local implementation
db/migrations       Numbered SQL migrations
infra/              docker-compose.yml, Keycloak realm import, role bootstrap SQL
tests/              integration (vitest, real PostgreSQL), security boundary, e2e (Playwright)
docs/               this page, player protocol, security, validation, hardware next step
```

## 4. Data model (minimum)

`organization`, `membership(org_id, oidc_sub, role)`, `site(org_id, name, timezone)`, `display(org_id, site_id, name, canvas_width, canvas_height, content_x, content_y, content_width, content_height, default_fit, route)`, `pairing_session`, `player_registration(org_id, display_id, token_hash, revoked_at)`, `media(org_id, kind, status processing|ready|failed, error_code, error_detail, bytes, sha256, width, height, duration_ms, codec, storage_key, original_name)`, `playlist(org_id, name)`, `playlist_item(org_id, playlist_id, position, media_id, duration_ms, fit)`, `publication(org_id, display_id, playlist_id, manifest jsonb, idempotency_key, created_by)`, `display_delivery(org_id, display_id, desired_publication_id, downloaded_publication_id, active_publication_id, active_item_index, last_seq, last_heartbeat_at, last_error)`, `heartbeat_log`, `audit_event`, `session`.

All timestamps are `timestamptz` in UTC. The seeded site uses `Australia/Melbourne`.

## 5. API surface (summary; schemas live in `packages/contracts`)

Portal, cookie session plus CSRF:
`GET /api/auth/login`, `GET /api/auth/callback`, `POST /api/auth/logout`, `GET /api/session`,
`GET /api/sites`, `GET|POST /api/displays`, `GET|PATCH /api/displays/:id`, `POST /api/displays/:id/claim` (body: pairing code), `POST /api/displays/:id/revoke-player`,
`GET /api/media`, `POST /api/media` (multipart, streamed with a byte limit), `GET /api/media/:id`, `GET /api/media/:id/preview`, `DELETE /api/media/:id`,
`GET|POST /api/playlists`, `GET|PUT /api/playlists/:id` (full item list replace), `POST /api/playlists/:id/publish` (body: displayId; header `Idempotency-Key`),
`GET /api/displays/:id/status`, `GET /api/audit`.

Player, CORS limited to the player origin:
`POST /player/pairing` (no auth, rate-limited), `GET /player/pairing/:id` (polling token), `GET /player/manifest`, `POST /player/media-urls`, `GET /player/media/:assetId`, `POST /player/heartbeat`.

Operations: `GET /healthz`, `GET /readyz`.

## 6. Default limits (configurable by environment)

Upload 200 MB per file; images up to 8192 px on a side and 40 megapixels; video H.264 in MP4, up to 3840×2160, up to 10 minutes; image item duration 1 to 3600 s; canvas 16 to 16384 px per side; per-organisation storage 5 GB; pairing 5 wrong attempts per code and 10 pairing sessions per IP per 10 minutes.

## 7. What M0 does not do

Scheduling, PDF, layouts with regions, transcoding, audio, billing, support access, multiple roles, any controller command, any vendor cloud, any production deployment.

## 8. Path to LED hardware

M0 proves the content model, publishing, and the player protocol in software. Two later routes plug in behind the delivery port:
1. A dedicated TINNOX player feeding a controller over HDMI. Needs kiosk-grade runtime, codec and HDMI-mode tests on real hardware.
2. Controller-native playback through a vendor API. Needs the exact model, firmware, API access and data-location review first.

See `docs/hardware-next-step.md`.

## 9. Differences from earlier documents

| Topic | Earlier documents | M0 |
|---|---|---|
| CDN | "CloudFront limited to the Australia price class" (DEC-13) | Incorrect: CloudFront has no Australia-only price class, and price classes are not a data-residency control. M0 uses private local storage; a later CDN needs its own data-flow review. |
| Identity | Amazon Cognito (PROPOSED) | Local Keycloak for development; provider kept replaceable behind OIDC |
| Player | Linux CM5 and Android players | Browser player only |
| Push channel | MQTT | HTTP polling with ETags |
| Retention | 24 months and 7 years proposed | Not treated as a legal obligation. Only the heartbeat-history period is a setting so far (`LIMIT_HEARTBEAT_LOG_RETENTION_HOURS`); session and pairing periods are fixed in code, and audit events, publications and soft-deleted media have no purge. The periods need TINNOX input (operations checklist section 3). |
| Roles | Owner, Admin, Editor, Viewer | One operator role |

Deviations from the decisions in section 2, recorded by the foundation step (2026-11-14):

| Topic | Decision as written | As built, and why |
|---|---|---|
| Owner of `SECURITY DEFINER` functions (D4) | Owned by the migrator | Owned by a third role, `tinnox_definer` (`NOLOGIN`, `BYPASSRLS`, not superuser). `FORCE ROW LEVEL SECURITY` also binds the table owner, so a function owned by the migrator could not look up a session or device token before the organisation is known. The functions live in schema `sec`, have `search_path = pg_catalog, pg_temp`, and are executable by `tinnox_app` only. |
| PostgreSQL host port (D17) | 54329 | Default 54329, configurable as `POSTGRES_HOST_PORT`. `npm run setup` picks the next free port when 54329 is taken; on the first development machine another project already listens there, so it chose 54330. All code reads the port from `.env`. |
| Extra workspace | Layout in section 3 | Added `packages/db` (`@tinnox/db`): pool, `withOrg`, typed wrappers for the `sec.*` functions, the migration runner. Shared by the API, scripts and integration tests so there is one implementation of the tenant-context helper. |
| Data model (section 4) | Minimum list | Added `publication_asset` (database-level reference from a publication to its media), `login_state` (PKCE verifier and nonce, one-time), `pairing_claim_failure` (per-operator guess throttle). `display_delivery.last_error` is `last_errors` (JSON array) and the table also stores `reporting_registration_id`, `player_state`, `staging` and `desired_at`. `media` has `mime_type`, `created_by`, `deleted_at`. |
| When the device token is created (D8, D9) | "shown to the player once at claim time" | Created when the player collects it: the operator's claim marks the pairing session; the player's next poll calls `sec.pairing_complete`, which stores only the token hash, and the API returns the token in that one response. The token therefore never exists in the operator's request and is never stored in clear. If that response is lost the player must pair again. |
| Attempt limits (D9, section 6) | 5 wrong attempts per code | A wrong code cannot be attributed to a code, so two limits exist: 5 wrong polling tokens lock a pairing session, and 5 wrong codes per operator in 10 minutes block further claims by that operator. Both are enforced in the database. |
| Membership provisioning (D5) | Membership attached at first login by matching a configured subject or username | The seed creates the membership from `DEV_OPERATOR_OIDC_SUB`, which `npm run setup` fixes as the Keycloak user id. There is no provisioning at sign-in: a subject without a membership is refused. |
| Redirect URIs (D5, D7) | One callback | Two exact URIs are registered for the development client, no wildcard: `http://localhost:5173/api/auth/callback` (through the portal proxy, the default) and `http://localhost:4000/api/auth/callback` (API directly, for tests). |
| Tooling (D1) | npm, pinned versions | `package-lock.json` is generated with npm 11.21.2 (`npx npm@11.21.2 install`), because npm 10.9.2 crashes while resolving vitest's optional peers. `npm ci` works with npm 10 and 11. TypeScript is pinned to 6.0.3 because typescript-eslint does not yet support TypeScript 7. |

Deviations recorded by the API and media-worker step (2026-11-14):

| Topic | Decision as written | As built, and why |
|---|---|---|
| Schema (D4) | Migrations 0001 and 0002 | Added `db/migrations/0003_api_lookups.sql` (0001 and 0002 unchanged): `sec.device_by_registration_id` (resolves the registration named in an already signature-verified media URL; revoked gives no row) and `sec.media_processing_jobs` (lists `processing` media ids across organisations so the API can ingest worker results and time out stuck jobs after a restart). Both follow the `sec` rules; every write still happens inside `withOrg`. |
| Signed media URL (D13) | `GET /player/media/:assetId?exp=&sig=` | Query is `pub`, `reg`, `exp`, `sig` (as in `MediaUrlQuerySchema`). The HMAC covers registration, publication, asset and expiry. The request carries no bearer header, so a media element or service worker can fetch it; the registration is looked up on every request, so revocation also stops unexpired URLs. |
| Player reset (section 5) | Not listed | Added `DELETE /player/registration` (bearer device token, 204): the player revokes its own registration. It is not in `ROUTES` of `packages/contracts`. |
| MFA evidence (D5) | TOTP is a required action | The API checks `acr`/`amr` only when `OIDC_MFA_ACR_VALUES` or `OIDC_MFA_AMR_VALUES` is set; production start-up refuses to run without one of them. With the development realm neither is set, because its ID token has no usable claim: MFA is then enforced by Keycloak's sign-in flow alone, and the `auth.login` audit event records `mfaVerifiedFromClaims: false`. |
| First type check (D11) | Magic bytes checked by the worker | The API also checks the first bytes while receiving and refuses content that is plainly not JPEG, PNG or ISO-BMFF with 415 before anything is queued. The worker still does the full inspection. |
| Media deletion (section 5) | `DELETE /api/media/:id` | Refused (409 `media_in_use`) while a playlist uses the file. When only publications reference it, the row is hidden (`deleted_at`) and the bytes stay so players can still download published assets; those bytes still count against the storage quota. |
| API tests (section 3) | `tests/` | The API's own integration tests live in `apps/api/test`. (Since the integration step, the root `npm run test:integration` includes them; see below.) |
| Worker base image (D11) | "pinned node LTS" | `node:24.22.3-alpine3.24` pinned by digest, with Alpine's `ffmpeg` 8.1 package for ffprobe. The worker runs TypeScript source with Node's built-in type stripping; no build step and no tsx in the image. |

Deviations and additions recorded by the integration and validation step (2026-11-14):

| Topic | Decision as written | As built, and why |
|---|---|---|
| Local origins (D7, D17) | Services bound to 127.0.0.1 | Servers still listen on 127.0.0.1 only, but the portal, player and API are addressed as `http://localhost:<port>`: the registered redirect URI, the session cookie host and the signed media URLs (which must match `API_PUBLIC_ORIGIN`) all use `localhost`. Opening `127.0.0.1:5173` or `127.0.0.1:5174` breaks sign-in or media downloads. The player's default API origin is therefore `http://localhost:4000`. |
| Player protocol details (D13, D14) | As in section 2 | Recorded from the player and API steps: `GET /player/manifest` answers 204 with no body when nothing is published; the heartbeat has no storage estimate because `HeartbeatV1Schema` is strict (usage and quota appear in the player's diagnostics only); the service worker caches only the player shell, and the page reads media from Cache Storage through object URLs; the player has extra phases (`standby` for a second tab, `faulted`, `resetting`). `/healthz` and `/readyz` have no contract schema. `GET /api/session` reports `displayName: "Operator"` (no name is stored). |
| Player garbage collection (D14) | "removes only assets referenced by neither the active nor the staging version" | Garbage collection now runs after the first item of a new version is on screen, not at the moment the version is adopted. Running it at adoption kept the previous version's last on-screen asset for ever (found by the E2E cache checks). Change in `apps/player-web/src/app.ts`. |
| Infrastructure commands | `infra:up` started PostgreSQL and Keycloak | `npm run infra:up` also builds and starts the media-worker container (compose profile `worker`) and waits for all three to be healthy. `npm run setup` creates `data/media` and `data/jobs/{inbox,outbox}` with fixed modes before any container starts, so Docker does not create the bind mount as root. |
| Image pinning (D1) | Exact versions | PostgreSQL (`17.12-alpine3.24`) and Keycloak (`26.8.2`) images are pinned by tag and digest, like the worker base image; GitHub Actions are pinned by commit SHA. |
| Root scripts | Section 3 | Added `npm run dev` (infra, then API, portal and player together), `npm run start:built` (production builds of portal and player), `npm run otp` (current TOTP code for the development operator), `npm run fixtures` (synthetic sample media), `npm run backup:verify` (backup and restore exercise). `npm run scan:secrets` also compares the generated secrets of the machine against every tracked and not-ignored file. |
| Tests (section 3) | `tests/` | The root `npm run test:integration` runs `packages/*/test`, `apps/*/test` and `tests/integration` (105 tests). Integration tests create operator sessions through `sec.session_create` instead of driving Keycloak; the Playwright suite (`tests/e2e`, 23 tests) does the real Keycloak sign-in with TOTP, runs the production builds of portal and player (`vite preview`, because the player's service worker exists only in a build) and starts the API itself. The portal status panel gained `data-testid` attributes for these tests; no behaviour changed. |
| CI | `.github/workflows/ci.yml` | The integration job builds the worker image and generates the fixtures; the E2E job runs only when started by hand or when the repository variable `RUN_E2E` is `true`. The workflow has never executed. |

Deviations and additions recorded by the review-fix step (2026-11-14):

| Topic | Decision as written | As built, and why |
|---|---|---|
| Schema (D4, D12, D16) | Migrations 0001 to 0003 | Added `db/migrations/0004_review_hardening.sql` (earlier files unchanged): a trigger lets `publication_asset` rows be inserted only in the transaction that created their publication and only as its manifest lists them; a trigger sets `audit_event.occurred_at` to the database time on every insert; `sec.heartbeat_log_purge` (17 `sec` functions now); `sec.session_purge_expired` also clears the stored ID token of ended sessions. |
| Heartbeat history (D13) | `heartbeat_log` | Only accepted reports are stored, at most one row per display per 10 s; the hourly housekeeping (`apps/api/src/housekeeping.ts`) purges rows older than the new limit `heartbeatLogRetentionHours` (`LIMIT_HEARTBEAT_LOG_RETENTION_HOURS`, default 24). The old purge on every 50th `seq` is gone. |
| Failed device authentication (D8, D13) | Per-credential rate limit | Failed credential lookups are also counted per client address (30 per 10 minutes, IPv6 per /64) in `apps/api/src/auth/failure-guard.ts`; over the budget the API answers 429 before any database lookup, except for a credential verified recently. `player.auth_rejected` is audited at most twice per address per window, with a keyed fingerprint of the address. |
| Trusted proxies | `TRUST_PROXY=true` behind a proxy | `TRUST_PROXY` is `false` or a comma-separated list of proxy addresses or CIDR ranges. `true` is refused (the client controls the leftmost `X-Forwarded-For` entry), and so are hop counts: Fastify 5.12.8 deliberately ignores `X-Forwarded-For` for a numeric `trustProxy` (checked in `node_modules/fastify/lib/request.js`). |
| Pairing response (D9) | `expiresAt` | `PairingCreateResponseSchema` gained `expiresInSeconds`. The player computes its deadline from it on its own clock and lets the server's poll answer decide expiry, so a device with a wrong clock can pair (`apps/player-web/src/core/pairing-clock.ts`). `docs/player-protocol-v1.md` updated. |
| Identity (D5) | TOTP as a required action | The realm template binds a browser flow `tinnox browser` with the one-time code `REQUIRED` (Keycloak's default flow runs it only for users who already have an authenticator). The template therefore carries Keycloak 26.8.2's default flows, exported from a fresh import, plus the two new ones. The client's default scopes are `basic` and `acr`; `profile` was removed so ID tokens carry no names. Changing the template requires recreating the Keycloak container (`npm run setup`, then remove the container and `npm run infra:up`). |
| Media worker (D11) | A job with a `.started` marker is rejected | The marker holds an attempt count; one retry is allowed, a second crash rejects the file (`apps/media-worker/src/attempts.ts`). `ffmpeg` is pinned to `8.1.3-r0`. The API sweeps orphaned quarantine files at start-up and hourly. |
| Player runtime (D14) | IndexedDB version 1 | The store opens a database left at a newer version by a later build instead of failing, and the player reloads when its connection is closed by another context or the browser. Reported errors are dropped once a successful sync cycle has resolved them. |
| Portal and player servers (D18) | CSP meta element | The Vite dev and preview servers send `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer` and `Cross-Origin-Opener-Policy: same-origin`. The player build now also fails on an inline script. |
| End-to-end tests | Shared development database | The Playwright run rebuilds its own database `tinnox_e2e_test` (created once with the PostgreSQL superuser) and uses `tests/.run/media`; screenshots and measurements go to `tests/.run/evidence` unless `E2E_EVIDENCE_DIR` is set. Global teardown signs the saved operator sessions out and deletes the saved browser states. The suite still restarts the shared PostgreSQL container (E2E 13) and shares `data/jobs` with the development worker. |
| Node.js (D1) | Node 22 or newer | `engines` is `>=22.13.0`, the lowest Node 22 release inside ESLint 10's supported range. Every recorded run used Node 23.10; none has run on Node 22 yet. `package-lock.json` still records the old `engines` value for the root package (it was not regenerated; no dependency changed). |

Additions recorded by portal v2 stage B, slice 1 (2026-11-16; spec `docs/portal-v2/stage-b.md`):

| Topic | Decision as written | As built, and why |
|---|---|---|
| Media worker (D11) | The worker writes only `outbox/<jobId>.json` | For an accepted image the worker also writes `outbox/<jobId>.thumb.jpg` (via `<jobId>.thumb.tmp`, mode 0644) before the verdict. The API stores it as a second object (`media.thumb_storage_key`, migration 0006) and serves it at `GET /api/media/:id/thumbnail`; media without one is served the original there. The thumbnail bytes are worker-trusted and not tied to the source bytes; the residual risk is in `docs/security/threat-model.md` T1. Thumbnails are not counted against the storage quota (at most 512 KiB each), are never backfilled for older media, and video has none. |
| Manifest (D14) | Manifest v1 only | `db/migrations/0006_stage_b_slice1.sql` lets `publication.manifest` hold `schemaVersion` 1 or 2. The server still writes v1 unless the publication needs a v2 field (`docs/player-protocol-v1.md` §5 and §9). |

Additions recorded by portal v2 stage B, slice 2 (2026-11-16; built-in apps):

| Topic | Decision as written | As built, and why |
|---|---|---|
| Dependencies (D1) | Exact versions, lockfile committed | One new run-time dependency: `uqr` 0.1.3 (MIT, no dependencies), pinned exactly in the new workspace package `packages/app-render` (`@tinnox/app-render`), which the player and the portal bundle to draw QR codes. Risk notes in `docs/security/threat-model.md` §10 (T13). |
| Manifest (D14) | Manifest v1 only | `db/migrations/0007_stage_b_apps.sql` lets `publication.manifest` hold `schemaVersion` 1, 2 or 3. The server writes v3 only when a playlist item is an app (`docs/player-protocol-v1.md` §5 and §9). |
