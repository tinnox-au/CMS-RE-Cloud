**Request changes: two Medium revocation gaps and one Low test weakness; no Critical or High finding from static review.**

Reviewed `1a036b5..11ea255`: six commits, 222 files. Applied the Ponytail lens to completeness across callers and lifecycle transitions, reuse, scope, meaningful tests, and preservation of security and validation.

**Findings**

“Test exists” means a regression test detecting the exact failure described below.

| ID | Severity | Area | Title | File:line | Test exists |
|---|---|---|---|---|---|
| RCX-01 | medium | Pairing / provisioning | [ponytail] Reactivation revives an outstanding pairing claim | [db/migrations/0013_roles_and_members.sql:521](../../../db/migrations/0013_roles_and_members.sql:521) | no |
| RCX-02 | medium | Incident revocation | [ponytail] Script sets the cutoff before waiting for the member lock | [scripts/revoke-subject-sessions.sql:22](../../../scripts/revoke-subject-sessions.sql:22) | no |
| RCX-03 | low | Authorization tests | [ponytail] Allowed-route assertions accept server errors | [tests/integration/roles-matrix.test.ts:118](../../../tests/integration/roles-matrix.test.ts:118) | no |

**RCX-01 — Removal does not durably invalidate an uncollected pairing claim**

The following sequence is permitted by the implementation:

1. An Editor claims a pairing code; the player delays collecting its credential.
2. An Owner removes that member. The route sets `removed_at`, revokes sessions and cancels invites, but leaves the pairing claim intact. See [members.ts:403](../../../apps/api/src/routes/members.ts:403).
3. Before the claim expires, staff fulfils a new invite for the same subject as a Viewer. Fulfilment reuses the membership ID and clears `removed_at`. See [provision.ts:742](../../../scripts/lib/provision.ts:742).
4. The original polling token can now complete the claim: `pairing_complete` checks only that the membership is currently unremoved, then inserts a player registration. See [0013:521](../../../db/migrations/0013_roles_and_members.sql:521) and [0013:538](../../../db/migrations/0013_roles_and_members.sql:538).

Thus a claim that removal was supposed to invalidate becomes usable again, including after restoration to a role without `screen.pair`. The window is bounded by claim expiry and requires staff reactivation.

This differs from documented SCR-04: that residual permits collection after **demotion or sign-out**; the specification explicitly closes the window for **removal**. See [earlier review:55](../../../docs/reviews/2026-11-20-stage-c-review/README.md:55).

**Suggested fix:** durably invalidate pre-removal claims during removal or before reactivation clears the removal marker. Preserve the documented pairing-row → membership-row lock order; adding pairing updates after locking the member could introduce a deadlock.

**Test gap:** the [removal test:884](../../../packages/db/test/migration-0013.integration.test.ts:884) polls while the member remains removed, permanently expiring the claim. The [reactivation test:463](../../../tests/integration/provision-member.test.ts:463) checks browser sessions but creates no pairing claim. Add claim → remove → reactivate as Viewer → collect, with **no intervening poll**, and assert both refusal and absence of a new registration.

The source establishes the sequence; reproduction is **unverified pending runtime**.

**RCX-02 — The incident script misses the cutoff-after-lock fix used by the API**

The script’s first membership statement both acquires the row lock and assigns `statement_timestamp()` to `sessions_valid_after`. That timestamp belongs to the statement’s start and does not advance while its `UPDATE` waits. See [revoke-subject-sessions.sql:21](../../../scripts/revoke-subject-sessions.sql:21).

If another transaction holds the member row:

- The revocation statement starts at T0 and waits.
- The provider authenticates a sign-in at T1, at least one whole second after T0.
- The script obtains the lock and finishes at T2, after T1.
- A subsequent callback using T1 passes the stored cutoff and can create a live session without another authentication.

The API avoids this by locking the target first, then invoking revocation. The migration explicitly explains why authentication during those lock waits must also be refused. See [members.ts:191](../../../apps/api/src/routes/members.ts:191) and [0013:557](../../../db/migrations/0013_roles_and_members.sql:557).

