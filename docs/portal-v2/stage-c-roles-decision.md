# CMS-13 roles and users: decision draft

**Status:** DECIDED by Michael, 2026-11-19 (DEC-35). Nothing built. The next step is the build spec for PRs C1 and C2.

**Decided by Michael, 2026-11-19:** four roles, Owner, Admin, Editor and Viewer, keeping Owner so that Admins cannot remove each other ("Bring back owner"). Editors get as much access as possible ("Give editor as much access to make things easier"): everything about content and screens, including pushing, deleting, screen set-up and pairing. Admins add people management and the full audit log. The remaining choices are D1 to D7 below.

**Answered by Michael, 2026-11-19:** D1 to D7 all a. On D2 he added: "later we might link payment and self service, so it will be something like YoDeck, so Tinnox don't need to add them manually, we allow sign up". So the invite request that TINNOX completes is the pilot step. Self-service sign-up with payment, and invites that complete without TINNOX, come later as their own card. Nothing in CMS-13 may block that path (see "Later, automatic accounts").

This is a read-only draft based on `main` at `c12003f`. It was merged from three drafts and checked by one review round; details on request. No code, config or board rows were changed.
- "Role" means a person's application role in an organisation (`membership.role`). The PostgreSQL roles `tinnox_app`, `tinnox_migrator` and `tinnox_definer` do not change.
- "Screen" is the customer word; code keeps `display`.

## Summary

1. There are four fixed roles, and each includes everything the role below it can do: Owner, Admin, Editor and Viewer. Today's users become Owners, so nothing changes for them on the day.
2. Editors run content and screens: they make content, push it, delete it, set up screens, and pair and revoke players. Admins also manage Editors and Viewers and read the full audit log. Only Owners make, change or remove Admins and Owners.
3. People join through an "Invite person" request in the portal, which TINNOX completes. Removing someone ends their access at once, even in a browser still signed in at the identity provider. A role change takes effect on the person's next action.
4. The API refuses any route that has no declared permission (default deny), and checks the role again inside every write. The database makes sure an organisation always has an owner. Every change writes its audit row in the same transaction.
5. TINNOX support access, site scoping and agency staff in several organisations are deferred. Michael answered all seven decisions (D1 to D7) with option a on 2026-11-19.

## The four roles

- **Owner:** holds the account; can do everything, and is the only role that can make someone an Admin or an Owner.
- **Admin:** runs the team. Adds or removes Editors and Viewers and reads the full audit log, on top of everything an Editor does.
- **Editor:** runs content and screens. Uploads and deletes media, builds apps, playlists, schedules and layouts, pushes them, adds and sets up screens, and pairs and revokes players. An Editor cannot manage people or read the full audit log.
- **Viewer:** sees every screen, all content and each screen's reported status, and changes nothing.

Typical holders:
- **Owner:** the business owner or whoever signed with TINNOX. Two per organisation is advised, and TINNOX can create both when it sets the organisation up.
- **Admin:** a venue manager, or whoever looks after staff accounts.
- **Editor:** marketing or communications staff, an IT or facilities person who installs screens, or an outside agency.
- **Viewer:** area managers, board members and front-desk staff who check the screens.

Giving Editors this much means an outside agency made an Editor can also pair, revoke and reconfigure screens. A customer who wants an agency limited to content waits for the deferred Contributor role, or makes the agency a Viewer for now.

The UI never shows "operator" as a role, because the spec uses "TINNOX Operator" for a staff role. Internally, `audit_event.actor_type = 'operator'` keeps meaning "a customer person", and the portal labels it "Person".

## Permission matrix

### Permission keys

These keys are cut at each line the client might move. Moving a key between roles later is a one-line change in one role-to-key table, and no route changes. A Contributor role needs a small migration as well, because the role CHECK lists the roles.

| Key | Lowest role (as recommended) | What it covers |
|---|---|---|
| `org.read` | Viewer | Every read of screens, sites, delivery status, media (including preview, thumbnail and "where used"), folders, tags, apps, playlists, schedules, layouts, the push plan and the dashboard. HEAD is treated as GET |
| `activity.read` | Viewer | `GET /api/audit` limited on the server to the categories `display`, `media`, `tag`, `folder`, `app`, `playlist`, `schedule`, `layout` and `publication`; `GET /api/members/names`; the Audit log page with this filter |
| `audit.read` | Admin | `GET /api/audit` with nothing filtered out: sign-ins, people changes and security events as well |
| `content.write` | Editor | Create and edit media, folders, media tags, apps, playlists (including duplicate), schedules and layouts |
| `content.delete` | Editor | Delete folders, media tags, apps, playlists, schedules and layouts |
| `media.delete` | Editor | Delete media permanently |
| `screen.assign` | Editor | The `assigned*` fields of `PATCH /api/displays/:id` |
| `push.publish` | Editor | `POST /api/push` |
| `screen.details` | Editor | A screen's name and description; putting screen tags on a screen |
| `screen.hours` | Editor | A screen's working hours |
| `screen.setup` | Editor | Add a screen; canvas, content area, fit and rotation; create, rename, recolour and delete screen tags |
| `screen.pair` | Editor | Pair a player, revoke a player, cancel a pending pairing |
| `member.read` | Admin | The Users page: names, roles, status, first sign-in, pending invites and their e-mail addresses |
| `member.manage` | Admin, limited by the rank rule | Invite, cancel an invite, change a role, correct a name, remove someone, sign someone out everywhere |
| Owner rule (`canManage`) | Owner | Anything that grants, changes or removes Admin or Owner |
| No key | any member | `GET /api/session`, `POST /api/auth/logout` |
| Reserved | none | `org.rename` (Owner), `org.delete` (Owner), `site.manage` (Editor), `support.grant` (H1), and the CMS-14, CMS-15 and CMS-16 keys below |
| Kept for now | none | `POST /api/playlists/:id/publish`. No portal button calls it, but tests and scripts do. It needs both `push.publish` and `screen.assign`, and a later cleanup card retires it |

### Matrix

Y means allowed and N means refused. "D*n*" marks a cell that depends on a decision below.

