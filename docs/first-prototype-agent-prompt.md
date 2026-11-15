# TINNOX CMS: browser-first prototype build prompt

Prepared November 13, 2026. Copy the prompt below into a coding agent working in this repository. It authorizes local implementation and testing of the first prototype, not production deployment or changes to physical controllers.

---

You are implementing the first working prototype of TINNOX CMS in this repository.

## 1. Objective and boundaries

TINNOX sells LED displays and wants its own CMS. Build a real, locally runnable application that lets an operator upload an image and a video, arrange a playlist, publish it to a registered browser player, and see delivery and player status. The initial player runs in Chrome on a MacBook or PC and displays on its built-in screen or an attached monitor. No physical LED hardware is required for this milestone.

This is an internal engineering prototype. It must establish sound module boundaries and security foundations, but it is not the full commercial release described in the older documents. Use synthetic accounts and non-sensitive sample media.

Start by reading any applicable AGENTS.md, then:

- README.md
- docs/decisions-2026-11.md
- docs/tinnox-mvp-spec.md, especially principles, domain model, publishing, and security
- docs/architecture-and-hardware.md, especially delivery routes and platform boundaries
- docs/implementation-backlog.md, section 0
- docs/gaps-and-first-steps.md
- docs/open-questions.md, Q13–Q15

Treat this prompt as the current milestone scope. Preserve earlier research and record scope differences in a new milestone document. Existing PROPOSED choices are proposals, not approvals or verified compatibility claims. Check current official documentation before relying on version-sensitive technical facts. Do not repeat the whole competitor research project or require access to Yodeck.

Inspect existing code and uncommitted changes before editing. Reuse working components if implementation has begun. Give a short implementation plan, then implement, run, test, and fix the prototype. Do not stop after planning or scaffolding. Resolve routine engineering decisions independently and record them. Ask only about a genuinely blocking business decision or missing access; missing hardware and cloud credentials do not block local development. Do not spawn additional agents unless separately authorized.

## 2. First user journey

Deliver this end-to-end flow:

1. An operator signs in to the TINNOX portal.
2. The operator sees a seeded internal organization and site and creates a display with a configurable canvas size.
3. A separate browser player presents a short-lived pairing code. The signed-in operator claims it for the display, and the player becomes registered.
4. The operator uploads JPEG/PNG images and a supported MP4 video. Files persist across application restarts. Media has processing, ready, or failed status with actionable errors.
5. The operator creates an ordered playlist, chooses image durations, and uses natural video duration. Playback is muted for this milestone.
6. Publish creates an immutable publication snapshot assigned to that display. Editing the draft does not change the active publication.
7. The player retrieves the manifest, downloads and verifies all required media, and activates the complete version at an item boundary. A failed or incomplete update leaves the previous complete version playing.
8. The portal distinguishes desired publication, downloaded publication, player-reported active publication/item, last heartbeat, and delivery errors.
9. The player continues playing cached content during a network outage and reports current state when reconnected.

Provide real persistence and API calls. No simulated success states or hard-coded online indicators. A player report is evidence from software, not proof that physical LED panels are displaying the content.

## 3. Module boundaries and future hardware compatibility

Use a modular monolith with a browser player and a bounded media-validation worker. Avoid microservices, Kubernetes, plugin marketplaces, or generic workflow engines.

Use TypeScript, React, a maintained Node.js API framework, and PostgreSQL unless existing implementation provides a good reason otherwise. Select supported stable versions, pin dependencies, and document the choice. Provide a reproducible local setup suitable for macOS and Linux; containers may provide PostgreSQL, the local identity provider, and the media worker. Prefer HTTP polling with ETags for the initial player protocol. MQTT and additional infrastructure are unnecessary now.

Suggested logical layout; adapt names to existing conventions:

- apps/portal: operator UI; no vendor SDK calls.
- apps/api: authentication, authorization, persistence, media, playlists, displays, publishing, status, and audit modules.
- apps/player-web: pairing, sync, durable cache, rendering, and telemetry.
- packages/contracts: versioned API/manifest schemas, shared types, and validation.
- packages/domain: vendor-independent publication and playlist rules.
- packages/delivery: delivery-port interfaces and the implemented browser route.
- packages/storage: private media-storage interface and local implementation.
- tests: integration, security-boundary, and end-to-end tests.
- docs: decisions, runbook, threat model, and milestone evidence.

Keep domain logic free of React, browser APIs, cloud SDKs, and controller SDKs. Separate these three concerns:

- **Content model:** media references, item order/duration, canvas geometry, and publication version.
- **Delivery adapter:** how a publication reaches a supported target and which capabilities and acknowledgments that target exposes.
- **Player runtime:** how a particular device downloads, stores, and renders content.

