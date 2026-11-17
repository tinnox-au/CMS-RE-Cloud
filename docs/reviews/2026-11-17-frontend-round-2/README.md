# Frontend review, round 2

Date: 17 November 2026, Australia/Melbourne (UTC+11).
Status: documented review only. Both reviewers worked read-only; no product code was changed, and this folder is a record of the outcome, not a patch.

This page is the consolidated record of Round 2 of the TINNOX CMS frontend review. It is intended to live at `docs/reviews/2026-11-17-frontend-round-2/`. The two source reports are kept beside it:

- [Codex report, areas 1 and 2](codex-areas-1-2.md)
- [Cursor report, areas 3 to 5, including the runtime appendix and screenshots](cursor-areas-3-5.md)

## 1. Baseline, scope and methods

| Item | Value |
|---|---|
| Repository | `tinnox-au/tinnox-cms` |
| Baseline | `6d88bafcc6cc848f8a026de227ca452592a76597` (`6d88baf`), tip of `main` |
| Commit | Merge pull request #8 from `tinnox-au/docs/backend-review-round-1`, 16 November 2026, 20:54 (Australia/Melbourne) |
| Scope | Frontend architecture, structure, and implementation quality, with particular attention to layout robustness (overflow, truncation, wrapping, responsive behaviour) |
| In scope | `apps/portal/**`, `apps/player-web/**`, and `packages/app-render/**` |
| Out of scope | Backend implementation (`apps/api`, media worker, `packages/db`) except as a contract dependency; new features; patches; exhaustive product QA |
| Method | One fixed snapshot. Neither reviewer followed a moving branch or changed the tree they reviewed. |

