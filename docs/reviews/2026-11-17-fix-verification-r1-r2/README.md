# Fix verification for review rounds 1 and 2 (17 Nov 2026)

Codex (gpt-6-astra, high effort, read-only) checked `main` at `f138439`. CMS Dev spot-checked the three partial verdicts (CU-01, CU-03, FCX-06) in the code and confirmed them. This was code reading only, and the test suites were not rerun at this commit.

Michael’s claim is **not fully supported** by the current code: **15 findings are FIXED, three are PARTIALLY FIXED, and one retains an ACCEPTED RESIDUAL**. The additional, unnumbered connection-loss finding is fixed.

Reviewed `main` at `f138439`; the working tree remained clean. Verdicts are based on current source and test inspection. Full database, browser and application-suite results are **unverified pending runtime**: dependencies are absent. I ran only small, read-only checks described below.

**Summary**

“Test” means committed regression coverage exists, not that it passed during this verification. Original severities are retained.

| ID | Severity | Verdict | Current evidence pointer | Test |
|---|---|---|---|---|
| CX-01 | Medium | ACCEPTED RESIDUAL | [auth.ts:264](../../../apps/api/src/routes/auth.ts) | Yes |
| CX-02 | Low | FIXED | [0009_stage_b_schedules.sql:150](../../../db/migrations/0009_stage_b_schedules.sql) | Yes |
| CX-03 | Low | FIXED | [migrate.ts:67](../../../packages/db/src/migrate.ts) | Yes |
| CX-04 | Low | FIXED | [storage.ts:47](../../../packages/storage/src/storage.ts) | No dedicated regression test; type contract |
| CU-01 | Medium | PARTIALLY FIXED | [backup-restore-check.sh:91](../../../scripts/backup-restore-check.sh) | No automated regression test found |
| CU-02 | Low | FIXED | [pipeline.ts:311](../../../apps/api/src/media/pipeline.ts) | Yes |
| CU-03 | Low | PARTIALLY FIXED | [control-matrix.md:32](../../../docs/security/control-matrix.md) | No; documentation |
| FCX-01 | High | FIXED | [api.ts:102](../../../apps/player-web/src/platform/api.ts) | Yes |
| FCX-02 | High | FIXED | [sync.ts:69](../../../apps/player-web/src/core/sync.ts) | Yes |
| FCX-03 | Medium | FIXED | [ScreenDetail.tsx:81](../../../apps/portal/src/features/displays/detail/ScreenDetail.tsx) | Yes; Canvas case |
| FCX-04 | Medium | FIXED | [MediaEditor.tsx:88](../../../apps/portal/src/features/media/detail/MediaEditor.tsx) | Yes; App case |
| FCX-05 | Medium | FIXED | [useLoad.ts:115](../../../apps/portal/src/hooks/useLoad.ts) | Yes |
| FCX-06 | Medium | PARTIALLY FIXED | [download.ts:66](../../../apps/player-web/src/core/download.ts) | Yes; remaining edges uncovered |
| FCU-01 | High | FIXED | [styles.css:123](../../../apps/player-web/src/styles.css) | Yes |
| FCU-02 | High | FIXED | [render.ts:111](../../../packages/app-render/src/render.ts) | Yes |
| FCU-03 | Medium | FIXED | [Chip.tsx:76](../../../apps/portal/src/ui/Chip.tsx) | Yes; page-title case |
| FCU-04 | Low | FIXED | [controls.css:510](../../../apps/portal/src/styles/controls.css) | Yes |
| FCU-05 | Low | FIXED | [Sidebar.tsx:345](../../../apps/portal/src/shell/Sidebar.tsx) | Yes; landmark ancestry |
| FCU-06 | Low | FIXED | [focusWrap.ts:36](../../../apps/portal/src/ui/focusWrap.ts) | Yes |
| Round-1 connection-loss follow-up, unnumbered | Observation¹ | FIXED | [tx.ts:30](../../../packages/db/src/tx.ts) | Yes |

¹ The source assigns no severity; “Observation” here identifies the unnumbered follow-up without inventing an original severity.

Git history confirms the fixes entered through PR **#11** (`737d8af`), **#12** (`e905bf7`) and **#14** (`f91947c`). Individual implementation commits are identified below.

**Round 1**

**CX-01 — Credential changes could commit without their audit event.**  
**ACCEPTED RESIDUAL.** Commits `1bd8758`, `c148a96`.

