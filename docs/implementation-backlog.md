# TINNOX CMS implementation backlog

Date: 2026-11-03. Status: PROPOSED. Priorities: **P0** = needed for the first pilot milestone, **P1** = needed for the first customer release, **P2** = later. Sizes are relative (S under a week for one engineer, M one to three weeks, L more than three weeks) and are estimates, not commitments. Every item references the specification section it implements and the acceptance tests that prove it.

## 0. Smallest practical milestone: "one display, one site, honest states"

Goal: a single TINNOX test customer with one site in Australia/Sydney, one Raspberry Pi 5 player feeding an LED controller at a custom canvas (or a 1080p monitor if the controller is not yet available), an operator who provisions it, and a customer editor who uploads an image and a video, builds a playlist, schedules it, publishes it, and watches it move through pending, downloading, downloaded and playing, with a screenshot proving it. The player survives a power cut and a 24-hour outage. Duration estimate: 8 to 10 weeks for two engineers after the pilot hardware arrives.

Exit criteria: acceptance tests PRV-01, PRV-05, MED-01, MED-02, MED-03, PL-01, SCH-01, SCH-02 (simulator), PUB-02, PUB-03, PUB-04, PUB-05, OFF-01, OFF-03, MON-01, MON-02, ISO-01, ISO-02 pass; E2E-01 passes in the simulator and on the pilot hardware.

## 1. Epics and stories

### Epic A: Platform foundation (P0)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| A1 | Repository layout, CI, environments (dev, pilot), infrastructure as code for an Australian region: compute, PostgreSQL, object storage, queue, DNS and TLS | M | 17 | NF-04, NF-05 |
| A2 | Tenancy data model with customer id on every row and PostgreSQL row-level security; tenant context middleware; 404-on-foreign-object behaviour | M | 5, 10 | ISO-01 to ISO-03 |
| A3 | Identity: user accounts, MFA (TOTP), sessions, password reset, service tokens with roles, operator accounts separate from customer users | M | 6.1, 8, 16 | ISO-05, NF-02 |
| A4 | Audit event pipeline: actor, customer, action, object, before and after summary, IP; append-only storage; customer-visible view | S | 5, 10 | ISO-07 to ISO-09 |
| A5 | Observability baseline: structured logs, metrics, error tracking, alert routing | S | 17 | MON-07 |
| A6 | Shared rendering module (fit, crop, letterbox, layout geometry) compiled for browser preview and player, with golden-image tests | M | 6.6 | MED-07 |

### Epic B: Customers, sites, displays, devices (P0)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| B1 | Operations console: create customer, site (IANA zone picker limited to Australian zones plus territories), first admin user | S | 7.1 | E2E-04 |
| B2 | Canvas profiles: global and per-customer, width, height, orientation, default fit, safe margins; change confirmation | S | 5, 6.10 | PRV-05, PRV-06 |
| B3 | Device registration by pairing code (6 characters, 15-minute expiry, regeneration), device credential issue and hardware binding | M | 7.2 | PRV-01, PRV-02, ISO-10 |
| B4 | Pre-provisioning by claim token in the player image; replace device behind a display | S | 7.2 | PRV-03, PRV-07 |
| B5 | Move display between sites and customers with cache purge command and audit | S | 7.2 | PRV-04 |
| B6 | Installer confirmation: reported HDMI mode versus configured canvas; test slate with pixel ruler | S | 7.3 | PRV-05 |

### Epic C: Media (P0)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| C1 | Resumable chunked upload direct to object storage with presigned URLs; completion and checksum | M | 6.2 | MED-05 |
| C2 | Validation worker: container, codec, dimensions, duration, size, extension-versus-content; named failure reasons | M | 6.2, 15 | MED-03, MED-04, MED-06 |
| C3 | Rendition worker: image renditions per canvas, video renditions (H.264 1080p-class, HEVC at canvas), poster frames, thumbnails; content-addressed keys; idempotent jobs | L | 15 | MED-01, MED-02 |
| C4 | Media library: folders, tags, search, usage view, replace keeping assignments, delete with reference check, quota | M | 6.3 | MED-08, MED-09 |
| C5 | Original download for customers | S | 5 | |

