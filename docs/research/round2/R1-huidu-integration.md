# R1 — Huidu as TINNOX's main controller vendor: how TINNOX CMS should integrate

Date: 2026-11-03. Builds on H01 (`../research/H01-novastar-led-integration.md`), which already recorded the Huidu HTTP API on port 30080, the "D" engineering-card rule, the Android model list, the HTTP-SDK-overrides-HDPlayer-schedules caveat and the SDK 2.0 Go port. This file adds only new evidence: the full endpoint inventory read from the official document, the one-time key initialisation lock, the gateway / reverse-TCP route, the discovery and TCP ports, the cloud and software names, product-family facts, a Huidu integrator's real-world notes, and the vendor-neutral comparison with Xixun (Sysolution), Colorlight and Linsn.

Labels used: VERIFIED_FULL_PAGE · OFFICIALLY_DOCUMENTED · THIRD_PARTY · INFERRED · UNKNOWN · HARDWARE-DEPENDENT/UNVERIFIED · PROPOSED.
Network note: huidu.cn, hdwell.com, gitee.com, toolboom.com and other retailer sites are blocked in this session (toolboom.com tried once, `ENOTFOUND`; it would need allow-listing). The official Huidu API document was read in full from a byte-for-byte GitHub mirror of the Gitee repo (raw.githubusercontent.com). Product specifications come from search snippets of retailer pages only.

---

## Summary

1. **Huidu has an official, documented device API: the "HTTP API".** It is a signed JSON-over-HTTP interface on each controller at `http://<card-ip>:30080/api/{device|program|file|screenshot}/`. It covers device properties (including brightness and time zone), status, scheduled brightness/volume/screen/relay tasks, polling tasks, push data, reboot, screen on/off, switching to a chosen program, program CRUD (text, image, video, clocks, dynamic areas, with playback windows), file upload and screenshot. Document revision 2026-06-16. [VERIFIED_FULL_PAGE, official document via mirror]
2. **Access depends on keys.** Every call is signed `HMACMD5(body+sdkKey+date, sdkSecret)`. The keys are **issued by hand by Huidu technical support**: "The platform is not yet open … contact Huidu to obtain your SDK Key and SDK Secret". **This sdkKey/sdkSecret pair is the most likely "one vendor API granted" to TINNOX** [INFERRED]. One key pair covers all of a developer's devices [THIRD_PARTY].
3. **Keys can be written to a card only once.** The key must be written to each card once, through `<ip>:30080/login/` or `/api/sdkkey/`. After that "it cannot be initialised again" [OFFICIALLY_DOCUMENTED]; recovery by factory reset is stated only by a third-party guide [THIRD_PARTY] [corrected in verification]. If a distributor or installer has already written its own key, TINNOX is locked out of that card. This is the biggest operational risk in the whole route.
4. **Only engineering cards are supported.** Secondary development works only on cards with a **"D" in the device ID** (e.g. `C16L-D00-A000F`). Android-series cards (A3L, A4L, A5L, A6L, H4K, H8, B8L, A7, A8) need current firmware, and on new firmware the HTTP API is on by default [OFFICIALLY_DOCUMENTED; THIRD_PARTY for "on by default"].
5. **The API can be reached three ways:** directly on the LAN; through a Huidu **"gateway service (Ubuntu/Windows)"** shown in the official flow diagram; and over the older **SDK 2.0 binary TCP protocol on port 10001**. SDK 2.0 has a `SetSDKTcpServer` command that makes a card dial out to a server. That gives a reverse connection, so cards on 4G behind carrier NAT can be managed from a server that **TINNOX could host in Australia** [OFFICIALLY_DOCUMENTED diagram; THIRD_PARTY for the TCP detail].
6. **No public Huidu cloud API was found.** Huidu's cloud is marketed as "XiaoHui Cloud" / "HD Cloud Platform", with phone apps LedArt and 屏掌控. The official request-header example shows `Host: sdk.huidu.cn`, which suggests a hosted endpoint exists, but it has no public documentation [OFFICIALLY_DOCUMENTED sample header; UNKNOWN for scope and terms].
7. **There are two Huidu product worlds.** *Synchronous* gear (HD-T901/T902 sending boxes, HD-VP210/410/620 video processors that include a sending card) only takes HDMI/DVI. *Asynchronous* cards (C/D/B/A/H series for full colour; W/U/E series for single and dual colour) store and play content. The Android "A"/"H"/"B8L" families are dual-mode: some have HDMI IN/LOOP for sync mode (H6, H8 confirmed). The C/D series run ARM Linux firmware [THIRD_PARTY; OFFICIALLY_DOCUMENTED for the Linux/Android split].
8. **Route ranking for TINNOX:** (a) TINNOX player → HDMI → Huidu sync sender or dual-mode card in sync mode gives TINNOX full control and is vendor-neutral. (b) Pushing programs through the HTTP API works and is official, but proof of play is limited and it is Huidu-only. (c) A TINNOX APK on a Huidu Android card is undocumented by Huidu (Xixun documents the same thing officially). (d) The Huidu cloud API is not viable today.
9. **PROPOSED primary:** route (a) for all video walls, pylons and billboards that have, or can be given, an HDMI-capable controller. Pair it with a Huidu HTTP-API **control adapter** (brightness, screen on/off, status, screenshot, schedules) on dual-mode cards. **PROPOSED fallback:** route (b), Huidu program push, for async-only small signs (C/D/W/E cards with HUB75/HUB12 outputs), where adding a player box is not economic.
10. **Proof of play is weak in route (b).** The HTTP API has no play-log endpoint. The evidence available is the screenshot, `screen.openStatus`, and (SDK 2.0) `GetCurrentPlayProgramGUID`. TINNOX has to build proof of play by polling and sampling [OFFICIALLY_DOCUMENTED absence in the full document; INFERRED design].
11. **Don't build for Huidu only.** Xixun/Sysolution (LedOK Express) officially documents four routes, including "install your own APK" and a self-hosted realtime server. NovaStar has VNNOX Open API (cloud). Colorlight has a device-to-server protocol document (v0.9, leaked copy) and no public API. Linsn has only a reverse-engineered receiving-card protocol. All of them accept HDMI, so route (a) works for every vendor.
12. **Next action:** ask TINNOX the identification questions in Open items §A before any adapter work. The key questions are whether the key is a 16-hex `sdkKey`, who issued it, whether the cards carry "D" IDs, and whether a key is already written to them.

