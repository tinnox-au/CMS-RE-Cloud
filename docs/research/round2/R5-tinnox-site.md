# R5 — TINNOX website read in full (tinnox.com.au), 2026-11-03

Scope: every page in https://tinnox.com.au/sitemap.xml (43 URLs, which already include all 21 internal links on the home page), plus 6 legacy URLs that the earlier docs cited, plus one linked page that returned 404. robots.txt allows everything (`User-agent: * / Allow: /`). Pages were fetched with `curl -L` at 0.5 s intervals. Raw HTML is in `(session scratchpad)/round2/tinnox-site/html/`, text extracts in `.../tinnox-site/txt/` and `.../tinnox-site/body/` (navigation stripped), CSS, JS and SVG in `.../tinnox-site/assets/`. The linked subdomain compliance.tinnox.com.au was blocked by the proxy (403) and was not read. The only image file downloaded was the 7 KB wordmark SVG (`/mark.svg`) and the 746-byte favicon SVG. The logo PNG was checked with a HEAD request only.

**Important context.** The site was rebuilt very recently. JSON-LD `dateModified` values run from 2026-10-31 to 2026-11-03. Many statements in `docs/tinnox-context.md` came from search snippets of the **previous** site and no longer appear anywhere. Those are flagged "not on current site" below. That means they can't be confirmed now; it doesn't prove they were wrong. No personal names are recorded here. Customer organisations are given by sector only.

Labels: VERIFIED_FULL_PAGE, OFFICIALLY_DOCUMENTED, THIRD_PARTY, INFERRED, UNKNOWN, PROPOSED.

## Summary

- **The site names NovaStar and "DsDevice".** The warranty page treats "devices from DsDevice and Novastar" as third-party hardware with a 1-year warranty and no extension. The three indoor PrecisionX package pages each say "the package schedule identifies the LED display and a NovaStar media-player/controller". `tinnox-context.md` §4 says no NovaStar link was found and that DsDevice is unknown. Both statements are now wrong. [VERIFIED_FULL_PAGE]
- **Huidu, Colorlight, Linsn, Android, Xibo and Yodeck are not mentioned on any page.** TINNOX's own answer to Q2 (Huidu) therefore rests only on that answer. The website doesn't support or contradict it.
- **No CMS is sold or named on the site, which matches the Q1 answer.** Kiosk and outdoor pages say "Media-player agnostic; player and CMS selected for the project" and "with a suitable player and content platform". The main menu has two disabled "coming soon" items, **"Software Products"** and **"DSIaaS"**, plus disabled "Partner Login", "Download Library" and "Track Your Project". These are visible placeholders for a future software offer. [VERIFIED_FULL_PAGE; reading them as future software is INFERRED] [corrected in verification: the home page has 31 distinct disabled `data-soon` items, including Careers, Leadership, Our Company, ESG, Whitepapers and Care & Maintenance Plans. The placeholders are a site-wide pattern from the rebuild, so they are weak evidence of a planned software product.]
- **Older marketing copy still describes a CMS.** It mentions "intuitive CMS software … mobile devices, online portals, or even USB uploads" (business page), "single, cloud-based CMS platform … compatible with various third-party platforms" (education page), and "Our CMS platform … single, central portal … supports 4G, Wi-Fi, and cabled internet" (government page). This is a ready-made requirements list for TINNOX CMS. [VERIFIED_FULL_PAGE]
- **The standard warranty is longer than the docs say.** It is a **2-year product warranty plus a 1-year on-site warranty** (on-site only where TINNOX installs), not "1-year on-site". Extensions cost 10% of hardware cost per extra 2 product-years and 10% of installation cost per extra on-site year, up to a maximum of 6 years product and 3 years on-site. The published SLA is: critical faults (≥1 m² of screen out, power, signal or control equipment) get a response the same day if reported before 12 pm, otherwise the next day, with a 3–5 business-day turnaround. Non-critical faults get a response within 2 business days and a 7-day turnaround. [VERIFIED_FULL_PAGE]
- **The current range is a set of named packages.**
  - Indoor LED: PrecisionMicro™, PrecisionPro™, PrecisionLuma™.
  - Outdoor LED: StructuraSign™, DuraBlaze™ Electronic Sign, DuraBlaze™ Media Advertising.
  - Kiosks: EdgePro™ (indoor LCD), RobustPro™ and RobustMini™ (outdoor LCD), RobustMicro™ (outdoor COB LED, P1.2), RobustMax™ (outdoor SMD LED, P2.9).
  - AdaptiView 250 survives on the retail page. VistaBlaze and WinBrite survive only on the warranty page. [VERIFIED_FULL_PAGE]
- **Published canvases are mostly not 16:9.** Examples: PrecisionPro S1 is 1376×774 px; PrecisionLuma S1 is 768×448 px; PrecisionMicro S4 is 2240×1260 px; DuraBlaze Media billboards are 2:1, 3:1 and 4:1 at P8. RobustMax comes in portrait and landscape. This strongly confirms the doc's custom-canvas requirement. [VERIFIED_FULL_PAGE]
- **Few environmental specs are published.**
  - Brightness: only PrecisionLuma, at 3,500 nits.
  - IP rating: IP65 on StructuraSign and in outdoor copy on the business page; IK10 also on the business page.
  - Operating temperature: never given as a number. The site mentions only "closed-loop air-conditioning" (RobustMicro) and "temperature sensing and fan control" (other kiosks).
  - Light sensors and automatic brightness: StructuraSign, DuraBlaze Media, RobustMax. Optional remote monitoring: RobustMicro.
- **Locations are now first-party data.** The site-wide footer and JSON-LD list a Melbourne head office (Level 3, 235 Queen St, VIC 3000), a warehouse at 359 Bluff Road, Hampton VIC 3188, and offices in Sydney, Brisbane, Perth and Canberra (ACT). `areaServed` is Australia. The projects page says installs are "around Australia and New Zealand". [VERIFIED_FULL_PAGE]
- **Provisional brand cues** (from CSS tokens):
  - Colours: primary **Deep Teal #0f4761**, ink **Midnight #12212a**, accent **Signal Sky #72afc2**, plus Slate #5d6b73, Mist #dce7ea, Porcelain #f6f8f8 and Deep Teal 800 #0d384d. The favicon tile is #102e50.
  - Fonts: **Manrope** for headings and **Inter** for body text, both self-hosted.
  - Logo: https://tinnox.com.au/assets/brand/tinnox-logo.png (1320×429) and a single-colour wordmark at https://tinnox.com.au/mark.svg. [VERIFIED_FULL_PAGE]