**Suggested fix:** acquire the target membership lock before calculating the cutoff, then retain the monotonic `greatest()` update, session revocation and audits in the same transaction. Ensure the chosen timestamp is evaluated after the lock has been acquired.

**Test gap:** the [script test:131](../../../tests/integration/session-revoke-all.test.ts:131) covers an uncontended cutoff, old authentication and preservation of a later cutoff. It never blocks the script’s membership update. Add that contention and authenticate during the wait; after the script commits, that authentication should require reauthentication.

This is a caller-completeness gap, distinct from documented provider/database clock skew. Its concurrent reproduction is **unverified pending runtime**.

**RCX-03 — The role matrix can pass when allowed requests return HTTP 500**

The matrix sends empty requests and random IDs. For an allowed role, it rejects only `401` and `403`; `500`, `503` or `429` count as success. See [roles-matrix.test.ts:114](../../../tests/integration/roles-matrix.test.ts:114).

Consequently, a failure in an allowed authorization path could leave this matrix green. The denied branch is stronger: it compares the complete expected generic refusal.

**Suggested fix:** specify acceptable statuses for each probe and reject unexpected errors. Use valid fixtures and bodies where successful execution is required to demonstrate access. This need not duplicate every endpoint’s functional tests.

The permissive assertion is directly verifiable from source; I did not run a mutation test.

**Derived role-to-route authorization matrix**

This covers all **59 operator routes: 26 reads and 33 writes**. Paths below have the `/api` prefix; braces enumerate alternatives. ✓ means the role passes route authorization, subject to validation, tenant lookup and the additional rules below.

Derived from [permissions.ts:62](../../../apps/api/src/auth/permissions.ts:62), [domain permissions:11](../../../packages/domain/src/permissions.ts:11) and the handlers.

| Method and route(s) | Required permission | Owner | Admin | Editor | Viewer |
|---|---|:---:|:---:|:---:|:---:|
| GET `/sites`, `/displays`, `/displays/status`, `/displays/:id`, `/displays/:id/status` | `org.read` | ✓ | ✓ | ✓ | ✓ |
| GET `/media`, `/media/:id`, `/media/:id/{preview,thumbnail,usage}` | `org.read` | ✓ | ✓ | ✓ | ✓ |
| GET `/{apps,schedules,layouts,playlists}` and `/{apps,schedules,layouts,playlists}/:id` | `org.read` | ✓ | ✓ | ✓ | ✓ |
| GET `/{tags,folders,push,overview}` | `org.read` | ✓ | ✓ | ✓ | ✓ |
| GET `/audit` | `activity.read`; full log additionally needs `audit.read` | Full | Full | Activity | Activity |
| GET `/members/names` | `activity.read` | ✓ | ✓ | ✓ | ✓ |
| GET `/members`, `/invites` | `member.read` | ✓ | ✓ | — | — |
| POST `/displays` | `screen.setup` | ✓ | ✓ | ✓ | — |
| PATCH `/displays/:id` | Every submitted field’s permission | ✓ | ✓ | ✓ | — |
| POST `/displays/:id/{claim,revoke-player}` | `screen.pair` | ✓ | ✓ | ✓ | — |
| POST `/{media,apps,schedules,layouts,folders,playlists}` | `content.write` | ✓ | ✓ | ✓ | — |
| PATCH `/{media,apps,folders}/:id` | `content.write` | ✓ | ✓ | ✓ | — |
| PUT `/{schedules,layouts,playlists}/:id` | `content.write` | ✓ | ✓ | ✓ | — |
| POST `/playlists/:id/duplicate` | `content.write` | ✓ | ✓ | ✓ | — |
| DELETE `/media/:id` | `media.delete` | ✓ | ✓ | ✓ | — |
| DELETE `/{apps,schedules,layouts,folders,playlists}/:id` | `content.delete` | ✓ | ✓ | ✓ | — |
| POST `/tags`; PATCH `/tags/:id` | Media: `content.write`; display: `screen.setup` | ✓ | ✓ | ✓ | — |
| DELETE `/tags/:id` | Media: `content.delete`; display: `screen.setup` | ✓ | ✓ | ✓ | — |
| POST `/playlists/:id/publish` | `push.publish` **and** `screen.assign` | ✓ | ✓ | ✓ | — |
| POST `/push` | `push.publish` | ✓ | ✓ | ✓ | — |
| PATCH `/members/:id` | `member.manage` plus target/grant rules | ✓ | Restricted | — | — |
| POST `/members/:id/{remove,sign-out}` | `member.manage` plus target rules | ✓ | Restricted | — | — |
| POST `/invites` | `member.manage` plus grant rules | ✓ | Restricted | — | — |
| POST `/invites/:id/cancel` | `member.manage` plus invite-role rule | ✓ | Restricted | — | — |

