# Developer handoff: foundation of prototype M0

> Updated 2026-11-14 by the integration step: the stubs in section 7 are now full applications, and the run, test and reset instructions live in the README ("Run the prototype"). Validation results: `docs/prototype-validation.md`.

Written 2026-11-14 by the foundation step. Read `docs/first-prototype-agent-prompt.md` and `docs/prototype-m0.md` first; this page says what already exists and how to use it. No secret value appears here; secrets live in gitignored files.

## 1. Commands

Run everything from the repository root. You should not need `npm install`; `node_modules` and `package-lock.json` are complete.

| Command | What it does |
|---|---|
| `npm run setup` | Writes `.env`, `infra/.generated/tinnox-dev-realm.json`, `infra/.generated/dev-credentials.json`. Idempotent. `-- --quiet` hides the sign-in details, `-- --force` regenerates every secret. |
| `npm run infra:up` | Builds the media-worker image if needed, starts PostgreSQL, Keycloak and the worker, and waits until all three are healthy. |
| `npm run infra:down` / `npm run infra:logs` | Stops the containers (data kept) / shows recent logs. |
| `npm run db:migrate` | Applies `db/migrations` as `tinnox_migrator`. `-- --test` targets `tinnox_test`. |
| `npm run db:seed` | Creates "TINNOX Internal", site "Melbourne Workshop" (Australia/Melbourne) and the operator's membership. `-- --second-org` also creates "Isolation Test Organisation" for the second test user. |
| `npm run verify:oidc` | Signs the test operator in to Keycloak over HTTP (PKCE, password, TOTP) and exchanges the code. Prints no secret. |
| `npm run dev` | Runs `dev` in `@tinnox/api`, `@tinnox/portal`, `@tinnox/player-web` together. |
| `npm run typecheck` / `npm run lint` / `npm run format` / `npm run format:check` | Type check every workspace plus `scripts/`; ESLint; Prettier. |
| `npm test` | Unit tests (vitest project `unit`). |
| `npm run test:integration` | Integration tests against PostgreSQL. Rebuilds database `tinnox_test` first. |
| `npm run test:e2e` | Playwright suite in `tests/e2e` (25 tests; rebuilds database `tinnox_e2e_test`, builds and starts portal, player and API itself; evidence to `tests/.run/evidence` unless `E2E_EVIDENCE_DIR` is set). |
| `npm run build` | `vite build` for portal and player. The API and worker run from TypeScript source. |
| `npm run audit` | `scripts/audit.ts`: `npm audit`, failing on high or critical advisories apart from the dated development-only exceptions in `scripts/audit-exceptions.json` (operations checklist section 6). |
| `npm run scan:secrets` | gitleaks (container, no network) over git history and all non-ignored files. |
| `npm run reset -- --yes` | Deletes the database volume, the Keycloak container and `./data`. Keeps `.env`. Run `npm run setup -- --quiet` afterwards: it recreates `./data/jobs`, without which the media worker stays unhealthy. |
| `npm run otp` | Prints the current TOTP code of the development operator (`-- --show-password`, `-- --second`). |
| `npm run fixtures` | Writes synthetic sample media to `apps/api/test-fixtures/out/`. |
| `npm run backup:verify` | Backup and restore exercise (API must be stopped). |
| `npm run start:built` | Like `dev`, but with production builds of portal and player (service worker active). |

Fresh machine: `npm ci && npm run setup && npm run infra:up && npm run db:migrate && npm run db:seed`.

To add or change a dependency use `npx npm@11.21.2 install <pkg>@<exact version> -w <workspace>`. The host's npm 10.9.2 crashes on `npm install` (a resolver bug triggered by vitest's optional peers); `npm ci` is fine with npm 10.

## 2. Current state of this machine

- PostgreSQL 17 is running on **127.0.0.1:54330**, not 54329: another project already listens on 54329, so setup chose the next port. Always take the port from `.env` (`POSTGRES_HOST_PORT`, `DATABASE_URL`).
- Keycloak 26.8.2 is running on 127.0.0.1:8080 with realm `tinnox-dev` imported.
- Database `tinnox` is migrated and seeded with both organisations. Database `tinnox_test` is rebuilt by every integration run.
- Chromium for Playwright 1.65.1 (build 1255) is installed in `~/Library/Caches/ms-playwright`.

## 3. Code conventions that the tooling enforces

