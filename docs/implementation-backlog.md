# TINNOX CMS implementation backlog

Date: 2026-11-03. Status: PROPOSED. Revised on 2026-11-03 with TINNOX's answers to Q1 to Q12 and the round-2 research (`research/round2/R99-critic.md` section 2.6 and row D19). Priorities: **P0** = needed for the first pilot milestone, **P1** = needed for the first customer release, **P2** = later. Sizes are relative (S under a week for one engineer, M one to three weeks, L more than three weeks) and are estimates, not commitments. Every item references the specification section it implements and the acceptance tests that prove it. Spec section numbers refer to `tinnox-mvp-spec.md`.

Inputs that shape this backlog (DECIDED by TINNOX unless labelled):
- TINNOX sells no CMS today, so there is nothing to migrate (Q1, Q12).
- Release 1 has two controller vendors: Huidu (Q2) and NovaStar, which the website names in the PrecisionX packages (VERIFIED_FULL_PAGE, `research/round2/R5-tinnox-site.md`).
- Release 1 is Australia only (Q6). The plan is hardware with TINNOX's own software for margin and recurring revenue (Q7).
- Support access follows the B+ policy (PROPOSED, `research/round2/R2-support-access-models.md`; R99 C4).
- Hosting is AWS Sydney with DR in Melbourne, all in Australia (PROPOSED, `research/round2/R3-au-hosting-compliance.md` Option A).
- Players are a CM5 Linux box and an RK3588-class Android box, with the Huidu card itself as the player on async-only signs (PROPOSED, `research/round2/R4-player-hardware-recommendation.md` with R99 C1 and C3).
- PDF is in release 1. PowerPoint and web pages are in release 2, on TINNOX-player routes only (Q11; R99 C7).

## 0. Smallest practical milestone: "one display, one site, honest states"

Goal: a single TINNOX test customer with one site in Australia/Sydney. One Raspberry Pi Compute Module 5 (CM5, eMMC) player on an industrial carrier feeds a Huidu sender (or a NovaStar sender) over HDMI at a custom canvas. A 1080p monitor stands in if the controller is not yet available. An operator provisions it. A customer editor uploads an image and a video, builds a playlist, schedules it, publishes it, and watches it move through pending, downloading, downloaded and playing, with a screenshot proving it. The player survives a power cut and a 24-hour outage. Duration estimate: 8 to 10 weeks for two engineers after the pilot hardware arrives.

Parallel thin slice: "one Huidu 'D' card driven by program push". An operator commissions one async Huidu "D" engineering card (B7). The same publication compiles to a Huidu program and the card plays it within 2 minutes on the LAN. The display page shows proof of play labelled "sampled". Traffic to the card runs only through an on-site agent or a VPN router (PROPOSED, `research/round2/R1-huidu-integration.md`; R99 C3). This slice is lab-only until a site card is identified (Q-T2, Q-T3).

Exit criteria: acceptance tests PRV-01, PRV-05, MED-01, MED-02, MED-03, PL-01, SCH-01, SCH-02 (simulator), PUB-02, PUB-03, PUB-04, PUB-05, OFF-01, OFF-03, MON-01, MON-02, ISO-01, ISO-02 pass; E2E-01 passes in the simulator and on the pilot hardware. For the thin slice, HUI-01, HUI-02, HUI-05 and HUI-08 pass against the mock card server (SIM) and on the lab card (HW).

## 1. Epics and stories

