# Stage C review: roles and people

Date: 20 November 2026, Australia/Melbourne (UTC+11).
What this is: a review of the whole stage C build (CMS-13, DEC-35) with its fixes. The reviewers worked read-only; the surviving findings were then fixed by area on the same branch, and the integration checks were run again. This folder records the outcome.

| Item | Value |
|---|---|
| Repository | `tinnox-au/tinnox-cms` |
| Baseline | `main` |
| Change under review | The `feat/stage-c-roles` branch: migration 0013, contracts and domain, the API guard and the people routes, the portal (roles, read-only editors, the Users page, names in activity), `provision-member` and the development users. Build spec `docs/portal-v2/stage-c.md`; decision record `docs/portal-v2/stage-c-roles-decision.md` |
| Reviewer | Claude Code workflow: eight lenses, adversarial verification |
| Lenses | Session and sign-in; tenant isolation; scripts and provisioning; database, roles and migration; authorisation and escalation; audit; tests that prove it; portal |
| Finding IDs | `SCR-01` to `SCR-35` |
| Runtime | Read-only review; the verifiers read the code and ran unit and component tests. Integration tests were run by the fixers on their own test databases, then by the integration step on `tinnox_test` (see "Test runs") |

Each finding was raised by one or more lenses, combined with its duplicates, and then given to a second reviewer told to refute it. A finding survives only when that reviewer could not refute it. Line numbers are as the reviewers read them, before the fixes.

## Reviewer report

41 raw findings, 35 once duplicates were combined. **No Critical, High or Medium finding survived.**

| Outcome | Count | IDs |
|---|---|---|
| Survived as Low, fixed | 13 | SCR-01, 05, 07, 09, 10, 11, 12, 15, 16, 17, 18, 19, 20 |
| Survived as Observation, fixed | 2 | SCR-14 (raised as Low), SCR-22 |
| Refuted | 8 | SCR-02, 03, 04, 06, 08, 13, 21, 23 |
| Known residuals (Observation, already documented) | 12 | SCR-24 to SCR-35 |

## Fixed

| ID | Severity | Area | Finding | Where | Fix |
|---|---|---|---|---|---|
| SCR-01 | Low | Portal | After `csrf_failed`, the client resent the write as whichever member the cookie now belonged to, even in another organisation | `apps/portal/src/api/client.ts:272` | The client keeps the token with the member and organisation it belongs to; for another member or organisation it never resends, drops the token and restarts the portal (the focus refresh does the same) |
| SCR-05 | Low | API, scripts | A rename (portal PATCH or `provision-member set-name`) could take a pending invite's name, after which TINNOX could never fulfil the invite | `apps/api/src/routes/members.ts:303` | PATCH answers 409 on `displayName`, `set-name` refuses, and the Correct name field says "An invite waiting for TINNOX uses this name." |
| SCR-07 | Low | API | A sign-in refused by a lock timeout wrote no `auth.login` row | `apps/api/src/routes/auth.ts:270` | The callback writes an unscoped `auth.login` failure (reason `member_locked`) before redirecting with `provider_unavailable` |
| SCR-09 | Low | Scripts | The provisioning "every command" audit-failure test covered three of the six commands | `tests/integration/provision-member.test.ts:911` | The test also covers `set-name` and both `restore-owner` modes, failing each audit insert of `--successor` in turn |
| SCR-10 | Low | Database | Existing members were not given a first sign-in, so every existing person read "Not signed in yet" and Owner promotion was refused | `db/migrations/0013_roles_and_members.sql:46` | 0013 sets `first_signed_in_at` from the earliest session row still kept, with `FORCE` lifted on `session` too inside the transaction |
| SCR-11 | Low | Portal | The role, name and sign-out dialogs reported a failure when the outcome was unknown, and kept the stale list | `apps/portal/src/features/users/RoleDialog.tsx:96` | Each says the change "could not be confirmed" and reloads both lists, as the Remove dialog did |
| SCR-12 | Low | Portal | Unnamed members could not be told apart in row menus or the Remove confirm | `apps/portal/src/features/users/UsersPage.tsx:230` | "Unnamed person" plus an 8-character reference from the membership ID (`memberLabel`); role and date would not tell rows apart after the upgrade |
| SCR-14 | Observation (raised as Low) | Scripts | `set-name` recorded "Name corrected" when the name had not changed | `scripts/lib/provision.ts:825` | The same name writes nothing and prints "nothing changed" |
| SCR-15 | Low | Portal | The Correct name dialog promised a "renamed" mark that a first naming never gets | `apps/portal/src/features/users/NameDialog.tsx:104` | The "renamed" sentence shows only when a set name is corrected |
| SCR-16 | Low | Portal tests | The Canvas read-only Enter test failed now and then in a full component run | `apps/portal/src/features/displays/detail/CanvasTab.test.tsx:87` | The cause was the Vitest Playwright provider's frame lookup, in any file: keyboard steps type into their own field, and every component test file waits for its frame (`apps/portal/src/componentTests.setup.ts`) |
| SCR-17 | Low | Portal | The screen's Overview tab showed customers the heading "Set by the operator" | `apps/portal/src/features/displays/detail/OverviewTab.tsx:105` | The heading is "Set in TINNOX CMS" |
| SCR-18 | Low | Portal | The read-only app editor still told a Viewer to choose other colours | `apps/portal/src/features/apps/AppEditor.tsx:704` | For a read-only role the contrast warning keeps the fact and drops the instruction |
| SCR-19 | Low | Portal | The failed-media page kept a "fix and upload" instruction in its reason banner for a Viewer | `apps/portal/src/features/media/detail/MediaPendingView.tsx:64` | Read-only roles get the first sentence of each media failure message, on the page and in list rows and tiles |
| SCR-20 | Low | Portal | Texts outside the spec's tables still told a Viewer to pair or add screens | `apps/portal/src/lib/screenStatus.ts:77` | An unpaired screen reads "… so it receives no content."; the dashboard's no-screens text names an editor for roles without `screen.setup` |
| SCR-22 | Observation | Scripts | `verify:oidc` proved the provisioning reader cannot create accounts, not that it holds `view-users` only | `scripts/verify-oidc-login.mjs:375` | Step 7 also checks that the reader's effective `realm-management` roles are `view-users` and its composites only (written, not run) |

