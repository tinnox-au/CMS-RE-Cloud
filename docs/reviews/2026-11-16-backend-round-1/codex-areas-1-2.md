# Codex report — areas 1 and 2

Date: 16 November 2026, Australia/Melbourne (UTC+11).

| Item | Value |
|---|---|
| Reviewer | Codex CLI v0.169.0, model `gpt-6-astra`, reasoning effort medium, sandbox read-only |
| Baseline | `cfa9926423e63393ab50afd6625a08beb69393f5` (`main`) |
| Date of report | 16 November 2026, 20:09 (Australia/Melbourne) |
| Method | Read-only static review of areas 1 and 2. No tests run, no files written, no GitHub access. |
| This file | The report text below is verbatim from the reviewer’s final message. The closing “Coordinator verification notes” were added afterwards and do not change the report above them. |
| Consolidated summary | [README.md](README.md) |

---

## 1. Baseline, scope and methods

Initial verification:

```text
git rev-parse HEAD
cfa9926423e63393ab50afd6625a08beb69393f5

git status --porcelain
<no output>
```

HEAD matched the pinned SHA and the working tree was clean. The same checks remained unchanged at the end.

This review covers **areas 1 and 2 only**: backend architecture, publishing ownership, database authority, transactions and durable invariants. I reviewed migrations **0001–0007**, relevant operator routes and `apps/api/src/routes/player.ts`. Authentication and storage code were read where needed to trace these boundaries. Neither `apps/portal` nor `apps/player-web` was reviewed.

All actions were read-only. No files were written, tests run, Docker started, branches changed, or GitHub accessed. Citations below refer to source at the verified SHA.

No Cursor Runtime Evidence appendix was supplied or found in the accessible review locations under `/workspace` or `/tmp`. Test references describe **committed test coverage, not observed passing results**. Installed privileges, actual concurrent lock behaviour and upgrade execution are **Unverified pending runtime**.

## 2. Architecture assessment against the brief

**The backend fundamentals are substantially well designed.** The modular monolith has a useful pure domain boundary, explicit transaction ownership and a shared publication implementation. I found no credible Critical or High defect in the reviewed scope. The principal current weakness is inconsistent transaction ownership around credential mutations and their audit events; the remaining findings are bounded safeguards and maintenance weaknesses.

### Ownership and dependencies

The effective dependency structure is:

```text
main.ts → concrete dependencies → AppContext → app.ts → routes
routes → publishing.ts → domain rules + delivery validator
routes / publishing.ts → database transaction helpers
media handling → ObjectStorage
domain → contracts
delivery → domain + contracts
```

The domain owns draft validation, publication construction and comparison with existing manifests. It does not import Fastify, PostgreSQL, storage or browser-player code. `PublicationValidator` is declared in the domain, allowing delivery implementations to satisfy the interface without reversing that dependency. This is a sound implementation of D2, D12 and D15. See [playlist.ts:30](/workspace/tinnox-cms/packages/domain/src/playlist.ts:30), [manifest.ts:144](/workspace/tinnox-cms/packages/domain/src/manifest.ts:144), [types.ts:129](/workspace/tinnox-cms/packages/domain/src/types.ts:129) and [domain package.json:12](/workspace/tinnox-cms/packages/domain/package.json:12).

The API layer is less cleanly separated internally:

- Publishing imports `contentRectOf` from the displays route and `MEDIA_WINDOW_COLUMNS` from the media route, and accepts `FastifyRequest` for header parsing.
- The player route imports display-state conversion helpers.
- Overview imports display status, media quota and push-plan helpers from route modules.
- Playlist DTO assembly imports media/app query projections and converters.

These dependencies are visible in [publishing.ts:43](/workspace/tinnox-cms/apps/api/src/publishing.ts:43), [player.ts:59](/workspace/tinnox-cms/apps/api/src/routes/player.ts:59), [overview.ts:18](/workspace/tinnox-cms/apps/api/src/routes/overview.ts:18) and [playlists.ts:55](/workspace/tinnox-cms/apps/api/src/routes/playlists.ts:55).

