# Cursor report — areas 3 to 5

Date: 17 November 2026, Australia/Melbourne (UTC+11).

| Item | Value |
|---|---|
| Reviewer | Cursor cloud agent, model Grok 4.7, reasoning effort xhigh, 500k context window, normal speed |
| Agent | [bc-6b210cc8-bd6e-557f-9d9f-1c4205db60e6](https://cursor.com/agents/bc-6b210cc8-bd6e-557f-9d9f-1c4205db60e6) |
| Baseline | `e905bf71e3e1f6a3d38d14e04d79f729f39c432f` (`e905bf7`, tip of `main` when the review started; merge of PR #12) |
| Date of report | 17 November 2026, 12:33 (Australia/Melbourne) |
| Method | Runtime review of areas 3, 4 and 5 on an isolated checkout at the same SHA. PostgreSQL 17.12, unit and integration suites, and API and database probes. Keycloak and the Playwright end-to-end suite did not run. No branch, commit, push, or pull request. |
| Path edits | Finding anchors (`scu-01` and so on) were added for navigation. The report text is otherwise unchanged. |
| Disposable VM paths | References to `/opt/cursor/artifacts/*` are left as written. Those files were on the reviewer’s disposable VM and are not in this folder. |
| This file | The report text below is from the reviewer’s final message, including its runtime-evidence appendix. |
| Consolidated summary | [README.md](README.md) |

---

# Round 3 database and security review — areas 3 to 5

SHA `e905bf71e3e1f6a3d38d14e04d79f729f39c432f`. Read-only. No branch, commit, push, or pull request. No product file was changed.

Reviewer scope: runtime database probing (area 3), API attack-surface tests (area 4), and suite plus fix verification (area 5). Areas 1 and 2 were left to the static review. This report reads code only to design probes and to cite what the probes hit.

## 1. Baseline, scope, environment, methods

| Item | Value |
|---|---|
| Repository | `tinnox-au/tinnox-cms` |
| SHA | `e905bf71e3e1f6a3d38d14e04d79f729f39c432f` (`e905bf7`, merge of the FCX-01 / FCX-06 player fix) |
| Host | Ubuntu 24.04.5, Node v22.23.4, npm workspaces installed with `npm ci` |
| PostgreSQL | 17.12 from PGDG (`postgresql-17`), cluster `17/main`, `listen_addresses=localhost`, port 5432, host auth `scram-sha-256` |
| Roles | Created by `infra/postgres/init/01-roles.sh` unchanged. Confirmed: `tinnox_app` can log in, is not superuser, has no `BYPASSRLS`; `tinnox_migrator` can log in, is not superuser, has no `BYPASSRLS`; `tinnox_definer` cannot log in, has `BYPASSRLS`, is not superuser |
| Databases | `tinnox` and `tinnox_test` from the role script. Extra throwaway `tinnox_review`, owner `tinnox_migrator`, for the probes. `tinnox_review` and `tinnox_test` migrated through `0008_null_safe_checks.sql`. `tinnox` was left unmigrated |
| Docker | Not present at the start. Installed later (`docker.io`). Daemon started with `dockerd` because policy-rc.d blocked the service unit. Worker image `tinnox-cms-media-worker:m0` built from `apps/media-worker/Dockerfile` |
| Identity provider | Keycloak was not started. Operator sessions in the API probes were created with `sec.session_create`, the same factory `apps/api/test/support.ts` uses. The sign-in callback was driven with an in-process fake `IdentityProvider`, not with Keycloak |
| Secrets | Passwords and HMAC keys lived in a mode-600 file outside the repository and in gitignored `.env`. They are not in this report or in the evidence files |

Supabase role names in `.agents/skills/postgres-best-practices/` were read as the repository maps them: `authenticated` is `tinnox_app` with `app.org_id`, and there is no service role. The only `BYPASSRLS` path is `tinnox_definer` inside `sec.*`.

Evidence files under `/opt/cursor/artifacts/`: `area3-results.jsonl` (316 probe rows), `area3-followup.jsonl`, `area4-results.jsonl` (partial; the process was stopped after a measurement bug), `area4b-results.jsonl`, `player-runtime.log`, `npm-test-unit.log`, `npm-test-integration.log`, `npm-test-integration-rerun.log`, `npm-test-media-worker.log`, `npm-test-security-subset.log`, `probes/*.ts`, and a copy of this report.

## 2. Short assessment of areas 3 to 5

Tenant isolation holds for the runtime role. With no `app.org_id`, an empty setting, or a malformed setting, tenant tables return no rows or the statement errors. With one organisation set, that organisation's rows are visible and the other organisation's rows are not. Composite foreign keys reject cross-organisation references. `tinnox_app` cannot set role to `tinnox_definer` or `tinnox_migrator`, cannot disable RLS, and cannot read `pg_authid` or the server filesystem. All 17 `sec.*` functions are `SECURITY DEFINER`, owned by `tinnox_definer`, with `search_path=pg_catalog, pg_temp`. Forced RLS is on for every `public` table except `schema_migrations`.

The API, reached as organisation B with A's identifiers, answered 404 on the object routes and did not echo A's identifiers in lists. CSRF and Origin checks reject state-changing requests that lack the portal Origin or the session token. Logout invalidates the cookie. A callback through the fake provider rotates the session cookie and the planted cookie stops working. Signed media URLs fail closed on a bad signature, a swapped registration, publication, or asset, and after revocation.

Two low findings are new. Pairing creation still commits the pairing session and writes `pairing.create` as a later autocommit statement, so a failed audit insert leaves a pending session and returns 500. `tinnox_app` can permanently change its own role configuration, including clearing `statement_timeout`. Neither is a cross-organisation read.

CX-01, CX-02, CX-03, FCX-01, and FCX-06 were reproduced in the direction of the fixes and held. The unit suite passed. The integration suite passed once three environment mismatches (worker image, `dev-` secret prefix, superuser password) were corrected. Playwright end-to-end was not run because Keycloak was not started.

## 3. Prioritized findings

<a id="scu-01"></a>
### SCU-01 — Pairing creation can commit without its audit event

**Severity: Low. Classification: New finding. Confidence: high (executed).**

**Claim.** `POST /player/pairing` inserts the pairing session and the `pairing.create` audit row as two autocommit statements. If the audit insert fails, the session remains and the client receives 500 without the code.

**Trigger.** As `tinnox_migrator`, a `BEFORE INSERT` trigger on `audit_event` raised when `action = 'pairing.create'`. Then `POST /player/pairing` on the real API.

**Consequence.** Pending pairing sessions went from 3 to 4. The response status was 500. The body did not contain the injected exception text, the SQL, or the word `pairing_session`. The code and polling token are returned only after the audit call (`apps/api/src/routes/player.ts:230-238`), so this request did not hand them to the client. The row is still a live pending code until it expires. Claiming it requires guessing an 8-character code from the pairing alphabet; `sec.pairing_claim` returned `rate_limited` after five wrong codes for one membership in the window. A client that receives 500 will ask again, so repeated audit failures also consume the per-client pairing-session budget.

This is the same split CX-01 fixed for pairing completion, sign-in, and sign-out. Those three paths now use `withResolvedOrg` and their regression tests passed (section 5). Creation was outside that fix.

**Citations.** `apps/api/src/routes/player.ts:100` (`poolAsTx`), `apps/api/src/routes/player.ts:202-229` (`pairingCreate` then `auditUnscoped` on that handle), `packages/db/src/tx.ts:127-132` (`poolAsTx` is one statement, its own transaction). Completion, for contrast of the intended shape, is `apps/api/src/routes/player.ts:284-317`.

**Required property.** Creating the pairing session and writing `pairing.create` commit together or roll back together. A failed audit insert leaves no pending session.

<a id="scu-02"></a>
### SCU-02 — The runtime role can clear its own timeout settings

**Severity: Low. Classification: New finding. Confidence: high (executed, then restored).**

**Claim.** `tinnox_app` can `ALTER ROLE tinnox_app SET` a configuration parameter, and the new value applies to later sessions. The timeouts in `infra/postgres/init/01-roles.sh` are therefore not fixed for the life of the role.

**Trigger and result.**

| Statement as `tinnox_app` | Result |
|---|---|
| `ALTER ROLE tinnox_app SET statement_timeout = '0'`, committed | A new connection showed `statement_timeout` of `0` |
| `ALTER ROLE tinnox_app SET statement_timeout = '15s'`, committed | A new connection showed `15s` again |
| `ALTER ROLE tinnox_app SET row_security = off`, rolled back | The statement was accepted. It was not left in place |
| `ALTER ROLE tinnox_app WITH BYPASSRLS`, `SUPERUSER`, or `CREATEROLE` | `42501` |
| `ALTER ROLE tinnox_definer WITH LOGIN` | `42501` |
| `ALTER ROLE tinnox_migrator SET lock_timeout = '0'` | `42501` |
| `ALTER ROLE tinnox_app SET app.org_id = '<org B>'` | `permission denied to set parameter "app.org_id"` |
| `SET row_security = off` then `SELECT` from `organization` | `42501` `query would be affected by row-level security policy`. Zero rows were not returned, and the other organisation was not returned |

After the probe, `pg_db_role_setting` for `tinnox_app` was `statement_timeout=15s`, `idle_in_transaction_session_timeout=30s`, `lock_timeout=5s`.

**Consequence.** Any session as `tinnox_app` can remove the 15 second statement timeout for every later session until an administrator sets it back. The same `ALTER ROLE SET` form accepted `row_security`. Turning `row_security` off does not bypass forced policies: the query errors. It would stop tenant queries rather than open them. The role cannot grant itself `BYPASSRLS` and cannot pin `app.org_id` as a role default. An attacker who can already run SQL as `tinnox_app` can already choose `app.org_id` per transaction. The new part is that the change survives the session and the process.

**Citations.** `infra/postgres/init/01-roles.sh:39-41`. Catalog check after restore, recorded in section 6.

**Required property.** The timeouts and `row_security` installed for `tinnox_app` stay in force for new sessions after a session as `tinnox_app` has tried to change them.

## 4. Things done well, with the probes that passed

**Roles and catalog.** On `tinnox_review` after migrations 0001 through 0008, 22 of 23 `public` tables have `relrowsecurity` and `relforcerowsecurity`. The exception is `schema_migrations`, which holds migration names and checksums. `tinnox_app` receives `42501` on it. All 17 `sec.*` functions are security definer, owned by `tinnox_definer`, with `search_path=pg_catalog, pg_temp`.

**No tenant context.** As `tinnox_app` and as `tinnox_migrator`, `SELECT count(*)` on every tenant table was 0. An empty `app.org_id` stayed at 0. `not-a-uuid`, a padded UUID, and `x' OR '1'='1` failed in `app_org_id()` with `22P02` before any row was returned. Organisation A saw one row of its own in each tenant table (two player registrations, two tags) and organisation B saw only its own.

**Cross-organisation writes.** Moving `org_id`, inserting the other organisation's id, updating or deleting the other organisation's primary key, and attaching the other organisation's media, playlist, tag, folder, or display failed with `42501` (RLS or missing column privilege) or `23503` (composite foreign key). A publication asset inserted after its publication, including one aimed at the other organisation's media, failed with `23001` (`publication assets can only be added with their publication`). `{}` as a manifest and a `ready` media row with `bytes` NULL failed `23514` (CX-02, below).

**Audit.** An insert that supplied `occurred_at = 2000-01-01` was stored with the database time (`2026-11-17`). `tinnox_app` `UPDATE` and `DELETE` on `audit_event` were `42501`. A direct insert with `org_id` NULL was `42501`. An oversized `detail` was `23514`. `sec.audit_unscoped` can insert a NULL-organisation event; that is the documented unscoped path.

**Privileges.** `tinnox_app` was refused `SET ROLE` to the definer and the migrator, `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`, `DROP POLICY`, `CREATE` in `public`, `TRUNCATE`, `COPY ... TO PROGRAM`, `pg_read_file`, `lo_import`, `SELECT` from `pg_authid`, and `CREATE EXTENSION`. Creating a temporary function was refused (`permission denied to create temporary tables`), which blocks a `pg_temp` search-path shadow. The non-tenant tables `session`, `login_state`, `pairing_session`, and `pairing_claim_failure` are permission-denied for `tinnox_app` even with an organisation set.

**`sec.*` hostile inputs.** Null, empty, quote, `%`, and a 100 000 character subject returned no membership. A short session-id hash and a one-second TTL were rejected. Login state was taken once and the replay returned no row. A revoked device hash returned no row. `pairing_claim` without an organisation, with the other organisation's display, and with the other organisation's membership did not claim. Five wrong codes then `rate_limited`. `pairing_complete` on a junk id returned `not_claimable`. Purge functions rejected a window under one hour.

**Pooling and timeouts.** Forty-eight parallel `withOrg` calls, alternating organisations, with one thrown error: 0 mismatched rows, the injected error counted once, no other errors. `pg_terminate_backend` on a checked-out connection failed the next query on that connection; the following `withOrg` for organisation B saw only B. `SELECT pg_sleep(20)` was cancelled at 15 001 ms (`57014`) and the connection accepted the next statement. A row lock held by another `tinnox_app` session cancelled an `UPDATE` at 5 002 ms (`55P03`). A transaction left idle for 32 seconds was no longer queryable (`idle_in_transaction_session_timeout` is 30 s). `SHOW` as `tinnox_app`: statement 15 s, lock 5 s, idle-in-transaction 30 s. `SHOW` as `tinnox_migrator`: lock 30 s. The migrator has no statement timeout and no idle-in-transaction timeout; the 30 s lock was not waited out.

**API, organisation B against A's ids.** Display, status, claim, revoke, media, preview, thumbnail, usage, playlist, publish, duplicate, app, folder, tag, and push returned 404 `not_found`. `GET /api/displays` did not contain A's display id. Audit, overview, and push lists returned 200 without A's ids. A create body that added `orgId` or `org_id`, or A's site id, returned 400 `validation_failed`.

**CSRF, session, player.** With `Content-Type: application/json`, PATCH without an Origin, with `https://evil.test`, with Origin `null`, without the CSRF token, with the wrong token, or with `Sec-Fetch-Site: cross-site` returned 403 (`origin_not_allowed` or `csrf_failed`). The same request with the portal Origin, the session token, and `Sec-Fetch-Site: same-origin` returned 200, and that was the name saved. `GET` does not require the token. Two sessions for one member had different cookies. After logout, `GET /api/displays` with that cookie returned 401. The other session still worked. The fake-provider callback returned 303 with a new session cookie; the planted cookie then got 401 on `GET /api/displays`; the new cookie got 200; replaying the callback redirected to `/?authError=state`. A missing pre-auth cookie did the same.

**Player and media URLs.** B's manifest did not contain A's publication (204). B's media-url request for A's publication was 404. A's signed URL returned 200. A flipped signature, an old expiry left in the query with the original signature, B's registration id, another publication id, another asset path, and a traversal asset path returned 403 `url_signature_invalid`. A device token on `/api/displays` and a session cookie on `/player/manifest` returned 401. After operator revoke, the same device token's manifest and the previously valid signed URL returned 401 `device_revoked`.

**Uploads, errors, limits, headers.** HTML bytes named `safe.png` returned 415. A real PNG named `../../etc/passwd.png`, a 400-character name, and a name containing a CR/LF were accepted as labels and the stored name was not a path. A body over a 64-byte limit returned 413. Malformed JSON returned 400 without a parser dump. An over-long path returned 404 without echoing the path. A SQL-shaped name returned 400 `validation_failed`. `GET /healthz` and `GET /readyz` returned 200. The 31st `GET /api/auth/login` in a minute, with rate-limit scale 1, returned 429 `rate_limited` and `Retry-After: 60`. Operator responses from a foreign Origin had no `Access-Control-Allow-Origin`. The player Origin received CORS on `/player/manifest` without credentials.

API `GET /api/session` headers: `Content-Security-Policy: default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `Cross-Origin-Resource-Policy: same-origin`. HSTS was absent on this HTTP listener, which matches the configuration (HSTS only when cookies are secure).

Built portal preview `http://127.0.0.1:4173/` and player preview `http://127.0.0.1:4174/`: response `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`. The HTML meta policy is `default-src 'self'; script-src 'self'; style-src 'self'` with no `unsafe-inline` and no `unsafe-eval`. Neither document contained an inline script. The player's `connect-src` includes `http://localhost:4000`, the origin written at build time.

## 5. Documented residuals confirmed

These match `docs/security/control-matrix.md` and `docs/reviews/2026-11-16-backend-round-1/` section 5. They are not new findings.

- **Application-selected tenancy (B4).** `tinnox_app` with `app.org_id` set to organisation A saw A's rows. RLS does not check that the caller was allowed to choose that id. The API probes took the id from the session row, and a client-supplied `orgId` was rejected by the schema.
- **`sec.*` reads before the organisation is known.** `device_by_token_hash` and `device_by_registration_id` returned the other organisation's registration id, organisation id, and display id when called with that registration's hash or id. `membership_by_oidc_sub` did the same for a known subject. `media_processing_jobs` is granted to `tinnox_app` and returns identifiers only. The signed-URL route verifies the HMAC before `device_by_registration_id` (`apps/api/src/routes/player.ts:479-496`).
- **Audit is not independent of the database owner (B11, T14).** The append-only trigger blocks `UPDATE`, including for `tinnox_migrator` (`23001`). It does not block `DELETE`. As `tinnox_migrator`, `DELETE` of one `media.upload` row removed it; rollback restored the count. `tinnox_migrator` could also `ALTER TABLE audit_event DISABLE TRIGGER` inside a transaction that was rolled back, and could `SET ROLE tinnox_definer` and then see both organisations (count 2) and the session table. That is the migration role's `BYPASSRLS` grant (`01-roles.sh:31`). `tinnox_app` can insert an audit row for the organisation in context, with the database clock. Unscoped rows are not visible to `tinnox_app`. `tinnox_definer` has `INSERT` on `audit_event` and no `SELECT`, so it cannot read them either. The abuse test reads them as the superuser, which matches the matrix: only a database administrator sees unscoped events.
- **Signed URL is a bearer until expiry, and revocation stops it (B7).** Confirmed by the 401 on the previously valid URL after revoke.
- **No antivirus scan (B8).** The worker suite, after the image was built, accepted JPEG, PNG, and H.264 and rejected disguised types, HTML, SVG, and unsupported codecs. That is structural inspection. A separate decompression-bomb file was not added beyond that suite.
- **In-memory rate limits (B5, B9).** The 429 on the 31st login is per process. A second API process was not run.
- **Database and object storage are separate.** Not re-tested as a new case. The upload route still commits the media row before enqueue (`apps/api/src/routes/media.ts:347-355`), which the earlier review already recorded.
- **Local HTTP, HSTS only on HTTPS (B9).** Confirmed on the API and on the preview servers.

**Observation.** A session-level `set_config('app.org_id', <org A>, false)` survived release back to a `max: 1` pool from `createPool`. The next checkout saw one organisation row without calling `withOrg`. `packages/db/src/pool.ts:27-35` does not `DISCARD ALL` or `RESET ALL`. Request code uses transaction-local `set_config` (`packages/db/src/tx.ts:79` and `:114`). The 48-way `withOrg` probe did not leak. This becomes a defect if a statement sets `app.org_id` for the session rather than the transaction. No such call exists under `apps/` or `packages/` outside tests and `scripts/seed.ts` (seed uses `is_local true`).

**Observation.** `schema_migrations` has no row-level security. It is not tenant data, and `tinnox_app` cannot read it.

## 6. Runtime evidence appendix

### Area 3

`npx tsx node_modules/.tinnox-review/migrate-review.ts REVIEW_DATABASE_MIGRATOR_URL` applied `0001` through `0008` on `tinnox_review`.

`npx tsx node_modules/.tinnox-review/area3.ts` wrote 316 rows to `area3-results.jsonl`. Two organisations were seeded as `tinnox_migrator` with transaction-local `app.org_id`. Probes then ran as `tinnox_app` and as `tinnox_migrator`.

`npx tsx node_modules/.tinnox-review/area3-followup.ts` checked `row_security` and `ALTER ROLE`, and restored `statement_timeout`.

`npx tsx node_modules/.tinnox-review/role-default.ts` attempted `ALTER ROLE tinnox_app SET app.org_id`. The server refused the parameter. The process was then stuck with the client open and was killed. `pg_db_role_setting` afterwards still had the three `tinnox_app` timeouts and no `app.org_id`.

### Area 4

`npx tsx node_modules/.tinnox-review/area4.ts` ran the cross-organisation, player, upload, and header probes. It stopped while counting audit rows: `tinnox_definer` has no `SELECT` on `audit_event`, so that count was the wrong role. The CSRF block in that run sent JSON without `Content-Type` and Fastify answered 415 before the CSRF hook; the display name was unchanged. Those two measurements were repeated.

`npx tsx node_modules/.tinnox-review/area4b.ts` recorded the CSRF matrix, logout, callback rotation, the pairing-create audit failure (sessions 3 → 4, HTTP 500), and the login rate limit.

Keycloak was not running. `npm run verify:oidc` was not run.

### Area 5

| Command | Result |
|---|---|
| `npm test` (vitest unit) | Exit 0. 71 files, 1490 tests passed, 5.10 s |
| `npm run test:integration` | Exit 1. 25 files, 278 tests: 268 passed, 4 failed, 6 skipped, 42 s |
| Rerun `tests/integration/production-refusal.test.ts` and `apps/api/test/abuse.integration.test.ts` | Exit 0. 2 files, 8 tests passed |
| `sudo docker build -f apps/media-worker/Dockerfile -t tinnox-cms-media-worker:m0 .` | Exit 0 |
| `tests/integration/media-worker.test.ts` | Exit 0. 6 tests passed, 13.5 s |
| `migrate.integration.test.ts`, `credential-audit.test.ts`, `rls.integration.test.ts`, `sec.integration.test.ts` | Exit 0. 4 files, 60 tests (4 + 3 + 29 + 24) |

The four integration failures were environment, and the reruns passed:

- `media-worker.test.ts` threw in `beforeAll` because the image did not exist yet. After the build, 6 tests passed, including disguised files, HTML, SVG, hostile names, and a worker killed mid-inspection.
- `abuse.integration.test.ts` counts unscoped audit rows as the `postgres` superuser. The local cluster had no password for that role yet, so the connection failed. After `ALTER ROLE postgres PASSWORD` from the gitignored env file, the file passed (5 tests, inside the 8-test rerun).
- `production-refusal.test.ts` expects secrets that start with `dev-`, which `npm run setup` writes. The review env used random hex, so the "development secret" assertion failed and one case started the API. That process logged `schema "sec" does not exist` because database `tinnox` was never migrated, then the test killed it at 20 s. Prefixing `SESSION_SECRET`, `MEDIA_URL_HMAC_SECRET`, `PAIRING_CLIENT_KEY_SECRET`, and `OIDC_CLIENT_SECRET` with `dev-` made the file pass. The failed run had already printed the https, `tinnox-dev` realm, and MFA refusals.

**CX-01.** `tests/integration/credential-audit.test.ts` (3 tests) passed. The file makes the audit insert fail for `pairing.complete`, `auth.logout`, and `auth.login`. The assertions are: completion returns 500 and leaves the registration count at 0, then a later poll issues the credential and one audit row; logout returns 500 and `GET /api/displays` is 401; sign-in returns 500, does not set a new session cookie, and leaves the previous session usable, then a later callback rotates it.

**CX-02.** As `tinnox_app` on a database migrated through 0008: inserting a publication whose manifest is `{}` failed `publication_manifest_shape` (`23514`); inserting `ready` media with `bytes` NULL failed `media_ready_is_complete` (`23514`). `db/migrations/0008_null_safe_checks.sql:21-42`.

**CX-03.** `packages/db/test/migrate.integration.test.ts` (4 tests) passed: a directory missing an applied file does not apply a later file; a changed checksum is refused; a new file that sorts before an applied one is refused; a file that follows the applied set is applied once. The check is before any pending file runs (`packages/db/src/migrate.ts:67-93`).

**FCX-01.** A local HTTP server wrote `200` and `{"manifest":` and then stalled. `PlayerHttpApi.forDevice(...).fetchManifest(null)` rejected at 15 025 ms with `manifest poll: no answer within 15000 ms`. `apps/player-web/src/platform/api.ts:25` and `:133-138`.

**FCX-06.** A local server answered 429 with `Retry-After: 30`. One heartbeat call returned a `PlayerFault` with `retryAfterMs=30000`. A `HeartbeatLoop` against that server made 1 call in 8 seconds. The ordinary backoff base is 5 seconds (`apps/player-web/src/core/heartbeat.ts:83`), so a loop that ignored `Retry-After` would have called again inside that window. The unit file `apps/player-web/src/core/retry-after.test.ts` is part of the 1490 passing unit tests.

**FCX-03 and FCX-05.** Not reproduced in a browser. They stay the open portal findings from round 2. Nothing in this pass gave them a database or cross-organisation angle that required a portal session.

### What did not run

- Playwright `tests/e2e/01` through `08`, `npm run test:e2e`, and `npm run verify:oidc`. Keycloak was not started. Docker was available only after the main integration run, and was used for the worker image.
- A migrator `lock_timeout` wait of 30 seconds. `SHOW lock_timeout` was `30s`.
- A hand-built decompression bomb beyond the worker suite's oversized and damaged-file cases.
- Browser reproduction of FCX-03 and FCX-05.

## 7. Open questions

1. Should `pairing.create` follow the same single-transaction rule as `pairing.complete`, or is an unaudited pending session whose code was never returned an accepted residual? SCU-01 assumes the former, because `AGENTS.md` lists pairing among the actions whose audit row shares the change's transaction.
2. Should `tinnox_app` be unable to `ALTER ROLE` its own configuration parameters? SCU-02 is limited because the role is already the runtime trust boundary. The timeouts only work as a backstop if the role cannot clear them.
3. Should `createPool` reset session state on release (`RESET ALL` or `DISCARD ALL`) so a session-level `app.org_id` cannot outlive a transaction? Current request code does not set one.
4. The end-to-end job is still a manual CI dispatch, and this environment did not run it. A Node 22 browser run with Keycloak remains outside this appendix.