Login rotation, session creation and audit now share one transaction at [apps/api/src/routes/auth.ts:186](../../../apps/api/src/routes/auth.ts). Pairing completion, display lookup and audit likewise share one transaction at [apps/api/src/routes/player.ts:284](../../../apps/api/src/routes/player.ts). `withResolvedOrg` establishes transaction-local tenant context on that same transaction: [packages/db/src/tx.ts:102](../../../packages/db/src/tx.ts).

Logout normally follows the same rule, but its catch block deliberately retries revocation without auditing: [auth.ts:279](../../../apps/api/src/routes/auth.ts). The [round-1 README:132](../../../docs/reviews/2026-11-16-backend-round-1/README.md) explicitly accepts this exception. Therefore, the original all-or-nothing invariant is **not universally restored**.

Tests inject audit failures for pairing, logout and login at [credential-audit.test.ts:90](../../../tests/integration/credential-audit.test.ts), [:119](../../../tests/integration/credential-audit.test.ts) and [:134](../../../tests/integration/credential-audit.test.ts).

**Introduced issue — Low:** fallback revocation errors are swallowed, but the next log unconditionally says “the session was ended anyway”: [auth.ts:282](../../../apps/api/src/routes/auth.ts). If that second database operation fails, the log falsely asserts revocation. This failure combination has no identified regression test; **unverified pending runtime**.

**CX-02 — SQL NULL bypassed publication and ready-media completeness checks.**  
**FIXED.** Commit `4bc90e9`.

Migration 0008 wraps the publication predicate in `IS TRUE` and explicitly requires `bytes IS NOT NULL`: [0008_null_safe_checks.sql:20](../../../db/migrations/0008_null_safe_checks.sql), [:35](../../../db/migrations/0008_null_safe_checks.sql). Crucially, the later schedules migration preserves `IS TRUE` when replacing the publication constraint: [0009_stage_b_schedules.sql:150](../../../db/migrations/0009_stage_b_schedules.sql).

Regression coverage rejects `{}`, missing/null required fields and ready media with null bytes as the runtime role: [rls.integration.test.ts:897](../../../packages/db/test/rls.integration.test.ts). Populated-upgrade coverage checks the resulting constraints at [migration-0005.integration.test.ts:544](../../../packages/db/test/migration-0005.integration.test.ts).

Migrations 0001–0007 remain unchanged against the reviewed baseline. The validation locks are explicitly documented in [0008_null_safe_checks.sql:15](../../../db/migrations/0008_null_safe_checks.sql); lock duration remains **unverified pending runtime**.

**CX-03 — Migration history could be rejected after newer migrations had committed.**  
**FIXED.** Commit `285ee04`.

The runner checks missing applied files, checksums and out-of-order additions before entering the pending-migration execution loop: [migrate.ts:67](../../../packages/db/src/migrate.ts), [:95](../../../packages/db/src/migrate.ts). SQL is loaded into the validated pending list before execution.

Tests verify that a missing or changed applied file leaves the later probe unapplied, reject an earlier-numbered addition, and retain normal one-time application: [migrate.integration.test.ts:68](../../../packages/db/test/migrate.integration.test.ts).

**CX-04 — Temporary-file cleanup relied on an undeclared optional storage method.**  
**FIXED.** Commit `0751446`.

`ObjectStorage` now requires `removeStaleTempFiles`: [storage.ts:47](../../../packages/storage/src/storage.ts). Housekeeping calls it directly, without a structural cast or silent fallback: [housekeeping.ts:35](../../../apps/api/src/housekeeping.ts).

This closes the type-correct-wrapper omission described originally. No dedicated wrapper regression test was found; compile-time enforcement is the main protection. Typechecking was not run.

**CU-01 — Restore verification rejected app publications and ignored thumbnails.**  
**PARTIALLY FIXED.** Commit `d4d6c41`.

The manifest checks now distinguish apps using `kind IS DISTINCT FROM 'app'`, skip media hashing for app-only publications, and restrict unresolved references to media: [backup-restore-check.sh:114](../../../scripts/backup-restore-check.sh). Referenced thumbnails must exist and be nonempty: [:100](../../../scripts/backup-restore-check.sh).

However, the earlier ready-media check still calls `check_files` unconditionally, and that function rejects zero rows: [:91](../../../scripts/backup-restore-check.sh), [:95](../../../scripts/backup-restore-check.sh). A valid app-only database with **no ready media** therefore still fails restore verification.

I executed the current `check_files` function alone with empty input, without running the backup script: it printed “nothing to check” and returned **1**. Full restore execution remains **unverified pending runtime**. No automated regression test was found; the README records historical manual exercises.

This is an incomplete fix, not a newly introduced failure.

**CU-02 — Restrictive umask made worker job specifications unreadable.**  
**FIXED.** Commit `0751446`.

