# PR 29 review

Date: 19 November 2026, Australia/Melbourne (UTC+11).
Status: review of a merged change, each finding verified, fixes in the follow-up pull request on branch `claude/pr29-review-fixes`.

| Item | Value |
|---|---|
| Repository | `tinnox-au/tinnox-cms` |
| Change under review | Fixes from the manual user test, [PR #29](https://github.com/tinnox-au/tinnox-cms/pull/29), merge `86cff02` (`git diff 86cff02^1 86cff02`) |
| Finding IDs | `UTX-01` to `UTX-11` |
| Verification | Each finding was checked against the merged code by two independent readers, one trying to prove it and one trying to refute it, with small reproductions (URL lengths built with the repository's `openid-client`, the real `useLoad` hook under timers, the real upload-summary and audit-check functions). Disagreements were settled by reading the cited lines. |

## Outcome

None of the findings is a regression introduced by PR 29 that breaks a client-facing function. Two Mediums (UTX-01, UTX-03) are real but older than PR 29 and are rated Low here. One Medium (UTX-02) is a test that proved less than the control matrix claimed.

| ID | Reviewer | Verified | New in PR 29 | Rated | Outcome |
|---|---|---|---|---|---|
| UTX-01 | Medium | Partly | Narrowed an existing gap | Low | Fixed |
| UTX-02 | Medium | Yes | Yes (test and wording) | Low | Fixed |
| UTX-03 | Medium | Yes | No | Low | Fixed |
| UTX-04 | Low | Yes, unchanged | No | Observation | Accepted |
| UTX-05 | Low | Yes, harmless | Yes | Observation | Accepted |
| UTX-06 | Low | Mostly pre-existing | Partly | Observation | Deferred to the screen-reader pass |
| UTX-07 to UTX-09 | Low | Yes (four plan points) | Three of four | Low | Fixed |
| UTX-10 | Low | Yes | No | Low | Fixed (wording) |
| UTX-11 | Info | Yes | No | Observation | Fixed (wording) |

## UTX-01: the end-session URL can exceed the portal's limit

The portal refuses a logout answer whose `redirectTo` is longer than 2000 characters (`packages/contracts/src/session.ts`), while the API stores ID tokens up to 8192 characters (`apps/api/src/routes/auth.ts`). With the development configuration the URL is 171 characters plus the token before PR 29 and 188 after (`&state=signed_out`), so the largest token that fits went from 1829 to 1812 characters. The reviewer's example of about 1856 characters already failed before PR 29. A token from the development realm is about 1000 characters (URL about 1185). When the limit is passed, the API has already revoked the CMS session and dropped the stored token, the portal throws `invalid_response`, and the provider's session is not ended. No earlier record mentioned this.

Fix: the limit is a shared constant, `LOGOUT_REDIRECT_MAX_LENGTH`. When the URL with `id_token_hint` would be longer, `endSessionUrl` sends `client_id` instead (the provider then asks the user to confirm and still ends its session); if even that is too long it answers null and the portal shows its own signed-out notice. Covered in `apps/api/src/auth/oidc.test.ts`.

## UTX-02: the sign-out e2e check did not prove the provider round trip

When the provider is skipped (`redirectTo: null`), the portal shows the same notice and the address has no `state`, so the PR 29 assertions passed either way, and the control-matrix sentence PR 29 added claimed more than they showed. Sign-out starts on `/audit`; only the provider's redirect lands on the post-logout URI `/`.

Fix: `e2e/01-journey.spec.ts` expects the final address to be `${PORTAL_URL}/`. The single-logout row in the control matrix says what the test checks.

## UTX-03: a failed first read after a reload stops the processing poll

Reproduced twice. `useLoad` starts each effect run with no known interval; a function poll learns it from the first successful read. If the first read after `reload()` fails, nothing is scheduled again (a failed routine tick does keep polling). In the media library this left accepted uploads "being checked" until the operator reloaded. The defect is older than PR 29 (the row spinner stuck the same way); the new summary only made it visible. Frontend round 2 looked at refresh failures and did not see it.

Fix: after a failed refresh of a page that already shows data, a function poll with no known interval retries after 5 seconds, doubling to at most 60 seconds while re-reads keep failing (so a permanent error does not re-announce its notice every few seconds); the next successful read works the interval out again. A failed routine tick keeps its known rhythm. Fixed and null polls, and a failed initial load, behave as before. Covered in `apps/portal/src/hooks/useLoad.test.tsx`.

## UTX-04: a lost upload answer is counted as "not uploaded" (accepted)

True and unchanged by PR 29: the footer said "not uploaded" before it too. The row says "The connection was lost during the upload. Refresh the list before trying again." Frontend round 2 accepted this way of acknowledging an uncertain outcome. A duplicate costs one extra media row that the operator can delete. The real remedy, an idempotency key per upload, is an API and migration change and is not planned here.

## UTX-05: the router can keep the sign-out marker (accepted)

True: `history.replaceState` does not update the module-level router, and the old `/displays` redirect keeps the query, so a signed-in operator who follows such a link can see `state=signed_out` in the address again. The worst effect is a meaningless parameter, or the signed-out notice shown to someone who is not signed in. Not worth the change to router creation.

## UTX-06: notices mounted with their text (deferred)

The in-app sign-out path has mounted the banner with its text since stage A; the path PR 29 added is a full page load, where WCAG 4.1.3 does not ask for a live announcement. The upload footer's later states change text inside an already mounted live region. Left for the screen-reader listening pass, which the manual test plan lists as not covered.

## UTX-07 to UTX-09: manual test plan

All four were right and are corrected in `docs/manual-test-plan.md`: T4.2 (the background toast counts only files still waiting or sending when the dialog closed), T4.3 (the renamed files are discarded, not "never stored": they pass briefly through the worker's staging folder), T13.1 step 2 (open the Screens list for the header push button; PR 29 fixed T9.4 and T12.5 but missed this step) and T17.3 (choose Category → Pairing before Result → Refused, or the category filter hides the event).

## UTX-10: control B1 said tokens never reach the browser

True and older than PR 29: the stored ID token reaches the browser once, at sign-out, as `id_token_hint` in the provider's end-session URL. That is standard OIDC RP-Initiated Logout; the API never accepts an ID token as a credential. B1 now says so. The comment in migration 0001 is left as it is (merged migrations are not edited).

## UTX-11: the checklist suggested renewing a stale exception

True: an exception that matches no reported advisory is refused whatever its date, so only removing it works. Section 6 of the operations checklist now says which remedy fits which failure.