## Refuted

| ID | Raised as | Finding | Where | Why it was refuted |
|---|---|---|---|---|
| SCR-02 | Low | Provisioning commands keyed by a bare membership id can change another customer's member, and the output does not name the organisation | `scripts/lib/provision.ts:812` | The code is as described, but the scenario needs staff to run the command with a wrong membership id; the change stays inside that row's organisation and is audited there with the request reference. Kept as an Observation: printing the organisation, as `fulfil` does, would help. (The verifier's note was cut short; this reason is read from the code.) |
| SCR-03 | Low | A repeated option is replaced by its last value | `scripts/lib/provision.ts:243` | True, but in the scenario (a reused command with a new id appended) the last value is the intended one, so nothing wrong happens |
| SCR-04 | Low | A pairing claim made before a demotion or a sign-out everywhere can still be collected | `db/migrations/0013_roles_and_members.sql:508` | The claim is the authorised write, checked for its role when it was made; codes expire within minutes, and the spec closes the window for a removal only (default 8). Now listed as a residual (control matrix B5, threat model T3 and T17). Round 6 closed it (RCX-01): `sec.pairing_complete` now refuses a claim made at or before the claimer's cut-off; see `docs/reviews/2026-11-20-stage-c-roles-round-6/README.md` |
| SCR-06 | Low | A pairing refused because its claimer was removed is expired without an audit row | `db/migrations/0013_roles_and_members.sql:508` | Specified behaviour, the same pattern an earlier round accepted, and no audited fact is lost: the claim and the removal are both recorded. Now listed as a residual (control matrix B11) |
| SCR-08 | Low | No test shows that a people-route change and its audit row commit together | `apps/api/src/routes/members.ts:409` | Each change and its audit row share one transaction today; the spec does not ask for this test; it guards only against a future change |
| SCR-13 | Low | Read-only portal tests set `readOnly` themselves, so none shows a Viewer gets locked editors | `apps/portal/src/features/displays/detail/ScreenDetail.tsx:59` | The role-to-read-only mapping is correct today; a wish for more coverage, not a defect. `tests/e2e/14-roles.spec.ts` covers it end to end |
| SCR-21 | Observation | Migration 0013 makes every existing member an Owner without an audit row | `db/migrations/0013_roles_and_members.sql:71` | Nothing about membership was audited before 0013, so no earlier role could be traced either; the mapping is decided (D4 a) and documented. Now listed as a residual (control matrix B11) |
| SCR-23 | Observation | The forbidden page heading uses a straight apostrophe | `apps/portal/src/shell/ForbiddenPage.tsx:9` | The spec and the record ask for this exact text; the curly-quote rule the finding cites is for the Users page |

## Known residuals (Observations)

Each was already documented before this review; the review confirmed it. Where a residual was missing from the control matrix or the threat model, it was added there with this record.

| ID | Residual | Where | Documented in |
|---|---|---|---|
| SCR-24 | No fresh sign-in before Owner-level actions: a stolen Owner session can promote, demote, remove or sign out other Owners and Admins (every step audited) | `apps/api/src/routes/members.ts:291` | `stage-c.md` section 12 (deferred, before the first external customer); `stage-c-roles-decision.md`, Deferred; control matrix B16 and ISM-2048/2049; threat model T17 |
| SCR-25 | After a cut-off, signing in depends on the provider sending `auth_time` and honouring `prompt=login`; without `auth_time` the member cannot sign in again | `db/migrations/0013_roles_and_members.sql:334` | `stage-c.md` risk 2 and "As built" (not verified yet); control matrix B1; threat model section 14 |
| SCR-26 | Routine provisioning runs as `tinnox_migrator`; the guard exemptions test `session_user = 'tinnox_migrator'`; the two staff ids are typed, not proven | `db/migrations/0013_roles_and_members.sql:100` | Threat model T14 and section 14; `stage-c.md` risk 7 and section 12 (a dedicated provisioning role); `AGENTS.md` §1 |
| SCR-27 | `tinnox_definer` has a script-only cross-organisation read of invite names and e-mail addresses and `UPDATE (status)`; `invited_by` is granted but no definer query reads it | `db/migrations/0013_roles_and_members.sql:286` | `AGENTS.md` and `.cursor/BUGBOT.md` §1; `stage-c.md` section 15, choice 10; threat model section 14 (T2) |
| SCR-28 | The development `.env` holds the migrator URL and the provisioning reader secret, and the development API loads the whole file | `scripts/setup-dev.mjs:244` | `stage-c.md` section 12 (a production start-up refusal, deferred); `.env.example`; threat model section 14 (T14) |
| SCR-29 | A removed member's sign-in attempt is recorded only as an anonymous unscoped event | `apps/api/src/routes/auth.ts:228` | Control matrix B11; threat model section 14 (T12) |
| SCR-30 | A read already in flight finishes under the old role (people list, invite e-mail addresses, full audit log) | `apps/api/src/routes/members.ts:455` | `stage-c-roles-decision.md`, "Remaining window"; control matrix B16; threat model T17 |
| SCR-31 | `auth_time` (provider clock) is compared with the cut-off (database clock); a provider clock running ahead lets a slightly older sign-in through | `db/migrations/0013_roles_and_members.sql:336` | `stage-c.md` risk 6 (both directions now); control matrix B1; threat model section 14 |
| SCR-32 | The permission-denied row is written in its own transaction after the rollback | `apps/api/src/auth/permissions.ts:424` | `stage-c.md` section 14, default 14, and the self-check (nothing changed, as `security.csrf_rejected`); control matrix B16 |
| SCR-33 | A push stopped part-way by a demotion or a sign-out answers 403 or 401 without the per-screen results | `apps/api/src/routes/push.ts:183` | `stage-c.md` section 14, default 7, and section 12 (`// shortcut:`); control matrix B16; threat model T17 |
| SCR-34 | `write-guard.test.ts` catches only a write that uses plain `withOrg` or `withOrgDecision` | `apps/api/src/auth/write-guard.test.ts:51` | `stage-c.md` risk 3; control matrix B16; threat model T17 |
| SCR-35 | The "Signed in" column shows the first sign-in date | `apps/portal/src/features/users/UsersPage.tsx:206` | `stage-c.md` section 12 ("Last sign-in" column, deferred) and section 7.4 |

## Earlier per-package reviews

Each work package was reviewed when it was built, before this round:
- Wave 1 (contracts, domain, migration 0013): 6 findings. One Medium (the SCX-01 regression test's faked claim had no claimer, so 0013's new check refused it first) and four Low were fixed. One Observation, the definer's read of invites, is a known residual (SCR-27).
- Wave 2 (API, people routes, portal, scripts): about 30 Low and 2 Medium (the Change role dialog's focus and the Remove banner's wording), all fixed.

## Test runs

After the fixes, the integration step ran on 2026-11-20:

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm test` | pass, 89 files, 1918 tests |
| `npm run test:component` | pass, 14 files, 61 tests |
| `npm run test:integration` | pass, 39 files, 491 tests, the `_test` database rebuilt from 0001 to 0013 |
| `npm run format:check` | pass |
| `npm run build` | pass |
| `npm run scan:secrets` | pass |

During the review, a verifier ran the portal component tests nine times and saw "Frame was detached" in another file than the one SCR-16 named; after the frame wait, the fixer saw no failure in 30 shuffled runs (three running at once), 18 runs in default order and 5 runs one after another. The database, API and provisioning fixes were each checked by disabling the fix and seeing its new test fail.

Not run: the end-to-end suite (`tests/e2e/14-roles.spec.ts` is written, not run) and `npm run verify:oidc` against a recreated Keycloak (the provisioning reader client import, `prompt=login` re-authentication and `auth_time`). Cognito's `auth_time` and `prompt=login` (A3) are unverified.

## Next steps

1. Run `tests/e2e/14-roles.spec.ts` and `npm run verify:oidc` against a recreated Keycloak; record the results in control matrix B1 and B16.
2. Before the first external customer: a fresh sign-in before Owner-level actions (SCR-24), and confirm the production provider's `auth_time` and `prompt=login` (SCR-25).
3. Before provisioning against a hosted environment: the production start-up refusal of migrator and provisioning variables (SCR-28), and a dedicated provisioning role (SCR-26, SCR-27).
