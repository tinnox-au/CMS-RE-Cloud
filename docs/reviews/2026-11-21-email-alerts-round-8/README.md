# E-mail alerts review, round 8

Date: 21 November 2026, Australia/Melbourne (UTC+11).
Status: documented review only. Both reviewers worked read-only, and the runtime reviewer restored every mutation it made. No product code was changed. This folder is a record of the outcome, not a patch. PR #34 was not merged at review time, so links to files that the PR adds only resolve once it lands. Round 7 was the follow-up check of the round 6 fixes, and it is recorded in [the round 6 folder](../2026-11-20-stage-c-roles-round-6/README.md).

| Item | Value |
|---|---|
| Repository | `tinnox-au/tinnox-cms` |
| Change under review | Stage C: e-mail alerts when a screen stops reporting (CMS-15, DEC-37), [PR #34](https://github.com/tinnox-au/tinnox-cms/pull/34). Branch `feat/cms-15-email-alerts` at `622958a`, base `main` `e44e5b9` (3 commits, 100 files, migration `0014_display_alerts.sql`, new dependency `nodemailer`) |
| Review lens | Ponytail principles ([dietrichgebert/ponytail](https://github.com/dietrichgebert/ponytail)). The brief given to both reviewers is in [ponytail-lens.md](ponytail-lens.md). Findings under this lens are tagged [ponytail] |
| Static reviewer | Codex CLI, gpt-6.2-astra, reasoning effort max (about 18 minutes). It covered migration 0014, the alert logic, mail, authorization, the ponytail lens and test quality. Report: [codex-static.md](codex-static.md) |
| Runtime reviewer | Cursor cloud agent, grok-4.7, reasoning effort xhigh (the model's highest), 500k context ([agent](https://cursor.com/agents/bc-f6d96bea-ae9e-50bf-a0d4-6de427724c84)). It covered the full environment with Mailpit, every suite, the 0013 to 0014 upgrade, live alerts, recipients and roles, SMTP outage and mutation checks. Report: [grok-runtime.md](grok-runtime.md) |
| Finding IDs | `EAX-01` to `EAX-14` (static), `EAU-01` to `EAU-03` (runtime) |

## Verdict

The static review requests changes before merge, with 2 high, 9 medium and 3 low findings. The runtime review found that the shipped behaviour matches DEC-37 on every path it exercised, and raised 3 info findings. The two reviews do not contradict each other. The static high and medium findings are mostly races and edge cases that the runtime pass did not set up, such as a removal during a send, a claim racing a settings change, or a replacement player heartbeat before the check. Where they overlap, the reviewers disagree on severity, as the table below shows.

| ID | Severity | Area | Title | Confirmed at runtime |
|---|---|---|---|---|
| EAX-01 | High | Recipient privacy | Removing an address does not cancel mail already queued in the current run | Not exercised (removal before the run was verified as safe) |
| EAX-02 / EAU-02 | High (static) / Info (runtime) | Working hours | [ponytail] The 14-day scan and 5-minute probes can suppress an alert indefinitely, for example a 48-hour delay on a one-hour day or openings between probes | Yes, the 60-day case. Widening `SCAN_MS` does not fail any test |
| EAX-03 / EAU-01 | Medium (static) / Info (runtime) | Working hours | An offline alert can first fire after closing time | Yes, close at 18:02 with an alert at 18:04 |
| EAX-04 | Medium | Recovery | A replacement player can close its predecessor's episode as "reporting again" | Not exercised |
| EAX-05 | Medium | Concurrency | A claim can use settings or a registration already revoked | Not exercised |
| EAX-06 | Medium | Multi-instance | Losing the advisory-lock connection leaves the old sender running | Not exercised (lock skip and two instances were verified) |
| EAX-07 | Medium | Portal | [ponytail] Saving one setting can overwrite another editor's change | Not exercised |
| EAX-08 | Medium | SMTP | The plaintext exception trusts a hostname before resolution | Not exercised |
| EAX-09 | Medium | Test isolation | [ponytail] The e2e API can send through the developer's SMTP relay | Not exercised |
| EAX-10 | Medium | Rollout | [ponytail] The release omits the existing stale-tab deployment constraint | n/a (static) |
| EAX-11 | Medium | Test quality | [ponytail] Several assertions pass with their safeguard removed | Consistent: the runtime mutations left some tests green |
| EAX-12 | Low | Migration | The final guard accepts a missing `search_path` | The runtime check found `search_path` pinned on both functions |
| EAX-13 | Low | Dev setup | [ponytail] Rerunning setup overwrites an existing SMTP configuration | Not exercised |
| EAX-14 | Low | Accessibility | [ponytail] Removing an address moves keyboard focus to the first row | Not exercised |
| EAU-03 | Info | e2e | The Text app overflow check fails on the VM's fonts, in code this PR does not touch | Yes |

## Suite results (runtime reviewer)

- Typecheck, lint (0 warnings) and format check pass.
- Unit tests pass: 92 files, 1,957 tests.
- Component tests pass: 18 files, 79 tests.
- Integration tests pass once `npm run fixtures` has been run: 41 files, 523 tests.
- e2e: 147 passed, 1 failed and 2 did not run. The failure is EAU-03. `15-alerts.spec.ts` passed 3 of 3, and the accessibility checks on the alert screens passed.

The two reports hold the evidence, reproduction steps, mutation results and environment versions for each finding, and what each reviewer verified as correct.

## Round 8 outcome (verified and fixed on the branch)

The sections above are the review record as written and are unchanged. Each finding was then checked against the code on `feat/cms-15-email-alerts` (after main was merged in), and Michael chose what to fix on 21 November 2026. The fixes were checked on a test database of their own (`tinnox_cms15_test`), never `tinnox_test` or the development database. Migration 0014 is not on `main`, so it was edited in place; a database that applied the earlier text is refused by the runner's checksum check and has to be rebuilt from the migrations.

| ID | Reviewers | Our severity | Outcome |
|---|---|---|---|
| EAX-01 | High | Low | Fixed: each address is read again just before its e-mail |
| EAX-02 / EAU-02 | High / Info | Medium | Fixed: exact overlap per step, and a cap at 14 silent days |
| EAX-03 / EAU-01 | Medium / Info | Low | EAU-01 fixed by the EAX-02 change. EAX-03 kept by Michael and documented |
| EAX-04 | Medium | Low | Documented, and pinned by a test |
| EAX-05 | Medium | Low | Documented as a shortcut |
| EAX-06 | Medium | Low | Fixed: a lost lock connection stops the run |
| EAX-07 | Medium | Low | Fixed: the Alerts tab sends only what changed |
| EAX-08 | Medium | Low | Fixed: plaintext SMTP only to `127.0.0.1` and `::1` |
| EAX-09 | Medium | Low | Fixed: the e2e API always uses Mailpit |
| EAX-10 | Medium | Low | Documented: release note |
| EAX-11 | Medium | Low | b, c and d fixed in tests; a and e no action |
| EAX-12 | Low | Low | Fixed in 0014 |
| EAX-13 | Low | Observation | Documented: setup and `.env.example` wording |
| EAX-14 | Low | Low | Fixed for the alert list, and for the invites list (CMS-22) |
| EAU-03 | Info | Info | Fixed in the test (CMS-21): the renderer was correct |

### Per finding

- **EAX-01** (Low, not High: nothing crosses organisations and the window was one run). `apps/api/src/alerts.ts`: before each e-mail, a short `withOrg` query checks the address is still confirmed in its organisation; a removed one is skipped, not counted as failed, and not logged. A mail already handed to the server cannot be recalled. Test: `tests/integration/display-alerts.test.ts` "mails every confirmed address, and not one removed during the run", which also covers two recipients (EAX-11c). With the recheck removed, that test fails.
- **EAX-02 / EAU-02** (Medium). `packages/domain/src/delivery-state.ts` `offlineDue`: each UTC 5-minute step counts its exact overlap with that day's hours (a step never crosses local midnight or a daylight-saving change), and a screen silent for at least 14 days alerts at the first open moment. The 5-minute shortcut is gone; the 14-day one now reads "capped at 14 silent days, then the next open moment". Unit tests: 12:00 to 13:00 with 48 hours over 60 days, 09:01 to 09:04, Melbourne 08:00 to 18:02.
- **EAX-03 / EAU-01** (Low). EAU-01, the miscount, is fixed by the exact overlap above. EAX-03: Michael kept the behaviour ("keep it": the e-mail is accurate, and a screen that dies at 4:29 pm on a Friday is reported that afternoon). An alert that comes due inside hours may go out a minute or two after closing. A closing-boundary unit case pins it (due at 17:00 is true), and the spec says so (section 9 row 25 and shortcuts).
- **EAX-04** (Low). Behaviour kept: re-paired and the new player has not reported closes silently; once the new player reports, the back-online e-mail is sent. Spec section 4, section 9 row 22 and the `alerts.ts` comment now say so. Test: "sends the reporting-again e-mail once a re-paired screen's new player has reported".
- **EAX-05** (Low). A `// shortcut:` above the opening claim in `alerts.ts` and a spec shortcut line: settings and registrations are read once per run, and a change during the run applies from the next run, which closes the episode silently.
- **EAX-06** (Low). `alerts.ts`: before each organisation, a lost lock connection stops the run, counts as failed and logs an error with no address. E-mails already claimed are still sent (delivery is at most once). Test: "stops claiming when the lock connection is lost, and still sends what it claimed" (terminates the lock backend from the first e-mail). With the check removed, that test fails.
- **EAX-07** (Low). `apps/portal/src/features/displays/detail/AlertsTab.tsx` sends only the changed settings. Component tests: "turns alerts off" now expects `{ alertOfflineMinutes: null }`, and "sends only the changed setting".
- **EAX-08** (Low). `apps/api/src/mail.ts`: `requireTLS` unless implicit TLS or the host is `127.0.0.1` or `::1`; names, `localhost` included, need TLS. `mail.test.ts` covers `localhost`, `relay.localhost` and `::1`. Spec row 2, control matrix B17, `config.ts` and `.env.example` wording updated.
- **EAX-09** (Low). `tests/e2e/support/stack.ts` sets `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`, `SMTP_SECURE=false`, `MAIL_FROM` and blank credentials for the e2e API. Not run end to end in this pass.
- **EAX-10** (Low). Release note in the spec (section 9): migrate, start the new API and portal together, reload open portal tabs. The 0014 header says the same. The PR description's "Deploy order" should gain the reload line.
- **EAX-11** (Low). b: the two 0014 composite foreign keys are in `packages/db/test/rls.integration.test.ts`'s composite-FK case. c: covered by the EAX-01 test. d: "sends no reporting-again e-mail when that choice is off"; with the `alert_back_online` condition removed, it fails. a and e: no action.
- **EAX-12** (Low). The 0014 sec guard uses `IS NOT TRUE`, so a NULL `proconfig` counts as unsafe. Earlier migrations keep the old guard (merged); `sec.integration.test.ts` remains the backstop.
- **EAX-13** (Observation). The `scripts/setup-dev.mjs` header and `.env.example` now say setup rewrites the fixed settings, Mailpit SMTP included; to try another relay, set it in the shell.
- **EAX-14** (Low). `useRowFocusReturn` takes an optional row control selector (`button`), and Settings → Alerts uses the hook: after a removal, focus goes to the next row's Remove, else the previous row's, else Add address. Component test in `AlertsPage.test.tsx`. The invite cancel in `UsersPage.tsx` has the same first-row behaviour but needs its rows' order and test ids from `InvitesCard.tsx`, so it is left for a follow-up. CMS-22 then fixed the invites list the same way: `CancelInviteDialog` in `UsersPage.tsx` uses the hook with the invites' order and `users-invite-row-` rows, so focus goes to the next invite's Cancel, else the previous one's, else Invite person; the ad-hoc `inviteFocusAfterCancel` is gone. Component test in `UsersPage.test.tsx` (it fails on the earlier code).
- **EAU-03** (Info). Fixed in this PR as CMS-21, in the test only. The check flagged a line as clipped when its leaf element's `scrollHeight` exceeded `clientHeight`. Chrome counts a glyph box taller than the `line-height: 1.15` line box (Linux sans fonts such as Noto, about 1.36em) as scrollable overflow, although nothing clips it: only the root has `overflow: hidden`, 29 px outside the fitted box. Reproduced on macOS with Linux-like font metrics, the reported rectangle came out almost exactly, and every glyph stayed inside the root. The check now measures each line's glyph box (`Range.getBoundingClientRect`) against the clip edge, which is stricter, and keeps the `scrollWidth` clip test. The renderer (`packages/app-render`) is unchanged.

### Checks after the fixes

typecheck, lint (0 warnings), format:check and build pass. `npm test`: 92 files, 1960 tests. `npm run test:component`: 18 files, 81 tests. `npm run test:integration` (`tinnox_cms15_test`): 41 files, 527 tests. Mutation runs: removing the address recheck, the lost-lock check or the `alert_back_online` condition each fails exactly its new test. End-to-end: `15-alerts`, `11-accessibility` and `14-roles`, 56 of 56 passed.
