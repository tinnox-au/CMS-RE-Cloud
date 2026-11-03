# TINNOX business context for the TINNOX CMS

Date: 2026-11-03. Working product name: **TINNOX CMS**.

How to read this document. tinnox.com.au was read in full on 2026-11-03 (all 43 sitemap pages, plus legacy URLs the earlier draft cited). The page-by-page record is `research/round2/R5-tinnox-site.md`. The site was rebuilt between 2026-10-31 and 2026-11-03, so several claims taken from search snippets of the old site no longer appear. Those are marked **no longer on site (2026-11-03)**. That means they cannot be confirmed now; it does not prove they were wrong.

Every statement carries one of these labels:

- **VERIFIED_FULL_PAGE**: read in full on the official page or document named in the source column, on 2026-11-03.
- **OFFICIALLY DOCUMENTED**: an official page or specification seen only through a search summary, because the host was blocked.
- **THIRD PARTY**: directories, social profiles, blogs, resellers. Lower confidence.
- **INFERRED**: a deduction from the above. Treat as a hypothesis.
- **PROPOSED**: a requirement or positioning choice this document recommends for the product. Not a fact about TINNOX.
- **UNKNOWN**: searched for, not found. Listed so it can be asked.

TINNOX's own answers to the twelve open questions (Q1 to Q12) are client decisions, not evidence labels. They are marked **DECIDED (TINNOX Qn)**. The full set is recorded in `open-questions.md` §2.

No personal names, personal contact details or customer names are recorded. Customers are described by sector only.

## 1. Company profile

| Attribute | Finding | Label | Source |
|---|---|---|---|
| Trading name | TINNOX (all caps in site copy) | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Legal entity | UFL Technology Pty Ltd trading as Tinnox (footer and JSON-LD `legalName`) | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| ABN | 12 656 209 639, Australian private company, main location VIC, GST registered, active from 21 Dec 2021 | VERIFIED_FULL_PAGE (ABN shown in site footer); registry details carried from the earlier draft and not re-checked in round 2 | https://tinnox.com.au/ , https://abr.business.gov.au/ABN/View?id=12656209639 |
| Positioning | "Australian Outdoor Display Specialists"; LED video walls, digital kiosks, outdoor LED displays and LED hire, "delivered and installed nationwide" | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Headquarters | Level 3, 235 Queen Street, Melbourne VIC 3000. This is first-party data (JSON-LD `address` and footer). | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Warehouse | 359 Bluff Road, Hampton VIC 3188. The retail page describes a local test-build warehouse with "over 400sqm of LED cabinets". | VERIFIED_FULL_PAGE | https://tinnox.com.au/ , https://tinnox.com.au/industries/digital-signage-for-retail/ |
| Other offices | Sydney (Surry Hills), Brisbane, Perth and Canberra (ACT), listed in the site-wide footer | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Coverage | JSON-LD `areaServed` is Australia. The projects page says installs are "around Australia and New Zealand". The earlier claim "LED wall hire only in VIC and NSW" is no longer on site (2026-11-03). | VERIFIED_FULL_PAGE | https://tinnox.com.au/ , https://tinnox.com.au/projects/ |
| Market for release 1 | Australia only. New Zealand comes later as a data change, not a code change. | DECIDED (TINNOX Q6) | TINNOX answer |
| Certifications | ISO 9001, ISO 14001 and ISO 45001; the government page says "JAS-ANZ". No certificate numbers are given. | VERIFIED_FULL_PAGE | https://tinnox.com.au/iso-certifications/ , https://tinnox.com.au/industries/digital-signage-for-government/ |
| Governance claims | Compliance team, annual ethics training, internal and third-party audits, a Chief Compliance Officer, and a link to a compliance portal subdomain. The subdomain was blocked from this environment. | VERIFIED_FULL_PAGE (subdomain UNKNOWN) | https://tinnox.com.au/ethics-and-compliance/ |
| Delivery model | Installation is "conducted by our network of certified installation partners"; a "global network of channel partners, suppliers, and subcontractors" | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Size | 11 to 50 employees (aggregator estimate). Not stated on the site. | THIRD PARTY (earlier draft; not re-checked in round 2) | https://zoominfo.com/c/tinnox/1318605509 |
| Founded | Not stated on the site. LinkedIn says 2015; the ABN was registered in Dec 2021; a directory says "over ten years" in AU and NZ. Conflicting. | THIRD PARTY (earlier draft; not re-checked in round 2) | https://au.linkedin.com/company/tinnox , https://diib.com/featuredmembers/tinnox/ |
| Business contact | Phone 1300 846 669 ("1300 TINNOX"); enquiry@ and support@ business mailboxes at tinnox.com.au. Warranty claims go "via a support ticket or" the support mailbox. | VERIFIED_FULL_PAGE | https://tinnox.com.au/support/ , https://tinnox.com.au/product-warranty/ |
| Support channel | /support/ is a ticket form (name, e-mail, device serial number, subject, description, up to 5 attachments of 20 MB, restart checkbox). It submits to Zoho Desk. | VERIFIED_FULL_PAGE | https://tinnox.com.au/support/ |