- ES modules, TypeScript 6 strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (no enums, no constructor parameter properties, no namespaces).
- **Relative imports carry the `.ts` extension** (`import { x } from './x.ts'`). Workspace packages are imported by name (`@tinnox/contracts`); their `exports` point at `src/index.ts`, so there is no build step and tsx, Vite and vitest all resolve them. Nothing is emitted (`noEmit`).
- Server-side workspaces extend `tsconfig.base.json` (NodeNext). Portal and player extend `tsconfig.web.json` (Bundler resolution, DOM libs).
- ESLint uses type-aware rules. Floating promises are errors. In portal and player, `localStorage`, `sessionStorage`, `innerHTML`, `document.write` and `dangerouslySetInnerHTML` are errors. `packages/domain` may import only `@tinnox/contracts`.
- Unit tests: `apps/*/src/**/*.test.ts`, `packages/*/src/**/*.test.ts`, `packages/*/test/**/*.test.ts`. Integration tests: `tests/integration/**/*.test.ts` and `packages/*/test/**/*.integration.test.ts`; they run one file at a time.
- Node: engines `>=22.13` (raised from 22.12 on 2026-11-14: ESLint 10 needs `^22.13.0`). The host has Node 23.10, which eslint 10 and vitest 5 do not list as supported (they warn at install); both were run on it without problems. CI uses Node 22 but has never run. The root entry of `package-lock.json` still shows `>=22.12.0`; refresh it with npm 11 at the next dependency change.

## 4. Environment variables (`.env`, documented in `.env.example`)

`NODE_ENV`, `LOG_LEVEL`, `POSTGRES_HOST_PORT`, `POSTGRES_SUPERUSER_PASSWORD`, `TINNOX_MIGRATOR_PASSWORD`, `TINNOX_APP_PASSWORD`, `DATABASE_URL`, `DATABASE_MIGRATOR_URL`, `TEST_DATABASE_URL`, `TEST_DATABASE_MIGRATOR_URL`, `API_HOST`, `API_PORT`, `API_PUBLIC_ORIGIN`, `PORTAL_ORIGIN`, `PLAYER_ORIGIN`, `SESSION_SECRET`, `SESSION_TTL_SECONDS`, `SESSION_IDLE_TIMEOUT_SECONDS`, `MEDIA_URL_HMAC_SECRET`, `PAIRING_CLIENT_KEY_SECRET`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_POST_LOGOUT_REDIRECT_URI`, `KC_BOOTSTRAP_ADMIN_USERNAME`, `KC_BOOTSTRAP_ADMIN_PASSWORD`, `DEV_OPERATOR_OIDC_SUB`, `DEV_SECOND_ORG_OIDC_SUB`, `MEDIA_ROOT`, `MEDIA_JOBS_DIR`, and optional `LIMIT_*` overrides (names in `LIMIT_ENV_VARS`).

The API's `dev` and `start` scripts load `../../.env` through tsx's `--env-file`. `MEDIA_ROOT` and `MEDIA_JOBS_DIR` are relative to the repository root; resolve them against it, not against `apps/api`.

**Every generated secret starts with `dev-`.** D19: when `NODE_ENV=production` the API must refuse to start if any secret starts with `dev-`, if the issuer or an origin is `http://`, or if the issuer ends in `/realms/tinnox-dev`.

## 5. Database

### Connection strings by role

| Variable | Role | Database | Use |
|---|---|---|---|
| `DATABASE_URL` | `tinnox_app` | `tinnox` | The running API. Nothing else. |
| `DATABASE_MIGRATOR_URL` | `tinnox_migrator` | `tinnox` | `db:migrate`, `db:seed` only. |
| `TEST_DATABASE_URL` | `tinnox_app` | `tinnox_test` | Integration tests, acting as the application. |
| `TEST_DATABASE_MIGRATOR_URL` | `tinnox_migrator` | `tinnox_test` | Integration tests, arranging data. |

Form: `postgres://<role>:<password>@127.0.0.1:<POSTGRES_HOST_PORT>/<database>`.

Roles: `tinnox_migrator` owns the schema. `tinnox_app` is `NOSUPERUSER NOBYPASSRLS`, owns nothing, has a 15 s statement timeout. `tinnox_definer` cannot log in, has `BYPASSRLS`, and owns only the functions in schema `sec`. The API should call `assertConnectionRole(DATABASE_URL, 'tinnox_app')` at start-up.