---

## Findings

### F1. Huidu product families

| # | Family / model | Type | OS / platform | Inputs / outputs | Max load (as listed) | Label | Source |
|---|---|---|---|---|---|---|---|
| 1 | HD-T901 | Synchronous sending box | FPGA (no OS) | DVI/HDMI in (model-dependent) | 1280×1024; widest 3840, highest 2048; 1–64 scan; multi-card splicing | THIRD_PARTY | https://toolboom.com/en/huidu-hd-t901-controller-1280-1024-widest-3840-highest-2048-synchronous/ |
| 2 | HD-T902X1 / X2 | Synchronous sending box | FPGA | 4 / 8 Ethernet ports | UNKNOWN | THIRD_PARTY | https://m.made-in-china.com/catlist/LED-Video-Processor-1660000000-21.html |
| 3 | HD-VP210, HD-VP410(A), HD-VP620 | Video processor + sending card ("3-in-1") | FPGA | DVI/HDMI/VGA in | VP210 1280×1024; VP410 "max 1920 px" | THIRD_PARTY | https://toolboom.com/en/huidu-hdvp210-video-processor-for-led-screens-1280-1024/ ; https://toolboom.com/en/huidu-hd-vp620-dvi-hdmi-vga-video-processor-for-led-screens/ ; https://www.scribd.com/document/740598595/HUIDU-Technology |
| 4 | HD-H6 | Dual-mode multimedia player | Android (family; see row 5) | HDMI IN (sync), HDMI LOOP (splice input), HDMI OUT (monitor/cascade); 6 Ethernet out | Listed 65536×8192 canvas; decode 2×4K / 6×1080p / 10×720p | THIRD_PARTY | https://toolboom.com/en/huidu-hd-h6-led-display-module-controller-65536-8192/ |
| 5 | HD-H8 (and H4K) | Dual-mode player, 8 ports | **Android 11** (H8 listing); H4K listed as Android series | HDMI IN, HDMI LOOP, ASYNC source button; 4K decode | UNKNOWN px | THIRD_PARTY (H8); OFFICIALLY_DOCUMENTED (H4K/H8 = Android series) | https://www.tokopedia.com/mms-surabaya/video-processor-huidu-hd-h8 ; https://github.com/Turkmen87ai/huidu-sdk-gitee-mirror/blob/master/README.en.md |
| 6 | HD-A3L, A4L, A5L, A6L, A601, A602, A6 | Async controller cards ("A" = Android) | **Android** (A4L listing "Android platform"; A3L–A6L in the official Android list) | LAN, Wi-Fi; 16 GB (A3L, A4L) | A3L/A4L 1280×512 (A3L max 4096 wide / 2048 high); A5/A5L 1280×1024; A6 2048×1024; A6L 2560×1024; A602 1280×720 or 3840×240 | THIRD_PARTY; OFFICIALLY_DOCUMENTED for the Android list | https://toolboom.com/en/huidu-hd-a3l-led-display-module-control-card-1280-512-with-wi-fi-module/ ; https://toolboom.com/en/huidu-hd-a4l-led-display-module-control-card-1280-512-with-wi-fi-module/ ; https://toolboom.com/en/huidu-hd-a6l-led-display-module-controller-2560x1024/ |
| 7 | HD-A7, HD-A8 | "Dual-mode intelligent 4K controllers" for large screens | Android (official list) | HDMI input **UNVERIFIED** | UNKNOWN | THIRD_PARTY (marketplace copy, contains a "LINSN" copy-paste error); HARDWARE-DEPENDENT/UNVERIFIED | https://es.made-in-china.com/category23_Electrical-Electronics/LED-Video-Processor_36.html |
| 8 | HD-B6, HD-B8L | Async controller (B series) | B8L = Android (official list); B6 UNKNOWN | UNKNOWN | B6 1280×512 | OFFICIALLY_DOCUMENTED (B8L Android) / THIRD_PARTY | https://toolboom.com/en/huidu-hd-b6-led-display-module-controller-1280-512/ |
| 9 | HD-C16L, C08L, C16C, C35C, C10C; HD-D15, D16, D18, D36 | Async full-colour cards with HUB75 outputs | **ARM/Linux** ("regular series", official) | LAN/Wi-Fi/optional 4G; no HDMI | C16C 204,800 px (640×320); C35C 1024×512; D15 640×64; D16 4 GB storage | OFFICIALLY_DOCUMENTED for C16L, C08L, D16, D36 only (official Linux list); C16C, C35C, C10C, D15, D18 THIRD_PARTY [corrected in verification] / THIRD_PARTY (sizes) | https://github.com/Turkmen87ai/huidu-sdk-gitee-mirror/blob/master/README.en.md ; https://m.indiamart.com/proddetail/hd-c16c-full-colour-asynchronous-led-controller-26499016548.html ; https://toolboom.com/en/huidu-hd-c35c-led-display-module-control-card-1024-512-with-wi-fi-module/ ; https://store.azarpixel.com/collections/receiving-cards/products/huidu-hd-d16-full-color-asynchronous-control-card |
| 10 | W series (W03, W60, W62, W63, W64A, WF1/WF2/WF4), U series (U62, U6A), E series (E62, E63, E66) | Single- and dual-colour text cards: W = Wi-Fi, U = USB stick, E = Ethernet + USB | Embedded (WF1/WF2/WF4 are ESP32-based, per hobby firmware projects) | HUB12/HUB08 | E63 1024×128; E62 1024×64 | THIRD_PARTY | https://circuitmall.ng/product/huidu-hd-w63-wifi-led-display-control-card/ ; https://hubtronics.in/HUB12/E62 ; https://toolboom.com/en/huidu-hd-e63-led-display-module-controller-1024-128-3072-32/ ; https://github.com/mrcodetastic/HD-WF1-WF2-LED-MatrixPanel-DMA |
| 11 | HD-R5xx / R6xx (R500, R508, R512, R516, R612, R320t) | Receiving cards | FPGA | Ethernet in, HUB out | per card | THIRD_PARTY | https://www.made-in-china.com/video-channel/szledworld_BObGqMxrfWce_HD-R320t-Huidu-HD-R500-R508-R512-R516-R612-Full-Color-Receiving-Card-Asyn-LED-Display-Controller.html |

