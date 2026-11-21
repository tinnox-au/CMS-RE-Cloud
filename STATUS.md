---
contract: status/v2
repo: tinnox-au/tinnox-cms
initiative: TINNOX CMS
key: CMS
next_id: 23
phase: Not written yet: one sentence on what this project is and where it stands
gate: -
seeded: 17 Nov 2026 by status init
reviewed: never
---

<!-- Change this file only through the status CLI (one card per call). Every row is a card with a permanent id;
     the section it sits in is its column. No hashes, no counts. Dates are AEDT. -->

## You decide

None.

## Waiting on others

None.

## Backlog

| Id | Card | Agreed | PR | Since |
|---|---|---|---|---|
| CMS-3 | Apps that use outside data (weather and similar); needs the P2-06 threat review first | proposed | - | 17 Nov |
| CMS-4 | Real-hardware check: scan the QR app with a phone and run the player on a low-power device | proposed | - | 17 Nov |
| CMS-6 | Screen-reader listening pass (VoiceOver or NVDA) on the portal before customers rely on it; start with the schedule editor | proposed | - | 17 Nov |
| CMS-14 | Emergency messages and takeover (stage C): override what chosen screens show, then return them to their content | proposed | - | 19 Nov |
| CMS-16 | Playback report (stage C): what each screen played and when, from player reports | proposed | - | 19 Nov |
| CMS-17 | Audio and PDF media (stage C): the Planned Audio and Documents entries in Media | proposed | - | 19 Nov |
| CMS-18 | Web pages on screens (stage C): sandboxed, off by default per organisation; needs the P2-06 threat review first, like CMS-3 | proposed | - | 19 Nov |
| CMS-20 | Self-service sign-up with payment (like Yodeck): new customers sign up and pay, invites complete without TINNOX | proposed | - | 19 Nov |
| CMS-21 | Text app line fit fails on Linux fonts in e2e 07-apps-player (EAU-03): run it on ubuntu-24.04 and fix the fitter or the check | proposed | - | 21 Nov |
| CMS-22 | Keyboard focus after cancelling an invite lands on the first row; reuse useRowFocusReturn as the Alerts page does (EAX-14) | proposed | - | 21 Nov |

## To do

None.

## In progress

None.

## In review

| Id | Card | Agreed | PR | Since |
|---|---|---|---|---|
| CMS-15 | E-mail alerts when a screen stops reporting (stage C) | Michael 21 Nov | #34 | 21 Nov |

## Done, last 14 days

| Id | Date | Outcome | PR |
|---|---|---|---|
| CMS-19 | 20 Nov | Re-run manual tests T11.1, T11.3, T12.1 and T12.3 after PR 29 (schedule and layout create and play) | - |
| CMS-13 | 20 Nov | Roles and user management (stage C): owner, admin, editor, viewer; invite and remove people; a permission matrix to decide first | #31 |
| CMS-12 | 19 Nov | Fix the confirmed PR 29 review findings (logout URL fallback, upload poll retry, sign-out e2e check, plan and control wording) | #30 |
| CMS-11 | 19 Nov | Fix the gaps from the 2026-11-19 manual user test (sign-out notice, upload summary, Apps note, test plan corrections) | #29 |
| CMS-9 | 19 Nov | Review picomatch audit exception GHSA-fc5q-39xc-vjpf: upgrade if fixed, else renew or remove (CI fails once its date passes) | #29 |
| CMS-10 | 18 Nov | Upgrade typescript-eslint to 8.73.0, clearing the moderate minimatch advisory GHSA-g3hv-75wg-m249 | #23 |
| CMS-8 | 18 Nov | CI audit gate: dated exception for picomatch GHSA-fc5q-39xc-vjpf (high, development tooling only, no fixed release); every other high or critical still blocks | #22 |
| CMS-7 | 18 Nov | Backup check: pass valid databases with no publications, fail only empty ones, add an automated test | #21 |
| CMS-5 | 18 Nov | Backend review round 1: decide and fix the two medium findings (CX-01 audit with credential changes, CU-01 backup check with apps) | #19 |
| CMS-2 | 18 Nov | Layouts (stage B): split a screen into zones, each with its own content | #25 |
| CMS-1 | 17 Nov | Schedules (stage B slice 3): choose which playlist a screen shows by day and time | #13 |

## Parked

None.

## Settled

None.

## Cards

### CMS-1

**Evidence**
Merged 17 Nov; CI green (lint, types, unit, component, integration 314, secret scan); full browser suite 100/100 before the merge with main

### CMS-2

