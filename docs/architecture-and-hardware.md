# TINNOX CMS: architecture, hardware dependencies and build-versus-buy

Date: 2026-11-03 (round-2 revision). Status: PROPOSED architecture built on labelled evidence.

Labels:
- **VERIFIED_FULL_PAGE**: an official page or specification read in full this session.
- **OFFICIALLY DOCUMENTED**: vendor or project documentation, repository files, verbatim mirrors, or a search summary of an official page.
- **THIRD PARTY**: resellers, forums, open-source re-implementations.
- **INFERRED**, **UNKNOWN**, **PROPOSED**.
- **HARDWARE-DEPENDENT/UNVERIFIED**: depends on the actual unit and firmware, and was not tested.

This revision applies TINNOX's answers to the open questions and the round-2 research in `research/round2/`. The answers that shape this document:
- TINNOX sells no CMS today, so there is nothing to migrate (Q1, Q12).
- Controllers are "mainly" from Chinese vendors such as Huidu (Q2). The website names NovaStar in the PrecisionX packages (`research/round2/R5-tinnox-site.md`). Release 1 therefore has two controller vendors: Huidu and NovaStar (INFERRED).
- Release 1 is Australia only (Q6). Hosting must follow strict Australian compliance (Q9).
- TINNOX asked us to recommend player hardware (Q10). Section 6 gives the recommendation.

Reachability: tinnox.com.au, xibosignage.com, the public Yodeck help centre and API specification, and raw GitHub files were read in full in round 2. novastar.tech, huidu.cn, gitee.com and pip-assets.raspberrypi.com stayed blocked. NovaStar facts therefore come from search summaries of official PDFs and from third parties. The official Huidu HTTP API document was read in full from a byte-for-byte mirror (`research/round2/R1-huidu-integration.md`). The authenticated Yodeck UI was not inspected. Nothing in this document was tested on real hardware.

## 1. The five separable concerns

| Concern | What it does | Who owns it in TINNOX CMS | Hardware or vendor dependence |
|---|---|---|---|
| **A. CMS interface and backend** | Customer portal, operations console, API, tenancy, users, roles, audit, scheduling engine, publication versions, telemetry store | TINNOX, fully owned | None (standard cloud services in an Australian region, section 8) |
| **B. Media storage and processing** | Upload, validation, transcoding to player profiles, renditions per canvas, thumbnails, signed delivery URLs, retention | TINNOX, fully owned; ffmpeg and libvips under their licences | None beyond the object storage choice |
| **C. Playback software** | The player: downloads manifests and files, caches, evaluates schedules locally, renders layouts, plays video, reports state, takes screenshots, applies updates | TINNOX owns its own players: a Linux image on Raspberry Pi Compute Module 5 and an Android device-owner app. On async-only Huidu cards the card's own firmware is the player, and TINNOX CMS drives it by program push (section 5, route 5) | Depends on the player type chosen (section 6). SoC displays and vendor players are partner-gated |
| **D. LED controller and display integration** | Getting pixels onto the LED wall or LCD at the right canvas size; brightness, power, panel health | Shared: TINNOX owns the player side; the controller vendor owns the sending and receiving cards. **Primary controller vendors: Huidu (TINNOX, Q2) and NovaStar (PrecisionX packages on the website)** (INFERRED split; confirm per package, Q14) | High. Synchronous senders consume HDMI or DVI only. Huidu documents an official, key-gated LAN HTTP API (VERIFIED_FULL_PAGE). NovaStar control needs vendor tools, the VNNOX cloud API (excluded by default, section 5) or reverse-engineered LAN protocols |
| **E. Fleet monitoring and software updates** | Heartbeats, diagnostics bundles, temperature and throttling telemetry, alerts, remote restart, staged OTA updates with rollback, remote shell for support | TINNOX, fully owned, optionally using Mender or RAUC for OS images | None if built on the own agent; commercial MDM adds per-device fees. Huidu cards update through vendor firmware only |

The design rule that follows (PROPOSED): **content never depends on the controller vendor.** TINNOX CMS keeps one publication model and reaches screens through two adapter classes:

| Adapter class | Purpose | Implementations in release 1 | Later | Evidence |
|---|---|---|---|---|
| **Content-delivery adapter** | Gets a publication onto the screen | `tinnox_player` (TINNOX player renders the exact canvas and sends it over HDMI); `huidu_push` (TINNOX CMS compiles the publication into Huidu programs and pushes them over the Huidu HTTP API) | Xixun APK or Realtime Server; VNNOX solution push, only if a vendor shows an Australian region in writing | R1 Analysis 7 (PROPOSED) |
| **Controller-control adapter** | Brightness, screen on and off, status, screenshot, scheduled tasks | Huidu HTTP API on "D" engineering cards (official); NovaStar LAN (reverse-engineered, read-only first) | Others per vendor | R1 F4 (VERIFIED_FULL_PAGE); H01 (THIRD PARTY) |

Each display records which route it uses. Features depend on the route, not only on the plan. For example, web pages and PowerPoint work only on `tinnox_player`, because the Huidu API has no web or HTML item (VERIFIED_FULL_PAGE, absence; `research/round2/R99-critic.md` C7).

## 2. Reference topology

**Site type A: TINNOX player feeding an HDMI-capable controller (walls, billboards, large pylons, LCD kiosks).**

```
                       Australian cloud region (AWS Sydney, DR Melbourne)
┌──────────────────────────────────────────────────────────────┐
│  Customer portal ──┐                                          │
│  Operations console┼── API / backend ── Postgres (tenant RLS) │
│  Player API ───────┘        │                                 │
│                             ├── Object storage (media, renditions, manifests)
│                             ├── Media workers (ffmpeg, libvips)
│                             ├── Delivery adapters (tinnox_player, huidu_push)
│                             └── Telemetry + command channel (heartbeat, screenshot, restart)
└──────────────────────────────────────────────────────────────┘
            │ HTTPS (manifests, range downloads)      ▲ heartbeats, logs, proof of play
            ▼                                          │
┌────────────────────────── site ─────────────────────────────┐
│  Player (CM5 Linux agent, or Android device-owner app)       │
│    cache ── schedule evaluator (site IANA zone) ── renderer  │
│      │ HDMI (standard or custom EDID mode)                    │
│      ▼                                                       │
│  LED controller in sync mode: Huidu T901/T902/VP sender or   │
│  H6/H8 dual-mode card; NovaStar sender or Taurus HDMI input  │
│      → receiving cards → LED modules                         │
│  or LCD kiosk / outdoor LCD (HDMI in)                        │
│      ▲ optional controller-control adapter on the LAN         │
│        (Huidu HTTP API; NovaStar LAN, read-only first)        │
└──────────────────────────────────────────────────────────────┘
```

**Site type B: Huidu async-only card as the player (small signs and pylons with HUB75 cards, no HDMI).**

```
                       Australian cloud region
┌──────────────────────────────────────────────────────────────┐
│  huidu_push adapter: compiles a publication into programs     │
│  (program "replace" + playControl windows), polls status and  │
│  screenshots, keeps its own record of what was sent           │
└──────────────────────────────────────────────────────────────┘
            ▲ outbound tunnel from the site (agent HTTPS, or VPN)
            │ the card's port is never exposed to the internet
┌────────────────────────── site ─────────────────────────────┐
│  On-site agent (small Linux box) or 4G router with VPN       │
│      │ LAN only: HTTP :30080, HMAC-MD5 signed, no TLS         │
│      ▼                                                       │
│  Huidu "D" engineering card (C/D series Linux, or A-series   │
│  Android without HDMI): stores programs, downloads media by  │
│  URL, runs schedules offline → receiving cards → LED modules │
└──────────────────────────────────────────────────────────────┘
  Lab spike only: Huidu gateway service or SDK 2.0 reverse TCP
  (SetSDKTcpServer) so the card dials out to an AU gateway.
```