**Observation — By design:** these imports currently reuse behaviour rather than duplicate it. The window projection specifically prevents inconsistent timestamp conversion, and its reuse is explicitly prescribed by [stage-b.md:124](/workspace/tinnox-cms/docs/portal-v2/stage-b.md:124). I did not find a present correctness failure caused by these imports.

Their concrete maintenance consequence is that route modules also serve as shared query/representation modules: changing a media projection or display-state conversion requires checking publishing, playlist responses, player responses and overview together. The required property is clear ownership of these shared contracts as they evolve. That does not justify a wholesale repository layer.

### Route-local SQL

Route-local SQL is reasonable here. It keeps locking, tenant predicates, mutation order and audit insertion visible inside the operation’s transaction. `publishing.ts` already extracts the important cross-route orchestration without hiding transaction boundaries.

Tenant filtering is consistently reinforced by RLS and composite references in the reviewed flows. Soft-delete filtering is purpose-specific:

- Live playlist and publication planning queries exclude deleted rows.
- Published media remains available through publication references.
- Quota accounting includes retained media even when it is absent from the library.

These differences are intentional, not inconsistent filtering. See [publishing.ts:231](/workspace/tinnox-cms/apps/api/src/publishing.ts:231), [publishing.ts:299](/workspace/tinnox-cms/apps/api/src/publishing.ts:299), [media.ts:121](/workspace/tinnox-cms/apps/api/src/routes/media.ts:121) and [player.ts:503](/workspace/tinnox-cms/apps/api/src/routes/player.ts:503).

Pure domain tests can exercise rules without a database; integration tests exercise SQL and transaction semantics. That is an appropriate testing split for this design.

### Both publication entry points

| Concern | `POST /api/playlists/:id/publish` | Assignment followed by `POST /api/push` |
|---|---|---|
| Selection | Explicit playlist and display | Display’s current assignment |
| Validation | Shared loaders and `planDraft` | Same planning through `assessDisplays` |
| Assignment | Updates assignment with successful publication | Assignment occurs separately; push does not change it |
| Idempotency | Existing key returns publication; different playlist conflicts | Existing key returns publication before reassessment |
| Lock order | Key → display → playlist → media/apps → delivery state | Same order, one display per transaction |
| Unchanged content | New key creates a publication | Returns `unchanged` |
| Rejection audit | Committed through `withOrgDecision`, then HTTP refusal | Committed with per-display `rejected` result |
| Desired state | Shared `createPublication` | Shared `createPublication` |
| Bulk atomicity | One display | Each display commits independently |

The common persistence function writes the publication, media-reference rows, desired state and success audit in the caller’s transaction. Direct publish additionally writes the assignment before that transaction commits. See [publishing.ts:522](/workspace/tinnox-cms/apps/api/src/publishing.ts:522), [playlists.ts:514](/workspace/tinnox-cms/apps/api/src/routes/playlists.ts:514) and [push.ts:85](/workspace/tinnox-cms/apps/api/src/routes/push.ts:85).

This is genuine shared ownership of core publishing behaviour. The entry-point differences are substantially documented in [stage-a.md:183](/workspace/tinnox-cms/docs/portal-v2/stage-a.md:183) and its following behaviour table.

### Composition root and delivery port

`main.ts` constructs the pool, storage, delivery registry, identity provider, media pipeline and clock, then supplies them to `buildApp`. This makes production assembly explicit and allows tests to construct the application independently. `AppContext` is broad and includes the concrete `MediaPipeline` type, but it is passed explicitly rather than accessed through a global locator. I found no consequential defect in that choice. See [main.ts:35](/workspace/tinnox-cms/apps/api/src/main.ts:35) and [context.ts:9](/workspace/tinnox-cms/apps/api/src/context.ts:9).

The delivery port has present value:

- Publishing invokes its validator.
- Heartbeat processing invokes `normalizeStatus`.
- The fake exercises domain planning against a different capability profile.

