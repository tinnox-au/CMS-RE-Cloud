# TINNOX CMS: architecture, hardware dependencies and build-versus-buy

Date: 2026-11-03. Status: PROPOSED architecture built on labelled evidence. Labels: **OFFICIALLY DOCUMENTED** (vendor or project documentation, repository files, or verbatim mirrors), **THIRD PARTY** (resellers, forums, open-source re-implementations), **INFERRED**, **PROPOSED**, **UNVERIFIED** (hardware-dependent, not tested), **UNKNOWN**. Vendor web sites (novastar.tech, docs.vnnox.com, xibosignage.com, brightsign.biz and others) were unreachable from this environment; vendor facts come from search-result snippets of their pages, GitHub-hosted documents and open-source client code, and are labelled accordingly. Nothing in this document was tested on real hardware.

## 1. The five separable concerns

| Concern | What it does | Who owns it in TINNOX CMS | Hardware or vendor dependence |
|---|---|---|---|
| **A. CMS interface and backend** | Customer portal, operations console, API, tenancy, users, roles, audit, scheduling engine, publication versions, telemetry store | TINNOX, fully owned | None (standard cloud services in an Australian region) |
| **B. Media storage and processing** | Upload, validation, transcoding to player profiles, renditions per canvas, thumbnails, signed delivery URLs, retention | TINNOX, fully owned; ffmpeg and libvips under their licences | None beyond object storage choice |
| **C. Playback software** | The player: downloads manifests and files, caches, evaluates schedules locally, renders layouts, plays video, reports state, takes screenshots, applies updates | TINNOX, fully owned | Depends on the player platform chosen (Linux on Raspberry Pi 5, Android device-owner app). SoC displays and vendor players are partner-gated |
| **D. LED controller and display integration** | Getting pixels onto the LED wall or LCD at the right canvas size; brightness, power, panel health | Shared: TINNOX owns the player side; the controller vendor owns the sending and receiving cards | High. NovaStar synchronous controllers consume HDMI only; control and monitoring need vendor tools, the VNNOX cloud API, or reverse-engineered LAN protocols |
| **E. Fleet monitoring and software updates** | Heartbeats, diagnostics bundles, alerts, remote restart, staged OTA updates with rollback, remote shell for support | TINNOX, fully owned, optionally using Mender or RAUC for OS images | None if built on the own agent; commercial MDM adds per-device fees |

The design rule that follows (PROPOSED): **content never depends on the controller vendor.** The CMS renders the exact canvas and delivers it over HDMI; controller-side control (brightness, power, panel health) is a separate, optional integration behind an adapter interface, so a site with a NovaStar controller and a site with a Huidu or Colorlight controller run the same player.

## 2. Reference topology

```
                       Australian cloud region
┌──────────────────────────────────────────────────────────────┐
│  Customer portal ──┐                                          │
│  Operations console┼── API / backend ── Postgres (tenant RLS) │
│  Player API ───────┘        │                                 │
│                             ├── Object storage (media, renditions, manifests)
│                             ├── Media workers (ffmpeg, libvips)
│                             └── Telemetry + command channel (heartbeat, screenshot, restart)
└──────────────────────────────────────────────────────────────┘
            │ HTTPS (manifests, range downloads)      ▲ heartbeats, logs, proof of play
            ▼                                          │
┌────────────────────────── site ─────────────────────────────┐
│  Player (Pi 5 Linux agent, or Android device-owner app)      │
│    cache ── schedule evaluator (site IANA zone) ── renderer  │
│      │ HDMI (standard or custom EDID mode)                    │
│      ▼                                                       │
│  LED controller (NovaStar sync card / VX / Taurus in sync    │
│  mode / Huidu / Colorlight)  → receiving cards → LED modules │
│  or LCD kiosk / outdoor LCD (HDMI in)                        │
│      ▲ optional LAN control adapter (brightness, power,       │
│        panel health) or vendor cloud API                     │
└──────────────────────────────────────────────────────────────┘
```

The LED signal chain and the independence of the physical canvas from the HDMI timing are THIRD PARTY findings consistent with the Taurus local API, which exposes an HDMI input resolution that is explicitly "not the physical LED screen size" (open-source client of the Taurus protocol). Custom non-16:9 modes are obtained by writing a custom EDID on the sending card in NovaLCT (Screen Config, Sending Card, Custom Resolution), by forcing the mode on the source (for a Linux source, a kernel `video=` entry with the `D` or `e` flags), or by accepting crop or letterbox at the controller (THIRD PARTY integrator runbooks; Raspberry Pi kernel mode documentation is OFFICIALLY DOCUMENTED).