Display PATCH maps fields as follows; mixed requests require every applicable key. See [permissions.ts:158](../../../apps/api/src/auth/permissions.ts:158).

| Fields | Permission |
|---|---|
| `name`, `description`, `tagIds` | `screen.details` |
| `workingHours` | `screen.hours` |
| `canvas`, `contentRect`, `defaultFit`, `rotation` | `screen.setup` |
| `assignedPlaylistId`, `assignedScheduleId`, `assignedLayoutId` | `screen.assign` |

Additional rules:

- Admins manage Editors/Viewers and grant only those roles. Owners manage other active members of every role. Nobody changes, renames, removes or signs out themselves through these member-management routes.
- Nobody invites an Owner. Owner promotion requires a recorded first sign-in.
- The database prevents removal or demotion of the last active Owner.
- Unauthorized roles receive the same generic `403` before object lookup. An authorized role supplying a foreign member/invite ID receives `404`.
- Tag updates/deletes derive scope from the stored row. `HEAD` uses the corresponding GET permission.

The remaining application routes use other authentication mechanisms:

| Routes | Authorization |
|---|---|
| GET `/healthz`, `/readyz` | Public operational checks |
| GET `/api/auth/login`, `/api/auth/callback` | OIDC initiation / validated callback |
| GET `/api/session` | Anonymous result or current verified session |
| POST `/api/auth/logout` | Any live member session; Origin and CSRF checks |
| POST `/player/pairing` | Public, bounded pairing initiation |
| GET `/player/pairing/:id` | Pairing polling token |
| DELETE `/player/registration`; GET `/player/manifest`; POST `/player/media-urls`, `/player/heartbeat` | Live device credential |
| GET `/player/media/:assetId` | Signed URL bound to registration, publication, asset and expiry; registration rechecked |

These are separate from the operator permission table. See [auth.ts:328](../../../apps/api/src/routes/auth.ts:328) and [player.ts:195](../../../apps/api/src/routes/player.ts:195).

**Verified as correct by static reading**

