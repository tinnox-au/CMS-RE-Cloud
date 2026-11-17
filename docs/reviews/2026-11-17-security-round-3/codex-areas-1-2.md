# Codex report — areas 1 and 2

Date: 17 November 2026, Australia/Melbourne (UTC+11).

| Item | Value |
|---|---|
| Reviewer | Codex CLI v0.169.0, model `gpt-6-astra`, reasoning effort high, sandbox read-only |
| Baseline | `e905bf71e3e1f6a3d38d14e04d79f729f39c432f` (`e905bf7`, tip of `main` when the review started; merge of PR #12) |
| Date of report | 17 November 2026, 19:56 (Australia/Melbourne) |
| Method | Read-only static review of areas 1 and 2. No tests run (dependencies were not installed). No files written, no GitHub access. Run on Michael’s second Codex account. |
| Path edits | Citations of the form `path:line` have been rewritten as repo-relative `../../../path#Lline` links, relative to `docs/reviews/2026-11-17-security-round-3/`. Finding anchors (`scx-01` and so on) were added for navigation. The report text is otherwise unchanged. |
| This file | The report text below is from the reviewer’s final message. |
| Consolidated summary | [README.md](README.md) |

---

# Round 3 — Database and Security Review

## 1. Baseline, scope and method

**Reviewed commit:** `e905bf71e3e1f6a3d38d14e04d79f729f39c432f` (`e905bf7`).

This report covers **areas 1–2: static database, transaction, API, player and media-worker security review**. All source citations refer to that immutable commit, read through Git rather than the moving branch.

Applied the binding AGENTS.md rules and the Postgres skill, including its RLS, privileges, connection, locking and foreign-key-index references. Read the specified architecture, decisions, security and player-protocol documents, plus both earlier review rounds and their fix records.

Reviewed migrations 0001–0008, role initialization, database helpers, runtime database call sites, authentication and authorization boundaries, media handling, browser security configuration, dependency manifests and relevant test source.

**No runtime tests, migrations, services, builds or dependency installations were executed.** Existing test results cited in repository documents are historical evidence, not results reproduced here. Runtime confirmation is explicitly delegated in section 6.

No files were changed. The workspace remained clean.

## 2. Assessment of areas 1–2

**Six prioritized findings:** four High and two Medium. No new Critical finding was established. The main weaknesses are pairing authorization surviving later operator decisions, destructive media cleanup, and incomplete pairing audit coverage.

### Database authority and migrations

The schema has **22 application tables: 18 tenant tables and four pre-tenant authentication/pairing tables**. All have ENABLE and FORCE RLS in the migration definitions. Tenant policies use `app_org_id()` with both `USING` and `WITH CHECK`; their default `ALL` command scope covers reads and writes. The four pre-tenant tables deliberately have no tenant policy and no direct runtime grants. `schema_migrations` is migration metadata, separately inaccessible to the runtime role.

Evidence: [`migrations/0001_schema.sql:423`](../../../db/migrations/0001_schema.sql#L423), [`migrations/0001_schema.sql:443`](../../../db/migrations/0001_schema.sql#L443), [`migrations/0005_portal_v2_stage_a.sql:154`](../../../db/migrations/0005_portal_v2_stage_a.sql#L154), [`migrations/0007_stage_b_apps.sql:66`](../../../db/migrations/0007_stage_b_apps.sql#L66).

| Migration | Static assessment |
|---|---|
| 0001 | Establishes forced RLS, tenant-qualified foreign keys and role grants. Runtime audit access is INSERT/SELECT only. Audit deletion protection relies on privileges; its trigger blocks UPDATE only. |
| 0002 | Defines the initial credential and pairing functions. Function hardening is present; pairing lifecycle and concurrency findings remain below. |
| 0003 | Adds documented, narrow registration and processing-job lookups. The processing-job limit becomes unsafe when reused for orphan detection. |
| 0004 | Protects publication-asset insertion, stamps audit time and adds bounded housekeeping functions. |
| 0005 | Adds forced RLS and composite references for folders/tags. Temporarily lifting FORCE for the owner’s backfill is restored within the migration transaction. Audit category addition rewrites the table. |
| 0006 | Adds Stage B fields, constraints and limited display-column grants. Existing tenant policies continue covering the new columns. |
| 0007 | Adds the app table with forced RLS and constrained update grants; playlist references include the organisation. |
| 0008 | Correctly closes the documented SQL-NULL completeness gaps using `IS TRUE` and explicit non-null bytes. |

There are no skipped or duplicate numbers in this bundle and no incompatible nontransactional statements. The runner checks recorded history before applying pending migrations, verifies `current_user`, and commits each migration with its history row. Evidence: [`migrate.ts:32`](../../../packages/db/src/migrate.ts#L32), [`migrate.ts:51`](../../../packages/db/src/migrate.ts#L51), [`migrate.ts:69`](../../../packages/db/src/migrate.ts#L69), [`migrate.ts:95`](../../../packages/db/src/migrate.ts#L95).

Migrations 0005–0008 have blocking schema/validation work. In particular, 0005 documents an audit-table rewrite and ACCESS EXCLUSIVE locks; 0008 validates all publication and media rows under ACCESS EXCLUSIVE locks. These are **documented operational constraints**, not newly discovered defects. Actual duration remains **unverified pending runtime**. Evidence: [`migrations/0005_portal_v2_stage_a.sql:15`](../../../db/migrations/0005_portal_v2_stage_a.sql#L15), [`migrations/0008_null_safe_checks.sql:15`](../../../db/migrations/0008_null_safe_checks.sql#L15).

### Roles, functions and tenant context

The role definitions preserve the intended separation: non-owner runtime role, schema-owning migrator, and non-login definer with BYPASSRLS. Runtime membership does not permit switching to the definer. Evidence: [`01-roles.sh:25`](../../../infra/postgres/init/01-roles.sh#L25), [`01-roles.sh:31`](../../../infra/postgres/init/01-roles.sh#L31).

All **17 final `sec.*` functions** pin `search_path`, use qualified application objects, and revoke PUBLIC execution while granting application execution. Existing functions created under the definer explicitly revoke PUBLIC privileges within the same migration. No request-controlled dynamic SQL was found inside them. Evidence: [`migrations/0002_security_functions.sql:381`](../../../db/migrations/0002_security_functions.sql#L381), [`migrations/0003_api_lookups.sql:17`](../../../db/migrations/0003_api_lookups.sql#L17), [`migrations/0004_review_hardening.sql:63`](../../../db/migrations/0004_review_hardening.sql#L63).

These functions intentionally trust proofs supplied by the API: verified OIDC subject, credential hash, or an already-verified media signature. They do not contain a compromised application role. The cross-organisation processing-job lookup and heartbeat purge are documented housekeeping exceptions with restricted outputs or age bounds. Evidence: [`migrations/0003_api_lookups.sql:9`](../../../db/migrations/0003_api_lookups.sql#L9), [`migrations/0004_review_hardening.sql:66`](../../../db/migrations/0004_review_hardening.sql#L66).

`app_org_id()` returns NULL for absent/empty context; malformed UUID text raises an error rather than selecting another tenant. Transaction helpers validate UUIDs and use transaction-local settings. Evidence: [`migrations/0001_schema.sql:23`](../../../db/migrations/0001_schema.sql#L23), [`src/tx.ts:73`](../../../packages/db/src/tx.ts#L73), [`src/tx.ts:110`](../../../packages/db/src/tx.ts#L110).

Across API and media-pipeline call sites, tenant SQL uses `withOrg`, `withOrgDecision` or `withResolvedOrg`. No request-supplied organisation identifier was found controlling tenant context. The worker itself has no database connection; the API resolves processing-job organisations through `sec.media_processing_jobs`. The unscoped readiness query is only `SELECT 1`. Evidence: [`media/pipeline.ts:349`](../../../apps/api/src/media/pipeline.ts#L349), [`media/pipeline.ts:553`](../../../apps/api/src/media/pipeline.ts#L553), [`ops.ts:29`](../../../apps/api/src/routes/ops.ts#L29), [`docker-compose.yml:97`](../../../infra/docker-compose.yml#L97).

### Transaction and audit integrity

The CX-01 credential-transition fixes remain present: sign-in and pairing completion use `withResolvedOrg`; normal logout does too. Rollback-failure disposal and checked-out connection error handling remain present. SCX-03 concerns callers treating an uncertain commit as a rollback, not removal of those fixes. Evidence: [`routes/auth.ts:186`](../../../apps/api/src/routes/auth.ts#L186), [`routes/player.ts:284`](../../../apps/api/src/routes/player.ts#L284), [`src/tx.ts:28`](../../../packages/db/src/tx.ts#L28).

The audit exceptions found are:

| Action | Assessment |
|---|---|
| Pairing creation | Mutation and audit use separate autocommit statements: SCX-04. |
| Pairing polling lockout | Security state changes without an audit event: SCX-04. |
| Replacement during delayed pairing completion | The displaced registration is not identified by a corresponding revocation event: SCX-01. |
| Logout after transactional audit failure | Deliberate, previously documented fallback; not re-reported as CX-01. |

Other reviewed operator mutations, uploads, validation outcomes, publication creation, explicit revocation and player reset write their audit events on the mutation’s transaction. Representative evidence: [`routes/media.ts:290`](../../../apps/api/src/routes/media.ts#L290), [`media/pipeline.ts:625`](../../../apps/api/src/media/pipeline.ts#L625), [`publishing.ts:535`](../../../apps/api/src/publishing.ts#L535), [`routes/displays.ts:541`](../../../apps/api/src/routes/displays.ts#L541), [`routes/player.ts:342`](../../../apps/api/src/routes/player.ts#L342).

No runtime audit UPDATE/DELETE was found. The insert trigger assigns database time, and audit helpers do not accept `occurred_at`. Evidence: [`migrations/0004_review_hardening.sql:43`](../../../db/migrations/0004_review_hardening.sql#L43), [`sec.ts:392`](../../../packages/db/src/sec.ts#L392).

### Security boundaries, dependencies and performance

Stage B operator routes inherit the shared session, exact Origin and CSRF checks. Player routes use explicit bearer credentials rather than ambient operator cookies. Signed media retrieval validates the signature, active registration, publication/display relationship and tenant-scoped object. Evidence: [`app.ts:99`](../../../apps/api/src/app.ts#L99), [`auth/session.ts:110`](../../../apps/api/src/auth/session.ts#L110), [`routes/player.ts:102`](../../../apps/api/src/routes/player.ts#L102), [`routes/player.ts:480`](../../../apps/api/src/routes/player.ts#L480).

External dependency versions are exact in the manifests, and external lockfile records carry registry locations and integrity hashes. This establishes reproducibility, not absence of vulnerabilities. **npm audit was not run** in this read-only, network-restricted static review. Current advisory and image-vulnerability status is **unverified pending runtime**; the historical development-tool advisories and `uqr` maintenance concern remain documented residuals.

RLS performance is also **unverified pending runtime**. Several tables lack an organisation-leading index, including membership, site, playlist items, publication assets, delivery state, heartbeat history and tag joins. Many actual queries instead constrain an indexed parent identifier, so missing `org_id` indexes alone do not demonstrate a defect. Policies directly call the stable helper; per-row evaluation cost was not measured. Evidence: [`migrations/0001_schema.sql:54`](../../../db/migrations/0001_schema.sql#L54), [`migrations/0001_schema.sql:248`](../../../db/migrations/0001_schema.sql#L248), [`migrations/0001_schema.sql:298`](../../../db/migrations/0001_schema.sql#L298), [`migrations/0001_schema.sql:350`](../../../db/migrations/0001_schema.sql#L350), [`migrations/0005_portal_v2_stage_a.sql:116`](../../../db/migrations/0005_portal_v2_stage_a.sql#L116).

## 3. Prioritized findings

<a id="scx-01"></a>
### SCX-01 — High — An older claimed pairing survives replacement or revocation

**Classification:** New finding.  
**Confidence:** High from code trace; reproduction **unverified pending runtime**.

**Trigger:** For one display:

1. Create pairing P1 and claim it through `POST /api/displays/:id/claim`, but do not collect its credential.
2. Claim P2 for that display and complete P2 through `GET /player/pairing/:id`.
3. Optionally revoke P2 through `POST /api/displays/:id/revoke-player`.
4. Before P1 expires, poll P1 with its valid polling credential.

**Evidence:** Claiming a new pairing revokes current registrations but does not invalidate older claimed pairings. Completion checks only the selected pairing’s token, claimed status and expiry. It then revokes whichever registration is currently active and inserts another one. Explicit operator revocation likewise affects registrations, not outstanding claimed pairings.

Citations: [`migrations/0002_security_functions.sql:273`](../../../db/migrations/0002_security_functions.sql#L273), [`migrations/0002_security_functions.sql:287`](../../../db/migrations/0002_security_functions.sql#L287), [`migrations/0002_security_functions.sql:309`](../../../db/migrations/0002_security_functions.sql#L309), [`migrations/0002_security_functions.sql:318`](../../../db/migrations/0002_security_functions.sql#L318), [`routes/displays.ts:548`](../../../apps/api/src/routes/displays.ts#L548).

**Consequence and scope:** A previously authorized pairing holder can regain access to that display after a later replacement or revocation decision, and can invalidate the replacement player. This requires an earlier valid operator claim and an unexpired pairing; it is not general cross-organisation access.

Completion also records only the new registration’s `pairing.complete` event, leaving the displaced registration unidentified by a corresponding `player.revoke` event. Evidence: [`routes/player.ts:308`](../../../apps/api/src/routes/player.ts#L308).

**Required property:** Replacement and revocation must establish an authorization boundary that older outstanding claims cannot cross. Any registration displaced during completion must be attributable in the same transaction’s audit record.

<a id="scx-02"></a>
### SCX-02 — High — Orphan cleanup deletes valid jobs beyond the first 500

**Classification:** New finding, distinct from the documented worker-fairness residual.  
**Confidence:** High from deterministic code trace; reproduction **unverified pending runtime**.

**Trigger:** Have more than 500 committed `processing` media rows with valid quarantine files. Let files belonging to a job outside the oldest 500 become more than two minutes old, then restart the API or run scheduled cleanup.

**Evidence:** `#pending()` requests only 500 jobs, ordered oldest first. `sweep()` treats that bounded result as the complete set of pending identifiers and deletes older files absent from it. Startup runs the sweep before processing resumes. Successfully enqueued jobs have already left the in-memory upload set.

Citations: [`migrations/0003_api_lookups.sql:34`](../../../db/migrations/0003_api_lookups.sql#L34), [`media/pipeline.ts:349`](../../../apps/api/src/media/pipeline.ts#L349), [`media/pipeline.ts:719`](../../../apps/api/src/media/pipeline.ts#L719), [`media/pipeline.ts:189`](../../../apps/api/src/media/pipeline.ts#L189), [`media/pipeline.ts:315`](../../../apps/api/src/media/pipeline.ts#L315).

**Consequence and scope:** Accepted uploads can lose their source files, specifications and results despite retaining valid pending database rows. When subsequently scanned, a missing source becomes “uploaded bytes were lost.” The queue is global, so a backlog can affect another organisation’s uploads. Evidence: [`media/pipeline.ts:378`](../../../apps/api/src/media/pipeline.ts#L378).

The documented serial-worker contention and crash-orphan risks do not describe deletion of files belonging to live pending jobs. See [`control-matrix.md:28`](../../../docs/security/control-matrix.md#L28).

**Required property:** Destructive orphan detection must establish that a file has no live database owner across the entire pending set, independently of processing-batch limits.

<a id="scx-03"></a>
### SCX-03 — High — An uncertain COMMIT outcome can cause deletion of committed media

**Classification:** New finding.  
**Confidence:** High in the conditional code path; fault reproduction **unverified pending runtime**.

**Trigger:** During successful upload insertion or validated-media ingestion, PostgreSQL commits the transaction, but the API loses the connection before receiving the successful COMMIT response. The API process and filesystem remain available.

**Evidence:** The transaction helper rejects when COMMIT rejects. Its subsequent rollback attempt cannot establish that the earlier commit did not happen.

- The upload route catches that rejection and discards the received job files.
- Ingestion assigns `updated` only after `withOrg` resolves. A rejected COMMIT leaves it false, causing deletion of the original object and thumbnail even if the ready row and validation audit committed.

Citations: [`src/tx.ts:40`](../../../packages/db/src/tx.ts#L40), [`src/tx.ts:43`](../../../packages/db/src/tx.ts#L43), [`routes/media.ts:342`](../../../apps/api/src/routes/media.ts#L342), [`media/pipeline.ts:623`](../../../apps/api/src/media/pipeline.ts#L623), [`media/pipeline.ts:665`](../../../apps/api/src/media/pipeline.ts#L665).

**Consequence and scope:** A committed processing row can lose its input, or a committed ready row can reference missing private media. In the latter case, subsequent pending-job scans will not repair it because the row is already ready. Later orphan cleanup can also remove remaining quarantine copies.

This differs from the documented crash leaving an unreferenced storage object: here a referenced object is actively deleted.

**Required property:** Filesystem compensation must distinguish a confirmed rollback from an unknown commit outcome. A lost database acknowledgment must not authorize deletion of potentially committed data.

The Round 1 broken-connection disposal fix remains intact; it does not resolve this caller-level durability problem.

<a id="scx-04"></a>
### SCX-04 — High — Pre-organisation pairing mutations lack required audit coverage

**Classification:** New finding; related to CX-01’s failure mode, outside its three named fixed transitions.  
**Confidence:** High from code trace; reproduction **unverified pending runtime**.

**Trigger A:** Submit `POST /player/pairing` while the pairing insert succeeds but the following `pairing.create` audit insert fails.

**Evidence:** Both calls use `poolAsTx`, whose statements commit independently. The pairing creation commits before the audit begins. Citations: [`routes/player.ts:100`](../../../apps/api/src/routes/player.ts#L100), [`routes/player.ts:202`](../../../apps/api/src/routes/player.ts#L202), [`routes/player.ts:221`](../../../apps/api/src/routes/player.ts#L221), [`src/tx.ts:127`](../../../packages/db/src/tx.ts#L127).

**Consequence A:** The request fails, but a pairing row remains and consumes the client’s creation allowance without its audit event. No device credential is issued by this failure.

**Trigger B:** Send five syntactically valid but incorrect polling credentials to a known pending or claimed pairing identifier.

**Evidence:** `sec.pairing_poll` increments failures and permanently changes the pairing to locked. The route returns a generic refusal without writing an audit event. Citations: [`migrations/0002_security_functions.sql:212`](../../../db/migrations/0002_security_functions.sql#L212), [`routes/player.ts:259`](../../../apps/api/src/routes/player.ts#L259).

**Consequence B:** A security lockout changes persistent state without an attributable audit record. This also limits the runbook’s stated use of audit records to detect pairing lockouts: [`operations-and-release-checklist.md:25`](../../../docs/security/operations-and-release-checklist.md#L25).

**Required property:** Pairing creation and security lockout transitions must commit with their corresponding audit records on the same transaction. Audit records must identify the action and object without containing the code or polling credential.

The corrected sign-in, pairing-completion and normal logout transactions are not being re-reported as broken.

<a id="scx-05"></a>
### SCX-05 — Medium — Concurrent claims exceed the per-operator wrong-code allowance

**Classification:** New finding.  
**Confidence:** High from transaction ordering; reproduction **unverified pending runtime**.

**Trigger:** An operator has four committed wrong-code attempts inside the ten-minute window. Two transactions then submit different invalid codes for a valid display, with the first transaction still uncommitted when the second checks the allowance.

**Evidence:** `pairing_claim` counts prior failures, compares the count with the limit, and later inserts a failure. It does not serialize this sequence by membership. Both transactions can observe four failures, attempt another claim and insert another failure. The API route adds no surrounding membership lock.

Citations: [`migrations/0002_security_functions.sql:265`](../../../db/migrations/0002_security_functions.sql#L265), [`migrations/0002_security_functions.sql:281`](../../../db/migrations/0002_security_functions.sql#L281), [`routes/displays.ts:472`](../../../apps/api/src/routes/displays.ts#L472).

**Consequence and scope:** The documented five-attempt budget can be exceeded by concurrent requests. A request already past the count check can also succeed after another request exhausts the budget. The consequence is bounded by concurrency and other rate limits; this does not make the random pairing code trivially guessable or bypass operator authentication.

The existing concurrent-claim protection handles multiple claims of the **same code**, which is a different invariant.

**Required property:** Checking and consuming a membership’s attempt budget must remain atomic across concurrent requests and API processes.

<a id="scx-06"></a>
### SCX-06 — Medium — Session-secret rotation does not perform the runbook’s promised sign-out

**Classification:** New finding.  
**Confidence:** High from complete usage trace; restart demonstration **unverified pending runtime**.

**Trigger:** Retain an active operator session, change only `SESSION_SECRET`, and restart the API against the existing database.

**Evidence:** The containment runbook says rotating the session secret signs everyone out. Existing session authentication instead hashes the cookie with unkeyed SHA-256 and looks up the database row. `sessionSecret` is used for login-state HMAC binding, not validation of established sessions.

Citations: [`operations-and-release-checklist.md:39`](../../../docs/security/operations-and-release-checklist.md#L39), [`auth/session.ts:70`](../../../apps/api/src/auth/session.ts#L70), [`routes/auth.ts:46`](../../../apps/api/src/routes/auth.ts#L46), [`migrations/0002_security_functions.sql:95`](../../../db/migrations/0002_security_functions.sql#L95).

**Consequence and scope:** Existing sessions remain usable until normal expiry or explicit revocation. An incident responder relying on this instruction may incorrectly conclude that potentially compromised sessions have been invalidated. Exposure of this secret alone does not allow forging a random session identifier.

**Required property:** The containment procedure must accurately identify an operation that invalidates established sessions, and its claimed effect must be verifiable.

## 4. Things done well

- **Tenant isolation has independent layers.** Verified identity selects context; forced RLS constrains rows; composite references prevent cross-tenant attachment. Delivery publication references additionally include the display. Evidence: [`src/tx.ts:79`](../../../packages/db/src/tx.ts#L79), [`migrations/0001_schema.sql:339`](../../../db/migrations/0001_schema.sql#L339).
- **Credential handling is appropriately separated.** Session and device identifiers have 256 bits of randomness; database lookups use hashes. Cookie flags and configured-origin redirects avoid trusting arbitrary request hosts. Evidence: [`security.ts:8`](../../../apps/api/src/security.ts#L8), [`auth/session.ts:47`](../../../apps/api/src/auth/session.ts#L47), [`auth/oidc.ts:128`](../../../apps/api/src/auth/oidc.ts#L128).
- **OIDC uses the maintained protocol implementation.** State, nonce and PKCE verification are supplied to the authorization-code flow; production requires configured MFA claims. Evidence: [`auth/oidc.ts:107`](../../../apps/api/src/auth/oidc.ts#L107), [`auth/oidc.ts:132`](../../../apps/api/src/auth/oidc.ts#L132), [`control-matrix.md:21`](../../../docs/security/control-matrix.md#L21).
- **Uploads have several containment layers.** Streaming size enforcement, content sniffing, serialized quota checks, immutable storage keys, and isolated structural inspection reduce the attack surface. Worker subprocesses use argument arrays and bounded output/time. Evidence: [`routes/media.ts:290`](../../../apps/api/src/routes/media.ts#L290), [`sniff.ts:13`](../../../apps/api/src/media/sniff.ts#L13), [`inspect.ts:132`](../../../apps/media-worker/src/inspect.ts#L132), [`docker-compose.yml:82`](../../../infra/docker-compose.yml#L82).
- **Publications and audit time have database enforcement.** Publication assets cannot be appended after publication creation; audit timestamps are overwritten by the database. Evidence: [`migrations/0004_review_hardening.sql:23`](../../../db/migrations/0004_review_hardening.sql#L23), [`migrations/0004_review_hardening.sql:43`](../../../db/migrations/0004_review_hardening.sql#L43).
- **Previous fixes remain visible and testable.** CX-02/03, connection-loss handling, and FCX-01/06 have corresponding implementation and focused test source. Populated upgrades explicitly cover 0006–0008. Evidence: [`migration-0005.integration.test.ts:544`](../../../packages/db/test/migration-0005.integration.test.ts#L544), [`tx.test.ts:53`](../../../packages/db/src/tx.test.ts#L53), [`platform/api.ts:102`](../../../apps/player-web/src/platform/api.ts#L102), [`retry-after.ts:13`](../../../apps/player-web/src/core/retry-after.ts#L13).
- **Browser and logging boundaries are deliberate.** Production HTML rejects inline scripts, app text uses `textContent`, and request logs omit query strings. The service worker restricts caching to the player shell. Evidence: [`shell-plugin.mjs:54`](../../../apps/player-web/build/shell-plugin.mjs#L54), [`render.ts:73`](../../../packages/app-render/src/render.ts#L73), [`logger.ts:35`](../../../apps/api/src/logger.ts#L35), [`sw.ts:115`](../../../apps/player-web/sw/sw.ts#L115).

## 5. Documented residuals confirmed

These are not new SCX findings.

| Classification | Residual and pinned evidence |
|---|---|
| **Documented residual** | **Application-role trust:** `tinnox_app` can select tenant context; RLS does not contain arbitrary malicious application SQL. Doc: [`control-matrix.md:24`](../../../docs/security/control-matrix.md#L24). Code: [`src/tx.ts:79`](../../../packages/db/src/tx.ts#L79). |
| **Documented residual** | **Shared quarantine and worker trust:** local users can read pending files or forge results under the shipped directory permissions; a compromised shared worker can substitute another tenant’s thumbnail content. Doc: [`control-matrix.md:28`](../../../docs/security/control-matrix.md#L28). Code: [`media/pipeline.ts:180`](../../../apps/api/src/media/pipeline.ts#L180), [`media/pipeline.ts:609`](../../../apps/api/src/media/pipeline.ts#L609). |
| **Documented residual** | **Development MFA and missing back-channel logout:** development MFA depends on the provider flow; established CMS sessions are not automatically revoked by provider logout. Doc: [`control-matrix.md:21`](../../../docs/security/control-matrix.md#L21), [`control-matrix.md:22`](../../../docs/security/control-matrix.md#L22). Code: [`auth/oidc.ts:62`](../../../apps/api/src/auth/oidc.ts#L62), [`auth/session.ts:70`](../../../apps/api/src/auth/session.ts#L70). |
| **Documented residual** | **Copyable player credentials and offline content:** IndexedDB contains the device credential; an unreachable player cannot be remotely erased. Doc: [`control-matrix.md:26`](../../../docs/security/control-matrix.md#L26), [`player-protocol-v1.md:93`](../../../docs/player-protocol-v1.md#L93). Code: [`idb-store.ts:121`](../../../apps/player-web/src/platform/idb-store.ts#L121), [`app.ts:581`](../../../apps/player-web/src/app.ts#L581). |
| **Documented residual** | **Per-process throttles and serial worker contention:** distributed sources and tenant fairness remain outside the current controls. Doc: [`control-matrix.md:26`](../../../docs/security/control-matrix.md#L26), [`threat-model.md:133`](../../../docs/security/threat-model.md#L133). Code: [`routes/player.ts:126`](../../../apps/api/src/routes/player.ts#L126), [`media/pipeline.ts:396`](../../../apps/api/src/media/pipeline.ts#L396). SCX-02 is separate destructive behavior. |
| **Documented residual** | **Logout’s audit-failure fallback:** revocation is attempted outside the failed audited transaction. Doc: [`2026-11-16-backend-round-1/README.md:132`](../../../docs/reviews/2026-11-16-backend-round-1/README.md#L132). Code: [`routes/auth.ts:279`](../../../apps/api/src/routes/auth.ts#L279). Actual revocation during a simultaneous database outage is unverified; the log’s unconditional success wording is not proof. |
| **By design / documented residual** | **Privileged audit administration:** runtime append-only access is enforced by grants. The audit trigger blocks UPDATE, not DELETE/TRUNCATE; owner-level deletion is explicitly reserved in the schema comment. Doc: [`control-matrix.md:31`](../../../docs/security/control-matrix.md#L31). Code: [`migrations/0001_schema.sql:384`](../../../db/migrations/0001_schema.sql#L384), [`migrations/0001_schema.sql:490`](../../../db/migrations/0001_schema.sql#L490). This is not owner-proof tamper evidence. |
| **Documented residual** | **Production deployment and dependency assurance:** production edge headers, infrastructure controls and current vulnerability evidence remain release work. The `uqr` maintenance concern is already recorded. Doc: [`operations-and-release-checklist.md:290`](../../../docs/security/operations-and-release-checklist.md#L290), [`threat-model.md:145`](../../../docs/security/threat-model.md#L145). Code: [`shell-plugin.mjs:60`](../../../apps/player-web/build/shell-plugin.mjs#L60), [`app-render/package.json:1`](../../../packages/app-render/package.json#L1). |

## 6. Questions for the runtime reviewer

All items below are **unverified pending runtime**. Use isolated test data and retain identifiers, status codes and assertions without credential, cookie or signed-URL values.

| Question | Exact evidence that would settle it |
|---|---|
| **SCX-01: Can an older claimed pairing supersede a replacement?** | Execute P1-claim → P2-claim → P2-complete → P1-complete before expiry. Repeat with explicit revocation before P1 completes. Record registration IDs/statuses, which credential authenticates afterward, and the associated audit actions/object IDs. |
| **SCX-02: Does sweep delete live jobs outside its batch?** | Prepare 501 ordered processing rows with matching valid job files older than 120 seconds, no in-flight upload entries, and no worker consuming them. Run startup cleanup or `sweep()`. Compare file presence for jobs 1–500 versus job 501 and show that job 501’s database row remained processing when its files disappeared. |
| **SCX-03: Does committed data lose its files after an acknowledgment failure?** | Let PostgreSQL durably commit upload insertion or ingestion, then suppress the COMMIT response and disconnect the API connection. Confirm the committed row from a separate connection and inspect file existence after the API error path. A mock that rejects COMMIT before any commit occurs does not establish this case. |
| **SCX-04: Are pairing changes left unaudited?** | Reject only `pairing.create` audit insertion, issue one create request and compare pairing/audit counts. Separately send five incorrect polling credentials and show the locked row plus the absence or presence of an identifying audit event. |
| **SCX-05: Can two transactions exceed five failures?** | Begin with four committed failures. In connection A, call `pairing_claim` with an invalid code and leave the transaction open. In connection B, do the same, then commit both. Record both outcomes and the final failure count. Follow with concurrent HTTP requests to establish route-level reachability. |
| **SCX-06: Does session-secret rotation invalidate existing sessions?** | Authenticate, retain the session privately, rotate only `SESSION_SECRET`, restart without changing database rows, and request an authenticated operator resource. Record status and session-row state only. |
| **Do deployed roles and ACLs match the migrations?** | Capture sanitized `current_user`, role flags/memberships, table ownership/RLS flags, policies, column/table/sequence ACLs and function owner/configuration/ACLs. Verify all 22 application tables and 17 functions. Exercise denied SET ROLE, DDL, direct auth-table access and audit UPDATE/DELETE/TRUNCATE as `tinnox_app`. The API’s startup URL-username check alone does not prove the effective database role: [`pool.ts:43`](../../../packages/db/src/pool.ts#L43). |
| **Do pooling, RLS and migration guarantees hold at this SHA?** | Record focused pinned-SHA results for context absence/empty/malformed values, cross-tenant CRUD/FKs, connection termination/reuse, audit-failure rollback, and populated upgrades through 0008. Include rejection of changed/missing/out-of-order history before applying pending migrations. |
| **What are the actual RLS and migration costs?** | Obtain `EXPLAIN (ANALYZE, BUFFERS)` as `tinnox_app` under one tenant using representative multi-tenant volumes for list/count, tag-join, delivery and heartbeat queries. Record migration lock wait/hold times and rewrite/validation duration on populated data. Parent-key indexes may make some missing organisation-leading indexes harmless. |
| **Do browser, provider, worker and logging controls survive failure cases?** | Supply actual HTTPS cookie/header captures, negative Origin/CSRF results including Stage B, provider state/nonce/PKCE/MFA results, revoked-token and signed-media denial results, worker resource/network restrictions, and logs checked for leakage during provider/database/media errors. Report pass/fail without reproducing sensitive values. |
| **What is the dependency status of the pinned build?** | Attach audit output against the pinned lockfile and vulnerability results for the actual worker/base-image/native-library inventory, separating runtime from development findings. Historical audit counts cannot settle current status. |

## 7. Open questions for Michael

1. Should a replacement claim and “revoke player” explicitly cancel every older uncollected authorization for that display? SCX-01 assumes that matches the operator-facing security promise.
2. Who owns production session invalidation and the incident runbook, and what verified operation should provide global sign-out?
3. What maximum pending-upload backlog, tenant scale and migration downtime must the service support?
4. Who accepts the existing shared-worker, privileged-audit and production-edge residuals before external customer use?
