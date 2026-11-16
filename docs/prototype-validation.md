# Prototype M0: validation record

Date: 2026-11-14. Branch `feat/prototype-m0`, code uncommitted on top of `1d3f220`. Written by the integration and validation step; sections 3 to 9 were updated, and section 10 added, by the review-fix step after three independent reviews (every suite was re-run after the fixes).

This page records what was **run**, with the real outcome. Anything not run says so. This is an internal browser prototype with synthetic data. A passing test here is evidence about software on one developer machine. It is not evidence of LED hardware compatibility, kiosk reliability, hosted data residency or legal compliance. NovaStar compatibility still needs the model-specific integration and hardware tests in `docs/hardware-next-step.md`.

## 1. Environment

| Item | Version |
|---|---|
| OS | macOS 26.6.2 (build 25G83), Apple silicon (arm64) |
| Node.js / npm | 23.10.0 / 10.9.2. **Every result on this page ran on Node 23.10**, which is end of life and outside the supported range of eslint 10 and vitest 5 (they warn at install; both ran without problems). `engines` is now `>=22.13.0` and `.nvmrc` and CI use Node 22, but **no run on Node 22 has happened** (it is not installed here and CI has never executed). |
| Docker | Engine 29.8.0, Compose 5.5.1 (Docker Desktop) |
| PostgreSQL | 17.12 (`postgres:17.12-alpine3.24`, pinned by digest), host port 54330 (54329 is taken on this machine) |
| Keycloak | 26.8.2 (`start-dev`, realm `tinnox-dev` imported from the generated file; container recreated after the review fixes to import the `tinnox browser` flow) |
| Media worker | `tinnox-cms-media-worker:m0`, Node 24.22.3 on Alpine 3.24, Alpine package `ffmpeg=8.1.3-r0` (pinned exactly since the review fixes; the image was rebuilt) |
| Browser for E2E | Playwright 1.65.1 with its Chromium 159.0.8154.6 (headless) |
| Main libraries | Fastify 5.12.8, React 19.3.1, Vite 8.3.8, TypeScript 6.0.3, pg 8.23.1, zod 4.6.7, vitest 5.1.0 |

## 2. Cold start

All local state was destroyed first, including the generated secrets, so the run started like a fresh clone with installed dependencies:

```sh
npm run reset -- --yes                  # removed containers, the database volume and ./data
# .env and infra/.generated/ were moved out of the repository, so setup had to generate everything again
npm run setup -- --quiet                # exit 0: new secrets, realm import, dev identities; chose port 54330
npm run infra:up                        # exit 0: PostgreSQL, Keycloak and the media worker healthy
npm run db:migrate                      # exit 0: applied 0001, 0002, 0003
npm run db:seed -- --second-org         # exit 0: "TINNOX Internal" and "Isolation Test Organisation"
npm run verify:oidc                     # exit 0: PKCE, refused unregistered redirect, password then TOTP, single-use code, sub matches
npm run fixtures                        # exit 0: synthetic sample media (the worker image runs ffmpeg; the host needs none)
```

Setup to verified sign-in took 53 seconds, with the worker image already in the Docker cache.

Then `npm run dev` started the API, the portal and the player together:

- `/readyz` reported database, storage, media jobs, identity provider and media worker all ready.
- The portal answered on http://localhost:5173, including a deep link. `GET /api/session` through the portal proxy returned `{"authenticated":false}`.
- `/api/auth/login` redirected to Keycloak with the registered redirect URI.
- `POST /player/pairing` from the player origin returned a pairing session.
- A headless browser opened the dev player and saw a pairing code of 8 characters. It also opened the portal sign-in page. Neither page logged a console error.
- The dev servers were then stopped.

## 3. Checks and test suites

Final results, re-run on 2026-11-14 (12:41 to 12:50 UTC) after every change described in sections 7 and 10:

