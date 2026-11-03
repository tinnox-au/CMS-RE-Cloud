# TINNOX business context for the TINNOX CMS

Date: 2026-11-03. Working product name: **TINNOX CMS**.

How to read this document. Every statement carries one of these labels:

- **VERIFIED PUBLIC**: text that appeared in a web-search result snippet attributed to a tinnox.com.au page or an authoritative registry. The container's network policy blocked opening tinnox.com.au directly, so no page was read in full. Snippets are quoted or closely paraphrased with their URL.
- **THIRD PARTY**: directories, social profiles, blogs. Lower confidence.
- **INFERRED**: a deduction from the above. Treat as a hypothesis.
- **PROPOSED**: a requirement or positioning choice this document recommends for the product. Not a fact about TINNOX.
- **UNKNOWN**: searched for, not found. Listed so it can be asked.

No personal names or personal contact details are recorded.

## 1. Company profile

| Attribute | Finding | Label | Source |
|---|---|---|---|
| Trading name | TINNOX (all caps in site copy) | VERIFIED PUBLIC | https://tinnox.com.au/ |
| Legal entity | UFL Technology Pty Ltd trading as Tinnox | VERIFIED PUBLIC | https://tinnox.com.au/contact/ |
| ABN | 12 656 209 639, Australian private company, main location VIC, GST registered, active from 21 Dec 2021 | VERIFIED PUBLIC | https://abr.business.gov.au/ABN/View?id=12656209639 |
| Headquarters | Melbourne, Victoria | VERIFIED PUBLIC (LinkedIn company page) | https://au.linkedin.com/company/tinnox |
| Locations | Offices listed in Melbourne, Sydney, Brisbane, Perth and the ACT, plus a Melbourne warehouse described as a test-build facility with over 400 sqm of LED cabinets | VERIFIED PUBLIC | https://tinnox.com.au/led-video-wall/digital-pylon/ , https://tinnox.com.au/industries/digital-signage-for-retail/ |
| Coverage | Sales and installation Australia-wide; LED wall hire only in VIC and NSW | VERIFIED PUBLIC (own YouTube channel description) | https://www.youtube.com/channel/UCnwAZpfxbel2MobI-KSWO8A |
| Size | 11 to 50 employees (aggregator estimate) | THIRD PARTY | https://zoominfo.com/c/tinnox/1318605509 |
| Founded | LinkedIn says 2015; ABN registered Dec 2021; a directory says "over ten years" in AU and NZ. Conflicting. | THIRD PARTY | https://au.linkedin.com/company/tinnox , https://diib.com/featuredmembers/tinnox/ |
| Business mailboxes | enquiry@ and support@ at tinnox.com.au; support mailbox named for warranty claims | VERIFIED PUBLIC | https://tinnox.com.au/product-warranty/ |

## 2. Product lines

| Product line | Evidence | Label | Source |
|---|---|---|---|
| LED video walls, indoor and outdoor | Dedicated page; outdoor installs "may require additional weatherproofing"; "real-time content management, remote monitoring, and software updates require a stable internet connection" | VERIFIED PUBLIC | https://tinnox.com.au/led-video-wall/ |
| Digital pylons, new build | Outdoor, 24/7 operation, content customisation | VERIFIED PUBLIC | https://tinnox.com.au/led-video-wall/digital-pylon/ |
| Pylon retrofit, DuraBlaze series | Converts existing static pylon signs into digital displays with LED panels sized to the existing structure | VERIFIED PUBLIC | https://tinnox.com.au/industries/digital-signage-for-business/ |
| Pole-mounted LED signs | Custom pole colours, logo integration | VERIFIED PUBLIC | same |
| LED billboards | Own channel description; a social post about five HD LED billboards on shop rooftops near the MCG | VERIFIED PUBLIC / THIRD PARTY | https://www.youtube.com/channel/UCnwAZpfxbel2MobI-KSWO8A , https://www.facebook.com/TinnoxAustralia/ |
| Outdoor LCD kiosks | Weatherproof housing; extreme conditions may need extra enclosures | VERIFIED PUBLIC | https://tinnox.com.au/digital-kiosk/ |
| Indoor LCD and interactive kiosks | "LCD indoor kiosks for dynamic spaces"; interactive indoor kiosks on the retail page | VERIFIED PUBLIC | https://tinnox.com.au/digital-kiosk/ , https://tinnox.com.au/industries/digital-signage-for-retail/ |
| AdaptiView 250 modular LED cabinets | 250 mm cabinets, curved banners, shopfronts, video-wall backdrops, CAD drawings for designers | VERIFIED PUBLIC | https://tinnox.com.au/industries/digital-signage-for-retail/ |
| Proprietary series names | AdaptiView, PrecisionPro, VistaBlaze, WinBrite "made by UFL Technology Pty Ltd"; DuraBlaze elsewhere | VERIFIED PUBLIC | https://tinnox.com.au/product-warranty/ |
| Pixel pitch and brightness examples | P6 at Sydney Markets; 3000 nits at Brady Residential | VERIFIED PUBLIC | https://tinnox.com.au/projects/sydney-markets/ , https://tinnox.com.au/projects/brady-residential/ |