## 2. Product lines

The current range is a set of named packages. All rows are VERIFIED_FULL_PAGE unless marked. "n/p" means not published.

| Package | Type | Pitch | Published sizes or canvas (px unless stated) | Controller or player named on site | Source |
|---|---|---|---|---|---|
| PrecisionMicro™ | Indoor LED, boardroom | P1.25 / P1.5625 / P1.875 | S1 to S3 1920×1080; S4 2240×1260 | "a NovaStar media-player/controller" | https://tinnox.com.au/led-video-wall/precisionmicro/ |
| PrecisionPro™ | Indoor LED, showroom | P1.86 | S1 1376×774, S2 1720×946, S3 2064×1204, S4 2408×1376. Only S1 is exactly 16:9. | "a NovaStar media-player/controller" | https://tinnox.com.au/led-video-wall/precisionpro/ |
| PrecisionLuma™ | Indoor LED, auditorium | P3.9 | S1 768×448 to S5 1280×704. Only S3 (1024×576) is exactly 16:9. Brightness 3,500 nits. | NovaStar; content enters through "the controller's HDMI input path" | https://tinnox.com.au/led-video-wall/precisionluma/ |
| StructuraSign™ | Outdoor pole-mounted road sign, single face | P2.9 | S1 1500×1000 mm to S5 3500×2000 mm; pixel counts n/p. IP65. Light-sensor auto brightness. | "processor, light sensor"; brand n/p | https://tinnox.com.au/led-video-wall/structurasign/ |
| DuraBlaze™ Electronic Sign | Outdoor LED retrofit for an existing façade or pylon | n/p | Predetermined sizes, n/p | n/p | https://tinnox.com.au/led-video-wall/durablaze-electronic-sign/ |
| DuraBlaze™ Media Advertising | Outdoor billboard | P8 | Super 4 3840×1920 mm (2:1), Super 6 5760×1920 mm (3:1), Super 8 7680×1920 mm (4:1), Super Site 11520×2880 mm (4:1). Light-sensor control. | "video processor configuration"; brand n/p | https://tinnox.com.au/led-video-wall/durablaze-media/ |
| EdgePro™ | Indoor freestanding portrait LCD kiosk | n/a | 55, 65, 75 and 86 inch; single or double-sided | "selected player" | https://tinnox.com.au/digital-kiosk/edgepro/ |
| RobustPro™ | Outdoor freestanding portrait LCD kiosk | n/a | 55, 65, 75 and 86 inch; single or double-sided | "Media-player agnostic; player and CMS selected for the project" | https://tinnox.com.au/digital-kiosk/robustpro/ |
| RobustMini™ | Outdoor wall-mounted landscape LCD kiosk, optional touch | n/a | 55, 65, 75 and 86 inch. Fan ventilation with temperature sensing. | "compatible media player" | https://tinnox.com.au/digital-kiosk/robustmini/ |
| RobustMicro™ | Outdoor portrait **LED** kiosk | P1.2 flip-chip COB | 75 and 86 inch; single or double-sided. Closed-loop air-conditioning. Optional remote monitoring. | n/p | https://tinnox.com.au/digital-kiosk/robustmicro/ |
| RobustMax™ | Outdoor driver-facing **LED** kiosk | P2.9 SMD | 88, 101 and 115 inch; landscape or portrait. Auto brightness. | n/p | https://tinnox.com.au/digital-kiosk/robustmax/ |
| AdaptiView 250 | Modular LED cabinets for retail | n/p | Multiples of 250 mm cabinets; CAD drawings available | n/p | https://tinnox.com.au/industries/digital-signage-for-retail/ |
| VistaBlaze, WinBrite | Named only on the warranty page as TINNOX series made by UFL Technology | n/p | n/p | n/p | https://tinnox.com.au/product-warranty/ |
| Digital pylon, digital billboard, pole signs, pylon retrofit | Older pages with general copy only (weatherproof, content customisation; business page says IP65 and IK10) | n/p | n/p | n/p | https://tinnox.com.au/led-video-wall/digital-pylon/ , https://tinnox.com.au/industries/digital-signage-for-business/ |