| Check | Command | Result |
|---|---|---|
| Type check (every workspace, scripts, tests) | `npm run typecheck` | exit 0 |
| Lint (type-aware, `--max-warnings=0`) | `npm run lint` | exit 0 |
| Formatting | `npm run format:check` | exit 0 (Markdown and `docs/` are excluded by `.prettierignore`) |
| Build | `npm run build` | exit 0 (the player build now also fails on an inline script). The API and worker run from TypeScript source and have no build step. |
| Unit tests | `npm test` | **395 passed of 395**, 24 files. By workspace: player 150, portal 78, domain 51, api 45, storage 23, contracts 20, media-worker 17, delivery 11. |
| Integration and security-boundary tests | `npm run test:integration` | **116 passed of 116**, 12 files (table below), on three runs after the fixes. Real PostgreSQL as `tinnox_app`, real API listener, real worker container (rebuilt image). |
| Browser end-to-end | `npm run test:e2e` | **25 passed of 25**, twice after the fixes: 6.3 minutes, then 5.8 minutes for the final run `3e95cb31` (section 8), which wrote `docs/evidence/` (`E2E_EVIDENCE_DIR=docs/evidence`). |
| Dependency audit | `npm run audit` (`--audit-level=high`) | exit 0. 0 critical, 0 high, 7 moderate: all one advisory, `minimatch` GHSA-g3hv-75wg-m249, inside `typescript-eslint`, development tooling only. No dependency was added or changed by the review fixes. |
| Secret scan | `npm run scan:secrets` | exit 0. gitleaks 8.30.1 (container, no network) found no leaks in 8 commits of history or in 299 tracked and not-ignored files. The exact-value check found 0 of 16 generated secrets in those files. |
| Secrets in logs | search of `tests/.run/api.log` (1,152 lines, the final E2E run at `info` level) | 0 occurrences of `sig=`, `Bearer `, `tinnox_session=`; 0 of 14 generated passwords, TOTP secrets and server secrets |
| Identity provider | `npm run verify:oidc` | exit 0 after the realm fix. New checks: the ID token carries no name or e-mail claim; a temporary user with a password and no authenticator gets no code and is sent to authenticator set-up (both failed against the previous realm). |
| Backup and restore | `npm run backup:verify` | passed again after migration 0004 (section 5) |
| CI workflow | `.github/workflows/ci.yml` | **not run**: it has never executed on GitHub. The pinned action SHAs were checked against the release tags. |

Integration tests by file:

| File | Passed | What it covers (brief section 8) |
|---|---|---|
| `packages/db/test/rls.integration.test.ts` | 26/26 | Row-level security as `tinnox_app`, with no context, own context and the other organisation; pooled-connection context; immutable publications; append-only audit; no assets added to an existing publication; audit time set by the database (item 4) |
| `packages/db/test/sec.integration.test.ts` | 24/24 | Pre-tenant functions: sessions (ID token removed when a session ends), pairing flow, concurrent claims and completions, expiry, lockouts, revocation, heartbeat-history purge (item 3) |
| `apps/api/test/pairing.integration.test.ts` | 8/8 | Pairing over HTTP: concurrent claims, lockouts, operator throttle, foreign display, replacement, player reset, real rate limits (item 3) |
| `apps/api/test/player.integration.test.ts` | 6/6 | Stale and replayed `seq`, reports for another display or publication, malformed reports, staleness by clock, ETag/304, signed-URL tamper, expiry and cross-registration (items 6, 10) |
| `apps/api/test/publish.integration.test.ts` | 5/5 | Idempotent publish under concurrency, snapshot unchanged after draft and display edits, unready media refused, cross-organisation publishing (items 4, 5, 6) |
| `apps/api/test/upload.integration.test.ts` | 10/10 | Upload cut off mid-stream at the limit, disguised content, file name never a path, API-computed SHA-256, forged worker verdicts, quarantine tampering, worker timeout across an API restart, quota under concurrency, published bytes kept after delete, orphaned quarantine files swept while running (item 5) |
| `tests/integration/cross-org.test.ts` | 7/7 | Second organisation, with its own session and its own registered player, against the first organisation's displays, media, previews, playlists, publications, status, audit and player endpoints by known id. Also covers ignored client-supplied organisation ids and a database proof with no `WHERE` clause (item 4) |
| `apps/api/test/abuse.integration.test.ts` | 5/5 | Random bearer tokens throttled per address with at most two audit rows; heartbeat history bounded and purged by time across organisations; over-long path parameter answered with the envelope and headers; real `Content-Length` on `HEAD` (new; all five failed before the fixes) |
| `tests/integration/media-worker.test.ts` | 6/6 | Real worker container. One retry after an interrupted inspection, rejection after two (failed against the old image). Accepts JPEG, PNG and H.264. Refuses HEVC, VP9, yuv444, an oversized PNG and a damaged JPEG with specific codes, and text, HTML and SVG under media names. A hostile file name is kept as a label only. Failed and processing media cannot be published (item 5) |
| `tests/integration/pairing-and-credentials.test.ts` | 7/7 | Expiry, single use, credential handed over once, both attempt limits, revoked player cut off from manifest, URLs, media and reports, reset and re-pair into another organisation, status from telemetry only (items 3, 10, 11) |
| `tests/integration/production-refusal.test.ts` | 3/3 | The real API process refuses `NODE_ENV=production` with the development configuration, and with one development setting left, naming the settings without printing values |
| `tests/integration/session-csrf.test.ts` | 9/9 | Unauthenticated access, device token versus cookie separation, CSRF token, exact Origin, CORS for the operator API and for player routes, hardening headers, sign-out, absolute and idle expiry, forged callbacks |