Implication for the CMS (INFERRED): the fleet is heterogeneous in pixel dimensions and aspect ratio. Retrofitted pylons and modular cabinet walls produce non-16:9 canvases (for example a pylon that is 1.5 wide by 4 tall in cabinet units). A first release that only understands 1920×1080 and 1080×1920 would not fit TINNOX's own product range.

## 3. Services and support model

| Service | Evidence | Label | Source |
|---|---|---|---|
| Installation | 1 to 2 days for a standard indoor install; outdoor longer | VERIFIED PUBLIC | https://tinnox.com.au/led-video-wall/ |
| Warranty | Standard 1-year on-site service warranty when TINNOX installs; extendable up to 6-year product and 3-year on-site; direct purchases only | VERIFIED PUBLIC | https://tinnox.com.au/product-warranty/ |
| SLAs | Extended warranties and SLAs available for select products | VERIFIED PUBLIC | https://tinnox.com.au/led-video-wall/ |
| Ongoing support | Troubleshooting, software updates, maintenance | VERIFIED PUBLIC | https://tinnox.com.au/ |
| Hire | Event and expo hire with truss-based setup and full-service install, VIC and NSW | VERIFIED PUBLIC | https://tinnox.com.au/led-video-wall-hire/ |
| Support pages | Links to /support/software and /support/warranty exist; contents not visible | VERIFIED PUBLIC (link only) | referenced from https://tinnox.com.au/led-video-wall/ |

Implication (INFERRED): TINNOX already carries an on-site service obligation. Each avoided truck roll has direct margin value, so remote diagnostics in the operations console are a revenue feature, not a nice-to-have.

## 4. Software currently offered

| Finding | Label | Source |
|---|---|---|
| "intuitive CMS software makes content management effortless via mobile devices, online portals, or even USB uploads" | VERIFIED PUBLIC | https://tinnox.com.au/industries/digital-signage-for-business/ |
| "Content management systems, software licenses, and integration with third-party systems are sold separately" | VERIFIED PUBLIC | https://tinnox.com.au/led-video-wall/ |
| Software offering described by a directory as a "software as a service (SaaS) content management solution" | THIRD PARTY | https://diib.com/featuredmembers/tinnox/ |
| Name of the CMS vendor currently supplied | UNKNOWN. No snippet names Yodeck, NovaStar VNNOX, ViPlex, Huidu, Xibo or any other platform in a TINNOX context. | |
| LED controller brand in deployed systems | UNKNOWN. No public link between TINNOX and NovaStar was found in search results, despite the task brief saying public materials mention NovaStar and DsDevice. The pages that mention them may simply not be indexed; the hardware questionnaire in `docs/architecture-and-hardware.md` must settle this. | |
| "DsDevice" | UNKNOWN in TINNOX context. The closest real product is DSDevices (dsdevices.com), a vendor of Android signage players (DSDA1, DSDX5; DSCS9 series end-of-life) built to run Xibo for Android, with no public API or cloud platform found. If that is the device, the integration surface is the Xibo player, not a DSDevices API. | THIRD PARTY / INFERRED, see https://dsdevices.com/us/ |

Interpretation (INFERRED): today TINNOX sells a per-screen software licence for a third-party CMS alongside its hardware. The web copy ("mobile, online portal, USB") matches the way LED-controller vendors' cloud products (NovaStar VNNOX, Huidu) and general SaaS signage products (Yodeck) are marketed, so it does not identify the vendor.

## 5. Owning and operating software versus re-branding someone else's service

This distinction matters for the brief and is the premise for the whole spec.