| Reviewer | Areas | Model and effort | Method |
|---|---|---|---|
| Codex CLI v0.169.0, sandbox read-only | 1 and 2: portal architecture and state; player and app-renderer architecture, including unattended operation | `gpt-6-astra`, medium | Static, read-only. Finished 17 November 2026, 00:52 (Australia/Melbourne). Dependencies were not installed, so no tests were run. No files written, no GitHub access. Report: [codex-areas-1-2.md](codex-areas-1-2.md). |
| Cursor cloud agent [bc-a55803b3-afd4-5ae7-aec9-a599cba7bd27](https://cursor.com/agents/bc-a55803b3-afd4-5ae7-aec9-a599cba7bd27) | 3 to 5: layout robustness and overflow; accessibility and interaction; player and app visual rendering | Grok 4.7, xhigh effort, 500k context window | Isolated checkout at the same SHA. Playwright drove the Vite portal and player against schema-validated mocked API fixtures, because Docker was unavailable, so end-to-end specs `04`, `06`, `07` and `08` did not run. Unit tests and production builds of the portal and player did run. Report and screenshots: [cursor-areas-3-5.md](cursor-areas-3-5.md). |

Findings are merged here by root cause. Area ownership is the default authority for a finding. Documented residuals and remaining runtime uncertainties are kept visible, including FCX-02, which is a documented residual but is listed in the findings table because of its severity. No code was changed in this round; every finding’s next step is for later rounds.

Both reports were scanned for secrets, tokens, and signed URLs. None were present, and nothing has been redacted. Citations in the Codex report have been rewritten as repo-relative links against the pinned SHA. Image paths in the Cursor report have been rewritten to `screenshots/`. Paths under `/tmp/review/` are left as written; those files were on the reviewer’s disposable VM and are not in this folder.

## 2. Overall verdict

The portal shell and its feature, UI-kit and pure-logic boundaries are in reasonable shape for stage B/C. At the viewports Cursor measured (1440, 1280, 1024, 768 and 390, and 200% zoom on a 1440×900 window) the signed-in pages did not grow a sideways scrollbar. List pages drop columns and ellipsize long names; editor pages also keep the same name in a field. Dialogs are native `<dialog>` elements and still showed their footers at 1280×600. axe-core on the style guide reported no violations. Uploads, bulk actions, response validation, staging and resource cleanup were judged sound on a static reading.

The player and renderer cannot yet be considered reliable for unattended operation, and two visual failures make content unreadable under conditions the product already allows. A stalled JSON body can strand sync or heartbeat because the timeout ends when response headers arrive (FCX-01). If cached media is lost while the active publication remains in IndexedDB, the player will not fetch that publication again (FCX-02, already documented). Player information screens clip an unbroken 120-character display name at 1920×1080, and a 192×96 window clips the pairing code (FCU-01). Built-in Text, a QR caption, and a reduced-motion ticker clip a long token on every canvas that was tried, from 192×96 through 3840×2160 (FCU-02).

The other confirmed findings are bounded. In the portal, a late save completion can erase a newer draft after a tab switch (FCX-03), media and app editors drop leave protection while a save is still in flight (FCX-04), and a delayed refresh can overwrite a successful mutation (FCX-05). The player discards `Retry-After` and retries throttled requests too soon (FCX-06). Several portal surfaces ellipsize a long name and give the pointer no full value (FCU-03). The three low findings are a hidden tab scrollbar at 390 px, the wordmark sitting outside a landmark, and one tab stop leaving an open dialog for the noscript fallback (FCU-06, medium confidence).

Neither reviewer found a Critical defect. There are four High findings, five Medium, and three Low.

## 3. Findings

These are the confirmed findings from both reviewers, sorted by severity, then by owner. There was no shared root cause that required collapsing two IDs into one. FCX-02 is a documented residual; it is in this table because both the documentation and the code still leave published content unrecoverable after media-only cache loss.

| ID | Severity | Classification | Summary | Area |
|---|---|---|---|---|
| [FCU-01](cursor-areas-3-5.md#fcu-01) | High | New finding | Player information screens clip an unbroken 120-character name, and a 192×96 window clips the pairing code. | 5 — Player and app visual rendering |
| [FCU-02](cursor-areas-3-5.md#fcu-02) | High | New finding | Text, a QR caption, and a reduced-motion ticker clip a long token on every canvas that was tried. | 5 — Player and app visual rendering |
| [FCX-01](codex-areas-1-2.md#fcx-01) | High | New finding | The player’s JSON timeout ends at response headers, so a stalled body can strand sync or heartbeat indefinitely. | 2 — Player and app renderer architecture |
| [FCX-02](codex-areas-1-2.md#fcx-02) | High | Documented residual | Losing cached media while retaining the active publication cannot self-repair, even after connectivity returns. | 2 — Player and app renderer architecture |
| [FCX-03](codex-areas-1-2.md#fcx-03) | Medium | New finding | Switching screen tabs during a save allows an old completion to erase a newer draft. | 1 — Portal architecture and state |
| [FCX-04](codex-areas-1-2.md#fcx-04) | Medium | New finding | Media and app editors remove leave protection before a save has succeeded. | 1 — Portal architecture and state |
| [FCX-05](codex-areas-1-2.md#fcx-05) | Medium | New finding | `useLoad.setData()` does not invalidate an older read, so a delayed refresh can overwrite a successful mutation. | 1 — Portal architecture and state |
| [FCX-06](codex-areas-1-2.md#fcx-06) | Medium | New finding | The player discards `Retry-After` and retries throttled requests before the server’s requested delay. | 2 — Player and app renderer architecture |
| [FCU-03](cursor-areas-3-5.md#fcu-03) | Medium | New finding | Several portal surfaces ellipsize a long name and give the pointer no full value. | 3 — Layout robustness and overflow |
| [FCU-04](cursor-areas-3-5.md#fcu-04) | Low | New finding | Screen settings tabs at 390 px scroll with the scrollbar hidden. | 3 — Layout robustness and overflow |
| [FCU-05](cursor-areas-3-5.md#fcu-05) | Low | New finding | The wordmark is outside a landmark. | 4 — Accessibility and interaction |
| [FCU-06](cursor-areas-3-5.md#fcu-06) | Low | New finding | One tab stop leaves an open dialog for the noscript fallback. | 4 — Accessibility and interaction |

## 4. Cross-reviewer notes

The area split held. There are no two new findings that share a root cause, and there is no disagreement on severity.

**Codex’s hand-offs and the Cursor findings.** Codex left three items as unverified pending runtime, not as confirmed visual defects.

- Hand-off 3 (maximum-length text, an unbroken word, and long QR content, plus visibility of overflow warnings) overlaps [FCU-02](cursor-areas-3-5.md#fcu-02) and the documented QR-module residual. Cursor confirmed that an unbroken token is clipped on every canvas that was tried, that `renderApp` reported overflow, and that the app editor shows the warning banner. A 300-character QR payload was about 1.14 CSS pixels per module in a 192×96 box and about 13 px per module in a 1920×1080 box. Cursor used 192×96, 1280×384, 1920×1080, 1080×1920 and 3840×2160, not the 640×1344 and 768×448 sizes Codex named. This is supporting runtime evidence for the same problem, not a second defect.
- Hand-off 1 (media and app forms and the playlist sequence at a 1100×768 viewport with the expanded sidebar) was not specifically reproduced at that size. Cursor found no page-level horizontal overflow at 1440, 1280, 1024, 768 and 390, or at 200% zoom, and [FCU-03](cursor-areas-3-5.md#fcu-03) is about ellipsis without a pointer tooltip, not about columns overflowing the page. The exact 1100×768 case remains unverified.
- Hand-off 2 (an equal-length date change, from Monday 23 November 2026 to Friday 27 November 2026, without a resize) was not exercised. Cursor recorded a single clock rendering and a short CJK sentence that fitted at 192×96. That does not overlap any FCU finding.

**FCX-02.** Only Codex owned the unattended-player architecture, so Cursor did not re-raise the cache-loss residual. Nothing in the runtime review contradicts it.

## 5. What was judged sound

These are design choices and runtime observations without an additional demonstrated defect. See [Codex section 4](codex-areas-1-2.md#4-design-choices-judged-reasonable) and [Cursor section 4](cursor-areas-3-5.md#4-things-done-well).

- Portal structure: feature modules own page behaviour, `lib` holds reusable rules, and the shell owns session-wide presentation. A global state library was not judged necessary.
- Routing and loading: per-object keys prevent one object’s data appearing under another object’s URL. `useLoad` protects against obsolete effect completions and retains useful data after a refresh failure. FCX-05 is a separate mutation-ordering gap.
- Session and contracts: CSRF state stays in memory, responses are validated, ordinary 401s reach the session gate, and both Vite builds route bare Zod imports through `zodJitless`.
- Uploads and bulk actions: sequential uploads, cancellation, retry, and per-item outcomes, including push idempotency keys, match the documented design.
- Player publication boundary: size and hash checks, one IndexedDB activation transaction, and garbage collection that protects active, staged and currently presented media.
- Resource ownership and renderer safety: object URLs are revoked, videos and app views are disposed, operator text reaches `textContent`, and QR content is encoded as SVG geometry. No executable HTML sink was found in the reviewed production paths.
- Layout at the measured viewports: no page-level horizontal scrollbar, including at 200% zoom. `NameCell` and the organisation capsule already expose the full string to a pointer. The account menu wraps a long display name. The selection bar at 640 px held its actions. Dialogs use the native modal and returned focus to the opener.
- Player diagnostics at 390 px wrapped a 120-character value and a 64-character hex string. A moving ticker on a 1280×384 strip was a single large scrolling line. A short CJK sentence fitted at 192×96 on the reviewer’s fonts. Player colours on `#060a09` measured well above 4.5:1.

## 6. Documented residuals

FCX-02 remains the principal actionable documented residual and is in the findings table. The others should stay visible in deployment and acceptance decisions. See [Codex section 5](codex-areas-1-2.md#5-documented-residuals) and [Cursor section 5](cursor-areas-3-5.md#5-documented-residuals).

- Time rules are checked at item boundaries; clock correction is not persisted. Long items can overrun a window; an offline reload relies on the device clock.
- BroadcastChannel leadership is best effort. Without Web Locks there is no strict single-writer guarantee.
- Asset downloads are assembled in memory. Storage quota alone does not prove a large asset fits in RAM.
- Browser execution has no external supervisor or automatic machine-boot recovery. Foreground-tab operation is not equivalent to the hardware recovery targets in the acceptance tests.
- Dashboard and activity naming perform overlapping or full-list reads. A scaling cost is acknowledged; no measured performance failure was established here.
- QR modules under 2 CSS pixels have no warning. A 300-character payload in a 192×96 box will not scan. This showed up in the same rendering run as FCU-02.
- The readability floor of one twelfth of the short side is why FCU-02 clips instead of shrinking further. The portal banner for that flag is implemented and was visible.
- Pairing and slate screens are not rotated with a publication. They fill the window, which is why FCU-01 is a window-size problem, not a canvas-size problem.
- The apps list has no grid, bulk selection, or pagination. That was not exercised past a handful of rows.

## 7. Runtime evidence and limitations

Codex ran no tests. Cursor ran unit tests, production builds, and a Playwright session in an isolated environment at the same SHA. Details, commands and the screenshot index are in [section 6 of the Cursor report](cursor-areas-3-5.md#6-runtime-evidence).

**Isolated appendix (Cursor).** Ubuntu 24.04.5, Node v22.23.4, npm 10.9.9, Google Chrome. `git status --porcelain` was empty at start and at end. `npm test` (`vitest run --project unit`, vitest 5.1.0) reported 69 files, 1469 tests, 0 failed. `npm run build -w @tinnox/portal` and `npm run build -w @tinnox/player-web` both exited 0. Playwright used Chrome (`channel: 'chrome'`), portal `http://127.0.0.1:5173`, and player `http://127.0.0.1:5174`. Portal `GET /api/*` responses were fixtures checked against the Zod response schemas. Hostile strings were inside the published limits. Apps were drawn by the real `renderApp`. No browser console errors were recorded. axe-core (`@axe-core/playwright` 4.11.0) ran on the style guide and on seven signed-in pages at 1440, light theme.

**What this is not.** It is not the Playwright end-to-end suite, and nothing was uploaded, paired, or pushed through the real API. Docker was not installed, so PostgreSQL, Keycloak, the media worker, and `tests/e2e/{04-portal-details,06-stage-b,07-apps-player,08-apps-portal}.spec.ts` did not run. Dark theme and `prefers-reduced-motion` were not applied to the portal: the script called `context.emulateMedia`, which that Playwright build does not provide, and that call stopped the portal half of the run after the screenshots listed in the appendix. Reduced motion for the ticker was passed straight into `renderApp`. Logs, fixtures and geometry JSON stayed on the reviewer’s disposable VM under `/tmp/review/`.

Screenshots named in the Cursor report, plus a further 15 frames from the same run (slate and text at other sizes, 4K and narrow pairing, 1024 and 1440 screen detail, the media selection bar, the tag tooltip, and related layout checks), are in [screenshots/](screenshots/). `screen-hours-390.png` was a byte-identical copy of `screen-detail-390.png` and was not included separately.

## 8. What remains unverified

- FCX-01 was traced in the HTTP adapter and the sync and heartbeat loops. Network fault injection of a stalled JSON body was not run.
- FCX-03 and FCX-05 are high-confidence component-lifetime traces. The described response orderings (a late PATCH completion after a tab remount; a delayed GET after `setData`) were not reproduced in the browser.
- End-to-end specs `04`, `06`, `07` and `08` did not run, and no real Keycloak, Postgres, or media-worker session was exercised.
- FCU-06 is medium confidence: the focused text matched the noscript node, but the element reference was not re-checked after the run.
- Codex hand-off 1 (1100×768 with the expanded sidebar) and hand-off 2 (an equal-length date change on a mounted date app) were not specifically reproduced.
- Dark theme and portal-level reduced motion were not applied. CJK was only tried on the reviewer’s Ubuntu fonts; a signage image with no CJK face was not tested.
- A multi-day hardware soak, storage-loss recovery, and stalled-body recovery remain acceptance questions. Static resource cleanup and a short unit run cannot establish those outcomes.

## 9. Suggested focus after this round

These are decisions and later work, not patches.

- Decide recovery ownership for media-only cache loss (FCX-02): whether operator intervention is acceptable, or the player must restore the same publication without waiting for a new publication ID.
- Decide whether 192×96 is a player window the product will open, or only a content canvas letterboxed inside a larger window. That changes the scope of FCU-01’s small-window case.
- Give network-operation deadlines coverage of response-body consumption, and let `Retry-After` constrain player retries, so a stalled or throttled control loop can settle (FCX-01, FCX-06).
- Before more editors are added, agree a shared rule for pending saves, tab changes, navigation, and the ordering of `setData` against in-flight reads (FCX-03, FCX-04, FCX-05).
- Treat a schema-legal long token as something that must remain readable on a 1920×1080 canvas and on a 1280×384 strip, including under reduced motion. The overflow flag can stay; it should not be the only thing that makes the text usable (FCU-02). A related product question is whether Save should remain available after the preview has reported overflow.
- Where an ellipsis is the only visual copy of a name, give the pointer the same full value `NameCell` already exposes (FCU-03). Schedule the three low findings with related UI work: a visible tab affordance at 390 px (FCU-04), a landmark for the wordmark (FCU-05), and keeping Tab inside an open dialog (FCU-06).
- When Docker is available, run the skipped end-to-end specs. Separately, fault-inject a stalled JSON body (FCX-01), reproduce the FCX-03 and FCX-05 orderings, and, if those hand-offs still matter, check the 1100×768 editor layout and an equal-length date advance on a mounted app.

## 10. Coordinator verification notes

These notes were added after both reviewers finished. The report text in [codex-areas-1-2.md](codex-areas-1-2.md) and [cursor-areas-3-5.md](cursor-areas-3-5.md) was not edited except for the path rewrites and navigation anchors described in those files’ preambles.

**Run confirmation.** The clone at `/workspace/tinnox-cms` was detached at `6d88bafcc6cc848f8a026de227ca452592a76597` with a clean working tree when the citations below were checked. Codex CLI v0.169.0, model `gpt-6-astra`, reasoning effort `medium`, sandbox `read-only`, session `01a1e49c-0ecd-71a2-a7f5-c594b58ecd72`, finished 17 November 2026, 00:52 Australia/Melbourne. Cursor cloud agent `bc-a55803b3-afd4-5ae7-aec9-a599cba7bd27`, model Grok 4.7, xhigh effort, 500k context, report dated 17 November 2026, 01:11 Australia/Melbourne. Neither reviewer created a branch, commit, push, or pull request.

**Citation spot-check.** Eight citations were checked from each report against that SHA. All files exist, all line numbers are in range, and every checked claim is supported by the nearby source. No citation pointed at the wrong file or at code that contradicted the claim.

Codex, checked and accurate, with only minor line-number imprecision:

- `apps/player-web/src/platform/api.ts:88` is the start of `#request`; the timeout is cleared in `finally` at 111–113 when `fetch` resolves. `api.ts:47` is the start of `readJson`; the unbounded `response.text()` is at line 55. Manifest and heartbeat callers at 183 and 294 do use that sequence.
- `apps/player-web/src/core/sync.ts:267` (`await syncCycle`) and `core/heartbeat.ts:171` (`await this.sendOnce()`) match the claim that those loops wait for the whole request, including the body read.
- `apps/player-web/src/ui/presenter.ts:152` is `if (isMediaItem(asset))`; the `storage_error` throw for a missing blob is at 156–163. `core/playback.ts:267` is the `consecutiveFailures >= step.playable` branch that clears the presenter at 269.
- `apps/player-web/README.md:451` starts the eviction residual; media-only eviction is not re-downloaded until a new publication arrives, at 455–456.
- `apps/portal/src/features/displays/detail/CanvasTab.tsx:98` initialises local `saving` to false; 133–138 unconditionally clears the parent drafts and replaces the display on completion. `ScreenTabs.tsx:90` is the tab switch that remounts the form. `ScreenDetail.tsx:74` is the comment above the parent-held drafts.
- `MediaEditor.tsx:87` and `AppEditor.tsx:119` both call `useLeaveGuard(dirty && !saving, …)`. `useLeaveGuard.tsx:22` is the `shouldBlock` callback that uses that boolean; `beforeunload` is registered at 29–38.
- `useLoad.ts:98` (`setData`) only replaces React state. `useLoad.ts:65` is the start of `run`; the `disposed` check that does not see `setData` is at 68. `DisplayDetailPage.tsx:34` and `:101` wire `setData` through `onChanged`.
- `platform/api.ts:116` (`#fail`) discards the body and throws a `PlayerFault` with status only, no `Retry-After`. `docs/player-protocol-v1.md:308` is the section heading; the 429 row that requires waiting for `Retry-After` is at line 323.

Cursor, checked and accurate, with only minor line-number imprecision:

- `apps/player-web/src/styles.css:19-26` and `:117-127` set `overflow: hidden` on `html, body` and `#screen { position: fixed; inset: 0 }`. The slate `h1` clamp is at 138–142; the pairing code is `white-space: nowrap` with a `3rem` floor at 157–166.
- `apps/player-web/src/ui/screens.ts:71-76` builds the slate title from the display name; `:86-93` interpolates the name into the revoked sentence (the string ends at 93–94); `:55` is the pairing code element; `:10` records that pairing and slate screens are not rotated.
- `packages/app-render/src/render.ts:96-101` (`fitLines` tries `nowrap`, then `normal`); `:172` (`pre-line` on the text body); `:186-187` (reduced motion uses the same text block); `:311-314` (`overflow: hidden` on the root); `:363-365` (the floor is `min: short / 12` on line 365).
- `render.ts:246` is the documented shortcut that there is no warning when a QR module is under 2 canvas pixels.
- `apps/portal/src/ui/DataTable.tsx:412-416` puts `title={name}` on `NameCell`. `PageHeader.tsx:64` is the page `h1` with no `title`; `:72-76` puts `title` on the organisation capsule. `shell.css:505-509` ellipsizes the title.
- `SequenceTile.tsx:118-123` renders the tile name with `tx-truncate` and no `title`. `playlistEditor.css:214-218` sets `inline-size: 212px`. `chips.css:40-46` ellipsizes chip labels.
- `apps/portal/src/styles/controls.css:491-503` is `overflow-x: auto` with `scrollbar-width: none` and a hidden WebKit scrollbar. `Tabs.tsx:54-66` is the arrow-key handler.
- `apps/portal/index.html:22` is the `<noscript>` sibling of `#root`. `Dialog.tsx:81-83` is the comment describing `showModal()`; the call itself is at line 128.

## 11. Fixes made after this round (17 November 2026)

Sections 1 to 10 are the review record as written and are unchanged. The two player findings below were then fixed, one commit per finding. Each fix has a unit test that fails on the code as reviewed.

| ID | Change | Evidence |
|---|---|---|
| FCX-01 | The player's JSON deadline stays armed until the body is read or discarded, and the timer is cleared on every path. A caller abort reaches a body read that has already started. Manifest, heartbeat, media-URL, pairing and registration-release calls share that path. | `apps/player-web/src/platform/api.test.ts`: "rejects a stalled manifest body when the deadline elapses", "rejects a stalled heartbeat body when the deadline elapses", "rejects a stalled media-URL body when the deadline elapses", "rejects a stalled pairing body when the deadline elapses", "settles a stalled registration release when discarding the body does not finish", and "aborts a stalled body when the caller cancels, and the deadline does not fire later". On the code as reviewed the call is still pending after the 15 s deadline, and after the caller aborts. |
| FCX-06 | A 429 keeps `Retry-After` (delay-seconds or an HTTP-date). Heartbeat, manifest, media-URL, media-download and pairing retries wait at least that long, and never less than the existing backoff. The wait is capped at 10 minutes; a wake or a state change does not cut it short. `docs/player-protocol-v1.md` records that cap. A missing or unreadable header, and a 5xx answer, keep the ordinary backoff. | `apps/player-web/src/core/retry-after.test.ts`: "does not retry a heartbeat 429 before Retry-After: 30, even when woken", "does not retry a heartbeat 429 before an HTTP-date Retry-After", "does not retry a manifest 429 before Retry-After: 30, even when woken", "does not retry a manifest 429 before an HTTP-date Retry-After", "does not ask for media URLs again before Retry-After: 30", and "does not repeat a media download before an HTTP-date Retry-After". On the code as reviewed the heartbeat retries at 5 s and a woken manifest retries within 1 s. |
