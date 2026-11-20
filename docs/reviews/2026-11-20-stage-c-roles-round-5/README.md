# Stage C roles and people review, round 5

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