| | White-label or resold service (what the public copy is consistent with today) | Owned product (TINNOX CMS as proposed) |
|---|---|---|
| Source code | Vendor's; TINNOX cannot change behaviour | TINNOX's (or an open-source base under a licence that permits it); behaviour is a roadmap decision |
| Hosting and data | Vendor's regions and terms; customer data residency not under TINNOX control | TINNOX chooses Australian hosting and retention rules |
| Pricing | Vendor sets floor per screen; margin is a resale markup | TINNOX sets price; cost is hosting plus engineering |
| Feature fit for LED pylons, custom canvases, Australian time zones | Only if vendor supports it | Built to TINNOX's hardware |
| Support | Two-tier (TINNOX then vendor); diagnostics limited to what vendor exposes | TINNOX owns device telemetry and support tooling |
| Risk | Vendor price changes, discontinuation, API changes; brand confusion | Engineering cost, operational responsibility (uptime, security, updates) |
| Time to market | Weeks | Months for a narrow first release (see `docs/implementation-backlog.md`) |

PROPOSED position: TINNOX CMS is an owned, maintained product sold with TINNOX hardware. An interim white-label service is evaluated in `docs/architecture-and-hardware.md` as a bridge only.

## 6. Customer segments and scenarios

Industry pages exist for business, retail, education and government, and hire for events and expos (VERIFIED PUBLIC: https://tinnox.com.au/industries/digital-signage-for-education/ , https://tinnox.com.au/industries/digital-signage-for-government/ , https://tinnox.com.au/led-video-wall-hire/expos/). Example projects: Sydney Markets (two P6 LED screens), Edith Cowan University entrance display (Perth), Strandbags (retail), Brady Residential (3000-nit outdoor display), billboards near the MCG (VERIFIED PUBLIC / THIRD PARTY, URLs in section 2).

The four scenarios used throughout the spec (PROPOSED, derived from these segments):

1. **School schedules notices on an outdoor sign.** One site, one landscape or portrait LED sign, weekly timetable of notices, term dates, emergencies. Office staff, not designers.
2. **Retailer updates promotions across locations.** One customer, many sites in different states and time zones, same campaign with per-site exceptions, strict start and end dates.
3. **Council manages public-information kiosks.** Portrait LCD kiosks, long dwell content, accessibility expectations, approval workflow, proof that content played.
4. **TINNOX support investigates a display that stopped updating.** Operations console: last heartbeat, download state, storage, network, screenshot, remote restart, audit trail of who changed what.

## 7. Branding cues available

| Cue | Finding | Label |
|---|---|---|
| Name styling | "TINNOX" all caps in body copy; "Tinnox" in titles and social handles | VERIFIED PUBLIC |
| Title tagline | Page titles end with "LED Digital Signage Australia" | VERIFIED PUBLIC |
| Product naming | Compound names: AdaptiView, PrecisionPro, VistaBlaze, WinBrite, DuraBlaze | VERIFIED PUBLIC |
| Colours, logo, typography | UNKNOWN (no snippet described them) | |

PROPOSED: the CMS uses TINNOX's own brand assets supplied by TINNOX and an original interface design. No Yodeck assets, copy, icons or layouts are reused.

## 8. What this means for the product

- Two interfaces, one platform (PROPOSED, from the brief): a **customer portal** (content, playlists, schedules, sites, displays, users) and a **TINNOX operations console** (provisioning, fleet health, support access with audit, customer administration).
- The hardware range forces first-class support for **custom pixel dimensions and portrait** canvases, and for an **external player feeding an LED controller over HDMI** as at least one supported topology (INFERRED from product lines; topology confirmed only after the hardware questionnaire).
- The service model makes **remote diagnostics and an audited support path** a day-one requirement (INFERRED from warranty and SLA offerings).
- The multi-state footprint makes **site-local Australian time zones with daylight-saving correctness** a day-one requirement.

## 9. Gaps to close with TINNOX

1. Which CMS is sold today, under what licence terms, and how many screens are on it.
2. Which LED controllers, sending cards and players are deployed (make, model, firmware), and whether any are NovaStar Taurus-class Android players or synchronous controllers behind an HDMI source.
3. What "DsDevice" refers to.
4. Brand assets (logo, colours, type) for the interface.
5. Whether NZ operations exist (affects time zones: Pacific/Auckland).
6. The contents of tinnox.com.au/support/software, which could not be opened from this environment.