### Epic A: Platform foundation (P0)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| A1 | Repository layout, CI, environments (dev, pilot), infrastructure as code for AWS ap-southeast-2 (Sydney): compute, PostgreSQL, S3 media, queue, DNS and TLS. DR in ap-southeast-4 (Melbourne) through RDS snapshot copies and S3 replication (inter-region transfer USD 0.080/GB, OFFICIALLY DOCUMENTED price file, R3 verification). An Organisations SCP that denies non-AU regions. KMS customer-managed keys in Sydney; CloudTrail, Config, Security Hub and GuardDuty. CloudFront limited to the Australia price class. Cloudflare R2 off by default, because it has no Australian jurisdiction (OFFICIALLY DOCUMENTED, R3) (PROPOSED, R3 Option A) | L | 10.7, 17 | NF-04, NF-05, NF-07 to NF-09 |
| A2 | Tenancy data model with customer id on every row and PostgreSQL row-level security; tenant context middleware; 404-on-foreign-object behaviour | M | 5, 10 | ISO-01 to ISO-03 |
| A3 | Identity: user accounts, MFA (TOTP), sessions, password reset, service tokens with roles, operator accounts separate from customer users. Cognito in Sydney (PROPOSED, R3) | M | 6.1, 8, 16 | ISO-05, NF-02 |
| A4 | Audit event pipeline: actor, customer, action, object, before and after summary, IP; append-only storage; customer-visible view. Customer audit log kept 24 months, searchable, for every customer. Support-session, grant and break-glass records kept 7 years in write-once storage in Australia (PROPOSED, R2; R99 C5). Retention is a compliance floor and does not vary by plan. 24 months exceeds the ISM minimum of 12 months searchable (ISM-1988, OFFICIALLY DOCUMENTED, R2) | M | 5, 10 item 8 | ISO-07 to ISO-09, ISO-12 to ISO-16 |
| A5 | Observability baseline: structured logs, metrics, error tracking, alert routing | S | 17 | MON-07 |
| A6 | Shared rendering module (fit, crop, letterbox, layout geometry, content window) compiled for browser preview and player, with golden-image tests | M | 6.6 | MED-07 |

### Epic B: Customers, sites, displays, devices (P0)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| B1 | Operations console: create customer, site (IANA zone picker limited to Australian zones plus territories; canonical names only, offsets computed per date, aliases accepted on input and stored as the canonical name, `Etc/*` rejected (spec section 11 rule 8); no New Zealand in release 1, Q6), first admin user | S | 7.1, 11 | E2E-04, SCH-11 |
| B2 | Canvas profiles: global and per-customer, width, height, orientation, default fit, safe margins; change confirmation | S | 5, 6.10 | PRV-05, PRV-06 |
| B3 | Device registration by pairing code (6 characters, 15-minute expiry, regeneration), device credential issue and hardware binding; registration beyond licensed seats refused (N3) | M | 7.2 | PRV-01, PRV-02, ISO-10 |
| B4 | Pre-provisioning by claim token in the player image; replace device behind a display | S | 7.2 | PRV-03, PRV-07 |
| B5 | Move display between sites and customers with cache purge command and audit | S | 7.2 | PRV-04 |
| B6 | Installer confirmation: reported HDMI mode versus configured canvas; test slate with pixel ruler. Package canvas presets: PrecisionMicro, PrecisionPro and PrecisionLuma S1 to S5, StructuraSign, DuraBlaze Media, and kiosk sizes in both orientations. Published examples include 1376×774 (PrecisionPro S1) and 768×448 (PrecisionLuma S1), which are not 16:9 (VERIFIED_FULL_PAGE, R5). StructuraSign and DuraBlaze pixel counts come from TINNOX (Q-T11). A content window (x and y offset, width, height) inside the output mode. A warning when the canvas exceeds a NovaStar TB60's load of about 2.3 Mpx (THIRD PARTY, R5 verification; R99 C1) | M | 6.6, 7.3 | PRV-05, PRV-06 |
| B7 | Huidu commissioning (new). Controller entity and the display's `delivery_route` (`tinnox_player` or `huidu_push`). Record make, model, full device ID, firmware and HDMI-in; only "D" engineering cards support the HTTP API (OFFICIALLY DOCUMENTED, R1). Write the TINNOX key once; the card accepts a key only once (OFFICIALLY DOCUMENTED, R1). Store the key reference per card in the secrets vault, never in tables, the console or logs. If another party already keyed the card, stop and show a clear console error. Set the site's Australian IANA zone (the card default is Asia/Shanghai, VERIFIED_FULL_PAGE, R1). Change or disable the Wi-Fi access-point password, which the API returns in clear text (VERIFIED_FULL_PAGE, R1 verification). Confirm HDPlayer on and off schedules are not in use (PROPOSED) | M | 5, 7.2, 10 item 4 | HUI-01, HUI-03, HUI-07, HUI-09 |

