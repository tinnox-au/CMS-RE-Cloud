# Codex report — areas 1 and 2

Date: 17 November 2026, Australia/Melbourne (UTC+11).

| Item | Value |
|---|---|
| Reviewer | Codex CLI v0.169.0, model `gpt-6-astra`, reasoning effort medium, sandbox read-only |
| Baseline | `6d88bafcc6cc848f8a026de227ca452592a76597` (`main`) |
| Date of report | 17 November 2026, 00:52 (Australia/Melbourne) |
| Method | Read-only static review of areas 1 and 2. No tests run (dependencies were not installed). No files written, no GitHub access. |
| Path edits | Links of the form `/workspace/tinnox-cms/path:line` have been rewritten as repo-relative `../../../path#Lline` links, relative to `docs/reviews/2026-11-17-frontend-round-2/`. Finding anchors (`fcx-01` and so on) were added for navigation. The report text is otherwise unchanged. |
| This file | The report text below is from the reviewer’s final message. |
| Consolidated summary | [README.md](README.md) |

---

# TINNOX CMS — Round 2 frontend review

Reviewer A: Codex · Areas 1–2 · Static review

## 1. Baseline and methods

Reviewed **`6d88bafcc6cc848f8a026de227ca452592a76597`** only. The detached checkout matched that SHA before and after review; `git status --short` was empty.

Scope: portal architecture/state, browser-player architecture, and shared app-renderer implementation. Backend implementation, browser layout testing, accessibility testing and visual rendering verification were excluded.

Method:

- Read the binding architecture, protocol, portal design and stage documentation, relevant UI-kit guidance, acceptance criteria and restyle-mockup source.
- Traced routing, loading, mutations, drafts, uploads, bulk operations, session handling, player lifecycle, staging, storage, playback and renderer disposal.
- Inspected relevant existing test source and searched for injection sinks, storage access and resource lifecycle handling.
- No dependencies were installed. Dependencies were absent from the reviewed workspaces, so **no tests were executed**.
- No browser, Docker, branch, commit, product-code change or report file was created.

All code citations below refer to the pinned checkout. Evidence is static code tracing, not runtime reproduction. Historical test results in repository documentation were not independently verified.

## 2. Short assessment of areas 1–2

**Portal:** The feature, shell, UI-kit and pure-logic boundaries are useful and generally consistent. Lazy routes, per-object remounting, response validation, explicit partial outcomes and shared draft helpers provide a reasonable foundation for stage B/C. The main weakness is asynchronous ownership: request completion, saved data and draft state do not always share the same lifetime or ordering guarantees.

**Player and renderer:** The separation between core loops, platform adapters and DOM presentation is clear. Staging and atomic activation are carefully implemented; media and app resources generally have explicit cleanup. However, the player cannot yet be considered reliable for unattended operation over days: a stalled JSON body can strand a loop, and the documented cache-loss recovery gap can leave published content unavailable indefinitely.

**Findings:** two High, four Medium; no Critical finding established.

## 3. Prioritized findings

<a id="fcx-01"></a>
### FCX-01 — High · New finding
**The player’s JSON timeout ends at response headers, allowing a stalled body to strand sync or heartbeat indefinitely.**

**Trigger:** A manifest or heartbeat request receives HTTP 200 headers promptly, then its JSON body stops arriving without closing the connection. For example, a proxy sends headers and a partial body before its upstream stalls.

