# Open questions, blockers and assumptions

Date: 2026-11-03. This file lists what could not be verified in this session, what is assumed in the other documents, and who can resolve each item. It is the honest boundary of the discovery work.

## 1. Blockers encountered in this session (facts)

| # | Blocker | Evidence | What unblocks it |
|---|---|---|---|
| B1 | **No authenticated inspection of app.yodeck.com was possible.** The container's network policy denies the host (`CONNECT tunnel failed, response 403` from curl, `net::ERR_TUNNEL_CONNECTION_FAILED` from Chromium, `getaddrinfo ENOTFOUND` from the fetch tool), and the session has no browser-takeover tool (no browser pane, no Remote Control folder, no connector). Every Yodeck statement in `docs/yodeck-workflow-audit.md` is therefore OFFICIALLY DOCUMENTED, THIRD PARTY or INFERRED, never DIRECTLY OBSERVED. | Capability checks in the session log; `docs/rea-evaluation.md` section 3 | Either (a) a session run from the Claude Desktop app or `claude remote-control` on a machine where the operator signs in with MFA in a browser pane, or (b) screenshots and a walkthrough recording of the account's key screens, or (c) sanitised exports (screens CSV, API responses with identifiers only). The minimum useful input is (b) for the ten workflow areas plus (c) for the API shapes. |
| B2 | **Public documentation sites were unreachable from the container** (yodeck.com, help.yodeck.com, tinnox.com.au, xibosignage.com, novastar.tech, brightsign.biz and others). Facts came from search-engine summaries of those pages and from GitHub-hosted mirrors and client code. | Host probes in the session log | Add the hosts to the environment's Allowed domains (environment menu, Edit; see https://code.claude.com/docs/en/cloud-environments#network-access), then re-run the documentation pass to upgrade snippet-level findings to full-page reads. |
| B3 | **Web search is capped at 200 calls per turn shared by all agents.** Two Yodeck areas (media, playlists) and parts of the hardware and Xibo research ran after the cap was hit and relied on GitHub sources only. | Agent reports; search logs in the research files | A follow-up turn re-runs those areas with search available (the cap resets per turn). |
| B4 | **Push to GitHub failed with 403.** Claude has no GitHub access to tinnox-au/CMS-RE-Cloud. Commits exist locally on `claude/fervent-rubin-cvgbnc`. | `git push` output | Reconnect GitHub or install the Claude GitHub App on the repository at https://claude.ai/connect-github. |
| B5 | **The repository is empty.** No existing stack, conventions or code to respect. | `git log` shows no commits; no remote branches | None; the architecture document chooses a stack on evidence instead. |
| B6 | **No test workspace or test player was designated**, so no write operations against Yodeck were attempted and none are needed until B1 is resolved. | Brief section 4 | When B1 is resolved, designate an isolated test workspace and a test player; routine tests then proceed within them without further prompts. |

## 2. Questions only TINNOX can answer

| # | Question | Why it matters | Document affected |
|---|---|---|---|
| Q1 | Which CMS is sold with TINNOX hardware today, under what commercial terms, and how many screens run on it? Is it Yodeck (the reference account suggests so), a NovaStar cloud product, or a Xibo-based player from DSDevices? | Determines the migration path, the interim white-label option and whether current customers must be moved | tinnox-context, architecture-and-hardware, backlog |
| Q2 | Exact deployed controllers and players per site (make, model, firmware, mode), per the hardware questionnaire in `docs/architecture-and-hardware.md` section 3 | Chooses the LED integration route and the pilot site | architecture-and-hardware, acceptance-tests |
| Q3 | What does "DsDevice" refer to? The only plausible public match is DSDevices, a vendor of Android players built for Xibo. | If it is DSDevices, the current content path is likely Android box → HDMI → NovaStar sync controller, and the box could be reused as a TINNOX player | tinnox-context, architecture-and-hardware |
| Q4 | Has any vendor granted TINNOX documented API or SDK access (NovaStar VNNOX Open Platform AppKey and region, NovaStar .NET SDK under NDA, Huidu SDK key, Samsung or LG partner programme)? | Converts THIRD PARTY integration findings into supported ones | architecture-and-hardware |
| Q5 | Brand assets: logo, colours, typography, tone | Interface design for the portal and console | mvp-spec |
| Q6 | Target customers for the first release: the four scenarios in the brief, or a specific pilot customer and site? Does TINNOX operate in New Zealand (adds Pacific/Auckland)? | Scopes the pilot and the time-zone list | mvp-spec, backlog |
| Q7 | Commercial model for the CMS: per screen per month, bundled with hardware, or tiered? Does TINNOX want self-serve sign-up or operator-provisioned customers only? | Decides whether billing, plans and quotas are in the first release (the spec assumes operator-provisioned customers and no in-product billing) | mvp-spec, backlog |
| Q8 | Support model: is TINNOX staff access to customer accounts acceptable to customers by default (opt-out) or must each customer opt in? What audit retention does TINNOX want (the spec assumes 2 years)? | Support access design | mvp-spec, acceptance-tests |
| Q9 | Hosting preference: a specific cloud provider, Australian region requirement, existing accounts, any customer with data-sovereignty obligations (councils, schools)? | Stack and cost | architecture-and-hardware |
| Q10 | Appetite for owning player hardware images (Raspberry Pi) versus buying commercial Android boxes, and whether a fanless commercial Compute Module 5 carrier is acceptable for outdoor pylon enclosures | Pilot hardware purchase | architecture-and-hardware |
| Q11 | Are documents (PDF, PowerPoint) and web pages required in the first release, or are images and video enough for the pilot customers? | Media processing scope | mvp-spec, backlog |
| Q12 | Is a Yodeck data migration required (media, playlists, schedules) for existing customers? Yodeck's API does not return original uploaded files, only transcoded renditions, so originals would have to be re-collected (THIRD PARTY). | Migration effort | backlog |

