# Manual user test

Date: 19 November 2026.
Status: record of a manual run. No product code was changed, and this folder is the filled-in plan, not a patch.

A person followed [the manual test plan](../../manual-test-plan.md) on a local checkout of `main` at the Layouts release (stage B, slice 4; migrations 0001 to 0012; player `player-web/0.5.0`).

**202 of 218** items matched. One Major: **T17.3**, the refused deletes from T6.6, T11.4 and T12.6 are not in the audit log. Nine Minor. The rest are Cosmetic, plus a note that the wipe-and-reseed step was left unrun so the test data could be kept.

The ticked plan and the tester issue log are in [manual-test-results.md](manual-test-results.md).
