# Portal v2, stage A: build spec

Date: 2026-11-15. Binding for stage A. Read `README.md` and `design-system.md` in this folder first. Where this page and existing code disagree about behaviour that M0 tests assert, keep the M0 behaviour and say so in section 6.

> **Naming (decided by TINNOX, 2026-11-15):** everything an operator sees says **screen**: "Screens", "Add screen", "Push to screens", and the portal paths are `/screens`. Old `/displays` paths redirect to their `/screens` equivalents. Inside the code, the API paths (`/api/displays`), the contracts and the database, the object keeps its M0 name `display`; that is not renamed. Sections 2 and 7 below therefore still say "display".

## 1. Routes and navigation

| Path | Page | `h1` |
|---|---|---|
| `/` | redirect to `/dashboard` | |
| `/dashboard` | Dashboard | Dashboard |
| `/media`, `/media/images`, `/media/videos` | Media library filtered by kind | All media, Images, Videos |
| `/media/audio`, `/media/documents`, `/media/web-pages` | Planned page | Audio, Documents, Web pages |
| `/media/:id` | Media details | the media name |
| `/apps`, `/layouts`, `/schedules`, `/users` | Planned page | Apps, Layouts, Schedules, Users |
| `/playlists` | Playlists | Playlists |
| `/playlists/:id` | Playlist editor | the playlist name |
| `/screens` | Screens | Screens |
| `/screens/new` | Add screen wizard | Add screen |
| `/screens/:id` | Screen details (tabs) | the screen name |
| `/screens/:id/edit` | redirect to `/screens/:id?tab=canvas` | |
| `/settings` | Settings | Settings |
| `/settings/tags` | Tags | Tags |
| `/audit` | Audit log | Audit log |
| `/styleguide` | Component gallery, development builds only | Style guide |

Sidebar, top to bottom: Dashboard; Media (group: All media, Images, Videos, Audio, Documents, Web pages); Apps; Playlists; Layouts; Schedules; Screens. Bottom: Settings. Entries whose page is a Planned page carry a small "Planned" pill. Account menu: Settings, Users, Audit log, Sign out.

A **Planned page** is an `EmptyState` that says in one sentence what the section will do and which stage brings it (from `README.md` section 2). It has no fake controls.

## 2. Backend additions

All follow the recipes in the codebase map: strict zod contracts first, a new migration `db/migrations/0005_portal_v2_stage_a.sql`, routes inside the operator plugin, `withOrg`, `auditScoped`, DTOs validated by the portal.

### 2.1 Schema

| Change | Detail |
|---|---|
| `tag` (new) | `id`, `org_id`, `scope` (`media` or `display`), `name` (1 to 40 characters), `colour` (one of `teal`, `sky`, `slate`, `green`, `amber`, `red`, `violet`, `pink`; default `teal`), timestamps. Unique on `(org_id, scope, lower(name))`. |
| `media_tag`, `display_tag` (new) | Join tables carrying `org_id`, composite foreign keys, `ON DELETE CASCADE` from both sides. |
| `folder` (new) | Flat media folders: `id`, `org_id`, `name` (1 to 80), timestamps. Unique on `(org_id, lower(name))`. |
| `media` | Add `name` (nullable, up to 120; the shown name is `name` or else `original_name`), `description` (nullable, up to 500), `default_duration_ms` (nullable, within the image-duration limits), `folder_id` (nullable, composite foreign key, `ON DELETE SET NULL (folder_id)`). |
| `playlist` | Add `description` (nullable, up to 500) and `deleted_at`. Every existing playlist query must ignore deleted rows. |
| `display` | Add `description` (nullable, up to 500) and `assigned_playlist_id` (nullable, composite foreign key to `playlist`). Grant column UPDATE for both to `tinnox_app`. Backfill `assigned_playlist_id` from each display's desired publication (the migration must lift and restore forced row-level security inside its transaction to do this; the forced-table test must still pass). |

Every new table: `ENABLE` and `FORCE ROW LEVEL SECURITY`, the `tenant_isolation` policy, explicit grants, the guard block, an entry in the tenant-table tests.

### 2.2 API

