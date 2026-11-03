# R6: Commercial model for TINNOX hardware with its own CMS (Q7)

Date: 2026-11-03. Round-2 research agent. Answers Q7: "not sure, the plan is to sell hardware with our own software to increase the profit and recurring rev". It also uses Q1 (no CMS today), Q6 (Australia only in release 1) and Q11 (PDF, PowerPoint and web in release 1 or 2).

Labels follow CONTEXT.md: VERIFIED_FULL_PAGE, OFFICIALLY_DOCUMENTED, THIRD_PARTY, INFERRED, UNKNOWN, PROPOSED.

**FX used:** 1 USD = AUD 1.449. This is 1/0.69, the rounded rate for 1 Oct 2026; the unrounded 0.6928 USD per AUD gives 1 USD = AUD 1.443, so every AUD conversion below is about 0.4% high, which changes no conclusion [corrected in verification] (0.6928 AUD/USD from R3 (THIRD_PARTY, https://www.exchange-rates.org/exchange-rate-history/aud-usd-2026-10-01). No rate for 3 Nov 2026 was fetched. EUR and GBP prices are left unconverted. All AUD figures are **ex GST** unless stated otherwise.

---

## Summary

- **The market sells software per screen per month.** Mainstream cloud CMS list prices fall between **AUD 7 and AUD 45 per screen per month**. Xibo Cloud is AUD 7.10–18.26, Yodeck AUD 13.00–25.00, Samsung VXT and LG SuperSign about AUD 18–36, ScreenCloud AUD 29–43, and Signagelive about AUD 33. Annual prepayment and volume discounts above roughly 50 screens are normal.
- **LED makers usually include basic control software with the hardware.** Daktronics includes Venus Control Suite *Basic* "in the cost of the LED display" and sells it on 1-, 3-, 5- or 10-year terms. Paid tiers and System Health monitoring are extra. Watchfire Ignite OPx is reported to have "no charge… no monthly subscription fees" (not re-confirmed in verification: vendor site unreachable, search found only the add-on price); its paid add-on is an AI content generator at USD 9.99/month. Chinese controller clouds (NovaStar VNNOX, Huidu) publish no prices. One EU reseller sells a one-year VNNOX licence at EUR 214.
- **What customers expect at the low end:** "the sign's software comes free". At the high end they expect "monitoring and support cost a recurring fee". TINNOX's recurring revenue therefore has to be tied to **monitoring, support, warranty extension and SLA**, not only to "access to the CMS".
- **PROPOSED model:** sell hardware with **12 months of TINNOX CMS included**, matching the 1-year on-site warranty. After that, a per-display subscription in three tiers (PROPOSED price bands, AUD ex GST per display per month, annual prepay):
  - **Essential:** AUD 15–19
  - **Professional:** AUD 25–32
  - **Managed:** AUD 49–79, including content changes, proactive monitoring and an SLA
- **Two further options:** a **3- or 5-year prepaid term** for councils and schools that want capital spend, and an **all-in monthly "TINNOX Signage-as-a-Service"** rental (hardware + install + CMS + warranty) through a finance partner.
- **No perpetual licence.** A hosted service has ongoing costs, so it does not fit a perpetual licence. Use prepaid multi-year terms instead (the Daktronics pattern).
- **Unit economics (50 customers × 3 screens = 150 displays, mixed tiers):** about **AUD 3,225 MRR, which is AUD 38,700 ARR** ex GST. Hosting is about **AUD 220–390/month**, which is **7–12% of MRR** (AUD 1.45–2.60 per display), from A04/R3 cost numbers. Hosting is not the issue. Fixed engineering and support cost is. Software alone pays for a small engineering team only at roughly 1,800–2,300 displays (R4 arithmetic) [corrected in verification; was 1,500–2,500]. Below that, it is justified by higher hardware margin and lower churn.
- **Billing is a product feature.** The product needs entitlements per customer and per display, quotas (licensed displays, storage, retention, API), licence states with **"disabled, not deleted"** behaviour, and a monthly **billing export** to TINNOX's accounting system. The spec currently assumes "no in-product billing" (A2). Release 1 needs at least entitlements, licence states and the export, even with operator provisioning.
- **Never blank a public sign for non-payment.** Yodeck flashes a red image on customers' screens after 5 days of failed payment and deactivates all but one screen after 2 weeks (VERIFIED_FULL_PAGE). TINNOX should lock **publishing**, not **playback**. LED signs face the public, and a dark pylon damages TINNOX's own brand.
- **Australian rules that affect pricing (INFERRED from sources):**
  - Quote businesses ex GST with a clear label. The ACCC B2B carve-out allows this; consumer-facing prices must include GST.
  - Standard-form contracts with small businesses (under 100 staff or under AUD 10M turnover) are within the **unfair contract terms** penalty regime from 9 Nov 2023 [corrected in verification; most sources and state regulators give 9 Nov]. Auto-renewal, unilateral price rises and suspension clauses need legal review.
- **Advertising/billboard revenue share:** defer. The spec already excludes advertising sales (§9). Overseas sources give landowner shares of 15–25% of ad revenue. TINNOX can sell **proof-of-play reporting** in Professional now and a platform fee later.

---

## Findings

### F1. Cloud CMS licence prices (per screen per month)

AUD conversions use 1 USD = AUD 1.449. "Native AUD" means the vendor publishes an AUD price.

| # | Vendor / plan | Published price | AUD / screen / month | Terms and notes | Label | Source |
|---|---|---|---|---|---|---|
| 1 | **Yodeck** Basic / Premium / Enterprise (AUD price list) | AUD 13.00 / 18.50 / 25.00 | **13.00 / 18.50 / 25.00** (native AUD) | "Prices are based on annual billing. Monthly billing may incur slightly higher rates." Annual plans include a free player per screen. All screens in an account must be on the same plan | VERIFIED_FULL_PAGE | https://help.yodeck.com/en/articles/456067-multicurrency ; https://help.yodeck.com/en/articles/456066-pricing-plans-screens |
| 2 | Yodeck 2026 increase | +USD 1/screen/month on Premium and Enterprise from 1 Apr 2026; AUD list as row 1 | same | The help article "How is Yodeck priced?" (updated 17 Jun 2026) still shows $8/$12/$16. The 2026 update and the AUD list disagree with it on Premium/Enterprise. Treat row 1 as current AUD | VERIFIED_FULL_PAGE | https://help.yodeck.com/en/articles/543957-yodeck-pricing-update-2026 ; https://help.yodeck.com/en/articles/456128-how-is-yodeck-priced |
| 3 | Yodeck free and trial | 1 screen free (Basic). 30-day "Unlimited Access Period" with 5 screens. Partner-created accounts get **demo licences** that do not bill and offset the billable count | n/a | No discount up to 50 screens; quote above 50 | VERIFIED_FULL_PAGE | https://help.yodeck.com/en/articles/589475-yodeck-unlimited-access-period ; https://help.yodeck.com/en/articles/835172-client-subscription-management ; https://help.yodeck.com/en/articles/456060-volume-discounts |
| 4 | Yodeck Assurance (hardware add-on) | USD 1/player/month or USD 12/year | 1.45 | Warranty for the life of the subscription, ship-first replacement | VERIFIED_FULL_PAGE | https://help.yodeck.com/en/articles/465480-yodeck-assurance |
| 5 | **Xibo Cloud** Professional / Business / Enterprise | USD 4.90 / 7.70 / 12.60 per display/month | **7.10 / 11.16 / 18.26** | Cloud hosting + help desk included, any player. Per-display allowances: 1 / 1.5 / 2 GB storage and 4 / 6 / 8 GB bandwidth. Proof-of-play retention 62 / 62 / 124 days; audit-log retention 1 month / 3 months / 1 year [corrected in verification]. SAML from Business up | VERIFIED_FULL_PAGE (page JSON-LD and pricing table read from the fetched HTML) | https://xibosignage.com/pricing |
| 6 | Xibo self-hosted + perpetual player licences | CMS free (AGPLv3). Android USD 28, webOS/Tizen USD 85, ChromeOS USD 49 one-off per display | 40.57 / 123.17 / 71.00 one-off | "Minor software upgrades at the current version. Major software upgrades are available for a fee." | VERIFIED_FULL_PAGE | https://xibosignage.com/pricing |
| 7 | **ScreenCloud** Core / Pro | Core "$20 per screen/mo + VAT"; Pro "$30… paid annually, minimum of 5 screens". Third parties report 24/36 and 27–47 | 28.98 / 43.47 (assuming USD) | Pro adds Microsoft integrations; Enterprise is quoted | OFFICIALLY_DOCUMENTED (snippet) / THIRD_PARTY | https://screencloud.com/pricing ; https://frontdeskreview.com/software/digital-signage/screencloud/ ; https://getpulsesignal.com/compare/appspace-vs-screencloud |
| 8 | **Fusion Signage** (Australian) Basic / Advanced / Pro | AUD 9 / 12 / 19 per licence/month, monthly billing; Basic AUD 99/year | **9 / 12 / 19** (native AUD, ex GST) | The official page says prices are "AUD ex GST", with a licence per installation (screen or player). The tier figures date from 2021 and are likely stale | OFFICIALLY_DOCUMENTED (ex-GST basis) / THIRD_PARTY (figures) | https://fusionsignage.com.au/pricing ; https://support.fusionsignage.com.au/getting-started/licence-types ; https://www.saasworthy.com/product/fusion-signage/pricing |
| 9 | **Signagelive** Standard | GBP 200 / USD 270 / EUR 230 per player per year | 32.60 | Per player, up to 2 outputs. Video-wall players are licensed separately | OFFICIALLY_DOCUMENTED (snippet) | https://signagelive.com/pricing ; https://www.fugo.ai/blog/signagelive-pricing/ |
| 10 | **OptiSigns** | USD 10–45/screen/month (USD 9–40.50 annual). Video-wall add-on USD 25/wall/month | 14.49–65.21 | Standard plan capped at 25 users | THIRD_PARTY (competitor blog) | https://www.risevision.com/blog/optisigns-pricing |
| 11 | **Rise Vision** | From USD 11/display/month; Advanced USD 13. Schools flat USD 1,399/year unlimited | 15.94 / 18.84 | 10% education/non-profit discount | THIRD_PARTY | https://www.g2.com/products/rise-vision-digital-signage/pricing |
| 12 | **NoviSign** | Entry USD 20/screen/month | 28.98 | No official 2026 list found | THIRD_PARTY | https://www.g2.com/compare/novisign-digital-signage-vs-rise-vision |
| 13 | **Samsung VXT** CMS | USD 20/month or USD 200/year per screen (reseller). CDW: USD 150/year Standard, USD 40/month P-Series Pro | 18.11–28.98 (Pro about 58) | Licensing unit differs by reseller (per screen vs per user). No official list | THIRD_PARTY | https://www.knitec.com/products/samsung-vxt-cms-cloud-based-solution-for-digital-signage ; https://www.cdw.com/product/samsung-vxt-cms-standard-subscription-license-1-year-1-display/7705945 |
| 14 | **LG SuperSign Cloud** CMS | 1-year per-display MSRP USD 225–300; 3-year USD 900; monthly Standard USD 23 | 27.17–36.23 | The Exertis SKU "SSC-Y1SLB.AUS" suggests an AU channel SKU; its currency is not confirmed | THIRD_PARTY | https://www.shidirect.com/product/46376729/SUPERSIGN-CLOUD-CMS1YEAR-LICENSE-PER-DISPLAY ; https://exertisalmo.com/productdetails/LGPRO/SSC-Y1SLB.AUS ; https://www.compsource.com/buy/SSCSLS/Lg-251/ |
| 15 | **BrightSign BSN.cloud** | Control Cloud free (health only). Content Cloud USD 99 or USD 139 per player/year (BrightSign docs disagree). Resellers USD 359/year, GBP 416/year | 11.95–16.78 | A good analogue for a "free control, paid content" split | OFFICIALLY_DOCUMENTED (snippets) / THIRD_PARTY | https://docs.brightsign.biz/faqs/general ; https://brightsign.atlassian.net/wiki/x/vwChc ; https://cdwg.com/product/bsn.cloud-subscription-license-1-year-1-player/7059301 |
| 16 | Pickcel Professional | USD 13.50/month (annual) | 19.56 | Market reference only | THIRD_PARTY | https://www.pickcel.com/blog/digital-signage-australia/ |

### F2. How LED hardware vendors and integrators bundle software

| # | Vendor | Bundle pattern | Paid parts | Label | Source |
|---|---|---|---|---|---|
| 1 | **Daktronics Venus Control Suite** | Basic tier "included in the cost of the LED Display". Subscription terms of 1, 3, 5 or 10 years appear as a line item on the quote. Council quotes show "Basic 10-Year Subscription" | Select (minimum for LCD), Professional tiers; **System Health** annual subscription. Legacy upgrade: USD 10,000 activation + USD 200/player (old blog) | OFFICIALLY_DOCUMENTED (snippets) | https://www.daktronics.com/en-us/support/kb/000030459 ; https://www.daktronics.com/en-us/support/kb/000025045 ; https://www.daktronics.com/blog/upgrade-galaxy-and-galaxypro-displays-with-venus-control-suite |
| 2 | **Watchfire Ignite OPx** | "No charge… no user and no monthly subscription fees" for a Watchfire sign | AI content generator, from USD 9.99/month, with credits | OFFICIALLY_DOCUMENTED (snippet) | https://www.watchfiresigns.com/led-signs/ignite-opx/ ; https://www.signshop.com/news/watchfire-brings-ai-powered-content-creation-directly-to-digital-signage-with-new-ignite-content-generator/ |
| 3 | **NovaStar VNNOX** (Standard / AD for content, Care for monitoring) | Only async players (TB/TU series, VPlayer) can publish through VNNOX Standard/AD | One EU reseller lists a "VNNOX licence 1 year" at EUR 214 (tier not stated). Official prices UNKNOWN | THIRD_PARTY | https://audioeffetti.com/en/category/video/led-wall-management/novastar-vnnox-lic1-y-vnnox-license-1-year-validity-cloud-based-led-screen-digital-management-monitoring-and-maintenance-solution-p114377 ; https://dynamo-led-displays.co.uk/novastar-cloud-cms/ |
| 4 | **Huidu** (HDPlayer, XiaoHui Cloud) | Desktop/LAN software comes with the card. Cloud pricing and terms not found | UNKNOWN | UNKNOWN | R1 open item 17 (`R1-huidu-integration.md`); searches 17 and 19 below returned nothing |
| 5 | **Absen** (ScreenHub) | Described as a free SaaS CMS for LED and other screens (press items may be old) | UNKNOWN | THIRD_PARTY | https://www.cbinsights.com/compare/absen-vs-cirrus-led-systems ; https://www.sixteen-nine.net/?p=10809 |
| 6 | **Unilumin** | No bundled cloud CMS offer found | UNKNOWN | UNKNOWN | search 20 below |
| 7 | **Allsee** (UK LCD) | "1 year free subscription to our CMS" with rod displays | Subscription after year 1 | THIRD_PARTY | https://allsee-tech.com/digital-signage-blog/?p=4122 |
| 8 | Yodeck resellers | May give players "for free, as a lease, or… for purchase" and may run a fully managed service. White-label partners set their own prices | Annual white-label fee | VERIFIED_FULL_PAGE | https://help.yodeck.com/en/articles/456156-what-are-the-different-types-of-yodeck-partners |
| 9 | **Australian LED integrators** (LED-Signs, Big Screen Video, Engagis managed service) | No published CMS-bundle or monthly managed price found. Engagis calls itself an "end-to-end managed service provider" (Telstra stores) | UNKNOWN (quoted per project) | THIRD_PARTY | https://led-signs.com.au/ ; https://engagis.com ; https://oma.org.au/outdoor-advertising-company-list/big-screen-video |

### F3. Commercial model patterns

| # | Model | Who uses it | Pros for TINNOX | Cons / risks | Label / evidence |
|---|---|---|---|---|---|
| M1 | **Included for N years, then subscription** | Daktronics (Basic included, terms up to 10 years); Allsee (1 year free); Yodeck (free player with an annual plan) | Removes a price objection at sale. The included period can match the 1-year on-site warranty (tinnox-context.md). Renewal is a natural sales touchpoint | Some customers lapse at renewal, so the product needs a graceful lapse path. Hosting cost for the included year must be built into the hardware price | OFFICIALLY_DOCUMENTED (F2 #1, #7); INFERRED |
| M2 | **Per-screen SaaS tiers** | Yodeck, Xibo, ScreenCloud, Signagelive, Samsung, LG, Fusion | Customers understand it. Revenue scales with screens. Tiers allow feature upsell | Price-comparable with AUD 7–25 products, so TINNOX must sell its support, not the software alone | VERIFIED_FULL_PAGE / OFFICIALLY_DOCUMENTED (F1) |
| M3 | **Managed service / Signage-as-a-Service (hardware lease + CMS + support, monthly)** | Yodeck resellers (lease or free players); Engagis-style managed services; 2007 Telstra/3M subscription | Converts large capex (pylons, billboards) into opex. Highest recurring revenue per site. Ties the customer in for 36–60 months | Needs a finance partner or balance sheet, plus credit checks, asset recovery and insurance. The rental factor is not sourced (INFERRED) | VERIFIED_FULL_PAGE (F2 #8); THIRD_PARTY (https://news.3m.com/2007-02-08-3M-Digital-Signage,-Prime-Digital-Media-and-Telstra-to-Provide-Unique-Digital-Signage-Solution) |
| M4 | **Perpetual licence + annual support** | Xibo players (perpetual, major upgrades paid); legacy on-premise CMSs | Suits capital budgets | A poor fit for a hosted multi-tenant service with ongoing hosting, security and Australian-compliance costs | VERIFIED_FULL_PAGE (F1 #6); INFERRED |
| M5 | **Content services add-on** | Watchfire AI content (USD 9.99/month); Xibo professional services ("Contact us"); managed providers | High margin. Uses TINNOX's install and design relationship. Helps schools and small retailers who lack designers | Labour-bound; needs scoping (changes per month) | OFFICIALLY_DOCUMENTED (F2 #2); VERIFIED_FULL_PAGE (Xibo page "Professional Services") |
| M6 | **Proof-of-play / ad revenue share (billboards)** | Landowner leases: 15–25% of gross or net ad revenue (US/general sources). Sydney Olympic Park tender: minimum rent + revenue share | Upside on billboard sites TINNOX installs | Needs ad booking, share-of-voice, audited proof of play and invoicing. All are out of scope (spec §9). Huidu async cards cannot give audited play logs (R1) | THIRD_PARTY https://beancount.io/blog/2026/07/11/billboard-outdoor-advertising-ground-lease-landowner-guide ; https://www.adnews.com.au/news/sydney-olympic-park-seeks-ooh-operator |

### F4. How lapses are handled (reference for "disabled, not deleted")

| # | Behaviour | Label | Source |
|---|---|---|---|
| 1 | Yodeck failed charge: email; after 5 days "every 2 hours, a flashing red image (without any text)… for 2 minutes"; after 2 weeks downgrade to free with "only 1 [screen] will remain active" | VERIFIED_FULL_PAGE | https://help.yodeck.com/en/articles/456134-what-happens-if-a-charge-for-my-subscription-fails |
| 2 | Yodeck partner cancellation: set quota 0 ("Screens stop displaying immediately"). Billing is "calculated on max(quota, registered)". Account left "dormant… in case they return"; content does not transfer between accounts | VERIFIED_FULL_PAGE | https://help.yodeck.com/en/articles/835172-client-subscription-management |
| 3 | Yodeck partner billing: monthly consolidated invoice on the 1st; annual or multi-year per account; mid-cycle additions prorated immediately; reductions at renewal | VERIFIED_FULL_PAGE | https://help.yodeck.com/en/articles/680807-prepayment-and-renewal |
| 4 | Yodeck player offline cutoff after 30–40 days (TINNOX spec §14 rejects an offline cutoff for a licensed display) | REFERENCE (spec) | /home/user/CMS-RE-Cloud/docs/tinnox-mvp-spec.md §14 |

### F5. Australian pricing and contract rules

| # | Rule | Label | Source |
|---|---|---|---|
| 1 | Prices shown only to businesses do not need to include GST. Consumer-facing prices must show the GST-inclusive total. The ACCC calls stating the full price with all components "best practice" | OFFICIALLY_DOCUMENTED (snippet) | https://www.accc.gov.au/consumers/pricing/price-displays |
| 2 | Unfair contract terms: penalties apply to standard-form consumer and small-business contracts entered, renewed or varied from 9 Nov 2023 [corrected in verification]. "Small business" means under 100 employees or under AUD 10M turnover. SaaS is called out as exposed. A March 2026 penalty doubling is reported by one source but not confirmed | THIRD_PARTY (law firms) | https://hamiltonlocke.com.au/unfair-contract-terms-regime-what-are-the-new-penalties-for-australian-businesses/ ; https://www.consumer.vic.gov.au/latest-news/new-penalties-from-today-for-businesses-using-unfair-contract-terms ; https://www.astrislaw.com/article/unfair-contract-terms-small-business |
| 3 | Fusion Signage (Australian) publishes "AUD ex GST" per-licence pricing, which is the local convention for B2B signage software | OFFICIALLY_DOCUMENTED (snippet) | https://fusionsignage.com.au/pricing |

### F6. Cost inputs (from earlier research)

| # | Item | Value | Label | Source |
|---|---|---|---|---|
| 1 | Hosting, pilot of 50 screens | USD 60–110/month | INFERRED from AWS price list (A04) | A04-cms-stack-components.md, "Cost" summary and cost tables |
| 2 | Hosting, 500 screens | USD 450–750/month; about USD 0.80–1.50 per screen | INFERRED (A04) | A04-cms-stack-components.md |
| 3 | All-Australia AWS model | AUD 110 at 10 screens, 260 at 100, 1,000 at 500 (HA), 2,900 at 2,000; i.e. AUD 10.90 / 2.63 / 2.00 / 1.46 per screen | INFERRED from VERIFIED_FULL_PAGE prices (R3) | R3-au-hosting-compliance.md, Summary |
| 4 | Android MDM if used | USD 2–6/device/month | THIRD_PARTY (H02 via R4) | R4-player-hardware-recommendation.md row 9 |
| 5 | Warranty baseline | 1-year on-site when TINNOX installs; extendable to 6-year product / 3-year on-site | VERIFIED (public) | https://tinnox.com.au/product-warranty/ (via docs/tinnox-context.md) |

---

## Analysis

1. **Where TINNOX can price.** List prices group into three bands:
   - Open-source-backed cloud (Xibo): AUD 7–18.
   - SMB SaaS (Yodeck, Fusion, Rise, OptiSigns): AUD 9–25.
   - OEM and enterprise (Samsung, LG, ScreenCloud, Signagelive): AUD 18–45.

   TINNOX sells installed LED and LCD hardware with on-site warranty, so its buyers compare it with the OEM band ("the screen maker's software"), not with Xibo. The INFERRED pitch is local support, LED-native canvases and one throat to choke. An **Essential tier at AUD 15–19** sits just above Yodeck Basic (AUD 13) and below OEM clouds. A **Professional tier at AUD 25–32** matches Yodeck Enterprise (AUD 25) and the Samsung/LG range.
2. **Software alone will not make large profits at TINNOX's likely scale. Bundling changes the hardware sale.** At 150 displays the CMS brings in about AUD 39k a year. That covers hosting many times over, but not a development team. The commercial case rests on three things (INFERRED):
   - higher win rate and hardware margin from a "complete solution" with local support;
   - recurring revenue that raises business value;
   - fewer site visits through remote diagnostics (spec §7.5).

   The model should push customers into **multi-year prepaid terms and the Managed tier**, where revenue per display is 2–4 times Essential.
3. **The included year must be priced in.** Twelve months of Essential is worth AUD 180–228 per display at list price. Its cost to TINNOX is about AUD 24–32 a year in hosting (F6 #3 at 100–500 screens: AUD 2.00–2.63 × 12) [corrected in verification; was 18–31] plus support time. Show it on the quote as a line item ("TINNOX CMS Essential, 12 months, included"), as Daktronics does. That keeps the renewal price anchored.
4. **Free control, paid content (BrightSign) versus free basic (Daktronics, Watchfire).** LED buyers expect the sign to be controllable for its whole life without a subscription. If a lapsed customer's sign goes dark, or their content gets locked, that creates disputes, and it creates unfair-contract-terms risk under F5 #2 for small-business customers. The PROPOSED lapse rule is "the player keeps playing the last publication; publishing and new uploads are locked; monitoring alerts to TINNOX stop". This keeps the sign working and still gives the customer a reason to renew. Yodeck's flashing red image (F4 #1) is a pattern to avoid on public LED signage.
5. **Perpetual licence: no.** Use prepaid terms of 3 or 5 years (Daktronics offers 1/3/5/10; LG sells 3-year SKUs). Councils and schools can then capitalise the software with the hardware, and TINNOX keeps a renewal date.
6. **Signage-as-a-Service fits pylons and billboards.** These are high-capex assets (fuel stations, shopping centres, clubs). A monthly all-in price makes the sale easier. TINNOX should use a third-party equipment-finance partner rather than its own balance sheet. The CMS must then let a finance or contract record suspend publishing (not playback) on default, and must keep hardware serials linked to contracts.
7. **Advertising revenue share is a later product.** It needs audited proof of play. R1 says Huidu async cards cannot provide that, so it would be honest only on TINNOX-player sites. It also needs share-of-voice scheduling and invoicing. The Professional tier's playback report is the bridge: billboard owners can use it to evidence campaigns to their own advertisers.
8. **Self-serve versus provisioned (Q7 second half).** All TINNOX customers come through a hardware sale, so **operator-provisioned** accounts are the right start, as spec A2 already says. Self-serve card payment (for example via a payment provider) is a release-2+ option, useful when TINNOX sells "software only" for existing third-party screens.

---

## Recommendation (PROPOSED)

### R1. Packaging

| Package | What the customer buys | Price band (AUD ex GST, PROPOSED) | Notes |
|---|---|---|---|
| **Hardware + 12 months Essential included** | Every installed display gets 12 months of TINNOX CMS Essential | Built into the hardware price (list value AUD 180–228 per display shown as a line item) | Matches the 1-year on-site warranty. Upgrade to Professional at a pro-rata difference |
| **Subscription after the included period** | Per display per month, billed annually in advance (monthly allowed at +15%) | Essential **15–19**; Professional **25–32**; Managed **49–79** | Volume pricing above 50 displays per customer (quote), as Yodeck does |
| **Prepaid term** | 3 or 5 years of a tier, paid at hardware purchase | 3-year = 32 months' price; 5-year = 50 months' price | For councils and schools with capital budgets; keeps a renewal date |
| **TINNOX Signage-as-a-Service** | Hardware + installation + Managed tier + extended warranty, 36 or 60 months, one monthly fee | Quote per site via a finance partner (INFERRED: rental factor to be supplied by the partner) | For pylons, billboards and multi-site retail. Hardware is recovered at end of term or bought out |
| **Content services** | Design and scheduling by TINNOX | Pack: AUD 99–149/month for up to 2 content changes; ad hoc AUD 110–150/hour (INFERRED market band, not sourced) | Included in Managed up to a stated number of changes |
| **Software-only** (existing third-party screens, release 2+) | Professional tier on a TINNOX-supplied player | Professional price + player hardware | Optional self-serve later |
| **Advertising / revenue share** | Deferred (spec §9) | — | Revisit after audited proof of play is proven on TINNOX players |

GST: quote and invoice B2B prices **ex GST, clearly labelled "+ GST"**, with GST shown on the tax invoice (F5 #1). Any consumer-facing or website price must show the GST-inclusive total. Have Australian counsel review standard terms (auto-renewal notice, price-change notice with a right to terminate, suspension) under the unfair contract terms regime (F5 #2).

### R2. Tiers mapped to the first-release spec

| Feature (spec section) | Essential | Professional | Managed |
|---|---|---|---|
| Media: images, video, folders, tags, availability (§4, §15) | yes | yes | yes |
| Storage quota (pooled per customer, §15 "Quotas") | 5 GB per licensed display | 20 GB per display | 50 GB per display |
| Playlists, full-canvas and two-region layouts (§6.4–6.5) | yes | yes | yes |
| Scheduling with site time zones, priority, preview (§6.7, §11) | yes | yes | yes |
| Publish, delivery states, rollback (§6.8, §12) | yes | yes | yes |
| Users and roles (Owner, Admin, Editor, Viewer) with MFA (§8) | up to 5 users | unlimited | unlimited |
| Site scoping of users (§8) | — | yes | yes |
| Offline and alert emails (§13) | yes | yes | yes (and TINNOX watches alerts proactively) |
| Screenshot on demand (§13) | yes | yes | yes |
| Periodic screenshots, 7-day retention (§13) | — | yes | yes |
| Playback log and CSV export (§6.11, §13) | 31-day retention | 13-month retention | 25-month retention |
| Customer audit log incl. TINNOX support sessions (§6.10, §7.6) | 90 days | 13 months | 25 months |
| Read-only API with service tokens (§16) | — | yes | yes |
| PDF to images (§15); PowerPoint and web pages (Q11, release 1 or 2) | PDF | PDF, PowerPoint, web pages | all |
| LED controller brightness and power (§9, release 2) | — | yes when available | yes |
| Remote diagnostics bundle and triage (§7.5) | used by TINNOX support | same | same, with a monthly health report |
| Support | Business hours, email/phone | Priority, next-business-day response target | SLA (for example 4 business hours response), content changes, quarterly review |
| SSO/SAML (§9, when required) | — | — | yes (as Xibo puts SAML in a higher tier) |

Retention days are PROPOSED and copy the *pattern* of Xibo's tiered proof-of-play and audit retention (F1 #5). Final values depend on the APP 11 retention schedule in R3.

### R3. What the product must build (release 1 unless noted)

1. **Entitlements.**
   - Per customer: `plan` (essential/professional/managed), `term_start`, `term_end`, `billing_cycle`, `included_until`, `price_book_id`, `currency=AUD`, `tax=GST`.
   - Per display: `licence_state` and `licence_end`.
   - Feature checks go through one entitlement service (feature flags keyed by plan), never through scattered `if plan ==` code. Every entitlement change is audited (actor, before/after).
2. **Licence states per display**, as an explicit state machine:
   `demo` (not billable; offsets count, like Yodeck demo licences) → `included` → `active` → `grace` (30 days after `licence_end` or non-payment; banner in the portal only, never on the screen) → `suspended` → `expired`.
   - **suspended:** publishing, uploads and new users locked; the player keeps playing the last publication; alerts to TINNOX off; portal read-only.
   - **expired:** after 90 days suspended. The player keeps the last publication or a customer-chosen holding slate. Data is retained for a further 90 days with written notice before deletion.
3. **Disabled, not deleted.**
   - Every lapse, downgrade or cancellation keeps media, playlists, schedules, publications, playback logs and audit logs until a documented deletion date.
   - A downgrade disables features above the plan but keeps their data (for example API tokens become `disabled`, site scopes are kept but not enforced read-only). Re-upgrading restores them.
   - Deletion is a separate, audited, two-person action on an Owner request (spec §8).
4. **Quotas.**
   - Licensed display seats: a registration beyond seats is refused with a clear message.
   - Storage pooled per customer.
   - Users (Essential).
   - API rate limits and token count.
   - Retention days by plan.
   - Fair-use egress metering per customer per month, measured for reporting even if not enforced, because egress is the main cost driver (R3).
5. **Billing export (no invoicing engine in release 1).**
   - A monthly CSV/JSON export per customer: billable display-days by plan, prorations for mid-cycle additions (charged immediately) and reductions (at renewal, as Yodeck does in F4 #3), included or demo displays at zero, term dates, purchase-order reference, and hardware serials.
   - Format suited to import into TINNOX's accounting system (for example Xero or MYOB, UNKNOWN which).
   - Tax invoices (ABN, GST) are produced by the accounting system, not the CMS.
6. **Operations console.**
   - Contracts screen: plan, term, included-until, renewal date.
   - Renewal reminders at 60, 30 and 7 days to the TINNOX account manager and the customer Owner.
   - Bulk "apply plan to customer".
   - Price book with effective dates.
   - A report of displays whose included period ends within 90 days (the sales pipeline).
7. **Hardware link.** Each display records device serial, controller model, hardware warranty end and contract ID, so warranty, SLA and subscription line up on one page (supports the Managed tier and Signage-as-a-Service).
8. **Release 2+.** Self-serve sign-up with card payments, in-product invoices, an ad-booking and share-of-voice module, and per-advertiser proof-of-play reports.

This changes spec assumption A2 ("no plans or billing in the first release"). The PROPOSED wording is: "no self-serve sign-up or in-product invoicing; plans, entitlements, licence states and billing export are in release 1".

### R4. Unit economics example

**Scenario A: 50 customers × 3 displays = 150 displays, after the included year.**

| Tier | Displays | Price (AUD ex GST / display / month, mid-band) | MRR (AUD) |
|---|---|---|---|
| Essential | 90 (60%) | 15 | 1,350 |
| Professional | 45 (30%) | 25 | 1,125 |
| Managed | 15 (10%) | 50 | 750 |
| **Total** | **150** | avg 21.50 | **3,225 MRR; 38,700 ARR** (GST of 3,870/yr collected and remitted on top) |

| Monthly cost line | Basis | AUD / month |
|---|---|---|
| Hosting (app, Postgres, media, egress, MQTT, monitoring) | A04: USD 60–110 at 50 screens and USD 450–750 at 500, linearly interpolated to 150 = USD 150–250 → **AUD 217–362**. R3's all-AU model gives about AUD 2.55/screen at 150 → AUD 383 | **220–390** (7–12% of MRR; AUD 1.45–2.60 per display) |
| Android MDM (only if commercial MDM is used on Android players) | USD 2–6/device on, say, 50 Android displays | 145–435 (avoidable with an own device-owner agent, R4) |
| Payment and collection costs | INFERRED about 1–2% of billed amount | 30–65 |
| Managed-tier content labour | 15 displays; say 5 h/month at AUD 60/h loaded (INFERRED) | 300 |
| **Variable cost total** | | **about 550–1,190** (low end excludes MDM; 695–1,190 if MDM is used) [clarified in verification] |
| **Contribution before fixed staff** | 3,225 − variable | **about 2,035–2,675 (63–83%)** |

Fixed costs not covered at this scale (INFERRED): about 2 engineers plus 0.5 support FTE, roughly AUD 350–450k a year loaded, plus security testing (spec §17: annual penetration test). At an average of AUD 21.50 per display and about 75% contribution, the software line covers those costs alone only at about **1,800–2,300 licensed displays**.

**Scenario B: 500 displays, same mix.** MRR about AUD 10,750 (ARR 129,000). Hosting USD 450–750 = AUD 652–1,087 (6–10% of MRR, A04).

**Scenario C: the included-year cost per display.**
- Hosting about AUD 1.45–2.60 × 12 = **AUD 17–31**, plus about 1 hour of support = AUD 60. That is about AUD 80–90 a year per display.
- Pricing the included year at AUD 180 (Essential list) in the hardware quote leaves margin.
- If 80% renew to a paid tier in year 2 (INFERRED assumption, not sourced), Scenario A becomes 120 paid displays and about AUD 2,580 MRR.

Conclusion: hosting is a small share at every scale modelled. The levers are price tier mix, renewal rate after the included year, and multi-year prepayment.

---

## Open items

1. **Official current prices** for ScreenCloud (currency and VAT note), Samsung VXT and LG in Australia (the Exertis ".AUS" SKU currency), BrightSign (USD 99 vs USD 139), and Fusion Signage's live calculator. Vendor sites are blocked from this container.
2. **NovaStar VNNOX** (Standard/AD/Care) and **Huidu cloud** licence terms and AU pricing. These matter if TINNOX customers already pay one of them, or if TINNOX needs VNNOX Care beside its own CMS. The vendor API access TINNOX was granted (Q4) may come with terms. Ask TINNOX for the agreement.
3. **TINNOX inputs:** current hardware gross margin per product line, typical number of displays per customer, existing extended-warranty prices, and the accounting system (Xero or MYOB). These replace the Scenario A assumptions.
4. **Finance partner** for Signage-as-a-Service: rental factors for 36 and 60 months, credit criteria and asset recovery. No source found (INFERRED only).
5. **Legal review** of standard terms under the unfair contract terms regime: auto-renewal, price change, suspension and data deletion. Confirm the reported March 2026 penalty change.
6. **Renewal-rate and tier-mix assumptions** (80% renewal; 60/30/10 mix) are INFERRED. Validate them with 5–10 pilot customers.
7. **Spec inconsistency:** `docs/tinnox-mvp-spec.md` §1 says TINNOX "today supplies a separately licensed third-party CMS". Q1 says TINNOX has no CMS today. §1 and assumption A2 need updating (not edited here, per task rules).
8. **Australian LED integrator bundles:** no published examples found. A short mystery-shop or quote request (by TINNOX, not by this agent) would confirm local norms.
9. **Content-services hourly band** (AUD 110–150) is unsourced. Check against Australian design agencies.

---

## Sources and search log

### Local corpus (VERIFIED_FULL_PAGE, read in full from `(session scratchpad)/web/art/`)
- https://help.yodeck.com/en/articles/456128-how-is-yodeck-priced
- https://help.yodeck.com/en/articles/543957-yodeck-pricing-update-2026
- https://help.yodeck.com/en/articles/456067-multicurrency
- https://help.yodeck.com/en/articles/456066-pricing-plans-screens
- https://help.yodeck.com/en/articles/456060-volume-discounts
- https://help.yodeck.com/en/articles/589475-yodeck-unlimited-access-period
- https://help.yodeck.com/en/articles/465480-yodeck-assurance
- https://help.yodeck.com/en/articles/455834-subscriptions-billing
- https://help.yodeck.com/en/articles/456132-can-i-have-an-annual-plan-on-yodeck
- https://help.yodeck.com/en/articles/456154-i-want-to-use-yodeck-for-my-customers
- https://help.yodeck.com/en/articles/456156-what-are-the-different-types-of-yodeck-partners
- https://help.yodeck.com/en/articles/455945-yodeck-partner-network-faq
- https://help.yodeck.com/en/articles/456134-what-happens-if-a-charge-for-my-subscription-fails
- https://help.yodeck.com/en/articles/456086-how-can-i-cancel-my-yodeck-subscription
- https://help.yodeck.com/en/articles/456135-what-will-happen-if-i-cancel-my-subscription
- https://help.yodeck.com/en/articles/835172-client-subscription-management
- https://help.yodeck.com/en/articles/680807-prepayment-and-renewal
- https://help.yodeck.com/en/articles/456095-subscription-plans-within-the-account

### Fetched
- https://xibosignage.com/pricing: fetched with curl (HTTP 200, 113,785 bytes, saved as `(session scratchpad)/round2/xibo-pricing.html`). Prices were read from the page's JSON-LD `Offer` list and pricing-table data. WebFetch failed with ENOTFOUND for this host, but curl worked.

### Earlier research files used
- `(session scratchpad)/research/A04-cms-stack-components.md` (hosting cost tables)
- `(session scratchpad)/round2/R3-au-hosting-compliance.md` (AUD model, FX rate)
- `(session scratchpad)/round2/R4-player-hardware-recommendation.md` (MDM cost)
- `(session scratchpad)/round2/R1-huidu-integration.md` (Huidu proof-of-play limits, XiaoHui Cloud unknown)
- `(session scratchpad)/research/H01-novastar-led-integration.md` (VNNOX tiers, pricing unknown)
- `/home/user/CMS-RE-Cloud/docs/tinnox-mvp-spec.md`, `/home/user/CMS-RE-Cloud/docs/tinnox-context.md`, `/home/user/CMS-RE-Cloud/docs/open-questions.md`

### WebSearch log (20 of 20 used)
1. ScreenCloud pricing per screen per month 2026 Core Pro plans → official snippet + third parties
2. Fusion Signage Australia pricing per screen per month AUD → ex-GST basis; 2021 tier figures
3. Signagelive pricing per screen licence 2026 → £200 / $270 / €230 per player per year
4. OptiSigns NoviSign Rise Vision pricing per screen per month 2026 → third-party ranges
5. Samsung VXT CMS pricing per screen per month licence → reseller USD 20/month, USD 150–200/year
6. BrightSign BSN.cloud pricing per player per year → USD 99 vs 139; Control Cloud free
7. LG SuperSign Cloud per display price → USD 225–300/year MSRP; USD 23/month
8. NovaStar VNNOX Standard/AD pricing → nothing relevant
9. Daktronics Venus Control Suite subscription → Basic included; 1/3/5/10-year terms
10. Watchfire Ignite OPx cost → no charge; AI add-on USD 9.99/month
11. Huidu cloud HDPlayer subscription → nothing relevant
12. Australia LED rental / signage-as-a-service monthly → no published monthly prices
13. Telstra/Optus digital signage as a service → 2007 Telstra/3M subscription; Engagis managed service
14. Digital billboard landowner revenue share Australia → 15–25% (US/general); SOP hybrid tender
15. Huidu XiaoHui Cloud fee → nothing relevant
16. Australia unfair contract terms 2023 SaaS → penalties, scope, small-business definition
17. VNNOX licence fee paid version → EU reseller EUR 214/year; tiers
18. Australian LED supplier CMS free 3 years → no published bundle found
19. ACCC GST price display B2B → B2B ex-GST carve-out
20. Absen/Unilumin cloud CMS bundled → Absen ScreenHub (free, older press); Allsee 1-year free CMS

Blocked or not attempted: www.yodeck.com, samsung.com, novastar.tech, huidu sites (CONTEXT.md). No vendor was contacted.

---

## Verification (adversarial pass)

Date: 2026-11-03. 6 WebSearch calls and 1 WebFetch (failed: www.watchfiresigns.com not resolvable from this container). Local re-reads: Yodeck help corpus, saved `xibo-pricing.html`, A04, R3 and R4. Every arithmetic line in F1, Analysis and R4 was recomputed.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | FX: 1 USD = AUD 1.449 is the 1 Oct 2026 rate of 0.6928 | corrected | 1/0.6928 = 1.4434. 1.449 is 1/0.69, which is what R3 rounded to. All AUD conversions are about 0.4% high; none crosses a band edge. FX line corrected inline |
| 2 | Yodeck AUD 13.00 / 18.50 / 25.00, annual billing, all screens on the same plan | confirmed | Local corpus 456067-multicurrency ("AU$13.00 / AU$18.50 / AU$25", "based on annual billing"), 543957 (same AUD list, effective 1 Apr 2026), 456066 ("All the screens will need to be on the same plan") |
| 3 | Yodeck 2026 change: +USD 1 on Premium/Enterprise from 1 Apr 2026; "How is Yodeck priced?" still shows $8/$12/$16 | confirmed | 543957 text; 456128 shows $8/$12/$16 |
| 4 | Yodeck: no discount at 50 screens or fewer | confirmed | 456060 ("no discounts are provided for orders of 50 screens or fewer") |
| 5 | Yodeck failed charge: red flashing image every 2 h for 2 min after 5 days; downgrade with 1 screen active after 2 weeks | confirmed | 456134, verbatim |
| 6 | Yodeck partner: quota 0 stops screens immediately; billing on max(quota, registered); adds prorated now, reductions at renewal | confirmed | 835172 and 680807, verbatim |
| 7 | Yodeck Assurance USD 1/player/month or USD 12/year | confirmed | 465480 ("$1 per player per month or $12 per player per year") |
| 8 | Xibo Cloud USD 4.90 / 7.70 / 12.60 per display/month; perpetual players USD 28 / 85 / 49; "Major software upgrades are available for a fee" | confirmed | JSON-LD Offers in saved xibo-pricing.html (lines 209–292); quoted sentence present |
| 9 | Xibo allowances: "1 GB storage" for every tier; PoP and audit retention "62 days on Business, 124 on Enterprise" | corrected | Pricing table: storage 1 / 1.5 / 2 GB; PoP 62 / 62 / 124 days; audit 1 month / 3 months / 1 year. Professional and Business share 62-day PoP. Corrected inline. The R2 tier-retention *pattern* still holds |
| 10 | Xibo SAML from Business up | confirmed | "Single sign on via SAML": Professional not-includes; Business and Enterprise include |
| 11 | Signagelive Standard GBP 200 / USD 270 / EUR 230 per player per year, up to 2 outputs → AUD 32.60/month | confirmed | Search summary of signagelive.com/pricing (official). An older Signagelive blog gives AUD 392/year (= AUD 32.67/month native AUD). CDW resells at USD 325.99 |
| 12 | Samsung VXT USD 150/year (CDW) to USD 200 → AUD 18.11–28.98 | confirmed | Search: CDW USD 150 (list USD 200); SHI MSRP USD 200, SKU VX-CSY, 1 year, 1 display. Official Samsung AU price still not found |
| 13 | Daktronics Basic "included in the cost of the LED Display"; 1/3/5/10-year terms as quote line items; council quote shows "Basic 10-Year Subscription" | confirmed | Search summary of daktronics.com KB 000030459 and royalpalmbeachfl.gov packet |
| 14 | Watchfire Ignite OPx "no charge… no monthly subscription fees" | unverifiable | Vendor site blocked (ENOTFOUND). The search found only the optional AI generator from USD 9.99/month (signshop.com, theatdb.com) and no statement on base pricing either way. Softened inline. The recommendation does not depend on it, because Daktronics alone supports the "basic included" pattern |
| 15 | Unfair contract terms penalties from 9–10 Nov 2023; small business is under 100 employees or under AUD 10M turnover | corrected (date) | Consumer Affairs Victoria notice dated 9 Nov 2023; NSW Fair Trading says contracts made, renewed or varied on or after that date. A few firms say 10 Nov. Date set to 9 Nov inline. Thresholds confirmed. The reported 2026 penalty doubling is still unconfirmed (one law-firm source only) |
| 16 | ACCC: B2B-only prices need not include GST; consumer prices must be GST-inclusive | confirmed | accc.gov.au price-displays page (search summary). Lawpath adds that the ex-GST basis must be stated clearly, which matches R1's "+ GST" label rule |
| 17 | Hosting at 150 displays: A04 interpolated to USD 150–250 → AUD 217–362; R3 → AUD 383 | confirmed (with note) | Linear interpolation gives USD 146.7–252.2. At 1.4434 that is AUD 212–364. The R3 AUD 383 comes from interpolating *per-screen* cost (2.63 → 2.00); interpolating the totals (260 → 1,000) gives AUD 352. Both fall inside the 220–390 band |
| 18 | Scenario A MRR 3,225; ARR 38,700; GST 3,870; average 21.50 | confirmed | 90×15 + 45×25 + 15×50 = 1,350 + 1,125 + 750 = 3,225; ×12 = 38,700; 10% = 3,870; 3,225/150 = 21.50 |
| 19 | Hosting is 7–12% of MRR, AUD 1.45–2.60 per display | confirmed | 220/3,225 = 6.8%; 390/3,225 = 12.1%; 220/150 = 1.47; 390/150 = 2.60 |
| 20 | Variable costs 550–1,190; contribution 2,035–2,675 (63–83%) | confirmed (clarified) | High end 390 + 435 + 65 + 300 = 1,190. The low end of 550 omits MDM (220 + 30 + 300). With MDM it is 695. Clarified inline. Contribution arithmetic is correct for the stated bounds |
| 21 | Break-even of the software line alone: 1,800–2,300 displays (R4) vs "1,500–2,500" (Summary) | corrected | AUD 350–450k/yr ÷ 12 ÷ (21.50 × 0.75 = 16.125) = 1,809–2,326. The Summary was aligned to 1,800–2,300 inline |
| 22 | Included-year hosting cost "AUD 18–31 a year (F6 #3 at 100–500 screens)" | corrected | F6 #3 gives AUD 2.00–2.63 per screen at 500/100 → AUD 24–32 a year. AUD 17–31 (Scenario C) uses the 150-display band, a different basis. Analysis 3 corrected inline. The included-year value (12 × 15–19 = AUD 180–228) is confirmed |
| 23 | Scenario B: 500 displays → MRR 10,750; hosting AUD 652–1,087 (6–10%) | confirmed | 500 × 21.50 = 10,750; 450/750 × 1.449 = 652/1,087; 6.1–10.1% (AUD 650–1,083 at 1.4434) |
| 24 | F1 AUD conversions (ScreenCloud 28.98/43.47, Rise 15.94/18.84, LG 27.17–36.23, BrightSign 11.95–16.78, OptiSigns 14.49–65.21, MDM 145–435, 80% renewal → 2,580) | confirmed | All recomputed at 1.449. Note: OptiSigns' top tier (AUD 65) sits above the Summary's "AUD 7–45 mainstream" range. The range describes mainstream tiers, so it was left as is |

**Does the recommendation still hold? Yes.** Nothing that supports it was refuted:
- The per-display price bands rest on Yodeck's native-AUD list and Xibo's JSON-LD prices, both re-confirmed from primary text. The Samsung, Signagelive and Daktronics figures were re-confirmed independently.
- The corrections are small: FX about 0.4%, Xibo storage and retention detail, the UCT date, two hosting-cost ranges, and the break-even band. They do not move any PROPOSED tier price or change the conclusion that hosting is 6–12% of MRR.
- The model still works the same way. Hosting is minor; the levers are tier mix, renewal after the included year, and multi-year prepayment. Lapses lock publishing, not playback.

One premise weakened: Watchfire's "no subscription" statement could not be re-confirmed. The "basic control included with LED hardware" pattern now rests mainly on Daktronics (confirmed) plus Allsee and Absen (third party).