Published environmental data is thin. Operating temperature is not given for any product (UNKNOWN). The only published brightness is PrecisionLuma at 3,500 nits. The earlier examples "P6 at Sydney Markets" and "3000 nits at a residential project" are no longer on site (2026-11-03); the project pages now redirect to a list that shows name and city only.

Implication for the CMS. The fleet is heterogeneous in pixel dimensions and aspect ratio, and most published canvases are not 16:9: 1376×774, 768×448 and 2240×1260, billboards at 2:1, 3:1 and 4:1, and RobustMax in both orientations (VERIFIED_FULL_PAGE; this was INFERRED in the earlier draft). The site itself tells customers to "use the native pixel canvas when preparing content templates". A first release that only understands 1920×1080 and 1080×1920 would not fit TINNOX's own range. Canvas presets per package belong in the screen-setup wizard (PROPOSED). Pixel counts for StructuraSign and DuraBlaze must come from TINNOX (UNKNOWN, question Q-T11).

## 3. Services and support model

| Service | Evidence | Label | Source |
|---|---|---|---|
| Installation | Done by TINNOX's network of certified installation partners. Turnkey outdoor work includes site inspection, engineering, footings, electrical work and help with council permits. The earlier "1 to 2 days for a standard indoor install" is no longer on site (2026-11-03). | VERIFIED_FULL_PAGE | https://tinnox.com.au/ , https://tinnox.com.au/industries/digital-signage-for-business/ |
| Standard warranty | 2-year product warranty plus 1-year on-site service warranty. On-site cover applies only where TINNOX installs. The warranty starts at the earliest of purchase, delivery or installation, and a certificate is issued only after full payment. | VERIFIED_FULL_PAGE | https://tinnox.com.au/product-warranty/ |
| Warranty extensions | See the table below. Maximum cover is 6 years product and 3 years on-site. | VERIFIED_FULL_PAGE | https://tinnox.com.au/product-warranty/ |
| Third-party hardware | "devices from DsDevice and Novastar" get a standard 1-year product warranty, with no extension available | VERIFIED_FULL_PAGE | https://tinnox.com.au/product-warranty/ |
| Third-party software | Limited support (written guides or video tutorials). Training and ongoing content-management services cost extra. TINNOX is not liable for third-party software faults. | VERIFIED_FULL_PAGE | https://tinnox.com.au/product-warranty/ |
| SLA | Published. See the table below. | VERIFIED_FULL_PAGE | https://tinnox.com.au/product-warranty/ |
| Spare parts | "spare parts are always stored on-site in a dedicated flight case"; local technicians | VERIFIED_FULL_PAGE | https://tinnox.com.au/industries/digital-signage-for-business/ |
| Ongoing support | Troubleshooting, software updates, maintenance | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Hire | Festivals, corporate events and expos; truss setups; on-site tech support; content management as a rental extra; TINNOX can supply a media player for a pre-prepared content list | VERIFIED_FULL_PAGE | https://tinnox.com.au/led-video-wall-hire/ , https://tinnox.com.au/led-video-wall-hire/led-hire-overview/ |
| Support pages | /support/ is the Zoho Desk ticket form (section 1). /support/software/ and /support/warranty/ return 404. The rental terms page /terms/rentals/ also returns 404. | VERIFIED_FULL_PAGE | https://tinnox.com.au/support/ |

