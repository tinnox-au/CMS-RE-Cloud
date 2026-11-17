# Backend review, round 1

Date: 16 November 2026, Australia/Melbourne (UTC+11).
Status: documented review only. Both reviewers worked read-only; no product code was changed, and this folder is a record of the outcome, not a patch.

This page is the consolidated record of Round 1 of the TINNOX CMS backend review. It is intended to live at `docs/reviews/2026-11-16-backend-round-1/`. The two source reports are kept verbatim beside it:

- [Codex report, areas 1 and 2](codex-areas-1-2.md)
- [Cursor report, areas 3 to 5, including the runtime appendix](cursor-areas-3-5.md)

## 1. Baseline, scope and methods

| Item | Value |
|---|---|
| Repository | `tinnox-au/tinnox-cms` |
| Baseline | `cfa9926423e63393ab50afd6625a08beb69393f5` (`cfa9926`), tip of `main` |
| Commit | Merge pull request #7 from `tinnox-au/feat/stage-b-apps`, 16 November 2026, 19:52 (Australia/Melbourne) |
| Scope | Backend architecture, structure, and whether the fundamentals are well designed and well implemented |
| In scope | Modular monolith API, domain, contracts, delivery port, database package and migrations 0001–0007, storage, media worker, setup and CI, and the server `/player/*` endpoints |
| Out of scope | `apps/portal/**`, `apps/player-web/**`, scheduling and rendering as product behaviour, new features, HDMI or controller adapters, patches, exhaustive CRUD, and performance benchmarking |
| Method | One fixed snapshot. Neither reviewer followed a moving branch or changed the tree they reviewed. |