| Area | Action | Key | Owner | Admin | Editor | Viewer | Note |
|---|---|---|---|---|---|---|---|
| Dashboard | Counters, Screens card, "Changes waiting" | org.read | Y | Y | Y | Y | Without `push.publish` the card is a read-only list |
| Dashboard | Recent activity card | activity.read | Y | Y | Y | Y | Editors and Viewers see content and screen events only |
| Dashboard | "Get set up" card | screen.setup | Y | Y | Y | N | |
| Screens | See screens, sites, one screen, delivery status | org.read | Y | Y | Y | Y | Paired or unpaired state is shown; pairing codes are not |
| Screens | Add a screen | screen.setup | Y | Y | Y | N | |
| Screens | Rename, edit description | screen.details | Y | Y | Y | N | |
| Screens | Put screen tags on a screen | screen.details | Y | Y | Y | N | |
| Screens | Create, rename, recolour or delete screen tags | screen.setup | Y | Y | Y | N | The tag's scope comes from the request on create and from the stored tag otherwise |
| Screens | Canvas, content area, fit, rotation | screen.setup | Y | Y | Y | N | Reaches the screen at the next push |
| Screens | Working hours | screen.hours | Y | Y | Y | N | A setting of the screen made at install, like canvas and rotation |
| Screens | Assign, change or remove a screen's content, including "Assign to screens" from a playlist | screen.assign | Y | Y | Y | N | Stored only; reaches the screen at the next push |
| Screens | Delete a screen | screen.setup (reserved) | Y | Y | Y | N | No route today |
| Sites | Manage sites and their time zone | site.manage (reserved) | Y | Y | Y | N | No route today. ISO-05's "site changes" step waits for it |
| Pairing | Pair a player (enter the code shown on the screen), including replacing a paired player | screen.pair | Y | Y | Y | N | Replacing a player also revokes the old one; the same key covers both. The wrong-code budget counts per member, so each extra holder adds guesses |
| Pairing | Revoke player | screen.pair | Y | Y | Y | N | The screen stops and clears its cache on its next contact. A player that stays offline keeps playing |
| Pairing | Cancel pending pairing | screen.pair | Y | Y | Y | N | Same route as revoke |
| Push | See the push plan and the "changes waiting" count | org.read | Y | Y | Y | Y | Without `push.publish` the header shows a plain "N screens waiting" chip |
| Push | Push to screens, from any entry point (see "What Viewers and Editors see") | push.publish | Y | Y | Y | N | A push sends every pending change on the chosen screens, including other people's |
| Push | Push a previous version again (rollback) | push.publish (reserved) | Y | Y | Y | N | No route today |
| Media | See the library, details, where used, preview, thumbnail | org.read | Y | Y | Y | Y | |
| Media | Upload | content.write | Y | Y | Y | N | Counts against the quota |
| Media | Edit name, description, duration, availability; move to a folder; set media tags | content.write | Y | Y | Y | N | |
| Media | Delete | media.delete | Y | Y | Y | N | Permanent. Refused while a playlist uses the item. Screens keep playing what was pushed |
| Folders | See | org.read | Y | Y | Y | Y | |
| Folders | New, rename | content.write | Y | Y | Y | N | |
| Folders | Delete | content.delete | Y | Y | Y | N | The folder's media moves to the library root; nothing is lost |
| Tags | See | org.read | Y | Y | Y | Y | |
| Tags | Create, rename, recolour media tags | content.write | Y | Y | Y | N | Screen tags: see Screens |
| Tags | Delete media tags | content.delete | Y | Y | Y | N | Removes the tag from every item |
| Apps | See | org.read | Y | Y | Y | Y | |
| Apps | Create, edit | content.write | Y | Y | Y | N | |
| Apps | Delete | content.delete | Y | Y | Y | N | Refused while in use |
| Playlists | See | org.read | Y | Y | Y | Y | |
| Playlists | New, save, duplicate; "Add to playlist" from media | content.write | Y | Y | Y | N | |
| Playlists | Delete | content.delete | Y | Y | Y | N | Refused while in use |
| Schedules | See | org.read | Y | Y | Y | Y | |
| Schedules | Create, save | content.write | Y | Y | Y | N | |
| Schedules | Delete | content.delete | Y | Y | Y | N | Refused while in use |
| Layouts | See | org.read | Y | Y | Y | Y | |
| Layouts | Create, save | content.write | Y | Y | Y | N | |
| Layouts | Delete | content.delete | Y | Y | Y | N | Refused while in use |
| Audit | Audit log page, full: sign-ins, people changes and security events as well | audit.read | Y | Y | N | N | Editors and Viewers get the same page filtered to the `activity.read` categories |
| Settings | See Settings | org.read | Y | Y | Y | Y | The Users row shows only with `member.read`. Tag management inside Settings follows the tag rows |
| Settings | Default working hours for new screens | screen.hours (reserved) | Y | Y | Y | N | Planned Settings row; no route today |
| Settings | Rename the organisation | org.rename (reserved) | Y | N | N | N | No route today; not built in this card |
| Settings | Delete the organisation's data | org.delete (reserved) | Y | N | N | N | No route. TINNOX acts on an Owner's written request (spec §8) |
| People | See your own name and role; sign out | none | Y | Y | Y | Y | |
| People | See colleagues' names in activity | activity.read | Y | Y | Y | Y | Names only, never e-mail addresses or roles |
| People | Users page: names, roles, status, first sign-in, pending invites | member.read | Y | Y | N | N | E-mail addresses appear only on pending invites (D3) |
| People | Invite an Editor or a Viewer | member.manage | Y | Y | N | N | |
| People | Invite an Admin | Owner rule | Y | N | N | N | D6 |
| People | Invite an Owner | none | N | N | N | N | Nobody can. Promote the person after their first sign-in |
| People | Cancel a pending invite | member.manage | Y | Y (Editor and Viewer invites) | N | N | |
| People | Change a role between Editor and Viewer | member.manage | Y | Y | N | N | |
| People | Make someone an Admin | Owner rule | Y | N | N | N | |
| People | Make someone an Owner | Owner rule | Y | N | N | N | Only someone who has signed in at least once. This is how ownership is handed over (D1) |
| People | Demote or remove an Admin | Owner rule | Y | N | N | N | |
| People | Demote or remove an Owner | Owner rule | Y | N | N | N | Never the last owner |
| People | Remove an Editor or a Viewer | member.manage | Y | Y | N | N | Access ends at once; their content and history stay |
| People | Correct a member's display name | member.manage | Y (anyone else) | Y (Editors and Viewers) | N | N | Names are unique in the organisation, and the audit page marks a renamed member |
| People | Sign a member out everywhere (for example, a lost laptop) | member.manage | Y (anyone else) | Y (Editors and Viewers) | N | N | Their next sign-in needs the password and one-time code again |
| People | Change your own role, remove yourself, rename yourself | none | N | N | N | N | Someone else does it (D7) |
| Reserved | Grant, approve or revoke TINNOX support access (H1) | support.grant | Y | Y | N | N | Decided in H1. An edit grant must never include managing people |
| Reserved | Emergency message or takeover (CMS-14) | later | Y | Y | Y | N | Suggested default: Editors and up define and trigger a message |
| Reserved | E-mail alert settings (CMS-15) | later | Y | Y | Y | N | Recipients are verified addresses (DEC-29), collected in CMS-15 |
| Reserved | Playback report (CMS-16) | later | Y | Y | Y | Y | Default only |
| Reserved | API tokens (Epic J) | later | Y | Y | N | N | A token's role can be no higher than its creator's |

There is no billing row, because billing is not in the product (DEC-27). ISO-05 (`docs/acceptance-tests.md:31`) uses three roles as test preconditions and names a billing right. It must be aligned to these four roles.

**The matrix in one sentence each (as recommended):**
- **Viewer:** `org.read` and `activity.read`.
- **Editor:** Viewer, plus `content.write`, `content.delete`, `media.delete`, `screen.assign` and `push.publish`.
- **Admin:** Editor, plus `screen.details`, `screen.hours`, `screen.setup`, `screen.pair`, `audit.read`, `member.read`, and `member.manage` over Editors and Viewers.
- **Owner:** Admin, plus everything at Admin and Owner level, and `org.rename` and `org.delete` when they are built.

### People routes

Each new route has its own entry in the route-to-key table.