The API explicitly applies `chmod(tempPath, 0o644)` before publishing the JSON specification with `rename`: [pipeline.ts:311](../../../apps/api/src/media/pipeline.ts).

The regression uploads under umask `077`, verifies both file modes and completes worker processing: [upload.integration.test.ts:240](../../../apps/api/test/upload.integration.test.ts). Its worker action is simulated; execution with a distinct worker UID remains **unverified pending runtime** here.

**CU-03 — Validation documents understated the existing Node 22 CI evidence.**  
**PARTIALLY FIXED.** Commit `ebca733`.

The validation record now names run `43835309136`, Node `v22.23.4`, 266 integration tests and the skipped E2E job: [prototype-validation.md:64](../../../docs/prototype-validation.md). The M0 CI and Node deviations were also corrected: [prototype-m0.md:139](../../../docs/prototype-m0.md), [:155](../../../docs/prototype-m0.md).

But B12’s **Remaining gap** column still says **“CI not yet run”**, directly contradicting the updated evidence in the same row: [control-matrix.md:32](../../../docs/security/control-matrix.md).

No automated documentation regression test exists. I checked repository consistency, not the external Actions execution independently.

**Unnumbered round-1 follow-up — Losing a checked-out connection could terminate the API through an unhandled error event.**  
**FIXED.** Commit `249c75c`.

This additional finding appears in the [round-1 README:144](../../../docs/reviews/2026-11-16-backend-round-1/README.md). The shared transaction runner now registers an error listener, marks the connection broken and releases it with an error: [tx.ts:30](../../../packages/db/src/tx.ts).

Coverage includes listener cleanup and failed rollback disposal at [tx.test.ts:53](../../../packages/db/src/tx.test.ts), plus termination of a real PostgreSQL connection at [rls.integration.test.ts:632](../../../packages/db/test/rls.integration.test.ts). My read-only mock checks passed for all three transaction helpers; the PostgreSQL case is **unverified pending runtime**.

**Round 2**

**FCX-01 — A stalled JSON body could strand sync or heartbeat after the header timeout ended.**  
**FIXED.** Commit `9233069`.

`#request` now races the entire fetch-and-consume operation against the deadline and caller cancellation, clearing timers/listeners in `finally`: [platform/api.ts:102](../../../apps/player-web/src/platform/api.ts). Body consumption occurs inside that operation. Sync and heartbeat pass their lifecycle signals: [sync.ts:79](../../../apps/player-web/src/core/sync.ts), [heartbeat.ts:154](../../../apps/player-web/src/core/heartbeat.ts).

Tests cover stalled manifest, heartbeat, media-URL and pairing bodies, stalled release disposal, cancellation and timer cleanup: [api.test.ts:236](../../../apps/player-web/src/platform/api.test.ts).

**FCX-02 — Evicted media could not be repaired while the same publication remained active.**  
**FIXED.** Commit `87e4758`.

Each cycle checks the active publication’s media cache. An incomplete cache causes an unconditional manifest request and permits restaging the same publication ID: [sync.ts:69](../../../apps/player-web/src/core/sync.ts), [:127](../../../apps/player-web/src/core/sync.ts), [:148](../../../apps/player-web/src/core/sync.ts).

The missing-file repair test asserts that only the absent asset is downloaded; adjacent tests cover a newer desired publication and normal conditional polling: [sync.test.ts:118](../../../apps/player-web/src/core/sync.test.ts). This closes the previously documented media-entry-loss scenario. Real browser eviction recovery remains **unverified pending runtime**.

**FCX-03 — Returning to a tab during its save allowed newer input to be erased by the older completion.**  
**FIXED.** Commit `280a4a0`.

Canvas, Tags and Working hours save/error state now belongs to `ScreenDetail`, surviving tab unmounts: [ScreenDetail.tsx:81](../../../apps/portal/src/features/displays/detail/ScreenDetail.tsx). Canvas rejects changes and duplicate submissions while saving: [CanvasTab.tsx:101](../../../apps/portal/src/features/displays/detail/CanvasTab.tsx). Tags disables its picker; Working hours guards changes: [TagsTab.tsx:68](../../../apps/portal/src/features/displays/detail/TagsTab.tsx), [WorkingHoursTab.tsx:60](../../../apps/portal/src/features/displays/detail/WorkingHoursTab.tsx).

The browser regression holds a Canvas PATCH across a tab round-trip and verifies the submitted value remains read-only: [09-review-round-2.spec.ts:73](../../../tests/e2e/09-review-round-2.spec.ts). Equivalent Tags/Working-hours delayed-response tests were not found.

