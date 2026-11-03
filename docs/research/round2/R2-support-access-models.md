# R2: Support access to customer accounts — what vendors do, and a proposed TINNOX policy (Q8)

Date: 2026-11-03. Author: round-2 research agent. Answers TINNOX Q8 ("how does normal CMS software do it, e.g. Samsung?"). Evidence labels follow CONTEXT.md. Nothing here is legal advice; the Australian legal frame should be confirmed by a privacy lawyer before contracts are signed.

## Summary

- **There is no single industry norm. Signage vendors fall into three groups.** (1) Default access: vendor or partner staff can enter customer accounts without asking each time (Xibo Cloud, Yodeck partners). (2) Customer-granted access, with a duration the customer picks (Signagelive, Salesforce, Zendesk, Atlassian). (3) Customer-approved access for each request, with a short expiry (Microsoft Customer Lockbox, Google Access Approval). Groups 2 and 3 are the enterprise and government pattern.
- **Samsung:** with on-premise MagicINFO, the customer runs the server, so Samsung has no standing access (THIRD_PARTY). With the cloud products (MagicINFO Cloud, VXT), Samsung hosts the data. Its business privacy notice says only that support staff "may sometimes have incidental access" to customer data during technical support (OFFICIALLY_DOCUMENTED, search summary). I found no public Samsung control that lets the customer grant or approve access. Customers can invite named partner users into a workspace with a role (OFFICIALLY_DOCUMENTED).
- **LG:** ConnectedCare lets system integrators manage customer displays remotely (OFFICIALLY_DOCUMENTED). I found no public detail on consent or audit.
- **Xibo Cloud:** its terms say "We may access your Xibo CMS on demand using an administrator account in order to provide support". Its privacy policy says "Our staff do have access to your CMS instances for the purposes of providing support". Its DPA limits access to personnel who need it and gives customers inspection rights on 5 working days' notice. All three VERIFIED_FULL_PAGE.
- **Yodeck:** partner staff with the "Support Login" permission (on by default for staff) can log in as any customer user. Each login is recorded in the partner's audit log with a "Support user" field. The customer's own audit log is Enterprise-only and keeps 90 days. VERIFIED_FULL_PAGE (local corpus).
- **Signagelive (now "by Navori")** is the closest match to what TINNOX needs. It offers three modes: (a) support raises a Network Access Request that a customer admin (or a user with the "Manage Signagelive Network Access Requests" permission) approves or rejects; (b) the customer pre-authorises a named Signagelive team to self-grant access for 24 hours at a time without per-session approval; (c) the customer grants indefinite access directly, revocable at any time. Revoking access means a new request is needed (OFFICIALLY_DOCUMENTED). [corrected in verification: the 24-hour window belongs to the pre-authorised self-grant mode, not to an admin's choice when approving a request]
- **BrightSign BSN.cloud, ScreenCloud, Rise Vision, NoviSign, Navori QL:** I found no public statement on how their own staff get access (UNKNOWN). On BSN.cloud, partners get access only when the customer adds them as a user (OFFICIALLY_DOCUMENTED).
- **General SaaS reference points:**
  - Salesforce: the customer grants access for 1 day to 1 year.
  - Zendesk: the customer grants access for 1 day, 1 week, 1 month, 1 year or indefinitely, and every admin gets an email.
  - Atlassian: an admin approves access for each ticket and can revoke it at once.
  - Microsoft Lockbox: an unanswered request lapses after 12 hours, and approved access lasts at most 4 hours.
  - Google: Access Transparency logs record each access with its justification, and Access Approval can block access until approved.
- **Australian frame:**
  - APP 11 requires reasonable steps to protect personal information. OAIC guidance names limiting who has access and keeping audit logs.
  - The NDB scheme gives 30 days to assess a suspected breach, so logs must let TINNOX reconstruct who accessed what.
  - APP 8 applies if overseas staff or contractors can view data. This matters if Chinese controller vendors, or offshore support staff, are ever given access.
- **Government and education buyers:**
  - Victorian agencies must make contracted providers meet the VPDSS (Standard 8, third-party risk).
  - Victorian government schools check for an ST4S assessment, which asks about logging, access control and hosting location.
  - The ISM requires event logs to be searchable for at least 12 months; earlier editions set 7 years.
- **PROPOSED TINNOX default (Option B+):**
  - Support access is off by default. A customer admin grants it, scoped and expiring: 24 hours by default, 7 days at most.
  - TINNOX can raise an in-app request that the admin approves with one click.
  - Narrow device-health access (heartbeat, logs, restart) is covered by the contract and does not need a grant.
  - A break-glass path exists only for incidents. It needs a second approver and notifies the customer within 24 hours.
  - Every support session is visible in the customer's audit log.
- **PROPOSED retention:**
  - Customer audit log: 24 months, searchable in the portal.
  - Support-session and break-glass records: 7 years in write-once storage.
  - Customers can export the log, or stream it to their SIEM.
  - Retention can be extended under contract for government customers.

## Findings

### F1. Vendor comparison

| Vendor / product | Default access by vendor or partner staff | Customer control | Duration / expiry | Audit visible to customer | Label | Source |
|---|---|---|---|---|---|---|
| Samsung MagicINFO Server (on-premise) | None standing: the customer installs and runs the server | Full (customer's own infrastructure; customer patches) | n/a | Customer's own server logs | THIRD_PARTY | https://magicinfoservices.com/faq ; https://www.magicinfoservices.com/magicinfo-licenses ; CVE context https://cyber.trackr.live/vulnerabilities/kev/CVE-2024-7399 |
| Samsung MagicINFO Cloud / VXT CMS (Samsung-hosted) | Samsung hosts the data; its business privacy notice says that during technical support Samsung "may sometimes have incidental access" to customer data | Customer Owner invites users (incl. partners) by Samsung-account email into a workspace with a role; can withdraw them | No customer-set expiry found | Not found | OFFICIALLY_DOCUMENTED (search summary); expiry and audit UNKNOWN | https://docs.samsungvx.com/eng/012_settings_4.html ; https://vxt.samsung.com/privacy-policy ; https://www.samsung.com/uk/business/info/privacy/ ; https://www.samsung.com/pt/business/display-solutions/magicinfo/cloud/ |
| LG ConnectedCare / SuperSign Cloud (LG Business Cloud) | System integrators "manage a wide range of customer products and display issues remotely" | Business Cloud has user privilege, access control and SSO | Not found | Not found | OFFICIALLY_DOCUMENTED (marketing); consent and audit UNKNOWN | https://www.lg.com/eg_en/business/lg-connectedcare/ ; https://www.lg.com/us/business/press-release/lg-business-cloud-platform-unifies-software-services-enhances-efficiency |
| BrightSign BSN.cloud | No public statement on BrightSign staff access; a partner gets in only if the customer adds them as a network user (or shares credentials) | Network owner adds and removes users | Not found | Not found | OFFICIALLY_DOCUMENTED (partner model); staff access UNKNOWN | https://docs.brightsign.biz/develop/bsncloud-api-integration.md |
| Xibo Cloud | Yes, on demand: "We may access your Xibo CMS on demand using an administrator account in order to provide support" (Terms 3.5); "Our staff do have access to your CMS instances for the purposes of providing support to you" (Privacy) | Customer has Super Admin on a private instance; DPA 6.1 limits access to personnel who need it, and to only the data needed | None (standing) | Not stated. DPA 8.1 gives information and inspection rights on 5 working days' notice | VERIFIED_FULL_PAGE (fetched 2026-11-03; privacy updated 14 Sep 2026) | https://xibosignage.com/terms ; https://xibosignage.com/privacy ; https://xibosignage.com/dpa |
| Yodeck (partner / reseller console) | Yes: the "Support Login" staff permission ("log in as another user") is enabled by default for new staff | Partner can remove the permission through Yodeck support; no customer-side switch documented | None documented | Partner audit log records "Logged in as User" with a "Support user" field. Customer audit log: Enterprise plan only, 90-day retention, downloadable. Whether partner logins show there: UNVERIFIED | VERIFIED_FULL_PAGE (local corpus) | https://help.yodeck.com/en/articles/455873-staff-permission-roles ; https://help.yodeck.com/en/articles/455842-2-1-audit-logs ; https://help.yodeck.com/en/articles/456152-how-do-i-support-my-customers ; https://help.yodeck.com/en/articles/455854-2-3-accounts ; https://help.yodeck.com/en/articles/455824-audit-log |
| Signagelive (by Navori) | No: support needs an approved Network Access Request | Admin, or a user with the "Manage Signagelive Network Access Requests" permission, approves or rejects and sets access level; can also proactively enable access with a reason | Approved requests; or a pre-authorised 24-hour self-grant by the Signagelive team (no per-session approval); or indefinite direct grant; after revocation a new request is required [corrected in verification] | Requests managed under Settings > Grant Network Access (whether a full action log exists: UNKNOWN) | OFFICIALLY_DOCUMENTED (search summary) | https://support.signagelive.com/en/articles/137907-grant-network-access-overview ; https://support.signagelive.com/en/articles/137911-how-to-manage-signagelive-network-access-requests ; https://support.signagelive.com/en/articles/137913-grant-network-access-faq |
| ScreenCloud | Not publicly documented | RBAC, custom roles, SSO; audit logging listed as a feature | UNKNOWN | Audit logging feature exists; coverage of support staff UNKNOWN | OFFICIALLY_DOCUMENTED (features) / UNKNOWN (support access) | https://screencloud.com/security |
| Rise Vision | Not publicly documented; parent companies can switch into sub-companies (reseller pattern) | System Administrator manages users and sub-companies | UNKNOWN | UNKNOWN | OFFICIALLY_DOCUMENTED (sub-company model) | https://help.risevision.com/hc/en-us/articles/115003739746-Manage-Sub-Companies |
| NoviSign | Not found | Not found | UNKNOWN | UNKNOWN | UNKNOWN | (no source found; search logged) |
| Navori QL | Not found | Not found | UNKNOWN | UNKNOWN | UNKNOWN | https://manual-qlpro.navori.com/QLMobileUserManual.html (irrelevant to access) |

### F2. General SaaS reference patterns

| Pattern / vendor | Default | Customer control | Duration / expiry | Audit visible to customer | Label | Source |
|---|---|---|---|---|---|---|
| Salesforce "Grant Account Login Access" | No access until a user grants it | Each user grants it from personal settings; can revoke early ("No Access") | 1 day up to 1 year (dropdown) | Actions while logged in as another user are audited | THIRD_PARTY (vendor help pages describing Salesforce) | https://webkul.com/blog/grant-login-access-salesforce/ ; https://www.greytrix.com/blogs/salesforce/?p=1626 ; https://help.creditsafeuk.com/en/support/solutions/articles/7000073244-how-do-i-grant-remote-login-access- |
| Zendesk account assumption | Off on paid accounts (always on during trial) | Admin Center > Security > Advanced > Account assumption | 1 day, 1 week, 1 month, 1 year, or indefinitely; auto-disables at expiry | Email to all admins when enabled | OFFICIALLY_DOCUMENTED (search summary) | https://support.zendesk.com/hc/en-us/articles/4408824477082 |
| Atlassian Cloud support data access | Support asks on the ticket | Admin with the right product role approves or rejects; can revoke at any time (immediate) | Life of the ticket, or until revoked | Bitbucket: each access writes a workspace audit-log entry referencing the ticket | OFFICIALLY_DOCUMENTED (search summary) | https://support.atlassian.com/atlassian-cloud/kb/atlassian-cloud-support-data-access-request-faq/ ; https://confluence.atlassian.com/display/BBKB/Prerequisites+to+raise+a+support+ticket+with+Bitbucket+Cloud |
| Microsoft Purview Customer Lockbox | Engineer access to content is blocked until approved | Designated approver approves or denies each request | Unanswered request lapses after 12 h; approved access up to 4 h (M365). Power Platform: 4-day window, 8 h access | Engineer actions and approvals in the unified audit log (approval activity Set-AccessToCustomerDataRequest); audit retention 180 days by default on Audit (Standard), 1 year on Audit (Premium) [corrected in verification] | OFFICIALLY_DOCUMENTED (search summary) | https://learn.microsoft.com/purview/customer-lockbox-requests ; https://learn.microsoft.com/power-platform/admin/about-lockbox |
| Google Access Transparency + Access Approval | Transparency: logs all Google staff access, each with a justification (e.g. case number). Approval: can require approval before access | Approve or dismiss each request; "transparency mode" logs without blocking | Per request | Near-real-time logs with justification, staff location and event ID; needs a paid support tier | OFFICIALLY_DOCUMENTED (search summary) | https://cloud.google.com/security/products/access-transparency ; https://cloud.google.com/logging/docs/audit/reading-access-transparency-logs ; https://cloud.google.com/blog/products/identity-security/gain-access-visibility-and-control-with-access-transparency-and-access-approval/ |

### F3. Australian legal and buyer frame

| Item | What it means for support access | Label | Source |
|---|---|---|---|
| APP 11 (security) | Take reasonable steps to protect personal information from misuse and unauthorised access. OAIC guidance lists limiting who can access it and keeping audit logs. OAIC assessments criticise having no process to withdraw access once it is no longer needed. OAIC is updating the guide | OFFICIALLY_DOCUMENTED (search summary) | https://www.oaic.gov.au/privacy/privacy-resources/privacy-guides/guide-to-information-security ; https://www.oaic.gov.au/agencies-and-organisations/guides/guide-to-securing-personal-information ; https://www.oaic.gov.au/privacy/privacy-assessments-and-decisions/privacy-assessments/summary-of-the-oaics-assessment-of-healthscope-groups-information-security-controls-to-protect-individual-healthcare-identifiers-ihis |
| APP 6 (use and disclosure) | Using customer users' personal information (names, emails, IPs, content) to support the service that was contracted for is most likely within the primary purpose. Using it for anything else (marketing, product analytics on content) needs consent or another exception | INFERRED (from APP structure; confirm with counsel) | https://www.oaic.gov.au/privacy/australian-privacy-principles-guidelines/preface |
| APP 8 (cross-border) | If someone overseas can view personal information, for example offshore support or a Chinese controller vendor given console access, that is likely a disclosure, and TINNOX stays accountable under s 16C. Storage-only hosting may not be a disclosure | OFFICIALLY_DOCUMENTED (OAIC chapter exists; v1.3 Oct 2025) + THIRD_PARTY commentary | https://www.oaic.gov.au/privacy/australian-privacy-principles-guidelines/chapter-8-app-8-cross-border-disclosure-of-personal-information/ ; https://www.oaic.gov.au/__data/assets/pdf_file/0036/256959/APP-Guidelines-Chapter-8-Cross-border-disclosure-of-personal-information-October-2025-v1.3.PDF ; https://ags.gov.au/sites/default/files/2020-07/fact_sheet_no_29.pdf |
| Notifiable Data Breaches (Part IIIC) | Generally up to 30 days to assess a suspected eligible breach, then notify the OAIC and affected individuals promptly. Audit logs of staff and support access are the evidence that assessment relies on | OFFICIALLY_DOCUMENTED (search summary) | https://www.oaic.gov.au/privacy/notifiable-data-breaches/quick-reference-guide-for-responding-to-data-breaches ; https://www.oaic.gov.au/__data/assets/pdf_file/0011/5213/the-ndb-scheme-an-overview.pdf |
| Small-business exemption | A business with annual turnover of A$3m or less is generally exempt from the APPs. TINNOX is likely to be bound anyway as a Commonwealth contracted service provider, and contracts with councils and state bodies impose privacy clauses. Building to APP standard is prudent | INFERRED (verify TINNOX's turnover and contracts) | https://www.oaic.gov.au/privacy/australian-privacy-principles-guidelines/preface |
| Victoria: PDP Act and VPDSS | Agencies must make sure contracted service providers do not breach the VPDSS (ss 84, 88). Standard 8: assess the third party's security before engaging it. Element E8.090 requires controls at the end of a contract; a common finding is provider access that persists after the contract ends. OVIC publishes a separate note on local-council obligations | OFFICIALLY_DOCUMENTED (search summary) | https://ovic.vic.gov.au/information-security/contracted-service-providers ; https://ovic.vic.gov.au/wp-content/uploads/2022/07/20220719-Standard-8-Audit-VPDSS.pdf ; https://ovic.vic.gov.au/wp-content/uploads/2026/02/Local-Government-Authorities-Information-Security-considerations.pdf ; https://ovic.vic.gov.au/wp-content/uploads/2025/03/Outsourcing-in-the-Victorian-public-sector-Short-guide.pdf |
| Schools: ST4S | Victorian government schools check for an ST4S assessment (Arc catalogue). The ST4S questionnaire covers hosting location, logging of interactions, access control, incident management, deletion and retention | OFFICIALLY_DOCUMENTED (search summary) | https://www2.education.vic.gov.au/pal/software-administration-systems ; https://esa.edu.au/solutions/our-solutions/safer-technologies-4-schools ; https://www.education.govt.nz/suppliers-and-providers/administration/digital-technology/safer-technologies-schools-information-suppliers |
| ISM event logging | The December 2025 ISM requires logs to be searchable for at least 12 months (ISM-1988), with retention following NAA AFDA Express (ISM-1989). Earlier editions (2023 to 2024, ISM-0859) required 7 years, and some agencies (e.g. Services Australia) still use 7 years | OFFICIALLY_DOCUMENTED (search summary) | https://www.cyber.gov.au/sites/default/files/2025-12/17.%20ISM%20-%20Guidelines%20for%20system%20monitoring%20%28December%202025%29.pdf ; https://www.cyber.gov.au/sites/default/files/2023-03/17.%20ISM%20-%20Guidelines%20for%20System%20Monitoring%20%28March%202023%29.pdf ; https://www.servicesaustralia.gov.au/sites/default/files/2026-09/lex-92376-documents.pdf |
| NSW buyers | Not researched in this pass (search cap). Expect the NSW Cyber Security Policy and cloud procurement terms to ask for similar controls | UNKNOWN | (open item) |
| Contract terms | Typical clauses: a DPA with purpose limitation, access limited to personnel who need it, breach notice, sub-processor list, and audit or inspection rights (Xibo DPA: 5 working days' notice). OVIC recommends a right of access to information held by the provider and flowing obligations down to subcontractors | VERIFIED_FULL_PAGE (Xibo DPA) + OFFICIALLY_DOCUMENTED (OVIC) | https://xibosignage.com/dpa ; https://ovic.vic.gov.au/wp-content/uploads/2025/03/Outsourcing-in-the-Victorian-public-sector-Short-guide.pdf |

## Analysis

1. **Answer to "Samsung has access, right?"**
   - **On-premise MagicINFO:** no standing access. The customer runs the server, and that is the usual choice of government buyers who want full control (THIRD_PARTY).
   - **Samsung-hosted cloud:** Samsung holds the data. Its notice admits "incidental" access during support. The control it exposes to customers is inviting named partner users into a workspace. I found no published approve-per-request or expiry feature (UNKNOWN, not proven absent).
   - **Conclusion:** a vendor that bundles hardware and cloud software (Samsung, LG) does not by itself give its staff a customer-visible, time-boxed access mechanism. Customer-controlled grants appear at signage-specialist SaaS vendors (Signagelive) and at large SaaS vendors.
2. **Signage-industry baseline is permissive.** Xibo and Yodeck partners have default, standing access, logged only on the vendor or partner side. A lot of signage happens to work this way, but it falls below what APP 11 guidance and the VPDSS expect, and it is a weak answer to a council or school security questionnaire.
3. **Enterprise baseline is "customer grants, it expires, customer sees the log".**
   - Salesforce, Zendesk, Atlassian and Signagelive all use this pattern, in slightly different forms.
   - Microsoft and Google add per-request approval for their highest-trust tiers.
   - TINNOX sells into councils, schools and state bodies, where third-party access is a standard assessment item. The enterprise baseline should therefore be the target.
4. **Signage support needs differ from SaaS support.** Most TINNOX support concerns device health (offline LED controller, failed download, wrong clock), not reading the customer's content. A split model fits:
   - A **device-operations scope** (fleet telemetry, logs, restart, firmware), which TINNOX needs to run the hardware it sells and warrants. It is covered by contract and always audited.
   - A **content and account scope** (media, playlists, schedules, users), which needs a grant.

   This mirrors the Bitbucket distinction between routine maintenance without consent and in-depth access with admin consent (OFFICIALLY_DOCUMENTED).
5. **Cross-border risk is specific to TINNOX.** The controllers are Chinese (Huidu and others), and one vendor API is already granted. If a Chinese vendor's cloud or engineers can see customer content or user data, APP 8 is engaged. The support policy should cover third-party vendor engineers as well as TINNOX staff: access only through TINNOX-brokered sessions, never shared credentials.
6. **Retention reasoning.**
   - Yodeck keeps 90 days; Microsoft keeps 180 days by default (Audit Standard) and 1 year with Audit Premium [corrected in verification].
   - The ISM now asks for at least 12 months searchable; earlier editions and some agencies use 7 years.
   - The NDB assessment and contract disputes need look-back further than the 30-day window.
   - Audit events are small (text rows), so storage cost is low (INFERRED).
   - Two years online covers an annual audit cycle with margin. Seven years matches the conservative government expectation and the typical limitation period for contract claims (6 years in Victoria; INFERRED, confirm with counsel).

## Recommendation (PROPOSED)

### Options

| Option | How it works | Pros | Cons | Fit |
|---|---|---|---|---|
| A. Opt-out default with customer-visible audit | TINNOX support can enter any account. Each session needs a reason, has a 4-hour limit, shows a banner, and is logged in the customer's audit log. A customer can switch the default off | Fastest support; closest to Xibo and Yodeck; simplest for small retail customers | Standing access; weak answer to government questionnaires; one compromised staff account reaches every tenant | Small SMB only |
| B. Opt-in grant with expiry | No content or account access until a customer admin grants it (24 h default, 7 days maximum, scope: view-only or edit). TINNOX can raise an in-app request that the admin approves in one click. The grant auto-expires and can be revoked at any time | Matches Signagelive, Salesforce, Zendesk and Atlassian; strong answer to APP 11, VPDSS and ST4S; limits damage from a compromised account | Adds a small delay to support; customers must answer requests | Default for everyone |
| C. Break-glass | Emergency access without a grant (e.g. an incident or abusive content on a public LED billboard). Needs a second TINNOX approver, a severity reason and a 2-hour limit; the customer is notified at once (email + portal) and in any event within 24 h; post-incident review | Covers real emergencies and legal take-downs | Must be rare and monitored or it becomes option A | An add-on to B, never the default |

### PROPOSED TINNOX policy ("B+")

1. **Device-operations scope (always on, covered by contract):** TINNOX operators can see device telemetry, logs, screenshots and storage, and can restart devices or roll out firmware for hardware TINNOX supplied or supports. They cannot view or edit the media library, playlists, schedules or users. Every action goes in the customer's audit log. Screenshots are taken only on demand and kept for 30 days (PROPOSED, because screenshots can show content).
2. **Content and account scope (customer grant):**
   - Off by default.
   - A customer admin grants access per request or proactively, choosing view-only or edit. The default duration is 24 hours, the maximum is 7 days, and renewal is explicit.
   - Optionally, the customer can enable "standing access" for managed-service customers who want TINNOX to run their content. It is labelled clearly, re-confirmed every 12 months, and still logged.
3. **Break-glass:** two TINNOX people (operator + manager); reason and incident number required; 2 hours; the customer is notified immediately; reviewed within 5 working days; break-glass use is reported to the customer monthly.
4. **Every session:** named operator identity (no shared accounts) and MFA; persistent banner in the portal; dual audit (operator + customer); visible to the customer's admins in their own audit log with reason, start, end and actions. Optionally, an email to admins when a session starts (default on).
5. **Third parties:** controller vendors or contractors never get direct console or tenant access. Where vendor engineers must help, it happens in a TINNOX-run session, or with data shared on a minimal basis. Any offshore access is recorded and covered by an APP 8 assessment and a contract.
6. **Account offboarding:** operator access is removed the day staff leave. A quarterly access review is recorded. Customer grants end when the contract ends (VPDSS E8.090).

### PROPOSED audit retention

| Log class | Retention | Where | Reason |
|---|---|---|---|
| Customer audit log (all user, operator and device actions) | 24 months, searchable in the portal; CSV/JSON export at any time | Primary database (AU region) | Exceeds the ISM 12-month searchable minimum; covers an annual audit plus look-back for NDB assessments; replaces spec assumption A8 (2 years) and confirms it |
| Support-session, grant and break-glass records (who, when, why, scope, approvals) | 7 years | Write-once object storage (AU region) | Matches the older ISM 7-year rule still used by some agencies and the likely contract limitation period; small volume |
| Device telemetry and raw logs | 90 days | Time-series / log store | Operational only; personal information is minimal |
| Government and enterprise option | Contractual extension (e.g. 7 years for everything) and/or near-real-time export to the customer's SIEM | Per contract | VPDSS and ISM-aligned buyers will ask |

Spec impact (for the parent to apply, not done here):
- `docs/tinnox-mvp-spec.md` section 7.6: change from "operator starts a 4-hour session, customer can later require approval" to the B+ model, with approval-first for the content scope.
- Audit retention: 24 months online and 7 years for support records.
- Acceptance tests should cover expiry, revocation, the break-glass dual approval, and customer-visible entries.

## Open items

- Samsung VXT and MagicINFO Cloud: confirm whether a support-access or partner-grant feature with expiry exists (read the VXT privacy policy and user guide in full; samsung.com is blocked here).
- LG ConnectedCare: confirm the consent and audit model for integrator access.
- BrightSign, ScreenCloud, Rise Vision, NoviSign, Navori: no public support-access statement was found. Ask them in an RFI or check their trust centres (trust.screencloud.com).
- Yodeck: whether partner "Support Login" entries appear in the customer's Enterprise audit log (Y10) still needs observation.
- NSW government and NSW Department of Education requirements were not researched (search cap reached).
- Legal checks with counsel:
  - whether TINNOX is an APP entity (turnover, Commonwealth contracts);
  - APP 8 position on Huidu and other vendor access;
  - limitation period behind the 7-year retention;
  - DPA template (purpose limitation, sub-processors, breach notice, audit rights).
- Ask TINNOX whether any customers want a managed-service model where TINNOX runs their content ("standing access" toggle).
- Ask TINNOX which vendor API is already granted (Q4), and what data that vendor's cloud can see.

## Sources and search log

Read in full (VERIFIED_FULL_PAGE):
- Xibo, read with curl on 2026-11-03 (copies under `round2/xibo-dl/`):
  - https://xibosignage.com/terms
  - https://xibosignage.com/privacy (updated 14 Sep 2026)
  - https://xibosignage.com/dpa
- Yodeck local corpus:
  - 455873-staff-permission-roles
  - 455842-2-1-audit-logs
  - 456152-how-do-i-support-my-customers
  - 455854-2-3-accounts
  - 455824-audit-log

Unreachable from this session (curl status 000 or a 403 from the proxy): help.screencloud.com, docs.brightsign.biz, docs.samsungvx.com, vxt.samsung.com, learn.microsoft.com, support.atlassian.com, oaic.gov.au, support.zendesk.com, help.salesforce.com, support.signagelive.com, help.risevision.com, ovic.vic.gov.au, legislation.gov.au, lg.com, navori.com, novisign.com, and docs.cloud.google.com (cloud.google.com redirects there). Facts from these hosts are search-summary only.

WebSearch log (21 of 22 allowed):

| # | Query |
|---|---|
| 1 | Xibo Cloud support access CMS instance |
| 2 | Samsung VXT CMS partner access customer workspace support access permission |
| 3 | Salesforce "Grant Login Access" support duration expiry |
| 4 | BrightSign BSN.cloud network support access |
| 5 | Microsoft Purview Customer Lockbox approval request expires hours audit log |
| 6 | Google Cloud Access Approval Access Transparency logs |
| 7 | ScreenCloud support access account |
| 8 | Atlassian Cloud support access customer data |
| 9 | Zendesk account assumption duration |
| 10 | Signagelive support access customer network permission |
| 11 | Samsung MagicINFO on-premise vs cloud data |
| 12 | LG SuperSign Cloud / ConnectedCare partner access |
| 13 | Rise Vision / NoviSign support access |
| 14 | OAIC APP 11 access controls audit logs |
| 15 | NDB scheme 30-day assessment |
| 16 | VPDSS contracted service provider |
| 17 | ISM event logging retention |
| 18 | APP 8 overseas support access |
| 19 | Samsung VXT terms / privacy support access |
| 20 | Navori QL support access |
| 21 | ST4S vendor requirements |

## Verification (adversarial pass)

Date: 2026-11-03. Method: re-read local copies (Xibo pages under `round2/xibo-dl/`, Yodeck corpus under `web/art/`), 6 WebSearch calls (Lockbox, Zendesk, Signagelive, ISM-1988, Samsung privacy, Salesforce), and well-established statute facts. This document has no cost tables, so there was no arithmetic to check. Labels for search-only checks stay OFFICIALLY_DOCUMENTED or THIRD_PARTY.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Xibo Terms 3.5: "We may access your Xibo CMS on demand using an administrator account in order to provide support" | confirmed | Exact text in `xibo-dl/terms.txt` (https://xibosignage.com/terms). The clause continues: "We may also access the Xibo CMS at other times as necessary to ensure smooth running", which is even broader than the summary says |
| 2 | Xibo privacy: "Our staff do have access to your CMS instances…"; updated 14 Sep 2026 | confirmed | `xibo-dl/privacy.txt`: "Updated 14th September 2026" and the exact quote (https://xibosignage.com/privacy) |
| 3 | Xibo DPA 6.1 need-to-know and 8.1 inspection on 5 working days' notice | confirmed | `xibo-dl/dpa.txt`, clauses 6.1.1, 6.1.2 and 8.1 (https://xibosignage.com/dpa) |
| 4 | Yodeck "Support Login" is on by default for staff | confirmed | 455873-staff-permission-roles: permissions 5 to 8, including "log in as other users (7)", are enabled by default when a user is promoted to staff. Removing them goes through Yodeck support |
| 5 | Yodeck partner audit log has a "Support user" field and records "Logged in as User" | confirmed | 455842-2-1-audit-logs, field list and second example |
| 6 | Yodeck customer audit log is Enterprise-only, 90 days | confirmed | 455824-audit-log: "Available only on the Enterprise plan" and "available on your account for 90 days" |
| 7 | Samsung's business notice says support "may sometimes have incidental access" to customer data | confirmed | Search found the same wording in a Samsung business privacy PDF (https://images.samsung.com/is/content/samsung/p5/ae/business/smvp/privacy_policy.pdf, UAE). The UK page cited in F1 was listed but its text was not seen. The wording may differ by region, so it is not shown to be specific to VXT |
| 8 | Signagelive: admin approves, choosing a 24-hour window or indefinite | corrected | There are three modes: an approved request, a pre-authorised 24-hour self-grant by the Signagelive team with no per-session approval, and an indefinite direct grant (https://support.signagelive.com/en/articles/137907-grant-network-access-overview ; …/137910-how-to-provide-permission-for-signagelive-by-navori-to-enable-access ; …/137909-how-to-enable-access-for-a-signagelive-by-navori-team). Fixed inline in Summary and F1 |
| 9 | Salesforce Grant Login Access: 1 day to 1 year, can be revoked early | confirmed | THIRD_PARTY guides agree (webkul, greytrix, Skedulo, Access Group). Salesforce's own support asks for at least 1 month for technical escalations, a detail worth noting |
| 10 | Zendesk account assumption: off on paid plans, always on in trials; 1 day, 1 week, 1 month, 1 year or indefinitely; auto-disables at expiry | confirmed | https://support.zendesk.com/hc/en-us/articles/4408824477082 ; API values off/day/week/month/year/always (https://developer.zendesk.com/api-reference/ticketing/account-configuration/security_settings/). The "email to all admins" detail was not re-checked (unverifiable this pass) |
| 11 | Microsoft Lockbox: an unanswered request lapses after 12 h; approved access lasts at most 4 h; actions are in the unified audit log | confirmed | Microsoft Learn training module and Purview pages (https://learn.microsoft.com/en-us/training/modules/audit-identity-access-management/customer-lockbox ; https://learn.microsoft.com/purview/customer-lockbox-requests) |
| 12 | Microsoft: "1-year default audit retention" | corrected | Audit (Standard) default retention is 180 days (raised from 90 days in 2023). 1 year applies to Audit (Premium) / E5 (https://learn.microsoft.com/purview/audit-log-retention-policies). Not re-searched; based on Microsoft documentation known before this pass. Fixed inline in F2 and Analysis 6 |
| 13 | Power Platform Lockbox: 4-day window, 8 h access | unverifiable | No search spent. Consistent with prior knowledge of https://learn.microsoft.com/power-platform/admin/about-lockbox. Not decision-critical |
| 14 | Google Access Transparency needs a paid support tier | unverifiable | Not re-searched. Google has tied Access Transparency to Enhanced/Premium support or Assured Workloads, but it has changed eligibility before. Not decision-critical |
| 15 | Atlassian: per-ticket admin approval, revocable at once; Bitbucket writes an audit entry | unverifiable | No search spent this pass |
| 16 | ISM December 2025: logs searchable for at least 12 months (ISM-1988); earlier editions required 7 years | confirmed (clarified) | ISM-1988 is listed "Updated: Dec-24", so it was introduced in the December 2024 edition and carried into March 2025 and December 2025. The September 2024 edition still had 7 years (18 months for DNS and proxy logs) (https://www.cyber.gov.au/sites/default/files/2025-12/17.%20ISM%20-%20Guidelines%20for%20system%20monitoring%20%28December%202025%29.pdf ; https://cyber.gov.au/sites/default/files/2024-09/17.%20ISM%20-%20Guidelines%20for%20System%20Monitoring%20%28September%202024%29.pdf). The ISM-1989 / AFDA Express link was not re-checked |
| 17 | Services Australia still uses 7 years | confirmed | The search summary says its policy PDF mirrors 7 years, and 18 months for DNS and proxy logs (https://www.servicesaustralia.gov.au/sites/default/files/2026-09/lex-92376-documents.pdf) |
| 18 | NDB: up to 30 days to assess a suspected eligible breach | confirmed | Privacy Act 1988 s 26WH(2): an assessment must be completed within 30 days. This is well-established statute and matches the OAIC guidance cited |
| 19 | Small-business exemption at A$3m annual turnover | confirmed | Privacy Act s 6D (A$3,000,000). Exceptions include contracted service providers to the Commonwealth (s 6D(4)(e)). Note that the Privacy and Other Legislation Amendment Act 2024 did not remove the exemption, but its removal is still proposed. Re-check before contracts |
| 20 | APP 8 accountability under s 16C | confirmed | Privacy Act s 16C makes the discloser accountable for an overseas recipient's acts. The "v1.3 October 2025" version label for the APP 8 guidelines was not re-checked |
| 21 | Victorian limitation period for contract claims is 6 years | confirmed | Limitation of Actions Act 1958 (Vic) s 5(1)(a). It still needs counsel to confirm it as the basis for 7-year retention, as the doc already says |
| 22 | VPDSS Standard 8 and element E8.090 (controls at the end of a contract) | unverifiable | ovic.vic.gov.au is blocked and no search was spent. Element numbering should be checked against the current VPDSS V2.x before it goes into tender responses |
| 23 | Premise: Samsung and LG expose no customer-visible, time-boxed support grant | unverifiable (absence) | Samsung's search result shows only "incidental access" wording. No grant feature was found, but an absence cannot be proved from search. The doc already labels this UNKNOWN |

### Does the recommendation still hold?

**Yes.** None of the corrections weakens the B+ model:
- The Signagelive correction makes the comparison closer. Signagelive's three modes (approved request, pre-authorised 24-hour self-grant, indefinite grant) map almost one-to-one onto B+: grant per request, optional "standing access" for managed-service customers, and revocation at any time. TINNOX could add Signagelive's middle mode as an extra customer option: "allow TINNOX to open its own 24-hour session without asking each time, always logged and emailed" (PROPOSED). It lowers support delay for SMB customers without making access the default.
- The Microsoft retention correction (180 days Standard, 1 year Premium) leaves the proposed 24-month customer log above every reference point: Yodeck 90 days, Microsoft 180 days or 1 year, ISM 12 months.
- The ISM clarification (12 months since December 2024; 7 years before that) supports keeping 7-year write-once retention only for the small support-session and break-glass record set, as proposed, and not for all logs.
- The core premises are confirmed from primary text: Xibo has standing on-demand access, Yodeck's staff "Support Login" is on by default, and Samsung admits "incidental access". The enterprise reference points (Zendesk, Salesforce, Lockbox) are confirmed, and so are the Australian timing rules (NDB 30 days, A$3m exemption, s 16C).
- Remaining unverifiable items (Atlassian detail, VPDSS element number, Power Platform and Google tier details) are supporting colour, not load-bearing.