| Route | Key | What it does |
|---|---|---|
| `GET /api/members` | member.read | Every member: name, role, active or removed, first sign-in. No e-mail address (D3) |
| `GET /api/members/names` | activity.read | Id and name of every member, removed ones included so history still reads. Never a role or an e-mail address |
| `GET /api/invites` | member.read | Pending invites: name, e-mail address, role, expiry |
| `POST /api/invites` | member.manage, then `canManage` on the role | Creates a pending invite |
| `POST /api/invites/:id/cancel` | member.manage, then `canManage` | Cancels a pending invite |
| `PATCH /api/members/:id` | member.manage, then `canManage` | Changes the role or the display name |
| `POST /api/members/:id/remove` | member.manage, then `canManage` | Removes the member and ends their sessions |
| `POST /api/members/:id/sign-out` | member.manage, then `canManage` | Ends all the member's sessions |

## Rules

### Last owner
- An organisation always has at least one active Owner. A database trigger in 0013 enforces this:
  - It runs `BEFORE UPDATE OF role, removed_at OR DELETE` on `membership`.
  - When an active Owner stops being one, it takes a per-organisation advisory lock (key `tinnox.membership:<org>`, the `hashtextextended` pattern of `0010_pairing_hardening.sql`). It then counts the other active Owners with an explicit `org_id = OLD.org_id` and raises an error if there are none. The API answers 409 `last_owner`.
  - It also raises when `app_org_id()` is not `OLD.org_id`. It therefore fails closed whether or not row-level security applies, for example in a script that forgot `app.org_id` or a migration that lifts `FORCE`.
- Every member-management transaction takes the same lock first, then reads the actor's and the target's rows again. Two Owners demoting each other at the same moment therefore run one after the other. An Admin demoted a moment ago cannot keep acting with the old role.
- **The same trigger refuses changing `removed_at` or `removed_by` once set, and clearing them, for every role except `tinnox_migrator`**, which the fulfilment script uses. An application bug therefore cannot bring a removed person back.
- **Lost owner (break-glass):** if every Owner is gone, TINNOX runs `scripts/restore-owner.sql` on a written request.
  - It promotes an existing active member. When nobody active is left (a one-person venue whose Owner has left), it creates an Owner membership for the successor's new sign-in account and marks the old Owner removed, in the same transaction.
  - It needs two TINNOX people: `--executed-by` and `--approved-by` must be different staff ids.
  - It is audited as `system`, with reason `owner_recovery`, the request reference and both staff ids.
- **Lost authenticator or password:** TINNOX resets the account at the identity provider after the identity check written in `operations-and-release-checklist.md`. When the organisation has another active Owner or Admin, TINNOX confirms with that person first. Staff then run `provision-member mfa-reset`, which writes `membership.mfa_reset` and ends the member's CMS sessions.

### Escalation limits
- Rank rule: an Admin acts only on Editors and Viewers and grants only those roles. Only an Owner grants, changes or removes Admin or Owner.
- Nobody raises, changes or removes their own role, and nobody renames themselves (D7). Handing over ownership therefore takes two people: Owner A makes B an Owner, then B demotes or removes A.
- Admins invite Editors and Viewers. Owners may also invite Admins (D6). Owner comes only from promoting someone who has signed in at least once. The API checks `membership.first_signed_in_at`, which only `sec.session_create` writes and which reactivation clears. It never reads the audit log for this.
- What stops a mistyped e-mail address is TINNOX's own step. Staff confirm the person with the requester before sending credentials, `fulfil` records that confirmation's reference, and `fulfil` refuses an account whose e-mail address differs from the invite's.
- The API checks the role named in the request against what the actor may grant. The portal's choices are never trusted.

### Enforcement
- **Default deny:**
  - One route-to-key table in `apps/api/src/auth/permissions.ts`, checked by a preHandler that runs after `requireOperator`.
  - Each entry is either `{all: [keys]}` or `{any: [keys], refine: name}`. The API refuses to start if an operator route has no entry, or an `any` entry names no refine function.
  - A test runs every route in `OPERATOR_ROUTE_PATTERNS` (`tests/integration/session-csrf.test.ts:43-94`; 51 today, 59 after the build) against all four roles. Each refine function has its own unit tests.
  - The helpers `can(role, key)` and `canManage(actor, target)` live in `packages/domain` and are shared by the API and the portal.
- **Routes that need a refine function:**

  | Route | Entry | Refine |
  |---|---|---|
  | `POST /api/tags` | any of `content.write`, `screen.setup` | By `scope` in the body: media needs `content.write`, display needs `screen.setup` |
  | `PATCH /api/tags/:id` | any of `content.write`, `screen.setup` | The same, by the stored tag's scope, read inside `withOrg` |
  | `DELETE /api/tags/:id` | any of `content.delete`, `screen.setup` | By the stored tag's scope |
  | `PATCH /api/displays/:id` | any of `screen.assign`, `screen.details`, `screen.hours`, `screen.setup` | Every field sent needs its key: `assigned*` needs `screen.assign`; `name`, `description` and `tagIds` need `screen.details`; `workingHours` needs `screen.hours`; `canvas`, `contentRect`, `defaultFit` and `rotation` need `screen.setup` |
  | `GET /api/audit` | `activity.read` | Without `audit.read`, only the categories listed under `activity.read`. Any other category answers 200 with an empty page, not 403 |
  | Member and invite writes | `member.manage` | `canManage` on the target and on the role named |

- **Checked again inside every write:** a helper `assertStillAllowed(tx, session, key)` is the first statement of every write transaction. It runs `SELECT role, removed_at FROM membership WHERE id = $1 AND org_id = app_org_id() FOR SHARE`, then `can(role, key)`.
  - It is needed because the preHandler reads the role before any transaction (`apps/api/src/auth/session.ts:73-77`). An upload streams for up to 15 minutes (`app.ts:47`) before it inserts its row, and a push walks up to 200 screens, one transaction each (`routes/push.ts:178-201`).
  - It is mandatory in the upload insert (a refused upload discards the stored file, as other failures do), in every per-screen push transaction, in pairing and revocation, and in every content write.
  - `FOR SHARE` waits for a member-management `UPDATE` on that row, so no write commits under a role that has already been taken away.
- **Status codes:**
  - A refusal by role is decided before any lookup and is the same 403 `forbidden` for every id, the person's own or another organisation's, so it reveals nothing.
  - A role that is allowed still gets 404 for another organisation's id.
  - Tag update and delete check the scope after reading the tag, a read the person could already make with `org.read`.
  - This is how CMS-13 reads AGENTS.md §2 ("Cross-organisation ids answer 404, never 403"); the DEC entry records it. `tests/integration/cross-org.test.ts` keeps its 404 cases as an Owner, and adds one case where a Viewer gets the same 403 for its own id and a foreign one.
- **Session response:** `GET /api/session` returns the real role, the display name and the list of permissions; today the role is hard-coded at `apps/api/src/routes/auth.ts:246`. The portal checks permissions, not role names.

### Sessions when something changes
- The role keeps being read live on every request (`0002_security_functions.sql:103-105`). It is never copied into the session row.
- **Removal, demotion and "sign out everywhere" end all of the target's CMS sessions:**
  - through a new `sec.session_revoke_membership`;
  - in the same transaction as the change and its audit row;
  - the actor's own sessions are not touched.