**Notes**
- 18 Nov: 18 Nov: built on feat/stage-b-layouts (uncommitted): spec in stage-b.md slice 4; migration 0011, manifest v5, player 0.5.0; typecheck, lint, unit, component, integration and the full e2e suite (incl. new 12 and 13) pass. Multi-agent review blocked by the weekly usage limit until 22 Nov
- 18 Nov: five-lens adversarial review done: no Critical or High; one Medium (player garbage collection across zones) and five Low fixed; all checks and the full e2e suite pass again. Still uncommitted on feat/stage-b-layouts

**Evidence**
merged to main; CI green; full e2e suite (132 tests) passed on the merged tree

### CMS-5

**Evidence**
PR #19 merged after CI passed (quality, integration, secret scan); CX-01 logout exception stays accepted; npm run backup:verify not yet run on the CU-01 change

**Notes**
- 18 Nov: 18 Nov: backup:verify run on realistic dev data (portal API, real sign-ins, paired players). App-only: merged script passes, pre-fix fails only on the CU-01 check. With media: both pass. Open: section c still fails a database with no publications; no automated test.
- 18 Nov: The open items above (no-publication false failure, no automated test) were closed by CMS-7, PR #21.

### CMS-6
from: CMS-1

### CMS-7
from: CMS-5

**Evidence**
PR #21 merged with CI green; the backup-check integration test runs in CI; backup:verify passes on realistic dev data

### CMS-8

**Evidence**
PR 22 merged to main 18 Nov with CI green, audit step included (picomatch allowed until 18 Dec; any other high or critical still fails)

### CMS-9
due: 18 Dec 2026
from: CMS-8

**Notes**
- 19 Nov: GitHub withdrew GHSA-fc5q-39xc-vjpf on 18 Nov; the exception is removed in PR 29 because the audit gate refused the stale entry

**Evidence**
Advisory withdrawn by GitHub 18 Nov; exception removed in PR 29, merged 19 Nov with the CI audit step green

### CMS-11

**Evidence**
PR 29 merged to main 19 Nov with CI green; locally unit, component, integration and all 132 e2e tests passed; T11.1, T11.3, T12.1, T12.3 still need a manual re-run

### CMS-12

**Evidence**
PR 30 merged to main after lint, unit, build, audit, integration and secret-scan checks passed; full e2e suite passed locally (132 tests)

### CMS-13

**Notes**
- 19 Nov: Decision draft written at docs/portal-v2/stage-c-roles-decision.md: four nested roles, full permission matrix, invites by a portal request that TINNOX completes, 13 decisions D1-D13 (recommendation a for each). The build waits on Michael's answers.
- 19 Nov: Michael chose three roles (Admin, Editor, Viewer), no separate Owner. Draft rewritten; the remaining decisions are D1-D9.
- 19 Nov: Michael brought back Owner (four roles, Admins cannot remove each other) and gave Editors the widest access: push, delete, screen set-up, pairing, filtered audit page. Old D1-D6 settled; remaining decisions renumbered D1-D7.
- 19 Nov: Michael answered D1-D7 all a (19 Nov), recorded as DEC-35 in docs/decisions-2026-11.md. Next: build spec, then PRs C1 (roles enforced) and C2 (people).
- 20 Nov: Built C1 and C2 on one branch, feat/stage-c-roles (spec docs/portal-v2/stage-c.md, As built and review record docs/reviews/2026-11-20-stage-c-review). Every suite, verify:oidc and the e2e suite pass. Not pushed; waiting for Michael's go-ahead to push and open the PR.
- 20 Nov: Round 6 review (docs/reviews/2026-11-20-stage-c-roles-round-6): verified each finding; fixed RCX-01 (pairing claim after reactivation), RCX-02 (incident script cut-off timing) and RCX-03 (role matrix accepted 5xx) on the PR; RCU-03 needs no change. All suites and e2e pass. Not merged.

**Evidence**
Merged to main; CI green; all suites, verify:oidc and the full e2e suite (143) pass; round 6 findings fixed

### CMS-18
from: CMS-3

### CMS-19
from: CMS-11

**Evidence**
Re-run on 20 Nov against main with stage C: T11.1, T11.3, T12.1 and T12.3 all pass (seeded playlists stood in for Main loop and Lunch specials)

### CMS-20
from: CMS-13

**Notes**
- 19 Nov: Needs the production sign-in service (A3), an e-mail service and a payment provider. Reverses DEC-27 (no self-serve sign-up in release 1) for a later release. See DEC-35.
- 19 Nov: Placeholder only (Michael, 19 Nov: no clear info yet). Unknown: pricing and plans, payment provider, trial or not, what a new sign-up gets.

### CMS-21
from: CMS-15

### CMS-22
from: CMS-15
