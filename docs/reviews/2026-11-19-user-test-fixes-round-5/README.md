# User-test gap fixes review, round 5

Date: 19 November 2026, Australia/Melbourne (UTC+11).
Status: documented review only. The reviewer worked read-only. This folder records the outcome and is not a patch. Later fixes for these findings are not re-verified here.

| Item | Value |
|---|---|
| Repository | `tinnox-au/tinnox-cms` |
| Change under review | User-test gap fixes, [PR #29](https://github.com/tinnox-au/tinnox-cms/pull/29), merge `86cff02`, reviewed at `main` `928cbf2` |
| Reviewer | Codex CLI, gpt-6.2-astra, reasoning effort xhigh (static, read-only). Report: [codex-review.md](codex-review.md) |
| Finding IDs | `UTX-01` to `UTX-11` |

## Verdict

Request changes. There are three medium findings: UTX-01, where the logout marker pushes long `id_token_hint` URLs past the 2,000-character `LogoutResponseSchema` limit; UTX-02, where the logout e2e passes even when Keycloak is skipped; and UTX-03, where a failed first refresh leaves the upload dialog stuck on "being checked". UTX-04 to UTX-10 are low, and UTX-11 is informational. The details are in the report.
