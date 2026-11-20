# Bugbot review rules for TINNOX CMS

## Code Review Rules

These rules are shared, word for word, by `AGENTS.md` (Codex) and `.cursor/BUGBOT.md` (Cursor Bugbot). Change both together.

Report findings as Critical, High, Medium, Low or Observation. Cite `path:line` for every finding. Say what you could not verify by reading alone and mark it "unverified pending runtime". Check `docs/decisions-2026-11.md`, `docs/security/control-matrix.md` and earlier rounds under `docs/reviews/` first: a known, documented residual is reported as such, not as a new finding.

### 1. Three database roles

The roles are created in `infra/postgres/init/01-roles.sh`.

- `tinnox_app` is the only runtime role. It has no superuser, no `BYPASSRLS` and owns nothing. Flag any runtime code that connects as another role, any grant that lets `tinnox_app` own, alter or bypass RLS on a table, and any widening of its grants beyond what a feature needs. `audit_event` stays `INSERT` and `SELECT` only.
- `tinnox_migrator` owns the schema and only runs migrations (`packages/db/src/migrate.ts`) and TINNOX's provisioning script (`scripts/provision-member.ts`) from a controlled host; both refuse any other role. Its credentials, and the provisioning reader secret, never reach the API, the media worker or the player.
- `tinnox_definer` cannot log in, has `BYPASSRLS`, and only owns the narrow `sec.*` `SECURITY DEFINER` functions that must read before the organisation is known (session, device token, pairing). Every new or changed `sec.*` function must pin `search_path`, take only what it needs, return the minimum, and be granted `EXECUTE` to `tinnox_app` only. Migration 0013 grants it `UPDATE (first_signed_in_at, sessions_valid_after)` on `membership`, which its `sec.*` functions write. It also grants a read of `member_invite` and `UPDATE (status)` on it. Only `provision-member` uses these, under `SET LOCAL ROLE tinnox_definer`; no `sec.*` function does. A new cross-organisation read is High until justified.

### 2. Tenant isolation

- Every tenant query runs inside `withOrg` (`packages/db/src/tx.ts`), which sets `app.org_id` for that transaction only. `withoutOrg` and `poolAsTx` are only for `sec.*` calls before the organisation is known. Flag any tenant query outside `withOrg`.
- The organisation id comes from the verified session membership or the device credential, never from a path, query, body or header. Flag any route that reads an `orgId` or `org_id` from the request.
- Every new tenant table has `ENABLE` and `FORCE ROW LEVEL SECURITY`, policies keyed on `app.org_id`, and composite `(org_id, id)` foreign keys to other tenant tables. Cross-organisation ids answer 404, never 403. A refusal by role is decided before any lookup and is the same 403 for every id (DEC-35). Each new table or route gets a case in `packages/db/test/rls.integration.test.ts` or `tests/integration/cross-org.test.ts`.
- Media, signed URLs, publications and player endpoints are tenant data too: check that a signed URL or device token for one organisation cannot reach another's objects.

### 3. Audit record in the same transaction as the change

- A state change that must be audited (sign-in and sign-out, pairing, revocation, upload, publishing, membership, and any new security-relevant action) writes its `audit_event` row with `auditScoped` or `auditUnscoped` (`packages/db/src/sec.ts`) on the same `Tx` as the change, so both commit or neither does. Writing the change in one transaction and the audit in a later one is a finding (see CX-01 in `docs/reviews/2026-11-16-backend-round-1/`).
- Audit rows carry actor, organisation, object and result. They never contain content, secrets, tokens, signed URLs or query strings. `occurred_at` is set by the database, so code must not pass a time.
- `audit_event` is append-only. Flag any `UPDATE` or `DELETE` on it and any change to its trigger.

### 4. Migration history

- Migrations live in `db/migrations/NNNN_description.sql`, are applied in order, and each runs in one transaction with its `schema_migrations` row. A migration that has been merged to `main` is never edited, renamed or deleted: the runner rejects a changed checksum. Fixes go in a new migration with the next number.
- Flag duplicate or skipped numbers, a migration that depends on data only present in development, and non-transactional statements (`CREATE INDEX CONCURRENTLY`, `VACUUM`) that cannot run inside the runner's transaction.
- Ownership changes on `sec.*` functions use `SET LOCAL ROLE tinnox_definer` and `RESET ROLE`, as in migrations 0002 to 0004.
- Locks: flag table rewrites or long `ACCESS EXCLUSIVE` locks on large tables. `tinnox_migrator` has `lock_timeout = '30s'`.
- Each migration that changes tables, policies, grants or functions has an integration test like `packages/db/test/migration-0005.integration.test.ts` when it upgrades existing data.

### 5. Skills for each kind of round

- Frontend rounds (portal, player, `packages/app-render`): also apply `.agents/skills/web-design-guidelines/`.
- Database rounds (migrations, RLS, `packages/db`): also apply `.agents/skills/postgres-best-practices/`. Its examples use Supabase's `authenticated` and `service_role` roles and `auth.uid()`. In this repo those map to `tinnox_app` with `app.org_id`, and there is no service role: nothing at runtime may bypass RLS except the `sec.*` functions above. Ignore advice that only applies to Supabase's hosted platform.
