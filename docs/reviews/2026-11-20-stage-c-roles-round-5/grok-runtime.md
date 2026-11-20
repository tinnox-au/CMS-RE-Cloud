Do not merge yet: two medium security bugs are reproduced (an uncollected pairing still registers a player after the claimer is removed and reactivated, and the incident revocation script stamps its cutoff before it gets the row lock).

## Environment and versions

Fresh machine. Node was already 22. Docker was not installed, so Docker Engine was installed and `dockerd` was started directly (this VM has no running systemd). `npm run setup`, `npm run infra:up`, `npm run db:migrate` and `npm run db:seed -- --second-org` completed. The upgrade check used a separate database, `tinnox_upgrade`, so the seeded development database stayed on a fresh 0013.

| Component | Version |
|---|---|
| Node | 22.23.4 |
| npm used for `npm ci` | 11.21.2 (package manager in `package.json`; the image npm is 10.9.9) |
| Docker Engine | 29.1.3 |
| Docker Compose | 2.40.3 |
| PostgreSQL | 17.12 (`postgres:17.12-alpine3.24`, healthy) |
| Keycloak | 26.8.2 (realm `tinnox-dev` imported, healthy) |
| Media worker | image `tinnox-cms-media-worker:m0`, healthy, ffprobe 8.1.3 |
| Playwright | 1.65.1, Chromium headless shell 159.0.8154.6 (build 1255) |
| Commit | `11ea255` on `feat/stage-c-roles`, merge-base `1a036b5` |

`git diff 1a036b5 11ea255 -- db/migrations` adds only `0013_roles_and_members.sql`. Migrations 0001–0012 are byte-identical to main.

## Summary

| ID | Severity | Area | Title | File:line | Reproduced at runtime | Test exists |
|---|---|---|---|---|---|---|
| RCU-01 | medium | pairing | Removing a member does not durably kill an uncollected pairing claim | `db/migrations/0013_roles_and_members.sql:521` | yes | no for this sequence |
| RCU-02 | medium | sessions | Incident revocation stamps the cutoff at statement start, while the UPDATE is blocked | `scripts/revoke-subject-sessions.sql:22` | yes | no |
| RCU-03 | info | tests | The HTTP `last_owner` case injects the database error [ponytail] | `apps/api/test/members.integration.test.ts:497` | yes (live race returns 401, not 409) | the injection test exists; it would still pass if the trigger stopped raising |

## Reproduction of RCX-01 and RCX-02

### RCX-01 — REPRODUCED

An Editor claimed a pairing code. The Owner removed that member. `fulfil()` reactivated the same membership as a Viewer. With no poll in between, the original polling token collected a new player registration.

The identity-provider lookup was a stub that returned that member's subject and the invite's email. Every database step was the real `fulfil()` in `scripts/lib/provision.ts`, including the reactivation `UPDATE` at line 742. No `GET /player/pairing/:id` was sent between the claim and the final collection.

Steps and observed rows (database clock, suffix `cfbe3c17`):

1. Inserted membership `8207ccff-a160-4c0b-83b5-69b1c81c9768`, role `editor`, subject `rcx01-cfbe3c17`. Signed in through `sec.session_create`. Created screen `04ad51c2-f034-4fc0-909e-f70e36517d24`.
2. `POST /player/pairing` then `POST /api/displays/04ad51c2-f034-4fc0-909e-f70e36517d24/claim` with the code. HTTP 200, `pairingId` `170b4913-480f-45eb-84f3-6cf43f27bdf9`. Row: `status=claimed`, `claimed_by=8207ccff-…`, `registration_id` null, unexpired (`expires_at` 02:38:40Z).
3. `POST /api/members/8207ccff-…/remove` as the Owner. HTTP 200. Membership `removed_at=2026-11-20 02:28:40.078466+00`, role still `editor`. Pairing row unchanged: still `claimed`, still unexpired, still no registration.
4. `POST /api/invites` as the Owner, role `viewer`, HTTP 201, invite `fc83bfc0-ec58-468d-a2c6-7b613e35515f`. Then `fulfil()` with `--username rcx01-cfbe3c17`'s stub account. Result: `reactivated: true`, same membership id, role `viewer`, `removed_at` null. `sessions_valid_after` stayed `02:28:40.080933+00` (the removal cutoff was kept). Pairing row still `claimed`, `claimed_by` still that id, registrations still `[]`.
5. `GET /player/pairing/170b4913-480f-45eb-84f3-6cf43f27bdf9` with the original `Authorization: Bearer` polling token. HTTP 200, body `status: "claimed"`, a device token (length 43), `registrationId: 501c4fe7-c160-49af-b16c-09e627749123`. `player_registration` gained that id at `02:28:40.125127+00`, `revoked_at` null. Pairing row became `completed` with that `registration_id`.

