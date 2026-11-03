# Yodeck workflow audit

Date: 2026-11-03. Revised the same day after the round-2 full-page verification. Status: DOCUMENTATION AUDIT, NOT AN OBSERVATION. This document records how Yodeck's workflows are described in Yodeck's own documentation, in Yodeck's public API specification and in third-party material, as a reference for designing TINNOX CMS. Nothing in it was observed in the Yodeck application. The authenticated Yodeck UI was not inspected at any point. Yodeck was studied only to learn from; nothing is copied.

## 1. How to read this document

### 1.1 What was and was not inspected

- **Not inspected:** the authenticated application at `app.yodeck.com`. No sign-in, MFA or browser session was possible in this engagement. No screen, menu or dialog described below was seen. See `docs/open-questions.md` blocker B1 and `docs/rea-evaluation.md` section 3.
- **Still blocked:** `www.yodeck.com` (the marketing site, `/docs`, `/academy` and `/release-notes`). Claims that rest only on those pages stay snippet-level (OFFICIALLY DOCUMENTED).
- **Read in full in round 2:** the full text of the Yodeck help centre at `help.yodeck.com` (656 articles, local copy in the session scratch area), and the public OpenAPI specification at https://app.yodeck.com/api-docs/bundle.yaml ("Yodeck API - Beta", version 2.0.0, OpenAPI 3.1.0). The specification is public and needs no login. It was fetched without credentials, parsed in full and re-fetched with a matching hash (`research/round2/R7-yodeck-api-spec.md`). The live API was never called.
- **Read in round 1:** web-search result summaries of official pages, plus third-party source code and documents on GitHub that consume Yodeck's REST API (importers, Home Assistant and Bitfocus Companion integrations, a production .NET publisher, a Terraform provider, competitor comparisons).
- **Consequence:** most official statements below are now VERIFIED_FULL_PAGE (help article or specification read in full). Statements that rest on `www.yodeck.com` alone are still search summaries. Menu names are taken from the help text, not from the UI. Wire behaviour of the API (what the live server actually returns) is untested.

### 1.2 Labels

| Label | Meaning in this document |
|---|---|
| DIRECTLY OBSERVED | Seen in the Yodeck application during this engagement. **No finding carries this label.** |
| VERIFIED_FULL_PAGE | A help.yodeck.com article or the public OpenAPI specification was read in full in round 2 and states the fact. "(spec)" marks the specification. Help article IDs are given as HELP nnnnnn. |
| OFFICIALLY DOCUMENTED | A yodeck.com or help.yodeck.com page surfaced in a search result and its summary states the fact. Snippet-level only. Used where the page was not available in full. |
| THIRD PARTY | Stated by a non-Yodeck source: integration source code, a reseller, a reviewer, a competitor's comparison, a community guide. Source named each time. |
| INFERRED | A conclusion drawn from documented or third-party facts, with the reasoning stated. |
| UNKNOWN | Searched for and not found. Absence of evidence, not evidence of absence. |
| HARDWARE-DEPENDENT / UNVERIFIED | Behaviour that depends on a player, display or controller and was not tested. |
| PROPOSED | A recommendation for TINNOX, not a fact about Yodeck. |

Confidence per area is given in section 1.4. "Plan restriction" means Yodeck documents the capability but gates it by subscription tier. "Missing feature" means no documentation or third-party evidence of the capability was found at any tier.

### 1.3 Method

Research ran in five passes, all in cloud sessions on 2026-11-03:

1. **Researcher pass.** One agent per area (eleven areas: the ten workflow areas in the brief plus the public API) wrote a findings file with goal, prerequisites, steps, inputs, validation, state changes, errors, plan restrictions, hardware caveats, relevance and a search log. Only the first two areas (accounts, registration) ran while web search was available. The other nine worked from the first two areas' captured official summaries plus GitHub code search.
2. **Adversarial verification pass.** A second agent per area tried to refute each key claim. Results: 215 claims checked, 96 confirmed, 37 corrected, 2 refuted, the rest left as "provenance verified, not independently confirmed".
3. **Completeness critic.** One agent read all eleven files, listed 90 gaps and 20 contradictions, and rated confidence per area.
4. **Supplementary pass.** With a fresh search budget, nine agents re-searched the weak areas against official Yodeck pages. Their corrections are listed in section 6.1.
5. **Round-2 full-page verification.** Five agents (AV1 to AV5) checked every claim in sections 3.1 to 3.10 against the full help-centre text and the specification. One agent (R7) extracted the whole specification and compared it with this document. A critic (R99) turned the results into the edits applied here. 312 claims were checked: 186 confirmed, 82 corrected, 24 refuted, 20 still unknown. Section 6.2 lists the changes. The area sections below carry the corrected wording.

Round-1 research files are in the session scratch area and are indexed in section 7.1. They are not committed because they contain long verbatim quotations from third-party repositories. Round-2 notes are committed under `docs/research/round2/` (section 7.1).

### 1.4 Confidence by area

| Area | Confidence | Why |
|---|---|---|
| 1 Accounts, workspaces, roles | high | 32 claims checked against full articles and the spec (AV1); residual unknowns sit on blocked www.yodeck.com pages |
| 2 Registration, pairing, provisioning | high | Full articles plus the spec's registration-code rules (AV2); Linux withdrawal still snippet-level |
| 3 Media | high | Upload flow and five-state lifecycle are spec-verified; formats and limits from full articles (AV3) |
| 4 Playlists | high | Item model, transitions and sub-playlist rules from the spec and full articles; duration limits unknown |
| 5 Layouts, orientation, LED | high for documented controls; LED hardware behaviour unverified | Region schema from the spec; LED workflow from the current help article (AV4) |
| 6 Scheduling, time zones | high for the model and zone format; DST behaviour unknown | Zone pair and floating local times in the spec; 0 DST mentions in 656 articles and the spec |
| 7 Publishing and deployment status | high for the push model and content states; low for heartbeat | Push and status schemas in the spec; six content states in full articles (AV5) |
| 8 Monitoring and reporting | high | Status fields, alert settings and playback CSV columns read in full |
| 9 Offline, startup, updates | high for documented windows and cadence; rollback undocumented | Offline window, boot sequence and update cadence read in full |
| 10 Customer admin and support | high for help-centre items; medium for compliance claims on www.yodeck.com | Partner terms, support hours and billing now first-party; ISO, DPA and SOC 2 claims unread |
| API (cross-cutting) | high for the contract; wire behaviour untested | Specification read in full and re-fetched (R7) |

## 2. Yodeck's product shape in one page

This summary is the frame for the area sections. Every sentence is VERIFIED_FULL_PAGE unless marked.

- One **Account** with a non-deletable Account Owner and invited Users. Every plan allows one role per user. On the Enterprise plan the account is partitioned into **Workspaces** (nested up to five levels) that scope content, screens and user roles, with one role per user per Workspace.
- A **Screen** is a registered player. Players are paired with an on-screen registration code typed into the portal; the first digit encodes the player type. Player types: Raspberry Pi (Yodeck-sold or self-flashed), Web Player, BrightSign, Android, Tizen, webOS, Windows, Fire OS, ChromeOS and Embeddable Feeds. Linux or x86 PCs are no longer supported (OFFICIALLY DOCUMENTED, snippet only).
- Content is **Media** (images, video, audio, documents, web pages, apps) organised in folders and tags, assembled into ordered **Playlists** and multi-region **Layouts**, and placed on screens as **Default Content** or through a **Schedule** of calendar Events with filler content between them. A per-screen **Takeover** and **Emergency Alerts** override everything.
- Nothing reaches a player until the operator pushes. Only affected screens download and restart playback.
- Players cache content and keep playing offline for at least 30 to 35 days, with a warning three days before the stop. They upload periodic screenshots, report Online, Offline, Upgrading, Disabled or Not Registered, and send offline and back-online e-mails.
- Pricing is per screen per month on Basic, Premium and Enterprise plans. The published rates assume annual billing. One screen is free while the account has exactly one screen. The MCP-based AI agent needs Premium or Enterprise; the REST API's tier is not stated in the spec or the help centre. Workspaces, SSO, audit log, security policies and player lock-down need Enterprise.
- A public, versioned REST API (beta) covers media, playlists, layouts, schedules, screens, users, roles, workspaces, push, takeover, emergency broadcast, playback reports and signed webhooks (VERIFIED_FULL_PAGE (spec)).
- Partners (resellers and white-label) manage separate full customer accounts from a partner console. Support Login, on by default for new partner staff, lets them act as any user of a customer account with no consent step. Each such login is recorded in the partner's audit log. The customer's own audit log has no column for it (INFERRED: probably not shown to the customer).

## 3. Workflow areas

Each area has the same shape: workflows as documented (goal, prerequisites, steps, inputs and validation, state changes), documented errors and recovery, plan restrictions versus missing features, hardware-dependent items, relevance to TINNOX with a suggested release priority, and what remains unknown. Step lists are condensed. Where round 2 changed a finding, the corrected version is given here and the change is listed in section 6.2.

### 3.1 Accounts, workspaces and roles

**Confidence: high.** Research files Y01, Y10 and Y10-supplement; round 2: `research/round2/AV1-accounts-admin.md`.