| Method and path | Purpose | Notes |
|---|---|---|
| `PATCH /api/media/:id` | Set `name`, `description`, `defaultDurationMs`, `folderId`, `tagIds` (any subset, at least one) | Audit `media.update`. `defaultDurationMs` only on images. Unknown folder or tag id answers 404. |
| `GET /api/media/:id/usage` | Where a media item is used | `{ playlists: [{id, name}], displays: [{id, name}] }`; displays are those whose current desired publication contains the item. |
| `GET /api/media` | Unchanged path | `MediaDto` gains `name` (resolved, never null), `description`, `defaultDurationMs`, `folderId`, `tagIds`, `usageCount` (playlists that contain it). |
| `GET, POST /api/tags`; `PATCH, DELETE /api/tags/:id` | Tag management | `GET` takes `scope`. `TagDto { id, scope, name, colour, usageCount }`. Duplicate name answers 409 `conflict`. Audit `tag.create`, `tag.update`, `tag.delete`. |
| `GET, POST /api/folders`; `PATCH, DELETE /api/folders/:id` | Folder management | `FolderDto { id, name, itemCount }`. Deleting a folder moves its media to the root. Audit `folder.create`, `folder.update`, `folder.delete`. |
| `PUT /api/playlists/:id` | Unchanged | `PlaylistReplaceSchema` gains optional `description`. |
| `GET /api/playlists` | Unchanged path | `PlaylistSummaryDto` gains `description`, `totalDurationMs`, `kinds` (media kinds present), `previewMediaIds` (first four distinct media ids), `assignedDisplayCount`. `PlaylistDto` gains `description`. |
| `POST /api/playlists/:id/duplicate` | Copy a playlist with its items | Name "Copy of X", trimmed to the limit. Audit `playlist.create` with `detail.duplicatedFrom`. |
| `DELETE /api/playlists/:id` | Delete a playlist | 409 `playlist_in_use` (new error code) while any display has it assigned. Otherwise soft delete (`deleted_at`). Audit `playlist.delete`. |
| `PATCH /api/displays/:id` | Existing | Also accepts `description`, `tagIds`, `assignedPlaylistId` (nullable). Assigning changes nothing on the display until a push. |
| `GET /api/displays` | Existing | `DisplayDto` gains `description`, `tagIds`, `assignedPlaylist` (`{id, name}` or null). |
| `GET /api/displays/status` | Status of every display in one call | `{ items: DeliveryStatusView[] }`, same builder as the single-display route. |
| `POST /api/playlists/:id/publish` | Existing | Also sets the display's `assigned_playlist_id` to this playlist, in the same transaction. |
| `GET /api/push` | The push plan | One row per display: `{ display: {id, name}, playlist: {id, name} or null, state, issues, lastPushedAt }`, plus `pendingCount`. `state` is `nothing_assigned`, `never_pushed`, `changes`, `up_to_date` or `blocked` (the assigned playlist cannot be published; `issues` say why, in the same shape as a publish rejection). |
| `POST /api/push` | Push to chosen displays | Body `{ displayIds }` (1 to 200), header `Idempotency-Key`. Each display is its own transaction and its own immutable publication, created by the same code path as publishing. Response `{ results: [{ displayId, outcome, publicationId, issues }] }` with `outcome` `published`, `unchanged`, `rejected` or `skipped`. A replay with the same key returns the same publications. Audit `publication.create` per display with `detail.via = 'push'`. Rate limit 30 a minute. |
| `GET /api/overview` | Dashboard numbers | `{ displays: { total, paired, bySummary }, media: { total, ready, processing, failed, usedBytes, limitBytes }, playlists: { total }, pendingPushCount }`. |
| `GET /api/audit` | Existing | Optional `category` (the part of the action before the first dot) and `result` filters. |

"Changes waiting" is decided by a new pure domain function that compares the publication draft that would be built now (`planPublication`) with the manifest of the display's desired publication: canvas, content rectangle, and the ordered list of asset id, hash, duration and fit. It lives in `packages/domain` with unit tests.

### 2.3 Tests required with the backend

Unit tests for the new domain function and contract schemas. Integration tests for every new route, including: another organisation's object answers 404; every state-changing route is in the CSRF and Origin test list; row-level security lists; replaying a push with the same key creates nothing new; pushing a blocked display reports `rejected` and leaves the previous publication desired; deleting an assigned playlist is refused; the migration backfill on a database that already holds publications.