However, `prepare()` currently returns a value that publishing discards, while the player endpoint constructs its own response and ETag. Thus the fake establishes domain substitution, **not end-to-end delivery substitution through the API**. This is a limited implementation of D15, not a defect merely because there is one real route. See [publishing.ts:530](/workspace/tinnox-cms/apps/api/src/publishing.ts:530), [player.ts:380](/workspace/tinnox-cms/apps/api/src/routes/player.ts:380), [player.ts:552](/workspace/tinnox-cms/apps/api/src/routes/player.ts:552) and [delivery.test.ts:72](/workspace/tinnox-cms/packages/delivery/test/delivery.test.ts:72).

## 3. Prioritized findings

### CX-01 — Credential changes can commit without their required audit event

**Severity: Medium · Classification: New finding**

**Affected invariant:** an authoritative credential transition and its D16 audit evidence should have a coherent durable outcome.

`poolAsTx` performs independent autocommitted statements. Pairing completion uses it to create the registration, revoke a previous registration and consume the pairing session. Only afterward does a separate `withOrg` transaction read the display and insert `pairing.complete`. Login creation and logout revocation similarly commit before their success audits.

Evidence:

- Autocommit adapter: [tx.ts:93](/workspace/tinnox-cms/packages/db/src/tx.ts:93).
- Pairing’s durable mutation: [0002_security_functions.sql:318](/workspace/tinnox-cms/db/migrations/0002_security_functions.sql:318).
- Separate completion and audit transactions: [player.ts:279](/workspace/tinnox-cms/apps/api/src/routes/player.ts:279).
- Session creation followed by audit: [auth.ts:189](/workspace/tinnox-cms/apps/api/src/routes/auth.ts:189).
- Revocation followed by audit: [auth.ts:255](/workspace/tinnox-cms/apps/api/src/routes/auth.ts:255).

**Trigger:** the API process exits, the next connection cannot be acquired, or the audit transaction fails after the credential mutation commits.

**Consequence and scope:** the credential change survives without its corresponding audit event. Pairing can also become consumed before the token response is returned; the subsequent poll reports `consumed`. This affects credential lifecycle evidence and bounded recovery, not tenant isolation.

The protocol already acknowledges that losing the single token response requires pairing again ([player-protocol-v1.md:32](/workspace/tinnox-cms/docs/player-protocol-v1.md:32)). The new finding is the avoidable database/audit split, not that documented delivery limitation.

**Test evidence:** the security-function tests cover atomic completion and concurrent completion of one pairing session ([sec.integration.test.ts:414](/workspace/tinnox-cms/packages/db/test/sec.integration.test.ts:414)). They do not establish atomicity with the later API audit transaction. I found no fault-injection coverage for this gap.

**Confidence:** high from transaction boundaries. Failure execution is **Unverified pending runtime**; evidence needed is interruption or audit failure between the two commits, followed by inspection of credential and audit state.

**Decision/property:** D4, D9 and D16. Credential-state ownership needs a defined relationship to durable audit evidence. Publication already provides the stronger, transactionally coherent model.

### CX-02 — Two database completeness checks admit SQL NULL

**Severity: Low · Classification: New finding**

**Affected invariant:** database checks should reject missing values for the specific completeness properties they claim to enforce.

The latest `publication_manifest_shape` constraint compares extracted JSON fields without requiring them to exist. For an object such as `{}`, those comparisons evaluate to SQL NULL; a CHECK rejects false, not NULL. Similarly, `media_ready_is_complete` uses `bytes > 0` without requiring non-null `bytes`, although the column itself is nullable.

Evidence:

- Current publication constraint: [0007_stage_b_apps.sql:53](/workspace/tinnox-cms/db/migrations/0007_stage_b_apps.sql:53).
- Nullable media bytes and ready check: [0001_schema.sql:201](/workspace/tinnox-cms/db/migrations/0001_schema.sql:201), [0001_schema.sql:220](/workspace/tinnox-cms/db/migrations/0001_schema.sql:220).
- Runtime write grants: [0001_schema.sql:481](/workspace/tinnox-cms/db/migrations/0001_schema.sql:481).