`sec.pairing_complete` (`0013_roles_and_members.sql:521-523`) only requires `removed_at IS NULL` at collection time. Removal (`apps/api/src/routes/members.ts:403-405`) sets `removed_at` and revokes sessions, and does not expire the claim. Reactivation clears `removed_at` on the same id, so the check passes. The existing test at `packages/db/test/migration-0013.integration.test.ts:884-898` collects while the member is still removed, which expires the claim. It never reactivates and then collects.

Suggested fix: expire that member's `claimed` pairing rows in the removal transaction, and make `pairing_complete` refuse a claim whose `claimed_at` is not after `sessions_valid_after`. Reactivation already keeps that cutoff, so an old polling token cannot complete after the person comes back.

### RCX-02 — REPRODUCED

`sessions_valid_after` was stamped with the time the `UPDATE` started, not the time it got the lock. A sign-in authenticated 2.2 seconds later, while the statement was blocked, was accepted. The same wait through `POST /api/members/:id/sign-out` refused that sign-in.

`auth_time` was passed to `sec.session_create` directly. No Keycloak round-trip was timed.

Script path. A superuser transaction held `SELECT … FOR UPDATE` on membership `rcx02-script-ef5d0e00`. The migrator session then ran the script's statement (`SET LOCAL ROLE tinnox_definer`, then the `UPDATE` at `revoke-subject-sessions.sql:22`).

| Event | Database time |
|---|---|
| `pg_stat_activity.query_start` while blocked | 2026-11-20T02:28:40.145Z |
| Wait | `Lock` / `transactionid`, state `active` |
| `T1` captured while still blocked | 2026-11-20T02:28:42.348Z (2203 ms after query start) |
| Holder rolled back | 2026-11-20T02:28:42.349Z |
| `UPDATE` returned: `statement_timestamp()` and stored cutoff | 2026-11-20T02:28:40.145Z |
| `clock_timestamp()` at the end of that same statement | 2026-11-20T02:28:42.350Z |
| Commit | 2026-11-20T02:28:42.351Z |

`sessions_valid_after` minus `query_start` is 0 ms. `sessions_valid_after` minus `T1` is −2203 ms. `sec.session_create` with `auth_time = T1` returned `created`. The same call with `auth_time` two seconds before `query_start` returned `reauth`, so the cutoff is enforced and is simply too early. The one-second whole-second grace in `session_create` (`0013_roles_and_members.sql:347-350`) does not cover a 2.2 second wait.

API path, same shape, different member (`rcx02-api-ef5d0e00`). The holder kept `FOR UPDATE`. `POST /api/members/:id/sign-out` blocked in `tinnox-api` on:

```sql
SELECT id, display_name, role, first_signed_in_at, removed_at
FROM membership WHERE id = $1 AND org_id = app_org_id() FOR NO KEY UPDATE
```

That is `lockTarget` at `apps/api/src/routes/members.ts:189-191`. `T1` was 2026-11-20T02:28:44.574Z. After the holder rolled back, the HTTP response was 200 `{ sessionsEnded: 0 }`. Stored cutoff was 2026-11-20T02:28:44.576Z, 2 ms after `T1`. `sec.session_create` with `auth_time = T1` returned `reauth`.

