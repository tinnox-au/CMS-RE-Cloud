---
contract: status/v2
repo: tinnox-au/tinnox-cms
initiative: TINNOX CMS
key: CMS
next_id: 7
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

## To do

None.

## In progress

| Id | Card | Agreed | PR | Since |
|---|---|---|---|---|
| CMS-2 | Layouts (stage B): split a screen into zones, each with its own content | Michael 18 Nov | - | 18 Nov |

## In review

None.

## Done, last 14 days

| Id | Date | Outcome | PR |
|---|---|---|---|
| CMS-5 | 18 Nov | Backend review round 1: decide and fix the two medium findings (CX-01 audit with credential changes, CU-01 backup check with apps) | #19 |
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

### CMS-5

**Evidence**
PR #19 merged after CI passed (quality, integration, secret scan); CX-01 logout exception stays accepted; npm run backup:verify not yet run on the CU-01 change

**Notes**
- 18 Nov: 18 Nov: backup:verify run on realistic dev data (portal API, real sign-ins, paired players). App-only: merged script passes, pre-fix fails only on the CU-01 check. With media: both pass. Open: section c still fails a database with no publications; no automated test.

### CMS-6
from: CMS-1