**Trigger/change scenario:** an internal writer or future application change bypasses normal manifest construction, or marks media ready with the other required fields populated but `bytes = NULL`.

**Consequence and scope:** the database can retain an incomplete “ready” media row or malformed immutable publication. A malformed desired publication fails server-side manifest parsing. No normal HTTP path producing these records was found: the current domain explicitly rejects missing media bytes and self-validates constructed manifests. Those protections bound the severity. See [playlist.ts:174](/workspace/tinnox-cms/packages/domain/src/playlist.ts:174), [manifest.ts:111](/workspace/tinnox-cms/packages/domain/src/manifest.ts:111) and [player.ts:391](/workspace/tinnox-cms/apps/api/src/routes/player.ts:391).

**Test evidence:** existing database tests reject wrong identifiers, unsupported versions and empty assets, but do not exercise absent/null required manifest keys ([rls.integration.test.ts:770](/workspace/tinnox-cms/packages/db/test/rls.integration.test.ts:770)).

**Confidence:** high in the static SQL conclusion. Acceptance by the installed database is **Unverified pending runtime**; evidence needed is direct insertion of these boundary cases as `tinnox_app`.

**Decision/property:** D11 and D12. Full contract validation may reasonably remain in the application, but the database’s selected completeness checks should enforce those selected properties under SQL null semantics.

### CX-03 — Migration history validation can reject the bundle after applying new migrations

**Severity: Low · Classification: New finding**

**Affected invariant:** an incompatible migration bundle should be distinguishable from a failed valid upgrade before it changes schema state.

The runner applies pending files while iterating the supplied directory. It checks for database migration records missing from that directory only after the application loop. Checksum comparisons are also interleaved with application.

Evidence: [migrate.ts:65](/workspace/tinnox-cms/packages/db/src/migrate.ts:65), [migrate.ts:79](/workspace/tinnox-cms/packages/db/src/migrate.ts:79) and [migrate.ts:94](/workspace/tinnox-cms/packages/db/src/migrate.ts:94).

**Trigger:** a packaged migration directory accidentally omits an already-applied migration but contains a valid later migration. For example, an existing database has 0001–0006, the package omits 0005, and 0007 is present.

**Consequence and scope:** 0007 can commit before the runner reports the missing 0005 file. The command fails, but the database has advanced. This complicates recovery and interpretation of deployment failure; it does not invalidate per-file transaction atomicity.

**Test evidence:** the 0005 suite deliberately fails inside a migration and checks rollback, including temporary FORCE/trigger changes ([migration-0005.integration.test.ts:283](/workspace/tinnox-cms/packages/db/test/migration-0005.integration.test.ts:283)). That tests a different property from rejecting an incompatible migration set before applying pending files.

**Confidence:** high from control flow. The concrete package-omission scenario is **Unverified pending runtime**.

**Decision/property:** D3/D4 schema authority and the runner’s checksum/history contract. Migration-set compatibility needs a clear validation boundary before new durable changes begin.

### CX-04 — Storage cleanup depends on an undeclared optional method

**Severity: Low · Classification: New finding**

**Affected invariant:** composition should preserve required storage-maintenance behaviour when dependencies are wrapped or changed.

Housekeeping casts `ObjectStorage` to an extended structural type and optionally invokes `removeStaleTempFiles`. That method is absent from the declared storage interface. If unavailable, housekeeping reports zero temporary files removed.

Evidence: [housekeeping.ts:35](/workspace/tinnox-cms/apps/api/src/housekeeping.ts:35), [storage.ts:34](/workspace/tinnox-cms/packages/storage/src/storage.ts:34) and the current implementation at [local.ts:275](/workspace/tinnox-cms/packages/storage/src/local.ts:275).

**Trigger/change scenario:** a logging wrapper or decorator forwards every declared `ObjectStorage` method around the current local store but does not know about the extra cleanup method.

**Consequence and scope:** the wrapper remains type-correct while stale temporary-file cleanup silently stops. Repeated interrupted writes can then accumulate files. The current composition passes `LocalObjectStorage` directly, so this is a concrete maintenance hazard, not a demonstrated current leak.