## 3. Questions for Yodeck inspection (once access exists)

These are the items the documentation pass could not settle and that a read-only session in the account would answer quickly. Each is phrased so that the answer can be recorded as DIRECTLY OBSERVED.

| # | Question | Area |
|---|---|---|
| Y1 | Which plan is the reference account on, and which features are hidden by plan rather than absent (Workspaces, Custom Roles, Audit Log, 2FA enforcement, API)? | Accounts |
| Y2 | What the Screens list shows for delivery state: does the UI expose download progress per screen, "Possibly Outdated / Not Updated" flags, and when exactly a push is confirmed? | Publishing |
| Y3 | Screenshot cadence and whether screenshots are on demand, periodic, or both; what the Status tab shows (storage, temperature, uptime, network) | Monitoring |
| Y4 | Playback report fields, aggregation and export format; the "5-minute segments" condition mentioned in the help article | Reporting |
| Y5 | Media upload limits (file size, resolution), accepted document types, where processing errors are shown, and whether originals can be downloaded in the UI | Media |
| Y6 | Transition types and where they are set; minimum and maximum item durations | Playlists |
| Y7 | Layout editor: custom resolution entry, fit modes per region, how the preview is rendered for a non-16:9 canvas and portrait | Layouts |
| Y8 | Schedule editor: how overlapping events and priorities are displayed, the time-zone label shown on events, behaviour on the first Sunday of October and April (can be checked with the preview, not the player) | Scheduling |
| Y9 | Offline behaviour indicators: "offline since", cutoff warnings, the 30 to 40 day limit | Offline |
| Y10 | What the Audit Log records and whether partner "Support Login" entries are visible to the customer | Support |
| Y11 | The API documentation at app.yodeck.com/api-docs (login-gated): confirm endpoints, rate limits (21 requests per 10 seconds reported by third parties), token scopes | API |

Policy for that session (PROPOSED, from the brief): read-only; no publishing, schedule changes, restarts, deletions, invitations, billing or account-setting changes; writes only inside a designated test workspace and test player; synthetic media; captured evidence reviewed for customer data before it enters any document; no replay of captured requests; no export or decompilation of Yodeck's application bundles.

## 4. Assumptions made in the deliverables (PROPOSED unless stated)

| # | Assumption | Where used |
|---|---|---|
| A1 | TINNOX wants an owned product, not a re-branded service; an interim white label is a bridge at most | tinnox-context section 5, architecture section 7 |
| A2 | Customers are provisioned by TINNOX operators; no self-serve sign-up, plans or billing in the first release | mvp-spec, backlog |
| A3 | Player platforms for the first release are Linux on Raspberry Pi 5 class hardware (LED walls, pylons, non-touch LCD) and Android device-owner (touch kiosks); no SoC display apps, no BrightSign, no Windows | architecture section 6 |
| A4 | The LED controller is treated as an HDMI sink; brightness, power and panel health are separate, optional adapters | architecture section 1 and 5 |
| A5 | Schedules are stored as wall-clock rules with an IANA zone per site, with RFC 5545 gap and overlap semantics (skip non-existent times, run the first of repeated times) unless a customer configures otherwise | mvp-spec, acceptance-tests SCH-02 and SCH-03 |
| A6 | Interactive kiosks, live video, synchronised playback, advertising billing and a widget catalogue are separate scope decisions, out of the first release | mvp-spec section 9 |
| A7 | First-release media types are images, video, and optionally PDF converted to images; audio is out of scope | mvp-spec |
| A8 | Hosting in an Australian region with object storage and PostgreSQL; identity provider with MFA | architecture section 8 |
| A9 | The TINNOX operations console and the customer portal are one application with role-separated surfaces, not two deployments | mvp-spec |
| A10 | Pilot scale is 10 to 50 displays; the data model and isolation design must not need rework at 500 | mvp-spec, backlog |
| A11 | The timing targets in the acceptance tests (heartbeat 60 s, pairing 30 s, boot to playback 90 s, screenshot 15 s) are release targets to be confirmed on the pilot hardware, not measured facts | acceptance-tests |
| A12 | Yodeck's terms of service restrict reverse engineering of its software; the investigation observes workflows and public documentation only and copies no code or assets. The terms were not read in this session (host unreachable). | rea-evaluation section 5 |

## 5. Items marked UNVERIFIED that need hardware

- Raspberry Pi 5 HDMI handshake with a NovaStar sending card at a custom canvas, with and without a custom EDID.
- Chromium hardware video decode on Raspberry Pi 5 at 4K HEVC; mpv as fallback.
- Portrait 2160×3840 throughput on Pi 5.
- Power-cut recovery with an overlay read-only root, repeated 20 times.
- Silent APK install on the chosen Android SKU with Play Protect present.
- Any reverse-engineered LAN protocol for NovaStar controllers (TCP 5200 registers, Taurus TCP 16606) on the actual firmware, read-only commands only.
- LED controller behaviour with HDCP-flagged sources.

## 6. Next actions in order

1. TINNOX resolves B4 (GitHub access) so the documents can be pushed, and answers Q1 to Q4.
2. TINNOX resolves B1 (a desktop-app or remote-control session with the operator signed in) and designates a test workspace and test player; the read-only inspection then records DIRECTLY OBSERVED answers to Y1 to Y11 and upgrades the audit.
3. A follow-up turn re-runs the media and playlist documentation areas with web search available (B3) and, if B2 is resolved, reads the official pages in full.
4. The pilot hardware is ordered per `docs/architecture-and-hardware.md` section 6 and the week-one hardware risks are retired before any portal work that depends on them.