### Tenant context: `@tinnox/db`

```ts
createPool(options: { connectionString: string; applicationName?: string; max?: number; statementTimeoutMs?: number }): Pool
withOrg<T>(pool: Pool, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T>
withoutOrg<T>(pool: Pool, fn: (tx: Tx) => Promise<T>): Promise<T>
poolAsTx(pool: Pool): Tx            // single-statement sec.* calls
interface Tx { query<R>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>> }
assertConnectionRole(connectionString: string, expectedRole: string): void
sha256(value: string | Uint8Array): Buffer
```

`withOrg` does `BEGIN`, `SELECT set_config('app.org_id', $1, true)`, runs `fn` on that one connection, then `COMMIT` (or `ROLLBACK` when `fn` throws). `orgId` must be a lower-case UUID that came from a verified session or device lookup. Outside `withOrg` every tenant table is empty to the application. pg returns `bigint` columns (`audit_event.id`, `media.bytes`, `last_seq`) as strings.

Inside `withOrg` write `org_id` explicitly or use `app_org_id()`: `INSERT INTO playlist (org_id, name) VALUES (app_org_id(), $1)`.

### Lookups before the organisation is known (schema `sec`, wrappers in `@tinnox/db`)

All take a `Tx` first. Pass `poolAsTx(pool)` or a `withoutOrg` transaction, except `pairingClaim`, which needs `withOrg`.

```ts
membershipByOidcSub(tx, oidcSub): Promise<{ membershipId, orgId, role, orgName } | null>
loginStatePut(tx, { stateHash, codeVerifier, nonce, returnTo, ttlSeconds }): Promise<void>      // ttl 30..900
loginStateTake(tx, stateHash): Promise<{ codeVerifier, nonce, returnTo } | null>               // one-time
sessionCreate(tx, { idHash, oidcSub, csrfToken, ttlSeconds, idToken }): Promise<{ membershipId, orgId, role, expiresAt } | null>
sessionByIdHash(tx, idHash, idleTimeoutSeconds): Promise<{ membershipId, orgId, oidcSub, role, orgName, csrfToken, createdAt, expiresAt } | null>
sessionRevoke(tx, idHash): Promise<{ membershipId, orgId, idToken } | null>
sessionPurgeExpired(tx): Promise<number>
pairingCreate(tx, { code, pollingTokenHash, clientKey, ttlSeconds, maxSessionsPerClient, windowSeconds })
  : Promise<{ outcome: 'created', pairingId, expiresAt } | { outcome: 'rate_limited' } | { outcome: 'code_collision' }>
pairingPoll(tx, { pairingId, pollingTokenHash, maxWrongAttempts })
  : Promise<{ outcome: 'pending' | 'claimed' | 'completed' | 'expired' | 'locked' | 'not_found' | 'wrong_token', expiresAt }>
pairingClaim(tx /* withOrg */, { code, displayId, membershipId, maxFailures, windowSeconds })
  : Promise<{ outcome: 'claimed', pairingId, replacedRegistrationId } | { outcome: 'invalid_code' | 'display_not_found' | 'rate_limited' }>
pairingComplete(tx, { pairingId, pollingTokenHash, deviceTokenHash })
  : Promise<{ outcome: 'completed', registrationId, orgId, displayId } | { outcome: 'not_claimable' }>
pairingPurge(tx, olderThanSeconds): Promise<number>
deviceByTokenHash(tx, tokenHash): Promise<{ registrationId, orgId, displayId } | null>         // null when revoked
auditScoped(tx /* withOrg */, event): Promise<void>
auditUnscoped(tx, event): Promise<void>                                                         // org_id NULL
```

Hashes are `sha256(rawValue)` Buffers. Raw session ids, polling tokens and device tokens are never stored.

Pairing sequence the API should implement:

1. `POST /player/pairing`: generate a code (8 symbols from `PAIRING_CODE_ALPHABET`, CSPRNG) and a polling token (32 random bytes, base64url); call `pairingCreate` with `clientKey` = HMAC of the client address under `PAIRING_CLIENT_KEY_SECRET`. On `code_collision` generate a new code and retry.
2. `POST /api/displays/:id/claim`: inside `withOrg`, call `pairingClaim` with the session's `membershipId`. It also revokes the display's current registration and returns its id for the audit record.
3. `GET /player/pairing/:id` (polling token as `Authorization: Bearer`): call `pairingPoll`. On `claimed`, generate the device token, call `pairingComplete` with its hash and return the token in a `claimed` response. Map `completed` to the contract's `consumed`; map `expired` to `expired`; answer `locked`, `not_found` and `wrong_token` with the same 404 so they cannot be told apart.