- **A promotion signs nobody out.** It takes effect on the person's next request, and the portal shows the new controls when it loads the session again.
- **No silent sign-back-in.** The realm signs a browser that still has a Keycloak session straight back in, without password or one-time code (`infra/keycloak/realm-template.json:678`, `auth-cookie` as an alternative; idle limit 30 minutes, maximum 8 hours at `:28-29`). `scripts/revoke-subject-sessions.sql:6` already warns about this. So `sec.session_revoke_membership` also sets `membership.sessions_valid_after = now()`:
  - `sec.session_by_id_hash` accepts only sessions created after it. This also closes a sign-in that commits at the same moment as the revocation.
  - `sec.session_create` receives the ID token's `auth_time` and creates no session when `auth_time` is not after it. The callback then sends the browser back to the identity provider with `prompt=login`, so the password and the one-time code are needed again.
  - This is what makes "sign out everywhere" useful for a lost laptop.
- **Safety net:** `sec.session_by_id_hash`, `sec.session_create` and `sec.membership_by_oidc_sub` ignore removed members. A missed revocation still ends access, and a removed person who signs in gets the existing `no_membership` refusal.
- **Portal:**
  - after a 403 it shows "Your role doesn't allow this" and loads the session again;
  - it also loads the session again when a tab regains focus;
  - after a 401 it sends the person to sign in.
- **Remaining window:** none for writes, because of the check inside every write. A read already running when the role changes can finish with the old role.
- This covers the "revisit when roles are added" note on the ISM-2048/2049 row (`docs/security/control-matrix.md:64`).

### One person in several organisations
- Not in CMS-13. `UNIQUE (oidc_sub)` stays (`0001_schema.sql:61`).
- Agency staff get one sign-in account per customer. Sign-in uses a username, and one authenticator app can hold several entries.
- The fulfilment script refuses a subject that already belongs to another organisation and tells only the TINNOX staff member. The customer's invite stays pending, so nothing about the other organisation leaks.
- Migration 0013 adds nothing that deepens the one-organisation assumption. Lifting it later needs a redesign of `sec.session_create` and an organisation picker.

### What Viewers and Editors see
- **A Viewer sees, read only:**
  - every page: dashboard, screens and their reported status, media and previews, folders, tags, apps, playlists, schedules, layouts, Settings;
  - content and screen activity with names, on the dashboard and a filtered Audit log page;
  - the number of screens waiting for a push;
  - their own name and role.
- **A Viewer does not see:** any push button, create, edit and delete controls, the Users page, or the people and security events of the audit log.
- **An Editor** sees every page and control except the Users page and the people and security events of the audit log.
- **One rule for controls:** a control the role lacks is hidden, not disabled. "Disabled with a reason" is used only inside forms.

| Surface | Without the key |
|---|---|
| Header "Push to screens" (`push.publish`) | A plain "N screens waiting" chip that links to the dashboard |
| Every other push entry point (`push.publish`): dashboard "Review and push", set-up step 4, the playlist editor's "Push now", the screen detail push button, the row menu's "Push now", pushing several screens | Hidden. The push dialog never opens. Set-up step 4 reads "An editor or admin pushes" |
| Row menus and bulk bars: "Edit tags" and "Add tags" (`screen.details`), "Revoke player" (`screen.pair`), media "Move", "Tags" and "Delete" (`content.write`, `media.delete`), playlist actions | Hidden. A menu left with only "Open" becomes a plain link; selection checkboxes go when no bulk action is left |
| "Add screen" and the empty-state buttons ("No screens yet", "No apps yet", "No layouts yet") | Text, such as "An editor adds screens." |
| Dropping files on the media page (`content.write`) | Off |
| Full-page editors: playlist, app, layout, schedule, media detail; the screen's Details, Tags and Pairing tabs | Read-only: fields locked, no dragging, no save bar, no leave warning, and one line such as "You can view this playlist. Editors make changes." |
| Forms inside a page the role can open, such as a screen's Canvas and Working hours tabs for a Viewer | Read-only, with one line such as "Editors change the canvas." |
| Account menu and Settings: "Users" (`member.read`) | Hidden. A direct visit to `/users`, or to `/screens/new` as a Viewer, shows "Your role doesn't allow this", not "page not found" and not a form that fails when sent |

- The frontend round applies `.agents/skills/web-design-guidelines/`.
- Hiding controls is a convenience. The API is the enforcement.

### Audit actions, each in the same transaction as the change

- Add the categories `invite` and `membership` to `AUDIT_CATEGORIES` (`packages/contracts/src/audit.ts:48`). Both need `audit.read`. The action pattern already allows these names (`0001_schema.sql:375`).
- No row carries a name, e-mail address or token. `occurred_at` is set by the database. Script rows carry TINNOX staff ids, which are not customer data.

| Action | Written when | Object | Detail | Transaction |
|---|---|---|---|---|
| `invite.create` | An Admin or Owner invites someone | invite | `{role}` | Same as the invite insert |
| `invite.cancel` | Cancelled by hand; automatically when the inviter is removed or demoted and could no longer send it; or expired by TINNOX's daily run (actor `system`) | invite | `{role, reason}` | Same as the cancellation, or as the change that caused it |
| `membership.create` | The TINNOX script fulfils an invite, reactivates a removed member, creates a new organisation's Owners, or restores an Owner (actor `system`) | membership | `{role, inviteId, reactivated, requestRef, confirmedWith, executedBy, approvedBy?, reason?}` | The script's single transaction |
| `membership.role_change` | A role changes, including a break-glass promotion | membership | `{from, to, sessionsEnded, reason?}` | Same as the update and any session revocation |
| `membership.update` | A display name is corrected, in the portal or by TINNOX's `set-name` | membership | `{fields:['displayName']}` | Same as the update |
| `membership.remove` | A member is removed | membership | `{previousRole, sessionsEnded, invitesCancelled, reason?}` | Same as the update, the revocation and the invite cancellations |
| `membership.sessions_end` | An Admin or Owner signs a member out everywhere | membership | `{sessions}` | Same as the revocation |
| `membership.mfa_reset` | TINNOX records an authenticator or password reset (actor `system`) | membership | `{requestRef, executedBy, confirmedWith?, sessionsEnded}` | The script's single transaction |
| `security.permission_denied` | A refused unsafe request, including a refused member change such as `last_owner` or outside the rank rule | route or membership | `{permission, method, reason?}` | Its own transaction, because nothing changed, like `security.csrf_rejected`. At most a few rows per member per window, with a count of the rest, as for device credentials (B6). Refused member changes are always written. Refused reads are not audited |

## Invitation and removal

**Recommended:** D2 a now, then automatic accounts once the production identity provider (A3) and the e-mail service (SES) are decided. Never D2 c.

