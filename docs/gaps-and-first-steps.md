# Gaps and first steps

Date: 2026-11-09. Status: PROPOSED review notes, for TINNOX to approve or amend.

This page is the result of re-reading the whole discovery pack on 2026-11-09 with one question in mind: what must happen first, and what is missing, if TINNOX wants to **launch a first version quickly while keeping fundamental security and Australian compliance in place**. No specific buyer is targeted yet. Requirements that only a large buyer (a university, a government agency) would impose are therefore listed in section 5 as "later", not as launch work.

How to read it:
- **Source** names the document and section a line comes from.
- **NOT IN DOCS** marks a recommendation made in this review. The rest of the pack does not contain it.
- **OUTSIDE KNOWLEDGE, unverified** marks general knowledge that was not checked against a source. Confirm it with an adviser before relying on it.
- Nothing here is legal advice. The legal facts in the pack are second-hand, because regulator and legislation sites were blocked during the research (`open-questions.md` B2).

## 1. Where the project stands

- **Desk research is finished.** Two rounds ran on 2026-11-03. Round 2 re-checked 312 claims from round 1: 186 confirmed, 82 corrected, 24 refuted, 20 unknown (`yodeck-workflow-audit.md` section 6.2).
- **Little is decided.** Of the 29 decisions, 4 are fully decided by TINNOX (DEC-01 to DEC-04), 6 are part-decided (DEC-05, 06, 08, 13, 24, 25) and 19 are proposals (`decisions-2026-11.md` section 1).
- **Q13 to Q26 are all unanswered** (`open-questions.md` section 2.1).
- **What remains is not research.** It is TINNOX's answers and approvals, tests on real hardware (15 items, `open-questions.md` section 5), and advice from an Australian lawyer (`open-questions.md` section 6 item 4).
- **There is no code, no CI, no named engineers and no start date** for the 22-week plan (`implementation-backlog.md` section 2).

## 2. First two weeks: checklist

Owner is TINNOX (Michael) unless stated.

### Week 1

- [ ] **Q13: find the vendor API grant.** Locate the e-mail or document. A 16-hex `sdkKey` plus secret means Huidu. An AppKey and AppSecret from the VNNOX Open Platform means NovaStar. Record who issued it, when, and any NDA, fee or expiry. No adapter work starts before this. (`open-questions.md` section 2.1 and section 6 item 1; DEC-06)
- [ ] **Q14, Q15, Q23: list the controller in each product package** (PrecisionX, StructuraSign, DuraBlaze, Robust kiosks, custom pylons): make, model, full device ID (does it contain "D"?), firmware, HDMI-in, pixel resolution. For installed Huidu cards: has anyone written an SDK key, are HDPlayer schedules in use, how many are on 4G. (`open-questions.md` section 2.1; `architecture-and-hardware.md` section 3)
- [ ] **Order the CM5 industrial box now**, with its clock backup battery and a temperature logger. It does not depend on Q13 or Q14, and it must be in a pilot pylon by the start of January 2027. Ask the supplier for the lead time. Order two if the budget allows, so one can stay in the pylon while bench work continues. (`implementation-backlog.md` section 2, K7. Ordering before Q14 and the second unit are NOT IN DOCS.)
- [ ] **Q22: name the pilot pylon** and describe its cabinet (cooling, controller compartment, access for the logger). Set an install date in mid December. (`open-questions.md` section 2.1. The date is NOT IN DOCS.)
- [ ] **Go through `decisions-2026-11.md`** and mark every PROPOSED row approve, amend or hold. Start with DEC-13 (hosting), DEC-17 and DEC-18 (support access and retention), DEC-20 and DEC-21 (player hardware), DEC-25 to DEC-27 (commercial), DEC-28 (Xibo bridge). (`open-questions.md` section 6 item 2)
- [ ] **Decide the reverse-engineering boundary** (section 6 below) and record it as a decision.

### Week 2

- [ ] **Engage an Australian lawyer.** The brief is in section 4.2.
- [ ] **After Q14: order the Huidu items**: two "D" engineering cards, a 4G router with VPN, a small Linux box for the on-site agent, and the RK3588 Android box with the supplier's written patch commitment. Confirm which HDMI sender and LED panel TINNOX can supply from stock for the first handshake test (K2). (`open-questions.md` section 6 item 3; `acceptance-tests.md` section 0 and HUI-08. Sender from stock is NOT IN DOCS.)
- [ ] **Answer the remaining questions**: Q16 to Q21 and Q24 to Q26. (`open-questions.md` section 2.1)
- [ ] **Confirm who builds it.** Name the two engineers (platform and portal; player and hardware) and the part-time designer, decide whether a third engineer for Epics M and N is funded, and set a start date. (`implementation-backlog.md` section 2. The start date is NOT IN DOCS.)
- [ ] **Add the launch security baseline to the backlog** (section 3) and give the compliance worklist an owner and dates (section 4). (NOT IN DOCS)
- [ ] **Engineers: start the platform work that does not wait for Q13 or Q14**: repository layout and CI, the AWS Sydney account with its security baseline (story A1), tenancy with row-level security (A2), identity with MFA (A3). (`implementation-backlog.md` section 2, phase 0)