**Test evidence:** testing the local implementation directly cannot establish that a conforming wrapper preserves this undeclared capability. No such wiring test was identified.

**Confidence:** high in the interface mismatch; accumulation under the change scenario is untested.

**Decision/property:** D10 and composition-root ownership. Maintenance capabilities on which the application relies need an explicit ownership contract, even when some storage implementations legitimately require no cleanup.

## 4. Design choices judged reasonable

### Verified identity precedes tenant context

Operator identity flows from the OIDC result into `sec.session_create`, which derives organisation membership in SQL. Subsequent requests resolve the cookie hash, then pass the returned organisation to `withOrg`. The operator route group installs the authentication hook centrally.

Player requests resolve a credential hash before setting tenant context. Signed media requests verify the signature before resolving the registration and its organisation. See [oidc.ts:124](/workspace/tinnox-cms/apps/api/src/auth/oidc.ts:124), [0002_security_functions.sql:62](/workspace/tinnox-cms/db/migrations/0002_security_functions.sql:62), [session.ts:65](/workspace/tinnox-cms/apps/api/src/auth/session.ts:65), [app.ts:99](/workspace/tinnox-cms/apps/api/src/app.ts:99) and [player.ts:473](/workspace/tinnox-cms/apps/api/src/routes/player.ts:473).

This supports D4’s actual trust model: RLS constrains queries to the organisation selected by trusted application code. It does not authenticate that selection independently.

### Pooled transaction lifetime is explicit

`withOrg` acquires one client, begins a transaction, sets transaction-local context, executes the callback and commits. Exceptions trigger rollback; rollback failure marks the connection broken for disposal. This avoids returning a connection whose failed rollback leaves its state unknown. See [tx.ts:23](/workspace/tinnox-cms/packages/db/src/tx.ts:23).

Direct pool use found in request code is the readiness `SELECT 1`. `poolAsTx` serves pre-tenant `sec.*` calls, housekeeping and processing-job discovery; it does not itself create a transaction. Its use is appropriate for individually atomic functions, subject to CX-01 when multiple durable operations are intended to form one action.

### The third role is a justified documented deviation

`tinnox_app` is declared non-owner, non-superuser and without BYPASSRLS. `tinnox_definer` is NOLOGIN with BYPASSRLS; the migrator may explicitly assume it but does not inherit its privileges. This resolves the problem that FORCE RLS also binds the table owner.

The deviation is recorded at [prototype-m0.md:105](/workspace/tinnox-cms/docs/prototype-m0.md:105); bootstrap declarations are at [01-roles.sh:25](/workspace/tinnox-cms/infra/postgres/init/01-roles.sh:25).

The `sec.*` functions use fixed search paths, qualified table names, bounded purposes and explicit execution grants. They include maintenance exceptions as well as pre-tenant identity lookup. They are not generic tenant-query escape hatches. See [0002_security_functions.sql:379](/workspace/tinnox-cms/db/migrations/0002_security_functions.sql:379) and [0003_api_lookups.sql:19](/workspace/tinnox-cms/db/migrations/0003_api_lookups.sql:19).

These are source declarations; installed ownership and grants remain unverified.

### Policy and composite-reference coverage is deliberate

The original tenant tables have forced policies; `session`, `login_state`, `pairing_session` and `pairing_claim_failure` deliberately have forced RLS **without tenant policies**, and ordinary runtime access is replaced by `sec.*`. `schema_migrations` is a separate administrative table.

Migration 0005 adds forced tenant policies and composite references for folders, scoped tags, joins and assignment. Migration 0006 adds columns, not new tenant tables. Migration 0007 adds the app policy, composite app reference and exactly-one-source playlist-item constraint. See [0001_schema.sql:421](/workspace/tinnox-cms/db/migrations/0001_schema.sql:421), [0005_portal_v2_stage_a.sql:107](/workspace/tinnox-cms/db/migrations/0005_portal_v2_stage_a.sql:107), [0005_portal_v2_stage_a.sql:148](/workspace/tinnox-cms/db/migrations/0005_portal_v2_stage_a.sql:148) and [0007_stage_b_apps.sql:40](/workspace/tinnox-cms/db/migrations/0007_stage_b_apps.sql:40).