| | **D2 a: portal request, TINNOX completes (recommended)** | D2 b: customers e-mail TINNOX | D2 c: invite link and self-registration | Later: automatic accounts (A3 and SES) |
|---|---|---|---|---|
| Customer experience | Fills in a form; TINNOX sets the person up within one business day | Sends TINNOX an e-mail; no record in the product | Instant; the person signs up | Instant; the person gets an e-mail |
| Who creates the sign-in account | TINNOX staff, with a script | TINNOX staff | The invitee | The API |
| New secret in the API | None | None | Invite token hashes, and mail credentials | Identity-provider admin rights. In Keycloak, `manage-users` covers the whole realm, TINNOX staff included |
| New infrastructure | None | None | Open sign-up and mail | Mail |
| Main risk | Manual; the account disable can be forgotten. A weekly check covers it | Slow; no audit of who asked; the account disable can be forgotten | The link is a bearer token: whoever opens it first joins. Binding it to an e-mail reverses B1. It needs a new cross-organisation function that runs before the organisation is known, rated High until justified | A stolen secret can take over accounts; "this address already exists" leaks across organisations |
| Build size (joining and leaving only) | S to M | S | M to L | M, or L if built for Keycloak now and again for Cognito |

**Joining (D2 a):**
1. **Request.** An Admin or Owner opens Users, chooses "Invite person", and enters a name, a work e-mail address and a role: Editor or Viewer, or also Admin for an Owner (D6).
   - Inside `withOrg`, the API inserts a `member_invite` row (pending, expires after 14 days, `invited_by` taken from the session) and writes `invite.create`, in one transaction.
   - The page shows "Waiting for TINNOX", a short reference, and "Contact support if it is urgent".
2. **TINNOX creates the sign-in account.**
   - Staff run `provision-member pending` daily during the pilot. It lists pending invites across organisations and expires old ones, which clears their name and e-mail address.
   - They create the identity-provider account with the required actions "set password" and "configure one-time code".
   - They confirm the person with the requester, then send the username and the temporary password by different channels. Nothing is stored in the CMS.
3. **TINNOX fulfils the invite.** Staff run `provision-member fulfil <invite> --confirmed-with <ref> --executed-by <staff>`. It takes no subject argument: it reads the subject from the identity-provider account itself and refuses unless that account's e-mail address equals the invite's. Then, as `tinnox_migrator` with `app.org_id` set from the invite, in one transaction it:
   - checks that the invite is pending and not expired, and that the inviter is still active and may still grant that role;
   - checks that the subject is not in another organisation;
   - takes the role and the name from the invite only (the script has no role argument);
   - inserts the membership, or reactivates a removed row of the same person and clears its `first_signed_in_at`;
   - marks the invite fulfilled, which clears its e-mail address;
   - writes `membership.create`.
4. **First sign-in.** The identity provider forces one-time-code setup (`infra/keycloak/realm-template.json:670-715`).
5. **Promotion.** An Owner may then promote the person, to Owner only after that first sign-in.

**A new customer's first Owners** are created by `provision-member org-create`, which makes the organisation and one or two Owners in one transaction, as `scripts/seed.ts` does today.

**Removal:**
1. **Remove.** An Admin or Owner confirms. In one `withOrg` transaction the API:
   - takes the lock;
   - checks the rank rule;
   - sets `removed_at` and `removed_by` (the last-owner trigger applies);
   - calls `sec.session_revoke_membership`, which also sets `sessions_valid_after`;
   - cancels invites the person sent;
   - writes `membership.remove`.

   Access ends at once.
2. **What stays.** Content and history stay. `created_by` keeps pointing at the row; hard deletion is impossible anyway (`0001_schema.sql:216`, `:282`).
3. **Sign-in account.** TINNOX disables it. A weekly check in `docs/security/operations-and-release-checklist.md` compares members with `removed_at` set against identity-provider accounts that are still enabled.
4. **Coming back.** A removed person returns through a new invite. Fulfilment reactivates the same row with the invite's role, never the old one. Old sessions stay revoked.

**How TINNOX's scripts reach the data:**
- The scripts run as `tinnox_migrator` from a controlled host, as `scripts/revoke-subject-sessions.sql` does today. AGENTS.md §1 says the migrator only runs migrations, so C2 records provisioning there as a second permitted use, and in threat T14. The migrator can still delete audit rows and disable triggers. That is the documented administrator residual (T14), now used more often.
- `pending` and the first step of `fulfil` read `member_invite` across organisations, which `FORCE ROW LEVEL SECURITY` refuses to the table owner. They use `SET LOCAL ROLE tinnox_definer`, as `revoke-subject-sessions.sql` does. The definer gets a new grant: `SELECT (id, org_id, role, name, email, status, expires_at)` and `UPDATE (status, closed_at)` on `member_invite`.
  - Justification: TINNOX staff must see the queue of every customer to work it.
  - It is script-only, never a `sec.*` function the API can call, and `sec.integration.test.ts` checks that `tinnox_app` cannot read invites of another organisation.
- A dedicated provisioning role with no ownership and no `DELETE` would be stronger. It is deferred, because this card keeps the three PostgreSQL roles unchanged.

**Later, automatic accounts:**
- On Cognito, allow only `AdminCreateUser`, `AdminGetUser`, `AdminDisableUser`, `AdminEnableUser` and `AdminUserGlobalSignOut`, with TINNOX staff in a separate pool.
- The tables and screens are the same; only steps 2 and 3 become one API call.
- Revisit D6 then, because nobody at TINNOX would check the person any more.
- Do not onboard real customers before A3 is decided: changing the identity provider changes every `sub`.
- **Self-service sign-up with payment (Michael, 2026-11-19, a later card):** a new customer signs up, pays and gets an organisation with its first Owner, with no TINNOX step. That replaces `provision-member org-create` with an API path, needs the e-mail service, the production identity provider and a payment provider, and reverses DEC-27's "no self-serve sign-up" for a later release. The membership table, the invite table and the Users page stay as built here; only who completes the steps changes.

## TINNOX support access: out of CMS-13

**Why:**
- B+ (DEC-17) still waits for approval in Q18.
- It needs grant records, time limits, a banner, customer e-mail and staff identities kept separate from customers (backlog A3).
- The operations console is "Later" (`docs/portal-v2/README.md:28`).
- A surface that works across customers collides with the tenant rules in AGENTS.md §2.

**What CMS-13 commits to:**
- TINNOX acts on memberships only through scripts (`provision-member`, `restore-owner`), audited as `system` with a request reference and staff ids. `restore-owner` needs two people.
- None of these scripts is reachable from the API, and `tinnox_migrator` credentials stay out of the API, the media worker and the player.
- `support.grant` is reserved in the matrix. `actor_type` is unchanged; H1 adds a `support` actor type later.
- No hidden staff accounts, ever. Recommended (D5 a): no TINNOX staff inside customer accounts until H1; help happens over a shared screen.
- If Michael chooses D5 b, it is a temporary exception to DEC-17 and is bounded:
  - Viewer or Editor only, enforced by a `membership.tinnox_staff` flag that only the fulfilment script sets, from a staff flag on the request; `canManage` refuses any higher role for it;
  - a "TINNOX" badge on the Users page, in activity and on the audit page, and a display name starting "TINNOX –";
  - removal by TINNOX within 7 days (the DEC-17 maximum), checked in the weekly identity-provider check.
- Installer partners get no accounts. On site, the installer reads the code on the screen to the customer's Editor or Admin, who pairs from the portal.