## 4. Browser end-to-end run

Playwright with Chromium. The operator and the player run in **separate browser contexts**. Since the review fixes the run uses its own database, `tinnox_e2e_test` (rebuilt from the migrations and seed at the start), and `tests/.run/media`; the development database received no rows from it (checked: its newest display predates the run). Playwright builds the portal and the player and serves the production builds with `vite preview` on 5173 and 5174, because the player's service worker exists only in a build. It also starts and stops the API on 4000. The operator signs in through the real Keycloak form with the generated password and a TOTP code computed from the generated secret. Faults are injected only with Playwright request interception on the player's media downloads, and with the context's offline switch.

| # | Test | Result |
|---|---|---|
| 1 | operator is signed in through the identity provider (password and one-time code) | passed |
| 2 | operator creates a display with a canvas | passed |
| 3 | player shows a pairing code; the operator claims it; the player registers | passed |
| 4 | operator uploads JPEG, PNG and MP4; the isolated worker validates them | passed |
| 5 | operator builds a playlist and publishes it to the display | passed |
| 6 | player downloads, verifies and really renders the image and the video (visible `img` with non-zero natural size; `video.currentTime` advances) | passed |
| 7 | portal shows desired = downloaded = active from real player reports | passed |
| 8 | editing the draft does not change the live publication | passed |
| 9 | publishing a second version switches the player over (and garbage-collects the asset only the old version used) | passed |
| 10 | a corrupt download is rejected: the previous version keeps playing and the portal shows the error (`integrity_mismatch`) | passed |
| 11 | an interrupted download keeps the previous version; the update completes once the network recovers; afterwards the resolved delivery errors are no longer reported (checked since the review fixes) | passed |
| 12 | playback continues through a network outage, survives an offline reload, and reports again afterwards | passed |
| 13 | data, media and the player survive a restart of the API and of the database | passed |
| 14 | revoking the player stops its access; it shows the unregistered screen and removes its content | passed |
| 15 | the audit trail records the journey without secrets | passed |
| 16 | portrait 1080x1920: contain and cover are drawn where the geometry says | passed |
| 17 | tall strip 640x1344: contain and cover are drawn where the geometry says | passed |
| 18 | wide panel 768x448 with a content rectangle: contain and cover are drawn where the geometry says | passed |
| 19 | the second organisation sees none of the first organisation's objects and cannot reach them by id | passed |
| 20 | upload failures are shown with a reason the operator can act on | passed |
| 21 | media in a playlist cannot be deleted; unused media can | passed |
| 22 | a display can be edited and invalid canvas input is refused in the form | passed |
| 23 | publishing an empty playlist is refused and says nothing was published | passed |
| 24 | a player whose clock is 11 minutes fast shows one pairing code, keeps it and pairs (new; it failed with the old expiry check) | passed |
| 25 | portal and player pages refuse to be framed and are not content-sniffed (preview servers; new) | passed |

The canvas tests (16 to 18) compute the expected contain and cover rectangles in the test itself, independently of the player's and the domain package's code. They compare them with the rendered element rectangles (to within 1 px) and check the colours of real screen pixels inside and outside the expected areas. Between canvases the player is **reset locally**, and the test checks that the credential, the state and every cached file are gone and that the old credential was revoked on the server (brief item 11).

Measured in the run that followed the cold start (run `537ffbff`, 23 of 23 passed in 6.1 minutes):