The API locks the row in an earlier statement, so the cutoff `UPDATE` inside `sec.session_revoke_membership` starts only after the lock is held. The script's `UPDATE` is itself the statement that waits, and `statement_timestamp()` is fixed at the start of that wait.

Suggested fix: `SELECT … FOR UPDATE` (or `FOR NO KEY UPDATE`) the membership row first, then set `sessions_valid_after` from `clock_timestamp()` or from `statement_timestamp()` of a statement that starts after that lock returns.

## Per-finding detail

### RCU-01

Covered above. Severity is medium: the player must still hold the original polling token, and staff must fulfil a new invite for the same subject, but the result is a live `player_registration` for a person who is now a Viewer and was removed in between.

### RCU-02

Covered above. Severity is medium: it is the incident path, and only a sign-in whose `auth_time` falls in the lock-wait window is accepted. That window was 2.2 seconds here and is bounded by `lock_timeout` (30 seconds for `tinnox_migrator`). The API people routes do not have this hole.

### RCU-03 [ponytail]

`apps/api/test/members.integration.test.ts:497-570` says the API never reaches the last-owner trigger, then throws a synthetic `23001` / `membership_last_owner` from a proxy around `pool.query`. Deleting the trigger would not fail this test. `packages/db/test/migration-0013.integration.test.ts:536-568` does run the real trigger, including two concurrent demotions.

Live check, two Owners demoting each other through `PATCH /api/members/:id`: HTTP 200 (`sessionsEnded: 1`) and HTTP 401 `unauthenticated`. Exactly one Owner remained. The loser was refused because `assertStillAllowed` saw the new cutoff (`apps/api/src/auth/permissions.ts:388-390`), which is the secure outcome. 409 `last_owner` was not what the API returned.

## Suite results