**Why it is safe:** the product has no staff access path today, and this card adds no code path for one. D5 b would add a policy path.

## Deferred, and why that is safe

| Deferred | Why it is safe now | What keeps it cheap later |
|---|---|---|
| Site scoping (ISO-06, H2) | No route creates or filters by site, and every member already sees the whole organisation | Scoping only narrows access; add a member-to-site table and a filter |
| A "Contributor" role limited to content, for an agency that should not push, pair or change screens, or an approval step for councils | `push.publish` is its own key. Nothing reaches a screen until someone pushes | A migration that widens the role CHECK, one line in the role table and a label. A real approval flow also needs "changed by" in the push plan |
| Several organisations per person (agencies) | `UNIQUE(oidc_sub)` stays, and the script refuses a second organisation | Separate card: redesign `sec.session_create` and add an organisation picker |
| TINNOX staff roles and support grants (H1) | No staff access path exists | `support.grant` reserved |
| Automatic invites and invitation e-mail | TINNOX completes invites by hand; no mail is sent | The same tables, routes and page |
| A dedicated database role for provisioning | Scripts run as `tinnox_migrator` from a controlled host, inside the documented T14 residual | A new login role with column grants and no `DELETE`; the trigger exemption moves to it |
| Fresh sign-in before owner actions (granting Admin or Owner, removing someone) | Sessions are MFA with a 30-minute idle limit, every action is audited, and removal or demotion signs the target out | `auth_time` is already read at sign-in. **Do this before the first external customer** |
| A restore window for deleted media | Deletes are refused while in use, and screens keep what was pushed | Editors already delete media; a restore window makes that safer |
| Self-service password or authenticator reset | TINNOX resets at the identity provider; pilot scale | Needs e-mail |
| "Last sign-in" column on the Users page | Not security-relevant; first sign-in is shown | Can come from `auth.login` audit rows |
| How long a removed member's name is kept | Nothing purges audit rows today | Needs TINNOX input under DEC-18. `display_name` can be overwritten later |
| Custom roles, groups, SSO, SCIM, IP allow-list, per-organisation session policy | The fixed nested roles cover the pilot | Nested roles map onto identity-provider groups |
| User quotas per plan; locking users when a licence is suspended (Epic N) | Entitlements are not built; TINNOX can refuse invites beyond the plan | Check at invite time |
| Routes for organisation rename and delete, screen delete, sites and rollback | No routes exist; the matrix already fixes who may use them | |
| Retiring `POST /api/playlists/:id/publish` | It keeps an all-of entry (`push.publish` and `screen.assign`) | A cleanup card moves the test and script helpers to assign plus `POST /api/push` |
| Renaming `actor_type 'operator'` | Cosmetic; the portal shows "Person" | A later migration |

## Decisions for Michael

Answered 2026-11-19: D1 to D7 all a (see the top of this page).

Settled on 2026-11-19 (old numbers in brackets):
- Four fixed roles: Owner, Admin, Editor and Viewer, one per person, each including the one below (old D1).
- Editors push to screens (old D2).
- Editors delete everything they can edit, media included (old D3).
- Editors set up screens: add, rename, describe, tag, canvas, rotation and working hours (old D4).
- Editors pair and revoke players and cancel pending pairings (old D5).
- Everyone sees content and screen activity, on the dashboard card and a filtered Audit log page. Only Admins and Owners see the full log, with sign-ins, people changes and security events (old D6).

**D1. How many Owners?**
- a) One or more, never zero; two are advised, and TINNOX can create both at set-up. A later second Owner is invited (as Admin under D6 a) and promoted after the first sign-in. Ownership moves when an Owner makes someone else Owner and that person then demotes or removes the old one. If every Owner is gone, TINNOX restores one on a written request: an existing member, or a successor's new account when nobody is left.
- b) Exactly one, with a Transfer ownership action. TINNOX restores a lost Owner on a verified request.

Recommend: a.

**D2. How are people added?**
- a) An "Invite person" request in the portal that TINNOX completes within one business day. It becomes automatic once the production sign-in service and e-mail are chosen.
- b) Customers e-mail TINNOX, with no form in the portal. This is the smallest build but leaves no record in the product.
- c) A self-service e-mailed invitation link now.

Recommend: a.

**D3. What does the CMS store about a person?**
- a) Their name. The work e-mail address is kept only on the pending invite, shown to Admins and Owners, and cleared when TINNOX completes, cancels or expires the invite. This stays closest to the API's data minimisation today (`apps/api/src/routes/auth.ts:245`). Alert addresses for CMS-15 are collected and verified there (DEC-29).
- b) Name and work e-mail address for every member, shown only to Admins and Owners. This reverses that minimisation and needs a privacy-notice entry and a retention row. The address is cleared on removal, and is never used to re-link accounts, because nobody verified it.
- c) Nothing; ids only. The Users page and audit log then cannot show who someone is.

Recommend: a.

**D4. What do today's "operator" accounts become?**
- a) All become Owners, so nobody loses anything. The dev seed can hold older subjects in one organisation (`scripts/seed.ts` keeps them); they become Owners too and can be removed by hand. TINNOX sets each existing member's name once with `provision-member set-name`.
- b) The oldest in each organisation becomes Owner and the rest become Admins. This is needed if D1 is b.

Recommend: a.

**D5. May TINNOX staff work inside a customer's account before support grants (B+) exist?**
- a) Never, until B+ grants are built (H1). Help happens over a shared screen with the customer.
- b) Only as a visible, named member that the customer invited and can remove. This is a temporary exception to DEC-17: Viewer or Editor only, a "TINNOX" badge, and removal within 7 days.

Recommend: a. DEC-17 and spec §7.6 ask for a customer grant, a time limit, a banner and a named staff identity, which b lacks.

**D6. May an Owner invite someone straight in as Admin?**
- a) Yes, while TINNOX completes every invite by hand (D2 a). Admins still invite only Editors and Viewers, and Owner still comes only by promotion after a first sign-in. TINNOX's check with the requester is what stops a mistyped address. Revisit when invites become automatic.
- b) No. Every invite carries Editor or Viewer. A new Admin waits for TINNOX, signs in, then waits for an Owner to promote them.

Recommend: a.

**D7. May people change their own membership?**
- a) No. Someone else removes or renames a person, and nobody changes their own role.
- b) Yes: anyone may leave the organisation (never the last Owner) and correct their own name.

Recommend: a.

## Build outline (no code)

**Size: L.** One build spec, two PRs, one migration. A rough reading-only guess is 9 to 12 working days (unverified). All schema goes into 0013 in the first PR, so no 0014 is needed.

**Migration `db/migrations/0013_roles_and_members.sql`** (0001 to 0012 are untouched):
- **Role column:**
  - Lift `FORCE ROW LEVEL SECURITY` on `membership` around the mapping and restore it in the same transaction, as `0005_portal_v2_stage_a.sql:179-187` does. Without that the owner sees no rows, the mapping updates nothing, and the new CHECK fails. The final "all tables forced" check stays.
  - Drop the role CHECK. Its name, probably `membership_role_check`, is unverified pending runtime.
  - Map `'operator'` according to D4.
  - Add `CHECK (role IN ('owner','admin','editor','viewer'))` and drop the default, so an insert that names no role fails.