## 3. Security: what the pack has, and the launch baseline

No software can be guaranteed free of vulnerabilities, and the pack does not claim it. What a first release can do is build the known controls, test them, and have one independent check before a customer's data goes in.

### 3.1 Already specified (keep)

| Control | Source |
|---|---|
| Customer isolation by PostgreSQL row-level security; 404 instead of 403; short-lived signed media URLs | `tinnox-mvp-spec.md` section 10; tests ISO-01 to ISO-06 |
| MFA for all users, lockout, session timeout; Cognito in Sydney | spec sections 6.1 and 17; `architecture-and-hardware.md` section 8 |
| Per-device credentials bound to hardware; outbound-only players with a read-only root | spec sections 10 and 14; ISO-10 |
| Signed player updates with rollback | spec section 14; UPD-03 |
| Cloud baseline: KMS keys, a policy that denies non-Australian regions, CloudTrail, Config, Security Hub, GuardDuty | architecture section 8; story A1; NF-05 |
| Support access by customer grant, two-person break-glass, audit log | spec section 7.6; ISO-07 to ISO-16 (awaits approval, Q18) |
| Huidu card: key in a vault, Wi-Fi AP password changed, port 30080 never on the public internet | DEC-10, DEC-11; HUI-01, HUI-07 to HUI-09 |
| Backup and restore tests | NF-04, NF-08 |

Two weak spots in this list:
- **MFA is stated two ways.** The spec says MFA for all users; test NF-02 only requires it to be "available" to customers. Pick one before launch.
- **The Huidu path is contained, not fixed.** The card's API is plain HTTP with a key that can be written once and never changed (`research/round2/R1-huidu-integration.md`). The on-site agent that bridges the card's LAN to the cloud has no hardening or update requirements anywhere in the pack.

### 3.2 Launch baseline: gaps to close for release 1 (PROPOSED, NOT IN DOCS unless a source is given)

These are small, cheap when done from the start, and expensive to retrofit.

| # | Item | Pack status today |
|---|---|---|
| S1 | **A one-page threat model** covering the portal, the player API, the on-site agent, the Huidu path and the update channel. Revisit it at each release. | Silent |
| S2 | **Dependency scanning and secret scanning in CI from the first commit.** | One line in spec section 17; no backlog story |
| S3 | **A written secure-coding baseline** the engineers agree to (for example a short checklist drawn from OWASP ASVS level 1; OUTSIDE KNOWLEDGE, unverified as the right level). | Silent |
| S4 | **Safe handling of uploaded files.** ffmpeg, libvips and Gotenberg/LibreOffice parse files that customers upload. Run them in an isolated worker with no network access and resource limits, and decide whether to add malware scanning. | Silent |
| S5 | **Signing-key custody.** Who holds the keys that sign player updates and manifests, where they live, how they are rotated. Manifest signing is one phrase in spec section 12 with no story or test. | Partly |
| S6 | **Rate limiting and lockout on every public endpoint**, not only the read-only API. | Partly (spec section 16) |
| S7 | **On-site agent requirements**: its own credentials, automatic updates, least access to the card's LAN. | Silent |
| S8 | **Controls on remote maintenance channels** ("ADB over VPN", "SSH or RDP over VPN" in architecture section 4): who may use them, logged how. | Silent |
| S9 | **A security contact** (an e-mail address and a short disclosure note) and a simple incident-response page that goes beyond the data-breach plan. | Partly (spec section 17 has the breach plan only) |
| S10 | **One independent penetration test with time to fix findings, before the first external customer.** The 22-week plan has no time for it. | One line in spec section 17; unscheduled |

### 3.3 Can wait

Secure boot and encrypted caches on players, an SBOM, SAST/DAST tooling beyond S2, streaming logs to a customer's SIEM. All are silent in the pack. None blocks a first release to small customers.

## 4. Australian compliance: what the pack has, and the launch baseline

### 4.1 Already covered