## 3. Hardware questionnaire (to be completed per deployed site before the pilot)

This is the instrument that settles what the brief calls unconfirmed: the deployed models and their integration capabilities.

| # | Question | Why it matters |
|---|---|---|
| 1 | Controller or player make, exact model and firmware (NovaStar MCTRL300/600/660/700/4K, VX400/600/1000, COEX/MX, H-series; Taurus TB1/2/3/6/8/10/30/40/50/60, T or TU; Huidu; Colorlight; Linsn; other). Serial numbers | Decides which integration route (section 5) is even possible; serials are needed for VNNOX Care binding and Taurus login |
| 2 | Operating system and version of any player (Android version on Taurus or "DsDevice"; Linux or Windows on mini PCs) | Device-owner provisioning, codec limits, update path |
| 3 | What feeds HDMI today: "DsDevice" exact model (DSDevices DSCS9X, DSCS95, DSDA1, DSDX5, or something else), its Android version, RAM and storage, the app it runs, and how it is managed | Determines whether the current CMS is Xibo-based and whether the box can be re-used |
| 4 | Inputs available on the controller (HDMI, DVI, SDI, Ethernet-only on Taurus), and whether a Taurus runs asynchronous (internal) or synchronous (HDMI pass-through) mode, with the ViPlex source policy | A Taurus in asynchronous mode has no HDMI source; the content path is then VNNOX or ViPlex |
| 5 | Physical canvas in pixels (width × height), pixel pitch, cabinet layout, number of Ethernet ports used, mosaic across multiple cards | The player must render this exact canvas; width limits of sending cards apply even when pixel count fits |
| 6 | HDMI timing currently negotiated (read the EDID from the source), whether a custom resolution is flashed, and who holds the NovaLCT project and receiving-card configuration backups | Custom-mode strategy and recovery after a controller swap |
| 7 | Controller mapping of input to canvas (crop offset, scaling on or off), any tolerated letterbox | Determines preview fidelity in the portal |
| 8 | Network: is the controller or player on a LAN the player can reach (TCP 5200, UDP 16601 and TCP 16606 for Taurus, HTTPS 16674), is there a 4G module with no inbound reachability, firewall rules, proxy, captive portal | Diagnostics and control adapters need reachability; the player needs outbound HTTPS only |
| 9 | Brightness regime (fixed, scheduled table, light sensor), where the sensor is connected (Taurus, multifunction card, monitoring card) | Whether brightness control is in scope and via which route |
| 10 | Power control (software screen-off versus mains contactor or timer) and who schedules it | Separates playback from power |
| 11 | VNNOX account: edition (Standard, AD, Care), regional server (no Australian host was seen in public documentation), players bound to VNNOX Care, whether an Open Platform AppKey can be issued | Cloud API feasibility and data residency |
| 12 | Device passwords and who holds them (Taurus login, VNNOX, NovaLCT advanced login) | Access for diagnostics |
| 13 | Content constraints on any vendor player (codec and resolution limits, USB filesystem, free storage) | Encoding profiles |
| 14 | HDCP on the HDMI source and controller behaviour with HDCP | LED controllers commonly refuse HDCP content (UNVERIFIED for NovaStar) |
| 15 | Audio requirement, emergency-override requirement, and the installer's or distributor's stance on third-party software on vendor players | Scope and warranty |
| 16 | Documented API or SDK access actually granted to TINNOX by any vendor (NovaStar, Huidu, Colorlight, display makers), with the document in hand | Converts THIRD PARTY findings into OFFICIALLY DOCUMENTED ones |

## 4. Hardware compatibility matrix (evidence-based, untested)