| Measure | Value |
|---|---|
| Network outage of the player context (offline, including an offline reload) | **110 seconds**. During it, 490 playback samples were taken and 39 item changes observed, with no blank sample. This is the only outage tested; **no 24-hour or multi-day soak was run.** |
| Reconnect to a fresh heartbeat in the portal | 5 seconds |
| Interrupted download (`network_error`) to completed update after recovery | 44 seconds |
| API and database restart to the next player report | 19 seconds |

The final run after the image pinning is recorded in section 8.

### Screenshots (`docs/evidence/`)

Written by the final run `3e95cb31` (section 8). These are synthetic content only. No password, TOTP code or token is visible; screenshots are never taken on the sign-in page.

| File | State |
|---|---|
| `01-portal-display-created.png` | Display created with its canvas |
| `02-player-pairing-code.png` | Player showing its pairing code |
| `03-portal-media-ready.png` | JPEG, PNG and MP4 ready after inspection |
| `04-portal-published.png` | Playlist published |
| `05-player-playing-image.png`, `06-player-playing-video.png` | Player rendering the image and the video |
| `07-portal-status-in-sync.png` | Desired = downloaded = active, from player reports |
| `08-portal-delivery-error.png` | Corrupt download: `integrity_mismatch` reported, previous version still active |
| `09-portal-status-stale.png` | Player offline: last report marked stale |
| `10-player-offline-reload.png` | Player still playing after an offline reload |
| `11-player-unregistered.png` | Player after revocation |
| `12-portal-audit.png` | Audit trail |
| `13-portal-upload-rejected.png` | HEVC video and a disguised text file refused with reasons |
| `canvas-<w>x<h>-contain.png`, `canvas-<w>x<h>-cover.png` | 1080×1920, 640×1344 and 768×448 canvases |

The integration step looked at 05, 07 and 08 directly: they show what the tests assert, and no secret is visible.

## 5. Restart persistence and backup/restore

**Restart.** E2E test 13 stops the API process and checks that the player keeps playing with no blank sample. It then restarts the PostgreSQL container (`docker compose restart postgres`) and starts the API again. After that:

- the same operator session is still valid;
- the media list is unchanged;
- a preview's SHA-256 equals the stored hash;
- the manifest is byte-identical;
- the player reports to the restarted API with desired = downloaded = active.

Separately, pinning the images by digest recreated the PostgreSQL and Keycloak containers on the same volume. The backup exercise after that found all data intact.

**Backup and restore.** First run by the integration step; re-run after the review fixes (migration 0004) on 2026-11-14 at 12:48 UTC with the API stopped: 11 table counts matched (now including 33 publications and 72 publication assets, from earlier runs only: E2E no longer writes to this database); 39 ready media rows and all 72 publication assets matched their restored files by SHA-256 and size; after the restore, 17 tables had forced row-level security, with 12 triggers (the two new ones included) and 17 `sec` functions owned by `tinnox_definer`; "restore verified". The first run, for the record: `BACKUP_ROOT=<scratch directory> npm run backup:verify` ran with the API stopped, following `docs/security/operations-and-release-checklist.md` section 2:

- `pg_dump` as the superuser produced 123,006 bytes, and the media archive 193,536 bytes with 8 objects. Both passed their `SHA256SUMS` check.
- The dump was restored with `pg_restore --exit-on-error` into the new database `tinnox_restore`, and the media into a new directory.
- Row counts of 11 tables match.
- All 8 ready media rows match their restored files by size and SHA-256.
- All **18 assets of 8 publications** match the SHA-256 and size frozen in the immutable manifests. No manifest asset lacks a stored object, and no `publication_asset` row is orphaned.
- After the restore, all 17 data tables still have forced row-level security, with 10 triggers and 16 `sec` functions owned by `tinnox_definer`. `tinnox_app` sees 0 rows with no organisation context, and a publication update is refused.
- Result: "restore verified". The scratch database and directory were removed.

The restore was into a new database in the same cluster, not onto a separate host or volume.

## 6. Coverage of brief section 8