Define a small typed delivery contract for capabilities, publication validation/preparation, delivery initiation or retrieval, and status normalization. Implement only the browser route. Do not invent methods for every possible vendor. A test-only fake can demonstrate that domain publishing is independent of browser-specific code; it must never appear as working NovaStar support in the product.

The architecture must leave room for two later LED routes:

1. **External TINNOX player to LED controller over HDMI:** a future supported player runtime feeds a compatible controller. The controller still drives the LEDs. The browser prototype helps validate software rendering, but does not establish unattended kiosk reliability, codec performance, HDMI compatibility, or controller input modes.
2. **Controller-native playback:** a future adapter translates the neutral publication into a vendor-supported format/API. NovaStar/Huidu APIs, credentials, licenses, models, firmware, network access, and data locations must be verified before implementation. Do not assume a controller can run Chromium or our application.

Separate content delivery from controller commands such as brightness, power, and hardware configuration. Do not implement controller commands now.

Give each route an explicit capability profile. Reject unsupported media/layout features before publication with an understandable explanation. Shared data does not imply identical player capabilities.

Model canvas width/height and fit mode from the start. Allow an optional content rectangle inside the output frame for later LED mapping. Validate dimensions and bounds. Demonstrate landscape, portrait, and an unusual LED-shaped canvas in software without claiming physical compatibility. Do not store playlists as HTML or arbitrary executable JavaScript.

## 4. Minimal functional scope

Implement only:

- Authentication, one operator role, and organization-scoped authorization.
- One seeded organization/site in the UI; a second isolated organization in automated tests.
- Display creation, canvas settings, browser pairing, credential revocation, and player reset.
- Private media upload/list/status and constrained validation.
- One-level playlists with reorder, item duration, and contain/cover behavior.
- Explicit publish, immutable manifest, polling, local caching, and status.
- Basic operational and security audit records.

Minimum persistent concepts: organization, membership, site, display, player registration, media, playlist/items, publication, delivery state, heartbeat, and audit event. Derive tenant context from verified identity and membership; a submitted organization ID is not authorization.

The manifest must have an explicit schema version, publication identity, canvas, ordered assets, durations, media types, byte sizes, and SHA-256 hashes. Store stable private asset references in the immutable publication. Issue temporary authorized download URLs separately so their expiration does not require mutating a publication. Scope URLs and player access to the assigned display's content; redact URLs from logs.

Initial constraints: JPEG/PNG and MP4 with supported H.264 video; muted playback; configurable conservative upload, duration, pixel, and storage limits with documented defaults. Detect unsupported codecs and report them clearly. No automatic transcoding is required now. No PDF, SVG, arbitrary websites, uploaded HTML, user scripts, nested playlists, drag-and-drop layout editor, recurring scheduling, billing, support impersonation, native mobile player, hardware provisioning, remote shell, or vendor-cloud integration.

The seeded site's IANA time zone may default to Australia/Melbourne; store event timestamps in UTC. Full scheduling and daylight-saving recurrence handling are later work.

## 5. Browser player reliability

Use durable browser storage such as IndexedDB/Cache Storage, with a service worker where appropriate. Cache the player shell and media needed for the last complete publication. Namespace caches by player registration and organization. Verify asset bytes before marking a publication ready, commit activation atomically, and preserve the previous version if download, integrity verification, storage allocation, or playback validation fails.

Handle quota failures, network errors, unsupported media, malformed manifests, and interrupted updates visibly. Garbage collection must not remove assets still needed by the active version. Do not cache portal pages, operator credentials, or unrelated private API responses in the service worker.

Test continued playback through an outage and an offline reload after a successful download. Document browser eviction, private browsing, tab suspension, autoplay, and OS restart limitations. Request persistent storage where supported, but do not imply the browser guarantees durable retention or automatic boot recovery. Clearly distinguish tested browser offline behavior from future dedicated-player guarantees.

Revocation stops future API/media authorization promptly; it cannot remotely erase an already offline device. Define this behavior explicitly. Provide a local reset that removes registration and cached content. Do not permit reassignment to another organization while preserving the previous organization's cache.

## 6. Security controls required in this milestone

Write a concise threat model before implementation and update it to match the built system. Include the portal, API, identity provider, media worker/storage, player, pairing flow, organization boundary, and future controller boundary. Consider malicious uploads, cross-organization access, stolen pairing codes, replay, XSS, CSRF, compromised players, and incomplete updates.

Implement:

- **Identity:** maintained OIDC authentication using authorization code flow and PKCE as appropriate. A real local identity provider with test accounts is acceptable; use its MFA capability for operator login. Do not create a custom password/MFA system or ship an authentication bypass. Keep identity-provider integration replaceable for a later reviewed AU-hosted provider.
- **Sessions:** secure session handling, expiry, logout, server-side authorization, appropriate HttpOnly/SameSite cookies and CSRF protection. Secure cookies and HTTPS outside an explicit loopback-only development configuration. Do not store operator bearer tokens in localStorage. Production-mode startup must reject development credentials/settings.
- **Organization isolation:** authorization on every query, mutation, media download, publication, and player endpoint. Use PostgreSQL row-level security as defense in depth with a non-owner/non-BYPASSRLS runtime role; transaction-scoped tenant context must use the same pooled connection. Migration credentials are separate. Test actual database policies, not only UI filtering.
- **Pairing/device access:** random, expiring, one-time codes; authenticated claiming; attempt limits; atomic claim to prevent races. Each registered player gets its own revocable, display-scoped credential, with a separate lifecycle from human sessions. Avoid secrets in URLs or logs. Document the browser credential mechanism and its exposure limits.
- **Private media:** authorization before granting access, non-public storage, opaque object keys, narrowly scoped temporary URLs where used, and no path traversal or user-controlled storage paths. Store files outside executable/static application directories. No arbitrary URL imports in this milestone.
- **Upload validation:** enforce size limits while receiving bytes; inspect actual file type and codec, not just extensions. Inspect media with bounded time, memory, CPU, and disk in an isolated unprivileged worker with no network access or application secrets. Never interpolate filenames into shell commands. Reject invalid files before publishing them.
- **Web/API hardening:** schema validation, parameterized queries, output escaping, restrictive CSP, appropriate content-type/nosniff headers, exact CORS allowlists, and rate limits for authentication/pairing/uploads and costly operations. Avoid arbitrary HTML execution. Check origin and CSRF defenses for cookie-authenticated actions.
- **Secrets and audit:** no committed credentials, private keys, tokens, or sample production secrets. Keep meaningful audit events for login, pairing/revocation, uploads, and publishing, with actor, organization, object, result, and UTC time. Do not log file content, secrets, or signed download URLs. Limit audit mutation privileges and document residual database-admin access.
- **Supply chain and recovery:** dependency/secret scanning, committed lockfile, CI checks, documented update process, and a backup/restore exercise covering database plus media references. Track actionable findings and unresolved exceptions honestly.

Browser players are untrusted clients. Never authorize operator actions based on player reports. Validate telemetry, enforce payload limits, and reject reports for another display or publication.

## 7. Australian security and privacy alignment

Use the official references at the end as a baseline and recheck them when building. Separate engineering controls, organizational responsibilities, and legal applicability. Do not claim that a prototype is legally compliant, certified, ISO 27001 certified, IRAP assessed, or Essential Eight maturity level compliant simply because controls exist in code or an AWS service has an assessment.

For this milestone:

- Apply ASD/ACSC Secure by Design and Secure by Default principles and relevant ISM software-development guidance. Record requirement, implementation, test evidence, and remaining gap in a security matrix.
- Treat Essential Eight as guidance for the development/operating environment; it does not replace application threat modeling or establish a universal legal requirement for this CMS.
- Design for data minimization, access control, deletion, and configurable justified retention. Do not treat the older documents' 24-month/7-year retention proposals as universal legal obligations. Avoid unnecessary personal information in telemetry and audit records.
- Record that TINNOX must determine Privacy Act/APP and NDB applicability, customer contractual obligations, and any sector/state-specific requirements before external customer use. Implement useful safeguards regardless of the applicability outcome.
- Provide a short incident-response runbook with containment, evidence preservation, assessment, escalation, and notification responsibilities. Where NDB applies, distinguish the requirement to take reasonable steps to complete an assessment within 30 days from prompt notification once an eligible breach is established. Thirty days is not a grace period to defer action.
- Preserve TINNOX's AU-hosting preference as a product requirement. Describe a future AWS Sydney deployment with optional Melbourne backups, but do not provision it in this task. Inventory locations for application data, media, identity, logs, backups, analytics, error reporting, and support access. Local development uses synthetic data and is not evidence of hosted data residency.
- Do not add third-party analytics, remote fonts, vendor clouds, or external error reporting by default. Document external build-time services separately from production data flows.
- Correct one known source error in the milestone decision record: CloudFront has no Australia-only price class; price classes are not an Australian data-residency control. Start with private local storage and a documented path to regional S3 delivery. Any later CDN or offshore provider needs a separate data-flow review.
- Australian hosting alone does not satisfy all privacy/security responsibilities. APP 8 addresses overseas disclosures; do not present it as a blanket rule that all Australian software must store all data in Australia.

