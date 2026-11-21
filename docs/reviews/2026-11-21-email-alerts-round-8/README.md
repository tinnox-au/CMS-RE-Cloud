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
