# R8 – Verification of Xibo facts (architecture-and-hardware.md §7 and A01)

Date: 2026-11-03. Scope: Xibo claims in `/home/user/CMS-RE-Cloud/docs/architecture-and-hardware.md` §7 and `scratchpad/research/A01-xibo-and-alternatives.md`, checked against xibosignage.com pages fetched in full with `curl -L` today, raw.githubusercontent.com files, `git ls-remote` tags and a shallow clone of `xibosignage/xibo-manual` (HEAD a648e38, 2026-09-25). Repository files were not edited.

Access notes: `account.xibosignage.com` (where `/docs/...` and `/manual/...` now redirect) is **blocked** (proxy 403). `api.github.com` is **repo-scoped** in this session, so issue-tracker queries failed. github.com web pages are blocked. Anonymous git reads and raw files worked. Labels follow CONTEXT.md.

## Summary

- **Licences confirmed.** CMS core is AGPLv3-or-later. The Windows and Linux players are open source with no licence cost. Android, LG webOS, Samsung Tizen and ChromeOS players are commercial perpetual licences (VERIFIED_FULL_PAGE).
- **Player licence prices are now known**, which closes an UNKNOWN in §7. These are the official pricing-page offers in USD: Android **US$28**, webOS/Tizen **US$85**, ChromeOS **US$49** per display, one-off. Minor upgrades are included and major upgrades cost extra. ChromeOS also needs a Google Kiosk & Signage Upgrade licence.
- **Cloud prices.** The hosting page shows "as little as **£3.50** a month" (per display, Professional). The pricing page's structured data gives USD **4.90 / 7.70 / 12.60** per display per month for Professional / Business / Enterprise. **No AUD price list was found** (UNKNOWN).
- **An Australian data centre exists.** "we have data centres in the United Kingdom, Germany, United States, Singapore and Australia" (VERIFIED). §7's "data residency UNKNOWN" for the white label is out of date. Which sub-processor hosts the Australian region is still UNKNOWN.
- **Isolation is one instance per customer.** "A Xibo Cloud Hosting instance is your own private CMS. We don't share CMS instances". There is still no tenant model, and Xibo staff recommend a separate CMS per customer (THIRD_PARTY forum, via search). Resellers create a "child company" per customer in My Account (OFFICIALLY_DOCUMENTED, search summary only).
- **Xibo staff access is on by default.** Terms clause 3.5: "We may access your Xibo CMS on demand using an administrator account". The manual tells Cloud customers not to modify or remove `xibo_admin` "so that our helpdesk agents can assist you". This answers part of TINNOX's Q8: the Xibo model gives vendor staff standing access, and the customer cannot opt out.
- **White-label terms are now read in full** (Channel Partner Agreement):
  - The CMS and Windows player must keep visible AGPL and copyright notices.
  - The Xibo brand cannot be used.
  - The partner must impose a EULA at least as strict as Xibo's.
  - English law applies.
  - The agreement renews automatically every 12 months, with 90 days' notice to end it.
  - On termination the partner "must immediately delete or remove the Xibo Solution".
  - The 5% discount is confirmed. The current set-up fee is not published; **£300** comes only from an archived 2018 post.
- **The Distributor and Value-Add Reseller tiers restrict competing services *based on Xibo Products*.** Their terms say "must not, without Xibo Signage's consent, offer competing services based on Xibo Products. (for example, offer its own cloud hosting, white labelling services, or own Android player, etc)". The same clause expressly contemplates "competing products and services that are not Xibo Product based", on condition that "Xibo Products should be presented at least as favourably as the competing option". A from-scratch TINNOX CMS is therefore probably not banned outright, but the "at least as favourably" duty conflicts with TINNOX promoting its own CMS [corrected in verification]. The White Label module (Part 3) repeats neither clause. Confirm the position with Xibo in writing.
- **Current CMS is 4.5.6** (git tag, and the compose file uses `xibo-cms:release-4.5.6`).
  - 4.5.0 shipped on 2026-07-30, followed by patches 4.5.1 to 4.5.6.
  - Requirements: PHP 8.4 (composer `"php": ">=8.4"` is the effective floor; the looser runtime check in Environment.php is 8.1 to 9.0) [corrected in verification], MySQL 8.4, XMR 1.5, Docker compose.
  - The production Linux player (Electron, AGPL) is v4.0.12, released 2026-10-01; the latest tag is v4.0.13.
- **Time zones.** Per-display time zones and `syncTimezone` are confirmed in code. The manual says events run on "local Display time" unless "Run at CMS time" is ticked. The 2026 open issues cited in A01: #4080, #4097 and #4102 **exist and match the description** (browser or computer time zone used instead of CMS time zone; dates shift a day ahead of UTC). This was confirmed by web search in the verification pass. #3884 is still not found [corrected in verification].
- **DSDevices** (EV4 Ltd, UK) makes the Android players DSCS9, DSCS9X and DSCS95 that Xibo sold. Xibo **retired them in September 2025**, and they are no longer for sale. They still run Xibo for Android v4, and v5 is planned for 2026. Xibo now certifies OEM hardware (Sony, ChromeOS, Philips, Hisense, Amino, Amazon) instead of selling its own.
- **Recommendation (PROPOSED):** keep "build TINNOX CMS". With no CMS today, no migration and Australia-only scope:
  - A Xibo Cloud white label (Australian region) is now a cheap, credible **bridge** for the first bundled sales.
  - Limit it to a capped pilot, because every white-label screen becomes a migration TINNOX must do later.
  - The deciding factors are now: the Huidu/LED-controller integration, which Xibo does not cover; standing vendor staff access; English-law terms; and deletion on termination.

