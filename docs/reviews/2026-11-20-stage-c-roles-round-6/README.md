# Stage C roles and people review, round 6

Date: 20 November 2026, Australia/Melbourne (UTC+11).
Status: documented review only. Both reviewers worked read-only. No product code was changed, and this folder is a record of the outcome, not a patch. PR #31 was not merged at review time, so links to files that the PR adds resolve only once it lands.

| Item | Value |
|---|---|
| Repository | `tinnox-au/tinnox-cms` |
| Change under review | Stage C: roles and people (CMS-13, DEC-35), [PR #31](https://github.com/tinnox-au/tinnox-cms/pull/31), branch `feat/stage-c-roles` at `11ea255` (`git diff 1a036b5 11ea255`, 6 commits, 222 files) |
| Review lens | Ponytail principles ([dietrichgebert/ponytail](https://github.com/dietrichgebert/ponytail)); the brief given to both reviewers is in [ponytail-lens.md](ponytail-lens.md). Findings under this lens are tagged [ponytail] |
| Static reviewer | Codex CLI, gpt-6-astra, reasoning effort max: migration 0013, API authorization and the route-to-role matrix, plus the ponytail lens. Report: [codex-static.md](codex-static.md) |
| Runtime reviewer | Cursor cloud agent, grok-4.7, reasoning effort xhigh, 500k context ([agent](https://cursor.com/agents/bc-541b8194-0e4f-5715-b965-7bf5a292a454)): full environment, the 0012 to 0013 upgrade, every suite, live role probing, the portal, and reproduction of the static findings. Report: [grok-runtime.md](grok-runtime.md) |
| Finding IDs | `RCX-01` to `RCX-03` (static), `RCU-01` to `RCU-03` (runtime) |

## Verdict

Hold the merge until the two medium findings are fixed. There are no critical or high findings. Both medium findings from the static review were reproduced at runtime.

| ID | Severity | Area | Title | Reproduced | Test exists |
|---|---|---|---|---|---|
| RCX-01 / RCU-01 | Medium | Pairing | Removing a member does not durably invalidate an uncollected pairing claim. After reactivation, even as a Viewer, the old polling token registers a player (`0013_roles_and_members.sql:521`) | Yes | No, not for this sequence |
| RCX-02 / RCU-02 | Medium | Sessions | `scripts/revoke-subject-sessions.sql` stamps the cutoff at statement start while the UPDATE waits for the row lock. A sign-in authenticated 2.2 s into the wait was accepted, while the API path refuses it | Yes | No |
| RCX-03 | Low | Tests | [ponytail] The role-matrix test accepts 500, 503 and 429 as "allowed" (`tests/integration/roles-matrix.test.ts:118`) | n/a (static) | No |
| RCU-03 | Info | Tests | [ponytail] The HTTP `last_owner` test injects the database error, so it would pass without the trigger. The real trigger is covered in `migration-0013`. A live race left exactly one Owner (200 and 401) | Yes | Partly |

## Suite results (runtime reviewer)

- Typecheck, format check and lint pass. Lint needed `--max-old-space-size=6144`.
- Unit: 89 files, 1,918 tests pass.
- Component: 14 files, 61 tests pass.
- Integration: 39 files, 491 tests pass once `npm run fixtures` has been run.
- e2e: 140 passed, 1 failed and 2 did not run. The failure is the text-fit check in `07-apps-player.spec.ts:347`, a font-metric difference on the VM in code the PR does not touch. The serial mode then skipped the next 2 tests. `14-roles.spec.ts` passed 7 of 7, and axe passed on Users and the invite dialog.

The per-finding detail, the reproduction steps and rows, the derived 59-route authorization matrix and the list of what was verified as correct are in the two reports.

## Outcome (verified and fixed on the branch)

The sections above are the review record as written and are unchanged. We then checked the findings: one agent reproduced RCX-01 to RCX-03 at runtime on `11ea255`, and a second tried to refute every finding, RCU-03 included, by reading the code. The verification used its own test databases (`tinnox_r6a_test` to `tinnox_r6c_test`), never `tinnox_test` or the development database. The three findings were then fixed on `feat/stage-c-roles`. Each fix was proved by a mutation run, described per finding below.

| ID | Reviewers | Real | Reproduced by us | Our severity | Outcome |
|---|---|---|---|---|---|
| RCX-01 / RCU-01 | Medium | Yes | Yes | Low | Fixed in migration 0013 |
| RCX-02 / RCU-02 | Medium | Yes | Yes | Low | Fixed in the incident script |
| RCX-03 | Low | Yes | Yes, with an injected 500 | Low | Fixed in the test |
| RCU-03 | Info | True, by design | Read only; the runtime reviewer's live race agrees | Info | No change |

Migration 0013 was edited in place for RCX-01. A database that applied the earlier text, such as a development database, is refused by the runner's checksum check and has to be rebuilt from the migrations.

### RCX-01 / RCU-01: a claim outlived a removal that was later undone

| | |
|---|---|
| Verdict | Real. Reproduced with the real API, the real HTTP routes and the real `fulfil()` (a stub identity provider), with no poll between the claim and the collection. The old polling token got `status: "claimed"`, a device token and a live `player_registration`. Cause: `sec.pairing_complete` checked only `removed_at IS NULL` at collection, and `fulfil` brings the person back on the same membership and clears `removed_at`. |
| Our severity | Low, not Medium. It needs a polling client that sends no poll from the claim until after the return: a real player polls every 2 s, and one poll while the member is removed expires the claim for good. It also needs an Owner to remove the claimer, an Owner or Admin to invite the same person again, and staff to check and run `fulfil`, all within the claim's life (the code's 10 minutes by default, or 2 minutes after the claim if that is later). Whoever holds the polling token could have collected while the claimer was still allowed. It did break a written promise: `stage-c.md` default 8 and threat model T3 said a removal closes the claim window. |
| Change | `db/migrations/0013_roles_and_members.sql`, `sec.pairing_complete`: the existing `FOR SHARE` member check also requires `sessions_valid_after IS NULL OR claimed_at > sessions_valid_after`. A refused claim is expired and the player is answered `consumed`, as for a removed claimer. `fulfil` keeps the cut-off, so a claim from before a removal stays dead. The lock order (pairing row, then member row), the signature and the grants are unchanged. Both times come from the database clock, and every cut-off is stamped after the member row is locked (for the incident script, because of the RCX-02 fix), so a claim that committed first is earlier; a tie is refused. This also closes the earlier residual SCR-04: a claim made before a demotion, a sign-out everywhere, `mfa-reset` or the owner recovery that replaces an Owner (`restore-owner --successor`) no longer completes. `restore-owner --promote` is a promotion and ends no session. Any demotion, Owner to Admin included, now refuses an uncollected claim, and the operator pairs again. |
| Tests | `packages/db/test/migration-0013.integration.test.ts`: "keeps a claim made before a removal dead after the member is brought back", "refuses a claim made before a demotion or a sign out everywhere", and, against over-refusal, "completes a claim made after the cut-off, however soon after". `tests/integration/provision-member.test.ts`: "a pairing code claimed before the removal cannot be collected after the return", over HTTP with the real `fulfil()`; it expects `{ status: 'consumed' }` and no registration for the screen. |
| Mutation | With only the new condition removed, and again with the whole migration as reviewed, three tests failed. The two database cases completed instead of answering `not_claimable`, and the HTTP case got `status: 'claimed'` with a device token. The other cases of the group still passed. With the fix restored, 8 files (157 tests) and 4 more files that collect pairings (27 tests) passed. |

### RCX-02 / RCU-02: the incident script stamped its cut-off before it waited

| | |
|---|---|
| Verdict | Real. Reproduced with a superuser transaction holding the member row while the script waited. The stored cut-off equalled the statement's start, and `sec.session_create` with an `auth_time` 2.6 s into the wait (whole seconds) answered `created`. That happened both with the file sent as one message and statement by statement. The API path refused the same sign-in, because `lockTarget` locks the row before the cut-off statement runs. |
| Our severity | Low, not Medium. The script is the database administrator's fallback, for when nobody in the customer can act. The gap needs another transaction holding the member row while the script runs, plus a fresh sign-in at the identity provider (password and one-time code) whose `auth_time` falls in the wait and in a later second than the script's start. Someone with those credentials can also sign in just after the cut-off, which is accepted by design, and the runbook also ends the sessions at the provider. It was still worth fixing. Run as the superuser, the wait has no limit (the reviewer's 30 s `lock_timeout` applies to `tinnox_migrator` only), and 0013 states that a sign-in during the lock waits must be refused. |
| Change | `scripts/revoke-subject-sessions.sql`: after `SET LOCAL ROLE tinnox_definer`, a statement of its own locks the member row (`SELECT 1 AS locked … FOR NO KEY UPDATE`, as `lockTarget`). The cut-off UPDATE then uses `greatest(sessions_valid_after, clock_timestamp())`. No grant changes. The lock order is the API's (member row, then session rows), with no advisory lock: one added later must come before the row lock, or it deadlocks with the people routes (reproduced). |
| Tests | `tests/integration/session-revoke-all.test.ts`: "the incident script's cut-off is taken after it waits for the member row". A holder locks the row `FOR SHARE` only, the shape of a member's own write. The script is sent as one message and waits, T1 is read 2.2 s later, and the holder rolls back. The test expects a cut-off at or after T1, one `membership.sessions_end` row, and a sign-in authenticated at T1 refused with `reauth`. |
| Mutation | With the script as reviewed, the test failed with the cut-off 2211 ms before T1, and the other 3 tests passed. With the lock statement but `statement_timestamp()`, and with `clock_timestamp()` but no lock statement, it failed too, each about 2.2 s early. With the fix restored, the file passed 4 of 4 in 3 runs. |

### RCX-03: the role matrix accepted server errors

| | |
|---|---|
| Verdict | Real. The allowed branch failed only on 401 or 403, so a 500, 503 or 429 counted as allowed. With a fault injected from the test (the tag list query made to throw), `GET /api/tags` answered 500 for every role and the old check passed. Nothing is broken today: all 194 allowed probes answer 200, 400 (`validation_failed`), 404 (`not_found`) or 415 (`unsupported_media_type`). |
| Our severity | Low, as reviewed. The matrix is the only test that checks every route for every allowed role, so it should catch a crash after the guard. A 429 cannot happen in this test (its rate limits are scaled by 1000), and it would prove nothing anyway: the rate limiter answers in `onRequest`, before the `preHandler` role guard. |
| Change | `tests/integration/roles-matrix.test.ts`: an allowed probe must answer one of `ALLOWED_STATUSES` (200, 400, 404, 415), the answers of a handler that ran past the role guard. This is narrower than the reviewer's suggestion of an expected status and valid bodies per probe, which would tie the matrix to each handler's validation order and repeat the functional tests. If probes ever get valid bodies, 201 or 204 is added on purpose. `tests/README.md` now says `e2e/14-roles.spec.ts` runs and passes. |
| Tests and mutation | The same file. With the tag list fault injected, the four role tests fail with "GET /api/tags: 500, expected to be allowed"; with the old check and the same fault, all 8 tests pass. Without the fault, the file passes 8 of 8. No product code was changed for the proof. |

### RCU-03: the HTTP last-Owner test injects the database error

| | |
|---|---|
| Verdict | True: the test would still pass without the trigger. It was written that way on purpose. |
| Our severity | Info, as reviewed. |
| Change | No change: 409 `last_owner` cannot be reached through the API in any interleaving (the membership lock serialises and the loser re-reads its own cut-off), so injecting the error is the only way to test the mapping. The trigger itself, concurrent demotions included, is tested in `packages/db/test/migration-0013.integration.test.ts`, and the runtime reviewer's live race left exactly one Owner (200 and 401). |

### Suggested fixes we did not take

- **RCX-01, expiring the member's claims in the removal.** This is the first half of the runtime reviewer's fix, and what the static reviewer's "during removal" points to. It deadlocks with `sec.pairing_complete`: a removal holds the member row and would wait for a pairing row, while a collection holds the pairing row and waits for the member row. We reproduced it: PostgreSQL aborted one side with 40P01 after about 1 s, and when the removal was the victim the API would answer 500 while the player paired. It would also need a new `sec.*` function (`tinnox_app` has no rights on `pairing_session`), and it leaves demotion and sign-out open. We took the other half, the comparison with the cut-off, which needs no new lock.
- **RCX-02, `clock_timestamp()` or the `statement_timestamp()` of a later statement, either one alone.** `statement_timestamp()` in a second statement fails when the file is sent as one message (`psql -c`, the test harness): every statement then shares one `statement_timestamp()`, and the cut-off came out 2.6 s early. `clock_timestamp()` alone in the single UPDATE fails when the holder only locks the row: the new value is computed before the wait, and the cut-off also came out 2.6 s early. Only both together, the lock in its own statement and then `clock_timestamp()`, refused the sign-in in every send mode.

### Follow-up review of the fixes

A second static pass (Codex) checked the fixes above. It confirmed RCX-01, RCX-03 and the closing of SCR-04, kept RCU-03 as an accepted residual, and raised two new items, both checked against the code:

| ID | Severity | Finding | Outcome |
|---|---|---|---|
| RFX-01 | Low | If the subject has no membership when the incident script's locking `SELECT` runs, and TINNOX provisions that person before its `UPDATE`, the new row was never locked, so the cut-off can land before a wait on that row. | Accepted, not changed. The mechanics are real, but the result is never worse than the other timing: had the provisioning committed a moment later, the script would have found no member and done nothing. It also needs staff running the incident script and provisioning the same person within milliseconds, while a third transaction holds the new row. Locking and stamping from one resolved set inside the script would need temporary tables or settings (psql does not substitute variables inside a `DO` block, and the file may arrive as one message), for no security gain. The runbook now says the script prints `locked` with one row, and that no row means nothing was revoked. |
| RFX-02 | Info | The docs said owner recovery voids outstanding claims, but `restore-owner --promote` sets no cut-off; only `--successor` does, because it removes the replaced Owner. | Fixed in wording: the 0013 comment, its copy in `stage-c.md`, the stage C As built row and this record now say "the owner recovery that replaces an Owner (`restore-owner --successor`)", and that a promotion ends no session. |

### Incidental notes

None of these is caused by this change.

- **Lint heap.** This already happens on `main`. Both `main` and the branch need a V8 heap of about 2.3 to 2.5 GB, so both run out at Node's 2 GB default on a machine with less than about 15 GB of memory; the branch needs about 7% more (48 more TypeScript files). CI passes because its runner gets a 4 GB default. The root `lint` script now runs ESLint with a 4 GB heap (`--max-old-space-size=4096`), so it no longer depends on the machine's memory.
- **Integration fixtures.** `tests/integration/backup-restore-check.test.ts` throws "sample media are missing" until `npm run fixtures` has run. `main` has the same guard, CI runs the fixtures first, and `media-worker.test.ts` generates them itself, which is why only the first run failed. The branch changes that file only to give its member a role.
- **e2e text fit.** The failure at `tests/e2e/07-apps-player.spec.ts:347` is in code the branch does not touch (`apps/player-web`, `packages/app-render` and that spec). It is a font-metric difference on the reviewer's Linux machine.