| Area | What the pack says | Source |
|---|---|---|
| Data location | All customer data and media stay in Australia (DECIDED). AWS Sydney with DR in Melbourne (PROPOSED). | DEC-13; `research/round2/R3-au-hosting-compliance.md` |
| Privacy Act and the Australian Privacy Principles | Covered from search summaries: APP 8 (overseas disclosure), APP 11 (security), the A$3M threshold, the Notifiable Data Breaches scheme. | R3 F3; `research/round2/R2-support-access-models.md` F3 |
| Support access and audit retention | The B+ policy; 24-month customer audit log; 7-year support records. | DEC-17, DEC-18 |
| Contracts and pricing | Unfair contract terms regime; prices shown with GST treatment. | `research/round2/R6-commercial-model.md` F5 |
| Government frameworks | IRAP applies to the AWS regions, not to TINNOX itself (INFERRED). An Essential Eight maturity level 2 self-assessment is on the worklist. | R3 F3; architecture section 8 |

### 4.2 Launch baseline (PROPOSED)

**The lawyer's brief.** The pack lists four items (`open-questions.md` section 6 item 4):
1. Is TINNOX an "APP entity" under the Privacy Act (Q20)?
2. Standard customer terms under the unfair contract terms regime: auto-renewal, price changes, suspension.
3. An APP 8 assessment for any vendor or offshore access to customer data.
4. The legal basis for keeping support records 7 years.

Add these (NOT IN DOCS, except where a source is given):
5. Yodeck's terms of service and the reverse-engineering boundary (section 6). The terms were never read (`open-questions.md` A12).
6. Use of third-party reverse-engineered NovaStar LAN protocols in a commercial product (`open-questions.md` section 5).
7. ffmpeg licensing (`architecture-and-hardware.md` section 8 says "confirm with counsel") and HEVC patent licensing, since DEC-22 chooses HEVC. (HEVC point is OUTSIDE KNOWLEDGE, unverified.)
8. A data-processing agreement template for customers.
9. Liability, indemnity and insurance in the customer contract. The pack does not mention them.

**The compliance worklist** already exists in `architecture-and-hardware.md` section 8 but has no owner and no dates. For launch it needs both:
- [ ] A privacy statement for the CMS that lists where data is stored (DEC-16).
- [ ] A data-breach response plan (spec section 17).
- [ ] The Essential Eight self-assessment.
- [ ] A folder of AWS's assurance reports (IRAP, ISO, SOC) to hand to buyers.
- [ ] A standard answer pack for security questionnaires.

The TINNOX website describes a compliance function (`tinnox-context.md` section 1). If it exists, it is the natural owner of this list.

**Loose ends that weaken "Australia only":**
- TINNOX's back office (HubSpot, Zoho Desk, Google, Meta) may process data overseas (DEC-16, Q26). Keep CMS customer data out of those systems.
- The optional Xibo Cloud bridge gives Xibo staff standing access to customer accounts (DEC-28). Avoid it unless a sale depends on it.
- The spec allows offshore media storage with a written opt-in (spec section 10 item 7). Keep it off for release 1.

**To check with an adviser** (the pack is silent on all three; whether they apply is OUTSIDE KNOWLEDGE, unverified):
- Regulatory marking (RCM) for the player boxes TINNOX would supply.
- Spam Act rules for alert e-mails sent to external addresses (DEC-29).
- Australian Consumer Law guarantees as they apply to a software subscription.

## 5. Deferred until a large buyer appears

The pack never names a university and contains no research on what one requires. "Monash" and "higher education" do not appear. Q20 asks only about council, school and government buyers. With no target buyer today, the items below are not launch work. They are listed so that nothing in release 1 makes them hard to add.

| Item | Pack status | Keep the door open by |
|---|---|---|
| Single sign-on (SAML or OIDC) and SCIM | Out of release 1, "when a customer requires it" (spec sections 4 and 9) | Keeping identity behind one interface. Architecture section 8 names Keycloak as the alternative if per-customer SAML federation is needed. |
| ISO 27001 or SOC 2 for TINNOX itself | Silent | Writing policies and keeping evidence from day one |
| Accessibility to a named standard (WCAG) | "Keyboard navigation and labelled controls" only (spec section 17, NF-06) | Using accessible components in the portal from the start |
| Whether Victorian public-sector privacy and data-security rules reach a university and its suppliers | Silent. R2 covers agencies, councils and schools only. | Asking the lawyer when a university sale becomes real |
| A buyer's own security questionnaire and contract schedule | Silent | Section 4.2's answer pack |
| Buyer restrictions on Chinese-made controllers (Huidu, NovaStar) on their network | Silent | Route (a), the HDMI route, keeps the controller off the buyer's network path to the cloud (DEC-09) |