- **New `membership` columns:**
  - `display_name` (1 to 120 characters, nullable for existing rows), unique per organisation on its lower-case form, removed members included;
  - `removed_at`;
  - `removed_by`, with a composite foreign key `(removed_by, org_id)`;
  - `first_signed_in_at`;
  - `sessions_valid_after`;
  - `email` only if D3 is b; `tinnox_staff` only if D5 is b.
- **Triggers** (created after the mapping; `search_path` pinned; not definer functions):
  - on `membership`: the last-owner rule and the `removed_at` and `removed_by` rule above;
  - `member_invite_guard`, after the `player_registration_guard` precedent: an insert must be `pending` with `expires_at` at most 14 days ahead; `tinnox_app` may only move `pending` to `cancelled`; only `tinnox_migrator` sets `fulfilled` or `expired`; a closed invite never changes again; name and e-mail are set to NULL when the status leaves `pending`.
- **`member_invite` tenant table:**
  - columns: role (`CHECK IN ('viewer','editor','admin')`, Admin per D6), name, e-mail (`CHECK (status <> 'pending' OR email IS NOT NULL)`), status, `expires_at`, and composite foreign keys for the inviter, the closer and the fulfilled membership;
  - `ENABLE` and `FORCE ROW LEVEL SECURITY` with the `tenant_isolation` policy;
  - `tinnox_app` gets `SELECT`, `INSERT` and `UPDATE (status, closed_at, closed_by)`;
  - `tinnox_definer` gets the script grants named under "How TINNOX's scripts reach the data".
- **Grants on `membership`:**
  - `tinnox_app` gets `UPDATE (role, display_name, removed_at, removed_by)` only;
  - never `INSERT`, `oidc_sub`, `org_id`, `first_signed_in_at` or `sessions_valid_after`;
  - `tinnox_definer` gets `UPDATE (first_signed_in_at, sessions_valid_after)`;
  - row-level security still applies.
  - The `UPDATE membership SET role` assertion in `packages/db/test/rls.integration.test.ts:641-645` changes on purpose. The `INSERT` refusal stays.
- **`sec.*` functions,** under `SET LOCAL ROLE tinnox_definer` … `RESET ROLE`. Each pins `search_path`, gets `EXECUTE` for `tinnox_app` only, and is covered by the ownership check from `0002:385-415`.
  - **New:** `sec.session_revoke_membership`. It acts only when the membership's organisation equals `app_org_id()`, revokes the sessions, sets `sessions_valid_after` and returns a count. The precedent is `sec.pairing_claim`'s organisation check (`0010:48-50`). It is needed because `tinnox_app` has no rights on `session`.
  - **`session_create`:** gains an `auth_time` parameter, so it is dropped and created again. It refuses removed members and an `auth_time` not after `sessions_valid_after`, and sets `first_signed_in_at` when it is empty.
  - **`CREATE OR REPLACE`** of `session_by_id_hash` (ignores removed members and sessions created before `sessions_valid_after`) and `membership_by_oidc_sub` (ignores removed members).
  - **`pairing_claim`:** also requires a member who has not been removed. It checks no role: the route and the check inside the write decide who may pair, so who may pair stays a one-line change. The signature does not change.
- **Locks:** `membership` is tiny, so the brief lock is harmless.

**API:**
- `packages/domain/src/permissions.ts`: roles, keys, the role-to-key table, `can` and `canManage`, with exhaustive unit tests.
- `apps/api/src/auth/permissions.ts`: the route-to-key table, the refine functions and the preHandler. Register it after `requireOperator` at `app.ts:104`, with the startup check.
- `assertStillAllowed` in every write transaction, as above.
- Route changes:
  - `displays.ts`: the per-field check in PATCH;
  - `tags.ts`: the scope check;
  - `audit.ts`: the category allow-list for `activity.read`;
  - `playlists.ts`: the publish route keeps working under its all-of entry;
  - `security.permission_denied` throttled per member.
- `routes/auth.ts`: the real role, display name and permissions in `GET /api/session` (`:239-252`), with the name read by one `withOrg` SELECT; the callback passes `auth_time` and redirects with `prompt=login` when the session is refused for being too old.
- New `routes/members.ts` with the eight people routes. Each runs in `withOrg`, takes the lock, and writes its audit row on the same `Tx`.
- Contracts:
  - `session.ts`: roles and permissions;
  - new `members.ts`;
  - `routes.ts`;
  - `audit.ts`: actions and the two categories;
  - `errors.ts`: `last_owner`.

**Portal:**
- `SessionContext.tsx`: `useCan(key)`, plus loading the session again after a 403 and when a tab regains focus.
- `AccountMenu.tsx:7`: role labels.
- New `features/users/*` in place of `PlannedPage`, wired through `App.tsx:138`, `nav.ts:107` and `settingsView.ts:176-181`.
- The surface rules above, sized per page rather than per control: every push entry point, the "Get set up" card, row menus and bulk bars, empty states, and a read-only mode for the playlist, app, layout, schedule, media and screen-detail editors.
- A "Your role doesn't allow this" page for direct visits.
- Names, and the "renamed" mark, in `AuditPage.tsx:282-286`, `AuditDetailDialog.tsx:83-86` and `lib/activity.ts`.

**Scripts:**
- `seed.ts:62-79`: one named member per role.
- `setup-dev.mjs:252`: four Keycloak users with one-time codes.
- New `provision-member` (`org-create`, `pending`, `fulfil`, `set-name`, `mfa-reset`) and `restore-owner.sql`, in the style of `revoke-subject-sessions.sql`. Every command requires `--executed-by`; `restore-owner` also requires a different `--approved-by`.

**Tests:**
- Role-by-route matrix over every route in `OPERATOR_ROUTE_PATTERNS`, plus unit tests for each refine function.
- A demotion during an upload: the insert is refused and the file discarded.
- `packages/db/test/rls.integration.test.ts`: the table list and the deliberate change to the membership assertions.
- `sec.integration.test.ts`: the new definer grants, and `tinnox_app` unable to read another organisation's invites.
- New `migration-0013.integration.test.ts`: the operator mapping with `FORCE` lifted and restored; the last-owner guard, including two concurrent demotions and a call without `app.org_id`; the invite guard; a removed member's sign-in refused; a session created before `sessions_valid_after` refused; `session_revoke_membership` limited to its own organisation.
- `tests/integration/cross-org.test.ts`: member and invite ids answer 404 across organisations as an Owner; a Viewer gets the same 403 for its own id and a foreign one.
- `npm run verify:oidc`: after "sign out everywhere", signing in with a live Keycloak session asks for the password and the one-time code.
- `fulfil`: an account whose e-mail address differs from the invite's is refused.
- Fixtures that relied on the old default role:
  - `apps/api/test/support.ts:205,232`;
  - `packages/db/test/support.ts:127`;
  - `sec.integration.test.ts:101`;
  - `backup-restore-check.test.ts:142`;
  - `migration-backfill.test.ts:168`.
- New e2e `tests/e2e/14-roles.spec.ts`, which covers ISO-05.