The device token is delivered in exactly one response. If that response is lost, the player starts a new pairing.

### Tables and what `tinnox_app` may do

| Table | Privileges | Notes |
|---|---|---|
| `organization`, `membership`, `site` | SELECT | Created by seed only. |
| `display` | SELECT, INSERT, UPDATE of name, canvas, content rectangle, default fit | `route` and `org_id` cannot be updated. |
| `player_registration` | SELECT, UPDATE of `revoked_at`, `revoked_reason` | Created only by `pairingComplete`. Revocation is permanent (trigger). Reasons: `operator`, `replaced`, `player_reset`. One active row per display. |
| `media`, `playlist`, `playlist_item` | SELECT, INSERT, UPDATE, DELETE | `media.status = 'ready'` requires all inspection columns. `storage_key` must start with the row's `org_id`. Media referenced by a playlist item or a publication cannot be hard-deleted (foreign key); use `deleted_at`. |
| `publication`, `publication_asset` | SELECT, INSERT | Immutable for every role (triggers). `UNIQUE (org_id, display_id, idempotency_key)`. `manifest.publicationId` and `manifest.displayId` must equal the row. Insert one `publication_asset` row per manifest entry. |
| `display_delivery` | SELECT, INSERT, UPDATE | One row per display. Publication columns must reference a publication of the same display. |
| `heartbeat_log` | SELECT, INSERT, DELETE | Payload up to 16 KiB. |
| `audit_event` | SELECT, INSERT | No UPDATE for anyone (trigger). `action` must look like `noun.verb`. |
| `session`, `login_state`, `pairing_session`, `pairing_claim_failure` | none | Reached only through `sec.*`. |

Composite foreign keys `(id, org_id)` stop a row from referencing another organisation's row. A cross-organisation attempt surfaces as PostgreSQL error `42501` (policy) or `23503` (foreign key); map both to 404, never to a message that confirms the other row exists.

Migration `0004_review_hardening.sql` (review fixes, 2026-11-14) adds the `publication_asset` insert guard, the audit time stamp trigger, `sec.heartbeat_log_purge` (wrapper `heartbeatLogPurge`) and a `sec.session_purge_expired` that also clears ended sessions' ID tokens; there are now 17 `sec` functions. New migrations: add `db/migrations/000N_name.sql`; never edit an applied file (the runner compares SHA-256 and refuses). To change a `sec` function use `SET LOCAL ROLE tinnox_definer; CREATE OR REPLACE FUNCTION ...; RESET ROLE;`. A new table needs `ENABLE` and `FORCE ROW LEVEL SECURITY`, a `tenant_isolation` policy and explicit grants; migration 0001 ends with a check that fails if a table lacks forced row-level security.

## 6. Packages

### `@tinnox/contracts` (zod 4 schemas, inferred types, constants)

For every `XSchema` there is a type `X`.