| Item | Where |
|---|---|
| 1 Fresh setup, migrations, identity, seeding; survives restart | Section 2; E2E 13; section 5 |
| 2 Sign-in with MFA, display, pairing, upload, playlist, publish, download, image and video playback in separate contexts | E2E 1 to 7 |
| 3 Pairing expiry, reuse, concurrent claim; revoked credentials | Integration (pairing files); E2E 14 and 24 |
| 4 Cross-organisation access through the API and database policies | `cross-org.test.ts`, `rls.integration.test.ts`, `publish.integration.test.ts`; E2E 19 |
| 5 Upload limits, disguised files, path traversal, codecs; unready media | `upload.integration.test.ts`, `media-worker.test.ts`, `publish.integration.test.ts`; E2E 20 |
| 6 Snapshot immutability, idempotent publish, stale telemetry | `publish.integration.test.ts`, `player.integration.test.ts`; E2E 8 |
| 7 Corrupt or interrupted downloads, insufficient cache space | E2E 10 and 11; **cache-space exhaustion only in player unit tests** (`apps/player-web/src/core/staging.test.ts`), not in a real browser |
| 8 Outage and offline reload | E2E 12: 110 seconds measured |
| 9 Portrait and unusual canvases; runtime errors reported | E2E 16 to 18. Runtime playback errors (decode failure, video error, stalled-video watchdog) are covered **only by player unit tests with fakes** (`apps/player-web/src/core/playback.test.ts`); E2E 10 and 11 cover download and integrity errors, not runtime playback errors. No real-browser runtime-error test exists. |
| 10 Status reflects telemetry, marks stale, distinguishes states | E2E 7 and 12 (screenshot 09); `player.integration.test.ts`; `pairing-and-credentials.test.ts` |
| 11 Local reset; no leak on reassignment | E2E 14 and 16 to 18; `pairing-and-credentials.test.ts` (reset and re-pair into another organisation) |
| 12 Type check, lint, build, tests, scans, restore | Section 3 and 5; CI not executed |

## 7. Changes made by the integration step

These changes touched code other engineers wrote. Each was needed to make the parts work together or to fix a fault the tests found.

- `apps/player-web/src/app.ts`: garbage collection now runs once the new version's first item is on screen. Before, the previous version's last asset was kept for ever. E2E 9 checks the fix.
- `apps/portal/src/pages/DisplayDetailPage.tsx`: `data-testid` and `data-summary`/`data-stale` attributes on the status panel, for the tests. No behaviour change.
- `scripts/setup-dev.mjs`: creates `data/media` and `data/jobs/{inbox,outbox}` with fixed modes before the containers start.
- `scripts/scan-secrets.mjs`: added the exact-value check of generated secrets.
- `package.json`: `infra:up` also builds and starts the media worker. Added `dev`, `start:built`, `otp`, `fixtures`, `backup:verify`.
- `vitest.config.ts`: the integration project also runs `apps/*/test`.
- `packages/db/test/sec.integration.test.ts`: expects 16 `sec` functions, which includes the two from migration 0003.
- `apps/api/test/support.ts`: a typing fix (`Blob` from bytes).
- `infra/docker-compose.yml`: PostgreSQL and Keycloak pinned by tag and digest.
- `.github/workflows/ci.yml`: the integration job builds the worker image and the fixtures; the E2E job was added and is manual.
- New: `tests/integration/*`, `tests/e2e/*`, `tests/playwright.config.ts`, `tests/support/png.ts`, `scripts/otp.mjs`, `scripts/backup-restore-check.sh`.
- Updated: the README run guide, this page, and the security documents.

No `NEEDS-DEPS.md` existed and no dependency was added.

## 8. Final end-to-end run

After all review fixes, `E2E_EVIDENCE_DIR=docs/evidence npm run test:e2e` ran from 12:41 UTC as run `3e95cb31`: **25 of 25 passed in 5.8 minutes**. Its measurements are in `docs/evidence/e2e-measurements.json`, and the screenshots in `docs/evidence/` come from this run (they replaced those of the earlier run `4be2ce7a`). The run before it (same code, evidence written to `tests/.run/evidence`) also passed 25 of 25 in 6.3 minutes.

| Measure | Value |
|---|---|
| Network outage (offline, including an offline reload) | 110 seconds; 487 playback samples, 39 item changes, no blank sample |
| Reconnect to a fresh heartbeat | 3 seconds |
| Interrupted download to completed update | 42 seconds |
| Errors still reported after that recovery | none |
| API and database restart to the next player report | under 1 second after the restarted API answered (recorded as 0) |

