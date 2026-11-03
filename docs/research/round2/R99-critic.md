# R99: Round-2 completeness critic

Date: 2026-11-03. Inputs read: `CONTEXT.md`; AV1–AV5 (summaries, new findings, still-unknown sections, plus targeted greps); R1–R8 (summary, findings, recommendation, open items and full verification sections); all 8 repository docs under `/home/user/CMS-RE-Cloud/docs/` (in full, except `yodeck-workflow-audit.md`, read by heading map and cross-checked through AV1–AV5 and R7). WebSearch calls used: **3 of 6** (Zoho AU data centre, NovaStar TB60 HDMI input, VNNOX AU region). Labels follow `CONTEXT.md`.

**Note on the "9 repository docs".** The repository holds **8** docs (`git ls-files`: acceptance-tests, architecture-and-hardware, implementation-backlog, open-questions, rea-evaluation, tinnox-context, tinnox-mvp-spec, yodeck-workflow-audit). There is no README. Section 2 covers all 8 and proposes a 9th file, `docs/decisions-2026-11.md`, to record the TINNOX answers (Q1–Q12) and the round-2 decisions in one place (PROPOSED).

---

## 1. Contradictions and recommended resolutions

### 1A. Between round-2 files

| # | Files | Contradiction | Recommended resolution |
|---|---|---|---|
| C1 | R5 vs R1, R4 (and TINNOX Q2) | R5 (VERIFIED_FULL_PAGE) finds that the site names **NovaStar** ("a NovaStar media-player/controller" in the PrecisionMicro, PrecisionPro and PrecisionLuma packages) and **DsDevice**, and never mentions Huidu. R1 and R4 build the whole hardware and integration plan on **Huidu as the main vendor** (from TINNOX's Q2 answer) and do not cover NovaStar. | Treat release 1 as having **two controller vendors**: NovaStar for the indoor PrecisionX packages and Huidu for outdoor and custom builds (INFERRED; ask TINNOX per package). Keep route (a), a TINNOX player feeding HDMI, as the vendor-neutral primary for both. Add a NovaStar row to the R4 pilot table: TINNOX player → Taurus or sender in synchronous mode. Watch the capacity limits: the TB60 handles about 2.3 Mpx, and sync-mode scaling on the Taurus series is down-only, with source width 64–2048 px documented for the TB40 (THIRD_PARTY, https://dynamo-led-displays.co.uk/novastar-tb40-playback-box/ ; https://audioeffetti.com/en/category/video/led-wall-management/novastar-m06020175-taurus-multimedia-player-4-gigabit-ethernet-ports-processing-capacity-of-up-to-2-3-mpixel-p23824). PrecisionPro S3/S4 and PrecisionMicro S4 need a larger NovaStar model or a split canvas (R5 verification #12). |
| C2 | R1 vs R5 | The **"one vendor API granted"** (Q4): R1 says it is most likely a Huidu sdkKey/sdkSecret. R5 says NovaStar is the prime candidate. | Both are INFERRED. Do not start adapter work on either assumption. Ask TINNOX the identification question in section 3 (Q-T1): a 16-hex `sdkKey` plus secret from Huidu support means Huidu; an AppKey/AppSecret from the VNNOX Open Platform means NovaStar. |
| C3 | R4 vs R1 (verification) | The R4 pilot for the async-only Huidu pylon uses "reverse TCP to an AU-hosted TINNOX gateway". R1's verification (caveat 1) says the gateway and `SetSDKTcpServer` reverse connection are THIRD_PARTY and unproven, and makes an on-site agent or VPN router the baseline. | Follow R1. **Baseline: on-site agent or 4G router with VPN. The reverse TCP gateway is a lab spike**, not the pilot path. Amend the R4 pilot row. |
| C4 | R2 vs AV1 (vs AV5) | **Default for staff access (Q8).** R2 proposes B+: content and account access is off by default and granted by the customer (24 h default, 7 days maximum). AV1 proposes "staff access on by default for TINNOX-managed customers ... plus a customer setting to require approval". AV5 leans towards opt-in. | Adopt **R2 B+**. AV1's case is already covered by B+ item 2, an optional "standing access" toggle for Managed-tier customers that is re-confirmed every 12 months and always logged. Add R2's verification suggestion as well: a Signagelive-style "pre-authorised 24 h self-grant" option. Device-operations scope (telemetry, restart, firmware) stays always-on under the contract. |
| C5 | R6 vs R2 | **Audit-log retention.** R6 ties customer audit-log retention to the plan: 90 days (Essential), 13 months (Professional), 25 months (Managed). R2 proposes 24 months for every customer, because the ISM-1988 minimum is 12 months searchable, and 7 years in write-once storage for support-session and break-glass records. R6's Essential figure falls below the ISM floor. | **Audit retention is a compliance floor, not a sales tier.** Use 24 months for all customers and 7 years for support and break-glass records. Tier only the playback-log (proof-of-play) retention and extras such as SIEM streaming and longer contractual retention. Fix the R6 R2 table. |
| C6 | R6 vs spec (and R2) | **Playback-log retention.** R6 proposes 31 days, 13 months or 25 months by tier. The spec (§5) assumes 13 months for all. | Accept the tiers, with a floor of 13 months for the Managed and government options. Change spec §5 to "retention per plan (entitlement)". |
| C7 | R6 vs R1 and R4 | R6 sells "PDF, PowerPoint, web pages" in Professional. R1 shows the Huidu HTTP API has **no web or HTML item** (VERIFIED_FULL_PAGE, absence), and Yodeck notes web pages do not work offline (AV1, AV3). | Features depend on the route. Web pages and PowerPoint are available only on TINNOX-player routes (a and c), never on Huidu program push (route b). The entitlement service needs a capability check per display ("route capabilities"), not only per plan. Q11: put **PDF in release 1, and PowerPoint (converted to video or images) and web pages in release 2** (PROPOSED). |
| C8 | R6 vs R3 | **Hosting cost basis and FX.** R6 mixes A04 figures (with Cloudflare R2 media) and R3 figures (all-AU), and uses FX 1.449 (1/0.69). R6's own verification gives 1.4434 (1/0.6928). R3 drops R2 by default. | Use **R3 Option A (all-AU AWS) as the single cost source**, with one FX rate stated with its date (0.6928 USD per AUD on 1 Oct 2026, RBA to confirm). The R6 band of AUD 220–390 per month at 150 displays still holds. |
| C9 | R6 vs R5 | R6 says the 12 months of included CMS "matches the 1-year on-site warranty". R5 shows the standard warranty is **2 years product plus 1 year on-site**. | Keep 12 months included, but describe it as aligned with the on-site year. Offer the product-warranty extension as a cross-sell with the subscription. |
| C10 | R8 vs R5 (vs arch §4) | R8 says the DSDevices players are **retired** (Xibo stopped selling DSCS9X/DSCS95 in September 2025). R5 says the DSDA1 is current (Android 14, Xibo pre-installed, GBP 235 ex VAT). | Both are true. Only the Xibo-sold DSCS9X/95 models are retired; DSDevices still sells the DSDA1 and DSDX5. Arch §4 should say this and add the 2024 DSDevices firmware advisory as a hardening lesson. |
| C11 | AV5 vs R7 | **Per-screen offline-alert recipients.** AV5 (help centre) says only users with Device Manager access can be chosen. R7 X9 (spec example) shows external e-mail addresses. | The UI restricts recipients to Device Manager users, and external addresses are only an API example (UNVERIFIED). TINNOX should allow external recipients with e-mail verification (PROPOSED). |
| C12 | AV4 vs R4 | AV4 N17: Yodeck still recommends the Pi 4 over the Pi 5. R4 recommends the CM5. | Not a real conflict. Yodeck optimises for consumer cost, while TINNOX needs eMMC, −20 to +85 °C module rating and supply to 2036 (R4, OFFICIALLY_DOCUMENTED). Keep the CM5 and note Yodeck's choice as context. |
| C13 | R4 (Pi 5 H.264 software decode) vs spec §15 and arch §8 | The repository makes "H.264 1080p-class" the universal rendition. R4 (VERIFIED_FULL_PAGE) shows that H.264 1080p60 costs 50–60 % CPU on a Pi 5 or CM5 and recommends HEVC first. | Renditions per player profile: HEVC for CM5, H.264 for Android and Huidu cards. R1 shows Huidu cards download by URL, so their codec limits are HARDWARE-DEPENDENT/UNVERIFIED. |
| C14 | R5 vs R3 (and TINNOX Q9) | R3 designs an all-AU stack. R5 shows that TINNOX's own back office (HubSpot, Zoho Desk, Google, Meta) "may store and process information outside Australia" (VERIFIED_FULL_PAGE, privacy policy). R5 also recommends linking the CMS to Zoho Desk tickets. | Keep CMS data in Australia. Any Zoho Desk link should carry only a ticket ID and a device serial, never content or personal data. Zoho runs an Australian data centre (desk.zoho.com.au, Sydney and Melbourne, launched 2019, THIRD_PARTY/OFFICIALLY_DOCUMENTED via search: https://www.techpartner.news/news/zoho-expects-channel-boost-from-new-local-data-centres-531232 ; https://help.zoho.com/portal/en/kb/accounts/manage-your-zoho-account/articles/data-center-for-zoho-account). Moving TINNOX's Desk to the AU DC is a TINNOX decision. The CMS privacy statement must be separate from the website's. |
| C15 | R1 (route d) and R3 vs a possible NovaStar VNNOX route | R3's "strictly AU" stance conflicts with any vendor cloud. No VNNOX Australian region was found in public sources (search on 2026-11-03 returned nothing relevant; UNKNOWN). | VNNOX (arch route 3) and the Huidu cloud (route d) are **excluded by default** under Q9 until a vendor shows an AU region in writing. LAN or HDMI routes only. |

### 1B. Between round-2 files and the repository docs

| # | Doc statement | Round-2 evidence | Resolution |
|---|---|---|---|
| D1 | tinnox-context §4 and mvp-spec §1: TINNOX "today supplies a separately licensed third-party CMS"; "per-screen licence" inference | Q1 (no CMS); R5 F7 rows 14, 15, 18 | Replace with "TINNOX sells no CMS today; player and CMS are selected per project". |
| D2 | tinnox-context §4: no NovaStar link; DsDevice UNKNOWN | R5 F3 (VERIFIED_FULL_PAGE) | NovaStar and DsDevice are named on the site; DsDevice identity is INFERRED to be DSDevices. |
| D3 | tinnox-context preamble and open-questions B2: tinnox.com.au, help.yodeck.com and xibosignage.com are unreachable | CONTEXT: now reachable; R5 read 43 pages in full | Update the labels to VERIFIED_FULL_PAGE and mark claims that are no longer on the site. |
| D4 | tinnox-context §3: "1-year on-site warranty"; SLA "available for select products"; 1–2 day installs; hire only in VIC and NSW; P6 at Sydney Markets and 3000 nits at Brady | R5 F7 rows 8, 10–12, 19 | Correct to 2-year product + 1-year on-site, add the published SLA, and remove claims that are no longer on the site. |
| D5 | architecture §1, §2, §5, §6: NovaStar-centric; "HDMI into the site's existing NovaStar synchronous controller"; Huidu is a minor route 5 | Q2 (Huidu), R1, R4, R5 | Make the routes vendor-neutral with Huidu first-class (section 2). |
| D6 | architecture §8: Cloudflare R2 is the default media store | R3: R2 has no AU jurisdiction (OFFICIALLY_DOCUMENTED) | Default to S3 Sydney with CloudFront limited to the AU price class; R2 is opt-in for non-personal media only. |
| D7 | architecture §8 cost table: USD 69–100 at 50 screens | R3: AUD 109 / 263 / 1,002 / 2,913 at 10 / 100 / 500 / 2,000 (verified arithmetic) | Replace the table with R3 Option A. |
| D8 | architecture §7: Xibo player price UNKNOWN; white-label residency UNKNOWN; £300 set-up | R8 (VERIFIED_FULL_PAGE) | Android US$28, webOS/Tizen US$85, ChromeOS US$49; an AU data centre exists; £300 is an archived 2018 figure; staff have standing access; English law; delete on exit; a non-compete applies on the Distributor and VAR tiers. |
| D9 | mvp-spec §7.6: operator-started 4 h session, approval later | R2 B+ | Rewrite §7.6 (section 2). |
| D10 | mvp-spec §5: AuditEvent "Retained 2 years (ASSUMPTION A8)" | open-questions A8 is the **hosting** assumption, not retention | Internal mislabel. Cite R2 and the new retention policy instead. |
| D11 | mvp-spec §4 and open-questions A2: no plans or billing in release 1 | R6 R3 | Change to "no self-serve or in-product invoicing; entitlements, licence states, quotas and billing export are in release 1". |
| D12 | mvp-spec §6.7 REFERENCE: Yodeck precedence by list order | R7 X14: integer `priority`, higher number wins (VERIFIED_FULL_PAGE spec) | Correct the reference. |
| D13 | mvp-spec §7.2: Yodeck "8 or 9 character code" | R7 X8 and AV2: 9 digits in the API, with the first digit giving the player type | Correct the reference. |
| D14 | mvp-spec §16: Yodeck "publishes no numbers; third parties report 21/10 s" | R7 F2: official Low 14/42, Standard 21/63, High 33/99 per 10 s | Correct the reference. |
| D15 | mvp-spec §12 REFERENCE: content flags Possibly Outdated and Not Updated only | AV5 row 8: six states, including Pending Media | Correct the reference. |
| D16 | mvp-spec §6.2 REFERENCE: upload lifecycle is THIRD PARTY | R7 X19, AV3: spec-verified, **five** states | Upgrade the label. |
| D17 | yodeck-workflow-audit §3.11 and §5 C3/C5/C6: spec login-gated; webhooks user-only; reboot endpoint; 8-digit Pi code; no AU zone observed; workspace deletion moves items | R7 X1–X25, AV1–AV5 (12 + 17 + 3 + 1 + 12 refutations) | Large rewrite (section 2). |
| D18 | open-questions Q1–Q12 open; B1 says app.yodeck.com is blocked | TINNOX answers; CONTEXT | Record the answers. B1 changes: public pages and spec are reachable, but authenticated inspection still has not been done. |
| D19 | backlog §0 and Epic K: "Raspberry Pi 5 player feeding an LED controller" | R4 | Use CM5 on an industrial carrier, plus a Huidu "D" card track. |
| D20 | mvp-spec §11 zone list includes Pacific/Auckland "if Q6 confirms NZ" | Q6: AU only. R5: the site says installs are "around Australia and New Zealand" | Drop NZ from release 1. Keep the zone model generic so NZ is a data change later. |

---

## 2. DOC IMPACT LIST (exact sections and new wording in brief)

### 2.1 `docs/tinnox-context.md`
- **Preamble / labels:** "tinnox.com.au read in full on 2026-11-03 (43 pages)". Change VERIFIED PUBLIC to VERIFIED_FULL_PAGE where a claim survives, and add "no longer on site (2026-11-03)" where it does not (R5 F7 #1).
- **§1:** HQ is Level 3, 235 Queen St, Melbourne (first-party, from JSON-LD); warehouse at 359 Bluff Rd, Hampton; offices in Sydney, Brisbane, Perth and Canberra; phone 1300 846 669; support goes to a Zoho Desk form. Remove "hire only in VIC and NSW". Add ISO 9001/14001/45001.
- **§2:** Replace with the named package range: PrecisionMicro™, PrecisionPro™ and PrecisionLuma™ (indoor LED); StructuraSign™, DuraBlaze™ Electronic Sign and DuraBlaze™ Media (outdoor LED); EdgePro™, RobustPro™ and RobustMini™ (LCD kiosks); RobustMicro™ and RobustMax™ (**LED kiosks**). Add the published canvases (1376×774, 768×448, 2240×1260; billboards at 2:1, 3:1 and 4:1). Upgrade the non-16:9 implication from INFERRED to VERIFIED_FULL_PAGE. Remove P6 and 3000 nits.
- **§3:** Warranty is 2 years product + 1 year on-site, extensions at 10 % per step, maximum 6 + 3 years. Add the published SLA (critical: same or next day, 3–5 business-day turnaround; non-critical: 2 business days, 7 business-day turnaround). Installation is by certified partners. Remove /support/software (404).
- **§4:** Vendor and CMS table becomes: CMS sold today = **none** (Q1). Controllers: **NovaStar named on the site (PrecisionX)**; **Huidu per TINNOX (Q2), not on the site**; DsDevice named on the warranty page, identity INFERRED to be DSDevices (Q3 "maybe"). Delete the "per-screen licence" interpretation. Add the older marketing promises (mobile, portal, USB, multi-site cloud portal, 4G, Wi-Fi and wired) as inherited requirements.
- **§5:** Replace "re-branding someone else's service" with "nothing to replace". The interim white label remains an optional bridge (R8).
- **§7:** Add provisional brand tokens (Deep Teal #0f4761, Midnight #12212a, Signal Sky #72afc2; Manrope and Inter, both SIL OFL), pending the official assets (Q5).
- **§9 Gaps:** Replace with a pointer to open-questions §2 (answered) and the new TINNOX question list.
- New **§10 Back-office data location:** HubSpot, Zoho Desk and Google may process data in the US. The CMS will have its own AU-only privacy statement.

### 2.2 `docs/yodeck-workflow-audit.md`
- **§1.1, §1.2, §1.4:** Help centre (656 articles) and public OpenAPI read in full. Raise confidence for §3.2–3.11. The authenticated UI is still unobserved.
- **§3.1:** Workspace deletion **permanently deletes content**; only screens move out (REFUTED, AV1). Customer audit log has 7 columns and is Enterprise-only with 90-day retention. There are 8 partner staff permissions, and Support Login is on by default. Support is 24/5 for every plan.
- **§3.2:** Registration code is 9 digits, prefixes 0–9 (plus W and 10 per the help centre). Fire OS = 7, Android Play Store = 8. The factory pre-provisioning flow (5-hour window). Android cannot set time zone, NTP, network or resolution.
- **§3.3 and 3.4:** Five media states, spec-verified. Weekdays as a 7-character string, Monday first. 23 transitions. Tag ordering is alphabetical. Re-encoding of all uploads. The API returns no originals (confirmed).
- **§3.5 and 3.6, §4.1:** Zone is stored as `time_zone` plus `time_subzone`, with 23 AU subzones including aliases and fixed DST-season offset labels. Event and availability times are floating local, and the examples' `Z` suffix contradicts that. DST: 0 mentions. Integer priority, higher wins. "After N occurrences" and Turn-Screen-Off are official. Restart from item 1, with no resume point. Playback reports are generated in Etc/UTC.
- **§3.7–3.9:** Six content states (adds Pending Media). Push status is account-level with no job ID. No reboot endpoint (the third-party path is API Evangelist "modeled"). Status fields documented (`subset=player_status`). Update cadence every 6 weeks. Cached boot after 2 minutes. Offline 30–35/40 days with a warning 3 days before; schedule file reissued every 30 days. Screenshot cadence contradictions (30 s / 30–40 s / 1 h / 2 h). Support VPN on 24/7 with SSH (relevant to Q8). Pi thermal icons at 80–85 °C.
- **§3.10:** Partner terms first-party (10-screen minimum; USD 50 Reseller; USD 450/yr Whitelabel; suspension at 60 days, screens off at 90). Failed payment for direct customers: red flash after 5 days, drop to Free after 2 weeks. Yodeck Assurance USD 1/player/month. Media hosted in AWS eu-west-1 (help 456124); playback CSVs probably us-east-1 (INFERRED).
- **§3.11:** Rewrite. Spec is public (OpenAPI 3.1, 55 paths, 110 operations). Official rate limits. Six webhook topics with HMAC-SHA256 and a validation handshake; no device or health topics. Per-screen recipients.
- **§4.4:** Remove "webhooks beyond user events" from the missing list.
- **§5:** Mark C2, C3, C5 and C6 resolved, and add R7 X1–X25 as new rows or a pointer.
- **§6 and §7:** Add "round-2 full-page verification (AV1–AV5, R7)" and add the corpus and spec SHA to the evidence index.
- **§8:** Shrink the authenticated-session list to the items still UNKNOWN: DST behaviour, the zone picker UI, the Android time-zone field, download-hours format, webhook payload and retries, and customer visibility of partner Support Login.

### 2.3 `docs/rea-evaluation.md`
- **§3 and §5:** Note that app.yodeck.com (public spec) and help.yodeck.com are now reachable without authentication. Authenticated inspection still needs an operator-signed-in browser, so the decision (REA optional and selective) is unchanged. A one-line addendum is enough. Reading the public OpenAPI spec is not reverse engineering of Yodeck code (PROPOSED wording).

### 2.4 `docs/tinnox-mvp-spec.md`
- **§1:** Change "replaces that resold licence" to "**TINNOX sells no CMS today (Q1)**; TINNOX CMS is the first software sold with its hardware, to raise margin and create recurring revenue (Q7)". Release 1 is Australia only (Q6).
- **§4 In scope:**
  - Add "**Delivery routes**: TINNOX player (Linux CM5, Android) and **Huidu program push for async-only cards** (playlist, zones, time windows; sampled proof of play)".
  - Add "**Controller control adapter (read plus screen on/off, brightness schedule) for Huidu 'D' cards**". This is PROPOSED to move brightness and power from release 2 into release 1 for Huidu only, because the official API makes it cheap (R1). Otherwise keep it in release 2.
  - Add "**Plans, entitlements, licence states, quotas, billing export**" (R6).
- **§4 Out of scope:** Remove "SoC" and Windows as before. Change "documents beyond PDF" to "PowerPoint and web pages (release 2, Q11)". Remove "migration tooling" (Q12: none required).
- **§5 Domain model:**
  - Display: add `delivery_route` (tinnox_player | huidu_push | …), `controller` (vendor, model, device ID, firmware, key status) and `package_preset`.
  - New entities `Controller` and `Entitlement`/`LicenceState`.
  - PlaybackLog: retention per plan; `evidence_type` (logged | sampled).
  - AuditEvent: "24 months; support records 7 years WORM (R2)", fixing the A8 mislabel.
  - New `SupportGrant` (scope view/edit, expiry, approver, standing flag).
- **§6.6 and §7.3:** Canvas presets per TINNOX package (R5). Model the "content window inside the output mode" (offset plus size) natively.
- **§7.2:** Commissioning step for Huidu cards: write the TINNOX sdkKey once, set an Australian IANA zone (default is Asia/Shanghai), change or disable the AP password (`[sample default redacted]` is the sample default), record the key per card in a vault. Fix the REFERENCE (9-digit code with prefix).
- **§7.6: rewrite to the B+ policy (R2)**:
  - Device-ops scope always on under contract, logged.
  - Content and account scope needs a customer grant: request and one-click approve, view or edit, 24 h default, 7 days maximum, revocable.
  - Optional standing access (Managed tier, re-confirmed every 12 months).
  - Optional 24 h pre-authorised self-grant.
  - Break-glass: two TINNOX approvers, reason and incident number, 2 h, customer notified immediately.
  - Banner, dual audit, e-mail to admins on start.
  - No vendor (Huidu or NovaStar) access to tenants; offshore access requires an APP 8 assessment.
- **§8 Roles table:** "TINNOX Support (in session)" becomes "(with active grant or break-glass)". Add a "Grant support access" row for Customer Admin and Owner.
- **§9:** Brightness and power: release 1 for Huidu HTTP API, release 2 for others. Documents: PDF in release 1; PowerPoint and web pages in release 2 (TINNOX-player routes only). Migration: none (Q12). Advertising: deferred (R6).
- **§10.7:** "All customer data and media in AWS ap-southeast-2, DR in ap-southeast-4; CDN limited to the AU price class; no non-AU storage without a written opt-in (R3)."
- **§11:** Drop Pacific/Auckland (Q6). Picker shows canonical IANA names only, with offsets computed per date. Reject aliases and `Etc/*` (R7 P1, AV4 N2–N3). Push the site zone to Huidu cards through `setDeviceProperty`. Proof of play shown in site-local time, stored in UTC. State explicitly what restarts versus resumes after a priority event ends (AV4 N6).
- **§12:** States for the Huidu route: `pending → sent → card-downloaded (via getAll/md5) → playing (sampled)`, with a label showing it is not a play log.
- **§13:** Default offline alert of 30 minutes with a recovery alert (vs Yodeck's 6 h). Temperature and throttling telemetry with an alert before 80 °C. Per-display external recipients. Webhooks for device events (R7 P5).
- **§14:** Note that Android `DISALLOW_SYSTEM_ERROR_DIALOGS` does not restart a crashed app (R4 #16), so the player needs its own relaunch. Outdoor players rated for 60 °C or more and mounted in the cooled compartment. The RTC battery charging flag must be set.
- **§15:** Renditions per player profile (HEVC for CM5; H.264 for Android and Huidu). PDF in release 1.
- **§16:** API publishes rate limits with `Retry-After` and JSON 429 bodies; job IDs for commands (R7 P4, P6). Fix the Yodeck REFERENCE numbers.
- **New §20 Commercial model hooks (R6):** 12 months included, then the Essential, Professional and Managed tiers. Licence states demo → included → active → grace → suspended → expired. **A lapse locks publishing, never playback.** "Disabled, not deleted". Monthly billing export (Xero or MYOB to be confirmed). Prices ex GST, labelled "+ GST".
- **§18:** Provisional design tokens from the site (R5) until Q5 assets arrive.

### 2.5 `docs/architecture-and-hardware.md`
- **§1 row D and the design rule:** "Primary controller vendors: **Huidu (TINNOX Q2) and NovaStar (site packages)**." Two adapter classes: a content-delivery adapter (TINNOX player, Huidu program push, later Xixun or VNNOX) and a controller-control adapter (Huidu HTTP, NovaStar LAN).
- **§2 topology:** Add a second site diagram for "Huidu async card as player" (CMS → AU gateway or on-site agent → card :30080 on LAN or VPN), and remove "(Taurus …)" emphasis.
- **§3 questionnaire:** Add Huidu items (R1 §B): device ID contains "D"? Firmware version; Android or Linux series; HDMI-in present; key already written and by whom; HDPlayer schedules in use; 4G and NAT; AP password changed. Add NovaStar per-package model (TB60 capacity).
- **§4 matrix:** Pi row becomes **CM5 on an industrial carrier** (EDATEC ED-IPC3630 rated −25 to +60 °C). The Giada DN25 is about 0–45 °C, so it is not for outdoor use. The DN84 60 °C rating applies only at 0.7 m/s airflow. Expand the Huidu row: HTTP API on :30080 with HMAC-MD5 and no TLS; keys written once; no play log; no HTML; HDPlayer conflict; H6/H8 have HDMI-in. DSDevices row: DSCS9X/95 retired; DSDA1 current (Android 14). Android RK3588 row: written patch commitment required; Android version varies by SKU.
- **§5 routes:** Re-rank as follows. **Route 1, TINNOX player → HDMI → Huidu sync sender (T901/T902/VP) or dual-mode H6/H8, or NovaStar sync input: primary for walls, billboards and large pylons.** **Route 5, renamed "Huidu HTTP API program push": the fallback for async-only signs**, labelled "sampled proof of play". Huidu control adapter on dual-mode cards. Route 3 (VNNOX) and the Huidu cloud are excluded under the AU compliance rule until an AU region is documented. Route 2a (Taurus or Huidu APK) is a lab spike only.
- **§6 pilot:** Replace with the R4 table, amended for C1 and C3: indoor wall (CM5 → Huidu or NovaStar sender); outdoor pylon with HDMI controller (CM5 in a 60 °C-rated box, temperature log Jan–Feb 2027); async Huidu "D" card (no box; on-site agent or VPN baseline); LCD kiosk (RK3588 Android 14 device owner). Add the Q10 answer and the procurement rules ("D" cards only; 60 °C rating; Android patch commitment over 10 units; one SKU per year).
- **§7:** Apply R8's seven cell edits (D8). Bridge conditions: AU region in writing, White Label tier only, at most 20 screens and 3 customers, and an explicit conflict with B+ because of Xibo's standing access.
- **§8:** Object storage becomes S3 Sydney plus CloudFront in the AU price class, with R2 a gated opt-in. Identity stays Cognito Sydney. Add DR in Melbourne at USD 0.080/GB inter-region. Add an SCP that denies non-AU regions. Replace the cost table with R3 Option A (AUD 109 / 263 / 1,002 / 2,913) plus alternatives (Google +19–32 %; DigitalOcean pilot only; sovereign providers on contract). Egress is 35 % at 2,000 screens. Add a compliance worklist: APP 1 statement, NDB plan, Essential Eight ML2 self-assessment, supplier security pack.
- **§9:** Replace the blockers with the TINNOX question list in section 3.

### 2.6 `docs/implementation-backlog.md`
- **§0 milestone:** "one CM5 player feeding a Huidu (or NovaStar) sender" instead of "Raspberry Pi 5"; a parallel thin slice of "one Huidu D card driven by program push".
- **Epic A:** A1 adds the AU-only SCP, Melbourne DR and the KMS baseline (R3). A4 adds 24-month audit retention plus a 7-year WORM support log.
- **Epic B:** B6 adds package canvas presets and a content-window offset. New **B7: Huidu commissioning** (key write once, zone, AP password, vault).
- **New Epic M, Huidu adapter (P0 for the thin slice, P1 overall):**
  - M1 HTTP API client with signing.
  - M2 compile publication to programs (`replace`) with `playControl`.
  - M3 status, screenshot and sampled proof of play.
  - M4 control adapter for brightness, screen on/off and scheduled tasks.
  - M5 on-site agent or VPN transport.
  - M6 lab spike: gateway and reverse TCP.
  - M7 lab spike: APK on an A-series card.
- **New Epic N, Entitlements and billing (P1):**
  - N1 entitlement service and plans.
  - N2 licence-state machine (publishing locked, playback continues).
  - N3 quotas, including egress metering.
  - N4 monthly billing export.
  - N5 contracts screen and renewal reminders.
- **Epic H:** H1 is rewritten as "Support grants (B+): request and approve, scope, expiry, revoke, standing access, break-glass with dual approval, customer notifications".
- **Epic I:** I2 adds its own crash-relaunch watchdog (R4 #16). I1 and K5 need the box vendor's written patch commitment.
- **Epic K:** K2 targets the Huidu and NovaStar sender with the CM5. Add K7 (outdoor thermal log, Jan–Feb 2027), K8 (Huidu D-card API soak: push ≤ 2 min, schedules offline, HDPlayer conflict), K9 (TB60 capacity per PrecisionX package).
- **Epic L (later):** PowerPoint and web pages (release 2, TINNOX-player routes only); remove "migration tooling" (Q12); VNNOX and Xixun adapters; webhooks.
- **§2 sequencing:** Phase 0 adds Huidu commissioning and the Q-T1 identification. Phase 3 adds N1–N5 and the B+ H1.
- **§3 risks:** Add Huidu key lock-out on cards keyed by someone else; HDPlayer schedule conflict; no TLS on :30080; outdoor heat; Android patch policy; two controller vendors in release 1. Remove "current CMS vendor terms" (Q1).

### 2.7 `docs/acceptance-tests.md`
- **§0 fixtures:** Add package canvases 1376×774 and 768×448 (non-16:9) and one Huidu "D" card fixture (lab).
- **Huidu route tests (new HUI-xx; levels SIM against a mock :30080 server, and HW):**
  - HUI-01: commissioning writes the key once; a second write is refused and reported.
  - HUI-02: publish compiles to a program `replace`, and the card is playing within 2 minutes on LAN.
  - HUI-03: the site zone is applied to the card, and a 08:30 event plays at 08:30 local in Sydney and Brisbane.
  - HUI-04: the card keeps the schedule through a 24 h outage.
  - HUI-05: proof of play is shown as "sampled" with the screenshot cadence; it is never labelled audited.
  - HUI-06: brightness schedule and screen on/off are audited.
  - HUI-07: a card keyed by another party gives a clear console error.
  - HUI-08: :30080 traffic never crosses the public internet (agent or VPN only).
  - HUI-09: the AP password is changed or disabled at commissioning.
- **Support access tests (replace ISO-07 to ISO-09 and add ISO-12 to ISO-16):**
  - No content access without a grant.
  - The grant expires at 24 h and is capped at 7 days.
  - Revocation is immediate.
  - Standing access needs annual re-confirmation.
  - Break-glass needs two approvers, has a 2 h limit and notifies the customer immediately.
  - Device-ops scope works without a grant but cannot read media.
  - The audit log keeps 24 months searchable, and support records are in WORM storage.
- **Hosting and residency tests (extend NF-05, add NF-07 to NF-09):**
  - No resource outside ap-southeast-2 or -4 (SCP and IaC scan).
  - The CDN uses the AU price class only, and R2 is disabled unless opted in.
  - DR restore from Melbourne within 4 h.
  - The privacy statement lists data locations.
- **Entitlement tests (new ENT-xx):**
  - Suspended state: publishing locked, playback continues, and nothing appears on the public screen.
  - Downgrade disables but does not delete.
  - A seat quota refuses extra registrations.
  - Billing export totals match display-days.
- **Hardware tests:**
  - OFF-09: a player in an outdoor box at 45 °C ambient does not throttle and logs temperature.
  - MON-09: temperature alert before 80 °C.
  - UPD-07: the Android player relaunches after a crash.
- **SCH:** Add SCH-11: the zone picker shows canonical IANA names with date-correct offsets, and aliases are rejected. Remove the Auckland example from the PUB/SCH set.

### 2.8 `docs/open-questions.md`
- **§1:**
  - B1: public Yodeck help and spec now read in full; authenticated UI still not observed.
  - B2: update the reachable hosts (tinnox.com.au, help/app.yodeck.com, xibosignage.com, raw GitHub). Still blocked: www.yodeck.com, novastar.tech, huidu.cn, gitee, samsung.com, pip-assets.raspberrypi.com, docs.digitalocean.com.
  - B4: status unchanged unless the push succeeds.
- **§2: mark Q1–Q12 answered** (Q1 none; Q2 mainly Huidu and other Chinese vendors, **with NovaStar named on the site**; Q3 maybe DSDevices; Q4 one granted, name pending; Q5 later, provisional tokens in use; Q6 AU only; Q7 hardware bundle plus recurring, see R6 model; Q8 B+ proposed; Q9 strict AU and AWS Sydney + Melbourne proposed on numbers; Q10 CM5 + Huidu-as-player + RK3588 Android proposed; Q11 PDF in R1, PPT and web in R2; Q12 no migration). Add the new TINNOX question list (section 3 below) as Q13 onwards.
- **§3 Y-list:** Close Y1 partly, Y2, Y3, Y4 (CSV columns), Y5 partly, Y6, Y9, Y11 (spec public). Keep Y7 (UI), Y8 (DST) and Y10.
- **§4 Assumptions:**
  - A1 restated (no current CMS).
  - A2 changed (entitlements and billing export in release 1).
  - A3 changed (CM5, Android RK3588, Huidu controller-as-player).
  - A4 changed (LED controller is an HDMI sink **or** a player via the Huidu API).
  - A7 changed (PDF release 1; PPT and web release 2).
  - A8 changed (AWS Sydney + Melbourne, no R2 by default).
  - A12: Yodeck terms still unread (www.yodeck.com blocked).
  - Add A13 (retention 24 months / 7 years) and A14 (lapse never blanks a screen).
- **§5 hardware items:** Add the Huidu key write, HDPlayer conflict, reverse TCP, A7/A8 HDMI-in, CM5 RTC, outdoor thermal and TB60 capacity per package.
- **§6 next actions:** TINNOX answers section 3. Order one Huidu "D" card plus a CM5 box plus an RK3588 box. Legal review (APP entity status, UCT terms, APP 8 for vendor access, 7-year basis).

### 2.9 Proposed new `docs/decisions-2026-11.md`
- One table: decision, source (TINNOX answer or R-file), status (decided or PROPOSED), affected docs. This keeps the Q-answers and round-2 decisions out of the long docs and gives TINNOX one page to approve.

---

## 3. Remaining unknowns only TINNOX or real hardware can resolve

**Questions for TINNOX (short list):**
1. **Q-T1 (Q4):** What does the granted access document or e-mail look like? Is it a 16-hex `sdkKey` plus secret from Huidu support, a VNNOX AppKey/AppSecret, or something else? Who issued it, and when?
2. **Q-T2:** Per product package (PrecisionX, StructuraSign, DuraBlaze, Robust kiosks, custom pylons), which controller or player is fitted? Give make, model, full device ID (does it contain "D"?), firmware, and whether it has HDMI-in.
3. **Q-T3:** On Huidu cards already installed, has anyone (TINNOX, an installer, a distributor) written an SDK key? Are HDPlayer on/off schedules in use? How many cards are on 4G?
4. **Q-T4:** Is "DsDevice" on the warranty page DSDevices (dsdevices.com)? Which model, in which kiosks, running which app?
5. **Q-T5:** How many deployed screens per vendor, and how many customers would move to TINNOX CMS in year 1? This is needed for the cost and tier model.
6. **Q-T6:** Approve or amend the B+ support-access default and the 24-month / 7-year retention. Do any customers want a managed service (standing access)?
7. **Q-T7:** Commercial inputs: hardware gross margin per line, typical displays per customer, accounting system (Xero or MYOB), appetite for 12-months-included plus tiers, and a finance partner for Signage-as-a-Service.
8. **Q-T8:** Is TINNOX an APP entity (turnover above A$3M or Commonwealth contracts)? Any council, school or government buyers asking for IRAP, HCF or Australian-owned hosting?
9. **Q-T9:** Existing AWS or Google accounts, team skills, and a budget ceiling for the pilot environment.
10. **Q-T10:** Outdoor cabinet design: is there AC, a heat exchanger or fans, and where is the controller compartment? Can a temperature logger go into one pylon over Jan–Feb 2027?
11. **Q-T11:** Pixel resolutions for StructuraSign and DuraBlaze, and the NovaStar model per PrecisionX size (S3/S4 exceed the TB60).
12. **Q-T12:** What "Software Products", "DSIaaS", "Partner Login" and "Track Your Project" are meant to be, and the intended product name and URL.
13. **Q-T13:** Official brand assets (Q5) and whether the site's tokens (Deep Teal, Manrope and Inter) can be used meanwhile.
14. **Q-T14:** Should the Zoho Desk instance be on the AU data centre, and can tickets link to devices by serial only?

**Hardware-only unknowns (HARDWARE-DEPENDENT/UNVERIFIED):** whether a Huidu card dials out to TINNOX through `SetSDKTcpServer` behind carrier NAT; HDMI-in on A7/A8; CM5 EDID handshake with Huidu T901/VP and the NovaStar TB60 at native canvas; Taurus sync-mode accepted input sizes (only up to 2048 px wide per the TB40 listing); mpv HEVC in the kiosk session on CM5; thermal behaviour in a sun-loaded AU cabinet; RK3588 4K portrait playback and silent update with Play Protect; Huidu codec and font limits for pushed media; what HDPlayer schedules do after the HTTP API is enabled; factory-reset behaviour of a written key.

---

## 4. Confidence per round-2 file

| File | Confidence | Why |
|---|---|---|
| AV1 accounts/admin | **High** | 46 claims checked against the full local help corpus and spec; residual unknowns are on blocked www.yodeck.com |
| AV2 registration/API | **High** | Spec and full articles; 64 claims; 7 refutations well-evidenced |
| AV3 media/playlists | **High** | Spec plus full articles; minor unknowns only |
| AV4 layouts/scheduling | **High** for facts, **Medium** for the inferred label-generation explanation | DST absence proven by grep; behaviour still needs a live test |
| AV5 publish/monitor/offline | **High** | 87 claims; flags Yodeck's own contradictions honestly |
| R1 Huidu integration | **Medium-High** | Official API read in full via a byte mirror; product specs and reverse-TCP are THIRD_PARTY; Huidu sites blocked |
| R2 support access | **High** for patterns and Australian law; **Medium** for Samsung and LG (absence only) | Primary texts for Xibo, Yodeck and Signagelive; legal points need counsel |
| R3 AU hosting | **High** for AWS and Google unit prices and arithmetic; **Medium** for DigitalOcean, OCI and SMS | Price files re-parsed, model re-run, several corrections made |
| R4 player hardware | **Medium** | Pi facts verified, but the order rests on the unverified per-site Huidu model list; omits NovaStar (C1); retail prices undated |
| R5 TINNOX site | **High** | 43 pages read in full and re-fetched; inferences (DsDevice identity, placeholders) correctly downgraded |
| R6 commercial model | **Medium** | Competitor prices verified; tiers, renewal rate, mix and labour are INFERRED; conflicts with R2 on audit retention (C5) |
| R7 Yodeck API spec | **High** | Spec parsed and re-fetched with matching SHA; wire behaviour untested |
| R8 Xibo verification | **High** | Live pages and repository files; AU sub-processor and the #3884 issue still unknown |

Search log (this file): 1) "Zoho Desk Australia data centre zoho.com.au"; 2) "NovaStar Taurus TB60 HDMI input synchronous mode 1920x1200 specifications"; 3) "VNNOX server regions Australia AU node NovaStar cloud" (no relevant result; VNNOX AU region UNKNOWN). Sources: https://www.techpartner.news/news/zoho-expects-channel-boost-from-new-local-data-centres-531232 , https://help.zoho.com/portal/en/kb/accounts/manage-your-zoho-account/articles/data-center-for-zoho-account , https://dynamo-led-displays.co.uk/novastar-tb40-playback-box/ , https://audioeffetti.com/en/category/video/led-wall-management/novastar-m06020175-taurus-multimedia-player-4-gigabit-ethernet-ports-processing-capacity-of-up-to-2-3-mpixel-p23824 , https://procom-me.com/products/tb60-taurus-multimedia-player-and-control-box
