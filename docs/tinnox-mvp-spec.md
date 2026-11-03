# TINNOX CMS: first-release specification

Date: 2026-11-03. Status: PROPOSED. Working product name: TINNOX CMS. This specification describes an independently designed product. Where a Yodeck behaviour informed a decision it is cited as a reference from `docs/yodeck-workflow-audit.md` with its evidence label; nothing is copied from Yodeck's software, interface or assets.

Labels: **VERIFIED** (public fact with a source in the other documents), **REFERENCE** (a documented Yodeck or Xibo behaviour used for comparison), **PROPOSED** (this specification's decision), **ASSUMPTION** (see `docs/open-questions.md` section 4).

## 1. Purpose and positioning

TINNOX sells and installs LED video walls, digital pylons, LED billboards and indoor and outdoor LCD kiosks across Australia, with on-site warranty and SLAs, and today supplies a separately licensed third-party CMS whose vendor is not named publicly (VERIFIED, `docs/tinnox-context.md`). TINNOX CMS replaces that resold licence with an owned platform sold alongside the hardware. It has two surfaces on one platform:

- **Customer portal**: customers manage media, playlists, layouts, schedules, sites, displays and their own users.
- **TINNOX operations console**: authorised staff provision devices, monitor the fleet, administer customers and support them under audit.

Owning the software means TINNOX controls the roadmap, hosting, pricing, customer data and diagnostics; it also means TINNOX carries uptime, security and update obligations (PROPOSED, `docs/tinnox-context.md` section 5).

## 2. Product principles

1. **Narrow first release.** Images and video on a schedule, delivered reliably to displays TINNOX installs, with diagnostics that avoid site visits. Everything else is a later scope decision (section 9).
2. **The canvas is a first-class object.** LED walls, pylons and portrait kiosks have arbitrary pixel dimensions. Previews must show exactly what the display will show.
3. **Site-local time.** Every schedule is evaluated in the site's Australian time zone with correct daylight-saving behaviour, on the server and on the player identically.
4. **Honest states.** A customer can always tell whether content is uploaded, published, downloaded or playing on each display, and when that last changed.
5. **Offline is normal.** Players keep playing through outages and recover from power loss without a person present.
6. **Customers are isolated; support is explicit and audited.** No cross-customer visibility; TINNOX staff enter a customer's account only through a logged, time-boxed support session.
7. **Original design.** TINNOX branding and an original interface. Yodeck is a reference for workflow expectations only.

## 3. Personas and scenarios

| Persona | Surface | Needs |
|---|---|---|
| Customer content editor (school office, retail marketing, council communications officer) | Portal | Upload, arrange, schedule, preview, publish, see that it is playing |
| Customer administrator | Portal | Users, sites, displays, audit of their own account, alerts |
| TINNOX installer | Console (mobile-friendly) | Pair a device on site in minutes, confirm canvas and orientation, see first content |
| TINNOX support engineer | Console | Fleet health, triage a display that stopped updating, remote restart, support session into a customer account |
| TINNOX account manager | Console | Create customers and sites, assign devices, see usage |

Scenarios (ASSUMPTION A6 set, from the brief):

1. **School notices on an outdoor sign.** One site, one LED sign (landscape or portrait), weekly timetable of notices, term dates, occasional emergency notice published within minutes.
2. **Retailer promotions across locations.** One customer, many sites in several states, one campaign with dated start and end, per-site exceptions, confirmation that every site is playing it.
3. **Council public-information kiosks.** Portrait LCD kiosks, long dwell content, approval before publishing, proof that content played for a reporting period.
4. **TINNOX support investigates a display that stopped updating.** Last heartbeat, delivery state, storage, network and clock diagnostics, screenshot, remote restart, audit of who changed what, without a site visit.

## 4. Scope of the first release

### In scope

| Area | First release |
|---|---|
| Tenancy | Customers (tenants) with sites and displays; TINNOX operators provision customers (no self-serve sign-up) |
| Users and roles | Customer roles: Owner, Admin, Editor, Viewer, with optional site scoping; TINNOX roles: Operator, Support, Admin; MFA for all users |
| Devices | Pairing by short code, pre-provisioning by claim token, device credentials bound to hardware, move between sites and customers with cache purge |
| Canvas | Named canvas profiles with pixel width and height, orientation and fit defaults; portrait and custom LED dimensions |
| Media | Images (PNG, JPEG, WebP) and video (MP4 with H.264 or HEVC); validation, renditions per canvas, thumbnails, folders, tags, availability windows; PDF to images optional (ASSUMPTION A7) |
| Playlists | Ordered items with per-item duration, video natural length default, availability per item |
| Layouts | Full-canvas single region, plus a two-region template (main region and text band) for notices |
| Scheduling | Default content per display, dated and recurring events with priority, site time zone, preview of what plays when |
| Publishing | Explicit publish creating an immutable version; per-display delivery states; rollback to a previous version |
| Player | Linux player (Raspberry Pi 5 class) and Android device-owner player; offline cache; local schedule evaluation; watchdog; staged updates with rollback |
| Monitoring | Heartbeats, online and offline transitions, screenshots on demand, diagnostics bundle, remote restart, alerts, playback log with CSV export |
| Support | Support sessions with reason, time limit, banner and audit; customer-visible audit of support actions |
| Operations | Customer and site administration, device inventory, fleet dashboard, update channels |
| API | Read-only API with per-customer tokens for screens, delivery state and playback logs (write API later) |

### Out of scope for the first release (separate decisions, section 9)

Interactive kiosks and touch, live video and streams, synchronised playback across displays, advertising sales and billing, widget and app catalogue, document and web-page content beyond PDF, audio, self-serve sign-up and billing, SSO and SCIM, brightness and power control of LED controllers, SoC display apps, Windows and BrightSign players, migration tooling from the current CMS.

## 5. Domain model

| Entity | Key fields | Notes |
|---|---|---|
| Customer | id, name, status, settings (default time zone, retention), created by operator | The tenant. All content and device rows carry customer id and are protected by row-level security |
| Site | id, customer, name, address, IANA time zone (required), contact | Time zone is per site, never per customer (scenario 2) |
| CanvasProfile | id, customer or TINNOX-global, name, width px, height px, orientation (0, 90, 180, 270), default fit mode, safe margins | Examples: `1920×1080 landscape`, `1080×1920 portrait kiosk`, `640×1344 pylon` |
| Display | id, customer, site, name, canvas profile, tags, update channel, status | The logical screen a customer schedules to |
| Device | id, hardware id, platform (linux, android), credential hash, registered at, bound display, player version | The physical player; a display may be re-bound to a replacement device |
| Media | id, customer, folder, name, type (image, video, document), original object key, sha256, size, status (uploaded, processing, ready, failed), failure reason, duration, pixel size, tags, availability window | Originals are kept and downloadable (differs from the Yodeck REFERENCE where originals are not returned by the API, THIRD PARTY) |
| Rendition | media, canvas profile or generic profile, codec, width, height, object key, sha256, size | Produced by workers; immutable |
| Playlist | id, customer, name, items[] (media or playlist, order, duration seconds, fit override, availability) | Nested playlists allowed one level deep in the first release |
| Layout | id, customer, canvas profile, regions[] (geometry, content reference) | Two templates in the first release |
| Schedule | display or display group, default content, events[] | See section 11 |
| ScheduleEvent | content reference, local start and end wall-clock times, date range, recurrence rule (RFC 5545 RRULE), priority 0 to 100, gap and overlap policy | Stored as wall-clock rule plus the site's zone |
| Publication | id, customer, version number, created by, created at, manifest hash, change summary, state (draft, published, superseded) | Immutable once published |
| Delivery | display, publication, state (pending, downloading, downloaded, playing, error), progress bytes, error reason, timestamps per transition | The per-display truth shown to customers and support |
| Heartbeat and DeviceState | device, received at, player version, uptime, boot reason, storage free, temperature, network summary, clock sync state, tzdata version, current publication, current item | Latest row denormalised onto the device |
| PlaybackLog | device, publication, media, started at, duration, completed | Batched upload; retained 13 months (ASSUMPTION) |
| User, Role, Membership | user, customer or TINNOX, role, site scope | One user can belong to several customers (agency case) |
| SupportSession | operator, customer, reason, started, expires, ended, actions count | Section 10 |
| AuditEvent | actor (user, operator in support session, device, system), customer, action, object, before and after summary, IP, time | Retained 2 years (ASSUMPTION A8) |
| Alert | customer, display, type (offline, update failed, storage low, delivery error), opened, resolved, notified to | |
| UpdateChannel and Release | channel (stable, pilot), platform, version, package hash, signature, rollout percentage, pinned displays | Section 14 |

## 6. Customer portal workflows

Each workflow lists the goal, prerequisites, steps, inputs and validation, and resulting state changes. REFERENCE notes point to the audit.

### 6.1 Sign in and MFA
- Goal: authenticated access with MFA. Steps: email and password, TOTP code (enrolment on first login), optional passkey later. Validation: lockout after repeated failures, session inactivity timeout (default 12 hours, configurable by customer admin). State: session, audit event.
- REFERENCE: Yodeck offers per-user TOTP and, on its Enterprise plan, account-wide policies such as inactivity logout, single session and IP allow-listing (OFFICIALLY DOCUMENTED). TINNOX CMS includes MFA for everyone and defers the policy set.

### 6.2 Upload media
- Goal: add images or video to the library. Prerequisites: Editor or Admin role; free quota.
- Steps: choose files or drag in; the portal requests a resumable upload session (direct to object storage via presigned URLs, chunked); on completion the server validates the file (container, codec, dimensions, duration, size, extension matches content) and queues processing; renditions and thumbnails are produced for every canvas profile the customer uses; status moves `uploaded → processing → ready` or `failed` with a specific reason.
- Inputs and validation: PNG, JPEG, WebP up to 50 megapixels; MP4 with H.264 or HEVC up to 2 GB and 4K; anything else fails with a named reason. Interrupted uploads resume from the last chunk.
- State: media row and renditions; nothing reaches displays until published.
- REFERENCE: Yodeck's API models an upload as create record, obtain upload URL, transfer, complete, then poll a status that moves through initialized, uploading, encoding, finished or failed (THIRD PARTY, from client code). TINNOX CMS adopts the same explicit lifecycle and additionally keeps originals.

### 6.3 Organise media
- Folders (nested), tags, search, usage view ("used in 3 playlists, 2 displays"), replace media keeping assignments, delete with reference check.

### 6.4 Build a playlist
- Ordered items, drag reorder, per-item duration (images default 10 s, videos default natural length, both overridable), per-item fit override, per-item availability window (date range plus weekly slots), nested playlist. Empty playlists are allowed but publish shows a warning and displays fall back to the customer's idle slate.
- REFERENCE: Yodeck playlist items carry a position and per-item duration, video defaults to its natural length, and availability is a media-level property; per-item availability is not evidenced (THIRD PARTY, INFERRED). TINNOX CMS puts availability on the playlist item as well as the media.

### 6.5 Build a layout
- Pick a canvas profile; choose full-canvas or two-region template; assign a playlist or media to each region; text band region accepts plain text with font size and colour. Preview renders at the exact canvas pixel dimensions, scaled to fit the browser, with a 1:1 zoom option.

### 6.6 Preview fit, crop and letterbox
- For any media on any canvas profile the portal shows the four fit modes (contain with letterbox, cover with crop, stretch, actual size) using the same rendering rules the player uses (a shared rendering module compiled for the browser and the player). Crop shows the discarded area. The preview is pixel-accurate within 1 px (acceptance test MED-07).
- REFERENCE: Yodeck supports portrait by rotating the output and advises custom ratios with exact pixel dimensions for LED boards through a forced resolution and disabling unused portions (OFFICIALLY DOCUMENTED, Yodeck LED board article). TINNOX CMS makes the canvas an explicit object instead of a per-screen override.

### 6.7 Schedule content
- Per display or display group: a default (always-on) content item, plus events. An event has content, a date range, local start and end times, a recurrence rule, a priority and a name. The editor shows a week view in the site's time zone and a "what plays at" probe for any date and time. Overlaps are resolved by priority, then by most recently created; the editor flags overlaps.
- Daylight-saving behaviour follows section 11 and is shown inline for the affected dates ("this event is skipped on 4 Oct 2026 because 02:30 does not exist in Australia/Sydney").
- REFERENCE: Yodeck exposes per-screen time zone, weekly schedules with precedence by list order and filler content for gaps (OFFICIALLY DOCUMENTED and THIRD PARTY). Xibo stores a per-display time zone and a per-event flag to sync to it, and has open 2026 reporting bugs for zones ahead of UTC (OFFICIALLY DOCUMENTED, issue tracker). TINNOX CMS stores wall-clock rules per site and makes the daylight-saving outcome visible.

### 6.8 Publish
- "Unpublished changes" indicator at playlist, layout, schedule and display level. Publish shows the affected displays and a diff summary, requires confirmation, creates an immutable publication version, and moves each affected display to `pending`. The customer can republish any previous version.
- REFERENCE: Yodeck separates Save from Push to Screens; the push button turns orange after changes and only affected screens download (OFFICIALLY DOCUMENTED). TINNOX CMS keeps an explicit publish step because it gives a natural audit point and avoids half-edited content reaching an LED wall, and adds versioning and rollback.

### 6.9 Watch delivery and playback
- Display page shows: online state and last heartbeat; delivery state with progress percentage and timestamps for pending, downloading, downloaded and playing; current publication and current item; last screenshot with time; recent alerts.
- "Playing" is set only when the player reports the version on screen, and the next screenshot request confirms it.

### 6.10 Manage sites, displays and users (customer admin)
- Sites with time zone; displays with name, tags, canvas profile (change requires confirmation because renditions and layouts depend on it); invite users with role and optional site scope; view the customer's audit log including TINNOX support sessions; alert preferences.

### 6.11 Playback report
- Per display and date range: items played with counts and total seconds; CSV export; proof-of-play rows carry publication version and media identity.
- REFERENCE: Yodeck playback reports record all playback, batch upload from players and distinguish playback date from reported date (OFFICIALLY DOCUMENTED, help article on playback reports). TINNOX CMS adopts the same distinction.

## 7. Operations console workflows

### 7.1 Create a customer and site
- Operator creates the customer (name, default retention, contact), the first site (address, IANA time zone chosen from the Australian list with a map hint), and the first admin user. Audit event.

### 7.2 Provision a device
- Three paths: (a) pairing code shown by a freshly booted player (6 characters, 15-minute expiry, regenerated on expiry), entered in the console with customer, site, display name and canvas profile; (b) pre-provisioned claim token written to the player image at staging, which registers the device to a pre-created display automatically; (c) replace the device behind an existing display, which keeps display identity, schedule and history.
- Device credentials are issued at registration, bound to a hardware identifier, and rotated on demand. A device presenting another device's credential is rejected and an event raised.
- REFERENCE: Yodeck pairs with an on-screen 8 or 9 character code entered under Screens, Add Screen, pairs within one to two minutes, supports pre-provisioning by writing a screen identifier into a settings file, and locks purchased players to the buying account (OFFICIALLY DOCUMENTED). TINNOX CMS keeps the short-code and pre-provisioning paths and adds explicit device replacement.

### 7.3 Confirm installation
- After pairing, the console shows the device's reported HDMI mode and the configured canvas; the installer can push a test slate (pixel ruler and orientation markers) that plays until first content is published. On an LED wall the installer confirms the ruler aligns at the panel edges.

### 7.4 Fleet dashboard
- All displays across customers: online and offline counts, delivery states, update versions, alerts; filters by customer, site, tag, platform, version. A display drill-down shows the same page the customer sees, plus internal detail (device credential age, raw heartbeat, log tail).

### 7.5 Triage a display that stopped updating
- The display page offers a triage panel that evaluates telemetry against known causes and states which applies: offline (last heartbeat age, last known network summary), DNS or CMS unreachable from the device, clock skew or no time sync, expired or mismatched credential, storage full, publication never created, display assigned to the wrong site, player version with a known defect. Each cause links to its remedy: request diagnostics bundle, request screenshot, restart player app, reboot device, rotate credential, republish.
- Remote actions require confirmation and are audited with the operator identity; customers see them in their audit log.

### 7.6 Support session into a customer account
- Operator with the Support role selects a customer, enters a reason, and starts a session limited to 4 hours (extendable once). While active, the operator sees the customer portal with a persistent banner, every write is audited with both the operator identity and the customer, and the customer's admins can see the session in their audit log and, later, can require approval before sessions start (ASSUMPTION Q8).
- REFERENCE: Yodeck's partner console lets partner staff log in as any user of a customer account, with each login recorded in the partner's audit log; whether the customer sees it is unverified (OFFICIALLY DOCUMENTED and UNVERIFIED). TINNOX CMS makes customer-side visibility a requirement.

### 7.7 Updates
- Releases are uploaded with signature; channels `pilot` and `stable`; displays are assigned to channels; rollouts can be staged by percentage and limited to a maintenance window per site; a display can be pinned to a version. The console shows per-display update state and rollbacks.

## 8. Roles and permissions

| Capability | Customer Viewer | Customer Editor | Customer Admin | Customer Owner | TINNOX Operator | TINNOX Support (in session) | TINNOX Admin |
|---|---|---|---|---|---|---|---|
| View media, playlists, layouts, schedules, delivery | yes | yes | yes | yes | fleet view only | yes | yes |
| Upload, edit, delete content | | yes | yes | yes | | yes (audited) | |
| Publish and rollback | | yes | yes | yes | | yes (audited) | |
| Manage displays and sites within the customer | | | yes | yes | yes | yes (audited) | yes |
| Invite and manage customer users | | | yes | yes | | | yes |
| Transfer ownership, delete customer data | | | | yes | | | yes (with Owner request) |
| Provision devices, move displays between customers | | | | | yes | | yes |
| Start support sessions | | | | | | yes | yes |
| Manage releases and channels | | | | | | | yes |
| View customer audit log | | | yes | yes | | yes | yes |

Site scoping: a customer user may be restricted to one or more sites; scoped users see only those sites' displays and schedules. Service tokens carry a role and a customer, are shown once, and are revocable.

REFERENCE: Yodeck offers a fixed role set, one role per user on lower plans, Enterprise-only workspaces and custom roles, and no documented per-screen permission (OFFICIALLY DOCUMENTED and INFERRED). Site scoping is TINNOX CMS's answer to that gap at the scale of its customers.

## 9. Scope decisions deferred

| Topic | Decision needed | Notes |
|---|---|---|
| Interactive kiosks and touch | Separate product decision | Android player can host it later; needs content types and analytics |
| Live video and streams | Separate | Player decode and network requirements differ; LED event walls |
| Synchronised playback across displays | Separate | Needs clock discipline and a lead-follow protocol |
| Advertising sales and billing | Separate | Share-of-voice, campaigns, invoicing |
| Widgets and apps catalogue | Separate | Start with clock, weather and RSS only if a pilot customer needs them |
| Brightness, power and panel health of LED controllers | Second release, gated on a verified adapter per controller model | `docs/architecture-and-hardware.md` section 5 |
| SSO and SCIM | When a customer requires it | Role model is designed so identity-provider groups can map to roles |
| Documents and web pages | After the pilot | PDF to images first |
| Migration from the current CMS | After Q1 and Q12 in `docs/open-questions.md` | Originals must be re-collected if the current CMS does not return them |

## 10. Customer isolation and support access (requirements)

1. Every customer-owned row carries the customer id; database row-level security enforces it for all application roles; the application never queries without a customer context except in explicitly TINNOX-scoped console code paths.
2. Object keys are content-addressed under a customer prefix; access is by short-lived signed URLs only; players receive URLs only for objects in their current or pending publication.
3. API responses never reveal the existence of another customer's objects (404, not 403).
4. Device credentials are per device, bound to a hardware identifier, rotated on demand and revoked on device move.
5. Support access is a first-class object (section 7.6) with reason, time limit, banner, dual audit and customer visibility.
6. Deleting a customer soft-deletes immediately, purges after a retention period and produces a purge report.
7. Data is stored in Australian regions; media renditions may be served from a global content network if the customer's contract allows (ASSUMPTION; see `docs/architecture-and-hardware.md` section 8).

## 11. Scheduling semantics and Australian time zones

Evidence for the zone rules is in the time-zone research summarised here (VERIFIED against the IANA tz source rules and empirical checks with tzdata 2026e):

- Australian zones in the first release: Australia/Sydney, Melbourne, Hobart, Brisbane, Adelaide, Darwin, Perth, Broken_Hill, Lord_Howe, Eucla, Lindeman; plus Antarctica/Macquarie, Pacific/Norfolk, Indian/Christmas and Indian/Cocos selectable; Pacific/Auckland if Q6 confirms New Zealand.
- Daylight saving in the five south-eastern zones and Norfolk starts on the first Sunday in October at 02:00 standard time (clocks go to 03:00) and ends on the first Sunday in April at 03:00 daylight time (clocks go back to 02:00). Lord Howe shifts by 30 minutes (02:00 to 02:30 in October, 02:00 to 01:30 in April). Brisbane, Darwin, Perth, Eucla and Lindeman do not observe it. Dates: 5 April and 4 October 2026, 4 April and 3 October 2027.

Rules (PROPOSED):

1. Schedules are stored as **wall-clock rules**: local start and end times, weekday or RRULE recurrence, date range, and the site's IANA zone. They are never stored as bare UTC instants. (A school notice at 08:30 stored as 22:30Z would drift to 09:30 local after the October change.)
2. The server materialises resolved UTC occurrences for a rolling 14-day horizon and records the tzdata version used; the player evaluates the same wall-clock rule locally and uses the server-resolved occurrences as a cross-check when its tzdata is older.
3. Non-existent local times (the skipped hour in October) follow RFC 5545: the occurrence is interpreted with the offset before the gap, so a 02:30 event becomes 03:30 daylight time; a window entirely inside the gap is skipped and the editor says so. Repeated local times (the April hour) run once, on the first occurrence, unless the event opts into the second occurrence.
4. On and off windows (for example, kiosk off 02:00 to 05:00) are **wall-clock predicates**: the display is off while local time is in the window, so the real duration is 2 hours on the October date and 4 hours on the April date. Duration-based windows are a separate option with explicit labelling.
5. Priorities 0 to 100 resolve overlaps; equal priority resolves to the most recently published event; the default content fills gaps.
6. Changing a site's time zone keeps wall-clock times, lists the affected displays and requires confirmation.
7. Players gate schedule evaluation on time synchronisation; before sync they use the last persisted good time plus the monotonic clock, never the epoch default, and report sync state and tzdata version in every heartbeat.

REFERENCE: Yodeck sets time zone per screen and documents that the user's profile zone does not affect screens (OFFICIALLY DOCUMENTED); its handling of the transition hours is UNKNOWN. Xibo converts event times with the display zone when the event opts in (OFFICIALLY DOCUMENTED, source code).

## 12. Publishing and delivery states

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

REFERENCE: Yodeck screens show statuses such as Online, Offline, Upgrading, Disabled and Not Registered and content flags Possibly Outdated and Not Updated, and only affected screens download after a push (OFFICIALLY DOCUMENTED, screens table manual); download progress visibility in its interface is UNVERIFIED here.

## 13. Monitoring, diagnostics and reporting

- Heartbeat every 60 seconds (target) with player version, uptime, boot reason, storage, temperature where available, network summary (interface, IP, gateway reachability, DNS result, CMS reachability), clock sync and tzdata version, current publication and item. Offline after three missed heartbeats.
- Screenshot on demand within 15 seconds (target); periodic screenshots optional per display (default every 15 minutes, retained 7 days).
- Diagnostics bundle on demand: the heartbeat fields plus cache manifest with per-file state, last 200 log lines, schedule evaluation and next change time.
- Alerts: offline longer than a threshold (default 15 minutes, configurable, with "do not alert during scheduled off hours"), update failed, storage below 10%, delivery error. Notification by email to customer and TINNOX recipients per preferences; alerts resolve automatically.
- Playback log batched from the player, uploaded on reconnect, with playback time distinct from reported time; CSV export.

REFERENCE: Yodeck provides per-screen offline email notifications with a wait time and back-online alert (OFFICIALLY DOCUMENTED, April 2025 release), and playback reports that batch records (OFFICIALLY DOCUMENTED). The screenshot cadence reported by third parties (30 to 40 seconds) is UNVERIFIED.

## 14. Player requirements: offline, startup, updates, recovery

1. Boots to playback without interaction; no public-facing error dialogs; a small staff-visible status indicator.
2. Plays the current publication from local cache indefinitely without network; evaluates schedules locally, including daylight-saving transitions.
3. Survives power loss: read-only root with overlay (Linux) or journaled cache (Android); cache integrity check at boot; last-known-good time persisted.
4. Watchdog restarts the renderer within 60 seconds of a freeze; three restarts in ten minutes trigger one reboot and an alert.
5. Updates are signed, downloaded in the background, applied in the site's maintenance window, health-checked within 2 minutes and rolled back automatically on failure; OS images are A/B; power loss during an update never leaves a half-installed state.
6. Outbound-only connectivity over HTTPS (and MQTT over TLS if used); no inbound ports; works behind proxies configured at provisioning.
7. Canvas rendering at the exact configured pixel dimensions and orientation; on Linux the HDMI mode is forced from the canvas profile when the display's EDID does not offer it.
8. Reports every state transition it makes.

REFERENCE: Yodeck documents cached offline playback with a warning three days before a cutoff and playback stopping with an "Internet Access Required" message after 30 to 40 days offline (OFFICIALLY DOCUMENTED). TINNOX CMS imposes no offline cutoff for a licensed display (PROPOSED).

## 15. Media validation and processing rules

| Rule | Value (PROPOSED) |
|---|---|
| Image formats | PNG, JPEG, WebP; up to 50 megapixels; renditions at canvas size, contain and cover variants |
| Video formats | MP4 container; H.264 High or HEVC Main; up to 3840×2160, 60 fps, 2 GB; renditions: H.264 1080p-class for universal playback, HEVC at canvas size for Pi and Android hardware paths; poster frame |
| Rejections | Wrong container, unsupported codec (ProRes, HEVC 10-bit on players lacking it), empty file, extension mismatch, over size, corrupt stream; each with a named reason |
| Documents (optional) | PDF rasterised to one image per page at canvas size |
| Processing time target | Under 2 minutes for a 1-minute 1080p clip at pilot |
| Quotas | Per customer storage quota with usage display |

## 16. API

First release: read-only REST API per customer (displays, delivery states, heartbeats summary, playback logs, media list) with service tokens carrying a role, rate limited, documented with OpenAPI. Write operations and webhooks are later.

REFERENCE: Yodeck's API is available on its Premium and Enterprise plans, tokens act as a user with a role, and third parties report a limit of 21 requests per 10 seconds (OFFICIALLY DOCUMENTED and THIRD PARTY).

## 17. Non-functional requirements

- Security: MFA for all users; TINNOX staff MFA mandatory; TLS everywhere; signed player releases; secrets in a managed store; dependency scanning; annual penetration test before the first external customer.
- Privacy: customer data stored in Australian regions; minimal personal data (user name and email); Australian Privacy Principles considered in the retention schedule.
- Availability: single-region with daily backups and tested restore within 4 hours at pilot; players are unaffected by CMS downtime beyond delayed publishes.
- Performance: portal pages under 2 seconds on a 10 Mbps link; fleet dashboard for 500 displays under 3 seconds.
- Accessibility: keyboard navigation and labelled controls in the portal.
- Observability: structured logs, metrics and alerting for the platform and per-device state.

## 18. Branding and design

TINNOX supplies logo, colours and typography (Q5). The interface is designed from scratch: a left navigation for Media, Playlists, Layouts, Schedules, Displays, Reports and Settings in the portal; Customers, Fleet, Devices, Releases and Audit in the console. A preview-first layout editor and a delivery-state-first display page are the two signature screens. No Yodeck imagery, copy or layout is reused.

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