- Identifiers and scalars: `UuidSchema`, `OrgIdSchema`, `SiteIdSchema`, `DisplayIdSchema`, `MediaIdSchema`, `PlaylistIdSchema`, `PlaylistItemIdSchema`, `PublicationIdSchema`, `RegistrationIdSchema`, `PairingSessionIdSchema`, `UtcTimestampSchema`, `Sha256HexSchema`, `IdParamSchema`, `NameSchema`.
- Canvas: `FitModeSchema`, `FIT_MODES`, `CanvasSchema`, `RectSchema`, `CanvasSpecSchema` (canvas plus content rectangle with bounds check), `contentRectProblem`.
- Limits: `LimitsSchema`, `DEFAULT_LIMITS`, `LIMIT_ENV_VARS`, `limitsFromEnv(env)`, `ABSOLUTE` (hard ceilings; use `ABSOLUTE.maxHeartbeatBodyBytes` and `ABSOLUTE.maxJsonBodyBytes` as Fastify body limits).
- Errors: `ApiErrorSchema`, `ApiErrorCodeSchema`, `API_ERROR_CODES`, `ApiErrorDetailSchema`, `apiError(code, message, extra?)`.
- Session: `SessionResponseSchema`, `LoginQuerySchema`, `LogoutResponseSchema`, `RoleSchema`, `ROLES`.
- Sites and displays: `SiteDtoSchema`, `SiteListResponseSchema`, `DisplayDtoSchema`, `DisplayListResponseSchema`, `DisplayCreateSchema`, `DisplayPatchSchema`, `RevokePlayerResponseSchema`, `DeliveryRouteIdSchema`, `DELIVERY_ROUTE_IDS`.
- Pairing: `PairingCodeSchema`, `PAIRING_CODE_ALPHABET`, `PAIRING_CODE_LENGTH`, `normalisePairingCode`, `formatPairingCode`, `OpaqueTokenSchema`, `PairingCreateResponseSchema`, `PairingPollResponseSchema`, `PairingClaimRequestSchema`, `PairingClaimResponseSchema`.
- Media: `MediaDtoSchema`, `MediaListResponseSchema`, `MediaUploadResponseSchema`, `MediaKindSchema`, `MediaStatusSchema`, `MediaMimeTypeSchema`, `MediaErrorCodeSchema`, `MEDIA_ERROR_MESSAGES`, `MEDIA_KIND_BY_MIME`, `MEDIA_MIME_TYPES`, `SUPPORTED_VIDEO_CODECS`, `MEDIA_UPLOAD_FIELD` (`file`), `MediaJobSpecSchema` (`inbox/<jobId>.json`), `MediaJobResultSchema` (`outbox/<jobId>.json`).
- Playlists and publishing: `PlaylistItemInputSchema`, `PlaylistItemDtoSchema`, `PlaylistSummaryDtoSchema`, `PlaylistDtoSchema`, `PlaylistListResponseSchema`, `PlaylistCreateSchema`, `PlaylistReplaceSchema`, `PublishRequestSchema`, `PublishResponseSchema`, `IdempotencyKeySchema`, `PublishRejectionCodeSchema`, `PUBLISH_REJECTION_CODES`.
- Manifest v1: `ManifestV1Schema`, `ManifestAssetV1Schema`, `MANIFEST_SCHEMA_VERSION`, `parseManifest(input)`.
- Player protocol: `ManifestResponseSchema`, `manifestEtag`, `publicationIdFromEtag`, `MediaUrlsRequestSchema`, `MediaUrlsResponseSchema`, `MediaUrlQuerySchema` (`pub`, `reg`, `exp`, `sig`), `HeartbeatV1Schema`, `HEARTBEAT_SCHEMA_VERSION`, `HeartbeatResponseSchema`, `PlayerStateSchema`, `StagingPhaseSchema`, `PlayerErrorSchema`, `PlayerErrorCodeSchema`, `REDACTED_HEADERS`, `REDACTED_QUERY_PARAMS`.
- Status: `DeliveryStatusViewSchema`, `DeliverySummarySchema`, `DELIVERY_SUMMARIES`.
- Capability: `CapabilityProfileSchema`.
- Audit: `AuditEventDtoSchema`, `AuditListQuerySchema`, `AuditListResponseSchema`, `AuditActionSchema`, `AUDIT_ACTIONS`, `AuditActorTypeSchema`, `AuditResultSchema`.
- Routes: `ROUTES` (constants, `*Pattern` strings for Fastify, builder functions), `HEADERS` (`x-csrf-token`, `idempotency-key`, `x-request-id`), `SESSION_COOKIE`, `API_PREFIX`, `PLAYER_PREFIX`, `DEV_PORTS`.

Object schemas are strict: unknown keys are rejected.

### `@tinnox/domain` (pure functions)

```ts
fitRect(source: Size, frame: FloatRect, fit: FitMode): Placement      // { scale, dest, clip, visible, sourceCrop }
placeOnCanvas(source, canvas, contentRect, fit): Placement
effectiveContentRect(canvas, contentRect): Rect
canvasToViewport(canvas, viewport): { scale, offsetX, offsetY }       // preview scaling in the player
validatePlaylist(items, mediaById, limits, { mode: 'draft' | 'publish' }): PublishIssue[]
buildPublicationDraft(display, items, mediaById, limits): { ok: true, draft } | { ok: false, issues }
planPublication({ display, items, mediaById, limits, route }): { ok: true, draft } | { ok: false, issues }
buildManifest(draft, { publicationId, createdAt }): ManifestV1
checkCapabilities(draft, profile): PublishIssue[]
manifestAssetIds(manifest): string[];  manifestStorageBytes(manifest): number
reduceHeartbeat(current: ReportedState, { registrationId, report, receivedAt }): { accepted, ignoredReason, state }
heartbeatRejection(report, { displayId, isPublicationOfDisplay }): string | null
isStale(lastHeartbeatAt, now, staleAfterSeconds): boolean
buildDeliveryStatusView({ displayId, activeRegistrationId, desired, reported, now, staleAfterSeconds }): DeliveryStatusView
EMPTY_REPORTED_STATE
```