### Epic D: Playlists, layouts, scheduling (P0)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| D1 | Playlist editor: ordered items, durations with defaults, fit override, nested playlist one level, per-item availability window | M | 6.4 | PL-01 to PL-03 |
| D2 | Layout templates: full canvas; main region plus text band; preview at exact canvas size | M | 6.5 | PL-04 |
| D3 | Scheduling engine library: wall-clock rules with IANA zone, RFC 5545 recurrence, gap and overlap policy, priority resolution, 14-day materialisation with tzdata version; shared by server and player; exhaustive tests for every Australian zone and the 2026 and 2027 transition dates | L | 11 | SCH-01 to SCH-10 |
| D4 | Schedule editor: default content, events, week view in site zone, overlap flags, "what plays at" probe, daylight-saving notices | M | 6.7 | SCH-08 |
| D5 | Site time-zone change flow with affected-display listing | S | 11.6 | SCH-06 |

### Epic E: Publishing and delivery (P0)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| E1 | Unpublished-changes tracking at playlist, layout, schedule and display level | S | 6.8 | PUB-01 |
| E2 | Publication versions: immutable manifest with file hashes and signed URLs, diff summary, affected displays, audit | M | 6.8, 12 | PUB-02 |
| E3 | Delivery state machine per display with progress and timestamps; player acknowledgement protocol; "playing" confirmation rule | M | 12 | PUB-03, PUB-04, PUB-08 |
| E4 | Rollback to previous publication | S | 6.8 | PUB-09 |

### Epic F: Linux player (P0)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| F1 | Base image: Raspberry Pi OS Lite 64-bit, overlay read-only root, kiosk compositor, Chromium kiosk, mpv, watchdog, no inbound ports | M | 14 | OFF-03, OFF-04, OFF-08 |
| F2 | Supervisor service: registration, credential storage, heartbeat, manifest poll, resumable verified downloads, atomic version switch, cache eviction, proof-of-play batching, command channel | L | 12, 13, 14 | PUB-05 to PUB-07, PUB-10, OFF-01, OFF-02, MON-01, MON-06 |
| F3 | Renderer: layouts in Chromium, video zones in mpv with hardware decode, canvas and orientation handling, forced HDMI mode from canvas profile | L | 14.7 | PL-01, PL-04, PRV-05, PRV-06 |
| F4 | Local schedule evaluation using the shared engine; time-sync gating; last-known-good time | M | 11.7 | OFF-05, OFF-06 |
| F5 | Screenshot and diagnostics bundle on command; restart and reboot commands | S | 13 | MON-02, MON-03, MON-05 |
| F6 | Application update with signature verification, maintenance window, health check and rollback; OS A/B image update (RAUC or Mender) | L | 14.5 | UPD-01 to UPD-06 |
| F7 | Player simulator: the supervisor and renderer running in a container with mocked clock and network for CI | M | validation split | all SIM tests |

### Epic G: Monitoring, alerts, reports (P0 to P1)

| ID | Story | Size | Spec | Tests | Priority |
|---|---|---|---|---|---|
| G1 | Heartbeat ingestion, online and offline transitions, device state denormalisation | S | 13 | MON-01 | P0 |
| G2 | Display page for customers and console with delivery state, last screenshot, alerts | M | 6.9, 7.4 | MON-08 | P0 |
| G3 | Fleet dashboard with filters | M | 7.4 | | P0 |
| G4 | Triage panel with cause evaluation and remedies | M | 7.5 | MON-04, E2E-04 | P1 |
| G5 | Alerts: offline, update failed, storage low, delivery error; email; auto-resolve; scheduled-off suppression | M | 13 | MON-07 | P1 |
| G6 | Playback report and CSV export | S | 6.11 | MON-06, E2E-03 | P1 |

### Epic H: Support access and customer administration (P1)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| H1 | Support sessions: reason, time limit, banner, dual audit, customer visibility | M | 7.6 | ISO-07 to ISO-09 |
| H2 | Customer user management: invite, roles, site scoping, ownership transfer | M | 6.10, 8 | ISO-05, ISO-06 |
| H3 | Customer deletion with purge job and report | S | 10.6 | ISO-11 |