| Platform | OS | Custom canvas and portrait | Kiosk and auto-start | Silent update | Remote diagnostics | Cost class | Lock-in | Evidence |
|---|---|---|---|---|---|---|---|---|
| Raspberry Pi 5 or CM5 (incl. Giada DN25 fanless, eMMC) | Raspberry Pi OS Lite 64-bit | Hardware HEVC 4K60 decode; H.264 in software (THIRD PARTY). KMS kernel `video=` modes with `rotate=90` and `e`/`D` force flags (OFFICIALLY DOCUMENTED); Pi 5 lets KMS select mode from EDID by default | systemd service plus a Wayland kiosk compositor and Chromium kiosk (cage OFFICIALLY DOCUMENTED) | apt or own agent; RAUC A/B (LGPL, OFFICIALLY DOCUMENTED; Pi 5 done by Bootlin, THIRD PARTY); Mender hosted | SSH over WireGuard or Tailscale | Low | None | H02 research |
| Raspberry Pi 4 | Raspberry Pi OS | 4K60 HEVC and H.264 hardware decode; DMT 81 mode filtered (OFFICIALLY DOCUMENTED) | as above | as above | as above | Low | None | H02 |
| Android commercial box (Giada DN76/D77/DN84, IAdea XMP-8552, Qbic BXP) | Android 12 to 15 | 4K60 output on most; portrait via app rotation; custom LED resolutions UNVERIFIED per box | Device-owner lock task mode and persistent HOME (OFFICIALLY DOCUMENTED, Android) | PackageInstaller session commit without user interaction on fully managed devices, Android 6+ (OFFICIALLY DOCUMENTED); Play Protect prompts reported (THIRD PARTY) | MDM or own agent; ADB over VPN | Low to mid | Low (AOSP APIs) | H02 |
| DSDevices DSDA1 / DSDX5 (the likely "DsDevice") | Android 14 | 8K decode claimed on DSDA1 | Built to run Xibo for Android (THIRD PARTY) | As any Android box if TINNOX becomes device owner (UNVERIFIED) | as above | Low to mid (US$149 to US$345 listed) | Low, but current Xibo licence per device if Xibo is kept | H01, T01 |
| NovaStar Taurus TB30/40/50/60 | Android (TB40 reported Android 11, THIRD PARTY) | Drives LED directly; HDMI in on some models for synchronous mode; internal viewport differs from physical canvas | Third-party apps "not supported" per the TB6 specification (OFFICIALLY DOCUMENTED) but side-loading via REST, SSH and ADB is documented by third parties (UNVERIFIED) | VNNOX or ViPlex | VNNOX Care; LAN protocol on TCP 16606 (reverse-engineered) | Mid | High | H01 |
| NovaStar MCTRL / VX synchronous controllers | Firmware | Custom EDID via NovaLCT; VX scales, plain MCTRL generally crops (per-model UNVERIFIED) | Not applicable (not a player) | Not applicable | TCP 5200 or serial register protocol (reverse-engineered, THIRD PARTY); H-series has an official JSON protocol; COEX has an HTTP API | Mid | High for control, none for content | H01 |
| Huidu Android or engineering cards | Embedded or Android | HDMI in on HD-H6 with asynchronous fallback (THIRD PARTY) | Vendor player | Official HTTP SDK on port 30080 with vendor-issued keys, only on "D" engineering cards (OFFICIALLY DOCUMENTED via Gitee mirror) | Same SDK | Low to mid | Medium | H01 |
| x86 mini PC | Linux or Windows | Depends on iGPU; Chromium hardware decode is feature-flagged on Linux (OFFICIALLY DOCUMENTED, Chromium source) | systemd or Windows shell replacement | RAUC supports EFI | SSH or RDP over VPN | Mid to high | None | H02 |
| BrightSign Series 5 | BrightSignOS | 4K | Autorun HTML app | BSN.cloud (paid) | BSN.cloud | XD5 "from US$600" (dated THIRD PARTY) | High | H02 |
| Samsung Tizen, LG webOS, Philips Android SoC displays | Vendor | Display-native | Partner app | Partner programmes only; Samsung SSSP is partner-only and deprecated from Tizen 8.0; LG SDK requires an NDA and development agreement (OFFICIALLY DOCUMENTED) | Vendor tools | Display only | High | H02 |

## 5. Integration routes for LED walls, compared