| Reviewer | Areas | Model and effort | Method |
|---|---|---|---|
| Codex CLI v0.169.0, sandbox read-only | 1 and 2: architecture, module boundaries, publishing ownership, database authority, transactions, and durable invariants | `gpt-6-astra`, medium | Static, read-only. Finished 16 November 2026, 20:09 (Australia/Melbourne). No tests run, no files written, no GitHub access. Report: [codex-areas-1-2.md](codex-areas-1-2.md). |
| Cursor cloud agent [bc-07332058-beb8-513d-b6ed-63f8491c2e10](https://cursor.com/agents/bc-07332058-beb8-513d-b6ed-63f8491c2e10) | 3 to 5: HTTP authority, media-worker boundary and recovery, operational backend and verification, plus the named integration subset | Grok 4.7, xhigh effort, 500k context window | Isolated checkout at the same SHA. Report and runtime appendix: [cursor-areas-3-5.md](cursor-areas-3-5.md). |

Findings are merged here by root cause and affected invariant, not by matching filenames. Area ownership is the default authority for a finding. Documented residuals and remaining runtime uncertainties are kept separate from confirmed new findings. No code was changed in this round; every finding’s next step is for later rounds.

Both reports were scanned for secrets, tokens, and signed URLs. None were present, and nothing has been redacted. Mentions of cookies, HMAC, bearer tokens, and secrets are descriptive only. Citations stay in `path:line` form against the pinned SHA.

## 2. Overall verdict

The backend fundamentals are in good shape for the prototype’s stated assumptions. Neither reviewer found a Critical or High defect. The modular monolith has a useful pure domain boundary, shared publication ownership across both entry points, explicit transaction helpers, forced row-level security, and an HTTP and media-worker boundary that matches the binding decisions in `docs/prototype-m0.md`. Codex does not recommend introducing a repository layer: route-local SQL keeps locking, tenant predicates, and audit insertion visible inside the operation’s transaction.

The principal weaknesses found in this round are bounded, not structural. The most important design gap is that credential mutations (pairing completion, login, and logout) can commit without their required audit event, because the mutation and the audit are separate transactions (CX-01). The other medium finding is operational rather than architectural: `npm run backup:verify` still treats every manifest item as a media file, so a consistent restore of a publication that contains an app fails the checker (CU-01). The five low findings are localised completeness, runner-ordering, interface, umask, and documentation issues.

Runtime evidence from the Cursor appendix now supports most of the database and lock propositions Codex had to leave unverified. The focused failure cases for CX-01, CX-02, and CX-03 were not exercised, and a few narrower runtime questions remain open, as set out in section 4.

## 3. Findings

These are the confirmed new findings from both reviewers, merged by root cause. There was no shared root cause that required collapsing two IDs into one. Documented residuals are in section 5, not in this table.

| ID | Severity | Classification | Area | Claim | Owner / next step | Detail |
|---|---|---|---|---|---|---|
| CX-01 | Medium | New finding | 2 — Database authority, transactions, and durable invariants | Pairing completion, login, and logout can commit a credential change and then fail to write the matching audit event, because the two writes are separate transactions. | For later rounds | [CX-01](codex-areas-1-2.md#cx-01--credential-changes-can-commit-without-their-required-audit-event) |
| CX-02 | Low | New finding | 2 — Database authority, transactions, and durable invariants | Two database completeness checks (`publication_manifest_shape` and `media_ready_is_complete`) admit SQL NULL, so they do not reject every missing value they claim to enforce. Normal HTTP paths still reject these cases in the application. | For later rounds | [CX-02](codex-areas-1-2.md#cx-02--two-database-completeness-checks-admit-sql-null) |
| CX-03 | Low | New finding | 2 — Database authority, transactions, and durable invariants | The migration runner can apply a later migration before it notices that an already-applied file is missing from the packaged directory, so a failed history check can land after the schema has already advanced. | For later rounds | [CX-03](codex-areas-1-2.md#cx-03--migration-history-validation-can-reject-the-bundle-after-applying-new-migrations) |
| CX-04 | Low | New finding | 1 — Architecture, module boundaries, and composition | Housekeeping reaches `removeStaleTempFiles` through a structural cast; the method is not on `ObjectStorage`, so a type-correct wrapper can silently stop temporary-file cleanup. | For later rounds | [CX-04](codex-areas-1-2.md#cx-04--storage-cleanup-depends-on-an-undeclared-optional-method) |
| CU-01 | Medium | New finding | 5 — Operational backend and credibility of verification | `npm run backup:verify` rejects a consistent restore as soon as a publication contains an app, and it never checks thumbnail objects. | For later rounds | [CU-01](cursor-areas-3-5.md#cu-01--restore-check-rejects-a-publication-that-contains-an-app-and-never-looks-at-thumbnails) |
| CU-02 | Low | New finding | 4 — Media worker boundary and cross-resource recovery | The job-spec file’s mode still depends on the API process umask, unlike the chmod’d bytes file, so umask `077` would make every upload fail closed. | For later rounds | [CU-02](cursor-areas-3-5.md#cu-02--the-job-specs-mode-still-depends-on-the-api-process-umask) |
| CU-03 | Low | New finding | 5 — Operational backend and credibility of verification | The validation and operations pages still say CI has never run and that results are from Node 23.10, which disagrees with the successful Node v22.23.4 workflow on this SHA. | For later rounds | [CU-03](cursor-areas-3-5.md#cu-03--the-written-verification-record-disagrees-with-the-workflow-result-on-this-sha) |

## 4. Runtime evidence and cross-check of Codex’s unverified items

Codex ran no tests and marked several propositions **Unverified pending runtime**. Cursor ran the named integration subset three times in an isolated environment at the same SHA, and also recorded the GitHub Actions run on that commit. Details and commands are in [section 6 of the Cursor report](cursor-areas-3-5.md#6-runtime-evidence-and-limitations).

**Isolated appendix (Cursor).** Ubuntu 24.04.5, Node v22.23.4, PostgreSQL 17.12 in a disposable container bound to `127.0.0.1:54329` (not the compose project or its volume). After `01-roles.sh`, the installed roles were: `tinnox_app` can log in, is not superuser, and does not have `BYPASSRLS`; `tinnox_migrator` can log in, is not superuser, and does not have `BYPASSRLS`; `tinnox_definer` cannot log in, has `BYPASSRLS`, and is not superuser. The media-worker image was built from `apps/media-worker/Dockerfile`. Keycloak, the compose project, the portal, the player, and Playwright were not started. The named 15 files reported 192 tests and 0 failures on each of three consecutive invocations (about 28 s, vitest 5.1.0):

`rls` 26, `sec` 24, `migration-0005` 17, `portal-v2` 29, `stage-b` 9, `publish` 7, `push` 24, `cross-org` 7, `session-csrf` 11, `pairing-and-credentials` 7, `production-refusal` 3, `player` 6, `abuse` 5, `upload` 11, `media-worker` 6.

**GitHub Actions on this SHA (external evidence).** Run [43835309136](https://github.com/tinnox-au/tinnox-cms/actions/runs/43835309136) on `cfa9926423e63393ab50afd6625a08beb69393f5`, Node v22.23.4: quality, integration, and secret scan succeeded; end-to-end was skipped. The integration job ran the full `npm run test:integration` suite: 23 files, 266 tests passed. That full suite includes files that were not in the isolated named subset, notably `packages/db/test/stage-b-apps.integration.test.ts` (8 tests, reported passed in the CI log) and `tests/integration/migration-backfill.test.ts`. Cursor did not re-download every log line of the 266 tests.

**Still not evidence, even after this run:** a real Keycloak MFA or PKCE flow (`npm run verify:oidc` and the browser suite were not run); an end-to-end `npm run backup:verify` on a populated database (CU-01); a different uid planting a thumbnail; and the focused failure cases listed below for CX-01, CX-02, and CX-03.

### Codex’s “Unverified pending runtime” propositions

| Proposition (Codex section 6) | Outcome | How the Cursor appendix bears on it |
|---|---|---|
| Installed role privileges, ownership, execution grants, and forced policies | Now supported | Cursor recorded the role flags after init and ran the catalog-assertion suites Codex named: `rls.integration.test.ts` (26, including the runtime role itself, ownership, forced RLS on every public table, and inability to escalate), `sec.integration.test.ts` (24), `portal-v2.integration.test.ts` (29), and `stage-b.integration.test.ts` (9), all passed at this SHA. `stage-b-apps.integration.test.ts` (migration 0007 grants and app policies) was not in the isolated named subset; the CI integration job on this SHA reports those 8 tests passed as part of the full suite. |
| Tenant context clears on commit/rollback, and concurrent pooled use remains isolated | Now supported, except rollback-failure disposal | The RLS suite passed, including “does not leak to the next user of the same connection”, “rolls back and clears the context when the work throws”, and “keeps concurrent organisations apart under load”. Codex also asked for targeted fault evidence that a failed rollback marks the connection for disposal. That narrower fault was not injected, so it is still unverified. |
| Publish, push, assignment, and delete locks serialise as intended | Now supported | `publish.integration.test.ts` (7), `push.integration.test.ts` (24, including mixed publish/push contention), and `portal-v2.integration.test.ts` (29, including the held-transaction assignment and deletion cases Codex cited) all passed in the recorded isolated environment, with no failures. |
| A populated 0004→0005 upgrade preserves data and restores FORCE and triggers after failure | Now supported for the 0005 suite; the API-level backfill test was not in the isolated appendix | `migration-0005.integration.test.ts` (17) passed, including a mid-backfill failure that leaves the schema, FORCE RLS, triggers, and rows as they were at 0004, and a successful upgrade of a database that already holds publications. `tests/integration/migration-backfill.test.ts` (an API-level M0 to portal v2 upgrade) was not in the named subset and was not run in the isolated environment. It is part of `npm run test:integration`, and the CI integration job on this SHA reported 23 files and 266 tests passed, so that file is supported only as part of the full CI suite, not by the appendix run. |
| 0006 and 0007 constraints and compatibility work on the actual database | Partially supported | `stage-b.integration.test.ts` passed locally (9 tests): stage B columns, grants, and publication manifest versions 1 to 3. `stage-b-apps.integration.test.ts` (0007 app rows, playlist-item exclusivity, and version 3 publication assets) was not run in the isolated appendix; CI reports 8 tests passed. Codex also asked that populated later-upgrade execution be distinguished from fresh-schema tests. The 0005 suite is a populated upgrade; the appendix did not separately identify the stage B suites as populated upgrades of an older database, so that distinction remains open for 0006 and 0007. |
| CX-01, CX-02, and CX-03 reproduce exactly as described | Still unverified | Cursor’s suites are ordinary integration coverage, not the focused failure and boundary scenarios Codex required: interruption or audit-transaction failure between the two commits (CX-01); direct insertion of NULL-boundary rows as `tinnox_app` (CX-02); and a packaged migration directory that omits an already-applied file but contains a later one (CX-03). Passing happy-path and concurrency suites does not settle these. The static claims and citations still stand; only reproduction is unverified. |

## 5. Overlaps, agreements, and disagreements

The area split held. There are no two new findings that share a root cause, and there is no disagreement on severity or on the overall judgement that the foundation is sound.

**CX-01 and the HTTP credential flows.** Codex asked that CX-01 be consolidated with Cursor’s HTTP findings without duplicating the issue. Cursor traced the same pairing, login, and logout paths at the HTTP boundary, judged them consistent with D5–D9, and did not raise the audit-transaction split — which was correctly left to Codex as an area 2 concern. The consolidation is therefore a single finding, CX-01. Cursor’s account of those HTTP flows is supporting context, not a second defect and not a rebuttal.

**Housekeeping and storage durability.** CX-04 (cleanup hangs on an undeclared storage method) and Cursor’s documented residual of no object-to-row reconciliation both involve housekeeping, but they are different invariants. They are kept as a new finding and a residual respectively. On the broader database and object-storage durability boundary, the two reports agree: Codex notes the architectural split and that deletion can commit the row change before object removal (`apps/api/src/routes/media.ts:673`); Cursor confirms that residual is still accurate and that thumbnails add a second object on both the orphan-object and leftover-file paths.

**Stale validation documents.** Only Cursor raised this, as CU-03. Codex did not review area 5 and did not mention the validation or CI record. There is no overlap to merge, and no disagreement.

**Documented residuals.** Both reviewers treated already recorded residuals as still accurate rather than rediscovering them as new defects: application-selected tenancy, audit that is not independent proof against trusted infrastructure, the database and object-storage durability split, the world-readable inbox and world-writable outbox, the single serial worker with no per-organisation fairness, and the lack of storage-object reconciliation. Cursor adds that thumbnails enlarge the inbox/outbox residual, because the thumbnail uid check follows the verdict’s writer and does not require the worker uid. That is a change of implication for a documented residual, not a new finding ID.

**No disagreement between the reviewers.** The only tension Cursor recorded sits inside the existing documents themselves: the threat model’s claim that the thumbnail uid check stops a local process, set against the same model’s claim that a local process can forge a verdict. The code implements the second claim, and the thumbnail check follows the verdict’s uid.

## 6. Documented residuals and observations kept out of the findings table

These are not additional newly discovered defects. See [Codex section 5](codex-areas-1-2.md#5-documented-residuals-and-their-current-implications) and [Cursor section 5](cursor-areas-3-5.md#5-documented-residuals-and-their-current-implications).

- Application-selected tenancy: `tinnox_app` can set any `app.org_id`; RLS protects against missing tenant predicates, not a compromised API.
- Push idempotency keys remember publications, not every request outcome; bulk push is partially committing, by design.
- Audit is not independent proof against trusted infrastructure.
- Database and object storage have separate durability boundaries, including orphan objects and delete-then-remove. Thumbnails add a second object on both paths, and thumbnail bytes remain outside the quota.
- Manifest compatibility is versioned without per-player negotiation.
- World-readable worker inbox and world-writable sticky outbox on Linux (threat model T1), enlarged by thumbnails as noted above.
- No per-organisation fairness on the single serial worker (T15); stage B image thumbnail encoding makes image jobs slower on that same loop.
- Audit rows have no purge (recorded retention deviation).
- The delivery-port test fake proves domain independence and alternate validation in isolation; it does not prove that API delivery orchestration consumes an alternative `prepare()` representation. This is a limited implementation of D15, recorded as an observation, not a defect.
- Route-module reuse of query and DTO helpers is a maintenance coupling, not present grounds for a repository layer.

## 7. Out of scope for this round

- All implementation review under `apps/portal/**` and `apps/player-web/**`.
- Portal UX, styling, accessibility, navigation, and workflow polish.
- Browser storage, service workers, offline activation, rendering, and playback algorithms.
- Scheduling correctness as a product feature, including DST edges, fail-open playback, and item-boundary timing.
- New features, future HDMI or controller adapters, vendor APIs, hardware integration, and production-platform redesign.
- Exhaustive CRUD walkthroughs, broad performance or scale benchmarking, and dependency-vulnerability research. The CI `npm audit` result (7 moderate `minimatch` findings, exit 0 at audit level high) is recorded only as part of the workflow evidence for CU-03.
- Implementing fixes, adding tests, or opening any product pull request. This folder is the review record only.

## 8. Suggested focus for round 2

- Decide and, in a later implementation pass, close the two medium findings: give credential mutations and their audit events a single durable outcome, as publication already does (CX-01); and bring `backup:verify` in line with manifest v3, including an explicit decision on whether thumbnail objects are part of the restore contract (CU-01).
- Schedule the five low findings with related work rather than as a redesign: NULL-safe completeness checks (CX-02), history validation before applying pending migrations (CX-03), an explicit storage-maintenance contract (CX-04), umask-independent job-spec permissions (CU-02), and a validation-record pass that matches GitHub Actions run 43835309136, including the skipped end-to-end job (CU-03).
- Finish the runtime questions this round left open: focused reproduction of CX-01, CX-02, and CX-03; targeted evidence for rollback-failure connection disposal; and, if a later appendix should stand on its own, the isolated named-subset run of `migration-backfill.test.ts` and `stage-b-apps.integration.test.ts`, plus a populated 0006/0007 upgrade distinguished from a fresh schema.
- Real Keycloak MFA and the manual end-to-end job remain unverified. That is a provider-flow and shared-environment question, not a backend design defect found here. Session-factory tests do not establish it.
- Do not introduce a repository layer on the strength of this review. If structure is revisited, the useful work is preserving shared query and DTO ownership as route modules evolve, and being precise about what the delivery fake actually proves.
- Expand into the portal, the browser player, or scheduling and DST only if that is a deliberately wider brief. Those areas were out of scope here and have not been reviewed.

## 9. Fixes made after this round (17 November 2026)

Sections 1 to 8 are the review record as written and are unchanged. The findings were then fixed on one branch, one commit per root cause. Where a finding can be tested, the fix comes with a test that fails on the code as reviewed.

| ID | Change | Evidence |
|---|---|---|
| CU-01 | `scripts/backup-restore-check.sh` selects media items by kind, counts app items without looking them up, and requires every thumbnail a media row names to be restored as a non-empty file (presence only; no thumbnail hash is stored). | Run end to end on a development database with 51 publications, 96 media items and 6 app items: passed, where the script as reviewed failed. That database had no thumbnails, so the check was also run against the end-to-end suite's database after a run (30 publications, 51 media items, 7 app items, 19 thumbnails, migration 0008 applied): passed. |
| CX-01 | Pairing completion, sign-in and sign-out run the credential change and its audit event in one transaction (`withResolvedOrg` in `packages/db/src/tx.ts`). A failed audit insert rolls a pairing completion or a sign-in back, and the pairing stays collectable. Sign-out is the deliberate exception: ending a session is the safe direction, so if its audit insert fails the session is still ended, the failure is logged and the request reports an error. | `tests/integration/credential-audit.test.ts` makes the audit insert fail for each of the three actions. This is also the focused reproduction section 4 left open: all three cases fail on the code as reviewed. |
| CX-02 | Migration `0008_null_safe_checks.sql` re-creates `publication_manifest_shape` and `media_ready_is_complete` so that SQL NULL no longer passes. | `packages/db/test/rls.integration.test.ts`, as `tinnox_app`: `{}`, each required field missing or null, and a ready media row with `bytes` NULL are refused; without 0008 the first is accepted. |
| CX-03 | The migration runner checks the directory against `schema_migrations` before applying anything. It also refuses a new file numbered before an applied one, a gap the review did not list. | `packages/db/test/migrate.integration.test.ts`; on the runner as reviewed, the later migration is applied before the missing file is reported. |
| CX-04 | `removeStaleTempFiles` is part of `ObjectStorage`; housekeeping calls it without a cast. | Type check. |
| CU-02 | The job spec is `chmod`'d to `0644` before it is renamed into the inbox. | `apps/api/test/upload.integration.test.ts` uploads under umask `077`; without the fix the spec is `0600`. |
| CU-03 | The validation, M0, control-matrix and operations pages now state what CI run 43835309136 showed, including the skipped end-to-end job. The threat model and the code comment on the thumbnail uid check say what the check does not stop (section 5). | Documentation only. |

The runtime questions section 8 left open were then taken up:

| Question | Outcome |
|---|---|
| Rollback-failure connection disposal | Supported. `packages/db/src/tx.test.ts` uses a pool whose ROLLBACK fails: all three transaction helpers release the connection with an error, which makes pg destroy it. `rls.integration.test.ts` has the server terminate a connection in mid-transaction: the pool replaces it and the next user has no tenant context. |
| New finding from that test | A connection lost while checked out emitted an `error` event nobody listened to, so the API's `uncaughtException` handler exited the process. The transaction helper now listens while it holds the connection; the request fails and the process stays up. Neither reviewer raised this. |
| Populated 0006/0007 upgrade, as distinct from a fresh schema | Supported. `migration-0005.integration.test.ts` already upgraded its populated 0004 database through every later migration; it now asserts that explicitly for 0006, 0007 and 0008 (existing rows keep their defaults, version 1 manifests pass the re-created checks). |
| Real Keycloak flow | `npm run verify:oidc` passed against the local realm on 17 November 2026: PKCE code flow, one-time code redemption, and a user without an authenticator is refused a code. The development realm's ID token still carries no usable `acr` or `amr` (`acr=0`), so MFA there rests on the realm's flow, not on claims. |

| Browser end-to-end suite | `npm run test:e2e` passed locally on 17 November 2026 with these changes (53 tests, macOS, Node 23.10): real Keycloak sign-in with TOTP, pairing, sign-out and the PostgreSQL restart, on a database migrated through 0008. |

Still open: the end-to-end job has not run in CI (it needs a manual dispatch or `RUN_E2E`), so there is no end-to-end result on Node 22.

## 10. Fix verification (17 November 2026)

A later read-only check of `main` at `f138439` is recorded in [Fix verification for review rounds 1 and 2](../2026-11-17-fix-verification-r1-r2/README.md).
CX-02, CX-03, CX-04 and CU-02 are fixed. CX-01 is an accepted residual (the logout fallback).
CU-01 is partly fixed, because restore verification still fails when there are zero ready media.
CU-03 is partly fixed, because the B12 row in `control-matrix.md` still says "CI not yet run".
The logout fallback log says the session ended even when revocation failed; that is a new low item.

Follow-up (branch `fix/verification-r1-r2`): CU-01 restore verification now passes a database with no ready media (an empty restore is still caught by the row counts and the publication check); CU-03's B12 gap now names only the end-to-end job; the logout fallback logs whether the retried revocation succeeded. CX-01's logout exception stays accepted.