Publication references in delivery state include both organisation and display. Registration references there and in heartbeat history enforce organisation, while same-display provenance additionally depends on authenticated API handling. That is a narrower database guarantee, not evidence of a current cross-display route defect.

### Publication, assignment and deletion locks fit together

Both publication paths take the same initial lock order. `FOR NO KEY UPDATE` on the display avoids an assignment-related upgrade and permits compatible reference locks. Playlist editing/deletion takes an exclusive row lock; publishing and assignment take a share lock.

Media and app loaders use key-share locks to prevent deletion. Media deletion explicitly takes `FOR UPDATE` before deciding whether to retain bytes. A published media reference prevents hard deletion; deleting its library entry retains the row and objects when necessary. See [publishing.ts:193](/workspace/tinnox-cms/apps/api/src/publishing.ts:193), [playlists.ts:275](/workspace/tinnox-cms/apps/api/src/routes/playlists.ts:275), [displays.ts:387](/workspace/tinnox-cms/apps/api/src/routes/displays.ts:387) and [media.ts:599](/workspace/tinnox-cms/apps/api/src/routes/media.ts:599).

Key-share locking is not a claim that all non-key metadata is frozen against updates. A concurrent media-window edit can leave a newly committed publication with the preceding values and another pending change. I found no requirement for a global snapshot across every editable record.

The assignment/deletion triggers provide a database backstop in both race directions. Dedicated tests exist at [portal-v2.integration.test.ts:484](/workspace/tinnox-cms/packages/db/test/portal-v2.integration.test.ts:484), and mixed publish/push contention is covered at [push.integration.test.ts:937](/workspace/tinnox-cms/apps/api/test/push.integration.test.ts:937). Actual behaviour remains unverified; I found no static lock-order inversion between the two publication paths.

### Publication and refusal auditing are coherent

Publication and asset rows reject mutation. The 0004 asset trigger permits insertion only with the creating publication transaction and only at a matching manifest position. This blocks later expansion of downloadable assets. App settings are copied into the manifest, so historical app playback does not depend on keeping the app row. See [0001_schema.sql:309](/workspace/tinnox-cms/db/migrations/0001_schema.sql:309), [0004_review_hardening.sql:16](/workspace/tinnox-cms/db/migrations/0004_review_hardening.sql:16) and [publishing.ts:551](/workspace/tinnox-cms/apps/api/src/publishing.ts:551).

`withOrgDecision` deliberately commits a refusal’s audit before throwing. In direct publishing, rejection occurs before publication, desired-state or assignment writes. The current call order therefore avoids accidentally committing a partial publish when refusing it. See [db-helpers.ts:26](/workspace/tinnox-cms/apps/api/src/db-helpers.ts:26) and [playlists.ts:542](/workspace/tinnox-cms/apps/api/src/routes/playlists.ts:542).

### Populated upgrades receive substantive attention

The migration runner serializes migrations with an advisory lock, checks checksums and commits each migration with its tracking row. A failed migration rolls back independently; the whole batch is not one transaction.

Migration 0005 backfills assignment from the **desired publication**, with organisation/display joins. It temporarily lifts FORCE on three tables and disables the display timestamp trigger, then restores them and checks final state within the migration transaction. Migration 0006 retains v1 while admitting v2; 0007 retains both while admitting v3.

The files explicitly require a stopped or idle API. I do not treat them as zero-downtime upgrades. The current application requires the new columns; rollback to older application code is not established merely because old manifest versions remain accepted. See [0005_portal_v2_stage_a.sql:173](/workspace/tinnox-cms/db/migrations/0005_portal_v2_stage_a.sql:173), [0006_stage_b_slice1.sql:8](/workspace/tinnox-cms/db/migrations/0006_stage_b_slice1.sql:8) and [0007_stage_b_apps.sql:8](/workspace/tinnox-cms/db/migrations/0007_stage_b_apps.sql:8).

