# R3: Australian hosting options and compliance for TINNOX CMS (answers Q9)

Date: 2026-11-03. Builds on A04 (`../research/A04-cms-stack-components.md`). This file answers Q9: TINNOX "strictly follow[s] AU compliance for data and security" and wants the hosting choice backed by numbers.

Labels: VERIFIED_FULL_PAGE, OFFICIALLY_DOCUMENTED (search summary of an official page), THIRD_PARTY, INFERRED, UNKNOWN, PROPOSED. Every price states its currency. AUD conversions use the FX rate below.

**FX used:** 1 AUD = 0.69 USD, so 1 USD = AUD 1.449. This is the aggregator rate for 1 Oct 2026 (0.6928, THIRD_PARTY, https://www.exchange-rates.org/exchange-rate-history/aud-usd-2026-10-01). I could not get a quote for 3 Nov 2026 because the RBA site is blocked from this container. The sensitivity column uses 1 AUD = 0.65 USD (AUD 1.538 per USD). All the hyperscalers below bill in USD, so the AUD cost moves with the exchange rate.

---

## Summary

- **Prices checked for this report:** AWS Sydney (ap-southeast-2) and Melbourne (ap-southeast-4) prices come from AWS's machine-readable price list (VERIFIED_FULL_PAGE, published 2026-10/11). **Melbourne costs the same as Sydney** for RDS Postgres, EC2, S3 and internet egress. Melbourne is therefore a free choice for primary or disaster recovery (DR); only cross-region transfer costs extra, at USD 0.080/GB Sydney to Melbourne (and Melbourne to Sydney) [corrected in verification].
- **Google Cloud Sydney prices** were read from cloud.google.com (VERIFIED_FULL_PAGE): Cloud SQL, GCS USD 0.023/GiB-mo, and egress USD 0.12/GiB (Standard tier) or USD 0.19/GiB (Premium tier). Direct GCS bucket downloads are always Premium tier; Standard tier needs a regional external Application Load Balancer in front of the bucket [corrected in verification]. Google is **"Certified Strategic" under the Hosting Certification Framework (HCF)** for Sydney and Melbourne. Its IRAP assessment found it "strongly aligned with PROTECTED", and Cloud SQL, Cloud Storage, Compute Engine and GKE are in scope (VERIFIED_FULL_PAGE).
- **The modelled monthly cost (AUD, base case of 3 GB of media per screen per month)** for the PROPOSED all-in-Australia AWS build is about **AUD 110 at 10 screens, 260 at 100, 1,000 at 500 (Postgres HA) and 2,900 at 2,000**. That works out to AUD 10.90, 2.63, 2.00 and 1.46 per screen per month.
- **Egress is the main cost driver at scale.** It is about 35% of AWS cost at 2,000 screens. At 10 GB per screen (4K-heavy content), AWS egress alone reaches about AUD 3,100/month at 2,000 screens [corrected in verification]. Player caching and content-hash delta downloads matter more than which provider you pick.
- **Moving media to Cloudflare R2 (zero egress) saves about 26% at 500 screens and 35% at 2,000.** However, R2 can only be pinned to the **EU or FedRAMP jurisdictions; there is no Australian jurisdiction** (OFFICIALLY_DOCUMENTED), and its location hints are best effort only. That conflicts with "strictly AU". **Treat R2 as a later, opt-in optimisation, and only for non-personal media.**
- **DigitalOcean SYD1 is the cheapest option** (about AUD 80, 140, 520 and 1,280 at the four sizes) because it includes transfer allowances and charges about USD 0.01/GiB overage. But it has **no IRAP assessment and no HCF certification**, and it is US-owned. It is fine for a pilot, but weak evidence for council or government tenders.
- **IRAP PROTECTED** applies to AWS (Sydney and Melbourne, 167 services at PROTECTED as of June 2026), Azure (all four AU regions, including Canberra's Australia Central 1 and 2), Google (Sydney and Melbourne) and Oracle (Sydney and Melbourne, 37 services). Sovereign providers AUCloud and Vault Cloud are also assessed at PROTECTED, and Vault also at SECRET. TINNOX **does not need IRAP itself** unless it hosts government PROTECTED data, which signage content almost never is (INFERRED).
- **The HCF matters only to Commonwealth (and some state) buyers.** It is now administered by Home Affairs, and the framework is officially "undergoing reform"; the claimed pause of new registrations since 3 Nov 2025 could not be confirmed (UNKNOWN) [corrected in verification]. Picking an HCF-certified hyperscaler region gives TINNOX an inherited answer to that question.
- **The obligations that bind TINNOX today** are the Privacy Act/APPs and the NDB scheme, whenever TINNOX is an APP entity or is contractually bound to act as one (INFERRED). Customers will also bring contractual security asks: Essential Eight ML2 references in VIC council policy (VPDSS), and E8 ML1 as mandatory in the NSW Cyber Security Policy 2026–27 (THIRD_PARTY/official PDF via snippet).
- **CLOUD Act:** the AUS–US CLOUD Act agreement (signed Dec 2021) gives a treaty channel for criminal-investigation data requests to US-incorporated providers, wherever the data sits. Some buyers raise it. The usual mitigations are customer-managed KMS keys, Australian-only regions, and contract terms. A fully Australian-owned provider (AUCloud, Vault, Macquarie) removes the issue but costs more.
- **PROPOSED: primary** is AWS ap-southeast-2 (Sydney) for everything: app, Postgres, S3 media and CloudFront limited to the Australia price class. Encrypted backups and DR copies go to ap-southeast-4 (Melbourne). **Alternative:** Google Cloud Sydney + Melbourne, which has HCF Strategic confirmed on Google's own page, at about 19–32% more in this model (direct GCS, Premium-tier egress; 0–20% at 500+ screens only if media is fronted by a regional Standard-tier load balancer) [corrected in verification]. **Pilot-only budget option:** DigitalOcean SYD1. **Escalation path:** AUCloud, Vault or Macquarie Government, for a buyer contract that demands Australian-owned or PROTECTED hosting.

---

## Findings

### F1. Provider comparison: regions, assurance, residency, Postgres, storage, egress, support

| Provider | AU regions | IRAP | ISO 27001 / SOC 2 | Data-residency position | Managed Postgres | Object storage | Internet egress (USD) | Label / source |
|---|---|---|---|---|---|---|---|---|
| **AWS** | ap-southeast-2 Sydney; ap-southeast-4 Melbourne | PROTECTED; Sydney and Melbourne in scope; 167 services at PROTECTED after the June 2026 "Phase 1a" report | Yes (widely published; not re-fetched this session) | Customer chooses the region; data stays in the chosen region unless moved (shared-responsibility model) | RDS PostgreSQL: Sydney and Melbourne identical (e.g. db.t4g.medium USD 0.102/h Single-AZ, 0.203/h Multi-AZ; gp3 USD 0.138 / 0.276 per GB-mo; backup over the free allocation USD 0.095/GB-mo) | S3 Standard USD 0.025/GB-mo (first 50 TB), identical in Melbourne | USD 0.114/GB for the first 10 TB, then 0.098, 0.094, 0.092 (both regions); "beyond the global free tier" (100 GB/mo per A04); Sydney to Melbourne USD 0.080/GB (usage type APS2-APS6-AWS-Out-Bytes; the 0.098/0.10 rows are inter-region peering to other regions) [corrected in verification] | Prices VERIFIED_FULL_PAGE: https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-southeast-4/index.csv (pub. 2026-10-29), .../AmazonS3/current/ap-southeast-4/index.csv (2026-10-15), .../AWSDataTransfer/current/index.csv (2026-11-03), .../AmazonEC2/current/ap-southeast-4/index.csv. IRAP OFFICIALLY_DOCUMENTED: https://aws.amazon.com/compliance/irap/ , https://aws.amazon.com/blogs/security/2026-phase-1a-irap-report-is-now-available-on-aws-artifact-for-australian-customers/ . ISO/SOC INFERRED |
| **Microsoft Azure** | Australia East (NSW), Australia Southeast (VIC), Australia Central and Central 2 (Canberra, CDC data centres; Central 2 restricted access, no availability zones) | PROTECTED across all four AU regions; Canberra regions aimed at government/PROTECTED | Yes (INFERRED, not fetched) | Region choice; Canberra regions for government | Azure Database for PostgreSQL Flexible: B2s about USD 76/mo and B2ms about USD 152/mo in Australia East (third-party tracker, updated Jul 2026); HA surcharge UNKNOWN | Blob Hot LRS AU East: UNKNOWN (official page shows placeholders) | Zone 2 (Asia/Oceania incl. AU): USD 0.12/GB first tier, then 0.085, 0.082, 0.08 | IRAP OFFICIALLY_DOCUMENTED: https://learn.microsoft.com/en-us/azure/compliance/offerings/offering-australia-irap , https://learn.microsoft.com/en-us/azure/reliability/regions-list . Egress OFFICIALLY_DOCUMENTED: https://azure.microsoft.com/en-au/pricing/details/bandwidth/ . Postgres THIRD_PARTY: https://www.bytebase.com/dbcost/azure-flexible/instance/B2s/ |
| **Google Cloud** | australia-southeast1 Sydney; australia-southeast2 Melbourne | Independently assessed against OFFICIAL and PROTECTED ISM controls, "strongly aligned with PROTECTED"; in-scope list includes Cloud SQL, Cloud Storage, Compute Engine, GKE, Cloud CDN, Cloud Run | Yes (INFERRED) | **HCF "Certified Strategic"** for Sydney and Melbourne; Assured Workloads for stronger residency controls | Cloud SQL Sydney: vCPU USD 0.0558/h, memory 0.0095/GiB-h; HA doubles both (0.1115 / 0.0189); SSD USD 0.2295/GiB-mo (HA 0.459); backups 0.108/GiB-mo; db-g1-small USD 0.0473/h | GCS Standard Sydney USD 0.023/GiB-mo | From Sydney: Premium tier to Australia USD 0.19 / 0.18 / 0.15 per GiB (0–1 TiB, 1–10 TiB, 10 TiB+); Standard tier USD 0.12 / 0.085 / 0.08 | VERIFIED_FULL_PAGE (fetched 2026-11-03): https://cloud.google.com/sql/pricing , https://cloud.google.com/storage/pricing , https://cloud.google.com/vpc/network-pricing , https://cloud.google.com/security/compliance/irap , https://cloud.google.com/security/compliance/hcf-australia . GCE VM prices could not be parsed (UNKNOWN) |
| **Oracle Cloud (OCI)** | Sydney; Melbourne; separate isolated Canberra government region (public sector only) | PROTECTED: 37 OCI services in Sydney and Melbourne; Canberra government region also PROTECTED | Yes (INFERRED) | Region choice; Canberra region has no backbone link to the public regions | OCI Database with PostgreSQL: priced per OCPU plus storage; unit price not rendered (JS) | Unit price not rendered; 10 GB Always Free | **First 10 TB/month outbound free** (APAC origin), then a per-GB rate (not rendered) | Egress VERIFIED_FULL_PAGE: https://www.oracle.com/cloud/price-list/ (row text "Outbound Data Transfer - Originating in APAC, Japan and South America - First 10 TB / Month: Free"). IRAP OFFICIALLY_DOCUMENTED/THIRD_PARTY: https://blogs.oracle.com/cloud-infrastructure/irap-assessment-opens-new-opportunities-in-australias-public-sector , https://www.datacenterdynamics.com/en/news/oracle-launches-government-cloud-region-in-australia/ . Postgres model: https://www.oracle.com/cloud/postgresql/pricing/ (snippet) |
| **AUCloud** (Sovereign Cloud Holdings, ASX-listed) | Canberra and Sydney (INFERRED from public profile) | "Security assessed ... up to the Protected classification" (IRAP) | ISO 27001 (THIRD_PARTY) | Australian-owned and operated; sovereign; targets government, defence and critical infrastructure; HCF Strategic in the 2021 first wave | Not published (quote-based) | Not published | Not published | OFFICIALLY_DOCUMENTED (snippet): https://docs.australiacloud.com.au/latest/Platform_Overview ; HCF: https://itwire.com/government-tech-news/government-tech-policy/dta-certifies-three-australian-firms,-one-us-outfit-for-cloud-hosting (THIRD_PARTY) |
| **Vault Cloud** | Canberra/Sydney (INFERRED) | IRAP for "PROTECTED SIG, PROTECTED Cloud, and SECRET Cloud" environments | UNKNOWN | Australian-owned; HCF Strategic (2021 first wave); NRFC invested AUD 22.5M | Not published | Not published | Not published | OFFICIALLY_DOCUMENTED (snippet): https://vaultcloud.com.au/security/ , https://vaultcloud.com.au/nrfc-invests-22-5-million-in-vault-cloud/ |
| **Macquarie Cloud Services / Macquarie Government** (Macquarie Technology Group) | Sydney and Canberra (INFERRED) | Runs IRAP-assessed Azure services for PROTECTED workloads (managed Azure practice launched 22 Jul 2026); own sovereign cloud | UNKNOWN (not verified) | Australian-owned; Macquarie Government says it is "one of three" HCF Certified Strategic providers | Managed service (quote) | Quote | Quote | THIRD_PARTY/vendor: https://www.macquariegovernment.com/glossary/certified-strategic/ , https://www.crn.com.au/news/2026/cloud/macquarie-government-launches-new-azure-practice-for-state-and-federal |
| **Servers Australia and other AU-owned VPS hosts** | Sydney etc. | None found | ISO 27001 not confirmed for Servers Australia; VentraIP (AU-owned) says it has ISO 27001 | AU-owned, AU data centres | Generally none, or self-managed | Varies | Usually bundled | THIRD_PARTY: https://faq.ventraip.com.au/about-us/ ; Servers Australia: UNKNOWN (site blocked, no search result) |
| **DigitalOcean** | SYD1 (Sydney) | None | DigitalOcean says SYD1 has "ISO 27001, PCI-DSS, and SOC" certifications | Region choice; US-owned | Managed PG from about USD 15/mo (1 GB); pricing region-agnostic | Spaces USD 5/mo with 250 GB storage and 1 TB transfer; CDN included | Overage about USD 0.01/GiB; Droplets include pooled transfer | OFFICIALLY_DOCUMENTED (snippet): https://www.digitalocean.com/blog/introducing-sydney-data-center , https://docs.digitalocean.com/products/spaces/details/pricing/ ; prices THIRD_PARTY: https://infratally.com/articles/digitalocean-managed-postgres-deep-dive/ , https://agentdeals.dev/digitalocean-free-tier-2026 |
| **Vultr** | Sydney, Melbourne (INFERRED, not confirmed) | None | UNKNOWN | US-owned | Managed PG exists; AU availability UNKNOWN | Object storage (UNKNOWN AU) | Overage USD 0.01/GB worldwide; 2 TB free monthly egress, pooled | OFFICIALLY_DOCUMENTED (snippet): https://docs.vultr.com/support/platform/billing/what-is-the-bandwidth-overage-rate , https://blogs.vultr.com/vultr-announces-reduced-bandwidth-pricing-2-tb-of-free-monthly-egress-free-ingress-and-global-pooling |
| **Akamai / Linode** | Sydney (au-syd), Melbourne (au-mel) (INFERRED from model knowledge, not verified) | None found | UNKNOWN | US-owned | Managed PG about USD 65/mo for 2 CPU/4 GB (region not stated, Nov 2024 data) | UNKNOWN | 1–20 TB/mo allowance per instance | THIRD_PARTY: https://getdeploying.com/linode-vs-supabase ; otherwise UNKNOWN |

Support (all INFERRED from standard published plans, not fetched this session):
- AWS Business Support is the greater of USD 100/mo or a percentage of spend.
- Azure Standard is about USD 100/mo.
- Google's paid support is spend-based.
- DigitalOcean, Vultr and Linode include ticket support, with paid tiers.
- The sovereign providers bundle named account support.
- Budget roughly AUD 150/mo for AWS Business Support from the 100-screen stage onwards. It is **not** included in the totals below.

### F2. Object storage and CDN for media delivery

| Option | AU location | Residency control | Storage (USD) | Egress (USD) | Label / source |
|---|---|---|---|---|---|
| S3 Sydney / Melbourne + CloudFront | ap-southeast-2 / -4; CloudFront AU edge price class | Origin pinned to an AU region. Edge caches can be limited by price class, but CloudFront is still a global service (INFERRED) | 0.025/GB-mo | 0.114/GB first 10 TB (S3 direct or CloudFront AU) | VERIFIED_FULL_PAGE (AWS price list); CloudFront figures from A04 |
| Azure Blob AU East + Azure CDN/Front Door | AU East/Southeast | Region choice | UNKNOWN AU price; about 0.02 (THIRD_PARTY in A04) | 0.12/GB Zone 2 | OFFICIALLY_DOCUMENTED (bandwidth page snippet) |
| GCS Sydney/Melbourne + Cloud CDN | australia-southeast1/2 | Region choice; HCF scope covers both regions | 0.023/GiB-mo | 0.19 (Premium, the only tier for direct bucket access) per GiB; 0.12 (Standard) only via a regional external ALB [corrected in verification] | VERIFIED_FULL_PAGE; tier rule OFFICIALLY_DOCUMENTED: https://docs.cloud.google.com/network-tiers/docs/overview |
| Cloudflare R2 | Global; **jurisdictions only `eu` and `fedramp`**; location hints (wnam, enam, weur, eeur, plus apac and oc per third parties) are best effort | **No enforceable AU residency** | 0.015/GB-mo | **0** | OFFICIALLY_DOCUMENTED (snippet): https://developers.cloudflare.com/r2/reference/data-location/ ; price from A04 |
| Backblaze B2 | **No AU region** (US West, US East, EU Central, CA East) | None in AU | about 6/TB-mo | Free up to 3x stored, then 0.01/GB; free via CDN partners | THIRD_PARTY (A04) |
| Wasabi | Sydney | AU region | about 6.99/TB-mo, 1 TB minimum, 90-day minimum retention | Free if egress ≤ storage | THIRD_PARTY (A04) |
| DigitalOcean Spaces SYD1 | Sydney | Region choice | USD 5 for 250 GB + 1 TB transfer | about 0.01/GiB overage; CDN included | OFFICIALLY_DOCUMENTED + THIRD_PARTY (F1) |
| OCI Object Storage Sydney/Melbourne | AU | Region choice | UNKNOWN (JS-rendered) | First 10 TB/mo free | VERIFIED_FULL_PAGE (egress row) |

Two consequences for TINNOX (INFERRED):
- Wasabi's egress policy fails for signage: egress far exceeds stored GB, because every screen downloads every asset.
- Backblaze B2 has no AU region, so it fails "strictly AU" outright.

### F3. Australian compliance obligations and what they mean for hosting

| Obligation | Applies to TINNOX when | Hosting implication | Label / source |
|---|---|---|---|
| Privacy Act 1988 / APPs (APP 1 policy, APP 8 cross-border disclosure, APP 11 security) | TINNOX is an APP entity (turnover over AUD 3M, or another trigger), or a customer contract requires APP compliance (common for government and enterprise) | Keep personal information (CMS users, audit logs, any audience analytics, site addresses tied to people) in AU regions; this avoids APP 8 analysis. Tranche 1 (Privacy and Other Legislation Amendment Act 2024, Royal Assent 10 Dec 2024) clarified that APP 11 "reasonable steps" include technical and organisational measures | THIRD_PARTY summaries: https://www.pinsentmasons.com/Out-Law/News/australian-privacy-law-reforms-consultation-tranche-two-Bill ; A04 sources. Turnover threshold INFERRED (model knowledge) |
| Tranche 2 reforms | Exposure draft of the Privacy Amendment (Personal Data Protection) Bill 2026 released 31 Aug 2026; 41 proposals; no commencement date. The small-business exemption may change | Design as if the exemption disappears: privacy by design, retention/deletion, access logging | THIRD_PARTY: https://www.hsfkramer.com/insights/2026-09/the-draft-tranche-2-privacy-act-reforms-whats-there-whats-new-and-whats-missing , https://www.minterellison.com/articles/draft-tranche-2-privacy-reforms-what-they-mean-for-businesses |
| Statutory tort for serious invasions of privacy | In force since 10 Jun 2025 | Strengthens the case for tight staff-access controls (links to Q8) | THIRD_PARTY: Pinsent Masons (above) |
| Notifiable Data Breaches (NDB) scheme | APP entities | Need logs and forensics to assess a suspected breach within 30 days and to notify the OAIC and affected individuals. Hosting must give audit logs, CloudTrail-style API logs and immutable backups | INFERRED (Privacy Act Part IIIC; OAIC not reachable) |
| ACSC/ASD Essential Eight | Mandatory for Commonwealth non-corporate entities; NSW Cyber Security Policy 2026–27 makes E8 ML1 controls mandatory for NSW agencies and recommends the policy to councils and universities; a VIC council policy (Greater Shepparton, Aug 2026) cites VPDSS and **E8 ML2** for SaaS vendor assessment | TINNOX will receive vendor security questionnaires. E8 mostly covers TINNOX's own corporate endpoints and admin practices (MFA, patching, admin privileges, backups), not the hosting provider | OFFICIALLY_DOCUMENTED (snippet): https://www.digital.nsw.gov.au/sites/default/files/2026-06/nsw-cyber-security-policy-2026-2027.pdf ; council PDF: https://greatershepparton.vic.gov.au/assets/files/documents/governance/meetings/2026/08/10.1_Cyber_Security_Policy_.pdf ; ASD "Essentials for cloud" (Oct 2026): https://www.cyber.gov.au/sites/default/files/2026-10/ASD%20Essentials%20for%20cloud.pdf (title only) |
| ISM / IRAP | Only when TINNOX processes government data at PROTECTED, or a buyer's contract demands an IRAP-assessed system. Signage content is typically OFFICIAL or public (INFERRED) | Build on an IRAP-assessed region so a future TINNOX IRAP assessment inherits the platform controls. A system assessment of TINNOX CMS would be a separate, paid engagement | OFFICIALLY_DOCUMENTED: AWS/Azure/Google pages in F1; "region is necessary but not sufficient": https://cybernion.com.au/insights/irap-for-aws/ (THIRD_PARTY) |
| Hosting Certification Framework (HCF) | Commonwealth agencies must use HCF-certified providers for certain data (e.g. sensitive or government data); Commonwealth Whole-of-Government Cloud Computing Policy in effect from 1 Jul 2026 | Choose a provider certified at Strategic level: Google (VERIFIED_FULL_PAGE), AWS, AUCloud and Vault (2021 first wave, THIRD_PARTY), Macquarie, CDC, ADC, Oracle (THIRD_PARTY headline). New HCF registrations paused from 3 Nov 2025 pending reform | OFFICIALLY_DOCUMENTED (snippet): https://www.hostingcertification.gov.au/node/12 ; https://cloud.google.com/security/compliance/hcf-australia ; https://www.techpartner.news/news/oracle-accredited-certified-strategic-gov-cloud-provider-579736 ; policy date THIRD_PARTY (https://windowsnews.ai/article/macquarie-government-opens-azure-managed-service-for-agencies-navigating-new-cloud-mandate.439944) |
| State requirements | VIC: VPDSS Standard 11 says controls should align with the ISM. NSW: Cyber Security Policy plus Digital.NSW Cloud Framework contract terms | Same as above: AU region, E8 posture, supplier questionnaire, contract clauses on data location and breach notice | THIRD_PARTY/official PDFs via snippet (see search 19) |
| US CLOUD Act | Any US-incorporated provider (AWS, Microsoft, Google, Oracle, DigitalOcean, Vultr, Akamai, Cloudflare) | AUS–US CLOUD Act Agreement signed Dec 2021 under the US CLOUD Act and Australia's TIA Act. Entered into force on 31 January 2024 (Digital Policy Alert records implementation on 30 Jan 2024, citing the US DOJ announcement); the "31 Jan 2026" date in a third-party blog is wrong [corrected in verification]. It enables orders for data held by providers "operating in the other's jurisdiction" for serious-crime investigations | OFFICIALLY_DOCUMENTED (snippet): https://www.homeaffairs.gov.au/about-us/our-portfolios/national-security/lawful-access-telecommunications/australia-united-states-cloud-act-agreement , https://www.justice.gov/dag/cloud-act-agreement-between-governments-us-and-australia ; entry-into-force date THIRD_PARTY: https://www.spheron.network/blog/gpu-cloud-providers-australia-2026/ |

How each kind of provider addresses CLOUD Act concerns (INFERRED unless a source is given):
- **Hyperscalers:** customer-managed encryption keys (AWS KMS customer-managed keys or CloudHSM; Google Cloud EKM/HSM, which are on Google's IRAP in-scope list, VERIFIED_FULL_PAGE; Azure Key Vault Managed HSM), transparency reports, and contract commitments to challenge requests.
- **Australian-owned providers** (AUCloud, Vault, Macquarie Government): no US parent, so the issue does not arise. Customers pay for that in price and service breadth.
- **TINNOX:** encrypt personal data at the application or KMS layer, keep keys in an AU region, and publish a data-location statement.

### F4. Monthly cost model (AUD), 10 / 100 / 500 / 2,000 screens

**Assumptions** (INFERRED unless stated):
- 730 h/month, on-demand, no Savings Plans or committed-use discounts, no free tiers subtracted.
- **Media egress:** 3 GB per screen per month (new content plus re-downloads after cache eviction), plus 0.1 GB per screen of API and heartbeat traffic (1/min).
- **Media library:** 20, 100, 500 and 1,500 GB.
- **Compute:**
  - 10 screens: 1× t4g.medium (API, web, worker and MQTT on one box).
  - 100 screens: t4g.medium + t4g.small worker.
  - 500 screens: 2× t4g.medium + c7g.large worker + t4g.small MQTT + ALB.
  - 2,000 screens: 3× t4g.large + 2× c7g.large + t4g.medium + ALB.
  - EBS gp3 USD 0.096/GB-mo (VERIFIED_FULL_PAGE).
- **Postgres:**
  - 10 screens: t4g.micro Single-AZ, 20 GB.
  - 100 screens: t4g.small Single-AZ, 50 GB.
  - **500 screens: t4g.medium Multi-AZ, 100 GB (HA).**
  - **2,000 screens: m7g.large Multi-AZ, 250 GB (HA).**
- **Backups:** DB-sized extra backup storage at USD 0.095/GB-mo, plus 10% media versioning.
- **Monitoring:** CloudWatch Logs USD 0.67/GB ingested (2, 10, 40 and 150 GB), metrics USD 0.30 each, alarms USD 0.10 each (VERIFIED_FULL_PAGE, AmazonCloudWatch ap-southeast-2, 2026-10-07).
- **Alerts:**
  - Email: SES USD 0.10 per 1,000 (VERIFIED_FULL_PAGE, AmazonSES ap-southeast-2, 2026-10-27), at 1k, 10k, 50k and 200k emails/month.
  - SMS: 20, 200, 1,000 and 4,000 per month at **about USD 0.045 each (UNKNOWN; the AU SMS rate was not in the fetched price files)**.
- **Misc:** DNS, KMS, Secrets Manager and WAF at USD 5, 8, 20 and 35 (INFERRED).
- **Google Cloud:** compute and monitoring assumed at parity with AWS (GCE page not parseable), Cloud SQL from the fetched rates, egress at Standard tier.
- **DigitalOcean:** Droplets USD 24 (2 vCPU/4 GB) and USD 48 (4 vCPU/8 GB), LB USD 12, managed PG USD 15/30/60/120 with HA as a second node. These are INFERRED list prices, partly THIRD_PARTY. Spaces USD 5, with transfer allowance pooled.
- Support plans are excluded.

Script: `(session scratchpad)/r3model/model.py`

**Totals (AUD/month, FX 1 AUD = 0.69 USD; bracket = at 0.65 USD)**

| Option | 10 screens | 100 screens | 500 screens (HA DB) | 2,000 screens (HA DB) | AUD per screen at 2,000 | Label |
|---|---|---|---|---|---|---|
| **A. AWS Sydney all-AU (S3 + CloudFront AU)** | **109** (116) | **263** (279) | **1,002** (1,064) | **2,913** (3,092) | 1.46 | Prices VERIFIED_FULL_PAGE; sizing INFERRED |
| B. AWS Sydney + Cloudflare R2 for media | 103 (110) | 211 (224) | 743 (789) | 1,885 (2,001) | 0.94 | R2 price from A04 snippet |
| C. Google Cloud Sydney (Cloud SQL + GCS, Premium-tier egress, DB sized like AWS) [corrected in verification] | 139 (147) | 346 (368) | 1,289 (1,369) | 3,473 (3,687) | 1.74 | DB, storage, egress VERIFIED_FULL_PAGE; compute INFERRED parity. Original figures (136 / 315 / 1,220 / 3,315) used Standard-tier egress, which direct GCS cannot use, and a larger DB than AWS at 500 and 2,000 |
| D. DigitalOcean SYD1 | 79 (84) | 139 (148) | 521 (553) | 1,278 (1,357) | 0.64 | THIRD_PARTY/INFERRED prices |
| E. Azure Australia East | Not modelled line by line: egress USD 0.12/GB (5% above AWS); Postgres B2s about USD 76/mo (third party). Expect A ±15% | | | | | INFERRED |
| F. OCI Sydney/Melbourne | Not modelled: unit prices did not render. Egress would be **free up to 10 TB/mo** (covers 2,000 screens at 3 GB = 6 TB), so it could beat A by about AUD 1,000/mo at 2,000 screens if compute and DB prices are comparable | | | | | VERIFIED_FULL_PAGE (egress only) |
| G. Sovereign AU-owned (AUCloud / Vault / Macquarie) | Quote-only; no public prices. Expect a significant premium and minimum commitments (INFERRED) | | | | | UNKNOWN |

**Line items for Option A (AUD/month)**

| Line item | 10 | 100 | 500 | 2,000 |
|---|---|---|---|---|
| API/web/worker compute (+EBS, ALB) | 49 | 76 | 263 | 597 |
| Managed Postgres (HA from 500) | 30 | 64 | 255 | 595 |
| Backups | 3 | 7 | 16 | 40 |
| Object storage (S3 + requests) | 1 | 4 | 19 | 58 |
| Egress / CDN | 5 | 52 | 259 | 1,035 |
| Monitoring (CloudWatch) | 12 | 34 | 90 | 247 |
| Email/SMS alerts | 1 | 14 | 72 | 290 |
| DNS/KMS/Secrets/WAF | 7 | 12 | 29 | 51 |
| **Total** | **109** | **263** | **1,002** | **2,913** |

Sensitivities (INFERRED):
- **Media egress at 10 GB per screen per month** (4K, frequent changes): the AWS egress line becomes about AUD 17, 167, 834 and 3,106 (the 0.098 tier applies above 10 TB). At 2,000 screens the Option A total is about AUD 5,000 [corrected in verification].
- **SMS:** at 2,000 screens, SMS alerts are about AUD 260/mo. Use email and push notifications by default and keep SMS opt-in.
- **DR copy to Melbourne:** replicating 1,500 GB of media once costs USD 0.080/GB, about AUD 174 one-off [corrected in verification], then only the changes. RDS snapshot copy is priced the same way.
- **Savings:** 1-year Savings Plans or Reserved Instances typically cut compute and DB by 30–40% (INFERRED from general AWS pricing; not fetched).

---

## Analysis

1. **"Strictly AU compliance" rules out some storage options and leaves the four hyperscalers.**
   - The law does not require AU residency for most private-sector data. APP 8 allows overseas disclosure with accountability.
   - But TINNOX has said it wants strict AU handling, and its likely buyers (councils, retail landlords, government-adjacent sites) ask "where is the data?".
   - So every component holding personal information or customer content should sit in an AU region: Postgres, auth, logs, backups and media.
   - That rules out Backblaze B2 (no AU region) and makes Cloudflare R2 a known exception rather than the default, because it has no AU jurisdiction.
2. **All four hyperscalers are equally good on assurance for a commercial SaaS.**
   - Each has AU regions in two cities and an IRAP PROTECTED assessment.
   - Google's HCF Strategic status is confirmed on its own page. AWS was in the 2021 first wave per a third party; I did not confirm Azure's HCF status this session.
   - So the deciding factors are cost, tooling and the team's skills, not compliance.
3. **On cost, AWS is lowest among the hyperscalers in this model; Google is about 19–32% higher** [corrected in verification] because direct GCS downloads pay Premium-tier egress (USD 0.19/GiB vs AWS 0.114/GB) and Cloud SQL is dearer (like-for-like HA DB about AUD 382 vs 255 at 500 screens).
   - Azure is probably close to AWS. Its egress is 5% higher; its DB price is unverified.
   - Oracle's 10 TB of free egress is a real structural advantage for signage. However, OCI has a smaller managed-service ecosystem and I could not verify its unit prices, so it is a "watch" item, not the primary.
4. **Egress, not compute, decides cost at scale.** Each GB/screen/month costs about AUD 0.165 per screen on AWS.
   - Design levers: content-addressed caching on players, delta-only downloads, and never re-downloading on reboot.
   - Pre-transcode to a sensible bitrate (H.264 1080p by default, per A04). 4K only where the panel needs it.
   - CDN tiered caching.
   - If media egress later dominates, R2 or OCI can be added as a media-only origin without moving the database, because object keys are content-addressed (A04).
5. **Sovereign or Australian-owned providers** (AUCloud, Vault, Macquarie) are the answer only when a buyer requires PROTECTED handling, an Australian-owned provider, or a CLOUD Act-free environment.
   - They publish no prices and target government.
   - Design the stack to be portable (containers, plain Postgres, S3-compatible storage) so TINNOX can deploy a dedicated instance there for such a customer.
6. **DigitalOcean** is about half the cost of AWS at 500–2,000 screens, mostly because of bundled transfer. It also states SYD1 has ISO 27001 and SOC certifications.
   - But it has no IRAP assessment and no HCF certification.
   - Its managed services are thinner: no Melbourne region for in-country DR, limited KMS and audit tooling.
   - Use it for a dev, staging or pilot environment if cash is tight. It is not the production story for "strict AU compliance".
7. **The Q8 link (staff access)** is a compliance issue, not a hosting one: just-in-time, customer-visible, audited support access. The hosting choice must give immutable audit logs (CloudTrail plus an application audit table, pgaudit) kept in AU.

---

## Recommendation (PROPOSED)

**Primary: AWS ap-southeast-2 (Sydney) for everything, with DR in ap-southeast-4 (Melbourne).**
- **Workloads:** ECS Fargate or EC2 Graviton for API, web and workers; RDS PostgreSQL (Single-AZ until about 300–500 screens, then Multi-AZ); S3 Sydney for media; CloudFront with the Australia price class (or S3-direct signed URLs at pilot scale); Cognito in Sydney; SES Sydney for email.
- **Backups and DR:** AWS Backup or RDS snapshot copies and S3 replication to Melbourne. Same unit prices; transfer at USD 0.080/GB [corrected in verification].
- **Security baseline:** KMS customer-managed keys in Sydney; CloudTrail and Config; Security Hub with the AWS Foundational and CIS benchmarks; GuardDuty; MFA everywhere; an Organisations SCP that denies non-AU regions (keeps data AU-only by policy).
- **Why AWS:**
  - Cheapest hyperscaler in this model.
  - Melbourne costs the same as Sydney, so there is in-country DR at no premium.
  - IRAP PROTECTED in both regions, with 167 services.
  - HCF Strategic since Oct 2021 (THIRD_PARTY: iTWire, ARN).
  - It continues the A04 design.
- **Expected spend:** about AUD 110/month at pilot (10 screens) to AUD 1,000/month at 500 screens, plus support.

**Alternative: Google Cloud australia-southeast1 + australia-southeast2.**
- Choose it if TINNOX prefers Google tooling or a buyer specifically values HCF Strategic evidence, which Google publishes on its own compliance page.
- It costs about 19–32% more in this model, mostly Premium-tier egress and Cloud SQL [corrected in verification].

**Not now:**
- **Cloudflare R2:** a gated cost lever for media only, once egress exceeds about AUD 500/month, and only if TINNOX accepts non-AU media placement. Write it into the privacy statement first.
- **OCI:** re-evaluate when unit prices can be confirmed; its 10 TB of free egress could be decisive at 2,000+ screens.
- **DigitalOcean:** dev or pilot only.
- **AUCloud, Vault or Macquarie:** a dedicated deployment only if a contract requires it.

**Compliance work to start now, independent of provider:**
- APP 1 privacy policy and data-location statement.
- NDB response plan (30-day assessment).
- Essential Eight self-assessment targeting ML2 for TINNOX's corporate and admin environment.
- Supplier security questionnaire pack (ISO 27001-aligned controls, pen test, audit logging, staff-access policy).
- Records of the provider's IRAP, ISO and SOC reports (downloaded from AWS Artifact) for tenders.

---

## Open items

1. **Exact FX on the decision date.** RBA F11 was not reachable; the rate used (0.69) is a 1 Oct 2026 aggregator figure. Recalculate with the RBA rate when budgeting.
2. **AU SMS price** (AWS End User Messaging / SNS) not found in the fetched price files. The USD 0.045 per message is an estimate; confirm, or compare with an AU SMS gateway (e.g. local carriers).
3. **Azure AU East unit prices** (Postgres Flexible HA, Blob Hot LRS) and Azure's HCF status were not verified. Use the Azure pricing calculator.
4. **OCI unit prices** (compute, PostgreSQL OCPU, object storage) did not render. Use the OCI cost estimator; the 10 TB free egress is confirmed.
5. **The HCF register** is not reachable. Confirm the current Strategic list (AWS, Microsoft, Vault, AUCloud, Macquarie) and the outcome of the 2025–26 HCF reform before quoting it in tenders.
6. **Whether TINNOX is an APP entity** (annual turnover over AUD 3M, or another trigger). This needs TINNOX input. Recommend complying regardless.
7. **Media egress per screen.** The 3 GB/month base is an assumption. Measure it in the pilot: bytes per screen per month by content type.
8. **Vultr and Linode** compliance and AU managed-database availability not verified. Low priority.
9. **Support plan choice and cost** (AWS Business Support minimum) not included in the totals.
10. **AUS–US CLOUD Act entry-into-force date** is January 2024, not 2026 [corrected in verification]. Confirm on the Home Affairs or DOJ page if quoted to customers.

---

## Sources and search log

**Direct fetches (VERIFIED_FULL_PAGE, 2026-11-03)**
- AWS price list: AmazonRDS ap-southeast-2 and ap-southeast-4 (pub. 2026-10-29); AmazonS3 ap-southeast-2 and -4 (2026-10-15); AWSDataTransfer global (2026-11-03); AmazonEC2 ap-southeast-2 and -4 (streamed); AmazonSES ap-southeast-2 (2026-10-27); AmazonCloudWatch ap-southeast-2 (2026-10-07); AWSEndUserMessaging3pFees (2026-10-14; no AU SMS row found). Base URL https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/
- https://cloud.google.com/sql/pricing , /storage/pricing , /vpc/network-pricing , /security/compliance/irap , /security/compliance/hcf-australia (/compute/vm-instance-pricing and /cdn/pricing fetched, but the Sydney rows were not parseable)
- https://www.oracle.com/cloud/price-list/ (row labels and free-tier rows only; prices are rendered by JS)
- Blocked (connection failed): azure.microsoft.com, prices.azure.com, learn.microsoft.com, aws.amazon.com, docs.digitalocean.com, docs.vultr.com, techdocs.akamai.com, developers.cloudflare.com, backblaze.com, australiacloud.com.au, vaultcloud.com.au, macquariegovernment.com, oaic.gov.au, legislation.gov.au, homeaffairs.gov.au, cyber.gov.au, hostingcertification.gov.au, rba.gov.au, bytebase.com, xe.com

**WebSearch log (23 of 24 used)**
1. Azure Australia Central Canberra IRAP PROTECTED regions Australia East Southeast Microsoft 2025
2. AWS IRAP PROTECTED assessment services in scope Sydney Melbourne ap-southeast-4 2025
3. Google Cloud IRAP PROTECTED australia-southeast1 australia-southeast2 Sydney Melbourne services
4. Oracle Cloud Infrastructure IRAP PROTECTED Sydney Melbourne regions Australia government
5. Hosting Certification Framework certified strategic providers list AUCloud Vault Cloud Macquarie CDC Home Affairs 2025
6. Sovereign Cloud Australia AUCloud IRAP PROTECTED Macquarie Government sovereign cloud pricing managed PostgreSQL 2026 (no relevant results)
7. Servers Australia hosting ISO 27001 sovereign Australian owned VPS pricing cloud
8. DigitalOcean SYD1 managed PostgreSQL pricing droplet bandwidth overage SOC 2 ISO 27001
9. Vultr Sydney Melbourne managed database PostgreSQL pricing bandwidth overage SOC 2 ISO 27001
10. Akamai Linode Sydney au-mel Melbourne managed PostgreSQL pricing network transfer overage (no relevant results)
11. Cloudflare R2 jurisdiction restrictions EU FedRAMP location hint OC Oceania data residency Australia
12. Azure Database for PostgreSQL flexible server Australia East price B1ms B2s D2ds_v5 HA
13. AUD USD exchange rate RBA 3 November 2026 (no rate for the date)
14. Azure bandwidth pricing Australia East egress; Blob hot LRS Australia East
15. OCI Database with PostgreSQL price per OCPU; object storage; outbound 10 TB free
16. US CLOUD Act Australia data sovereignty; AUS-US CLOUD Act agreement
17. AUD/USD trades November 2026 (no dated November quote)
18. Privacy Act tranche 2 reforms 2026 status; NDB; statutory tort
19. VPDSS cloud SaaS vendor requirements; NSW Cyber Security Policy; Essential Eight
20. Vault Cloud / AUCloud / Sovereign Cloud Australia IRAP status 2025–2026; Macquarie
21. Australian dollar US cents late October 2026 (returned the 1 Oct 2026 rate of 0.6928, used here)
22. DigitalOcean Sydney Spaces CDN price; Droplet pricing; SOC 2
23. Macquarie Cloud Services / Macquarie Government sovereign cloud; Certified Strategic; IRAP; Azure
No further searches were run. 23 queries were used against the cap of 24.

---

## Verification (adversarial pass)

Date: 2026-11-03. Method: re-parsed the price files saved locally by the original run (`../r3dl/`: AWS RDS, S3, DataTransfer, SES and CloudWatch CSVs; Google SQL, VPC, HCF and IRAP pages), re-streamed the AWS EC2 ap-southeast-2 price list (fetched 2026-11-03), re-ran `../r3model/model.py` plus a recompute script (`../verify-r3/model_v.py`), and ran 6 WebSearch calls. The original text is backed up at `../verify-r3/R3.bak`.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | RDS PostgreSQL Sydney: t4g.micro 0.025, t4g.small 0.051, t4g.medium 0.102 Single-AZ / 0.203 Multi-AZ, m7g.large 0.468 Multi-AZ; gp3 0.138 / 0.276 per GB-mo | confirmed | AmazonRDS ap-southeast-2 CSV (pub. 2026-10-29), rows APS2-InstanceUsage / APS2-Multi-AZUsage |
| 2 | "Melbourne costs the same as Sydney" for RDS | confirmed, with one nuance | Identical for t4g sizes and gp3. m7g.large is USD 0.235 / 0.470 in Melbourne against 0.234 / 0.468 in Sydney (about 0.4% higher). Immaterial |
| 3 | S3 Standard USD 0.025/GB-mo (first 50 TB), same in both regions | confirmed | AmazonS3 ap-southeast-2 and -4 CSVs |
| 4 | Internet egress USD 0.114 / 0.098 / 0.094 / 0.092 per GB, both regions | confirmed | AWSDataTransfer CSV (pub. 2026-11-03), APS2/APS6-DataTransfer-Out-Bytes |
| 5 | Sydney to Melbourne transfer USD 0.098/GB (0.10 from Melbourne) | **corrected** | The rows for APS2-APS6-AWS-Out-Bytes and APS6-APS2-AWS-Out-Bytes are both **USD 0.080/GB**. The 0.098 and 0.10 figures are "Inter Region Peering Data Transfer Outbound" to external/other regions. Fixed in the Summary, F1, Sensitivities and Recommendation. The DR seed copy of 1,500 GB is therefore AUD 174, not 213 |
| 6 | EC2 Sydney: t4g.small 0.0212, t4g.medium 0.0424, t4g.large 0.0848, c7g.large 0.0944 USD/h | confirmed | AmazonEC2 ap-southeast-2 CSV, re-streamed 2026-11-03 (Linux, shared tenancy, on-demand) |
| 7 | CloudWatch Logs 0.67/GB, metrics 0.30, alarms 0.10; SES 0.10 per 1,000 | confirmed | AmazonCloudWatch and AmazonSES ap-southeast-2 CSVs. The 0.30 metric price applies only to the first 10,000 metrics, so it is conservative here |
| 8 | Arithmetic of the Option A to D totals and the line items | confirmed | The model re-run reproduces every total exactly. Egress is 35.5% of Option A at 2,000 screens; R2 saves 25.8% at 500 and 35.3% at 2,000; DigitalOcean is 52% and 44% of AWS at 500 and 2,000; AUD 0.165 per GB per screen is correct |
| 9 | 10 GB/screen sensitivity: AWS egress AUD 3,337 and total about AUD 5,200 at 2,000 screens | **corrected** | The flat 0.114 rate ignored the 0.098 tier above 10 TB (20.2 TB in this case). Tiered result: egress AUD 3,106, total about AUD 4,995 |
| 10 | Google Cloud SQL Sydney: vCPU 0.0558/h, memory 0.0095/GiB-h, HA 0.1115 / 0.0189 | confirmed | Re-parsed cloud.google.com/sql/pricing (local copy) |
| 11 | Google Standard-tier egress from Sydney 0.12 / 0.085 / 0.08; Premium 0.19 / 0.18 / 0.15 | confirmed as list prices | Re-parsed the Sydney blocks of cloud.google.com/vpc/network-pricing |
| 12 | Option C may use Standard-tier egress for GCS media | **refuted** | Google's Network Service Tiers overview says access to Cloud Storage buckets is Premium tier by default. Standard tier is possible only behind an external Application Load Balancer with a regional IP (OFFICIALLY_DOCUMENTED, https://docs.cloud.google.com/network-tiers/docs/overview). Option C was re-costed with Premium-tier egress |
| 13 | Option C Cloud SQL sizing is comparable to AWS | **corrected** | At 500 screens the model used 2 vCPU / 8 GiB HA against AWS t4g.medium (2 vCPU / 4 GiB); at 2,000 it used 4 vCPU / 16 GiB HA against m7g.large (2 vCPU / 8 GiB). Matched sizes give a Cloud SQL line of AUD 382 (not 462) at 500 and AUD 562 (not 958) at 2,000 |
| 14 | "Google about 13–22% more than AWS" | **corrected** | Recomputed with Premium-tier egress and matched DB sizes, Option C is AUD 139 / 346 / 1,289 / 3,473, which is **+27% / +32% / +29% / +19%**. If media is fronted by a regional Standard-tier load balancer (+USD 0.034/h + 0.011/GiB), the gap at 500 and 2,000 narrows to about +20% and +5%. Google remains dearer in every case |
| 15 | Google HCF "Certified Strategic"; Sydney and Melbourne in scope | confirmed | Local copy of cloud.google.com/security/compliance/hcf-australia: "Google Cloud is 'Certified Strategic' under the HCF"; regions australia-southeast1 and -2 are listed |
| 16 | Google IRAP "strongly aligned with PROTECTED" | confirmed | Local copy of cloud.google.com/security/compliance/irap |
| 17 | AWS IRAP: Sydney and Melbourne in scope; 167 services at PROTECTED after the June 2026 Phase 1a report | confirmed (count THIRD_PARTY) | The AWS IRAP page and the 2026 Phase 1a blog (search result) confirm both regions and the June 2026 assessment. The 167 figure comes from aws-news.com (adding four new services); not re-read on aws.amazon.com, which is blocked |
| 18 | AWS HCF Certified Strategic since 2021 | confirmed (THIRD_PARTY) | The October 2021 first wave was AWS, Sliced Tech, Vault Cloud and AUCloud (iTWire, ARN via search). Microsoft and Oracle were certified later |
| 19 | HCF new registrations paused since 3 Nov 2025 | unverifiable | hostingcertification.gov.au says the framework "is currently undergoing reform", and Home Affairs has a consultation open. No source found for a pause or for the 3 Nov 2025 date. Do not quote the date in tenders |
| 20 | AUS–US CLOUD Act agreement signed Dec 2021, in force 31 Jan 2026 | **corrected** | Signed 15 Dec 2021 (DOJ, Covington). In force since late January 2024 (Digital Policy Alert, citing DOJ). The 2026 date in the Spheron blog is wrong. Fixed in F3 and Open item 10 |
| 21 | Cloudflare R2 jurisdictions only `eu` and `fedramp`; location hints are best effort | confirmed, with a caveat | Cloudflare R2 data-location docs (search summary). A third-party blog reports a `us` jurisdiction from 17 Aug 2026 (unverified). Either way there is still no AU jurisdiction, so the conclusion stands |
| 22 | DigitalOcean SYD1 prices (managed PG from USD 15, Spaces USD 5 for 250 GB + 1 TB, about USD 0.01/GiB overage) and ISO/SOC claim | unverifiable this pass | docs.digitalocean.com is blocked; no search budget was left. These remain THIRD_PARTY/INFERRED |
| 23 | OCI first 10 TB/month outbound free (APAC origin) | confirmed (row label) | Local copy of oracle.com/cloud/price-list (row text as quoted). Unit prices are still not rendered |
| 24 | Option A Postgres line (AUD 255 at 500, 595 at 2,000) | confirmed | (0.203 × 730 + 100 × 0.276) × 1.449 = AUD 255; (0.468 × 730 + 250 × 0.276) × 1.449 = AUD 595 |

**Not checked:** CloudFront Australia request pricing (USD 1.25 per million HTTPS requests, from A04). The model also does not subtract CloudFront's always-free 1 TB/month, so Option A is slightly conservative (by about AUD 165/month at 2,000 screens). The AU SMS rate remains UNKNOWN.

**Does the recommendation still hold? Yes.**
- **AWS is still the cheapest hyperscaler in the model**, and the gap to Google is wider once GCS's Premium-tier egress is applied (+19–32%, previously +13–22%).
- **Melbourne DR is cheaper than stated:** USD 0.080/GB inter-region rather than 0.098/GB. That strengthens the "in-country DR at no premium" premise.
- **The compliance premises still hold:** IRAP PROTECTED in Sydney and Melbourne, HCF Strategic since Oct 2021, and R2 has no AU jurisdiction.
- **None of the corrections changes the ranking:** AWS, then Google, then DigitalOcean (pilot only), then the sovereign providers (on demand).
- **What not to quote externally until confirmed:** the HCF "paused since 3 Nov 2025" date, and the DigitalOcean prices.

**WebSearch calls used in this pass: 6 of 6.**