| Route | What TINNOX CMS gets | Vendor dependence | Effort | Unknowns |
|---|---|---|---|---|
| **1. External HDMI player → synchronous controller** (recommended) | Full ownership of rendering, scheduling, offline cache, proof of play and screenshots of the rendered canvas; works with NovaStar, Colorlight, Linsn and Huidu synchronous gear alike | Lowest: the controller only consumes pixels | Low for content; medium for a custom EDID per site | Custom-resolution support per controller model; HDCP; no screenshot of the LED itself; panel health needs route 4 or 3 |
| 2a. TINNOX app side-loaded on a Taurus | One box for content and LED output | Medium to high: unofficial path, 1 GB RAM class hardware, firmware may close it, stock player owns the screen | Medium plus unknown coexistence effort | No official SDK; warranty stance UNKNOWN |
| 2b. Stock Taurus with the ViPlex web-page widget pointing at a CMS URL | No app work | Medium: WebView version, offline behaviour, widget reliability | Low | Caching and reload behaviour, viewport scaling |
| **3. VNNOX Open API** (NovaCloud Open Platform; OFFICIALLY DOCUMENTED portal, endpoint detail THIRD PARTY) | Player inventory and status; real-time and scheduled brightness, power, volume, source, reboot, screenshot; emergency insert; solution distribution; play logs; webhooks; VNNOX Care panel health | High: cloud account per tenant, one AppKey per user, regional hosts (US, EU, CN seen; no AU host seen), edition gating, rate limits | Low to medium | No media-upload endpoint in public documentation (assets must be URL-hosted); data residency; pricing UNKNOWN |
| **4. LAN control adapter from the on-site player** (TCP 5200 register protocol, Taurus TCP 16606, H-series UDP 6000, COEX HTTP) | Brightness, test patterns, blackout, temperature, voltage and receiving-card status without any cloud | Medium: mostly reverse-engineered; register maps differ by model and firmware | Medium: adapter plus per-model profiles | Correctness per firmware; risk of writing topology registers; no vendor support |
| 5. Huidu engineering cards for new sites | Official HTTP API: brightness, schedules, program push, screenshot, file upload | Low to medium: official but key-gated | Medium | Different ecosystem from an existing NovaStar estate |

**Content playback versus brightness, power and panel monitoring.** Route 1 covers playback entirely. Brightness, power and panel health are deliberately separate capabilities: in the first release they are read-only where cheaply available (for example input-signal presence and temperature via route 4 on a known controller model, or VNNOX Care via route 3 if the customer already has it) and otherwise out of scope. Writing brightness or power is a second-release feature gated on a verified adapter per controller model.

## 6. Recommended pilot hardware combination

PROPOSED, based on H02 and H01 evidence; every hardware claim stays UNVERIFIED until the pilot runs it.

**Primary pilot: Raspberry Pi 5 (8 GB) or a Compute Module 5 commercial carrier with eMMC, Raspberry Pi OS Lite 64-bit, read-only root via overlayfs, TINNOX player agent, Chromium in a Wayland kiosk compositor for layouts and mpv with hardware decode for full-screen video, HDMI into the site's existing NovaStar synchronous controller at the controller's native canvas.**

Reasons: hardware HEVC 4K60 decode (THIRD PARTY), documented kernel mode forcing and rotation for awkward controller EDIDs (OFFICIALLY DOCUMENTED), an open stack with no partner gating, the lowest unit cost, and precedent from Yodeck, Anthias, PiSignage and info-beamer on the same hardware. Encode pilot video as HEVC; keep an H.264 profile only for Pi 4.

**Secondary pilot: one indoor portrait touch kiosk on an Android commercial box (Giada DN76/D77 or IAdea XMP-8552 class) with the TINNOX app as device owner** (lock task mode, persistent HOME, PackageInstaller silent updates; all OFFICIALLY DOCUMENTED Android APIs). This validates the second player platform without touching the LED path.

**Why two platforms.** Chromium on Linux hardware-decodes HEVC only through VA-API, not the Raspberry Pi's V4L2 path, and the Pi 5 has no H.264 hardware decoder (OFFICIALLY DOCUMENTED Chromium feature flags; THIRD PARTY Pi 5 decoder tests). A browser-rendered video on the Pi is therefore software-decoded, which is acceptable at 1080p-class sizes and not at 4K. LED canvases are bounded by the sending card's pixel budget (roughly 1.3 to 2.3 megapixels for MCTRL and Taurus classes, THIRD PARTY), so the Pi with mpv hardware decode covers LED walls and pylons; 4K LCD kiosks are the Android box's job, where Media3 uses the SoC decoder (OFFICIALLY DOCUMENTED).

**Risks to retire in week one of the pilot** (all UNVERIFIED): the controller's EDID handshake with the Pi 5 at the native canvas; mpv hardware decode of HEVC on Pi 5 inside the kiosk session, and whether Chromium can be kept for layouts only; 2160×3840 portrait throughput on the Android box; power-cut recovery with overlayfs; Play Protect prompts on the Android SKU.