- **Back-office SaaS in use** (privacy policy): HubSpot (CRM and quote form), Zoho Desk (support tickets, with a ticket form at /support/), Google Analytics and Ads, Meta Pixel and Cloudflare Web Analytics. The policy says these "may store and process information outside Australia, including in the United States". This matters for Q9. [VERIFIED_FULL_PAGE]
- **Several pages the docs cite have gone.** /support/software/ and /support/warranty/ return 404. /contact/ redirects to /get-a-quote/. /projects/<name>/ pages redirect to anchors on /projects/ that show only a name and a city. The earlier claims "P6 at Sydney Markets", "3000 nits at Brady Residential", "install takes 1–2 days", "CMS … sold separately" and "hire only in VIC and NSW" do not appear anywhere on the current site.

## Findings

### F1. Company details

| Item | Site says | Label | URL |
|---|---|---|---|
| Legal entity | "UFL TECHNOLOGY PTY LTD \| ABN 12 656 209 639 \| Trading as Tinnox"; JSON-LD legalName "UFL Technology Pty Ltd" | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Positioning (H1 and meta) | "TINNOX — Australian Outdoor Display Specialists"; "LED video walls, digital kiosks, outdoor LED displays and LED hire, delivered and installed nationwide" | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Head office | Level 3, 235 Queen Street, Melbourne VIC 3000 (JSON-LD address) | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Warehouse | 359 Bluff Road, Hampton VIC 3188 | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Other offices | Sydney (285A Crown St, Surry Hills NSW 2010); Brisbane (Level 18, 175 Eagle St QLD 4000); Perth (Level 17, 2 The Esplanade WA 6000); ACT (Level 10, 1 Constitution Place, Canberra 2601) | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Area served | JSON-LD `areaServed: Australia`; projects page: "all around Australia and New Zealand" | VERIFIED_FULL_PAGE | https://tinnox.com.au/ , https://tinnox.com.au/projects/ |
| Business contact | 1300 846 669 ("1300 TINNOX"); enquiry@ and support@ tinnox.com.au | VERIFIED_FULL_PAGE | https://tinnox.com.au/support/ |
| Certifications | ISO 9001, ISO 14001, ISO 45001; the government page says "JAS-ANZ" | VERIFIED_FULL_PAGE (no certificate numbers given) | https://tinnox.com.au/iso-certifications/ , https://tinnox.com.au/industries/digital-signage-for-government/ |
| Governance claims | Compliance team, annual ethics training, internal and third-party audits, a Chief Compliance Officer; link to a "Compliance Portal" subdomain | VERIFIED_FULL_PAGE (subdomain not reachable) | https://tinnox.com.au/ethics-and-compliance/ |
| Delivery model | "Installation and setup services are conducted by our network of certified installation partners"; "global network of channel partners, suppliers, and subcontractors" | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Founding year, headcount | Not stated on the site | UNKNOWN | — |

### F2. Product lines and published specs

Labels: all rows VERIFIED_FULL_PAGE. "n/p" means not published.

| Series | Type | Pitch | Sizes / canvas | Brightness | IP / IK | Controller / player named | CMS wording | URL |
|---|---|---|---|---|---|---|---|---|
| PrecisionMicro™ (boardroom) | Indoor LED package | P1.25 / P1.5625 / P1.875 | S1–S3 1920×1080 px; S4 2240×1260 px (2400×1350 to 4200×2362.5 mm) | n/p (adjustable) | n/p | "NovaStar media-player/controller" | "content-system requirements" confirmed in quotation | https://tinnox.com.au/led-video-wall/precisionmicro/ |
| PrecisionPro™ (showroom) | Indoor LED package | P1.86 | S1 1376×774, S2 1720×946, S3 2064×1204, S4 2408×1376 px. Only S1 is exactly 16:9. Front-serviceable modules ("DashSwap™") | n/p | n/p | NovaStar media-player/controller | as above | https://tinnox.com.au/led-video-wall/precisionpro/ |
| PrecisionLuma™ (auditorium) | Indoor LED package | P3.9 | S1 768×448 to S5 1280×704 px. Only S3 is exactly 16:9 | **3,500 nits** | n/p | NovaStar; "controller's HDMI input path" | as above | https://tinnox.com.au/led-video-wall/precisionluma/ |
| StructuraSign™ | Outdoor pole-mounted road sign | P2.9 | S1 1500×1000 to S5 3500×2000 mm (pixel counts n/p); single face | auto brightness via light sensor | **IP65** | "processor, light sensor" (brand n/p) | "from your chosen content platform. With a suitable player and connection, publish remotely and schedule" | https://tinnox.com.au/led-video-wall/structurasign/ |
| DuraBlaze™ Electronic Sign | Outdoor LED for existing façade or pylon (retrofit) | n/p | predetermined sizes (n/p) | n/p | n/p | n/p | "With a suitable player, content platform and connection, update the sign remotely"; "40% less energy than conventional LED displays*" | https://tinnox.com.au/led-video-wall/durablaze-electronic-sign/ |
| DuraBlaze™ Media Advertising | Outdoor billboard | P8 | Super 4 3840×1920 mm (2:1), Super 6 5760×1920 (3:1), Super 8 7680×1920 (4:1), Super Site 11520×2880 (4:1) | light-sensor control | n/p | "video processor configuration" (brand n/p) | "With a suitable media player and content platform, schedule campaigns remotely" | https://tinnox.com.au/led-video-wall/durablaze-media/ |
| AdaptiView 250 | Modular LED cabinets for retail | n/p | multiples of 250 mm cabinets; CAD drawings available | n/p | n/p | n/p | — | https://tinnox.com.au/industries/digital-signage-for-retail/ |
| VistaBlaze, WinBrite | Named only on the warranty page | n/p | n/p | n/p | n/p | n/p | — | https://tinnox.com.au/product-warranty/ |
| EdgePro™ | Indoor freestanding portrait LCD kiosk | — | 55/65/75/86", single or double-sided (models KEPO..). Double-sided version can run mixed brightness | n/p | n/p | "selected player" | "Directory, advertising or rate-board layouts through the selected player and CMS" | https://tinnox.com.au/digital-kiosk/edgepro/ |
| RobustPro™ | Outdoor freestanding portrait LCD | — | 55/65/75/86", single or double-sided (KRPO..) | n/p | n/p; "TitanShield™" glass; vandalism 2/3 on the site's own scale | — | "Media-player agnostic; player and CMS selected for the project" | https://tinnox.com.au/digital-kiosk/robustpro/ |
| RobustMini™ | Outdoor wall-mounted landscape LCD, optional touch | — | 55/65/75/86" (KRMI..) | n/p | n/p; fan ventilation with temperature sensing | "compatible media player" | "Player and CMS selected for the project; interactive software scoped separately"; "can join the system you already manage" | https://tinnox.com.au/digital-kiosk/robustmini/ |
| RobustMicro™ | Outdoor portrait LED kiosk | **P1.2 flip-chip COB** | 75/86", single or double-sided (KRMO..) | n/p | n/p; closed-loop air-conditioning | n/p | "With a suitable CMS, publish to selected screens together"; "Optional remote monitoring … status information and alerts" | https://tinnox.com.au/digital-kiosk/robustmicro/ |
| RobustMax™ | Outdoor driver-facing LED kiosk | **P2.9 SMD** | 88/101/115", landscape or portrait (KRMA..) | auto brightness | n/p | n/p | update "using an available site network or a configured mobile-data connection" | https://tinnox.com.au/digital-kiosk/robustmax/ |
| Digital Pylon, Digital Billboard, Entrance/Indoor/Public Space, Retail/Educational Space | Older pages; general copy only | n/p | n/p | n/p | "weatherproof", "front-strengthened glass" | n/p | "Easily update content" | https://tinnox.com.au/led-video-wall/digital-pylon/ , https://tinnox.com.au/led-video-wall/digital-billboard/ |
| Business-page outdoor claims | Pole signs and pylon retrofit (DuraBlaze) | n/p | — | "high-brightness" | **IP65, IK10**; "6-year warranty" | — | "intuitive CMS software … mobile devices, online portals, or even USB uploads" | https://tinnox.com.au/industries/digital-signage-for-business/ |

