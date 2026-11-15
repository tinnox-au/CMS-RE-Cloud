# Hardware next step: one NovaStar test

Date: 2026-11-14. Scope: the smallest hardware experiment that should follow prototype M0. Nothing on this page has been tested. No physical controller was contacted for M0, and this page authorises none: no controller configuration, key writes or changes to customer displays.

## 1. What the browser prototype does and does not establish

Prototype M0 exercises the content model, publishing, the player protocol and software rendering of a canvas (including portrait and unusual LED-shaped canvases) in Chrome on a laptop or PC.

**It does not establish:**

- unattended **kiosk reliability** (boot to playback, recovery after power loss, weeks of running without a person);
- **codec performance** on any player hardware;
- **HDMI compatibility** with any LED controller (mode negotiation, EDID, custom resolutions, HDCP);
- **controller input modes** (synchronous or asynchronous operation, source policy, scaling or cropping);
- anything about NovaStar or Huidu APIs, credentials, licences, firmware or network behaviour.

A player report in the portal is evidence from software. It is not proof that LED panels are showing the content. NovaStar compatibility remains unverified until a model-specific test on real hardware is run.

## 2. What the existing documents already say

Evidence labels are kept exactly as in the source documents. Nothing below was re-verified for this page, and every hardware claim remains HARDWARE-DEPENDENT/UNVERIFIED until run on a device.