**Not for the pilot:** SoC displays (partner agreements first), BrightSign (lock-in, cost), NovaStar Taurus side-loading (unofficial), x86 (cost and power).

### Browser or simulator validation versus real-hardware validation

| Validated in a desktop browser or container | Needs real hardware |
|---|---|
| Layout geometry, fit, crop, letterbox at target pixel sizes; portrait templates | HDMI handshake and EDID with the LED controller; forced modes |
| Scheduling, recurrence, time zones, priorities (mocked clock) | Decode performance, frame rate, tearing, seamless loops |
| Publication state machine, manifest parsing, resumable download logic (mocked network) | Boot recovery after power cut, SD wear, thermal behaviour in enclosures, watchdog |
| Portal and API behaviour, isolation, audit | Silent update and rollback end to end on each SKU |
| Telemetry parsing and dashboards | Network outage behaviour, PoE budget, remote diagnostics latency |

Rule: anything touching the kernel display pipeline, decoder, storage or power is a hardware test; everything above the rendered surface is a browser test and is built first.

## 7. Build, adapt Xibo, or interim white label

Evidence from A01 (Xibo repository files, GitHub metadata and search snippets of official pages) and H02.

| Dimension | Adapt Xibo (fork, rebrand, host) | Build TINNOX CMS | Interim white-label service |
|---|---|---|---|
| Licensing | CMS, XMR, Docker tooling, Windows and Electron players are AGPL-3.0-or-later (OFFICIALLY DOCUMENTED). Hosting a modified version obliges offering the modified source to every remote user (AGPL section 13). Android, webOS and Tizen players are closed source and licensed per device by Xibo. Even Xibo's own white-label programme leaves the CMS AGPL. | TINNOX chooses; may be proprietary. LGPL-3.0 libraries from Xibo (layout renderer, communication framework) and Apache-2.0 Concerto parts can be reused without copyleft on the whole (OFFICIALLY DOCUMENTED licences; reuse INFERRED). | Vendor terms. Xibo White Label Reseller: set-up fee per brand (archived figure £300) plus 5% discount; Cloud from £3.50 per display per month (OFFICIALLY DOCUMENTED via snippets). Other vendors UNKNOWN (sites unreachable). |
| Source ownership | Only the delta; Xibo Signage is sole steward and large external features are generally not accepted (PROMISE.md), so a fork diverges | 100% | None |
| Hosting | Docker per customer; Xibo staff advise one CMS per customer because there is no tenant model (THIRD PARTY forum) | Multi-tenant from day one | Vendor-hosted; data residency UNKNOWN |
| Maintenance | Patch releases every one to four weeks on 4.5.x, including security fixes; fork must rebase; `custom/` extension surface shrank in 4.5 (OFFICIALLY DOCUMENTED) | Self-funded, no rebase tax | Vendor's |
| Recurring cost | Infrastructure plus per-device commercial player licences (current price UNKNOWN; historic £15 to US$28 one-off) | Infrastructure plus engineering | Per display per month minus 5 to 12% partner discount |
| Engineering effort | Weeks to rebrand and host; retrofitting tenancy is "a huge task" per Xibo's own community guidance; replacing the three closed players is a product each (INFERRED) | Multi-person-year to match Xibo's full feature set, but scope can be cut to TINNOX's needs; see `docs/implementation-backlog.md` for a narrow first release (INFERRED) | Near zero engineering |
| Australian time zones | Per-display zone and per-event sync exist; several open 2026 reporting bugs that shift dates for zones ahead of UTC (OFFICIALLY DOCUMENTED issue tracker) | Designed in | UNKNOWN per vendor |
| Exit | Low (AGPL source and data remain) | None | High for commercial vendors |

Recommendation (PROPOSED): **build TINNOX CMS as an owned product with a narrow first release, using Xibo as a reference architecture rather than a base**, and run an interim white-label arrangement only if a sales commitment requires screens before the pilot ships. The decisive factors are the AGPL network clause combined with the absence of a tenant model, and the closed per-device players on exactly the platforms (Android, SoC) that matter for kiosks.

## 8. Platform stack and running costs (PROPOSED, evidence from the stack-components research)

Licences were read from the projects' repositories; AWS Sydney unit prices come from the AWS public price-list files (publication October 2026) and are OFFICIALLY DOCUMENTED; other vendors' prices came through search snippets and are THIRD PARTY.

