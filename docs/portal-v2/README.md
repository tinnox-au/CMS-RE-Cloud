# Portal v2 (milestone M1): plan and scope

Date: 2026-11-15. Status: DECIDED by TINNOX on 2026-11-15 for direction; the stage contents below are the working plan. This page supersedes the scope limits of `docs/first-prototype-agent-prompt.md` (M0) for the items it lists. Every M0 security decision (D1 to D19 in `docs/prototype-m0.md`) still binds.

Read with: `docs/yodeck-ui-observation.md` (what the reference product looks like), `docs/portal-v2/design-system.md` (how ours looks), `docs/portal-v2/stage-a.md` (the first build).

## 1. Decisions

| ID | Decision | Status |
|---|---|---|
| P2-01 | The operator portal follows Yodeck's information architecture and interaction patterns: the same sections, list pages, editors and dialogs, and over time the same functions. | DECIDED by client, 2026-11-15 |
| P2-02 | Identity is TINNOX's own: the tinnox.com.au palette and typefaces, an Apple-like finish, our own wording, an open-source icon set. No Yodeck code, image, icon, illustration, template, screenshot or sentence is reused. This answers Q25 / Q-T13: the site tokens are used now; the logo stays a text wordmark until official files arrive. **The palette and typeface part is superseded by DEC-34 (2026-11-16): an Apple-like neutral palette with one blue accent and the system typeface; the teal tokens and Manrope are dropped.** | DECIDED by client (direction); boundary PROPOSED; palette superseded by DEC-34 |
| P2-03 | Everything an operator sees says **screen**: "Screens", "Add screen", "Push to screens", and portal paths under `/screens`. Inside the code, the API paths, the contracts and the database, the object keeps its M0 name `display`. | DECIDED by client, 2026-11-15 |
| P2-04 | Status wording stays honest. The portal never says a display is "online". It reports what the player software last said: In sync, Updating, Not reporting, Error, Waiting for player, Nothing pushed, Not paired. The M0 rule "a player report is evidence from software, not proof" stands, and the unit test that bans the word stays. | PROPOSED |
| P2-05 | **Assign, then push.** A display has assigned content (in stage A: one playlist). Editing or assigning changes nothing on a display. "Push to screens" builds one immutable publication per chosen display, exactly as M0 publishing does. A display has changes waiting when the publication that would be built differs from the one it was last given. | PROPOSED |
| P2-06 | Features that let content from outside TINNOX reach a display (web pages, embedded pages, feeds, custom HTML) are built only after a written data-flow and threat review, run in a sandboxed frame, and stay off by default per organisation. Connectors to third-party clouds (social feeds, calendars, BI dashboards, cloud drives, stock libraries, AI generation) and billing are out of scope until TINNOX decides otherwise. | PROPOSED |
| P2-07 | Yodeck's terms of use have not been reviewed by a lawyer. The walkthrough was read-only in TINNOX's own trial account. A legal check of P2-01 before any external customer sees the product remains on the pre-customer checklist. | PROPOSED |

## 2. Stages

Each stage ends with the full test suite green and the stage usable end to end.

| Stage | Contents | Player change |
|---|---|---|
| **A. New portal, same engine** | Design system and shell; dashboard; media library (list and grid, search, sort, folders, tags, names, descriptions, default durations, where used); playlists (list, filmstrip editor, duplicate, delete); screens (list with live status, add wizard, details with tabs, tags, assigned content); push to screens; settings; audit log filters. Sections not built yet are present in the sidebar and say so. | None. Manifest v1. |
| **B. Richer content** | Media thumbnails made by the worker; availability windows; working hours; image transitions and shuffle; built-in apps that need no outside data (clock, date, countdown, ticker, QR code); multi-zone layouts with a canvas editor; schedules with a calendar, repeating events and filler content; display orientation. | Manifest v2 and player v2 (zones, item kinds, local-time rules). v1 players keep working. |
| **C. Organisation and safety** | Roles (owner, admin, editor, viewer) and user management; takeover and emergency messages; e-mail alerts when a display stops reporting; playback report; audio and PDF media; web pages under P2-06. | Small additions. |
| **Later** | Sites and display groups as workspaces, operations console, NovaStar and Huidu routes, third-party connectors. | Per route. |

## 3. Mapping from the reference product

| Yodeck section | TINNOX CMS | Stage |
|---|---|---|
| Welcome | Folded into Dashboard as a "Get set up" checklist driven by real data | A |
| Dashboard | Dashboard: screen status counters, changes waiting, recent activity, storage | A |
| Media (All, Images, Videos) | Media library | A |
| Media (Audio, Documents, Web Pages) | Same sidebar entries, marked "Planned" | C |
| Apps | Apps: built-in set only | B |
| Playlists | Playlists | A (transitions, shuffle: B) |
| Layouts | Layouts | B |
| Schedules | Schedules | B |
| Screens | Screens, with TINNOX's custom pixel canvas and content rectangle kept | A (working hours, orientation: B; alerts: C) |
| Push to Screens | Push to screens | A |
| Users, Groups, Roles | Users | C |
| Audit Log | Audit log | A |
| Account Settings | Settings | A (rows grow per stage) |
| Workspaces | Organisation label now; sites and groups later | Later |
| Emergency Alerts, Takeover | Emergency messages, Takeover | C |
| Subscription, billing, player shop, AI, stock, cloud drives | Not built | Out of scope |

## 4. What must not regress

Tenant isolation through forced row-level security; organisation taken only from the session; CSRF token plus exact Origin on every state-changing route; immutable publications with idempotent creation; signed, short-lived media URLs; the isolated media worker; the strict portal Content-Security-Policy; no web storage in the portal; no remote fonts, scripts or analytics; synthetic data only; a failed update never interrupts what a display is playing.