Make a short pre-customer-release checklist covering applicable obligations, privacy notice, retention, provider/location review, production identity/MFA, TLS, infrastructure security, restore testing, incident ownership, and an independent security review. Mark which items are implemented, tested, deferred, or require TINNOX input. These external-release tasks must not prevent completing the local prototype.

## 8. Verification and definition of done

Use automated integration tests and browser E2E tests, plus visual inspection. Verify at least:

1. Fresh setup, migrations, identity setup, and sample seeding work from documented commands; the app survives restart with data intact.
2. Operator sign-in/MFA, display creation, player pairing, upload, playlist, publish, download, and actual image/video playback work end to end in separate browser contexts.
3. Pairing codes expire, cannot be reused, and cannot be claimed twice concurrently. Revoked credentials cannot retrieve new manifests or media.
4. Cross-organization object, media, publication, and player access fail through direct API requests and database policies.
5. Upload limits, disguised/invalid files, path traversal attempts, and unsupported codecs fail safely. Unready media cannot be published.
6. Published snapshots remain unchanged after draft edits. Publishing retries are idempotent. Delayed telemetry cannot overwrite newer delivery state.
7. Corrupt or interrupted downloads and insufficient cache space preserve the previous complete playlist. No partial version is activated.
8. Cached playback continues during a test outage and an offline reload works. Report the tested outage duration; do not claim an unperformed 24-hour soak.
9. Portrait and unusual canvas dimensions render with correct contain/cover behavior. The player reports runtime playback errors rather than claiming success.
10. Portal last-seen/active publication reflects actual telemetry, marks stale reports, and distinguishes desired/downloaded/reported-playing states.
11. Local reset removes cached content and credentials; reassignment cannot leak a prior organization's media.
12. Type checking, lint, build, relevant tests, dependency and secret scans, and the restore exercise run with recorded results. Explain unavailable checks instead of claiming they passed.

Include a short manual walkthrough with exact URLs and setup commands. Test fixtures must not introduce known default credentials into deployment modes or real secrets into screenshots.

## 9. Deliverables and working behavior

Deliver working source code, database migrations, reproducible local configuration, synthetic seed data, tests, and CI configuration. Update README with setup, run, test, and reset instructions. Add:

- docs/prototype-m0.md: scope, assumptions, architecture, module boundaries, and decisions.
- docs/player-protocol-v1.md: schemas, authentication, state transitions, cache activation, and capability negotiation.
- docs/security/threat-model.md and docs/security/control-matrix.md.
- docs/security/operations-and-release-checklist.md: incident, backup/restore, retention, and pre-customer checks.
- docs/prototype-validation.md: commands, real outcomes, browser/environment, visual evidence, and limitations.
- docs/hardware-next-step.md: what to obtain for one NovaStar test—exact model/firmware, video input and mode, canvas/output dimensions, existing software, API access if needed, and acceptance checks for HDMI versus native playback.

Keep documentation proportionate; do not turn this milestone into another research-only exercise. Record unresolved hardware questions without inventing compatibility. No production deployments, paid resource creation, controller configuration/key writes, or changes to existing customer displays are authorized by this prompt.

Finish with what works, how to run and demonstrate it, test results, known limitations, and the smallest next hardware experiment. Clearly state that this is an internal browser prototype, with NovaStar compatibility still awaiting model-specific integration and hardware tests.

## Official reference material

These support the security design; exact applicability must be evaluated separately. Recheck current guidance and record the date accessed.

- ASD/ACSC, Secure by Design foundations: https://www.cyber.gov.au/publication/secure-by-design-foundations
- ASD/ACSC, ISM guidelines for software development (September 2026 edition; check for newer editions): https://www.cyber.gov.au/ism/2026-09/guidelines-for-software-development
- ASD/ACSC, Essential Eight explained: https://www.cyber.gov.au/business-government/asds-cyber-security-frameworks/essential-eight/essential-eight-explained
- OAIC, APP guidelines: https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines
- OAIC, APP 11: https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information
- OAIC, APP 8: https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-8-app-8-cross-border-disclosure-of-personal-information
- OAIC, Privacy Act coverage for small businesses: https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business
- OAIC, NDB assessment and notification: https://www.oaic.gov.au/privacy/notifiable-data-breaches/preventing-preparing-for-and-responding-to-data-breaches/data-breach-preparation-and-response/part-4-notifiable-data-breach-ndb-scheme
- AWS, CloudFront DistributionConfig/PriceClass: https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_DistributionConfig.html