| Layer | Choice | Licence | Alternative | Reason |
|---|---|---|---|---|
| Backend and portal | TypeScript on Node 22: NestJS or Fastify API, React front end, PostgreSQL 16 with row-level security keyed by tenant, Redis-backed job queue | MIT (frameworks), PostgreSQL licence | Django for faster back-office CRUD; Go for the device gateway only if concurrent connections exceed what Node handles comfortably | One language across API, portal and the Linux player supervisor; RLS makes isolation auditable |
| Media processing | ffmpeg and ffprobe (validation, poster frames, per-canvas renditions), sharp on libvips (images), Gotenberg (LibreOffice and PDF rasterising) if documents are in scope | ffmpeg LGPL 2.1 or GPL when built with libx264/libx265 (run as a separate process; confirm with counsel), sharp Apache-2.0, libvips LGPL-2.1, Gotenberg MIT | ImageMagick | Encode H.264 High 1080p as the universal rendition and HEVC for 4K Android and Pi mpv paths; content-addressed object keys |
| Object storage and delivery | Cloudflare R2 for media renditions (zero egress), AWS S3 Sydney for everything that must stay in Australia; presigned URLs with Range support | Service | All-AWS with CloudFront at pilot for simplicity | Every screen downloads every asset, so egress dominates: S3 or CloudFront AU egress is USD 0.114/GB for the first 10 TB versus USD 0 on R2 |
| Identity | Amazon Cognito in ap-southeast-2 (MFA, Australian residency, free up to 10,000 monthly active users) for portal users; device credentials issued by the CMS enrolment flow | Service | Keycloak self-hosted (Apache-2.0) if per-tenant SAML federation is needed without per-user fees | Residency and MFA at no cost at pilot scale |
| Player protocol | HTTPS poll of a content-addressed manifest (default 300 s, ETag) plus a push channel for commands (Mosquitto MQTT at pilot, AWS IoT Core at scale), resumable Range downloads, idempotent publication versions, batched proof-of-play | Mosquitto EPL-2.0 and EDL | WebSocket long-poll instead of MQTT | Mirrors the proven shapes in Xibo (RequiredFiles with size and md5, collectNow push) and info-beamer (signed per-device sync files with rollback) |
| Linux player | Node supervisor service, Chromium kiosk under a Wayland kiosk compositor for layouts, mpv with hardware decode for video zones, overlayfs read-only root | cage MIT, mpv GPL/LGPL, Chromium BSD | Qt-based renderer as Anthias moved to | See section 6 |
| Android player | Kotlin, Media3 ExoPlayer, WebView for layouts, device-owner lock task, silent PackageInstaller updates | Apache-2.0 libraries | Flutter (not researched) | Documented platform APIs, no vendor partnership |
| OS updates | Mender (client and server Apache-2.0; hosted Basic about USD 34 per month) or RAUC (LGPL-2.1; needs a bootloader backend around the Pi `tryboot` mechanism) for Pi images; app updates via the supervisor with signature check and health-gated rollback | As stated | balenaCloud (first ten devices free, THIRD PARTY) | A/B images with rollback are the only safe way to update unattended outdoor devices |
| Observability | Prometheus, Grafana and Loki self-hosted at pilot; Grafana Cloud and Sentry at scale; offline alerting from the heartbeat table | Grafana and Loki AGPL (hosted use fine), Sentry FSL | Vendor SaaS from day one | Cost |

**Running cost estimate** (USD per month, AWS Sydney on-demand prices, assumptions: one heartbeat per minute per screen, 2 to 3 GB of content churn per screen per month, media library 50 GB at pilot and 500 GB at scale; AWS free tiers not subtracted):

| Scale | All-AWS | AWS compute and database with R2 media |
|---|---|---|
| Pilot, up to 50 screens | about 69 to 100 | about 58 to 90 |
| 500 screens | about 650 to 750 (Multi-AZ database) | about 400 to 470 (Single-AZ database) |

Per-screen infrastructure cost at 500 screens is roughly USD 0.80 to 1.50 per month (INFERRED from the table), far below signage SaaS list prices (Yodeck: USD 8 to 16 per screen per month from April 2026, OFFICIALLY DOCUMENTED in its pricing update). Engineering and support, not hosting, are the real cost of ownership.

## 9. Open items specific to this document

See `docs/open-questions.md`. The three that block hardware commitment: the controller and player inventory (questionnaire items 1 to 6), the identity and management of the current "DsDevice", and whether any vendor API or SDK access has already been granted to TINNOX.