**Evidence:** [`platform/api.ts:88`](../../../apps/player-web/src/platform/api.ts#L88) starts a timeout around `fetch`, but clears it in `finally` as soon as `fetch` resolves. Body consumption occurs afterward through the unbounded `response.text()` at [`platform/api.ts:47`](../../../apps/player-web/src/platform/api.ts#L47). Manifest and heartbeat callers use that sequence at lines 183 and 294.

The sync loop awaits the whole cycle before scheduling another attempt ([`core/sync.ts:267`](../../../apps/player-web/src/core/sync.ts#L267)); heartbeat likewise awaits `sendOnce()` ([`core/heartbeat.ts:171`](../../../apps/player-web/src/core/heartbeat.ts#L171)). Their wake mechanisms interrupt sleeps, not the pending body read. Credentialed JSON calls also do not receive the session abort signal.

**Consequence and scope:** One stalled manifest response prevents subsequent publications from being downloaded. One stalled heartbeat response stops reporting and server-clock correction. Existing cached playback can continue, concealing the failed control loop until an operator notices. Pairing and media-URL responses use the same body-reading pattern.

**Confidence:** High in the code trace; network fault injection was not run.

**Required property:** Network-operation deadlines must cover response-body consumption, and lifecycle cancellation must reach pending operations. A stalled response must eventually settle so recovery/backoff can proceed.

---

<a id="fcx-02"></a>
### FCX-02 — High · Documented residual
**Losing cached media while retaining the active publication cannot self-repair, even after connectivity returns.**

**Trigger:** Play a publication containing one JPEG, then lose that asset’s Cache Storage entry while retaining the registration and `activeVersion` in IndexedDB. The server continues to desire the same publication.

**Evidence:** A missing blob becomes `storage_error` at [`ui/presenter.ts:152`](../../../apps/player-web/src/ui/presenter.ts#L152). When every playable item fails, playback clears the presenter and retries later ([`core/playback.ts:267`](../../../apps/player-web/src/core/playback.ts#L267)).

Sync sends the retained active publication ID, treats 304 as up to date, and also skips staging if a 200 response repeats that ID ([`core/sync.ts:54`](../../../apps/player-web/src/core/sync.ts#L54), lines 71 and 100). Retrying playback therefore never repairs the missing asset.

This exact limitation is acknowledged in [`apps/player-web/README.md:451`](../../../apps/player-web/README.md#L451): media-only eviction is reported, but assets are not downloaded again until a new publication arrives.

**Consequence and scope:** A one-item publication remains unplayable indefinitely; a mixed publication repeatedly skips missing items. Reconnecting or reloading with the same surviving IndexedDB state does not resolve it. This matters directly to unattended operation under storage pressure.

**Confidence:** High; explicit documentation and matching code trace.

**Required property:** Local completeness must remain independently verifiable after activation. A player must be able to restore its currently desired publication without requiring a content change merely to obtain a different publication ID.

---

<a id="fcx-03"></a>
### FCX-03 — Medium · New finding
**Switching screen tabs during a save allows an old completion to erase a newer draft.**

**Trigger:**

1. On a screen’s Canvas tab, change width from `1920` to `1280` and save.
2. Delay the PATCH response.
3. Switch to Overview, then back to Canvas.
4. Change width to `1024`.
5. Let the original save return successfully with width `1280`.

**Evidence:** Drafts live in the parent page ([`ScreenDetail.tsx:74`](../../../apps/portal/src/features/displays/detail/ScreenDetail.tsx#L74)), but the selected tab renders a different component type, unmounting the previous form ([`ScreenTabs.tsx:90`](../../../apps/portal/src/features/displays/detail/ScreenTabs.tsx#L90)).

`CanvasTab` owns `saving` locally, initialized to false on each mount. Its original promise remains alive and unconditionally invokes parent callbacks to clear both drafts and replace the display ([`CanvasTab.tsx:98`](../../../apps/portal/src/features/displays/detail/CanvasTab.tsx#L98), lines 133–138). Consequently, the remounted form accepts `1024`, then the old completion removes it.

Tags and Working hours use the same local-busy/parent-draft pattern ([`TagsTab.tsx:23`](../../../apps/portal/src/features/displays/detail/TagsTab.tsx#L23), [`WorkingHoursTab.tsx:44`](../../../apps/portal/src/features/displays/detail/WorkingHoursTab.tsx#L44)).

**Consequence and scope:** New unsaved input disappears and the screen can appear saved. Switching tabs also permits another save while the original request remains pending.

**Confidence:** High in the component-lifetime trace.

**Required property:** Mutation ownership and draft reconciliation must survive tab changes. A completion may settle only the draft revision it submitted; it must not clear later input.

---

<a id="fcx-04"></a>
### FCX-04 — Medium · New finding
**Media and app editors remove leave protection before a save has succeeded.**

**Trigger:** Change a media name from `Poster` to `Summer poster`, click Save over a slow connection, then select another sidebar page while the request is pending. Have the save fail with a network error or server refusal. The same sequence applies to an app editor.

**Evidence:** Both editors explicitly call `useLeaveGuard(dirty && !saving, …)`:

- [`MediaEditor.tsx:87`](../../../apps/portal/src/features/media/detail/MediaEditor.tsx#L87)
- [`AppEditor.tsx:119`](../../../apps/portal/src/features/apps/AppEditor.tsx#L119)

The shared guard only blocks navigation and registers `beforeunload` while its boolean argument is true ([`useLeaveGuard.tsx:22`](../../../apps/portal/src/features/shared/useLeaveGuard.tsx#L22)). Save failures are stored in the editor’s local state; after navigation that editor and its draft are gone.

The binding editor pattern requires confirmation when leaving unsaved changes ([`design-system.md:204`](../../../docs/portal-v2/design-system.md#L204)).

**Consequence and scope:** A failed save can lose the draft without confirmation or a visible failure message. The issue affects media and app editing, including ordinary in-portal navigation during a pending save.

**Confidence:** High.

**Required property:** A pending save must not be treated as durable success. Draft protection or recoverable draft ownership must remain until the outcome is known.

---

<a id="fcx-05"></a>
### FCX-05 — Medium · New finding
**`useLoad.setData()` does not invalidate an older read, so a delayed refresh can overwrite a successful mutation.**

**Trigger:** On a screen detail page:

1. Complete pairing or revocation, which starts a display refresh.
2. Hold the GET response containing name `Lobby`.
3. Save the name as `Reception`, allowing that PATCH response to arrive first.
4. Release the earlier GET response.

**Evidence:** Player changes call `onReload()` ([`ScreenDetail.tsx:98`](../../../apps/portal/src/features/displays/detail/ScreenDetail.tsx#L98)). Successful edits flow through `onChanged` into `useLoad.setData()` ([`DisplayDetailPage.tsx:34`](../../../apps/portal/src/features/displays/DisplayDetailPage.tsx#L34), line 101).

`setData` only replaces React state. It neither invalidates nor cancels the pending loader ([`useLoad.ts:98`](../../../apps/portal/src/hooks/useLoad.ts#L98)). The older loader subsequently passes its unchanged `disposed` check and replaces that state again ([`useLoad.ts:65`](../../../apps/portal/src/hooks/useLoad.ts#L65)).

**Consequence and scope:** The page reverts to `Lobby` after reporting a successful save of `Reception`, while the server retains `Reception`. Screen details do not continuously reload the full display DTO, so this false state can persist. Subsequent edits can be based on stale values. Any caller combining `setData` and overlapping reads inherits the same hazard.

**Confidence:** High for the specified response ordering.

**Required property:** Read and mutation results need a shared ordering rule. Reads started before an accepted mutation must not overwrite its newer result.

---

<a id="fcx-06"></a>
### FCX-06 — Medium · New finding
**The player discards `Retry-After` and retries throttled requests before the server’s requested delay.**

**Trigger:** Return HTTP 429 with `Retry-After: 600` to a player manifest or heartbeat request.

**Evidence:** The HTTP adapter reduces non-success responses to a `PlayerFault` containing status and a generic message; it does not retain `Retry-After` ([`platform/api.ts:116`](../../../apps/player-web/src/platform/api.ts#L116)).

Sync then uses its ordinary network backoff, starting at five seconds ([`core/sync.ts:17`](../../../apps/player-web/src/core/sync.ts#L17)). Heartbeat also computes ordinary backoff after failure ([`core/heartbeat.ts:174`](../../../apps/player-web/src/core/heartbeat.ts#L174)). Neither can honour the discarded header.

The protocol explicitly requires waiting for `Retry-After` on 429 ([`player-protocol-v1.md:308`](../../../docs/player-protocol-v1.md#L308)).

**Consequence and scope:** Players issue avoidable requests throughout the server’s refusal period. Across multiple devices this increases load during throttling and makes recovery behaviour diverge from the protocol. Cached playback continues; this is not a playback-outage finding.

**Confidence:** High.

**Required property:** Throttling metadata must survive the transport boundary and constrain retry scheduling.

## 4. Design choices judged reasonable

These are **By design** observations, without an additional demonstrated defect.

- **Portal structure:** Feature modules own page behaviour; `lib` contains reusable draft, selection, filtering and outcome rules; the shell owns session-wide presentation state. Adding a global state library is not inherently necessary.
- **Routing and loading:** Per-object keys prevent one object’s retained data appearing under another object’s URL. `useLoad` protects against obsolete effect completions, retains useful data after refresh failures and polls sequentially. FCX-05 concerns the separate mutation-ordering gap.
- **Session and contracts:** The API client keeps CSRF state in memory, validates responses, reports ordinary 401s to the session gate and attempts one recovery for an explicit CSRF rejection. Ordinary forbidden responses remain actionable errors. Both Vite builds route bare Zod imports through `zodJitless`.
- **Uploads and bulk actions:** Sequential uploads match the documented design. Cancellation, retry and list refresh acknowledge uncertain outcomes. Bulk operations preserve per-item successes and failures; push has explicit idempotency-key and partial-batch handling.
- **Player publication boundary:** Downloads are size/hash checked and probed before one IndexedDB activation transaction. Garbage collection protects active, staged and currently presented media. These are appropriate boundaries for immutable publications.
- **Resource ownership:** Media layers revoke object URLs; videos are explicitly released; app views dispose timers, observers and animations. Core sleep removes completed abort listeners. The reviewed loops do not accumulate playback history or offline heartbeat queues.
- **Renderer safety:** Operator text reaches `textContent`; QR content is encoded into numeric SVG geometry rather than interpreted as markup. No executable HTML sink was found in the reviewed production paths.
- **Renderer determinism:** Time and zone are explicit inputs, and formatting/QR helpers are separated from DOM measurement. Layout is necessarily browser-dependent. System fonts avoid a remote-font-loading dependency, but do not promise identical metrics across operating systems.
- **Planned sections:** `planned/*` is intentional, routed scope communication. Its presence is not evidence of abandoned code. The development-only styleguide is explicitly excluded from production.

## 5. Documented residuals

**FCX-02 remains the principal actionable documented residual.** Its acknowledgement does not reduce its consequence for unattended use.

Other documented boundaries should remain visible in deployment and acceptance decisions:

| Boundary | Documentation and implementation | Assessment |
|---|---|---|
| Time rules are checked at item boundaries; clock correction is not persisted | [`stage-b.md:176`](../../../docs/portal-v2/stage-b.md#L176), [`stage-b.md:608`](../../../docs/portal-v2/stage-b.md#L608); [`core/playback.ts:174`](../../../apps/player-web/src/core/playback.ts#L174), [`app.ts:365`](../../../apps/player-web/src/app.ts#L365) | **By design observation.** Long items can overrun time boundaries; offline reload relies on the device clock. These are explicit limits, not exact-time scheduling guarantees. |
| BroadcastChannel leadership is best effort | [`player-web/README.md:342`](../../../apps/player-web/README.md#L342); [`platform/leader.ts:53`](../../../apps/player-web/src/platform/leader.ts#L53) | **Documented residual observation.** Without Web Locks, the implementation does not provide a strict single-writer guarantee. Browser capability requirements matter. |
| Asset downloads are assembled in memory | [`player-web/README.md:458`](../../../apps/player-web/README.md#L458); [`core/download.ts:53`](../../../apps/player-web/src/core/download.ts#L53) | **Documented residual observation.** Large permitted assets require hardware memory validation; storage quota alone does not establish that a download fits RAM. |
| Browser execution has no external supervisor or automatic machine boot recovery | [`player-web/README.md:464`](../../../apps/player-web/README.md#L464); [`src/index.ts:23`](../../../apps/player-web/src/index.ts#L23) | **By design observation.** Foreground-tab operation and local failure UI are not equivalent to the hardware recovery targets in acceptance tests. |
| Dashboard and activity naming perform overlapping/full-list reads | [`stage-a.md:231`](../../../docs/portal-v2/stage-a.md#L231); [`useDashboardData.ts:63`](../../../apps/portal/src/features/dashboard/useDashboardData.ts#L63) | **Documented residual observation.** A scaling cost is acknowledged. No measured performance failure was established here. |

## 6. Hand-offs to reviewer B

These are **Unverified pending runtime** checks, not confirmed visual defects.

- **Editor width near the desktop breakpoint.** At a `1100×768` viewport with the expanded sidebar, inspect media/app forms and the playlist sequence with long names. The breakpoint uses viewport width while columns impose substantial minimum widths: [`styles/layout.css:111`](../../../apps/portal/src/styles/layout.css#L111), [`playlistEditor.css:34`](../../../apps/portal/src/features/playlists/editor/playlistEditor.css#L34). Evidence needed: document overflow measurements and whether inputs/actions remain reachable.
- **Equal-length date changes.** The renderer refits only when text length changes ([`render.ts:103`](../../../packages/app-render/src/render.ts#L103)). Advance a mounted long-date app from Monday 23 November 2026 to Friday 27 November 2026 without resizing, particularly on portrait/narrow canvases. Equal character counts do not imply equal letter widths. Evidence needed: measured overflow and warning behaviour before/after the change.
- **Text clipping and QR density.** Exercise maximum-length text, an unbroken word and long QR content on `640×1344`, `768×448` and a wide-strip canvas. Clipping below the font floor and no small-module warning are documented ([`stage-b.md:517`](../../../docs/portal-v2/stage-b.md#L517), [`stage-b.md:538`](../../../docs/portal-v2/stage-b.md#L538)). Evidence needed: preview/player agreement, visibility of overflow warnings and actual QR readability.

## 7. Open questions

1. **Supported kiosk browsers:** Will Web Locks, persistent storage and foreground operation be deployment requirements?
2. **Recovery ownership:** Is operator intervention after media-only cache loss acceptable, or must the player recover the same publication autonomously?
3. **Mutation ownership:** Before adding more editors, what shared rule will govern pending saves, navigation and newer draft revisions?
4. **Acceptance evidence:** Who owns stalled-body fault injection, storage-loss recovery tests and a multi-day hardware soak? Static resource cleanup and historical short runs cannot establish those outcomes.
5. **Scheduling expectations:** Are documented boundary overruns and offline clock limitations acceptable for initial deployments, particularly where an availability deadline is operationally significant?