**FCX-04 — Media and app editors disabled leave protection before a save succeeded.**  
**FIXED.** Commit `280a4a0`.

Both editors now pass `dirty` independently of `saving`: [MediaEditor.tsx:88](../../../apps/portal/src/features/media/detail/MediaEditor.tsx), [AppEditor.tsx:120](../../../apps/portal/src/features/apps/AppEditor.tsx). The guard retains route blocking and `beforeunload` protection, with pending-save wording: [useLeaveGuard.tsx:31](../../../apps/portal/src/features/shared/useLeaveGuard.tsx).

The browser test holds an App PATCH, attempts navigation, stays, fails the request and checks the draft remains dirty: [09-review-round-2.spec.ts:105](../../../tests/e2e/09-review-round-2.spec.ts). The identical Media scenario and browser-unload behavior are not covered by that test.

**FCX-05 — A delayed GET could overwrite data installed by a successful save.**  
**FIXED.** Commit `09f2c10`.

Reads capture a generation ticket. `setData` invalidates earlier tickets, and both success and error paths discard stale results: [useLoad.ts:71](../../../apps/portal/src/hooks/useLoad.ts), [:115](../../../apps/portal/src/hooks/useLoad.ts).

Coverage includes [readOrder.test.ts:5](../../../apps/portal/src/lib/readOrder.test.ts) and a browser test that obtains the old GET response before saving, then delivers it afterward: [09-review-round-2.spec.ts:130](../../../tests/e2e/09-review-round-2.spec.ts). My direct, read-only generation-invalidation check also passed.

**FCX-06 — Player retries ignored the server’s Retry-After delay.**  
**PARTIALLY FIXED.** Commit `dec3fa0`.

The main manifest and heartbeat cases are fixed. The adapter preserves delay-seconds/HTTP-date metadata, and the loops hold the requested wait against wake signals: [api.ts:168](../../../apps/player-web/src/platform/api.ts), [sync.ts:328](../../../apps/player-web/src/core/sync.ts), [heartbeat.ts:195](../../../apps/player-web/src/core/heartbeat.ts). The ten-minute cap is explicitly documented at [player-protocol-v1.md:376](../../../docs/player-protocol-v1.md).

Two retry paths still violate the broader requirement:

- **Exhausted downloads:** after the sixth failed attempt, `downloadAsset` throws before waiting and drops the last `retryAfterMs`: [download.ts:66](../../../apps/player-web/src/core/download.ts). Staging converts that into an ordinary failed update, whose next cycle uses update backoff rather than the remaining server delay: [staging.ts:270](../../../apps/player-web/src/core/staging.ts), [sync.ts:328](../../../apps/player-web/src/core/sync.ts). A final `Retry-After: 600` can therefore be followed by another download attempt after roughly the ordinary 30-second update backoff.
- **Pairing near expiry:** the computed retry wait is shortened to the pairing deadline, with a one-second minimum: [app.ts:330](../../../apps/player-web/src/app.ts). For example, 30 seconds requested with five seconds remaining becomes a five-second wait before the next loop iteration.

Existing tests cover ordinary manifest/heartbeat wakes and intermediate media retries: [retry-after.test.ts:159](../../../apps/player-web/src/core/retry-after.test.ts), [:189](../../../apps/player-web/src/core/retry-after.test.ts), [:247](../../../apps/player-web/src/core/retry-after.test.ts). Neither remaining edge has identified coverage; both are **unverified pending runtime**. These are incomplete coverage of the original retry requirement, not newly introduced failure modes.

**FCU-01 — Player information screens clipped long names and the tiny-window pairing code.**  
**FIXED.** Commit `87e4758`.

`#screen` now scrolls, the card uses auto margins and `overflow-wrap:anywhere`, and the pairing code scales with width: [styles.css:123](../../../apps/player-web/src/styles.css), [:139](../../../apps/player-web/src/styles.css), [:166](../../../apps/player-web/src/styles.css). The tiny-height rule prioritizes the code and warning.

The browser regression checks slate, revoked and pairing layouts at five sizes including `192×96`: [09-review-round-2.spec.ts:238](../../../tests/e2e/09-review-round-2.spec.ts). It uses production CSS with representative markup, rather than invoking `screens.ts`; layout execution here is **unverified pending runtime**.

**FCU-02 — Long tokens clipped in Text, QR captions and reduced-motion tickers.**  
**FIXED for the reported cases.** Commit `2656954`.

The fitter now tries `overflow-wrap:anywhere`, then a smaller fallback font: [render.ts:111](../../../packages/app-render/src/render.ts). Text and reduced-motion tickers use this path; QR captions use `fitLines`: [:195](../../../packages/app-render/src/render.ts), [:319](../../../packages/app-render/src/render.ts).

