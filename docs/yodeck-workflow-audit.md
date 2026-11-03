# Yodeck workflow audit

Date: 2026-11-03. Status: DOCUMENTATION AUDIT, NOT AN OBSERVATION. This document records how Yodeck's workflows are described in Yodeck's own documentation and in third-party material, as a reference for designing TINNOX CMS. Nothing in it was observed in the Yodeck application.

## 1. How to read this document

### 1.1 What was and was not inspected

- **Not inspected:** `app.yodeck.com` and every other Yodeck host. The cloud container's network policy denies them (HTTP 403 from the proxy tunnel, DNS failure from the fetch tool, `ERR_TUNNEL_CONNECTION_FAILED` from Chromium). No browser-takeover, Remote Control or connector tool was available, so no sign-in or MFA was possible. See `docs/open-questions.md` blocker B1 and `docs/rea-evaluation.md` section 3.
- **Inspected instead:** web-search result summaries of official pages at `help.yodeck.com`, `www.yodeck.com/docs`, `www.yodeck.com/academy`, `www.yodeck.com/release-notes` and the legacy `yodeck.zohodesk.eu` knowledge base, plus third-party source code and documents on GitHub that consume Yodeck's REST API (importers, Home Assistant and Bitfocus Companion integrations, a production .NET publisher, a Terraform provider, competitor comparisons).
- **Consequence:** every official statement here is a condensed search-result summary of a named page, not a page that was read in full. Wording, menu names and limits may have changed since the summary was indexed.

### 1.2 Labels

| Label | Meaning in this document |
|---|---|
| DIRECTLY OBSERVED | Seen in the Yodeck application during this engagement. **No finding carries this label.** |
| OFFICIALLY DOCUMENTED | A yodeck.com or help.yodeck.com page surfaced in a search result and its summary states the fact. Always snippet-level. |
| THIRD PARTY | Stated by a non-Yodeck source: integration source code, a reseller, a reviewer, a competitor's comparison, a community guide. Source named each time. |
| INFERRED | A conclusion drawn from documented or third-party facts, with the reasoning stated. |
| UNKNOWN | Searched for and not found. Absence of evidence, not evidence of absence. |
| HARDWARE-DEPENDENT / UNVERIFIED | Behaviour that depends on a player, display or controller and was not tested. |

Confidence per area is given in section 1.4. "Plan restriction" means Yodeck documents the capability but gates it by subscription tier; "missing feature" means no documentation or third-party evidence of the capability was found at any tier.

### 1.3 Method

Research ran in four passes, all in this cloud session on 2026-11-03:

1. **Researcher pass.** One agent per area (eleven areas: the ten workflow areas in the brief plus the public API) wrote a findings file with goal, prerequisites, steps, inputs, validation, state changes, errors, plan restrictions, hardware caveats, relevance and a search log. Only the first two areas (accounts, registration) ran while web search was available. The other nine exhausted the shared per-turn search budget and worked from the first two areas' captured official summaries plus GitHub code search.
2. **Adversarial verification pass.** A second agent per area tried to refute each key claim by re-fetching cited sources and finding independent ones. Results: 215 claims checked, 96 confirmed, 37 corrected, 2 refuted, the rest left as "provenance verified, not independently confirmed".
3. **Completeness critic.** One agent read all eleven files, listed 90 gaps and 20 contradictions, and rated confidence per area.
4. **Supplementary pass.** With a fresh search budget, nine agents re-searched the weak areas against official Yodeck pages (20 searches each). Their corrections are merged into the area sections below and listed in section 6.

Research files, with the per-finding tables and full search logs, are in the session scratch area and are indexed in section 7. They are not committed because they contain long verbatim quotations from third-party repositories.

### 1.4 Confidence by area

| Area | Confidence | Why |
|---|---|---|
| 1 Accounts, workspaces, roles | medium to high | Researched with search; about 35 official pages; role names and policies single-sourced |
| 2 Registration, pairing, provisioning | high for the flow, medium for statuses and groups | About 50 official pages; pre-provisioning independently confirmed |
| 3 Media | low, raised by supplement | Upload flow and status lifecycle agree across 2 to 4 clients; limits and quotas were unknown |
| 4 Playlists | low to medium | Item model corroborated by 3 clients; transitions, limits and shuffle semantics unknown |
| 5 Layouts, orientation, LED | low to medium | Region schema from one fixture; LED guidance from an older knowledge-base mirror |
| 6 Scheduling, time zones | medium for the model, low for DST | Event fields confirmed by two importers; DST handling never documented |
| 7 Publishing and deployment status | medium for API, low for player side | Push endpoints confirmed by 2 to 5 integrators; heartbeat and progress unknown |
| 8 Monitoring and reporting | low to medium | Status table and alerts are summaries; playback reports confirmed by one official article this turn |
| 9 Offline, startup, updates | low | Headline offline window single-sourced; update and rollback behaviour undocumented |
| 10 Customer admin and support | medium for pricing, low for support and compliance | Three datasets agree on pricing; support channels and data residency unknown |
| API (cross-cutting) | medium | Base URL, auth, paging, push flows agree across 5 to 7 clients; the specification itself was never read |

## 2. Yodeck's product shape in one page

This summary is the frame for the area sections. Every sentence is OFFICIALLY DOCUMENTED (snippet) unless marked.

- One **Account** with a non-deletable Account Owner and invited Users. On the Enterprise plan the account is partitioned into **Workspaces** (nested up to five levels) that scope content, screens and user roles. Below Enterprise every user holds one role account-wide.
- A **Screen** is a registered player. Players are paired with an on-screen registration code typed into the portal. Player types: Raspberry Pi (Yodeck-sold or self-flashed), Android, Windows, LG webOS, Samsung Tizen, Amazon Fire OS and Signage Stick, BrightSign, and a browser-based Web Player. Linux or x86 PCs are no longer supported.
- Content is **Media** (images, video, audio, documents, web pages, apps) organised in folders and tags, assembled into ordered **Playlists** and multi-region **Layouts**, and placed on screens as **Default Content** or through a **Schedule** of calendar Events with filler content between them. A per-screen **Takeover** and account-wide **Emergency Alerts** override everything.
- Nothing reaches a player until the operator presses **Push to Screens**. Only affected screens download and restart playback.
- Players cache content and keep playing offline for roughly a month, with a warning three days before the cutoff. They upload periodic screenshots, report Online, Offline, Upgrading, Disabled or Not Registered, and send offline and back-online e-mails.
- Pricing is per screen per month on Basic, Premium and Enterprise plans. One screen is free while the account has exactly one screen. The REST API and the MCP-based AI agent need Premium or Enterprise. Workspaces, SSO, audit log, security policies and player lock-down need Enterprise.
- Partners (resellers and white-label) manage separate full customer accounts from a partner console and can log in as any user of a customer account; each such login is recorded in the partner's audit log (THIRD PARTY on whether the customer sees it: UNVERIFIED).

## 3. Workflow areas

Each area has the same shape: workflows as documented (goal, prerequisites, steps, inputs and validation, state changes), documented errors and recovery, plan restrictions versus missing features, hardware-dependent items, relevance to TINNOX with a suggested release priority, and what remains unknown. Step lists are condensed; the research files hold the full versions with a source per step. Where the supplementary pass changed a finding, the corrected version is given here and the change is listed in section 6.

### 3.1 Accounts, workspaces and roles

**Confidence: medium to high.** Research files Y01, Y10 and Y10-supplement.