## 5. Documented residuals and their current implications

These are observations, not additional newly discovered defects.

| Classification | Residual and implication |
|---|---|
| **Documented residual** | **Application-selected tenancy.** `tinnox_app` can set any `app.org_id`; RLS protects against missing tenant predicates, not arbitrary SQL authority or a compromised API. This is explicitly recorded in [control-matrix.md:24](/workspace/tinnox-cms/docs/security/control-matrix.md:24) and implemented by [tx.ts:60](/workspace/tinnox-cms/packages/db/src/tx.ts:60). No client-controlled organisation path was found in the reviewed flows. |
| **Documented residual** | **Push keys remember publications, not all request outcomes.** A lost response followed by a retry can publish later edits for a display that previously returned `unchanged`, `skipped` or `rejected`. This is documented in [stage-a.md:198](/workspace/tinnox-cms/docs/portal-v2/stage-a.md:198) and implemented at [push.ts:94](/workspace/tinnox-cms/apps/api/src/routes/push.ts:94). “Retry-safe” therefore means at most one publication per display/key, not replay of an immutable bulk-command snapshot. |
| **By design** | **Bulk push is partially committing.** Earlier displays remain published if a later display fails; replay resumes through per-display keys. This is explicit at [stage-a.md:201](/workspace/tinnox-cms/docs/portal-v2/stage-a.md:201) and [push.ts:169](/workspace/tinnox-cms/apps/api/src/routes/push.ts:169). |
| **Documented residual** | **Audit is not independent proof against trusted infrastructure.** The runtime role can insert false actor details; privileged administrators can alter enforcement. The audit timestamp is database-controlled, but event authenticity remains application-controlled. See [control-matrix.md:31](/workspace/tinnox-cms/docs/security/control-matrix.md:31), [sec.ts:392](/workspace/tinnox-cms/packages/db/src/sec.ts:392) and [0004_review_hardening.sql:43](/workspace/tinnox-cms/db/migrations/0004_review_hardening.sql:43). |
| **Documented residual** | **Database and object storage have separate durability boundaries.** The documented orphan-object risk remains; deletion similarly commits the row change before attempting object removal. This review notes the architectural boundary without duplicating the media/recovery review. See [control-matrix.md:28](/workspace/tinnox-cms/docs/security/control-matrix.md:28) and [media.ts:673](/workspace/tinnox-cms/apps/api/src/routes/media.ts:673). |
| **Documented residual** | **Manifest compatibility is versioned without per-player negotiation.** The server retains v1/v2/v3 handling, but cannot tailor publication to an individual older player. See [player-protocol-v1.md:301](/workspace/tinnox-cms/docs/player-protocol-v1.md:301) and [manifest.ts:80](/workspace/tinnox-cms/packages/domain/src/manifest.ts:80). Rendering behaviour was not reviewed. |

## 6. Runtime evidence and limitations

**No runtime result is asserted by this report.** Existing documentation contains historical “TESTED” statements, but these do not establish execution at this SHA in the reviewer’s environment.

| Proposition | Status and evidence needed |
|---|---|
| Installed role privileges, ownership, execution grants and forced policies | **Unverified pending runtime.** Catalog assertions from the RLS, security-function, portal-v2 and stage-B suites at the pinned SHA. |
| Tenant context clears on commit/rollback and concurrent pooled use remains isolated | **Unverified pending runtime.** RLS integration results, including connection reuse; rollback-failure disposal additionally needs targeted fault evidence. |
| Publish/push/assignment/delete locks serialize as intended | **Unverified pending runtime.** Publish/push tests and the held-transaction assignment/deletion cases, with environment and failures recorded. |
| Populated 0004→0005 upgrade preserves data and restores FORCE/triggers after failure | **Unverified pending runtime.** `migration-0005.integration.test.ts` and `migration-backfill.test.ts`. |
| 0006/0007 constraints and compatibility work on the actual database | **Unverified pending runtime.** Stage-B database tests; populated later-upgrade execution should be distinguished from fresh-schema tests. |
| CX-01, CX-02 and CX-03 reproduce exactly as described | **Unverified pending runtime.** Focused failure/boundary scenarios beyond ordinary happy-path suite results. |

