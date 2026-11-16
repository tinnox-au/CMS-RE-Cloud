# Cursor report — areas 3 to 5

Date: 16 November 2026, Australia/Melbourne (UTC+11).

| Item | Value |
|---|---|
| Reviewer | Cursor cloud agent, model Grok 4.7, reasoning effort xhigh, 500k context window |
| Agent | [bc-07332058-beb8-513d-b6ed-63f8491c2e10](https://cursor.com/agents/bc-07332058-beb8-513d-b6ed-63f8491c2e10) |
| Baseline | `cfa9926423e63393ab50afd6625a08beb69393f5` (`main`) |
| Date of report | 16 November 2026 (Australia/Melbourne) |
| Method | Read-only review of areas 3, 4 and 5, plus mechanical execution of the named integration subset in an isolated environment. No branch, commit, push, or pull request. |
| This file | The report text below is verbatim from the reviewer’s final message, including its runtime-evidence appendix. |
| Consolidated summary | [README.md](README.md) |

---

# Backend review, areas 3–5 (TINNOX CMS M0)

## 1. Baseline, scope and methods

| Item | Value |
|---|---|
| Repository | `tinnox-au/tinnox-cms` |
| SHA | `cfa9926423e63393ab50afd6625a08beb69393f5` (`git rev-parse HEAD`) |
| Branch label | `main` (this SHA only) |
| Tree at start | `git status`: on `main`, up to date with `origin/main`, nothing to commit, working tree clean |
| Tree at end | Clean again. No branch, commit, push, or pull request. Generated `.env`, `infra/.generated/`, and `data/` were removed. |

This review covers HTTP authority (area 3), the media worker boundary (area 4), and operational startup and verification (area 5), plus mechanical execution of the named integration files. Portal UI, `apps/player-web`, scheduling and rendering, migration-SQL design, and RLS policy design are out of scope. SQL and publishing code were read only where an HTTP or worker invariant depends on them.

Runtime was a disposable PostgreSQL 17.12 container (the compose image digest), initialised only by `infra/postgres/init/01-roles.sh`, bound to `127.0.0.1:54329`, with its own volume. The compose project `tinnox-cms` and the volume `tinnox_pgdata` were not created. Integration tests reset `tinnox_test` only. Job and media directories came from `mkdtemp`, not `./data`. The media-worker image was built from `apps/media-worker/Dockerfile` on this machine. Keycloak was not started. Details and per-file results are in section 6.

## 2. Assessment

The HTTP and media boundaries are in good shape for the prototype’s stated assumptions. Authority for an operator request comes from the session’s membership row. Authority for a player request comes from the device credential, which names one registration, one display, and one organisation. State-changing operator routes sit behind one hook that requires that session, the exact portal `Origin`, and the session CSRF token, and rejects a cross-site `Sec-Fetch-Site` when the header is present. Pairing, revocation, signed media URLs, and heartbeat reduction match the decisions in `docs/prototype-m0.md` (D5–D9, D13) and the corrections already recorded in the threat model.

The upload path is a filesystem exchange coordinated with `media.status`, and it has a real recovery step for the gap the checklist asks about: a committed `processing` row whose job spec was never written is re-queued from the quarantined bytes or failed if those bytes are gone (`apps/api/src/media/pipeline.ts:375-391`). The API recomputes size and SHA-256 when it copies bytes into private storage and discards the object if they differ from the upload record (`pipeline.ts:577-604`). Worker metadata is checked again against the configured limits (`pipeline.ts:455-497`). A thumbnail is accepted only as a regular file, opened with `O_NOFOLLOW` and `O_NONBLOCK`, owned by the same uid as the verdict, between 1 and 524288 bytes, and beginning with a JPEG marker. It is not decoded (`pipeline.ts:504-542`, D11 as amended for stage B).

What is not closed, and was already written down, is the shared-directory residual: the inbox is world-readable and the outbox is world-writable and sticky on Linux. Thumbnails make that residual larger, because the uid check compares the thumbnail with the verdict’s writer and does not require the worker uid. A local process that can forge the verdict can attach a thumbnail as well. There is still one serial worker and no sweep that reconciles storage objects with media rows.

The process can be configured, migrated, and checked without a hidden developer database. Production start-up refuses development secrets, `http://` origins, the `tinnox-dev` realm, and a missing MFA claim list, and the real process was exercised. Two gaps sit in the verification story. The restore checker still treats every manifest item as a media file, so a publication that contains an app makes `npm run backup:verify` fail. The validation documents still say CI has never run and that nothing has run on Node 22; the workflow on this SHA has succeeded on Node v22.23.4.

Session-factory and integration tests do not establish that Keycloak enforces MFA. They create sessions through `sec.session_create`. This run did not execute `npm run verify:oidc` or the browser suite. The realm template binds the `tinnox browser` flow with the one-time-code step required (`infra/keycloak/realm-template.json`, `browserFlow` and `auth-otp-form`). With the development realm, `mfaSatisfied` does not consult `acr` or `amr`, and the login audit records `mfaVerifiedFromClaims: false` (`apps/api/src/auth/oidc.ts:62-68`, `apps/api/src/routes/auth.ts:162-223`). Production start-up refuses to boot until `OIDC_MFA_ACR_VALUES` or `OIDC_MFA_AMR_VALUES` is set (`apps/api/src/config.ts:306-309`).

## 3. Prioritized findings

### CU-01 — Restore check rejects a publication that contains an app, and never looks at thumbnails

- **Severity:** Medium. **Classification:** New finding.
- **Invariant:** `npm run backup:verify` is the documented proof that a dump and the object archive restore together (`docs/security/operations-and-release-checklist.md` section 2; `scripts/backup-restore-check.sh:1-13`).
- **Trigger:** Any publication whose manifest contains an app item (manifest v3, stage B slice 2).
- **Consequence:** The script exits 1 on a consistent restore. A missing thumbnail object does not fail the script. The custom dump and the `objects/` tar can still hold the bytes; the checker is what breaks.
- **Mechanism:** Section (c) joins every manifest asset to `media` on `(a->>'assetId')::uuid` (`scripts/backup-restore-check.sh:97-105`). An app item has no `assetId` and no `sha256` (`packages/contracts/src/manifest.ts:164-171`). A missing JSON key becomes SQL NULL, so the inner join drops app items from the hash check. The unresolved count is a left join with `WHERE m.storage_key IS NULL` (`scripts/backup-restore-check.sh:107-110`), which is true for every app item. One app makes that count non-zero and fails the run. A database whose publications contain only apps also fails the hash check, because `check_files` treats zero rows as failure (`scripts/backup-restore-check.sh:88`). `thumb_storage_key` is never selected. The archive is a tar of the whole `objects` directory (`scripts/backup-restore-check.sh:38`), so thumbnail files ride along unverified.
- **Tests:** `apps/api/test/publish.integration.test.ts` “writes manifest v3 for a playlist with an app, with file rows for media positions only” passed. `scripts/backup-restore-check.sh` was not executed: it dumps database `tinnox` through the compose project and writes `~/tinnox-backups`. This run’s database was a separate container, and only `tinnox_test` was reset.
- **Confidence:** High on the SQL outcome. Unverified as an end-to-end script exit on a populated development database.
- **Decision:** D12 and the stage B slice 2 deviation (manifest v3). The checker was written when every asset was a media file.
- **Required property:** The checker should count and hash media items only, and it should state whether thumbnail objects are part of the restore contract. If they are, `thumb_storage_key` has to be checked as an object that exists; the row stores no thumbnail hash.

### CU-02 — The job spec’s mode still depends on the API process umask

- **Severity:** Low. **Classification:** New finding.
- **Invariant:** The worker uid must be able to read `inbox/<jobId>.json`, which the API writes last (`docs/prototype-m0.md` D11; `apps/media-worker/src/main.ts:99-120`).
- **Trigger:** The API process runs with umask `077` (or any mask that clears the group and other read bits).
- **Consequence:** Every upload fails closed. The worker cannot read the spec, writes `inspection_failed` / “The job description is not valid.” (`apps/media-worker/src/main.ts:171-179`), and the media row becomes `failed`. Default umask `022` keeps mode `0644`, which is why CI and this run’s worker tests pass.
- **Mechanism:** `prepare()` comments that `mkdir`’s mode is reduced by the umask and then `chmod`s the inbox to `0755` and the outbox to `01777` (`apps/api/src/media/pipeline.ts:178-185`). After the bytes are renamed, they are `chmod`’d to `0644` (`pipeline.ts:294-295`). The spec is `writeFile(..., { mode: 0o644 })` plus `rename`, with no follow-up `chmod` (`pipeline.ts:309-312`). Node applies the process umask to that mode.
- **Tests:** None set the umask. The worker suite passed under this environment’s default umask.
- **Confidence:** High on the file-mode mechanism. Unverified by running the API under umask `077`.
- **Required property:** The spec file must be readable by the worker uid after it is published, independent of the API umask, in the same way the bytes file already is.

### CU-03 — The written verification record disagrees with the workflow result on this SHA

- **Severity:** Low. **Classification:** New finding.
- **Invariant:** A reader of the operations and validation record can tell what actually ran on the supported Node line (`docs/prototype-m0.md` D1; area 5).
- **Trigger:** Reading `docs/prototype-m0.md` (the CI deviation and the Node 22 deviation), `docs/prototype-validation.md` (lines 12, 64, 236), or `docs/security/control-matrix.md` (B12, “CI has never executed”) at this SHA.
- **Consequence:** Those pages say the workflow has never executed, that every result is from Node 23.10, that no Node 22 run exists, and that integration is 105 tests. On this commit the workflow has succeeded on Node v22.23.4, and the integration job reported 23 files and 266 tests. The root `package-lock.json` `engines` field is already `>=22.13.0`, which the Node deviation still describes as stale. A release decision that trusts the pages will understate the evidence that exists, and will miss that end-to-end remains skipped.
- **Evidence:** GitHub Actions run [43835309136](https://github.com/tinnox-au/tinnox-cms/actions/runs/43835309136) on `cfa9926423e63393ab50afd6625a08beb69393f5`, 2026-11-16. Quality, integration, and secret scan completed with conclusion `success`. End-to-end was `skipped`. The quality log records `node: v22.23.4` from `actions/setup-node` with `.nvmrc`. The integration log ends with `Test Files 23 passed` and `Tests 266 passed`. `npm audit` in that job reported 7 moderate `minimatch` findings and exit 0 at audit level high.
- **Confidence:** High for that run. This review did not re-download every log line of the 266 tests.
- **Required property:** The validation record for a SHA should match the workflow result for that SHA, including the Node version, the test count, and the fact that the end-to-end job did not run.

## 4. Design choices judged reasonable

**Operator authority.** `requireOperator` loads the session from the cookie hash, then for any method outside GET, HEAD, and OPTIONS requires `Origin` to equal `PORTAL_ORIGIN`, rejects `Sec-Fetch-Site` when it is present and is neither `same-origin` nor `none`, and compares `X-CSRF-Token` with `timingSafeEqual` (`apps/api/src/auth/session.ts:110-147`). The hook is installed on the plugin that registers every operator route (`apps/api/src/app.ts:99-116`). Logout is a POST with the same hook (`apps/api/src/routes/auth.ts:250-252`). `tests/integration/session-csrf.test.ts` builds the served `/api` route list from `ROUTES` and `hasRoute`, fails if that list drifts, and applies the cookie, CSRF, and Origin checks across the state-changing set. That test passed, including a cross-site `Sec-Fetch-Site` with a correct Origin (403 `origin_not_allowed`).

**OIDC binding.** Login stores `state`, `nonce`, and the PKCE verifier under HMAC-SHA256(session secret, `login-state`, pre-auth cookie, state), in a one-time row, and sets an `HttpOnly`, `SameSite=Lax` cookie (`apps/api/src/routes/auth.ts:46-98`). The callback clears that cookie, takes the row once, and only then calls `authorizationCodeGrant` with the stored verifier, state, and nonce (`auth.ts:107-141`, `apps/api/src/auth/oidc.ts:124-136`). The callback URL is built from the configured redirect URI, so the Host header is not the redirect. `returnTo` must match `^/(?!/)[A-Za-z0-9\-._~/]*$` and is at most 200 characters (`packages/contracts/src/session.ts:28-35`). A previous session cookie is revoked before the new id is issued (`auth.ts:179-183`). `sec.session_create` inserts only when `oidc_sub` matches a membership, and `oidc_sub` is unique (`db/migrations/0001_schema.sql:61`, `db/migrations/0002_security_functions.sql:72-78`). Idle and absolute expiry are applied in `sec.session_by_id_hash` (`0002_security_functions.sql:81-106`). The session-csrf test covers callback rejection, logout, absolute expiry, and idle timeout.

**Pairing and credentials.** The code and the polling token are separate. The claim response contains no device token (`apps/api/src/routes/displays.ts:502-506`). The token is created on the collecting poll, returned once, and stored as SHA-256 (`apps/api/src/routes/player.ts:279-286`). Claim revokes the display’s active registration; complete inserts the new one (`db/migrations/0002_security_functions.sql:287-324`). Wrong codes, wrong polling tokens, expiry, single use, and cross-organisation claim are covered by `packages/db/test/sec.integration.test.ts` and `tests/integration/pairing-and-credentials.test.ts`, both passed. Five wrong polling outcomes (`locked`, `not_found`, `wrong_token`) are the same HTTP 404 (`player.ts:252-274`).

**Signed media and same-organisation displays.** The HMAC covers a version tag, registration, publication, asset, and expiry (`apps/api/src/security.ts:60-92`). Download checks the signature before expiry, resolves the registration through `sec.device_by_registration_id` (revoked rows return nothing, `db/migrations/0003_api_lookups.sql:19-27`), and serves the object only when that publication belongs to that display and lists the asset (`apps/api/src/routes/player.ts:454-532`). Issuance requires the publication to be the display’s current desired publication (`player.ts:406-429`). An already issued URL stays valid until expiry or revocation, which the threat model records as built (T4). `apps/api/test/player.integration.test.ts` passed “binds signed media URLs to registration, publication, asset and expiry” and the same-organisation cross-display cases at `player.integration.test.ts:149` and `:313`. `abuse.integration.test.ts` passed “reports the real size on HEAD of a signed media URL”. `serveObject` sets `nosniff`, a sandbox CSP, and a generated filename (`apps/api/src/media/serve.ts:49-59`).

**Heartbeat.** The browser route parses `HeartbeatV1Schema` (`packages/delivery/src/browser/browser-route.ts:66-77`). The report’s display must be the credential’s display. Named publication ids must already belong to that display (`apps/api/src/routes/player.ts:561-588`, `packages/domain/src/delivery-state.ts:101-117`). A sequence that is not greater than the stored sequence for the same registration is ignored; a different registration starts a new sequence (`delivery-state.ts:67-71`). The delivery row is locked with `FOR UPDATE`. Accepted reports are sampled to one `heartbeat_log` row per display per 10 seconds (`player.ts:632-653`). Housekeeping purges by age. The player and abuse tests for replay, foreign publications, sampling, and purge passed.

**Abuse bounds that are actually bounded.** Credentialed player routes key `@fastify/rate-limit` 11.2.2 by a hash of the Authorization header when that header is at most 100 characters (`player.ts:88-94`). The plugin gives that route its own store, so the global 600/minute IP limit does not also apply. The store is an LRU; the dependency’s `LocalStore` defaults the cap to 5000 and the application does not pass `cache`. Failed lookups are counted per address (IPv4 as-is, IPv4-mapped addresses unwrapped, IPv6 by /64) and, after 30 in 10 minutes, refused before the database lookup unless that credential hash was verified recently (`apps/api/src/auth/failure-guard.ts:101-134`). A failure forgets the credential immediately, so a revoked player loses the exception. Audit rows for `player.auth_rejected` are written on the first failure in the window and when the limit is crossed. `abuse.integration.test.ts` “throttles random bearer tokens per client address and audits per client, not per token” passed. Login, callback, and logout are 30/minute by address. Pairing create is 30/minute plus the database cap on sessions per HMAC of the client address. Pairing poll is 120/minute. Upload is 60/minute and still requires the operator session. Claim is 20/minute. Media download is 900/minute by address. Push at the real scale of 30/minute returned 429 in `push.integration.test.ts`. `login_state_put` deletes expired login rows as part of the write (`db/migrations/0002_security_functions.sql:42`). Expired sessions, pairings, heartbeat history, stale temp files, and orphaned job files are what housekeeping removes (`apps/api/src/housekeeping.ts:31-45`). Audit rows have no purge; that is the recorded retention deviation in `docs/prototype-m0.md` section 9.

**Proxy and body limits.** `TRUST_PROXY=true` and numeric hop counts are refused. A list must be addresses or CIDRs no wider than IPv4 /8 or IPv6 /16 (`apps/api/src/config.ts:164-198`). The default is false, so `request.ip` is the socket peer. JSON bodies are capped at 256 KiB, heartbeats at 16 KiB, the router at 100 characters per parameter, and the request at 15 minutes (`apps/api/src/app.ts:41-50`, `packages/contracts/src/limits.ts`). Multipart allows one file, and the upload route stops when the parser emits `limit` (`pipeline.ts:250-254`). `errors.ts` maps privilege failure `42501` to 404, uses a fixed envelope, and the logger serialises requests as method plus path with the query string removed (`apps/api/src/logger.ts:35-49`).

**Worker isolation and source-byte integrity.** The compose service and the test helper both set `network_mode` / `--network none`, a read-only root, user `10001:10001`, `cap_drop: ALL`, `no-new-privileges`, 128 pids, 768 MiB, 1 CPU, and a noexec `/tmp` (`infra/docker-compose.yml:74-103`, `tests/integration/support.ts:116-142`). The image pins Node `24.22.3-alpine3.24` and `ffmpeg=8.1.3-r0`; that apk pin still resolved when this image was built. Inspection uses `ffprobe` as an argument array with `-protocol_whitelist file`, a timeout, and an output cap (`apps/media-worker/src/inspect.ts:132-160`). Images go through `sharp` with `limitInputPixels` (`inspect.ts:59-66`). A `.started` marker allows one retry and then a rejection (`apps/media-worker/src/attempts.ts:11-26`). The worker is a single loop (`apps/media-worker/src/main.ts:283-292`). On an image timeout it writes the rejection and exits so the container restart clears a decode that JavaScript cannot cancel (`main.ts:201-208`). `tests/integration/media-worker.test.ts` passed against this image, including real JPEG, PNG, and H.264 acceptance, HEVC and damaged-file rejection, and the double-crash marker.

**Startup guards and test isolation.** `loadConfig` requires the runtime URL to use role `tinnox_app`, three distinct secrets, and https outside loopback when `NODE_ENV=production` (`apps/api/src/config.ts:242-320`). `scripts/setup-dev.mjs` prefixes generated secrets with `dev-` and writes `.env` mode `0600`. `resetTestDatabase` refuses a database whose name does not end in `_test` (`packages/db/src/migrate.ts:110-118`). The root integration project uses that reset (`scripts/vitest-integration-setup.ts:7-16`, `vitest.config.ts:26-39`). The API’s own vitest config does not wipe; this run used the root project, as the setup inspection requires. Each API test listener uses `mkdtemp` for jobs and media (`apps/api/test/support.ts:80-82`). `/readyz` requires database, storage, and the jobs directory; identity-provider and worker freshness are reported and do not flip readiness (`apps/api/src/routes/ops.ts:27-48`). Shutdown stops the listener, the pipeline timer, and the pool, and exits if that takes more than 10 seconds (`apps/api/src/main.ts:80-98`). The pipeline starts before listen, so leftover jobs are scanned first (`main.ts:110-112`).

**Manifest handling at the HTTP boundary.** `GET /player/manifest` re-parses the stored document with `ManifestSchema` (versions 1, 2, and 3, all strict) and fails the request if that parse fails (`apps/api/src/routes/player.ts:391-393`). The ETag is the publication row id. Publish tests passed for v1, v2, and v3, including “keeps a published snapshot unchanged when the playlist and the display are edited”. Time-window execution, shuffle, and rotation rendering were not reviewed.

## 5. Documented residuals and their current implications

These are still accurate. “Documented” here means the threat model and `docs/prototype-m0.md` already name them. They still have consequences.

**World-readable inbox and world-writable outbox (T1, threat model section 9).** `scripts/setup-dev.mjs:289-297` and `pipeline.ts:179-185` still set inbox `0755`, inbox files `0644`, and outbox `01777`. The compose comment still warns that Docker creates `data/jobs` as root if the API has not created it first (`infra/docker-compose.yml:72-73`). A local user can read quarantined uploads. A local user can create files in the outbox. The sticky bit stops that user from unlinking the worker’s files, and mode `0644` stops them from rewriting a file the worker already owns. They can create `outbox/<jobId>.json` first. The worker’s `rename` onto that name then fails, and the API will ingest the planted verdict if it matches `MediaJobResultSchema`. The API re-checks type consistency, limits, magic bytes of the quarantined file, and the upload’s size and SHA-256. It does not decode the file. That is the residual the threat model already states.

Thumbnails enlarge it. `#readThumbnail` requires `info.uid === verdictUid` (`pipeline.ts:524-526`). It does not require uid 10001. The same local user who plants the verdict can plant `outbox/<jobId>.thumb.jpg` and pass the check. The API will store up to 512 KiB of JPEG under the victim organisation and serve it at `GET /api/media/:id/thumbnail` as `image/jpeg`, with `nosniff` and a sandbox CSP. The code comment at `pipeline.ts:606` attributes that injection to a compromised worker. The threat-model sentence that “the uid check stops another local process from planting a thumbnail” holds when the verdict file was written by the worker. It does not hold for the local writer the same page already says can forge the verdict. The upload test plants thumbnails as the same uid as the verdict and does not exercise a different uid; the threat model already says that case needs root. Assumptions still match M0: one host, local users, no dedicated shared group. The operations checklist still defers that group (`docs/security/operations-and-release-checklist.md` item 7).

**No per-organisation fairness on the single serial worker (T15).** `pendingJobs` sorts by spec mtime and `processJob` runs one at a time (`apps/media-worker/src/main.ts:237-292`). The API’s deadline gives each visible job one inspection timeout per job ahead of it (`pipeline.ts:394-404`), and `sec.media_processing_jobs` returns at most 500 rows. A queue of slow files still delays every organisation. Stage B makes image jobs slower: each accepted image is fully decoded and re-encoded as a JPEG (`apps/media-worker/src/inspect.ts:101-110`) on that same serial loop. No scheduler was added, and none is proposed here.

**No reconciliation of orphaned storage objects (T1 / storage lifecycle).** `runHousekeeping` deletes expired sessions, old pairings, stale `.tmp` files, old heartbeat rows, and job-exchange leftovers (`apps/api/src/housekeeping.ts:31-45`, `packages/storage/src/local.ts:275-290`, `pipeline.ts:716-740`). Nothing lists `MEDIA_ROOT/objects` and compares it with `storage_key` and `thumb_storage_key`. A crash after `putFile` or thumbnail `put` and before the `processing` to `ready` update leaves an object whose key was never stored; the next tick allocates a new key. `media.delete` logs and continues if `storage.delete` throws, so the row can be gone while the file remains (`apps/api/src/routes/media.ts:673-679`). Thumbnails add a second object on both paths. Quota still sums `media.bytes` for `processing` and `ready` only (`media.ts:121-128`) and the delete path says quota ignores thumbnail bytes (`media.ts:659`). That matches the stage B deviation in `docs/prototype-m0.md`: at most 512 KiB each, outside the 5 GB cap. Soft-deleted published media keeps both objects, and the source bytes still count because `deleted_at` is not part of the sum. There is still no backfill and no video poster; `/thumbnail` serves the original when `thumb_storage_key` is null (`media.ts:568-574`).

## 6. Runtime evidence and limitations

### This run

| Item | Value |
|---|---|
| SHA | `cfa9926423e63393ab50afd6625a08beb69393f5` |
| Host | Ubuntu 24.04.5, Linux 6.12.113+, x86_64 |
| Node / npm | v22.23.4 / 10.9.9 (`.nvmrc` is `22`; `engines` is `>=22.13.0`) |
| PostgreSQL | 17.12, image `postgres:17.12-alpine3.24@sha256:d3244e8ce3f165ee3c93d9c4a4b1d0fe48b3a89e2287b717fdcbbde92d405065`, container `tinnox-review-pg-2e10`, volume `tinnox-review-pg-2e10`, `127.0.0.1:54329` |
| Roles after init | `tinnox_app` login, not superuser, not `BYPASSRLS`; `tinnox_migrator` login, not superuser, not `BYPASSRLS`; `tinnox_definer` nologin, `BYPASSRLS`, not superuser. Databases `tinnox` and `tinnox_test`. |
| Worker image | `tinnox-cms-media-worker:m0`, built here from `apps/media-worker/Dockerfile`. `apk add ffmpeg=8.1.3-r0` succeeded. Image user `10001:10001`. |
| What was not started | Keycloak, the compose project, the portal, the player, Playwright |
| Cleanup | Container and volume removed. `.env` and `infra/.generated/` removed. `git status --porcelain` empty. |

Command (repository root, after `npm ci` and `npm run setup -- --quiet` so `production-refusal` had a `dev-` `.env`):

```sh
npx vitest run --project integration \
  packages/db/test/rls.integration.test.ts \
  packages/db/test/sec.integration.test.ts \
  packages/db/test/migration-0005.integration.test.ts \
  packages/db/test/portal-v2.integration.test.ts \
  packages/db/test/stage-b.integration.test.ts \
  apps/api/test/publish.integration.test.ts \
  apps/api/test/push.integration.test.ts \
  tests/integration/cross-org.test.ts \
  tests/integration/session-csrf.test.ts \
  tests/integration/pairing-and-credentials.test.ts \
  tests/integration/production-refusal.test.ts \
  apps/api/test/player.integration.test.ts \
  apps/api/test/abuse.integration.test.ts \
  apps/api/test/upload.integration.test.ts \
  tests/integration/media-worker.test.ts
```

The root project’s global setup ran `resetTestDatabase` on `TEST_DATABASE_MIGRATOR_URL` (`…/tinnox_test`) and then `runMigrations` from `db/migrations`. Three consecutive invocations (default reporter, verbose, JSON) each reported 15 files, 192 tests, 0 failed. The tabulated run is the JSON one (vitest 5.1.0, about 28 s). There is no failure output.

| File | Result |
|---|---|
| `packages/db/test/rls.integration.test.ts` | passed, 26 |
| `packages/db/test/sec.integration.test.ts` | passed, 24 |
| `packages/db/test/migration-0005.integration.test.ts` | passed, 17 |
| `packages/db/test/portal-v2.integration.test.ts` | passed, 29 |
| `packages/db/test/stage-b.integration.test.ts` | passed, 9 |
| `apps/api/test/publish.integration.test.ts` | passed, 7 |
| `apps/api/test/push.integration.test.ts` | passed, 24 |
| `tests/integration/cross-org.test.ts` | passed, 7 |
| `tests/integration/session-csrf.test.ts` | passed, 11 |
| `tests/integration/pairing-and-credentials.test.ts` | passed, 7 |
| `tests/integration/production-refusal.test.ts` | passed, 3 |
| `apps/api/test/player.integration.test.ts` | passed, 6 |
| `apps/api/test/abuse.integration.test.ts` | passed, 5 |
| `apps/api/test/upload.integration.test.ts` | passed, 11 |
| `tests/integration/media-worker.test.ts` | passed, 6 |

`packages/db/test/stage-b-apps.integration.test.ts` is not in the named subset and was not run here. The GitHub integration log shows it passed (8 tests) inside the full suite.

### GitHub Actions on this SHA (external evidence, not a substitute for the table above)

Run [43835309136](https://github.com/tinnox-au/tinnox-cms/actions/runs/43835309136), event `push`, branch `main`, head SHA `cfa9926423e63393ab50afd6625a08beb69393f5`, `ubuntu-24.04`, Node v22.23.4.

| Job | Conclusion | What the log shows |
|---|---|---|
| Lint, types, unit tests, build, audit | success | `npm ci`, lint, format, typecheck, `npm test`, build, `npm audit` (7 moderate, exit 0) |
| Integration and security-boundary tests | success | `npm run setup -- --quiet`, `npm run infra:up` (postgres, keycloak, media-worker; ffmpeg 8.1.3-r0), `npm run fixtures`, `npm run test:integration` — 23 files, 266 tests passed, about 33 s |
| Secret scan (gitleaks) | success | `npm run scan:secrets` |
| End-to-end (manual) | skipped | `if` is `workflow_dispatch` or `vars.RUN_E2E == 'true'` (`.github/workflows/ci.yml:90-92`) |

### Limitations

- No Keycloak process, so no proof of the `tinnox browser` flow, PKCE at the provider, or TOTP. The production-refusal test proves the API exits before listen; it does not prove the provider.
- No browser end-to-end run. `tests/README.md` and `docs/prototype-m0.md` still record that the Playwright run restarts the shared PostgreSQL container and shares `data/jobs` with the development worker. That suite was correctly left unrun.
- `npm run backup:verify` was not run (CU-01).
- The full `npm run test:integration` suite was not repeated locally. The named subset was. The full suite’s result on this SHA is the GitHub job above.
- Worker tests use simulated verdicts in `apps/api/test/upload.integration.test.ts` and the real container in `tests/integration/media-worker.test.ts`. A different uid on a thumbnail file was not exercised.
- Supported environment versus this evidence: the documents still describe Node 23.10 and an unrun workflow. This machine and the GitHub job both used Node v22.23.4. The worker image uses Node 24, which is the documented image deviation, not the API runtime.

## 7. Deferred questions

- Does a hosted deployment’s API umask keep the job spec readable by uid 10001 (CU-02)? The safe property is a `chmod` after the spec is renamed.
- Should thumbnail objects be part of the restore proof, and should app items be excluded from the media-asset join (CU-01)?
- The validation pages need a pass that matches run 43835309136, including the skipped end-to-end job (CU-03).
- Real MFA remains a provider-flow question. `npm run verify:oidc` and the manual end-to-end job are the checks that would exercise Keycloak. Neither was run here, and the end-to-end job did not run in CI on this SHA.
- `stage-b-apps.integration.test.ts` was outside the named subset. The full CI log shows those 8 tests passed. This review does not add an architecture reading of migration 0007.
- Migration ordering and RLS policy design are left to the other review. The mechanical results those suites produced are in the table in section 6: `rls` 26, `sec` 24, `migration-0005` 17, `portal-v2` 29, `stage-b` 9, `publish` 7, `push` 24, all passed.
- No disagreement with another reviewer’s findings: this is the first round. The one tension inside the existing documents is the threat model’s claim that the thumbnail uid check stops a local process, set against the same model’s claim that a local process can forge a verdict. The code implements the second claim, and the thumbnail check follows the verdict’s uid.
