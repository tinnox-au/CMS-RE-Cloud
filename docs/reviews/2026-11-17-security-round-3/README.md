# Database and security review, round 3

Date: 17 November 2026, Australia/Melbourne (UTC+11).
Status: documented review only. Both reviewers worked read-only; no product code was changed, and this folder is a record of the outcome, not a patch.

This page is the consolidated record of Round 3 of the TINNOX CMS database and security review. It is intended to live at `docs/reviews/2026-11-17-security-round-3/`. The two source reports are kept beside it:

- [Codex report, areas 1 and 2](codex-areas-1-2.md)
- [Cursor report, areas 3 to 5, including the runtime appendix](cursor-areas-3-5.md)

## 1. Baseline, scope and methods

| Item | Value |
|---|---|
| Repository | `tinnox-au/tinnox-cms` |
| Baseline | `e905bf71e3e1f6a3d38d14e04d79f729f39c432f` (`e905bf7`). This was the tip of `main` when the review started. |
| Commit | Merge pull request #12 from `tinnox-au/fix/player-fcx-01-fcx-06`, 17 November 2026, 11:22 (Australia/Melbourne) |
| Scope | Database and security: PostgreSQL row-level security, roles and grants, the `sec.*` SECURITY DEFINER functions, migrations 0001–0008, transaction and audit integrity, and the security boundaries of the API, player and media worker |
| In scope | `packages/db` and `db/migrations` 0001–0008, `infra/postgres` role initialization, `apps/api` (including the media pipeline, auth, pairing, player and operator routes), `apps/media-worker`, the documented security and operations pages, and runtime probes of the same surface |
| Out of scope | New features; patches; known open frontend items from round 2 (FCX-02..05, FCU-01..06) unless they had a security or data-integrity angle; exhaustive product QA; a production-scale performance study |
| Method | One fixed snapshot. Neither reviewer followed a moving branch or changed the tree they reviewed. |

After both reviewers had taken that snapshot, `main` moved on. When this record was filed, `main` was `42ff3f887754b39be7502d463e7de74a73ffe076` (`42ff3f8`), the merge of pull request #15 on 17 November 2026, 19:15 (Australia/Melbourne). Between `e905bf7` and that tip, `main` also gained pull request #13 (stage B schedules, including migration 0009) and pull request #14 (the frontend review round 2 fixes). This documentation branch is taken from current `main`. The findings describe the code at `e905bf7` and were not re-checked against those later commits.