Operating temperature is **not published for any product** (UNKNOWN). Also not mentioned anywhere on the site: Huidu, Colorlight, Linsn, DSDevices (plural), Android, Windows players, Xibo, Yodeck, VNNOX/ViPlex, apps. A full-text grep across all 44 HTML files found "NovaStar"/"Novastar" (4 pages) and "DsDevice" (1 page) only.

### F3. Software, CMS and vendor mentions

| Statement on site | Label | URL |
|---|---|---|
| "Third-party hardware, such as devices from DsDevice and Novastar, is covered by a standard one-year product warranty. No extended warranties can be purchased for these products." | VERIFIED_FULL_PAGE | https://tinnox.com.au/product-warranty/ |
| "All third-party software comes with limited support … written guides or video tutorials … Initial training or ongoing content management services are available for an additional fee. TINNOX is not liable for any malfunction … associated with third-party software." | VERIFIED_FULL_PAGE | https://tinnox.com.au/product-warranty/ |
| "The package schedule identifies the LED display and a NovaStar media-player/controller." | VERIFIED_FULL_PAGE | https://tinnox.com.au/led-video-wall/precisionpro/ (same text on /precisionmicro/ and /precisionluma/) |
| "Media-player agnostic; player and CMS selected for the project" | VERIFIED_FULL_PAGE | https://tinnox.com.au/digital-kiosk/robustpro/ |
| Disabled menu items "Software Products", "DSIaaS", "Partner Login", "Download Library", "Track Your Project"; the applications page "Operations & Monitoring" is marked "coming soon" | VERIFIED_FULL_PAGE (markup `data-soon aria-disabled`) | https://tinnox.com.au/ , https://tinnox.com.au/digital-kiosk/robustmax/ |
| "Manage all your screens across multiple locations through a single, cloud-based CMS platform … compatible with various third-party platforms" | VERIFIED_FULL_PAGE | https://tinnox.com.au/industries/digital-signage-for-education/ |
| "Our CMS platform … manage all digital signage across the city from a single, central portal. Schedule content remotely, manage updates via mobile devices … supports 4G, Wi-Fi, and cabled internet connections" | VERIFIED_FULL_PAGE | https://tinnox.com.au/industries/digital-signage-for-government/ |
| "Real-time content management, remote monitoring, and software updates require a reliable internet connection." | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Hire: "Media Player Supply: If you have a pre-prepared content list (images and videos), we can supply the media player" | VERIFIED_FULL_PAGE | https://tinnox.com.au/led-video-wall-hire/led-hire-overview/ |
| Terms of use: the customer grants TINNOX "a royalty-free and non-exclusive licence to display … the content you upload and publish"; governing law Victoria, Australia | VERIFIED_FULL_PAGE | https://tinnox.com.au/terms-and-conditions/ |
| Support: ticket form (name, email, **serial number**, subject, description, up to 5 × 20 MB attachments, restart checkbox) goes to Zoho Desk | VERIFIED_FULL_PAGE | https://tinnox.com.au/support/ |
| Identity of "DsDevice": one search found only DSDevices (dsdevices.com) Android players DSDA1, DSDX5 and DSCS9X. No Australian distributor was found. [corrected in verification: Xibo's own knowledge base uses the singular "DSDevice" for these players ("Removing a pre-installed Player App version from your DSDevice"), and DSDA1 ships with Xibo pre-installed. This makes the identification stronger, though it is still not proven for TINNOX] | THIRD_PARTY / INFERRED | https://manuals.plus/category/dsdevices , https://docs.xibosignage.com/kb/media-players/removing-a-pre-installed-player-app-version-from-your-dsdevice , https://dsdevices.com/product/dsda1/ |

### F4. Services, warranty and SLA

| Item | Site says | Label | URL |
|---|---|---|---|
| Warranty trigger | A Warranty Certificate is issued only after full payment. The warranty starts at the earliest of purchase, delivery or installation | VERIFIED_FULL_PAGE | https://tinnox.com.au/product-warranty/ |
| Standard warranty | 2-year product warranty + 1-year on-site service warranty (on-site only where TINNOX installs) | VERIFIED_FULL_PAGE | same |
| Extended warranty | +2 years product for 10% of hardware cost; +1 year on-site for 10% of installation cost; maximum 6 years product / 3 years on-site. Worked example: $1,000 hardware and $500 install gives a $1,800 total | VERIFIED_FULL_PAGE | same |
| Series covered | "TINNOX display series designed and manufactured by UFL TECHNOLOGY Pty Ltd": PrecisionPro, AdaptiView, VistaBlaze, WinBrite | VERIFIED_FULL_PAGE | same |
| SLA | Critical (≥1 m², power, signal, control equipment): same day if reported before 12 pm, else next day, excluding Sundays and public holidays; turnaround 3–5 business days. Non-critical (<1 m², ribbon, LED, module): within 2 business days; turnaround 7 business days | VERIFIED_FULL_PAGE | same |
| Spare parts | "spare parts are always stored on-site in a dedicated flight case"; local technicians | VERIFIED_FULL_PAGE | https://tinnox.com.au/industries/digital-signage-for-business/ |
| Turnkey outdoor | Site inspection, engineering, excavation, footings, electrical work, council permit help | VERIFIED_FULL_PAGE | same |
| Hire | Festivals, corporate events, expos; truss setups; on-site tech support; content management offered as a rental extra; promotion of "50% off" in exchange for reviews and social posts | VERIFIED_FULL_PAGE | https://tinnox.com.au/led-video-wall-hire/ , https://tinnox.com.au/led-video-wall-hire/expos/ |
| Retail | Shopfitter collaboration; local test-build warehouse "over 400sqm of LED cabinets" | VERIFIED_FULL_PAGE | https://tinnox.com.au/industries/digital-signage-for-retail/ |
| Rental terms page | /terms/rentals/ is linked but returns 404 | VERIFIED_FULL_PAGE (404) | https://tinnox.com.au/terms/rentals/ |

### F5. Case studies and customers (sector only)

| Source | Sectors shown | Label | URL |
|---|---|---|---|
| Projects page (12 entries; name and city only, no specs) | Residential property development (Melbourne); university (Perth); fashion retail (Sydney, Newcastle); kitchen/joinery retail (Sydney); wholesale fresh-produce market (Sydney); music festival (Sydney); regional tourism body (VIC); FMCG brand activation (Sydney); major tennis event (Melbourne); barbershop (in-store); independent supermarket (outdoor) | VERIFIED_FULL_PAGE | https://tinnox.com.au/projects/ |
| Home-page "Our Clients" logos (12) | Supermarkets, department store, hardware retail, FMCG, telecommunications, banking, sports events, stadium hospitality, two universities, state government, capital-city council | VERIFIED_FULL_PAGE (logos only; no project detail) | https://tinnox.com.au/ |
| Featured-project image captions | AFL match LED signage; an outdoor kiosk at a waste transfer station | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Industry pages | Business & communities, education, government, retail | VERIFIED_FULL_PAGE | https://tinnox.com.au/industries/digital-signage-for-education/ |

### F6. Provisional brand cues

| Cue | Value | Label | URL |
|---|---|---|---|
| Primary colour | `--tinnox-color-deep-teal: #0f4761`, used for brand text, brand borders and the "navy" token; dark variant `#0d384d`; also `#155a7a` in the nav | VERIFIED_FULL_PAGE (CSS) | https://tinnox.com.au/site.css , https://tinnox.com.au/nav.css |
| Ink / strong background | `--tinnox-color-midnight: #12212a` (text-primary, background-strong) | VERIFIED_FULL_PAGE | https://tinnox.com.au/site.css |
| Accent / focus | `--tinnox-color-signal-sky: #72afc2` (action-focus, navigation signal); teal-400 `#6099ac` | VERIFIED_FULL_PAGE | same |
| Neutrals | Slate `#5d6b73` (secondary text), Mist `#dce7ea` (lines), Porcelain `#f6f8f8`, neutral-100 `#eaf0f1`, neutral-400 `#93a1a7`, teal-50/100/200 `#eff5f7`/`#dce9ed`/`#b7d3dc`, white page background; error `#a4262c` | VERIFIED_FULL_PAGE | same |
| Favicon tile | `#102e50` square with a white "NN" monogram | VERIFIED_FULL_PAGE | https://tinnox.com.au/icon.svg |
| Theme colour | `#ffffff` (meta and manifest) | VERIFIED_FULL_PAGE | https://tinnox.com.au/site.webmanifest |
| Typefaces | Headings: Manrope (variable 200–800, self-hosted as "TINNOX Manrope"). Body: Inter (variable 100–900, "TINNOX Inter"). Both fall back to the system sans stack | VERIFIED_FULL_PAGE | https://tinnox.com.au/site.css |
| Shape language | Large radii (20 px cards, 28–36 px nav panel, pill buttons 999 px) | VERIFIED_FULL_PAGE | same |
| Logo files | PNG https://tinnox.com.au/assets/brand/tinnox-logo.png (1320×429, JSON-LD; not downloaded). Wordmark SVG https://tinnox.com.au/mark.svg (`fill="currentColor"`, single colour, aspect about 3.9:1). App icons /assets/brand/icon-192.png and icon-512.png | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| Name styling and titles | "TINNOX" in all caps throughout; product names in CamelCase with ™ (EdgePro™, RobustMax™, DashSwap™, TitanShield™, FormatReady™). Titles follow "<Page> — TINNOX"; home title is "TINNOX — Digital Signage Australia" | VERIFIED_FULL_PAGE | https://tinnox.com.au/products/ |
| Tone of voice | New pages: second person, short imperative headlines ("Give people something to picture.", "Keep the wall. Replace the part."), scenario-led, careful scoping ("included only where specifically scoped"), Australian English (colour, organisation), no hype. Older pages: SEO-style marketing ("Revolutionise", "unparalleled") with some US spellings ("customize") | VERIFIED_FULL_PAGE (assessment INFERRED) | https://tinnox.com.au/led-video-wall/precisionpro/ , https://tinnox.com.au/industries/digital-signage-for-business/ |

### F7. Corrections to `docs/tinnox-context.md` (doc statement | site says | label | URL)

| # | Doc statement (section) | Site says (2026-11-03) | Label | URL |
|---|---|---|---|---|
| 1 | Preamble: "network policy blocked opening tinnox.com.au directly, so no page was read in full" | All 43 sitemap pages were read in full today. The "VERIFIED PUBLIC" snippet label should become VERIFIED_FULL_PAGE where the claim still holds, and be marked "not on current site" where it does not | VERIFIED_FULL_PAGE | https://tinnox.com.au/sitemap.xml |
| 2 | §1 Locations: offices "listed" on the digital-pylon page plus a Melbourne warehouse | Offices are in the site-wide footer and JSON-LD with full addresses: HQ Level 3, 235 Queen St, Melbourne 3000; warehouse at 359 Bluff Rd, Hampton VIC 3188; Sydney (Surry Hills), Brisbane, Perth, Canberra. The digital-pylon page no longer lists offices | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| 3 | §1 Headquarters labelled from LinkedIn (and T01 labels the Queen St address THIRD_PARTY) | Queen St HQ is first-party data (JSON-LD `address`) | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| 4 | §1 Coverage: "LED wall hire only in VIC and NSW" | Not stated anywhere on the current site. The site says "delivered and installed nationwide" and the projects page says "around Australia and New Zealand" | VERIFIED_FULL_PAGE (absence) | https://tinnox.com.au/ , https://tinnox.com.au/projects/ |
| 5 | §1 Business mailboxes only | Also the business phone 1300 846 669 ("1300 TINNOX"); support tickets go through a Zoho Desk form at /support/ | VERIFIED_FULL_PAGE | https://tinnox.com.au/support/ |
| 6 | §2 Product lines list: video walls, pylons, DuraBlaze retrofit, pole signs, billboards, kiosks, AdaptiView, series "AdaptiView, PrecisionPro, VistaBlaze, WinBrite … DuraBlaze elsewhere" | The current range is named packages: PrecisionMicro™/PrecisionPro™/PrecisionLuma™ (indoor LED); StructuraSign™ (pole sign), DuraBlaze™ Electronic Sign (façade/pylon), DuraBlaze™ Media Advertising (billboard); kiosks EdgePro™, RobustPro™, RobustMini™ (LCD), RobustMicro™ (COB LED), RobustMax™ (SMD LED). VistaBlaze and WinBrite appear only on the warranty page; AdaptiView only on the retail and warranty pages | VERIFIED_FULL_PAGE | https://tinnox.com.au/products/ , https://tinnox.com.au/led-video-wall/ , https://tinnox.com.au/digital-kiosk/ |
| 7 | §2 Kiosks described as "LCD" only | Two of the five kiosks are LED: RobustMicro™ (P1.2 COB, 75/86") and RobustMax™ (P2.9 SMD, 88/101/115") | VERIFIED_FULL_PAGE | https://tinnox.com.au/digital-kiosk/robustmicro/ , https://tinnox.com.au/digital-kiosk/robustmax/ |
| 8 | §2 Pixel pitch and brightness examples: "P6 at Sydney Markets; 3000 nits at Brady Residential" | Not on current site: /projects/sydney-markets/ and /projects/brady-residential/ redirect to anchors that show a name and city only. Published figures now: P1.25–P1.875, P1.86, P3.9 (3,500 nits), P2.9, P8, P1.2 | VERIFIED_FULL_PAGE | https://tinnox.com.au/projects/ , https://tinnox.com.au/led-video-wall/precisionluma/ |
| 9 | §2 Implication: non-16:9 canvases, "e.g. a pylon 1.5 wide by 4 tall in cabinet units" (INFERRED) | Now evidenced: native canvases include 1376×774, 768×448, 2240×1260 px; billboards at 2:1, 3:1 and 4:1; RobustMax in portrait and landscape. The site says "Use the native pixel canvas when preparing content templates" | VERIFIED_FULL_PAGE (upgrade from INFERRED) | https://tinnox.com.au/led-video-wall/precisionpro/ , https://tinnox.com.au/led-video-wall/durablaze-media/ |
| 10 | §3 Installation: "1 to 2 days for a standard indoor install" | Not on current site. The site now says installation is "conducted by our network of certified installation partners" | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| 11 | §3 Warranty: "Standard 1-year on-site service warranty when TINNOX installs; extendable up to 6-year product and 3-year on-site" | Standard is **2-year product + 1-year on-site** (on-site only where TINNOX installs). Extension: 10% of hardware cost per +2 product-years, 10% of installation cost per +1 on-site year. Maximum 6 years product / 3 years on-site. Warranty starts only after full payment and the issue of a certificate | VERIFIED_FULL_PAGE | https://tinnox.com.au/product-warranty/ |
| 12 | §3 SLAs: "available for select products" (no detail) | The SLA is published: critical faults get a response the same or next day with a 3–5 business-day turnaround; non-critical faults within 2 business days with a 7 business-day turnaround; "critical" means ≥1 m² of screen affected | VERIFIED_FULL_PAGE | https://tinnox.com.au/product-warranty/ |
| 13 | §3 Support pages: "/support/software and /support/warranty exist; contents not visible" | Both return **404**. /support/ is a ticket form (serial number, photos). The "tinnox.com.au/support/warranty" link text points to /product-warranty/ | VERIFIED_FULL_PAGE | https://tinnox.com.au/support/ |
| 14 | §4 "Content management systems, software licenses … are sold separately" | Not on current site. Current wording: "Media-player agnostic; player and CMS selected for the project"; third-party software gets "limited support" and content-management services cost extra | VERIFIED_FULL_PAGE | https://tinnox.com.au/digital-kiosk/robustpro/ , https://tinnox.com.au/product-warranty/ |
| 15 | §4 "Name of the CMS vendor currently supplied: UNKNOWN" | No CMS is named anywhere. Disabled menu items "Software Products" and "DSIaaS" signal a planned offer. TINNOX confirms it has no CMS today (Q1). The field should read "None; TINNOX sells no CMS today" | VERIFIED_FULL_PAGE + TINNOX answer | https://tinnox.com.au/ |
| 16 | §4 LED controller brand UNKNOWN; "No public link between TINNOX and NovaStar was found" | **NovaStar is named.** The PrecisionMicro/Pro/Luma package schedule includes "a NovaStar media-player/controller", and the warranty page lists Novastar as third-party hardware. No other controller brand (Huidu, Colorlight, Linsn) appears | VERIFIED_FULL_PAGE | https://tinnox.com.au/led-video-wall/precisionpro/ , https://tinnox.com.au/product-warranty/ |
| 17 | §4 "DsDevice": UNKNOWN in TINNOX context | **"DsDevice" appears on the warranty page** as a third-party hardware brand (1-year warranty, no extension). This is the source of the term. Its identity is still INFERRED to be DSDevices (Android players built for Xibo) | VERIFIED_FULL_PAGE (mention) / INFERRED (identity) | https://tinnox.com.au/product-warranty/ |
| 18 | §4 Interpretation: "today TINNOX sells a per-screen software licence for a third-party CMS" (INFERRED) | Not supported. The site shows no licence or price, and TINNOX says it has no CMS (Q1). The site wording points to project-by-project player and CMS selection, with the customer's own CMS allowed ("can join the system you already manage") | VERIFIED_FULL_PAGE + TINNOX answer | https://tinnox.com.au/digital-kiosk/robustmini/ |
| 19 | §6 Example projects: Sydney Markets (two P6 screens), ECU, Strandbags, Brady (3000 nits), MCG billboards | The projects page lists 12 projects with city only (see F5). The P6, 3000-nit and MCG claims are not on the current site | VERIFIED_FULL_PAGE | https://tinnox.com.au/projects/ |
| 20 | §7 "Title tagline: page titles end with 'LED Digital Signage Australia'" | Titles now follow "<Page> — TINNOX"; home is "TINNOX — Digital Signage Australia"; H1 is "Australian Outdoor Display Specialists" | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| 21 | §7 "Colours, logo, typography: UNKNOWN" | Provisional cues: Deep Teal #0f4761, Midnight #12212a, Signal Sky #72afc2; Manrope (headings) and Inter (body); logo at /assets/brand/tinnox-logo.png and /mark.svg. TINNOX will supply official assets (Q5) | VERIFIED_FULL_PAGE | https://tinnox.com.au/site.css |
| 22 | §7 Product naming: compound names | Confirmed, and they now carry ™ and include feature trademarks (DashSwap™, TitanShield™, FormatReady™, DeepBlack™, DetailCanvas™, Dual-Channel Ventilation™) | VERIFIED_FULL_PAGE | https://tinnox.com.au/led-video-wall/precisionpro/ |
| 23 | §9 Gap 5: "Whether NZ operations exist" | Projects page says "around Australia and New Zealand"; JSON-LD areaServed is Australia only; TINNOX says release 1 is AU only (Q6) | VERIFIED_FULL_PAGE + TINNOX answer | https://tinnox.com.au/projects/ |
| 24 | §9 Gap 6: contents of /support/software | The page does not exist (404) | VERIFIED_FULL_PAGE | https://tinnox.com.au/support/software/ |
| 25 | (missing) Certifications | ISO 9001/14001/45001 (the government page says JAS-ANZ) | VERIFIED_FULL_PAGE | https://tinnox.com.au/iso-certifications/ |
| 26 | (missing) Remote monitoring offered by hardware | RobustMicro: "Optional remote monitoring brings supported status information and alerts"; light-sensor auto-brightness on StructuraSign, DuraBlaze Media and RobustMax; "Operations & Monitoring" application coming soon | VERIFIED_FULL_PAGE | https://tinnox.com.au/digital-kiosk/robustmicro/ |
| 27 | (missing) CMS expectations already promised in marketing | Mobile, portal and USB publishing; single cloud portal across sites; remote scheduling; 4G, Wi-Fi and cabled connectivity; third-party platform compatibility | VERIFIED_FULL_PAGE | https://tinnox.com.au/industries/digital-signage-for-government/ , https://tinnox.com.au/industries/digital-signage-for-education/ |
| 28 | (missing) Current SaaS and data locations relevant to Q9 | HubSpot, Zoho Desk, Google, Meta and Cloudflare; "may store and process information outside Australia, including in the United States" | VERIFIED_FULL_PAGE | https://tinnox.com.au/privacy-policy/ |
| 29 | §1 Business mailboxes: "support mailbox named for warranty claims" | Confirmed: claims go "via a support ticket or support@tinnox.com.au" | VERIFIED_FULL_PAGE (no change) | https://tinnox.com.au/product-warranty/ |
| 30 | §3 Ongoing support: troubleshooting, software updates, maintenance | Confirmed by home FAQ [06] | VERIFIED_FULL_PAGE (no change) | https://tinnox.com.au/ |

### F8. Differences from `scratchpad/research/T01-tinnox-context.md` not already covered above

| T01 statement | Site says | Label | URL |
|---|---|---|---|
| Street address Level 3, 235 Queen St is THIRD_PARTY | It is first-party data (JSON-LD and footer) | VERIFIED_FULL_PAGE | https://tinnox.com.au/ |
| "Transparent LED / indoor LED billboard: UNKNOWN" | Neither is offered on the current site. Micro-LED home-theatre walls appear only in an article | VERIFIED_FULL_PAGE | https://tinnox.com.au/articles/luxury-home-theatre-micro-led-video-walls/ |
| Hardware vendors table: NovaStar UNKNOWN; DsDevice UNKNOWN; Huidu UNKNOWN | NovaStar and DsDevice are named (F3). Huidu is still not on the site | VERIFIED_FULL_PAGE | https://tinnox.com.au/product-warranty/ |
| Pricing UNKNOWN | Only the warranty-extension percentages and a hire promotion are published. No product prices | VERIFIED_FULL_PAGE | https://tinnox.com.au/product-warranty/ |
| Gap 5: "PrecisionPro, VistaBlaze, WinBrite, DuraBlaze: no specs" | PrecisionPro is P1.86 with 4 sizes; DuraBlaze Media is P8 with 4 sizes; VistaBlaze and WinBrite still have no specs | VERIFIED_FULL_PAGE | https://tinnox.com.au/led-video-wall/precisionpro/ |

## Analysis

1. **The device landscape is NovaStar for indoor LED packages, with an unnamed processor for outdoor LED and project-selected players for LCD kiosks.** The site's specific evidence points to NovaStar media-player/controllers (Taurus-class asynchronous players or a sending box with HDMI in, given "the controller's HDMI input path"). TINNOX's answer says Huidu is used "mainly". Both can be true: NovaStar for the PrecisionX packages, Huidu for outdoor and custom builds. That would mean two controller vendors in release 1 (INFERRED). The outdoor packages say only "processor" or "video processor", so their brand is still UNKNOWN.
2. **"DsDevice" now has a first-party source.** It is a hardware brand that TINNOX supplies alongside NovaStar under a 1-year warranty. Given the LCD kiosk wording ("Media-player agnostic", "compatible media player"), the likeliest role is an Android media player inside the LCD kiosks. That is consistent with DSDevices DSDA1/DSDX5, but not proven (INFERRED). If so, the integration surface is an Android player app (TINNOX's own or Xibo), not a vendor cloud.
3. **The marketing has already promised most of the release-1 CMS.** It promises a multi-site cloud portal, remote scheduling, mobile management, USB fallback, 4G/Wi-Fi/wired connectivity and third-party compatibility. It also promises remote monitoring (RobustMicro) and an "Operations & Monitoring" application. The placeholders "Software Products", "DSIaaS" (probably "Digital Signage Infrastructure as a Service", INFERRED), "Partner Login" and "Track Your Project" suggest TINNOX is already planning a software and partner portal. [corrected in verification: they are 5 of 31 disabled nav items, so treat this as a weak signal and confirm it with TINNOX.] That fits the Q7 goal of recurring revenue.
4. **The canvas evidence makes custom pixel dimensions a release-1 requirement.** The site itself tells customers to "use the native pixel canvas when preparing content templates". Content templates per package (S1–S5 sizes) are an easy win.
5. **The published SLA shapes what the operations console needs.** A critical fault is defined as ≥1 m² of screen, power, signal or control equipment, with a same-day or next-day response. The console therefore needs per-display fault classification, timestamps that line up with the SLA clock (reported before or after 12 pm in site-local time, excluding Sundays and public holidays), and a serial-number link to the Zoho Desk ticket form.
6. **Data residency today does not match the "strict AU compliance" goal.** Current SaaS tools may process data in the US. The CMS can still be AU-hosted, but the privacy policy will need a separate section covering the CMS.
7. **The website is in transition.** Older SEO pages sit alongside new package pages, and many links are "coming soon". The docs should cite the new package pages and avoid quoting older pages whose claims have already disappeared.

## Recommendation (PROPOSED)

1. Update `docs/tinnox-context.md` with the 30 rows in F7. Priorities: NovaStar and DsDevice named (rows 16–17), the warranty correction (row 11), the published SLA (row 12), removing the "per-screen licence" inference (row 18), and the brand cues (row 21). Change the labelling scheme to VERIFIED_FULL_PAGE.
2. Release-1 device topologies:
   - **(a)** NovaStar asynchronous player for the PrecisionX packages (integrate through the player's local or LAN API, or as an HDMI source fed by a TINNOX player). [corrected in verification: a Taurus TB60 loads at most about 2.3 M pixels, and its HDMI input tops out at 1920×1200@60. That covers PrecisionMicro S1–S3, PrecisionPro S1–S2 and all PrecisionLuma packages. It does not cover PrecisionPro S3 (2.49 M px), PrecisionPro S4 (3.31 M px) or PrecisionMicro S4 (2.82 M px), which need a higher-capacity NovaStar model or a split canvas. Ask TINNOX which model is in each package.]
   - **(b)** TINNOX player (Android or Linux) feeding Huidu or NovaStar sending hardware over HDMI for outdoor packages.
   - **(c)** TINNOX player app on the LCD kiosk player, which is possibly DsDevice/DSDevices.
   - Ask TINNOX which controller is used in StructuraSign, DuraBlaze and RobustMax.
3. Ship package canvas presets (PrecisionMicro/Pro/Luma S1–S5, StructuraSign S1–S5, DuraBlaze Media Super 4/6/8/Site, kiosk sizes in both orientations) in the screen-setup wizard. Pixel counts for StructuraSign and DuraBlaze must come from TINNOX.
4. Build the published SLA into the operations console: fault severity, SLA timers in the site's time zone, and a serial-number link to Zoho Desk tickets.
5. Use the provisional palette and typefaces (Deep Teal / Midnight / Signal Sky; Manrope and Inter, both SIL OFL) as design tokens until the official assets arrive (Q5). Don't embed the logo PNG until TINNOX supplies it.
6. Treat the "Software Products / DSIaaS / Partner Login" placeholders as the website destinations for the CMS launch, and confirm the intended naming with TINNOX.

## Open items

1. Which controller and processor brand the StructuraSign, DuraBlaze and RobustMax packages use (the site says only "processor"). Is Huidu used there? (Q2 follow-up)
2. Confirm that "DsDevice" on the warranty page means DSDevices (dsdevices.com), and which model and which kiosks use it.
3. Which vendor API access has been granted (Q4). The site makes NovaStar the prime candidate.
4. Pixel resolutions for the StructuraSign and DuraBlaze packages, and pitch and sizes for DuraBlaze Electronic Sign (not published).
5. Operating temperature ranges for all outdoor products (not published).
6. What "DSIaaS" stands for and what is planned for "Software Products", "Partner Login" and "Track Your Project".
7. Contents of compliance.tinnox.com.au (proxy-blocked, 403).
8. Whether New Zealand installs (per the projects page) need support after release 1.
9. Whether the claims removed from the old site (P6 at Sydney Markets, 3000 nits at Brady, 1–2 day install, hire only in VIC/NSW) are still true.

## Sources and search log

**Pages fetched in full (HTTP 200)**, all at https://tinnox.com.au/:

- `/` and `/products/`
- `/led-video-wall/` and sub-pages `precisionmicro`, `precisionpro`, `precisionluma`, `structurasign`, `durablaze-electronic-sign`, `durablaze-media`, `digital-pylon`, `digital-billboard`, `retail-space`, `educational-space`
- `/digital-kiosk/` and sub-pages `edgepro`, `robustpro`, `robustmini`, `robustmicro`, `robustmax`, `entrance-signage`, `indoor-space`, `public-space`
- `/industries/digital-signage-for-business/`, `-education/`, `-government/`, `-retail/`
- `/led-video-wall-hire/`, `/led-video-wall-hire/expos/`, `/led-video-wall-hire/led-hire-overview/`
- `/projects/`, `/product-warranty/`, `/support/`, `/get-a-quote/`, `/iso-certifications/`, `/ethics-and-compliance/`, `/privacy-policy/`, `/terms-and-conditions/`
- 6 articles under `/articles/`

**Assets:** `/robots.txt`, `/sitemap.xml`, `/site.css`, `/nav.css`, `/nav.js`, `/site.js`, `/mark.svg`, `/icon.svg`, `/site.webmanifest`. HEAD requests only for `/assets/brand/tinnox-logo.png` and `/product-warranty/tinnox-product-warranty.pdf` (both 200; not downloaded).

**404 responses:** `/terms/rentals/`, `/support/software/`, `/support/warranty/`.

**Redirects:** `/contact/` goes to `/get-a-quote/`; `/projects/{sydney-markets,brady-residential,strandbags}/` go to `/projects/#…`.

**Blocked:** `https://compliance.tinnox.com.au/` (proxy 403).

**WebSearch:** 1 of 6 used.

| # | Query | Outcome |
|---|---|---|
| 1 | "DsDevice" digital signage media player Australia | Only a DSDevices manuals listing (DSDX5, DSDA1, DSCS9X; https://manuals.plus/category/dsdevices). No Australian distributor found |

## Verification (adversarial pass)

Done on 2026-11-03. Method: re-fetched /product-warranty/, /led-video-wall/precisionpro/ and /led-video-wall/precisionluma/ live and diffed them against the stored copies. Grepped all 44 stored HTML and body files for every quoted string, checked the arithmetic and aspect ratios with Python, and ran 2 WebSearches (out of 6 allowed). Third-party sources: Xibo, DSDevices and NovaStar.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Warranty page names "devices from DsDevice and Novastar" as third-party hardware with a 1-year warranty and no extension | confirmed | Live re-fetch, exact text. https://tinnox.com.au/product-warranty/ |
| 2 | NovaStar appears on 4 pages (PrecisionMicro, Pro and Luma, plus the warranty page); "DsDevice" appears on 1 | confirmed | `grep -l` over html/: exactly those files |
| 3 | Huidu, Colorlight, Linsn, Xibo, Yodeck, Android, VNNOX and ViPlex appear on no page | confirmed | Case-insensitive grep across 44 HTML files: 0 hits |
| 4 | Standard warranty is 2-year product + 1-year on-site (on-site only if TINNOX installs) | confirmed | Live text: "A two-year Product Warranty … A one-year On-Site Service Warranty, on the condition that TINNOX carries out the installation" |
| 5 | Extension is 10% of hardware cost per +2 product years and 10% of install cost per +1 on-site year; maximum 6 years product / 3 years on-site | confirmed | Live text, same page |
| 6 | Worked example: $1,000 hardware + $500 install comes to $1,800 at maximum cover | confirmed (arithmetic) | +4 product years = 2 × 10% × $1,000 = $200. +2 on-site years = 2 × 10% × $500 = $100. $1,000 + $500 + $200 + $100 = $1,800 (AUD implied; the page gives no currency code) |
| 7 | SLA: critical faults get same-day response if reported before 12 pm, otherwise next day, excluding Sundays and public holidays, with a 3–5 business-day turnaround. Non-critical faults get a response within 2 business days and a 7 business-day turnaround. Critical means ≥1 m² of screen | confirmed | Live text, same page |
| 8 | PrecisionX pages say "The package schedule identifies the LED display and a NovaStar media-player/controller" | confirmed | Live re-fetch of Pro and Luma; stored Micro page |
| 9 | PrecisionPro S1–S4 are 1376×774, 1720×946, 2064×1204 and 2408×1376 px, and only S1 is exactly 16:9 | confirmed | Live table. Ratios: 1.778, 1.818, 1.714, 1.750 |
| 10 | PrecisionLuma runs from S1 768×448 to S5 1280×704 at P3.9, only S3 (1024×576) is 16:9, output is 3,500 nits | confirmed | Live text: "The listed 3,500-nit output". 3000 mm / 3.9 ≈ 769 px, consistent with 768 |
| 11 | PrecisionMicro S4 is 2240×1260 px | confirmed | Stored page; exactly 16:9 |
| 12 | Topology (a): a NovaStar asynchronous player can drive the PrecisionX packages | corrected | TB60 capacity is 2.3 M px, with HDMI-in up to 1920×1200@60 (https://oss.novastar.tech/uploads/2024/06/Taurus-Series-Multimedia-Player-TB60-Specifications-V1.1.0.pdf, via search summary; host blocked). PrecisionPro S3/S4 and PrecisionMicro S4 exceed that, so a single Taurus unit cannot drive them. Fixed inline |
| 13 | Menu items "Software Products", "DSIaaS", "Partner Login", "Download Library" and "Track Your Project" are disabled (`data-soon aria-disabled`) | confirmed, but the inference was corrected | They are disabled. However, 31 distinct nav labels carry `data-soon`, including Careers, Leadership, Our Company and ESG, so they are weak evidence of a software plan. Fixed inline |
| 14 | Older copy promises "intuitive CMS software … mobile devices, online portals, or even USB uploads", a "single, cloud-based CMS platform" and "4G, Wi-Fi, and cabled" | confirmed | body/industries__digital-signage-for-{business,education,government}.txt, exact strings |
| 15 | Kiosks say "Media-player agnostic; player and CMS selected for the project" and "can join the system you already manage" | confirmed | robustpro and robustmini body text |
| 16 | RobustMicro is P1.2 flip-chip COB with optional remote monitoring; RobustMax is 88/101/115" | confirmed | Stored body text |
| 17 | StructuraSign is IP65; the business page says IP65, IK10 and "6-year warranty" | confirmed | Stored body text |
| 18 | Privacy policy names HubSpot and Zoho Desk, and says data "may store and process information outside Australia, including in the United States" | confirmed | body/privacy-policy.txt |
| 19 | HQ is Level 3, 235 Queen St, Melbourne 3000; the warehouse is 359 Bluff Rd, Hampton 3188; JSON-LD areaServed is Australia; the projects page says "Australia and New Zealand" | confirmed | home.html JSON-LD (`areaServed` Country / "AU"); projects body |
| 20 | Certifications are ISO 9001/14001/45001, and the government page says "JAS-ANZ" | confirmed | Government body text |
| 21 | Site was rebuilt, with dateModified from 2026-10-31 to 2026-11-03 | confirmed | 31 pages carry 2026-10-31T05:43Z; the latest is 2026-11-03T03:45Z |
| 22 | Brand tokens are Deep Teal #0f4761, Midnight #12212a, Signal Sky #72afc2, Slate #5d6b73, Mist #dce7ea and Porcelain #f6f8f8; fonts are Manrope and Inter | confirmed | assets/site.css custom properties |
| 23 | Manrope and Inter are both SIL OFL | confirmed | https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt ; https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt (both "SIL Open Font License, Version 1.1") |
| 24 | Logo PNG is 1320×429 | confirmed | JSON-LD `logo` width 1320, height 429 (image not downloaded) |
| 25 | No product prices are published | confirmed | Only the warranty page contains "$". The article "outdoor-led-billboard-cost" has no dollar figures |
| 26 | "DsDevice" is probably DSDevices (Android players built for Xibo) | confirmed as stronger THIRD_PARTY evidence; still INFERRED for TINNOX | Xibo's KB uses the singular "DSDevice" (https://docs.xibosignage.com/kb/media-players/removing-a-pre-installed-player-app-version-from-your-dsdevice, title via search; host blocked). DSDA1 ships with Xibo pre-installed (separate licence), runs Android 14 and costs GBP 235 ex VAT (https://dsdevices.com/product/dsda1/, search summary, 2026-11-03). DSCS9X is end of life but still supported (https://xibosignage.com/blog/announcement-dscs9x-and-dscs95-retirement) |
| 27 | The compliance.tinnox.com.au contents | unverifiable | Proxy 403 (not retried as a separate claim) |

**Tally:** 27 claims checked. 24 confirmed, 2 corrected (rows 12 and 13), 0 refuted, 1 unverifiable.

**Does the recommendation still hold? Yes, with two adjustments.**

- The core premises hold. NovaStar and DsDevice are named first-party. Huidu is absent from the site. No CMS is sold. Canvases are non-16:9. The warranty and SLA figures are as stated. Older marketing copy already promises a multi-site cloud CMS. All of these were re-checked against live or stored page text.
- **Adjustment 1, recommendation 2(a).** The NovaStar integration must allow per-package player models and multi-unit or split canvases. PrecisionPro S3/S4 and PrecisionMicro S4 exceed a TB60's 2.3 M-pixel load. The canvas-preset work in recommendation 3 should record which player each package uses.
- **Adjustment 2, recommendation 6.** "Software Products" and "DSIaaS" are only 2 of 31 disabled menu items. Treat them as possible launch destinations to confirm with TINNOX, not as evidence of an existing plan.
- None of the corrections changes the release-1 direction: a TINNOX player app on Android or Linux, plus NovaStar/Huidu controllers fed via LAN API or HDMI.