### Epic C: Media (P0)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| C1 | Resumable chunked upload direct to object storage with presigned URLs; completion and checksum | M | 6.2 | MED-05 |
| C2 | Validation worker: container, codec, dimensions, duration, size, extension-versus-content; named failure reasons | M | 6.2, 15 | MED-03, MED-04, MED-06 |
| C3 | Rendition worker: image renditions per canvas; video renditions per player profile (HEVC for CM5, because H.264 1080p60 costs 50 to 60 % CPU in software on a Pi 5 or CM5, VERIFIED_FULL_PAGE, R4; H.264 for Android and Huidu cards, whose codec limits are HARDWARE-DEPENDENT/UNVERIFIED); poster frames, thumbnails; PDF rasterised to images (Q11); content-addressed keys; idempotent jobs | L | 15 | MED-01, MED-02 |
| C4 | Media library: folders, tags, search, usage view, replace keeping assignments, delete with reference check, quota | M | 6.3 | MED-08, MED-09 |
| C5 | Original download for customers | S | 5 | |

### Epic D: Playlists, layouts, scheduling (P0)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| D1 | Playlist editor: ordered items, durations with defaults, fit override, nested playlist one level, per-item availability window | M | 6.4 | PL-01 to PL-03 |
| D2 | Layout templates: full canvas; main region plus text band; preview at exact canvas size | M | 6.5 | PL-04 |
| D3 | Scheduling engine library: wall-clock rules with IANA zone, RFC 5545 recurrence, gap and overlap policy, priority resolution, 14-day materialisation with tzdata version; shared by server and player; exhaustive tests for every Australian zone and the 2026 and 2027 transition dates | L | 11 | SCH-01 to SCH-10 |
| D4 | Schedule editor: default content, events, week view in site zone, overlap flags, "what plays at" probe, daylight-saving notices | M | 6.7 | SCH-08 |
| D5 | Site time-zone change flow with affected-display listing; pushes the new zone to Huidu cards (M4) | S | 11.6 | SCH-06 |

### Epic E: Publishing and delivery (P0)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| E1 | Unpublished-changes tracking at playlist, layout, schedule and display level | S | 6.8 | PUB-01 |
| E2 | Publication versions: immutable manifest with file hashes and signed URLs, diff summary, affected displays, audit | M | 6.8, 12 | PUB-02 |
| E3 | Delivery state machine per display with progress and timestamps; player acknowledgement protocol; "playing" confirmation rule. The Huidu route's states are in M3 | M | 12 | PUB-03, PUB-04, PUB-08 |
| E4 | Rollback to previous publication | S | 6.8 | PUB-09 |

### Epic F: Linux player (P0)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| F1 | Base image for CM5 (eMMC): Raspberry Pi OS Lite 64-bit, overlay read-only root, kiosk compositor, Chromium kiosk, mpv, watchdog, RTC backup-cell charging enabled (off by default, VERIFIED_FULL_PAGE, R4), no inbound ports | M | 14 | OFF-03, OFF-04, OFF-08 |
| F2 | Supervisor service: registration, credential storage, heartbeat (including SoC temperature and throttling flags), manifest poll, resumable verified downloads, atomic version switch, cache eviction, proof-of-play batching, command channel | L | 12, 13, 14 | PUB-05 to PUB-07, PUB-10, OFF-01, OFF-02, MON-01, MON-06 |
| F3 | Renderer: layouts in Chromium, video zones in mpv with HEVC hardware decode, canvas, content window and orientation handling, forced HDMI mode from canvas profile | L | 14.7 | PL-01, PL-04, PRV-05, PRV-06 |
| F4 | Local schedule evaluation using the shared engine; time-sync gating; last-known-good time | M | 11.7 | OFF-05, OFF-06 |
| F5 | Screenshot and diagnostics bundle on command; restart and reboot commands | S | 13 | MON-02, MON-03, MON-05 |
| F6 | Application update with signature verification, maintenance window, health check and rollback; OS A/B image update (RAUC or Mender) | L | 14.5 | UPD-01 to UPD-06 |
| F7 | Player simulator: the supervisor and renderer running in a container with mocked clock and network for CI | M | validation split | all SIM tests |

### Epic G: Monitoring, alerts, reports (P0 to P1)