## 3. Pages

### 3.1 Dashboard

- **Get set up** card, shown until all four steps are done: add a screen, pair its player, upload media, push a playlist. Each step shows done or not from real data and links to the place to do it.
- **Screens** card: four counters as links to the filtered list: In sync, Changes or updating, Needs attention (error, not reporting), Not paired. Under them, up to five screens that need attention with their status pill.
- **Changes waiting** card: the number from the push plan and a "Review and push" button that opens the push dialog. "Everything is up to date" when zero.
- **Recent activity**: the last ten audit events in plain words ("Playlist updated: Reception loop"), with time and a link to the object where it exists.
- **Library** card: counts of media and playlists, and the storage meter.
- Refreshes every 15 s while the tab is visible.

### 3.2 Media library

- The list page pattern from the design system. Columns: checkbox, thumbnail and name, Kind, Details (dimensions; length for video), Size, Tags, Modified, Status, actions. Narrow screens drop Size, then Details.
- Filters: search by name; folder (a row of folder chips: All, each folder, with "New folder"); tag chips (multi-select); status (Ready, Processing, Failed).
- Sorting by Name, Modified, Size. Client-side pagination (10, 25, 50, 100). List or grid.
- **Add media** opens the dialog: tabs Upload (active), and Stock, Web page, Document, Audio shown disabled with "Planned". Upload has a drop zone and a file button, accepts several files, shows one row per file with progress, cancel, and the server's verdict; it keeps the M0 sequential queue and never judges the file type in the browser. Dropping files anywhere on the library page opens the dialog with those files.
- Row menu: Open, Add to playlist (dialog listing playlists; appends and saves), Move to folder, Edit tags, Delete. Bulk: Move to folder, Add tags, Delete.
- Processing rows refresh every 2 s. Failed rows show the reason and the API error code as text, as M0 does.
- Storage meter in the toolbar row.

### 3.3 Media details

Two columns. Left: preview (image, or video with controls), then facts (kind, dimensions, length, codec, size, uploaded, SHA-256 shortened with copy, ID with copy), then **Used in** (playlists and screens as links). Right: Name, Description, Default duration (images only; a stepper in seconds; used when the item is added to a playlist), Folder, Tags (picker with create-on-the-fly). Save and Cancel in the header; a split Save offers "Save and add to playlist". Delete in a quiet danger button; the server's refusal (`media_in_use`) is shown as text.

### 3.4 Playlists

- List columns: checkbox, a four-up thumbnail mosaic and name, Description, Items, Length, Screens (how many have it assigned), Modified, actions. Row menu: Open, Assign to screen (dialog), Duplicate, Delete.
- **New playlist** is a small dialog asking for the name, then opens the editor.

### 3.5 Playlist editor