These numbers vary between runs (the reviewers' own run measured 46 s recovery and 3 s reconnect). The API log of this run (1,152 lines) contained no `sig=`, no `Bearer ` and no `tinnox_session=`, and none of the generated secrets. At teardown the three saved operator sessions were signed out (3 `auth.logout` events, no live session left in the E2E database) and their browser states deleted.

## 9. Limitations (frank)

- **Browser prototype only.** No LED controller, HDMI chain, kiosk device or NovaStar/Huidu software was used. A player report is evidence from software, not proof that a physical screen shows the content.
- **Outage tested for 110 seconds, not for hours or days.** There was no soak. Long-running behaviour is unmeasured: memory growth, browser tab suspension, OS sleep, browser updates and storage eviction.
- **Browser storage is not guaranteed.** Persistent storage was refused in headless Chromium. Browsers may evict IndexedDB and Cache Storage under pressure, private windows lose everything, and nothing restarts the player after an OS reboot. There is no wake lock.
- Insufficient cache space is tested in unit tests only, not in a real browser with a real quota. The same holds for the IndexedDB fixes (connection closed by another context, database left at a newer version): unit tests against fake-indexeddb only.
- A download is held in memory before hashing, so a 200 MB asset needs about 400 MB of RAM in the player. The 200 MB upload limit was tested only at a reduced limit.
- MFA is enforced by Keycloak's flow, now with the one-time code required for every user. The API cannot verify it from claims with the development realm, so production start-up requires ACR or AMR settings; a Keycloak administrator who changes the flow is not detected.
- No antivirus or malicious-content scan of uploads. Structural inspection is not malware detection. The worker's jobs directory is shared across organisations, its inbox and files are readable by every local user (`0755`/`0644`) and its outbox is world-writable (`1777`) so the worker's uid can write there: on Linux any local account could read pending uploads or forge a verdict (not fixed: it needs a group shared by the API user and the worker uid, which could not be tested here; on macOS Docker does not enforce the modes at all). One serial worker serves every organisation, so one organisation's slow uploads can make another's time out (no fairness; not fixed). The worker retry was tested with crash markers, not by killing a running inspection. A crash between storing a validated file and marking it ready leaves an unreferenced storage object (no reconciliation).
- Rate limits, including the new per-address throttle of failed device credentials, are in memory and per process; a distributed source is not limited. Behind a reverse proxy they depend on `TRUST_PROXY` listing the proxies. The device token is stored in clear in the player's IndexedDB.
- Unscoped audit events (failed sign-ins, pairing creation, rejected device credentials) cannot be read through the API. Organisations and publications cannot be deleted, and there is no retention purge for audit events or soft-deleted media bytes; only the heartbeat-history period is configurable.
- The portal has no component or DOM tests (its logic is unit-tested; its screens are covered by E2E). Dark mode, narrow layouts and screen readers were not checked.
- The CI workflow has never run. All results above are from one macOS machine, on Node 23.10; nothing has run on the declared Node 22 line.
- The backup exercise is local, same-cluster and manual. There are no scheduled, off-site or encrypted backups.
- `npm audit` lists 7 moderate advisories in development tooling, waiting for an upstream `typescript-eslint` release.
- The development server (`npm run dev`) uses a looser CSP than the builds, and the player's service worker runs only in a build (`npm run start:built`). Offline reload therefore works only with the build. The new anti-framing headers were verified on the preview servers (E2E 25); on the dev servers they come from the same Vite option but no request was made to check them. No reference reverse-proxy configuration ships.
- The E2E suite still restarts the shared PostgreSQL container and shares `data/jobs` with the development worker; the E2E API's quarantine sweep would remove files of a development job left pending in that directory (the development API must not run at the same time).
- `package-lock.json` still records the old root `engines` value (`>=22.12.0`); it was not regenerated because no dependency changed.

## 10. Review findings and fixes (2026-11-14)

Three independent reviewers (security, reliability, brief conformance) reported 27 findings, two of them duplicates across reviewers. Each was checked against the code before anything changed. None was rejected; one was partly inaccurate (marked). "Fails before" means the new test was run against the unfixed code and failed; tests marked "by reasoning" were not run before the fix.

| # | Finding (severity) | Confirmed how | Fix | Test |
|---|---|---|---|---|
| 1 | Random bearer tokens bypass the player rate limit and each writes an unscoped audit row (high, and a medium duplicate) | New test, fails before (all requests answered 401) | Failed credential lookups counted per client address (IPv6 per /64): after 30 in 10 minutes `429` before any database lookup, except for a recently verified credential; audit once when an address starts failing and once when throttled (`apps/api/src/auth/failure-guard.ts`, `routes/player.ts`) | `apps/api/test/abuse.integration.test.ts` (flood); `apps/api/src/auth/failure-guard.test.ts` |
| 2 | `TRUST_PROXY=true` trusts a client-chosen `X-Forwarded-For` (medium) | Code read; Fastify's request code read | `TRUST_PROXY` is `false` or a list of proxy addresses/CIDRs; `true` and hop counts refused at start-up (Fastify 5.12.8 ignores hop-count trust) | `apps/api/src/config.test.ts` "TRUST_PROXY" (by reasoning for the old behaviour) |
| 3 | Conditional OTP: a user without an authenticator signs in with a password only (medium) | Reproduced: a temporary password-only user received an authorization code | Realm template binds the `tinnox browser` flow with the code `REQUIRED`; Keycloak recreated | `npm run verify:oidc` MFA probe, fails before |
| 4 | Player can grow `heartbeat_log` without bound (medium, two reviewers) | New tests, fail before | Only accepted reports stored, at most one per display per 10 s; hourly time-based purge across organisations (`sec.heartbeat_log_purge`, `LIMIT_HEARTBEAT_LOG_RETENTION_HOURS`) | `abuse.integration.test.ts` (two tests); `sec.integration.test.ts` |
| 5 | Player with a fast clock cannot pair and uses up the pairing quota (medium) | E2E with an 11-minute skew, fails before (no code shown) | `expiresInSeconds` in the pairing response; local deadline; the poll answer decides expiry | `e2e/05-hardening.spec.ts` (24); `apps/player-web/src/core/pairing-clock.test.ts` |
| 6 | Full ID token with names stored in `session` (low) | `verify:oidc` listed `name`, `given_name`, `family_name`, `preferred_username`; fails before | `profile` scope removed from the client; stored token cleared when a session ends (migration 0004). The token (without names) is still stored, for `id_token_hint` | `verify:oidc`; `sec.integration.test.ts` "drops the stored ID token…" |
| 7 | `tinnox_app` can append `publication_asset` rows and backdate audit events (low) | New tests, fail before | Insert trigger: assets only in the publication's own transaction and only as its manifest lists them; `occurred_at := now()` on every audit insert. A forged `actor_id` remains possible | `rls.integration.test.ts` (two tests) |
| 8 | Quarantine world-readable, outbox world-writable (low) | Code and modes read | **Not fixed** (needs a shared group for the API user and worker uid 10001, untestable on macOS Docker); documented in section 9, control matrix B8, threat model section 9 | none |
| 9 | Over-long path parameter: raw 414 without headers, path echoed (low) | New test, fails before | `frameworkErrors` handler: standard envelope, 404, hardening headers, no echo | `abuse.integration.test.ts` |
| 10 | Portal and player pages frameable in every documented run mode (low) | Config read | Vite dev and preview servers send `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `COOP`. No reverse-proxy reference config | `e2e/05-hardening.spec.ts` (25, preview only); `build-checks.test.ts` |
| 11 | E2E saved states keep live session and Keycloak cookies (low) | Files inspected | Teardown signs sessions out (API and Keycloak) and deletes the files; directory `0700`, files `0600` | Observed after both runs: no state file left, 3 logins and 3 logouts, no live session |
| 12 | One serial worker: one organisation's uploads can time out another's (low; "not in the threat model" was partly inaccurate: T15 named the delay, not the failures) | Code read | **Not fixed**; threat model and limitations updated | none |
| 13 | `HEAD` on signed media reports `Content-Length: 0` (low) | New test, fails before | Empty stream for `HEAD` keeps the real length | `abuse.integration.test.ts` |
| 14 | Lost IndexedDB connection leaves stale playback; newer database version blocks start (low) | Code read | Version-tolerant open; reload on `blocking`/`terminated` | `idb-store.test.ts` (three tests, by reasoning; not in a real browser) |
| 15 | Worker crash fails a valid upload permanently (low) | New test against the old image, fails | Attempt count in the marker; one retry; reject after two | `media-worker.test.ts` (real container); `attempts.test.ts` |
| 16 | Orphaned quarantine and storage files after an API crash (low) | Code read | Quarantine: sweep at start-up and hourly, 2-minute grace, uploads in progress excluded. **Storage objects: not fixed** (no reconciliation) | `upload.integration.test.ts` "sweeps orphaned quarantine files…" |
| 17 | Player errors never cleared (low) | Code read | Errors resolved by a successful sync cycle are dropped; playback and local errors kept for an hour | E2E 11 (extended); `errors.test.ts`; `sync.test.ts` |
| 18 | Docs claim a keyed session-id hash; code stores plain SHA-256 (low) | Code read | Docs corrected (no code change: ids are 256-bit random) | n/a |
| 19 | E2E overwrites `docs/evidence` and fills the development database (low) | Code read | Evidence to `tests/.run/evidence` unless `E2E_EVIDENCE_DIR`; own database `tinnox_e2e_test` and media directory. The PostgreSQL restart remains, documented | Both E2E runs; development database unchanged |
| 20 | Node minimum wrong; nothing ran on a supported Node (low) | Lockfile engines read | `engines >=22.13.0`; README and handoff. **No Node 22 run** (not installed; CI never ran) | n/a |
| 21 | "Configurable" retention overstated (low) | Docs and code read | Reworded; heartbeat retention became a setting | n/a |
| 22 | Player build lacks the inline-script check (low) | Code read | Check added to the player build | `build-checks.test.ts` |
| 23 | Validation row 9 cites download errors for runtime playback errors (low) | Tests read | Row corrected (section 6) | n/a |
| 24 | Build-time inventory incomplete; `ffmpeg` floats within 8.1.x (low) | Dockerfile read | ghcr.io, Alpine repository, Playwright download listed; `ffmpeg=8.1.3-r0` pinned, image rebuilt | Worker integration tests on the rebuilt image |
| 25 | Setup's free-port probe ignores IPv6 (low) | `[::1]:54330` busy here | Probe checks both loopback addresses; README says to use `127.0.0.1` for database clients | Probe run by hand: 54330 reported busy on `::1` |

Remaining known defects after this step: items 8, 12 and the storage half of 16; no Node 22 run; dev-server headers not checked by request; IndexedDB fixes unit-tested only; and every limitation in section 9.

## 11. Portal v2 end-to-end run (2026-11-16)

Added on 2026-11-16 for portal v2 stage A (`docs/portal-v2/stage-a.md`), branch `feat/portal-v2`, code uncommitted. The sections above record the M0 portal and are left as they were.

The Playwright specs were rewritten for the v2 screens, so the suite grew from 25 to 27 tests (the dashboard counters and the push from the header are new). `npm run test:e2e` ran against the production builds of the portal and the player (`vite build` and `vite preview`, strict Content-Security-Policy), with real Keycloak sign-in and TOTP, the real API and the real validation worker, on Node 23.10 as before.

| Run | Result |
|---|---|
| First full run, before fixes | 10 passed, 2 failed, 15 did not run (the journey is serial, so its later tests stop after a failure) |
| Full run 1 after the fixes | **27 passed of 27**, 6.2 minutes, none skipped |
| Full run 2 after the fixes, straight after | **27 passed of 27**, 6.1 minutes, none skipped |

Both failures were test defects; no product defect was found. The dashboard test expected the screen counters on the seeded organisation, which has no screen (the card shows its empty state); it now checks the empty state, then the counters against `GET /api/overview` once the journey has a screen. The canvas edit test read the API before the save finished; it now waits for the "Canvas saved" notification. Throughout the journey the portal kept no web-storage key and reported no Content-Security-Policy violation.

Measurements of the second run (`tests/.run/evidence/e2e-measurements.json`, not copied to `docs/evidence`): network outage 111 seconds with 489 playback samples, 38 item changes and no blank sample; reconnect to a fresh report 5 seconds; interrupted download to completed update 43 seconds, with no error still reported afterwards; API and database restart to the next player report 1 second.

The same day, after the runs: `npm run typecheck` exit 0; `npx eslint . --max-warnings=0` exit 0; `npx prettier --check .` exit 0; `npm test` 1,255 passed of 1,255 (64 files); `npm run test:integration` 233 passed of 233 (20 files).