The pixel figures are retailer titles, not datasheets. Treat each as HARDWARE-DEPENDENT/UNVERIFIED until checked against the label and HDPlayer "device info" of the actual unit.

### F2. Huidu software and cloud

| # | Name | Role | Label | Source |
|---|---|---|---|---|
| 1 | **HDPlayer** | Windows (and a Linux .deb, v1.0.15.0, in the UnionTech app store) PC software: LAN discovery by broadcast, program editing, firmware upgrade (Control → Firmware Upgrade; firmware e.g. V2.8.5.10) | THIRD_PARTY | https://github.com/System233/linglong-builder (repos/com.huidu.hdplayer.linyaps/linglong.yaml) ; https://raw.githubusercontent.com/Turkmen87ai/huidu-sdk-gitee-mirror/main/docs-tr/02-sdk-test-ve-cihaz-baglantisi.md ; https://manuals.plus/category/huidu |
| 2 | **HDSet** | Configuration tool (screen parameters, receiving cards) | THIRD_PARTY | https://manuals.plus/category/huidu |
| 3 | **HD2016 / HD2018 / HD2020** | Older PC editing software generations (HD2016 manual exists); HD2020 / "HDPlayer2" not confirmed | THIRD_PARTY / UNKNOWN | https://st.storeland.ru/9/2133/510/HD2016-_INSTRUKCIYa_Operation_manual_V1.0_1_.pdf |
| 4 | **LedArt** (and LedArt lite) | iOS/Android app; Wi-Fi control of cards | THIRD_PARTY | https://toolboom.com/en/huidu-hd-c08l-led-display-module-control-card-640-320-8-hub75e-with-wi-fi-module/ ; https://manuals.plus/category/huidu |
| 5 | **屏掌控** (publisher Shenzhen Huidu Technology) | iOS app: remote card settings, remote commands, cluster publishing | THIRD_PARTY (app-store listing) | https://apps.apple.com/cn/app/id1144062386 |
| 6 | **XiaoHui Cloud / "HD Cloud Platform"** | Huidu's cloud for remote cluster management and program updates ("USB, Wi-Fi via LedArt, or remotely through XiaoHui Cloud, depending on model") | THIRD_PARTY | https://manuals.plus/category/huidu ; https://www.aliexpress.com/s/wiki-ssr/article/xiaohui-cloud ; https://m.indiamart.com/proddetail/hd-c16c-full-colour-asynchronous-led-controller-26499016548.html |
| 7 | **SDK Test tool + Apipost collection** (in the official SDK `tools/` and `doc/`) | Send XML SDK 2.0 commands (`GetHttpApiEnable` / `SetHttpApiEnable`), debug HTTP API | VERIFIED_FULL_PAGE | https://github.com/Turkmen87ai/huidu-sdk-gitee-mirror/blob/master/README.en.md |

### F3. Official and semi-official integration surfaces