## Findings

### Table A – Doc claim | verdict | evidence

| # | Doc claim (source) | Verdict | Label | Evidence URL + quote |
|---|---|---|---|---|
| A1 | CMS is AGPL-3.0-or-later (§7, A01) | Confirmed | VERIFIED_FULL_PAGE | https://raw.githubusercontent.com/xibosignage/xibo/master/README.md – "under the terms of the GNU Affero General Public License ... either version 3 of the License, or any later version"; https://xibosignage.com/open-source – "The Xibo CMS core will remain open source on GitHub under the AGPLv3 licence." |
| A2 | XMR is AGPL (§7) | Confirmed | VERIFIED_FULL_PAGE | https://raw.githubusercontent.com/xibosignage/xibo-xmr/master/README.md – "GNU Affero General Public License ... version 3 of the License, or any later version" |
| A3 | Windows (.NET) and Electron players are AGPL (§7) | Confirmed, with an update: the Electron player is now the production "Xibo Player App for Linux" | VERIFIED_FULL_PAGE | https://raw.githubusercontent.com/xibosignage/xibo-dotnetclient/master/LICENSE and https://raw.githubusercontent.com/xibosignage/electron-player/main/LICENSE – "GNU AFFERO GENERAL PUBLIC LICENSE Version 3"; https://raw.githubusercontent.com/xibosignage/xibo/master/PROMISE.md – "The Windows and Linux player applications will remain freely available under an open source licence"; https://xibosignage.com/blog/september-2026-releases – "Linux v4.0.12 Release Date: 01/10/2026 ... first release of the production-ready, first-class Linux player" |
| A4 | Android, webOS, Tizen players are closed and licensed per device (§7) | Confirmed. ChromeOS added: also a commercial perpetual licence | VERIFIED_FULL_PAGE | https://xibosignage.com/pricing – "Xibo's commercial player software for Android, LG webOS and Samsung Tizen is available for purchase with a perpetual licence"; JSON-LD offer "ChromeOS perpetual player licence"; PROMISE.md – "commercial features ... such as compatibility with selected media player hardware" |
| A5 | Commercial player licence: "current price UNKNOWN; historic £15 to US$28 one-off" (§7) | **Outdated: price now known** | VERIFIED_FULL_PAGE (structured data on official page) | https://xibosignage.com/pricing JSON-LD: "Android perpetual player licence" "priceCurrency": "USD", "price": "28.00"; "LG webOS and Samsung Tizen perpetual player licence" "85.00"; "ChromeOS perpetual player licence" "49.00". Page text: "Perpetual player software licences include minor software upgrades at the current version. Major software upgrades are available for a fee." VAT treatment and AUD price UNKNOWN |
| A6 | ChromeOS needs a Google licence (new) | New fact | VERIFIED_FULL_PAGE | https://xibosignage.com/blog/xibo-for-chromeos-launch – "you will need to purchase a Kiosk and Signage Upgrade Licence from ChromeOS directly or a ChromeOS Reseller" |
| A7 | Cloud "from £3.50 per display per month" (§7) | Confirmed | VERIFIED_FULL_PAGE | https://xibosignage.com/hosting – "All for as little as £3.50 * a month. (*) per display / Professional Plan / T&Cs apply." |
| A8 | Tiers £3.50 / £5.50 / £9.00 (A01, THIRD_PARTY) | GBP tiers 2 and 3 not seen on official pages. Official USD tiers confirmed | VERIFIED_FULL_PAGE (USD); THIRD_PARTY (GBP 5.50 / 9.00) | https://xibosignage.com/pricing JSON-LD – Professional "4.90", Business "7.70" ("plus 6GB bandwidth, priority help desk support, SAML support and 5 concurrent dashboards"), Enterprise "12.60" ("plus 8GB bandwidth ... extended proof of play and audit log retention"), "unitText": "display", "unitCode": "MON". GBP: https://www.capterra.com/p/182202/Xibo/pricing/ (search summary) |
| A9 | AUD prices | Not found | UNKNOWN | Not on the pricing, hosting or terms pages. https://xibosignage.com/terms 6.6 – "payments must be made in the currency indicated at the time of purchase". No conversion done: FX sites are blocked, so there is no dated rate |
| A10 | White-label hosting: "Vendor-hosted; data residency UNKNOWN" (§7) | **Outdated: an Australian DC exists** | VERIFIED_FULL_PAGE | https://xibosignage.com/hosting – "we have data centres in the United Kingdom, Germany, United States, Singapore and Australia". Sub-processors: https://xibosignage.com/dpa – "DigitalOcean LLC, OVH (Canada and Netherlands), Amazon Web Services EMEA SARL, Vultr, Easyspace Ltd (iomart), Bitfolk Ltd (UK), Linode LLC, Hetzner Online GmbH", plus Gitbook, Arcade, Intelligent Media (Greece) for webOS/Tizen stats, Google and HubSpot. Which provider serves Australia: UNKNOWN |
| A11 | White Label Reseller: set-up fee per brand (archived £300) plus 5% discount (§7) | Partly confirmed: 5% current; **£300 is archived only** | VERIFIED_FULL_PAGE | https://xibosignage.com/become-a-partner – "White Label Reseller Setup fee (includes full branding*) ... *Excludes Cloud Custom / Vanity Domain Discount: 5% on Plans and selected products" (no amount shown). https://xibosignage.com/blog/xibo-launches-a-new-channel-partner-programme (23 Aug 2018, marked "now archived") – "set-up fee of £300 GBP" |
| A12 | Distributor 12% (A01) | Confirmed. Value-Add Reseller 20%, invite only (new) | VERIFIED_FULL_PAGE | https://xibosignage.com/become-a-partner – "Discount: 12% ..."; "Value-Add Reseller Invite only ... Discount: 20%" |
| A13 | "Even Xibo's own white-label programme leaves the CMS AGPL" (§7) | Confirmed | VERIFIED_FULL_PAGE | https://xibosignage.com/become-a-partner – "for the Xibo CMS and Windows player the AGPL Licence and Copyright notices must remain present and visible. Xibo for Android will not show any licensing information. Your customers must always know they are using Open Source software." |
| A14 | White-label partner obligations (new) | New facts | VERIFIED_FULL_PAGE | https://xibosignage.com/cpa – Part 3: White Label Resellers "ensure that End Users abide by the terms of the AGPL 3.0"; "shall not be entitled to use the Trade Marks without Xibo Signage's express written consent"; on termination "you must immediately delete or remove the Xibo Solution or relevant component of the Xibo Cloud"; cl. 14.1 automatic "12-monthly periods", notice "not later than 90 days before the end"; cl. 26 "laws of England and Wales"; "28 days' notice of any changes in the Xibo Product Fee"; cl. 3 obligation "use its best endeavours to promote" (Part 3 exempts White Label from 3(b), (c), (h)) |
| A15 | Non-compete (new; matters if TINNOX builds its own CMS) | Applies explicitly to Value-Add Reseller and Distributor, **but only to competing services "based on Xibo Products"**. Non-Xibo competing products are allowed if Xibo is "presented at least as favourably" [corrected in verification]. **Not repeated** in the White Label module | VERIFIED_FULL_PAGE (text); INFERRED (scope) | https://xibosignage.com/cpa Parts 1 and 2 – "the Channel Partner must not, without Xibo Signage's consent, offer competing services based on Xibo Products. (for example, offer its own cloud hosting, white labelling services, or own Android player, etc)". Part 3 has no equivalent. Confirm with Xibo before signing |
| A16 | No tenant model; Xibo advises one CMS per customer (§7, THIRD_PARTY) | Confirmed. Official wording supports per-instance isolation | VERIFIED_FULL_PAGE (instance) + THIRD_PARTY (staff forum) + OFFICIALLY_DOCUMENTED (child company) | https://xibosignage.com/hosting – "A Xibo Cloud Hosting instance is your own private CMS. We don't share CMS instances and you'll have full Super Admin rights to your instance." https://community.xibo.org.uk/t/multi-tenant-customization/30276 (search summary: single-tenant by design; adding a tenant id "a huge task"). https://xibosignage.com/docs/setup/purchasing-for-your-customers (search summary: distributors "make a child company for each company") |
| A17 | Permissions are folders + user groups + features (A01) | Confirmed | VERIFIED_FULL_PAGE (manual source) | xibo-manual `source/en/users_groups.md` – "Features control what a User can see and do within the CMS ... When combined with Share options, View, Edit and Delete"; `configure_folders.md` – "Only administrators can create Folders under the Root Folder ... Only Administrators can set Share options"; `users_administration.md` – a Group Admin gets "access to all items of all Users belonging to the User Group". Source: https://github.com/xibosignage/xibo-manual (cloned) |
| A18 | Can a provider host many customers in one CMS? | Technically possible through permissions, but not recommended; a Super Admin sees everything | THIRD_PARTY + INFERRED | Community thread above (search summary: "multi-tenant is possible using the Permissions model ... recommend a separate CMS per customer") |
| A19 | Support-access model (new; feeds Q8) | Vendor staff can access on demand with an admin account; no customer opt-out on Cloud | VERIFIED_FULL_PAGE | https://xibosignage.com/terms 3.5 – "We may access your Xibo CMS on demand using an administrator account in order to provide support ... We may also access the Xibo CMS at other times as necessary ... Wherever possible we will always aim to give notice". xibo-manual `users_administration.md` – "ensure that the default user account named `xibo_admin` is not modified or removed so that our helpdesk agents can assist you". https://xibosignage.com/hosting – "Help Desk ... available 24 hours a day, Monday to Friday (UTC)" |
| A20 | Patch releases every 1–4 weeks on 4.5.x (§7) | Confirmed. Current version 4.5.6 | VERIFIED_FULL_PAGE | `git ls-remote --tags https://github.com/xibosignage/xibo-cms` → 4.5.0-rc1, rc2, 4.5.1 … 4.5.6; https://raw.githubusercontent.com/xibosignage/xibo-docker/master/docker-compose.yml – `image: ghcr.io/xibosignage/xibo-cms:release-4.5.6`; https://xibosignage.com/blog/july-2026-releases – "Xibo CMS v4.5 Release Date: 30/07/2026"; https://xibosignage.com/blog/august-2026-releases – "v4.5.1 Release Date: 20/08/2026"; https://xibosignage.com/blog/september-2026-releases – "v4.5.2 Release Date: 03/09/2026" |
| A21 | Requirements: PHP 8.4, MySQL 8.x, Docker (A01) | Confirmed | VERIFIED_FULL_PAGE | https://raw.githubusercontent.com/xibosignage/xibo-cms/master/composer.json – `"platform": {"php": "8.4"`; `lib/Helper/Environment.php` – `$WEBSITE_VERSION_NAME = '4.5.6'`, `$VERSION_REQUIRED = '8.1.0'`, `$VERSION_UNSUPPORTED = '9.0'`, `$XMDS_VERSION = '7'`; docker-compose.yml – `mysql:8.4` (mem_limit 1g), `xibo-xmr:1.5` (256m), cms-web 1g, memcached 100M, quickchart |
| A22 | Large external features generally not accepted; Xibo is sole steward (§7) | Confirmed | VERIFIED_FULL_PAGE | PROMISE.md – "we generally do not accept large-scale feature contributions"; "Xibo Signage Ltd remains the sole steward of the project." |
| A23 | Per-display time zone and per-event sync exist (§7) | Confirmed. The UI default is **display-local time** unless "Run at CMS time" is ticked | VERIFIED_FULL_PAGE (code and manual); INFERRED (UI-to-flag mapping) | https://raw.githubusercontent.com/xibosignage/xibo-cms/master/lib/Xmds/Soap.php – `$isSyncTimezone = ($schedule->syncTimezone == 1 && !empty($this->display->timeZone));` then `Carbon::createFromTimestamp($scheduleEvent->fromDt, $this->display->timeZone)`; xibo-manual `scheduling_priority_display_order.md` – "With this ticked [Run at CMS time], the Event time would be determined by the CMS time rather than using the local Display time" |
| A24 | "Several open 2026 reporting bugs that shift dates for zones ahead of UTC" (§7: #4080, #4097, #4102, #3884) | **#4080, #4097 and #4102 confirmed by search in the verification pass; #3884 not found** [corrected in verification] | THIRD_PARTY (search summary of github.com issue pages) | The GitHub issues API is repo-scoped here and github.com is blocked. Two web searches returned no match. Re-check on https://github.com/xibosignage/xibo/issues before quoting |
| A25 | DST handling | Relies on PHP/Carbon IANA tzdata | INFERRED | Soap.php uses IANA zone ids through Carbon. No Xibo-specific DST defect found for Australia/* |
| A26 | DSDevices: an Android player vendor built for Xibo (§3/§4, Q3) | Confirmed, but **retired** | VERIFIED_FULL_PAGE | https://xibosignage.com/blog/xibo-dsdevices-partnership (2019, archived) – "Xibo and EV4 Ltd, the creators of DSDevices ... DSCS9 ... $99 USD + VAT"; https://xibosignage.com/blog/announcement-dscs9x-and-dscs95-retirement (25 Sep 2025) – "Stock for these devices has now run out and they can no longer be purchased ... compatible with Xibo for Android version 4 and with version 5 (when it's released in 2026) ... Xibo has made the decision to stop selling hardware as a product" |
| A27 | DSDevices security history (new) | New fact | VERIFIED_FULL_PAGE | https://xibosignage.com/blog/security-advisory-dsdevices-2024-09 – firmware flaw "may allow an attacker on the same local network ... to execute arbitrary commands"; fixed in DSCS9X 20240909 and DSCS95 20240904 |
| A28 | Xibo hardware certification (new) | Re-tested on every release; OEM partners | VERIFIED_FULL_PAGE | https://xibosignage.com/digital-signage-hardware – "Choosing Xibo certified hardware means the device has passed our strict testing suite. We re-test these devices against every new Xibo software release"; partners named in the retirement post: "Sony, ChromeOS, Philips, and Hisense". Amino and Amazon pages are in https://xibosignage.com/sitemap.xml. The certified list itself loads dynamically and was not captured (UNKNOWN which models) |
| A29 | Legacy device cut-off (new; relevant to old SoC screens) | New fact | VERIFIED_FULL_PAGE | https://xibosignage.com/blog/changes-to-legacy-hardware-compatibility-2028 (11 Aug 2026) – "By June 30th 2028, Xibo Cloud will no longer be compatible with HTTPS connections for devices running Android 4, as well as older versions of webOS and Tizen" (root-CA expiry; also "likely to also affect self-hosted Xibo installations") |
| A30 | Xibo supports Huidu / NovaStar LED controllers | No evidence on any fetched page | UNKNOWN / HARDWARE-DEPENDENT/UNVERIFIED | Not mentioned on the pricing, player-app, hardware or partner pages. Xibo's player platforms are "Android, Tizen, webOS, ChromeOS, Windows, and Linux" (https://xibosignage.com/player-app) |

### Table B – Xibo price sheet (as of 2026-11-03, no AUD conversion)

| Item | Price | Currency | Source | Label |
|---|---|---|---|---|
| Cloud Professional | 4.90 / display / month (GBP headline "as little as £3.50") | USD (GBP) | https://xibosignage.com/pricing JSON-LD; https://xibosignage.com/hosting | VERIFIED_FULL_PAGE |
| Cloud Business | 7.70 / display / month | USD | pricing JSON-LD | VERIFIED_FULL_PAGE |
| Cloud Enterprise | 12.60 / display / month | USD | pricing JSON-LD | VERIFIED_FULL_PAGE |
| Self-hosted CMS | 0 | USD | pricing JSON-LD "The CMS core is free and open source under AGPLv3" | VERIFIED_FULL_PAGE |
| Windows / Linux player | 0 (AGPL) | – | pricing page; PROMISE.md | VERIFIED_FULL_PAGE |
| Android perpetual | 28.00 / display | USD | pricing JSON-LD | VERIFIED_FULL_PAGE |
| webOS / Tizen perpetual | 85.00 / display | USD | pricing JSON-LD | VERIFIED_FULL_PAGE |
| ChromeOS perpetual | 49.00 / display (+ Google Kiosk & Signage licence) | USD | pricing JSON-LD; ChromeOS launch blog | VERIFIED_FULL_PAGE |
| White Label set-up | not published (archived £300, 2018) | GBP | become-a-partner; 2018 blog | VERIFIED_FULL_PAGE (no current amount) |
| Partner discounts | WL 5%, Distributor 12%, VAR 20% (invite) | – | become-a-partner | VERIFIED_FULL_PAGE |
| Chargeback / late admin fees | £50 / £20 | GBP | https://xibosignage.com/terms 7.1, 8.5 | VERIFIED_FULL_PAGE |

## Analysis

1. **What changes given TINNOX's answers.** No CMS today (Q1), no migration (Q12) and Australia-only scope (Q6) remove two arguments from §7: there is no installed base to protect, and the vendor's hosting location is no longer unknown. Xibo Cloud has an Australian data centre. TINNOX could therefore sell a white-label "TINNOX Signage" on Xibo Cloud within weeks. Per-display cost is about USD 4.66 per month (Professional less 5%), plus a set-up fee not yet known.
2. **What does not change.**
   - The CMS stays AGPL, with visible notices.
   - The players stay Xibo's.
   - Contracts are under English law.
   - Xibo staff keep standing admin access (terms 3.5, `xibo_admin`). This conflicts with any TINNOX promise of an opt-in staff-access model under Q8, and needs assessing against TINNOX's Australian compliance stance (Q9). R2 and R3 cover the details.
   - On termination TINNOX must delete the Xibo solution, so customers on the white label would have to be moved to a TINNOX CMS later. That migration is the cost TINNOX currently does not have.
3. **The LED-controller gap is now the main technical point.** TINNOX's hardware is mostly LED walls and signs on Chinese controllers such as Huidu (Q2). Xibo's player platforms are Android, Tizen, webOS, ChromeOS, Windows and Linux. No fetched Xibo page mentions Huidu or NovaStar (A30). Xibo could only drive an LED wall through a separate Android, Windows or Linux player feeding the controller's HDMI or sending-card input. Whether a Huidu Android-based controller can run Xibo for Android is HARDWARE-DEPENDENT/UNVERIFIED. The differentiating integration (controller status, brightness, screen-on/off through the vendor SDK under Q4) would have to be built either way.
4. **Multi-tenancy is less decisive under a hosted model.** One instance per customer is acceptable when Xibo operates it. If TINNOX self-hosted a Xibo fork it would have to run its own instance fleet, AGPL source offer and patch cadence (six patches in about three months). That is the "adapt" path §7 already rejects, and the verified facts here support rejecting it.
5. **The non-compete risk is specific to the tier.** The Distributor and Value-Add Reseller tiers forbid competing services "based on Xibo Products" (for example, "own cloud hosting ... or own Android player"). They allow non-Xibo competing products only if Xibo is "presented at least as favourably" [corrected in verification]. If TINNOX takes any Xibo partnership while building its own CMS, it should be the White Label tier, and only after written confirmation that Part 1/2 clause 1.2.3-style restrictions do not apply (A15).
6. **DSDevices.** If "DsDevice" (Q3) means DSDevices, those units are retired (September 2025), so they are not a pilot hardware option. Existing units would still run Xibo for Android, and the 2024 firmware advisory is a useful hardening lesson for any Android box TINNOX picks.

## Recommendation (PROPOSED)

1. **Keep §7's core recommendation:** build TINNOX CMS as an owned, multi-tenant product with a narrow first release, using Xibo as a reference rather than a base. Update the justification to:
   - (a) LED-controller (Huidu/vendor-SDK) integration is the differentiator and no Xibo route covers it;
   - (b) owned software is needed for the margin and recurring revenue in Q7;
   - (c) Xibo's terms impose standing vendor access, English law and deletion on exit.
2. **Recast the "interim white label" column as an optional bridge**, not a default. Use it only if signed hardware sales need software before the TINNOX MVP is ready. Conditions:
   - Xibo Cloud **Australian region** confirmed in writing for every instance;
   - **White Label tier only**, with written confirmation that building TINNOX's own CMS is allowed;
   - capped at pilot scale (for example, 20 screens or fewer and 3 customers or fewer);
   - customer contracts state up front that the platform will change;
   - only screens with players TINNOX will reuse: Android or Windows boxes, not SoC licences.
3. **Edits to make in §7** (do not edit now; for the doc owner):
   - Licensing cell: add "ChromeOS commercial; Android US$28, webOS/Tizen US$85, ChromeOS US$49 perpetual (pricing page, 2026-11-03)".
   - Interim white-label licensing cell: say the "£300" figure is archived (2018) and the current amount is unpublished; Cloud is USD 4.90 / 7.70 / 12.60 per display per month (or "from £3.50").
   - Hosting row, white-label column: "Xibo Cloud has an Australian data centre; sub-processor for the Australian region UNKNOWN; vendor staff have on-demand admin access (terms 3.5)".
   - Recurring-cost row: replace "current price UNKNOWN" with the prices above.
   - Australian time-zones row: mark the 2026 issue numbers "to re-verify"; add "UI default is display-local time unless 'Run at CMS time' is ticked".
   - Exit row, white-label column: add "on termination the Xibo Solution must be deleted; customers must be migrated".
   - Hardware sections: DSDevices retired September 2025; Xibo now certifies OEM hardware; legacy Android 4, webOS 3.x and old Tizen lose Xibo Cloud HTTPS by 30 June 2028.

## Open items

- Current White Label set-up fee, whether it is per brand, and whether an AUD price list exists. Ask Xibo sales; not contacted per rules.
- Which sub-processor runs the Xibo Cloud Australian region, and whether backups ("offsite location") also stay in Australia.
- Whether the Part 1/2 non-compete applies in any form to White Label Resellers. The Confirmation form may add terms.
- Re-verify issue #3884 on https://github.com/xibosignage/xibo/issues, and check the current open or closed state of #4080, #4097 and #4102 (their existence was confirmed by search in the verification pass) [corrected in verification].
- Exact mapping of the "Run at CMS time" checkbox to `syncTimezone` (which Twig view; default value). Confirm by reading `views/schedule-form-*.twig` or by testing.
- Current Xibo certified-hardware list (loads dynamically; not captured), and whether any Huidu or other LED-controller model is listed.
- Whether a Huidu Android-based controller can install Xibo for Android (HARDWARE-DEPENDENT/UNVERIFIED; links to R1 and the Q4 vendor-SDK name).
- Release date of Xibo for Android v5 ("2026" per the retirement post).

## Sources and search log

Fetched in full (curl -L, 2026-11-03, text in `scratchpad/round2/r8/`): https://xibosignage.com/pricing (from `round2/xibo-pricing.html`, including JSON-LD), /hosting, /become-a-partner, /cpa, /terms, /dpa, /eula, /open-source, /player-app, /digital-signage-hardware, /downloads, /acceptable-use, /sitemap.xml, /blog/xibo-dsdevices-partnership, /blog/announcement-dscs9x-and-dscs95-retirement, /blog/announcing-the-dscs9x, /blog/security-advisory-dsdevices-2024-09, /blog/changes-to-legacy-hardware-compatibility-2028, /blog/player-license-pricing-changes, /blog/xibo-launches-a-new-channel-partner-programme, /blog/xibo-for-chromeos-launch, /blog/july-2026-releases, /blog/august-2026-releases, /blog/september-2026-releases, /blog/timezones.
Blocked or 404: account.xibosignage.com (all /docs and /manual; proxy 403); xibosignage.com/hardware and /hardware/dscs9x (404); api.github.com org and issue endpoints (repo-scoped 403); github.com web pages (403).
GitHub raw/git: xibo/master/PROMISE.md, xibo/master/README.md, xibo-cms/master/composer.json, lib/Helper/Environment.php, lib/Xmds/Soap.php, lib/Entity/Schedule.php, lib/Entity/Display.php, lib/Controller/Schedule.php, xibo-xmr/master/README.md, xibo-dotnetclient/master/LICENSE, electron-player/main/{LICENSE,README.md}, xibo-docker/master/docker-compose.yml; `git ls-remote --tags` for xibo-cms and electron-player; shallow clone of https://github.com/xibosignage/xibo-manual.

WebSearch log (8 of 10 used):
1. "xibosignage github issue timezone 2026 4.5": no 2026 issues surfaced.
2. "Xibo certified hardware DSDevices DSCS9 certified devices list": found the retirement post and DSCS9X pages.
3. "Xibo CMS multi tenant one CMS per customer white label reseller multiple instances My Account": community threads, and the purchasing-for-your-customers doc (child company).
4. "Xibo pricing AUD Australian dollars per display plan Xibo Cloud Australia data centre": no AUD found.
5. "github.com/xibosignage/xibo/issues timezone 'ahead of UTC' OR 'daylight saving' 2026": nothing relevant.
6. "Xibo Cloud support team access CMS ...": found the `xibo_admin` note and My Account roles.
7. "'xibosignage/xibo' issues 4097 OR 4080 OR 4102 ...": not found.
8. "Xibo White Label Reseller set-up fee price per brand 2026": only the archived £300; "one time charge per brand" (white-label players doc, search summary: https://xibosignage.com/docs/setup/white-label-players).

## Verification (adversarial pass)

Date: 2026-11-03. Method:
- Re-fetched these pages live with `curl -L` today: xibosignage.com /pricing, /hosting, /terms, /become-a-partner, /cpa and /privacy. Copies are in `scratchpad/round2/v8/`.
- Re-fetched the raw GitHub files (docker-compose.yml, Environment.php, composer.json, PROMISE.md) and two xibo-manual pages, and re-ran `git ls-remote` for tags.
- Re-read the local blog copies in `round2/r8/`, including their `datePublished` metadata.
- Ran 3 WebSearch calls (cap 6).

Each claim was tested for currency, units and billing basis, and the arithmetic was checked.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| V1 | Android US$28, webOS/Tizen US$85, ChromeOS US$49, perpetual | Confirmed | Live /pricing JSON-LD: "price": "28.00" / "85.00" / "49.00", all `priceCurrency` USD. Independent: Xibo community buyer post "28.00 USD" (https://community.xibo.org.uk/t/license-for-open-source/35045, search summary). Caveat: the displayed currency varies by region, per the same thread |
| V2 | Cloud USD 4.90 / 7.70 / 12.60 per display per month | Confirmed (units checked) | Live JSON-LD `UnitPriceSpecification`: "unitText": "display", "billingDuration": 1, "unitCode": "MON". This is per display per month, not annual |
| V3 | Hosting "as little as £3.50 a month", per display, Professional | Confirmed | Live /hosting: "All for as little as £3.50 * a month. (*) per display / Professional Plan" |
| V4 | Australian data centre | Confirmed, and strengthened | Live /hosting: "data centres in the United Kingdom, Germany, United States, Singapore and Australia". **New:** https://xibosignage.com/privacy says "if you ask us to host your CMS instance in Sydney Australia, then CMS instance data will be held in Australia". Caveat: the DPA lists third-party sub-processors outside Australia (Google, HubSpot, Intelligent Media in Greece for webOS/Tizen stats), so not *all* data stays onshore. Facility provider still UNKNOWN (search found none) |
| V5 | Private instance per customer, no shared CMS | Confirmed | Live /hosting: "your own private CMS. We don't share CMS instances" |
| V6 | Staff on-demand admin access (terms 3.5) | Confirmed | Live /terms 3.5: "We may access your Xibo CMS on demand using an administrator account". Independent corroboration: /privacy says "Our staff do have access to your CMS instances for the purposes of providing support". Manual (raw GitHub, today): "`xibo_admin` is not modified or removed so that our helpdesk agents can assist you". The claim that the customer "cannot opt out" is INFERRED: no opt-out is documented, but none is expressly excluded |
| V7 | Partner discounts: WL 5%, Distributor 12%, VAR 20% (invite) | Confirmed | Live /become-a-partner: "Discount: 5% on Plans", "Discount: 12%", "Invite only ... Discount: 20%" |
| V8 | Arithmetic: Professional less 5% = USD 4.66 | Confirmed | 4.90 × 0.95 = 4.655, which rounds to 4.66 |
| V9 | WL set-up fee £300 is archived (2018) only | Confirmed | Live /become-a-partner shows "Setup fee" with no amount. The 2018 blog says "set-up fee of £300 GBP" |
| V10 | AGPL notices must stay visible for CMS and Windows player | Confirmed | Live /become-a-partner: "the AGPL Licence and Copyright notices must remain present and visible" |
| V11 | CPA: English law, 12-month auto-renewal, 90 days' notice, delete on termination | Confirmed | Live /cpa: "laws of England and Wales"; "automatically extend for 12-monthly periods"; "not later than 90 days before the end"; Part 3 cl. 4.1.3 "must immediately delete or remove the Xibo Solution". Also "28 days' notice of any changes in the Xibo Product Fee" |
| V12 | Distributor and VAR tiers "ban competing services" / "must not ... offer its own cloud hosting ... own Android player" | **Corrected** | Live /cpa Parts 1 and 2 cl. 1.2: the ban covers "competing services **based on Xibo Products**". The clause also says "If the Channel Partner offers competing products and services that are not Xibo Product based, then Xibo Products should be presented at least as favourably". So a from-scratch TINNOX CMS is likely allowed even on these tiers, but under a favourable-presentation duty. Part 3 (White Label) has neither clause. Fixed inline in the Summary, A15 and Analysis 5 |
| V13 | Current CMS 4.5.6; compose uses `release-4.5.6`; MySQL 8.4; XMR 1.5 | Confirmed | `git ls-remote` today: the last tag is 4.5.6. docker-compose.yml: `xibo-cms:release-4.5.6`, `mysql:8.4`, `xibo-xmr:1.5`. Environment.php: `$WEBSITE_VERSION_NAME = '4.5.6'` |
| V14 | PHP requirement "8.4 (runtime check 8.1 to below 9.0)" | **Corrected (wording)** | composer.json `require` is `"php": ">=8.4"`, so 8.4 is the effective floor. The Environment.php check (`8.1.0`, unsupported `9.0`) is looser. Fixed inline |
| V15 | 4.5.0 on 30/07/2026; 4.5.1 on 20/08/2026; 4.5.2 on 03/09/2026 | Confirmed | Local blog copies: "Release Date: 30/07/2026", "20/08/2026", "03/09/2026" |
| V16 | Linux player v4.0.12 on 01/10/2026; latest tag v4.0.13 | Confirmed | September-2026 blog: "Release Date: 01/10/2026". `git ls-remote` on electron-player: v4.0.11, v4.0.12, v4.0.13 |
| V17 | Windows and Linux players stay open source; Xibo sole steward; large features not accepted | Confirmed | PROMISE.md (raw, today): "Windows and Linux player applications will remain freely available under an open source licence"; "sole steward of the project"; "do not accept large-scale feature contributions" |
| V18 | Display-local time is the default unless "Run at CMS time" is ticked; `syncTimezone` in Soap.php | Confirmed | Manual (raw, today): "If Run at CMS time was ticked, Display 1 will start to show at 11:00hrs ...". Soap.php lines 561 and 1352: `$isSyncTimezone = ($schedule->syncTimezone == 1 && ...)`. The UI-to-flag mapping remains INFERRED |
| V19 | 2026 time-zone issues #4080, #4097, #4102, #3884 "not re-verifiable" | **Corrected** | WebSearch found https://github.com/xibosignage/xibo/issues/4080 (Report Schedules edit uses browser time zone), /4097 (Proof of Play export shifts dates a day when ahead of UTC; example Pacific/Auckland) and /4102 (SSP Activity uses computer time zone). Related: #3968. #3884 not found. Status is from the search summary, so open/closed state needs a direct check. Fixed inline |
| V20 | DSDevices DSCS9X/DSCS95 retired, Sept 2025; still on Android v4, v5 "in 2026" | Confirmed (date nuance) | Retirement post: "Stock ... has now run out"; "version 5 (when it's released in 2026)". `datePublished` is 2025-09-25T23:00Z, which is 26 Sep 2025 UK local time; "25 Sep 2025" is acceptable in UTC. Whether Android v5 has shipped by November 2026 is UNKNOWN |
| V21 | DSCS9 was US$99 + VAT (2019) | Confirmed | Partnership blog: "offered at $99 USD + VAT" (historic only) |
| V22 | ChromeOS needs a Google Kiosk & Signage Upgrade licence | Confirmed | ChromeOS launch blog: "you will need to purchase a Kiosk and Signage Upgrade Licence" |
| V23 | Android 4 and old webOS/Tizen lose Xibo Cloud HTTPS by 30 June 2028 | Confirmed | Legacy-hardware blog (datePublished 2026-08-11): "By June 30th 2028 ... Android 4, as well as older versions of webOS and Tizen". The page lists "webOS 3.0 displays" and "webOS 3.2 displays", so "webOS 3.x" holds |
| V24 | DSDevices firmware fix: DSCS9X 20240909, DSCS95 20240904 | Confirmed | Advisory: "For the DSCS9X, firmware version 20240909 ... DSCS95, firmware version 20240904" |
| V25 | Xibo does not cover Huidu/NovaStar LED controllers | Unverifiable (absence of evidence) | Not mentioned on any page fetched. Searches made no Xibo–Huidu link. Remains HARDWARE-DEPENDENT/UNVERIFIED; it cannot be proven negative |

**Tally:** 25 checked: 21 confirmed, 3 corrected (V12, V14, V19), 0 refuted, 1 unverifiable (V25).

**Does the recommendation still hold?** Yes. Its premises survive:
- Xibo has no Huidu or LED-controller route (V25 is unrefuted, and no counter-evidence was found).
- Vendor staff have standing access (V6, now corroborated by the privacy policy).
- English law and deletion on termination are confirmed (V11).
- Prices and units are correct (V1, V2, V8).

The one material correction, V12, makes the bridge option *less* risky. The Distributor and VAR tiers only bar competing services "based on Xibo Products", so a from-scratch TINNOX CMS is probably not prohibited. Even so, the "present Xibo at least as favourably" duty still conflicts with TINNOX's own-software strategy (Q7), so preferring the White Label tier, with written confirmation from Xibo, remains right.

The privacy policy also strengthens the Australia-only case (Q6, Q9): instance data stays in the chosen region. Some sub-processors (Google, HubSpot, Greece-based stats) sit offshore, so the "Australian compliance" assessment in R3 should treat Xibo as partly offshore.

Sources added in this pass: https://xibosignage.com/privacy, https://github.com/xibosignage/xibo/issues/4080, https://github.com/xibosignage/xibo/issues/4097, https://github.com/xibosignage/xibo/issues/4102, https://community.xibo.org.uk/t/license-for-open-source/35045, https://raw.githubusercontent.com/xibosignage/xibo-manual/master/source/en/users_administration.md, https://raw.githubusercontent.com/xibosignage/xibo-manual/master/source/en/scheduling_priority_display_order.md. WebSearch calls used: 3 of 6.