**Warranty extension pricing** (VERIFIED_FULL_PAGE, https://tinnox.com.au/product-warranty/; amounts implied AUD, the page gives no currency code)

| Extension step | Price | Maximum |
|---|---|---|
| +2 years product | 10 % of hardware cost | 6 years product |
| +1 year on-site | 10 % of installation cost | 3 years on-site |
| Worked example on the page: hardware 1,000 and installation 500 at maximum cover | Total 1,800 | |

**Published SLA** (VERIFIED_FULL_PAGE, https://tinnox.com.au/product-warranty/)

| Fault class | Definition | Response | Turnaround |
|---|---|---|---|
| Critical | 1 m² or more of screen out, or power, signal or control equipment | Same day if reported before 12 pm, otherwise next day; Sundays and public holidays excluded | 3 to 5 business days |
| Non-critical | Less than 1 m², ribbon, LED or module | Within 2 business days | 7 business days |

Implications.

- TINNOX already carries an on-site service obligation. Each avoided truck roll has direct margin value, so remote diagnostics in the operations console are a revenue feature, not a nice-to-have (INFERRED).
- The published SLA shapes the console. It needs a fault class per display, SLA timers that start in site-local time (before or after 12 pm, excluding Sundays and public holidays), and a link from the display serial number to the Zoho Desk ticket (PROPOSED, from `research/round2/R5-tinnox-site.md` Analysis 5). The ticket link carries only identifiers (section 10).
- Commercial alignment. The proposed 12 months of included CMS lines up with the **1-year on-site** warranty year, not the 2-year product warranty. The product-warranty extension can be sold together with the subscription after that year (PROPOSED, `research/round2/R6-commercial-model.md` as corrected by `research/round2/R99-critic.md` C9).

## 4. Software currently offered

| Finding | Label | Source |
|---|---|---|
| CMS sold today: **none**. TINNOX sells no CMS today, so there is nothing to migrate. | DECIDED (TINNOX Q1) | TINNOX answer: "we dont have CMS today" |
| Current site wording matches that. Player and CMS are selected per project: "Media-player agnostic; player and CMS selected for the project"; "with a suitable player and content platform"; a customer's existing system can be used ("can join the system you already manage"). | VERIFIED_FULL_PAGE | https://tinnox.com.au/digital-kiosk/robustpro/ , https://tinnox.com.au/digital-kiosk/robustmini/ , https://tinnox.com.au/led-video-wall/structurasign/ |
| The earlier snippet "Content management systems, software licenses, and integration with third-party systems are sold separately" is no longer on site (2026-11-03). No licence or price for any software appears anywhere. | VERIFIED_FULL_PAGE (absence) | https://tinnox.com.au/led-video-wall/ |
| Older marketing copy still describes a CMS: "intuitive CMS software ... via mobile devices, online portals, or even USB uploads" (business page); "a single, cloud-based CMS platform ... compatible with various third-party platforms" (education page); "Our CMS platform ... a single, central portal ... supports 4G, Wi-Fi, and cabled internet connections" (government page). | VERIFIED_FULL_PAGE | https://tinnox.com.au/industries/digital-signage-for-business/ , https://tinnox.com.au/industries/digital-signage-for-education/ , https://tinnox.com.au/industries/digital-signage-for-government/ |
| Hardware already promises monitoring: RobustMicro offers "Optional remote monitoring ... status information and alerts"; an "Operations & Monitoring" application page is marked coming soon. | VERIFIED_FULL_PAGE | https://tinnox.com.au/digital-kiosk/robustmicro/ |
| Disabled menu items "Software Products", "DSIaaS", "Partner Login", "Download Library" and "Track Your Project". These are 5 of 31 disabled items left by the site rebuild, so they are weak evidence of a planned software offer. What they are meant to become is question Q-T12. | VERIFIED_FULL_PAGE (markup); meaning INFERRED | https://tinnox.com.au/ |
| Commercial intent: "sell hardware with our own software to increase the profit and recurring rev". | DECIDED (TINNOX Q7) | TINNOX answer |

**Inherited requirements (PROPOSED).** The older copy above is a promise TINNOX has already made in public. Release 1 should honour it: publishing from a phone, a web portal for many sites, a USB fallback for offline loading, remote scheduling, and players that work over 4G, Wi-Fi and wired networks. "Compatible with third-party platforms" is too vague to build; confirm its meaning with TINNOX.

**Controllers and players.**

| Vendor or device | Finding | Label | Source |
|---|---|---|---|
| NovaStar | Named on the site. The three indoor PrecisionX package pages say "The package schedule identifies the LED display and a NovaStar media-player/controller". The warranty page lists Novastar as third-party hardware. | VERIFIED_FULL_PAGE | https://tinnox.com.au/led-video-wall/precisionpro/ , https://tinnox.com.au/product-warranty/ |
| Huidu | Main controller supplier per TINNOX: "mainly provider from China, e.g., Huidu". Not mentioned anywhere on the site. | DECIDED (TINNOX Q2); site absence VERIFIED_FULL_PAGE | TINNOX answer; `research/round2/R5-tinnox-site.md` verification row 3 |
| Controller vendors in release 1 | Treat release 1 as having **two controller vendors**: NovaStar for the indoor PrecisionX packages, Huidu for outdoor and custom builds. The split per package must be confirmed (question Q-T2). | INFERRED | `research/round2/R99-critic.md` C1 |
| Outdoor processor brand | StructuraSign, DuraBlaze and RobustMax name only a "processor" or "video processor configuration". | UNKNOWN | https://tinnox.com.au/led-video-wall/structurasign/ |
| NovaStar capacity | A Taurus TB60 loads about 2.3 M pixels, with HDMI input up to 1920×1200 at 60 Hz. That covers PrecisionMicro S1 to S3, PrecisionPro S1 and S2 and all PrecisionLuma sizes. PrecisionPro S3 (2.49 M px), PrecisionPro S4 (3.31 M px) and PrecisionMicro S4 (2.82 M px) need a larger NovaStar model or a split canvas. Which model each package uses is question Q-T11. | OFFICIALLY DOCUMENTED (spec sheet via search summary; host blocked) | https://oss.novastar.tech/uploads/2024/06/Taurus-Series-Multimedia-Player-TB60-Specifications-V1.1.0.pdf ; `research/round2/R5-tinnox-site.md` verification row 12 |
| DsDevice | Named on the warranty page as third-party hardware alongside Novastar (1-year warranty, no extension). TINNOX answered "not sure, maybe" when asked if this is DSDevices. Identity is INFERRED to be DSDevices (dsdevices.com), a UK maker of Android players built for Xibo. Xibo's own knowledge base uses the singular "DSDevice" for these players. The likely role is the Android player inside the LCD kiosks. Confirmation is question Q-T4. | VERIFIED_FULL_PAGE (mention); INFERRED (identity); TINNOX Q3 | https://tinnox.com.au/product-warranty/ ; https://docs.xibosignage.com/kb/media-players/removing-a-pre-installed-player-app-version-from-your-dsdevice (THIRD PARTY) |
| DSDevices current models | Only the Xibo-sold DSCS9X and DSCS95 were retired (September 2025). DSDevices still sells the DSDA1 (Android 14, Xibo pre-installed) and the DSDX5. If DsDevice is DSDevices, the integration surface is an Android player app (TINNOX's own or Xibo), not a vendor cloud. | THIRD PARTY; INFERRED | https://dsdevices.com/product/dsda1/ ; https://xibosignage.com/blog/announcement-dscs9x-and-dscs95-retirement ; `research/round2/R8-xibo-verify.md` |
| Vendor API already granted | "there's one granted, but not sure the name at the moment". Whether it is Huidu (a 16-hex `sdkKey` plus secret from Huidu support) or NovaStar (an AppKey and AppSecret from the VNNOX Open Platform) is not known. Both guesses are INFERRED. No adapter work starts on either assumption until question Q-T1 is answered. | DECIDED (TINNOX Q4); identity UNKNOWN | TINNOX answer; `research/round2/R99-critic.md` C2 |
| Other brands | Colorlight, Linsn, Android, Windows players, Xibo, Yodeck, VNNOX and ViPlex appear on no page. | VERIFIED_FULL_PAGE (absence) | `research/round2/R5-tinnox-site.md` F2 |

Interpretation. TINNOX sells no CMS today; player and CMS are selected per project (DECIDED, TINNOX Q1; VERIFIED_FULL_PAGE site wording). The earlier "per-screen third-party licence" interpretation is withdrawn: the site shows no licence or price, and TINNOX confirms there is no CMS. Because two controller vendors are in play, the vendor-neutral primary route for both is a TINNOX player feeding the controller over HDMI (PROPOSED, `research/round2/R99-critic.md` C1). Controller-specific routes are set out in `architecture-and-hardware.md`.

## 5. Owning and operating software: nothing to replace

TINNOX sells no CMS today (DECIDED, TINNOX Q1), and no migration from Yodeck is needed because Yodeck is studied only to learn from (DECIDED, TINNOX Q12). TINNOX CMS is therefore not replacing or re-branding anything. It is the first software TINNOX will sell with its hardware, to raise margin and create recurring revenue (DECIDED, TINNOX Q7). The table below compares an owned product with the only alternative still on the table: a white-label service used as a short bridge.

| | White-label service (optional bridge only) | Owned product (TINNOX CMS as proposed) |
|---|---|---|
| Source code | Vendor's; TINNOX cannot change behaviour | TINNOX's (or an open-source base under a licence that permits it); behaviour is a roadmap decision |
| Hosting and data | Vendor's regions and terms. Xibo Cloud has an Australian data centre, but vendor staff have on-demand admin access and some sub-processors are offshore. | TINNOX chooses Australian hosting and retention rules (section 10) |
| Pricing | Vendor sets the floor per screen; margin is a resale markup | TINNOX sets the price; cost is hosting plus engineering |
| Feature fit for LED pylons, custom canvases, Australian time zones | Only if the vendor supports it. No Xibo route covers Huidu or NovaStar controllers (HARDWARE-DEPENDENT/UNVERIFIED). | Built to TINNOX's hardware |
| Support | Two-tier (TINNOX then vendor); diagnostics limited to what the vendor exposes | TINNOX owns device telemetry and support tooling |
| Risk | Vendor price changes, discontinuation, API changes; brand confusion; every bridge screen becomes a later migration; English-law terms and deletion on exit | Engineering cost, operational responsibility (uptime, security, updates) |
| Time to market | Weeks | Months for a narrow first release (see `implementation-backlog.md`) |

Sources for the white-label column: `research/round2/R8-xibo-verify.md` (VERIFIED_FULL_PAGE on xibosignage.com terms, privacy and pricing pages).

PROPOSED position: TINNOX CMS is an owned, maintained product sold with TINNOX hardware. A white-label service is an optional bridge only, used if signed hardware sales need software before the MVP is ready. R8's conditions apply: an Australian region in writing, the White Label tier only, pilot scale (about 20 screens and 3 customers or fewer), and customer contracts that say the platform will change. The bridge is evaluated in `architecture-and-hardware.md` §7.

## 6. Customer segments and scenarios

Industry pages exist for business and communities, education, government and retail, and hire covers festivals, corporate events and expos (VERIFIED_FULL_PAGE: https://tinnox.com.au/industries/digital-signage-for-education/ , https://tinnox.com.au/industries/digital-signage-for-government/ , https://tinnox.com.au/led-video-wall-hire/expos/).

Projects and clients by sector only (VERIFIED_FULL_PAGE, https://tinnox.com.au/projects/ and https://tinnox.com.au/):

- The projects page lists 12 entries with name and city only, no specs. Sectors: residential property development, a university, fashion retail, kitchen and joinery retail, a wholesale fresh-produce market, a music festival, a regional tourism body, FMCG brand activation, a major tennis event, a barbershop and an independent supermarket. Cities include Melbourne, Sydney, Newcastle and Perth.
- The home page shows 12 client logos: supermarkets, a department store, hardware retail, FMCG, telecommunications, banking, sports events, stadium hospitality, two universities, a state government and a capital-city council.
- Featured image captions show AFL match LED signage and an outdoor kiosk at a waste transfer station.
- The earlier claims about specific project specs (P6 screens, a 3000-nit display, rooftop billboards) are no longer on site (2026-11-03).

The four scenarios used throughout the spec (PROPOSED, derived from these segments):

1. **School schedules notices on an outdoor sign.** One site, one landscape or portrait LED sign, weekly timetable of notices, term dates, emergencies. Office staff, not designers.
2. **Retailer updates promotions across locations.** One customer, many sites in different states and time zones, same campaign with per-site exceptions, strict start and end dates.
3. **Council manages public-information kiosks.** Portrait LCD or LED kiosks, long dwell content, accessibility expectations, approval workflow, proof that content played.
4. **TINNOX support investigates a display that stopped updating.** Operations console: last heartbeat, download state, storage, network, screenshot, remote restart, audit trail of who changed what.

## 7. Branding cues available

| Cue | Finding | Label |
|---|---|---|
| Name styling | "TINNOX" in all caps throughout | VERIFIED_FULL_PAGE |
| Page titles | Titles put the page name first and "TINNOX" last. The home title is "TINNOX" plus "Digital Signage Australia". The H1 is "Australian Outdoor Display Specialists". The earlier tagline "LED Digital Signage Australia" is no longer on site (2026-11-03). | VERIFIED_FULL_PAGE |
| Product naming | Compound CamelCase names with ™: PrecisionPro™, EdgePro™, RobustMax™, DuraBlaze™. Feature trademarks too: DashSwap™, TitanShield™, FormatReady™, DeepBlack™, DetailCanvas™. | VERIFIED_FULL_PAGE |
| Tone of voice | New pages: second person, short imperative headlines, careful scoping, Australian English, no hype. Older pages: SEO-style marketing. | VERIFIED_FULL_PAGE (assessment INFERRED) |
| Colours, logo, typography | Official assets will be supplied later. | DECIDED (TINNOX Q5) |

**Provisional design tokens** (VERIFIED_FULL_PAGE from https://tinnox.com.au/site.css, https://tinnox.com.au/icon.svg and the site JSON-LD; use until the official assets arrive, PROPOSED)

| Token | Value | Use on the site |
|---|---|---|
| Deep Teal | #0f4761 | Primary brand colour (dark variant #0d384d) |
| Midnight | #12212a | Primary text, strong backgrounds |
| Signal Sky | #72afc2 | Accent and focus |
| Slate | #5d6b73 | Secondary text |
| Mist | #dce7ea | Lines |
| Porcelain | #f6f8f8 | Light surface |
| Favicon tile | #102e50 | Icon background |
| Heading typeface | Manrope (SIL Open Font License 1.1) | Self-hosted on the site |
| Body typeface | Inter (SIL Open Font License 1.1) | Self-hosted on the site |
| Shape | Large radii: 20 px cards, pill buttons | |

The logo exists as a PNG (1320×429) and a single-colour wordmark SVG on the site. Do not embed either until TINNOX supplies the official files (PROPOSED). Whether the site tokens may be used in the meantime is question Q-T13.

PROPOSED: the CMS uses TINNOX's own brand assets supplied by TINNOX and an original interface design. No Yodeck assets, copy, icons or layouts are reused.

## 8. What this means for the product

- Two interfaces, one platform (PROPOSED, from the brief): a **customer portal** (content, playlists, schedules, sites, displays, users) and a **TINNOX operations console** (provisioning, fleet health, support access with audit, customer administration).
- The hardware range forces first-class support for **custom pixel dimensions and portrait** canvases, with **canvas presets per package** (VERIFIED_FULL_PAGE canvases; presets PROPOSED).
- Release 1 must work with **two controller vendors, Huidu and NovaStar** (INFERRED from TINNOX Q2 and the site). An **external TINNOX player feeding the controller over HDMI** is the vendor-neutral primary topology (PROPOSED). The per-package controller list is question Q-T2.
- The published SLA and on-site warranty make **remote diagnostics, SLA timers and an audited support path** a day-one requirement (INFERRED from section 3). Staff access to customer content follows the opt-in grant model recommended in `research/round2/R2-support-access-models.md` (PROPOSED, B+).
- Release 1 is **Australia only** (DECIDED, TINNOX Q6). Site-local **Australian time zones with daylight-saving correctness** are a day-one requirement. New Zealand is added later as zone data.
- Documents: **PDF in release 1; PowerPoint and web pages in release 2**, on TINNOX-player routes only. TINNOX accepts either release (DECIDED, TINNOX Q11); this split and the route limit are PROPOSED (`research/round2/R99-critic.md` C7).
- All CMS data stays in Australia (DECIDED, TINNOX Q9; section 10).

## 9. Gaps to close with TINNOX

The twelve original questions (Q1 to Q12) are answered. The answers are recorded in `open-questions.md` §2 and summarised in this document where they apply.

What remains is the new TINNOX question list, Q-T1 to Q-T14, in `open-questions.md` (source: `research/round2/R99-critic.md` section 3). The ones that touch this document most are:

| ID | Question in brief |
|---|---|
| Q-T1 | Identify the vendor API access already granted (Q4): Huidu `sdkKey` or NovaStar VNNOX AppKey, who issued it and when |
| Q-T2 | Controller or player fitted per package (make, model, device ID, firmware, HDMI-in) |
| Q-T4 | Is "DsDevice" DSDevices? Which model, in which kiosks, running which app |
| Q-T11 | Pixel resolutions for StructuraSign and DuraBlaze; NovaStar model per PrecisionX size |
| Q-T12 | Meaning of "Software Products", "DSIaaS", "Partner Login" and "Track Your Project"; intended product name and URL |
| Q-T13 | Official brand assets (Q5) and interim use of the site tokens |
| Q-T14 | Move Zoho Desk to the AU data centre? Link tickets to devices by serial only? |

Still unconfirmed from the old site: whether the removed claims (P6 and 3000-nit project specs, 1 to 2 day installs, hire only in VIC and NSW) are still true. The contents of the compliance portal subdomain are also UNKNOWN.

## 10. Back-office data location

TINNOX's own back-office tools and the CMS have different data locations. They must be kept apart.

| System | Data location | Label | Source |
|---|---|---|---|
| Website back office: HubSpot (CRM and quote form), Zoho Desk (support tickets), Google Analytics and Ads, Meta Pixel, Cloudflare Web Analytics | The privacy policy says these "may store and process information outside Australia, including in the United States" | VERIFIED_FULL_PAGE | https://tinnox.com.au/privacy-policy/ |
| Zoho Desk Australian data centre | Zoho runs an Australian data centre (desk.zoho.com.au, Sydney and Melbourne, launched 2019). Which data centre TINNOX's Desk uses today is UNKNOWN. | THIRD PARTY / OFFICIALLY DOCUMENTED (search summary) | https://www.techpartner.news/news/zoho-expects-channel-boost-from-new-local-data-centres-531232 ; https://help.zoho.com/portal/en/kb/accounts/manage-your-zoho-account/articles/data-center-for-zoho-account |
| TINNOX CMS | All customer data and media in Australia: AWS Sydney (ap-southeast-2) primary, Melbourne (ap-southeast-4) for backups and disaster recovery, CDN limited to the Australia price class | DECIDED (TINNOX Q9: "we strictly follow AU compliance for data and security"); provider choice PROPOSED | `research/round2/R3-au-hosting-compliance.md` Option A |

Modelled monthly cost of the all-AU AWS build (Option A, AUD, base case of 3 GB of media per screen per month; prices VERIFIED_FULL_PAGE, sizing INFERRED; FX 1 AUD = 0.69 USD, rounded from 0.6928 on 1 Oct 2026, THIRD PARTY, RBA to confirm; source `research/round2/R3-au-hosting-compliance.md`):

| Screens | 10 | 100 | 500 | 2,000 |
|---|---|---|---|---|
| AUD per month | 109 | 263 | 1,002 | 2,913 |
| AUD per screen per month | 10.90 | 2.63 | 2.00 | 1.46 |

Rules for the boundary (PROPOSED, from `research/round2/R99-critic.md` C14 and `research/round2/R5-tinnox-site.md` Analysis 6):

1. CMS data stays in Australia. No CMS content, media, user data or audit records go into HubSpot, Zoho Desk, Google or Meta.
2. A link from the CMS to a Zoho Desk ticket carries only the ticket ID and the device serial number. It never carries content or personal data.
3. Moving TINNOX's Zoho Desk to the Australian data centre is a TINNOX decision (question Q-T14).
4. TINNOX CMS has its own privacy statement, separate from the website's. It states that CMS data is held in Australia and lists the data locations.
5. Vendor clouds (NovaStar VNNOX, the Huidu cloud) are not used by default, because no Australian region has been documented for them (UNKNOWN). See `architecture-and-hardware.md`.