| # | Surface | Transport / auth | What it does | Label | Source |
|---|---|---|---|---|---|
| 1 | **HTTP API** (`cn.huidu.device.sdk`, Gitee `szhuidu`) | HTTP on card **TCP 30080**; headers `requestId`, `sdkKey`, `date` (RFC 1123), `sign`; `sign = HMACMD5(body+sdkKey+date, sdkSecret)`; file calls `HMACMD5(sdkKey+date, sdkSecret)`; SDK version must be ≤ device API version | See F4 | VERIFIED_FULL_PAGE | https://github.com/Turkmen87ai/huidu-sdk-gitee-mirror/blob/master/README.en.md ; official https://gitee.com/szhuidu/cn.huidu.device.sdk |
| 2 | Client SDKs inside the same repo | Java (JDK 21, Maven; demos 0–6), C (CMake), Python 3.9 (`requests`, `requests-toolbelt`) | Wrappers for row 1 | VERIFIED_FULL_PAGE (directory listing) | same |
| 3 | **Gateway service (Ubuntu/Windows)** | SDK → gateway → device; shown as one of two official access flows | Central fan-out to many cards; details (port, packaging, licence) not in the document | OFFICIALLY_DOCUMENTED (diagram only); details UNKNOWN | same, §1.2 |
| 4 | **SDK 2.0 binary protocol** (C# `HDSDK.dll`, "Gen6 SDK V2.0") | TCP **10001** on card; little-endian frames; version handshake 0x2001; XML `<sdk guid><in method=…>`; file transfer 0x8001–0x8006 with MD5 resume; heartbeat | AddProgram/UpdateProgram/DeleteProgram, Get/SetLuminancePloy (manual, scheduled, sensor), Get/SetSwitchTime, Open/CloseScreen, time sync, Wi-Fi/Ethernet, boot logo, `GetCurrentPlayProgramGUID`, **`Get/SetSDKTcpServer` (card dials out to a remote server)** | THIRD_PARTY (reverse-engineered from the official C# SDK 2.0.10; tested on HD-WF2) | https://github.com/alparslanahmed/huidu-led ; https://github.com/sintar777/HUIDU-HD-FW2-SDK-python |
| 5 | HDPlayer wire protocol (A3L) | Card = TCP server on 10001; **UDP 9527 broadcast discovery**; in Wi-Fi AP mode the card is `192.168.43.1`; JSON `PlayTask` + MD5 file-sync sub-protocol (only missing bytes uploaded) | Push a full-screen image to an A3L | THIRD_PARTY (Wireshark-derived) | https://github.com/MrKadyroff/tablo-poster-huidu (HUIDU_INTEGRATION.md) |
| 6 | Old official GitHub org `huidutech/sdk` | Placeholder only ("测试提交", 2017) | none | THIRD_PARTY observation | https://github.com/huidutech/sdk |
| 7 | Hosted SDK endpoint `sdk.huidu.cn` | Appears as `Host:` in the official signed-request example; a third-party guide calls it the "cloud API, needed only for remote management" | UNKNOWN scope | OFFICIALLY_DOCUMENTED (sample header) / THIRD_PARTY (interpretation) | https://github.com/Turkmen87ai/huidu-sdk-gitee-mirror/blob/master/README.en.md ; https://raw.githubusercontent.com/Turkmen87ai/huidu-sdk-gitee-mirror/main/docs-tr/01-sdk-kayit-ve-baslangic.md |
| 8 | XiaoHui Cloud open API | none found | — | UNKNOWN | search log #6, #15 |
| 9 | Other community ports | Node bindings (D16), Spanish rendering of the HTTP API, Korean integrator spec (C16L via 30080, keys requested from Huidu support, "once written cannot be rewritten") | — | THIRD_PARTY | https://github.com/KryQ/node-huidu-sdk ; https://github.com/anavarui/HTTP-API-Full-Color-ESP ; https://github.com/nabaho/pureunall (docs/superpowers/specs/2026-10-12-signboard-design.md) |

### F4. HTTP API inventory (read in full; revision 2026-06-16)

| Area | Method / path | Notes relevant to TINNOX | Label |
|---|---|---|---|
| Key init | `POST /api/sdkkey/` or web `:30080/login/` | **One-time**; "already initialised … can only be added once"; the only unsigned call | VERIFIED_FULL_PAGE |
| Enable | XML `GetHttpApiEnable` / `SetHttpApiEnable` (via SDK Test) | Step is skipped for the Android series ("just upgrade to the latest firmware"), so in practice Linux series only [INFERRED from the official note, corrected in verification]; enabling "takes over certain standard functions … HDPlayer … scheduled power on/off may not take effect" | VERIFIED_FULL_PAGE |
| Addressing | `/api/device/` (local card), `/api/device/ID1,ID2` or `?id=` | One request can address several cards (through the gateway) | VERIFIED_FULL_PAGE |
| Inventory | `getDeviceProperty` (online list) | Returns name, `sync`, `screen.width/height/rotation`, hardware/FPGA/app versions, `time.timeZone` (default Asia/Shanghai), `luminance`, `luminance.mode`, volume, Ethernet/GSM/Wi-Fi config (**Wi-Fi AP password returned in clear text**; `getDeviceStatus` returns it too, and the official sample value is `[sample default redacted]`, which looks like a factory default [added in verification]) | VERIFIED_FULL_PAGE |
| Update | `setDeviceProperty` | Brightness, time zone, network, name | VERIFIED_FULL_PAGE |
| Status | `getDeviceStatus` | `screen.openStatus`, Ethernet/Wi-Fi validity, 4G modem IMEI/ICCID/signal/network type | VERIFIED_FULL_PAGE |
| Schedules | `getScheduledTask` / `setScheduledTask` for `screen`, `volume`, `luminance`, `relay` | Time range, date range, week and month filters; the card enforces these offline | VERIFIED_FULL_PAGE |
| Polling task | `get/setPeriodicTask` (`url`, regex, interval 3–3600 s) | The card pulls an external URL and regex-parses key/values into dynamic areas. Usable for live data (e.g. fuel prices on pylons) without pushing | VERIFIED_FULL_PAGE |
| Push data | `pushStatus` (key/values) | Updates dynamic areas or switches programs | VERIFIED_FULL_PAGE |
| Control | reboot, open screen, close screen, `demandProgram {index}` | Immediate | VERIFIED_FULL_PAGE |
| Programs | `POST /api/program/` `append | remove | update | replace | getAll` | Program → area → item (image, video, text, digitalClock, dialClock, dynamic); `playControl` = duration, weekdays, date ranges, daily time windows; image `file` = **file name on card or any valid URL** + `fileMd5` (the card downloads it; skips download if already present) | VERIFIED_FULL_PAGE |
| Files | `POST /api/file/` (form-data) | Returns a signed, expiring URL on the card | VERIFIED_FULL_PAGE |
| Screenshot | `GET /api/screenshot/` | Base64 image of what the card renders | VERIFIED_FULL_PAGE |
| Play logs / proof of play | — | **Not present** in the document | VERIFIED_FULL_PAGE (absence) |
| HTML/web page item | — | **Not present** (no web/URL widget type) | VERIFIED_FULL_PAGE (absence) |

### F5. Integration routes for TINNOX CMS with Huidu

| Route | Feasibility | Scheduling | Proof of play | Screenshots | Brightness | Power | Offline | Latency | Risks | Evidence / label |
|---|---|---|---|---|---|---|---|---|---|---|
| **(a) TINNOX player → HDMI → Huidu sync sender (T901/T902/VP) or dual-mode card in sync mode (H6/H8, maybe A7/A8)** | High for sites with an HDMI-capable controller; **impossible on HUB75-only async cards** (C/D/W/U/E) without adding a sender | Full (TINNOX) | Full (player logs) | Of the rendered canvas (player side) | Not through HDMI. Needs the HTTP API (dual-mode cards) or HDSet/sensor; T/VP senders: UNKNOWN control API | Player-side display off; LED output off needs the controller API or a relay | Full player cache | Frame-level (~1–2 frames controller delay, INFERRED) | Extra box per site (cost, power, heat in pylons); custom EDID/canvas mapping per site; the dual-mode card's async content can override HDMI if the source policy is wrong | F1 rows 1–5; H01 signal chain — THIRD_PARTY + INFERRED |
| **(b) TINNOX CMS pushes programs via HTTP API (direct LAN through an on-site agent, or a TINNOX-hosted gateway/reverse TCP)** | High on "D" engineering cards with TINNOX's key written; **nil** on non-D cards or cards already keyed by someone else | Huidu's model only: programs + playControl windows + scheduled tasks; no layered campaigns or priorities beyond what TINNOX compiles into a playlist | **Weak:** no play log; only screenshot sampling + status + (SDK 2.0) current program GUID | Yes (`/api/screenshot`) | Yes, manual + scheduled (+ sensor via SDK 2.0) | Screen on/off + schedules; relay schedules | Yes. Card stores programs and runs schedules autonomously | Commands sub-second on LAN (INFERRED); content = card download from URL (4G bandwidth-bound) | Key lock-in; HDPlayer schedule conflict; Huidu-only rendering (fonts, effects, codec limits); default Asia/Shanghai time zone must be set to Australian zones; Wi-Fi AP password exposure; no TLS on 30080 (plain HTTP, INFERRED from URLs) → traffic must stay on LAN/VPN or go through a reverse tunnel | F3 rows 1–5, F4 — VERIFIED_FULL_PAGE |
| **(c) TINNOX player APK on a Huidu Android card (A/H/B8L)** | **UNKNOWN.** Huidu documents no APK install, ADB or launcher replacement; nothing found in searches | Full, if it works | Full, if it works | App-side | Only via the HTTP API on the card itself: the official document says "no id specified: /api/device/ indicates operating the local device"; the `127.0.0.1:30080` address comes from a third-party guide [corrected in verification] | Same | Full | Frame-level | Unsupported by vendor; firmware updates may remove side-loads; low RAM class; HUB/receiving-card output still owned by Huidu's player process (who owns the screen is UNKNOWN). Contrast: Xibo-style APK route is **officially documented by Xixun**, not Huidu | Search log #11 (nothing); F6 Xixun row — UNKNOWN / HARDWARE-DEPENDENT/UNVERIFIED |
| **(d) Huidu cloud API bridge (XiaoHui Cloud / `sdk.huidu.cn`)** | **Low today.** No public cloud API documentation; the developer platform is "not yet open" | What the cloud exposes (UNKNOWN) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Card-side | Cloud round trip, probably China-hosted (UNKNOWN) | Data leaves Australia (conflicts with TINNOX's AU compliance stance, Q9); undocumented; vendor can change it | F2 row 6, F3 rows 7–8 — UNKNOWN |

### F6. Other Chinese vendors (brief, for a vendor-neutral design)

| Vendor | Async player OS | Official integration surface | Third-party APK | Cloud | Label | Source |
|---|---|---|---|---|---|---|
| NovaStar (Taurus, VNNOX) | Android | VNNOX Open API (cloud REST, HMAC, no media upload, no AU host seen); LAN protocols reverse-engineered | Possible only through an unofficial ADB path | VNNOX / VNNOX Care | OFFICIALLY_DOCUMENTED / THIRD_PARTY | H01 (no new evidence added here) |
| **Xixun / Sysolution** (LedOK Express, LEDOK Lite, AIPS 2.0, "Y"/"C"/"M" cards) | Android | **Four documented routes:** (1) own APK replacing `xixunplayer`; (2) self-hosted **Realtime Server** (Linux/Windows; HTTP `POST /command/<controller-serial>` relayed to cards over WebSocket); (3) own WebSocket server using the AIPS 2.0 API; (4) LAN TCP push + HTTP calls. Notes: HTML pages render in the card's built-in WebView (Android version-dependent); video ≤1280×720 recommended; ADB enabled through LedOK Express advanced settings | **Yes, officially** ("uninstall controller's xixunplayer app"; add your own auto-boot) | AIPS 2.0 | THIRD_PARTY mirror of vendor Q&A (official Gitee `sysolution/xixun-test`) | https://github.com/gg146/Sysolution-xixun-test (xixun-SDK/Common Q &A regarding the customized development.md; 1.Realtime Solution/…) ; https://sj.qq.com/appdetail/uni.UNI1EB8210 |
| Colorlight (A/C series, PlayerMaster, LEDVISION) | Android (A series) | No public API. A "Colorlight C-Serial Interface Between Device and Server" v0.9 (commands, GPS reporting, scheduling) circulates on Scribd; LAN control driver for sync gear (AV-Coders) | UNKNOWN | Colorlight cloud (A200/A2K) | THIRD_PARTY | https://www.scribd.com/document/845621262/ColorlightCSerial-InterfaceBetweenDeviceAndServer ; https://github.com/AV-Coders/c-sharp-device-library |
| Linsn (LEDStudio; L2/L3 boxes) | UNKNOWN | None found. Receiving-card Ethernet protocol reverse-engineered by hobbyists | UNKNOWN | UNKNOWN | THIRD_PARTY / UNKNOWN | https://github.com/tyalie/LinsnLED-eth-protocol-docs ; https://es.made-in-china.com/category23_Electrical-Electronics/LED-Video-Processor_37.html |
| Onbon (BX-Y/BX-C) | Embedded | Native `YQNetCom.dll` SDK (seen in an integrator project next to Huidu) | n/a | UNKNOWN | THIRD_PARTY | https://github.com/MrKadyroff/tablo-poster-huidu |

---

## Analysis

1. **Huidu's estate is probably mostly async cards.** TINNOX says it uses "mainly Chinese providers, e.g. Huidu". Huidu's volume products are async HUB75 cards (C/D series) and Android A-series cards: small outdoor signs and pylons that have no PC and often no HDMI input [INFERRED from F1]. On those screens route (a) means adding hardware: a player plus a sync sender, or swapping to a dual-mode card. So TINNOX CMS cannot rely on route (a) alone if it wants to manage its existing customers.
2. **The HTTP API is good enough for a "managed playlist" product, not a full signage engine.** It supports image/video/text/clock items in zones, playback windows, a pull-based live-data feature, and autonomous offline scheduling. That covers most pylon and shopfront needs. What is missing is proof-of-play logs, HTML widgets, layered priority scheduling and TLS. TINNOX's scheduler would need to *compile* its campaign model into Huidu programs (one `replace` per change) and keep its own audit of what was sent (INFERRED).
3. **The key model shapes the commercial model, in TINNOX's favour.** Keys are issued per developer, one pair works on every card, and a card can be keyed only once. If TINNOX writes its key at the factory or at install, nobody else, including the customer and rival installers, can drive those cards through the SDK without a factory reset. That is a strong basis for the "hardware + own software + recurring revenue" plan (Q7) [INFERRED]. The same mechanism is a risk on cards someone else has already keyed.
4. **Data sovereignty favours the gateway / reverse-TCP route over Huidu's cloud.** A TINNOX-run gateway or agent in an Australian region keeps commands and media in Australia (Q9). The Huidu cloud's hosting location and terms are UNKNOWN. Cards must be set to an Australian IANA time zone; the default shown is Asia/Shanghai.
5. **Security work is needed.** Port 30080 is plain HTTP with HMAC-MD5 signing (integrity, no confidentiality). `getDeviceProperty` returns the Wi-Fi AP password. The 4G status returns IMEI/ICCID. All of this argues for keeping 30080 off the public internet: use an on-site agent, a VPN, or the card's outbound connection to a TINNOX server. Treat ICCID/IMEI as device data under TINNOX's privacy policy (INFERRED).
6. **The HDPlayer conflict is real.** Once the HTTP SDK owns a card, scheduled on/off set in HDPlayer may stop working. TINNOX must be the single owner of each card, and install crews must stop using HDPlayer schedules on CMS-managed cards.
7. **Design implication: two adapter classes.** TINNOX CMS needs (i) a **content-delivery adapter** interface with a "TINNOX player" implementation (route a) and a "Huidu program push" implementation (route b), later "Xixun APK/Realtime" and "VNNOX solution"; and (ii) a **controller-control adapter** (brightness, screen on/off, status, screenshot, schedules) with Huidu HTTP, NovaStar VNNOX/LAN and others. This matches the vendor-neutral rule already in `architecture-and-hardware.md` and adds route (b) as a first-class content path.

---

## Recommendation (PROPOSED)

- **Primary: route (a)**, TINNOX player → HDMI → Huidu sync sender (T901/T902/VP series) or a Huidu dual-mode card (H6/H8; A7/A8 once HDMI is confirmed) in sync mode. Use it for every new video wall, billboard and large pylon. Add the **Huidu HTTP API control adapter** on dual-mode cards for brightness schedules, screen on/off, status, screenshot of the LED canvas, and time-zone setting. Run it through an on-site agent or a TINNOX-hosted gateway in an Australian region.
- **Fallback: route (b)**, Huidu HTTP API program push, for existing and new **async-only** Huidu cards (C/D/A-series without HDMI, W/E text cards), where a player box is not economic. Scope the product as "playlist + zones + time windows + live data via periodic task". Proof of play is "sampled": screenshot plus status polling, clearly labelled to customers as not audited play logs.
- **Don't do yet:** route (c) (APK on a Huidu Android card): run it only as a time-boxed lab spike on one A-series "D" card after asking Huidu whether it is supported. Route (d) (Huidu cloud): only if Huidu documents an API with Australian hosting.
- **Procurement rule:** from now on, order only Huidu cards with a "D" engineering ID. TINNOX writes its own sdkKey at commissioning. Prefer dual-mode (HDMI-in) models for anything over about 1280×512.
- **Vendor neutrality:** keep the two adapter interfaces. Xixun is the easiest second vendor because it documents an APK route and a self-hostable realtime server; NovaStar is next through VNNOX.

---

## Open items

### A. Questions to identify the "one vendor API granted" (ask TINNOX)
1. What exactly was received: a 16-hex-character **sdkKey** plus a secret (Huidu); an **AppKey/AppSecret** (NovaStar VNNOX Open Platform); a Realtime Server or AIPS account (Xixun); something else? Which email domain did it come from (huidu.cn / hdwell.com, vnnox.com / novastar.tech, xixun / sysolution)?
2. Was it issued by the manufacturer or by a distributor? Is there an NDA, fee, per-device charge or expiry?
3. Did it come with a document link (e.g. `gitee.com/szhuidu/cn.huidu.device.sdk`, `developer-en.vnnox.com`) or a DLL (`HDSDK.dll`)?
4. For Huidu: which device IDs will it be used on, and do they contain **"D"**? Has the key **already been written** to any card (`:30080/login/`)? By whom?
5. Was any **gateway** software (Ubuntu/Windows) supplied, and on what port? Does it run on TINNOX infrastructure or Huidu's?
6. Is access to `sdk.huidu.cn` (or another hosted endpoint) included, and where is it hosted?
7. For NovaStar: which VNNOX region, which edition (Standard/AD/Care), and is the AppKey tied to a TINNOX sub-account?

### B. Per-site hardware facts needed (adds to the H01 questionnaire)
8. Huidu model, device ID (D or not), firmware version and HTTP API status (`GetHttpApiEnable`) for each card; whether the card is async-only, dual-mode or a sync sender.
9. Does the card have HDMI IN? Is the screen currently fed by a PC/player or by stored programs?
10. Connectivity per site: LAN, Wi-Fi AP or 4G (carrier NAT)? Can the card be pointed to an outbound server (`SetSDKTcpServer`)?
11. Who runs HDPlayer/LedArt/XiaoHui Cloud on each card today, and with which schedules?
12. Light sensor fitted? Relay used for mains switching?

### C. Evidence gaps
13. Official Huidu datasheets for A7/A8/H4K (HDMI-in, RAM, Android version) and T/VP-series control interfaces: UNKNOWN. huidu.cn and gitee.com need allow-listing.
14. Gateway service packaging and protocol: UNKNOWN.
15. Whether Huidu permits third-party APKs on A-series: UNKNOWN; ask Huidu through TINNOX.
16. Huidu Australian distribution channel: none found (search #12).
17. XiaoHui Cloud hosting region, pricing and API: UNKNOWN.

---

## Sources and search log

### Primary documents read in full (raw.githubusercontent.com)
- Official Huidu HTTP API document, Chinese and English, revision 2026-06-16 (byte mirror of Gitee `szhuidu/cn.huidu.device.sdk`): https://github.com/Turkmen87ai/huidu-sdk-gitee-mirror/blob/master/README.md and README.en.md (local copies: `../research/gh/Turkmen87ai_huidu-sdk-gitee-mirror_master_README.md`, `r1gh/mirror_README.en.md`).
- Third-party Turkish guides (key application, one-time init, ports 30080/10001, Android API on by default): https://github.com/Turkmen87ai/huidu-sdk-gitee-mirror/tree/main/docs-tr (`r1gh/docs-tr_01…`, `r1gh/docs-tr_02…`).
- Integrator notes, A3L HDPlayer protocol (TCP 10001, UDP 9527): https://github.com/MrKadyroff/tablo-poster-huidu/blob/HEAD/HUIDU_INTEGRATION.md
- Korean integrator spec (C16L, 30080, keys from Huidu support): https://github.com/nabaho/pureunall/blob/HEAD/docs/superpowers/specs/2026-10-12-signboard-design.md
- SDK 2.0 Go port (command list, SetSDKTcpServer): https://github.com/alparslanahmed/huidu-led
- HD-WF2 Python wrapper over HDSDK.dll: https://github.com/sintar777/HUIDU-HD-FW2-SDK-python
- HDPlayer Linux package: https://github.com/System233/linglong-builder (repos/com.huidu.hdplayer.linyaps/linglong.yaml)
- Xixun/Sysolution SDK Q&A and Realtime protocol: https://github.com/gg146/Sysolution-xixun-test
- Linsn protocol RE: https://github.com/tyalie/LinsnLED-eth-protocol-docs
- Placeholder org: https://github.com/huidutech/sdk

### WebSearch log (18 of 22 allowed)
1. Huidu HD-A3…A7 Android specs HDMI pixels → toolboom A-series titles, A3 5 V.
2. Huidu HDPlayer HD2020 HDSet LEDArt cloud → HDPlayer/HDSet, LedArt, XiaoHui Cloud.
3. Huidu sync sending card VP series T901 T902 → T901 limits, VP410 3-in-1, T902X1/X2.
4. Huidu A7 A8 A6L Android 11 dual mode → no relevant results.
5. "XiaoHui Cloud" Huidu → cluster management, update methods.
6. HDPlayer2 / HD2020 → nothing Huidu-specific.
7. HD-A3L Android RAM storage → A3L 16 GB, max 4096×2048; A4L "Android platform".
8. "LedOK Express" → LEDOK Lite = Shanghai Xixun.
9. Colorlight cloud API → C-Serial device-server doc on Scribd; no official portal.
10. Linsn async Android cloud → nothing.
11. Huidu Android third-party APK → nothing (LedArt lite APK only).
12. Huidu distributor Australia → none found.
13. Huidu W62 U62 E63 → W = Wi-Fi, U = USB, E = Ethernet; HUB12/HUB08.
14. Huidu H4K H8 HDMI → H8 Android 11, HDMI IN/LOOP/ASYNC; H6 port roles, decode.
15. 灰度科技 小灰云 开放接口 → 屏掌控 app only.
16. Huidu B6 B8L C16L C36 → C16C 204,800 px, "HD Cloud Platform"; D16 4 GB.
17. Linsn EX902 LedSync LEDStudio → Linsn L2/L3 boxes only.
18. Huidu A7/A8 HDMI 4K → "dual-mode intelligent 4K controllers" marketing copy; HDMI unconfirmed.

### GitHub API (search endpoints; repo-tree API is blocked in this session)
- `search/repositories q=huidu` (102 results; relevant ones listed above); `q=user:huidutech`.
- `search/code`: `sdk.huidu.cn` (0), `30080 huidu`, `getDeviceProperty luminance`, `huidu gateway`, `HDPlayer huidu`, `hdsdk huidu`, `colorlight api player`, `linsn led protocol`, `xixun led sdk`, `huidu A3L`.

### WebFetch
- toolboom.com: `ENOTFOUND` (blocked; one attempt).

---

## Verification (adversarial pass)

Date: 2026-11-03. Method: I re-read the local byte-mirror of the official Huidu HTTP API document (`r1gh/mirror_README.en.md`, 57.5 KB) line by line against each claim, re-read the third-party files that are cited (`r1gh/docs-tr_01/02`, `kadyroff_integration.md`, `nabaho_spec.md`, `xixun_qa.md`, `xixun_protocols.md`, `linglong.yaml`, `huidutech_sdk_README.md`, `../research/gh/alparslanahmed_huidu-led_main_README.md`), and ran 5 WebSearch calls for independent checks. huidu.cn, gitee.com and toolboom.com are still blocked, so I could not re-fetch them. The file has **no prices, cost tables or arithmetic**, so there is nothing to check on currency or sums.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | HTTP API on card TCP 30080 at `/api/{device,program,file,screenshot}/` | confirmed | Official doc: every interface URL is `http://192.168.90.153:30080/api/...` (§3.1–3.4) |
| 2 | Signing: `sign = HMACMD5(body+sdkKey+date, sdkSecret)`; file calls `HMACMD5(sdkKey+date, sdkSecret)`; keys never sent | confirmed | Official doc §2.4 (lines 137–155) |
| 3 | Document revision 2026-06-16 | confirmed | Change log row "2026/06/16 tanglin 3.2.1 Playback Controls / 3.1.13 On-demand" |
| 4 | Keys are issued by hand by Huidu support; "platform is not yet open" | confirmed | Official doc §2.3; the Korean integrator spec agrees (`nabaho_spec.md` l.144) |
| 5 | sdkKey is 16 hex characters | confirmed | Official sample `sdkKey=a7fa6795aaa891e2` (16 hex) in the §3.3 file URL |
| 6 | Key can be written only once | confirmed | Official doc §2.4: "once initialized, it cannot be initialized again. Only one addition is permitted" |
| 7 | …"unless factory-reset" labelled OFFICIALLY_DOCUMENTED | **corrected** | The official doc does not mention a reset. Only the Turkish guide does (`docs-tr_01` l.161, 217, 337). Relabelled THIRD_PARTY inline |
| 8 | Only "D" engineering cards support secondary development (e.g. C16L-D00-A000F) | confirmed | Official doc §2.1 |
| 9 | Official model lists: Linux = C16L, C08L, D16, D36…; Android = A3L, A4L, A5L, A6L, H4K, H8, B8L, A7, A8 | confirmed | Change log 2025/08/05 |
| 10 | F1 row 9 labels C16C, C35C, C10C, D15, D18 as on the official Linux list | **corrected** | Those models are not named in the official list (it ends in "…"). Relabelled inline |
| 11 | Android series: HTTP API on by default on new firmware | confirmed (THIRD_PARTY, as labelled) | `docs-tr_02` l.150; the official doc says only "upgrade to the latest firmware and skip this step" |
| 12 | `GetHttpApiEnable/SetHttpApiEnable` is "Linux series only" (VERIFIED) | **corrected** | That is inferred from the Android skip note, not stated. Relabelled INFERRED inline |
| 13 | Enabling the HTTP SDK can stop HDPlayer schedules from working | confirmed | Official doc §2.2 note (l.77–78) |
| 14 | Two access flows: via a "gateway service (Ubuntu/Windows)" and direct | confirmed | Official doc §1.2. Gateway port, packaging and licence are still UNKNOWN |
| 15 | `Host: sdk.huidu.cn` in the signed-request sample | confirmed | Official doc l.174. Scope is still UNKNOWN; the reading as a "cloud API" comes only from `docs-tr_01` l.349 |
| 16 | Endpoint inventory (properties, status, scheduled tasks for screen/volume/luminance/relay, periodic task 3–3600 s, pushStatus, reboot, screen on/off, demandProgram, program append/remove/update/replace/getAll, file, screenshot GET) | confirmed | Official doc §3.1.1–3.4 headings; interval "Int [3 – 3600 seconds] Default: 30" (l.713); screenshot "Request method: GET" |
| 17 | Image/video `file` may be a file name on the card or a valid URL, plus `fileMd5`; no re-download if already present | confirmed | Official doc l.1495–1497, 1574–1576 |
| 18 | No play-log / proof-of-play endpoint and no HTML/web widget | confirmed (absence) | No such section in the §3 table of contents; item types are text, picture, video, digital clock, analog clock, dynamic area |
| 19 | `getDeviceProperty` returns the Wi-Fi AP password in clear text; default time zone Asia/Shanghai | confirmed (+ detail added) | Official sample: `"wifi.ap.passwd": "[sample default redacted]"` and `"time.timeZone": "Asia/Shanghai;UTC+08:00..."`. `getDeviceStatus` also returns `wifi.ap.passwd`, and `gsm.imei`/`gsm.iccid`. Added inline |
| 20 | Route (c): localhost `127.0.0.1:30080` "documented as allowed" | **corrected** | The official doc says only "No id specified: /api/device/ indicates operating the local device". The `127.0.0.1` address is from `docs-tr_01` l.40/349. Fixed inline |
| 21 | One key pair covers all of a developer's devices | confirmed (THIRD_PARTY, as labelled) | `docs-tr_01` l.331–333 |
| 22 | SDK 2.0: TCP 10001, version handshake 0x2001, `Get/SetSDKTcpServer`, `GetCurrentPlayProgramGUID` | confirmed (THIRD_PARTY) | `alparslanahmed_huidu-led` README l.690–783. Whether `SetSDKTcpServer` really makes the card dial out to a TINNOX server, through carrier NAT, is **not shown in practice**; the README lists it only as "TCP server config". Treat it as HARDWARE-DEPENDENT/UNVERIFIED until a lab test |
| 23 | A3L HDPlayer protocol: TCP 10001, UDP 9527 discovery, AP-mode IP 192.168.43.1, MD5 partial upload | confirmed (THIRD_PARTY) | `kadyroff_integration.md` l.39–75 |
| 24 | HD-H8: Android 11, HDMI IN / HDMI LOOP / ASYNC button, 4K | confirmed (THIRD_PARTY) | WebSearch: Tokopedia listing https://www.tokopedia.com/mms-surabaya/video-processor-huidu-hd-h8 . The H6 listing (https://www.tokopedia.com/mms-surabaya/video-processor-huidu-hd-h6) also gives Android 11 and HDMI IN/LOOP/OUT, which backs the H6 row |
| 25 | HD-A7/A8 HDMI input | unverifiable (unchanged) | WebSearch found only the "dual-mode 4K" marketing copy (https://es.made-in-china.com/category23_Electrical-Electronics/LED-Video-Processor_34.html); no datasheet. It stays UNVERIFIED, as the file already says |
| 26 | HD-T901: 1280×1024, widest 3840, highest 2048 | confirmed (THIRD_PARTY) | WebSearch, same retailer: https://toolboom.com/en/huidu-hd-t901-controller-1280-1024-widest-3840-highest-2048-synchronous/ ("≈1.3 M pixels"); no official datasheet |
| 27 | HD-A3L: 16 GB, max 4096 wide / 2048 high | unverifiable | WebSearch found no A3L listing with these figures. The sibling A5L lists 1280×1024, max 3840 × 2048 and 16 GB (https://toolboom.com/en/huidu-hd-a5l-led-display-module-controller-1280-1024/). Keep it HARDWARE-DEPENDENT/UNVERIFIED |
| 28 | No Huidu Australian distributor found | confirmed (absence) | WebSearch "Huidu LED controller distributor Australia" returned only Indian, Chinese and EU marketplace sellers |
| 29 | Xixun documents an own-APK route (uninstall `xixunplayer`) and a Realtime Server with `POST /command/<serial>` over WebSocket | confirmed (THIRD_PARTY mirror) | `xixun_qa.md` l.5–7; `xixun_protocols.md` l.7, 19. The video ≤1280×720 guidance and network ADB toggle are also confirmed (l.24, 41–45) |
| 30 | HDPlayer Linux .deb v1.0.15.0 in the UnionTech store | confirmed | `linglong.yaml` l.5–13 |
| 31 | `huidutech/sdk` is a 2017 placeholder | confirmed (content) | README is "深圳市灰度科技SDK代码仓库 / 测试提交". The year was not re-checked |

**Tally:** 31 claims checked; 22 confirmed as stated, 2 confirmed with added detail (#19, #24), 5 corrected (#7, #10, #12, #20 inline; #22 caveat added here), 0 refuted, 3 unverifiable (#25, #27, and the scope of #15).

### Does the recommendation still hold?

**Yes, with two sharper caveats.**
- The core premises survive: an official, signed LAN HTTP API on D cards; keys issued by hand and written once; no play log or HTML item; an HDPlayer conflict; gateway as an official flow; no public cloud API; and HDMI-in on the H-series dual-mode players. Every correction above is about labels or provenance, not facts that change the route ranking.
- **Caveat 1, reverse connection.** The "TINNOX-hosted gateway / reverse TCP for 4G cards" leg rests on third-party evidence only: the gateway is shown as a diagram, and `SetSDKTcpServer` is a name in a reverse-engineered command list. Until a lab test on one D card shows a card dialling out to a server, plan 4G sites with an on-site agent or VPN router as the baseline. The Huidu gateway and SDK 2.0 reverse connection should be treated as an optimisation still to be proven.
- **Caveat 2, key lock-in.** The factory-reset escape is third-party only. That cuts both ways. It may be weaker protection for TINNOX than Analysis §3 implies, since a customer could reset the card. It may also be a harder lock-out on cards already keyed by someone else. In either case the commissioning rule (TINNOX writes its key, records it per card, and keeps the secret in a vault) stands.
- **Added security point:** the official sample AP password `[sample default redacted]` looks like a factory default. Commissioning should change the AP password or disable the AP, and should also set an Australian IANA time zone.