Site type B evidence: the Huidu HTTP API on TCP 30080 with signed requests, program push and offline schedules is VERIFIED_FULL_PAGE (official document, revision 2026-06-16, via mirror). No TLS is INFERRED from the documented `http://` URLs. The on-site agent or VPN is the baseline. The reverse connection rests on a diagram and a reverse-engineered command name only, so it is a lab spike, not the pilot path (R1 verification, caveat 1; R99 C3). Site type B has no play log: proof of play is "sampled" from screenshots and status (VERIFIED_FULL_PAGE, absence of a play-log endpoint).

The LED signal chain and the independence of the physical canvas from the HDMI timing are THIRD PARTY findings. They are consistent with the Taurus local API, which exposes an HDMI input resolution that is explicitly "not the physical LED screen size" (open-source client of the Taurus protocol). Custom non-16:9 modes come from three places: a custom EDID on the sending card (NovaStar NovaLCT: Screen Config, Sending Card, Custom Resolution; Huidu: HDSet); forcing the mode on the source (for a Linux source, a kernel `video=` entry with the `D` or `e` flags); or accepting crop or letterbox at the controller (THIRD PARTY integrator runbooks; Raspberry Pi kernel mode documentation is OFFICIALLY DOCUMENTED). Sender limits apply even when the pixel count fits. Examples: Huidu HD-T901 is 1280×1024, widest 3840, highest 2048 (THIRD PARTY retailer listing). NovaStar Taurus sync-mode scaling is down-only, and the TB40 accepts a source width of 64 to 2048 px (THIRD PARTY listings cited in R99 C1).

## 3. Hardware questionnaire (to be completed per deployed site and per product package before the pilot)

This is the instrument that settles what the brief calls unconfirmed: the deployed models and their integration capabilities. Items 17 to 23 are new in round 2 (R1 Open items B; R99 section 2.5).