| Reviewer | Areas | Model and effort | Method |
|---|---|---|---|
| Codex CLI v0.169.0, sandbox read-only | 1 and 2: static database, transaction, API, player and media-worker security | `gpt-6-astra`, high | Static, read-only. Finished 17 November 2026, 19:56 (Australia/Melbourne). Dependencies were not installed, so no tests were run. No files written, no GitHub access. Run on Michael’s second Codex account. Report: [codex-areas-1-2.md](codex-areas-1-2.md). |
| Cursor cloud agent [bc-6b210cc8-bd6e-557f-9d9f-1c4205db60e6](https://cursor.com/agents/bc-6b210cc8-bd6e-557f-9d9f-1c4205db60e6) | 3 to 5: runtime database probing; API attack-surface tests; suite and fix verification | Grok 4.7, xhigh effort, 500k context window, normal speed | Isolated checkout at the same SHA. PostgreSQL 17.12, roles from `infra/postgres/init/01-roles.sh`, and a throwaway `tinnox_review` database migrated through 0008. Unit and integration suites ran, as did custom database and API probes. Keycloak was not started, so `npm run test:e2e` and `npm run verify:oidc` did not run. Report: [cursor-areas-3-5.md](cursor-areas-3-5.md). |

Findings are merged here by root cause. Area ownership is the default authority for a finding. Documented residuals and remaining runtime uncertainties are kept visible. [SCX-04](codex-areas-1-2.md#scx-04) part A and [SCU-01](cursor-areas-3-5.md#scu-01) share a root cause; both IDs are kept, as set out in section 4. No product code was changed in this round; every finding’s next step is for later rounds.

Both reports were scanned for secrets, tokens, and signed URLs. None were present, and nothing has been redacted. Mentions of cookies, HMAC, bearer tokens, and secrets are descriptive only. Citations in the Codex report have been rewritten as repo-relative links against the pinned SHA. Paths under `/opt/cursor/artifacts/` are left as written; those files were on the reviewer’s disposable VM and are not in this folder.

## 2. Overall verdict

Tenant isolation held at runtime for the `tinnox_app` role. With no `app.org_id`, an empty setting, or a malformed setting, tenant tables returned no rows or the statement errored. With one organisation set, that organisation’s rows were visible and the other organisation’s rows were not. Composite foreign keys rejected cross-organisation references. The API, reached as organisation B with A’s identifiers, answered 404 on the object routes and did not echo A’s identifiers in lists. CSRF and Origin checks rejected state-changing requests that lacked the portal Origin or the session token. Signed media URLs failed closed on a bad signature, a swapped registration, publication, or asset, and after revocation. Forced RLS, the three-role split, and all 17 `sec.*` SECURITY DEFINER functions with `search_path` pinned to `pg_catalog, pg_temp` were present in the migrations and confirmed on the reviewed database.

The principal new weaknesses are on pairing authorization and destructive media cleanup, not on tenant isolation. An older claimed pairing can survive a later replacement or revocation and can then take the display back ([SCX-01](codex-areas-1-2.md#scx-01)). Orphan cleanup can delete files that still belong to live processing jobs beyond the first 500 ([SCX-02](codex-areas-1-2.md#scx-02)). If the API loses the COMMIT acknowledgement after PostgreSQL has committed, upload and ingestion error paths can delete files that now belong to committed rows ([SCX-03](codex-areas-1-2.md#scx-03)). Pairing creation still writes the session and its audit in separate autocommits ([SCX-04](codex-areas-1-2.md#scx-04) part A / [SCU-01](cursor-areas-3-5.md#scu-01)), and a poll lockout changes security state with no audit event ([SCX-04](codex-areas-1-2.md#scx-04) part B). Concurrent wrong-code claims can exceed the five-attempt budget ([SCX-05](codex-areas-1-2.md#scx-05)). Rotating `SESSION_SECRET` does not perform the runbook’s promised global sign-out ([SCX-06](codex-areas-1-2.md#scx-06)). The runtime role can clear its own statement timeout for later sessions ([SCU-02](cursor-areas-3-5.md#scu-02)).

Neither reviewer found a Critical defect. There are four High findings, two Medium, and two Low.

## 3. Findings

These are the confirmed findings from both reviewers, sorted by severity, then by owner. [SCX-04](codex-areas-1-2.md#scx-04) part A and [SCU-01](cursor-areas-3-5.md#scu-01) share a root cause; both IDs remain in this table, as set out in section 4.

| ID | Severity | Classification | Summary | Area |
|---|---|---|---|---|
| [SCX-01](codex-areas-1-2.md#scx-01) | High | New finding | An older claimed pairing survives later replacement or revocation, so a previously authorized device can reclaim the display. | 1–2 — Pairing authorization |
| [SCX-02](codex-areas-1-2.md#scx-02) | High | New finding | Orphan cleanup treats the oldest 500 processing jobs as the complete pending set, and can delete files for live jobs beyond that limit. | 1–2 — Media pipeline and housekeeping |
| [SCX-03](codex-areas-1-2.md#scx-03) | High | New finding | If the API loses the COMMIT acknowledgement after PostgreSQL has committed, upload and ingestion error paths can delete files that now belong to committed rows. | 1–2 — Transaction durability |
| [SCX-04](codex-areas-1-2.md#scx-04) | High | New finding | Pairing creation writes the session and its audit in separate autocommits, and a poll lockout changes security state with no audit event. | 1–2 — Transaction and audit integrity |
| [SCX-05](codex-areas-1-2.md#scx-05) | Medium | New finding | Concurrent `pairing_claim` transactions can both pass the wrong-code allowance at count 4, exceeding the five-attempt budget. | 1–2 — Pairing authorization |
| [SCX-06](codex-areas-1-2.md#scx-06) | Medium | New finding | Rotating `SESSION_SECRET` does not invalidate established sessions, despite the runbook saying it signs everyone out. | 1–2 — Session management and operations |
| [SCU-01](cursor-areas-3-5.md#scu-01) | Low | New finding | `POST /player/pairing` can leave a pending session when the later `pairing.create` audit insert fails. Same split as SCX-04 part A. | 4 — API attack surface |
| [SCU-02](cursor-areas-3-5.md#scu-02) | Low | New finding | `tinnox_app` can `ALTER ROLE` its own configuration, including clearing `statement_timeout` for later sessions. | 3 — Runtime database probing |

## 4. Cross-reviewer notes

The area split held, with one shared root cause.

**SCX-04 part A and SCU-01.** Codex’s [SCX-04](codex-areas-1-2.md#scx-04) part A (pairing creation and its audit written as separate autocommits through `poolAsTx`) is the same root cause as Cursor’s [SCU-01](cursor-areas-3-5.md#scu-01). Codex rated the combined SCX-04 High, because it also includes part B: `sec.pairing_poll` locks the session after the Nth wrong token and the route returns a generic not-found with no audit event. Cursor rated the create split Low, having executed it: a failed `pairing.create` audit left a pending session, the client received 500 without the code, and claiming still required guessing that code. Both IDs are kept. The difference is honest: Cursor demonstrated part A and judged that bounded case Low; Codex judged the create split together with the unaudited lockout as High.

**Parallel reviews and unverified SCX reproductions.** The two reviewers ran in parallel. Cursor did not receive or exercise Codex’s section 6 runtime questions, so the SCX reproductions remain unverified at runtime, even though their code citations were re-read after the fact (section 10). The exception is SCX-04 part A, which Cursor reproduced as SCU-01. Some of Codex’s later, general questions — deployed roles and ACLs, pooling and RLS behaviour, CSRF and Origin checks, signed-media denial, worker structural inspection, and whether error responses leaked internals — were independently covered by Cursor’s areas 3–5, but not as a response to that list. The SCX-specific items in Codex section 6 remain open follow-ups in section 8.

Neither report contradicts the other on tenant isolation. Both judged it sound, and Cursor demonstrated it.

## 5. What was judged sound

These are design choices and runtime observations without an additional demonstrated defect. See [Codex section 4](codex-areas-1-2.md#4-things-done-well) and [Cursor section 4](cursor-areas-3-5.md#4-things-done-well-with-the-probes-that-passed).

- Tenant isolation has independent layers: verified identity selects context, forced RLS constrains rows, and composite references prevent cross-tenant attachment. Cursor confirmed this as `tinnox_app` and through the API: cross-organisation reads, writes, list leaks, and client-supplied `orgId` values were refused.
- Roles and `sec.*` hardening: the three-role split is as designed; `tinnox_app` cannot assume the definer or migrator, cannot disable RLS, and cannot read `pg_authid` or the server filesystem. All 17 `sec.*` functions are `SECURITY DEFINER`, owned by `tinnox_definer`, with `search_path=pg_catalog, pg_temp`. Hostile inputs to those functions did not return another organisation’s membership or claim.
- Credential handling is separated from presentation: session and device identifiers have 256 bits of randomness; database lookups use hashes; cookie flags and configured-origin redirects avoid trusting arbitrary request hosts.
- OIDC uses the maintained protocol implementation, with state, nonce and PKCE on the authorization-code flow. Production still requires configured MFA claims. Cursor drove the callback with an in-process fake provider, not Keycloak: the session cookie rotated, the planted cookie stopped working, and a replay failed.
- Operator routes inherit shared session, exact Origin and CSRF checks. Player routes use explicit bearer credentials rather than ambient operator cookies. Signed media retrieval validates the signature, the active registration, the publication and display relationship, and the tenant-scoped object, and fails closed after revocation.
- Uploads have several containment layers: streaming size enforcement, content sniffing, serialized quota checks, immutable storage keys, and isolated structural inspection. HTML bytes named as a PNG were refused; traversal-like and hostile names were stored as labels, not as paths.
- Publications and audit time have database enforcement. Publication assets cannot be appended after publication creation; audit timestamps are overwritten by the database; `tinnox_app` cannot update or delete `audit_event`.
- Previous fixes remain visible and testable. Cursor reproduced CX-01, CX-02, CX-03, FCX-01 and FCX-06 in the direction of the fixes, and they held. The unit suite passed. The integration suite passed once three environment mismatches (worker image, `dev-` secret prefix, superuser password) were corrected.
- Browser and logging boundaries are deliberate. Production HTML rejects inline scripts, app text uses `textContent`, request logs omit query strings, and the service worker restricts caching to the player shell. Cursor recorded the expected API and preview security headers; HSTS was absent on the local HTTP listener, which matches the configuration.
- Pooling and timeouts: 48 parallel `withOrg` calls alternating organisations did not leak rows. A terminated connection was not reused with leftover tenant context. Statement, lock and idle-in-transaction timeouts fired as configured, subject to SCU-02.

## 6. Documented residuals

These are not new SCX or SCU findings. They should stay visible in deployment and acceptance decisions. See [Codex section 5](codex-areas-1-2.md#5-documented-residuals-confirmed) and [Cursor section 5](cursor-areas-3-5.md#5-documented-residuals-confirmed).

- Application-selected tenancy: `tinnox_app` can select tenant context; RLS does not contain arbitrary malicious application SQL. The API probes took the organisation id from the session row, and a client-supplied `orgId` was rejected by the schema.
- Some `sec.*` lookups run before the organisation is known (`device_by_token_hash`, `device_by_registration_id`, `membership_by_oidc_sub`, and the identifier-only `media_processing_jobs` result). The signed-URL route verifies the HMAC before `device_by_registration_id`.
- Shared quarantine and worker trust: local users can read pending files or forge results under the shipped directory permissions; a compromised shared worker can substitute another tenant’s thumbnail content. SCX-02 is separate destructive behaviour on top of the documented fairness residual.
- Development MFA depends on the provider flow; established CMS sessions are not automatically revoked by provider logout.
- Copyable player credentials and offline content: IndexedDB contains the device credential; an unreachable player cannot be remotely erased.
- Per-process throttles and serial worker contention: distributed sources and tenant fairness remain outside the current controls. Cursor confirmed a 429 on the 31st login in a minute in one process; a second API process was not run.
- Logout’s audit-failure fallback: revocation is attempted outside the failed audited transaction. Actual revocation during a simultaneous database outage is unverified.
- Privileged audit administration: runtime append-only access is enforced by grants. The audit trigger blocks UPDATE, not DELETE or TRUNCATE; owner-level deletion is explicitly reserved. Cursor confirmed that `tinnox_migrator` can delete an audit row and can `SET ROLE tinnox_definer`. This is not owner-proof tamper evidence.
- Production deployment and dependency assurance, including production edge headers, infrastructure controls, current vulnerability evidence, and the already-recorded `uqr` maintenance concern, remain release work. Codex did not run `npm audit`.
- Signed media URLs remain bearer tokens until expiry; revocation stops them. Cursor confirmed a 401 on a previously valid URL after operator revoke.
- There is no antivirus scan. The worker suite accepted JPEG, PNG and H.264 and rejected disguised types, HTML, SVG and unsupported codecs. That is structural inspection.
- Database and object storage remain separate. The upload route still commits the media row before enqueue, which earlier reviews already recorded.
- Local HTTP; HSTS only when cookies are secure. Confirmed on the API and on the preview servers.

**Observations, not findings.** A session-level `set_config('app.org_id', …, false)` survived release back to a `max: 1` pool from `createPool`. Request code uses transaction-local settings, and the 48-way `withOrg` probe did not leak. This becomes a defect if a statement sets `app.org_id` for the session rather than the transaction; no such call exists under `apps/` or `packages/` outside tests and `scripts/seed.ts`. `schema_migrations` has no row-level security; it is not tenant data, and `tinnox_app` cannot read it.

## 7. Runtime evidence and limitations

Codex ran no tests, migrations, services or builds. Existing test results cited in repository documents are historical evidence, not results reproduced in that half. Runtime confirmation of the SCX findings was explicitly delegated to section 6 of the Codex report.

Cursor ran unit tests, integration tests, and custom probes in an isolated environment at the same SHA. Details, commands and outcomes are in [section 6 of the Cursor report](cursor-areas-3-5.md#6-runtime-evidence-appendix).

**Isolated appendix (Cursor).** Ubuntu 24.04.5, Node v22.23.4, PostgreSQL 17.12 from PGDG, host auth `scram-sha-256`. Roles were created by `infra/postgres/init/01-roles.sh` unchanged. Probes used a throwaway `tinnox_review` database, migrated through 0008. Operator sessions in the API probes were created with `sec.session_create`; the sign-in callback used an in-process fake `IdentityProvider`. Docker was installed later in the run and was used to build the media-worker image. Passwords and HMAC keys lived in a mode-600 file outside the repository and in gitignored `.env`; they are not in the report or in the evidence files.

`npm test` (vitest unit) passed: 71 files, 1490 tests. The first integration run had four failures, all from environment mismatches (worker image, `dev-` secret prefix, superuser password). After those were corrected, the failed files passed on rerun, as did the security subset (`migrate`, `credential-audit`, `rls`, and `sec` integration tests). Evidence files under `/opt/cursor/artifacts/` stayed on the reviewer’s disposable VM.

**What this is not.** It is not the Playwright end-to-end suite, and Keycloak was not started. Codex’s SCX-specific reproductions, other than SCU-01, were not executed. A migrator `lock_timeout` wait of 30 seconds was not waited out. A hand-built decompression bomb was not added beyond the worker suite. FCX-03 and FCX-05 were not reproduced in a browser; they remain the open portal findings from round 2, with no new database or cross-organisation angle in this pass.

## 8. What remains unverified

The following items from Codex section 6 remain open follow-ups. Cursor ran in parallel and did not execute this list as a script.

- **SCX-01.** Can an older claimed pairing supersede a replacement, including after explicit revocation? Record registration IDs and statuses, which credential authenticates afterward, and the associated audit actions.
- **SCX-02.** Does `sweep()` delete live jobs outside its batch of 500? Needs more than 500 committed `processing` rows with matching valid job files older than 120 seconds, and a comparison of file presence for jobs 1–500 versus job 501.
- **SCX-03.** Does committed data lose its files after a lost COMMIT acknowledgement? A mock that rejects COMMIT before any commit occurs does not establish this case.
- **SCX-04 part B.** After five incorrect polling credentials, is the pairing locked with no identifying audit event? (Part A was executed as SCU-01.)
- **SCX-05.** With four committed failures, can two concurrent `pairing_claim` transactions both pass the allowance and leave more than five failures?
- **SCX-06.** After rotating only `SESSION_SECRET` and restarting against the existing database, does an established session still authenticate?
- **RLS and migration costs.** `EXPLAIN (ANALYZE, BUFFERS)` under representative multi-tenant volumes, and measured lock wait or rewrite times for migrations 0005 and 0008 on populated data, were not collected.
- **HTTPS, Keycloak and current dependency status.** Cursor did not start Keycloak, so provider state, nonce, PKCE and MFA were not exercised against the real realm, and there are no HTTPS cookie captures. Codex did not run `npm audit` against the pinned lockfile, and no current worker or base-image vulnerability inventory was attached.

Cursor did independently settle several of the general questions in that same list, as recorded in sections 5 and 7: deployed roles and ACLs on the throwaway database, denied `SET ROLE` and audit UPDATE/DELETE as `tinnox_app`, pooling and context leakage, focused RLS behaviour, CSRF and Origin checks, signed-media denial, worker structural inspection, and error responses that did not leak internals. Those results support the corresponding static claims; they do not close the SCX reproductions above.

## 9. Open questions for Michael

These are decisions and later work, not patches.

1. Should a replacement claim and “revoke player” explicitly cancel every older uncollected authorization for that display? SCX-01 assumes that matches the operator-facing security promise.
2. Should `pairing.create` follow the same single-transaction rule as `pairing.complete`, or is an unaudited pending session whose code was never returned an accepted residual? SCU-01 and SCX-04 part A assume the former, because `AGENTS.md` lists pairing among the actions whose audit row shares the change’s transaction. The unaudited poll lockout in SCX-04 part B is a separate, stricter gap.
3. Who owns production session invalidation and the incident runbook, and what verified operation should provide global sign-out? SCX-06 shows that rotating `SESSION_SECRET` does not do what the runbook currently says.
4. What maximum pending-upload backlog, tenant scale and migration downtime must the service support? That bears on SCX-02 (the finding is only reachable with a backlog over 500 processing rows), on the documented serial-worker residual, and on the unmeasured cost of migrations 0005 and 0008.
5. Should `tinnox_app` be unable to `ALTER ROLE` its own configuration parameters? SCU-02 is limited because the role is already the runtime trust boundary. The timeouts only work as a backstop if the role cannot clear them.
6. Should `createPool` reset session state on release (`RESET ALL` or `DISCARD ALL`) so a session-level `app.org_id` cannot outlive a transaction? Current request code does not set one.
7. Who accepts the existing shared-worker, privileged-audit and production-edge residuals before external customer use?
8. The end-to-end job is still a manual CI dispatch. A Node 22 browser run with Keycloak remains outside this appendix.

When prioritising, note that verification agrees with the findings as written, but SCX-02 and SCX-03 depend on uncommon preconditions: a backlog of more than 500 processing rows, and a lost COMMIT acknowledgement after the server has committed. Reviewer severities are recorded unchanged.

## 10. Verification by CMS Dev (17 Nov 2026)

These notes were added after both reviewers finished. The report text in [codex-areas-1-2.md](codex-areas-1-2.md) and [cursor-areas-3-5.md](cursor-areas-3-5.md) was not edited except for the path rewrites and navigation anchors described in those files’ preambles.

**Run confirmation.** The clone at `/workspace/tinnox-cms` was detached at `e905bf71e3e1f6a3d38d14e04d79f729f39c432f` with a clean working tree when the citations below were checked. Codex CLI v0.169.0, model `gpt-6-astra`, reasoning effort `high`, sandbox `read-only`, run on Michael’s second Codex account, finished 17 November 2026, 19:56 Australia/Melbourne. Cursor cloud agent `bc-6b210cc8-bd6e-557f-9d9f-1c4205db60e6`, model Grok 4.7, xhigh effort, 500k context, normal speed, report written 17 November 2026, 12:33 Australia/Melbourne. Neither reviewer created a branch, commit, push, or pull request.

**Citation check.** Every SCX finding was re-read against the code at `e905bf7`. The files exist, the line numbers are in range, and the citations hold:

- **SCX-01.** `sec.pairing_claim` (`db/migrations/0002_security_functions.sql:236-297`) revokes active registrations but does not cancel other `claimed` pairing sessions for the display. `sec.pairing_complete` (`0002_security_functions.sql:300+`) checks only that pairing’s token, status and expiry, then revokes whatever is active and inserts a new registration. `POST` revoke-player (`apps/api/src/routes/displays.ts` around line 548) only touches `player_registration`. Confirmed.
- **SCX-02.** `sec.media_processing_jobs` is limited to 500 (`db/migrations/0003_api_lookups.sql:29-39`). `#pending()` passes 500 (`apps/api/src/media/pipeline.ts` around line 355). `sweep()` (`pipeline.ts:719`) treats that as the full pending set. It is called from `start()` (`pipeline.ts:192`) and from `apps/api/src/housekeeping.ts:37`. Confirmed. The finding is only reachable with a backlog over 500 processing rows.
- **SCX-03.** `packages/db/src/tx.ts` `run()` rethrows after a COMMIT rejection. `apps/api/src/routes/media.ts` around line 342 discards job files in `catch`. `pipeline.ts` around lines 623–670 deletes the stored object and thumbnail when `updated` is false. Confirmed. The finding is only reachable when the COMMIT acknowledgement is lost after the server committed (a rare fault).
- **SCX-04B.** `sec.pairing_poll` locks the session on the Nth wrong token (`0002_security_functions.sql:212-219`) and `apps/api/src/routes/player.ts` around lines 259–275 returns not-found without an audit event. Confirmed.
- **SCX-05.** `pairing_claim` counts failures then inserts without a per-membership lock (`0002_security_functions.sql:265-285`), so concurrent READ COMMITTED transactions can both pass at count 4. Confirmed.
- **SCX-06.** The runbook (`docs/security/operations-and-release-checklist.md:39`) says rotating `SESSION_SECRET` signs everyone out, but `readSession` (`apps/api/src/auth/session.ts:70`) uses an unkeyed SHA-256 of the cookie. Confirmed.
- **SCU-01 and SCU-02** were demonstrated at runtime by Cursor.

**Severity note.** Verification agrees with the findings. SCX-02 and SCX-03 depend on uncommon preconditions (a backlog over 500, and a lost COMMIT acknowledgement), which Michael may weigh when prioritising. Reviewer severities are recorded unchanged.

## 11. Fixes made after this round (17 November 2026)

Sections 1 to 10 are the review record as written and are unchanged. Before fixing, every finding was checked again on `main` at `f138439`, which had moved past the reviewed `e905bf7`. No later commit had touched the cited code, and all eight findings held there. They were fixed on one branch in three commits (pairing, media, then sessions and the pool). Where a fix depended on one of the open questions in section 9, the decision taken is stated in the table below.

| ID | Change | Evidence |
|---|---|---|
| SCX-01 | Migration `0010_pairing_hardening.sql`:<br>• A successful claim cancels every older claim of the same display that no player has collected. Its status becomes `expired`, so that player is told to start again. A lock per display means two claims at the same time cannot miss each other.<br>• Revoking the player first calls the new `sec.pairing_cancel_claims`, which does the same within the operator's own organisation.<br>• Completion never replaces an active registration. A registration that is active when an older pairing completes belongs to a newer claim, so the older pairing is cancelled and answers `not_claimable`. No registration is displaced, so none goes unaudited.<br>• The `pairing.claim` and `player.revoke` audit details list the cancelled pairing ids. The revoke answer (`cancelledPairingCount`) and the portal say how many codes were cancelled.<br><br>**Decision taken (question 1):** a replacement claim and "revoke player" both cancel every older uncollected authorisation for the display. | `packages/db/test/sec.integration.test.ts`:<br>• "a newer claim cancels an older one no player collected…"<br>• "revoking the player cancels claims no player has collected, in its own organisation only"<br>• "completing a pairing never replaces an active registration"<br>• "of two claims for one screen at the same time, the later waits and cancels the earlier"<br><br>`tests/integration/pairing-and-credentials.test.ts` "an older claim no player collected cannot take the screen back after a replacement or a revocation". On the code as reviewed, the late poll was answered `claimed` and handed out a device credential. |
| SCX-02 | The sweep reads the pending list at the lookup's maximum of 5000 rows. It removes a file only when that complete list shows the file has no owner. When the list may be cut off, it removes nothing and logs why, and orphans wait until the backlog drains. The scan keeps its batch of 500. No migration was needed.<br><br>**Question 4** (the backlog the service must support) stays open, but the sweep no longer depends on the answer. | `apps/api/test/upload.integration.test.ts` "never sweeps the files of a pending job, however long the queue is". With 500 older jobs queued, the sweep as reviewed deleted the pending upload's bytes and its job file. |
| SCX-03 | `withOrg`, `withoutOrg` and `withResolvedOrg` throw `CommitOutcomeUnknownError` when COMMIT does not confirm. The exception is a refusal the server raises only while rolling back: a deferred constraint (class 23) or a serialization failure (class 40); that error is passed on unchanged.<br>• The upload route keeps the received bytes. If the row exists, the scan queues them. If it does not, the sweep removes them once the hour-long in-progress mark has expired.<br>• Ingestion keeps the stored copies that a ready row may name.<br><br>At worst an unreferenced object remains, the residual already recorded in control matrix B8. | `packages/db/src/tx.test.ts` "a COMMIT that does not confirm…" (four tests).<br><br>`apps/api/test/upload.integration.test.ts`:<br>• "keeps validated media whose commit went through when the answer to COMMIT was lost"<br>• "keeps the bytes of an upload whose row was committed when the answer to COMMIT was lost"<br><br>Both use a pool that commits for real and then reports a lost connection (`losingCommitAnswers`, the case the review asked for). On the code as reviewed, the ready row's object was deleted and the upload's bytes were discarded. |
| SCX-04, SCU-01 | **Part A:** `POST /player/pairing` writes the session and its `pairing.create` event in one `withoutOrg` transaction.<br><br>**Part B:** `sec.pairing_poll` answers `wrong_token_locked`, once, on the attempt that locks a session. The route then writes a new unscoped `pairing.lock` event in the same transaction: actor `anonymous`, result `denied`, a keyed client fingerprint, and never the code or a token. The player still gets the same 404 for every wrong token.<br><br>**Decision taken (question 2):** pairing creation follows the single-transaction rule. | `tests/integration/credential-audit.test.ts`:<br>• "creates no pairing session when its audit event cannot be written". As reviewed, the session count rose by one.<br>• "records a polling-token lockout once, in the same transaction as the lock". As reviewed, there was no event and the lock committed anyway. |
| SCX-05 | `sec.pairing_claim` takes a lock per membership before it counts the operator's wrong codes. Counting and recording the failure are then a single step, across connections and API processes. The membership lock is always taken before the display lock. | `packages/db/test/sec.integration.test.ts` "checks and uses an operator's wrong-code budget in one step, also across concurrent claims". As reviewed, the second claim did not wait, and it claimed the code past the limit. |
| SCX-06 | The runbook no longer says that rotating `SESSION_SECRET` signs everyone out; rotation only cancels sign-ins in progress. A new runbook row gives the global sign-out: `scripts/revoke-all-sessions.sql`, run by the database administrator. It revokes every live session and keeps the rows as evidence. In the same transaction it writes one `auth.logout` event per organisation, with actor `system` and `reason: global_revocation`.<br><br>A keyed session hash was considered and not chosen, for two reasons. It would reverse the recorded decision for an unkeyed hash (control matrix B2). It would also leave the old rows looking live.<br><br>The runbook's sign-out of one operator was a bare UPDATE with no audit event. It is now `scripts/revoke-subject-sessions.sql`, which writes one `auth.logout` event per membership in the same transaction.<br><br>**Question 3** (who owns production session invalidation) stays open. | `tests/integration/session-revoke-all.test.ts` runs the same files:<br>• An API started with another `SESSION_SECRET` still accepts an existing session.<br>• After the global script, every session is refused, and each organisation's audit trail has the event.<br>• The per-subject script ends only that operator's sessions.<br><br>Both scripts were also run through `psql` on the test database, as the superuser and as `tinnox_migrator`. |
| SCU-02 | `createPool` already sent the statement and idle-in-transaction timeouts as connection startup parameters, which take precedence over role defaults. It now also sends `lock_timeout` and `row_security=on`. PostgreSQL always lets a role change its own defaults, and that cannot be revoked; such a change now reaches only clients that do not set their own values, such as `psql`.<br><br>**Question 5:** the change cannot be prevented, only made irrelevant to the API. | `packages/db/test/rls.integration.test.ts` "keeps its timeouts and row security on new connections when it changes its own defaults". A plain connection gets `lock_timeout` 0 and `row_security` off; the pool's connection gets 5 s and on. As reviewed, the pool's connection got 0 and off. |

**Independent review of the fixes.** Four reviewers each read the diff through one lens: the SQL, the API and contracts, media and transactions, and the tests and docs. A separate skeptic then tried to refute each finding. Four findings held, and all four were fixed:
- The player protocol page had not been updated: `expired` and `consumed` also cover a cancelled claim.
- Logs lost the reason behind `CommitOutcomeUnknownError`. The error serializer now logs the cause's name, message and code, never database detail. `apps/api/src/logger.test.ts` checks this.
- One test looked its upload up by SHA-256, which could match an earlier upload in about 1 run in 19.
- The per-subject sign-out wrote no audit event (see SCX-06 above).

One finding was refuted: claims left outstanding from before migration 0010. They expire within 10 minutes, and completion still refuses them while the display has a player.

**Proof on the code as reviewed.** Every new test was run with the product code taken from `f138439`, migration 0010 removed, and the tests from the branch. Each failed for the reason in its finding: 17 integration and 4 unit failures in all. These include three existing tests updated for the new function count, the new poll outcome and the new revoke answer, plus one existing test that failed only because the new test before it left files behind. All pass on the branch.

**Severity.** Reviewer severities above are recorded unchanged. On re-checking, we would rate:
- SCX-01 to SCX-04: Medium.
- SCX-05 and SCX-06: Low.
- SCU-02: an Observation. For the API, two of the three timeouts were already pinned per connection.

**Deploy order.** Run migration 0010 before starting the new API.
- The new API against a database without 0010 fails on claim and revoke.
- An older API against the new database answers 500 instead of 404 on the poll that locks a session (the lock still commits).

**Not changed.**
- Question 6 (`DISCARD ALL` on release): no code sets a session-level `app.org_id`.
- Questions 7 and 8 (residual acceptance, the CI browser job).
- Two observations found while checking for findings of the same shape:
  - The in-memory `AuthFailureGuard` checks its budget before the database lookup, so a burst of concurrent invalid device tokens from one address can exceed 30. This is per process, the documented residual of B6.
  - The `auth.login` event does not name the session that sign-in rotated out.
