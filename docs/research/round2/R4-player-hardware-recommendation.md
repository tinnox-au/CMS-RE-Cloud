# R4: Player hardware strategy for TINNOX (Q10)

Date: 2026-11-03. Round-2 research agent. This answers TINNOX's Q10: "not sure about this, can you recommend for us". It builds on H02 (`../research/H02-player-hardware-options.md`), `docs/architecture-and-hardware.md` §6 and R1 (`R1-huidu-integration.md`). New evidence is added only where H02 had gaps: thermal ratings, AUD prices, supply life, RTC and watchdog, Android patch policy, and the Huidu dependency.

Labels follow CONTEXT.md: VERIFIED_FULL_PAGE, OFFICIALLY_DOCUMENTED, THIRD_PARTY, INFERRED, UNKNOWN, HARDWARE-DEPENDENT/UNVERIFIED, PROPOSED. Prices are shown in the currency of the source, with the source date where one was visible. No AUD conversion has been made, because no exchange rate was fetched in this session.

---

## Summary

1. **The answer depends first on which Huidu cards TINNOX ships, not on Pi versus Android.** Huidu's async HUB75 cards (C/D series, and A-series cards without HDMI IN) cannot take an external player unless a sync sender is added. On those cards the controller *is* the player, and TINNOX CMS drives it through the Huidu HTTP API (R1 route b). An external box only fits where the sign has, or is given, an HDMI-capable Huidu device: an HD-T901/T902 sender, an HD-VP processor, or a dual-mode H6/H8 (R1 F1) [THIRD_PARTY; INFERRED].
2. **PROPOSED platform split: three player types, in this order.** (A) Huidu controller-as-player for small async signs. (B) A TINNOX Linux image on Raspberry Pi Compute Module 5 (eMMC) for HDMI-fed LED walls and large pylons or billboards. (C) A TINNOX Android app as device owner on a Rockchip RK3588/RK3576 box for LCD kiosks, especially touch and 4K portrait. x86 is deferred.
3. **CM5 is the better Pi for TINNOX, not the Pi 5 board.** CM5 has 16, 32 or 64 GB soldered eMMC, so there is no SD-card wear [VERIFIED_FULL_PAGE, Pi docs]. The module is rated −20 to +85 °C [OFFICIALLY_DOCUMENTED, product brief via search]. The official CM5 product brief (July 2026 edition, read via search summary) says it stays in production until at least January 2036 [OFFICIALLY_DOCUMENTED; label raised in verification]. The CM5 8 GB/16 GB eMMC is AUD 209.95 inc GST at Core Electronics, against AUD 285.65 for a bare Pi 5 8 GB board [THIRD_PARTY, retailer; date not shown].
4. **Use industrial CM5 boxes outdoors, not hobby cases.** The EDATEC ED-IPC3630 (CM5, fanless metal enclosure, 9–36 V input) is rated −25 to +60 °C [OFFICIALLY_DOCUMENTED datasheet via Mouser]. Consumer-class players are rated much lower: Giada DN84 (RK3576) 0–60 °C (at 0.7 m/s airflow [corrected in verification]), MINIX N100 0–50 °C, and the Giada DN25 (CM5) about 0–45 °C [THIRD_PARTY].
5. **Australian outdoor heat sets the design limit.** Ambient air reaches 45 °C or more, and solar load comes on top of that [THIRD_PARTY]. Passive heat exchangers can stop removing heat during heatwaves [THIRD_PARTY]. AU cabinet air-conditioners are sold for ambients up to 55 °C [THIRD_PARTY]. INFERRED rule: no player is rated for an unconditioned, sun-loaded cabinet in an Australian summer. Mount it in the cooled controller compartment, require a 60 °C operating rating, and log its temperature.
6. **The Pi 5 SoC throttles at 80 °C and throttles harder at 85 °C** [OFFICIALLY_DOCUMENTED, Raspberry Pi news]. A fanless CM5 therefore needs a carrier whose heat path is designed for it. Revolution Pi needed thermal simulation to keep a CM5 under 85 °C under load [OFFICIALLY_DOCUMENTED, Raspberry Pi news].
7. **Pi 5 and CM5 have an on-board RTC with an optional rechargeable backup cell. Battery charging is off by default** (`dtparam=rtc_bbat_vchg`) [VERIFIED_FULL_PAGE, Pi docs; CM5 RTC INFERRED from the shared PMIC design]. The PMIC records watchdog resets [VERIFIED_FULL_PAGE]. RK3588 signage boxes such as the Geniatech APC3588Q (price on enquiry only; USD 299 not found, the non-Q APC3588 shop listing is USD 269–359 with Android 12 [corrected in verification]; Android 14 per Geniatech's launch post) and the Rikomagic DS08 advertise a hardware watchdog and RTC [OFFICIALLY_DOCUMENTED / THIRD_PARTY].
8. **Android's weak point is security patching.** No Rockchip or box-vendor patch or OTA policy was found. Android 14 board support packages (BSPs) for RK3588 exist on kernel 6.1 (Advantech, FriendlyELEC), while some boards stay on Android 12 (Radxa ROCK 5T) [OFFICIALLY_DOCUMENTED vendor wikis]. TINNOX must get a written patch commitment from the box supplier before buying in volume [INFERRED].
9. **Pi's weak point is TINNOX's own engineering effort.** TINNOX would own the OS image, A/B updates with rollback (RAUC), signing, kiosk session and Debian security updates. That is roughly 6–10 engineer-weeks to production quality, plus ongoing upkeep [INFERRED]. Android needs an APK plus a small device-policy controller (DPC), about 3–5 weeks, but OS patches depend on the box vendor [INFERRED].
10. **Installer preference was not evidenced.** No installer forum data was found. INFERRED from the market: LED installers default to an async controller with no PC outdoors, because there is one less box to fail or overheat. A TINNOX external player has to earn its place with features, and on small signs it will not.
11. **Defer:** x86 N100 (no wide-temperature unit found in AU; AUD 322–354 inc GST for a 0–50 °C MINIX, depending on capture date, out of stock when checked [corrected in verification]), BrightSign, SoC displays, a TINNOX APK on Huidu A-series cards (lab spike only), NovaStar Taurus, a custom carrier board, Yocto, and paid fleet tools.
12. **Next step:** get the per-site Huidu model list (questionnaire item 1 and R1 §A). Then run three pilots: CM5 box → Huidu sender on one indoor wall; CM5 box in one outdoor pylon cabinet with temperature logging through Jan–Feb 2027; RK3588 Android box in one LCD kiosk. In parallel, run the Huidu HTTP API on one async "D" card.

---

## Findings

### F1. Platform comparison (numbers where found)

| # | Attribute | (1) Own image on CM5 / Pi 5 | (2) Android RK3588/RK3576 box | (3) x86 N100/N150 Linux | (4) Huidu / NovaStar controller as player |
|---|---|---|---|---|---|
| 1 | Unit price | CM5 8 GB/16 GB eMMC **AUD 209.95** inc GST; CM5 2 GB Lite AUD 95.05 (special 66.54); Pi 5 8 GB board **AUD 285.65** inc GST (Core Electronics) [THIRD_PARTY]. Industrial carrier/box price UNKNOWN (EDATEC/Waveshare sell without prices in results) | Geniatech APC3588Q **price on enquiry**; non-Q APC3588 USD 269–359 (Android 12) [OFFICIALLY_DOCUMENTED shop; corrected in verification]; DSDevices DSDA1 USD 345, DSDX5 USD 149 [THIRD_PARTY, H01]; Qbic BXP-300 sold in AU, price not captured (H02) | MINIX NEO Z100-0dB N100 8/256 **AUD 322.08–354.29** inc GST (PB Tech AU, figures vary by capture date; out of stock) [THIRD_PARTY; corrected in verification] | No extra box. Card prices UNKNOWN in this session (retailer sites blocked) |
| 2 | Availability in AU | Core Electronics stocks CM5. Some variants need a minimum order of 25 units and longer lead time [THIRD_PARTY] | Qbic via PB Tech AU / Area9 (H02); Giada/Geniatech via import or distributor (UNKNOWN AU stock) | PB Tech AU (consumer grade) | Through TINNOX's existing Huidu supply chain [INFERRED] |
| 3 | Operating temperature | CM5 module −20 to +85 °C [OFFICIALLY_DOCUMENTED]; EDATEC ED-IPC3630 box **−25 to +60 °C**; ED-HMI3630 −20 to +60 °C (13.3" variant possibly −20 to +50 °C, conflict) [OFFICIALLY_DOCUMENTED datasheet / THIRD_PARTY]; Giada DN25 ≈0–45 °C [THIRD_PARTY, H02]; Pi 5 board: no official ambient figure found (UNKNOWN) | Giada DN84 (RK3576) **0–60 °C at 0.7 m/s airflow** [THIRD_PARTY; airflow condition added in verification]; Giada AR707 (RK3588J) **−20 to +70 °C** industrial PC [THIRD_PARTY]; RK3588J silicon −40 to +85 °C (upper limit disputed, 80 vs 85) [THIRD_PARTY, kernel list]; APC3588Q temperature UNKNOWN (non-Q APC3588 CN spec: −20 to 60 °C ambient) [corrected in verification] | MINIX N100 **0–50 °C** operating [THIRD_PARTY]; Indian industrial N100 claims "extended" with no figure (UNKNOWN) | Huidu HD-A6L listed **−40 to +80 °C** by a retailer. This is probably a listing error [THIRD_PARTY, doubtful]. Other models UNKNOWN |
| 4 | Fanless | Yes on industrial carriers (EDATEC, Chipsee, Waveshare metal cases) [THIRD_PARTY]; Pi 5 board needs a heatsink or fan under sustained load (H02, Pi news) | Most signage boxes fanless (INFERRED); per SKU | MINIX Z100-0dB fanless [THIRD_PARTY] | Yes (cards) [INFERRED] |
| 5 | Decode | Hardware HEVC 4K60 only; H.264 decoded in software [THIRD_PARTY, H02] | Rockchip MPP H.264/HEVC 4K–8K; APC3588Q "8K video", 4 HDMI outputs [OFFICIALLY_DOCUMENTED shop]; DSDA1 8K AV1 claimed [THIRD_PARTY] | Intel Quick Sync H.264/HEVC (INFERRED); Chromium hardware decode is feature-flagged on Linux [OFFICIALLY_DOCUMENTED, H02] | H6: 2×4K / 6×1080p decode [THIRD_PARTY, R1]; small C/D cards: low (UNKNOWN) |
| 6 | Storage | CM5 eMMC 16/32/64 GB, or Lite + SD [VERIFIED_FULL_PAGE]; Pi 5 = SD or NVMe HAT | eMMC (typical 32–128 GB) [THIRD_PARTY, H02] | NVMe/SATA SSD [THIRD_PARTY] | Internal flash (A3L/A4L 16 GB; D16 4 GB) [THIRD_PARTY, R1] |
| 7 | RTC | On-board RTC; rechargeable Li-Mn backup cell on J5; charging **off by default** [VERIFIED_FULL_PAGE, Pi rtc.adoc]. CM5 equivalent INFERRED | APC3588Q: RTC + hardware watchdog [OFFICIALLY_DOCUMENTED]; Rikomagic DS08 RK3588: RTC + watchdog [THIRD_PARTY] | Standard PC CMOS RTC [INFERRED] | Clock is part of the card (time zone settable via HTTP API) [OFFICIALLY_DOCUMENTED, R1] |
| 8 | Watchdog | PMIC `reset_event` reports watchdog resets [VERIFIED_FULL_PAGE, Pi power-supplies.adoc]; systemd `RuntimeWatchdogSec` use INFERRED | Per SKU (above); Android `DISALLOW_SYSTEM_ERROR_DIALOGS` suppresses crash dialogs and **force-stops** the crashed app; it does not restart it, so the TINNOX APK needs its own relaunch (HOME/lock-task launcher or alarm watchdog) [VERIFIED_FULL_PAGE, AOSP UserManager.java; corrected in verification] | Intel TCO/iTCO watchdog [INFERRED] | UNKNOWN |
| 9 | Remote management | Own agent + WireGuard; RAUC/Mender (H02) | Device owner + own DPC or MDM USD 2–6/device/month (H02) | Same as (1) | Huidu HTTP API :30080 / SDK 2.0 reverse TCP, gateway; keys written once per card [OFFICIALLY_DOCUMENTED, R1] |
| 10 | Update and rollback | RAUC A/B, signed bundles, automatic fallback (LGPL) [OFFICIALLY_DOCUMENTED, H02]; Bootlin has done it on Pi 5 [THIRD_PARTY] | App: PackageInstaller silent install as device owner [OFFICIALLY_DOCUMENTED]. OS: vendor OTA only; A/B (seamless) OTA depends on BSP (UNKNOWN per SKU) | RAUC supports EFI/GRUB [OFFICIALLY_DOCUMENTED] | Firmware via HDPlayer (vendor) [THIRD_PARTY, R1]; no rollback evidence (UNKNOWN) |
| 11 | OS version and security patches | Raspberry Pi OS (Debian) security updates; TINNOX controls when they ship [INFERRED] | Android 14 BSP on kernel 6.1.75 (Advantech ROM-6881, ASR-A501) [OFFICIALLY_DOCUMENTED]; Radxa ROCK 5T Android 12 [OFFICIALLY_DOCUMENTED]; **no box-vendor patch policy found (UNKNOWN)** | Debian/Ubuntu LTS [INFERRED] | Huidu firmware (H8 = Android 11) [THIRD_PARTY]; patch policy UNKNOWN |
| 12 | Supply longevity | CM5 "in production until at least January 2036" [THIRD_PARTY copy of official statement]; CM3 EoL 16 Oct 2025, with a formal notice [VERIFIED_FULL_PAGE] | No Rockchip longevity statement found (UNKNOWN); industrial "J" parts exist [THIRD_PARTY] | Intel N-series embedded roadmap not checked (UNKNOWN) | Huidu model churn high (A5→A5L etc.) [THIRD_PARTY, R1] |
| 13 | TINNOX effort | **High**: image build, RAUC, signing, kiosk, mpv/Chromium, patch pipeline ≈ 6–10 engineer-weeks + upkeep [INFERRED] | **Medium**: APK (Media3 + WebView) + DPC + provisioning ≈ 3–5 weeks; per-SKU QA [INFERRED] | Medium–high (as 1, plus driver variance) [INFERRED] | **Low–medium**: HTTP API adapter; product limited to Huidu's programme model; weak proof of play [OFFICIALLY_DOCUMENTED, R1] |
| 14 | Lock-in | None | Low (AOSP APIs); box firmware for OS | None (Linux) | High (Huidu) |

Sources for F1 are listed by number in "Sources".

### F2. Thermal evidence for Australian outdoor enclosures

| # | Finding | Label | Source |
|---|---|---|---|
| 1 | Pi boards throttle at 80 °C SoC and throttle further at 85 °C | OFFICIALLY_DOCUMENTED | https://www.raspberrypi.com/news/heating-and-cooling-raspberry-pi-5/ |
| 2 | Keeping a CM5 below 85 °C under heavy load needed thermal simulation (Revolution Pi) | OFFICIALLY_DOCUMENTED (Pi news) | https://www.raspberrypi.com/news/powering-industrial-innovation-compute-module-5-meets-revolution-pi/ |
| 3 | The official Active Cooler keeps the SoC 20–25 °C under the throttle point at 22 °C ambient (fan, so not usable sealed outdoors) | THIRD_PARTY | https://pidiylab.com/raspberry-pi-5-cooling-guide-fan-curves-cases-testing/ |
| 4 | AU outdoor sites see 45 °C+ summers, direct sun, UV and salt air | THIRD_PARTY | https://kickstartcomputers.com.au/outdoor-digital-signage |
| 5 | Heat is the main cause of outdoor display failure; cooling must be rated for ambient plus solar load | THIRD_PARTY | https://www.digitalsignagetoday.com/blogs/sourcing-outdoor-lcd-displays-for-australia-and-new-zealand-what-to-specify-before-you-buy/ |
| 6 | Most AU outdoor screen failures are decided at the specification stage | THIRD_PARTY | https://www.retailcustomerexperience.com/blogs/outdoor-display-failures-start-at-the-spec-sheet/ |
| 7 | Air-conditioning is the most effective cooling; passive heat exchangers can stop working in heatwaves | THIRD_PARTY | https://risevision.com/blog/how-to-keep-outdoor-digital-signage-cool |
| 8 | A passive enclosure claim tops out at −20 to +40 °C internal without AC, which is below the AU 45 °C design point | THIRD_PARTY (vendor) | https://www.digitalsignagetoday.com/news/premier-mounts-launches-the-habitat-for-outdoor-digital-signage/ |
| 9 | Dark colours, glass, heat-storing materials and more sun-exposed sides increase heat build-up | THIRD_PARTY (Gore) | https://www.gore.com/system/files/2021-03/GORE_what_is_driving_heat_emission_infographic.pdf |
| 10 | AU cabinet air-conditioners are marketed for ambients up to 55 °C | THIRD_PARTY | https://electricalconnection.com.au/?p=29674 ; https://nhp.com.au/products/industrial-control-and-automation/climate-control/air-conditioners |
| 11 | Remote-monitored enclosure AC can alert on internal temperature rise | THIRD_PARTY | https://fugo.ai/wiki/outdoor-display-enclosures |
| 12 | Rockchip advises "normal mode" (no overdrive) for industrial environments; overdrive shortens life at high temperature | THIRD_PARTY (kernel list quoting datasheet) | https://lists.infradead.org/pipermail/linux-rockchip/2025-March/057067.html |

### F3. Huidu dependency (from R1, restated for the hardware decision)

| # | Huidu device class | Can an external TINNOX player feed it? | Player choice that follows | Label | Source |
|---|---|---|---|---|---|
| 1 | HD-T901/T902 sync sending boxes | Yes, DVI/HDMI in (model-dependent); T901 1280×1024, widest 3840, highest 2048 | External box (CM5 or Android) | THIRD_PARTY | https://toolboom.com/en/huidu-hd-t901-controller-1280-1024-widest-3840-highest-2048-synchronous/ |
| 2 | HD-VP210/410/620/820 video processor + sender | Yes, HDMI-A / DVI / VGA in; VP620 3.9 Mpx, VP820 5.2 Mpx (as listed) | External box | THIRD_PARTY | https://toolboom.com/en/huidu-hd-vp620-dvi-hdmi-vga-video-processor-for-led-screens/ ; https://www.scribd.com/document/740598595/HUIDU-Technology |
| 3 | HD-H6 / H8 dual-mode Android players | Yes: HDMI IN (sync), LOOP, ASYNC switch; H8 Android 11 | External box in sync mode, or the card's own async mode as fallback | THIRD_PARTY | https://www.tokopedia.com/mms-surabaya/video-processor-huidu-hd-h6 ; R1 F1 rows 4–5 |
| 4 | HD-A3L…A6L, A601/A602 Android async cards | HDMI IN not evidenced; A4L described as "sync-async with HDMI" by one retailer (conflict) | Controller as player (Huidu HTTP API), unless HDMI IN is confirmed on the actual unit | THIRD_PARTY; HARDWARE-DEPENDENT/UNVERIFIED | https://toolboom.com/en/huidu-hd-a6l-led-display-module-controller-2560x1024/ ; https://bigl.ua/p2703633414-kontroller-dlya-led |
| 5 | HD-A7/A8 "dual-mode 4K" | HDMI IN UNVERIFIED | Confirm on the unit; then as row 3 | THIRD_PARTY | R1 F1 row 7 |
| 6 | HD-C/D series (ARM Linux, HUB75) and W/U/E text cards | No HDMI | Controller as player only | OFFICIALLY_DOCUMENTED (Linux list) / THIRD_PARTY | R1 F1 rows 9–10 |
| 7 | Third-party APK on Huidu Android cards | Not documented by Huidu | Lab spike only | UNKNOWN | R1 §Recommendation |

---

## Analysis

**1. Which signs need which kind of player.** TINNOX sells into four kinds of sign. Each one has a different "natural" player:

| Product line | Typical controller (INFERRED from Huidu product mix) | Content needs | Thermal environment | Natural player |
|---|---|---|---|---|
| Indoor LED wall | Sync sender / video processor (T901, VP series) or H6/H8 | Video, layouts, live data; ≥1080p canvas | Indoor, 20–35 °C | External box (CM5 or Android) |
| Large outdoor pylon / billboard (≥ ~1280×512) | VP series, H6/H8, or A6L/A7/A8 | Ads, dayparting, proof of play | Sun-loaded cabinet, 45 °C+ ambient | External industrial box *if* HDMI-capable; else controller |
| Small outdoor pylon / shop sign | C/D or A3L/A4L async card, HUB75 | Few images or videos, text, clock | Same as above, minimal space | Controller as player |
| Indoor/outdoor LCD kiosk | No LED controller; HDMI display, often touch, portrait | 4K portrait, touch, web | Indoor; outdoor kiosks usually have built-in AC | Android box (or the display's own SoC later) |

**2. Why CM5 rather than Pi 5 for the Linux line.** The Pi 5 and CM5 share the same silicon and the same software. The CM5 adds three things that matter for installed signage:

- soldered eMMC instead of an SD card [VERIFIED_FULL_PAGE];
- a documented −20 to +85 °C module rating, together with industrial carriers rated −25 to +60 °C [OFFICIALLY_DOCUMENTED];
- a stated production life to January 2036 [THIRD_PARTY].

It is also cheaper as a module: AUD 209.95 for 8 GB with 16 GB eMMC, against AUD 285.65 for a bare Pi 5 8 GB board at the same retailer [THIRD_PARTY]. The board price looks inflated against PB Tech's figures, so treat the gap as indicative. An industrial carrier adds an unknown amount, estimated at AUD 150–400 [INFERRED, no price found]. That puts the installed CM5 player at roughly AUD 360–610 (209.95 + 150–400) [corrected in verification; was 400–650], before PSU, cabling and the 32 GB eMMC uplift used in the pilot. A USD 270–360 RK3588 box lands in a similar range after freight and GST, but no exchange rate was fetched, so this comparison is indicative only. **Unit price does not decide this; engineering effort and patching do.**

**3. Android versus own Linux image: who carries the security risk.**

- *Own CM5 image:* TINNOX controls the whole OS. It can push Debian security fixes through RAUC A/B with automatic rollback, which gives the strongest story for "strictly follow AU compliance for data and security" (Q9). The cost is that TINNOX engineers own it for the life of every screen [INFERRED].
- *Android box:* the app layer is easy. Silent updates and kiosk lockdown are standard Android APIs [OFFICIALLY_DOCUMENTED]. But TINNOX cannot patch the OS itself. No Rockchip box vendor in the results publishes a patch cadence [UNKNOWN], and some RK3588 boards still ship Android 12 [OFFICIALLY_DOCUMENTED, Radxa]. For a security-conscious AU seller, the box supplier must sign a written patch-level and end-of-support commitment, or the box may only be used on isolated networks [INFERRED].
- *Controller as player:* Huidu firmware is a closed box. Patching is Huidu's job, and the attack surface is the HTTP API on :30080. Keep it on a private LAN/4G APN or behind the reverse-TCP route to a TINNOX server in Australia [R1; INFERRED].

**4. Thermal design rules for Australian outdoor sites (INFERRED from F2).**

- Size for **45 °C ambient plus full solar load**. Without active cooling, the inside of a sun-loaded dark cabinet is expected to run well above ambient. INFERRED working figure: +15 to +25 °C, to be measured in the pilot.
- **No player in F1 survives that unconditioned.** The best rating found for a fanless player is 60 °C (EDATEC CM5, Giada DN84), or 70 °C for an RK3588J industrial PC. The player must sit in the controller and PSU compartment that the cabinet already cools, with fans plus a thermostat or AC rated to 55 °C ambient.
- **Specify an operating rating of ≥ 60 °C for any outdoor player**, and choose a light-coloured, shaded mounting position away from LED module backs and PSUs.
- **Derate:** run the CM5 at stock clocks with no overclock (the same applies to Rockchip "normal mode"). Leave thermal headroom by decoding HEVC in hardware, not H.264 in software, since software decode is the main CPU load on Pi 5 [INFERRED from H02].
- **Telemetry is mandatory:** the player reports SoC temperature, throttling flags and uptime to the CMS, with an alert threshold of about 75 °C. This is also the evidence for a warranty claim.
- **The fewer boxes in the cabinet, the better.** This is why controller-as-player is the right default for small signs, and why installers lean that way [INFERRED].

**5. What depends on the Huidu models TINNOX ships (explicit).**

| If TINNOX's signs mostly use… | Then the outdoor pylon / billboard pilot is… |
|---|---|
| C/D series or A3L/A4L (HUB75, no HDMI) | **Controller as player** via Huidu HTTP API on "D" engineering cards. No CM5 outdoors in release 1. An external player is possible only by adding a T901/VP sender, which adds cost and heat. |
| A6L/A7/A8 with HDMI IN confirmed | CM5 industrial box → HDMI into the card in sync mode, plus the HTTP API for brightness and power. Fall back to async mode if the player fails (INFERRED; test the failover). |
| VP series / T901 / H6 / H8 | CM5 industrial box → HDMI. The Huidu controller is only a pixel pipe; control through the HTTP API where a "D" card is present. |
| Mixed estate | Both routes. The CMS hides the difference behind a "player type" field (TINNOX CMS player vs Huidu device). This is the likely case [INFERRED]. |

**6. The likely "DsDevice" (DSDevices).** DSDevices boxes are Android signage players built for Xibo [THIRD_PARTY, H01]. If TINNOX already holds some, test one as the Android candidate (it is the same route C as the Rockchip boxes). The device-owner path is UNVERIFIED on DSDevices firmware.

---

## Recommendation (PROPOSED)

### Order of preference (platforms)
1. **Controller as player (Huidu HTTP API)** for small async signs. It is the lowest effort, adds no hardware, and it is what installers already deploy.
2. **TINNOX Linux image on CM5 (eMMC) on an industrial fanless carrier** for every HDMI-fed LED wall and large LED pylon or billboard.
3. **TINNOX Android app as device owner on an RK3588/RK3576 box** for LCD kiosks. It is also the fallback for LED walls if CM5 work slips.
4. x86 N100 Linux: deferred.

### Pilot combination per product line

| Product line | Pilot (one site each) | Why | Pass criteria |
|---|---|---|---|
| **Indoor LED wall** | CM5 8 GB / 32 GB eMMC on an EDATEC ED-IPC3630-class (or Waveshare CM5 box) carrier → HDMI → Huidu VP-series or T901 sender (or H6/H8 in sync mode). Raspberry Pi OS Lite 64-bit, overlayfs, mpv HEVC for video, Chromium kiosk for layouts. Huidu HTTP API control adapter if the card is a "D" card | Full content control and proof of play; vendor-neutral; no thermal issue indoors | EDID handshake at native canvas; 72 h soak with no frame drops on HEVC; power-cut recovery ×20; RAUC rollback works |
| **Outdoor pylon / billboard, HDMI-capable controller** | Same CM5 stack on a box rated **−25 to +60 °C**, inside the cabinet's cooled controller compartment, RTC battery fitted with charging enabled, temperature telemetry | eMMC, 2036 supply, fanless, full control | Internal temperature log through Jan–Feb 2027; no throttling at ≥45 °C ambient days; watchdog recovery tested |
| **Outdoor pylon / billboard, async-only Huidu card** | No box. Huidu "D" engineering card + TINNOX HTTP API adapter (program push, brightness, schedules, screenshot), with reverse TCP to an AU-hosted TINNOX gateway | Fewest parts in a hot cabinet; matches installer practice | Program push from CMS ≤ 2 min; screenshot-based proof of play sampled; key written by TINNOX at commissioning |
| **LCD kiosk (indoor/outdoor)** | RK3588 (or RK3576) Android 14 box with RTC and watchdog (Geniatech APC3588Q class; or an existing DSDevices unit if TINNOX has one). TINNOX APK with Media3 and WebView, provisioned as device owner. Outdoor kiosk: rely on the kiosk's own AC; box rated ≥ 60 °C | Touch, 4K portrait, silent updates via documented Android APIs, lower TINNOX effort | 4K portrait HEVC/H.264 playback; silent APK update with no prompt; vendor's written patch commitment received |

### Procurement and design rules (PROPOSED)
- Buy only Huidu cards with a "D" engineering ID. Prefer HDMI-capable dual-mode models above about 1280×512 (from R1).
- Any outdoor player must be rated for ≥ 60 °C operation and report its temperature.
- Android boxes need a written Android version, security patch level, OTA cadence and end-of-support date before any order over 10 units.
- Encode all CMS video as HEVC (Pi constraint), with H.264 renditions kept for Android/Huidu.
- Standardise on one CM5 carrier and one Android SKU per year to keep QA manageable.

### Defer
- x86 N100/N150 (no AU wide-temperature unit found; 0–50 °C consumer units only, AUD 322–354 inc GST [corrected in verification]). Reconsider for multi-output walls with heavy HTML/WebGL.
- BrightSign, Samsung/LG/Philips SoC displays (partner programmes; see H02).
- TINNOX APK on Huidu A-series cards (a time-boxed lab spike after asking Huidu); NovaStar Taurus (only for customer sites that already have it).
- A custom TINNOX CM5 carrier board, a Yocto image, and paid fleet tools (Mender/balena/Esper). Revisit at about 100 screens.

---

## Open items
1. **Per-site Huidu model list and firmware**, including whether IDs contain "D" and whether HDMI IN is present. This decides the pylon route (Analysis §5). Questionnaire item 1; R1 §A.
2. Industrial CM5 carrier **AUD prices and AU stock** (EDATEC, Waveshare CM5-HMI-BOX-A, Chipsee CS-CM5-BOX, Seeed). No price was found. Seeed CM5 box not found (only CM4 reComputer R1100).
3. **Official CM5 product brief and datasheet** (temperature, RTC, watchdog, 2036 statement). `pip-assets.raspberrypi.com` / `pip.raspberrypi.com` must be allowed in the session's network settings to read them first-hand.
4. Geniatech APC3588Q **operating temperature** and AU distribution; DSDevices specifications and Android version (dsdevices.com blocked).
5. **Android patch policy** from any shortlisted box vendor: UNKNOWN.
6. **Measured cabinet internal temperatures** for TINNOX's own pylon and billboard designs: is there AC, a heat exchanger or fans, and where is the controller compartment?
7. Huidu card **operating temperatures** from official datasheets (the A6L −40 to +80 °C figure is doubtful).
8. Whether the "granted vendor API" (Q4) is a Huidu sdkKey (R1 inference). If so, the async-pylon pilot can start immediately.
9. Installer preference: ask TINNOX's own installation team. No external evidence was found.
10. Exchange rate for converting the USD box prices; no rate was fetched.

---

## Sources and search log

### Sources (by finding)
- Core Electronics CM5 listings (AUD): https://core-electronics.com.au/catalog/product/view/sku/CM5008016 ; https://core-electronics.com.au/catalog/product/view/sku/CM5002000 ; https://core-electronics.com.au/catalog/product/view/sku/CM5008032 [THIRD_PARTY]
- Core Electronics Pi 5 8 GB: https://core-electronics.com.au/catalog/product/view/sku/CE09786 ; PB Tech AU: https://www.pbtech.com/au/product/SEVRBP0502/Raspberry-Pi-5-8GB-LPDDR4-24GHz-Quad-Core-ARM-Cort [THIRD_PARTY]
- CM5 temperature (product brief, via search): https://pip-assets.raspberrypi.com/categories/944-raspberry-pi-compute-module-5/documents/RP-008181-DS-10-cm5-product-brief.pdf [OFFICIALLY_DOCUMENTED; fetch blocked]
- CM5 production to January 2036: https://www.pishop.us/product/raspberry-pi-compute-module-5-8gb-ram-16gb-emmc-cm5008016/ ; https://www.electrokit.com/en/raspberry-pi-compute-module-5-4gb-32gb-cm5 [THIRD_PARTY]
- Raspberry Pi docs, read in full via raw.githubusercontent.com [VERIFIED_FULL_PAGE]: compute-module introduction (eMMC options, CM3 EoL 16 Oct 2025): https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation/asciidoc/computers/compute-module/introduction.adoc ; RTC: https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation/asciidoc/computers/raspberry-pi/rtc.adoc ; PMIC reset_event (watchdog): https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation/asciidoc/computers/raspberry-pi/power-supplies.adoc
- EDATEC ED-IPC3630 datasheet: https://www.mouser.lt/datasheet/3/6063/1/ED_IPC3630_datasheet_en.pdf ; CNX: https://www.cnx-software.com/2025/03/24/edatec-ed-ipc3630-raspberry-pi-cm5-powered-industrial-pc-di-docan-bus/ ; ED-HMI3630: https://buyzero.de/en/products/edatec-ed-hmi3634-101c-industrial-hmi-cm5 ; https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/8564/ED-HMI3632-133C-10232-S.pdf
- Other CM5 boxes: https://chipsee.com/?p=22457 ; https://www.waveshare.com/product/raspberry-pi/boards-kits/cm5/cm5-hmi-box-a.htm [THIRD_PARTY]
- Pi thermals: https://www.raspberrypi.com/news/heating-and-cooling-raspberry-pi-5/ ; https://www.raspberrypi.com/news/powering-industrial-innovation-compute-module-5-meets-revolution-pi/ ; https://pidiylab.com/raspberry-pi-5-cooling-guide-fan-curves-cases-testing/
- Geniatech APC3588Q: https://shop.geniatech.com/?p=3078 ; https://www.geniatech.com/mpd3588-rk3588-quad-display-signage-player-launch/
- Giada AR707 / DN84 temperatures: https://www.giadatech.com/about/news1172.html ; https://www.tekdis.co.uk/partners/android-linux/uk-axiomtek-giada-technology-inc..html ; Rikomagic DS08: https://www.cnx-software.com/news/digital-signage/page/3/?amp=1&noamp=mobile
- RK3588J temperatures and normal mode: https://lists.infradead.org/pipermail/linux-rockchip/2025-March/057067.html ; https://forum.banana-pi.org/t/banana-pi-open-source-community-complete-the-full-industrial-grade-and-automotive-grade-verificationthe-base-on-rockchip-rk3588m-3588j-and-completed-mass-production/15625 ; RK3576J: https://bliiot.com/info-detail/deep-comparison-between-rk3576j-and-rk3588s-processors
- Android BSPs for RK3588: https://docs.aim-linux.advantech.com/docs/processors/rockchip/RK3588/ROM-6881_wiki_data/ROM-6881_Android14_Release_Note ; https://wiki.friendlyelec.com/wiki/index.php/Template:RK3588-UpdateLog ; https://docs.radxa.com/en/software-support-matrix/rockchip
- DSDevices: https://manuals.plus/category/dsdevices ; H01 (USD prices)
- MINIX N100 (AUD, 0–50 °C): https://www.pbtech.com/au/product/IPCMNXZ10002/MINIX-Fanless-MiniPC-NEO-Z100-0dB-Intel-N100-8G256
- Huidu: https://toolboom.com/en/huidu-hd-a6l-led-display-module-controller-2560x1024/ ; https://toolboom.com/en/huidu-hd-t901-controller-1280-1024-widest-3840-highest-2048-synchronous/ ; https://toolboom.com/en/huidu-hd-vp620-dvi-hdmi-vga-video-processor-for-led-screens/ ; https://www.tokopedia.com/mms-surabaya/video-processor-huidu-hd-h6 ; https://bigl.ua/p2703633414-kontroller-dlya-led ; https://ibspot.com/products/huidu-r712-led-display-controller-card-dual-mode-sync-async-for-led-sign-board ; R1 (`R1-huidu-integration.md`)
- Outdoor thermal: see F2 URLs.

### Search log (19 of 20 WebSearch calls used)
1. Huidu HD-A6L HD-A4L asynchronous controller HDMI input operating temperature specification: A6L −40 to 80 °C (retailer), A4L "sync-async HDMI".
2. Raspberry Pi Compute Module 5 industrial fanless box operating temperature EDATEC Seeed reComputer: CM5 −20 to +85 °C; Chipsee, Waveshare; no Seeed CM5.
3. Raspberry Pi Compute Module 5 price AUD Core Electronics eMMC: AUD 209.95 / 95.05.
4. EDATEC ED-HMI3630 OR ED-IPC3630 CM5 operating temperature datasheet: −25 to +60 °C.
5. Raspberry Pi 5 thermal throttling 80C 85C: official 80/85 °C.
6. Compute Module 5 "remain in production until" 2036: January 2036 (retailers).
7. DSDevices DSDA1 DSDX5 specifications: little new.
8. Geniatech RK3588/RK3576 signage industrial wide temperature: APC3588Q USD 299; Giada AR707 −20 to 70 °C; DN84 0–60 °C.
9. Huidu HD-A6L Android version third-party APK HDMI: nothing relevant.
10. Intel N100 fanless industrial wide temperature price Australia: MINIX AUD 354.29, 0–50 °C.
11. Outdoor digital signage enclosure Australia heat 45 degrees: F2 rows 4–9, 11.
12. Huidu synchronous sending card HDMI T901 / VP410 / H series: T901, VP410/620/820.
13. Rockchip RK3588J industrial temperature longevity: −40 to 85 °C, normal mode; no longevity statement.
14. Raspberry Pi 5 RTC battery hardware watchdog: retailer notes (then read the official doc via raw GitHub).
15. Raspberry Pi 5 product brief operating temperature 0–50 °C: not confirmed for the board.
16. Android signage Rockchip security patch OTA policy: no policy; Android 14 BSPs.
17. LED installer Huidu vs NovaStar async vs PC player: no forum evidence.
18. Raspberry Pi 5 8GB price AUD Core Electronics: AUD 285.65.
19. Outdoor LED cabinet temperature, cabinet AC Australia: AC rated to 55 °C ambient.

WebFetch: `pip-assets.raspberrypi.com` failed (ENOTFOUND, network policy). curl via raw.githubusercontent.com succeeded for Raspberry Pi docs `computers/raspberry-pi/rtc.adoc`, `computers/raspberry-pi/power-supplies.adoc`, `computers/compute-module/introduction.adoc`, `datasheet.adoc`, `cmio-display.adoc` and `config_txt/common.adoc` (saved under `../r4dl/`). `compute-module/cm5.adoc` returned 404.

---

## Verification (adversarial pass)

Date: 2026-11-03. Method: re-fetch where reachable (Raspberry Pi docs and AOSP source via raw.githubusercontent.com; RAUC via GitHub), otherwise independent web search (6 of 6 WebSearch calls used). Still blocked in this session despite the network change: pip-assets.raspberrypi.com, raspberrypi.com, core-electronics.com.au, pbtech.com, shop.geniatech.com, mouser, cnx-software, tekdis, docs.radxa.com, Advantech docs, lists.infradead.org (all HTTP 403 at the proxy). Local copies: `../r4dl/`, `../r4v/`.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | CM5 eMMC options 16/32/64 GB (Lite = 0 GB) | confirmed | Pi docs `compute-module/introduction.adoc` line 91 (VERIFIED_FULL_PAGE, raw GitHub). The same page also lists 2/4/8/16 GB RAM |
| 2 | CM5 module rated −20 to +85 °C | confirmed | Search summary of official CM5 product brief (RP-008181-DS, July 2026 and Oct 2025 editions): https://pip-assets.raspberrypi.com/categories/944-raspberry-pi-compute-module-5/documents/RP-008181-DS-10-cm5-product-brief.pdf (OFFICIALLY_DOCUMENTED; PDF still blocked) |
| 3 | CM5 in production until at least January 2036 | confirmed (label raised) | Same product brief, per search summary; now OFFICIALLY_DOCUMENTED, not only retailer copies |
| 4 | CM3 EoL 16 Oct 2025 | confirmed (minor caveat) | `introduction.adoc` line 152. Note that the older Pi `datasheet.adoc` still says CM3 EOL "no earlier than January 2026", so the Pi docs contradict each other. This does not affect TINNOX |
| 5 | CM5 8 GB/16 GB eMMC AUD 209.95 inc GST, Core Electronics | confirmed | Search: AUD 209.95 inc / 190.86 ex GST; date not shown. https://core-electronics.com.au/catalog/product/view/sku/CM5008016 . Cross-check: pishop.us USD 185 |
| 6 | Pi 5 8 GB AUD 285.65 inc GST, Core Electronics | confirmed | Search: AUD 285.65 inc / 259.68 ex GST, https://core-electronics.com.au/catalog/product/view/sku/CE09786 . "Looks inflated" is also fair: an older PB Tech AU bare-board listing showed AUD 129.08 + GST. Switch Science attributes recent rises to memory prices |
| 7 | Pi 5 throttles at 80 °C and harder at 85 °C | confirmed | Pi docs `raspberry-pi/frequency-management.adoc` lines 3–5 (VERIFIED_FULL_PAGE): Arm cores throttle progressively between 80 and 85 °C; at 85 °C both Arm and GPU throttle; the limit can be lowered, not raised |
| 8 | Pi 5 hardware decode is HEVC 4K60 only; H.264 is software | confirmed | Pi docs `processors/bcm2712.adoc` lines 20–23: 4Kp60 HEVC hardware decode; H.264 1080p60 decode takes about 50–60 % CPU (VERIFIED_FULL_PAGE). Supports the HEVC-first encoding rule |
| 9 | Pi 5 RTC battery charging off by default (`rtc_bbat_vchg`) | confirmed | `rtc.adoc` lines 56–74 (VERIFIED_FULL_PAGE). CM5 RTC is still INFERRED. The CM5 datasheet was not readable |
| 10 | PMIC `reset_event` reports watchdog resets | confirmed | `power-supplies.adoc` line 220 (VERIFIED_FULL_PAGE) |
| 11 | EDATEC ED-IPC3630 −25 to +60 °C, 9–36 V input, fanless CM5 | confirmed | Search summary of the EDATEC datasheet and user manual (Mouser), and of CNX: operating −25 to 60 °C, 9–36 V Phoenix terminal, up to 24 W. A different EDATEC model is −10 to 60 °C, so the exact SKU matters |
| 12 | Giada DN84 0–60 °C | corrected | The rating holds **at 0.7 m/s airflow** (Giada spec via tekdis.co.uk). DN84-A/-I variants are listed at 0–45 °C (Assured Systems). In a still-air sealed compartment, assume less than 60 °C |
| 13 | MINIX N100 0–50 °C | confirmed | PB Tech listing: 0–50 °C, 5–85 % RH |
| 14 | MINIX N100 8/256 AUD 354.29 inc GST | corrected | The same SKU shows AUD 322.08 and 329.01 on PB Tech AU captures, out of stock. Restated as AUD 322–354. The deferral is unaffected |
| 15 | Geniatech APC3588Q USD 299, Android 14, RTC + watchdog | corrected (price); confirmed (OS, RTC, watchdog) | The APC3588Q page is enquiry-only. USD 299 was not found. The non-Q APC3588 shop range is USD 269–359, preloaded with Android 12. Android 14 and "Watchdog & RTC, 24/7" come from Geniatech's launch post and product page. The non-Q CN spec gives −20 to 60 °C ambient. https://www.geniatech.com/mpd3588-rk3588-quad-display-signage-player-launch/ ; https://shop.geniatech.com/product/apc3588 ; https://file.geniatech.com/download/APC/APC3588_Specification_V1.0_CN.pdf |
| 16 | `DISALLOW_SYSTEM_ERROR_DIALOGS` restarts crashed apps | **refuted** | AOSP `UserManager.java` (VERIFIED_FULL_PAGE, raw GitHub aosp-mirror): "the system will force-stop the app as if the user chooses the 'close app' option". It does **not** restart the app. The Android player needs its own relaunch mechanism, and the 3–5-week estimate should include it |
| 17 | Device owner can install APKs silently via PackageInstaller | confirmed | AOSP `PackageInstaller.java` lines 122–131: installation completes automatically when the caller is the device owner or an affiliated profile owner |
| 18 | RAUC is LGPL and supports signed A/B with fallback | confirmed (licence) | RAUC README: LGPL-2.1-or-later. A/B and fallback were not re-checked but are core RAUC features (H02) |
| 19 | Installed CM5 player ≈ AUD 400–650, same band as a USD 299 RK3588 box | corrected (arithmetic) | 209.95 + 150–400 (INFERRED carrier) = AUD 360–610, not 400–650. The comparison with the RK3588 box also needs an exchange rate, which was not fetched, so it is indicative only. The conclusion "unit price does not decide this" still holds, because the ranges overlap |
| 20 | Some RK3588 boards stay on Android 12 (Radxa ROCK 5T); Android 14 BSP on kernel 6.1 (Advantech) | unverifiable this pass | docs.radxa.com and Advantech docs are blocked. The indirect support is that Geniatech's non-Q APC3588 also ships Android 12 (row 15), so the premise "Android versions vary per SKU" is supported |
| 21 | RK3588J −40 to +85 °C; Rockchip "normal mode" advice | unverifiable this pass | lists.infradead.org blocked; no search spent |
| 22 | Huidu async C/D cards have no HDMI IN; T901/VP/H6/H8 accept HDMI/DVI | unverifiable this pass | Huidu sites are blocked; this rests on R1 and retailer listings (THIRD_PARTY). It stays the key open item (Open items 1) |
| 23 | Engineering effort: CM5 6–10 weeks, Android 3–5 weeks | unverifiable (INFERRED) | No external benchmark. Android should rise slightly because of row 16 |
| 24 | AU outdoor 45 °C+ design point; cabinet AC rated to 55 °C | unverifiable this pass | Not re-searched. The sources are THIRD_PARTY marketing and blogs, so treat 45 °C as a design assumption to confirm with the pilot logging |

**Tally:** 24 claims checked: 14 confirmed (rows 1–11, 13, 17, 18; row 3's label was raised and row 4 has a caveat), 4 corrected (rows 12, 14, 15, 19), 1 refuted (row 16), 5 unverifiable (rows 20–24).

**Does the recommendation still hold? Yes.**
- Its premises survive. CM5 is the module with eMMC, a −20 to +85 °C rating and supply to 2036, all now officially sourced. A −25 to +60 °C fanless CM5 box exists. Pi 5 hardware decode is HEVC-only. Throttling starts at 80 °C. Android silent install as device owner is documented. Android versions vary per box SKU.
- The corrections narrow detail but do not change the order. The RK3588 box price is now on enquiry or USD 269–359 instead of USD 299. The CM5 installed-cost band is AUD 360–610. The DN84's 60 °C rating needs airflow, which strengthens the rule to mount players in the cooled compartment. The MINIX price is lower but the unit is still a 0–50 °C consumer box.
- The single refuted item, Android crash auto-restart, adds a small task to the Android route (its own relaunch or watchdog). It does not change which platform suits which product line.
- The recommendation still hinges on the unverified Huidu per-site model list (row 22), exactly as the report states.