| ID | Story | Size | Spec | Tests | Priority |
|---|---|---|---|---|---|
| G1 | Heartbeat ingestion, online and offline transitions, device state denormalisation; Huidu card status from M3 | S | 13 | MON-01 | P0 |
| G2 | Display page for customers and console with delivery state, last screenshot, alerts | M | 6.9, 7.4 | MON-08 | P0 |
| G3 | Fleet dashboard with filters, including delivery route, controller vendor and licence state | M | 7.4 | | P0 |
| G4 | Triage panel with cause evaluation and remedies, including Huidu causes (key not written, card keyed by another party, wrong zone, agent or VPN down) and publishing locked by licence state | M | 7.5 | MON-04, E2E-04 | P1 |
| G5 | Alerts: offline (default 30 minutes, with a recovery alert), temperature high (about 75 °C, before the 80 °C throttle point, VERIFIED_FULL_PAGE, R4 verification #7), update failed, storage low, delivery error; email to users and verified external addresses; auto-resolve; scheduled-off suppression (PROPOSED) | M | 13 | MON-07, MON-09 | P1 |
| G6 | Playback report and CSV export; evidence type shown per row (logged or sampled); retention per plan (N3) | S | 6.11 | MON-06, E2E-03 | P1 |

### Epic H: Support access and customer administration (P1)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| H1 | Support grants (B+). A SupportGrant object. The operator raises a request with a reason and ticket number; a customer Admin or Owner approves it in one click or grants proactively. Scope view-only or edit. Expiry 24 hours by default, 7 days at most; renewal is explicit. Revocation ends active sessions at once. Optional pre-authorised 24-hour self-grant, logged and e-mailed to admins. Optional standing access, Managed plan only, re-confirmed every 12 months. Break-glass with dual approval (operator and manager), reason and incident number, 2-hour limit, customer notified at once by e-mail and in the portal, review within 5 working days and a monthly report. Device-operations scope stays on under the contract and cannot read media, playlists, schedules or users. Every session: named operator with MFA, portal banner, dual audit, e-mail to the customer's admins when it starts (PROPOSED, R2; R99 C4; TINNOX approval pending, Q-T6) | L | 7.6, 8, 10 items 5 and 8 | ISO-07 to ISO-09, ISO-12 to ISO-16 |
| H2 | Customer user management: invite, roles, site scoping, ownership transfer | M | 6.10, 8 | ISO-05, ISO-06 |
| H3 | Customer deletion with purge job and report | S | 10.6 | ISO-11 |

### Epic I: Android player (P1)

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| I1 | Device-owner provisioning (QR), lock task mode, persistent HOME, kiosk restrictions on an RK3588 or RK3576 Android 14 box. Before ordering more than 10 units, obtain the box vendor's written commitment on Android version, security patch level, OTA cadence and end-of-support date. No Rockchip or box-vendor patch policy was found (UNKNOWN, R4) | M | 14 | OFF-03 |
| I2 | Player app: registration, heartbeat, downloads, Media3 playback, WebView layouts, schedule engine, screenshot, diagnostics. Its own crash-relaunch watchdog: `DISALLOW_SYSTEM_ERROR_DIALOGS` force-stops a crashed app and does not restart it (VERIFIED_FULL_PAGE, AOSP source, R4 verification #16) | L | 12 to 14 | as Epic F, UPD-07 |
| I3 | Silent update through PackageInstaller with staged rollout and rollback to the previous APK | M | 14.5 | UPD-01 to UPD-03 |

### Epic J: Read-only API and documentation (P1)

| ID | Story | Size | Spec |
|---|---|---|---|
| J1 | OpenAPI-documented read endpoints for displays, delivery states, playback logs; published numeric rate limits with `Retry-After` and a JSON 429 body; job IDs for device commands, read-only; service tokens | M | 16 |
| J2 | Customer and operator documentation, installer checklist, Huidu commissioning checklist | S | |

### Epic K: Hardware validation (P0, runs in parallel with Epics F and M)

| ID | Task | Size |
|---|---|---|
| K1 | Complete the hardware questionnaire for the pilot site; obtain controller model, firmware, canvas, EDID. For Huidu: full device ID ("D" or not), Android or Linux series, HDMI-in, key already written and by whom, HDPlayer schedules in use, 4G and NAT (R1 open items B; Q-T2, Q-T3). For NovaStar: model per PrecisionX package (Q-T11) | S |
| K2 | CM5 to controller handshake at native canvas, with and without custom EDID, against a Huidu sender (T901, T902 or VP series, or an H6 or H8 in sync mode) and a NovaStar sender in synchronous mode; document the forced mode (HARDWARE-DEPENDENT/UNVERIFIED) | S |
| K3 | mpv HEVC hardware decode in the kiosk session on CM5; Chromium layout performance; portrait throughput | S |
| K4 | Power-cut recovery, 20 cycles, with overlay root on CM5 eMMC; RTC keeps time across the cut with the backup cell charging | S |
| K5 | Android SKU: device-owner enrolment, silent install with Play Protect present; vendor's written patch commitment received | S |
| K6 | Outage simulation at the pilot site: 24 hours offline, reconnect, state reconciliation | S |
| K7 | Outdoor thermal log (new): a CM5 in a box rated −25 to +60 °C (EDATEC ED-IPC3630 class, OFFICIALLY DOCUMENTED datasheet, R4) in the cooled controller compartment of one pylon, with temperature telemetry through January and February 2027. Pass: no throttling on days of 45 °C ambient or more, watchdog recovery tested. Needs the cabinet design answer (Q-T10). Tests OFF-09, MON-09 | M |
| K8 | Huidu "D" card API soak (new): program push to playing within 2 minutes on the LAN; card keeps its schedule through a 24-hour outage; HDPlayer schedule conflict observed and documented; key write-once behaviour; codec and font limits for pushed media (HARDWARE-DEPENDENT/UNVERIFIED). Tests HUI-02, HUI-04 | M |
| K9 | NovaStar TB60 capacity per PrecisionX package (new): confirm the model in each package (Q-T11). A TB60 loads about 2.3 Mpx with HDMI-in up to 1920×1200@60, so PrecisionPro S3 and S4 and PrecisionMicro S4 need a larger model or a split canvas (THIRD PARTY, R5 verification #12). Test the input sizes accepted in synchronous mode | S |

### Epic L: Later scope (P2, not scheduled)

| Item | Target | Note |
|---|---|---|
| PowerPoint (converted to video or images) and web pages | Release 2, TINNOX-player routes only | Q11. Huidu cards have no web item (VERIFIED_FULL_PAGE, absence, R1) |
| Webhooks for device events (online and offline, publish completed, media ready, playback batch, alert) | Release 2 | Designed in release 1; HMAC-SHA256 with a timestamp and a documented retry policy (PROPOSED, R7 P5; spec section 13) |
| LED controller adapters for brightness, power and panel health beyond Huidu "D" cards, including NovaStar LAN control | Release 2, per verified model | Huidu control is in release 1 (M4) |
| NovaStar VNNOX and Xixun adapters | Later | VNNOX and the Huidu cloud are excluded until a vendor shows an Australian region in writing (Q9; R99 C15). Xixun documents its own APK route (THIRD PARTY, R1) |
| Self-serve sign-up, card payments and in-product invoicing | Release 2 or later | Entitlements, licence states and billing export are in release 1 (Epic N) |
| Widgets, SSO and SCIM, synchronised playback, interactive kiosks, live video, advertising, SoC display apps | Separate decisions | Spec section 9 |

Migration tooling is removed. TINNOX sells no CMS today and needs no Yodeck migration (Q1, Q12).

### Epic M: Huidu adapter (P0 for the thin slice, P1 overall)

Rests on TINNOX answer Q2 and on the official Huidu HTTP API (VERIFIED_FULL_PAGE, official document via mirror, revision 2026-06-16, R1). Whether the vendor API TINNOX already holds is a Huidu key is open; it is identified in phase 0 before M1 starts (Q-T1; R99 C2).

| ID | Story | Size | Spec | Tests | Priority |
|---|---|---|---|---|---|
| M1 | HTTP API client with signing: requests to the card on TCP 30080 with `requestId`, `sdkKey`, `date` and `sign` headers, `sign = HMACMD5(body+sdkKey+date, sdkSecret)`; secrets read from the vault only; SDK version check against the device API version; a mock :30080 server for CI | M | 7.2, 12 | all HUI SIM tests | P0 |
| M2 | Compile a publication to Huidu programs: one program `replace` per publication; program, area and item (image, video, text, clocks); `playControl` for duration, weekdays, date ranges and daily windows; media by signed URL plus `fileMd5`; route capability check, so no web or PowerPoint items (spec 20.3); audit of what was sent | M | 12, 15, 20.3 | HUI-02, HUI-04 | P0 |
| M3 | Status, screenshot and sampled proof of play: states `pending`, `sent`, `card-downloaded` (from `getAll` and file MD5), `playing (sampled)`; `getDeviceStatus` polling; screenshot cadence. The API has no play-log endpoint (VERIFIED_FULL_PAGE, absence, R1), so proof of play is labelled "sampled" and never "audited" | S | 12, 13 | HUI-05 | P0 |
| M4 | Control adapter: brightness (manual and scheduled), screen on and off, scheduled tasks for screen, luminance, volume and relay, and time zone through `setDeviceProperty`. Also used on dual-mode cards fed by a TINNOX player (route (a)). Every action audited | S | 4, 9, 13 | HUI-03, HUI-06 | P1 |
| M5 | Transport: on-site agent or 4G router with VPN. Port 30080 is plain HTTP and never crosses the public internet. The agent connects outbound to the AU region only (PROPOSED, R1 verification caveat 1) | M | 7.2, 10 | HUI-08 | P0 |
| M6 | Lab spike: Huidu gateway service and reverse TCP (`SetSDKTcpServer`) behind carrier NAT on one "D" card. Time-boxed. Evidence is THIRD PARTY only; the result decides whether it can replace M5 for 4G sites (HARDWARE-DEPENDENT/UNVERIFIED) | S | | | P2 (spike) |
| M7 | Lab spike: TINNOX APK on one A-series "D" card, after asking Huidu whether it is supported. Huidu documents no APK install (UNKNOWN, R1) | S | | | P2 (spike) |

### Epic N: Entitlements and billing (P1)

Implements spec section 20 (PROPOSED, `research/round2/R6-commercial-model.md` R3). No self-serve sign-up and no in-product invoicing in release 1.

| ID | Story | Size | Spec | Tests |
|---|---|---|---|---|
| N1 | Entitlement service and plans: Essential, Professional and Managed; per-customer plan, term start and end, billing cycle, included-until, price book, AUD and GST. One service answers every feature check, combining plan and route capabilities. Every entitlement change audited. A downgrade disables features but keeps their data | M | 20.1 to 20.3, 20.5 | ENT-02, ENT-05 |
| N2 | Licence-state machine per display: `demo`, `included`, `active`, `grace` (30 days, portal banner only), `suspended`, `expired` (after 90 days suspended). Publishing locked, playback continues. Nothing is ever shown on the public screen because of a licence state | M | 20.4 | ENT-01 |
| N3 | Quotas: licensed display seats, storage pooled per customer, users on Essential, API token count and rate limits, playback-log retention by plan, and egress metered per customer per month for reporting, because egress is the main hosting cost driver (about 35 % at 2,000 screens, R3 verification) | M | 20.6 | ENT-03 |
| N4 | Monthly billing export (CSV and JSON) per customer: billable display-days by plan, prorations, included and demo displays at zero, term dates, purchase-order reference, hardware serials. Ex GST, labelled "+ GST". Format for Xero or MYOB (Q-T7) | S | 20.7 | ENT-04 |
| N5 | Contracts screen and renewal reminders: plan, term, included-until, renewal date; reminders at 60, 30 and 7 days to the account manager and the customer Owner; bulk "apply plan"; report of displays whose included period ends within 90 days; hardware link (serial, controller model, warranty end, contract ID) | S | 20.7 | |

## 2. Sequencing

| Phase | Weeks (indicative) | Content | Milestone |
|---|---|---|---|
| 0 | 1 to 2 | Hardware questionnaire, pilot hardware order (one CM5 industrial box, one RK3588 Android box, one Huidu "D" card), A1, A2, A3 start, K1. Identify the granted vendor API (Q-T1). Ask Q-T2, Q-T3 and Q-T11. Design the Huidu commissioning flow (B7) | Stack running in AWS Sydney; pilot site known; vendor API identified |
| 1 | 3 to 6 | A4 to A6, B1 to B3, B7, C1 to C3, F1, F2 start, K2 to K4, K9, M1, M5 | Device pairs; media processes; Huidu lab card commissioned; hardware risks retired or re-planned |
| 2 | 7 to 10 | D1 to D4, E1 to E3, F2 to F5, F7, G1, G2, M2, M3, K8 | **Smallest milestone (section 0) and the Huidu thin slice achieved** in simulator and on pilot hardware |
| 3 | 11 to 16 | B4 to B6, C4, C5, D5, E4, F6, G3, G5, G6, H1 (B+) to H3, K5, K6, M4, N1 to N5 | First customer release candidate on Linux players and Huidu cards |
| 4 | 17 to 22 | I1 to I3, G4, J1, J2, M6, M7 | Android kiosks; read-only API; support triage; Huidu lab spikes reported |

K7 is calendar-bound. The CM5 must be in the pilot pylon by the start of January 2027 and logging through February 2027, whatever phase is active.

Assumptions: two engineers (one platform and portal, one player and hardware) plus part-time design; pilot hardware available by week 3; TINNOX answers Q-T1, Q-T2, Q-T3 and Q-T11 in `docs/open-questions.md` during phase 0. Epic M and Epic N add about 9 to 24 engineer-weeks by the size scale (INFERRED). Phase 3 is two weeks longer than before, which absorbs only the low end. A third engineer for Epics M and N keeps these dates (PROPOSED). If the controller handshake (K2) fails on the CM5, phase 1 swaps the LED path to the RK3588 Android box with a confirmed custom-mode capability, and the schedule slips by two to three weeks. If no site has a "D" card (K1), the Huidu thin slice stays in the lab and M2 to M4 move to P1.

## 3. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| LED controller rejects the CM5's HDMI mode at the custom canvas | LED path blocked | K2 in week 3; custom EDID via the controller's configuration tool; RK3588 Android fallback |
| Video performance on CM5 | Stutter | Route all video through mpv (F3); HEVC renditions for CM5, because H.264 decodes in software (C3) |
| Daylight-saving edge cases | Wrong content times twice a year | Shared engine with exhaustive transition tests (D3) and visible notices (D4) |
| Silent Android updates blocked by Play Protect | Manual visits | K5; AOSP or policy-disabled devices; MDM fallback |
| Android patch policy unknown for RK3588 boxes | Unpatched kiosks in the field | Written vendor commitment before orders over 10 units (I1, K5); one Android SKU per year |
| Huidu card already keyed by someone else | TINNOX locked out of that card; recovery by factory reset is THIRD PARTY only (R1 verification) | Ask Q-T3 before any install; B7 detects and reports it; buy only "D" cards and write the TINNOX key at commissioning |
| HDPlayer schedules conflict with the HTTP API | Screen on and off stops working as expected | B7 checks and removes HDPlayer schedules; installers stop using them on CMS-managed cards; K8 documents the behaviour |
| No TLS on Huidu port 30080; AP password returned in clear text | Commands or credentials exposed | M5 keeps traffic on the LAN or a VPN; B7 changes or disables the AP password; HUI-08, HUI-09 |
| Reverse TCP to an AU gateway unproven | 4G sites need extra hardware | Agent or VPN router is the baseline (M5); gateway is a lab spike (M6) |
| Outdoor heat in Australian cabinets | Throttling at 80 °C, failures in summer | Players rated 60 °C or more in the cooled compartment; temperature alerts (G5); K7 logging through January and February 2027 |
| Two controller vendors in release 1 (Huidu and NovaStar) | More hardware paths to test; TB60 capacity limits | Route (a) over HDMI is vendor-neutral; per-package model and canvas checks (B6, K9); NovaStar control adapter deferred to release 2 |
| Granted vendor API not yet identified | Work on the wrong adapter | Q-T1 in phase 0 before M1 (R99 C2) |
| Scope creep from widget and app requests | Delayed milestone | Section 9 of the spec: separate decisions, not backlog items |
| Customer data outside Australia | Contract or privacy objection; conflicts with Q9 | AWS Sydney and Melbourne only; SCP denies other regions; CloudFront Australia price class; R2 only with a written opt-in (A1) |
