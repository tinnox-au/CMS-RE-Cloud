# REA evaluation (morluto/rea) for the TINNOX CMS discovery work

Status: completed pilot on an isolated synthetic target. Date: 2026-11-03.
Environment: Claude Code cloud container (Ubuntu 24.04, Node 22.23.4, 4 vCPU, Playwright 1.63.0 with Chrome for Testing 153.0.8010.12).

Evidence labels used in this document: **DIRECTLY OBSERVED** (we ran it here), **OFFICIALLY DOCUMENTED** (REA's own README/docs at the pinned version), **INFERRED**, **PROPOSED**.

## 1. Verdict in one paragraph

REA 6.8.0 installs and runs in this environment as a project-scoped npm dependency, and its browser-observation surface works against a Chromium instance exposing a loopback-only Chrome DevTools Protocol (CDP) port. It produced content-addressed, value-redacted evidence (DOM/accessibility inventory, network request list with JSON *shapes*, script sources with hashes, screenshots with SHA-256, SPA navigation timeline, pixel diffs) that is reproducible and auditable. It is **not** a dependency for this project: everything it captured could also be captured with ordinary Playwright, and Playwright additionally drives the page and records real request/response values, which REA deliberately withholds. REA could **not** be used against app.yodeck.com from this container because the container's network policy blocks that host and no browser-takeover tool is available here (see `docs/open-questions.md`). Recommendation: keep REA as an optional, selectively used evidence tool when the Yodeck inspection is done from a machine that can reach the app; do not build any process on it.

## 2. What REA is (OFFICIALLY DOCUMENTED, v6.8.0)

| Item | Value | Source |
|---|---|---|
| Package | `rea-agents` on npm, CLI command `rea`, also an MCP server | README "Quick start" |
| Version pinned for this pilot | **6.8.0** (npm `time.modified` 2026-10-25) | `npm view rea-agents` |
| Licence | MIT | README badge, `npm view` |
| Runtime requirement | Node `^22.23.4 \|\| ^24.22.1 \|\| >=26.12.1` | `npm view rea-agents engines` |
| Linux prerequisite | procps-compatible `ps` on PATH (present here: procps-ng 4.0.4) | README "Quick start" |
| Browser surface | "attach to a user-owned Chrome-family browser through CDP and produce bounded Evidence about an existing page. This is a passive reverse-engineering capability, not a general browser automation or remote-control surface." | docs/browser-observation.md |
| Browser commands | `list-browser-targets`, `inspect-web-page`, `analyze-web-bundle`, `observe-web-session`, `discover-webmcp-tools`, `capture-web-screenshot`, `compare-web-screenshots`, `compare-web-captures`, `export-web-scripts`, `capture-browser-scenario` (Playwright-driven), `inspect-web-network-capture` (HAR/SAZ offline) | `rea --help`, docs/browser-observation.md |
| CDP endpoint rules | Only `http://127.0.0.1:PORT` or `ws://127.0.0.1:PORT/devtools/browser/ID` (or `[::1]`); `localhost`, LAN addresses, HTTPS/wss, implicit ports are rejected. "Do not expose the debugging port on a non-loopback interface." | docs/browser-observation.md "Request boundary", "Start a browser" |
| Non-goals | No generic CDP commands, no `Runtime.evaluate`, no navigation, no input, no downloads, no page/browser closure; screenshot is the only pixel surface | docs/browser-observation.md "Non-goals and threat model" |
| Data minimisation | Raw headers, bodies, cookies, storage values, WebSocket payloads are never retained; JSON/WebSocket captures keep value-free shapes; accessibility text and script sources are opt-in and may contain secrets | docs/browser-observation.md "CLI workflow", "Data minimization" |
| Limits | 64 MiB per CDP WebSocket message (`payload_limit`); observation begins at attach time (no prior activity); worker coverage attach-limited | docs/browser-observation.md |
| Native analysis engines | Hopper/Ghidra/IDA/JADX/Kuna are optional; not installed here and not needed for website work | `rea doctor` output |

Note: `npx rea-agents setup` rewrites agent configuration (`/root/.claude.json` registration, skill files). We did **not** run setup; the CLI has equivalent contracts to the MCP tools ("Every surface has equivalent CLI and MCP contracts"), so a project-scoped CLI install was sufficient and left session configuration untouched.

## 3. Compatibility check in this cloud environment (DIRECTLY OBSERVED)

| Requirement | Result |
|---|---|
| Node version | 22.23.4 satisfies `^22.23.4` |
| `ps` on PATH | yes (`/usr/bin/ps`, procps-ng 4.0.4) |
| npm registry reachable | yes (registry.npmjs.org is on the proxy's no-proxy list) |
| Install | `npm install --save-exact rea-agents@6.8.0` in a scratch project: 176 packages, 17 s, one deprecation warning (`prebuild-install`) |
| `rea doctor` | `healthy: false` solely because native engines (Hopper, Ghidra, IDA, JADX, Kuna) and the agent registration/skill are absent; node and host checks healthy |
| Chrome-family browser with CDP | Chrome for Testing 153.0.8010.12 at `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`, launched by us with `--headless=new --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir=<dedicated profile>` |
| Platform managed browser exposing CDP | **None.** This session has no browser MCP tools (no `Claude_Browser`, no `claude-in-chrome`, no `remote-devices`), no Remote Control folders, and no connectors. The only browser is the one we launch ourselves. |
| Network to app.yodeck.com | **Blocked** by the environment's network policy: `curl` gets `CONNECT tunnel failed, response 403`; Chromium gets `net::ERR_TUNNEL_CONNECTION_FAILED`; the WebFetch tool gets `getaddrinfo ENOTFOUND`. |
| MCP integration | Not registered (would require `rea setup` to edit session config). CLI used instead. |

Conclusion: the runtime and CLI are compatible; the browser connection works for a browser we own on loopback; the intended target is unreachable from this container.

## 4. Pilot on one isolated workflow (DIRECTLY OBSERVED)

Because Yodeck was unreachable, the pilot used a **synthetic, self-contained "schedule editor" page** served on `127.0.0.1:3000` by a 60-line Node script (three fake screens, a schedule form posting JSON to `/api/schedules`, a 2-second poll of `/api/screens`, `history.pushState` after save, a 422 for `priority` outside 0-100). No real product, account, or customer data was involved. Two independent capture methods were run against it.

### 4.1 REA commands and outcomes

| Step | Command (abridged) | Wall time | Outcome |
|---|---|---|---|
| Discover targets | `rea list-browser-targets http://127.0.0.1:9222` | 3.1 s | 1 page target listed; 5 non-page targets excluded; evidence `ev_ab999bb7…` |
| Passive inspect (3 s window, all opt-ins) | `rea inspect-web-page … --observation-ms 3000 --include-accessibility-text --include-console-text --include-json-body-shapes --include-script-sources --include-storage-keys` | 4.9 s | 40.5 KB evidence: 102 DOM nodes; accessibility roles for every form control (combobox "Screen", textbox "Playlist", spinbutton "Priority", button "Save schedule"); 2 polled `GET /api/screens` requests with response **shape** (`array` of objects with `id:string,name:string,status:string,pending:number,lastSeen:number`, 3 observations each) and initiator `app.js:2:42`; 1 script with SHA-256 and full source (opt-in); storage keys empty, values redacted |
| Screenshot | `rea capture-web-screenshot …` | 2.1 s | 1280×757 PNG inline (base64) with SHA-256 `77a44d20…`, 54,963 bytes |
| Static bundle | `rea analyze-web-bundle …` | 3.8 s | Endpoint candidates `/api/screens` and `/api/schedules` (`call:fetch`, with line/column); 0 route patterns; explicit coverage statement "application_routes: unknown" |
| Passive inspect while a *separate* CDP client submitted the form (10 s window) | `rea inspect-web-page … --observation-ms 10000 --include-json-body-shapes` + Playwright `connectOverCDP` driver | ~12 s | Captured `POST /api/schedules` **201** with request shape `playlist:string, priority:number, rrule:string, screenId:string, start:string, tz:string`, then a direct `POST` **422** with shape `priority:number, screenId:string`; no values retained |
| Observe navigation window (10 s) | `rea observe-web-session … --observation-ms 10000` + driver | ~11 s | Timeline: 1 `same_document_navigation` to `/schedules/sch-3`, `destination_scope: approved`, completeness `attach_limited` |
| Pixel diff | `rea compare-web-screenshots before.json after.json` (artifact objects) | 2 s | `status: different`, 2,686 of 968,960 pixels changed (0.28%), max channel delta 229 |

Everything ran with exit code 0 except one input-contract error (we first passed the whole result instead of the `artifact` object to `compare-web-screenshots`; the error message named the missing fields and the retry succeeded).

A noteworthy pilot detail: the first driver attempt set `priority=150` and clicked Save; nothing happened because the mock form's own `max=100` constraint blocked the submit event. REA correctly recorded no request. This is exactly the kind of client-side validation versus server-side validation distinction the Yodeck audit needs to make, and it shows REA will not "see" a validation failure that never leaves the browser unless accessibility text or console output reveals it.

### 4.2 Plain Playwright comparison (same page, separate headless browser)

A 30-line Playwright script navigated, recorded every request and response including **bodies**, read the form fields and rows from the DOM, took an ARIA snapshot, filled the form, clicked Save, waited for the response, and took before/after screenshots.

| Capability | REA (passive CDP) | Playwright |
|---|---|---|
| Lists form controls and roles | Yes (accessibility inventory) | Yes (`ariaSnapshot`, DOM evaluate) |
| Network request list with status | Yes | Yes |
| Request/response **values** | No (shapes only, by design) | Yes (full POST body `{"screenId":"scr-1",…,"priority":10}` and response `{"id":"sch-1","state":"unpublished"}`) |
| Drive the UI (fill, click, navigate) | No (non-goal) | Yes |
| Screenshot | Yes, with SHA-256 and size, inline base64 | Yes, file |
| Pixel diff | Yes (built-in, bounded) | Needs an extra library (e.g. pixelmatch) |
| Script source with hash | Yes (opt-in) | Possible via response capture; no hashing without code |
| Evidence provenance, explicit limitations, completeness flags | Yes, on every result | No; you write your own log |
| Static endpoint candidates from bundle | Yes | No |
| Attach to an already-open, already-authenticated browser | Yes, if that browser exposes loopback CDP | Yes (`connectOverCDP`) |
| Risk of exfiltrating customer data into notes | Lower (values redacted unless opted in) | Higher (bodies captured verbatim) |

Interpretation (INFERRED): REA's value for a *workflow* audit is the evidence discipline (hashes, value-free shapes, stated limitations, before/after comparisons), not unique access. Playwright's value is interaction and seeing real payloads, which matter for understanding validation rules and state transitions. For a discovery exercise on a third-party SaaS that may hold live customer data, REA's default redaction is a genuine advantage; for understanding exact state machines, Playwright or the browser DevTools Network panel is needed.

## 5. How REA would be used against Yodeck, if access is arranged (PROPOSED)

1. On a machine that can reach app.yodeck.com, start a **dedicated** Chrome profile with `--remote-debugging-port=9222` (loopback only, never `--remote-debugging-address=0.0.0.0`), sign in there with MFA as the human operator, and never share the profile directory.
2. Use REA only for: `inspect-web-page` with `--include-json-body-shapes` (API shapes without values), `capture-web-screenshot` for sanitised screenshots, `observe-web-session` for navigation timing, and `compare-web-screenshots` for before/after states of an isolated test workspace. Do not enable `--include-accessibility-text`, `--include-console-text` or `--include-script-sources` on pages showing customer names, media or settings unless the capture is reviewed and redacted before it enters any deliverable.
3. Do **not** use `export-web-scripts`, `recover-javascript-sources` or `analyze-javascript-application` on Yodeck's bundles. The task is to observe workflows, not to reconstruct proprietary code, and Yodeck's terms of service likely restrict reverse engineering (not verified here; see `docs/open-questions.md`).
4. Compare each REA capture with the ordinary DevTools/Playwright view of the same action once, as done in this pilot, before relying on it for a workflow.
5. Record the REA version and evidence IDs in the evidence index of `docs/yodeck-workflow-audit.md`.

## 6. Limitations recorded during the pilot

- Observation starts at attach; nothing before attach is available (OFFICIALLY DOCUMENTED, confirmed by `prior_activity_available: false`).
- `observe-web-session` keeps navigation metadata only; it does not list requests (OFFICIALLY DOCUMENTED; confirmed).
- Attachment state of targets is reported as unknown under HTTP discovery (observed `attached: null`).
- Passive capture enables the `Debugger` domain; a page with a `debugger` statement could pause. Not encountered.
- CDP gives the attached client deep access to the whole profile. A dedicated profile is mandatory (OFFICIALLY DOCUMENTED).
- The CLI's `capture-browser-scenario` (Playwright-driven, provider-owned browser) was not piloted because the plain Playwright script already covered interaction; it should be evaluated only if a reproducible scripted scenario against the test workspace is needed later.
- Throughput: each command re-attaches and takes 2-5 s; fine for dozens of captures, slow for hundreds.

## 7. Decision

| Option | Decision |
|---|---|
| Make REA a project dependency | **No.** Keep it out of `package.json` of the product. |
| Use REA for the Yodeck audit | **Optional, selective**, from a machine with access; pinned to 6.8.0 (or the then-current release after re-checking the browser docs). |
| Install native binary-analysis engines | **No**; no task requires them. |
| Replace REA with Playwright | For interaction and payload capture, yes; for sanitised evidence, either is acceptable with the review step in section 5. |

## 8. Pilot artefacts

Kept in the session scratch area (not committed, no product data): synthetic server script, Chromium profile, REA JSON evidence files (`targets`, `inspect`, `inspect2`, `shot`, `shot2`, `bundle`, `observe`, `observe2`, `shotcmp2`), decoded PNGs, and the Playwright `result.json` with before/after PNGs. Evidence IDs: `ev_ab999bb7…`, `ev_06fa1c99…`, `ev_b66f1494…`, `ev_a84bf1c6…`, `ev_b8dd1d1e…`, `ev_23673dcc…`, `ev_9e55ffed…`, `ev_18b2394c…`.