- Header: back link "All playlists", name as `h1` (editable in place through a Name field below), status label Saved or Unsaved changes, Discard, Save.
- Details row: Name, Description.
- **Sequence** card: a horizontal filmstrip of tiles in play order. Each tile: thumbnail, name, position number, a duration stepper in seconds for images, the fixed length for videos, a fit menu (Screen default, Contain, Cover), move earlier, move later and remove buttons, all keyboard operable. Tiles reorder by drag and drop with the HTML drag-and-drop API, with the buttons as the accessible equivalent. Card header shows "N items" and "Loop length m:ss". An empty strip shows a drop target that says to add items from the library below.
- **Library** card under it: search, kind chips (All, Images, Videos), folder and tag filters, a grid of ready media. Clicking a card, pressing Enter on it, or dragging it to the strip appends it. Images use their default duration, or 10 s.
- **Push** card: lists the screens that have this playlist assigned with their push state, an "Assign to screens" button (as built: it opens the multi-screen picker, see section 8), and "Push now" (pushes this playlist's screens through `POST /api/push`). Push is disabled while there are unsaved changes. Server refusals are shown in full, as M0 does.
- Leaving with unsaved changes asks for confirmation (the M0 blocker stays).

### 3.6 Screens

- List columns: checkbox, name, Status (pill from the delivery summary, plus "last report 12 s ago"), Content (assigned playlist as a link, with a "Changes waiting" marker), Site, Canvas, Tags, actions. Filters: search, status chips, tag chips. Grid view shows a canvas-shaped tile with the status pill. Row menu: Open, Assign content, Push now, Revoke player. Bulk: Assign content, Add tags, Push.
- Status refreshes every 10 s through `GET /api/displays/status`.

### 3.7 Add screen wizard

Three steps with a progress header: **Details** (name, site, canvas presets and custom width and height, optional content rectangle, default fit, with the canvas-shape preview), **Pair** (the screen is created; enter the code the player shows; "Skip for now" is allowed), **Content** (choose a playlist to assign, or skip). Finish opens the screen's page. The M0 validation rules and messages stay.

### 3.8 Screen details

- Left card: a canvas-shaped preview frame showing the assigned playlist's first item (a mock of the content, clearly labelled "Assigned content preview", never presented as a screenshot of the screen), the status headline with its M0 test ids and data attributes, last report, and buttons **Push to this screen** and a menu (Revoke player).
- Right: Name, Description, Site (read-only), and **Content**: the assigned playlist with Change and "Open playlist", and the push state for this screen.
- Tabs: **Overview** (the M0 live-status facts: desired, downloaded, active, player state, errors); **Canvas** (the M0 canvas, content rectangle and fit form); **Pairing** (pair, replace, revoke, as M0); **Tags**; **Planned** tabs shown disabled with a tooltip naming the stage: Working hours, Alerts, Advanced.
- Status keeps polling every 5 s so the stale flag flips without a reload.

### 3.9 Push to screens (dialog)

Opened from the header button, the dashboard, a playlist and a screen. Lists every screen from the push plan in groups: Changes waiting (ticked by default), Blocked (not selectable, with the issues), Up to date, Nothing assigned. Each row: screen name, playlist name, state. Primary button "Push to N screens". After the call, each row shows its outcome; rejected rows show the issues. One idempotency key per opening of the dialog, reused only while the outcome is unknown. The header button shows the pending count and refreshes it every 30 s and after any save.

### 3.10 Settings, Tags, Audit log

- **Settings**: a list of rows in groups, each with an icon, title, one-line description and current value: Organisation (name, read-only); Content (Media tags, Screen tags, Folders); Security (Audit log; Sign-in and MFA, read-only note that sign-in is handled by the identity provider); Planned (Users and roles, Working hours, Alerts, API tokens), marked with the stage.
- **Tags**: two tabs, Media tags and Screen tags; list with name, colour, usage count; create, rename, recolour, delete (confirm names how many items lose the tag). Folders are managed from the media library and listed here read-only with counts.
- **Audit log**: the list page pattern; columns Time, Action (in plain words, with the raw action as small monospace text), Result, Actor, Object, Detail (expandable); filters by category and result; "Load older" paging as M0.

## 4. Frontend structure

As built (the folders below are the real ones; `apps/portal/README.md` describes how a page is put together):

- `src/styles/`: `tokens.css`, `base.css`, one file per component group, imported from `src/styles/index.css`. The M0 stylesheet (`legacy.css`) and the M0 pages and components were deleted once every page was rebuilt.
- `src/ui/`: the components from the design system, one file each, exported from `src/ui/index.ts`; API reference in `src/ui/README.md`.
- `src/shell/`: `AppShell.tsx`, `Sidebar.tsx`, `PageHeader.tsx`, `Page.tsx`, `EditorPage.tsx`, `AccountMenu.tsx`, `PushButton.tsx`, navigation data in `nav.ts`.
- `src/features/<area>/`: page components and their parts, one CSS file per area: `dashboard`, `media` (`library/`, `detail/`), `playlists` (`list/`, `editor/`), `displays` (`list/`, `wizard/`, `detail/`; this is the code name of the operator's "Screens"), `push` (the provider and the push dialog), `settings` (settings and tags), `audit`, `planned`, `shared` (tags, folders, thumbnails, pickers, status pills, the leave guard) and `styleguide`.
- `src/lib/`: pure logic with unit tests (list filtering, sorting and paging; status presentation; drafts; push dialog state; activity wording).
- Data: the existing `useLoad` pattern and `api.*` endpoints. No new state or data-fetching library.
- New dependencies, exact versions, installed with the repository's pinned npm: `lucide-react`, `@fontsource-variable/inter`, `@fontsource-variable/manrope`. Nothing else.

## 5. Tests required with the frontend

- Unit tests beside every new `src/lib` module.
- The Playwright specs are rewritten for the new screens and must cover at least what they cover today (the journey, canvases, isolation, portal details, hardening), plus: the dashboard loads with real counters; push to screens from the header publishes to a screen and the player switches; a tag can be created and filters the library; the portal origin still has no web-storage keys; and no Content-Security-Policy violation is reported by the browser during the journey.
- Locators use roles, labels and `data-testid`; the three old class selectors go away.

## 6. Deviations from M0 behaviour

| M0 | Stage A | Why |
|---|---|---|
| Top navigation bar | Left sidebar and sticky header | P2-01 |
| Sign-in lands on Screens | Sign-in lands on Dashboard | P2-01 |
| Publish from the playlist editor to one chosen screen | Assign content to screens, then push; the old publish route stays and also records the assignment | P2-05 |
| "Sign out" button in the top bar | "Sign out" in the account menu | P2-01 |
| System fonts | Self-hosted Inter and Manrope | P2-02 |

## 7. Stage A API as built

Written 2026-11-15 by the backend step. Sections 2.2 and 2.3 are implemented as written unless a row below says otherwise. Nothing here changes behaviour that an M0 test asserts.

### 7.1 Where the code lives

| Area | Files |
|---|---|
| Publishing, shared by publish, the push plan, push and the dashboard | `apps/api/src/publishing.ts` |
| Routes | `apps/api/src/routes/{media,playlists,displays,tags,folders,push,overview,audit}.ts`, registered in the operator plugin in `apps/api/src/app.ts` |
| Portal client | `apps/portal/src/api/endpoints.ts` |
| Tests | `apps/api/test/{library,playlists,push,dashboard,audit-trail}.integration.test.ts`, `tests/integration/{cross-org,session-csrf,migration-backfill}.test.ts`, `packages/db/test/{portal-v2,migration-0005}.integration.test.ts`, `apps/portal/src/api/endpoints.test.ts` |

There is one way to build a publication. `POST /api/playlists/:id/publish` and `POST /api/push` both take the publish key lock (`lockPublishKey`), look for a publication already made under the key (`findPublicationByKey`), lock the display (`lockDisplayForPublish`), plan with `planDraft` (the domain rule plus the route's capability profile) and create with `createPublication`. The push plan and the dashboard run the same `planDraft` through `assessDisplays` and compare its draft with the display's current manifest using `decidePushState` from `@tinnox/domain`, so what a push would do and what a push does cannot drift apart.

### 7.2 Deviations from sections 2.1 to 2.3, and additions

| Spec | As built | Why |
|---|---|---|
| `GET /api/tags` "takes `scope`" | `scope` is optional. Without it the tags of both scopes are listed, display tags first. | One call serves the Tags page with its two tabs. |
| No limit on tags or folders | At most 10,000 tags and 10,000 folders per organisation (`ABSOLUTE.maxListItems`). Creating one more answers 409 `conflict`. | The lists have no paging and the portal refuses a list longer than that. |
| Lists without paging | `GET /api/tags`, `/api/folders`, `/api/displays/status`, `/api/push` and each list of `/api/media/:id/usage` return at most 10,000 rows. | Bounded answers. `GET /api/displays`, `/api/media` and `/api/playlists` are as unbounded as they were in M0. |
| `DELETE /api/playlists/:id` is a soft delete | The row is kept with `deleted_at` and its `playlist_item` rows are removed in the same transaction. The 409 `playlist_in_use` answer lists up to five of the displays in `details` (`path: "display"`, `message`: the display name). | A deleted playlist must not hold media back: `media_in_use`, `usageCount` and the usage route see only live playlists. Publications are snapshots and are not affected. |
| `media_in_use` | Decided by live playlists only. | Follows from the row above. |
| `PATCH /api/media/:id` | `name: null` or an empty string returns the item to its file name. `defaultDurationMs` on a video, or outside `minImageItemDurationMs` to `maxImageItemDurationMs`, answers 400 `validation_failed` with `details[0].path = "defaultDurationMs"`; `null` is accepted for a video. A request that changes only tags leaves `updatedAt` as it was. | The database allows the full 24 hours; the configured image limits are narrower. Tags are not part of the row. |
| `PATCH /api/displays/:id` | A request that changes only tags leaves `updatedAt` as it was. The audit event carries `detail.assignedPlaylistId` when an assignment was sent. An unknown, foreign or deleted playlist, an unknown tag and a media tag all answer 404. | Same rule as media. |
| `TagDto.usageCount`, `FolderDto.itemCount` | Media that was deleted but is kept for a publication is not counted. | It is not in the library any more. |
| `POST /api/playlists/:id/publish` | Also assigns, as specified. The display row is now locked `FOR NO KEY UPDATE` instead of `FOR SHARE`. The audit event gains `detail.via = "publish"`. A repeat with an old key returns the old publication and does not assign again. A refused publish assigns nothing. | The assignment is an UPDATE of the row publishing has locked; taking the stronger lock at the start avoids a lock upgrade, and with it a deadlock between two publishes to one display. |
| `POST /api/push`, replay | The key is checked per display before the display's state is decided. A display that got a publication under the key answers `published` with that publication for ever. A display that answered `unchanged`, `skipped` or `rejected` stored nothing, so a repeat decides it afresh: if its playlist changed or was fixed in between, the repeat publishes it. | Only a created publication can be remembered; the outcomes that write nothing are safe to recompute. The portal uses one key per opening of the push dialog. |
| `POST /api/push`, key space | Publish and push share the unique key per display. A key that was used to publish to a display answers `published` with that publication in a push. | One index, one rule: a key names at most one publication per display. |
| `POST /api/push`, unknown display | Every id is checked first. An unknown id, or a display of another organisation, answers 404 for the whole request before anything is written. | As specified in the task; stated here because the spec table does not say it. |
| `POST /api/push`, order | Displays are pushed one after another, each in its own transaction. Results are in request order. A rejected display writes one audit event (`publication.create`, `failure`, `detail.via = "push"`, `detail.reasons`) and nothing else. If the database refuses a write part of the way through (a file changed under the push), the request answers 409 `conflict`; displays already done keep their publications and a repeat with the same key carries on. | One connection per request, however many displays. |
| Push states | A display whose stored manifest no longer parses is reported as `changes`. A display whose assigned playlist cannot be published is `blocked` whether or not it has a publication; `blocked` is not counted as pending. | A push would replace the first and be refused for the second. |
| What counts as a change | Besides canvas, content rectangle and the ordered asset id, hash, duration and fit, the comparison covers size in bytes, media type, kind and pixel size. Names, descriptions and tags are not content. An explicit fit equal to the display's default is not a change. Assigning another playlist with identical content is not a change. | Everything a player is given is compared; nothing else is. |
| `GET /api/push`, `GET /api/overview` | Computed from stored facts on every request, with no cache. The plan takes four queries for the displays, their playlists and media, then one query for every 100 displays (`MANIFEST_BATCH_SIZE`) to read the current manifest (up to 1 MiB) of each display that has a playlist assigned. A manifest and the draft it is compared with are dropped as soon as the display's state is decided, so memory is bounded by one batch, not by the number of displays. The overview adds four queries to the plan's. | Correct first, with bounded memory. The work still grows with displays times playlist items; if the dashboard polling becomes costly with many displays, store a content hash beside each publication and compare hashes. |
| `GET /api/audit` filters | `category` must be one of `AUDIT_CATEGORIES` and `result` one of `AUDIT_RESULTS`; anything else answers 400. Paging with `before` keeps the filters. The category is a stored generated column of `audit_event` (`category`, computed by the database from `action`; no role can write it), and the filter is `category = $n`. | Strict input; the two indexes of migration 0005 serve the filters. An index on the expression `split_part(action, '.', 1)` would not: under row-level security the planner uses only leakproof conditions as index conditions, `split_part` is not leakproof, and the filter would read the audit rows of every organisation. `packages/db/test/portal-v2.integration.test.ts` checks the plan as the runtime role. |
| Identifiers in addresses | A UUID in a path is accepted in either letter case and handled in lower case (`IdParamSchema`), on every operator route, the M0 ones included. Identifiers in audit events (`objectId`, `detail.assignedPlaylistId`, `detail.duplicatedFrom`) are therefore always lower case. | One spelling per object in the audit trail; before, an event named its object as the address was typed. |
| Rate limits | `POST /api/push` 30 a minute, as specified. The other new routes fall under the global limit of 600 a minute. | The spec names no other limit. |
| Bulk changes | Moving files to a folder and changing tags on many files or screens send one `PATCH` per item, one after another (`runInSequence`). An item answered 429 `rate_limited` is not counted as failed: the portal waits as long as the `Retry-After` header says (at least 1 s, at most 60 s, up to five times per item) and sends it again, keeping "Saving n of N" on screen. Bulk routes (`PATCH /api/media/bulk`, `PATCH /api/displays/bulk` with a capped list of ids, one transaction, one audit event per item, per-item outcomes) are left to a later stage. | A throttled request was not carried out, so sending it again cannot apply it twice; a selection of more than about 600 items would otherwise fail part way through the global limit. |

### 7.3 Portal endpoints

Existing method names are unchanged. New on `api`: `listDisplayStatuses`, `getMedia`, `patchMedia`, `getMediaUsage`, `listTags(scope?)`, `createTag`, `patchTag`, `deleteTag`, `listFolders`, `createFolder`, `renameFolder`, `deleteFolder`, `duplicatePlaylist`, `deletePlaylist`, `getPushPlan`, `push(displayIds, idempotencyKey)`, `getOverview`. `listAudit` also takes `category` and `result`. `patchDisplay` and `replacePlaylist` accept the new fields through the shared types.

### 7.4 To run it

The development database has to be migrated once (`npm run db:migrate`) before the running API can serve these routes; this step did not do that. Until then the media, playlist and display routes fail on the missing columns.

## 8. Stage A portal as built

Written 2026-11-16 by the integration step. Section 3 is built as written except for the rows below. Every M0 safeguard stays (leave guards, idempotency keys reused only while an outcome is unknown, API error codes shown as text, the `status-*` test ids with `data-summary` and `data-stale`, polling of the screen status every 5 s).

| Section | As built | Why |
|---|---|---|
| All | Operator-facing API messages say "screen" (`The screen was not found.`, `This playlist is assigned to a screen. …`, the capability issues `The screen canvas is …` and `… from the screen.`). Player-facing messages are unchanged. | P2-03: the portal shows server messages verbatim. |
| All | A push state "Up to date" is drawn in the neutral tone; green means only a player-reported "In sync". "Not reporting" keeps the warn tone, not danger. The push dialog, the lists and the screen page use one wording (`lib/screenStatusPush.ts`): Changes waiting, Not pushed yet, Up to date, Blocked, Nothing assigned. | A push state says what was pushed, not what the player shows; "not reporting" means unknown, not failed (P2-04). |
| 3.1 | The second counter is "Updating or waiting" (updating, waiting for player, nothing pushed) and links to the screens list's "Updating" chip. Recent activity names the actor by kind ("Operator", "Player software"). | The spec's "Changes or updating" would be confused with the push plan's "changes waiting"; audit events carry no person's name. |
| 3.2 | Add to playlist reads the playlist and saves it whole (`PUT`). | The API has no append route or version check; a simultaneous edit can be overwritten (open). |
| 3.3 | "Add to playlist" in Used in adds the item as last saved; "Save and add to playlist" in the Save menu saves first. | No silent save. |
| 3.4 | The row menu says "Assign to screens" and opens a multi-screen picker; results are reported per screen with "Try again" for the failed ones. | One assignment can go to several screens. |
| 3.5 | The Push card's button reads "Assign to screens" and opens the multi-screen picker, as the list's row menu does. The buttons keep the M0 labels "Save draft" and "Discard changes"; Discard asks first. "Push now" opens the push dialog limited to this playlist's screens (it does not push without the dialog) and is held while the draft is unsaved. | M0 end-to-end wording; a push always goes through the one dialog. |
| 3.6 | Status chips: In sync, Updating (updating, waiting for player, nothing pushed), Needs attention (error, not reporting), Not paired, in `?status=`. The grid draws the canvas shape inside a fixed 16:9 picture. A frame is never thinner than a fifth of its picture (`MIN_FRAME_SHARE` in `lib/screensList.ts`): in a 16:9 tile every wizard preset, the 3840 × 480 "Wide strip" (8:1) included, is drawn at its true proportion; only a canvas wider than about 8.9:1 or taller than about 1:2.8 is drawn at the limit. In the 44 px square lead of a list row the limit is 5:1 and 1:5. The exact size is always written beside the frame. The M0 "Default fit" column is not listed (it stays on the screen page). | Same groups as the dashboard; tiles line up; a strip never becomes a hairline. |
| 3.7 | The screen's id and the step are kept in the address (`?screen=<id>&step=pair\|content`), so a reload resumes. Leaving with unsaved details asks first. | No duplicate screen after a reload or Back. |
| 3.8 | Name and Description are saved inside the Details card (the header has no Save); the Canvas and Tags tabs have their own Save. Drafts survive tab switches; leaving with any unsaved draft asks first. After "Save changes" on the Canvas tab the page stays on `?tab=canvas`. | One page, three independent forms. |
| 3.9 | Only rows with changes waiting (including never pushed) can be ticked. More than 200 ticked screens are sent in batches with the same key. A 409 `conflict` keeps the key. The dialog stops waiting after 60 s and offers a retry with the same key. The plan is not re-read under an open dialog. | The API would answer `unchanged` or `skipped` for the rest; 7.2 says a repeat with the same key carries on; the client has no request timeout. |
| 3.10 | The Detail column shows the recorded detail as `key: value` text, with the raw keys and values (for example `scope: display`), like the raw action. | It is the audit record, not prose. |

Known deviations, not fixed in stage A:

- Screens cannot be deleted or archived in stage A (M0 had no delete either). Screens created by mistake stay in every list, counter and push plan. An archive with an audit entry is planned for a later stage.

Known performance items, not fixed in stage A:

- The dashboard derives its counters from `GET /api/overview` while it also polls the screen statuses and the push plan, so one view makes overlapping requests.
- Recent activity on the dashboard and the Audit log fetch whole lists (media, playlists, screens, tags) only to name the objects of events. The fix needs an `objectName` on audit events in the API.

End-to-end suite: `tests/e2e/01` to `05` drive the v2 screens through `tests/e2e/support/portal.ts` (roles, labels and the test ids below; no CSS classes). Sign-in lands on the Dashboard; a screen is added and paired in the wizard; uploads go through Add media; a playlist is assigned from its editor and pushed from the header's "Push to screens" button, and the player is checked to switch; Revoke is on the screen's Pairing tab; Sign out is in the account menu; the Audit log's `h1` is "Audit log". The checks of section 5 are in the journey (dashboard counters equal `GET /api/overview`; push from the header; no web-storage keys and no Content-Security-Policy violation after each portal step) and in `04` (a media tag is created, given to a file and filters the library). The helpers were checked step by step against the development stack on 2026-11-16.

End-to-end run of 2026-11-16: `npm run test:e2e` ran the whole suite, 27 tests in `01` to `05`, against the production builds of the portal and the player (`vite build` then `vite preview`, served under the strict Content-Security-Policy), with real Keycloak sign-in and TOTP, the real API and the real validation worker. Two consecutive full runs passed 27 of 27 (6.2 and 6.1 minutes), with none skipped and no retries. Every journey step found no web-storage key and no Content-Security-Policy violation. The first run found two test defects and no product defect:

- `01`, the dashboard test expected the four counters on a seeded organisation that has no screen, where the Screens card rightly shows "No screens yet" instead. The test now checks the empty state there and checks the four counters against `GET /api/overview` again once the journey has a screen (before the first push).
- `04`, the canvas edit read the API before the save had finished: the canvas preview follows the draft as typed, so "3840 × 480 px" was visible at once. The test now waits for the "Canvas saved" notification first.

Test hooks for the end-to-end rewrite: every dialog that a test drives carries its `data-testid` on the `<dialog>` element (`Dialog` and `ConfirmDialog` take `testId`; a `ConfirmDialog` adds `-cancel` and `-confirm` to its buttons). The M0 texts "Displays", "New display", "Create display", "Publish to display", "Publication created" and "The display could not be loaded" are gone; sign-in lands on the Dashboard; the class hooks `.media-card`, `.add-row` and `.upload-row` are replaced by test ids.