The browser regression checks the original hostile strings at four large/strip/portrait sizes: [09-review-round-2.spec.ts:286](../../../tests/e2e/09-review-round-2.spec.ts). It does **not** include `192×96`, despite the README’s broader statement.

There is still an explicitly documented clipping boundary below `shortSide/24`: [stage-b.md:517](../../../docs/portal-v2/stage-b.md). The fix is not a guarantee that every legal string fits every canvas.

**Introduced documentation mismatch — Low:** [player-protocol-v1.md:193](../../../docs/player-protocol-v1.md) still describes clipping below `shortSide/12`, contradicting the changed renderer and stage-B specification.

**FCU-03 — Ellipsized portal names lacked a way for pointer users to read the full value.**  
**FIXED.** Commit `b4712db`.

Full-value titles now cover the originally named surfaces:

- Page title: [PageHeader.tsx:65](../../../apps/portal/src/shell/PageHeader.tsx).
- Dashboard screen names and playlist/schedule caption: [ScreensCard.tsx:203](../../../apps/portal/src/features/dashboard/ScreensCard.tsx), [PushCard.tsx:101](../../../apps/portal/src/features/dashboard/PushCard.tsx).
- Playlist tile names: [SequenceTile.tsx:120](../../../apps/portal/src/features/playlists/editor/SequenceTile.tsx).
- Plain-text tag labels and explicit folder names: [Chip.tsx:76](../../../apps/portal/src/ui/Chip.tsx), [FolderChips.tsx:168](../../../apps/portal/src/features/media/library/FolderChips.tsx).
- Screen-description metadata: [DataTable.tsx:422](../../../apps/portal/src/ui/DataTable.tsx).

The dedicated regression checks only the page-title attribute: [09-review-round-2.spec.ts:162](../../../tests/e2e/09-review-round-2.spec.ts). The remaining surfaces are verified by source inspection.

**FCU-04 — Narrow screen-settings tabs required scrolling without a visible affordance.**  
**FIXED.** Commit `b4712db`.

Below `40rem`, tab lists wrap and remove horizontal scrolling: [controls.css:510](../../../apps/portal/src/styles/controls.css). The browser test at 390 pixels checks both scroll width and every tab’s horizontal bounds: [09-review-round-2.spec.ts:173](../../../tests/e2e/09-review-round-2.spec.ts).

**FCU-05 — The wordmark sat outside an accessibility landmark.**  
**FIXED.** Commit `b4712db`.

Both drawer and docked sidebar bodies are enclosed in named `aside` elements: [Sidebar.tsx:345](../../../apps/portal/src/shell/Sidebar.tsx), [:354](../../../apps/portal/src/shell/Sidebar.tsx).

The regression checks wordmark landmark ancestry: [09-review-round-2.spec.ts:201](../../../tests/e2e/09-review-round-2.spec.ts). This is targeted structural coverage, not a fresh axe or screen-reader pass.

**FCU-06 — Tab could leave an open dialog.**  
**FIXED for the reported dialog sequence.** Commit `b4712db`.

The shared handler explicitly wraps first/last focus targets for Tab and Shift+Tab: [focusWrap.ts:9](../../../apps/portal/src/ui/focusWrap.ts), [:36](../../../apps/portal/src/ui/focusWrap.ts). Dialog and navigation drawer use it.

Coverage comprises [focusWrap.test.ts:7](../../../apps/portal/src/ui/focusWrap.test.ts) and 15 forward/15 backward Tabs in Add media: [09-review-round-2.spec.ts:215](../../../tests/e2e/09-review-round-2.spec.ts). My pure endpoint-wrapping checks passed. Actual browser focus behavior remains **unverified pending runtime**.

Apart from the logout-log issue and renderer/protocol documentation mismatch identified above, I found no additional introduced regression in the inspected fixes.

**Still needing work**

- Finish **CU-01**: allow a valid populated app-only restore with zero ready media, and add automated coverage.
- Finish **CU-03**: remove the contradictory B12 “CI not yet run” statement.
- Finish **FCX-06**: preserve throttling across download-attempt exhaustion and pairing expiry; add boundary tests.
- Correct the logout fallback’s unconditional success claim and the stale renderer protocol description.
- Run the committed regression suites at `f138439`. Historical README results do not establish this checkout’s runtime behavior.
- Keep **CX-01’s accepted logout exception** visible. The original unnumbered frontend hand-offs—1100-pixel editor layout and equal-length date changes—also remain unresolved runtime checks, not verified fixes.