| Statement | Label in source | Source |
|---|---|---|
| The TINNOX website names a NovaStar media-player/controller in the PrecisionMicro, PrecisionPro and PrecisionLuma packages | VERIFIED_FULL_PAGE | `docs/open-questions.md` Q2; `docs/decisions-2026-11.md` DEC-05 |
| NovaStar is used for indoor PrecisionX and Huidu for outdoor and custom builds | INFERRED; confirm per package (Q14) | `docs/decisions-2026-11.md` DEC-05 |
| Which NovaStar model is fitted in each package and size is not known | Open: Q14, Q23 | `docs/open-questions.md` section 2.1 |
| One vendor API access has been granted to TINNOX; the vendor is not identified. An AppKey and AppSecret from the VNNOX Open Platform would mean NovaStar; a 16-hex `sdkKey` plus secret would mean Huidu | Grant: DECIDED by client. Vendor: UNKNOWN until Q13 | `docs/decisions-2026-11.md` DEC-06; `docs/open-questions.md` Q13 |
| Q15 concerns installed Huidu cards (SDK keys, HDPlayer schedules, 4G). It does not bear on a NovaStar test | Open | `docs/open-questions.md` Q15 |
| A NovaStar TB60 loads about 2.3 Mpx, with HDMI-in up to 1920×1200@60 | OFFICIALLY DOCUMENTED via search summary (the vendor site was not reachable during research) | `docs/architecture-and-hardware.md` sections 3 and 4; `docs/open-questions.md` Q23 |
| PrecisionPro S3 (2.49 Mpx), PrecisionPro S4 (3.31 Mpx) and PrecisionMicro S4 (2.82 Mpx) exceed that load and would need a larger model or a split canvas | From R5 verification #12; capacity HARDWARE-DEPENDENT/UNVERIFIED | `docs/architecture-and-hardware.md` section 3 item 23 |
| Taurus synchronous-mode scaling is down-only; TB40 accepts a source width of 64 to 2048 px | THIRD PARTY | `docs/architecture-and-hardware.md` sections 2 and 4 |
| The HDMI timing is independent of the physical LED canvas; custom modes come from a custom EDID on the sending card (NovaLCT), a mode forced at the source, or crop or letterbox at the controller | THIRD PARTY | `docs/architecture-and-hardware.md` section 2 |
| Third-party apps are "not supported" on Taurus per the TB6 specification; side-loading is documented only by third parties | OFFICIALLY DOCUMENTED; HARDWARE-DEPENDENT/UNVERIFIED | `docs/architecture-and-hardware.md` section 4 |
| NovaStar VNNOX is excluded until the vendor shows an Australian region in writing; no Australian region was found | PROPOSED; UNKNOWN | `docs/decisions-2026-11.md` DEC-15 |
| The HDMI route (a TINNOX player feeding a controller's synchronous input) is the proposed primary route for walls | PROPOSED for TINNOX approval | `docs/decisions-2026-11.md` DEC-09 |
| Related backlog spikes: K2 (handshake at native canvas) and K9 (TB60 capacity per package) | HARDWARE-DEPENDENT/UNVERIFIED | `docs/implementation-backlog.md` |
| The order list has no HDMI sender, NovaStar unit or LED panel; the proposed fix is that TINNOX supplies them from stock. Which sender is in stock is NOT IN DOCS | Recorded inconsistency | `docs/gaps-and-first-steps.md` sections 2, 7 and 8 |
| Use of third-party reverse-engineered NovaStar LAN protocols in a commercial product is a question listed for legal advice | Undecided | `docs/gaps-and-first-steps.md` section 4 |

## 3. The experiment

**One NovaStar controller, one LED screen (or a few cabinets), one HDMI source, on a bench at TINNOX.** The question: does a canvas rendered by the TINNOX player arrive pixel-accurate on the LEDs through that controller's HDMI input?

The HDMI route comes first because it needs no vendor API, no vendor account and no vendor cloud, and it does not depend on the answer to Q13. Native playback (section 6) is attempted only if TINNOX intends it and the access in section 4 item 6 exists.

For the first run the HDMI source can be the same laptop or PC that runs the M0 browser player, with its HDMI output connected to the controller. That tests the signal path and canvas mapping only. It says nothing about a dedicated player's reliability or decode performance, which is a separate later test on the chosen player hardware (`docs/decisions-2026-11.md` DEC-20, PROPOSED).

## 4. What to obtain and record before the test

TINNOX supplies items 1 to 5 from one existing product package. Record facts by reading them off the device and its software, not from memory or a catalogue. Record who holds each login, never the secret itself.

| # | Item | Exactly what to record | Why |
|---|---|---|---|
| 1 | **Controller model and firmware** | Make and exact model as printed on the unit (for example which Taurus, MCTRL, VX or other series; do not assume), hardware revision, serial number, firmware version as shown in the vendor tool, and for an Android-based unit the Android version. Which TINNOX package and size it belongs to | Capacity, input limits and any API differ by model and firmware. Answers Q14 and Q23 for one package |
| 2 | **Video input and mode** | Which inputs the unit has (HDMI, DVI, other) and which is used; whether the unit is running in synchronous (live input) or asynchronous (internal playback) mode, and its source-priority setting; the input resolution and refresh rate currently negotiated; whether a custom resolution or EDID has been set on the unit; whether HDCP is involved | A unit in asynchronous mode shows no HDMI source. The negotiated mode decides what the player must output |
| 3 | **Canvas and output dimensions** | Physical LED canvas in pixels (width × height), pixel pitch, cabinet count and layout, number of Ethernet outputs used. How the controller maps input to canvas: 1:1, scaled, cropped, with what offset. Therefore: the HDMI frame size, and the content rectangle inside it | The CMS models canvas width and height plus an optional content rectangle inside the output frame; these numbers are its input |
| 4 | **Existing software in use** | Which vendor tools configure and feed this screen today (for example NovaLCT, ViPlex, VNNOX), their versions, who holds the logins, where the screen-configuration backup file is kept, and whether any vendor cloud account is bound to the unit | Needed to restore the unit after the test; a cloud binding is a data-location question (DEC-15) |
| 5 | **Test rig** | The LED screen or cabinets driven by the unit; an HDMI cable and any adapter; a colour-accurate reference (a second monitor on a splitter is enough); a phone camera for evidence | |
| 6 | **API access, only if controller-native playback is intended** | The grant document from Q13: who issued it, when, for which product, under what terms (NDA, fee, expiry), which endpoints and regions it covers, and whether use requires the vendor's cloud. For any LAN interface: the vendor's own documentation for this exact model and firmware | No adapter work starts until the vendor is identified (DEC-06). Use of reverse-engineered protocols is undecided and listed for legal advice (`docs/gaps-and-first-steps.md` section 4); vendor clouds are excluded by default (DEC-15) |

Before touching the unit: export and keep its current configuration, note the current mode and source, and agree who restores it. Do not change receiving-card or screen-topology settings for this test. Do not use a customer's live display.

## 5. Acceptance checks: HDMI route

Run with the M0 player in full screen on the HDMI output, publishing from the portal. Record pass, fail or not run for each, with a photo where it helps. A fail is a finding, not a defect in the test.

| # | Check | Pass when |
|---|---|---|
| H1 | Mode negotiation | The source and controller settle on a stable mode without manual retries; the mode (resolution, refresh) is recorded. Repeat after unplugging and replugging the cable, and after power-cycling each end in turn |
| H2 | Canvas mapping | A test image with a one-pixel border, corner markers and a pixel grid at the recorded canvas size shows all four edges on the LEDs with no cropping, scaling blur or offset. The required content rectangle is recorded |
| H3 | Display settings in the CMS | A display created with that canvas and content rectangle renders the same result without hand adjustment of the browser window |
| H4 | Fit modes | A 16:9 image and a portrait image show correct contain and cover behaviour on the physical canvas |
| H5 | Image and video playback | A JPEG, a PNG and an H.264 MP4 from the sample set play in order; transitions happen at item boundaries; no visible tearing or dropped frames over a 30-minute run (state that this is observation by eye unless measured) |
| H6 | Colour and levels | Black, white, primary and grey-ramp test images look the same as on the reference monitor apart from the screen's own calibration; no crushed blacks or clipped whites that would indicate a range mismatch |
| H7 | Update on screen | Publishing a new playlist changes the LEDs at an item boundary; an interrupted update leaves the previous content on the LEDs |
| H8 | Network loss | With the network unplugged from the source, playback continues from cache for the tested period (state the duration) |
| H9 | Signal loss behaviour | What the controller shows when HDMI is removed and restored (black, last frame, internal content) is recorded; it returns to live input without intervention |
| H10 | Report versus reality | The portal's reported active item matches what is on the LEDs at three spot checks. Record that this was checked by a person; the software cannot verify it |

Explicitly not covered by H1 to H10: long-run stability, thermal behaviour, automatic recovery after power loss, decode performance on a dedicated player, brightness or power control, and any other controller model.

## 6. Acceptance checks: controller-native playback

Only if TINNOX intends native playback on this model **and** item 6 of section 4 is in hand. Otherwise record "not attempted" and the reason. These checks describe what a later adapter would have to prove; M0 contains no such adapter and no vendor method has been written.

Preconditions (all must be true before any attempt):

| # | Precondition |
|---|---|
| P1 | The vendor and the access grant are identified from the document itself (Q13) |
| P2 | Official vendor documentation for this exact model and firmware is in hand and covers content transfer and playback status |
| P3 | The access path does not require a vendor cloud, or the cloud's data location has been reviewed and accepted (DEC-15) |
| P4 | Licence, NDA and warranty terms permit the use |
| P5 | The unit is a bench unit whose configuration is backed up; no customer display |

Checks, to be run with the vendor's own tool first, by hand, before any TINNOX code:

| # | Check | Pass when |
|---|---|---|
| N1 | Formats | The unit plays the sample JPEG, PNG and H.264 MP4 at the canvas size; unsupported formats, sizes or bitrates are recorded as limits for a capability profile |
| N2 | Canvas | Content sized to the physical canvas appears 1:1 with no scaling or cropping |
| N3 | Ordered playlist with durations | Items play in order with the set image durations and natural video duration |
| N4 | Complete-or-nothing update | A new playlist replaces the old one only after it has fully arrived; an interrupted transfer leaves the previous playlist playing. If the unit cannot guarantee this, record it: it changes what the CMS may promise on this route |
| N5 | Integrity | There is a documented way to confirm the files on the unit match what was sent (size or hash) |
| N6 | Status and acknowledgement | The documented interface reports what is stored and what is playing, in enough detail to distinguish delivered, downloaded and playing. Record exactly what is and is not reported |
| N7 | Offline | Playback continues with the network removed; behaviour after a power cycle is recorded |
| N8 | Security of the interface | How the interface authenticates, whether transport is encrypted, which ports must be reachable and from where, and whether default credentials exist. Record facts only |
| N9 | Coexistence | Whether using this interface disables or conflicts with the existing vendor software and schedules on the unit |

## 7. How the outcome feeds the design

| Outcome | Next step |
|---|---|
| H1 to H4 pass | The HDMI route is plausible for this model. Next: the same checks on the intended dedicated player hardware, then reliability and decode tests (backlog K2 and related spikes). Add the measured canvas and content rectangle as a tested configuration; do not generalise to other models |
| H1 or H2 fail | Record the negotiated mode and mapping. Options from the existing research (custom EDID on the sending card, forcing the source mode, accepting crop or letterbox) are THIRD PARTY findings to try next, with the controller owner's agreement |
| Section 6 preconditions not met | Native playback stays out of scope. The delivery port (`packages/delivery`, D15 in `docs/prototype-m0.md`) keeps room for it; no vendor method is invented meanwhile |
| N-checks run | Their results become the capability profile and the open risks for a future adapter proposal, which needs its own threat model and data-flow review (`docs/security/threat-model.md` section 3, boundary 8) |

## 8. Open questions this test does not close

Q13 (which vendor granted API access), the controller list for every other package (Q14), installed Huidu cards (Q15), pixel resolutions and NovaStar models for the remaining sizes (Q23), player hardware selection, outdoor thermal behaviour, and all Huidu routes. See `docs/open-questions.md` and `docs/gaps-and-first-steps.md`.