| # | Question | Why it matters |
|---|---|---|
| 1 | Controller or player make, exact model and firmware per product package (Huidu T901/T902, VP series, H6/H8, A/B/C/D series; NovaStar MCTRL300/600/660/700/4K, VX400/600/1000, COEX/MX, H-series, Taurus TB1 to TB60; Colorlight; Linsn; Xixun; other). Serial numbers | Decides which integration route (section 5) is possible; serials are needed for key records and support |
| 2 | Operating system and version of any player (Android version on Taurus, Huidu A/H series or "DsDevice"; Linux or Windows on mini PCs) | Device-owner provisioning, codec limits, update path |
| 3 | "DsDevice" identity: is it DSDevices (dsdevices.com)? Which model (DSDA1, DSDX5, or a retired DSCS9X/DSCS95), its Android version, RAM and storage, the app it runs, which kiosks use it, and how it is managed | Decides whether the box can be the Android kiosk player (DSDA1 is current; DSCS9X and DSCS95 are retired). Identity is INFERRED (Q16 in `open-questions.md`) |
| 4 | Inputs available on the controller (HDMI, DVI, SDI, Ethernet-only), and whether a dual-mode device (Huidu H6/H8, NovaStar Taurus) runs in synchronous (HDMI) or asynchronous (internal) mode, with its source policy | A device in asynchronous mode has no HDMI source; the content path is then the vendor's own player (route 5 for Huidu) |
| 5 | Physical canvas in pixels (width × height), pixel pitch, cabinet layout, number of Ethernet ports used, mosaic across multiple cards | The player must render this exact canvas; sender width limits apply even when the pixel count fits |
| 6 | HDMI timing currently negotiated (read the EDID from the source), whether a custom resolution is flashed, and who holds the NovaLCT or HDSet project and receiving-card configuration backups | Custom-mode strategy and recovery after a controller swap |
| 7 | Controller mapping of input to canvas (crop offset, scaling on or off), any tolerated letterbox | Preview fidelity in the portal; content-window offset inside the output mode |
| 8 | Network: is the controller or player on a LAN the player or an on-site agent can reach (Huidu TCP 30080; NovaStar TCP 5200, Taurus UDP 16601 and TCP 16606, HTTPS 16674), is there a 4G module behind carrier NAT, firewall rules, proxy, captive portal | Control adapters and route 5 need LAN reachability through an agent or VPN; the TINNOX player needs outbound HTTPS only |
| 9 | Brightness regime (fixed, scheduled table, light sensor), where the sensor is connected (controller, multifunction card, monitoring card) | Whether brightness control is in scope and via which route |
| 10 | Power control (software screen-off, relay on the card, mains contactor or timer) and who schedules it | Separates playback from power |
| 11 | Any vendor cloud account in use (Huidu XiaoHui Cloud; NovaStar VNNOX edition and region) | Vendor clouds are excluded by default under Q9 (section 5); existing use must be known so it can be retired or ring-fenced |
| 12 | Who holds device access (Taurus login, VNNOX, NovaLCT advanced login, Huidu keys). Record the holder, never the secret, in the questionnaire | Access for diagnostics; secrets go into the vault at commissioning |
| 13 | Content constraints on any vendor player (codec and resolution limits, fonts, USB filesystem, free storage) | Encoding profiles; Huidu codec and font limits are HARDWARE-DEPENDENT/UNVERIFIED |
| 14 | HDCP on the HDMI source and controller behaviour with HDCP | LED controllers commonly refuse HDCP content (HARDWARE-DEPENDENT/UNVERIFIED) |
| 15 | Audio requirement, emergency-override requirement, and the installer's or distributor's stance on third-party software on vendor players | Scope and warranty |
| 16 | Documented API or SDK access actually granted to TINNOX by any vendor, with the document in hand: a 16-hex `sdkKey` plus secret from Huidu support, a VNNOX AppKey and AppSecret, or something else; who issued it and when | Converts THIRD PARTY findings into OFFICIALLY DOCUMENTED ones; identifies the "one API granted" (Q4; Q13 in `open-questions.md`) |
| 17 | Huidu: full device ID. Does it contain "D" (engineering card, for example `C16L-D00-A000F`)? | Only "D" cards support the HTTP API (OFFICIALLY DOCUMENTED) |
| 18 | Huidu: firmware version, Linux (C/D) or Android (A/H/B8L) series, and HTTP API status (`GetHttpApiEnable` on Linux cards) | The API needs current firmware; the enable step applies to Linux cards (INFERRED) |
| 19 | Huidu: is HDMI IN present (H6/H8 confirmed THIRD PARTY; A7/A8 HARDWARE-DEPENDENT/UNVERIFIED)? | Decides route 1 versus route 5 for the sign |
| 20 | Huidu: has an SDK key already been written to the card, and by whom (TINNOX, installer, distributor)? | A key can be written only once (OFFICIALLY DOCUMENTED); a card keyed by someone else locks TINNOX out |
| 21 | Huidu: are HDPlayer, LedArt or XiaoHui Cloud schedules in use on the card (on and off times, brightness)? | Enabling the HTTP API can stop HDPlayer on and off schedules from working (VERIFIED_FULL_PAGE); TINNOX must be the single owner |
| 22 | Huidu: connectivity (LAN, Wi-Fi AP, 4G with carrier NAT), and has the Wi-Fi AP password been changed or the AP disabled? | The status calls return the AP password in clear text (VERIFIED_FULL_PAGE); commissioning must change it or disable the AP |
| 23 | NovaStar: exact model per PrecisionX package and size (PrecisionMicro S1 to S4, PrecisionPro S1 to S4, PrecisionLuma S1 to S5) | A TB60 loads about 2.3 Mpx with HDMI-in up to 1920×1200@60. PrecisionPro S3 (2.49 Mpx), PrecisionPro S4 (3.31 Mpx) and PrecisionMicro S4 (2.82 Mpx) exceed it and need a larger model or a split canvas (R5 verification #12; Q23 in `open-questions.md`) |

## 4. Hardware compatibility matrix (evidence-based, untested)

| Platform | OS | Custom canvas and portrait | Kiosk and auto-start | Silent update | Remote diagnostics | Operating temperature | Cost class | Lock-in | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| **Raspberry Pi Compute Module 5 (eMMC) on an industrial fanless carrier** (EDATEC ED-IPC3630 class) | Raspberry Pi OS Lite 64-bit | Hardware HEVC 4K60 decode; H.264 is software only, about 50 to 60 % CPU at 1080p60 (VERIFIED_FULL_PAGE, Pi docs). KMS `video=` modes with `rotate=90` and `e`/`D` force flags (OFFICIALLY DOCUMENTED) | systemd service plus a Wayland kiosk compositor and Chromium kiosk (cage OFFICIALLY DOCUMENTED) | RAUC A/B (LGPL, OFFICIALLY DOCUMENTED; Pi 5 done by Bootlin, THIRD PARTY); Mender hosted | Own agent over WireGuard. PMIC reports watchdog resets (VERIFIED_FULL_PAGE). On-board RTC; backup-cell charging is off by default (VERIFIED_FULL_PAGE for Pi 5; INFERRED for CM5) | Module −20 to +85 °C; supply to at least January 2036 (OFFICIALLY DOCUMENTED, product brief via search). ED-IPC3630 box −25 to +60 °C (OFFICIALLY DOCUMENTED datasheet via Mouser). Giada DN25 (CM5) about 0 to 45 °C, indoor only (THIRD PARTY) | Low: CM5 8 GB / 16 GB eMMC AUD 209.95 inc GST (THIRD PARTY, date not shown); installed about AUD 360 to 610 with an industrial carrier (INFERRED) | None | `research/round2/R4-player-hardware-recommendation.md`; H02 |
| Raspberry Pi 5 or Pi 4 board (lab and development only) | Raspberry Pi OS | Pi 5 as CM5. Pi 4: hardware decode of HEVC up to 4K60 and H.264 up to 1080p60; DMT 81 mode filtered (OFFICIALLY DOCUMENTED) | as above | as above | as above | Pi 5 board: no official ambient figure (UNKNOWN); SD card wear | Low | None | H02; Yodeck still recommends the Pi 4 as "the best balance of performance, reliability and cost" (VERIFIED_FULL_PAGE help article, `research/round2/AV4-layouts-scheduling.md` N17). TINNOX needs eMMC, a wide temperature rating and long supply, so CM5 is preferred (R99 C12) |
| **Android RK3588 or RK3576 commercial box** (Geniatech APC3588Q class, Giada DN84, Rikomagic DS08; IAdea and Qbic as alternatives) | Android 12 to 14; **varies by SKU** (non-Q APC3588 ships Android 12; APC3588Q Android 14) (OFFICIALLY DOCUMENTED) | 4K decode via the SoC; portrait via app rotation; custom LED resolutions HARDWARE-DEPENDENT/UNVERIFIED per box | Device-owner lock task mode and persistent HOME (OFFICIALLY DOCUMENTED). `DISALLOW_SYSTEM_ERROR_DIALOGS` force-stops a crashed app and does not restart it, so the TINNOX app needs its own relaunch (VERIFIED_FULL_PAGE, AOSP source) | PackageInstaller completes without user interaction for a device owner (VERIFIED_FULL_PAGE, AOSP source). OS patches come only from the box vendor; no vendor patch policy was found (UNKNOWN). **A written patch commitment is required** | Own agent; ADB over VPN. RTC and hardware watchdog advertised on APC3588Q (OFFICIALLY DOCUMENTED) | DN84 0 to 60 °C only at 0.7 m/s airflow (THIRD PARTY). Non-Q APC3588 −20 to 60 °C (OFFICIALLY DOCUMENTED, CN spec). APC3588Q UNKNOWN | Low to mid: APC3588Q price on enquiry; non-Q APC3588 USD 269 to 359 (OFFICIALLY DOCUMENTED shop) | Low (AOSP APIs); box firmware for the OS | R4; H02 |
| DSDevices DSDA1 / DSDX5 (the likely "DsDevice") | DSDA1 Android 14 (THIRD PARTY) | 8K decode claimed on DSDA1 | Ships with Xibo for Android pre-installed, under a separate licence (THIRD PARTY) | As any Android box if TINNOX becomes device owner (HARDWARE-DEPENDENT/UNVERIFIED) | as above | UNKNOWN | DSDA1 GBP 235 ex VAT (THIRD PARTY, search summary 2026-11-03); DSDX5 USD 149 (H01) | Low | `research/round2/R5-tinnox-site.md`; `research/round2/R8-xibo-verify.md`; H01. The Xibo-sold DSCS9X and DSCS95 are retired (below) |
| NovaStar Taurus TB30/40/50/60 | Android (TB40 reported Android 11, THIRD PARTY) | Drives LED directly. TB60 loads about 2.3 Mpx; HDMI-in up to 1920×1200@60 (OFFICIALLY DOCUMENTED, spec PDF via search summary). Sync-mode scaling is down-only; TB40 source width 64 to 2048 px (THIRD PARTY). Internal viewport differs from the physical canvas | Third-party apps "not supported" per the TB6 specification (OFFICIALLY DOCUMENTED); side-loading via REST, SSH and ADB is documented by third parties (HARDWARE-DEPENDENT/UNVERIFIED) | VNNOX or ViPlex | VNNOX Care (cloud; excluded by default, section 5); LAN protocol on TCP 16606 (reverse-engineered) | UNKNOWN | Mid | High | H01; R5 verification #12; R99 C1 |
| NovaStar MCTRL / VX synchronous controllers | Firmware | Custom EDID via NovaLCT; VX scales, plain MCTRL generally crops (per model HARDWARE-DEPENDENT/UNVERIFIED) | Not applicable (not a player) | Not applicable | TCP 5200 or serial register protocol (reverse-engineered, THIRD PARTY); H-series has an official JSON protocol; COEX has an HTTP API | UNKNOWN | Mid | High for control, none for content | H01 |
| **Huidu synchronous senders and processors** (HD-T901/T902, HD-VP210/410/620/820) | FPGA, no OS | HDMI or DVI in (model-dependent). T901 1280×1024, widest 3840, highest 2048; VP620 3.9 Mpx; VP820 5.2 Mpx (THIRD PARTY retailer listings) | Not applicable (not a player) | Firmware via HDPlayer (THIRD PARTY) | Control interface for T and VP series UNKNOWN | UNKNOWN | Low to mid (prices UNKNOWN) | Low for content | `research/round2/R1-huidu-integration.md` F1; R4 F3 |
| **Huidu engineering cards ("D" in the device ID)**: C/D series (ARM Linux, HUB75, no HDMI); A-series and B8L (Android, mostly no HDMI); H6/H8 dual-mode (Android, HDMI IN and LOOP); A7/A8 (HDMI IN HARDWARE-DEPENDENT/UNVERIFIED) | Linux or Android (official model lists, OFFICIALLY DOCUMENTED; H8 Android 11, THIRD PARTY) | Card stores and plays programs in zones; H6/H8 also take HDMI in sync mode | Vendor player only. A TINNOX APK on an A-series card is undocumented by Huidu (UNKNOWN; lab spike) | Firmware via HDPlayer; no rollback evidence (UNKNOWN) | **HTTP API on TCP 30080**: signed with HMAC-MD5, plain HTTP with no TLS (signing VERIFIED_FULL_PAGE; no TLS INFERRED). Keys are issued by Huidu support and **written once per card**. No play-log endpoint and no HTML item (VERIFIED_FULL_PAGE, absence). Enabling the API can stop HDPlayer on and off schedules (VERIFIED_FULL_PAGE). Default time zone Asia/Shanghai; status calls return the Wi-Fi AP password in clear text (VERIFIED_FULL_PAGE) | A6L listed at −40 to +80 °C by a retailer (THIRD PARTY, doubtful); others UNKNOWN | Low to mid (prices UNKNOWN) | Medium to high (Huidu) | R1 F1, F3, F4 (official document, revision 2026-06-16) |
| x86 mini PC (deferred) | Linux or Windows | Depends on iGPU; Chromium hardware decode is feature-flagged on Linux (OFFICIALLY DOCUMENTED, Chromium source) | systemd or Windows shell replacement | RAUC supports EFI | SSH or RDP over VPN | MINIX N100 0 to 50 °C; no wide-temperature unit found in AU (THIRD PARTY) | Mid: MINIX N100 AUD 322 to 354 inc GST, out of stock (THIRD PARTY) | None | H02; R4 |
| BrightSign Series 5 | BrightSignOS | 4K | Autorun HTML app | BSN.cloud (paid) | BSN.cloud | UNKNOWN | XD5 "from US$600" (dated THIRD PARTY) | High | H02 |
| Samsung Tizen, LG webOS, Philips Android SoC displays | Vendor | Display-native | Partner app | Partner programmes only; Samsung SSSP is partner-only and deprecated from Tizen 8.0; LG SDK requires an NDA and development agreement (OFFICIALLY DOCUMENTED) | Vendor tools | Display-dependent | Display only | High | H02 |

Notes on the matrix (round 2):
- **DSDevices.** Xibo sold the DSCS9X and DSCS95 and retired them in September 2025; they can no longer be bought (VERIFIED_FULL_PAGE, Xibo retirement post). DSDevices still sells the DSDA1 and DSDX5 (THIRD PARTY). Both statements are true (R99 C10).
- **Hardening lesson.** A 2024 DSDevices firmware flaw "may allow an attacker on the same local network ... to execute arbitrary commands". It was fixed in DSCS9X firmware 20240909 and DSCS95 firmware 20240904 (VERIFIED_FULL_PAGE, Xibo security advisory). Any Android box TINNOX picks needs a LAN-isolation rule, firmware version tracking and a vendor advisory channel (INFERRED).
- **Xibo hardware.** Xibo no longer sells hardware and now certifies OEM devices instead (VERIFIED_FULL_PAGE). Android 4 and older webOS and Tizen devices lose Xibo Cloud HTTPS by 30 June 2028 because of a root-CA expiry (VERIFIED_FULL_PAGE). Old SoC screens therefore have a limited life with any HTTPS player (INFERRED).
- **Thermal rule.** No player found is rated for an unconditioned, sun-loaded Australian cabinet. Players go in the cooled controller compartment, with a 60 °C or higher operating rating and temperature telemetry (INFERRED from THIRD PARTY thermal sources in R4 F2). The Pi SoC throttles from 80 °C and harder at 85 °C (VERIFIED_FULL_PAGE, Pi docs).

## 5. Integration routes for LED walls, compared

Route numbers are kept from the first round so other documents stay valid. The table is ordered by rank.

| Route | Status (PROPOSED) | What TINNOX CMS gets | Vendor dependence | Effort | Unknowns |
|---|---|---|---|---|---|
| **1. TINNOX player → HDMI → synchronous input**: Huidu T901/T902/VP sender, or Huidu H6/H8 dual-mode card in sync mode; NovaStar sender or Taurus HDMI input in sync mode; also Colorlight, Linsn and Xixun gear | **Primary** for indoor walls, billboards and large pylons, for both Huidu and NovaStar | Full ownership of rendering, scheduling, offline cache, proof of play (player logs) and screenshots of the rendered canvas | Lowest: the controller only consumes pixels | Low for content; medium for a custom EDID per site; an extra box per site | Custom-resolution support per controller model; HDCP; no screenshot of the LED itself. NovaStar TB60 capacity (about 2.3 Mpx; HDMI-in up to 1920×1200@60, OFFICIALLY DOCUMENTED via search summary) does not cover PrecisionPro S3/S4 or PrecisionMicro S4. A dual-mode card's async content can override HDMI if its source policy is wrong (THIRD PARTY) |
| **5. Huidu HTTP API program push** (renamed from "Huidu engineering cards for new sites") | **Fallback** for async-only Huidu signs (C/D series, A-series without HDMI, W/E text cards) where a player box is not economic | Playlist, zones and time windows compiled into Huidu programs (`replace` per change, `playControl`); live data through the card's periodic URL task; brightness, screen on and off, scheduled tasks; screenshot. The card keeps playing its schedule offline. Proof of play is **"sampled"** (screenshot and status polling), labelled to customers as not an audited play log | Medium to high: official but Huidu-only, and key-gated per card | Medium: HTTP API client with signing, compiler, status poller | Key already written by someone else (lock-out); HDPlayer schedule conflict; Huidu rendering, codec and font limits (HARDWARE-DEPENDENT/UNVERIFIED); no TLS, so traffic stays on the LAN behind an on-site agent or VPN. Reverse TCP to an AU gateway is a lab spike (R1 verification, caveat 1) |
| **4. Controller-control adapter on the LAN**: Huidu HTTP API on "D" cards (official); NovaStar TCP 5200 register protocol, Taurus TCP 16606, H-series UDP 6000, COEX HTTP (mostly reverse-engineered) | Huidu control on dual-mode and async "D" cards: PROPOSED for release 1 (brightness schedule, screen on and off, status, screenshot, time zone), because the official API makes it cheap. NovaStar: read-only first, writes in release 2 | Brightness, power, test patterns, temperature, voltage and receiving-card status without any cloud | Huidu: low to medium (official, key-gated). NovaStar: medium (register maps differ by model and firmware) | Medium: adapter plus per-model profiles | NovaStar correctness per firmware and the risk of writing topology registers; Huidu T and VP sender control interface UNKNOWN |
| 2a. TINNOX app side-loaded on a vendor Android player (NovaStar Taurus, or Huidu A-series card) | **Lab spike only** (one time-boxed test on one A-series "D" card, after asking Huidu) | One box for content and LED output | High: unofficial path, low-RAM hardware, firmware may close it, the stock player owns the LED output | Medium plus unknown coexistence effort | No official SDK from Huidu or NovaStar (Xixun documents this route officially, THIRD PARTY mirror); warranty stance UNKNOWN |
| 2b. Stock Taurus with the ViPlex web-page widget pointing at a CMS URL | Not planned | No app work | Medium: WebView version, offline behaviour, widget reliability | Low | Caching and reload behaviour, viewport scaling. Not available on Huidu: the HTTP API has no web item (VERIFIED_FULL_PAGE, absence) |
| 3. VNNOX Open API (NovaCloud Open Platform; OFFICIALLY DOCUMENTED portal, endpoint detail THIRD PARTY) | **Excluded by default** under Q9 until NovaStar documents an Australian region in writing (R99 C15) | Player inventory and status; brightness, power, volume, source, reboot, screenshot; emergency insert; solution distribution; play logs; webhooks; VNNOX Care panel health | High: cloud account per tenant, one AppKey per user, regional hosts (US, EU and CN seen; no AU host found, search on 2026-11-03), edition gating, rate limits | Low to medium | No media-upload endpoint in public documentation; data residency; pricing UNKNOWN |
| 6. Huidu cloud bridge (XiaoHui Cloud; the `sdk.huidu.cn` host seen in the official sample request) | **Excluded by default** under Q9 | UNKNOWN | High | UNKNOWN | No public cloud API documentation; hosting location and terms UNKNOWN (R1 route d) |

**Content playback versus brightness, power and panel monitoring.** Route 1 covers playback entirely. Brightness, power and panel health are separate capabilities behind the controller-control adapter. In release 1, Huidu "D" cards get brightness schedules and screen on and off through the official API (PROPOSED). Other controllers are read-only where cheaply available, for example input-signal presence and temperature through route 4 on a known NovaStar model, and otherwise out of scope. Writing brightness or power on NovaStar is a release-2 feature gated on a verified adapter per controller model.

**Route capabilities.** Web pages and PowerPoint are available only on route 1 and the LCD kiosk player (release 2, Q11). Route 5 supports image, video, text, clock and dynamic-data items (VERIFIED_FULL_PAGE). PDF in release 1 is converted to images before it reaches a Huidu card (INFERRED design).

**Huidu commissioning rules (PROPOSED, from R1).**
- Order only Huidu cards with a "D" engineering ID. Prefer HDMI-capable dual-mode models above about 1280×512.
- TINNOX writes its own SDK key once at commissioning, records the key per card, and keeps the secret in a vault.
- Set an Australian IANA time zone on every card; the default is Asia/Shanghai.
- Change the Wi-Fi AP password or disable the AP.
- Keep port 30080 off the public internet: on-site agent or VPN only.
- TINNOX CMS is the single owner of each card. Install crews stop using HDPlayer schedules on CMS-managed cards.

**Second vendor.** Xixun (Sysolution) is the easiest additional controller vendor later, because it documents an own-APK route and a self-hostable Realtime Server (THIRD PARTY mirror of vendor Q&A; R1 F6).

## 6. Recommended pilot hardware combination (answers Q10)

PROPOSED, based on R4 as amended by R99 C1 (NovaStar) and C3 (on-site agent or VPN baseline). Every hardware claim stays HARDWARE-DEPENDENT/UNVERIFIED until the pilot runs it.

**Recommendation for Q10: three player types, in this order of preference.**

| # | Player type | Use it for | Why |
|---|---|---|---|
| 1 | **Huidu controller as player** (route 5) | Small async-only LED signs and pylons | No extra box in a hot cabinet; matches installer practice; lowest effort |
| 2 | **TINNOX Linux image on CM5 (eMMC) on an industrial fanless carrier** | Every HDMI-fed LED wall, large pylon and billboard, on Huidu or NovaStar controllers | Full content control and proof of play; eMMC; module rated −20 to +85 °C; supply to 2036; no partner gating |
| 3 | **TINNOX Android app as device owner on an RK3588 or RK3576 box** | LCD kiosks, especially touch and 4K portrait; fallback for LED walls if CM5 work slips | Documented Android APIs for kiosk and silent update; lower TINNOX effort |
| - | x86 N100 Linux | Deferred | No wide-temperature unit found in AU; cost and power |

The Pi 5 board is for the lab only. Yodeck still recommends the Pi 4 (VERIFIED_FULL_PAGE, AV4 N17). That choice suits a consumer price point. TINNOX needs eMMC, a wide temperature rating and supply to 2036, so the CM5 stays (R99 C12).

**Pilot combination per product line (one site each).**

| Product line | Pilot | Why | Pass criteria |
|---|---|---|---|
| **Indoor LED wall, Huidu** | CM5 8 GB / 32 GB eMMC on an EDATEC ED-IPC3630-class (or Waveshare CM5 box) carrier → HDMI → Huidu VP-series or T901 sender, or H6/H8 in sync mode. Raspberry Pi OS Lite 64-bit, overlayfs read-only root, mpv HEVC for video, Chromium kiosk for layouts. Huidu control adapter if the card is a "D" card | Full content control and proof of play; vendor-neutral; no thermal issue indoors | EDID handshake at the native canvas; 72 h soak with no frame drops on HEVC; power-cut recovery ×20; RAUC rollback works |
| **Indoor LED wall, NovaStar (PrecisionX package)** | Same CM5 stack → HDMI → NovaStar Taurus in synchronous mode or a NovaStar sender, at a package canvas such as PrecisionPro S1 (1376×774) or PrecisionLuma S1 (768×448). NovaStar control read-only | The website names NovaStar in the PrecisionX packages; this proves the second vendor on route 1 | EDID handshake at the native canvas; canvas fits the model's load (TB60 about 2.3 Mpx); for PrecisionPro S3/S4 and PrecisionMicro S4, a larger model or split canvas confirmed with TINNOX (Q23) |
| **Outdoor pylon or billboard, HDMI-capable controller** | Same CM5 stack on a box rated −25 to +60 °C, inside the cabinet's cooled controller compartment. RTC backup cell fitted with charging enabled. Temperature telemetry | eMMC, 2036 supply, fanless, full control | Internal temperature log through January and February 2027; no throttling on days at 45 °C ambient or more; watchdog recovery tested |
| **Outdoor pylon or billboard, async-only Huidu card** | No player box. Huidu "D" engineering card with the TINNOX key written at commissioning, driven by the `huidu_push` adapter (program push, brightness, schedules, screenshot). **Transport baseline: an on-site agent or a 4G router with VPN.** The Huidu gateway and reverse TCP are a separate lab spike | Fewest parts in a hot cabinet; matches installer practice | Program push from the CMS live within 2 minutes on the LAN; schedule keeps running through a 24 h outage; sampled proof of play shown as "sampled"; key written by TINNOX; AP password changed or AP disabled |
| **LCD kiosk (indoor or outdoor)** | RK3588 (or RK3576) Android 14 box with RTC and watchdog (Geniatech APC3588Q class, or an existing DSDevices DSDA1 if TINNOX holds one). TINNOX APK with Media3 and WebView, provisioned as device owner, with its own crash-relaunch watchdog. Outdoor kiosk: rely on the kiosk's own air-conditioning; box rated 60 °C or more | Touch, 4K portrait, silent updates through documented Android APIs | 4K portrait HEVC and H.264 playback; silent APK update with no prompt; relaunch after a forced crash; vendor's written patch commitment received |

Lab spikes in parallel (not pilot paths): a Huidu "D" card dialling out to an AU-hosted gateway through `SetSDKTcpServer` behind carrier NAT; a TINNOX APK on one Huidu A-series card.

**Indicative unit costs (no exchange conversion for box prices; see R4).**

| Item | Price | Label |
|---|---|---|
| CM5 8 GB RAM / 16 GB eMMC | AUD 209.95 inc GST (Core Electronics, date not shown) | THIRD PARTY |
| Industrial CM5 carrier or box | about AUD 150 to 400 (no price found) | INFERRED |
| Installed CM5 player before PSU and cabling | about AUD 360 to 610 | INFERRED |
| RK3588 signage box | APC3588Q on enquiry; non-Q APC3588 USD 269 to 359 | OFFICIALLY DOCUMENTED (shop) |
| DSDevices DSDA1 | GBP 235 ex VAT | THIRD PARTY |
| Huidu cards and senders | UNKNOWN (retailer sites blocked) | UNKNOWN |

Unit price does not decide the platform; engineering effort and patching do. The CM5 image is about 6 to 10 engineer-weeks to production quality; the Android app and device-policy controller about 3 to 5 weeks, a little more with the relaunch watchdog (INFERRED, R4).

**Procurement and design rules (PROPOSED).**
- Buy only Huidu cards with a "D" engineering ID. Prefer HDMI-capable dual-mode models above about 1280×512.
- Any outdoor player must be rated for 60 °C or more and report its temperature. Mount it in the cooled compartment. Alert at about 75 °C, before the 80 °C throttle point.
- Android boxes need a written Android version, security patch level, OTA cadence and end-of-support date before any order over 10 units.
- Standardise on one CM5 carrier and one Android SKU per year.
- Renditions per player profile: HEVC for CM5; H.264 for Android and Huidu (section 8).

**Why these player types.** Chromium on Linux hardware-decodes HEVC only through VA-API, not the Raspberry Pi's V4L2 path (OFFICIALLY DOCUMENTED, Chromium feature flags). The Pi 5 and CM5 have no H.264 hardware decoder; H.264 1080p60 costs about 50 to 60 % CPU (VERIFIED_FULL_PAGE, Pi docs). A browser-rendered video on the CM5 is therefore software-decoded, which is acceptable at small sizes and not at 4K. LED canvases are bounded by the sender's pixel budget (Huidu T901 about 1.3 Mpx, NovaStar TB60 about 2.3 Mpx; THIRD PARTY and OFFICIALLY DOCUMENTED respectively), so the CM5 with mpv hardware decode covers LED walls and pylons. 4K LCD kiosks are the Android box's job, where Media3 uses the SoC decoder (OFFICIALLY DOCUMENTED). Small async signs need no player at all.

**Risks to retire in week one of the pilot** (all HARDWARE-DEPENDENT/UNVERIFIED): the CM5 EDID handshake with Huidu T901/VP and NovaStar TB60 at the native canvas; Taurus sync-mode accepted input sizes; mpv hardware decode of HEVC on CM5 inside the kiosk session, and whether Chromium can be kept for layouts only; Huidu key write, program push and HDPlayer behaviour on one "D" card; 2160×3840 portrait throughput on the Android box; power-cut recovery with overlayfs; Play Protect prompts on the Android SKU.

**Not for the pilot:** SoC displays (partner agreements first), BrightSign (lock-in, cost), NovaStar Taurus or Huidu side-loading (lab spike only), vendor clouds (Q9), x86 (cost and power), a custom CM5 carrier board, a Yocto image and paid fleet tools (revisit at about 100 screens).

### Browser or simulator validation versus real-hardware validation

| Validated in a desktop browser, container or mock | Needs real hardware |
|---|---|
| Layout geometry, fit, crop, letterbox at target pixel sizes, including package canvases 1376×774 and 768×448; portrait templates | HDMI handshake and EDID with the LED controller; forced modes |
| Scheduling, recurrence, time zones, priorities (mocked clock) | Decode performance, frame rate, tearing, seamless loops |
| Publication state machine, manifest parsing, resumable download logic (mocked network) | Boot recovery after power cut, thermal behaviour in enclosures, watchdog, RTC |
| Huidu program compilation and signing against a mock :30080 server | Huidu key write, card download from URL, offline schedules, HDPlayer conflict, codec and font limits |
| Portal and API behaviour, isolation, audit | Silent update and rollback end to end on each SKU |
| Telemetry parsing and dashboards | Network outage behaviour, 4G NAT, PoE budget, remote diagnostics latency |

Rule: anything touching the kernel display pipeline, decoder, storage, power or a real controller is a hardware test; everything above the rendered surface, including the Huidu protocol against a mock, is a simulator test and is built first.

## 7. Build, adapt Xibo, or interim white label

Evidence from A01 (Xibo repository files, GitHub metadata and search snippets of official pages), H02, and `research/round2/R8-xibo-verify.md` (xibosignage.com pages read in full on 2026-11-03). TINNOX sells no CMS today and needs no migration (Q1, Q12), so there is no installed base to protect. The white-label column is therefore an **optional bridge only**, not a default.

| Dimension | Adapt Xibo (fork, rebrand, host) | Build TINNOX CMS | Interim white-label service (optional bridge) |
|---|---|---|---|
| Licensing | CMS and XMR are AGPL-3.0-or-later; the Windows and Linux (Electron) players are AGPL version 3 (VERIFIED_FULL_PAGE, repository licence files). The Docker tooling licence was not re-checked in round 2. Hosting a modified version obliges offering the modified source to every remote user (AGPL section 13). Android, webOS, Tizen and ChromeOS players are closed and sold as perpetual per-display licences: Android US$28, webOS/Tizen US$85, ChromeOS US$49 (VERIFIED_FULL_PAGE, pricing page, 2026-11-03). ChromeOS also needs a Google Kiosk & Signage Upgrade licence. Even Xibo's own white-label programme leaves the CMS AGPL with visible notices | TINNOX chooses; may be proprietary. LGPL-3.0 libraries from Xibo (layout renderer, communication framework) and Apache-2.0 Concerto parts can be reused without copyleft on the whole (OFFICIALLY DOCUMENTED licences; reuse INFERRED) | Xibo White Label Reseller: set-up fee, amount not published (whether it is per brand rests on a search summary only); the £300 figure is from an archived 2018 post only. 5 % discount on plans. Cloud USD 4.90 / 7.70 / 12.60 per display per month (Professional / Business / Enterprise), or "as little as £3.50" (VERIFIED_FULL_PAGE). No AUD price list (UNKNOWN). Other vendors UNKNOWN |
| Source ownership | Only the delta; Xibo Signage is sole steward and large external features are generally not accepted (PROMISE.md, VERIFIED_FULL_PAGE), so a fork diverges | 100 % | None |
| Hosting | Docker per customer; one private instance per customer, no tenant model (VERIFIED_FULL_PAGE hosting page; THIRD PARTY staff forum) | Multi-tenant from day one, all in Australia (section 8) | Xibo Cloud has an Australian data centre; instance data stays in Sydney if requested (VERIFIED_FULL_PAGE). The sub-processor for the Australian region is UNKNOWN, and some sub-processors (Google, HubSpot, a Greece-based stats provider) are offshore. **Vendor staff have on-demand admin access** (terms 3.5; `xibo_admin` must not be removed) (VERIFIED_FULL_PAGE) |
| Maintenance | Current CMS 4.5.6; 4.5.0 shipped 2026-07-30, then six patches in about three months, including security fixes. Requires PHP 8.4, MySQL 8.4, XMR 1.5. Fork must rebase; `custom/` extension surface shrank in 4.5 (VERIFIED_FULL_PAGE) | Self-funded, no rebase tax | Vendor's |
| Recurring cost | Infrastructure plus per-display player licences: Android US$28, webOS/Tizen US$85, ChromeOS US$49 one-off; minor upgrades included, major upgrades paid (VERIFIED_FULL_PAGE) | Infrastructure (section 8) plus engineering | Professional USD 4.90 less 5 % = USD 4.66 per display per month, plus the unpublished set-up fee (VERIFIED_FULL_PAGE; arithmetic checked in R8) |
| LED-controller coverage | None. No Xibo page mentions Huidu or NovaStar; an LED wall needs a separate player feeding HDMI (HARDWARE-DEPENDENT/UNVERIFIED, absence of evidence) | Huidu and NovaStar adapters designed in (section 5) | None |
| Engineering effort | Weeks to rebrand and host; retrofitting tenancy is "a huge task" per Xibo's own community guidance; replacing the closed players is a product each (INFERRED) | Multi-person-year to match Xibo's full feature set, but scope can be cut to TINNOX's needs; see `implementation-backlog.md` for a narrow first release (INFERRED) | Near zero engineering |
| Australian time zones | Per-display zone and per-event sync exist; the UI default is display-local time unless "Run at CMS time" is ticked (VERIFIED_FULL_PAGE, code and manual). 2026 reporting issues #4080, #4097 and #4102 use the browser or computer time zone instead of the CMS zone, or shift dates a day for zones ahead of UTC (THIRD PARTY search summary; open or closed state not checked, re-verify before quoting). #3884 was not found | Designed in | As Xibo |
| Contract terms | AGPL only | Own | Channel Partner Agreement under English law; renews every 12 months with 90 days' notice; Xibo trade marks cannot be used; the partner imposes a EULA at least as strict as Xibo's (VERIFIED_FULL_PAGE). The Distributor and Value-Add Reseller tiers bar competing services "based on Xibo Products" and require Xibo to be "presented at least as favourably" as a non-Xibo option. The White Label module repeats neither clause (VERIFIED_FULL_PAGE text; scope INFERRED) |
| Exit | Low (AGPL source and data remain) | None | On termination the partner "must immediately delete or remove the Xibo Solution", so every white-label customer must be moved to TINNOX CMS (VERIFIED_FULL_PAGE) |

Recommendation (PROPOSED): **build TINNOX CMS as an owned, multi-tenant product with a narrow first release, using Xibo as a reference architecture rather than a base.** The decisive factors are now:
- (a) Huidu and NovaStar controller integration is the differentiator, and no Xibo route covers it;
- (b) owned software is needed for the margin and recurring revenue TINNOX wants (Q7);
- (c) the AGPL network clause and the absence of a tenant model;
- (d) Xibo's terms impose standing vendor staff access, English law and deletion on exit.

The interim white label is an optional bridge, used only if signed hardware sales need software before the TINNOX MVP is ready. Conditions (PROPOSED, R8):
- the Xibo Cloud Australian region is confirmed in writing for every instance;
- White Label tier only, with Xibo's written confirmation that building TINNOX's own CMS is allowed;
- capped at 20 screens or fewer and 3 customers or fewer;
- customer contracts state up front that the platform will change;
- only screens whose players TINNOX will reuse (Android or Windows boxes, not SoC licences).

The bridge **conflicts with the B+ support-access default** (`research/round2/R2-support-access-models.md`). Under B+, content and account access is off until the customer grants it. Xibo staff have standing admin access that the customer cannot switch off (no opt-out documented, INFERRED). Any bridge customer must be told this in writing.

## 8. Platform stack and running costs (PROPOSED)

Licences were read from the projects' repositories. AWS Sydney and Melbourne unit prices come from the AWS machine-readable price list (VERIFIED_FULL_PAGE, files published October and November 2026). Google Cloud Sydney prices were read from cloud.google.com (VERIFIED_FULL_PAGE). Other vendors' prices came through search snippets and are THIRD PARTY. Hosting follows `research/round2/R3-au-hosting-compliance.md`.

| Layer | Choice | Licence | Alternative | Reason |
|---|---|---|---|---|
| Backend and portal | TypeScript on Node 22: NestJS or Fastify API, React front end, PostgreSQL 16 with row-level security keyed by tenant, Redis-backed job queue | MIT (frameworks), PostgreSQL licence | Django for faster back-office CRUD; Go for the device gateway only if concurrent connections exceed what Node handles comfortably | One language across API, portal, the Linux player supervisor and the on-site agent; RLS makes isolation auditable |
| Hosting region | AWS ap-southeast-2 (Sydney) for everything; ECS Fargate or EC2 Graviton; RDS PostgreSQL Single-AZ until about 300 to 500 screens, then Multi-AZ | Service | Google Cloud Sydney + Melbourne | Cheapest hyperscaler in the model; IRAP PROTECTED in both AU regions (OFFICIALLY DOCUMENTED); HCF Strategic since October 2021 (THIRD PARTY) |
| Disaster recovery | AWS Backup or RDS snapshot copies and S3 replication to ap-southeast-4 (Melbourne) | Service | None needed | Melbourne unit prices equal Sydney's; cross-region transfer USD 0.080/GB (VERIFIED_FULL_PAGE). Seeding 1,500 GB of media costs about AUD 174 once, then only changes |
| Media processing | ffmpeg and ffprobe (validation, poster frames, per-canvas renditions), sharp on libvips (images), Gotenberg (LibreOffice and PDF rasterising) for PDF in release 1 | ffmpeg LGPL 2.1 or GPL when built with libx264/libx265 (run as a separate process; confirm with counsel), sharp Apache-2.0, libvips LGPL-2.1, Gotenberg MIT | ImageMagick | **Renditions per player profile**: HEVC for CM5 (no H.264 hardware decoder; VERIFIED_FULL_PAGE); H.264 for Android and Huidu cards (Huidu codec limits HARDWARE-DEPENDENT/UNVERIFIED). 4K only where the panel needs it. Content-addressed object keys |
| Object storage and delivery | **S3 Sydney with CloudFront limited to the Australia price class** (or S3-direct signed URLs at pilot scale); presigned URLs with Range support. Huidu cards download media by URL from the same origin | Service | Cloudflare R2 as a **gated opt-in** for non-personal media only, once egress exceeds about AUD 500 per month, and only after the privacy statement says so | R2 has no Australian jurisdiction, only `eu` and `fedramp`, and location hints are best effort (OFFICIALLY DOCUMENTED). That conflicts with strict AU handling (Q9). Edge caches remain a global service (INFERRED) |
| Identity | Amazon Cognito in ap-southeast-2 (MFA, Australian residency, free up to 10,000 monthly active users) for portal users; device credentials issued by the CMS enrolment flow; Huidu card secrets in a vault | Service | Keycloak self-hosted (Apache-2.0) if per-tenant SAML federation is needed without per-user fees | Residency and MFA at no cost at pilot scale |
| Security baseline | KMS customer-managed keys in Sydney; CloudTrail and Config; Security Hub with AWS Foundational and CIS benchmarks; GuardDuty; MFA everywhere; **an Organisations SCP that denies all non-AU regions** | Service | Equivalent controls on Google Cloud | Keeps data AU-only by policy, not only by habit (R3) |
| Player protocol | HTTPS poll of a content-addressed manifest (default 300 s, ETag) plus a push channel for commands (Mosquitto MQTT at pilot, AWS IoT Core at scale), resumable Range downloads, idempotent publication versions, batched proof of play. Huidu cards: signed HTTP API calls relayed by the on-site agent or VPN | Mosquitto EPL-2.0 and EDL | WebSocket long-poll instead of MQTT | Mirrors the proven shapes in Xibo (RequiredFiles with size and md5, collectNow push) and info-beamer (signed per-device sync files with rollback) |
| Linux player | Node supervisor service, Chromium kiosk under a Wayland kiosk compositor for layouts, mpv with hardware decode for video zones, overlayfs read-only root, temperature and throttling telemetry | cage MIT, mpv GPL/LGPL, Chromium BSD | Qt-based renderer as Anthias moved to | See section 6 |
| Android player | Kotlin, Media3 ExoPlayer, WebView for layouts, device-owner lock task, silent PackageInstaller updates, own crash-relaunch watchdog | Apache-2.0 libraries | Flutter (not researched) | Documented platform APIs, no vendor partnership |
| OS updates | Mender (client and server Apache-2.0; hosted Basic about USD 34 per month) or RAUC (LGPL-2.1; needs a bootloader backend around the Pi `tryboot` mechanism) for CM5 images; app updates via the supervisor with signature check and health-gated rollback | As stated | balenaCloud (first ten devices free, THIRD PARTY) | A/B images with rollback are the only safe way to update unattended outdoor devices |
| Observability | CloudWatch Logs and metrics (priced in the cost model below), or Prometheus, Grafana and Loki self-hosted in Sydney; offline alerting from the heartbeat table; email by default, SMS opt-in | Grafana and Loki AGPL (hosted use fine), Sentry FSL | Grafana Cloud and Sentry, only with an AU data location | Cost and residency |

**Running cost estimate: Option A, AWS Sydney all-AU** (AUD per month). The model and its arithmetic were re-run in the R3 verification pass.

Assumptions (INFERRED unless stated):
- **FX:** 1 AUD = 0.69 USD (1 USD = AUD 1.449). This rounds the aggregator rate of 0.6928 USD per AUD on 1 October 2026 (THIRD PARTY, https://www.exchange-rates.org/exchange-rate-history/aud-usd-2026-10-01). The RBA rate is to be confirmed on the decision date. At the unrounded 0.6928 the totals fall by about 0.4 %. Brackets show the totals at 0.65 USD per AUD. All hyperscalers bill in USD.
- 730 hours per month, on-demand, no Savings Plans, no free tiers subtracted, support plans excluded (budget about AUD 150 per month for AWS Business Support from 100 screens).
- 3 GB of media egress per screen per month plus 0.1 GB of API and heartbeat traffic (one heartbeat per minute).
- Media library 20, 100, 500 and 1,500 GB. Postgres Multi-AZ from 500 screens.

| Line item | 10 screens | 100 screens | 500 screens | 2,000 screens |
|---|---|---|---|---|
| API, web and worker compute (with EBS, ALB) | 49 | 76 | 263 | 597 |
| Managed Postgres (HA from 500) | 30 | 64 | 255 | 595 |
| Backups | 3 | 7 | 16 | 40 |
| Object storage (S3 and requests) | 1 | 4 | 19 | 58 |
| Egress and CDN | 5 | 52 | 259 | 1,035 |
| Monitoring (CloudWatch) | 12 | 34 | 90 | 247 |
| Email and SMS alerts | 1 | 14 | 72 | 290 |
| DNS, KMS, Secrets, WAF | 7 | 12 | 29 | 51 |
| **Total** (bracket: at 0.65 USD per AUD) | **109** (116) | **263** (279) | **1,002** (1,064) | **2,913** (3,092) |
| Per screen per month | 10.90 | 2.63 | 2.00 | 1.46 |

Prices are VERIFIED_FULL_PAGE; sizing and volumes are INFERRED. The SMS unit rate (about USD 0.045) is UNKNOWN. CloudFront's free 1 TB per month is not subtracted, so the 2,000-screen figure is conservative by about AUD 165.

**Egress is the main cost driver at scale.** It is 35 % of Option A at 2,000 screens. Each GB per screen per month costs about AUD 0.165 per screen. At 10 GB per screen (4K-heavy content), egress is about AUD 3,106 and the total about AUD 5,000 per month at 2,000 screens. Player caching and content-hash delta downloads matter more than the provider.

**Alternatives** (AUD per month, same assumptions; R3 F4):

| Option | 10 | 100 | 500 | 2,000 | Position |
|---|---|---|---|---|---|
| B. AWS Sydney + Cloudflare R2 for media | 103 | 211 | 743 | 1,885 | Not the default: R2 has no AU jurisdiction. Saves about 26 % at 500 and 35 % at 2,000 screens |
| C. Google Cloud Sydney (Cloud SQL, GCS, Premium-tier egress) | 139 | 346 | 1,289 | 3,473 | Alternative: 19 to 32 % above Option A; HCF "Certified Strategic" on Google's own page (VERIFIED_FULL_PAGE) |
| D. DigitalOcean SYD1 | 79 | 139 | 521 | 1,278 | Dev or pilot only: no IRAP, no HCF, no Melbourne DR (prices THIRD PARTY or INFERRED) |
| E. Azure Australia East | Not modelled line by line | | | | Expect Option A ±15 % (INFERRED) |
| F. Oracle Cloud Sydney / Melbourne | Not modelled | | | | First 10 TB per month of egress free (VERIFIED_FULL_PAGE row label); a watch item |
| G. Sovereign AU-owned (AUCloud, Vault, Macquarie) | Quote only | | | | Dedicated deployment only if a buyer contract demands Australian-owned or PROTECTED hosting (UNKNOWN prices) |

Infrastructure is far below signage SaaS list prices. From 1 April 2026 Yodeck lists USD 8 to 16 per screen per month, and its own Australian list is AUD 13.00 to 25.00 per screen per month (VERIFIED_FULL_PAGE, Yodeck pricing-update help article, `research/round2/AV1-accounts-admin.md` row 35). Engineering and support, not hosting, are the real cost of ownership (INFERRED).

**Compliance worklist, independent of provider (PROPOSED, R3).**
- APP 1 privacy policy and a CMS data-location statement, separate from the website's privacy policy.
- Notifiable Data Breaches response plan (30-day assessment).
- Essential Eight self-assessment targeting ML2 for TINNOX's corporate and admin environment.
- Supplier security questionnaire pack (ISO 27001-aligned controls, pen test, audit logging, staff-access policy).
- Records of the provider's IRAP, ISO and SOC reports for tenders.

## 9. Open items specific to this document

The TINNOX question list from the round-2 critic (`research/round2/R99-critic.md` section 3, Q-T1 to Q-T14) is recorded in `open-questions.md` as **Q13 onwards** (Q13 = Q-T1, through Q26 = Q-T14). The ones that block hardware commitment:
- **Q13 (Q-T1):** which vendor API was granted (Q4). A 16-hex `sdkKey` plus secret from Huidu support means Huidu; an AppKey and AppSecret from the VNNOX Open Platform means NovaStar. No adapter work starts on either assumption.
- **Q14 (Q-T2):** controller or player per product package: make, model, full device ID ("D"?), firmware, HDMI-in.
- **Q15 (Q-T3):** on installed Huidu cards, whether a key is already written and by whom, whether HDPlayer schedules are in use, and how many cards are on 4G.
- **Q16 (Q-T4):** whether "DsDevice" is DSDevices, which model and which kiosks.
- **Q22 (Q-T10):** outdoor cabinet cooling and the controller compartment, and whether a temperature logger can go into one pylon over January and February 2027.
- **Q23 (Q-T11):** pixel resolutions for StructuraSign and DuraBlaze, and the NovaStar model per PrecisionX size.

Hardware-only unknowns, settled by the pilot (HARDWARE-DEPENDENT/UNVERIFIED): whether a Huidu card dials out through `SetSDKTcpServer` behind carrier NAT; HDMI-in on Huidu A7/A8; the CM5 EDID handshake with Huidu T901/VP and NovaStar TB60 at the native canvas; Taurus sync-mode accepted input sizes; mpv HEVC in the kiosk session on CM5; thermal behaviour in a sun-loaded Australian cabinet; RK3588 4K portrait playback and silent update with Play Protect; Huidu codec and font limits for pushed media; what HDPlayer schedules do after the HTTP API is enabled; factory-reset behaviour of a written key.