- **Migration history and upgrade:** only `0013` is added; `0001–0012` are unchanged, with no numbering gap. Every existing `operator` becomes an Owner deliberately, preserving existing capabilities and adding the new Owner management rights. Existing live sessions remain valid. First sign-in is backfilled from retained session rows; purged history cannot be recovered. See [0013:67](../../../db/migrations/0013_roles_and_members.sql:67).
- **Migration execution:** schema changes and the history row share one transaction. Repeat execution is handled by the checksum-aware runner; the raw SQL is not independently rerunnable. An upgrade-and-rerun integration test exists. See [migrate.ts:95](../../../packages/db/src/migrate.ts:95) and [migration test:268](../../../packages/db/test/migration-0013.integration.test.ts:268).
- **Database boundaries:** `member_invite` has ENABLE/FORCE RLS, an organisation policy with both `USING` and `WITH CHECK`, and composite tenant foreign keys. Temporarily lifted FORCE on membership/session is restored inside the migration transaction. Runtime membership updates are restricted to four columns; audit grants remain append-only. Changed `sec.*` functions pin `search_path` and retain the intended owner/execution grants. See [0013:212](../../../db/migrations/0013_roles_and_members.sql:212), [0013:280](../../../db/migrations/0013_roles_and_members.sql:280) and [0013:641](../../../db/migrations/0013_roles_and_members.sql:641).
- **API enforcement:** authorization is enforced server-side, including a default-deny route table and transaction-time membership recheck. Member routes apply target rank and grant rank separately. Tenant context comes from the verified session, and writes retain the member lock through commit. See [permissions.ts:383](../../../apps/api/src/auth/permissions.ts:383) and [members.ts:183](../../../apps/api/src/routes/members.ts:183).
- **Revocation and audit:** apart from the findings above, demotion/removal/sign-out flows revoke sessions and write their successful change audits in the same transaction. Promotions retain sessions intentionally. The fallback SQL’s cutoff and audit are also atomic; RCX-02 concerns timing, not atomicity.
- **CSRF, contracts and privacy:** new mutations inherit exact-Origin and session-CSRF enforcement. Member/invite request contracts are strict and align with handlers. Member responses exclude email; pending invite details are cleared on closure. See [session.ts:110](../../../apps/api/src/auth/session.ts:110), [members contract:1](../../../packages/contracts/src/members.ts:1) and [0013:265](../../../db/migrations/0013_roles_and_members.sql:265).
- **Provisioning reader fix:** the template supplies `kc-admin-api`, restricts the service account/scope mapping to `view-users`, and disables interactive/password flows. The reader requires an exact account match. Verification checks successful lookup, denied account creation and effective management roles. Live imported permissions remain unverified. See [realm-template.json:77](../../../infra/keycloak/realm-template.json:77), [realm-template.json:767](../../../infra/keycloak/realm-template.json:767) and [verify-oidc-login.mjs:342](../../../scripts/verify-oidc-login.mjs:342).
- **Ponytail scope/reuse:** no dependencies were added; `package.json` adds only the provisioning command. Provisioning, recovery, portal restrictions and fixture/config changes are requested by Stage C. Shared authorization wrappers serve the existing routes, and moved upload-abandonment handling retains its cleanup behavior. I found no additional actionable unnecessary abstraction or unrequested feature.

**Test quality assessment**

The tests generally exercise the relevant behavior rather than merely reproduce implementation tables:

- The migration test upgrades populated `0012` data and checks Owner mapping, retained sessions, FORCE RLS and rerun behavior.
- Last-owner tests exercise real SQL, including concurrent changes. The API’s injected constraint error tests error translation separately. See [migration test:539](../../../packages/db/test/migration-0013.integration.test.ts:539).
- Cross-org member/invite tests compare foreign IDs with unknown IDs and verify unchanged data. See [cross-org.test.ts:311](../../../tests/integration/cross-org.test.ts:311).
- Controlled write races test removal/sign-out during push and upload, including absence of unauthorized persisted results. See [roles.integration.test.ts:311](../../../apps/api/test/roles.integration.test.ts:311).
- Provisioning tests inject audit insertion failures and check rollback. See [provision-member.test.ts:945](../../../tests/integration/provision-member.test.ts:945).

Those assertions target meaningful failures. The two lifecycle/contention combinations in RCX-01/02 are missing, and RCX-03 weakens the matrix’s positive assertions. I did not run mutation testing.

Previously documented residuals remain residuals, rather than new findings: fresh authentication before Owner actions, privileged provisioning and typed staff attestations, development secret exposure, reads already in flight, provider clock/claim assumptions, and partial push results. See [earlier review:63](../../../docs/reviews/2026-11-20-stage-c-review/README.md:63).

**Checks run**

| Check | Result |
|---|---|
| Requested diff and six-commit log | Reviewed |
| Migration history and dependency diff | Only migration 0013 added; no dependency changes |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `git diff --check 1a036b5 11ea255` | Passed |
| Final `git status --porcelain=v1` | Clean; no edits or commits |

Not checked: runtime suites, live role/OIDC probes and portal interaction, reserved for the parallel reviewer—**unverified pending runtime**.  
Risk: migration lock duration could not be determined from reading; [0013:26](../../../db/migrations/0013_roles_and_members.sql:26) requires stopping the API, migrating, then starting the matching API and portal.