### Epic I: Android player (P1)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| I1 | Device-owner provisioning (QR), lock task mode, persistent HOME, kiosk restrictions | M | 14 | OFF-03 |
| I2 | Player app: registration, heartbeat, downloads, Media3 playback, WebView layouts, schedule engine, screenshot, diagnostics | L | 12 to 14 | as Epic F |
| I3 | Silent update through PackageInstaller with staged rollout and rollback to the previous APK | M | 14.5 | UPD-01 to UPD-03 |

### Epic J: Read-only API and documentation (P1)

| ID | Story | Size | Spec |
|---|---|---|---|
| J1 | OpenAPI-documented read endpoints for displays, delivery states, playback logs; rate limiting; service tokens | M | 16 |
| J2 | Customer and operator documentation, installer checklist | S | |

### Epic K: Hardware validation (P0, runs in parallel with Epic F)

| ID | Task | Size |
|---|---|---|
| K1 | Complete the hardware questionnaire for the pilot site; obtain controller model, firmware, canvas, EDID | S |
| K2 | Pi 5 to controller handshake at native canvas, with and without custom EDID; document the forced mode | S |
| K3 | mpv HEVC hardware decode in the kiosk session; Chromium layout performance; portrait throughput | S |
| K4 | Power-cut recovery, 20 cycles, with overlay root; SD versus eMMC decision | S |
| K5 | Android SKU: device-owner enrolment, silent install with Play Protect present | S |
| K6 | Outage simulation at the pilot site: 24 hours offline, reconnect, state reconciliation | S |

### Epic L: Later scope (P2, not scheduled)

LED controller adapters (brightness, power, panel health) per verified model; documents and web pages; widgets; SSO and SCIM; synchronised playback; interactive kiosks; live video; advertising; self-serve sign-up and billing; migration tooling from the current CMS; SoC display apps.

## 2. Sequencing

| Phase | Weeks (indicative) | Content | Milestone |
|---|---|---|---|
| 0 | 1 to 2 | Hardware questionnaire, pilot hardware order, A1, A2, A3 start, K1 | Stack running in the Australian region; pilot site known |
| 1 | 3 to 6 | A4 to A6, B1 to B3, C1 to C3, F1, F2 start, K2 to K4 | Device pairs; media processes; hardware risks retired or re-planned |
| 2 | 7 to 10 | D1 to D4, E1 to E3, F2 to F5, F7, G1, G2 | **Smallest milestone (section 0) achieved** in simulator and on pilot hardware |
| 3 | 11 to 14 | B4 to B6, C4, C5, D5, E4, F6, G3, G5, G6, H1 to H3, K5, K6 | First customer release candidate on Linux players |
| 4 | 15 to 20 | I1 to I3, G4, J1, J2 | Android kiosks; read-only API; support triage |

Assumptions: two engineers (one platform and portal, one player and hardware) plus part-time design; pilot hardware available by week 3; TINNOX answers Q1 to Q4 in `docs/open-questions.md` during phase 0. If the controller handshake (K2) fails on the Pi, phase 1 swaps the LED path to an Android box with a confirmed custom-mode capability or an x86 mini PC, and the schedule slips by two to three weeks.

## 3. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| LED controller rejects the Pi's HDMI mode at the custom canvas | LED path blocked | K2 in week 3; custom EDID via the controller's configuration tool; fallback platforms |
| Chromium video performance on Pi 5 | Stutter | Route all video through mpv (F3); encode HEVC |
| Daylight-saving edge cases | Wrong content times twice a year | Shared engine with exhaustive transition tests (D3) and visible notices (D4) |
| Silent Android updates blocked by Play Protect | Manual visits | K5; AOSP or policy-disabled devices; MDM fallback |
| Scope creep from widget and app requests | Delayed milestone | Section 9 of the spec: separate decisions, not backlog items |
| Customer data in a global content network | Contract or privacy objection | Default to Australian-region storage; content network opt-in per customer |
| Current CMS vendor terms | Migration friction | Q1 and Q12 answered early; originals re-collected from customers if needed |