The existing test design is useful: it includes held transactions, cross-organisation access, populated upgrades and failure injection during the 0005 backfill. It is stronger evidence preparation than a suite consisting only of endpoint success cases. It is still not execution evidence.

## 7. Deferred questions and unresolved disagreements

1. **Audit ownership is the main issue to resolve.** Publication has coherent transaction semantics; credential lifecycle operations do not. CX-01 should be consolidated with Cursor’s HTTP findings without duplicating the issue.

2. **The database/application division needs precise claims.** It is reasonable for contracts to enforce full manifest and app-setting structure. It is less reasonable to describe selected database completeness guards as authoritative when NULL bypasses those guards.

3. **Route-module reuse is not currently grounds for architectural replacement.** I would not recommend a repository layer from this review. The concrete requirement is preserving shared query/DTO ownership as route modules evolve.

4. **The delivery fake proves a narrower claim than its broad architectural description might suggest.** It proves domain independence and alternate validation/preparation in isolation. It does not prove API delivery orchestration consumes an alternative prepared representation.

5. **Runtime confirmation remains outstanding.** There is no basis here to claim installed privileges, race outcomes or populated upgrades have passed at the pinned SHA. Missing evidence is not itself a defect.

The architecture is a credible foundation for continued implementation. The most valuable correction in ownership is the durable relationship between credential changes and auditing; the remaining findings can be addressed as bounded improvements without reorganizing the monolith.
---

## Coordinator verification notes

These notes were added after Codex finished. Codex’s report text above was not edited.

**Run confirmation.** Codex CLI v0.169.0, model `gpt-6-astra`, reasoning effort `medium`, sandbox `read-only`, session `01a1e398-76cd-79e1-b492-cbc16dcdf88c`, ~164,541 tokens, finished 2026-11-16 20:09 Australia/Melbourne. Repository remained at `cfa9926423e63393ab50afd6625a08beb69393f5` with a clean working tree throughout; no commits, branches, pushes, or GitHub writes.

**Citation spot-check.** Sixteen path:line citations were checked against that SHA, with emphasis on CX-01–CX-04 plus supporting architecture and residual citations. All files exist, all line numbers are in range, and every checked claim is supported by the nearby source. No citation pointed at the wrong file or at code that contradicted the claim.

Minor line-number imprecision only (none treated as errors):

- `apps/api/src/routes/player.ts:279` is the comment immediately above `pairingComplete` (line 281); the later separate `withOrg` audit is at 288–313.
- `db/migrations/0007_stage_b_apps.sql:53` is the `DROP CONSTRAINT`; the replacement CHECK that can admit SQL NULL starts at line 54.
- `apps/api/src/housekeeping.ts:35` is the comment; the structural cast is at 36–38.
- `apps/api/src/publishing.ts:530` is `buildManifest`; the unused `prepare()` return is at line 533.
- `apps/api/src/publishing.ts:43` is the `FastifyRequest` import; the `displays.ts` / `media.ts` imports are at 47–48.
- `packages/db/src/tx.ts:23` is the shared `run` helper (BEGIN / COMMIT / rollback disposal); `withOrg` itself is at line 60 and calls `run`.

Checked and accurate without even that imprecision: `packages/db/src/tx.ts:93` (`poolAsTx`); `apps/api/src/routes/auth.ts:189` and `:255` (credential mutation then a later audit); `packages/db/src/migrate.ts:65`, `:79`, `:94` (apply loop, then missing-file check); `packages/storage/src/storage.ts:34` and `packages/storage/src/local.ts:275`; `apps/api/src/publishing.ts:522`; `packages/domain/src/playlist.ts:174`; `packages/domain/src/manifest.ts:111`; `docs/portal-v2/stage-a.md:183`, `:198`, `:201`; `docs/security/control-matrix.md:24`, `:28`, `:31`; `db/migrations/0001_schema.sql:201` and `:220`; `docs/player-protocol-v1.md:32` and `:301`.