| Suite | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run format:check` | pass, all matched files |
| `npm run lint` (`--max-warnings=0`) | pass on the retry. The first run died with a JavaScript heap out-of-memory error at the default heap. `NODE_OPTIONS=--max-old-space-size=6144` then exited 0 |
| `npm test` (unit) | 89 files, 1918 tests, all passed (6.25 s) |
| `npm run test:component` | 14 files, 61 tests, all passed (Chromium) |
| `npm run test:integration` | first run: 38 files passed, 1 file failed, 474 tests passed, 17 skipped. The failure is `tests/integration/backup-restore-check.test.ts:366`: `sample media are missing; run "npm run fixtures" first`. That file is unchanged by this PR. After `npm run fixtures`, that file alone passed 17/17 (61 s). With fixtures present the suite is 39 files, 491 tests, all passed. Not caused by the PR |
| `npm run test:e2e` | 140 passed, 1 failed, 2 did not run, 15.8 minutes. `e2e/14-roles.spec.ts` all 7 passed. Axe on Users, including the invite dialog, passed in light and dark (`e2e/11-accessibility.spec.ts`) |

E2E failure: `tests/e2e/07-apps-player.spec.ts:347` “on a 1376x774 canvas the Text app fits without overflow”. One text line reported `clipped: true` (`scrollWidth > clientWidth + 1`). The file is `test.describe.configure({ mode: 'serial' })`, so the next two tests did not run: the 90-degree ticker (`:387`) and the apps CSP check (`:436`). `git diff 1a036b5 11ea255` does not touch `apps/player-web`, `packages/app-render`, or this spec. The font stack is `system-ui` (`packages/app-render/src/render.ts:33`). This is a font-metric difference on this Linux VM, not a change in this PR.

## What was verified as correct

- Upgrade on `tinnox_upgrade`: 0001–0012 applied, then four `operator` memberships and three sessions (one revoked, two live, one member with no session). 0013 applied once through the real runner. Membership count stayed 4, sessions 3, organisations 2. Every `operator` became `owner`. `first_signed_in_at` for the member with two sessions is the earlier (revoked) `created_at`, 2026-11-10T02:12:17.533Z. The member who never signed in stayed null. Both live sessions then resolved as `owner`. The revoked session did not. `FORCE ROW LEVEL SECURITY` is back on `membership` and `session`; the migrator with no organisation context sees 0 membership rows. Stored checksums of 0001–0012 were unchanged across 0013 and match the files. A one-line tamper of `0001_schema.sql` was refused: `migration 0001_schema.sql was changed after it was applied`. The five-argument `sec.session_create` is gone. The role check is `membership_role_known`.
- Live API, seeded Owner, Admin, Editor, Viewer, and the second organisation's Owner. `GET /api/session` permissions match the stage C role table. All 59 operator routes against all four roles returned the matrix in section 1.3: a missing key is 403 `forbidden` with “Your role doesn't allow this.” before lookup; an allowed call was not 401 or 403. Empty-body writes created no playlists. `HEAD /api/displays` as a Viewer was 200.
- Editor created a screen, renamed it, set working hours, changed the canvas, created media and display tags, and assigned a playlist. Viewer writes on their own id and on a random id were the same 403 message. The second organisation's Owner got 404 `not_found` for that screen, for a member patch, and for cancelling an invite. A Viewer read of an unknown screen was 404.
- `GET /api/audit?category=auth` and `category=membership` were 200 with an empty page for Viewer and Editor. An unfiltered Viewer page contained only activity categories. `GET /api/members` is 403 for Editor and Viewer and 200 for Admin, with no email field. `GET /api/members/names` for a Viewer returned only `id`, `displayName`, `removed`, `renamedAt`.
- CSRF and Origin on `POST /api/invites`: missing or foreign Origin, and `sec-fetch-site: cross-site`, were 403 `origin_not_allowed`. A wrong or missing CSRF token was 403 `csrf_failed`. None of those created an invite. No cookie on `GET /api/members` was 401.
- An Admin cannot grant `admin` or `owner`, cannot change or remove an Owner, and cannot invite an Admin (403). An Owner inviting `owner` was 400. Promoting a member with `first_signed_in_at` null to Owner was 409 `conflict`. Nobody can change their own role or name (403), and the seeded Owner stayed `Dev Owner` / `owner`. An Admin can invite a Viewer and cancel an Editor invite, and cannot cancel an Admin invite.
- `xmin` of the membership row matched the audit row for `invite.create`, `membership.update`, and `membership.role_change`. A name clash (409) wrote no `membership.update`. A refused removal wrote one new `security.permission_denied` and no `membership.remove`. A refused `GET /api/members` wrote no denial row.
- Demotion and removal end the session immediately. After demotion, `GET /api/displays` was 401 and `GET /api/session` was 200 `{ authenticated: false }` (`apps/api/src/routes/auth.ts:331`). `sec.session_create` with an `auth_time` from an hour earlier returned `reauth`; a future `auth_time` returned `created` with the new role. Sign-out everywhere and removal did the same to the old cookie. A removed subject then got `no_membership`. The last Owner cannot demote or remove themselves (403).
- Portal, through the full Playwright run: a Viewer sees no write controls and is refused by the API; an Editor can publish and cannot open people; an Admin manages only Editors and Viewers; a demotion and a sign-out end an open editor session; Users fits a phone. Axe reported no serious or critical issues on Users or the invite dialog, light and dark.

## What I could not run, and why

- A Keycloak sign-in timed so that the ID token's `auth_time` falls inside the RCX-02 lock wait. `sec.session_create` was called with a chosen `auth_time` instead, which is the check the callback uses.
- The two serial player tests that Playwright skipped after the text-fit failure.
- A listening pass with a screen reader. Axe on the Users page passed; that is not a screen-reader pass.
- Cognito `auth_time` and `prompt=login`. Out of scope for this branch, and already listed as unverified in the spec.