**Workflows as documented (OFFICIALLY DOCUMENTED unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Invite a user | Add a colleague with a role. Requires the Account Owner or Administrator permission; on Enterprise a Workspace Admin may add users to their own workspace. | Profile menu, Users, create user, assign a role. Enterprise: add a role per workspace and set a Primary Workspace. | Inputs: e-mail, role, workspaces. The invitation link is valid for 30 days with a reminder two days before expiry; one e-mail address equals one Yodeck account. Every plan allows unlimited users. Basic and Premium allow one role per user. Eight standard roles exist on all plans (Global Admin, Workspace Admin, Content & Device Manager, Content Manager, Restricted Content Manager, Content Viewer, Template Manager, plus a Billing Access permission). The Owner cannot be deleted. Resend and pending-invitation views: UNKNOWN. |
| Transfer ownership | Make another person the Owner. Only the current Owner can do it. | Delete any existing user with the new owner's e-mail, then change the e-mail on My User Profile and save; the new owner resets the password. | Ownership is a property of the Owner's user record, not a transferable flag (INFERRED from the procedure). If the Owner login is lost, Yodeck support performs the change. |
| Create a Workspace | Partition content, screens and users. Enterprise plan; the Workspace permission. | Account Settings or Active Workspace menu, Manage Workspaces, Create Workspace: Name, Description, Screen Limit, Parent Workspace. | Hierarchy up to five levels; "as many Workspaces as you need". Reaching a Screen Limit blocks adding screens. Deleting a workspace moves its items to the Default Workspace, which ordinary users may not see. Creating content while "All" is selected forces a workspace choice. Screens are moved between workspaces with a Move action. |
| Assign roles through Groups | Give many users the same role in their own branch. Enterprise. | Create or pick a role, create a Group per role, set each user's Primary Workspace, add users to the Group, optionally cascade to sub-workspaces. | Effective role per workspace = Group role on the Primary Workspace plus explicit per-workspace roles. |
| Custom Roles | Per-object permissions. Enterprise and Enterprise Plus (the one help article saying "Premium and Enterprise" is treated as stale). | Account Settings, Custom Roles, Add Custom Role, name, tick permissions, save. | Permission rows: Media, Apps (split from Media in October 2026), Playlists, Layouts, Schedules, Screen Content, Screen Configuration, Push to Screens, Broadcast Emergency, Create and Delete Screens, User Management. Whether Screen Content has a Delete permission: UNKNOWN. |
| Enable per-user 2FA | TOTP second factor. Any authenticator app. | My User Profile, Two Factor tab, scan the QR code or enter the secret key, enter the 6-digit code. | No plan restriction appears in the current page summary (INFERRED available on all plans). An "Enforce Two Factor Authentication" Security Policy is Enterprise-only. |
| Security Policies | Account-wide authentication rules. Enterprise. | Password rotation every 1, 3, 6 or 12 months and length rules; forced reset on first login; inactivity logout; single active session; IP allow-list for the dashboard (players unaffected); enforce 2FA; disable e-mail password reset and Google login. | Per-user allow-list extensions are set in User Management. |
| SAML SSO and SCIM | Federated login and automatic provisioning. Enterprise; Owner for SCIM. | Account Settings, SSO, enable SAML, import IdP metadata, enable "Automatically Create Users" (Yodeck's own just-in-time toggle), map IdP groups to Yodeck Groups, optionally map a claim to the Primary Workspace; then SSO Advanced Settings, enable SCIM deprovisioning and generate a token and identifier URL for the IdP. | THIRD PARTY (Okta guide): enabling SAML disables the normal login for everyone, there is no backup login URL, and support must switch SAML off. SCIM requires working SSO first. SCIM attributes and group push: UNKNOWN. |
| API token | Credential for the REST API. Premium or Enterprise. | Account Settings, Advanced Settings, API Tokens, Generate Token, name it, choose a role, copy once. | The token "functions as a user" with the chosen role and "will not be visible again". |
| Audit Log | See who did what. Enterprise. | Account Settings, Audit Log; columns Time, Session (IP and session code), Workspace, User, Section, Name, Action, Object, Change Message. | Retained 90 days, then deleted; downloadable as .txt, .csv or .json (April 2025 release note). Whether a push appears as an audit action: UNKNOWN. |
| Partner console | Resellers and white-label partners manage customer accounts. Partner Network membership; 10-screen minimum. | Sign in, be redirected to the partner console, open a customer account, use Support Login to act as any user of that account. | Each customer is a full separate account, not a workspace. Staff permissions (Billing, Audit Logs, Add or Delete Accounts, Update billing-related, Support Login) are set by Yodeck support, not self-serve. Every Support Login is written to the partner's audit log with a "Support user" field. Whether the customer sees it in their own audit log: UNVERIFIED. White-label partners get a custom portal domain for an annual servicing fee; discounts up to 50 percent by volume tier (THIRD PARTY on the exact margins). |

**Errors and recovery (documented):** Owner lockout needs support; ownership transfer collides with an existing user of the same e-mail; SAML lock-out needs support; SAML rejects users with an empty group value (THIRD PARTY); workspace deletion hides content in the Default Workspace; audit entries are purged at 90 days; IP allow-list never affects players; deprecated roles cannot be assigned after April 2023, use a Custom Role instead.

**Plan restriction or missing feature**

| Capability | Classification |
|---|---|
| One role per user | Plan restriction (Basic, Premium) |
| Workspaces, hierarchy, Groups, role per workspace, moving screens between workspaces | Plan restriction (Enterprise) |
| Custom Roles | Plan restriction (Enterprise, Enterprise Plus) |
| SAML, SCIM, Audit Log, Security Policies including enforced 2FA | Plan restriction (Enterprise) |
| API tokens | Plan restriction (Premium and Enterprise) |
| Per-user 2FA | Available on all plans (INFERRED from the absence of a gate in the current page) |
| Per-screen, per-folder or tag-level permissions | Missing feature; Workspaces are the only scoping mechanism (INFERRED from absence) |
| Self-serve partner staff roles; cross-account content move; backup login when SAML is on | Missing; support-mediated |
| Agency sub-accounts under one direct account | Not a feature; use Enterprise Workspaces or separate accounts |

**Hardware-dependent or unverified:** nothing hardware-dependent. Unverified: customer-side visibility of partner Support Logins; invitation resend; the numeric workspace cap; SCIM attribute list.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Non-deletable Owner with an explicit transfer-ownership action | MVP | Cheap; avoids Yodeck's e-mail-swap collision trap |
| Fixed role set with a separate billing permission | MVP | Covers documented use; Yodeck decoupled billing from admin in 2023 for a reason |
| Customer-level tenancy with explicit site and display scoping | MVP | Yodeck has no per-screen permission below Enterprise Workspaces; TINNOX's customers have few displays each |
| Per-user TOTP 2FA for everyone, with 30-day invitation links | MVP | Expected baseline; matches Yodeck's documented invitation expiry |
| Audit log with export and retention longer than 90 days | MVP (basic) | Needed for support accountability across customers |
| Role-carrying API tokens | MVP | Needed for TINNOX's own hardware-monitoring integrations |
| Staff support access into any customer with every entry logged and visible to the customer | MVP | The direct equivalent of Yodeck's partner Support Login, with the customer-visibility gap closed |
| Custom roles, security policies, SAML with group mapping, SCIM | Later | Enterprise and tender features; design the role model so IdP groups can map onto it |
| Billing entities, white-label reseller programme | Out of scope | TINNOX builds for its own brand; billing stays external |

### 3.2 Display registration, pairing, grouping and provisioning

**Confidence: high for the registration flow and pre-provisioning, medium for statuses, groups and billing of disabled screens.** Research files Y02 and the Y02 section of Y11-supplement.

**Workflows as documented (OFFICIALLY DOCUMENTED unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Register a screen with a code | Pair a player with the account. Account with screen allowance; player installed, powered and online so the code shows. | Screens, Add Screen; pick a player type or enter the code directly; Continue to the Registration Code page; enter a Name and the code; Save; assign a schedule or default content; press the orange Push to Screens button. | Code is 8 digits for the Raspberry Pi player and 9 digits for Web Player, BrightSign, Android, Tizen, webOS, Windows and Fire OS; the first digit encodes the player type (8 Fire OS, 3 Android, 6 legacy Windows, W new Windows; the full per-type table was not retrieved). Current docs say the portal detects the type from the code. Pairing completes "within 1 to 2 minutes". A registered screen without content shows "No content assigned to player" with a QR code. Errors: code does not match player type; "Player Already Registered". Code lifetime: not stated for any player; the Windows guide only says to use the latest code if it expires or the app restarts. |
| Pre-configured Yodeck Player | Zero-touch deployment of a purchased Raspberry Pi player. | Connect HDMI and network, power on. The player is registered to the buying account on receipt. | Purchased players are locked to the account that bought them. Current models: 1 GB player and 4 GB Player Plus, shipped from US or EU warehouses. |
| Self-flashed Raspberry Pi | Turn a customer's Pi into a player. Supported model (Pi 4B recommended; Pi 3 limited; Pi 5 "Beta Image, Supported" on the newer page with its own limitation list), Class-10 card of at least 16 GB, correct power supply. | Flash the image with Raspberry Pi Imager (category Digital Signage OS) or Etcher; optionally edit SETTINGS.txt; boot; wait 3 to 5 minutes; read the 8-digit code. | Black screen means a corrupt card or bad flash: reflash. No code means no internet: try Ethernet. |
| Pre-provisioning with SETTINGS.txt | Register a Pi without typing a code, for bulk rollouts. The screen must already exist in the portal with all settings set. | Copy the Screen ID into the `[REGISTRATION] deviceid` key; optionally set Wi-Fi SSID, key, mode, static IP, netmask, gateway, DNS and a proxy; boot. | On startup the player registers with that ID; if that fails the code appears. If screen settings were not set first, the player fetches account defaults "which can take the player offline again". After first connection the Wi-Fi credentials on the card are obfuscated. No zero-touch path is documented for Android, Windows, Tizen or webOS; the Android APK production guide uses an ADB command to make the app device owner. |
| Android, Fire OS, Windows, webOS, Tizen, BrightSign, Web Player | Register each player type. | Install the app or package, read the 9-digit code, register as above. Tizen is installed from a package URL and its orientation is fixed at install time. The current Windows guide documents self-serve registration with a W-prefixed code; the "Beta, manual registration" statement is stale, and the Intel-only kiosk build was hidden from 17 September 2026 for accounts without active Windows players. | Per-platform limits: no CEC power control on Android or Fire TV; webOS has no 4K and rotates 90 or 270 only, webOS 8 added April 2026; Tizen 8 and later not supported; Linux and x86 PCs no longer supported; Web Player not supported on iOS and needs a browser extension for screenshots. |
| Delete, re-register, move | Lifecycle. | Delete from the Screens list; the player de-registers and shows a code again; re-add. Enterprise: choose a Workspace and click Move. | Moving a player between accounts is delete and re-register or a support request. Billing reductions take effect at the next renewal. |
| Bulk edit and export | Change many screens at once. | Select two or more screens, Actions, Edit, tick Set Value next to each property, Save, Push. Screens CSV export honours the workspace selection. | Working Hours and e-mail notifications are bulk-editable. CSV column list: UNKNOWN. |
| Screen properties | Per-screen configuration. | Screen Details tabs: Basic Info (name, description, tags, orientation, time zone), Screen Takeover, Network (Wi-Fi with EAP for enterprise networks, static IP, proxy with username and password, Advanced Networking with custom NTP servers), Sound/Display (resolution auto-detect or forced mode; overscan parameters; sound output), Media Filtering, Working Hours, Location (IP guess or manual pin), Screen Email Notifications, Status (content status, storage, hardware status with a Refresh button), Advanced (Custom Certificates; Encrypt Player Storage and Lock Down Player on Enterprise). | The screen's time zone drives schedules and working hours; the user's profile zone does not affect screens. |

**Grouping:** no general screen folder or group hierarchy is documented; a search restricted to yodeck.com found no page about screen groups, folders or tags. Tags on screens exist and drive media filtering and emergency broadcast groups. The API `/groups` resource is the user-group resource (bundle relay), not a screen group. Enterprise Workspaces, with Move and a per-workspace Limit Number, are the documented organising construct. A "Device Disabled" message means the device was disabled for subscription or payment reasons and is reactivated by Yodeck's Success team; it is not a per-screen toggle (corrects the earlier INFERRED reading). Whether disabled screens are billed: UNKNOWN.

**Errors and recovery (documented):** see the table; plus Tizen installation blocked by a wrong date or time; webOS version matrix; weekly restart advised for Fire TV; the Workspace Screen Limit blocks new screens until raised.

**Plan restriction or missing feature**

| Capability | Classification |
|---|---|
| One free screen; per-screen billing beyond that | Plan restriction |
| Workspaces, per-workspace screen limits, moving screens between workspaces | Plan restriction (Enterprise) |
| Lock Down Player, Encrypt Player Storage (Raspberry Pi only) | Plan restriction (Enterprise) |
| Screen groups or folders | Missing feature (user feedback requests exist, THIRD PARTY) |
| Self-service transfer of a player between accounts | Missing; support-mediated |
| Zero-touch provisioning for non-Pi players | Not documented (UNKNOWN) |
| Linux or x86 player | Dropped feature |

**Hardware-dependent or unverified:** Pi performance tiers and Pi 5 limitations may be stale; boot time 3 to 5 minutes depends on card and model; CEC behaviour depends on the display; the LED forced-resolution behaviour depends on the sending card; the per-type registration code prefix table.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Short on-screen pairing code with a type prefix; auto-detect type | MVP | Field-proven; one dialog serves all player types |
| Immediate "no content assigned" placeholder after pairing | MVP | Installers need visual confirmation on site |
| Pre-provisioning by device identity in the image or a config file | MVP | TINNOX ships its own hardware; factory pre-registration avoids on-site pairing |
| Device locked to its customer; clear "already registered" path | MVP | Prevents hijacking of fleet devices |
| Screen properties: orientation in all four angles, time zone, custom LED pixel dimensions, location, custom NTP | MVP | Core for LED pylons and multi-state fleets |
| Display groups and sites (Yodeck lacks them) | MVP | The most requested Yodeck gap; cheaper than full workspaces |
| Linux or x86 and Android players | MVP | Yodeck dropped Linux; TINNOX's kiosks and LED senders are x86 or Android |
| Bulk edit, CSV export, offline alerts, working hours | Later | High value above about 20 screens |
| Consumer TV OS players (Tizen, webOS, Fire OS, BrightSign) | Out of scope | Version-fragmented; TINNOX's hardware is LED and kiosk |

### 3.3 Media upload, validation, processing and organisation

**Confidence: medium after the supplementary pass (was low).** Research files Y03 and Y03-supplement. The original pass could not search and reconstructed the area from API client code; the supplement surfaced about 60 official pages.

**Workflows as documented**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Upload a file (UI OFFICIALLY DOCUMENTED; API flow THIRD PARTY from a production .NET publisher and two importers) | Add an image, video, audio file or document. A role with Media change permission; on Enterprise a workspace must be chosen. | Media, choose Images, Videos, Audio or Documents, upload; files "can be used right away in Playlists and Layouts". API: create the media record; request an upload URL; PUT the bytes to that pre-signed URL without the API token; call upload complete; poll status until `finished`. | Maximum 5 GB per file. Cloud storage is unlimited subject to fair use on every plan including Free; the player's card is the real cap. Images: jpeg, jpg, png, bmp, gif, jfif, webp, svg (heic only in Safari or macOS); images are "not resized automatically", smaller images show black bars, huge resolutions slow older players; one page mentions a 50 megapixel cap (scope unverified). Audio: mp3, wav, aac, ogg, m4a. Video: "almost all containers" including MP4, TS, MKV; target is H.264 with AAC, High Profile level 4.1, 1080p; a release note says most uploads are repackaged in about 30 seconds without re-encoding and only re-encoded when needed; a per-upload skip-encoding option and an account setting "Enable video original" exist. API status lifecycle `initialized`, `uploading`, `encoding`, `finished`, `failed` (THIRD PARTY); importers refuse media that is not `finished`; the API does not return originals. Nothing plays until pushed. |
| Documents (OFFICIALLY DOCUMENTED) | Show PDF and Office files. | Upload to Documents; PDF, Word, Excel and PowerPoint are "automagically converted to PDF and displayed as slideshows". | 10 seconds per page by default; per-page duration; 0 skips a page; 200-slide cap. Uploading a PowerPoint to Videos keeps animations and transitions. Rendering parity on non-Pi players: UNVERIFIED. |
| Add from URL, cloud drives, stock and streams (OFFICIALLY DOCUMENTED for the UI; API shape THIRD PARTY) | Content fetched from elsewhere. | YouTube and Vimeo links are downloaded at up to 1080p and played locally through Videos, Add video. "Live Video Streaming" is a separate option for H.264 live streams (HLS, RTP, MPEG-TS per the feature list). "Import Media Files" copies once from Dropbox, OneDrive, SharePoint, Google Drive and Google Photos; separate live cloud-drive playlists sync within about five minutes. Stock images and video from Pexels, Unsplash and Pixabay and a built-in gallery; a Canva app and Canva Export app. Web pages carry a refresh rate, zoom factor, auto-zoom and a per-page proxy directive. | Basic and Premium allow one storage connection, Enterprise several (plan restriction). Whether the one-connection cap applies to one-time imports: UNKNOWN. |
| Organise (OFFICIALLY DOCUMENTED for folders and media filtering; API shape THIRD PARTY) | Folders, tags, workspaces, search. | Folders are global across Images, Videos, Audio, Documents, Web Pages and Apps with an Add Folder control; free-form tags; search by name, date, workspace and tag; per-screen Media Filtering shows only media carrying the screen's tag from one master playlist. | No folder-level permissions documented (INFERRED missing). Folder nesting depth and move steps: UNKNOWN. |
| Availability window (page OFFICIALLY DOCUMENTED; API fields THIRD PARTY) | Make an item playable only within dates and weekly slots. | On the media object: enable flag, available-after and available-before datetimes, weekly slots with a Monday-first weekday bitmask. | "The timezone is set based on the player's timezone"; semantics are player-local wall clock. How the API serialises the datetimes (offset required or ignored) remains UNVERIFIED, since two third-party sources conflict. Weekly scheduled availability is Premium and Enterprise only; whether start and expiry dates are available on Basic or Free: UNKNOWN. |
| Apps and custom HTML apps (official URLs cited by third parties; steps THIRD PARTY) | Widgets and packaged HTML. | Apps, My apps, Create App, Create HTML app: name, icon, zoom factor, enable Chromium, upload a ZIP with `index.html` at its root, paste a settings schema; create an instance; add to a playlist or layout; push. | Catalogue size reported as 80 to 90 plus apps and 800 plus templates (dated third-party captures of the pricing page). |

**Errors and recovery:** `failed` is a terminal API status; a "This file is too large" message exists; deleted media returns 404 to the API; a push that exceeds the player's free space shows a red "No Space Left" message while old content keeps playing; rate limiting with 429 and Retry-After. Portal-side processing-status labels and error wording: UNKNOWN. Two official pages disagree on whether images are resized (manual: not automatically; FAQ: resized upon display) and on whether all videos are re-encoded.

**Plan restriction or missing feature:** API and MCP need Premium or Enterprise; workspaces, Branded Templates and multiple storage connections need Enterprise; weekly availability slots and tag-based playlists need Premium; apps, templates and unlimited storage are included from Basic; folder or tag permissions are missing; API download of originals is missing, although the portal has an "Enable video original" setting.

**Hardware-dependent or unverified:** 4K playback per player type; which codecs each player decodes after transcode; document rendering on non-Pi players; USB capture inputs; the 50 megapixel image cap.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Typed media model with an explicit status lifecycle | MVP | Makes upload honest on slow site links; the four-state model is corroborated by several clients |
| Pre-signed direct-to-storage upload with a complete call; 5 GB files | MVP | Large LED video should not pass through the API |
| Transcode to a player-safe rendition, repackage without re-encoding when possible, keep the original downloadable | MVP | Yodeck's missing originals are a documented migration complaint; LED controllers need pixel-exact sources |
| Per-canvas renditions for non-16:9 LED sizes | MVP | Yodeck leaves images unresized and forces resolution at the screen; TINNOX should produce the right pixels at upload |
| Folders, tags and tag-based per-display filtering | MVP | Proven organisation; covers multi-site retail without workspaces |
| Availability window stored with the display's IANA zone | MVP | Dated promotions are the most common request; Yodeck confirms player-local evaluation but leaves the API format unclear |
| PDF and Office conversion to pages with per-page durations | Later | Yodeck's 10-second default and 200-page cap are a sensible reference for council and school content |
| URL and stream items, app catalogue, stock library, cloud-drive pickers, quotas | Later | Useful but not for first LED and kiosk customers |
| Audio-only media | Out of scope (MVP) | Outdoor LED and kiosks rarely play audio |

### 3.4 Playlists, ordering, durations and transitions

**Confidence: medium after the supplementary pass (was low to medium).** Research files Y04 and Y04-supplement.

**Workflows as documented**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Create a playlist and order items (UI OFFICIALLY DOCUMENTED; API shape THIRD PARTY from three independent clients) | A named ordered list for a screen, layout region or schedule event. | Playlists, create, add items, adjust each item's duration with minus and plus controls, drag to position, save, Push to Screens. CSV import of playlist items exists. | Items carry an integer position, a per-item duration in seconds and a type (media, layout, sub-playlist). Images, web pages and apps inherit a per-media default duration; videos have "a fixed display time (the duration of the video itself), which cannot be changed" in the UI. Yodeck states no limits on uploading content or making changes; enforced minimum and maximum durations and item counts: UNKNOWN. Layout items are recommended at 20 seconds or more. |
| Shuffle (OFFICIALLY DOCUMENTED) | Random order. | Per-playlist Random Playback checkbox. | "All media in the Playlist will play at least once." Reshuffle per loop and repeat avoidance: UNKNOWN. |
| Transitions (OFFICIALLY DOCUMENTED) | Visual transitions between items. | Per-playlist toggle; about 25 transition types; speed Slow 3 s, Medium 2 s, Fast 1 s or custom. | Images to images only; not with layer transparency; not yet at 4K; inherited by sub-playlists. Separately, video-to-video playback is gapless with an opt-in 0.5-second black gap option. Transition type names and which players render them: UNKNOWN, HARDWARE-DEPENDENT. |
| Availability | Dated or time-sliced items. | Lives on the media object, not the playlist item (section 3.3). | Per-item availability: not evidenced (INFERRED missing). |
| Nested playlists (OFFICIALLY DOCUMENTED) | Reuse a playlist inside another. Premium and Enterprise. | Item of type sub-playlist with optional maximum items and maximum time in seconds; a Repeat Items option loops until a limit is hit. | A 30-second asset under a 25-second maximum is always skipped; the sub-playlist resumes where it left off on the next pass. Nesting depth: UNKNOWN. |
| Tag-based playlists (OFFICIALLY DOCUMENTED) | Dynamic selection by tag. Premium and Enterprise. | Include tags on one line are AND, extra lines are OR; a separate Exclude list; each item plays for its media default duration. | Item ordering: not official (a forum user says upload order). Per-screen Media Filtering is a separate mechanism (section 3.3). |
| Audio (OFFICIALLY DOCUMENTED) | Sound. | An audio-only playlist can be created (mp3, wav, aac, ogg); a layout's background audio can be a file or a playlist and overrides media sound; main-playlist background audio overrides sub-playlist audio. | Audio item duration behaviour: UNKNOWN. |
| Other options (OFFICIALLY DOCUMENTED) | Playback tuning. | "Add a black gap between videos" (0.5 s) and "Keep Web Pages open" (Pi 4 with 2 GB or more; unavailable when a layout is inside the playlist). | Mapping to the legacy API flag names is INFERRED. |
| Assign (THIRD PARTY for the API shape) | Put a playlist on a screen, region, schedule event or takeover. | Screen content source type playlist; region item of type playlist; schedule event source; takeover content. | Schedules cannot be takeover content. |

**Errors and recovery:** media must be `finished` before use; the API playlist update replaces the whole item list, so integrators re-read before patching (INFERRED); a push after a failed partial update is the documented recovery pattern; the API playlists list has no workspace filter (THIRD PARTY).

**Plan restriction or missing feature:** API on Premium and Enterprise; sub-playlists and tag-based playlists on Premium and Enterprise; workspace field on playlists is Enterprise; per-screen playlist overrides and per-item availability are not evidenced (absence only); transitions exist but are image-only.

**Hardware-dependent or unverified:** which players render transitions and whether the 4K restriction still applies; what the API does with a video item duration shorter than the clip; the "30 to 60 seconds to sync after push" is one user's observation (official: a push can take up to three minutes).

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Ordered items with position and per-item duration; video fixed to natural length by default | MVP | Three independent clients and the official page converge on this model |
| Drag reordering, duplicate, explicit publish | MVP | Table stakes; publish gives an audit point |
| Media-level availability evaluated in the display's zone | MVP | Dated campaigns across Australian states |
| Sub-playlists with item and time limits for ad-slot packaging | Later | Yodeck's "maximum seconds, skip items that do not fit" rule is a good reference for billboard rotations |
| Per-item availability and per-display overrides (Yodeck lacks both) | Later | Differentiators once the core is stable |
| Shuffle, tag-based playlists, image transitions | Later | Transitions on LED walls are often rendered by the controller; Yodeck limits them to images anyway |
| Audio playlists | Out of scope | Silent installations |

### 3.5 Layouts, regions, orientation, pixel dimensions and content fitting

**Confidence: medium after the supplementary pass (was low to medium). This area carries TINNOX's core need, LED pylons and portrait kiosks, and most of its LED guidance is now first-hand official.** Research files Y05 and Y05-supplement.

**Workflows as documented**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Create a layout (editor OFFICIALLY DOCUMENTED; object model THIRD PARTY from two importer fixtures) | A reusable multi-zone design. A content-creating role. | Layouts, create; choose Resolution/Ratio from presets (Landscape, Portrait, Full HD, 4K) or Add Custom Ratio with free width and height in pixels; add regions; put content in each; set per-region options; set a layout background colour from the top-bar colour picker; Preview; save; assign; push. | Custom ratios default to a maximum of 4096 px per side and can also be managed under Account Settings, Custom Ratios; a 1920x480 pylon canvas is therefore possible (INFERRED from the free entry). API objects store `resolution_width` and `resolution_height`; regions are absolute pixel rectangles with z-order, fit, rotation, flip, transparency, mute, hidden and a duration for single media. Changing the ratio or orientation resizes the canvas instantly and elements may need manual repositioning; there is no auto-conversion. No geometry validation documented. |
| Fit content (OFFICIALLY DOCUMENTED) | Off-ratio creative. | Per element or region, including playlist regions: Fill, Fit or Stretch (older pages: Fit, Crop, Stretch); video also has per-side crop margins. | API `fit: contain` corresponds to Fit. Default fit and per-playlist-item override: UNKNOWN. Background colour is layout-wide and solid only; per-region colour needs a shape element. |
| Start from a template (OFFICIALLY DOCUMENTED) | Apply a ready-made design. | Templates tab in the editor: search, horizontal or vertical orientation filter, categories; preview; Use Template. "Magic Layout" is an OpenAI-powered Create with AI button that returns two editable options and saves generated images to the library; hidden unless AI features are enabled; not for white-label partners at launch. | Applying to a non-empty canvas shows a replacement warning; undo is supported. AI plan tier: UNKNOWN. |
| Branded Templates (OFFICIALLY DOCUMENTED, quoted by a third party) | Locked brand assets. Enterprise. | Layouts, Branded Templates; Draft and Published states; Import Template keeps logos, fonts and colours locked. | Template Manager permission has View, Change, Delete. |
| Set a screen to portrait (OFFICIALLY DOCUMENTED) | Rotate the output. | Screen settings, Basic Info, Orientation: Normal, Rotated Clockwise or Rotated Counterclockwise; two-push sequence (set Normal, push, then rotate, push); overscan on Sound/Display; build 9:16 layouts, the output stays 16:9. | 180 degrees ("Upside down") appears only in a third-party FAQ; webOS officially excludes it; no rotation limit is documented for Windows. Tizen orientation is fixed at install. |
| Drive an LED board (OFFICIALLY DOCUMENTED on the current manual and help centre) | Non-standard pixel sizes. | Yodeck states LED controllers use the top-left corner of the input. Set a custom ratio with the exact pixel dimensions; force a standard output resolution on Sound/Display; enter the unused right and bottom pixels as overscan or advanced parameters so that part of the output is disabled; the player reboots. Worked examples: 1920x1080 output to a 320x240 board; 1440x900 to 256x256. | Auto-detect uses the display's preferred mode with a 640x480 VGA fallback. Exact field names, non-top-left offsets and how a given sending card maps the signal: HARDWARE-DEPENDENT, UNVERIFIED. Custom non-standard output modes are documented only for the Pi 3B+. |
| Preview (OFFICIALLY DOCUMENTED) | See the layout as the player shows it. | Top-right Preview button opens a pop-up rendered as on the player; the editor preview updates in real time. | Rendering engine and list thumbnails: UNKNOWN. |
| Overlays and tickers (ticker OFFICIALLY DOCUMENTED; transparency THIRD PARTY) | Layered regions. | Z-index and a transparency flag per region. The ticker is an app (RSS or static text, right to left, speed in seconds edge to edge), not a region type. | Transparency over video per renderer: UNVERIFIED (one project reports WebKit only). |
| Video walls (OFFICIALLY DOCUMENTED) | Multi-screen. | One player and one layout per screen; a master player plus an IP video streaming device; playlist Sync Playback with equal or multiple durations; bezel compensation from measured gaps; per-side video crop margins. | A "Lock Mode" setting mentioned by a third party: unconfirmed. |

**Errors and recovery:** replacement warning on templates; orientation needs a push and the two-step sequence; Tizen needs a reinstall to change orientation; the Pi 5 limitations page still lists no multi-zone layouts, 16-bit colour and a 4K screenshot pause, while a newer compatibility page lists the Pi 5 as "Beta Image, Supported" (page dates unknown); the Pi uses only its left micro-HDMI port; fixed-frame embeds do not resize.

**Plan restriction or missing feature:** Branded Templates are Enterprise; Template Manager is a role restriction; multi-zone on the Pi 5 is a hardware limit, not a plan; AI layouts are feature-flagged with an unknown tier; a native ticker region and per-region background colour are absent by design (apps and shapes are the documented substitutes), not plan-gated.

**Hardware-dependent or unverified:** LED sending-card handling of a forced mode with a disabled area, for any specific controller such as NovaStar or Huidu; renderer per player type; 4K layouts with several video regions; region rotation on every player; the 180-degree option per player.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Pixel-addressed canvas of arbitrary width and height with absolute-pixel regions and z-order | MVP | Yodeck's own model is pixel-based and its editor accepts free custom ratios; TINNOX pylons such as 1920x480 need the canvas to equal the wall |
| Screen-level output mode: auto-detect, forced standard mode, and an active area (offset plus width and height) within the output | MVP | Mirrors Yodeck's documented top-left LED workflow and how most sending cards consume HDMI |
| Orientation in all four angles with a matching portrait canvas in the editor | MVP | Yodeck documents only two rotations and a two-push sequence; TINNOX controls its own player |
| Named fit modes (contain, cover, stretch, none), crop margins and a background colour, with a preview at canvas size | MVP | Yodeck's Fill, Fit, Stretch set and crop margins are now documented; advertisers supply off-ratio creative |
| Region content types: playlist, single media, web page with viewport and zoom, text, app | MVP | Matches Yodeck's region vocabulary |
| Template gallery, branded locked templates, overlays with transparency, region rotation, AI layout generation, server-rendered thumbnails | Later | Onboarding and brand features for later customers |
| Layout background audio; video wall by one player per tile with sync playback | Out of scope | TINNOX drives LED walls as one canvas through the controller |

### 3.6 Scheduling, recurrence, time zones, priorities and conflicts

**Confidence: medium for the data model, precedence, takeover and working hours after the supplement; low for DST and the API time-zone format.** Research files Y06 and Y06-supplement.

**Workflows as documented**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Default content per screen (OFFICIALLY DOCUMENTED; API THIRD PARTY) | One item plays continuously. | Screens, edit, choose Default Content (layout, playlist, media or app) and optionally Scheduled Content; Save; Push. | API: screen content with a source type of media, playlist, layout, schedule or turned off. |
| Create a schedule with events (OFFICIALLY DOCUMENTED; vocabulary corroborated by API fixtures) | Different content by date and time. | Schedules, Add Schedule, name it; calendar in month, week or day view; Add Event: content, start date and time, end date and time (overnight windows allowed); Repeat none, daily (seven weekday checkboxes), work days, weekly, monthly, annual or custom, with Repeat Until; save; assign to screens as Scheduled Content; push. | "After N occurrences" and a "Turned Off" entry are evidenced only by third parties. API event: start, end, duration in minutes, recurrence code, interval, Monday-first weekday bitmask, occurrences, integer priority, source. Limits on events per schedule: UNKNOWN. |
| Precedence and filler (OFFICIALLY DOCUMENTED) | Resolve overlaps. | The event placed higher in the Events List plays; priority is changed by dragging events in that list. Gaps play the schedule's filler content, which may itself be turned off. | "Events List" is the current wording, "Entries" is older. No overlap warning or conflict report documented: UNKNOWN. |
| Content-type priority (OFFICIALLY DOCUMENTED, "Prioritization of Content Types") | What wins when several mechanisms apply. | Emergency Alerts, then Takeover, then Working Hours, then Scheduled Content, then Default or Filler content; Content Availability is lowest but always enforced. | An emergency alert overrides even a running takeover; a takeover outside Working Hours leaves the screen off, because takeover controls playback, not power. |
| Preview (OFFICIALLY DOCUMENTED) | Check before assigning. | Playlists, Layouts and Schedules can be previewed individually before assigning. | Whether the schedule preview simulates "what plays at time T": UNKNOWN. |
| Skip an occurrence (THIRD PARTY, Companion module) | Exceptions. | API add-event-exception with skip-on or skip-from dates. | A skip-from on or before a non-recurring event's start may delete the event entirely; the response note explains. UI equivalent: UNKNOWN. |
| Per-screen time zone (OFFICIALLY DOCUMENTED) | Local evaluation. | Screen Details, Basic Info, Time zone, searchable by city, country or UTC offset; use the physical location. | Drives schedules and working hours; the profile time zone "does not automatically change the timezone of your screens or players". The Schedules page example uses an IANA-style zone name. The API representation (area plus sub-zone pair versus a full string) is still UNVERIFIED. **DST: seven targeted searches found no Yodeck page, release note, forum or feedback post that mentions daylight saving.** Local wall-clock behaviour is INFERRED from "runs according to the player's time zone". No Australian zone value was observed anywhere. Players sync time by NTP automatically; the Android player uses the OS time settings. |
| Working Hours (OFFICIALLY DOCUMENTED) | Power schedule. | Global, per workspace or per screen override (the per-screen override wins); screen turned off outside hours in its local zone, or a black image if the player cannot power the display off; "special working hours" for specific dates and holidays (September 2024 release); bulk-editable. | Display power depends on CEC: unsupported on Android and Fire TV. |
| Takeover (OFFICIALLY DOCUMENTED; API THIRD PARTY) | Per-screen override. | Screen Takeover tab: content plus duration indefinite, 30 minutes, 1 hour or custom minutes; Stop Takeover button; a new takeover replaces the current one; not available on unregistered screens; needs the change-content permission. API: takeover content with a duration in minutes of at least five, blank for indefinite, null to clear. | Schedules cannot be takeover content. Auto-revert timing on the player: UNVERIFIED. The API five-minute floor versus the UI custom minutes: unreconciled. |
| Emergency alerts (OFFICIALLY DOCUMENTED; API THIRD PARTY) | Account or workspace broadcast. | Broadcast Groups are tag-based (at least one tag); a three-step wizard; Workspace filter on Enterprise; CAP (Common Alerting Protocol) support; the alert overrides every other function and shows within 5 to 10 seconds. API: broadcast with headline, description, instruction, duration (default 7200 seconds), workspace and group; cancel all or one. | Plan tier: UNKNOWN (a competitor blog's claim is unreliable). |
| Download hours (OFFICIALLY DOCUMENTED, "Timed Events") | Defer downloads to a window. | Set download hours per player; on push choose immediate or wait for the window; a window of at least two hours is advised on slow links; previous content keeps playing if the download is unfinished. | Scope (global, workspace or per screen), format, default and interaction with Working Hours: UNKNOWN. |

**Errors and recovery:** single-screen API push returns 200 even on failure (check the body); bulk push drops screens the token cannot push; a screen with no time zone is read as UTC by one importer, implying the field can be empty (THIRD PARTY); a schedule whose filler is turned off leaves the screen black between events; content flags "Possibly Outdated" and "Not Updated" until pushed.

**Plan restriction or missing feature:** API and emergency alerts are plan-gated (tier unknown for alerts); workspace-scoped schedules and alerts are Enterprise; conflict warnings, takeover with a schedule, multiple schedules per screen (INFERRED from the single content source) and a time-based schedule simulation are missing or unknown.

**Hardware-dependent or unverified:** CEC and RS-232 power; takeover revert timing; how an emergency broadcast renders; download hours per player; freshness of the time-zone database on the Raspberry Pi image (base OS release unverified), which matters for Australian DST rule changes.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Default content plus explicit publish | MVP | Every board needs a fallback and a deliberate go-live |
| Named schedule with events, overnight windows and filler content | MVP | Dayparting and trading hours |
| Recurrence stored as RFC 5545 rules; once, daily with weekdays, weekly, until a date | MVP | Importers already map Yodeck's vocabulary to RRULE |
| A single documented precedence order (emergency, takeover, working hours, schedule, default, availability) | MVP | Yodeck publishes exactly this; copying the order avoids operator confusion |
| Per-display IANA zone, wall-clock events, DST-safe evaluation, gated on time sync | MVP | Multi-state Australian fleet; Yodeck leaves DST entirely undocumented |
| Explicit integer priority with a non-blocking overlap warning | MVP | Yodeck's drag-order rule is cheap and understood; the warning is a small improvement |
| Single-screen takeover with preset and custom durations, stop button, replace semantics | MVP | Panic button for closures and sold-out notices; Yodeck's UI options are a good reference |
| Schedule timeline preview | Later | Yodeck previews schedules but a time simulation is unconfirmed; valuable for DST edge cases |
| Exceptions that never silently delete an event; working hours with holiday overrides; download hours; group scheduling; emergency alert library with CAP | Later | Follow the core |

### 3.7 Publishing, download progress, deployment status and confirmation

**Confidence: medium to high for the push model and content states after the supplement; low for heartbeat and reconnect behaviour.** Research files Y07 and Y07-supplement.

**Workflows as documented**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Push to Screens (OFFICIALLY DOCUMENTED) | Make saved changes take effect. A role allowed to push (Restricted Content Manager cannot). | Save; the Push to Screens button flashes orange while unpublished changes exist; click it; "only affected screens download and restart playback"; the button turns black with "Changes pushed". A force push to all screens exists for troubleshooting. Per screen: "Push again to this Screen" in the Screens list Actions menu. If download hours are set, the push prompts "push immediately or wait for download hours". | A push can take up to three minutes (Windows troubleshooting guide). No dialog listing affected screens and no scheduled push found in docs or 2024 and 2025 release notes. Whether individual items carry an unpublished badge: UNKNOWN. Whether a push is written to the audit log: UNKNOWN. |
| Content states per screen (OFFICIALLY DOCUMENTED, Screens Overview) | See who is current. | Five states: Up to date; Possibly Outdated (offline and has not reported receiving the latest content); Not Updated (keeps showing older content because of network restrictions or a long offline period); Downloading; Unknown. The Status tab adds "might not be downloaded" and a Refresh button. Dashboard shows Online, Offline, Registered and Unregistered counts and a map from the last public IP. | A Yodeck staff forum reply says the portal shows only these states, not bytes, percent or time remaining; while downloading the player keeps playing old content. The only on-screen download message found is the red "No Space Left" error. Introduced by a "Content Status Reports" release (April 2019 per the forum). |
| Single-screen API push (THIRD PARTY, Companion module and Home Assistant integration) | Push from an integration. | PATCH the screen content, then POST push with an optional flag to respect download hours. | Returns HTTP 200 even on logical failure; success body status is `completed`, while the public OpenAPI document says `successful` (the module author calls the specification wrong). A slow screen can be reported as failed after the client's 10-second timeout. |
| Bulk API push and status polling (THIRD PARTY, four integrators) | Push many screens and confirm per screen. | POST push with device or workspace filters (none means all); poll the push status endpoint; statuses initialized, in progress with a progress object, completed with a list of screens, failed with errors. | Empty device filter is a 400; screens the token cannot push are silently dropped; only the account's most recent bulk push is tracked, with no job identifier, so concurrent pushes collide. Confirm per screen by presence in the completed list. |
| Confirm what is playing (OFFICIALLY DOCUMENTED) | Visual confirmation. | Screenshot thumbnails refresh every 30 seconds while Screen Details is open and every two hours otherwise; "Capturing screenshot..." means a capture is queued on reconnect; allow up to three minutes on Windows. API: a public screenshot URL and a refresh-screenshot call (THIRD PARTY). | Image format, resolution and retention: UNKNOWN. |
| Bandwidth and endpoints (OFFICIALLY DOCUMENTED) | Plan network capacity. | Control connection up to 300 MB per month per player; media downloaded once; streams and web pages unpredictable; contact Yodeck before using metered links. Outbound 443 to the IoT hub and asset hosts (section 3.9). | |
| Offline at push time (OFFICIALLY DOCUMENTED) | Recovery. | Pushing to an offline player shows "Content not updated"; the Windows and webOS guides say reconnect, then click Push again. | Whether an offline screen auto-downloads a missed push on reconnect without a manual re-push: UNKNOWN, HARDWARE-DEPENDENT; the official guides recommend re-pushing. |

**Errors and recovery:** forgetting to push leaves the old content playing; a pre-provisioned player that registers before its settings exist can go offline; integrators re-push idempotently after any failure and confirm per screen; rate limiting at roughly 21 requests per 10 seconds per token (THIRD PARTY); status page at status.yodeck.com (contents unverified).

**Plan restriction or missing feature:** portal push on all plans (INFERRED, no gate found); API push on Premium and Enterprise; per-screen download progress is absent by design (confirmed by a staff reply), a per-item unpublished badge and job-scoped push status are missing or not found; cross-account push for partners is API-only; scheduled publishing is absent apart from download-hours deferral.

**Hardware-dependent or unverified:** screenshot cadence per player type; how fast the online flag flips; Web Player behaviour offline; download hours per player; auto-delivery on reconnect.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Explicit save versus publish with an unpublished indicator that names the pending displays | MVP | Keeps Yodeck's safety, fixes its account-level-only indicator |
| Per-display states: uploaded, published, downloaded, playing, with last seen, last published and last changed, plus Yodeck's five content states as a reference | MVP | What operators of unattended boards need first |
| Per-display download progress with bytes and an estimate | MVP | Yodeck refuses it by design; regional 4G links make large pushes slow |
| Keep playing the old loop until the new bundle is fully cached; no black screen | MVP | Yodeck documents the same behaviour while downloading |
| Automatic delivery when an offline display reconnects | MVP | Yodeck's guides tell operators to push again |
| Periodic screenshot with a per-display URL, faster while an operator is watching | MVP | Yodeck's 30-second and two-hour cadence is a sensible reference |
| Published bandwidth budget and endpoint list in the install guide | MVP (documentation) | Yodeck publishes both; installers on corporate networks need them |
| Download windows, proof of play, offline alerts, job-scoped API push status, takeover publish path | Later | Follow the core |

### 3.8 Screenshots, monitoring, diagnostics and playback reporting

**Confidence: medium after the supplement (was low to medium).** Research files Y08 and Y08-supplement.

**Workflows as documented**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Monitor the fleet (OFFICIALLY DOCUMENTED) | See who is online and current. | Screens table: fixed Name and Player Status (Online, Offline, Upgrading, Disabled, Not Registered); optional Player Type, Description, Tags, Scheduled Content, Default Content, Offline Time, TV Status (On, Off, N/A when no CEC information) and, for the Pi player only, Power Supply and Locked Down; content states as in section 3.7; dashboard counts and map; CSV export honouring the workspace selection. | TV status, CPU temperature and power supply refresh hourly. API (THIRD PARTY): online, last seen, updating, registered; integrators poll every 60 seconds to 5 minutes. Heartbeat interval and the offline-detection threshold: UNKNOWN (troubleshooting advice says wait two minutes). |
| Offline e-mail notifications (OFFICIALLY DOCUMENTED) | Be e-mailed on offline and recovery. | Screen Details, Screen Email Notifications, or bulk through Actions: wait time Do not notify, 30 minutes, 2, 6 or 12 hours, or custom from 30 minutes to 48 hours in 30-minute steps; optional recovery e-mail within five minutes; toggle to alert during scheduled-off hours; on by default (April 2025). | Recipients are account users; a per-screen recipient is an open feedback request. Channels beyond e-mail: UNKNOWN. |
| Screenshots (OFFICIALLY DOCUMENTED) | Confirm what is rendering. | Players send a screenshot every 30 to 40 seconds (preview FAQ); thumbnails refresh every 30 seconds on Screen Details and every two hours elsewhere; "Capturing screenshot..." shows while a capture is queued; Web Players need the Yodeck browser extension. | The Status tab has a Refresh button; a dedicated "take screenshot now" button was not named; the API refresh-screenshot call is THIRD PARTY. A 2019 "Full-size Screenshot" command's fate: UNKNOWN. Pi 5 pauses screenshots at 4K. |
| Remote actions (OFFICIALLY DOCUMENTED for the UI; API paths THIRD PARTY) | Restart or re-send. | Screens Overview Actions: Turn monitor ON/OFF (CEC), Reboot Player, Shutdown, Push again; a Reboot Player revamp is described in a release note. Scheduled reboot: forum only. API: reboot and push endpoints (one integrator's code); an official feature page says the API supports "actions like reboots". | Push returns 200 on logical failure (section 3.7). |
| Status tab and diagnostics (OFFICIALLY DOCUMENTED, partial) | Per-screen health. | Status tab: content status (up to date, not updated, downloading, might not be downloaded), Storage line, hardware status, Refresh button. | Full field list, CPU temperature, RAM, uptime and storage exposure in the API: UNKNOWN. No player log viewer or "send logs" feature found. An optional support remote-access channel on port 1194/TCP to a Yodeck host is documented for Yodeck Support. |
| Playback reports (OFFICIALLY DOCUMENTED, help article 455928 and a release note) | Proof of play. | Enable with a toggle and choose daily, weekly or monthly CSV export; push to screens after saving; aggregate reports filterable by media tags and player tags. | Pro (older name) and Enterprise plans; records kept about three months while generated CSVs are kept; reports generated in UTC; a record every five minutes when one item stays on screen; playback date and reported date differ because players upload in batches. CSV columns and granularity: UNKNOWN. A Playback Reports API was announced in July 2025; shipping unconfirmed. |
| Remote settings (OFFICIALLY DOCUMENTED) | Change configuration from the portal. | Orientation, resolution and overscan, sound, working hours, location, network (Wi-Fi including EAP, static IP, proxy, NTP), all applied after a push; the manual configuration guide says settings can be changed through Yodeck once the player is online. | Display power through CEC or RS-232 where the display supports it (THIRD PARTY on RS-232). |

**Errors and recovery:** stale screenshot after a player goes offline; "Content not updated" when pushing to an offline player; no CEC on Fire OS or Android (black screen instead of off); back-online alert within five minutes; weekly Fire TV restart advised; status page at status.yodeck.com.

**Plan restriction or missing feature:** API on Premium and Enterprise; Lock Down and Encrypt Player Storage on Enterprise; playback reports on Pro or Premium and Enterprise; per-screen notification recipient missing (feedback request); live screen mirroring missing (competitor claim); player log viewer not found; screen groups for monitoring missing.

**Hardware-dependent or unverified:** screenshot cadence per player type; CEC and RS-232 power; what Power Supply reports; CPU temperature exposure; whether all player types report content status at the same cadence.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Online, offline, upgrading and not-registered states with last seen and offline time, plus dashboard counts | MVP | Baseline for an unattended fleet |
| Heartbeat with a published interval and offline threshold | MVP | Yodeck leaves even its integrators guessing |
| Periodic screenshot, faster while watched, plus an on-demand capture command | MVP | Yodeck's documented cadence is the reference; on-demand closes its gap |
| Offline e-mail alert with Yodeck's wait-time ladder, recovery notice, scheduled-off suppression, and per-display recipients | MVP | Copy the documented options; add the recipient Yodeck lacks |
| Remote reboot, display power, re-push from UI and API with per-display results | MVP | Yodeck has the UI actions; its API push hides failures |
| Player health telemetry (temperature, throttling, storage, uptime, version) in a Status tab and API | MVP (lite) | Outdoor LED cabinets in Australian heat fail on temperature first; Yodeck's exposure is partial |
| Proof of play with batch upload, playback versus reported date, UTC generation and CSV export | MVP for advertising boards, later for kiosks | Yodeck's documented semantics are a good reference |
| Remote network editing, log upload to support, webhooks, status page | Later | Yodeck offers network editing and a support tunnel; logs and webhooks are gaps |
| Live mirroring, plan-gated tiers | Out of scope | Kiosk-specific or not TINNOX's model |

### 3.9 Offline playback, startup, updates and recovery

**Confidence: medium to high after the supplement (was low); update rollback remains undocumented.** Research files Y09 and Y09-supplement.

**Workflows as documented (OFFICIALLY DOCUMENTED unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Offline playback | Keep playing when the internet drops. Content pushed while online; clock in sync. | Playback continues from the local cache. "Players can withstand at least 30 days of no Internet access"; a warning appears in the bottom-right corner three days before stopping; "between 30 to 40 days after losing internet access, your Player will stop playback, displaying an error message". | Other official pages say "more than 30 days", "up to a month" and "up to 45 (or even more) days" for Android; 30 days is the guaranteed minimum and the stop is not exact. The "35 days" figure was third-party only and is dropped. Mechanism: the schedule file has an expiry; an "Apply Needed" message shows within three days of expiry (Amazon Signage Stick guide); the stop screen is "Internet Access Required" or "Invalid Schedule File"; a reboot restores playback for up to one hour. Android screens offline more than 30 days "may have been auto-disabled". Fix: reconnect, check Last Seen Online, push again. A Zoho-era article answers "No" to "Does Yodeck work offline?" because changes need the internet. |
| Boot and startup (Raspberry Pi) | Power-on to playback or to a code. | Connect the display, insert the card, power on; 3 to 5 minutes to initialise; auto-detect the preferred resolution unless forced; pre-provisioned units register by ID; outcome is a code, "No content assigned" with a QR code, or playback. | The boot logo can be replaced with the customer's own, which forces a playback restart or reboot. Whether cached content starts before the network is up: UNKNOWN. webOS relaunches the app on boot; the Windows app must stay open and its code changes on restart. |
| Player software updates | Stay current without operator action. | Updates are automatic and self-applied; the player shows "Updating" and the table shows Upgrading; "most updates take 2 to 30 minutes" (Windows); packages come from a plain-HTTP update repository and are digitally signed; Android and Fire OS rely on store auto-updates. | Cadence, staging, maintenance window, opt-out and what the Pi shows while updating: UNKNOWN. **Rollback after a failed update: no official page exists**; a competitor's "in place, no rollback" claim is uncontradicted but unconfirmed. Reflashing erases content but retains settings. |
| Network requirements | Get onto a site network. | Outbound only: the IoT hub host on 443/TCP (required), the assets host on 443/TCP for schedules and media (required), the update repository on 80/TCP, an optional support host on 1194/TCP and an optional widgets host on 443/TCP; NTP on UDP 123; two fallback IP addresses for IP-only firewalls (may change); Windows additionally needs an S3 host and a packages host; webOS also needs signageOS endpoints. Control traffic up to 300 MB per month; media downloaded once. | SETTINGS.txt supports Wi-Fi, static IP, DNS and a proxy key (IP preferred); the portal supports an HTTP proxy with username and password and per-web-page proxy directives; Custom Certificates for TLS inspection. Enterprise Wi-Fi: "use the EAP security option", available on all plans. Captive portals: "Yodeck players do not support captive portals", with a network-side bypass page. Proxy key names, PAC, NTLM and EAP methods: UNKNOWN. |
| Clock and NTP | Keep schedules accurate. | Players contact NTP servers periodically "maintaining accuracy down to milliseconds"; per-screen custom NTP servers under Network, Advanced Networking; Android APKs support custom NTP. | Without an RTC the Pi saves the time to the card hourly and loads it after a power failure; offline it cannot sync, so the clock "might be off (from minutes to hours)", which "will affect Scheduling, not content playback". An optional DS3231 RTC is documented through a config.txt overlay and a custom script. Default NTP hostnames beyond "the default Debian NTP servers and our service": UNKNOWN. Whether the Pi 5 image uses its on-board RTC: UNKNOWN. |
| Storage | Fit content on the card. | The Status tab shows a Storage line; the bundled card is 32 GB with about 28 GB usable; Android needs at least 500 MB free. If a push exceeds free space the player fails to download and shows a red "No Space Left" message while old content keeps playing. | Cache eviction policy: UNKNOWN. |
| Encrypt Player Storage | Protect media on a stolen player. Enterprise; Raspberry Pi only. | Key fetched from Yodeck at boot (needs connectivity), stored locally (works offline, extractable) or fetched with an IP allow-list; one method at a time. | |
| Reflash and recover | Rebuild a Pi player. | Raspberry Pi Imager or Etcher; black screen means reflash; a pre-provisioned ID keeps the screen record, otherwise re-add. | |

**Errors and recovery:** as above, plus "Player Already Registered" can be caused by no internet; a Wi-Fi credential change loses connectivity; a stall at "Downloading media..." after blanked Wi-Fi settings was fixed from the portal Network tab (THIRD PARTY); wrong date or time blocks Tizen setup.

**Plan restriction or missing feature:** Encrypt Player Storage and Lock Down are Enterprise; enterprise Wi-Fi is on all plans; operator-controlled update windows, rollback, captive-portal support and a 802.1X certificate workflow are missing or undocumented; the offline cutoff is product behaviour, not plan-gated.

**Hardware-dependent or unverified:** boot time; Pi 5 image status; base OS release of the Pi 1 to 4 image; RTC use on the Pi 5; offline behaviour of the Web Player and BrightSign; per-platform cache limits; whether the 30-day auto-disable applies on every platform.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Full local cache with no licensing cutoff; a documented grace period if one is ever needed | MVP | Yodeck's 30 to 40 day stop is a commercial gate; unattended boards must not go dark |
| Download-then-swap with no black screen; old loop until the new bundle is verified | MVP | Yodeck documents the same while downloading and a "No Space Left" failure mode worth copying |
| Fast branded boot with cached content before the network is up | MVP | Yodeck's 3 to 5 minute boot is a visible weakness on a public board |
| Pre-provisioning file (device ID, Wi-Fi including EAP, static IP, DNS, proxy) | MVP | Mirrors SETTINGS.txt; avoid the "fetches defaults and goes offline" trap |
| Automatic updates with A/B partitions and rollback, visible Updating state, version and uptime in the table and API | MVP (agent), later (staged rollout) | Yodeck updates automatically but documents no rollback |
| Published allow-list (hosts, ports, NTP, bandwidth) in the install guide | MVP (documentation) | Yodeck publishes one; copy the shape |
| Configurable NTP, an RTC on the pilot hardware, schedules gated on time sync, time-synced flag in the heartbeat | MVP | Yodeck documents hourly time saving and multi-hour drift offline; DST-heavy scheduling needs better |
| Storage reporting and a "not enough space" state that keeps old content | MVP | Documented Yodeck behaviour worth matching |
| Proxy with auth and custom CA, encrypted storage, lock-down | Later | Enterprise and kiosk sites |
| Captive portals | Out of scope | Yodeck does not support them either |

### 3.10 Customer administration, plans, restrictions and support

**Confidence: medium to high for pricing, plan gating, compliance and support after the supplement; low for partner commercial terms.** Research files Y10 and Y10-supplement.

**Workflows as documented (OFFICIALLY DOCUMENTED unless marked)**

| Workflow | Goal and prerequisites | Steps (condensed) | Inputs, validation, state |
|---|---|---|---|
| Sign up and the free period | Start at no cost. | Self-serve sign-up without a credit card; new accounts get a "Yodeck Unlimited Access Period" of 30 days on up to 5 screens; afterwards the quota drops to one screen and the account pauses until a billing user chooses a plan. | The Free plan is a single screen licence with all Basic features, unlimited storage and unlimited users, kept only while the account has exactly one screen. |
| Subscribe and change plan | Pay per screen. The Billing Access permission. | Basic, Premium and Enterprise at USD 8, 12 and 16 per screen per month from 1 April 2026, or AUD 13, 18.50 and 25; the per-screen rate is the same monthly or annual; annual billing adds a free Yodeck Player (1 GB on Basic, 4 GB Player Plus on Premium and Enterprise) or a bring-your-own-device credit. Enterprise Plus is a custom quote. | One unreconciled "AU$19.2 per screen per year" label. GST on Australian invoices, minimum terms and freight for the free player to Australia: UNKNOWN. Billing reductions take effect at the next renewal. Refund only within the first 30 days of an annual subscription and conditioned on returning the player. |
| Cancel and delete | Leave the service. | Cancel by reducing licences to one screen (zero is not allowed). Deletion is a separate permanent self-serve request through an "account compliance page" after downgrading to one screen, or by e-mailing support. Inactive accounts are deleted after 365 days. | Content-deletion lag and a formal subject-access channel: UNKNOWN. |
| Compliance and hosting | Answer tender questions. | A privacy policy, a data processing agreement PDF, a Data Privacy Framework notice, a sub-processors page and a vulnerability disclosure policy exist. The CMS is hosted on AWS in Ireland (eu-west-1); the sub-processors page also names Sweden. ISO 27001 and ISO 9001 certification by TUV Austria and GDPR and CCPA compliance are stated. SOC 2 is not claimed. | No Australian region and no on-premises option. Certificate scope and date, and the role of the Swedish location: UNKNOWN. |
| Get support | Resolve a problem. | In-app chat with agents from Monday 06:00 to Saturday 06:00 Athens time and an AI assistant around the clock; e-mail support; toll-free phone numbers including an Australian number, Monday to Friday 10:00 to 01:00 Athens time; first response "usually within 10 hours"; paid users prioritised. Enterprise gets 24/5 and Enterprise Plus 24/7 priority support. | The Capterra "1 hour SLA" claim is unsupported. Support-mediated cases: lost Owner login, "Player Already Registered", partner staff roles, content transfer between accounts, Device Disabled reactivation. |
| Billing Entities | Invoice several legal entities under one account. Enterprise add-on; included in Enterprise Plus. | Enabled by the account manager. | Steps not retrieved. |
| Partner programme | Resell or white-label. Partner Network membership; 10-screen minimum. | Separate full customer accounts managed from the partner console; Support Login; staff permissions set by Yodeck; white-label custom portal domain for an annual servicing fee; partners may prepay one to three years. | Discount tiers up to 50 percent by volume, margins 20 to 50 percent (THIRD PARTY on the numbers); tier thresholds and the fee amount: UNKNOWN. |
| Export data | Take data out. | Screens CSV export; audit log download (.txt, .csv, .json; Enterprise; 90 days); the REST API on Premium and Enterprise, which third-party importers use to pull media, playlists, layouts, schedules and screens. | One-click full account export: UNKNOWN. |

**Errors and recovery:** adding a second screen ends the free benefit; an expired 5-screen period leaves one free screen and four disabled; a Workspace Screen Limit blocks new screens; Device Disabled for payment reasons needs the Success team; billing reductions wait for renewal; audit log purged at 90 days; service incidents on status.yodeck.com (a tracker logged a 12-minute partial outage on 30 September 2026, THIRD PARTY).

**Plan restriction or missing feature**

| Capability | Classification |
|---|---|
| More than one screen at no cost | Plan restriction |
| API, API tokens, MCP agent, live-data apps | Plan restriction (Premium and Enterprise) |
| Workspaces, per-workspace roles, Groups, Custom Roles, SSO, SCIM, audit log, security policies, player lock-down and encryption, multiple storage connections | Plan restriction (Enterprise) |
| Billing Entities | Plan restriction (Enterprise add-on, Enterprise Plus) |
| 24/5 and 24/7 support, account manager | Plan restriction (Enterprise, Enterprise Plus) |
| Agency sub-accounts; self-serve partner roles; self-serve content move; self-serve player transfer | Missing; support-mediated |
| On-premises hosting; Australian data residency | Missing (cloud-only, EU-hosted) |
| Audit retention beyond 90 days | Product limit |
| Per-screen access control | Missing (INFERRED) |

**Hardware-dependent or unverified:** free-player conditions and freight to Australia; how a purchased player's account lock is released; which platforms support lock-down and encryption (encryption is Pi-only); the role of the Swedish AWS location.

**Relevance to TINNOX**

| Capability | Priority | Reasoning |
|---|---|---|
| Per-customer entitlement model where displays beyond quota become disabled, not deleted | MVP | Yodeck's safe default for lapsing and returning customers |
| Customer tenant with audited TINNOX staff access | MVP | Direct equivalent of the partner console |
| Audit log export and retention beyond 90 days | MVP (basic) | Advertiser disputes and accountability |
| Australian hosting with a published data-location statement, DPA and sub-processor list | MVP | Yodeck is EU-hosted with no Australian option; Australian government and enterprise buyers ask first |
| Documented account deletion and export procedure | MVP (procedure), later (self-serve) | Yodeck's compliance page is a reference; tenders expect it |
| Documented support channel, hours and first-response target | Later | Yodeck publishes hours, an Australian number and a 10-hour target; TINNOX can start with one channel |
| Status page, ISO 27001, SSO | Later | Design logging and access control now so certification is reachable |
| Billing entities, white-label programme, free self-serve tier | Out of scope | TINNOX is hardware-led and sells under its own brand |

### 3.11 Cross-cutting: the Yodeck public API and integrations

**Confidence: medium; the specification itself remains login-gated and unread.** Research files Y11 and Y11-supplement.

**What is official (snippet level):** a REST API introduction article on yodeck.com and the help centre, "released in phases" from September 2024 (no official page uses the word Beta); the Academy token page (Account Settings, Advanced Settings, API Tokens; the token acts as a user with a role; shown once; Premium and Enterprise); the OpenAPI bundle text relayed by a third party ("Yodeck API - Beta", base URL `https://app.yodeck.com/api/v2`, header `Authorization: Token <label>:<secret>`, a three-level rate limiter answering 429 with no body, user create, update and delete webhooks restricted to global admins); July 2025 release notes adding schedule CRUD, tag-based playlists, screen player-status endpoints, media and screen tags, and announcing a Playback Reports API; the AI Agent and MCP installation guide (`https://mcp.yodeck.com/mcp`, OAuth 2.1 within the user's role, legacy tokens still accepted, Premium and Enterprise at no extra charge, clients including Claude, ChatGPT, Cursor and VS Code); a local Player HTTP API on `localhost:9999` with device identity routes plus proxying, caching and app storage, and a GPIO HTTP API page; SCIM guides with an identifier URL and secret token under SSO Advanced Settings.

**What is third party (consistent across five to seven independent clients):** paging envelope with count, next, previous and results and limit and offset parameters; list filters on screens (workspace, online, text, basic subset with tags and time zone) and media (text, tags, type, workspace); error body with code, message, details and timestamp, where the field-level reason sits in details; observed limits of 21 requests per 10 seconds per token and 63 per account on screens endpoints, with Retry-After in seconds; the media upload flow of section 3.3; the push, takeover, emergency-alert and schedule-exception flows of sections 3.6 and 3.7; reboot and refresh-screenshot endpoints; the specification's response values drifting from the live API; the hosted MCP server exposing about 53 tools.

**Still unknown:** official numeric rate-limit tiers and their mapping to endpoints or plans; any webhook beyond user events; Zapier, Make or Power Automate connectors (none found; five competitors advertise Zapier apps); the SCIM identifier URL value, attributes and group push; exact paths for users, roles, groups and workspaces; whether the Playback Reports API shipped; official SDKs or a Postman collection; a public status page listing.

**Relevance to TINNOX:** role-scoped tokens shown once (MVP); a versioned REST API with the same paging envelope, structured errors and published numeric limits with Retry-After (MVP for read endpoints, later for full CRUD); screen status, screenshot, reboot and push with job-scoped status and per-screen results (MVP); the pre-signed upload flow with originals kept (MVP); outbound webhooks for offline, online, push completed and media finished (later; a documented Yodeck gap); takeover and broadcast endpoints (MVP single screen, later groups); a local player HTTP API for on-device apps (later; Yodeck's port 9999 model is a reference); SAML with a break-glass local login (later); an MCP server (later); no-code connectors and a partner API domain (out of scope).

## 4. Cross-cutting findings

### 4.1 Australian time zones and daylight saving

- **What Yodeck documents:** a per-screen time zone chosen by city, country or UTC offset; schedules, working hours and media availability "run according to the player's time zone"; the user's profile zone never affects screens; players sync time by NTP, with a per-screen custom NTP field; a Pi without an RTC saves the time hourly and may drift "from minutes to hours" after a power failure while offline, which "will affect Scheduling, not content playback". All OFFICIALLY DOCUMENTED (snippet).
- **What Yodeck does not document:** daylight-saving behaviour. Seven targeted searches found no page, release note, forum thread or feedback post that mentions DST. Whether the zone picker lists Australia/Melbourne, Brisbane, Adelaide, Perth, Lord_Howe and Eucla, and how the API serialises the zone, are UNKNOWN; no Australian zone value appears in any third-party code. Wall-clock evaluation across the transition hours is INFERRED, not stated.
- **Consequence for TINNOX:** the spec's scheduling semantics (`docs/tinnox-mvp-spec.md` section 11) and the time-zone acceptance tests (SCH-01 to SCH-10 in `docs/acceptance-tests.md`) must be designed from first principles using the Australian rules in the research file A03, not from Yodeck. The open question Y8 in `docs/open-questions.md` (the time-zone label on events and the editor's behaviour at the transition) stays open for an authenticated session, and section 8 below adds the picker check.

### 4.2 Portrait and custom-resolution LED canvases

- **Official:** the layout editor accepts free custom ratios in pixels up to 4096 per side; LED controllers read the top-left corner of the input; the documented LED workflow forces a standard output mode and disables the unused right and bottom pixels through overscan parameters, with worked examples; portrait is two rotations plus a two-push sequence with 9:16 layouts on a 16:9 output; fit modes are Fill, Fit and Stretch with video crop margins.
- **Unverified:** the exact field names, whether offsets other than top-left are possible, 180-degree rotation on any player, and how a specific sending card (NovaStar, Huidu) negotiates the forced mode. These are HARDWARE-DEPENDENT and belong to the real-hardware validation track in `docs/architecture-and-hardware.md` (section 6, "Browser or simulator validation versus real-hardware validation").
- **Consequence for TINNOX:** the canvas profile and output-mode model in the spec (section 5 domain model, sections 6.5 and 6.6) match the documented Yodeck controls while removing the two-rotation and output-ratio limits.

### 4.3 Free and paid plan restrictions

Best-corroborated topic. Free: one screen while the account has exactly one screen, all Basic features, unlimited storage and users, no card. Trial: 30 days on up to five screens. Basic, Premium, Enterprise at USD 8, 12, 16 (AUD 13, 18.50, 25) per screen per month, same rate monthly or annual. Premium adds the API, the AI agent, sub-playlists, tag-based playlists, weekly availability slots, live-data apps and playback reports (under the older "Pro" name). Enterprise adds workspaces, custom roles, SSO, SCIM, audit log, security policies, lock-down, encryption, multiple storage connections, 24/5 support and the Billing Entities add-on. Residual unknowns: the emergency-alert tier, the AI-layout tier, GST and minimum terms.

### 4.4 Account restrictions versus missing features, summary

| Missing at every tier (no evidence found) | Plan-gated (documented) |
|---|---|
| Screen groups or folders; per-screen permissions | Workspaces and Move (Enterprise) |
| Per-screen download progress (confirmed absent by a staff reply) | Playback reports (Pro or Premium and Enterprise) |
| Per-item playlist availability; per-screen playlist overrides | Sub-playlists, tag-based playlists, weekly availability (Premium) |
| Scheduled publishing (beyond download hours) | API, MCP, live-data apps (Premium) |
| Update rollback or maintenance windows | Custom Roles, SSO, SCIM, audit log, policies, lock-down, encryption (Enterprise) |
| Webhooks beyond user events; Zapier connector | Multiple cloud-storage connections (Enterprise) |
| Australian hosting; on-premises | 24/5 and 24/7 support (Enterprise, Enterprise Plus) |
| Customer-visible record of partner support logins (UNVERIFIED) | Emergency alerts (tier unknown) |

## 5. Contradictions register

Condensed from the critic file Y99 and the supplementary passes.

| # | Topic | Resolution |
|---|---|---|
| C1 | Offline window | Resolved: at least 30 days, stop between 30 and 40 days, warning three days before; "35 days" was third-party only; Android pages say up to 45 or more |
| C2 | API reboot endpoint | Narrowed: an official feature page says the API supports "actions like reboots"; the path remains THIRD PARTY (one integrator's code); the UI has a Reboot Player action |
| C3 | Rate limits | Open: official text is three levels and 429 with no body; the numbers (Low 14/42, Standard 21/63, High 33/99 per 10 s) are one dataset's reading of the login-gated bundle; a third-party catalogue confirms Yodeck publishes no numbers |
| C4 | Custom Roles tier | Resolved: Enterprise and Enterprise Plus; the "Premium and Enterprise" help article is stale |
| C5 | Availability datetime zone | Partly resolved: evaluation is player-local wall clock (official); API serialisation (offset required or ignored) still UNVERIFIED |
| C6 | Screen time-zone API format | Narrowed: the Schedules page uses an IANA-style name; the area and sub-zone pair seen by one importer is probably the same data; UNVERIFIED |
| C7 | Transitions | Resolved: configurable image-to-image transitions exist, about 25 types, three speeds, per playlist |
| C8 | Legacy Windows rotation | Resolved: no rotation limit is documented for Windows; the 180-degree exclusion is webOS only |
| C9 | On-demand screenshot | Narrowed: a Status tab Refresh button and "Capturing screenshot..." state exist; the API refresh call is THIRD PARTY; no dedicated button named |
| C10 | Screen groups | Confirmed: none documented; the API groups resource is user groups; tag-based broadcast groups exist for alerts |
| C11 | Free-plan user count | Resolved: unlimited users on every plan (pricing page) |
| C12 | Monthly versus annual pricing | Mostly resolved: same per-screen rate; annual adds the free player or a credit; one "per year" label unreconciled |
| C13 | Emergency alert gating | Open: unavailable on lower plans and/or without token permission; tier unnamed |
| C14 | Dashboard counts source | Resolved: the Dashboard article (help 455858) |
| C15 | App catalogue size | Report as 80 to 90 plus (dated captures) |
| C16 | Pi 5 status | Partly resolved: newer page says "Beta Image, Supported"; the limitations page still stands; "not our default player" |
| C17 | Windows player beta registration | Resolved: stale; self-serve registration with a W-prefixed code is current |
| C18 | Playback reports sources | Resolved: help article 455928 plus a release note |
| C19 | Entries versus Events List | Resolved: "Events List" is current |
| C20 | Second-hand official rows in the first pass | Mitigated: the supplementary pass surfaced about 280 official pages first-hand; rows still marked "via Y01/Y02" in the research files are relays |
| New | Image resizing; video re-encoding | Two official pages each disagree (not resized versus resized on display; all re-encoded versus mostly repackaged); the newer release-note wording is preferred |

## 6. What the supplementary pass changed

Per area, the main upgrades from UNKNOWN or THIRD PARTY to OFFICIALLY DOCUMENTED (snippet). Full tables are in the `-supplement.md` research files.

- **Media:** 5 GB file limit; unlimited storage; formats; H.264 and AAC target with repackaging; documents converted to PDF with per-page durations and a 200-slide cap; cloud imports and live cloud playlists; stock libraries and Canva; availability evaluated in the player's zone; weekly slots Premium-gated.
- **Playlists:** fixed video duration in the UI; per-media default durations; transitions (image-only, about 25 types); random playback plays everything at least once; sub-playlist seconds limit and skip rule; tag logic (AND within a line, OR across lines, exclude list); audio-only playlists; black-gap and keep-web-pages options; "no limits" statement.
- **Layouts:** Fill, Fit, Stretch; crop margins; layout-wide background colour; custom ratios up to 4096 px; top-left LED mapping with worked examples; two-push portrait sequence; no auto-conversion on ratio change; Magic Layout; Preview pop-up; video wall mechanics; ticker is an app; no Windows rotation limit.
- **Scheduling:** drag-ordered precedence and the "Events List" name; the full content-type priority order; recurrence list and Repeat Until; takeover durations and Stop button; emergency alerts wizard, tag groups, CAP; working hours black-image fallback and special dates; download hours as Timed Events; preview of schedules; profile zone statement; NTP auto-sync. DST remains undocumented.
- **Publishing:** five content states with definitions; orange-to-black button; force push; "Push again to this Screen"; up to three minutes per push; bandwidth budget; no bytes or percent by design; "Content not updated" for offline players; audit log fields.
- **Monitoring:** screenshot cadence (30 to 40 s send; 30 s or 2 h refresh); Reboot Player, Shutdown and CEC actions in the UI; offline-alert wait-time ladder; Status tab content states and Refresh; TV Status and Power Supply columns refreshed hourly; playback reports confirmed twice; support remote-access port.
- **Offline and updates:** 30 to 40 day window with mechanism; firewall allow-list with hosts and ports; NTP and RTC behaviour; enterprise Wi-Fi on all plans; captive portals unsupported; proxy options; Encrypt Player Storage details; update duration; "No Space Left"; reflash retains settings; per-platform offline notes. Rollback remains undocumented.
- **Administration:** Custom Roles tier; unlimited users; same monthly and annual rate in AUD; current Windows registration; privacy, DPA, sub-processors, vulnerability policy; AWS Ireland hosting, ISO 27001 and 9001, no SOC 2; cancellation and deletion procedure; support hours, Australian phone number and 10-hour first-response target; invitation expiry; 2FA on all plans (inferred) with enforced 2FA on Enterprise; audit export formats; eight standard roles and the Custom Role permission rows; partner white-label domain fee and discount tiers.
- **API and registration:** REST intro article and token page first-hand; MCP guide with OAuth 2.1; July 2025 API additions; Player HTTP API on port 9999 and a GPIO API; SCIM identifier URL; "Device Disabled" is a subscription state; Move between workspaces; Add Screen flow with a Continue step; the 9-digit code player list; no Zapier connector.

## 7. Evidence index

### 7.1 Research files (session scratch area, not committed)

Directory: `/tmp/claude-0/-home-user-CMS-RE-Cloud/d09ddace-04e7-5327-b786-ab6528f1a63e/scratchpad/research/`. Each first-pass file has a Summary, Workflow as documented, Findings table with a label and URL per row, Errors, Plan restrictions, Hardware-dependent items, Relevance, Search log, Gaps and a Verification (adversarial pass) section. Each supplement has a Summary, New or corrected findings, Contradictions, Still unknown and a Search log.

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

### 7.2 Official Yodeck pages by area (snippet-level; abbreviations: HELP = help.yodeck.com/en/articles/, DOCS = www.yodeck.com/docs/, WWW = www.yodeck.com/)

Only the pages most load-bearing for the findings above are listed; the research files cite about 420 distinct Yodeck URLs in total.

- **3.1 Accounts:** HELP 455907-users; 422752 ownership change; 669486 and 456245 workspaces introduction; 669485 organize workspaces; 669482 workspaces troubleshooting; 423013 groups; 456199 user roles; 423192 and 455826 security policies; 455831 SAML; 455976 SCIM with Okta; 455824 audit log; 456241 partner console; 455945 partner FAQ; 673179 billing entities; DOCS user-manual/user-permissions-for-screens/ (Custom Roles); user-manual/users/; user-manual/audit-log/; partner-manual/staff-permission-roles/; partner-manual/audit-logs/; WWW academy/api-token/; release-notes/yodeck-updates-april-2025/.
- **3.2 Registration:** DOCS user-manual/screen-registration-yodeck/; yodeck-registration-code/; why-am-i-getting-the-the-registration-code-given-does-not-match-the-player-type-error-message/; what-is-the-player-already-registered-error-message/; yodeck-manual-configuration-guide-for-raspberry-pi/; how-to-flash-an-sd-card-using-pi-imager/; raspberry-pi-compatibility/; raspberry-pi-5-limitations/; setting-up-a-windows-player-with-the-yodeck-software/; setting-up-a-tizen-player-with-the-yodeck-software/; lg-webos-player-troubleshooting/; setting-up-a-yodeck-web-player/; monitor-basic-info/; monitors-table-manual/; screens-overview-introduction/; i-accidentally-deleted-my-screen-do-you-know-what-i-can-do/; HELP 224961 device disabled; 661682 Windows player; 713000 Windows troubleshooting; WWW academy/yodeck-player/.
- **3.3 Media:** DOCS user-manual/media-overview-2/; images-introduction/; videos-introduction/; how-to-upload-videos-with-yodeck/; bypassing-video-re-encoding-as-is-upload/; file-size-limitation-on-the-yodeck-portal/; supported-file-extensions/; documents-on-screen/; what-is-the-maximum-slide-number-that-a-ppt-pptx-file-can-have/; media-availability/; advanced-media-scheduling/; media-filtering/; dropbox-playlist-introduction/; onedrive-playlist/; how-do-i-display-a-canva-design-on-my-screen/; live-video-streaming-support/; web-pages-introduction/; build-an-html-widget/; html-widget-packaging/; are-there-any-limits-placed-on-yodeck-usage/; HELP 169245 audio formats; WWW academy/youtube-vimeo-videos/.
- **3.4 Playlists:** HELP 456318 playlists introduction; 181531 create a playlist; 165053 transition effects; 702723 sub-playlist playback; 423063 and 455920 sub-playlists; 181527 tag-based playlist; 455917 audio assets; 456271 background audio; 456323 playlist of layouts; DOCS user-manual/playlists-introduction/; playlist-types-best-practices/; sub-playlist-playback-examples/; tag-based-playlist/; WWW release-notes/random-playback-for-playlists/; release-notes/playback-preview/; news/software-update-audio-files/.
- **3.5 Layouts:** HELP 456268 layout editor getting started; 456284 screen sizes and aspect ratios; 456104 custom ratio; 169258 outdoor LED billboards; 456216 portrait; 456250 sound and display; 456165 and 601510 video walls; 455897 ticker; 423015 webOS limitations; 456024 Pi 5 limitations; DOCS user-manual/does-yodeck-support-outdoor-led-billboards/; how-to-create-a-custom-ratio/; layouts-introduction/; yodeck-layout-editor-introduction/; editing-customizing-content-layout-editor/; magic-layout-design-layouts-with-ai/; changing-the-screen-resolution-on-a-yodeck-player/; create-a-video-wall/; on-screen-ticker/; branded-templates-layout-editor/; layout-editor-templates/; WWW release-notes/video-walls-tweaking-options/.
- **3.6 Scheduling:** HELP 456255 schedules introduction; 455875 timed events; 456030 screen takeover; 455900 emergency alerts; 456411 date and time; DOCS user-manual/yodeck-content-prioritization/; schedules-introduction/; how-to-create-a-schedule-with-yodeck/; examples-of-schedules/; working-hours/; takeover-feature; emergency-alerts-introduction/; yodeck-ntp-server-configuration/; user-settings/; WWW academy/create-schedule/; academy/screen-takeover/; academy/working-hours/; release-notes/cap-support-for-emergency-alerts-is-here/; release-notes/yodeck-updates-september-2024/.
- **3.7 Publishing:** HELP 456278 pushing changes; 455885 screens overview; 455893 status; 455858 dashboard; 455972 screens table; 757879 screen messages; 176545 no space left; 169244 bandwidth; DOCS user-manual/pushing-changes-to-monitors/; screens-overview-introduction/; dashboard/; understanding-screen-messages-yodeck/; how-much-bandwidth-does-yodeck-use/; WWW release-notes/content-status-reports/.
- **3.8 Monitoring:** HELP 455928 playback reports; 455858 dashboard; 455972 screens table; 455866 static IPs; DOCS how-to-articles/screen-email-notifications/; user-manual/screen-email-notifications/; how-do-i-preview-whats-displayed-on-the-tv-before-pushing-the-content/; static-ips/; WWW release-notes/instagram-inspiration-playback-reports/; release-notes/yodeck-updates-june-2025/.
- **3.9 Offline and updates:** HELP 166303 does Yodeck work offline; 482103 NTP; 169938 reflash; 455942 boot logo; 423110 and 455874 encrypt player storage; 455836 per-page proxy; 712985 Android troubleshooting; 712994 webOS troubleshooting; 712998 Tizen troubleshooting; DOCS user-manual/i-have-a-restricted-network-which-ports-do-i-need-to-whitelist-for-the-yodeck-players; what-is-the-internet-access-required-or-the-invalid-schedule-file-error-message/; configure-rtc-ds3231/; does-the-yodeck-player-support-connecting-through-an-http-proxy/; does-yodeck-player-support-connecting-through-a-wifi-network/; how-to-reflash-your-yodeck-player/; timed-events/; raspberry-pi-compatibility/; software-support-for-raspberry-pi-5-2.
- **3.10 Administration:** WWW pricing/; contact/; privacy-policy/; subprocessors/; vulnerability-policy/; digital-signage-security/; terms-of-service/; dpa.pdf; dpf.pdf; release-notes/yodeck-awarded-iso-certification/; HELP 456128 how is Yodeck priced; 543957 pricing update 2026; DOCS user-manual/free-period/; canceling-your-subscription-and-deleting-your-account/; how-can-i-cancel-my-yodeck-subscription/; what-will-happen-if-i-cancel-my-subscription/; what-about-customer-support/; do-you-have-an-on-premise-solution/; i-want-to-use-yodeck-for-my-customers/; how-to-find-the-your-2fa-security-key/; partner-manual/yodeck-partner-network-faq/; WWW news/new-yodeck-partner-programs-have-launched/.
- **3.11 API:** HELP 204549 REST API introduction; DOCS user-manual/yodeck-mcp-installation-guide/; player-http-api/; gpio-http-api/; how-to-configure-scim-with-okta/; how-to-configure-scim-with-onelogin/; WWW academy/api-token/; ai-agent/; features/yodeck-api/; use-cases/digital-signage-api/; use-cases/ai-digital-signage-yodeck-ai-agent/; release-notes/yodeck-updates-july-2025/.

### 7.3 Third-party sources (GitHub, consulted as code or documents; counts are citations across the research files)

Bitfocus Companion module for Yodeck (philon-/companion-module-yodeck, 58; push, takeover, alerts, exceptions, error shapes); ScreenTinker importer (screentinker/screentinker, 32; media, playlists, layouts, schedules, originals not returned); screenrig CLI importer (screenrig/cli, 30; fixtures for layouts, regions, time zones); BOTGC .NET publisher (botgc-comms/Miscelaneous, 20; upload flow, availability validation, push recovery); Home Assistant integration (pturner1989/ha-yodeck, 19; status, screenshot, reboot, power); C# SDK (cpettit/Yodeck_SDK, 15; models); Wobot cms-playground (12; refresh-screenshot); Screenly Anthias importer (10); IdenWorks scim-tax record (9; bundle quotes, pricing, roles); go-yodeck and terraform-provider-yodeck (easylo, 9); API Evangelist profiles (10; modelled, not authoritative); yobot manual copy (6); mwm-sales-agent (6; partner API domain); EasyAD competitive review (5); born2net pricing datasets (4); Vennusign memo (3); flexible-rss-yodeck (3); Microsoft Entra tutorial (2); others with one or two citations as listed in the research files. Reviewer and competitor pages (rfp.wiki, Capterra, GetApp, ScreenTinker comparisons, Anthias comparison tables) are cited only where labelled THIRD PARTY.

### 7.4 REA evidence (from the pilot in `docs/rea-evaluation.md`)

REA 6.8.0 was piloted on a synthetic loopback page, never on Yodeck. Evidence identifiers: `ev_ab999bb7…` (targets), `ev_06fa1c99…` and `ev_b66f1494…` (inspect), `ev_a84bf1c6…` (observe), `ev_b8dd1d1e…` and `ev_23673dcc…` (screenshot artefacts), `ev_9e55ffed…` (screenshot comparison), `ev_18b2394c…` (bundle). JSON files are in the session scratch area under `rea-pilot/out/`. No REA evidence exists for any Yodeck page.

## 8. What an authenticated, read-only session should capture

Ordered by TINNOX relevance; each item upgrades a finding above from snippet or third-party to DIRECTLY OBSERVED. The read-only policy in `docs/open-questions.md` section 3 applies: no publishing, schedule changes, reboots, deletions, invitations, billing or account-wide settings outside a designated test workspace and test player.

1. Screen Basic Info time-zone picker: whether Australian zones with and without DST and Lord Howe appear; the API `basic.time_zone` value for a Melbourne screen (section 4.1).
2. Sound/Display and the Custom Ratio dialog: exact overscan and forced-resolution field names; whether a 1920x480 canvas and a non-top-left offset are accepted (section 4.2).
3. A schedule event spanning 4 October 2026 02:00 to 03:00 in Australia/Melbourne, observed in the preview and on the test player (sections 3.6 and 4.1).
4. Screens Overview content states and the Status tab during a push of a large file to the test player: what changes, how fast, and what the player shows (sections 3.7 and 3.8).
5. The Playlists editor: transition type names, duration controls and any enforced minimum (section 3.4).
6. The Media library: processing status labels and error wording; the "Enable video original" setting; whether originals can be downloaded (section 3.3).
7. Account Settings: Custom Roles permission rows including any Delete on Screen Content; the Audit Log columns and an entry for a push; the enforce-2FA policy (section 3.1).
8. The API reference at app.yodeck.com/api-docs: rate-limit tiers, webhook catalogue, push status shape, time-zone and availability serialisation (section 3.11). Record shapes and identifiers only; do not replay captured requests.
9. Emergency alert wizard and takeover tab on the test screen: plan availability, durations, revert behaviour (section 3.6).
10. Partner console, if TINNOX holds a partner account: whether a Support Login appears in the customer account's own audit log (section 3.1).
