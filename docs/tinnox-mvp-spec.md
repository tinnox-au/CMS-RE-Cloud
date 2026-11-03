# TINNOX CMS: first-release specification

Date: 2026-11-03. Status: PROPOSED. Working product name: TINNOX CMS. This specification describes an independently designed product. Where a Yodeck behaviour informed a decision it is cited as a reference from `docs/yodeck-workflow-audit.md` or from the round-2 notes under `research/round2/`, with its evidence label; nothing is copied from Yodeck's software, interface or assets. The authenticated Yodeck interface was not inspected; Yodeck references come from its public help centre and public API specification. This revision applies TINNOX's answers to Q1 to Q12 and the round-2 research (`research/round2/R99-critic.md` section 2.4).

Labels: **VERIFIED_FULL_PAGE** (official page or specification read in full on 2026-11-03), **OFFICIALLY DOCUMENTED** (official source seen in part or through a search summary), **THIRD PARTY**, **INFERRED**, **UNKNOWN**, **HARDWARE-DEPENDENT/UNVERIFIED** (needs a test on real hardware), **PROPOSED** (this specification's decision). **TINNOX answer Qn** marks a decision TINNOX has made (see `docs/open-questions.md` section 2). **REFERENCE** marks a Yodeck, Xibo or other vendor behaviour used for comparison; it always carries one of the evidence labels. **ASSUMPTION** points to `docs/open-questions.md` section 4. Questions to TINNOX that are still open use the IDs Q-T1 to Q-T14 from `research/round2/R99-critic.md` section 3. `docs/open-questions.md` section 2.1 numbers them Q13 to Q26 (Q-Tn is Q(12+n)), so Q-T1 is Q13.

## 1. Purpose and positioning

TINNOX sells and installs LED video walls, outdoor LED signs, digital pylons, LED billboards, and LCD and LED kiosks across Australia, with a 2-year product and 1-year on-site warranty and a published SLA (VERIFIED_FULL_PAGE, tinnox.com.au read in full, `research/round2/R5-tinnox-site.md`). TINNOX sells no CMS today; players and content software are chosen per project (TINNOX answer Q1). TINNOX CMS is the first software TINNOX sells with its hardware. Its purpose is to raise margin and create recurring revenue (TINNOX answer Q7; commercial hooks in section 20). Release 1 serves Australia only (TINNOX answer Q6). It has two surfaces on one platform:

- **Customer portal**: customers manage media, playlists, layouts, schedules, sites, displays, their own users and support grants.
- **TINNOX operations console**: authorised staff provision devices and controllers, monitor the fleet, administer customers and plans, and support customers under audit.

Owning the software means TINNOX controls the roadmap, hosting, pricing, customer data and diagnostics. It also means TINNOX carries uptime, security and update obligations (PROPOSED, `docs/tinnox-context.md` section 5). There is nothing to migrate: no current CMS exists (TINNOX answer Q1), and Yodeck was studied only to learn from (TINNOX answer Q12).

## 2. Product principles

1. **Narrow first release.** Images, video and PDF on a schedule, delivered reliably to displays TINNOX installs, with diagnostics that avoid site visits. Everything else is a later scope decision (section 9).
2. **The canvas is a first-class object.** LED walls, pylons and portrait kiosks have arbitrary pixel dimensions. Previews must show exactly what the display will show.
3. **Site-local time.** Every schedule is evaluated in the site's Australian time zone with correct daylight-saving behaviour, on the server and on the player identically.
4. **Honest states.** A customer can always tell whether content is uploaded, published, downloaded or playing on each display, and when that last changed. Where the evidence is sampled rather than logged, the portal says so.
5. **Offline is normal.** Players keep playing through outages and recover from power loss without a person present.
6. **Customers are isolated; support is explicit and audited.** No cross-customer visibility. TINNOX staff work on device health under the contract. They see content and account data only with a customer grant, or through an audited break-glass path (section 7.6).
7. **Original design.** TINNOX branding and an original interface. Yodeck is a reference for workflow expectations only.
8. **A lapse never blanks a screen.** Non-payment or an expired term locks publishing, never playback (section 20).

## 3. Personas and scenarios

| Persona | Surface | Needs |
|---|---|---|
| Customer content editor (school office, retail marketing, council communications officer) | Portal | Upload, arrange, schedule, preview, publish, see that it is playing |
| Customer administrator | Portal | Users, sites, displays, audit of their own account, alerts, approve or revoke TINNOX support access |
| TINNOX installer | Console (mobile-friendly) | Pair a player or commission a controller on site in minutes, confirm canvas and orientation, see first content |
| TINNOX support engineer | Console | Fleet health, triage a display that stopped updating, remote restart, request a support grant into a customer account |
| TINNOX account manager | Console | Create customers and sites, assign devices, set plans and terms, see usage and renewals |

Scenarios (ASSUMPTION A6 set, from the brief):

1. **School notices on an outdoor sign.** One site, one LED sign (landscape or portrait), weekly timetable of notices, term dates, occasional emergency notice published within minutes.
2. **Retailer promotions across locations.** One customer, many sites in several states, one campaign with dated start and end, per-site exceptions, confirmation that every site is playing it.
3. **Council public-information kiosks.** Portrait LCD kiosks, long dwell content, approval before publishing, proof that content played for a reporting period.
4. **TINNOX support investigates a display that stopped updating.** Last heartbeat, delivery state, storage, network and clock diagnostics, screenshot, remote restart, audit of who changed what, without a site visit.

## 4. Scope of the first release

### In scope

| Area | First release |
|---|---|
| Market | Australia only (TINNOX answer Q6). Zones, currency (AUD) and tax (GST) are data, so New Zealand can be added later without code changes (PROPOSED) |
| Tenancy | Customers (tenants) with sites and displays; TINNOX operators provision customers (no self-serve sign-up) |
| Users and roles | Customer roles: Owner, Admin, Editor, Viewer, with optional site scoping; TINNOX roles: Operator, Support, Admin; MFA for all users |
| Devices | Pairing by short code, pre-provisioning by claim token, device credentials bound to hardware, move between sites and customers with cache purge |
| Delivery routes | (a) **TINNOX player** (route 1 in `architecture-and-hardware.md` section 5) (Linux on a Raspberry Pi CM5 industrial box, or Android device owner on an RK3588-class box) feeding the LED controller over HDMI, or driving an LCD panel. This is the primary route for walls, billboards and large pylons, for both Huidu and NovaStar senders. (b) **Huidu program push** (route 5 in `architecture-and-hardware.md` section 5) to async-only Huidu "D" cards through the card's HTTP API: playlist, zones and time windows, with sampled proof of play. Route (b) is the fallback where a player box is not economic (PROPOSED, `research/round2/R1-huidu-integration.md`) |
| Controller vendors | Two in release 1: **Huidu** (TINNOX answer Q2) and **NovaStar** (named in the PrecisionMicro, PrecisionPro and PrecisionLuma packages, VERIFIED_FULL_PAGE, R5). Which controller each package uses is open (Q-T2). NovaStar is reached through route (a) only in release 1 (INFERRED, `research/round2/R99-critic.md` C1) |
| Controller control adapter | Read status, screenshot, screen on and off, brightness schedule and time-zone setting for **Huidu "D" cards** through the official HTTP API. This moves brightness and power into release 1 for Huidu only, because the official API makes it cheap (PROPOSED, R1). Other controllers stay in release 2 |
| Canvas | Named canvas profiles with pixel width and height, orientation and fit defaults; portrait and custom LED dimensions; presets per TINNOX package; a content window (offset and size) inside the output mode |
| Media | Images (PNG, JPEG, WebP), video (MP4 with H.264 or HEVC) and PDF rasterised to images (TINNOX answer Q11: PDF in release 1); validation, renditions per player profile and canvas, thumbnails, folders, tags, availability windows |
| Playlists | Ordered items with per-item duration, video natural length default, availability per item |
| Layouts | Full-canvas single region, plus a two-region template (main region and text band) for notices |
| Scheduling | Default content per display, dated and recurring events with priority, site time zone, preview of what plays when |
| Publishing | Explicit publish creating an immutable version; per-display delivery states; rollback to a previous version |
| Player | Linux player on a CM5 industrial box and Android device-owner player; offline cache; local schedule evaluation; watchdog; staged updates with rollback (PROPOSED, `research/round2/R4-player-hardware-recommendation.md` with the R99 C1 and C3 amendments) |
| Monitoring | Heartbeats, online and offline transitions, screenshots on demand, diagnostics bundle, remote restart, temperature telemetry, alerts, playback log with CSV export |
| Support | Support grants under the B+ policy: device-operations scope under contract; content and account scope by customer grant; break-glass with two approvers; customer-visible audit (section 7.6) |
| Plans and billing hooks | Plans, entitlements, licence states, quotas and a monthly billing export (PROPOSED, `research/round2/R6-commercial-model.md`; section 20). No self-serve sign-up and no in-product invoicing |
| Hosting | All customer data and media in AWS Sydney, DR in AWS Melbourne (PROPOSED, `research/round2/R3-au-hosting-compliance.md`; section 10 item 7) |
| Operations | Customer and site administration, device and controller inventory, fleet dashboard, update channels, contracts and renewals |
| API | Read-only API with per-customer tokens for screens, delivery state and playback logs (write API later) |

### Out of scope for the first release (separate decisions, section 9)

Interactive kiosks and touch, live video and streams, synchronised playback across displays, advertising sales and revenue share, widget and app catalogue, PowerPoint and web pages (release 2, TINNOX-player routes only, TINNOX answer Q11), audio, self-serve sign-up, card payments and in-product invoicing, SSO and SCIM, brightness and power control of LED controllers other than Huidu "D" cards (release 2), a TINNOX app on Huidu Android cards (lab spike only), the Huidu cloud and NovaStar VNNOX routes (excluded under the AU data rule until a vendor shows an Australian region in writing), SoC display apps, Windows and BrightSign players, New Zealand. Migration tooling is not needed (TINNOX answers Q1 and Q12).

## 5. Domain model

| Entity | Key fields | Notes |
|---|---|---|
| Customer | id, name, status, settings (default time zone), created by operator | The tenant. All content and device rows carry customer id and are protected by row-level security. Plan and retention come from its Entitlement |
| Site | id, customer, name, address, IANA time zone (required, canonical Australian zone in release 1), contact | Time zone is per site, never per customer (scenario 2) |
| CanvasProfile | id, customer or TINNOX-global, name, width px, height px, orientation (0, 90, 180, 270), default fit mode, safe margins, package preset, content window (x offset, y offset, width, height inside the output mode) | Examples: `1376×774 PrecisionPro S1`, `768×448 PrecisionLuma S1`, `2240×1260 PrecisionMicro S4` (VERIFIED_FULL_PAGE, R5), `1080×1920 portrait kiosk`. Billboard presets at 2:1, 3:1 and 4:1 need pixel sizes from TINNOX (Q-T11) |
| Display | id, customer, site, name, canvas profile, tags, update channel, status, `delivery_route` (`tinnox_player` or `huidu_push`, later others), `controller` (reference to Controller), `package_preset` | The logical screen a customer schedules to. The route decides which features and evidence the display supports (section 20) |
| Device | id, hardware id, platform (linux, android), credential hash, registered at, bound display, player version | The physical TINNOX player; a display may be re-bound to a replacement device. A `huidu_push` display has no Device; its Controller plays the content |
| Controller | id, customer, display, vendor (huidu, novastar, other), model, device ID, engineering card flag ("D" in the device ID), firmware, mode (sync sender, dual-mode, async card), HDMI input present, connection (on-site agent, VPN), key status (not written, written by TINNOX, keyed by another party), key reference (pointer to the secrets vault; never the key itself), access-point state (changed or disabled), time zone applied, capabilities | The LED controller behind a display. For route (a) it receives HDMI from the player; for route (b) it is the player (PROPOSED, R1) |
| Media | id, customer, folder, name, type (image, video, document), original object key, sha256, size, status (uploaded, processing, ready, failed), failure reason, duration, pixel size, tags, availability window | Originals are kept and downloadable. This differs from the Yodeck REFERENCE: its public API returns no originals (VERIFIED_FULL_PAGE, absence in the public spec, `research/round2/AV3-media-playlists.md`) |
| Rendition | media, player profile (cm5, android, huidu), canvas profile or generic profile, codec, width, height, object key, sha256, size | Produced by workers; immutable (section 15) |
| Playlist | id, customer, name, items[] (media or playlist, order, duration seconds, fit override, availability) | Nested playlists allowed one level deep in the first release |
| Layout | id, customer, canvas profile, regions[] (geometry, content reference) | Two templates in the first release |
| Schedule | display or display group, default content, events[] | See section 11 |
| ScheduleEvent | content reference, local start and end wall-clock times, date range, recurrence rule (RFC 5545 RRULE), priority 0 to 100, gap and overlap policy, resume policy | Stored as wall-clock rule plus the site's zone |
| Publication | id, customer, version number, created by, created at, manifest hash, change summary, state (draft, published, superseded) | Immutable once published. For a `huidu_push` display the publication is compiled into Huidu programs |
| Delivery | display, publication, state (route-specific, section 12), progress bytes, error reason, timestamps per transition | The per-display truth shown to customers and support |
| Heartbeat and DeviceState | device or controller, received at, player version, uptime, boot reason, storage free, SoC temperature, throttling flags, network summary, clock sync state, tzdata version, current publication, current item | Latest row denormalised onto the device or controller |
| PlaybackLog | display, device or controller, publication, media, started at (UTC), duration, completed, `evidence_type` (`logged` or `sampled`) | Batched upload. Retention per plan from the Entitlement: 31 days, 13 months or 25 months, with a 13-month floor for Managed and government customers (PROPOSED, R6 with R99 C6) |
| User, Role, Membership | user, customer or TINNOX, role, site scope | One user can belong to several customers (agency case) |
| SupportGrant | id, customer, scope (`view` or `edit`), type (`request`, `proactive`, `standing`, `self_grant`, `break_glass`), requested by, reason, ticket or incident number, approver (customer admin, or two TINNOX approvers for break-glass), created, expires, revoked at, standing flag, re-confirm due date | The customer's permission for content and account access (section 7.6) |
| SupportSession | operator, customer, SupportGrant (or break-glass), reason, started, ended, actions count | One operator's working session under a grant |
| AuditEvent | actor (user, operator under a grant, operator in device-operations scope, device, controller, system), customer, action, object, before and after summary, IP, time | Retained 24 months, searchable, for every customer. Support-session, grant and break-glass records are also kept 7 years in write-once storage (PROPOSED, `research/round2/R2-support-access-models.md`; ASSUMPTION A13; approval in Q-T6) |
| Entitlement | customer, plan (essential, professional, managed), term start, term end, billing cycle, included until, price book, currency (AUD), tax (GST), quotas (licensed display seats, storage, users, API, playback-log retention) | One entitlement service answers every feature check (section 20) |
| LicenceState | display, state (`demo`, `included`, `active`, `grace`, `suspended`, `expired`), licence end, changed at, reason, actor | Explicit state machine; a lapse locks publishing, never playback (section 20) |
| Alert | customer, display, type (offline, update failed, storage low, delivery error, temperature high), opened, resolved, notified to | Recipients may include verified external addresses (section 13) |
| UpdateChannel and Release | channel (stable, pilot), platform, version, package hash, signature, rollout percentage, pinned displays | Section 14 |

## 6. Customer portal workflows

Each workflow lists the goal, prerequisites, steps, inputs and validation, and resulting state changes. REFERENCE notes point to the audit or the round-2 notes.

### 6.1 Sign in and MFA
- Goal: authenticated access with MFA. Steps: email and password, TOTP code (enrolment on first login), optional passkey later. Validation: lockout after repeated failures, session inactivity timeout (default 12 hours, configurable by customer admin). State: session, audit event.
- REFERENCE: Yodeck offers per-user TOTP and, on its Enterprise plan, account-wide policies such as inactivity logout, single session and IP allow-listing (VERIFIED_FULL_PAGE, help centre, `research/round2/AV1-accounts-admin.md` rows 19 and 20; whether TOTP is on every plan is INFERRED). TINNOX CMS includes MFA for everyone and defers the policy set.

### 6.2 Upload media
- Goal: add images, video or PDF to the library. Prerequisites: Editor or Admin role; free quota under the customer's plan.
- Steps: choose files or drag in; the portal requests a resumable upload session (direct to object storage via presigned URLs, chunked); on completion the server validates the file (container, codec, dimensions, duration, size, extension matches content) and queues processing; renditions and thumbnails are produced for every player profile and canvas profile the customer uses; status moves `uploaded → processing → ready` or `failed` with a specific reason.
- Inputs and validation: PNG, JPEG, WebP up to 50 megapixels; MP4 with H.264 or HEVC up to 2 GB and 4K; PDF up to the page limit in section 15; anything else fails with a named reason. Interrupted uploads resume from the last chunk.
- State: media row and renditions; nothing reaches displays until published.
- REFERENCE: Yodeck's public API models an upload as create record, obtain upload URL, transfer, complete, then poll a status with five values: initialized, uploading, encoding, finished and failed (VERIFIED_FULL_PAGE, public OpenAPI spec, `research/round2/R7-yodeck-api-spec.md` X19 and AV3). TINNOX CMS adopts the same explicit lifecycle and additionally keeps originals.

### 6.3 Organise media
- Folders (nested), tags, search, usage view ("used in 3 playlists, 2 displays"), replace media keeping assignments, delete with reference check.

### 6.4 Build a playlist
- Ordered items, drag reorder, per-item duration (images default 10 s, videos default natural length, both overridable), per-item fit override, per-item availability window (date range plus weekly slots), nested playlist. Empty playlists are allowed but publish shows a warning and displays fall back to the customer's idle slate.
- REFERENCE: Yodeck playlist items carry an integer order field (named `priority` in the public API) and a per-item duration, and a video's duration is fixed to its own length (VERIFIED_FULL_PAGE, public spec and help centre, AV3 rows 39 and 40). Availability is a media-level property (VERIFIED_FULL_PAGE, AV3 row 31); per-item availability is not evidenced (INFERRED). TINNOX CMS puts availability on the playlist item as well as the media.

### 6.5 Build a layout
- Pick a canvas profile; choose full-canvas or two-region template; assign a playlist or media to each region; text band region accepts plain text with font size and colour. Preview renders at the exact canvas pixel dimensions, scaled to fit the browser, with a 1:1 zoom option.
- On a `huidu_push` display, regions compile to Huidu areas and the text band compiles to a Huidu text item. Font rendering on the card is HARDWARE-DEPENDENT/UNVERIFIED, so the preview shows a note for that route (PROPOSED, R1).

### 6.6 Preview fit, crop and letterbox
- For any media on any canvas profile the portal shows the four fit modes (contain with letterbox, cover with crop, stretch, actual size) using the same rendering rules the player uses (a shared rendering module compiled for the browser and the player). Crop shows the discarded area. The preview is pixel-accurate within 1 px (acceptance test MED-07).
- Canvas presets per TINNOX package are offered first (for example PrecisionPro S2 1720×946 and PrecisionLuma S1 768×448, which are not 16:9; PrecisionPro S1 1376×774 is the only exact 16:9 PrecisionPro size; VERIFIED_FULL_PAGE, R5). Where the LED canvas is smaller than the player's output mode, the preview shows the **content window** (offset and size) inside the output frame, so editors see exactly which pixels reach the LED (PROPOSED).
- REFERENCE: Yodeck supports portrait by rotating the output and advises custom ratios with exact pixel dimensions for LED boards through a forced resolution and disabling unused portions (VERIFIED_FULL_PAGE, Yodeck portrait and LED board articles, AV4 L14 and L20). TINNOX CMS makes the canvas and the content window explicit objects instead of a per-screen override.

### 6.7 Schedule content
- Per display or display group: a default (always-on) content item, plus events. An event has content, a date range, local start and end times, a recurrence rule, a priority and a name. The editor shows a week view in the site's time zone and a "what plays at" probe for any date and time. Overlaps are resolved by priority (the higher number wins), then by the most recently published event (section 11 rule 5); the editor flags overlaps.
- Daylight-saving behaviour follows section 11 and is shown inline for the affected dates ("this event starts at 03:30 on 4 Oct 2026 because 02:30 does not exist in Australia/Sydney").
- REFERENCE: Yodeck exposes per-screen time zone, weekly schedules and filler content for gaps (VERIFIED_FULL_PAGE, help centre and public spec, AV4 S9 and S14). Its public API gives each event an integer `priority`, and on overlap the higher number plays (VERIFIED_FULL_PAGE, public spec, R7 X14); how the help centre's drag-to-reorder list maps to that integer is INFERRED. Xibo stores a per-display time zone and a per-event flag to sync to it (VERIFIED_FULL_PAGE, source code and manual, `research/round2/R8-xibo-verify.md` A23). It has 2026 reporting issues that shift dates for zones ahead of UTC (THIRD PARTY, search summary of the issue tracker, R8 V19; whether they are still open was not checked). TINNOX CMS stores wall-clock rules per site and makes the daylight-saving outcome visible.

### 6.8 Publish
- "Unpublished changes" indicator at playlist, layout, schedule and display level. Publish shows the affected displays and a diff summary, requires confirmation, creates an immutable publication version, and moves each affected display to `pending`. The customer can republish any previous version.
- Publish is locked, with a clear message, while the display's LicenceState is `suspended` or `expired`. Playback continues (section 20).
- REFERENCE: Yodeck separates Save from Push to Screens; the push button turns orange after changes and only affected screens download (VERIFIED_FULL_PAGE, help centre, AV5 rows 1 and 2). TINNOX CMS keeps an explicit publish step because it gives a natural audit point and avoids half-edited content reaching an LED wall, and adds versioning and rollback.

### 6.9 Watch delivery and playback
- Display page shows: online state and last heartbeat; delivery state with progress percentage and timestamps for each state of the display's route (section 12); current publication and current item; last screenshot with time; recent alerts.
- On the TINNOX player route, "Playing" is set only when the player reports the version on screen, and the next screenshot request confirms it.
- On the Huidu route, "Playing (sampled)" is set from a screenshot and the card's screen status. The page says that this is a sample, not a play log.

### 6.10 Manage sites, displays and users (customer admin)
- Sites with time zone; displays with name, tags, canvas profile (change requires confirmation because renditions and layouts depend on it); invite users with role and optional site scope; view the customer's audit log including TINNOX support sessions and device-operations actions; alert preferences.
- Support access: see pending TINNOX requests and approve or reject them in one click; grant access proactively (view or edit, 24 hours by default, 7 days at most); revoke any grant at once; enable the optional pre-authorised self-grant; on the Managed plan, enable standing access (section 7.6).

### 6.11 Playback report
- Per display and date range: items played with counts and total seconds; CSV export; proof-of-play rows carry publication version, media identity and evidence type (`logged` or `sampled`). Times are stored in UTC and shown in the site's local time.
- The report covers the retention period of the customer's plan (section 20). Huidu-route rows are labelled "sampled, not audited".
- REFERENCE: Yodeck playback reports record all playback, batch upload from players and distinguish playback date from reported date (VERIFIED_FULL_PAGE, help article on playback reports, AV5 row 51). Yodeck generates them in Etc/UTC (VERIFIED_FULL_PAGE, `research/round2/AV4-layouts-scheduling.md` N5). TINNOX CMS adopts the date distinction and presents local time.

## 7. Operations console workflows

### 7.1 Create a customer and site
- Operator creates the customer (name, contact), its Entitlement (plan, term, included-until date), the first site (address, IANA time zone chosen from the canonical Australian list with a map hint), and the first admin user. Audit event.
- Plans and contracts: the account manager can change a customer's plan and term, apply a plan in bulk, and see renewal dates on the contracts screen (section 20.7).

### 7.2 Provision a device or controller
- Three paths for a TINNOX player: (a) pairing code shown by a freshly booted player (6 characters, 15-minute expiry, regenerated on expiry), entered in the console with customer, site, display name and canvas profile; (b) pre-provisioned claim token written to the player image at staging, which registers the device to a pre-created display automatically; (c) replace the device behind an existing display, which keeps display identity, schedule and history.
- Device credentials are issued at registration, bound to a hardware identifier, and rotated on demand. A device presenting another device's credential is rejected and an event raised.
- A registration beyond the customer's licensed display seats is refused with a clear message (section 20).
- **Commissioning a Huidu card** (route (b), and the control adapter on route (a)) (PROPOSED, R1):
  1. Record make, model, full device ID, firmware and HDMI-in. Only cards with a "D" engineering ID support the HTTP API (OFFICIALLY DOCUMENTED, R1).
  2. Write the TINNOX key to the card once. The card accepts a key only once (OFFICIALLY DOCUMENTED, R1). Store the key reference per card in the secrets vault; the secret never appears in the console or logs.
  3. If the card refuses because another party already keyed it, stop and show a clear console error. Do not retry.
  4. Set the site's Australian IANA zone on the card. The card's default is Asia/Shanghai (VERIFIED_FULL_PAGE, official HTTP API document, R1).
  5. Change or disable the card's Wi-Fi access-point password. The official sample value looks like a factory default, and the API returns the password in clear text (VERIFIED_FULL_PAGE, R1 verification).
  6. Confirm that HDPlayer on/off schedules are no longer used on the card. Enabling the HTTP API can stop them working (VERIFIED_FULL_PAGE, R1).
  7. Connect the card through an on-site agent or a VPN router. Port 30080 is plain HTTP (INFERRED from the official document's URLs, R1) and must never cross the public internet. A TINNOX-hosted gateway or reverse TCP connection is a lab spike only, because it rests on third-party evidence (HARDWARE-DEPENDENT/UNVERIFIED, R1 verification caveat 1).
- Which vendor API TINNOX already holds is open: a 16-hex `sdkKey` from Huidu support means Huidu; an AppKey and AppSecret from the VNNOX Open Platform means NovaStar (Q-T1). No adapter work starts on either assumption (PROPOSED, R99 C2).
- REFERENCE: Yodeck pairs with an on-screen registration code entered under Screens, Add Screen. Its public API takes the code as exactly 9 digits, and the first digit gives the player type (0 Raspberry Pi, 1 Web Player, 2 BrightSign, 3 Android 7 or earlier, 4 Tizen, 5 webOS, 6 Windows, 7 Fire OS, 8 Android Play Store, 9 ChromeOS). The help centre shows the Pi code as 8 digits and the Windows standard code as W plus 8 digits (VERIFIED_FULL_PAGE, R7 X8 and `research/round2/AV2-registration-api.md`). Yodeck supports pre-provisioning and locks purchased players to the buying account (VERIFIED_FULL_PAGE, help centre, AV2 rows 9 and 16). TINNOX CMS keeps the short-code and pre-provisioning paths and adds explicit device replacement and controller commissioning.

### 7.3 Confirm installation
- After pairing, the console shows the device's reported HDMI mode, the configured canvas and the content window; the installer can push a test slate (pixel ruler and orientation markers) that plays until first content is published. On an LED wall the installer confirms the ruler aligns at the panel edges.
- For NovaStar senders, the console warns when the canvas exceeds the sender's capacity. A Taurus TB60 handles about 2.3 Mpx, so PrecisionPro S3 and S4 and PrecisionMicro S4 need a larger model or a split canvas (THIRD PARTY, R5 verification and R99 C1; model per package is Q-T11). The EDID handshake at native canvas is HARDWARE-DEPENDENT/UNVERIFIED.
- For Huidu cards, the console shows the card's reported width, height and rotation from the HTTP API next to the canvas profile.

### 7.4 Fleet dashboard
- All displays across customers: online and offline counts, delivery states, update versions, temperatures, alerts, licence states; filters by customer, site, tag, platform, delivery route, controller vendor, version. A display drill-down shows the same page the customer sees, plus internal detail (device credential age, controller key status, raw heartbeat, log tail).

### 7.5 Triage a display that stopped updating
- The display page offers a triage panel that evaluates telemetry against known causes and states which applies: offline (last heartbeat age, last known network summary), DNS or CMS unreachable from the device, clock skew or no time sync, expired or mismatched credential, storage full, publication never created, display assigned to the wrong site, player version with a known defect, thermal throttling, publishing locked by licence state, and for Huidu cards: key not written, card keyed by another party, wrong time zone, agent or VPN down. Each cause links to its remedy: request diagnostics bundle, request screenshot, restart player app, reboot device, rotate credential, republish.
- Remote actions require confirmation and are audited with the operator identity; customers see them in their audit log. These actions are in the device-operations scope and need no customer grant (section 7.6).

### 7.6 Support access to a customer account (B+ policy)
TINNOX's support policy is option B+ (PROPOSED, R2; adopted over the AV1 opt-out proposal by R99 C4; TINNOX approval pending, Q-T6). It answers Q8. Vendors differ: Xibo Cloud and Yodeck partners have standing access by default; Signagelive, Salesforce, Zendesk and Atlassian need a customer grant (R2: VERIFIED_FULL_PAGE for Xibo and Yodeck; OFFICIALLY DOCUMENTED for Signagelive, Zendesk and Atlassian; THIRD PARTY for Salesforce). No public Samsung control that lets a customer grant or approve access was found (UNKNOWN, R2). B+ follows the customer-grant pattern because councils, schools and state bodies assess third-party access (APP 11, VPDSS, ST4S; OFFICIALLY DOCUMENTED, R2).

1. **Device-operations scope (always on, under the contract).** Operators see telemetry, logs, storage and screenshots, restart devices and roll out firmware for hardware TINNOX supplied or supports. They cannot view or edit media, playlists, schedules or users. Every action is logged in the customer's audit log. Screenshots are taken on demand only and kept 30 days, because they can show content.
2. **Content and account scope (customer grant).** Off by default. A TINNOX operator raises an in-app request with a reason and ticket number. A customer Admin or Owner approves it in one click, choosing view-only or edit. The admin can also grant access proactively. The default duration is 24 hours and the maximum is 7 days. Renewal is explicit. The customer can revoke a grant at any time, and revocation ends active sessions at once.
3. **Pre-authorised self-grant (optional).** The customer can let TINNOX open its own 24-hour grant without asking each time. Each self-grant is logged and e-mailed to the customer's admins. This mirrors Signagelive's middle mode (OFFICIALLY DOCUMENTED, R2 verification).
4. **Standing access (optional, Managed plan only).** For managed-service customers who want TINNOX to run their content. It is labelled clearly, re-confirmed by the customer every 12 months, and every session is still logged.
5. **Break-glass.** Only for incidents, for example abusive content on a public LED billboard or a legal take-down. It needs two TINNOX approvers (operator and manager), a reason and an incident number. It lasts 2 hours. The customer is notified at once by e-mail and in the portal. Each use is reviewed within 5 working days and reported to the customer monthly.
6. **Every session.** A named operator identity (no shared accounts) with MFA; a persistent banner in the portal; dual audit (operator and customer); visible in the customer's audit log with reason, start, end, scope and actions; an e-mail to the customer's admins when a session starts (default on).
7. **Third parties.** Controller vendors (Huidu, NovaStar) and contractors never get console or tenant access. If a vendor engineer must help, it happens in a TINNOX-run session or with minimal shared data. Any offshore access needs an APP 8 assessment and a contract (OFFICIALLY DOCUMENTED for APP 8, R2; legal confirmation pending).
8. **Offboarding.** Operator access is removed the day staff leave. A quarterly access review is recorded. Customer grants end when the contract ends.

Retention for these records is in section 10 item 8.

- REFERENCE: Yodeck partner staff have a "Support Login" permission, on by default, that lets them log in as any customer user. Each login is recorded in the partner's audit log with a "Support user" field. The customer's own audit log is Enterprise-only and keeps 90 days. Whether partner logins appear there is UNKNOWN (VERIFIED_FULL_PAGE, help centre, R2). TINNOX CMS makes the grant the customer's decision and the log the customer's record.

### 7.7 Updates
- Releases are uploaded with signature; channels `pilot` and `stable`; displays are assigned to channels; rollouts can be staged by percentage and limited to a maintenance window per site; a display can be pinned to a version. The console shows per-display update state and rollbacks.
- Huidu card firmware is not updated by TINNOX CMS in release 1. The console records the firmware version found at commissioning (PROPOSED).

## 8. Roles and permissions

| Capability | Customer Viewer | Customer Editor | Customer Admin | Customer Owner | TINNOX Operator | TINNOX Support (with active grant or break-glass) | TINNOX Admin |
|---|---|---|---|---|---|---|---|
| View media, playlists, layouts, schedules, delivery | yes | yes | yes | yes | fleet view only | yes (view or edit grant) | yes (with grant) |
| Upload, edit, delete content | | yes | yes | yes | | yes with edit grant (audited) | |
| Publish and rollback | | yes | yes | yes | | yes with edit grant (audited) | |
| Manage displays and sites within the customer | | | yes | yes | yes | yes with edit grant (audited) | yes |
| Invite and manage customer users | | | yes | yes | | | yes |
| Grant, approve and revoke TINNOX support access; enable self-grant or standing access | | | yes | yes | | | |
| Transfer ownership, delete customer data | | | | yes | | | yes (with Owner request) |
| Provision devices, commission controllers, move displays between customers | | | | | yes | | yes |
| Device-operations scope (telemetry, screenshot, restart, firmware) | | | | | yes | yes, no grant needed (audited) | yes |
| Request a support grant | | | | | | yes | yes |
| Approve break-glass (second approver) | | | | | | | yes |
| Manage plans, entitlements and licence states | | | | | yes | | yes |
| Manage releases and channels | | | | | | | yes |
| View customer audit log | | | yes | yes | | yes (with grant) | yes |

Site scoping: a customer user may be restricted to one or more sites; scoped users see only those sites' displays and schedules. Service tokens carry a role and a customer, are shown once, and are revocable.

REFERENCE: Yodeck offers a fixed role set, one role per user on every plan (one role per workspace on Enterprise), Enterprise-only workspaces and custom roles (VERIFIED_FULL_PAGE, AV1 rows 4 and 16), and no documented per-screen permission (INFERRED). Site scoping is TINNOX CMS's answer to that gap at the scale of its customers.

## 9. Scope decisions deferred

| Topic | Decision needed | Notes |
|---|---|---|
| Interactive kiosks and touch | Separate product decision | Android player can host it later; needs content types and analytics |
| Live video and streams | Separate | Player decode and network requirements differ; LED event walls |
| Synchronised playback across displays | Separate | Needs clock discipline and a lead-follow protocol |
| Advertising sales and revenue share | Deferred (R6) | Needs audited proof of play, share-of-voice and invoicing. Honest only on TINNOX-player routes, because Huidu cards give no play log. The Professional playback report is the bridge |
| Widgets and apps catalogue | Separate | Start with clock, weather and RSS only if a pilot customer needs them. Huidu's polling task can feed live data on route (b) later |
| Brightness, power and panel health of LED controllers | Release 1 for Huidu "D" cards through the HTTP API; release 2 for others, each gated on a verified adapter per controller model | `docs/architecture-and-hardware.md` section 5; R1 |
| NovaStar control adapter (LAN) | Release 2 | Release 1 reaches NovaStar through route (a) only |
| Huidu cloud and NovaStar VNNOX routes | Excluded until a vendor shows an Australian region in writing | Conflicts with TINNOX answer Q9 (R1 route (d), architecture routes 3 and 6; R99 C15) |
| TINNOX app on a Huidu Android card | Lab spike only | Undocumented by Huidu (UNKNOWN, R1) |
| SSO and SCIM | When a customer requires it | Role model is designed so identity-provider groups can map to roles |
| Documents and web pages | PDF in release 1. PowerPoint (converted to video or images) and web pages in release 2, on TINNOX-player routes only | TINNOX answer Q11. Huidu cards have no web item (VERIFIED_FULL_PAGE, absence, R1) |
| Self-serve sign-up and in-product invoicing | Release 2 or later | Entitlements, licence states and billing export are in release 1 (section 20) |
| New Zealand | Later, as a data change | TINNOX answer Q6 |
| Migration from another CMS | None required | TINNOX answers Q1 and Q12 |

## 10. Customer isolation and support access (requirements)

1. Every customer-owned row carries the customer id; database row-level security enforces it for all application roles; the application never queries without a customer context except in explicitly TINNOX-scoped console code paths.
2. Object keys are content-addressed under a customer prefix; access is by short-lived signed URLs only; players and Huidu cards receive URLs only for objects in their current or pending publication.
3. API responses never reveal the existence of another customer's objects (404, not 403).
4. Device credentials are per device, bound to a hardware identifier, rotated on demand and revoked on device move. Huidu keys are held in the secrets vault and referenced per card, never stored in application tables.
5. Support access is a first-class object (SupportGrant, section 7.6): device-operations scope under contract; content and account scope only with a customer grant or break-glass; banner, dual audit and customer visibility for every session.
6. Deleting a customer soft-deletes immediately, purges after a retention period and produces a purge report. A lapse or downgrade disables but never deletes (section 20).
7. All customer data and media are stored in AWS ap-southeast-2 (Sydney), with backups and DR copies in ap-southeast-4 (Melbourne). The CDN is limited to the Australia price class. No storage outside Australia without a written customer opt-in (PROPOSED, R3). Cloudflare R2 has no Australian jurisdiction, so it is not used by default (OFFICIALLY DOCUMENTED, R3).
8. Retention: the customer audit log is kept 24 months, searchable in the portal, for every customer; support-session, grant and break-glass records are kept 7 years in write-once storage in Australia; device telemetry and raw logs are kept 90 days. Customers can export the audit log at any time. SIEM streaming and longer contractual retention are options (section 20). 24 months exceeds the ISM minimum of 12 months searchable (ISM-1988, OFFICIALLY DOCUMENTED, R2) (PROPOSED, R2; R99 C5; TINNOX approval pending, Q-T6).

## 11. Scheduling semantics and Australian time zones

Evidence for the zone rules is in the time-zone research summarised here (OFFICIALLY DOCUMENTED from the IANA tz source rules, with empirical checks against tzdata 2026e):

- Australian zones in the first release: Australia/Sydney, Melbourne, Hobart, Brisbane, Adelaide, Darwin, Perth, Broken_Hill, Lord_Howe, Eucla, Lindeman; plus Antarctica/Macquarie, Pacific/Norfolk, Indian/Christmas and Indian/Cocos selectable. New Zealand zones are not offered in release 1 (TINNOX answer Q6). The zone model is generic, so adding Pacific/Auckland later is a data change.
- Daylight saving in the five south-eastern zones and Norfolk starts on the first Sunday in October at 02:00 standard time (clocks go to 03:00) and ends on the first Sunday in April at 03:00 daylight time (clocks go back to 02:00). Lord Howe shifts by 30 minutes (02:00 to 02:30 in October, 02:00 to 01:30 in April). Brisbane, Darwin, Perth, Eucla and Lindeman do not observe it. Dates: 5 April and 4 October 2026, 4 April and 3 October 2027.

Rules (PROPOSED):

1. Schedules are stored as **wall-clock rules**: local start and end times, weekday or RRULE recurrence, date range, and the site's IANA zone. They are never stored as bare UTC instants. (A school notice at 08:30 stored as 22:30Z would drift to 09:30 local after the October change.)
2. The server materialises resolved UTC occurrences for a rolling 14-day horizon and records the tzdata version used; the player evaluates the same wall-clock rule locally and uses the server-resolved occurrences as a cross-check when its tzdata is older.
3. Non-existent local times (the skipped hour in October) follow RFC 5545: the occurrence is interpreted with the offset before the gap, so a 02:30 event becomes 03:30 daylight time; a window entirely inside the gap is skipped and the editor says so. Repeated local times (the April hour) run once, on the first occurrence, unless the event opts into the second occurrence.
4. On and off windows (for example, kiosk off 02:00 to 05:00) are **wall-clock predicates**: the display is off while local time is in the window, so the real duration is 2 hours on the October date and 4 hours on the April date. Duration-based windows are a separate option with explicit labelling.
5. Priorities 0 to 100 resolve overlaps and the higher number wins; equal priority resolves to the most recently published event; the default content fills gaps.
6. Changing a site's time zone keeps wall-clock times, lists the affected displays and requires confirmation.
7. Players gate schedule evaluation on time synchronisation; before sync they use the last persisted good time plus the monotonic clock, never the epoch default, and report sync state and tzdata version in every heartbeat.
8. The zone picker shows canonical IANA names only, with the UTC offset computed for the date being viewed. Aliases (for example Australia/ACT or Australia/Canberra) are accepted on import and stored as the canonical name; `Etc/*` zones are rejected. Fixed offset labels are wrong half the year, and `Etc/GMT+10` means UTC-10 (VERIFIED_FULL_PAGE, AV4 N2 and N3; R7 P1).
9. For `huidu_push` displays, the server sends the site zone to the card through `setDeviceProperty` at commissioning and whenever the site zone changes, and compiles events into the card's local-time playback windows (PROPOSED, R1). How the card handles the daylight-saving transition hours is HARDWARE-DEPENDENT/UNVERIFIED (acceptance test HUI-03 covers 08:30 in Sydney and Brisbane).
10. Proof-of-play times are stored in UTC and shown in the site's local time.
11. Resume versus restart is explicit. When a higher-priority event ends, the interrupted playlist resumes at the item that was interrupted, from that item's start. After a reboot or a new publication, playback restarts from item 1. The schedule editor states this next to the priority setting (PROPOSED). Behaviour on Huidu cards is HARDWARE-DEPENDENT/UNVERIFIED.

REFERENCE: Yodeck sets time zone per screen (VERIFIED_FULL_PAGE, AV4 S14). A statement that the user's profile zone does not affect screens was not found in the help centre (UNKNOWN, AV4 S16). Its help centre and API spec never mention daylight saving, and its zone list mixes aliases with canonical names (VERIFIED_FULL_PAGE, AV4). Its help centre says a layout or playlist restarts from item 1 after a priority event, while another page says it "resumes" (VERIFIED_FULL_PAGE, AV4 N6). Xibo converts event times with the display zone when the event opts in (VERIFIED_FULL_PAGE, source code, R8 A23).

## 12. Publishing and delivery states

TINNOX player route (`tinnox_player`):

| State | Set by | Meaning | Shown to customer as |
|---|---|---|---|
| Media `uploaded` | upload completion | bytes received and checksum verified | "Uploaded, checking" |
| Media `processing` | worker start | renditions being produced | "Processing" with spinner |
| Media `ready` or `failed` | worker end | playable, or failed with reason | "Ready" or "Failed: reason" |
| Publication `draft` | any edit | unpublished changes exist | "Unpublished changes" badge |
| Publication `published` | publish action | immutable version created, manifest signed | "Published v12 by X at T" |
| Delivery `pending` | publish | display has not yet acknowledged the version | "Waiting for display" with offline note if applicable |
| Delivery `downloading` | first progress report | files transferring, with percentage | "Downloading 63%" |
| Delivery `downloaded` | all files verified on device | ready to switch | "Downloaded, switching" |
| Delivery `playing` | player reports version on screen | confirmed | "Playing v12 since T" |
| Delivery `error` | player or server | checksum failures exhausted, storage full, unsupported file | "Error: reason" with remedy |

Players download new versions in the background, verify every file by hash, switch atomically between items, and keep the previous version for rollback. Downloads use range requests and resume; corrupt chunks are refetched up to three times before `error`. A display that is offline at publish time shows `pending (offline since T)` and catches up on reconnect.

Huidu program push route (`huidu_push`) (PROPOSED, R1):

| State | Set by | Meaning | Shown to customer as |
|---|---|---|---|
| Delivery `pending` | publish | the server has compiled the publication into Huidu programs; not yet sent | "Waiting for sign" |
| Delivery `sent` | card accepts the program `replace` call | the card has the program list and will fetch media by URL | "Sent to sign" |
| Delivery `card-downloaded` | `getAll` shows the programs and every file's MD5 is present on the card | ready to play | "Downloaded to sign" |
| Delivery `playing (sampled)` | a screenshot and the card's screen status match the publication | sampled evidence, not a play log | "Playing v12 (sampled at T)" |
| Delivery `error` | card or server | key refused, card unreachable through agent or VPN, file fetch failed | "Error: reason" with remedy |

REFERENCE: Yodeck screens show statuses such as Online, Offline, Upgrading, Disabled and Not Registered. Its content status has six values: Up to date, Downloading, Unknown, Pending Media (download deferred by Restricted Download Hours), Possibly Outdated and Not Updated (VERIFIED_FULL_PAGE, help centre, `research/round2/AV5-publish-monitor-offline.md` row 8). Only affected screens download after a push (VERIFIED_FULL_PAGE, AV5 row 2). Its bulk push status is tracked per account with no job ID (VERIFIED_FULL_PAGE, public spec, R7). Download progress visibility in its interface is UNKNOWN.

## 13. Monitoring, diagnostics and reporting

- Heartbeat every 60 seconds (target) with player version, uptime, boot reason, storage, SoC temperature and throttling flags, network summary (interface, IP, gateway reachability, DNS result, CMS reachability), clock sync and tzdata version, current publication and item. Offline after three missed heartbeats. Huidu cards are polled through the agent for `getDeviceStatus` and screen status at the same target interval (PROPOSED).
- Screenshot on demand within 15 seconds (target); periodic screenshots optional per display (default every 15 minutes, retained 7 days). On the Huidu route the screenshot comes from the card's screenshot endpoint and is the proof-of-play sample.
- Diagnostics bundle on demand: the heartbeat fields plus cache manifest with per-file state, last 200 log lines, schedule evaluation and next change time.
- Alerts:
  - Offline: default after 30 minutes, with a recovery alert when the display comes back; configurable, with "do not alert during scheduled off hours" (PROPOSED). Yodeck's default for new screens is 6 hours with no back-online alert (VERIFIED_FULL_PAGE, AV5 row 34); an unattended LED board needs a shorter default.
  - Temperature: alert at about 75 °C SoC temperature, before the Pi throttle point of 80 °C (VERIFIED_FULL_PAGE throttle point, Pi documentation, R4 verification #7). Throttling flags raise an alert.
  - Update failed, storage below 10%, delivery error.
- Recipients: per display and per customer, chosen from customer users and TINNOX staff. External e-mail addresses are allowed after the address is verified (PROPOSED, R99 C11). Alerts resolve automatically.
- Playback log batched from the player, uploaded on reconnect, with playback time distinct from reported time; CSV export.
- Webhooks for device events (online and offline, publish completed, media ready, playback batch, alert) are designed now and delivered in release 2, signed with HMAC-SHA256 and a timestamp, with a documented retry policy (PROPOSED, R7 P5).

REFERENCE: Yodeck lets each screen have its own offline-alert recipient list. The help centre limits recipients to users with Device Manager access, while the API example shows external addresses (VERIFIED_FULL_PAGE, AV5 and R7 X9; whether the UI accepts external addresses is UNKNOWN). Its playback reports batch records (OFFICIALLY DOCUMENTED). Its own pages give conflicting screenshot cadences: 30 seconds or 30 to 40 seconds while a screen is watched, and one per hour or every two hours otherwise (VERIFIED_FULL_PAGE, AV5 rows 18 and 37).

## 14. Player requirements: offline, startup, updates, recovery

These apply to the TINNOX player (route (a)). On the Huidu route the card stores programs and runs its schedules offline by itself (VERIFIED_FULL_PAGE, R1); TINNOX CMS keeps its own record of what it sent.

1. Boots to playback without interaction; no public-facing error dialogs; a small staff-visible status indicator.
2. Plays the current publication from local cache indefinitely without network; evaluates schedules locally, including daylight-saving transitions.
3. Survives power loss: read-only root with overlay (Linux) or journaled cache (Android); cache integrity check at boot; last-known-good time persisted. On the Pi 5 the RTC backup cell's charging is off by default, so the image must enable it (`dtparam=rtc_bbat_vchg`) where a rechargeable cell is fitted (VERIFIED_FULL_PAGE, Pi documentation, R4). The CM5 is assumed to behave the same way (INFERRED from the shared power-management chip, R4).
4. Watchdog restarts the renderer within 60 seconds of a freeze; three restarts in ten minutes trigger one reboot and an alert. On Android, `DISALLOW_SYSTEM_ERROR_DIALOGS` hides crash dialogs and force-stops the crashed app but does not restart it, so the TINNOX app needs its own relaunch (home or lock-task launcher, or an alarm watchdog) (VERIFIED_FULL_PAGE, AOSP source, R4).
5. Updates are signed, downloaded in the background, applied in the site's maintenance window, health-checked within 2 minutes and rolled back automatically on failure; OS images are A/B; power loss during an update never leaves a half-installed state.
6. Outbound-only connectivity over HTTPS (and MQTT over TLS if used); no inbound ports; works behind proxies configured at provisioning.
7. Canvas rendering at the exact configured pixel dimensions, orientation and content window; on Linux the HDMI mode is forced from the canvas profile when the display's EDID does not offer it.
8. Reports every state transition it makes.
9. Outdoor players are rated for at least 60 °C operation and mounted in the cabinet's cooled controller compartment, never in an unconditioned, sun-loaded space. They run at stock clocks and report temperature (PROPOSED, R4; thermal behaviour in an Australian summer cabinet is HARDWARE-DEPENDENT/UNVERIFIED until the Jan to Feb 2027 log).

REFERENCE: Yodeck documents cached offline playback with a warning three days before a cutoff and playback stopping with an error message 30 to 40 days after losing internet access (VERIFIED_FULL_PAGE, AV5 row 57). TINNOX CMS imposes no offline cutoff for a licensed display, and a lapsed licence never stops playback either (PROPOSED, section 20).

## 15. Media validation and processing rules

| Rule | Value (PROPOSED) |
|---|---|
| Image formats | PNG, JPEG, WebP; up to 50 megapixels; renditions at canvas size, contain and cover variants |
| Video formats | MP4 container; H.264 High or HEVC Main; up to 3840×2160, 60 fps, 2 GB |
| Renditions per player profile | **CM5 (Linux):** HEVC at canvas size first, because the Pi 5 and CM5 decode HEVC 4K60 in hardware while H.264 1080p60 takes about 50 to 60% CPU in software (VERIFIED_FULL_PAGE, Pi documentation, R4 verification). **Android (RK3588 class):** H.264, with HEVC where the box supports it. **Huidu cards:** H.264 at the card's canvas; codec, bitrate and font limits are HARDWARE-DEPENDENT/UNVERIFIED (R1). Poster frame for every video |
| Rejections | Wrong container, unsupported codec (ProRes, HEVC 10-bit on players lacking it), empty file, extension mismatch, over size, corrupt stream; each with a named reason |
| Documents | Release 1: PDF rasterised to one image per page at canvas size. Release 2: PowerPoint converted to video or images, and web pages, on TINNOX-player routes only (TINNOX answer Q11) |
| Processing time target | Under 2 minutes for a 1-minute 1080p clip at pilot |
| Quotas | Per customer storage quota from the plan (section 20) with usage display |

## 16. API

First release: read-only REST API per customer (displays, delivery states, heartbeats summary, playback logs, media list) with service tokens carrying a role, documented with OpenAPI.

- Rate limits are published as numbers per token and per customer. A throttled request gets a 429 with a `Retry-After` header and a JSON error body (PROPOSED, R7 P4). The figures are set at pilot.
- Device commands (screenshot now, restart, reboot, re-push) return a job ID with a per-device result, so status is tracked per job, never per account (PROPOSED, R7 P6). In release 1 these are console actions; the public API exposes job status read-only.
- Write operations and webhooks are later (section 13).

REFERENCE: Yodeck API tokens act as a user with a role (VERIFIED_FULL_PAGE, public spec, AV2 row 40). The Premium and Enterprise plan gate is stated only on its AI-agent page; no page states the plan for the REST API (AV1 row 24, AV2 row 53). Its public spec publishes three rate-limit levels per rolling 10 seconds, counted per token and per account: Low 14 and 42, Standard 21 and 63, High 33 and 99. A throttled request gets a 429 with no body and a `Retry-After` header in seconds (VERIFIED_FULL_PAGE, public spec, R7 F2).

## 17. Non-functional requirements

- Security: MFA for all users; TINNOX staff MFA mandatory; TLS everywhere between cloud, players and agents; Huidu port 30080 traffic kept on the site LAN or a VPN; signed player releases; secrets and Huidu keys in a managed store; KMS customer-managed keys in Sydney; an AWS Organisations policy that denies non-Australian regions; dependency scanning; annual penetration test before the first external customer.
- Privacy: customer data stored in Australian regions only (TINNOX answer Q9); minimal personal data (user name and email); a CMS privacy statement separate from the website's, listing data locations; Australian Privacy Principles applied in the retention schedule (section 10 item 8); an NDB response plan with the 30-day assessment window (OFFICIALLY DOCUMENTED, R2 and R3).
- Availability: AWS Sydney primary with daily backups, encrypted copies replicated to Melbourne, and a tested restore from Melbourne within 4 hours at pilot. Postgres is Single-AZ until about 300 to 500 screens, then Multi-AZ. Players and Huidu cards are unaffected by CMS downtime beyond delayed publishes.
- Hosting cost: R3 Option A, all in Australia (PROPOSED, R3). Prices are VERIFIED_FULL_PAGE from the AWS price list; sizing is INFERRED. FX is 1 AUD = 0.69 USD (rounded from 0.6928 on 1 Oct 2026, THIRD PARTY). Support plans are excluded.

| Screens | 10 | 100 | 500 (HA database) | 2,000 (HA database) |
|---|---|---|---|---|
| AUD per month | 109 | 263 | 1,002 | 2,913 |
| AUD per screen per month | 10.90 | 2.63 | 2.00 | 1.46 |

Egress is about 35% of cost at 2,000 screens, so player caching and content-hash downloads matter more than the provider. Google Cloud Sydney and Melbourne is the alternative at about 19 to 32% more. Inter-region DR transfer costs USD 0.080 per GB (VERIFIED_FULL_PAGE, R3 verification).
- Performance: portal pages under 2 seconds on a 10 Mbps link; fleet dashboard for 500 displays under 3 seconds.
- Accessibility: keyboard navigation and labelled controls in the portal.
- Observability: structured logs, metrics and alerting for the platform and per-device state.

## 18. Branding and design

TINNOX will supply logo, colours and typography later (TINNOX answer Q5). Until then the interface uses provisional tokens taken from tinnox.com.au: primary Deep Teal #0f4761, ink Midnight #12212a, accent Signal Sky #72afc2; Manrope for headings and Inter for body text, both under the SIL Open Font Licence (VERIFIED_FULL_PAGE, R5). The logo is not embedded until TINNOX supplies it, and use of the tokens meanwhile is to be confirmed (Q-T13). The interface is designed from scratch: a left navigation for Media, Playlists, Layouts, Schedules, Displays, Reports and Settings in the portal; Customers, Fleet, Devices, Controllers, Contracts, Releases and Audit in the console. A preview-first layout editor and a delivery-state-first display page are the two signature screens. No Yodeck imagery, copy or layout is reused.

## 19. Traceability to the brief

| Brief requirement | Where |
|---|---|
| Customer, site, display organisation | sections 5, 6.10, 7.1 |
| Customer isolation and role-based access | sections 8, 10 |
| Authorised, audited TINNOX support access | sections 7.6, 10 |
| Portrait kiosks and LED screens with custom dimensions | sections 5 (CanvasProfile), 6.5, 6.6, 7.3, 14.7 |
| Accurate fit, crop, letterbox previews | section 6.6 |
| Site-specific time zones and daylight saving | section 11 |
| Local playback during outages | section 14 |
| Clear uploaded, published, downloaded, playing states | section 12 |
| Diagnostics that reduce site visits | sections 7.5, 13 |
| Narrow first release with separate scope decisions | sections 4, 9 |
| Huidu and NovaStar controllers (Q2) | sections 4, 5 (Controller), 7.2, 7.3, 12 |
| Australian data and security compliance (Q9) | sections 10, 17 |
| Hardware plus own software for margin and recurring revenue (Q7) | section 20 |

## 20. Commercial model hooks

TINNOX's plan is to sell hardware with its own software to increase profit and recurring revenue (TINNOX answer Q7). This section lists what release 1 must build so that plan works. Prices are PROPOSED bands from `research/round2/R6-commercial-model.md` and need TINNOX's inputs (Q-T5, Q-T7).

### 20.1 Packaging (PROPOSED)

| Package | What the customer buys | Price band (AUD per display per month, ex GST, annual prepay) |
|---|---|---|
| Hardware with 12 months included | Every installed display gets 12 months of the Essential plan, shown as a line item on the quote. The included year is aligned with the 1-year on-site warranty year; the standard warranty is 2 years product plus 1 year on-site (VERIFIED_FULL_PAGE, R5) | Built into the hardware price (list value AUD 180 to 228 per display) |
| Essential | Core signage | 15 to 19 |
| Professional | Adds site scoping, API, periodic screenshots, longer playback history | 25 to 32 |
| Managed | Adds TINNOX content changes, proactive monitoring, SLA, optional standing support access | 49 to 79 |
| Prepaid term | 3 or 5 years of a plan, paid with the hardware | 3 years for the price of 32 months; 5 years for 50 months |
| Signage-as-a-Service | Hardware, installation, Managed plan and extended warranty for 36 or 60 months through a finance partner | Quote per site (rental factor UNKNOWN) |

Monthly billing is allowed at 15% more. Volume pricing applies above 50 displays per customer. There is no perpetual licence. The market band for comparison is about AUD 7 to 45 per screen per month (VERIFIED_FULL_PAGE for Yodeck and Xibo, THIRD PARTY for most others, R6). The product-warranty extension is offered as a cross-sell with the subscription (R99 C9).

### 20.2 Plan features and retention (PROPOSED)

| Feature | Essential | Professional | Managed |
|---|---|---|---|
| Images, video, PDF, playlists, layouts, scheduling, publish, delivery states | yes | yes | yes |
| Storage quota (pooled per customer) | 5 GB per licensed display | 20 GB per display | 50 GB per display |
| Users | up to 5 | unlimited | unlimited |
| Site scoping of users | no | yes | yes |
| Offline and alert e-mails, screenshot on demand | yes | yes | yes, and TINNOX watches alerts |
| Periodic screenshots (7-day retention) | no | yes | yes |
| Playback-log (proof-of-play) retention | 31 days | 13 months | 25 months |
| Customer audit log | 24 months | 24 months | 24 months |
| Support, grant and break-glass records (write-once) | 7 years | 7 years | 7 years |
| SIEM streaming, longer contractual audit retention | no | no | option |
| Read-only API | no | yes | yes |
| PowerPoint and web pages (release 2, TINNOX-player routes only) | no | yes | yes |
| Huidu brightness schedule and screen on/off (release 1); other controllers (release 2) | no | yes | yes |
| Standing support access (section 7.6) | no | no | option |
| Support | business hours | priority, next business day | SLA, content changes, quarterly review |
| SSO (when built) | no | no | yes |

Audit retention is a compliance floor, not a sales tier: every plan gets 24 months searchable and 7 years write-once for support and break-glass records (R99 C5, R2). Only playback-log retention is tiered. Managed and government customers have a floor of 13 months for playback logs (R99 C6). These retention values are subject to TINNOX approval (Q-T6).

### 20.3 Entitlement service and route capabilities

- One entitlement service answers every feature check. Code never tests the plan name directly. Every entitlement change is audited with actor and before and after values.
- A feature is available on a display only if the plan allows it **and** the display's delivery route supports it. Route capabilities (PROPOSED, R99 C7):

| Capability | `tinnox_player` | `huidu_push` |
|---|---|---|
| Images, video, two-region layout | yes | yes (compiled to Huidu areas) |
| PDF (as images) | yes | yes |
| PowerPoint and web pages (release 2) | yes | no (no web item on the card, VERIFIED_FULL_PAGE absence, R1) |
| Proof of play | logged | sampled only |
| Brightness and screen on/off | only through the controller adapter | yes on "D" cards |

The per-display route check is tested by ENT-05 in `docs/acceptance-tests.md`.

### 20.4 Licence states

Each display has a LicenceState: `demo` → `included` → `active` → `grace` → `suspended` → `expired`.

| State | Meaning | Effect |
|---|---|---|
| `demo` | Not billable | Full features; does not count towards billing |
| `included` | Within the included 12 months | Full plan features |
| `active` | Paid term current | Full plan features |
| `grace` | 30 days after licence end or non-payment | Banner in the portal only, never on the screen |
| `suspended` | After grace | Publishing, uploads and new users locked; portal read-only; TINNOX monitoring alerts off; **the player or card keeps playing the last publication** |
| `expired` | After 90 days suspended | The player keeps the last publication or a customer-chosen holding slate; data kept a further 90 days with written notice before deletion |

A lapse locks publishing, never playback. Nothing is ever shown on the public screen because of a licence state. REFERENCE: Yodeck flashes a red image on customers' screens after 5 days of failed payment and leaves only one screen active after 2 weeks (VERIFIED_FULL_PAGE, R6). TINNOX CMS does not do this on public LED signage.

### 20.5 Disabled, not deleted

- Every lapse, downgrade or cancellation keeps media, playlists, schedules, publications, playback logs and audit logs until a documented deletion date.
- A downgrade disables features above the plan but keeps their data, for example API tokens become `disabled` and site scopes are kept. Re-upgrading restores them.
- Deletion is a separate, audited, two-person action on an Owner request (section 8).

### 20.6 Quotas

Licensed display seats (a registration beyond seats is refused with a clear message); storage pooled per customer; users on Essential; API rate limits and token count; playback-log retention by plan; egress metered per customer per month for reporting, even when not enforced, because egress is the main hosting cost driver (R3).

### 20.7 Billing export and contracts

- A monthly CSV and JSON export per customer: billable display-days by plan, prorations (additions charged at once, reductions at renewal), included and demo displays at zero, term dates, purchase-order reference and hardware serials.
- The format suits import into TINNOX's accounting system, Xero or MYOB (to be confirmed, Q-T7). Tax invoices with ABN and GST are produced by the accounting system, not by the CMS.
- Prices are quoted and exported ex GST and labelled "+ GST". Consumer-facing prices, if any, show the GST-inclusive total (OFFICIALLY DOCUMENTED, ACCC, R6). Standard terms (auto-renewal, price changes, suspension, deletion) need legal review under the unfair contract terms regime (THIRD PARTY, R6).
- Console: contracts screen (plan, term, included-until, renewal date); renewal reminders at 60, 30 and 7 days to the account manager and the customer Owner; bulk "apply plan"; price book with effective dates; a report of displays whose included period ends within 90 days.
- Hardware link: each display records device serial, controller model, hardware warranty end and contract ID, so warranty, SLA and subscription line up on one page.
- Release 2 or later: self-serve sign-up with card payments, in-product invoices, ad booking and per-advertiser proof-of-play reports.

At 150 displays with a 60/30/10 plan mix, the model gives about AUD 3,225 a month ex GST. Hosting at that size is about AUD 220 to 390 a month, which is 7 to 12% of that revenue (INFERRED, R6 with R3 Option A). The levers are plan mix, renewal after the included year and multi-year prepayment, not hosting cost.