**PRs:**
- **C1, "Roles enforced" (L):** 0013, the domain module, the guard, refine functions and the check inside every write, the activity filter, the real session role, `sessions_valid_after` and `auth_time`, portal gating and read-only pages, the dev users and the tests above.
- **C2, "People" (M):** the members routes, the Users page, names in the audit page, the provisioning and restore scripts, cross-organisation and e2e tests, and the docs:
  - `control-matrix.md` (`:21`, `:64`, and a new row for role enforcement);
  - `threat-model.md` (a new elevation-of-privilege threat, T11, and T14 for routine provisioning);
  - AGENTS.md §1 and `.cursor/BUGBOT.md` together (provisioning as a second use of `tinnox_migrator`);
  - `operations-and-release-checklist.md` (`:38`, `:254`, the weekly identity-provider check, the identity check for resets, and retention rows for `member_invite` and `membership`);
  - `acceptance-tests.md:31` (ISO-05 on four roles, its site step waiting for `site.manage`, and the full audit log hidden from Editors and Viewers) and `:32` (ISO-06 deferred);
  - `tinnox-mvp-spec.md` §8, `:52`, `:95` and `:151` (site scope and several organisations per person deferred), `:162` ("first Owner"), `:222` (handover by promotion);
  - `implementation-backlog.md:104` (split H2: roles and invites done; site scoping, a transfer action and several organisations per person left, with their own card ids and size) and `:39` ("first Owner");
  - `prototype-m0.md:99`;
  - `portal-v2/README.md:27`;
  - `apps/portal/src/lib/settingsView.ts:178`, whose "choose what an owner, an admin, an editor and a viewer may do" reads as configurable roles;
  - a DEC entry recording Michael's answers and the reading of AGENTS.md §2.

**Known residuals (already documented, not new):**
- A database administrator can bypass every application rule (T14). Routine provisioning as `tinnox_migrator` uses that access more often.
- The runtime role can insert an audit row with a false actor (`control-matrix.md:31`). No permission decision reads the audit log.
- Back-channel logout from the identity provider is not implemented (`control-matrix.md:79`): signing out at the identity provider alone does not end CMS sessions.

**Unverified pending runtime:**
- whether Fastify's automatic HEAD routes reach the guard as GET;
- the name of the role CHECK constraint;
- the trigger's behaviour under two concurrent demotions (the 0013 test must cover it);
- whether `SELECT … FOR SHARE` by `tinnox_app` works with its column `UPDATE` grant on `membership`;
- whether Keycloak asks for the password and one-time code after `prompt=login` while its own session is alive (the `verify:oidc` check must show it), and whether Cognito ID tokens carry `auth_time`;
- how soon a player reacts to a push or a revoke.

## Review notes

The review round ran before Michael's answers of 2026-11-19. Those answers settled old D1 to D6, with Editors given the widest option each time, and renumbered old D7 to D13 as D1 to D7. The notes below keep the old numbers.

- S1: applied. Sign-out everywhere, removal and demotion set `sessions_valid_after`, and sign-in compares `auth_time` and forces `prompt=login`.
- S2: applied. Every write transaction checks the role again with `FOR SHARE`, and the "under a second" claim is gone.
- S3: applied. `first_signed_in_at` replaces the audit-log check, and the mistyped-address sentence now names TINNOX's check with `--confirmed-with`.
- S4: applied in part. The migrator's use and the cross-organisation definer read are named and justified. No new database role or decision was added, because this card keeps the three PostgreSQL roles; it is listed under Deferred.
- S5: applied in part. `fulfil` has no subject argument and checks the account's e-mail against the invite; usernames are not derived from the invite reference.
- S6: applied. There is now a `provision-member mfa-reset` with an audit row, sessions ended, and confirmation from another Owner or Admin.
- S7: applied. Invite name and e-mail are cleared when the invite closes, expiry is done by the daily run, and D9 now recommends name only.
- S8: applied in part. Names are unique per organisation, renames are marked, and the false claim was reworded; there is no role or id next to each name.
- S9: applied. The trigger counts by explicit `org_id` and fails closed, and 0013 lifts and restores `FORCE` around the mapping.
- S10: applied. There is a `member_invite_guard`, and `removed_at` and `removed_by` cannot change once set.
- S11: applied as a condition of D11 b: the staff flag, the badge and the role cap.
- S12: applied. `--executed-by`, and for `restore-owner` a different `--approved-by`, go into the audit detail.
- S13: applied. `security.permission_denied` is throttled per member, as in B6.
- S14: applied. The 403 rule is stated precisely, the DEC entry records it, and the cross-org tests were adjusted.
- C1: applied. Entries are `{all}` or `{any, refine}`, with five refine routes written out, and the 403 sentence was reworded.
- C2: applied. `screen.setup` is split into `screen.details`, `screen.hours` and `screen.setup`; `pairing_claim` has no role check; the Contributor cost is restated; the D4 markers and wording are aligned.
- C3: applied. The people routes table was added, and the test iterates `OPERATOR_ROUTE_PATTERNS`, 59 routes after the build.
- C4: applied. `activity.read` has a category allow-list, and other categories answer 200 with an empty page.
- C5: applied. Without `push.publish`, the push count shows as a chip and every push entry point is hidden.
- C6: applied. The "Get set up" card has its own matrix row.
- C7: applied. Missing controls are hidden, not disabled, with a surface table.
- C8: applied. The publish route is kept under an all-of entry, and its retirement moves to a cleanup card.
- C9: applied in part. D12 (inviting an Admin) and D13 (leaving or renaming yourself) were added; D12 recommends yes, following CC-03.
- C10: applied. Users and Audit log entries are hidden without the key, and direct visits get "Your role doesn't allow this".
- C11: applied. Editor pages open read-only, and portal work is sized per page.
- C12: applied. Reserved rows were added for `site.manage`, `org.delete`, rollback and default working hours.
- CC-01: applied. D11 now recommends no staff in customer accounts (now option a), and the other option is bounded.
- CC-02: applied. The invitation table columns now use the D8 letters.
- CC-03: applied. D12 lets Owners invite Admins while TINNOX completes invites, and `org-create` can make two Owners.
- CC-04: applied. A promotion signs nobody out, and Summary item 3 was reworded.
- CC-05: applied. There is a `provision-member set-name` for existing members, and the cell now reads "anyone else".
- CC-06: applied. `restore-owner` can create a successor Owner when nobody active is left.
- CC-07: applied. D6 a now gives everyone the activity card but the Audit log page only to Admins and Owners.
- CC-08: applied, same as C8.
- CC-09: applied. The C2 docs list now covers the backlog, the spec, ISO-06 and `settingsView.ts:178`.
- CC-10: applied. D9 now recommends name only. The `prototype-m0.md:133` citation does not hold, but `auth.ts:245` does.
- CC-11: applied. The three-role option was dropped from D1.
- CC-12: applied. The working-hours note was replaced. The reviewer's example is wrong (a push with nothing assigned is skipped, `routes/push.ts:110-112`), but an Editor can still push a black image.
- CC-13: applied. `idp_disabled_at`, `membership.idp_disable` and the `idp-disabled` command are dropped, and the weekly check reads the identity provider.
- CC-14: applied. Scores and provenance were cut, the D5 b example changed, and the Viewer now sees "reported status".