That large buyers commonly ask for these is OUTSIDE KNOWLEDGE, unverified. When a first large prospect appears, ask for their supplier security questionnaire before quoting.

## 6. Decision needed: the reverse-engineering boundary

- TINNOX's answer to Q12 was that Yodeck is "just for us to do reverse engineering and learn" (`open-questions.md` section 2).
- The pack narrowed this to "reference only, nothing copied" and a PROPOSED policy: public documentation and observed workflows only, no decompiling, no replaying requests, writes only in a test workspace (`open-questions.md` section 3; `rea-evaluation.md` section 5).
- Nothing records TINNOX agreeing to the narrowing, and no legal analysis backs either position.

**What was actually done:** Yodeck's 656 public help articles and public API specification were read. Nobody signed in. Xibo's open-source code and manual were read; Xibo was rejected as a base and kept as a reference design (`architecture-and-hardware.md` section 7).

**Proposed decision (NOT IN DOCS):** adopt the narrowed policy as written, record it in `decisions-2026-11.md`, and hold any signed-in Yodeck session or Yodeck test player until the lawyer has read Yodeck's terms.

## 7. Hardware to prepare

Everything here is PROPOSED (DEC-20, DEC-21) and untested.

| Item | Qty | Order when | Source |
|---|---|---|---|
| Raspberry Pi CM5 industrial box, EDATEC ED-IPC3630 class, −25 to +60 °C, 8 GB / 32 GB eMMC, with clock backup battery | 1 (2 recommended) | Now | `open-questions.md` section 6; architecture section 6 |
| Temperature logger for the pilot pylon | 1 | Now | OFF-09; K7 |
| RK3588 Android 14 box with clock and watchdog (Geniatech APC3588Q class), with a written patch commitment | 1 | Any time; kiosks are a later phase | `open-questions.md` section 6; DEC-21 |
| Huidu "D" engineering card | 2 | After Q14 | `acceptance-tests.md` section 0; HUI-08 |
| 4G router with VPN; small Linux box as on-site agent | 1 each | After Q14 | DEC-10; HUI-08 |
| Huidu HDMI sender (T901, T902, VP series, or H6/H8); NovaStar sender or Taurus; LED panels | 1 set each | From TINNOX stock or a pilot site, after Q14 and Q23 | architecture section 6; K2, K9 |
| 1080p monitor; portrait 4K screen for kiosk tests | 1 each | Any time | `implementation-backlog.md` section 0 |

The pack says one Huidu card is the minimum, but test HUI-08 as written needs a second card behind the 4G router, and HUI-08 is an exit criterion for the first milestone. Plan for two.

**For a Yodeck test bench (optional, on hold under section 6):** a Yodeck account, a Raspberry Pi 4 with a 16 GB or larger Class-10 card, an HDMI screen, and an Android screen for one item (`research/round2/AV2-registration-api.md`; `yodeck-workflow-audit.md` section 8). The pack lists nothing to buy for this and treats it as optional.

## 8. Inconsistencies found in the pack

| # | Inconsistency | Where | Suggested reading |
|---|---|---|---|
| 1 | When to order pilot hardware: after TINNOX's answers and approvals, or in weeks 1 to 2 alongside them | `open-questions.md` section 6 versus `implementation-backlog.md` section 2 | Only the Huidu items depend on Q14. Order the CM5 box now. |
| 2 | "Retire hardware risks in week one" versus the controller handshake test "in week 3" | `open-questions.md` section 6 item 3 versus backlog section 3 | Week 3, once hardware has arrived |
| 3 | First milestone takes "8 to 10 weeks after the pilot hardware arrives" (week 3), yet is placed at week 10 | backlog section 0 versus section 2 | Expect about week 11 to 13 |
| 4 | The order list has no HDMI sender, NovaStar unit or LED panel, which tests K2 and K9 need | `open-questions.md` section 6 item 3 | TINNOX supplies them from stock (section 7) |
| 5 | Yodeck items still needing a signed-in session: four in one place, five in another | `open-questions.md` B1 versus section 6 item 5 | Five: Y1, Y5, Y7, Y8, Y10 |
| 6 | MFA "for all users" versus "available" to customers | spec section 17 versus NF-02 | Decide before launch (section 3.1) |
| 7 | The security line "penetration test before the first external customer" has no time in the plan | spec section 17 versus backlog section 2 | Add it (S10) |