Publishing in the API: load display, items and media inside `withOrg`; `planPublication` with `registry.get(display.route)`; on success generate the id, `buildManifest`, insert `publication` and `publication_asset`, upsert `display_delivery.desired_publication_id`. On an idempotency-key conflict return the existing row (`replayed: true`) if the playlist matches and the stored manifest has no `schedule` or `zones` block, otherwise `idempotency_conflict`.

`ReportedState` maps onto `display_delivery` (`reporting_registration_id`, `last_seq`, `downloaded_publication_id`, `active_publication_id`, `active_item_index`, `player_state`, `staging`, `last_errors`, `last_heartbeat_at`). A heartbeat from a newly registered player starts a new sequence; `seq` only has to increase within one registration.

### `@tinnox/delivery`

`DeliveryRoute<TPrepared>` (`id`, `capabilities()`, `validate(draft)`, `prepare(manifest)`, `normalizeStatus(report)`), `createDeliveryRegistry(options?)` with `get(routeId)` and `ids()`, `createBrowserRoute(options?)`. Only `browser` exists. `packages/delivery/test/fake-route.ts` is test-only and is neither exported nor registered. Pass the configured limits when creating the registry: `createDeliveryRegistry({ browser: { maxAssetBytes: limits.maxUploadBytes, maxItems: limits.maxPlaylistItems, maxVideoWidthPx: limits.maxVideoWidthPx, maxVideoHeightPx: limits.maxVideoHeightPx } })`.

### `@tinnox/storage`

```ts
LocalObjectStorage.create({ root }): Promise<LocalObjectStorage>      // implements ObjectStorage
put(key, source: Readable | Uint8Array, { maxBytes? }): Promise<{ key, bytes, sha256 }>
putFile(key, sourcePath, { maxBytes? }): Promise<{ key, bytes, sha256 }>   // source file is left in place
stat(key): Promise<{ bytes } | null>
openRead(key, range?: { start, end }): Promise<{ stream, length, totalBytes, range }>
delete(key): Promise<boolean>;  check(): Promise<void>;  removeStaleTempFiles(olderThanMs): Promise<number>
newObjectKey(orgId): string;  isValidObjectKey(key);  parseObjectKey(key);  keyBelongsToOrg(key, orgId)
parseRangeHeader(header, size): { kind: 'full' } | { kind: 'partial', range } | { kind: 'unsatisfiable' }
contentRangeHeader(range, size);  unsatisfiableContentRangeHeader(size)
StorageError (code: invalid_key | not_found | already_exists | too_large | invalid_range | not_a_regular_file | io_error)
```

Keys are `<org uuid>/<object uuid>` and nothing else is accepted. `put` never replaces an object and stores nothing on failure. `putFile` computes bytes and SHA-256 in the API process, which is what D11 requires after the worker accepts a file.

## 7. Stubs left for the next engineers

| Directory | What exists | What is missing |
|---|---|---|
| `apps/api` | `package.json` (all dependencies; scripts `dev`, `start`, `typecheck`), `tsconfig.json`, `src/index.ts` placeholder | Everything. `dev` runs `tsx watch --env-file=../../.env src/main.ts`, so the entry point is `src/main.ts`; delete `src/index.ts`. |
| `apps/media-worker` | `package.json` (sharp, file-type, zod), `tsconfig.json`, placeholder | The worker and `apps/media-worker/Dockerfile`. The compose service `media-worker` (profile `worker`) already applies no network, read-only root, uid 10001, no capabilities, `no-new-privileges`, 128 PIDs, 768 MB, 1 CPU, a tmpfs `/tmp`, and mounts only `./data/jobs` at `/jobs`. The image needs ffprobe and a user with uid 10001. Create `data/jobs/inbox` and `data/jobs/outbox` writable by that uid. |
| `apps/portal` | `package.json`, `tsconfig.json`, `vite.config.ts` (127.0.0.1:5173, strict port, `/api` proxied to 127.0.0.1:4000), placeholder `index.html` and `src/index.ts` | The React application. |
| `apps/player-web` | `package.json` (idb; fake-indexeddb for tests), `tsconfig.json`, `vite.config.ts` (127.0.0.1:5174), placeholders | The player and its service worker. |
| `tests` | `package.json`, `tsconfig.json`, `support/dev-identity.ts` (`devUser()`, `totpCode()`), `README.md` | `playwright.config.ts`, `integration/`, `e2e/`. |