**Workflows as documented (VERIFIED_FULL_PAGE unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Invite a user | Add a colleague with a role. Requires the Account Owner or Administrator permission; on Enterprise a Workspace Admin may add users to their own workspace. | Profile menu, Users, create user, assign a role. Enterprise: add a role per workspace and set a Primary Workspace. The API offers invitation (default) or a manual password, chosen with `send_invite` (spec). | Inputs: e-mail, role, workspaces. The invitation link is valid for 30 days with a reminder two days before expiry, and can be resent (HELP 455907). One e-mail address equals one Yodeck account. Every plan allows unlimited users. One role per user on every plan; Enterprise allows one role per Workspace. Eight standard roles: Global Admins, Billing Access, Workspace Admin, Content & Device Manager, Content Manager, Restricted Content Manager, Content Viewer, Template Managers. The Owner cannot be deleted and is always in Global Admins. A pending-invitation list view: UNKNOWN. |
| Transfer ownership | Make another person the Owner. Only the current Owner can do it; Global Admins cannot. | Delete any existing user with the new owner's e-mail, then change the e-mail on My User Profile and save; the new owner resets the password (HELP 456205). | Ownership is a property of the Owner's user record, not a transferable flag (INFERRED from the procedure). If the Owner login is lost, Yodeck support performs the change. |
| Create a Workspace | Partition content, screens and users. Enterprise plan only (HELP 455895). | Manage Workspaces, Create Workspace: Name, Description, Screen Limit, Parent Workspace. | Hierarchy up to five levels; Yodeck recommends two or three. The API calls the limit `screen_quota`, where -1 means unlimited (spec). A Workspace has its own Working Hours. Reaching a Screen Limit blocks adding screens until a Global Admin raises it. Creating content while "All" is selected forces a workspace choice. Screens are moved between workspaces with a Move action. **Deleting a Workspace permanently deletes its content (Media, Playlists, Layouts, Schedules) and cannot be undone; only its screens are moved out** (HELP 669482). No help article mentions a "Default Workspace". |
| Assign roles through Groups | Give many users the same role in their own branch. Enterprise. | Create or pick a role, create a Group per role, set each user's Primary Workspace, add users to the Group, optionally cascade to sub-workspaces. | Effective role per workspace = Group role on the Primary Workspace plus explicit per-workspace roles. Permissions from several Groups add up. Workspace Admins cannot view or edit Groups. |
| Custom Roles | Per-object permissions. Enterprise plan (HELP 455896). | Account Settings, Custom Roles, Add Custom Role, name, tick permissions, save. | Permission rows: Media, Apps (split from Media; View on Apps auto-grants View on Media), Playlists, Layouts, Schedules, Screen Content, Screen Configuration, Push to Screens, Broadcast Emergency, Create and Delete Screens, User Management. **Screen Content and Screen Configuration have View and Change only, with no Delete** (help and spec agree). The help article lists User Management; the spec says it is "not applicable to Custom Roles" (contradiction C30). |
| Enable per-user 2FA | TOTP second factor. Any authenticator app. | My User Profile, Two Factor tab, scan the QR code or enter the secret key, enter the 6-digit code. | No plan gate is shown (INFERRED available on all plans). An "Enforce Two Factor Authentication" Security Policy is Enterprise-only. When Yodeck itself needs access to a customer account for an integration, it asks the customer to hand over the TOTP secret (HELP 456037). |
| Security Policies | Account-wide authentication rules. Enterprise. | Password rotation every 1, 3, 6 or 12 months; length, regex and template rules; forced reset on first login; inactivity logout; single active session; IP allow-list for the dashboard (players unaffected); enforce 2FA; disable e-mail password reset and Google login; "Enforce Policy for Screen Passwords" for players' remote-support passwords (HELP 455826). | Per-user allow-list extensions are set in User Management. An admin must set up their own 2FA before enforcing it, or the save fails. |
| SAML SSO and SCIM | Federated login and automatic provisioning. Enterprise; Owner for SCIM. | Account Settings, SSO, enable SAML, import IdP metadata, enable "Automatically Create Users" (just-in-time provisioning), map IdP groups to Yodeck Groups, optionally map a claim to the Primary Workspace; then SSO Advanced Settings, enable SCIM deprovisioning and generate a token and identifier URL for the IdP. | Roles come from SAML group mapping or are set by hand, never both. If the IdP is down, the Owner or a Global Admin e-mails support, which turns SSO off; all users then reset their passwords (HELP 456125). That no backup login URL exists is INFERRED. Documented IdPs for SCIM: Entra ID, Okta, OneLogin. Microsoft SSO is not available on Reseller or Whitelabel sites. SCIM attribute list: UNKNOWN. |
| API token | Credential for the REST API. | Account Settings, Advanced Settings, API Tokens, Generate Token, name it, choose a role, copy once. | The token "acts as a user" and is shown once (spec). On Enterprise a token takes one role per Workspace and can carry a Custom Role. The token list shows name, last accessed, creator, role and last modified. Deletion is immediate. The Premium and Enterprise gate is stated on the MCP page; the REST API's own tier is not stated (UNKNOWN). |
| Audit Log | See who did what. Enterprise. | Account Settings, Audit Log. | **Seven columns:** Time, Session (IP and session code), Workspace, User, Section, Name, Action (HELP 455824). "Object", "Change Message" and "Support user" belong to the partner console log, not the customer log. Retained 90 days, then deleted. Downloadable; the .txt, .csv and .json formats rest on an April 2025 release note only (OFFICIALLY DOCUMENTED). Whether a push appears as an audit action: UNKNOWN. The API has no audit-log endpoint (spec). |
| Partner console | Resellers and white-label partners manage customer accounts. Partner Network membership; 10-screen minimum across the whole partner site. | Sign in, be redirected to the partner console, open a customer account, use "Login" (as the account owner) or Support Login (as any user). | Each customer is a full separate account, not a workspace. **Eight staff permissions:** Billing, Audit Logs, Add Accounts, Delete Accounts, Update Accounts, Update Billing-related, Support Login, Documentation (HELP 455873). Permissions 5 to 8, including Support Login, are on by default when someone is promoted to staff; support customises the rest on request. Every Support Login is written to the partner's audit log with a "Support user" field (actions such as "Logged in as User" and "Released User"). The customer audit log has no such column (INFERRED: probably not shown; UNKNOWN until observed). Fees and terms: section 3.10. |

**Errors and recovery (documented):** Owner lockout needs support; ownership transfer collides with an existing user of the same e-mail; SAML lock-out needs support and a password reset for everyone; SAML rejects users with an empty group value (THIRD PARTY); **workspace deletion destroys its content irreversibly**; audit entries are purged at 90 days; the IP allow-list never affects players; deprecated roles cannot be assigned after April 2023, use a Custom Role instead (HELP 455959); enforcing 2FA fails if the admin has not set up 2FA.

**Plan restriction or missing feature**

| Capability | Classification |
|---|---|
| One role per user | All plans (Enterprise: one role per Workspace) |
| Workspaces, hierarchy, Groups, role per workspace, moving screens between workspaces | Plan restriction (Enterprise) |
| Custom Roles; API Roles resource (not available to Premium accounts, spec) | Plan restriction (Enterprise) |
| SAML, SCIM, Audit Log, Security Policies including enforced 2FA | Plan restriction (Enterprise) |
| API tokens | MCP: Premium and Enterprise; REST API tier not stated (UNKNOWN) |
| Per-user 2FA | Available on all plans (INFERRED from the absence of a gate) |
| Per-screen, per-folder or tag-level permissions | Missing feature; Workspaces are the only scoping mechanism (INFERRED from absence) |
| Self-serve partner staff roles; cross-account content move; backup login when SAML is on | Missing; support-mediated |
| Soft delete or restore of a deleted Workspace's content | Missing (deletion is permanent) |
| Agency sub-accounts under one direct account | Not a feature; use Enterprise Workspaces or separate accounts |

**Hardware-dependent or unverified:** nothing hardware-dependent. Unverified: customer-side visibility of partner Support Logins; the pending-invitation list; the SCIM attribute list; whether Custom Roles can grant User Management.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Non-deletable Owner with an explicit transfer-ownership action | MVP | Cheap; avoids Yodeck's e-mail-swap collision trap |
| Fixed role set with a separate billing permission | MVP | Covers documented use; Yodeck decoupled billing from admin in 2023 for a reason |
| Customer-level tenancy with explicit site and display scoping | MVP | Yodeck has no per-screen permission below Enterprise Workspaces; TINNOX's customers have few displays each |
| Soft delete with a restore window and a confirmation that lists what will go, for sites, tenants and content | MVP | Yodeck's workspace deletion is irreversible; a cheap way to do better (PROPOSED) |
| Per-user TOTP 2FA for everyone, with 30-day invitation links that can be resent | MVP | Expected baseline; matches Yodeck's documented invitation rules |
| Audit log with export, 24 months searchable, support records kept 7 years write-once | MVP (basic) | Yodeck keeps 90 days; retention as a compliance floor follows `research/round2/R2-support-access-models.md` (PROPOSED) |
| Role-carrying API tokens | MVP | Needed for TINNOX's own hardware-monitoring integrations |
| Staff support access under the B+ model: device operations always on under contract; content and account access only with a customer grant (24 h default, 7 days maximum), every session logged and visible to the customer | MVP | Yodeck's partner Support Login needs no consent and is not shown in the customer log; B+ closes both gaps (`research/round2/R2-support-access-models.md`, PROPOSED) |
| Custom roles, security policies, SAML with group mapping, SCIM | Later | Enterprise and tender features; design the role model so IdP groups can map onto it |
| Billing entities, white-label reseller programme | Out of scope | TINNOX builds for its own brand; billing stays external |

### 3.2 Display registration, pairing, grouping and provisioning

**Confidence: high.** Research files Y02 and the Y02 section of Y11-supplement; round 2: `research/round2/AV2-registration-api.md`.

**Workflows as documented (VERIFIED_FULL_PAGE unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Register a screen with a code | Pair a player with the account. Account with screen allowance; player installed, powered and online so the code shows. | Screens, Add Screen; choose guided setup (I have a player, a smart TV or a browser), enter the code directly, or use Advanced setup to pick a player type; enter a Name and the code; Register; assign a schedule or default content; push (HELP 682888). API: `POST /screens` with `name`, `player_type`, `workspace` and `reg_code` (spec). | The portal detects the type from the code; picking the wrong type is not an error. On screen, the Raspberry Pi shows 8 digits (e.g. 1234-5678); Web Player, BrightSign, Android, Tizen, webOS, Windows Intel-only and Fire OS show 9 digits; the Windows standard player shows W plus 8 digits (HELP 654056). The spec says `reg_code` "must be exactly 9 digits", with 0 for the Raspberry Pi (INFERRED: the Pi code carries an implied leading 0). **First-digit table:** 0 Yodeck Player (Pi), 1 Web Player, 2 BrightSign, 3 Android APK (Android 7 or earlier), 4 Tizen, 5 webOS, 6 Windows Intel-only (W for Windows standard), 7 Fire OS, 8 Android (Play Store), 9 ChromeOS, 10 Embeddable Feeds. Pairing completes "within 1-2 minutes". A registered screen without content shows "No content assigned to player" with a QR code. "Player Already Registered" means the device is linked to another account or has no internet; support resolves it. Codes are unique per device. No code lifetime is stated; the spec calls `reg_code` temporary and it may be empty after registration. |
| Factory pre-provisioning (Yodeck-sold players) | Zero-touch deployment of purchased Raspberry Pi players. | Ordering players auto-creates one screen per player. The buyer then has a **5-hour window** to name the screens and set Wi-Fi, 3G/4G/LTE, proxy, static IP and workspace (Enterprise), and can invite IT to finish. Each player "is bound to its screen before it ships". On arrival: connect HDMI and network, power on (HELP 887679). | Deleting the screen in transit forces manual registration. Content is not preloaded. Purchased players are locked to the buying account. Models: 1 GB player and 4 GB Player Plus. US orders ship from California via UPS; an EU warehouse is not stated. Not available on Reseller or Whitelabel partner sites (HELP 680806). |
| Self-flashed Raspberry Pi | Turn a customer's Pi into a player. Pi 4 recommended; Class-10 card of at least 16 GB; correct power supply. | Flash the image with Raspberry Pi Imager (Digital Signage OS list) or Etcher; optionally edit SETTINGS.txt; boot; read the code. | Up and running "within 3-4 minutes", up to 5 minutes with Wi-Fi from SETTINGS.txt (HELP 456187). The Pi 5 image is in Beta (HELP 456103). Pi 5 limits: layouts with more than one dynamic zone lag, colour depth is fixed at 16-bit, and a 4K screenshot briefly pauses video and tickers (HELP 456024). Black screen means a corrupt card: reflash. No code means no internet: try Ethernet. |
| Pre-provisioning with SETTINGS.txt | Register a Pi without typing a code, for bulk rollouts. The screen must already exist with all settings set. | Copy the Screen ID into the `[REGISTRATION] deviceid` key; optionally set Wi-Fi (mode WPA, WEP or WPA-EAP), static IP, netmask, gateway, DNS, `[PROXY]` (keys `proxy`, `port` with default 3128, `username`, `password`), `[TIME]` zone and subzone, `[SECURITY]` and `[RASPBERRY] config_overwrite`; boot. | On startup the player registers with that ID; if that fails the code appears. If screen settings were not set first, the player fetches the account defaults and may "revert back to the wrong settings, possibly getting the Player offline again". After first connection the Wi-Fi credentials on the card are obfuscated. Non-Pi zero-touch: only the Android APK device-owner command over ADB is documented (HELP 456043). |
| Android, Fire OS, Windows, webOS, Tizen, BrightSign, ChromeOS, Web Player | Register each player type. | Install the app or package, read the code, register as above. Tizen is installed from a package URL, with a separate portrait package; orientation is fixed at install. Windows standard registers self-serve with a W code. The Intel-only Windows build is hidden from 17 September 2026 for accounts without active Windows players. | Per-platform limits: Tizen officially supported only up to Tizen 7; webOS 4.0, 4.1, 6.x and 8.x supported (8 added April 2026), 3.x, 5.x and 7.x not; webOS has no 4K and rotates 90 or 270 only; Web Player not on iOS or iPadOS, no 4K, needs a browser extension for screenshots. **Android (HELP 455948): no CEC, and network, resolution, time zone and NTP cannot be managed from Yodeck yet; no custom certificates, SSH or storage encryption; web pages always render on top in layouts.** Fire OS: no CEC except the Amazon Signage Stick. Linux and x86 PCs no longer supported: OFFICIALLY DOCUMENTED (snippet only); no help article states it, and the prefix tables have no Linux type (INFERRED). |
| Delete, re-register, move | Lifecycle. | Delete from the Screens list; the player shows a code again; re-add. Enterprise: choose a Workspace and click Move. | Moving a player between accounts is delete and re-register, or a support request for purchased players. Billing reductions take effect at the next renewal on partner-billed accounts (HELP 680807, 841402); for direct customers this is INFERRED. |
| Bulk edit and export | Change many screens at once. | Select two or more screens, Actions, Edit, tick Set Value next to each property, Save, push. Screens CSV export honours the workspace selection. API: `POST`, `PUT` and `PATCH /screens/bulk` (spec). | A bulk update or delete in the API is rolled back entirely if any object fails (spec). CSV column list: UNKNOWN. |
| Screen properties | Per-screen configuration. | Screen fields: name, description. Basic tab: tags, orientation, time zone (searchable by city, country or UTC/GMT offset); Android adds TouchScreen and Kiosk Mode. Network: Wi-Fi with EAP, static IP, proxy with credentials, 3G/4G/LTE modem (APN, PIN), Advanced Networking with custom NTP servers. Sound/Display: resolution auto-detect or forced; overscan; sound output. Media Filtering, Working Hours, Location (IP guess or manual pin), Screen Email Notifications, Status (hardware status and Refresh), Advanced (Custom Certificates; Encrypt Player Storage and Lock Down on Enterprise, Pi only). | **The Basic tab of the Web Player and Fire OS shows no Time zone field.** None of the Network settings can be managed on Android. The API stores overscan as a four-number string (e.g. `4,3,5,1`) and resolution as an X11 modeline string (spec). The screen's time zone drives schedules and working hours (HELP 455844). That the user's profile zone does not affect screens is not stated on any help page (INFERRED). |

**Grouping:** no general screen folder or group hierarchy is documented. Tags on screens exist and drive media filtering and emergency broadcast groups. The API `/groups` resource holds roles for users and "Requires Feature: Workspaces" (spec); it is not a screen group. Enterprise Workspaces, with `parent_workspace`, Move and `screen_quota`, are the documented organising construct. "Device Disabled" means the device was disabled for subscription or payment reasons and is reactivated by Yodeck's Success team (HELP 456074); it is not a per-screen toggle. Whether disabled screens are billed: UNKNOWN.

**Errors and recovery (documented):** see the table; plus Tizen installation blocked by a wrong date or time; webOS version matrix; weekly Fire TV restart advised; the Workspace Screen Limit blocks new screens until raised.

**Plan restriction or missing feature**

| Capability | Classification |
|---|---|
| One free screen; per-screen billing beyond that | Plan restriction |
| Workspaces, per-workspace screen limits, moving screens between workspaces | Plan restriction (Enterprise) |
| Lock Down Player, Encrypt Player Storage (Raspberry Pi only) | Plan restriction (Enterprise) |
| Factory pre-provisioning on partner sites | Missing on Reseller and Whitelabel sites |
| Screen groups or folders | Missing feature (user feedback requests exist, THIRD PARTY) |
| Self-service transfer of a player between accounts | Missing; support-mediated |
| Zero-touch provisioning for non-Pi players | Only the Android device-owner command; no order-time binding |
| Remote time zone, NTP and network settings on Android | Missing ("temporarily unavailable") |
| Linux or x86 player | Dropped feature (OFFICIALLY DOCUMENTED, snippet only) |

**Hardware-dependent or unverified:** boot time depends on card and model; CEC behaviour depends on the display; the LED forced-resolution behaviour depends on the sending card; whether the Pi's 8-digit on-screen code is the 9-digit API code with a leading 0; the Windows standard code format (W plus 8 digits on one page, "9-digit" on another).

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Short on-screen pairing code with a type prefix; auto-detect type | MVP | Field-proven; one dialog serves all player types; a wrong type pick should never be an error |
| Immediate "no content assigned" placeholder after pairing | MVP | Installers need visual confirmation on site |
| Factory pre-provisioning by device identity, bound to a display record before shipping, with a set-up window for site details | MVP | TINNOX ships its own hardware; Yodeck's 5-hour order window is a direct reference |
| Device locked to its customer; clear "already registered" path; reassigning a device between customers as an operations-console action | MVP | Prevents hijacking; Yodeck makes reassignment a support job |
| Screen properties: orientation in all four angles, time zone, custom LED pixel dimensions, location, custom NTP | MVP | Core for LED pylons and multi-state fleets |
| Time zone, NTP and network owned by the TINNOX agent on every player type, including Android | MVP | Yodeck cannot set any of these on Android; Android players and Android-based controllers are in the TINNOX range (PROPOSED) |
| Display groups and sites (Yodeck lacks them) | MVP | The most requested Yodeck gap; cheaper than full workspaces |
| Linux (CM5) and Android players, plus Huidu cards driven as players | MVP | Yodeck dropped Linux; hardware choice per `research/round2/R4-player-hardware-recommendation.md` and `research/round2/R1-huidu-integration.md` |
| Bulk edit with all-or-nothing semantics, CSV export, offline alerts, working hours | Later | High value above about 20 screens |
| Consumer TV OS players (Tizen, webOS, Fire OS, BrightSign, ChromeOS) | Out of scope | Version-fragmented; TINNOX's hardware is LED and kiosk |

### 3.3 Media upload, validation, processing and organisation

**Confidence: high.** Research files Y03 and Y03-supplement; round 2: `research/round2/AV3-media-playlists.md` and `research/round2/R7-yodeck-api-spec.md` (F6).

**Workflows as documented (VERIFIED_FULL_PAGE unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Upload a file | Add an image, video, audio file or document. A role with Media change permission; on Enterprise a workspace must be chosen. | Media, choose Images, Videos, Audio or Documents, upload; files are "available for immediate use in Playlists and Layouts", subject to encoding (1 to 2 minutes for small batches, up to 5 for large). API (spec): `POST /media` with `source: local`; `GET /media/{id}/upload` returns a pre-signed S3 PUT URL (example host in `eu-west-1`, expiry 600 s); PUT the bytes; `PUT /media/{id}/upload/complete`; poll `GET /media/{id}/status`. URL import uses `download_from_url` and needs no completion call. | Maximum 5 GB per file. Storage is unlimited; the only limit is the number of subscribed screens (HELP 456202). Images (help): jpeg, jpg, png, bmp, gif, jfif, webp, svg, plus heic and heif only in Safari or macOS apps. The spec's local list is narrower: jpeg, jpg, png, bmp, svg, jfif (contradiction C33). Images "are not resized automatically"; resize to 1920x1080 for pre-4K players, since huge images slow them; LG webOS crops images above native resolution. Audio upload: mp3, wav, aac, ogg, m4a; players also play MP4, OGA and OPUS. Video: "almost all containers" including MP4, TS, MKV. **All uploads are re-encoded to H.264 with AAC** (three help pages). A "Skip video encoding" option uploads the exact file (no thumbnail); as-is files must be H.264 up to High Profile level 4.1. **Five status states (spec): `initialized`, `uploading`, `encoding`, `finished`, `failed`**; the status endpoint's own enum omits `failed`. The API returns no original file and has no download field. Nothing plays until pushed. |
| Documents | Show PDF and Office files. | Upload to Documents; PDF, Word, Excel, PowerPoint and rtf are "automagically converted to PDF and displayed as slideshows". | 10 seconds per page by default; per-page durations; 0 skips a page. PowerPoint uploaded to Videos is "converted to videos on our servers, retaining all transitions and animations"; the spec's PowerPoint `format` is `pdf` (default) or `video`. A 200-slide cap: UNKNOWN (in no full page). Rendering parity on non-Pi players: UNVERIFIED. |
| Add from URL, cloud drives, stock and streams | Content fetched from elsewhere. | YouTube and Vimeo are downloaded at up to 1080p and played locally. Live streams: the Pi uses Streamlink (HLS, HTTP, RTMP, RTSP); other players handle YouTube, HLS and DASH; UStream, custom HLS and RTMP or RTSP are Pi-only; no adaptive bitrate on the Pi. "Import Media Files" is a one-time copy from Dropbox, OneDrive, SharePoint, Google Drive and Google Photos. Live cloud-drive playlists sync up to 5 minutes after the folder has been inactive for at least 5 minutes. Stock images from Pexels, Unsplash, Pixabay and a built-in gallery; stock video from Pixabay, Pexels and the Yodeck library. Web pages: zoom factor, auto-adjust zoom (on by default), Chromium, scripts, refresh interval under each page's Advanced settings, a per-page proxy directive. | "You can link multiple cloud services simultaneously" (HELP 456267). The round-1 claim of one storage connection below Enterprise is not in any help page: UNKNOWN. |
| Organise | Folders, tags, workspaces, search. | Folders are global across Images, Videos, Audio, Documents, Web Pages and Apps; free-form tags; search by name, date, workspace and tag. Per-screen Media Filtering has four modes (all tags, any tags, all with no extra, any with no extra); it filters media only, never Apps; Premium and Enterprise (HELP 455943). Editing a media item can replace its file and keep every reference. | The API folder resource is read and delete only, with `parent_folder` (spec). No folder-level permissions documented (INFERRED missing). Folder nesting depth: UNKNOWN. |
| Availability window | Make an item playable only within dates and weekly slots. | On the media object (spec): `enable`, `available_after`, `available_before`, `availability_slots[]` with `start` and `end` (`HH:mm:ss`) and `days_of_week`. | `days_of_week` is a **7-character binary string, Monday first** (`0101011` = Tuesday, Thursday, Saturday, Sunday). The timestamps "do not include a timezone and [are] interpreted based on the screen's location" (spec), yet the spec's examples end in `Z` (C5). Weekly slots are Premium and Enterprise only. Start and expiry dates carry no plan badge (INFERRED: all plans). |
| Apps and custom HTML apps | Widgets and packaged HTML. | Apps, Create HTML app: name, icon, zoom factor, auto-adjust zoom, Chromium, ZIP with `index.html` in the base folder (no wrapping folder), "UI Configuration" settings schema; create an instance; add to a playlist or layout; push. | Apps run offline, have no CORS limits and are playback-aware. The spec lists 22 app templates. Catalogue size of 80 to 90 plus apps: THIRD PARTY (dated captures). |
| Content Flow | Compose content at HQ, region and local levels. Enterprise. | Each level gets a guaranteed airtime budget per loop; schedules override it (HELP 769385). | YouTube items count as 0 s. |

**Errors and recovery:** `failed` is a terminal status; deleted media returns 404 to the API; a push that exceeds the player's free space shows a red "No Space Left" message while old content keeps playing and the portal still says "Downloading" (HELP 456126); rate limiting answers 429 with `Retry-After` in seconds (spec). Two pairs of official statements still disagree: images not resized (manual) against cropped above native resolution (webOS guide); all uploads re-encoded against a per-upload skip option. The "repackaged in about 30 seconds without re-encoding" release note is not in the help corpus and is contradicted by three full pages (C34). Portal processing-status labels and error wording: UNKNOWN.

**Plan restriction or missing feature:** MCP needs Premium or Enterprise; the REST API tier is not stated; workspaces, Branded Templates and Content Flow need Enterprise; weekly availability slots, media filtering, CSV playlist import and tag-based playlists need Premium; apps, templates and unlimited storage are included from Basic; folder or tag permissions are missing; API download of originals is missing. "Enable video original" is a partner-console account field, not a customer setting; customers ask support to enable as-is upload (HELP 455854, 456172).

**Hardware-dependent or unverified:** 4K playback per player type; which codecs each player decodes after transcode; document rendering on non-Pi players; USB capture inputs (spec source `usb_stream`).

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Typed media model with an explicit five-state lifecycle | MVP | Yodeck's spec defines the five states; makes upload honest on slow site links |
| Pre-signed direct-to-storage upload with a complete call; 5 GB files; storage in an Australian region | MVP | Large LED video should not pass through the API; Yodeck's upload bucket is in eu-west-1 |
| Transcode to a player-safe rendition per player profile, keep the original downloadable | MVP | Yodeck re-encodes everything and returns no originals; LED controllers need pixel-exact sources; renditions per profile follow `research/round2/R4-player-hardware-recommendation.md` |
| Per-canvas renditions for non-16:9 LED sizes | MVP | Yodeck leaves images unresized and forces resolution at the screen; TINNOX should produce the right pixels at upload |
| Folders, tags and tag-based per-display filtering | MVP | Proven organisation; covers multi-site retail without workspaces |
| Availability window stored as local wall-clock time plus the display's IANA zone, with a trailing `Z` rejected or normalised explicitly | MVP | Yodeck evaluates in the screen's zone but its own examples carry `Z` (PROPOSED) |
| PDF conversion to pages with per-page durations | MVP | Release 1 per TINNOX Q11 |
| PowerPoint (converted to video or images) and web pages | Later (release 2) | Q11; TINNOX-player routes only |
| URL and stream items, app catalogue, stock library, cloud-drive pickers, quotas | Later | Useful but not for first LED and kiosk customers |
| Audio-only media | Out of scope (MVP) | Outdoor LED and kiosks rarely play audio |

### 3.4 Playlists, ordering, durations and transitions

**Confidence: high.** Research files Y04 and Y04-supplement; round 2: `research/round2/AV3-media-playlists.md` and `research/round2/R7-yodeck-api-spec.md` (F7).

**Workflows as documented (VERIFIED_FULL_PAGE unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Create a playlist and order items | A named ordered list for a screen, layout region or schedule event. | Playlists, create, add items, adjust each item's duration with the minus and plus controls, drag to position, save, push. CSV import of items exists (Premium and Enterprise; media names must already exist). | API items (spec) are one of four types: `media` (id, `priority` as the order, duration in seconds), `layout` (id, priority, duration), `subplaylist` (id, priority, `max_time`, `max_items`, no duration) and `hide_playlist` (priority, duration; reveals the layer underneath in a layout). Media default duration is 5 s (spec). Videos have "a fixed display time (the duration of the video itself), which cannot be changed". Layout items are recommended at 20 seconds or more, and each layout slide at no less than 10 s. A playlist that contains a layout cannot be placed inside a layout. Enforced minimum and maximum durations and item counts: UNKNOWN. |
| Shuffle | Random order. | Per-playlist Random Playback checkbox (API `random_playback`). | The player shows the media "randomly". The round-1 sentence "All media in the Playlist will play at least once" is in no help page and is dropped. Reshuffle per loop and repeat avoidance: UNKNOWN. |
| Transitions | Visual transitions between items. | Per-playlist toggle; speed Slow 3 s, Medium 2 s, Fast 1 s or custom. | The spec enum has **23 named types plus `random`** (fade, burn, fadegrayscale, colorphase, colourdistance, morph, dreamy, directionalwipe, directionalwrap, crosswrap, ripple, corcleopen, radial, wind, windowslice, crosshatch, randomsquares, pixelize, polkadotscurtain, squareswire, flyeye, squeeze, waterdrop); help pages say "more than 23" and "25". Images to images only; not with layer transparency; not yet at 4K; inherited by sub-playlists. Back-to-back 1080p videos are gapless only on Yodeck and Raspberry Pi players; Android TV and Google TV apps can show a black frame whatever the setting. Which other players render transitions: HARDWARE-DEPENDENT. |
| Availability | Dated or time-sliced items. | Lives on the media object, not the playlist item (section 3.3). | Per-item availability: not evidenced (INFERRED missing). |
| Nested playlists | Reuse a playlist inside another. Premium and Enterprise. | Item of type sub-playlist with maximum items and maximum time; a Repeat Items option. | Whichever limit is reached first wins. The player never plays an item partially, so a 30-second asset under a 25-second maximum is always skipped. The sub-playlist resumes where it left off on the next pass. Repeat Items applies only when all items finish before any limit; the API has no repeat field. A sub-playlist can contain another one; Yodeck advises one level only (HELP 702723, 682152). |
| Tag-based playlists | Dynamic selection by tag. Premium and Enterprise. | Include tags on one line are AND, extra lines are OR; a separate Exclude list; `content_to_filter` is media only or media and apps (spec). | **Default order is alphabetical**; `shuffle_content: true` gives random order (spec). The forum claim of upload order is refuted. The black gap between videos defaults to on. |
| Audio | Sound. | An audio-only playlist can be created; a layout's background audio can be a file or a playlist and overrides media sound; main-playlist audio overrides sub-playlist audio. | Audio item duration behaviour: UNKNOWN. |
| Other options | Playback tuning. | "Add a black gap between videos" (API `add_gaps`), "Keep Web Pages open" (Pi 4 with 2 GB or more; unavailable when a layout is in the playlist), Synced Playback (almost frame-accurate across players on one account; 4K synced videos can gap on the Pi). | Preloading: the next item loads off-screen while the current one plays (HELP 455815). |
| Assign | Put a playlist on a screen, region, schedule event or takeover. | Screen content source type `playlist`; region item of type playlist; schedule event source; takeover content (spec). | Schedules cannot be takeover content. |

**Errors and recovery:** media must be `finished` before use; the spec offers PUT and PATCH on a playlist "including its items", but whether PATCH merges or replaces the item list is UNKNOWN, so integrators re-read before patching; a push after a failed partial update is the documented recovery pattern; the API playlists list has no workspace filter (spec).

**Plan restriction or missing feature:** sub-playlists, tag-based playlists and CSV import on Premium and Enterprise; workspace field on playlists is Enterprise; per-item availability is not evidenced; per-display composition exists only as Enterprise Content Flow (section 3.3); transitions are image-only.

**Hardware-dependent or unverified:** which players render transitions and the 4K restriction per player; what the API does with a video item duration shorter than the clip; a push can take up to three minutes to appear on any player (HELP 455913).

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Ordered items with an explicit order field and per-item duration; video fixed to natural length by default | MVP | The spec and the help centre converge on this model |
| Drag reordering, duplicate, explicit publish | MVP | Table stakes; publish gives an audit point |
| Media-level availability evaluated in the display's zone | MVP | Dated campaigns across Australian states |
| A "hide" item that reveals the layer beneath in a layout | Later | Cheap and useful for layered LED layouts |
| Sub-playlists with item and time limits, never partial plays, for ad-slot packaging | Later | Yodeck's "whichever limit first, skip items that do not fit" rule is a good reference for billboard rotations |
| Per-item availability and per-display overrides | Later | Differentiators once the core is stable; Yodeck offers overrides only through Enterprise Content Flow |
| Shuffle with a documented reshuffle rule, tag-based playlists with a documented order, image transitions | Later | Transitions on LED walls are often rendered by the controller; Yodeck limits them to images anyway |
| Audio playlists | Out of scope | Silent installations |

### 3.5 Layouts, regions, orientation, pixel dimensions and content fitting

**Confidence: high for the documented controls; LED hardware behaviour is unverified. This area carries TINNOX's core need, LED pylons and portrait kiosks.** Research files Y05 and Y05-supplement; round 2: `research/round2/AV4-layouts-scheduling.md`.

**Workflows as documented (VERIFIED_FULL_PAGE unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Create a layout | A reusable multi-zone design. A content-creating role. | Layouts, create; choose Resolution/Ratio from presets (Landscape, Portrait, Full HD, 4K) or Add Custom Ratio with free width and height in pixels; add regions; put content in each; set per-region options; set a layout background colour from the top-bar colour picker; Preview; save; assign; push. | Custom ratios have a default maximum of 4096 px per side, with "no practical limit" on the number saved; also managed under Account Settings, Custom Ratios. 32:9 (3840x1080) is presented as the ratio for "Ultra-wide LED walls, menu boards". The API stores `resolution_width` and `resolution_height` (spec). Each region requires `width`, `height`, `top`, `left`, `zindex`, `duration`, `res_width`, `res_height` and `order`, and has `fit`, `rotation` (degrees), `flip`, `enable_transparency`, `is_muted` and `hidden`; `duration: -2` typically means infinite (spec). Changing the ratio resizes the canvas instantly and elements may need manual repositioning. No geometry validation documented. One layout can hold several aspect-ratio versions; each player picks the best fit (HELP 456193). |
| Fit content | Off-ratio creative. | Per element or region: Fill (may crop), Fit or Stretch (may distort); video also has per-side crop margins in percent, applied at playback only. | The API `fit` is a free string with examples `crop`, `contain` and `fit`; its mapping to the UI names is not documented (INFERRED: crop = Fill, contain = Fit). Background colour is layout-wide and solid only, and the API `Layout` schema has no background-colour field. On BrightSign, video crop applies only to full-screen video with HTML playback. |
| Start from a template | Apply a ready-made design. | Templates tab: search, Horizontal or Vertical filter (default Horizontal), categories; preview; Use Template. "Magic Layout" generates two editable options with a third-party AI provider and saves generated images to the library. | Applying to a non-empty canvas shows a "Warning for Replacement"; undo is supported. Magic Layout is "free for all Yodeck users at launch" and needs the Account Owner's AI Content Creation toggle plus layout and media permissions (HELP 776362). |
| Branded Templates | Locked brand assets. Enterprise and Enterprise Plus. | Layouts, Branded Templates; Draft and Published states; drafts are hidden from non-admin roles. | Template Manager permission has View, Change, Delete (round 1 only; not rechecked in round 2). |
| Set a screen to portrait | Rotate the output. | Screen settings, Basic, Orientation: Normal, Rotated Clockwise or Rotated Counterclockwise; two-push sequence (set Normal, push, then rotate, push); build 9:16 layouts on a 16:9 output mode (HELP 456216). | An official video-wall article tells users to set "upside-down" in the Player configuration (HELP 601510). The API `monitor_rotation` is a free string ("CW, CCW, etc.") with no documented 180 value. webOS cannot do 180. Tizen orientation is fixed at install. No Windows rotation statement exists (UNKNOWN). |
| Drive an LED board | Non-standard pixel sizes. | Yodeck states LED displays "just use the top-left corner of the input". Set a custom ratio with the exact pixel dimensions; force a standard output ("DVI resolution") on Sound/Display; disable the unused right and bottom pixels with overscan parameters; the player reboots. Worked examples: 1920x1080 output to a 320x240 board; 1440x900 to 256x256 (HELP 455837). | Auto-detect falls back to 640x480 VGA when the player boots before the screen reports. The help page shows the overscan strings as images only. The API stores overscan as a four-number string and output resolution as an X11 modeline, which suggests arbitrary timings can be stored (INFERRED). No help article or spec line mentions Huidu, NovaStar, Colorlight or Linsn. Non-top-left offsets and how a given sending card maps the signal: HARDWARE-DEPENDENT, UNVERIFIED. |
| Preview | See the layout as the player shows it. | Top-right Preview button opens a pop-up (pop-ups must be allowed); the editor preview updates in real time. | Rendering engine and list thumbnails: UNKNOWN. |
| Overlays and tickers | Layered regions. | Z-index and a transparency flag per region. The ticker is an app (RSS or static text, speed in seconds edge to edge), not a region type. | The ticker page names both directions and calls Left to Right the default while also describing right to left (C26). On Android, web pages always render on top regardless of layer order. Transparency over video per renderer: UNVERIFIED. |
| Video walls | Multi-screen. | One player and one layout per screen; a master player plus an IP video streaming device; playlist Sync Playback; bezel compensation from measured gaps; per-side video crop margins. | Yodeck says "The screens on the Video Wall are not 100% synced". The example streamer in the guide is end-of-life per Yodeck. A "Lock Mode" setting: absent from all 656 articles and the spec. |

**Errors and recovery:** replacement warning on templates; orientation needs a push and the two-step sequence; Tizen needs a reinstall to change orientation; on the Pi 5, layouts with more than one dynamic zone lag while one dynamic zone works fine; the Pi uses only its left micro-HDMI port; fixed-frame embeds do not resize.

**Plan restriction or missing feature:** Branded Templates are Enterprise and Enterprise Plus; Template Manager is a role restriction; Pi 5 dynamic-zone lag is a hardware limit, not a plan; Magic Layout is free at launch behind an Owner toggle; a native ticker region and per-region background colour are absent by design (apps and shapes are the documented substitutes).

**Hardware-dependent or unverified:** LED sending-card handling of a forced mode with a disabled area for any specific controller such as NovaStar or Huidu; renderer per player type; 4K layouts with several video regions; region rotation on every player; the 180-degree option per player.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Pixel-addressed canvas of arbitrary width and height with absolute-pixel regions and z-order | MVP | Yodeck's own model is pixel-based; TINNOX's published package canvases such as 1376x774 and 768x448, and wide pylon canvases (1920x480 is an illustrative size, not a published one), need the canvas to equal the wall |
| Screen-level output mode as validated integers: auto-detect, forced standard mode, and an active area (offset plus width and height) within the output | MVP | Mirrors Yodeck's documented top-left LED workflow without its free-string modeline and overscan fields (PROPOSED) |
| Orientation 0, 90, 180 and 270 as an enum, with a matching portrait canvas in the editor | MVP | Yodeck documents only two rotations in the UI, a free-string API field and a two-push sequence |
| Named fit modes as an enum (contain, cover, stretch, none), crop margins and a background colour field, with a preview at canvas size | MVP | Yodeck's `fit` is a free string and its API has no background field |
| Region content types: playlist, single media, web page with viewport and zoom, text, app | MVP | Matches Yodeck's region vocabulary |
| Multi-version layouts that pick the version matching the display ratio | Later | Useful for a mixed fleet of pylons, kiosks and walls |
| Template gallery, branded locked templates, overlays with transparency, region rotation, AI layout generation, server-rendered thumbnails | Later | Onboarding and brand features for later customers |
| Layout background audio; video wall by one player per tile with sync playback | Out of scope | TINNOX drives LED walls as one canvas through the controller |

### 3.6 Scheduling, recurrence, time zones, priorities and conflicts

**Confidence: high for the data model, zone format, precedence, takeover and working hours; DST behaviour is undocumented.** Research files Y06 and Y06-supplement; round 2: `research/round2/AV4-layouts-scheduling.md` and `research/round2/R7-yodeck-api-spec.md` (F5, F7).

**Workflows as documented (VERIFIED_FULL_PAGE unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Default content per screen | One item plays continuously. | Screens, edit, choose Default Content (layout, playlist, media or app) and optionally Scheduled Content; Save; push. | API (spec): one `screen_content` slot with `source_type` `playlist`, `media`, `layout`, `schedule` or `turned_off`. A screen has one content source; one schedule can go to many screens. |
| Create a schedule with events | Different content by date and time. | Schedules, Add Schedule, name it; calendar in month, week or day view; Add Event (or drag content onto the calendar): Event Type "Schedule Content" or "Turn Screen Off"; content (Media, Layout or Playlist); start and end date and time (overnight windows allowed); Repeat none, daily, work days, weekly, monthly, annual or custom ("Repeat Every X days/weeks/months/years"); Ends never, on a date, or after X occurrences; save; assign to screens; push (HELP 456255). | API event (spec): naive `start` and `end` with no offset, `duration` in minutes, `recurrence` code `o`, `d`, `w`, `m` or `y`, `every`, `occurrences`, Monday-first `days_of_week` string (`1111100` = Monday to Friday), `on` (day of month or nth weekday), integer `priority`, `source`. There is no `until` field; `end` serves as the series end. Work days and custom repeats are encoded with `w` plus `days_of_week`, `every` and `on` (INFERRED). Limits on events per schedule: UNKNOWN. |
| Precedence and filler | Resolve overlaps. | "When two events overlap, the one placed higher in the 'Events List' will play"; drag events to reorder. Gaps play the schedule's filler content, whose `source_type` may be `turned_off`. | API: "the one with higher number priority will play" (spec). How the UI list order maps to the integer: INFERRED. No overlap warning or conflict report; Yodeck only advises avoiding overlaps "unless intentionally using priority". **When a higher-priority event ends, or after a reboot, the active layout or playlist restarts from item 1; "The player does not keep a resume point"** (HELP 456255). The Prioritization page's Scenario 2 says the promo "resumes" (C25). |
| Content-type priority ("Prioritization of Content Types") | What wins when several mechanisms apply. | Emergency Alerts, then Takeover, then Working Hours, then Scheduled Content, then Default or Filler content; Content Availability is lowest but always enforced (HELP 589509). | A takeover outside Working Hours leaves the screen off, because takeover "controls playback, not power state". Whether an emergency alert shows outside Working Hours is ambiguous on the same page. Working Hours "override all other schedules"; a scheduled Turn Screen Off acts within Working Hours. |
| Preview | Check before assigning. | Playlists, Layouts and Schedules can be previewed individually. | The calendar can be navigated by day, week and month; no "what plays at time T" simulation is described. |
| Skip or change one occurrence | Exceptions. | UI: editing or deleting a recurring event offers "This event", "This and future events" or "All events in the series"; "All" removes exceptions; duplicating copies only the main event. API: `PATCH /schedules/{id}/add-event-exception` with `skip_on` or `skip_from` dates. | A `skip_from` on or before the event start, or a `skip_on` on a one-off event, deletes the event (spec). "Time shifting exceptions may only be applied via the Portal's UI". |
| Per-screen time zone | Local evaluation. | Screen, Basic, Time zone, searchable by city, country or UTC/GMT offset; use the physical location (HELP 455844). | **API format (spec): two strings, `basic.time_zone` (area, e.g. `Australia`; default `Etc`) and `basic.time_subzone` (city, e.g. `Melbourne`; default `UTC`).** The allowed values are tables, not an enum. The Australia area has **23 subzones**: Adelaide, Brisbane, Broken_Hill, ACT, Canberra, Currie, Darwin, Eucla, Hobart, Lindeman, LHI, Lord_Howe, Melbourne, North, Perth, Queensland, South, NSW, Sydney, Tasmania, Victoria, West, Yancowinna; twelve are tzdb backward-compatibility aliases (INFERRED from tzdb). The UTC labels are fixed daylight-saving values (Melbourne "UTC+11", Adelaide "UTC+10:30", Lord Howe "UTC+11"), wrong for about half the year (INFERRED: generated once in southern summer). Event and availability times are floating local wall-clock times read in the screen's zone. **DST: 0 mentions of daylight, DST or summer time in 656 articles and the spec.** **The Web Player and Fire OS show no Time zone field; Android's Basic Info lists one, but Android Limitations says the time zone "can't be set from Yodeck yet"; Android and Fire OS use the device's own settings** (C24). The Schedules example is written "America/New York"; the API value is `New_York` under `America`. A screen with no zone is read as Etc/UTC (spec default). That the profile zone never affects screens: the exact sentence is not in the help corpus (UNKNOWN). Players sync time by NTP; an empty NTP field uses "trusted time sources, based on its operating system and locale". |
| Working Hours | Power schedule. | Global, per workspace or per screen override (the per-screen override wins); screen turned off outside hours in its local zone, or a black image if the player cannot power the display off; "special working hours" for specific dates; bulk-editable (HELP 456026). | Display power needs CEC: Android shows black and the TV stays on; the Amazon Signage Stick puts the TV in standby; other Fire TV devices show black. The September 2024 release date for special working hours is not on the page. |
| Takeover | Per-screen override. | Screen Takeover tab: Media, Apps, Playlists or Layouts, with duration indefinite, 30 minutes, 1 hour or custom minutes; Stop Takeover; a new takeover replaces the current one; not available on unregistered screens or while a new media item is still uploading; needs the change-content permission (HELP 456030). | API: `PUT /screens/{id}/takeover` or `PUT /screens/takeover` with content type media, layout or playlist; duration in minutes, minimum 5; `null` duration is indefinite; `null` content stops it (spec). Schedules cannot be takeover content. The UI minimum for a custom duration: UNKNOWN. |
| Emergency alerts | Account or workspace broadcast. | Broadcast Groups are tag-based (at least one tag); a three-step wizard; Workspace filter on Enterprise; CAP support (help and release note); UI display durations 2, 5, 12, 24 or 48 h (HELP 456243). Only Global Admins define alert types, groups and CAP handlers; Workspace Admins and Content Managers can broadcast in their workspaces; a Custom Role can carry Broadcast Emergency. | API (spec): list, broadcast and cancel only; alert definitions cannot be created through the API; broadcast duration defaults to 7200 s; no CAP field. "Shows within 5 to 10 seconds" is not in the help corpus (OFFICIALLY DOCUMENTED, snippet only). Plan tier: UNKNOWN. |
| Download hours ("Timed Events") | Defer downloads to a window. | Set download hours per player; on push choose immediate or wait for the window; a window of at least two hours is advised on slow links; the same tab sets a scheduled reboot (HELP 455875). | The setting is per screen (`advanced.timed_events.download_timeslots`, spec); push and takeover carry `use_download_timeslots`. If the download is unfinished, old content keeps playing. Format, default and interaction with Working Hours: UNKNOWN. |

**Errors and recovery:** the single-screen API push returns 200 even on failure (check the body); bulk push skips screens the token cannot push; a schedule whose filler is turned off leaves the screen black between events; a skip exception can delete a whole event; content flags "Possibly Outdated" and "Not Updated" until pushed; playback reports are generated in Etc/UTC.

**Plan restriction or missing feature:** emergency alerts are plan-gated (tier unknown); workspace-scoped schedules and alerts are Enterprise; conflict warnings, takeover with a schedule, multiple schedules per screen (INFERRED from the single content source), a time-based schedule simulation and remote time-zone setting on Android, Fire OS and the Web Player are missing.

**Hardware-dependent or unverified:** CEC and RS-232 power; takeover revert timing; how an emergency broadcast renders; the tz database version on the player image (Debian 10 base, section 3.9) and in bundled widgets (moment-timezone), which matters for Australian rule changes.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Default content plus explicit publish | MVP | Every board needs a fallback and a deliberate go-live |
| Named schedule with events, overnight windows, filler content and a "turn off" event type | MVP | Dayparting and trading hours |
| Recurrence stored as RFC 5545 rules; once, daily with weekdays, weekly, monthly, until a date or after N occurrences | MVP | Yodeck's `o/d/w/m/y` with `every`, `occurrences` and `on` maps cleanly to RRULE |
| A single documented precedence order (emergency, takeover, working hours, schedule, default, availability) | MVP | Yodeck publishes exactly this; copying the order avoids operator confusion |
| Per-display canonical IANA zone (aliases never listed or stored, accepted on input only; no `Etc/*`), offsets computed per date, wall-clock events, documented DST gap and overlap rules, gated on time sync | MVP | Yodeck mixes aliases into the list, shows fixed summer offsets and says nothing about DST (PROPOSED; see SCH-11 in `docs/acceptance-tests.md`) |
| Explicit integer priority, higher wins, with a non-blocking overlap warning | MVP | Yodeck's spec uses the same rule; the warning is a small improvement |
| A stated rule for restart versus resume after a higher-priority event ends | MVP | Yodeck's own pages contradict each other; share of voice on pylons depends on it (PROPOSED) |
| Single-screen takeover with preset and custom durations, stop button, replace semantics | MVP | Panic button for closures and sold-out notices |
| Proof of play stored in UTC and shown in the display's local time | MVP | Yodeck generates reports in UTC only |
| Schedule timeline preview | Later | Valuable for DST edge cases; Yodeck has none |
| Exceptions that never silently delete an event; working hours with holiday overrides; download hours; group scheduling; emergency alert library | Later | Follow the core |

### 3.7 Publishing, download progress, deployment status and confirmation

**Confidence: high for the push model and content states; low for heartbeat and reconnect behaviour.** Research files Y07 and Y07-supplement; round 2: `research/round2/AV5-publish-monitor-offline.md` and `research/round2/R7-yodeck-api-spec.md` (F7).

**Workflows as documented (VERIFIED_FULL_PAGE unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Push to Screens | Make saved changes take effect. A role allowed to push (Restricted Content Manager "cannot publish to screens"). | Save; the Push to Screens button turns orange and flashes while unpublished changes exist; click it; affected screens download and restart playback, and unaffected screens "will not be notified"; the button turns black. Clicking the black button force-pushes to all screens. Per screen: **Save & Push to this Screen** from the screen editor, or Push Again to this Screen with no pending changes. If download hours are set, the push prompts "push immediately or wait for download hours" (HELP 456278, 830976). | A push can take up to three minutes to appear on any player type (HELP 455913). No dialog listing affected screens and no scheduled push were found. Whether individual items carry an unpublished badge: UNKNOWN. Whether a push is written to the audit log: UNKNOWN. |
| Content states per screen | See who is current. | **Six states:** Up to date; Downloading; Unknown; **Pending Media** (the player will download later because Restricted Download Hours are on); Possibly Outdated (offline and has not reported receiving the latest content); Not Updated (keeps showing older content) (HELP 456254). Dashboard shows Online, Offline, Registered and Unregistered counts and a map from the last public IP. | The Status tab has a Refresh button but lists no content-status field; the round-1 phrase "might not be downloaded" is in no article. A Yodeck staff forum reply says the portal shows no bytes, percent or time remaining (THIRD PARTY). On screen, the Pi shows a blinking "Downloading" message in the bottom-right corner; out of space, it shows a red "No Space Left" while the portal still says "Downloading". |
| Old content during download | Avoid black screens. | | Old content keeps playing when the player runs out of space and when the download window ends before the download finishes. The Pi guide's "After the download completes, playback resumes" may imply a short interruption; the swap moment is undocumented (INFERRED). |
| Single-screen API push | Push from an integration. | `PATCH` the screen content, then `POST /screens/{id}/push` with optional `use_download_timeslots` (spec). | The spec says the call is synchronous and returns 200 with either `status: successful` or `status: failed` with `errors`. Integrators report `completed` on the wire (THIRD PARTY). A slow screen can be reported as failed after a client's 10-second timeout (THIRD PARTY). |
| Bulk API push and status polling | Push many screens and confirm per screen. | `POST /screens/push` with `filter_workspaces` or `filter_devices` (mutually exclusive; none means all screens) and `use_download_timeslots`; poll `GET /screens/push/status` (spec). | Statuses: `initialized`; `in_progress` with `progress{index, of, percent}`; `completed` with `screens[{id, name}]`; `failed` with `errors`. An empty `filter_devices` is a 400; an empty `filter_workspaces` means all permitted workspaces; screens without `apply_changes` permission are excluded. **The status URL is fixed and takes no job ID**, so only the latest bulk push per account can be read and concurrent pushes cannot be told apart (INFERRED from the schema). |
| Confirm what is playing | Visual confirmation. | Screenshot thumbnails: every 30 s while Screen Details is open and every two hours otherwise (HELP 456254); the preview FAQ says 30 to 40 s while watched and one per hour after logout (HELP 456120); the screen-messages page says frequency "depends on your plan" (C27). "Capturing screenshot..." means a capture is running now; "Your screenshot will appear here soon" means a capture is queued for when the player reconnects (HELP 757879). | API (spec): `screenshot_url` on each screen; `POST /screens/{id}/refresh-screenshot` and a bulk variant, both asynchronous. Image format: PNG (INFERRED from the spec example). Resolution and retention: UNKNOWN. |
| Bandwidth and endpoints | Plan network capacity. | Control connection up to 300 MB per month per player; media downloaded once; streams and web pages unpredictable; contact Yodeck before using metered links (HELP 456162). Outbound endpoints: section 3.9. | |
| Offline at push time | Recovery. | "If the Player is 'Offline' in the Portal, there is no way for the Player to receive the 'Push' command"; reconnect, then push again (HELP 455913, 830976). | The round-1 quote "Content not updated" is in no article and is dropped. Whether an offline screen picks up a missed push on reconnect without a manual re-push: UNKNOWN; every guide says to push again. |

**Errors and recovery:** forgetting to push leaves the old content playing; a pre-provisioned player that registers before its settings exist can go offline; integrators re-push idempotently after any failure and confirm per screen; rate limits apply per token and per account (section 3.11); incidents are posted at status.yodeck.com (contents unverified).

**Plan restriction or missing feature:** portal push on all plans (INFERRED, no gate found); per-screen download progress in bytes is absent (the bulk API reports only a screen-count percentage); a per-item unpublished badge, a job-scoped push status and scheduled publishing (beyond download-hours deferral) are missing.

**Hardware-dependent or unverified:** screenshot cadence per player type and plan; how fast the online flag flips; Web Player behaviour offline; auto-delivery on reconnect; the exact swap moment.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Explicit save versus publish with an unpublished indicator that names the pending displays | MVP | Keeps Yodeck's safety, fixes its account-level-only indicator |
| Per-display states: uploaded, published, downloaded, playing, with last seen, last published and last changed, plus Yodeck's six content states (including a pending-window state) as a reference | MVP | What operators of unattended boards need first |
| Per-display download progress with bytes and an estimate | MVP | Yodeck reports only a screen count; regional 4G links make large pushes slow |
| Keep playing the old loop until the new bundle is fully cached; swap only at an item boundary; no black screen | MVP | Yodeck documents the old-content rule but not the swap moment |
| Automatic delivery when an offline display reconnects | MVP | Yodeck's guides tell operators to push again |
| Push jobs with an ID and per-display results, in the UI and the API | MVP | Yodeck's status endpoint has no job ID (PROPOSED) |
| Periodic screenshot with a per-display URL, faster while an operator is watching, and a documented cadence | MVP | Yodeck's own pages disagree on the cadence |
| Published bandwidth budget and endpoint list in the install guide | MVP (documentation) | Yodeck publishes both; installers on corporate networks need them |
| Download windows, proof of play, offline alerts, takeover publish path | Later | Follow the core |

### 3.8 Screenshots, monitoring, diagnostics and playback reporting

**Confidence: high.** Research files Y08 and Y08-supplement; round 2: `research/round2/AV5-publish-monitor-offline.md` and `research/round2/R7-yodeck-api-spec.md` (F5, F9).

**Workflows as documented (VERIFIED_FULL_PAGE unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Monitor the fleet | See who is online and current. | Screens table: fixed Name and Player Status (Online, Offline, Upgrading, Disabled, Not Registered); optional ID, Player Type, Description, Tags, Workspace, Scheduled Content, Default Content, Offline Time, TV Status, HDMI Connected, Uptime, CPU Temperature, Screen Resolution, Hardware Version, Power Supply, Locked Down, Encrypted, Hostname (HELP 455972). CPU temperature, power supply, hardware version, lock-down, encryption and hostname are shown for the Pi only. Content states as in section 3.7; dashboard counts and map; CSV export. | TV status, HDMI connected, CPU temperature and power supply refresh hourly; TV status on non-Pi players "may display inaccurate information". API (spec): `state{online, last_seen, updating, registered}` as an untyped object, `online=` and `registered=` filters and `last_pushed`. Heartbeat interval and offline-detection threshold: UNKNOWN (guides say to wait up to three minutes). |
| Offline e-mail notifications | Be e-mailed on offline and recovery. | Screen Details, Screen Email Notifications, or bulk through Actions: Do not notify, 30 minutes, 2, 6 or 12 hours, or custom from 30 minutes to 48 hours in 30-minute steps; optional back-online e-mail within five minutes; toggle to alert during scheduled-off hours (HELP 456051). | **Defaults for new screens: 6 hours, no alerts during scheduled turn-off, no back-online alert, recipients All Users.** **Each screen has its own recipient list, limited in the UI to users with Device Manager access**; recipients can be edited in bulk; each user has a global opt-out. API: `offline_notifications{notify_after (minutes), notify_during_scheduled_turnoff, notify_when_back_online, recipients, recipients_all}`; the spec example lists external addresses (C31). Channel: e-mail only. Whether a webhook Screen event fires on an online or offline change: UNKNOWN. |
| Screenshots | Confirm what is rendering. | Cadence and messages as in section 3.7; Web Players need the Yodeck browser extension. | On the Pi 5, taking a screenshot of a 4K screen briefly pauses video and tickers (temporary issue). |
| Remote actions | Restart or re-send. | Screens Overview Actions: Turn monitor ON/OFF (CEC), Reboot Player, Shutdown, Push again. After a Shutdown someone must power-cycle the player on site. Scheduled reboot is set under Timed Events (HELP 455875) and in the API as `advanced.timed_events.schedule_reboot` (format undocumented). | **The public API has no reboot, shutdown or CEC endpoint** (spec). The reboot path used by one integrator matches a self-described "modeled" third-party OpenAPI file, not Yodeck's spec (THIRD PARTY, `research/round2/R7-yodeck-api-spec.md` verification row 25). |
| Status tab and diagnostics | Per-screen health. | Status tab: Screen ID, status last updated, hardware and software version, hostname, resolution, storage, browser cache size, uptime, Wi-Fi SSID and signal, HDMI, TV status, power supply, colour depth, CPU temperature, CPU load (1, 5 and 15 minutes), RAM, swap, public IP per interface, Locked Down, Encrypted; Refresh button (HELP 455893). | API: `GET /screens?subset=player_status`; "Available fields vary based on player type"; storage is a text string such as "24.08 GB free of 25.93 GB"; most fields are Pi-only; Android gives versions, RAM and window size (spec). Pi thermal icons: half-red thermometer at 80 to 85 °C (CPU throttled), full red above 85 °C (CPU and GPU throttled), lightning for under-voltage; `avoid_warnings=1` hides them (HELP 455913). No player log viewer or "send logs" feature found; the API `advanced` subset mentions diagnostics and remote debug fields; SSH is documented. **Pi players stay connected 24/7 to Yodeck's support VPN on 1194/TCP unless it is turned off per player** (`network_disable_remote_support`); SSH is the only service enabled on the player. |
| Playback reports | Proof of play. | Enable with a toggle and choose daily, weekly or monthly CSV export; push to screens after saving, or the player does not start generating records (HELP 455928). API: `GET /account/playback-reports` with a date filter returns a pre-signed `download_url` that expires in 2 hours (spec). | Premium and Enterprise (help); the spec's "Pro" is a stale plan name (C28). The article says CSVs "are not deleted" and also that all data and CSV files are kept "for up to 3 months": treat 3 months as the bound. Generated in Etc/UTC. Records: one per complete play for video, audio and multi-page documents (interrupted plays are not logged); per playlist slot or every 300 s when shown alone for images, web pages, apps and one-page documents. Players upload in batches, so playback date and reported date differ. **CSV columns:** Reported Date, Screen ID, Screen UUID, Screen Name, Screen Tags, Media ID, Media Name, Playback Date (when play ended), Media Duration (ms), Media Tags; UTF-8. The example download host is in us-east-1 (INFERRED storage region). |
| Remote settings | Change configuration from the portal. | Orientation, resolution and overscan, sound, working hours, location, network (Wi-Fi including EAP, static IP, proxy, modem, NTP), all applied after a push. | Not available on Android for network, resolution, time zone or NTP (section 3.2). Display power through CEC or RS-232 where the display supports it (THIRD PARTY on RS-232). |

**Errors and recovery:** stale screenshot after a player goes offline; an offline player cannot receive a push; no CEC on Android (black screen, TV stays on); the Amazon Signage Stick does standby, other Fire TV devices go black; back-online alert within five minutes; "Updating" for more than one to two hours means a failed update (section 3.9); weekly Fire TV restart advised; status page at status.yodeck.com.

**Plan restriction or missing feature:** Lock Down and Encrypt Player Storage on Enterprise (Pi only); playback reports on Premium and Enterprise; alert channels beyond e-mail are missing; device-health webhooks (online, offline, push completed) are missing; live screen mirroring missing (competitor claim); player log viewer not found; screen groups for monitoring missing.

**Hardware-dependent or unverified:** screenshot cadence per player type; CEC and RS-232 power; what Power Supply reports; whether all player types report content status at the same cadence.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Online, offline, upgrading and not-registered states as an enum, with last seen and offline time, plus dashboard counts | MVP | Baseline for an unattended fleet; Yodeck's `state` is untyped |
| Heartbeat with a published interval and offline threshold | MVP | Yodeck leaves even its integrators guessing |
| Periodic screenshot, faster while watched, plus an on-demand capture command | MVP | Yodeck has both but documents conflicting cadences |
| Offline e-mail alert defaulting to 30 minutes with recovery alerts on, scheduled-off suppression, and per-display recipients including verified external addresses | MVP | Yodeck defaults to 6 hours with no recovery alert and limits recipients to Device Manager users (PROPOSED) |
| Remote reboot, display power, re-push from UI and API, as jobs with per-display results | MVP | Yodeck has the UI actions but no API reboot and a push that hides failures |
| Player health telemetry (temperature, throttling, storage as numbers, uptime, version) in a Status tab and API, with an alert before 80 °C | MVP (lite) | Outdoor LED cabinets in Australian heat fail on temperature first; Yodeck's thresholds are a reference |
| Proof of play with batch upload, playback versus reported date, UTC storage, local-time display and CSV export | MVP for advertising boards, later for kiosks | Yodeck's documented semantics and columns are a good reference |
| Signed outbound webhooks with device topics (online, offline, push completed, media ready, playback batch) | Later | Yodeck has resource webhooks only (section 3.11) |
| Remote network editing, log upload to support, status page | Later | Yodeck offers network editing and a support tunnel; logs are a gap |
| Support remote access that is off by default and opened per session | MVP (policy) | Yodeck's Pi VPN is on 24/7 by default; TINNOX follows B+ (`research/round2/R2-support-access-models.md`) |
| Live mirroring, plan-gated tiers | Out of scope | Kiosk-specific or not TINNOX's model |

### 3.9 Offline playback, startup, updates and recovery

**Confidence: high for documented windows, boot and update cadence; update rollback remains undocumented.** Research files Y09 and Y09-supplement; round 2: `research/round2/AV5-publish-monitor-offline.md`.

**Workflows as documented (VERIFIED_FULL_PAGE unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Offline playback | Keep playing when the internet drops. Content pushed while online; clock in sync. | Playback continues from the local cache. "At least 30-35 days without any disruption" (HELP 456183); a warning three days before stopping; "between 30-40 days after losing internet access, your Player will stop playback, displaying an error message" (HELP 456208). | The general troubleshooting guide says it "might take up to 45 (or even more) days"; this is not Android-specific. Yodeck calls the stop a "fail-safe" black-out. Mechanism: a new schedule file is issued automatically every 30 days; "Apply Needed" shows near expiry on the Pi, Windows and Amazon players; the stop screen is "Internet Access Required" or "Invalid Schedule File"; a reboot restores playback for up to one hour. Screens offline more than 30 days may have been auto-disabled (Pi, Windows, webOS and Android). While offline the clock "can be off by a couple of hours". Web pages and live streams do not work offline. Content cannot be updated by USB. Fix: reconnect, check Last Seen Online, push again. |
| Boot and startup (Raspberry Pi) | Power-on to playback or to a code. | First set-up "may take up to 5'". A normal boot runs in stages: chip 3 s, firmware 2 s, bootloader 3 s, logo and Loading 3 to 15 s (roughly 11 to 23 s before the software loads, INFERRED sum). The player shows "Running startup diagnostics"; **cached playback starts after 2 minutes if a valid schedule file and media are stored, with or without network** (HELP 455913). | Outcome is a code, "No content assigned" with a QR code, or playback. A 3 s delay at power-on lets the screen boot first. A custom boot logo is unlocked only after the customer posts a Capterra or G2 review (HELP 455942). webOS launches the app on boot; the Windows app must stay open and its code changes on restart. |
| Player software updates | Stay current without operator action. | Updates are automatic. **Regular releases ship every 6 weeks on Tuesdays; emergency hotfixes come one to two times a year;** devices also update at first boot before registering (HELP 455913). The player shows "Updating" and the table shows Upgrading; most updates take 2 to 30 minutes. Packages come from a plain-HTTP repository and are digitally signed. Fire TV uses Appstore auto-update; the Android APK v2 "Production Setup" (device owner) updates itself without Google; the Play Store variant needs a signed-in Google account; "Test Setup" never updates. | "Updating" for more than one to two hours means the update failed and needs Yodeck's remote manual intervention. **Rollback: no article mentions it**; the only documented recovery is a USB self-reflash with a signed image or Yodeck's intervention. Staging, a maintenance window and opt-out: UNKNOWN. |
| Network requirements | Get onto a site network. | Outbound only (HELP 456123): the IoT hub host on 443/TCP, the assets host on 443/TCP, the S3 host and the packages host on 443/TCP (all required, for every player type), the update repository on 80/TCP, an optional support host on 1194/TCP and an optional widgets host on 443/TCP; NTP on UDP 123; two fallback IP addresses for IP-only firewalls; webOS also needs signageOS endpoints. Control traffic up to 300 MB per month; media downloaded once. Players use Google DNS by default as well as local DNS; this can be turned off. | The hosts sit behind CloudFront and S3 and resolve to many IPs. Proxy: SETTINGS.txt `[PROXY]` keys `proxy`, `port` (default 3128), `username` and `password`; HTTPS needs CONNECT; the portal supports an HTTP proxy with credentials and per-web-page proxy directives. Custom Certificates in PEM format, installable before registration. Enterprise Wi-Fi: "use the EAP security option" (the "all plans" statement was not found on this page). Captive portals: "Yodeck players do not support captive portals"; the bypass is MAC-address allow-listing. PAC, NTLM and EAP methods: UNKNOWN. |
| Clock and NTP | Keep schedules accurate. | Players contact NTP servers over UDP 123; per-screen custom NTP servers under Network, Advanced Networking (comma separated, no restart needed); an empty field uses "trusted time sources, based on its operating system and locale" (HELP 482103). | The Pi's hourly time save without an RTC, the "minutes to hours" drift and the DS3231 RTC overlay are not in the help centre; they remain OFFICIALLY DOCUMENTED (snippet only, probably www.yodeck.com/docs). Whether the Pi 5 image uses its on-board RTC: UNKNOWN. |
| Storage | Fit content on the card. | The Status tab shows a Storage line; the bundled card is 32 GB with about 28 GB usable; the Pi 5 software uses about 5 GB; Android needs at least 500 MB free. If a push exceeds free space the player shows a red "No Space Left" message while old content keeps playing. | Cache eviction policy: UNKNOWN. |
| Encrypt Player Storage | Protect media on a stolen player. Enterprise; Raspberry Pi only. | Key fetched from Yodeck at boot (needs connectivity), stored locally (works offline, extractable) or fetched with an IP allow-list; one method at a time. | A boot from an IP outside the allow-list triggers an hourly e-mail warning, and the player shows offline. |
| Reflash and recover | Rebuild a Pi player. | Raspberry Pi Imager or Etcher, or a USB self-reflash at boot with a signed image (up to 30 minutes to write plus 15 to 20 minutes to start). | Only SETTINGS.txt survives a reflash; command-line changes are lost. A pre-provisioned ID keeps the screen record, otherwise re-add. The Pi 1 to 4 image runs Debian 10 (Buster), with a move to Debian 12 (Bookworm) planned (HELP 456079, dated 31 October 2025). |

**Errors and recovery:** as above, plus "Player Already Registered" can be caused by no internet; a Wi-Fi credential change loses connectivity; a stall at "Downloading media..." after blanked Wi-Fi settings was fixed from the portal Network tab (THIRD PARTY); wrong date or time blocks Tizen setup.

**Plan restriction or missing feature:** Encrypt Player Storage and Lock Down are Enterprise and Pi-only; operator-controlled update windows, staged rollout, rollback, captive-portal support and an 802.1X certificate workflow are missing or undocumented; the offline cutoff is product behaviour, not plan-gated.

**Hardware-dependent or unverified:** boot time on non-Pi players; Pi 5 image status (Beta); RTC use on the Pi 5; offline behaviour of the Web Player and BrightSign; per-platform cache limits.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Full local cache with no licensing cutoff on playback; a lapse locks publishing, never playback | MVP | Yodeck's 30 to 40 day stop is a commercial gate; unattended boards must not go dark (`research/round2/R6-commercial-model.md`) |
| Download-then-swap with no black screen; old loop until the new bundle is verified | MVP | Yodeck documents the old-content rule and a "No Space Left" failure mode worth copying |
| Fast branded boot with cached content before the network is up | MVP | Yodeck waits two minutes of diagnostics before cached playback |
| Pre-provisioning file (device ID, Wi-Fi including EAP, static IP, DNS, proxy, time zone) | MVP | Mirrors SETTINGS.txt; avoid the "fetches defaults and goes offline" trap |
| Automatic updates with A/B partitions and rollback, a published cadence, visible Updating state with a failure timeout, version and uptime in the table and API | MVP (agent), later (staged rollout) | Yodeck publishes a 6-week cadence but documents no rollback |
| A current, supported base OS on the player image | MVP | Yodeck's Pi image is still on Debian 10 |
| Published allow-list (hosts, ports, NTP, DNS behaviour, bandwidth) in the install guide | MVP (documentation) | Yodeck publishes one; copy the shape |
| Configurable NTP, an RTC on the pilot hardware, schedules gated on time sync, time-synced flag in the heartbeat | MVP | Yodeck admits drift of a couple of hours offline; DST-heavy scheduling needs better |
| Storage reporting and a "not enough space" state that keeps old content | MVP | Documented Yodeck behaviour worth matching |
| Proxy with auth and custom CA, encrypted storage, lock-down | Later | Enterprise and kiosk sites |
| Captive portals | Out of scope | Yodeck does not support them either |

### 3.10 Customer administration, plans, restrictions and support

**Confidence: high for pricing, plan gating, partner terms and support; medium for compliance claims that rest on www.yodeck.com.** Research files Y10 and Y10-supplement; round 2: `research/round2/AV1-accounts-admin.md`.

**Workflows as documented (VERIFIED_FULL_PAGE unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Sign up and the free period | Start at no cost. | Self-serve sign-up without a credit card. For sign-ups from 2 March 2026, a 30-day "Unlimited Access Period" on up to 5 screens **runs on the Enterprise plan**; a reminder goes out on day 25; afterwards the quota drops to one free Basic screen and the account pauses until a billing user chooses a plan (HELP 589475). | Extra screens are disabled starting with the highest screen ID. Partner-created accounts get no trial; they use Demo licences. The Free plan keeps all Basic features, unlimited storage and unlimited users while the account has exactly one screen; going from 1 to 5 screens bills 5. Several Enterprise feature pages still say the Enterprise plan "is free if you only manage one screen" (C29). |
| Subscribe and change plan | Pay per screen. The Billing Access permission. | Basic, Premium and Enterprise at USD 8, 12 and 16 per screen per month from 1 April 2026, or AUD 13, 18.50 and 25 (HELP 543957); Premium and Enterprise rose by USD 1. All screens in one account must be on the same plan. Discounts start above 50 screens, with custom quotes. Enterprise Plus is a custom quote. | **The published rates are annual rates; monthly billing "may incur slightly higher rates"** (HELP 456067, 456132). Annual plans include a free player per screen: the 1 GB unit is standard and the 4 GB unit costs USD 70 extra (a partner page says direct Premium includes 4 GB); excluding hardware only means "discounts may apply". Player list price USD 85 before shipping. The **refund** is a 30-day money-back on a purchased player, with a prepaid return label; no page ties it to annual subscriptions. Downgrades take effect at the next renewal with no mid-cycle credit (partner pages; INFERRED for direct customers). GST on Australian invoices and freight to Australia: UNKNOWN. |
| Failed payment (direct customers) | Recover a lapsed account. | After 5 days of failed charges, screens flash a red image for 2 minutes every 2 hours. After 2 weeks the account drops to Free and only the first screen stays active (HELP 456134). | Device Disabled for payment reasons needs the Success team. |
| Cancel and delete | Leave the service. | Cancel by reducing licences to one screen (zero is not allowed); this counts as cancellation. Deletion is a separate permanent request through the account compliance page after downgrading, or by e-mailing support (HELP 562252). | Deletion of inactive accounts after 365 days: OFFICIALLY DOCUMENTED (snippet only; no help article). Content-deletion lag and a formal subject-access channel: UNKNOWN. |
| Compliance and hosting | Answer tender questions. | Media is "securely hosted in Amazon Web Services (AWS) data centers located in Ireland (eu-west-1 region)" (HELP 456124); on-premises is not planned "within the next five years". GDPR and CCPA compliance are stated (HELP 884576). A third-party AI provider is a sub-processor for Magic Write (HELP 562276). | Playback-report CSVs appear to sit in us-east-1 (INFERRED from the spec's example URL). ISO 27001 and ISO 9001 certification, the DPA, the Data Privacy Framework notice, the sub-processor list with a Swedish location and the vulnerability disclosure policy rest on www.yodeck.com only (OFFICIALLY DOCUMENTED, snippet). No SOC 2 claim was found, but this absence was only checked at snippet level (UNKNOWN). No Australian region. |
| Get support | Resolve a problem. | In-app chat and e-mail, **24 hours a day, 5 days a week, on every plan including Free**; paid accounts are prioritised; an AI assistant around the clock; toll-free phone numbers including an Australian one (HELP 178348). | Seen from Australia, live chat opens Monday 1:00 pm AEST (3:00 pm AEDT) and the Australian phone line runs roughly 5:00 pm to 8:00 am AEST, mostly outside local business hours (INFERRED conversion). The "within 10 hours" first response and the Enterprise 24/5 and Enterprise Plus 24/7 tiers are not in the help centre; the page points to a separate SLA page that was not read (UNKNOWN). Support-mediated cases: lost Owner login, "Player Already Registered", partner staff permissions, content transfer between accounts, Device Disabled reactivation, splitting a workspace account into separate accounts. |
| Billing Entities | Invoice several legal entities under one account. | Available on Enterprise and Enterprise Plus with an annual, invoiced subscription; card-on-file accounts are excluded. Basic and Premium can buy a paid add-on with limited functions. Yodeck enables it on request (HELP 673179). | Steps not documented. |
| Partner programme | Resell or white-label. Partner Network membership. | Separate full customer accounts managed from the partner console. **10-screen minimum billed across the whole partner site.** Fees: **USD 50 one-off (Reseller), USD 450 a year (Whitelabel)**. Monthly pay-as-you-go invoice on the 1st; annual or multi-year prepay earns extra discounts. Resellers must charge the published price list; Whitelabel partners set their own prices (HELP 680806). | Partner-site billing counts the higher of quota and registered devices, less demo licences; demo accounts never expire. Dunning: warning at 45 days overdue, site disabled at 60, device warning at 75, screens disabled at 90 (HELP 841402). Moving to a partner site loses player preconfiguration; SSO must be rebuilt; content and hardware do not transfer. Discount percentages and margins: THIRD PARTY only. |
| Hardware care add-on | Recurring hardware revenue. | "Yodeck Assurance" (launched October 2025): USD 1 per player per month or USD 12 a year; lifetime warranty while subscribed, ship-first replacement, free two-way shipping (HELP 465480). | |
| Export data | Take data out. | Screens CSV export; audit log download (Enterprise; 90 days); the REST API (section 3.11), which third-party importers use to pull media, playlists, layouts, schedules and screens. | One-click full account export: UNKNOWN. |

**Errors and recovery:** adding a second screen ends the free benefit; an expired trial leaves one free screen with the rest disabled; a Workspace Screen Limit blocks new screens; failed payment escalates from a red flash to a drop to Free; partner sites are disabled at 60 days overdue; billing reductions wait for renewal; audit log purged at 90 days; service incidents on status.yodeck.com (a tracker logged a 12-minute partial outage on 30 September 2026, THIRD PARTY).

**Plan restriction or missing feature**

| Capability | Classification |
|---|---|
| More than one screen at no cost | Plan restriction |
| MCP agent, live-data apps, media filtering, sub-playlists, playback reports | Plan restriction (Premium and Enterprise); REST API tier not stated |
| Workspaces, per-workspace roles, Groups, Custom Roles, SSO, SCIM, audit log, security policies, player lock-down and encryption | Plan restriction (Enterprise) |
| Billing Entities | Enterprise and Enterprise Plus; limited paid add-on on Basic and Premium |
| 24/5 live support | All plans; paid accounts prioritised |
| Agency sub-accounts; self-serve partner roles; self-serve content move; self-serve player transfer | Missing; support-mediated |
| On-premises hosting; Australian data residency | Missing (cloud-only, EU-hosted media) |
| Audit retention beyond 90 days | Product limit |
| Per-screen access control | Missing (INFERRED) |

**Hardware-dependent or unverified:** free-player freight to Australia; how a purchased player's account lock is released; the role of the Swedish location; whether all customer data sits in eu-west-1.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Per-customer entitlement model where displays beyond quota become disabled, not deleted, and a lapse locks publishing but never blanks or flashes a public screen | MVP | Yodeck's red flash on lapse would be a safety and brand problem on an outdoor pylon (`research/round2/R6-commercial-model.md`, PROPOSED) |
| Licence states and a staged dunning timeline, with quota, registered devices and demo licences counted separately | MVP | Yodeck's partner billing rules are a first-party reference |
| Customer tenant with audited TINNOX staff access under B+ | MVP | Direct equivalent of the partner console, with consent added |
| Audit log export, 24 months searchable | MVP (basic) | Advertiser disputes and accountability; Yodeck keeps 90 days |
| Australian hosting (AWS Sydney primary, Melbourne disaster recovery) with a published data-location statement, DPA and sub-processor list | MVP | TINNOX Q9; Yodeck hosts media in Ireland with no Australian option (`research/round2/R3-au-hosting-compliance.md`) |
| Documented account deletion and export procedure | MVP (procedure), later (self-serve) | Yodeck's compliance page is a reference; tenders expect it |
| Local, business-hours support desk with a published first-response target | MVP (commercial) | Yodeck's live hours and phone line miss most Australian business hours |
| Hardware-care add-on with recurring billing | Later | Yodeck Assurance shows the pattern; fits TINNOX Q7 |
| Status page, ISO 27001, SSO | Later | Design logging and access control now so certification is reachable |
| Billing entities, white-label programme, free self-serve tier | Out of scope | TINNOX is hardware-led and sells under its own brand |

### 3.11 Cross-cutting: the Yodeck public API and integrations

**Confidence: high for the contract; wire behaviour untested.** Research files Y11 and Y11-supplement; round 2: `research/round2/R7-yodeck-api-spec.md` and `research/round2/AV2-registration-api.md`.

**The specification (VERIFIED_FULL_PAGE (spec)).** The OpenAPI 3.1.0 bundle "Yodeck API - Beta", version 2.0.0, is public at https://app.yodeck.com/api-docs/bundle.yaml. The copy read on 2026-11-03 is 676,299 bytes and 14,593 lines, with sha256 `65053d2d…6e31737` (truncated as recorded in R7). It has 55 paths, 110 operations and 17 tags. The full path list is in R7 section F1.

| Topic | What the spec says | Label |
|---|---|---|
| Base URL and auth | `https://app.yodeck.com/api/v2`; header `Authorization: Token <label>:<token_value>`; the token acts as a user with a role and is shown once. | VERIFIED_FULL_PAGE (spec) |
| Rate limits | Rolling 10-second window, per token and per account: Low 14/42, Standard 21/63, High 33/99. 106 operations are standard, 2 (emergency-alert reads) high, 2 unlabelled, none low. A throttled call gets 429 with no body and `Retry-After` in seconds. No plan dependence is stated. | VERIFIED_FULL_PAGE (spec) |
| Paging and errors | `limit` (default 100, but 10 on `/screens`) and `offset`; envelope `count`, `next`, `previous`, `results`; the `next` example uses `?page=2`, inconsistent with limit and offset. Errors are wrapped as `{"error": {code, message, details, timestamp}}` with codes such as `err_1001` (400), `auth_1001` (401), `err_1004` (404), `err_1000` (500). Bulk updates roll back entirely on any failure. | VERIFIED_FULL_PAGE (spec) |
| Filters | Common: `q`, `workspace`, `parent_folder`, `ids`, `ordering`, `tags`, `exclude_tags`, dates with `__gte` and `__lte` in ISO 8601 without an offset. Screens add `subset` (nine groups), `online`, `registered`. Playlists have no workspace filter. | VERIFIED_FULL_PAGE (spec) |
| Webhooks | Six topics: 1 Media, 2 Playlist, 3 Layout, 4 Schedule, 5 Screen, 6 User, each for create, update and delete. HMAC-SHA256 signature in `x-signage-signature`, key shown once. Registration: pending, then a validation handshake of 3 POSTs (2 bad signatures that must get 401, 1 good that must get 2xx), then active. HTTPS on port 443, answer within 5 s, no cookies, re-validation every 90 days, optional workspace filter, global-admin API tokens only. **No topics for online or offline, push completed, media finished or playback.** The delivery `events[]` element schema, signature encoding, retry schedule and auto-disable threshold are not documented. | VERIFIED_FULL_PAGE (spec) |
| Screens and push | Screen schema with nine opt-in subsets, including `player_status` health fields; single push synchronous; bulk push asynchronous with a fixed status URL and no job ID; takeover for one or many screens; screenshot refresh for one or many screens. **No reboot, shutdown, CEC, log or command endpoint.** | VERIFIED_FULL_PAGE (spec) |
| Content | Media CRUD and the five-state upload flow; media tags; apps and 22 app templates; folders (read and delete only); playlists, tag-based playlists, layouts, schedules with event exceptions. | VERIFIED_FULL_PAGE (spec) |
| Emergency alerts | List alerts, list broadcast groups (tag-based), broadcast, cancel one or all. Alert definitions cannot be created. No CAP field. | VERIFIED_FULL_PAGE (spec) |
| Users, roles, groups, workspaces | `/users`, `/roles`, `/groups` (with `manage-members`) and `/workspaces`, full CRUD. Roles and Groups require the Workspaces feature; Premium accounts cannot use the Roles resource. Users carry a language and a `time_zone` and `time_subzone` pair. | VERIFIED_FULL_PAGE (spec) |
| Playback reports | `GET /account/playback-reports` returns CSV download links valid for 2 hours. The CSV columns are documented in the help centre, not the spec (section 3.8). | VERIFIED_FULL_PAGE (spec, HELP 455928) |
| Partner and audit | No partner, Support Login, impersonation or audit-log endpoint. | VERIFIED_FULL_PAGE (spec, absence) |
| Quirks | Takeover examples use a Greek capital Zeta instead of `Z`; availability examples end in `Z` while the text says no time zone; the operationId `getPustStatus` is misspelt; the Webhooks text links to a `bulkValidateWebhooks` operation that does not exist; `player_status.ram` has the field `availabe`. | VERIFIED_FULL_PAGE (spec) |

**Around the specification (VERIFIED_FULL_PAGE unless marked):** the help centre's REST API announcement (HELP 456025) carries no date and no "phases" wording; the round-1 "released in phases from September 2024" is OFFICIALLY DOCUMENTED (snippet only). The REST API's plan tier is not stated in the spec or the help centre; MCP is Premium and Enterprise at no extra charge (HELP 884576). The AI Agent and MCP guide gives `https://mcp.yodeck.com/mcp`, OAuth 2.1 within the user's role, API-token fallback, **delete operations disabled through MCP**, and common AI-assistant and code-editor clients. The local Player HTTP API on `localhost:9999` binds to localhost only and offers device identity routes, proxying, caching and app storage with a per-app token (HELP 456441); a GPIO HTTP API sits under the same port (HELP 456056). SCIM guides cover Entra ID, Okta and OneLogin. No Zapier, Make or Power Automate connector appears in the corpus.

**Still THIRD PARTY:** live wire behaviour reported by integrators (single push answering `completed`, the spec drifting from the live API); a hosted MCP server with about 53 tools; the reboot path, which matches a self-described "modeled" third-party OpenAPI file.

**Still unknown:** the webhook delivery payload, signature encoding and retry policy; the formats of `download_timeslots` and `schedule_reboot`; whether a trailing `Z` on availability datetimes is ignored or rejected; the allowed values of `monitor_rotation` and region `fit`; how concurrent bulk pushes behave; the REST API plan tier; official SDKs or a Postman collection.

**Relevance to TINNOX:** role-scoped tokens shown once (MVP); a versioned REST API with a consistent paging envelope, structured errors including a JSON 429 body, and published numeric limits per token and per tenant with `Retry-After` (MVP for read endpoints, later for full CRUD); screen status as an enum, screenshot, reboot, display power and push as jobs with IDs and per-display results (MVP; Yodeck has no job ID and no reboot endpoint); the pre-signed upload flow with originals kept (MVP); signed outbound webhooks that copy Yodeck's strong parts (HMAC-SHA256, key shown once, a validation handshake with negative tests, sequence numbers, re-validation) and add a documented event schema, a retry and backoff policy, a timestamped signature against replay, and device topics (later; R7 proposal P5); takeover and broadcast endpoints (MVP single screen, later groups); validated enums for rotation and fit (MVP); a local player HTTP API for on-device apps (later); SAML with a break-glass local login (later); an MCP server (later); no-code connectors and a partner API domain (out of scope). All PROPOSED.

## 4. Cross-cutting findings

### 4.1 Australian time zones and daylight saving

- **What Yodeck documents (VERIFIED_FULL_PAGE):** a per-screen time zone chosen by city, country or UTC/GMT offset; schedules and working hours run in the screen's local zone; event `start` and `end` and media availability timestamps carry no offset and are "interpreted based on the screen's location"; the API stores the zone as `basic.time_zone` plus `basic.time_subzone`, defaulting to Etc/UTC; the Australia area lists 23 subzones; the 23 include canonical cities such as Eucla, Lord_Howe and Broken_Hill and also legacy aliases such as ACT, NSW, Victoria, LHI and Yancowinna; the Date and Time app lists the same names as `Australia/*` IANA IDs and bundles moment-timezone data; players sync time by NTP with a per-screen custom NTP field; playback reports are generated in Etc/UTC.
- **What Yodeck does not document:** daylight-saving behaviour. "Daylight", "DST" and "summer time" return 0 hits across 656 help articles and the spec. The offset labels are a fixed summer snapshot (Melbourne "UTC+11"), wrong for about half the year. The spec's examples put a `Z` on timestamps that the text calls offset-free. Android cannot take a time zone or NTP setting from Yodeck at all; the Web Player and Fire OS have no Time zone field. Events in the missing or repeated DST hour: UNKNOWN.
- **Consequence for TINNOX:** the spec's scheduling semantics (`docs/tinnox-mvp-spec.md` section 11) and the time-zone acceptance tests (SCH-01 to SCH-11 in `docs/acceptance-tests.md`) must be designed from first principles using the Australian rules in the research file A03, not from Yodeck. TINNOX should show canonical IANA zones only, compute offsets per date, accept aliases on input only and store the canonical name, reject `Etc/*`, and own the zone and NTP on every player type including Android (PROPOSED; `research/round2/R7-yodeck-api-spec.md` P1 and P2). Release 1 is Australia only (TINNOX Q6); New Zealand is a later data change. The open question Y8 in `docs/open-questions.md` stays open for an authenticated session (section 8).

### 4.2 Portrait and custom-resolution LED canvases

- **Official (VERIFIED_FULL_PAGE):** the layout editor accepts free custom ratios in pixels up to 4096 per side; layout regions are absolute pixel rectangles; LED displays "just use the top-left corner of the input"; the documented LED workflow forces a standard output ("DVI resolution") and disables the unused right and bottom pixels through overscan, with worked examples; the API stores overscan as a four-number string and output resolution as an X11 modeline; portrait is two UI rotations plus a two-push sequence with 9:16 layouts on a 16:9 output; an official video-wall article names "upside-down" as a player setting; fit modes are Fill, Fit and Stretch with video crop margins; Yodeck claims "hundreds of production-grade LED billboards".
- **Absent:** no help article and no spec line mentions Huidu, NovaStar, Colorlight or Linsn. Yodeck has no controller integration: no brightness control, no receiving-card monitoring, no sensors.
- **Unverified:** the overscan parameter strings (images on the help page), whether offsets other than top-left are possible, 180-degree rotation per player type, and how a specific sending card (NovaStar, Huidu) negotiates the forced mode. These are HARDWARE-DEPENDENT and belong to the real-hardware validation track in `docs/architecture-and-hardware.md` (section 6).
- **Consequence for TINNOX:** the canvas profile and output-mode model in the spec (section 5 domain model, sections 6.5 and 6.6) should match the documented Yodeck controls while modelling the content window (offset plus size) natively, validating rotation and output as integers, and adding the controller integration Yodeck lacks for Huidu and NovaStar (`research/round2/R1-huidu-integration.md`).

### 4.3 Free and paid plan restrictions

Best-corroborated topic, now read in full. Trial: 30 days on up to five screens, running on the Enterprise plan, for sign-ups from 2 March 2026. Free: one Basic screen while the account has exactly one screen, all Basic features, unlimited storage and users, no card; some Enterprise pages still say Enterprise is free on one screen. Basic, Premium, Enterprise at USD 8, 12, 16 (AUD 13, 18.50, 25) per screen per month; these are annual rates and monthly billing may cost slightly more. Premium adds the MCP agent, sub-playlists, tag-based playlists, media filtering, weekly availability slots, CSV playlist import, live-data apps and playback reports. Enterprise adds workspaces, custom roles, SSO, SCIM, audit log, security policies, lock-down, encryption, Branded Templates, Content Flow and Billing Entities. 24/5 live support is on every plan. Magic Layout is free at launch. Residual unknowns: the REST API tier, the emergency-alert tier, the cloud-connection cap, GST and minimum terms.

### 4.4 Account restrictions versus missing features, summary

| Missing at every tier (no evidence found) | Plan-gated (documented) |
|---|---|
| Screen groups or folders; per-screen permissions | Workspaces and Move (Enterprise) |
| Per-screen download progress in bytes (bulk push reports a screen-count percentage only) | Playback reports (Premium and Enterprise) |
| Per-item playlist availability | Sub-playlists, tag-based playlists, weekly availability, media filtering (Premium) |
| Scheduled publishing (beyond download hours); job-scoped push status | MCP agent, live-data apps (Premium); REST API tier not stated |
| Update rollback, staged rollout or maintenance windows | Custom Roles, SSO, SCIM, audit log, policies, lock-down, encryption (Enterprise) |
| Device-event webhooks (online, offline, push completed, media finished); reboot endpoint in the public API; Zapier connector | Per-display composition through Content Flow (Enterprise) |
| Australian hosting; on-premises; soft delete of a Workspace's content | Billing Entities (Enterprise; limited add-on below) |
| Customer-visible record of partner support logins (INFERRED absent); remote time zone on Android | Emergency alerts (tier unknown) |

## 5. Contradictions register

Condensed from the critic file Y99, the supplementary passes and round 2 (`research/round2/R99-critic.md` section 1B, row D17). Rows C1 to C20 are the round-1 register with their round-2 status. Rows C21 onwards are new in round 2. The full spec-versus-audit comparison, X1 to X26, is in `research/round2/R7-yodeck-api-spec.md` section F10.

| # | Topic | Resolution |
|---|---|---|
| C1 | Offline window | Resolved: at least 30 to 35 days (HELP 456183), stop between 30 and 40 days (HELP 456208), warning three days before; the general Pi guide says up to 45 days or more, not only Android. The round-1 decision to drop "35 days" is reversed |
| C2 | API reboot endpoint | Resolved: no reboot endpoint in the public spec; reboot exists only as `schedule_reboot` and in the UI. The third-party path matches a self-described "modeled" OpenAPI file (R7 X5) |
| C3 | Rate limits | Resolved: official Low 14/42, Standard 21/63, High 33/99 per 10 s, per token and per account (R7 X2) |
| C4 | Custom Roles tier | Resolved: Enterprise (HELP 455896) |
| C5 | Availability datetime zone | Resolved in the spec text: offset-free, read in the screen's zone. The spec's own examples end in `Z`; whether the server ignores it is untested (R7 X7) |
| C6 | Screen time-zone API format | Resolved: `time_zone` plus `time_subzone` pair; 23 Australian subzones exist (R7 X6) |
| C7 | Transitions | Resolved: 23 named types plus `random` in the spec; help pages say "more than 23" and "25" |
| C8 | Windows and 180-degree rotation | Narrowed: no Windows rotation statement exists; webOS cannot do 180; an official video-wall article names "upside-down"; the API documents no 180 value |
| C9 | On-demand screenshot | Resolved: official refresh-screenshot endpoints for one or many screens; "Capturing screenshot..." means a capture is running |
| C10 | Screen groups | Confirmed: none documented; the API groups resource is user groups; tag-based broadcast groups exist for alerts |
| C11 | Free-plan user count | Resolved: unlimited users on every plan |
| C12 | Monthly versus annual pricing | Reopened and resolved the other way: published rates are annual; monthly "may incur slightly higher rates" |
| C13 | Emergency alert gating | Open: tier unnamed in the help centre and the spec |
| C14 | Dashboard counts source | Resolved: HELP 455858 |
| C15 | App catalogue size | Third party 80 to 90 plus; the spec lists 22 app templates |
| C16 | Pi 5 status | Resolved: the Pi 5 image is in Beta (HELP 456103); the limitation is lag with more than one dynamic zone, not "no multi-zone"; the Pi 4 is still recommended |
| C17 | Windows player beta registration | Resolved: the "Beta, manual registration" wording is in no help article; self-serve W-code registration is current |
| C18 | Playback reports sources | Resolved: HELP 455928 and the spec endpoint |
| C19 | Entries versus Events List | Resolved: "Events List" is current |
| C20 | Second-hand official rows | Superseded: round 2 read the help centre and the spec in full |
| C21 | Workspace deletion | Refuted: content is permanently deleted and only screens move out; no "Default Workspace" exists in the help centre (HELP 669482) |
| C22 | Support tiers | Corrected: 24/5 live support on every plan; Enterprise 24/5, Enterprise Plus 24/7 and the 10-hour response are not in the help centre |
| C23 | Registration code length and prefixes | Corrected: on-screen 8 digits for the Pi, 9 for most players, W plus 8 for Windows standard; the spec requires 9 digits with 0 for the Pi; Fire OS is 7 and 8 is Android Play Store. The Windows guide still says "9-digit" (open) |
| C24 | Android time zone | Open inside Yodeck: Basic Info lists a Time zone field for Android; Android Limitations says it "can't be set from Yodeck yet" |
| C25 | Restart or resume after a priority event | Open inside Yodeck: Schedules Introduction says restart from item 1 with no resume point; Prioritization Scenario 2 says "resumes" |
| C26 | Ticker direction | Open inside Yodeck: the same page describes right to left and calls Left to Right the default |
| C27 | Screenshot cadence | Open inside Yodeck: 30 s and 2 h (Screens Overview), 30 to 40 s and 1 h (preview FAQ), "depends on your plan" (screen messages) |
| C28 | Playback reports plan and retention | Plan resolved: Premium and Enterprise; the spec's "Pro" is stale. Retention open: "not deleted" and "up to 3 months" on the same page |
| C29 | Free screen plan | Open inside Yodeck: "one free Basic screen" against Enterprise pages saying Enterprise "is free if you only manage one screen" |
| C30 | Custom Roles and User Management | Open: the help article lists it; the spec says it is "not applicable to Custom Roles" |
| C31 | Per-screen alert recipients | Resolved as far as documents allow: the UI limits recipients to Device Manager users; external addresses appear only in an API example (UNVERIFIED) (R99 C11) |
| C32 | Content states | Corrected: six states, adding Pending Media; "might not be downloaded" and "Content not updated" appear in no article |
| C33 | Accepted formats | Open: the help centre accepts gif, webp and aac; the spec's local lists omit them (R7 X18) |
| C34 | Video re-encoding | Narrowed: three full pages say all uploads are re-encoded, with a per-upload skip option; the "repackaged in about 30 seconds" release note is not in the help corpus. Images: "not resized" (manual) against cropped above native resolution (webOS guide) |
| C35 | Webhooks | Refuted round-1 claim: six resource topics, not user events only; device-event topics are still missing (R7 X3, X4) |
| C36 | API specification access | Refuted round-1 claim: the spec is public and was read in full (R7 X1) |

## 6. What the research passes changed

### 6.1 Supplementary pass (round 1)

Per area, the main upgrades from UNKNOWN or THIRD PARTY to OFFICIALLY DOCUMENTED (snippet). Several of these were corrected again in round 2 (section 6.2).

- **Media:** 5 GB file limit; unlimited storage; formats; H.264 and AAC target; documents converted to PDF with per-page durations; cloud imports and live cloud playlists; stock libraries and Canva; availability evaluated in the player's zone; weekly slots Premium-gated.
- **Playlists:** fixed video duration in the UI; per-media default durations; image-only transitions; sub-playlist seconds limit and skip rule; tag logic (AND within a line, OR across lines, exclude list); audio-only playlists; black-gap and keep-web-pages options; "no limits" statement.
- **Layouts:** Fill, Fit, Stretch; crop margins; layout-wide background colour; custom ratios up to 4096 px; top-left LED mapping with worked examples; two-push portrait sequence; no auto-conversion on ratio change; Magic Layout; Preview pop-up; video wall mechanics; ticker is an app.
- **Scheduling:** drag-ordered precedence and the "Events List" name; the full content-type priority order; recurrence list and Repeat Until; takeover durations and Stop button; emergency alerts wizard, tag groups, CAP; working hours black-image fallback and special dates; download hours as Timed Events; preview of schedules; NTP auto-sync. DST remained undocumented.
- **Publishing:** content states with definitions; orange-to-black button; force push; "Push again to this Screen"; up to three minutes per push; bandwidth budget; no bytes or percent by design.
- **Monitoring:** screenshot cadence; Reboot Player, Shutdown and CEC actions in the UI; offline-alert wait-time ladder; Status tab and Refresh; TV Status and Power Supply columns refreshed hourly; playback reports; support remote-access port.
- **Offline and updates:** 30 to 40 day window with mechanism; firewall allow-list; NTP behaviour; captive portals unsupported; proxy options; Encrypt Player Storage details; update duration; "No Space Left"; reflash retains settings. Rollback remained undocumented.
- **Administration:** Custom Roles tier; unlimited users; AUD prices; current Windows registration; privacy, DPA, sub-processors, vulnerability policy; AWS Ireland hosting, ISO 27001 and 9001, no SOC 2; cancellation and deletion procedure; support hours and Australian phone number; invitation expiry; 2FA on all plans (inferred); eight standard roles and the Custom Role permission rows.
- **API and registration:** REST intro article and token page; MCP guide with OAuth 2.1; July 2025 API additions; Player HTTP API on port 9999 and a GPIO API; SCIM identifier URL; "Device Disabled" is a subscription state; Move between workspaces; the 9-digit code player list; no Zapier connector.

### 6.2 Round-2 full-page verification (AV1 to AV5, R7)

Checked against 656 full help articles and the full public specification, with 0 web searches in AV1 to AV5. The authenticated UI was still not observed.

| Note | Audit sections | Claims | Confirmed | Corrected | Refuted | Still unknown |
|---|---|---|---|---|---|---|
| `research/round2/AV1-accounts-admin.md` | 3.1, 3.10 | 46 | 30 | 12 | 1 | 3 |
| `research/round2/AV2-registration-api.md` | 3.2, 3.11, 4.3 | 64 | 38 | 17 | 7 | 2 |
| `research/round2/AV3-media-playlists.md` | 3.3, 3.4 | 54 | 33 | 14 | 3 | 4 |
| `research/round2/AV4-layouts-scheduling.md` | 3.5, 3.6, 4.1, 4.2 | 61 | 42 | 12 | 1 | 6 |
| `research/round2/AV5-publish-monitor-offline.md` | 3.7, 3.8, 3.9 | 87 | 43 | 27 | 12 | 5 |
| Total | | 312 | 186 | 82 | 24 | 20 |

`research/round2/R7-yodeck-api-spec.md` extracted all 110 operations and listed 26 contradictions with this document (X1 to X26). Its own adversarial pass checked 25 claims: 22 confirmed, 3 corrected (labels and provenance only).

Main changes by area:

- **Accounts:** workspace deletion destroys content (refuted); one role per user on every plan; customer audit log has seven columns; eight partner staff permissions with Support Login on by default; invitations can be resent; Screen Content has no Delete permission.
- **Registration:** full prefix table (Fire OS is 7, Android Play Store 8, ChromeOS 9, Embeddable Feeds 10); 9-digit API code; factory pre-provisioning with a 5-hour window; Android cannot take time zone, NTP, network or resolution settings; Web Player and Fire OS have no time zone field.
- **Media and playlists:** five upload states spec-verified; all uploads re-encoded; weekdays as a 7-character string; 23 transitions plus random; tag-based order alphabetical; "plays at least once" and the 200-slide cap dropped; nesting allowed; "Enable video original" is a partner field.
- **Layouts and scheduling:** zone pair with 23 Australian subzones and summer-offset labels; floating local times; DST 0 mentions; integer priority, higher wins; "After N occurrences" and Turn Screen Off official; restart from item 1 with no resume point; Magic Layout free at launch; Pi 5 limit is dynamic-zone lag.
- **Publishing, monitoring, offline:** six content states; push status account-level with no job ID; no reboot endpoint; full Status field list and `player_status`; per-screen recipients; playback CSV columns; update cadence every 6 weeks; cached playback after 2 minutes; offline 30 to 35 days official; schedule file reissued every 30 days; support VPN on 24/7; Pi thermal icons at 80 to 85 °C; Debian 10 base image.
- **Administration:** 24/5 support on every plan; published rates are annual; partner fees and dunning first-party; failed-payment red flash; Billing Entities on Enterprise and Enterprise Plus; media in AWS eu-west-1 (help-stated); Yodeck Assurance add-on.
- **API:** the spec is public; official rate limits; six webhook topics with HMAC-SHA256 and a validation handshake; full paths for users, roles, groups and workspaces; Playback Reports API shipped.

## 7. Evidence index

### 7.1 Research files

**Round 1 (session scratch area, not committed).** Directory: the session scratch area's `research/` folder (not committed). Each first-pass file has a Summary, Workflow as documented, Findings table with a label and URL per row, Errors, Plan restrictions, Hardware-dependent items, Relevance, Search log, Gaps and a Verification (adversarial pass) section. Each supplement has a Summary, New or corrected findings, Contradictions, Still unknown and a Search log.

| File | Area | Search calls (first pass) | Official pages (supplement) |
|---|---|---|---|
| Y01-accounts-roles.md | 3.1 | 42 | covered by Y10-supplement |
| Y02-screen-registration.md | 3.2 | 58 | covered by Y11-supplement |
| Y03-media.md, Y03-media-supplement.md | 3.3 | 0 (GitHub only) | 62 |
| Y04-playlists.md, -supplement.md | 3.4 | 0 | 25 |
| Y05-layouts.md, -supplement.md | 3.5 | 0 | 45 |
| Y06-scheduling.md, -supplement.md | 3.6 | 0 | 25 |
| Y07-publishing.md, -supplement.md | 3.7 | 0 | 17 |
| Y08-monitoring.md, -supplement.md | 3.8 | 0 | 18 |
| Y09-offline-updates.md, -supplement.md | 3.9 | 0 | 38 |
| Y10-admin-support.md, -supplement.md | 3.10, 3.1 | 0 | 19 |
| Y11-api-integrations.md, -supplement.md | 3.11, 3.2 | 0 | 30 |
| Y99-critic-gaps.md | all | 0 | 90 gaps, 20 contradictions, confidence table |
| A03-australian-timezones-scheduling.md | 4.1 | see file | Australian DST rules and RFC 5545 semantics |
| H01, H02, A01, A04, T01 | other deliverables | see files | hardware, Xibo, stack, TINNOX context |

Workflow run identifier: `wf_7ce6f2aa-ad5` (23 agents, 1114 tool calls); the per-agent journal is in the session's workflow directory.

**Round 2 (committed under `docs/research/round2/`).** Each note lists confirmed, corrected and refuted claims with help article IDs or spec line numbers, and the R notes end with a Verification (adversarial pass) section.

| File | Area | Evidence base |
|---|---|---|
| `research/round2/AV1-accounts-admin.md` | 3.1, 3.10 | Full help articles and the spec |
| `research/round2/AV2-registration-api.md` | 3.2, 3.11, 4.3 | Full help articles and the spec |
| `research/round2/AV3-media-playlists.md` | 3.3, 3.4 | Full help articles and the spec |
| `research/round2/AV4-layouts-scheduling.md` | 3.5, 3.6, 4.1, 4.2 | Full help articles and the spec |
| `research/round2/AV5-publish-monitor-offline.md` | 3.7, 3.8, 3.9 | Full help articles and the spec |
| `research/round2/R7-yodeck-api-spec.md` | 3.11 and all API rows | The spec parsed in full; F10 lists X1 to X26 |
| `research/round2/R99-critic.md` | all | Impact list applied in this revision (section 2.2, row D17) |
| `research/round2/R1-huidu-integration.md`, `R2-support-access-models.md`, `R3-au-hosting-compliance.md`, `R4-player-hardware-recommendation.md`, `R6-commercial-model.md` | TINNOX relevance rows | Cited where a relevance row depends on a TINNOX decision |

**Round-2 corpus.** Help centre: 656 full article texts, fetched 2026-11-03, local copy in the session scratch area (`web/art/`), not committed. Specification: https://app.yodeck.com/api-docs/bundle.yaml, "Yodeck API - Beta" 2.0.0, OpenAPI 3.1.0, 676,299 bytes, 14,593 lines, sha256 `65053d2d…6e31737` (the hash is truncated as recorded in R7; the full value is in the R7 working files), local copy `web/probe-api-docs_bundle.yaml` in the session scratch area.

### 7.2 Official Yodeck pages by area (abbreviations: HELP = help.yodeck.com/en/articles/, DOCS = www.yodeck.com/docs/, WWW = www.yodeck.com/)

Only the pages most load-bearing for the findings above are listed. Round-1 rows are snippet-level; the round-2 rows were read in full.

- **3.1 Accounts:** HELP 455907-users; 422752 ownership change; 669486 and 456245 workspaces introduction; 669485 organize workspaces; 669482 workspaces troubleshooting; 423013 groups; 456199 user roles; 423192 and 455826 security policies; 455831 SAML; 455976 SCIM with Okta; 455824 audit log; 456241 partner console; 455945 partner FAQ; 673179 billing entities; DOCS user-manual/user-permissions-for-screens/ (Custom Roles); user-manual/users/; user-manual/audit-log/; partner-manual/staff-permission-roles/; partner-manual/audit-logs/; WWW academy/api-token/; release-notes/yodeck-updates-april-2025/. Round 2: HELP 455907, 456205, 455895, 669482, 669484, 669485, 669486, 455896, 455959, 455826, 456244, 456125, 455976, 841362, 455824, 455842, 455854, 455873, 456037.
- **3.2 Registration:** DOCS user-manual/screen-registration-yodeck/; yodeck-registration-code/; raspberry-pi-compatibility/; raspberry-pi-5-limitations/; setting-up-a-windows-player-with-the-yodeck-software/; setting-up-a-tizen-player-with-the-yodeck-software/; lg-webos-player-troubleshooting/; setting-up-a-yodeck-web-player/; monitor-basic-info/; monitors-table-manual/; screens-overview-introduction/; HELP 224961 device disabled; 661682 Windows player; 713000 Windows troubleshooting; WWW academy/yodeck-player/. Round 2: HELP 682888, 654056, 887679, 456187, 455921, 456043, 455952, 629086, 455948, 712994, 455937, 456254, 455844, 455849, 455866, 455837, 455878, 455893, 455835, 455874, 456074, 456024, 456103.
- **3.3 Media:** DOCS user-manual/media-overview-2/; images-introduction/; videos-introduction/; bypassing-video-re-encoding-as-is-upload/; file-size-limitation-on-the-yodeck-portal/; supported-file-extensions/; documents-on-screen/; media-availability/; media-filtering/; live-video-streaming-support/; web-pages-introduction/; html-widget-packaging/; HELP 169245 audio formats; WWW academy/youtube-vimeo-videos/. Round 2: HELP 456038, 456065, 456267, 456202, 456287, 456178, 456258, 871934, 455917, 456172, 456257, 455854, 456180, 455856, 456171, 456186, 517933, 456176, 456256, 455943, 456281, 455950, 456409, 456126, 769385.
- **3.4 Playlists:** HELP 456318 playlists introduction; 181531 create a playlist; 165053 transition effects; 702723 sub-playlist playback; 423063 and 455920 sub-playlists; 181527 tag-based playlist; 455917 audio assets; 456271 background audio; 456323 playlist of layouts; WWW release-notes/random-playback-for-playlists/. Round 2: HELP 456318, 455906, 456323, 456301, 702723, 682152, 456271, 455815.
- **3.5 Layouts:** HELP 456268 layout editor getting started; 456284 screen sizes and aspect ratios; 456104 custom ratio; 169258 outdoor LED billboards; 456216 portrait; 456250 sound and display; 456165 and 601510 video walls; 455897 ticker; 423015 webOS limitations; 456024 Pi 5 limitations; DOCS user-manual/does-yodeck-support-outdoor-led-billboards/; magic-layout-design-layouts-with-ai/; branded-templates-layout-editor/. Round 2: HELP 456284, 629090, 456268, 611479, 456297, 776362, 456216, 601510, 455956, 455953, 455837, 456149, 456250, 456024, 456103, 461003, 455897, 456193.
- **3.6 Scheduling:** HELP 456255 schedules introduction; 455875 timed events; 456030 screen takeover; 455900 emergency alerts; 456411 date and time; DOCS user-manual/yodeck-content-prioritization/; working-hours/; yodeck-ntp-server-configuration/; WWW release-notes/cap-support-for-emergency-alerts-is-here/; release-notes/yodeck-updates-september-2024/. Round 2: HELP 456255, 456058, 589509, 455844, 455948, 456270, 456411, 456347, 482103, 456026, 456032, 456030, 456243, 455875, 455922, 455928.
- **3.7 Publishing:** HELP 456278 pushing changes; 455885 screens overview; 455893 status; 455858 dashboard; 455972 screens table; 757879 screen messages; 176545 no space left; 169244 bandwidth; WWW release-notes/content-status-reports/. Round 2: HELP 456278, 830976, 455875, 455913, 455907, 456254, 455893, 455858, 456126, 456120, 757879, 456162.
- **3.8 Monitoring:** HELP 455928 playback reports; 455858 dashboard; 455972 screens table; 455866 static IPs; DOCS how-to-articles/screen-email-notifications/. Round 2: HELP 455972, 455893, 456051, 456120, 757879, 456024, 456254, 455875, 455871, 455913, 455928, 456032, 455963.
- **3.9 Offline and updates:** HELP 166303 does Yodeck work offline; 482103 NTP; 169938 reflash; 455942 boot logo; 423110 and 455874 encrypt player storage; 455836 per-page proxy; 712985 Android troubleshooting; 712994 webOS troubleshooting; 712998 Tizen troubleshooting; DOCS user-manual/i-have-a-restricted-network-which-ports-do-i-need-to-whitelist-for-the-yodeck-players; configure-rtc-ds3231/; does-the-yodeck-player-support-connecting-through-an-http-proxy/. Round 2: HELP 456208, 456183, 455913, 455936, 455837, 455942, 830986, 830976, 456123, 712986, 455933, 482103, 456187, 456264, 456078, 455918, 461003, 455874, 654056, 830975, 456079.
- **3.10 Administration:** WWW pricing/; contact/; privacy-policy/; subprocessors/; vulnerability-policy/; terms-of-service/; dpa.pdf; dpf.pdf; release-notes/yodeck-awarded-iso-certification/; HELP 456128 how is Yodeck priced; 543957 pricing update 2026; DOCS user-manual/free-period/; canceling-your-subscription-and-deleting-your-account/; what-about-customer-support/; do-you-have-an-on-premise-solution/; partner-manual/yodeck-partner-network-faq/. Round 2: HELP 589475, 456128, 543957, 456066, 456067, 456132, 461003, 456071, 841402, 680806, 680807, 562252, 456124, 884576, 562276, 178348, 673179, 456134, 465480, 456218.
- **3.11 API:** https://app.yodeck.com/api-docs/bundle.yaml (read in full); HELP 204549 REST API introduction; 456025 REST API announcement; 884576 MCP installation guide; 456441 Player HTTP API; 456056 GPIO HTTP API; DOCS user-manual/how-to-configure-scim-with-okta/; how-to-configure-scim-with-onelogin/; WWW academy/api-token/; features/yodeck-api/; release-notes/yodeck-updates-july-2025/.

### 7.3 Third-party sources (GitHub, consulted as code or documents; counts are citations across the round-1 research files)

Bitfocus Companion module for Yodeck (philon-/companion-module-yodeck, 58; push, takeover, alerts, exceptions, error shapes); ScreenTinker importer (screentinker/screentinker, 32; media, playlists, layouts, schedules, originals not returned); screenrig CLI importer (screenrig/cli, 30; fixtures for layouts, regions, time zones); BOTGC .NET publisher (botgc-comms/Miscelaneous, 20; upload flow, availability validation, push recovery); Home Assistant integration (pturner1989/ha-yodeck, 19; status, screenshot, reboot, power); C# SDK (cpettit/Yodeck_SDK, 15; models); Wobot cms-playground (12; refresh-screenshot); Screenly Anthias importer (10); IdenWorks scim-tax record (9; bundle quotes, pricing, roles); go-yodeck and terraform-provider-yodeck (easylo, 9); API Evangelist profiles (10; self-described as modelled, not authoritative; probable source of the third-party reboot path); yobot manual copy (6); mwm-sales-agent (6; partner API domain); EasyAD competitive review (5); born2net pricing datasets (4); Vennusign memo (3); flexible-rss-yodeck (3); Microsoft Entra tutorial (2); others with one or two citations as listed in the research files. Reviewer and competitor pages (rfp.wiki, Capterra, GetApp, ScreenTinker comparisons, Anthias comparison tables) are cited only where labelled THIRD PARTY. In round 2 most third-party API facts were re-labelled VERIFIED_FULL_PAGE (spec).

### 7.4 REA evidence (from the pilot in `docs/rea-evaluation.md`)

REA 6.8.0 was piloted on a synthetic loopback page, never on Yodeck. Evidence identifiers: `ev_ab999bb7…` (targets), `ev_06fa1c99…` and `ev_b66f1494…` (inspect), `ev_a84bf1c6…` (observe), `ev_b8dd1d1e…` and `ev_23673dcc…` (screenshot artefacts), `ev_9e55ffed…` (screenshot comparison), `ev_18b2394c…` (bundle). JSON files are in the session scratch area under `rea-pilot/out/`. No REA evidence exists for any Yodeck page. Reading the public help centre and the public spec in round 2 did not use REA.

## 8. What an authenticated, read-only session should capture

Round 2 settled most of the earlier list from full help articles and the public spec. The items below are still UNKNOWN and can only be settled by observing the authenticated UI or a test player. Each would turn a documented or inferred finding into an observed one. The read-only policy in `docs/open-questions.md` section 3 applies: no publishing, schedule changes, reboots, deletions, invitations, billing or account-wide settings outside a designated test workspace and test player.

1. **DST behaviour:** a schedule event spanning 4 April 2027 02:00 to 03:00 (the repeated hour) and one spanning 3 October 2027 02:00 to 03:00 (the missing hour) in Australia/Melbourne, observed in the schedule preview and on the test player (sections 3.6 and 4.1; open question Y8).
2. **Zone picker UI:** Screen, Basic, Time zone: whether it shows exactly the 23 spec subzones including the aliases, and which offset labels it shows in winter (section 4.1).
3. **Android time-zone field:** on an Android test screen, whether the Basic tab's Time zone field exists, is greyed out or is ignored (C24).
4. **Download-hours format:** Screen, Timed Events: the scope, format and default of download hours and of the scheduled reboot, and how they read back as `download_timeslots` and `schedule_reboot` (sections 3.6 and 3.11).
5. **Webhook payload and retries:** in the designated test workspace only, the shape of one delivered `events[]` element, the signature encoding and the retry behaviour after a failed delivery. Record shapes only; do not replay captured requests (section 3.11).
6. **Partner Support Login visibility:** if TINNOX holds a partner account, whether a Support Login appears in the customer account's own audit log (section 3.1).

Other UNKNOWN items (heartbeat interval and offline threshold, auto-delivery of a missed push on reconnect, the swap moment, update staging and rollback, screenshot retention) need a test player and time, not a UI session. They are tracked in the area sections and in `docs/open-questions.md`.