## 8. Keycloak

- Image `quay.io/keycloak/keycloak:26.8.2`, `start-dev --import-realm`, http://localhost:8080. The realm is imported only when it does not exist; after `npm run setup -- --force`, run `npm run reset -- --yes` and start again.
- Realm `tinnox-dev`. Issuer `http://localhost:8080/realms/tinnox-dev`. Discovery at `<issuer>/.well-known/openid-configuration`.
- Client `tinnox-portal-bff`: confidential (client secret in `OIDC_CLIENT_SECRET`), standard flow only, PKCE S256 required, no implicit flow, no direct grants, no service account. Redirect URIs, exact: `http://localhost:5173/api/auth/callback` (default, `OIDC_REDIRECT_URI`) and `http://localhost:4000/api/auth/callback`. Post-logout redirect: `http://localhost:5173/`. Scopes: `basic`, `acr`, `profile`.
- Users: `operator` (organisation "TINNOX Internal") and `second-operator` ("Isolation Test Organisation"). Each has a random password and a pre-provisioned TOTP credential (SHA-1, 6 digits, 30 s). Values are in `infra/.generated/dev-credentials.json` (`operator`, `secondOrgOperator`: `username`, `password`, `oidcSub`, `totpSecretBase32`). New users must configure TOTP (default required action).
- The user id in the realm import is the `sub` claim; it equals `DEV_OPERATOR_OIDC_SUB` / `DEV_SECOND_ORG_OIDC_SUB` and `membership.oidc_sub`. Verified by `npm run verify:oidc`.
- The id token contains `sub`, `preferred_username`, `name`, `given_name`, `family_name`, `acr`, `auth_time`, `nonce`, `sid`. It has **no `amr` claim**, and `acr` was `0` when a code was issued from an existing Keycloak session. Do not treat `acr` or `amr` as proof of MFA with this realm as configured; MFA is enforced by Keycloak's browser flow. If the API should verify it, the realm needs an ACR-to-level mapping first.
- Keycloak rejects a TOTP code that was already used. An automated test that signs the same user in twice within one 30-second window must wait for the next window or reuse the session.
- Admin console: user from `KC_BOOTSTRAP_ADMIN_USERNAME`, password in `.env`.

## 9. What was verified, and what was not

Run and passed on 2026-11-14 (macOS, Node 23.10, Docker 29.8): `npm ci`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test` (105 tests); `npm run test:integration` (46 tests, including the row-level security proof in `packages/db/test/rls.integration.test.ts`); `npm run build` (placeholder shells); `npm run audit` (no high or critical; 7 moderate, all the `minimatch` advisory inside the typescript-eslint development toolchain); `npm run scan:secrets` (clean, and a planted private key was detected); `npm run setup` twice (second run changed nothing); `npm run infra:up`; `npm run db:migrate` twice; `npm run db:seed`; `npm run verify:oidc`.

Written but not run: the GitHub Actions workflow (`.github/workflows/ci.yml`) has never executed; `npm run reset`; `npm run dev` and `npm run test:e2e` (nothing to run yet); the `media-worker` compose service (no Dockerfile yet); `infra/postgres/init/01-roles.sh` through the CI path (`docker cp` + `docker exec`).

Known gaps:

- `tinnox_app` can set `app.org_id` to any organisation. Row-level security protects against a query that forgets its filter or runs outside `withOrg`; it does not protect against application code that passes the wrong organisation to `withOrg`.
- There is no way to delete an organisation or a publication: publications are immutable for every role. Deletion and retention need a designed, migrator-run procedure.
- Audit events with no organisation (`auditUnscoped`) can be read only by a database administrator.
- The Keycloak development database lives inside the container; removing the container loses Keycloak sessions and events (the realm is re-imported).
- The second organisation is seeded in the development database as well as in tests, so the second test user can sign in during manual checks.
