# Portal v2, stage C: roles and people (CMS-13 build spec)

Date: 2026-11-19. Card CMS-13, decision DEC-35 (`docs/decisions-2026-11.md:50`), decision record `docs/portal-v2/stage-c-roles-decision.md` (called "the record" below). Read the record's top lines ("Decided by Michael", "Answered") and its matrix rows first; they win over everything else in it. Its "The matrix in one sentence each" lines are stale (they put the screen keys on Admin); section 1.3 is the table to build from, and section 10 fixes those lines.

Scope: the whole of CMS-13 on one branch (`feat/stage-c-roles`): the record's C1 ("Roles enforced") and C2 ("People"). One migration, `db/migrations/0013_roles_and_members.sql`, holds all schema. Migrations 0001 to 0012 are never edited.

Ponytail rule as in stage B: every known limit gets `// shortcut: <limit>, <when to upgrade>`; section 12 lists the ones this build adds. Paths are relative to the repository root. Every claim about existing code was checked against `feat/stage-c-roles` at `2a5ad54`; nothing was run. Review rules: `AGENTS.md` "Code Review Rules" (database roles, tenant isolation, audit in the same transaction, migration history). The database round applies `.agents/skills/postgres-best-practices/` (mapping: Supabase `authenticated` is `tinnox_app` with `app.org_id`; there is no service role). The frontend round applies `.agents/skills/web-design-guidelines/` (sentence case wins over its title-case rule, `docs/portal-v2/design-system.md:17`).

**What it delivers.** Four fixed roles (Owner, Admin, Editor, Viewer), enforced by the API on every operator route and again inside every write. A portal that hides what a role lacks and opens editors read-only. A Users page where Admins and Owners request invites, change roles, correct names, sign people out everywhere and remove them. TINNOX completes invites with a script. Removal, demotion and "sign out everywhere" end the person's sessions at once, and a browser that is still signed in at the identity provider must enter the password and one-time code again.

**Model in five sentences.** A member's role is read live from `membership` on every request; the session row never copies it. A route-to-key table decides every operator route before the handler runs (default deny), and every write transaction re-reads the role with `FOR SHARE` as its first statement. Member changes run one at a time per organisation under one advisory lock, and a trigger keeps an active Owner. `sessions_valid_after` on the member row ends old sessions and refuses sign-ins whose `auth_time` is older, which forces `prompt=login`. Invites are requests in `member_invite`; their name and e-mail address are deleted when the invite closes.

---

## 1. Roles, keys and rules (every other section uses these tables)

### 1.1 Roles and rank

| Role | Rank | Label | One line (Users page, invite dialog) |
|---|---|---|---|
| `owner` | 3 | Owner | Holds the account. Can do everything, and is the only role that makes, changes or removes Admins and Owners. |
| `admin` | 2 | Admin | Everything an Editor does, plus inviting, changing and removing Editors and Viewers and reading the full audit log. |
| `editor` | 1 | Editor | Makes, pushes and deletes content, sets up screens and pairs players. |
| `viewer` | 0 | Viewer | Sees every screen, all content and each screen's reported status. Changes nothing. |

Each role includes everything the role below it can do. One role per person. The UI never shows "operator" as a role. `audit_event.actor_type = 'operator'` keeps meaning "a customer person" and is labelled "Person".

### 1.2 Permission keys

Active keys (`PERMISSION_KEYS`, in this order):

| Key | Covers |
|---|---|
| `org.read` | Every read: screens, sites, delivery status, media (preview, thumbnail, usage), folders, tags, apps, playlists, schedules, layouts, push plan, overview. HEAD is treated as GET |
| `activity.read` | `GET /api/audit` limited to the activity categories (1.5); `GET /api/members/names` |
| `audit.read` | `GET /api/audit` unfiltered |
| `content.write` | Create and edit media (upload included), folders, media tags, apps, playlists (duplicate included), schedules, layouts |
| `content.delete` | Delete folders, media tags, apps, playlists, schedules, layouts |
| `media.delete` | Delete media |
| `screen.assign` | The `assigned*` fields of `PATCH /api/displays/:id` |
| `push.publish` | `POST /api/push` |
| `screen.details` | A screen's `name`, `description`, `tagIds` |
| `screen.hours` | A screen's `workingHours` |
| `screen.setup` | Add a screen; `canvas`, `contentRect`, `defaultFit`, `rotation`; create, rename, recolour and delete screen tags |
| `screen.pair` | Claim a pairing code, revoke a player, cancel a pending pairing |
| `member.read` | `GET /api/members`, `GET /api/invites`; the Users page |
| `member.manage` | Invite, cancel an invite, change a role, correct a name, remove, sign out everywhere; always followed by the rank rule (1.4) |

Reserved, **not** in `PERMISSION_KEYS` (a comment in `packages/contracts/src/session.ts` lists them; adding one later is one line plus its role-table row): `org.rename` (Owner), `org.delete` (Owner), `site.manage` (Editor), `support.grant` (Admin, H1), the CMS-14 emergency message, CMS-15 alert settings, CMS-16 playback report and Epic J API token keys. No route uses them.

No key: `GET /api/session`, `POST /api/auth/logout`, `GET /api/auth/login`, `GET /api/auth/callback` (all outside the operator plugin).

### 1.3 Role-to-key table (`ROLE_PERMISSIONS`, `packages/domain/src/permissions.ts`)

Built from the record's matrix rows (`stage-c-roles-decision.md:69-137`), its key table (`:44-63`) and DEC-35. Not from `:141-145`.

| Key | viewer | editor | admin | owner |
|---|---|---|---|---|
| `org.read` | Y | Y | Y | Y |
| `activity.read` | Y | Y | Y | Y |
| `content.write` | | Y | Y | Y |
| `content.delete` | | Y | Y | Y |
| `media.delete` | | Y | Y | Y |
| `screen.assign` | | Y | Y | Y |
| `push.publish` | | Y | Y | Y |
| `screen.details` | | Y | Y | Y |
| `screen.hours` | | Y | Y | Y |
| `screen.setup` | | Y | Y | Y |
| `screen.pair` | | Y | Y | Y |
| `audit.read` | | | Y | Y |
| `member.read` | | | Y | Y |
| `member.manage` | | | Y | Y |

Owner differs from Admin only through the rank rule (1.4), never through a key. Consequence for the 51 routes that exist today: Editor, Admin and Owner differ only in the `GET /api/audit` filter; every refusal on them is a Viewer refusal of a write.

### 1.4 Rank rule (`canManage`, `grantableRoles`) and self-actions

- `canManage(actor: Role, target: Role): boolean`: `owner` → any target; `admin` → `editor` or `viewer`; `editor`, `viewer` → nothing.
- `grantableRoles(actor: Role, purpose: 'invite' | 'change'): readonly Role[]`:

  | actor | invite | change |
  |---|---|---|
  | owner | admin, editor, viewer | owner, admin, editor, viewer |
  | admin | editor, viewer | editor, viewer |
  | editor, viewer | none | none |

- Owner is granted only to a member whose `first_signed_in_at` is set (API check, 409). Nobody invites an Owner (`INVITE_ROLES` has no `owner`; the database CHECK agrees).
- Nobody changes, renames, removes or signs out themselves (D7). The API compares ids: `target.id === session.membershipId` → 403.
- Demotion = the new role's rank is lower. Removal, demotion and sign-out-everywhere end the target's sessions; a promotion and a name change end none.
- A demotion cancels the target's pending invites whose role is not in `grantableRoles(newRole, 'invite')`. A removal cancels all of them.

### 1.5 Activity categories (`ACTIVITY_CATEGORIES`)

`display`, `pairing`, `player`, `media`, `tag`, `folder`, `app`, `playlist`, `schedule`, `layout`, `publication`. Without `audit.read` these are the only categories `GET /api/audit` returns. Excluded, `audit.read` only: `auth`, `security`, `invite`, `membership`. `pairing` and `player` are in because Editors pair and revoke and must see those events (`player.auth_rejected` is written without an organisation, so it never shows anyway).

### 1.6 Status codes

| Situation | Answer |
|---|---|
| The role lacks the route's key (preHandler) | 403 `forbidden`, message "Your role doesn't allow this.", decided before any lookup, the same for every id (own, unknown, other organisation's) |
| The role was lowered between the preHandler and the write (`assertStillAllowed`; a race, or a change made in the database) | 403 `forbidden`, same message |
| The member was removed, or their sessions were ended (removal, demotion, sign out everywhere), between the preHandler and the write | 401 `unauthenticated` (existing code) |
| Role allowed, id of another organisation | 404 `not_found` (unchanged, AGENTS.md §2) |
| Rank rule, self-action or a role the actor may not grant (people routes, after the target is read) | 403 `forbidden` |
| The change would leave no active Owner | 409 `last_owner` (new code) |
| Owner for a member who never signed in | 409 `conflict`, detail `{ path: 'role', code: 'not_signed_in_yet' }` |
| `lock_timeout` (55P03) anywhere in a write transaction (membership lock, actor row, target row, any other lock) | 503 `service_unavailable` (existing code, `apps/api/src/errors.ts:69`), header `retry-after: 2`; mapped by `withOrgAllowed` and `withOrgDecisionAllowed` (6.3) |

This is how DEC-35 reads AGENTS.md §2: cross-organisation ids still answer 404; a refusal by role is the same 403 for every id. In-organisation refusals never use SQLSTATE 42501, because `apps/api/src/errors.ts:159-163` answers 42501 as 404.

---

## 2. Migration `db/migrations/0013_roles_and_members.sql`

0012 is `0012_pairing_upgrade_cleanup.sql`, so this is 0013. One file, one transaction (`packages/db/src/migrate.ts:95-111`). No `CONCURRENTLY`, no `VACUUM`.

```sql
-- 0013: roles and members (CMS-13, DEC-35; docs/portal-v2/stage-c.md). 0001 to 0012 are unchanged.
--
--   1. membership: four roles; today's 'operator' rows become 'owner' (D4 a); display name,
--      removal, first sign-in and the session cut-off.
--   2. membership_guard: an organisation keeps an active Owner; a removal is final.
--   3. membership_display_name_stamp: records when a set name is changed.
--   4. member_invite: invite requests that TINNOX completes, and member_invite_guard.
--   5. Row-level security and grants.
--   6. sec.*: session_create (new signature and outcome), session_by_id_hash,
--      membership_by_oidc_sub, pairing_claim and pairing_complete ignore removed members;
--      session_revoke_membership is new.
--   7. Final checks.
--
-- Script exemptions test session_user, not current_user. TINNOX's provisioning scripts log in
-- as tinnox_migrator and read across organisations under SET LOCAL ROLE tinnox_definer, where
-- current_user is tinnox_definer. session_user stays the login role under SET ROLE and inside
-- SECURITY DEFINER functions, and only a superuser can change it, so the API (tinnox_app) and
-- the sec.* functions it calls can never pass the check.
--
-- Grants. tinnox_app gets UPDATE on exactly four membership columns: the in-write role check
-- (SELECT ... FOR SHARE needs UPDATE on one column) and the people routes of this build use
-- them. It gets no INSERT on membership, and never oidc_sub, org_id, first_signed_in_at,
-- sessions_valid_after or display_name_changed_at. tinnox_definer gets UPDATE on the two
-- columns its sec.* functions write, and a script-only read of member_invite (section 5).
--
-- Locks and deploy order. Takes ACCESS EXCLUSIVE on membership until commit, which waits for
-- every API request (sec.session_by_id_hash joins membership). It drops the five-argument
-- sec.session_create, so an API from before 0013 cannot sign anyone in afterwards: stop the
-- API, migrate, then start the new API and portal together.

-- ------------------------------------------------------------------ 1. membership

ALTER TABLE public.membership
  -- Verified name of the unnamed 0001 column CHECK (role = 'operator').
  DROP CONSTRAINT membership_role_check,
  -- An insert that names no role now fails (23502).
  ALTER COLUMN role DROP DEFAULT,
  -- NULL for members TINNOX has not named yet (provision-member set-name). Twin of ABSOLUTE.maxNameLength.
  ADD COLUMN display_name text,
  -- Set by membership_display_name_stamp when a set name changes; drives the audit page's "renamed" mark.
  ADD COLUMN display_name_changed_at timestamptz,
  ADD COLUMN removed_at timestamptz,
  -- The member who removed this one; NULL when TINNOX's script removed them.
  ADD COLUMN removed_by uuid,
  -- Written by sec.session_create only; reactivation by provision-member fulfil clears it.
  ADD COLUMN first_signed_in_at timestamptz,
  -- Written by sec.session_revoke_membership only: sessions created, and sign-ins
  -- authenticated, before it are refused.
  ADD COLUMN sessions_valid_after timestamptz,
  ADD CONSTRAINT membership_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 120),
  ADD CONSTRAINT membership_display_name_trimmed CHECK (display_name = btrim(display_name)),
  ADD CONSTRAINT membership_removed_by_fk FOREIGN KEY (removed_by, org_id)
    REFERENCES public.membership (id, org_id),
  -- removed_by stays NULL for a removal by a TINNOX script, so this is not "both or neither".
  ADD CONSTRAINT membership_removed_pair CHECK (removed_by IS NULL OR removed_at IS NOT NULL),
  -- Nobody removes themselves (D7); the API refuses first, this is the backstop.
  ADD CONSTRAINT membership_not_removed_by_self CHECK (removed_by IS DISTINCT FROM id);

-- Names are unique per organisation, ignoring case, removed members included (their name
-- keeps old activity readable). NULLs never collide.
CREATE UNIQUE INDEX membership_org_display_name_key ON public.membership (org_id, lower(display_name));

-- sec.session_revoke_membership ends a member's live sessions by membership_id.
CREATE INDEX session_membership_idx ON public.session (membership_id) WHERE revoked_at IS NULL;

-- Row-level security is forced, so even the owner sees no membership rows without an
-- organisation context, and this statement spans every organisation. FORCE is lifted for this
-- one statement and restored at once, inside this transaction, as 0005:179-201 does: no other
-- session ever sees the table without it, and tinnox_app stays subject to the policy.
ALTER TABLE public.membership NO FORCE ROW LEVEL SECURITY;
UPDATE public.membership SET role = 'owner' WHERE role = 'operator';
ALTER TABLE public.membership FORCE ROW LEVEL SECURITY;

-- Validated against every row now: a row the mapping missed fails the migration.
ALTER TABLE public.membership
  ADD CONSTRAINT membership_role_known CHECK (role IN ('owner', 'admin', 'editor', 'viewer'));

-- ------------------------------------------------------------- 2. membership_guard

-- Created after the mapping, which runs without an organisation context.
-- SECURITY INVOKER: for tinnox_app the count runs under row-level security, which the
-- organisation check below makes equal to OLD.org_id.
CREATE FUNCTION public.membership_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  others integer;
BEGIN
  -- Fails closed outside the row's organisation, for every role and whether or not
  -- row-level security applies (a script without app.org_id, a superuser, FORCE lifted).
  IF public.app_org_id() IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'a membership is changed only inside its own organisation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A removal is final: removed_at and removed_by are set once and never changed or cleared,
  -- and a removed member's role stays as it was. Only TINNOX's provisioning scripts, logged in
  -- as tinnox_migrator, reactivate a removed member (see the file header).
  IF TG_OP = 'UPDATE' AND OLD.removed_at IS NOT NULL AND session_user <> 'tinnox_migrator'
     AND (NEW.removed_at IS DISTINCT FROM OLD.removed_at
          OR NEW.removed_by IS DISTINCT FROM OLD.removed_by
          OR NEW.role IS DISTINCT FROM OLD.role) THEN
    RAISE EXCEPTION 'a removed member cannot be changed'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'membership_removed_final';
  END IF;

  -- An organisation always keeps an active Owner. One check at a time per organisation (the
  -- lock the API and the scripts also take first); at READ COMMITTED each count takes a fresh
  -- snapshot, so the second of two concurrent demotions sees the first one's commit. Under
  -- REPEATABLE READ both would count the other as active, so any other level is refused.
  -- Rows changed earlier by the same statement are visible here, so a multi-row demotion
  -- fails on its last owner.
  IF OLD.role = 'owner' AND OLD.removed_at IS NULL
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.removed_at IS NOT NULL) THEN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'membership changes run at READ COMMITTED'
        USING ERRCODE = 'invalid_transaction_state';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('tinnox.membership:' || OLD.org_id::text, 0));
    SELECT count(*) INTO others
    FROM public.membership m
    WHERE m.org_id = OLD.org_id AND m.id <> OLD.id AND m.role = 'owner' AND m.removed_at IS NULL;
    IF others = 0 THEN
      RAISE EXCEPTION 'an organisation keeps at least one active owner'
        USING ERRCODE = 'restrict_violation', CONSTRAINT = 'membership_last_owner';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

-- Not a plain BEFORE UPDATE: sec.session_create (first_signed_in_at) and
-- sec.session_revoke_membership (sessions_valid_after) update the row, the first without an
-- organisation context, and must not fire it.
CREATE TRIGGER membership_guard
  BEFORE UPDATE OF role, removed_at, removed_by OR DELETE ON public.membership
  FOR EACH ROW EXECUTE FUNCTION public.membership_guard();
REVOKE ALL ON FUNCTION public.membership_guard() FROM PUBLIC;

-- ---------------------------------------------- 3. membership_display_name_stamp

-- Naming a member for the first time is not a rename; changing a set name is.
CREATE FUNCTION public.membership_display_name_stamp() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF OLD.display_name IS NOT NULL AND NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    NEW.display_name_changed_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membership_display_name_stamp
  BEFORE UPDATE OF display_name ON public.membership
  FOR EACH ROW EXECUTE FUNCTION public.membership_display_name_stamp();
REVOKE ALL ON FUNCTION public.membership_display_name_stamp() FROM PUBLIC;

-- ----------------------------------------------------------------- 4. member_invite

-- An "Invite person" request. TINNOX completes it (provision-member fulfil) or lets it expire
-- (provision-member pending, daily); an Admin or Owner may cancel it. The name and the work
-- e-mail address exist only while it is pending (D3 a). Twins in packages/contracts/src/members.ts.
CREATE TABLE public.member_invite (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES public.organization (id),
  -- Twin of INVITE_ROLES: nobody is invited as an Owner (promotion after the first sign-in).
  role                    text NOT NULL,
  name                    text,
  email                   text,
  status                  text NOT NULL DEFAULT 'pending',
  invited_by              uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL,
  -- Set by member_invite_guard when the invite leaves 'pending'.
  closed_at               timestamptz,
  -- The member who cancelled it; NULL when a TINNOX script, or a removal or demotion of the
  -- inviter, closed it.
  closed_by               uuid,
  fulfilled_membership_id uuid,
  UNIQUE (id, org_id),
  CONSTRAINT member_invite_role_known CHECK (role IN ('admin', 'editor', 'viewer')),
  CONSTRAINT member_invite_status_known
    CHECK (status IN ('pending', 'fulfilled', 'cancelled', 'expired')),
  CONSTRAINT member_invite_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT member_invite_name_trimmed CHECK (name = btrim(name)),
  CONSTRAINT member_invite_email_length CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT member_invite_email_shape CHECK (email LIKE '%_@_%'),
  -- Written with IS NULL and IS NOT NULL only, so it is never NULL (0008).
  CONSTRAINT member_invite_open CHECK (
    (status = 'pending' AND name IS NOT NULL AND email IS NOT NULL AND closed_at IS NULL)
    OR (status <> 'pending' AND name IS NULL AND email IS NULL AND closed_at IS NOT NULL)
  ),
  CONSTRAINT member_invite_fulfilled
    CHECK ((status = 'fulfilled') = (fulfilled_membership_id IS NOT NULL)),
  CONSTRAINT member_invite_invited_by_fk FOREIGN KEY (invited_by, org_id)
    REFERENCES public.membership (id, org_id),
  CONSTRAINT member_invite_closed_by_fk FOREIGN KEY (closed_by, org_id)
    REFERENCES public.membership (id, org_id),
  CONSTRAINT member_invite_fulfilled_fk FOREIGN KEY (fulfilled_membership_id, org_id)
    REFERENCES public.membership (id, org_id)
);
-- The Users page list and the scripts' queue.
CREATE INDEX member_invite_org_pending_idx ON public.member_invite (org_id, created_at)
  WHERE status = 'pending';
-- Invites a removed or demoted member sent (cancelled in the same transaction).
CREATE INDEX member_invite_invited_by_idx ON public.member_invite (invited_by)
  WHERE status = 'pending';
-- One pending invite per address and per name in an organisation, ignoring case.
CREATE UNIQUE INDEX member_invite_pending_email_key ON public.member_invite (org_id, lower(email))
  WHERE status = 'pending';
CREATE UNIQUE INDEX member_invite_pending_name_key ON public.member_invite (org_id, lower(name))
  WHERE status = 'pending';

CREATE FUNCTION public.member_invite_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.closed_at IS NOT NULL OR NEW.closed_by IS NOT NULL
       OR NEW.fulfilled_membership_id IS NOT NULL
       OR NEW.expires_at <= now() OR NEW.expires_at > now() + interval '14 days' THEN
      RAISE EXCEPTION 'a new invite is pending and expires within 14 days'
        USING ERRCODE = 'restrict_violation', CONSTRAINT = 'member_invite_guard';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a closed invite cannot change'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'member_invite_guard';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.role IS DISTINCT FROM OLD.role OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR (NEW.status = 'pending' AND (NEW.name IS DISTINCT FROM OLD.name
                                     OR NEW.email IS DISTINCT FROM OLD.email
                                     OR NEW.closed_by IS NOT NULL)) THEN
    RAISE EXCEPTION 'an invite request cannot change'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'member_invite_guard';
  END IF;
  -- tinnox_app only cancels; TINNOX's scripts (logged in as tinnox_migrator) fulfil and expire.
  IF NEW.status IN ('fulfilled', 'expired') AND session_user <> 'tinnox_migrator' THEN
    RAISE EXCEPTION 'only TINNOX fulfils or expires an invite'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'member_invite_guard';
  END IF;
  IF NEW.status <> 'pending' THEN
    -- Closing deletes the person's details (D3 a) and stamps the time. Changes made here are
    -- not privilege-checked, so the column grants below stay narrow.
    NEW.name := NULL;
    NEW.email := NULL;
    NEW.closed_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER member_invite_guard BEFORE INSERT OR UPDATE ON public.member_invite
  FOR EACH ROW EXECUTE FUNCTION public.member_invite_guard();
REVOKE ALL ON FUNCTION public.member_invite_guard() FROM PUBLIC;

-- --------------------------------------------------------------- 5. RLS and grants

ALTER TABLE public.member_invite ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_invite FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.member_invite
  USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id());

-- Runtime role. membership keeps its table-wide SELECT (0001:471), which covers the new columns.
GRANT UPDATE (role, display_name, removed_at, removed_by) ON public.membership TO tinnox_app;
GRANT SELECT, INSERT ON public.member_invite TO tinnox_app;
GRANT UPDATE (status, closed_by) ON public.member_invite TO tinnox_app;

-- Owner of the sec.* functions: sec.session_create writes first_signed_in_at and locks the
-- row (FOR NO KEY UPDATE needs UPDATE on one column); sec.session_revoke_membership writes
-- sessions_valid_after.
GRANT UPDATE (first_signed_in_at, sessions_valid_after) ON public.membership TO tinnox_definer;

-- Script-only: provision-member pending and the first step of fulfil read the invite queue of
-- every organisation under SET LOCAL ROLE tinnox_definer (TINNOX staff must work every
-- customer's queue) and expire old invites. No sec.* function reads member_invite, and
-- tinnox_app cannot SET ROLE tinnox_definer.
GRANT SELECT (id, org_id, role, name, email, status, invited_by, created_at, expires_at)
  ON public.member_invite TO tinnox_definer;
GRANT UPDATE (status) ON public.member_invite TO tinnox_definer;

-- -------------------------------------------------------------------- 6. sec.*

SET LOCAL ROLE tinnox_definer;

-- A new OUT column and a new parameter cannot be added with CREATE OR REPLACE.
DROP FUNCTION sec.session_create(bytea, text, text, integer, text);

-- Creates a session for a verified subject. The organisation comes from the membership row
-- and from nowhere else. outcome:
--   created        the session exists; membership_id, org_id, role and expires_at are set;
--   reauth         the member's sessions were ended after this sign-in was authenticated
--                  (auth_time, whole seconds); membership_id and org_id are set, nothing else;
--   no_membership  no member with this subject, or a removed one; nothing else is set.
-- The member row is locked first, so a revocation that is changing it commits before this
-- decides, and this then reads the committed row (READ COMMITTED re-check).
CREATE FUNCTION sec.session_create(
  p_id_hash bytea, p_oidc_sub text, p_csrf_token text, p_ttl_seconds integer, p_id_token text,
  p_auth_time timestamptz)
  RETURNS TABLE (outcome text, membership_id uuid, org_id uuid, role text, expires_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_id uuid;
  v_org uuid;
  v_role text;
  v_removed timestamptz;
  v_cutoff timestamptz;
  v_expires timestamptz;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'session ttl must be 60 to 86400 seconds' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT m.id, m.org_id, m.role, m.removed_at, m.sessions_valid_after
    INTO v_id, v_org, v_role, v_removed, v_cutoff
  FROM public.membership m
  WHERE m.oidc_sub = p_oidc_sub
  FOR NO KEY UPDATE;
  IF NOT FOUND OR v_removed IS NOT NULL THEN
    RETURN QUERY SELECT 'no_membership'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  -- auth_time has whole seconds: a sign-in in the same second as the cut-off is refused once
  -- more (the safe direction). A missing auth_time fails closed once a cut-off exists.
  IF v_cutoff IS NOT NULL
     AND (p_auth_time IS NULL
          OR p_auth_time < date_trunc('second', v_cutoff) + interval '1 second') THEN
    RETURN QUERY SELECT 'reauth'::text, v_id, v_org, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  INSERT INTO public.session AS s (id_hash, membership_id, org_id, oidc_sub, csrf_token, id_token, expires_at)
  VALUES (p_id_hash, v_id, v_org, p_oidc_sub, p_csrf_token, p_id_token,
          now() + make_interval(secs => p_ttl_seconds))
  RETURNING s.expires_at INTO v_expires;
  -- Not in membership_guard's column list, so no organisation context is needed.
  UPDATE public.membership m SET first_signed_in_at = now()
  WHERE m.id = v_id AND m.first_signed_in_at IS NULL;
  RETURN QUERY SELECT 'created'::text, v_id, v_org, v_role, v_expires;
END $$;
REVOKE ALL ON FUNCTION sec.session_create(bytea, text, text, integer, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sec.session_create(bytea, text, text, integer, text, timestamptz) TO tinnox_app;

-- Same contract as 0002, plus: a removed member's session, and a session created before the
-- member's cut-off, are not live. The filter is inside the UPDATE, so a refused session is not
-- touched. Output columns unchanged, so CREATE OR REPLACE keeps owner and grants.
CREATE OR REPLACE FUNCTION sec.session_by_id_hash(p_id_hash bytea, p_idle_timeout_seconds integer)
  RETURNS TABLE (membership_id uuid, org_id uuid, oidc_sub text, role text, org_name text,
                 csrf_token text, created_at timestamptz, expires_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_idle_timeout_seconds IS NULL OR p_idle_timeout_seconds < 60 THEN
    RAISE EXCEPTION 'idle timeout must be at least 60 seconds' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  WITH live AS (
    UPDATE public.session s
    SET last_seen_at = now()
    FROM public.membership m
    WHERE s.id_hash = p_id_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND s.last_seen_at > now() - make_interval(secs => p_idle_timeout_seconds)
      AND m.id = s.membership_id AND m.org_id = s.org_id
      AND m.removed_at IS NULL
      -- Written out: a comparison with NULL is NULL and would drop every row.
      AND (m.sessions_valid_after IS NULL OR s.created_at > m.sessions_valid_after)
    RETURNING s.membership_id, s.org_id, s.oidc_sub, m.role AS member_role, s.csrf_token,
              s.created_at, s.expires_at
  )
  SELECT live.membership_id, live.org_id, live.oidc_sub, live.member_role, o.name,
         live.csrf_token, live.created_at, live.expires_at
  FROM live
  JOIN public.organization o ON o.id = live.org_id;
END $$;

-- Same contract as 0002, plus: a removed member is no member.
CREATE OR REPLACE FUNCTION sec.membership_by_oidc_sub(p_oidc_sub text)
  RETURNS TABLE (membership_id uuid, org_id uuid, role text, org_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT m.id, m.org_id, m.role, o.name
  FROM public.membership m JOIN public.organization o ON o.id = m.org_id
  WHERE m.oidc_sub = p_oidc_sub AND m.removed_at IS NULL
$$;

-- CREATE OR REPLACE sec.pairing_claim with the body of 0010:29-108 copied verbatim, except the
-- membership check at 0010:48, which becomes:
--   PERFORM 1 FROM public.membership m
--   WHERE m.id = p_membership_id AND m.org_id = v_org AND m.removed_at IS NULL;
-- Same signature and OUT columns, so owner and grants stay. It checks no role: the route and
-- the in-write check decide who may pair, so moving screen.pair stays a one-line change.

-- CREATE OR REPLACE sec.pairing_complete with the body of 0010:146-181 copied verbatim, plus
-- this block right after the "IF NOT FOUND ... not_claimable" block that follows the
-- FOR UPDATE select (0010:155-162), before the active-registration check:
--   -- The member who claimed the code must still be in the organisation (0013). FOR SHARE
--   -- waits for a removal that is committing (the definer's 0013 UPDATE grant allows the
--   -- lock). Order: pairing row, then member row; a member change never locks pairing rows.
--   PERFORM 1 FROM public.membership m
--   WHERE m.id = v.claimed_by_membership AND m.org_id = v.org_id AND m.removed_at IS NULL
--   FOR SHARE;
--   IF NOT FOUND THEN
--     UPDATE public.pairing_session ps SET status = 'expired' WHERE ps.id = v.id;
--     RETURN QUERY SELECT 'not_claimable'::text, NULL::uuid, NULL::uuid, NULL::uuid;
--     RETURN;
--   END IF;

-- Ends every live session of one member of the current organisation and sets the member's
-- cut-off: sessions created, and sign-ins authenticated, before it are refused. The member
-- row is updated first, so a sign-in that locked it first and committed is visible to the
-- second statement and is revoked too (each statement takes a fresh snapshot). Returns the
-- number of sessions ended. tinnox_app has no rights on session, hence a sec.* function.
CREATE FUNCTION sec.session_revoke_membership(p_membership_id uuid)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_org uuid := public.app_org_id();
  n integer;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'session_revoke_membership requires an organisation context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- An id from another organisation changes nothing and takes no lock (0012:11-13).
  UPDATE public.membership m SET sessions_valid_after = now()
  WHERE m.id = p_membership_id AND m.org_id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership does not belong to the current organisation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.session s SET revoked_at = now(), id_token = NULL
  WHERE s.membership_id = p_membership_id AND s.org_id = v_org AND s.revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION sec.session_revoke_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sec.session_revoke_membership(uuid) TO tinnox_app;

RESET ROLE;

-- -------------------------------------------------------------------- 7. checks
```

End the file with three DO blocks, unchanged except as noted:
1. The forced-RLS check of 0011:167-179.
2. The tenant-policy and disabled-trigger check of 0011:181-205, with `unnest(ARRAY['member_invite'])`.
3. The `sec.*` hardening guard of 0012:70-86 (owner `tinnox_definer`, `search_path=pg_catalog, pg_temp`, no PUBLIC execute, `tinnox_app` execute). It covers the five re-created functions (`session_create`, `session_by_id_hash`, `membership_by_oidc_sub`, `pairing_claim`, `pairing_complete`) and the one new one. (The record's `0002:385-415` citation is wrong; 0002 ends at 409.)

The SQL above is near-full: copy `pairing_claim` and `pairing_complete` from 0010 as the comments say, and nothing else is left to invent. `OUT` column `role` of `session_by_id_hash` is fed from a CTE alias (`member_role`) so plpgsql never sees an ambiguous name.

**Facts that follow from the SQL:**
- `sec.*` functions: 18 today (`packages/db/test/sec.integration.test.ts:157-160`), 19 after 0013.
- Every existing member becomes `owner`. The dev seed's older subjects become Owners too (D4 a); they can be removed by hand.
- `tinnox_app` `UPDATE membership SET role = …` now passes the privilege check and is decided by the trigger and `membership_role_known` (23001 or 23514). `INSERT INTO membership` stays 42501.
- A removed member: `session_create` → `no_membership`; `session_by_id_hash` → no row (401); `membership_by_oidc_sub` → no row; `pairing_claim` → 42501 (404); `pairing_complete` of their uncollected claim → `not_claimable`.
- Last-owner refusal: 23001, constraint `membership_last_owner` → API 409 `last_owner`. Organisation mismatch: 42501 → 404 (cross-organisation, correct).
- NULL safety: every new CHECK with a nullable column means "no value" when NULL and is meant to pass; `member_invite_open` and `member_invite_fulfilled` use `IS [NOT] NULL` only.
- Locks, held until commit: ACCESS EXCLUSIVE on `membership` (ALTER TABLE, NO FORCE, FORCE; nullable columns without defaults, so no rewrite; the CHECK and FK scan a tiny table), SHARE on `membership` and `session` for the two indexes, SHARE ROW EXCLUSIVE on `organization` and `membership` for the new foreign keys. The migrator's `lock_timeout` is 30 s (`infra/postgres/init/01-roles.sh:44`). `membership` has a handful of rows per organisation.

**`packages/db/src/constraints.ts`** gains, after `STAGE_B_CONSTRAINTS`:

```ts
/** The names of db/migrations/0013_roles_and_members.sql that a caller has to tell apart. */
export const STAGE_C_CONSTRAINTS = Object.freeze({
  /** 23001: the change would leave the organisation without an active Owner. */
  lastOwner: 'membership_last_owner',
  /** 23001: a removed member's removal or role was changed (only TINNOX's scripts reactivate). */
  removedFinal: 'membership_removed_final',
  /** 23505: another member of the organisation has, or had, this name, ignoring case. */
  memberNameTaken: 'membership_org_display_name_key',
  /** 23505: a pending invite of the organisation has this e-mail address, ignoring case. */
  inviteEmailTaken: 'member_invite_pending_email_key',
  /** 23505: a pending invite of the organisation has this name, ignoring case. */
  inviteNameTaken: 'member_invite_pending_name_key',
  /** 23001: an invite change the guard refuses (closed, request changed, wrong status for the role). */
  inviteGuard: 'member_invite_guard',
});
```

---

## 3. Contracts (`packages/contracts`, all objects `.strict()`)

Roles and keys live here because `SessionResponseSchema` validates them and contracts cannot import domain (`packages/domain/package.json` depends on contracts; ESLint `eslint.config.js:65-84`).

**ids.ts:** `MembershipIdSchema = UuidSchema`, `InviteIdSchema = UuidSchema`, with `type MembershipId`, `type InviteId` (after `LayoutIdSchema`, `:19`, `:35`).

**limits.ts:** `ABSOLUTE.maxPendingInvites: 100` (doc: "Pending invites per organisation. Checked under the membership lock by `POST /api/invites`."). `ABSOLUTE` only; `LimitsSchema` does not change.

**session.ts:**
```ts
/** Highest first. Each role includes everything the roles after it can do. */
export const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

/**
 * Active permission keys. Reserved, not listed until a route needs one: org.rename, org.delete,
 * site.manage, support.grant (H1), and the keys of CMS-14, CMS-15, CMS-16 and Epic J.
 * Who holds which key: ROLE_PERMISSIONS in packages/domain/src/permissions.ts.
 */
export const PERMISSION_KEYS = [
  'org.read', 'activity.read', 'audit.read',
  'content.write', 'content.delete', 'media.delete',
  'screen.assign', 'push.publish', 'screen.details', 'screen.hours', 'screen.setup', 'screen.pair',
  'member.read', 'member.manage',
] as const;
export const PermissionKeySchema = z.enum(PERMISSION_KEYS);
export type PermissionKey = z.infer<typeof PermissionKeySchema>;

/** Reasons the portal shows after a failed sign-in (`?authError=` on the portal root). */
export const AUTH_ERROR_CODES = [
  'state', 'provider', 'provider_unavailable', 'no_membership', 'mfa_required', 'reauth_failed',
] as const;
export const AuthErrorCodeSchema = z.enum(AUTH_ERROR_CODES);
export type AuthErrorCode = z.infer<typeof AuthErrorCodeSchema>;
```
`SessionResponseSchema`'s `user` (`:15`) becomes:
```ts
user: z.object({
  membershipId: MembershipIdSchema,
  /** Null until TINNOX names the member; the portal then shows the role label. */
  displayName: z.string().min(1).max(ABSOLUTE.maxNameLength).nullable(),
  role: RoleSchema,
  /** The keys the role holds now. The portal checks these, never role names. */
  permissions: z.array(PermissionKeySchema).max(PERMISSION_KEYS.length),
}).strict(),
```
`apps/api/src/routes/auth.ts:42-44` deletes its local `AuthErrorCode` type and imports this one.

**members.ts (new, exported from index.ts after `session.ts`):**
```ts
/** Roles an invite can carry: nobody is invited as an Owner (promotion after the first sign-in). Twin of member_invite_role_known. */
export const INVITE_ROLES = ['admin', 'editor', 'viewer'] as const;
export const InviteRoleSchema = z.enum(INVITE_ROLES);
export type InviteRole = z.infer<typeof InviteRoleSchema>;

/** Days an invite waits for TINNOX. Twin of member_invite_guard (14 days). */
export const INVITE_TTL_DAYS = 14;

/** A member's display name in a request. Twin of membership_display_name_length and _trimmed. */
export const MemberNameSchema = labelSchema(ABSOLUTE.maxNameLength, 'name');

/** A work e-mail address in an invite request. The database twin checks only length and an "@". */
export const InviteEmailSchema = z.string().trim()
  .min(3).max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'work e-mail address must look like name@example.com');

const NameOut = z.string().min(1).max(ABSOLUTE.maxNameLength);

/** `GET /api/members` item. Never an e-mail address (D3 a). */
export const MemberDtoSchema = z.object({
  id: MembershipIdSchema,
  displayName: NameOut.nullable(),
  role: RoleSchema,
  firstSignedInAt: UtcTimestampSchema.nullable(),
  removedAt: UtcTimestampSchema.nullable(),
}).strict();
export const MemberListResponseSchema = z.object({ items: z.array(MemberDtoSchema).max(ABSOLUTE.maxListItems) }).strict();

/** `GET /api/members/names` item: what activity needs. Never a role or an e-mail address. */
export const MemberNameDtoSchema = z.object({
  id: MembershipIdSchema,
  displayName: NameOut.nullable(),
  removed: z.boolean(),
  /** When the name last changed; events before it show "(renamed)". Null when never renamed. */
  renamedAt: UtcTimestampSchema.nullable(),
}).strict();
export const MemberNameListResponseSchema = z.object({ items: z.array(MemberNameDtoSchema).max(ABSOLUTE.maxListItems) }).strict();

/** `PATCH /api/members/:id`. */
export const MemberPatchSchema = z.object({
  role: RoleSchema.optional(),
  displayName: MemberNameSchema.optional(),
}).strict().refine((p) => p.role !== undefined || p.displayName !== undefined, {
  message: 'name a role or a display name to change',
});

/** Answer of `PATCH /api/members/:id` and `POST /api/members/:id/remove`. */
export const MemberChangeResponseSchema = z.object({
  member: MemberDtoSchema,
  sessionsEnded: z.number().int().min(0),
  invitesCancelled: z.number().int().min(0),
}).strict();
/** Answer of `POST /api/members/:id/sign-out`. */
export const MemberSignOutResponseSchema = z.object({ sessionsEnded: z.number().int().min(0) }).strict();

/** `POST /api/invites`. The organisation and the inviter come from the session. */
export const InviteCreateSchema = z.object({
  name: MemberNameSchema,
  email: InviteEmailSchema,
  role: InviteRoleSchema,
}).strict();

/** A pending invite (`GET /api/invites` item, `POST /api/invites` answer). */
export const InviteDtoSchema = z.object({
  id: InviteIdSchema,
  name: NameOut,
  email: z.string().min(3).max(254),
  role: InviteRoleSchema,
  invitedBy: MembershipIdSchema,
  createdAt: UtcTimestampSchema,
  expiresAt: UtcTimestampSchema,
}).strict();
export const InviteListResponseSchema = z.object({ items: z.array(InviteDtoSchema).max(ABSOLUTE.maxPendingInvites) }).strict();

/** The short reference staff and customers quote: the id's first 8 hex digits, upper case. Never used to derive a username. */
export function inviteReference(id: string): string
```
Plus `type` exports for each schema (`MemberDto`, `MemberNameDto`, `MemberPatch`, `MemberChangeResponse`, `MemberSignOutResponse`, `InviteCreate`, `InviteDto`).

**routes.ts**, after `audit`:
```ts
/** GET: every member, removed ones included (member.read). */
members: '/api/members',
/** GET: id and name of every member (activity.read). A fixed path, registered beside `:id`. */
memberNames: '/api/members/names',
/** PATCH: role or display name. */
memberPattern: '/api/members/:id',
member: (id: string) => `/api/members/${enc(id)}`,
memberRemovePattern: '/api/members/:id/remove',
memberRemove: (id: string) => `/api/members/${enc(id)}/remove`,
memberSignOutPattern: '/api/members/:id/sign-out',
memberSignOut: (id: string) => `/api/members/${enc(id)}/sign-out`,
/** GET: pending invites (member.read). POST: request an invite (member.manage). */
invites: '/api/invites',
inviteCancelPattern: '/api/invites/:id/cancel',
inviteCancel: (id: string) => `/api/invites/${enc(id)}/cancel`,
```

**errors.ts:** `'last_owner'` in `API_ERROR_CODES`, after `'layout_in_use'`.

**audit.ts:**
- `AUDIT_ACTIONS` gains, in this order after `'publication.create'`: `'invite.create'`, `'invite.cancel'`, `'membership.create'`, `'membership.role_change'`, `'membership.update'`, `'membership.remove'`, `'membership.sessions_end'`, `'membership.mfa_reset'`; and `'security.permission_denied'` after `'security.csrf_rejected'`.
- `AUDIT_CATEGORIES` gains `'invite'` and `'membership'` after `'publication'`. Added together with their actions, so `portal-v2.test.ts:1331-1334` (categories equal the derived set) stays green.

Audit details (no name, e-mail address, token or time in any row; `occurred_at` is set by the database):

| Action | Writer | Object | `detail` |
|---|---|---|---|
| `invite.create` | `POST /api/invites` | `invite`, id | `{ role }` |
| `invite.cancel` | `POST /api/invites/:id/cancel`; a removal or demotion of the inviter; `provision-member pending` expiry; `restore-owner` | `invite`, id | `{ role, reason: 'cancelled' \| 'inviter_removed' \| 'inviter_demoted' \| 'expired', executedBy? }` |
| `membership.create` | `provision-member fulfil`, `org-create`, `restore-owner` (actor `system`) | `membership`, id | `{ role, inviteId, reactivated, requestRef, confirmedWith?, executedBy, approvedBy?, reason? }` |
| `membership.role_change` | `PATCH /api/members/:id`; `restore-owner --promote` | `membership`, id | `{ from, to, sessionsEnded, invitesCancelled, reason?, requestRef?, executedBy?, approvedBy? }` |
| `membership.update` | `PATCH /api/members/:id`; `provision-member set-name` | `membership`, id | `{ fields: ['displayName'], requestRef?, executedBy? }` |
| `membership.remove` | `POST /api/members/:id/remove`; `restore-owner --successor` | `membership`, id | `{ previousRole, sessionsEnded, invitesCancelled, reason?, requestRef?, executedBy?, approvedBy? }` |
| `membership.sessions_end` | `POST /api/members/:id/sign-out`; `scripts/revoke-subject-sessions.sql` (actor `system`, 8.3) | `membership`, id | `{ sessions }` from the route; `{ reason: 'incident_revocation' }` from the script |
| `membership.mfa_reset` | `provision-member mfa-reset` | `membership`, id | `{ requestRef, executedBy, confirmedWith?, sessionsEnded }` |
| `security.permission_denied` | the guard, `assertStillAllowed`, refused member changes (section 6.4) | `route` with `"<METHOD> <pattern>"`, or `membership` / `invite` with the target id | `{ permission: string[], method, route, reason, refusalsInWindow?, throttled? }` |

`auth.login` gains two denied reasons: `reauth_required` and `reauth_failed` (scoped to the member's organisation).

---

## 4. Domain (`packages/domain/src/permissions.ts`, new; exported from `index.ts` after `delivery-state.ts`)

```ts
import { AUDIT_CATEGORIES, PERMISSION_KEYS, ROLES, type AuditCategory, type PermissionKey, type Role } from '@tinnox/contracts';

const VIEWER = ['org.read', 'activity.read'] as const;
const EDITOR = [...VIEWER, 'content.write', 'content.delete', 'media.delete', 'screen.assign',
  'push.publish', 'screen.details', 'screen.hours', 'screen.setup', 'screen.pair'] as const;
const ADMIN = [...EDITOR, 'audit.read', 'member.read', 'member.manage'] as const;

/** The one role-to-key table (section 1.3 of docs/portal-v2/stage-c.md). Moving a key is one line here. */
export const ROLE_PERMISSIONS: { readonly [R in Role]: readonly PermissionKey[] } = {
  owner: ADMIN, admin: ADMIN, editor: EDITOR, viewer: VIEWER,
};
export const ROLE_RANK: { readonly [R in Role]: number } = { owner: 3, admin: 2, editor: 1, viewer: 0 };
export const ROLE_LABELS: { readonly [R in Role]: string } = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };

export function can(role: Role, key: PermissionKey): boolean;
/** The role's keys in PERMISSION_KEYS order (the session's `permissions`). */
export function permissionsOf(role: Role): PermissionKey[];
/** Rank rule: an Owner manages every role; an Admin manages Editors and Viewers; nobody else manages anyone. */
export function canManage(actor: Role, target: Role): boolean;
/** Roles the actor may give (section 1.4). Owner for 'change' still needs the target's first sign-in (API). */
export function grantableRoles(actor: Role, purpose: 'invite' | 'change'): readonly Role[];
export function isDemotion(from: Role, to: Role): boolean;  // ROLE_RANK[to] < ROLE_RANK[from]

/** Categories GET /api/audit returns without audit.read (section 1.5). Explicit, never "all but". */
export const ACTIVITY_CATEGORIES: readonly AuditCategory[] = [
  'display', 'pairing', 'player', 'media', 'tag', 'folder', 'app', 'playlist', 'schedule', 'layout', 'publication',
];
export function visibleAuditCategories(fullLog: boolean): readonly AuditCategory[];  // AUDIT_CATEGORIES or ACTIVITY_CATEGORIES
```
The player depends on domain too (`apps/player-web/package.json:15`); the module is constant tables and pure functions, so it is tree-shaken there.

---

## 5. Database package (`packages/db`)

**src/sec.ts:** the header comment names 0002 and 0013. `SessionCreated` (`:84-89`) is replaced:
```ts
export type SessionCreateResult =
  | { readonly outcome: 'created'; readonly membershipId: string; readonly orgId: string; readonly role: string; readonly expiresAt: string }
  | { readonly outcome: 'reauth'; readonly membershipId: string; readonly orgId: string }
  | { readonly outcome: 'no_membership' };

/** sec.session_create (0013). authTime: the ID token's auth_time; null when the token has none. */
export async function sessionCreate(
  tx: Tx,
  input: { idHash: Buffer; oidcSub: string; csrfToken: string; ttlSeconds: number; idToken: string | null; authTime: Date | null },
): Promise<SessionCreateResult>
// 'SELECT outcome, membership_id, org_id, role, expires_at FROM sec.session_create($1, $2, $3, $4, $5, $6)'
// Exactly one row; an unknown outcome throws.

/** sec.session_revoke_membership (0013): ends the member's sessions and sets the cut-off. Inside withOrg only. */
export async function sessionRevokeMembership(tx: Tx, membershipId: string): Promise<number>
```
`role` stays `string` in `@tinnox/db` (it depends only on `pg`); the API narrows it.

**src/members.ts (new, exported from `index.ts`):** the SQL the API and the scripts share, so the lock key and the lock order exist once.
```ts
/**
 * Takes the per-organisation membership lock of the current withOrg transaction, the key the
 * 0013 trigger uses ('tinnox.membership:' || org). Every member-management transaction takes
 * it first. Throws when there is no organisation context (pg_advisory_xact_lock(NULL) would
 * silently take no lock). A lock timeout (55P03) is thrown as the pg error; the API's
 * wrappers map it (6.3).
 */
export async function lockOrgMembership(tx: Tx): Promise<void>
// SELECT app_org_id() IS NOT NULL AS in_org,
//        pg_advisory_xact_lock(hashtextextended('tinnox.membership:' || app_org_id()::text, 0))

export interface MembershipCheck { readonly role: string; readonly removedAt: string | null; readonly cutOff: boolean }
/**
 * The member row as the in-write role check reads it, share-locked until commit. Null when it
 * is not in this organisation. cutOff: the member's sessions were ended at or after the
 * session's creation (removal, demotion, sign out everywhere, mfa-reset).
 */
export async function membershipForCheck(tx: Tx, membershipId: string, sessionCreatedAt: string): Promise<MembershipCheck | null>
// SELECT role, removed_at,
//        (sessions_valid_after IS NOT NULL AND sessions_valid_after >= $2) AS cut_off
// FROM membership WHERE id = $1 AND org_id = app_org_id() FOR SHARE
```
`$2` is `session.createdAt` (`SessionLookup.createdAt`, `packages/db/src/sec.ts:132`), the same test `sec.session_by_id_hash` applies. It has whole milliseconds, so the comparison errs toward refusing.

**src/constraints.ts:** `STAGE_C_CONSTRAINTS` (section 2).

---

## 6. API (`apps/api`)

Every operator route stays inside the operator plugin (session, CSRF, exact Origin). The organisation comes only from `session.orgId` and `app_org_id()`; no route reads an `orgId` from the request.

### 6.1 Route-to-key table (`ROUTE_PERMISSIONS`, `apps/api/src/auth/permissions.ts`)

Keyed by `` `${METHOD} ${ROUTES.<name>}` `` (the contract constants, so a renamed path breaks the build). An entry is `{ all: [...] }` or `{ any: [...], refine: RefineName }`. 59 entries: the 51 of `tests/integration/session-csrf.test.ts:43-94` plus 8 people routes. 26 GET, 33 writes.

| # | Method | Path (`ROUTES.`) | Rule | Handler |
|---|---|---|---|---|
| 1 | GET | `/api/sites` (`sites`) | all `org.read` | displays.ts:347 |
| 2 | GET | `/api/displays` (`displays`) | all `org.read` | displays.ts:357 |
| 3 | POST | `/api/displays` (`displays`) | all `screen.setup` | displays.ts:365 |
| 4 | GET | `/api/displays/status` (`displaysStatus`) | all `org.read` | displays.ts:718 |
| 5 | GET | `/api/displays/:id` (`displayPattern`) | all `org.read` | displays.ts:410 |
| 6 | PATCH | `/api/displays/:id` (`displayPattern`) | any `screen.assign`, `screen.details`, `screen.hours`, `screen.setup`; refine `displayPatchFields` | displays.ts:426 |
| 7 | POST | `/api/displays/:id/claim` (`displayClaimPattern`) | all `screen.pair` | displays.ts:586 |
| 8 | POST | `/api/displays/:id/revoke-player` (`displayRevokePlayerPattern`) | all `screen.pair` | displays.ts:663 |
| 9 | GET | `/api/displays/:id/status` (`displayStatusPattern`) | all `org.read` | displays.ts:707 |
| 10 | GET | `/api/media` (`media`) | all `org.read` | media.ts:191 |
| 11 | POST | `/api/media` (`media`) | all `content.write` | media.ts:206 |
| 12 | GET | `/api/media/:id` (`mediaItemPattern`) | all `org.read` | media.ts:373 |
| 13 | PATCH | `/api/media/:id` (`mediaItemPattern`) | all `content.write` | media.ts:388 |
| 14 | DELETE | `/api/media/:id` (`mediaItemPattern`) | all `media.delete` | media.ts:606 |
| 15 | GET | `/api/media/:id/preview` (`mediaPreviewPattern`) | all `org.read` | media.ts:594 |
| 16 | GET | `/api/media/:id/thumbnail` (`mediaThumbnailPattern`) | all `org.read` | media.ts:595 |
| 17 | GET | `/api/media/:id/usage` (`mediaUsagePattern`) | all `org.read` | media.ts:507 |
| 18 | GET | `/api/apps` (`apps`) | all `org.read` | apps.ts:70 |
| 19 | POST | `/api/apps` (`apps`) | all `content.write` | apps.ts:84 |
| 20 | GET | `/api/apps/:id` (`appPattern`) | all `org.read` | apps.ts:117 |
| 21 | PATCH | `/api/apps/:id` (`appPattern`) | all `content.write` | apps.ts:127 |
| 22 | DELETE | `/api/apps/:id` (`appPattern`) | all `content.delete` | apps.ts:175 |
| 23 | GET | `/api/schedules` (`schedules`) | all `org.read` | schedules.ts:232 |
| 24 | POST | `/api/schedules` (`schedules`) | all `content.write` | schedules.ts:251 |
| 25 | GET | `/api/schedules/:id` (`schedulePattern`) | all `org.read` | schedules.ts:266 |
| 26 | PUT | `/api/schedules/:id` (`schedulePattern`) | all `content.write` | schedules.ts:279 |
| 27 | DELETE | `/api/schedules/:id` (`schedulePattern`) | all `content.delete` | schedules.ts:297 |
| 28 | GET | `/api/layouts` (`layouts`) | all `org.read` | layouts.ts:207 |
| 29 | POST | `/api/layouts` (`layouts`) | all `content.write` | layouts.ts:212 |
| 30 | GET | `/api/layouts/:id` (`layoutPattern`) | all `org.read` | layouts.ts:225 |
| 31 | PUT | `/api/layouts/:id` (`layoutPattern`) | all `content.write` | layouts.ts:238 |
| 32 | DELETE | `/api/layouts/:id` (`layoutPattern`) | all `content.delete` | layouts.ts:256 |
| 33 | GET | `/api/tags` (`tags`) | all `org.read` | tags.ts:134 |
| 34 | POST | `/api/tags` (`tags`) | any `content.write`, `screen.setup`; refine `tagScopeFromBody` | tags.ts:149 |
| 35 | PATCH | `/api/tags/:id` (`tagPattern`) | any `content.write`, `screen.setup`; refine `tagScopeFromRow` | tags.ts:197 |
| 36 | DELETE | `/api/tags/:id` (`tagPattern`) | any `content.delete`, `screen.setup`; refine `tagScopeFromRow` | tags.ts:229 |
| 37 | GET | `/api/folders` (`folders`) | all `org.read` | folders.ts:58 |
| 38 | POST | `/api/folders` (`folders`) | all `content.write` | folders.ts:72 |
| 39 | PATCH | `/api/folders/:id` (`folderPattern`) | all `content.write` | folders.ts:119 |
| 40 | DELETE | `/api/folders/:id` (`folderPattern`) | all `content.delete` | folders.ts:150 |
| 41 | GET | `/api/playlists` (`playlists`) | all `org.read` | playlists.ts:167 |
| 42 | POST | `/api/playlists` (`playlists`) | all `content.write` | playlists.ts:229 |
| 43 | GET | `/api/playlists/:id` (`playlistPattern`) | all `org.read` | playlists.ts:256 |
| 44 | PUT | `/api/playlists/:id` (`playlistPattern`) | all `content.write` | playlists.ts:269 |
| 45 | DELETE | `/api/playlists/:id` (`playlistPattern`) | all `content.delete` | playlists.ts:435 |
| 46 | POST | `/api/playlists/:id/duplicate` (`playlistDuplicatePattern`) | all `content.write` | playlists.ts:368 |
| 47 | POST | `/api/playlists/:id/publish` (`playlistPublishPattern`) | all `push.publish`, `screen.assign` (kept; no portal caller; a cleanup card retires it) | playlists.ts:534 |
| 48 | GET | `/api/push` (`push`) | all `org.read` | push.ts:74 |
| 49 | POST | `/api/push` (`push`) | all `push.publish` | push.ts:156 |
| 50 | GET | `/api/overview` (`overview`) | all `org.read` | overview.ts:25 |
| 51 | GET | `/api/audit` (`audit`) | all `activity.read` (the handler filters, 6.6; it never refuses) | audit.ts:33 |
| 52 | GET | `/api/members` (`members`) | all `member.read` | members.ts (new) |
| 53 | GET | `/api/members/names` (`memberNames`) | all `activity.read` | members.ts |
| 54 | PATCH | `/api/members/:id` (`memberPattern`) | all `member.manage` (then the rank rule) | members.ts |
| 55 | POST | `/api/members/:id/remove` (`memberRemovePattern`) | all `member.manage` (then the rank rule) | members.ts |
| 56 | POST | `/api/members/:id/sign-out` (`memberSignOutPattern`) | all `member.manage` (then the rank rule) | members.ts |
| 57 | GET | `/api/invites` (`invites`) | all `member.read` | members.ts |
| 58 | POST | `/api/invites` (`invites`) | all `member.manage` (then `grantableRoles`) | members.ts |
| 59 | POST | `/api/invites/:id/cancel` (`inviteCancelPattern`) | all `member.manage` (then the rank rule) | members.ts |

Totals: `org.read` 22, `activity.read` 2, `member.read` 2, `content.write` 13, `content.delete` 5, `media.delete` 1, `screen.setup` 1, `screen.pair` 2, `push.publish` 1, publish all-of 1, any-with-refine 4, `member.manage` 5. `screen.details`, `screen.hours` and `screen.assign` are reached only through row 6 (and `screen.assign` through row 47).

Refine functions (`REFINES`), all pure and unit-tested with a hypothetical key set (`meetsKeys`, 6.2), because under 1.3 no real role holds one candidate key without the other:

| Refine | In the preHandler | In the handler |
|---|---|---|
| `displayPatchFields` | `displayPatchKeys(Object.keys(body))` when the body is a plain object; unknown fields map to nothing (`.strict()` answers 400); `{}` gives `[]` (400 follows); not an object gives null (stay any-of, 400 follows) | nothing more |
| `tagScopeFromBody` | `scope` `'media'` → `[content.write]`, `'display'` → `[screen.setup]`; anything else → null (400 follows) | nothing more |
| `tagScopeFromRow` | null (stay any-of) | PATCH: new first read `SELECT scope FROM tag WHERE id = $1 AND org_id = app_org_id() FOR UPDATE` (404 when none), then `requirePermission(role, { all: [tagScopeKey(scope, 'write')] })`. DELETE: after the existing locked read (`tags.ts:233-239`), `requirePermission(role, { all: [tagScopeKey(row.scope, 'delete')] })` |

```ts
/** PATCH /api/displays/:id field → key. `satisfies` makes a new DisplayPatch field a compile error until it is mapped. */
export const DISPLAY_PATCH_KEYS = {
  name: 'screen.details', description: 'screen.details', tagIds: 'screen.details',
  workingHours: 'screen.hours',
  canvas: 'screen.setup', contentRect: 'screen.setup', defaultFit: 'screen.setup', rotation: 'screen.setup',
  assignedPlaylistId: 'screen.assign', assignedScheduleId: 'screen.assign', assignedLayoutId: 'screen.assign',
} as const satisfies { readonly [K in keyof DisplayPatch]-?: PermissionKey };
export function displayPatchKeys(fields: Iterable<string>): PermissionKey[];   // unique, PERMISSION_KEYS order
/** media: write → content.write, delete → content.delete; display: both → screen.setup. */
export function tagScopeKey(scope: TagScope, action: 'write' | 'delete'): PermissionKey;
```

`DisplayPatch` is `z.infer<typeof DisplayPatchSchema>` (`packages/contracts/src/display.ts:168-194`); its keys are the 11 fields, so the `satisfies` clause is exhaustive without touching contracts.

### 6.2 The guard, the startup check, HEAD (`apps/api/src/auth/permissions.ts`, new)

```ts
export type RefineName = 'displayPatchFields' | 'tagScopeFromBody' | 'tagScopeFromRow';
export type RouteRule =
  | { readonly all: readonly PermissionKey[] }
  | { readonly any: readonly PermissionKey[]; readonly refine: RefineName };
export type Requirement = { readonly all: readonly PermissionKey[] } | { readonly any: readonly PermissionKey[] };

export const ROUTE_PERMISSIONS: Readonly<Record<string, RouteRule>>;
/** `${METHOD} ${pattern}`, with HEAD read as GET (Fastify registers a HEAD twin of every GET). */
export function routeKey(method: string, pattern: string): string;
export function parseRole(value: string): Role | null;            // RoleSchema.safeParse
/** The test of a requirement against a key set; `meets` calls it with `ROLE_PERMISSIONS[role]`. */
export function meetsKeys(held: ReadonlySet<PermissionKey>, required: Requirement): boolean;
export function meets(role: Role, required: Requirement): boolean;
/** Problems with the table against the registered routes (empty = fine). Pure; unit-tested. */
export function checkRouteTable(registered: ReadonlySet<string>, table?: Readonly<Record<string, RouteRule>>): string[];
export function createRouteCheck(): { onRoute(route: RouteOptions): void; assertComplete(): void };
export function permissionGuard(ctx: AppContext): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
/** Moved here from media.ts:183-189 (media.ts imports it): ends a request whose body is still arriving. */
export function abandonBody(request: FastifyRequest, reply: FastifyReply): void;
```

`declare module 'fastify'` in this file (not in `auth/session.ts`, which no package owns): `interface FastifyRequest { permission: { readonly required: Requirement } | null }`; `app.decorateRequest('permission', null)` after `app.ts:56`.

`apps/api/src/app.ts` operator plugin (`:101-120`) becomes:
```ts
const routeCheck = createRouteCheck();
await app.register(async (api) => {
  api.addHook('onRoute', routeCheck.onRoute);      // before any register*: sees exactly the operator routes
  api.addHook('preHandler', requireOperator(ctx)); // unchanged, first
  api.addHook('preHandler', permissionGuard(ctx)); // new, second
  api.addHook('onSend', /* unchanged */);
  registerDisplayRoutes(api, ctx);
  /* … unchanged … */
  registerAuditRoutes(api, ctx);
  registerMemberRoutes(api, ctx);                  // new, routes/members.ts
});
routeCheck.assertComplete();                       // throws: buildApp rejects, main.ts:119-121 exits
```
- `onRoute` sees 85 registrations: 59 plus 26 automatic HEAD twins. `route.method` may be a string or an array; handle both. Login, callback, session and logout are on the root and need no entry.
- `checkRouteTable` reports: a registered route with no entry; an entry with no registered route (stale or mistyped); an `any` entry whose refine is not in `REFINES` (also a type error).

`permissionGuard(ctx)` (preHandler, after `requireOperator`):
1. `session = operatorOf(request)`; `rule = ROUTE_PERMISSIONS[routeKey(request.method, request.routeOptions.url ?? '')]`. No rule: log an error and refuse (fail closed; the startup check makes it unreachable).
2. `role = parseRole(session.role)`. Null (unknown value): refuse.
3. `all` rule: required `{ all: rule.all }`, allowed when every key holds.
4. `any` rule: refuse unless one key holds; then `keys = REFINES[rule.refine](request.body)`; required = `keys === null ? { any: rule.any } : { all: keys }`; refuse unless it is met.
5. Allowed: `request.permission = { required }`.
6. Refused: `keys` is the requirement that failed: the refine's keys when it returned some and they are not met; otherwise `rule.all` or `rule.any` (an unknown role, no candidate key held, or a refine that gave null). For unsafe methods, `await recordPermissionDenied(ctx, request, session, { keys, reason: 'role', always: false })` (6.4). A refused `POST /api/media` calls `abandonBody(request, reply)`. Then `throw forbidden()`. Refused reads are not audited.

The body is parsed (not validated) before preHandlers, so refines read it; a multipart upload is not consumed yet, so a Viewer's upload is refused before any byte reaches storage, and `abandonBody` closes the connection as the route's own early refusals do (`media.ts:222`, `:248`). An owner sending no body to any write passes the guard (`session-csrf.test.ts:288-291` still holds).

### 6.3 The check inside every write

```ts
export const forbidden = (): HttpError => new HttpError(403, 'forbidden', "Your role doesn't allow this.");

/** A refusal by role found inside a transaction or by a people-route rule. Carries what the audit row needs. */
export class PermissionDeniedError extends HttpError { readonly record: DenialRecord }  // 403 forbidden, same message

/** Throws PermissionDeniedError unless the role meets the requirement. */
export function requirePermission(role: Role, required: Requirement, reason?: DenialReason): void;

/**
 * First statement of every write transaction: re-reads the member row FOR SHARE (it waits for a
 * member change that is committing) with membershipForCheck(tx, id, session.createdAt), and
 * checks the role against the requirement the guard resolved. Returns the role it read.
 * Removed, gone or cut off (the session's sessions were ended): 401. Role lacks the keys: 403
 * (reason 'role_changed').
 */
export async function assertStillAllowed(tx: Tx, session: OperatorSession, required: Requirement): Promise<Role>;

/**
 * withOrg for writes: [lockOrgMembership when lockMembership] → assertStillAllowed → fn(tx, role).
 * A PermissionDeniedError thrown anywhere inside rolls back, is recorded with
 * recordPermissionDenied in its own transaction, and is rethrown. A lock timeout (55P03)
 * raised anywhere inside (membership lock, actor row, target row, any other lock) becomes
 * 503 service_unavailable with retry-after 2.
 */
export async function withOrgAllowed<T>(
  ctx: AppContext, request: FastifyRequest,
  fn: (tx: Tx, role: Role) => Promise<T>,
  options?: { readonly required?: Requirement; readonly lockMembership?: boolean },
): Promise<T>;
/** The same around withOrgDecision (commits a refusal's trace, then throws it). */
export async function withOrgDecisionAllowed<T>(
  ctx: AppContext, request: FastifyRequest,
  fn: (tx: Tx, role: Role) => Promise<Decision<T>>,
  options?: { readonly required?: Requirement; readonly lockMembership?: boolean },
): Promise<T>;
```
`required` defaults to `request.permission.required`; a missing one throws (a route outside the guard). All of this block lives in `apps/api/src/auth/permissions.ts` (WP3), not in `errors.ts` or `db-helpers.ts`, which no package owns. It is in `apps/api` because it needs `can` and `HttpError`; `packages/db` cannot import domain.

The 28 write transactions, each changed from `withOrg`/`withOrgDecision` to the wrapper, with nothing before it in the transaction:

| File:line | Route | Wrapper | Note |
|---|---|---|---|
| displays.ts:369 | POST /api/displays | `withOrgAllowed` | |
| displays.ts:431 | PATCH /api/displays/:id | `withOrgAllowed` | requirement from `displayPatchFields` |
| displays.ts:593 | POST …/claim | `withOrgDecisionAllowed` | before `pairingClaim`, so a refused member counts no wrong code |
| displays.ts:666 | POST …/revoke-player | `withOrgAllowed` | the comment at `:667-670` becomes "After the role check, the claims are cancelled first, before the display row is locked (round 3, SCX-01)" |
| media.ts:297 | POST /api/media (insert) | `withOrgDecisionAllowed` | before the quota lock `:299`; a throw discards the stored file through `:349-357` |
| media.ts:393 | PATCH /api/media/:id | `withOrgAllowed` | |
| media.ts:611 | DELETE /api/media/:id | `withOrgAllowed` | |
| apps.ts:87, :131, :179 | POST, PATCH, DELETE apps | `withOrgAllowed` | |
| schedules.ts:255, :284, :301 | POST, PUT, DELETE schedules | `withOrgAllowed` | `saveSchedule` keeps its signature |
| layouts.ts:216, :243, :260 | POST, PUT, DELETE layouts | `withOrgAllowed` | `saveLayout` keeps its signature |
| playlists.ts:232, :274, :373, :441 | POST, PUT, duplicate, DELETE | `withOrgAllowed` | |
| playlists.ts:547 | POST …/publish | `withOrgDecisionAllowed` inside `attempt()` | runs in each attempt, before `lockPublishKey` `:551` |
| tags.ts:154 | POST /api/tags | `withOrgAllowed` | before the tag-count lock `:156` |
| tags.ts:202 | PATCH /api/tags/:id | `withOrgAllowed` | then the scope read (6.1) |
| tags.ts:232 | DELETE /api/tags/:id | `withOrgAllowed` | then the scope check on `row.scope` |
| folders.ts:77, :124, :153 | POST, PATCH, DELETE folders | `withOrgAllowed` | |
| push.ts:92 | POST /api/push, each screen | `withOrgAllowed` | `pushDisplay(request, session, displayId, key)`; before `lockPublishKey` `:93`, so a demoted member's replay of the same key is refused too |

Left as they are (no content change): `media.ts:165` (`auditUpload`, audit only), `media.ts:219` (quota read before streaming), `push.ts:168` (id check), `auth/session.ts:90` (CSRF audit), `media/pipeline.ts:558, 633, 686` (background validation, actor `system`; an upload committed under a valid role is still validated after a demotion).

A push refused part-way (the role was lowered during the loop at `push.ts:179-199`) answers 403 with no `results`; screens already pushed stay pushed, and their `publication.create` rows record it. `pushDisplay`'s 403 is not a pg error, so the loop's `else throw error` (`:196-198`) rethrows it. Documented, not caught (`// shortcut: a push refused part-way answers 403 without the results so far; return per-screen results with a 'refused' outcome if people ask what happened`).

### 6.4 `security.permission_denied` (`apps/api/src/auth/permission-audit.ts`, new)

```ts
export type DenialReason = 'role' | 'role_changed' | 'rank' | 'self' | 'grant' | 'last_owner' | 'not_signed_in';
export interface DenialRecord {
  readonly keys: readonly PermissionKey[];
  readonly reason: DenialReason;
  /** Refused member and invite changes are always written; route refusals are throttled per member. */
  readonly always: boolean;
  readonly object?: { readonly type: 'membership' | 'invite'; readonly id: string };
}
export const PERMISSION_DENIALS_PER_WINDOW = 20;
export const PERMISSION_DENIAL_WINDOW_MS = 10 * 60 * 1000;
export async function recordPermissionDenied(ctx: AppContext, request: FastifyRequest, session: OperatorSession, record: DenialRecord): Promise<void>;
```
- Copies `recordCsrfRejection` (`auth/session.ts:83-104`): its own `withOrg(ctx.pool, session.orgId, …)`, `auditScoped`, `actorType 'operator'`, `actorId session.membershipId`, `result 'denied'`; a failure is logged and swallowed. Unsafe methods only.
- Object: `record.object` when given, else `objectType 'route'`, `objectId` `` `${request.method} ${request.routeOptions.url}` `` (under 100 characters).
- Detail: `{ permission: record.keys, method, route, reason }`, plus `refusalsInWindow` and `throttled` for throttled rows.
- Throttle, the B6 pattern as it works (`routes/player.ts:124-187`): one `AuthFailureGuard` (`auth/failure-guard.ts`) per `AppContext`, kept in a module `WeakMap<AppContext, AuthFailureGuard>` (no `AppContext` change), built with `maxFailures: Math.ceil(PERMISSION_DENIALS_PER_WINDOW * (ctx.rateLimitScale ?? 1))`, `windowMs: PERMISSION_DENIAL_WINDOW_MS`, `now: () => ctx.now().getTime()`. Key: `recordFailure(session.membershipId, '')` (`clientKeyOf` returns a non-IP string unchanged, `failure-guard.ts:49`). A row is written when `first` or `crossedLimit`: at most two rows per member per window, the second saying how many. `always` writes every time and still counts.
- Callers: the guard (route refusal, `always: false`); `withOrgAllowed` on a `PermissionDeniedError` (its `record`); the people routes after their transaction for `last_owner` (PATCH, remove) and `not_signed_in` (PATCH) (the 409 leaves the wrapper, then `recordPermissionDenied(… { keys: ['member.manage'], reason, always: true, object })`, 6.7). A 401 inside a write (removed or signed out) is not recorded (the removal or sign-out is).
- Category `security` needs `audit.read`, so Editors and Viewers never see their own refusals. Intended.

### 6.5 Session and sign-in

**`apps/api/src/auth/oidc.ts`:**
- `VerifiedIdentity` (`:15-23`) gains `readonly authTime: number | null` (seconds since the epoch): `typeof claims.auth_time === 'number' ? claims.auth_time : null` (oauth4webapi `IDToken.auth_time`, verified with the token).
- `IdentityProvider.beginLogin(options?: { readonly reauthenticate?: boolean }): Promise<AuthorizationRequest>`. With `reauthenticate`, `buildAuthorizationUrl` (`:117-132`) gets `prompt: 'login'`. No `max_age` (it would oblige `maxAge` on the token exchange).
- Stubs that implement the interface: `apps/api/test/support.ts:61-69` (`noIdentityProvider`, signature only), `tests/integration/credential-audit.test.ts:222-235` (`authTime: null`).

**`apps/api/src/routes/auth.ts`:**
- `loginStateKey(ctx, preAuth, state, kind: 'normal' | 'reauth')`: the HMAC label is `login-state\n` for normal and `login-state-reauth\n` for a forced re-login. This is the loop guard; the `login_state` table and its functions do not change.
- `GET /api/auth/login`: unchanged (kind `normal`).
- `GET /api/auth/callback`, after the state checks (`:110-121`):
  1. `reauthStored = loginStateTake(unscoped, key 'reauth')`; `stored = reauthStored ?? loginStateTake(unscoped, key 'normal')`; `forced = reauthStored !== null`. Null: unchanged `state` failure.
  2. `sessionCreate(tx, { …, authTime: identity.authTime === null ? null : new Date(identity.authTime * 1000) })` runs first in the existing `withResolvedOrg` (`:186-224`); the rotation (`sessionRevoke(previous)`, today `:187-189`, before the create) moves after it and still commits in every outcome. A sign-in then takes the member row before any session row, the order a member change uses (6.8); the old order deadlocks (40P01) with a removal, demotion or sign-out of the member whose idle session cookie the browser still sends. A lock timeout (55P03) from this transaction → `failureRedirect(ctx, reply, 'provider_unavailable')`.
  3. `no_membership`: unchanged (`:197-208`, `:225-228`). A removed member lands here.
  4. `reauth`: `enterOrg(orgId)`; `auditScoped` `auth.login`, `actorType 'operator'`, `actorId membershipId`, `objectType 'membership'`, `result 'denied'`, `detail { reason: forced ? 'reauth_failed' : 'reauth_required' }`. After the transaction: clear the session cookie. If `forced`: `failureRedirect(ctx, reply, 'reauth_failed')`. Otherwise: `begin = await ctx.idp.beginLogin({ reauthenticate: true })` (error → `provider_unavailable`), new `preAuth`, `loginStatePut` with the `reauth` key and the same `stored.returnTo`, set the pre-auth cookie (it replaces the clear made at `:108` in the same reply: `@fastify/cookie` keeps one Set-Cookie per name, domain and path, `node_modules/@fastify/cookie/index.js:48`), 303 to `begin.url`.
  5. `created`: unchanged (`:209-235`).
- `AuthErrorCode` comes from contracts (adds `reauth_failed`).
- `GET /api/session` (`:239-252`):
  ```ts
  const role = parseRole(session.role);
  if (role === null) { request.log.error('session with an unknown role'); return { authenticated: false }; }
  const name = await withOrg(ctx.pool, session.orgId, (tx) => tx.query<{ display_name: string | null }>(
    'SELECT display_name FROM membership WHERE id = $1 AND org_id = app_org_id()', [session.membershipId]));
  return { authenticated: true,
    // The name TINNOX recorded for the member (provision-member); no e-mail address is stored (D3 a).
    user: { membershipId: session.membershipId, displayName: name.rows[0]?.display_name ?? null, role, permissions: permissionsOf(role) },
    organization: …, csrfToken: …, expiresAt: …, limits: … };
  ```
  Each call records activity (`sec.session_by_id_hash` bumps `last_seen_at`), so the portal's focus refresh counts as activity; it is throttled to once per 10 s (7.1).

### 6.6 `GET /api/audit` (`routes/audit.ts:33-80`)

Before building the query: `const fullLog = can(role, 'audit.read')` with `role = parseRole(session.role)` (the guard already refused an unknown role).
- Without `audit.read` and a `category` outside `ACTIVITY_CATEGORIES`: return `{ items: [], nextBefore: null }` (200) without a query.
- Without `audit.read` and no `category`: add `` `category = ANY(${parameter([...ACTIVITY_CATEGORIES])}::text[])` `` (plain column comparison, leakproof under RLS, 0005:264-274).
- Otherwise unchanged. Paging stays correct: the filter is in the same WHERE.
- `// shortcut: the activity filter is per category; split by action if pairing.lock must leave the Editors' view`.

### 6.7 People routes (`apps/api/src/routes/members.ts`, new; `registerMemberRoutes(api, ctx)`)

Template for list, row menu and refusals: `routes/tags.ts`. Every write: `withOrgAllowed(ctx, request, fn, { lockMembership: true })`, so the order is always membership lock → actor row `FOR SHARE` (role re-read) → target row → change → audit, all on one `Tx`. The global rate limit applies; writes add `perMinute(ctx, 30)`.

Shared steps of the three member writes (PATCH, remove, sign-out), after the wrapper's two:
1. `SELECT id, role, display_name, removed_at, first_signed_in_at FROM membership WHERE id = $1 AND org_id = app_org_id() FOR NO KEY UPDATE` (lower-cased id). None → 404 `notFound('The person')`. `removed_at` set → 409 `conflict` "This person was removed. Invite them again to bring them back."
2. `target.id === session.membershipId` → `PermissionDeniedError` reason `self`, object the target.
3. `!canManage(role, target.role)` → reason `rank`.

**GET /api/members** (`withOrg`): `SELECT id, display_name, role, first_signed_in_at, removed_at FROM membership WHERE org_id = app_org_id() ORDER BY removed_at IS NOT NULL, lower(display_name) NULLS LAST, created_at, id` → `{ items: MemberDto[] }`. No e-mail exists to leak.

**GET /api/members/names** (`withOrg`): `SELECT id, display_name, removed_at IS NOT NULL AS removed, display_name_changed_at FROM membership WHERE org_id = app_org_id() ORDER BY id` → `{ items: MemberNameDto[] }` (`renamedAt` from `display_name_changed_at`).

**GET /api/invites** (`withOrg`): `SELECT id, name, email, role, invited_by, created_at, expires_at FROM member_invite WHERE org_id = app_org_id() AND status = 'pending' ORDER BY created_at, id` → `{ items: InviteDto[] }`. Expired but not yet closed by TINNOX's daily run are listed; the portal says "Expired".

**POST /api/invites** (`InviteCreateSchema`), 201 `InviteDto`:
1. `input.role` not in `grantableRoles(role, 'invite')` → `PermissionDeniedError` reason `grant`.
2. `SELECT count(*) FROM member_invite WHERE org_id = app_org_id() AND status = 'pending'` ≥ `ABSOLUTE.maxPendingInvites` → 409 `conflict` "The organisation already has 100 invites waiting for TINNOX. Cancel ones that are no longer needed."
3. Name taken by an active member (`lower(display_name) = lower($1) AND removed_at IS NULL`) or a pending invite → 409 `conflict` with `details [{ path: 'name', message: 'Another person in this organisation has this name.' }]`. A removed member's name is allowed here (a person who comes back keeps their row and name); `provision-member fulfil` reports a clash with another removed row.
4. A pending invite with the same `lower(email)` → 409 `conflict`, `details [{ path: 'email', message: 'An invite for this address is already waiting.' }]`.
5. `INSERT INTO member_invite (org_id, role, name, email, invited_by, expires_at) VALUES (app_org_id(), $1, $2, $3, $4, now() + interval '14 days') RETURNING …` (`$4` = `session.membershipId`).
6. `auditScoped` `invite.create`, `objectType 'invite'`, detail `{ role }`.
7. 23505 on `inviteEmailTaken` or `inviteNameTaken` (a race past steps 3 and 4) → the same 409s.

**POST /api/invites/:id/cancel**, 204:
1. `SELECT id, role, status FROM member_invite WHERE id = $1 AND org_id = app_org_id() FOR UPDATE`. None → 404 `notFound('The invite')`. Not `pending` → 409 `conflict` "This invite is no longer waiting. TINNOX may have just set the person up."
2. `!canManage(role, invite.role)` → reason `rank`, object the invite.
3. `UPDATE member_invite SET status = 'cancelled', closed_by = $2 WHERE id = $1 AND org_id = app_org_id()` (the guard clears name and e-mail and stamps `closed_at`).
4. `invite.cancel` detail `{ role, reason: 'cancelled' }`.

**PATCH /api/members/:id** (`MemberPatchSchema`), 200 `MemberChangeResponse`, after the shared steps:
1. Role named and different from `target.role`: not in `grantableRoles(role, 'change')` → reason `grant`. `'owner'` and `target.first_signed_in_at` null → 409 `conflict` "Only someone who has signed in at least once can be made an Owner." with `details [{ path: 'role', code: 'not_signed_in_yet', message }]`, recorded after the transaction with reason `not_signed_in` (always, 6.4).
2. One `UPDATE membership SET … WHERE id = $1 AND org_id = app_org_id()` setting only the named, changed columns (`role`, `display_name`). Nothing changed → no UPDATE, no audit, 200 with zero counts.
3. Demotion (`isDemotion`): `sessionsEnded = await sessionRevokeMembership(tx, id)`; then cancel the target's pending invites whose role is not in `grantableRoles(newRole, 'invite')`: `UPDATE member_invite SET status = 'cancelled' WHERE org_id = app_org_id() AND invited_by = $1 AND status = 'pending' AND NOT (role = ANY($2::text[])) RETURNING id, role`, one `invite.cancel` per row with `reason 'inviter_demoted'`, `actorType 'operator'`, `actorId session.membershipId` (the person whose change caused it); `closed_by` stays NULL.
4. Audits: `membership.role_change { from, to, sessionsEnded, invitesCancelled }` when the role changed; `membership.update { fields: ['displayName'] }` when the name changed.
5. Errors after the transaction: 23505 `memberNameTaken` → 409 `conflict` `details [{ path: 'displayName', message: 'Another person in this organisation has, or had, this name.' }]`; 23001 `lastOwner` → `recordPermissionDenied(… { keys: ['member.manage'], reason: 'last_owner', always: true, object })` then 409 `last_owner` "An organisation always keeps at least one Owner. Make someone else an Owner first." Under the lock order the trigger is a backstop; tests reach it through a fault-injecting pool (9).

**POST /api/members/:id/remove**, 200 `MemberChangeResponse`, after the shared steps:
1. `UPDATE membership SET removed_at = now(), removed_by = $2 WHERE id = $1 AND org_id = app_org_id()`.
2. `sessionsEnded = sessionRevokeMembership(tx, id)`.
3. Cancel all the target's pending invites (`reason 'inviter_removed'`; actor and `closed_by` as for a demotion).
4. `membership.remove { previousRole, sessionsEnded, invitesCancelled }`.
5. 23001 `lastOwner` as for PATCH.

**POST /api/members/:id/sign-out**, 200 `MemberSignOutResponse`, after the shared steps: `sessionsEnded = sessionRevokeMembership(tx, id)`; `membership.sessions_end { sessions: sessionsEnded }`. It also sets the cut-off, so the next sign-in asks for the password and one-time code.

Every refusal by these routes (`self`, `rank`, `grant`, `not_signed_in`, `last_owner`) is written with `always: true`.

### 6.8 Lock order (no cycle)

- Content write: actor `membership` row `FOR SHARE` → its own locks as today (display `FOR NO KEY UPDATE`, playlists `FOR SHARE`, pairing advisory locks, …). It never takes the membership advisory lock, another member's row or `member_invite`.
- Member change: membership advisory lock → actor row `FOR SHARE` → target row `FOR NO KEY UPDATE` → `session` rows (definer) → `member_invite` rows. It waits for the target's in-flight writes (their `FOR SHARE`), never the other way round. Two member changes serialise on the advisory lock first.
- Sign-in: own row `FOR NO KEY UPDATE` → `session` insert → previous session row (the rotation, 6.5). A member change on that row makes it wait and then re-read. Both take the member row before session rows.
- Pairing completion (`sec.pairing_complete`): pairing row `FOR UPDATE` → claimer's member row `FOR SHARE`. No member change locks pairing rows.
- Scripts (`provision-member`): membership advisory lock first, as the API (`pending` excepted, 8.2).

---

## 7. Portal (`apps/portal/src`; UI kit only; customers read "screen"; no inline style attribute)

One rule for controls: a control the role lacks is **hidden**, not disabled. "Disabled with a reason" only inside forms. The portal reads `session.user.permissions`, never role names, except for the rank rule on the Users page (`canManage`, `grantableRoles` on `session.user.role`, 7.4). Hiding is a convenience; the API enforces.

### 7.1 Session, client, guard pages, sign-in errors (WP5)

**`session/SessionContext.tsx`**
- `SessionState`'s `anonymous` variant (`:15-19`) gains `authError: AuthErrorCode | null`, filled once at load from `takeAuthError()` (below), next to `takeSignedOutMarker` (`:50-56`).
- The context value (`:21-25`) gains `refresh(): Promise<void>`, a **silent** reload: its own `AbortController`, a sequence number (latest call wins), `apiClient.loadSession(signal)`. It acts only while `authenticated`: an authenticated answer for the same `user.membershipId` and `organization.id` replaces the session object (the router stays mounted); an authenticated answer for another member or organisation (another tab signed in as someone else) calls `retry()` instead; an unauthenticated one moves to `{ status: 'anonymous', reason: 'ended', authError: null }`; any other failure (network, 5xx, 429, `aborted`, `invalid_response`) keeps the state. It never sets `loading` itself. `retry` (`:98-101`) stays for the error screen and that identity change only, because `Gate` (`App.tsx:173-185`) unmounts the router on `loading` and drafts would be lost.
- `SessionProvider` calls `refresh()` on `onForbidden` (new listener, below), on `window` `focus` and on `document` `visibilitychange` to visible (`PushProvider`'s visibility pattern, `features/push/PushContext.tsx:150-165`). Focus and visibility refresh at most once per `SESSION_REFRESH_MIN_MS = 10_000`, because each refresh records activity on the server (6.5). A forbidden notification always refreshes. A trigger that arrives while a refresh is in flight joins it, so a bulk action with many 403s loads the session once.
- `AuthenticatedContext`, `AuthenticatedProvider`, `useSession` (today `:126-143`) and the new hooks move to `session/AuthenticatedSession.tsx` (new), which imports nothing from `api/`; `SessionContext.tsx` re-exports them, so `AppShell.tsx` and other untouched importers keep working. Every file this build touches imports them from the new file. Reason: component tests mock `api/index.ts` with only `{ api }` (`ScreensList.test.tsx:16`, `ContentCard.test.tsx:13`, `LibraryCard.test.tsx:14`), and Vitest's browser mocker exports only the factory's keys (`node_modules/@vitest/mocker/dist/browser.js:31-33`). Reaching `SessionContext.tsx` (`:11` imports `apiClient` and `onUnauthenticated`) through `PushContext.tsx`, a gated component or the `features/shared/index.ts` barrel would fail those files at module link (unverified pending runtime).
  ```ts
  /** True when the signed-in member's role grants `key` now. Only below AuthenticatedProvider. */
  export function useCan(key: PermissionKey): boolean;
  /** useCan frozen at the first render: an editor decides read-only once, when it mounts. */
  export function useCanAtMount(key: PermissionKey): boolean;
  ```
- Never called from `src/ui/*` (the kit has no session). Pure helpers in `lib/` take booleans.

**`session/session.test-support.tsx` (new, imports from `AuthenticatedSession.tsx`):** `sessionFor(role: Role, overrides?: Partial<AuthenticatedSession>): AuthenticatedSession` (permissions from `permissionsOf`, `displayName` `'Test person'`, a fixed membership id) and `WithSession({ role, children })` around `AuthenticatedProvider`. Every component test that renders a gated component uses it (`vitest.config.ts:33` picks only `*.test.tsx`, so the file is not run).

**API client**
- `api/client.ts`: `ApiClientDeps` (`:132-136`) gains optional `onForbidden?: () => void`. `sendWithRecovery` (`:236-259`): after a response error with `status === 403 && code === 'forbidden' && fromApi`, call `deps.onForbidden?.()`, then rethrow. `csrf_failed` and `origin_not_allowed` (also 403) never call it. The same 401 and forbidden handling applies to the error of the retried `send` after `csrf_failed` (`:250-256`, today it escapes unhandled). `ApiClient` gains `notifyForbidden(): void`.
- `api/index.ts` (`:7-20`): `onForbidden(listener): () => void`, a listener set like `onUnauthenticated`, passed to `createApiClient`.
- `api/upload.ts` (`:70-84`): a 403 `forbidden` calls `client.notifyForbidden()` next to the 401 branch; the queue item shows the API message.
- `features/media/library/useUploadQueue.ts` (`:64-103`): on a `forbidden` failure, the remaining queued entries are marked failed with the same error instead of being sent one by one.
- `ui/ErrorNotice.tsx` (`:23-62`): no "Try again" button when `error.code === 'forbidden'`. The API message is "Your role doesn't allow this.", so every existing error surface already prints the decided wording.

**Sign-in errors**
- `lib/authError.ts` (new): `takeAuthError(): AuthErrorCode | null` (reads `authError` from `window.location.search`, removes it with `history.replaceState`, ignores unknown values) and `authErrorMessage(code: AuthErrorCode): string`:

  | Code | Message |
  |---|---|
  | `no_membership` | This sign-in account has no access to TINNOX CMS. If you were removed, or have not been set up yet, ask the Owner or an Admin of your organisation. |
  | `reauth_failed` | Sign in again with your password and one-time code. If this keeps happening, contact TINNOX support. |
  | `mfa_required` | Your sign-in did not include a one-time code. Sign in again. |
  | `state` | The sign-in took too long or was started in another tab. Sign in again. |
  | `provider` | The sign-in service did not accept the sign-in. Sign in again. |
  | `provider_unavailable` | The sign-in service is not responding. Try again in a few minutes. |

- `shell/Screens.tsx`: `SignInScreen` (`:20-53`) heading "Operator sign-in" (`:26`) becomes "Sign in to TINNOX CMS"; above the button, `Banner tone="danger"` with `authErrorMessage(authError)` when set.

**Guard pages**
- `shell/ForbiddenPage.tsx` (new), modelled on `shell/NotFoundPage.tsx:7-23`: `Page` titled "Your role doesn't allow this", `EmptyState` text "Ask the Owner or an Admin of your organisation if you need this.", `ButtonLink` "Go to dashboard" to `HOME_PATH`.
- `shell/RequirePermission.tsx` (new): `({ permission, children }) => useCan(permission) ? children : <ForbiddenPage />`.
- `App.tsx`: `page('screens/new', …)` (`:155`) inside `RequirePermission permission="screen.setup"`; `page('users', …)` (`:138`) becomes `const users = () => import('./features/users/UsersPage.tsx')` with `(m) => <m.UsersPage />` inside `RequirePermission permission="member.read"`. `/screens/:id/edit` (`:88-92`) only redirects to the Canvas tab, which is read-only without `screen.setup`: no guard.

**Shell and Settings**
- `shell/AccountMenu.tsx`: `ROLE_LABEL` (`:7`) is replaced by `ROLE_LABELS` from `@tinnox/domain`. The name (`:28`) is `displayName ?? ROLE_LABELS[role]` (initials from the same). The `ACCOUNT_NAV` map (`:64-73`) skips items whose `permission` the session lacks.
- `shell/nav.ts`: `NavLinkItem` (`:32-42`) gains `permission?: PermissionKey`; Users (`:107`) gets `permission: 'member.read'` and loses `planned: true`. `nav.ts` stays free of React; the filter is in `AccountMenu`.
- `features/planned/PlannedPage.tsx`: `users` leaves the `PlannedSection` union (`:6`), the map (`:37-42`) and the icon import (`:3`).
- `features/styleguide/SurfaceSections.tsx:202-203`: the sample planned section becomes "Audio is planned" / "Audio files will be added and played here in a later stage."
- `lib/settingsView.ts`: `'users'` leaves `PlannedSettingId` (`:165`) and `PLANNED_SETTINGS` (`:175-181`; its "choose what an owner … may do" text goes with it).
- `features/settings/SettingsPage.tsx`: `PLANNED_ICONS.users` (`:129-134`) goes. A "People" group before "Security", only with `useCan('member.read')`: `SettingsRow icon={Users} title="Users" description="People in this organisation, their roles and invites waiting for TINNOX." to="/users" testId="settings-row-users"`, value "N people" from `api.listMembers()` (active members), loaded only when allowed. The "Audit log" row (`:214-221`) reads "Content and screen events in this organisation." without `audit.read`.

### 7.2 Push entry points and list pages (WP5)

`features/push/PushContext.tsx` (`:172-182`): `openDialog` and `openPush` return early without `push.publish`. `PushDialog` stays rendered as today; it opens only through `openDialog`. If the key is lost while it is open, it stays open until the person closes it, so its refusal shows and `close()` clears `dialogOpen` (`:184-187`; unmounting it instead would leave `dialogOpen` set and stop the plan poll and later openings). The plan poll (`GET /api/push`, `org.read`) keeps running for everyone; it feeds the waiting count.

`lib/pushDialog.ts`: `PushFailureKind` gains `'role'`; `classifyPushFailure` (`:214-219`) returns it for a 403 `forbidden` (today any 403 is `refused`, "Nothing was pushed"). `PushDialog.tsx` `AttemptError` (`:452-469`) titles it "Your role changed during the push" with "Screens pushed before the change keep their new version. The others were not pushed." It never says "Nothing was pushed" for this kind, and offers no retry (`lib/pushDialog.ts:360` retries `unknown` only).

Every control below is in a WP5 file. "Hidden" also means: a row menu left with only "Open" or "Edit" becomes no menu (`rowActions`/`actions` `undefined`; the name cell is the link), and selection checkboxes go when no bulk action is left (`selection={undefined}`, no `SelectionBar`).

| Surface | File:line | Key | Without the key |
|---|---|---|---|
| Header "Push to screens" | `shell/PushButton.tsx:14-32` (rendered by `shell/Page.tsx:45`) | push.publish | A chip "N screens waiting" (`N screen waiting` for 1) linking to `/dashboard`; nothing while the count is null or 0 |
| Dashboard "Review and push" / "Review screens" | `features/dashboard/PushCard.tsx:33-46` | push.publish | Hidden; the list (`:56`, `PushSummary :61-132`) stays. The description (`:31`) comes from `pushOverview(plan, limit = 3, canPush = true)` (`lib/dashboard.ts:364`, new optional third parameter): without the key its texts (`:377`, `:386`, `:391`) say "until an editor pushes", and the no-screens text reads "An editor adds screens and assigns content. Changes then wait here until an editor pushes." |
| Dashboard "Get set up" card | `features/dashboard/DashboardPage.tsx:107` | screen.setup | Card hidden |
| Set-up step actions | `lib/dashboard.ts:263-324` (rendered `features/dashboard/SetupCard.tsx:87-98`) | step 1 screen.setup (`:284`), step 2 screen.pair (`:294-297`), step 3 content.write (`:305`), step 4 push.publish (`:268-275`; its "Create a playlist" / "Open playlists" links content.write) | `setupProgress(input, can: { setup, pair, write, push } = all true)` (new optional second parameter, booleans; the nine one-argument calls in `lib/dashboard.test.ts` stay) returns `action: null`; step 4 without `push.publish` reads "An editor or admin pushes" |
| Media "Add media" | `features/media/library/MediaLibrary.tsx:363-375` (used `:534`) | content.write | Hidden |
| Media empty states "No media / images / videos yet" | `MediaLibrary.tsx:395-414` | content.write | No button; text "An editor adds media." (no drop hint) |
| Media `folder_empty` body "…use Move to folder…" | `MediaLibrary.tsx:432-434` | content.write | Body omitted; the title "No … in this folder" stays |
| Drop files on the media page | `MediaLibrary.tsx:180` (`useFileDrop(openAdd)`), overlay `:763-773` | content.write | The hook **stays mounted** with a handler that ignores the files (it calls `preventDefault`, `useFileDrop.ts:41-48`, so the browser does not open the file); overlay hidden |
| Media row/tile menu | `features/media/library/MediaRowMenu.tsx:16-78` | Add to playlist `:40-49` content.write; Move to folder `:50-57` content.write; Edit tags `:58-65` content.write; Delete `:66-75` media.delete | Items hidden; Open only → no menu |
| Media selection and bulk bar | `MediaLibrary.tsx:664-669`, `:703-710`, `SelectionBar :719-760` | Move `:726-736` content.write; Add tags `:737-747` content.write; Delete `:748-759` media.delete | Items hidden; selection off when none left |
| Folder chips | `features/media/library/FolderChips.tsx` | New folder `:79-90` content.write; Rename `:227-234` content.write; Delete `:236-244` content.delete | `onCreate`, `onRename`, `onDelete` (`:39-41`) become optional; absent → control hidden |
| Inline tag creation | `features/shared/TagChecklist.tsx:75-118`, `:239-330`; `TagPicker.tsx:121-131`; `TagsDialog.tsx:256-265` | media scope content.write; display scope screen.setup | New prop `allowCreate?: boolean` (default true) on all three. False sets `offerCreate` (`TagChecklist.tsx:75`) to false, so there is no "Create tag" option and no Enter path to `create()` (`:135`), and the label and placeholder (`:148-149`) read "Search tags". Callers pass it (WP5 lists, WP6 editors) |
| Inline folder creation | `features/shared/FolderSelect.tsx:18,44,96` (has `allowCreate`); `features/shared/MoveToFolderDialog.tsx:330` (`NewFolderForm`) | content.write | `MoveToFolderDialog` gains `allowCreate?: boolean`; callers pass `useCan('content.write')` |
| Screen picker "Add screen" | `features/shared/ScreenPickerDialog.tsx:241-243` | screen.setup | Text "An editor adds screens." |
| Push dialog "Add screen" | `features/push/PushDialog.tsx:345` | screen.setup | Text "An editor adds screens." |
| Apps "Create app" and empty state | `features/apps/AppsPage.tsx:158-170` (used `:212`, `:258`) | content.write | Hidden; empty text "An editor creates apps." |
| Apps row menu Delete | `AppsPage.tsx:146-154` | content.delete | Hidden; Edit only → no menu |
| Playlists "New playlist" and empty state | `features/playlists/PlaylistsPage.tsx:309-321` (used `:412`, `:437`) | content.write | Hidden; empty text "An editor creates playlists." |
| Playlist row menu | `features/playlists/list/PlaylistRowMenu.tsx:15-66` | Assign to screens `:37-44` screen.assign; Duplicate `:45-53` content.write; Delete `:55-63` content.delete | Items hidden |
| Playlists selection and bulk Delete | `PlaylistsPage.tsx:522-527`, `:562-563`, `:578-597` | content.delete | Hidden; selection off |
| Assign to screens result "Push now" / "Open Push to screens" | `features/playlists/list/AssignToScreens.tsx:87-90`, `:151-164` | push.publish | Hidden |
| Schedules "Create schedule" and empty state | `features/schedules/SchedulesPage.tsx:179-191` (used `:237`, `:267`) | content.write | Hidden; empty text "An editor creates schedules." |
| Schedules row menu Delete | `SchedulesPage.tsx:167-175` | content.delete | Hidden |
| Layouts "Create layout" and empty state | `features/layouts/LayoutsPage.tsx:174-186` (used `:228`, `:258`) | content.write | Hidden; empty text "An editor creates layouts." |
| Layouts row menu Delete | `LayoutsPage.tsx:162-170` | content.delete | Hidden |
| Screens "Add screen" | `features/displays/list/ScreensList.tsx:620-631` | screen.setup | Hidden |
| Screens empty state | `ScreensList.tsx:536-560` | screen.setup | No button; text "An editor adds screens." |
| Screen row menu | `features/displays/list/ScreenRowMenu.tsx:20-80` | Assign content `:38-45` screen.assign; Push now `:46-55` push.publish; Edit tags `:56-63` screen.details; Revoke player `:64-77` screen.pair | Items hidden; Open only → no menu |
| Screens selection and bulk bar | `ScreensList.tsx:808-813`, `:845-852`, `:866-906` | Assign `:873-883` screen.assign; Add tags `:884-894` screen.details; Push `:895-905` push.publish | Items hidden; selection off |
| Screens tags dialog | `ScreensList.tsx:946-955` | create: screen.setup | `allowCreate={useCan('screen.setup')}` |
| Settings tag pages | `features/settings/TagsPage.tsx` | media: New tag `:125-135` (used `:265`, `:288`), Rename `:202-209`, Change colour `:210-217` content.write; Delete `:224-232` content.delete. display: all screen.setup. "Show files" `:218-222` stays | Hidden per scope; empty text "An editor adds tags." |

### 7.3 Read-only editors and the screen page (WP6)

Rules for every editor below:
- `const readOnly = !useCanAtMount(key)`, decided once at mount. A demotion through the Users page ends the person's sessions: the next request answers 401 and the portal shows "Your session has ended"; unsaved edits are lost. A 403 on save happens only when the role changed between the guard and the write (`assertStillAllowed`, for example a script demotion): the "Your role doesn't allow this." message without "Try again", and a silent session refresh; the editor stays as it was.
- `const locked = saving || readOnly` wherever the editor already locks on `saving` (`readOnly` on text inputs, `disabled` on selects, steppers, pickers, switches; `if (locked) return` in change handlers).
- **No path saves:** every submit handler starts `if (readOnly || saving) return;` after `event.preventDefault()`; every explicit Enter-to-save handler returns early when read-only (`MediaDetailForm.tsx:111` `submitOnEnter`, wired at `:202`). Implicit submission (Enter in a single text field) therefore does nothing.
- No `actions` and no `status` passed to `shell/EditorPage.tsx` (`:47-53`, both optional): no save bar, no "Unsaved changes". `useLeaveGuard(dirty && !readOnly, …)`.
- Delete menus, add, move and remove buttons, drag handles and drop zones hidden.
- One line, `features/shared/ReadOnlyNote.tsx` (new): `({ children }) => <Banner tone="info">{children}</Banner>`, first in the page body. Imported by its file path, not through `features/shared/index.ts` (no package owns the barrel).
- `ui/Segmented.tsx` gains a group `disabled?: boolean` prop (`:16-27`).

| Editor | Files | Key | Note text | Also |
|---|---|---|---|---|
| Media detail | `features/media/detail/MediaEditor.tsx` (actions `:179-208`, guard `:88`, outer form `:223`), `MediaDetailForm.tsx` (new `readOnly` prop; `:127-131`, `:111`, `:202`; Delete section `:342-357` media.delete; `FolderSelect allowCreate` `:317`; `TagPicker allowCreate` `:332`), `MediaDetailsCard.tsx` ("Add to playlist" `:311-319` content.write; `onAddToPlaylist` `:261` optional), `MediaPendingView.tsx` ("Delete file" `:63-70` media.delete) | content.write | You can view this file. Editors make changes. | Delete stays for `media.delete` holders even read-only |
| App | `features/apps/AppEditor.tsx` (guard `:120`, header `:471-523`, Delete menu `:502-522` content.delete, form `:588-592`) | content.write | You can view this app. Editors make changes. | "Preview on" (`:542-558`) stays enabled |
| Playlist | `features/playlists/editor/PlaylistEditor.tsx` (guard `:105`, header `:247-274`, `LibraryCard` `:334-341` not rendered read-only), `SequenceCard.tsx` (drop handlers `:205`, `:220`, `:227` off; empty text `:348-351` "This playlist is empty."; hint `:388-392` hidden), `SequenceTile.tsx` (handle `:96-101`, `Stepper` `:144-157` disabled, Fit menu `:171-203`, buttons `:210-243` hidden), `DetailsCard.tsx` (`TextInput :59-71`, `Textarea :81-91` readOnly; `Segmented :100-107` and `Switch :109-116` disabled), `PushCard.tsx` ("Assign to screens" `:184-195` screen.assign; "Push now" `:86-100` push.publish; actions row `:183-205` dropped when neither) | content.write | You can view this playlist. Editors make changes. | Today it locks nothing on save: thread `readOnly` through the three child components |
| Schedule | `features/schedules/ScheduleEditor.tsx` (guard `:100`, form `:275-279`, header `:220-272`, Delete `:251-271` content.delete, "Add event" `:457-464`), `ScheduleEventRow.tsx` (new `readOnly` prop hides up, down and remove `:156-180`) | content.write | You can view this schedule. Editors make changes. | |
| Layout | `features/layouts/LayoutEditor.tsx` (guard `:96`, form `:222-226`, header `:167-219`, Delete `:198-218` content.delete; `Stepper :353` and `LayoutZoneFields :378` get `disabled={locked}`) | content.write | You can view this layout. Editors make changes. | |

Screen page (`features/displays/detail/`; tabs Overview, Canvas, Pairing, Tags, Working hours, `lib/screenDetail.ts:42-50`; Details is a card). Each section decides its own key at mount and passes `readOnly` down from `ScreenDetail.tsx` (drafts `:77-81`, dirty `:88-97`, guard `:99` → `dirty && !allReadOnly`) and `ScreenTabs.tsx`.

| Part | File:line | Key | Without the key |
|---|---|---|---|
| "Push to this screen" | `SummaryCard.tsx:70-72` | push.publish | Hidden |
| More menu: Pair, Revoke | `SummaryCard.tsx:88-90`, `:92-99` | screen.pair | Hidden; "Refresh status" (`:85-87`) stays |
| Details card | `DetailsCard.tsx:102-171` (form `:103-106`, inputs `:120-131`, `:140-150`, Save `:156-164`) | screen.details | Inputs readOnly, actions hidden, note "Editors change the screen's name and description." Enter in the name submits nothing |
| Content card | `ContentCard.tsx:219-302` (Change `:221-268`, buttons `:270-301`) | screen.assign | Hidden; "Open {kind}" (`:304-313`) stays; the card description (`:187`, "…until you push.", shown on every screen) is omitted; with nothing assigned, "Nothing assigned" (`:214`) stays and the note (`:215-217`) reads "An editor assigns content." |
| Canvas tab | `CanvasTab.tsx` (form `:185-188`, inputs `:174`, size preset buttons `:244-263`, checkbox `:268-277`, selects `:292-308`, `:317-332`, Save `:343-354`) | screen.setup | Locked, preset buttons and save row hidden, note "Editors change the canvas." `submit` (`:119-150`) has no dirty check, so its `if (readOnly \|\| saving) return;` is the only thing that stops Enter in a read-only field from sending `patchDisplay` |
| Pairing tab | `PairingTab.tsx` (form `:107-150`, revoke/cancel `:179-191`) | screen.pair | Form and buttons not rendered; the state text stays; note "Editors pair and revoke players." |
| Tags tab | `TagsTab.tsx` (`TagPicker :64-75`, Save `:78-86`, Discard `:88-97`) | screen.details (create: screen.setup) | Locked, row hidden, note "Editors change this screen's tags."; `allowCreate={useCan('screen.setup')}` |
| Working hours tab | `WorkingHoursTab.tsx` (`change()` `:60-62`, `Switch :113-121`, days `:133`, times `:149`, `:162`, Save `:188-196`) | screen.hours | Locked, save hidden, note "Editors change working hours." |

Add-screen wizard (`/screens/new`, guarded by `screen.setup`): `features/displays/wizard/ContentStep.tsx` hides "Push now" (`:124-134`) without `push.publish` and the assign buttons (`:297`, `:311`) without `screen.assign`; `PairStep.tsx` hides the claim form (`:254`) without `screen.pair` and offers only "Skip". Defensive under 1.3.

### 7.4 Users page (WP7)

Files: `features/users/{UsersPage.tsx, InvitesCard.tsx, InviteDialog.tsx, RoleDialog.tsx, NameDialog.tsx, RoleChoices.tsx, users.css, UsersPage.test.tsx}` (new); remove, sign-out and cancel-invite confirms use `ui/ConfirmDialog` inside `UsersPage.tsx`. Pure logic in `lib/users.ts` (new) with `lib/users.test.ts`. Model: the Tags page family (`features/settings/TagsPage.tsx`, `TagFormDialog.tsx`, `DeleteTagDialog.tsx`, `lib/settingsView.ts`); radio cards from `features/apps/CreateAppDialog.tsx:105-140`; confirm refusals as in `features/schedules/DeleteScheduleDialog.tsx:78-93`.

**`lib/users.ts`** (uses `canManage`, `grantableRoles`, `ROLE_LABELS`, `ROLE_RANK` from `@tinnox/domain`):
```ts
export const ROLE_DESCRIPTIONS: { readonly [R in Role]: string };            // the lines of 1.1
export function memberName(member: { displayName: string | null }): string;  // null → 'Unnamed person'
export type MemberAction = 'role' | 'name' | 'signOut' | 'remove';
/** Actions the actor may take on the row: none for self, removed rows, or a target the rank rule protects. */
export function memberActions(actor: { id: string; role: Role }, target: MemberDto): readonly MemberAction[];
export interface RoleChoice { readonly role: Role; readonly current: boolean; readonly disabledReason: string | null }
export function roleChoices(actorRole: Role, target: MemberDto): readonly RoleChoice[];   // Owner disabled "Available after their first sign-in."
export function inviteRoleChoices(actorRole: Role): readonly InviteRole[];
export function roleChangeConsequence(name: string, from: Role, to: Role, invitesToCancel: number): string;
export function invitesCancelledBy(invites: readonly InviteDto[], memberId: string, newRole: Role | null): number;  // null = removal
export function inviteNameProblem(name: string, members: readonly MemberDto[], invites: readonly InviteDto[]): string | null;
export function inviteEmailProblem(email: string): string | null;
export function memberRefusal(error: ApiRequestError): { field: 'name' | 'email' | 'displayName' | 'role' | null; message: string };
export function peopleCountLabel(n: number): string;   // "1 person", "3 people"
export function inviteCountLabel(n: number): string;   // "1 invite waiting for TINNOX", "2 invites waiting for TINNOX"
```

**Layout** (`Page title="Users"`, subtitle "{people} · {invites}" once both lists loaded, `data-testid="users-page"`):
- Section "People": filter row (`SearchField` "Search people" `users-search`; primary "Invite person" with `UserPlus`, `users-invite`); toolbar (count `users-count` with `aria-live="polite"`; `Segmented` "Current" / "Removed (n)" `users-show`, kept in `?show=removed`, hidden while nobody is removed; refresh `users-refresh`); `DataTable caption="People"` (`users-table`, rows `users-row-{id}`); for an Admin, a muted line "Only an Owner can change or remove Admins and Owners."
- Card "Pending invites" (`users-invites`): description "TINNOX sets up each person within one business day and sends them their sign-in details. TINNOX CMS sends no e-mail. Contact support if it is urgent."; `DataTable caption="Pending invites"` (rows `users-invite-row-{id}`), or inline `EmptyState` "No invites waiting" / "Invites you request appear here until TINNOX sets the person up."
- Two independent `useLoad`s (`api.listMembers`, `api.listInvites`); a failure in one keeps the other (`ErrorNotice` "The people could not be loaded" / "The invites could not be loaded", with Retry). After every write, reload both.
- "Invite person", the invite "Cancel" button and the row menu also require `useCan('member.manage')` (the page itself needs only `member.read`), so moving that key stays one line.

People columns: Name (`NameCell` with `Avatar`; `memberName`; own row adds a "You" badge, nothing else), Role (label; sorts by rank, Owner first), Signed in (`formatDate(firstSignedInAt)` or `StatusPill tone="neutral"` "Not signed in yet"), actions. Removed view: Name, Role (at removal), Removed (`formatDate(removedAt)`), no actions; note "Removed people keep their name in the activity history. To bring someone back, invite them again." Default sort Name ascending; search on name and role label; paginate as Tags.

Invite columns: Name (`NameCell` with the work e-mail as `meta`, `translate="no"`; no separate e-mail column, because `NameCell` always renders `meta`, `ui/DataTable.tsx:420-425`, and a column would be read twice), Role, Status (`StatusPill tone="warn"` "Waiting for TINNOX" plus the reference `inviteReference(id)` in `tx-mono`, `translate="no"`; after `expiresAt`, `StatusPill tone="neutral"` "Expired, TINNOX will close it"), Requested ("by {inviter name} · {date}"), Expires, and a ghost "Cancel" button (hidden text " invite for {name}", `users-invite-row-cancel`) only where `canManage(actorRole, invite.role)`.

Row menu (`users-row-actions`, label "Actions for {name}"), items from `memberActions`: Change role (`UserCog`), Correct name (`Pencil`), Sign out everywhere (`LogOut`), separator, Remove (`UserMinus`, `tone="danger"`). No button at all when the list is empty; for a row the rank rule protects, the name cell then carries the hidden text "Managed by an Owner" (the own row has its "You" badge only). New icons go into `ui/icons.ts` first.

Dialogs:

| Dialog | Test id | Content | On success | Refusals |
|---|---|---|---|---|
| Invite person | `users-invite-dialog` | `<form noValidate>`; Name (`users-invite-name`, `autoComplete="off"`, `data-autofocus`, hint "Up to 120 characters, as it should appear in TINNOX CMS. No two people here can share a name."); Work e-mail (`users-invite-email`, `type="email" inputMode="email" spellCheck={false} autoComplete="off"`, hint "TINNOX uses it once, to set up the sign-in account. It is deleted when the invite closes."); Role radio cards (`users-invite-role-{role}`) from `inviteRoleChoices`, Viewer preselected; Owner only: "To make someone an Owner, invite them as an Admin and promote them after their first sign-in." Buttons "Cancel" and "Request invite" (`users-invite-submit`, busy) | Close, reload, focus back on "Invite person"; toast "Invite for {name} saved" with detail "Waiting for TINNOX. Reference {ref}." | `validation_failed` and `conflict` with `details[].path` → field errors, first one focused; `forbidden` → the 7.1 handling; else `ErrorNotice` "The invite was not saved" |
| Change role | `users-role-dialog` | Title "Change role for {name}"; radio cards from `roleChoices` (current marked "Current"); consequence `p` with `aria-live="polite"` (`users-role-consequence`) from `roleChangeConsequence`; primary "Make {Role}" (`users-role-save`), `danger-solid` for a demotion | Toast "{name} is now {a/an} {Role}", detail "{n} sessions ended" on a demotion | `last_owner` → `Banner tone="danger"` "An organisation always keeps at least one Owner. Make someone else an Owner first."; `conflict` `not_signed_in_yet` → the same banner style with its message; any other `conflict` (the person was removed meanwhile, 6.7 step 1) → in-dialog `Banner` with the API message, then reload both lists |
| Correct name | `users-name-dialog` | Field "Name" (`users-name-input`); "Save name" (`users-name-save`), `aria-disabled` when unchanged; description "The new name shows here, in activity and in the audit log, for past events too. The audit log marks the person as renamed." | Toast "Name changed to “{name}”" | `conflict` with `details[0].path === 'displayName'` → field error "Another person in this organisation has, or had, this name."; any other `conflict` → in-dialog `Banner` with the API message, then reload both lists |
| Sign out everywhere | `users-sign-out-dialog` (`ConfirmDialog`, default tone) | Title "Sign {name} out everywhere?"; body "Every TINNOX CMS session {name} has open ends now, in every browser. Anything they have not saved is lost. Their next sign-in asks for their password and one-time code. Their role does not change." Confirm "Sign out everywhere" | Toast "{name} signed out everywhere", detail "{n} sessions ended" or "No session was open" | in-dialog `Banner` with the API message; a `conflict` also reloads both lists |
| Remove | `users-remove-dialog` (`ConfirmDialog tone="danger"`, `returnFocus` via `useRowFocusReturn`) | Title "Remove {name}?"; body "{name} is signed out now and can no longer use TINNOX CMS for {organisation}. Their content and the activity history stay. {Their n pending invites are cancelled.} To bring them back later, invite them again; they get the role on the new invite." Confirm "Remove person" | Toast "{name} removed", detail "{n} sessions ended" | outcome unknown (`isOutcomeUnknown`) → "The server may or may not have removed {name}" and reload; `conflict` → in-dialog `Banner` with the API message, then reload both lists |
| Cancel invite | `users-invite-cancel-dialog` (`ConfirmDialog tone="danger"`, `cancelLabel="Keep invite"`) | Title "Cancel the invite for {name}?"; body "TINNOX will not set up {name}. Their name and work e-mail address are deleted from the invite now. You can invite them again later." Confirm "Cancel invite" | Toast "Invite for {name} cancelled" | `conflict` → "This invite is no longer waiting. TINNOX may have just set {name} up; the lists were refreshed." and reload |

Words: "Waiting for TINNOX" (never "Invited"); "Not signed in yet" (never "Pending" or "Inactive"); "Removed" with the date; no "online" or "last seen". Australian English, sentence case, "…" and curly quotes.

**`api/endpoints.ts`** (WP7) gains, documented like the rest:
```ts
listMembers(signal?: AbortSignal): Promise<MemberDto[]>;
listMemberNames(signal?: AbortSignal): Promise<MemberNameDto[]>;
listInvites(signal?: AbortSignal): Promise<InviteDto[]>;
createInvite(input: InviteCreate): Promise<InviteDto>;
cancelInvite(id: string): Promise<void>;                               // requestNoContent
patchMember(id: string, patch: MemberPatch): Promise<MemberChangeResponse>;
removeMember(id: string): Promise<MemberChangeResponse>;
signOutMember(id: string): Promise<MemberSignOutResponse>;
```

### 7.5 Audit page, activity and names (WP7)

- `lib/auditView.ts`:
  - `AUDIT_CATEGORY_LABELS` (`:34-48`, exhaustive) gains `invite: 'Invites'`, `membership: 'People'`. `AUDIT_CATEGORY_OPTIONS` (`:51-56`) stays every category (`auditView.test.ts:81-87` pins it).
  - `CATEGORY_SUBJECTS` (`:112-126`, also exhaustive) gains `invite: 'Invite'`, `membership: 'Person'`.
  - New `auditCategoryOptionsFor(fullLog: boolean)` (options filtered by `visibleAuditCategories`) and `parseAuditCategory(value, fullLog)` (`:59-61`, still `AuditCategory | null`) that returns null for a category outside it (a bookmarked `?category=auth` shows the whole filtered log, not "No event matches").
  - `OBJECT_TYPE_LABELS` (`:255-269`): `membership: 'Person'` (was 'Operator account', `:267`), `invite: 'Invite'`, `route: 'Request'`.
  - `AuditTargetKind` (`:288-289`) gains `membership` (named from the member map, no link); `AuditNames` (`:436-458`) gains `member: ReadonlyMap<string, MemberNameDto> | null`.
  - `auditSearchTexts` (`:627-639`) adds the actor's name.
- `lib/activity.ts`:
  - `ACTOR_LABELS.operator` (`:505`) becomes `'Person'`; `auth.login` / `auth.logout` (`:85-86`) become "Person signed in" / "Person signed out".
  - `WORDING` (`:84`, exhaustive) gains, icon `'account'` unless noted (each unique, capitalised, no `.` or `_`):

    | Action | done | attempt |
    |---|---|---|
    | `invite.create` | Invite requested | Invite request |
    | `invite.cancel` | Invite cancelled | Invite cancellation |
    | `membership.create` | Person added by TINNOX | Adding a person |
    | `membership.role_change` | Role changed | Role change |
    | `membership.update` | Name corrected | Name correction |
    | `membership.remove` | Person removed | Removing a person |
    | `membership.sessions_end` | Signed out everywhere | Signing out everywhere |
    | `membership.mfa_reset` | Sign-in reset by TINNOX | Sign-in reset |
    | `security.permission_denied` (icon `'security'`) | Refused by role | Request the role does not allow |

  - `CATEGORY_ICONS` / `CATEGORY_LABELS` (`:175-201`) gain `invite` and `membership` (icon `'account'`, labels "Invites", "People").
  - `activityActorLabel(event, names)`: for `actorType 'operator'`, the member's name when known, "Unnamed person" when their name is null, "Person" when the list is unknown or lacks the id; other actor types unchanged. `ActivityNames` (`features/dashboard/useActivityNames.ts`) gains `member`.
- Names come from one `api.listMemberNames()` per page load and per Refresh generation, in `features/audit/useAuditNames.ts` (`:13-53`, `:62-122`) and `features/dashboard/useActivityNames.ts` (`:20-35`, `:45-95`). A failed load leaves `member: null` ("show the id, never a guess").
- `features/audit/AuditPage.tsx`: actor cell (`:275-292`) shows the name, then " (removed)" when `removed`, then " (renamed)" when `renamedAt` is after the event's `occurredAt`; the short id stays as secondary text with the full id as `title`. Category `Select` (`:367-381`) uses `auditCategoryOptionsFor(useCan('audit.read'))`. Intro (`:522-525`) and empty text (`:420-426`) without `audit.read`: "Content and screen events in this organisation: who changed what, and when." and "No content or screen events yet."
- `features/audit/AuditDetailDialog.tsx` (`:83-87`): "Actor" shows the name and marks; "Membership ID" stays.
- `features/dashboard/ActivityCard.tsx`: description (`:60`) "Content and screen events in this organisation." without `audit.read`; the actor (`:147`) is the name. No marks on the dashboard.

---

## 8. Scripts and development setup (WP8)

### 8.1 Development users

| Credentials key (`infra/.generated/dev-credentials.json`) | Keycloak username | Organisation | Role | Display name | `.env` subject |
|---|---|---|---|---|---|
| `operator` (kept; every e2e spec defaults to it) | `operator` | 1, TINNOX Internal | owner | Dev Owner | `DEV_OPERATOR_OIDC_SUB` |
| `secondOrgOperator` (kept) | `second-operator` | 2, Isolation Test Organisation | owner | Second Owner | `DEV_SECOND_ORG_OIDC_SUB` |
| `admin` (new) | `org-admin` (not `dev-admin`, the master-realm bootstrap user) | 1 | admin | Dev Admin | `DEV_ADMIN_OIDC_SUB` |
| `editor` (new) | `editor` | 1 | editor | Dev Editor | `DEV_EDITOR_OIDC_SUB` |
| `viewer` (new) | `viewer` | 1 | viewer | Dev Viewer | `DEV_VIEWER_OIDC_SUB` |

- **`scripts/setup-dev.mjs`:**
  - `:140-147` stops reusing the whole credentials object: `credentials = existingCredentials ?? {…}`, then `credentials.admin ??= makeUser('org-admin', 'Dev', 'Admin')`, `credentials.editor ??= makeUser('editor', 'Dev', 'Editor')`, `credentials.viewer ??= makeUser('viewer', 'Dev', 'Viewer')`. When a key was added to an existing file, the file is written again (pushed to `created`) and the report prints: "New development users were added. Recreate the Keycloak container so it imports them: `docker compose --env-file .env -f infra/docker-compose.yml rm -sf keycloak && npm run infra:up`" (Keycloak imports the realm only when it does not exist, `infra/docker-compose.yml:47-48`).
  - `.env` development identities (`:211-216`) add the three subjects; provisioning section adds `PROVISION_IDP_CLIENT_ID=tinnox-provisioning` and a generated `PROVISION_IDP_CLIENT_SECRET` (`dev-` prefix, kept when present, as other secrets are, `:111-116`).
  - `realm.users` (`:252`, today an assignment that replaces the template's users) becomes `realm.users = [...realm.users, ...devUsers]` with all five dev users, so the template's provisioning service-account user survives. Setup finds each client by `clientId` (not `realm.clients[0]`, `:244`); the realm's `tinnox-provisioning` client secret is filled from `.env`.
  - The report (`:318-336`) still prints the `operator` user, plus one line: "Other development users: org-admin, editor, viewer (`npm run otp -- --as admin|editor|viewer`)."
  - CI is unaffected: `.github/workflows/ci.yml:66,109` always runs a fresh setup.
- **`infra/keycloak/realm-template.json`:** a second client `tinnox-provisioning`, after `tinnox-portal-bff` (confidential, `serviceAccountsEnabled: true`, `standardFlowEnabled: false`, `directAccessGrantsEnabled: false`, `implicitFlowEnabled: false`, `fullScopeAllowed: true` (not copied from the portal client's `false`, `:62`, which would leave the token without the realm-management role), secret marked FILLED like the portal client's), and in `users` (`:743`) its service-account user `service-account-tinnox-provisioning` with `serviceAccountClientId: "tinnox-provisioning"` and `clientRoles: { "realm-management": ["view-users"] }` only (read; no `manage-users`, which covers the whole realm).
- **`.env.example` (`:61-66`):** the three subjects and the two provisioning variables, each with a one-line comment.
- **`scripts/seed.ts`:** `SEED` (`:25-42`) gets a `members` list per organisation (the table above; `subjectEnv`, `role`, `name`). In the existing transaction (`:49-85`), for each member: a row for the subject exists → note "membership already present" and leave its role; also `UPDATE membership SET display_name = $name WHERE id = $id AND display_name IS NULL` when the name is free. No row → `INSERT INTO membership (org_id, oidc_sub, role, display_name)`. "Free" means no row of the organisation has `lower(display_name) = lower($name)`, removed members included; otherwise the seed uses `` `${name} (${subject.slice(0, 8)})` ``, so a re-seed after `npm run setup -- --force` (new subjects, old rows kept, `:75-78`) never fails on `membership_org_display_name_key`. The literal `'operator'` at `:73` goes. The header (`:1-13`) says one member per role in organisation 1.
- **`scripts/otp.mjs`:** `--as <operator|second|admin|editor|viewer>` picks the user (`second` = `secondOrgOperator`); `--second` stays as an alias; usage comment `:3-5` updated.
- **`scripts/verify-oidc-login.mjs`:** the user argument (`:19-21`) and the subject map (`:175-176`) accept the five keys. New checks, all against the local Keycloak:
  1. the ID token carries a numeric `auth_time`;
  2. with the same cookie jar (a live Keycloak session), an authorization request with `prompt=login` answers with a login form (200 and a `#password` field), not a 302 with a code. Keycloak may hide the username during a re-authentication (unverified pending runtime), so the script posts `username` only when the form has `#username`. It waits for the next 30-second step before typing the code (Keycloak refuses a code twice, `tests/support/dev-identity.ts:51-53`; this script already used the current one). The new ID token's `auth_time` is later than the first one;
  3. the provisioning client gets a token by `client_credentials`; `GET /admin/realms/{realm}/users?username=operator&exact=true` returns one user with an `email`; `POST /admin/realms/{realm}/users` answers 403.
- **`tests/support/dev-identity.ts:21`:** `DevUserName = 'operator' | 'secondOrgOperator' | 'admin' | 'editor' | 'viewer'`.
- **`package.json`** (root scripts): `"provision": "tsx scripts/provision-member.ts"`.

### 8.2 `scripts/provision-member.ts` (new), `scripts/lib/provision.ts` (new), `scripts/lib/idp.ts` (new)

TINNOX staff run it from a controlled host, never from the API's host or container. The CLI (`provision-member.ts`) parses with `node:util` `parseArgs({ strict: true, allowPositionals: true })`; subcommand = `positionals[0]`. Exit 0 success, 1 refusal or failure, 2 usage error. `lib/provision.ts` has one exported function per command, `(pool: Pool, idp: IdpDirectory, args) => Promise<Result>`, plus the pure validators; `lib/idp.ts` the reader.

```ts
// scripts/lib/idp.ts
export interface IdpAccount { readonly subject: string; readonly email: string | null; readonly enabled: boolean }
export interface IdpDirectory { findByUsername(username: string): Promise<IdpAccount | null> }  // exactly one exact match, or null
/** Keycloak: client_credentials token for PROVISION_IDP_CLIENT_ID (view-users only), then
 *  GET {base}/admin/realms/{realm}/users?username={u}&exact=true. */
export function keycloakDirectory(options: { issuer: string; clientId: string; clientSecret: string; fetch?: typeof fetch }): IdpDirectory;
```
Environment (controlled host only; never in the API's config schema, compose or the worker): `DATABASE_MIGRATOR_URL`, `PROVISION_IDP_ISSUER` (default `OIDC_ISSUER`), `PROVISION_IDP_CLIENT_ID`, `PROVISION_IDP_CLIENT_SECRET`.

Rules for every command:
1. `loadEnv()`, `requireEnv('DATABASE_MIGRATOR_URL')`, a one-connection `pg.Pool` (`application_name: 'tinnox-provision'`, not `createPool`). Each exported command in `lib/provision.ts` first calls a shared `assertMigrator(pool)`: `SELECT current_user, session_user`, refuse unless both are `tinnox_migrator` (as `packages/db/src/migrate.ts:51-54`; this refuses the superuser, whose writes the 0013 exemptions would not cover). The CLI adds no check of its own.
2. Identity-provider reads happen before `BEGIN`; the database facts are checked again inside the transaction.
3. One transaction per command: `withResolvedOrg` when the organisation comes from a row (`enterOrg` only with a value read from the database, never an argument), `withOrg` for `org-create`, `withoutOrg` for `pending`. `pending` takes no membership lock (`lockOrgMembership` throws without an organisation): it writes only `member_invite` rows, and a concurrent `fulfil` or cancel holds the row `FOR UPDATE` while the expiry's READ COMMITTED re-check then skips it. Every other command calls `lockOrgMembership(tx)` (`@tinnox/db`) before touching `membership` or `member_invite`.
4. Cross-organisation reads between `SET LOCAL ROLE tinnox_definer` and `RESET ROLE`; `RESET ROLE` before any `membership` write and any `member_invite` write, so writes run as the migrator (the exemptions test `session_user`, which is `tinnox_migrator` either way). Exception: `pending`'s expiry and its audit insert run as the definer (rule 6). Every migrator write to `membership` or `member_invite` runs with `app.org_id` set: both tables force row-level security on their owner.
5. Session ends: `SET LOCAL ROLE tinnox_definer; SELECT sec.session_revoke_membership($1); RESET ROLE;` with `app.org_id` set (the owner may execute its function; no new `EXECUTE` grant).
6. Audit with `auditScoped(tx, { actorType: 'system', actorId: null, … })` on the same `Tx`; no time passed. `pending`'s cross-organisation expiry uses the `WITH … UPDATE … RETURNING` then `INSERT INTO audit_event … SELECT` shape of `scripts/revoke-subject-sessions.sql:16-26`, as the definer (`BYPASSRLS`, its 0013 `UPDATE (status)` grant on `member_invite`, its `INSERT` on `audit_event`). As the migrator without an organisation it would match no row.
7. Arguments: `--executed-by` on every command, `--approved-by` on `restore-owner` and different from `--executed-by` (it cannot prove two people; T14). Staff ids `^[a-z][a-z0-9._-]{1,39}$`; `--request-ref` and `--confirmed-with` `^[A-Za-z0-9._:/-]{1,64}$` (no `@`, no space, so no e-mail address or name reaches `audit_event.detail`); ids are lower-case UUIDs; names pass `MemberNameSchema`.
8. Output to the staff terminal only. Only `pending` prints names and e-mail addresses. On `CommitOutcomeUnknownError`: "outcome unknown: run `pending` or read the audit log before running again".

| Command | Does, in one transaction |
|---|---|
| `org-create --org-name <n> --timezone <IANA> [--site-name <n>] --owner <username>=<name> [--owner …] --request-ref <r> --executed-by <s>` (one or two owners) | IdP: each account exists and is enabled; usernames distinct. `withOrg(new uuid)`, lock; as the definer, refuse a subject that already has a membership anywhere. Insert `organization`, a `site` (required: `display.site_id` is NOT NULL and no route creates sites; default name "Main site"), one `owner` membership per `--owner` with its display name. `membership.create { role: 'owner', inviteId: null, reactivated: false, requestRef, executedBy, reason: 'org_create' }` per owner. Prints the ids |
| `pending --executed-by <s>` | As the definer: expire every `pending` invite with `expires_at <= now()` (`status = 'expired'`; the guard clears name and e-mail) and write `invite.cancel { role, reason: 'expired', executedBy }` per invite; then list the pending invites of every organisation (id, `inviteReference`, organisation name, role, name, e-mail, created, expires) |
| `fulfil <inviteId> --username <u> --confirmed-with <ref> --executed-by <s>` (`--username` is new to the record's form; there is no subject or role argument) | IdP: one enabled account; keep subject and e-mail. As the definer: the invite's `org_id`; any membership of the subject. `enterOrg`, lock, re-read the invite `FOR UPDATE` as the migrator. Refuse (invite stays pending, nothing written) when: not pending or expired; the IdP e-mail is empty or `lower(btrim)` differs from the invite's; the inviter is removed or `grantableRoles(inviterRole, 'invite')` lacks the invite's role; the subject has a membership row in any other organisation, removed or not (`UNIQUE (oidc_sub)`, `0001_schema.sql:61`; removed rows are never deleted); the subject is already an active member here. A removed row of the same subject here is reactivated: `role` and `display_name` from the invite, `removed_at`, `removed_by` and `first_signed_in_at` NULL, `sessions_valid_after` kept. Otherwise insert `membership (org_id, oidc_sub, role, display_name)`. A 23505 on `memberNameTaken`: "Name in use in this organisation; agree a different name with the requester." Mark the invite `fulfilled` with `fulfilled_membership_id`. `membership.create { role, inviteId, reactivated, requestRef: inviteReference(id), confirmedWith, executedBy }`. Prints membership id, organisation and role, never the e-mail |
| `set-name (--membership <id> \| --username <u>) --name <name> --request-ref <r> --executed-by <s>` | Resolve the membership (definer read), `enterOrg`, lock. `UPDATE membership SET display_name = $2 WHERE id = $1 AND org_id = app_org_id() AND removed_at IS NULL` (0 rows: refuse). `membership.update { fields: ['displayName'], requestRef, executedBy }`. Used once for every existing member (D4 a) |
| `mfa-reset --username <u> --request-ref <r> --executed-by <s> [--confirmed-with <ref>]` | Staff have already reset the account at the IdP. Resolve the active membership, `enterOrg`, lock. When another active Owner or Admin exists, `--confirmed-with` is required. `sessionsEnded` from `sec.session_revoke_membership` (also sets the cut-off). `membership.mfa_reset { requestRef, executedBy, confirmedWith?, sessionsEnded }`. Reminds staff to sign the user out at the IdP |
| `restore-owner --request-ref <r> --executed-by <s> --approved-by <s2> --promote <membershipId>` | Lost-owner break-glass, on a written request. The target is active and has signed in at least once. `UPDATE membership SET role = 'owner'`. `membership.role_change { from, to: 'owner', sessionsEnded: 0, invitesCancelled: 0, reason: 'owner_recovery', requestRef, executedBy, approvedBy }` |
| `restore-owner --request-ref <r> --executed-by <s> --approved-by <s2> --successor <username>=<name> --replaces <membershipId>` | Nobody active is left except the old Owner. IdP read for the successor; the subject has no membership row anywhere, removed or not (as `org-create`); `--replaces` is the active Owner and the only active member. Insert the new `owner` membership **first** (so the trigger finds an Owner), then `removed_at = now()` (`removed_by` NULL) on the old one, cancel the old Owner's pending invites (`invite.cancel reason 'inviter_removed'`), end their sessions. `membership.create { …, reason: 'owner_recovery', approvedBy }` and `membership.remove { previousRole: 'owner', sessionsEnded, invitesCancelled, reason: 'owner_recovery', requestRef, executedBy, approvedBy }`. Reminds staff to disable the old IdP account |

`restore-owner` is a subcommand, not the record's `scripts/restore-owner.sql`: the successor path needs the IdP read, and psql does not substitute variables inside `DO $$ … $$` bodies, so a `.sql` file could not check the staff ids.

### 8.3 `scripts/revoke-subject-sessions.sql`

After the `SET LOCAL ROLE tinnox_definer` (`:14`), before the session update (`:16-26`), one statement that sets the cut-off and audits it (the definer's 0013 grant; AGENTS.md §3: a member with no live session gets a cut-off too, so the session update's `auth.logout` rows do not cover it):
```sql
WITH cut AS (
  UPDATE public.membership SET sessions_valid_after = now()
  WHERE oidc_sub = :'subject'
  RETURNING id, org_id
)
INSERT INTO public.audit_event (org_id, actor_type, actor_id, action, object_type, object_id, result, detail)
SELECT cut.org_id, 'system', NULL, 'membership.sessions_end', 'membership', cut.id::text, 'success',
       jsonb_build_object('reason', 'incident_revocation')
FROM cut;
```
The header line `:6` becomes: "It also sets the member's cut-off, so a browser still signed in at the identity provider must enter the password and one-time code again. End the user's sessions at the identity provider too."

---

## 9. Tests

A case goes in the file named here. "Owner" in a fixture means the default member of `createOrg`.

### 9.1 Fixtures

Change (each because 0013 drops the default role, the five-argument `sec.session_create`, or the old CHECK):

| File:line | Today | Change | WP |
|---|---|---|---|
| `apps/api/test/support.ts:205` `createOrg(name)` | inserts no role | `createOrg(name, options?: { role?: Role; displayName?: string \| null })`, default `role: 'owner'`, `displayName: null` | WP3 |
| `apps/api/test/support.ts:232` `addMember(org)` | inserts no role | `addMember(org, role: Role = 'owner', displayName: string \| null = null)`; `apps/api/test/pairing.integration.test.ts:120,140` keep working (Owner may pair) | WP3 |
| `apps/api/test/support.ts:258-264` `signIn(t, org)` | five-argument `sessionCreate` | `signIn(t, org, options?: { authTime?: Date \| null })`, default `new Date(Date.now() + 60_000)` (after any cut-off the test has set, even within the same second or with the database clock a little ahead; nothing checks an upper bound); tests of the cut-off pass an explicit `authTime`; throws unless `outcome === 'created'` | WP3 |
| `apps/api/test/support.ts:61-69` `noIdentityProvider` | `beginLogin()` | the new signature (still rejects) | WP3 |
| `packages/db/test/support.ts:78` `createOrg(migrator, name)` (insert `:127-131`) | inserts no role | `createOrg(migrator, name, options: { role?: 'owner' \| 'admin' \| 'editor' \| 'viewer' \| 'operator' } = {})`, default `'owner'`; the doc comment (`:71-77`) says `member_invite` gets no row | WP2 |
| `packages/db/test/migration-0012.integration.test.ts:176-178` | three `createOrg` calls at the 0011 schema | pass `{ role: 'operator' }` to all three (the only valid value at 0011, `0001_schema.sql:59`; 0013 maps it during the upgrade at `:205`) | WP2 |
| `packages/db/test/sec.integration.test.ts:101` `addMember` | no role | `'editor'` (the colleague claims codes) | WP2 |
| `packages/db/test/sec.integration.test.ts:157-160` | 18 functions | 19, comment names `session_revoke_membership` (0013) | WP2 |
| `packages/db/test/sec.integration.test.ts:184, 258, 267` | `role: 'operator'` | `'owner'` | WP2 |
| `packages/db/test/sec.integration.test.ts:248, 284, 303, 317, 348, 374` | five-argument `sessionCreate`, row-or-null | `authTime: new Date()`, `outcome` result | WP2 |
| `packages/db/test/rls.integration.test.ts:641-645` | `UPDATE membership SET role = 'operator'` → 42501 | deliberate change (record `:467`): `UPDATE membership SET oidc_sub`, `org_id`, `first_signed_in_at`, `sessions_valid_after`, `display_name_changed_at` → 42501 each; `UPDATE membership SET role = 'viewer'` on the only Owner → 23001 `membership_last_owner`. The INSERT refusal (`:646-655`) stays 42501 | WP2 |
| `packages/db/test/migration-0005.integration.test.ts:598-627` (exact table list) | no `member_invite` | add `member_invite` under `// 0013` | WP2 |
| `tests/integration/backup-restore-check.test.ts:142` | no role | `'owner'` | WP3 |
| `tests/integration/credential-audit.test.ts:222-235` (fake IdP) | no `authTime` | `authTime: null`; `beginLogin` takes the options | WP3 |
| `scripts/seed.ts:73` | `'operator'` | section 8.1 | WP8 |
| `apps/portal/src/api/client.test.ts:18`, `apps/portal/src/api/endpoints.test.ts:280` | `role: 'operator'`, no permissions | `sessionFor('owner')`-shaped user (`membershipId`, `displayName`, `role: 'owner'`, `permissions`) | WP5, WP7 |

**Must NOT change** (they run on an older schema, where only `'operator'` is valid and the default exists; after their upgrade they test the operator → owner mapping for free):
- `tests/integration/migration-backfill.test.ts:168` (runs at 0004);
- `packages/db/test/migration-0005.integration.test.ts:130` (`createLegacyOrg`, runs at 0004);
- the `role` option of `packages/db/test/support.ts` `createOrg` must keep accepting `'operator'` for `migration-0012.integration.test.ts`.

The default test member stays an Owner: `tests/integration/session-csrf.test.ts:210-259` reads `security.csrf_rejected` through `GET /api/audit` (needs `audit.read`), and `:288-291` needs a role allowed on every write.

### 9.2 Contracts and domain (WP1)

`packages/contracts/src/roles.test.ts` (new):
- `ROLES` is exactly owner, admin, editor, viewer; `PERMISSION_KEYS` exactly the 14 keys of 1.2; none of `org.rename`, `org.delete`, `site.manage`, `support.grant` is in it.
- `SessionResponseSchema`: the new user accepted; `role: 'operator'` refused; an unknown permission refused; missing `membershipId` refused; `displayName` null accepted, `''` and 121 characters refused; an extra key refused.
- `AUTH_ERROR_CODES` contains `reauth_failed`.
- `MemberDtoSchema` with an extra `email` refused (D3 on the client side); `InviteCreateSchema`: trims; name 1 to 120; e-mail without "@" or a dot after it, and over 254, refused; `role: 'owner'` refused; extra key refused. `MemberPatchSchema`: `{}` refused with "name a role or a display name to change"; each field alone accepted.
- `inviteReference('3f9a12c4-…')` is `'3F9A12C4'`.
- `ROUTES.member('../x')`, `memberRemove`, `memberSignOut`, `inviteCancel` encode their argument.
- `API_ERROR_CODES` contains `last_owner`; `AUDIT_ACTIONS` contains the nine new actions. `portal-v2.test.ts:1325-1334` (unique, well-formed actions; categories equal the derived set) stays green unchanged.

`packages/domain/src/permissions.test.ts` (new):
- `ROLE_PERMISSIONS` equals the table of 1.3, written out in the test (not derived).
- Nesting: each role's keys contain the next lower role's keys.
- `can` for all 56 role × key pairs, from the same written table.
- `permissionsOf(role)` follows `PERMISSION_KEYS` order.
- `canManage` for all 16 pairs; `grantableRoles` for every role and purpose (1.4); `isDemotion` both ways.
- `ACTIVITY_CATEGORIES` equals the 11 of 1.5, is a subset of `AUDIT_CATEGORIES`, and contains none of auth, security, invite, membership; `visibleAuditCategories(true)` is every category.
- No `ROLE_LABELS` value contains "operator".

### 9.3 Database (WP2)

`packages/db/test/migration-0013.integration.test.ts` (new; template `migration-0012.integration.test.ts:55`, `:162-224`: scratch directory with 0001 to 0012, `expect(before).toHaveLength(12)`, reset, migrate, arrange legacy data, migrate all, `afterAll` re-runs all). Helpers: `stillWaiting`, `twoTransactions`, `asDefiner` (local to `sec.integration.test.ts:80-140`) move to `packages/db/test/support.ts` and are exported, and `sec.integration.test.ts` imports them; `asSuperuser` (local to `tests/integration/session-revoke-all.test.ts:17-27`, WP8) is copied there. Never import a `*.test.ts`: it would run its suites again. Legacy data: organisation A with two `'operator'` members, B with one, all role-less inserts. Add `PG.notNull = '23502'` to `support.ts` `PG`.

Every migrator write to `membership` or `member_invite` in 9.3 and 9.4 (outside `SET LOCAL ROLE tinnox_definer`) runs in a transaction that first calls `set_config('app.org_id', <the row's organisation>, true)`: row-level security binds the owner, so without it the UPDATE matches no row and holds no lock, and with the wrong one `membership_guard` raises 42501.

1. Applied on top of 0012, once; every legacy member is `owner`; `membership` is forced again (`relforcerowsecurity`), and the owner without `app.org_id` sees no rows.
2. `membership_role_check` absent, `membership_role_known` present (`pg_get_constraintdef`); `column_default` of `role` NULL; an insert without a role (migrator, `app.org_id` set) → 23502; `role = 'operator'` → 23514.
3. Grants exactly (template `stage-b-layouts.integration.test.ts:218-232`): `tinnox_app` UPDATE on `membership` only `display_name, removed_at, removed_by, role`, no INSERT; `tinnox_definer` UPDATE only `first_signed_in_at, sessions_valid_after`; on `member_invite` `tinnox_app` SELECT, INSERT, UPDATE only `closed_by, status`, no DELETE; `tinnox_definer` SELECT only the nine columns, UPDATE only `status`.
4. `tinnox_app` runs `SELECT role FROM membership WHERE id = $1 AND org_id = app_org_id() FOR SHARE` on its own row (the record's unverified item), and it waits (`stillWaiting`) while the migrator holds an `UPDATE` of that row.
5. Display names: `''` and 121 characters → 23514 `membership_display_name_length`; `' x'` → 23514 `membership_display_name_trimmed`; the same name in another case in one organisation → 23505 `membership_org_display_name_key`, also against a removed member; the same name in another organisation accepted; two NULL names accepted.
6. Rename stamp: NULL → name leaves `display_name_changed_at` NULL; name → other name sets it; `tinnox_app` `UPDATE … SET display_name_changed_at` → 42501.
7. Last owner, as `tinnox_app` in A: demoting the only Owner → 23001 `membership_last_owner`; removing it → the same; with two Owners, one demotion passes and then the other fails; one statement demoting both → 23001; **two concurrent demotions** (`twoTransactions`): the second waits (`stillWaiting`) and fails with 23001 after the first commits; the migrator deleting the only Owner (with `app.org_id`) → 23001; an update through `asSuperuser` without `app.org_id` → 42501; demoting one of two Owners in a `REPEATABLE READ` transaction → 25000 (`invalid_transaction_state`).
8. Removal is final: as `tinnox_app`, clearing `removed_at`, changing `removed_by`, or changing a removed member's role → 23001 `membership_removed_final`; the migrator reactivates (`removed_at = NULL, removed_by = NULL, role = 'viewer'`) and passes; `removed_by` without `removed_at` → 23514 `membership_removed_pair`; `removed_by = id` → 23514 `membership_not_removed_by_self`; `removed_by` from organisation B → 23503 `membership_removed_by_fk`.
9. `sec.session_create`: `created` sets `first_signed_in_at` once (a second sign-in leaves it); unknown subject → `no_membership`; removed member → `no_membership`; with `sessions_valid_after` arranged at T (definer): `authTime` null → `reauth`; `authTime = date_trunc('second', T)` → `reauth`; `date_trunc('second', T) + 1 s` → `created`; `reauth` returns the membership and organisation ids.
10. `sec.session_by_id_hash`: a session created before the cut-off → no row; a removed member's session → no row; a live one still works. `sec.membership_by_oidc_sub` of a removed member → no row.
11. The race of the record's `:220` (map 01 §6.4): (a) transaction R calls `session_revoke_membership` and stays open; `sessionCreate` with an `authTime` before R waits (`stillWaiting`) and returns `reauth` once R commits; (b) a sign-in commits first, then `session_revoke_membership` returns 1 and that session is revoked.
12. `sec.session_revoke_membership`: returns the count, sets the cut-off, leaves other members' sessions; another organisation's id → 42501 and nothing changed; no context → 42501.
13. `sec.pairing_claim` by a removed member → 42501; `sec.pairing_complete` of a claim whose claimer was removed afterwards → `not_claimable` and the pairing `expired`.
14. `member_invite`: CHECKs (role `owner` → 23514 `member_invite_role_known`; an unknown status on an UPDATE of a pending invite → 23514 `member_invite_status_known`, while on INSERT the BEFORE trigger answers 23001 `member_invite_guard` first; a pending row without e-mail → `member_invite_open`; e-mail without "@" → `member_invite_email_shape`); guard (insert expired, or more than 14 days ahead, or not pending → 23001 `member_invite_guard`); `tinnox_app` cancel works, sets `closed_at`, clears `name` and `email`; `tinnox_app` setting `fulfilled` or `expired` → 23001; changing a pending invite's role or name as the migrator → 23001, as `tinnox_app` → 42501 (no column grant); any change to a closed invite → 23001; the migrator fulfils (`fulfilled_membership_id` required, `member_invite_fulfilled`); the migrator under `SET LOCAL ROLE tinnox_definer` expires invites of A and B in one statement; a second pending invite with the same e-mail or name in another case → 23505 `member_invite_pending_email_key` / `_name_key`, accepted again once the first is cancelled; `invited_by` from B → 23503.
15. The exemption's premise: under `SET LOCAL ROLE tinnox_definer` (as `asDefiner` does), `SELECT session_user, current_user` gives `tinnox_migrator`, `tinnox_definer`. The `tinnox_app` side is covered by 8 and 14 (refused).

`packages/db/test/rls.integration.test.ts`: `TENANT_TABLES` (`:12-35`) gains `member_invite`; `ROWS_PER_ORG.member_invite = 0` (`:41-46`; `createOrg` also runs at 0011, where the table does not exist); a new case arranges one pending invite per organisation as the migrator and checks that `tinnox_app` in A reads only A's, cannot insert one with B's `org_id` (42501, WITH CHECK), and updates 0 rows of B's; the `:641-655` change of 9.1.

`packages/db/test/sec.integration.test.ts`: 9.1 only; the new behaviour is in `migration-0013`.

### 9.4 API (WP3, WP4)

Unit (`apps/api/src`, WP3):
- `auth/permissions.test.ts` (new): `ROUTE_PERMISSIONS` has exactly the 59 keys of 6.1, each pattern a `ROUTES` value; `checkRouteTable` reports a registered route without an entry, an entry without a route, an `any` entry with an unknown refine, and accepts `HEAD /api/media` as `GET /api/media`; `displayPatchKeys` maps each of the 11 fields (iterating `Object.keys(DISPLAY_PATCH_KEYS)` against the schema's keys, so a new field fails) and ignores unknown ones; `tagScopeKey` for 2 scopes × 2 actions; `REFINES.tagScopeFromBody` returns `['screen.setup']` for `display` and `['content.write']` for `media`, null for a body that is not an object; with a **hypothetical key set** holding only `content.write`, `meetsKeys` fails `{ all: ['screen.setup'] }` (POST tags `display` refused) and passes `{ all: ['content.write'] }` (`media` allowed); `meets` for `all` and `any`; `parseRole('operator')` is null.
- `auth/write-guard.test.ts` (new): reads every `apps/api/src/routes/*.ts` except `auth.ts`, `ops.ts`, `player.ts` and counts `/\bwithOrg\s*[<(]/g` and `/\bwithOrgDecision\s*[<(]/g` matches (the word boundary excludes `withOrgAllowed` and `withOrgDecisionAllowed`; import lines do not match; `playlists.ts:547` calls the generic `withOrgDecision<…>(`) against an allow-list of reads and audit-only transactions: apps 2, audit 1, displays 5, folders 1, layouts 2, media 6, members 3, overview 1, playlists 2, push 2, schedules 2, tags 1; `withOrgDecision` 0 everywhere. A new write that uses plain `withOrg` fails it.
- `auth/oidc.test.ts`: `beginLogin({ reauthenticate: true })` URL carries `prompt=login`; plain `beginLogin()` carries none; `completeLogin` maps `auth_time` to `authTime` and a token without it to null.

Integration (`apps/api/test`):
- `roles.integration.test.ts` (new, WP3):
  - `GET /api/session` for each role: `role`, `permissions` equal to `permissionsOf(role)`, `membershipId`; `displayName` null, then the set name after a migrator update.
  - Audit filter: an Editor's and a Viewer's `GET /api/audit` contain no `auth` or `security` event (the Owner's do); `?category=auth` → 200 `{ items: [], nextBefore: null }`; `?category=media` works; paging with `before` stays inside the filter.
  - A Viewer's `POST /api/playlists` → 403 `forbidden`, message "Your role doesn't allow this."; one `security.permission_denied` row (read as the Owner, `?category=security`) with `objectType 'route'`, `objectId 'POST /api/playlists'`, detail `permission ['content.write']`, `method`, `route`, `reason 'role'`; a refused `GET` writes nothing.
  - Throttle with `startTestApp({}, 1)`: 25 refusals by one Viewer → exactly 2 rows (the first, and the 20th with `throttled: true`, `refusalsInWindow: 20`); a second Viewer gets its own first row.
  - Demotion during a push: a `wrapPool` (as `upload.integration.test.ts:568-640`) holds the second screen's `FOR SHARE` read; the migrator demotes the Editor to Viewer; release → 403; the first screen keeps its publication; a `security.permission_denied` row with `reason 'role_changed'`.
  - Removal during a write: the same hold, the migrator sets `removed_at` → 401 `unauthenticated`.
  - Sign out everywhere during a push: the same hold at the second screen; the test calls `sessionRevokeMembership` for the Editor in its own `withOrg` transaction (as `tinnox_app`); release → 401 `unauthenticated`; the first screen keeps its publication and later screens are not pushed. The same during a held upload → 401, no `media` row.
  - Lock timeout: the migrator holds `UPDATE membership SET role = role WHERE id = <editor>` open over 5 s; the Editor's `POST /api/folders` → 503 `service_unavailable` with `retry-after: 2`.
  - `HEAD /api/displays` as a Viewer → 200; without a session → 401.
  - Tags as an Editor: PATCH and DELETE of an own media tag and an own screen tag → not 403.
- `upload.integration.test.ts` (WP3): a demotion during an upload, held at the `FOR SHARE` read (`wrapPool`): 403, no `media` row, `listDir(join(t.jobsDir, 'inbox'))` empty.
- `members.integration.test.ts` (new, WP4): one organisation with Owner, second Owner, Admin, Editor, Viewer (`addMember`). The 100-invite cap case (100 invites arranged as the migrator, the 101st through the API) and the removed-name case each run in their own `createOrg` organisation, so the cap and the removal do not leak into later cases.
  - `GET /api/members`: Owner and Admin see every member, removed ones with `removedAt`; no `email` key anywhere; Editor 403.
  - `GET /api/members/names`: every role 200; removed included; `renamedAt` set after a rename.
  - Invites: Admin invites Viewer and Editor → 201, `invite.create { role }`; Admin invites Admin → 403 and a `security.permission_denied` row `reason 'grant'`; Owner invites Admin → 201; `role: 'owner'` → 400; a second pending invite for the same address in another case → 409 `details[0].path 'email'`; a name equal to an active member's → 409 `path 'name'`; a removed member's name → 201; the 101st pending invite → 409; Editor `GET /api/invites` → 403; Admin's list has the e-mail addresses.
  - Cancel: Admin cancels an Editor invite → 204, `invite.cancel { role, reason: 'cancelled' }`, name and e-mail NULL in the row; Admin cancels an Owner's Admin invite → 403 `rank`; a cancelled invite → 409; unknown id → 404.
  - Role change: Admin Viewer → Editor → 200, `sessionsEnded 0`, the target's session still works; Admin Editor → Viewer → `sessionsEnded` ≥ 1, the target's old session 401, `membership.role_change { from, to, sessionsEnded, invitesCancelled }`; Admin on the Owner or the other Admin → 403 `rank`; Admin granting Admin → 403 `grant`; anyone on themselves → 403 `self`; Owner → Owner for a member who never signed in → 409 `conflict` with `details[0].code 'not_signed_in_yet'`, after a sign-in → 200; a 23001 `membership_last_owner` injected by a `wrapPool` on the UPDATE → 409 `last_owner` and an always-written denial `reason 'last_owner'`.
  - Demotion cancels invites: the second Owner has a pending Admin invite and a pending Editor invite; the Owner demotes them to Admin → the Admin invite is cancelled (`reason 'inviter_demoted'`), the Editor invite stays; `invitesCancelled: 1`.
  - Name: PATCH `displayName` → 200 and `membership.update { fields: ['displayName'] }`; a name in use → 409 `path 'displayName'`.
  - Remove: Owner removes the Admin → 200 with counts; the Admin's next request 401; the Admin's pending invites cancelled (`inviter_removed`); `membership.remove`; the removed subject's `sessionCreate` → `no_membership`; removing again → 409; Admin removes the Owner → 403.
  - Sign out everywhere: Admin signs the Editor out → `{ sessionsEnded }`, the Editor's session 401, `sessionCreate` with an `authTime` before now → `reauth`, `membership.sessions_end { sessions }`; on themselves → 403.
  - Every refused write above (403 `self`, `rank`, `grant`; 409 `last_owner`, `not_signed_in_yet`) wrote its `security.permission_denied` row even with the throttle at its default; the refused GETs wrote none (6.2 step 6).
- Not touched: the other `apps/api/test/*.integration.test.ts` files (their member is an Owner).

`tests/integration` (WP3 unless noted):
- `routes.ts` (new): exports `OPERATOR_ROUTE_PATTERNS` (moved from `session-csrf.test.ts:43-94`, plus the 8 people routes: 59), `PUBLIC_API_ROUTES`, `LOGOUT`, `operatorRoutes(id)`.
- `session-csrf.test.ts`: imports them; every assertion unchanged; "lists every /api route the application serves" (`:110-131`) now covers the people routes.
- `roles-matrix.test.ts` (new): an **independent oracle**, written in the test, not read from the API's table: Viewer may only GET (except `GET /api/members` and `GET /api/invites`); Editor may do everything except the 7 member and invite routes other than `GET /api/members/names`; Admin and Owner may do everything. For each of the 59 routes × 4 roles with a random id and an empty body: refused → 403 `forbidden`; allowed → neither 401 nor 403. Each refused write also with the caller's own object id (a display, a playlist) → the same 403 body. `HEAD` of three GET routes as a Viewer → not 403.
- `reauth.test.ts` (new): fake IdP as `credential-audit.test.ts:220-234`, with a settable `authTime` and a log of `beginLogin` options:
  1. a normal login → session; `GET /api/session` role `owner`;
  2. cut-off arranged now (`arrangeAsDefiner`), callback with `authTime` an hour ago → 303 to the IdP URL, `beginLogin` called with `{ reauthenticate: true }`, a pre-auth cookie set, the previous session revoked, `auth.login` denied `reason 'reauth_required'`;
  3. that forced callback with the old `authTime` again → 303 to `/?authError=reauth_failed`, no redirect to the IdP, `reason 'reauth_failed'`;
  4. the forced callback with `authTime` two seconds after the cut-off → a session;
  5. `authTime` null with a cut-off → re-login;
  6. a removed member → `/?authError=no_membership`;
  7. lock order (6.5 step 2, 6.8): the member signs in and keeps that cookie; a `wrapPool` holds the callback (sent with that cookie) just before `sec.session_create`; a `withOrg` transaction as `tinnox_app` calls `sessionRevokeMembership` for the member; release → both finish: the callback answers a redirect (never 500) and the revocation commits (no 40P01). With the old order (rotation first) the revocation waits on the cookie's session row and the two deadlock.
- `cross-org.test.ts` (WP4): `world()` (`:62-123`) also creates a pending invite in each organisation; Bob (Owner of B) on A's member and invite ids: `PATCH /api/members/:id`, remove, sign-out, cancel → 404 each, same body as an unknown id; `/api/members`, `/api/members/names`, `/api/invites` join the list checks (`:196-214`) and leak no A id; `TABLES` (`:628-650`) gains `member_invite`; **a Viewer of B** gets the same 403 body for `PATCH /api/displays/:id` with its own display id, A's display id and an unknown id. The Viewer case is a new `it` after "keeps lists, storage totals and the audit trail…" (`:195`): its `security.permission_denied` rows carry the Viewer's id, which the actor check at `:267` does not allow.
- `migration-backfill.test.ts` (WP3): after the upgrade, `GET /api/session` as the legacy member says `role: 'owner'` (a new assertion; `:168` untouched).
- `credential-audit.test.ts`, `backup-restore-check.test.ts`: 9.1 only.
- `provision-member.test.ts` (new, WP8): migrator pool on `TEST_DATABASE_MIGRATOR_URL`, a fake `IdpDirectory`. An expired invite is arranged by inserting it as the migrator (with `app.org_id`) with `expires_at = now() + interval '1 second'`, committing and waiting until it has passed; the trigger is never disabled. `fulfil` refuses an account whose e-mail differs from the invite's (record `:515`), an expired invite, a removed inviter, a demoted inviter who can no longer grant the role, a subject in another organisation, each leaving the invite pending and writing nothing; a fulfil inserts the member with the invite's role and name and clears the invite's details; reactivation clears `first_signed_in_at`, takes the invite's role, keeps the old sessions revoked; `pending` expires and audits invites of two organisations and lists the rest; `set-name`, `mfa-reset` (sessions ended, cut-off set, `--confirmed-with` required when another Owner exists), `org-create` (site created; a subject already in an organisation refused), `restore-owner` (equal staff ids → exit 2; promote refuses a never-signed-in member; the successor path leaves exactly one active Owner); a failing audit insert leaves nothing committed; every command refuses the superuser.
- `session-revoke-all.test.ts` (WP8): after `revoke-subject-sessions.sql`, the subject's `sessions_valid_after` is set and one `membership.sessions_end` row (actor `system`, `reason 'incident_revocation'`) is written, also for a member with no live session.

`scripts/lib/provision.test.ts` (new, WP8, unit): staff id, reference and name validation (an `@` or a space refused), equal `--executed-by` and `--approved-by` refused, unknown subcommand and option → usage error.

### 9.5 Portal

Unit (`*.test.ts`, node project):
- WP5: `api/client.test.ts` (403 `forbidden` from the API calls `onForbidden` once; `csrf_failed`, `origin_not_allowed` and a 403 without an API envelope do not); `shell/nav.test.ts:50-57` (Users has `permission: 'member.read'` and no `planned`); `lib/settingsView.test.ts:169-176` (planned rows without Users); `lib/dashboard.test.ts` (`setupProgress` with each `can` flag false gives `action: null` and the step-4 text; `pushOverview` with `canPush` false says "until an editor pushes"); `lib/pushDialog.test.ts` (a 403 `forbidden` → `'role'`; `csrf_failed` stays `refused`); `lib/authError.test.ts` (new: a message for every `AUTH_ERROR_CODES`; `takeAuthError` ignores unknown values and removes the parameter).
- WP7: `lib/users.test.ts` (new: `memberActions` for every actor × target role, self, removed; `roleChoices` with the Owner disabled before a first sign-in; `inviteRoleChoices`; `roleChangeConsequence` for each change in 1.4 with invite counts; `invitesCancelledBy`; name and e-mail problems; `memberRefusal` for `last_owner`, `conflict` with paths, `not_signed_in_yet`; count labels; no wording contains "operator" or "display"); `api/endpoints.test.ts` (the 8 calls in the reads and changes tables, `:322-384`, `:408-596`; a `MemberDto` with an `email` key → `invalid_response`; id encoding `:849`); `lib/activity.test.ts` (`:603` actor 'Person'; the nine wordings; actor names known, null → "Unnamed person", unknown → "Person"); `lib/auditView.test.ts` (`:251`, `:263`, `:654` follow 'Person'; `auditCategoryOptionsFor(false)` lists the 11 activity categories; `parseAuditCategory('auth', false)` is null; names and the "(removed)" and "(renamed)" marks by `occurredAt`).

Component (`*.test.tsx`, headless Chromium; every gated render uses `WithSession`):
- WP5: `session/SessionContext.test.tsx` (its `../api/index.ts` mock exports `onForbidden`; a forbidden notification refreshes **without unmounting** a child that counts its mounts; a focus within 10 s does not refresh again, but a forbidden notification within 10 s of a focus refresh does; two forbidden notifications during one refresh load the session once; a network failure and an `invalid_response` keep the session; an answer for another member calls `retry`; an unauthenticated answer moves to "Your session has ended"); `features/displays/list/ScreensList.test.tsx` (wrapped as Owner, existing cases unchanged; new: as Viewer with no screens, the text "An editor adds screens."; as Viewer with screens, no "Add screen", no row menu, no selection); `shell/RequirePermission.test.tsx` (new: a Viewer on `/users` and `/screens/new` sees "Your role doesn't allow this"); `shell/PushButton.test.tsx` (new: Viewer sees "3 screens waiting" linking to `/dashboard`; Editor sees the button).
- WP6: `features/displays/detail/ContentCard.test.tsx` (wrapped; as Viewer no Change menu, "Open playlist" stays); `features/displays/detail/DetailsCard.test.tsx` (new: as Viewer, rendered with a non-null changed `draft` so that only the read-only guard stops the save (`submit` sends nothing for an unchanged form, `DetailsCard.tsx:64-67`), Enter in the name field sends no request and there is no Save); `features/displays/detail/CanvasTab.test.tsx` (new: as Viewer, Enter in Width sends no `patchDisplay`; no preset buttons); `features/media/detail/MediaDetailForm.test.tsx` (new: read-only, Enter in the name calls no save); `features/playlists/editor/PlaylistEditor.test.tsx` (new: as Viewer, the note shows, no save bar, no drag handle, no library card, leaving with no warning). `features/playlists/editor/LibraryCard.test.tsx` is unchanged (gating sits in `PlaylistEditor`; it still links because the hooks live in `session/AuthenticatedSession.tsx`, 7.1). A component test whose `vi.mock('…/api/index.ts')` factory still reaches `SessionContext.tsx` (for example through `shell/Page.tsx`, which no package touches) returns `apiClient`, `onUnauthenticated` and `onForbidden` too.
- WP7: `features/users/UsersPage.test.tsx` (new): as Admin, the Owner and Admin rows have no "Actions for …" button and the invite dialog has no Admin card; as Owner, the Owner card is disabled with its reason for a member who never signed in; the own row has no actions; Remove opens with focus on Cancel, names the person and the consequence, and calls `removeMember(id)` and toasts only after it resolves; a `last_owner` answer stays in the role dialog as an alert; the cancel-invite confirm says "Keep invite".

### 9.6 End to end (WP9, written, not run by agents)

`tests/e2e/14-roles.spec.ts` (new; covers ISO-05). Users through `operatorSession(browser, '<key>', { fresh: true })` (`tests/e2e/support/contexts.ts:38-60`); each user has its own TOTP secret.
1. **Viewer:** the dashboard shows no "Push to screens" button (a chip when screens wait); the media page has no "Add media"; the screens list has no "Add screen" (the e2e database has screens, so the empty text never shows); a playlist opens with "You can view this playlist. Editors make changes." and no Save; on a screen's Canvas tab, Enter in Width sends no `PATCH` (recorded with `page.on('request')`; the playlist editor has no `<form>`, so it would prove nothing); `/screens/new` and `/users` show "Your role doesn't allow this"; the account menu has no Users; the audit page's category list has no "Sign-in and sign-out", "Security", "Invites" or "People"; `POST /api/playlists` with the Viewer's own session and CSRF token answers 403 `forbidden`.
2. **Editor:** creates a playlist, uploads an image and pushes to a screen; `/users` shows the refusal; the audit page has no "People" category.
3. **Admin:** `/users` lists the four seeded people; the Owner row has no actions; the invite dialog offers Viewer and Editor only; invites a Viewer ("Waiting for TINNOX" and a reference appear); cancels it ("Keep invite" / "Cancel invite").
4. **Owner (`operator`):** invites an Admin; makes the Editor a Viewer while the Editor's playlist editor is open: the Editor's next save shows "Your session has ended" (a demotion ends sessions); signing in again asks for the password and a fresh one-time code (the step-5 helper); the playlist now opens read-only with no "Push now"; on `/playlists` the header shows the "screens waiting" chip and no `push-button` (the editor pages' header has no push button, `shell/EditorPage.tsx:54`). The Owner then makes that person an Editor again (a promotion ends no session); `page.reload()` brings the push button back.
5. **Sign out everywhere:** the Owner signs the Editor out; the Editor's next request shows "Your session has ended"; "Sign in" goes to Keycloak, which shows a password form although its session is alive, then asks for the one-time code; the Editor is back. Not through `signIn()` (`tests/e2e/support/operator.ts:44` always fills `#username`, which Keycloak may hide here): a new `reauthenticate(page, name)` in `operator.ts` fills `#username` only when present, then the password, then a fresh code (`freshTotp`).
6. **Restore:** the spec ends with the seeded roles restored (Editor is an Editor).
7. Phone width does not scroll sideways (`scrollsSideways`) on `/users`; no CSP violations; no web storage.

Other e2e files: `tests/e2e/01-journey.spec.ts:762` expects the heading "Sign in to TINNOX CMS"; `tests/e2e/11-accessibility.spec.ts` `PAGES` (`:83-99`) gains `['users', () => '/users', 'Users']` and the invite dialog; `tests/e2e/support/database.ts:84` runs the seed with `stdio: ['ignore', 'ignore', 'inherit']` so a seed failure is visible; `tests/e2e/support/portal.ts` gains `openUsers(page)`, `invitePerson(page, name, email, role)`, `changeRole(page, name, role)`, `signOutEverywhere(page, name)`; `tests/e2e/support/operator.ts` gains `OperatorApi.memberIdByName(name)` (through `GET /api/members`) and `reauthenticate(page, name)` (step 5).

---

## 10. Docs (WP10)

| File | Change |
|---|---|
| `docs/portal-v2/stage-c-roles-decision.md` | `:141-145` "The matrix in one sentence each (as recommended)" becomes: **Viewer:** `org.read`, `activity.read`. **Editor:** Viewer plus `content.write`, `content.delete`, `media.delete`, `screen.assign`, `push.publish`, `screen.details`, `screen.hours`, `screen.setup`, `screen.pair`. **Admin:** Editor plus `audit.read`, `member.read`, `member.manage` (over Editors and Viewers only, the rank rule). **Owner:** Admin's keys plus the rank rule over Admins and Owners; `org.rename` and `org.delete` when built. `:3` "Nothing built. The next step is the build spec for PRs C1 and C2." becomes "Build spec: `stage-c.md` (C1 and C2 on one branch). Where the two differ, the build spec is what is built: `restore-owner` is a `provision-member` subcommand, `fulfil` takes `--username`, the trigger fires on `role, removed_at, removed_by` and exempts `session_user = 'tinnox_migrator'`, `pairing` and `player` are activity categories, and the new threat is T17." |
| `docs/decisions-2026-11.md:50` | DEC-35 "Affected docs" adds control-matrix, threat-model, operations checklist, AGENTS.md and BUGBOT.md, prototype-m0 |
| `docs/security/control-matrix.md` | `:21` B1: removed members refused; after removal, demotion or sign-out-everywhere a live Keycloak session cannot sign back in silently (`auth_time` vs `sessions_valid_after`, then `prompt=login`); evidence `verify:oidc`, `migration-0013`, `reauth.test.ts`. `:22` B2: per-member revocation `sec.session_revoke_membership`. `:25` B5: "per member"; every holder of `screen.pair` adds a wrong-code budget. `:64` ISM-2048/2049: four nested roles changed only by someone else under the rank rule; removal, demotion and sign-out-everywhere end sessions in the same transaction; gap: no fresh sign-in before owner actions (deferred, before the first external customer). New row **B16** "Application authorisation" (marked "not from brief section 6"): default-deny route-to-key table, start-up refusal, `assertStillAllowed`, last-owner trigger, rank rule, 403 before lookup, throttled `security.permission_denied`; evidence `roles-matrix.test.ts`, `members.integration.test.ts`, `14-roles.spec.ts`; T17. `:119`: names what CMS-13 adds (member names; work e-mail on pending invites only). `:133`: four roles and B16 instead of "One role only"; T14 covers routine provisioning |
| `docs/security/threat-model.md` | `:15` A3 "Member identity and session … grants what the member's role allows in one organisation". `:23` adds `membership.display_name` and invite name and e-mail while pending; drops "name claims" (ID tokens carry none). `:29` the Operator actor becomes "Member (Owner, Admin, Editor or Viewer)"; new actor "TINNOX staff running provisioning scripts (`tinnox_migrator`, audited as `system`)". `:53` flow 1 adds removed members ignored, `auth_time` vs cut-off, `prompt=login`, `first_signed_in_at`. `:54` flow 2 adds the permission preHandler and `assertStillAllowed`; new flow 8: invite → `provision-member pending` / `fulfil` → first sign-in. `:70` T2 adds the 403-for-every-id reading. `:71` T3: a member with `screen.pair`; more holders, more guesses. `:78` T10: "sign out everywhere" for a lost laptop. `:79` T11: removed members and the `auth_time` rule; memberships only from `fulfil` and `org-create`; the reader client (`view-users`). `:82` T14: provisioning uses `tinnox_migrator` routinely from a controlled host, staff ids typed not proven, `SET LOCAL ROLE tinnox_definer` read of `member_invite`; a dedicated provisioning role deferred. New row **T17** (E) "Privilege escalation inside an organisation" (a write called directly, an Admin granting Admin or Owner, self-change, a stale role during a long upload or push, a smuggled PATCH field, removing the last Owner; mitigations and the residuals: no fresh sign-in before owner actions, a read already running finishes under the old role). New section "14. Stage C: roles and people (2026-11-19)" after section 13 |
| `AGENTS.md` and `.cursor/BUGBOT.md` (together, word for word) | §1 `tinnox_migrator` (`AGENTS.md:16`, `BUGBOT.md:14`): "…only runs migrations and TINNOX's provisioning script (`scripts/provision-member.ts`) from a controlled host; both refuse any other role. Its credentials, and the provisioning reader secret, never reach the API, the media worker or the player." §1 `tinnox_definer` (`:17`, `:15`): names its 0013 grants (`UPDATE (first_signed_in_at, sessions_valid_after)` on `membership`; the script-only `member_invite` read and `UPDATE (status)`). §2 (`:23`, `:21`): append "A refusal by role is decided before any lookup and is the same 403 for every id (DEC-35)." |
| `docs/security/operations-and-release-checklist.md` | `:38` "Member account or session suspected stolen": first an Owner or Admin uses "Sign out everywhere" or removes the person (sets the cut-off); the script stays for when nobody in the customer can act, and now sets the cut-off too. `:66`, `:296`: member names and invite e-mail addresses. `:251`: audit rows carry no names; names come from `membership` at read time. `:254`: membership holds a display name; removed members stay; period for a removed member's name NEEDS TINNOX INPUT (DEC-18). New retention row `member_invite`: name and work e-mail while pending, cleared on fulfil, cancel or expiry (14 days, daily `pending`). `:299`: `mfa-reset` and `restore-owner` are the pilot recovery path. New subsection "Membership operations": the daily `provision-member pending`; `fulfil` with `--confirmed-with` after confirming the person with the requester and sending username and temporary password by different channels; the weekly check of removed members against enabled identity-provider accounts; the identity check before a password or authenticator reset (confirm with another active Owner or Admin first), then `mfa-reset`; `restore-owner` with two different staff ids on a written request; the controlled-host rule |
| `docs/acceptance-tests.md` | `:31` ISO-05 on four roles: Viewer refused every write including push, screen set-up and pairing (hidden in the UI, 403 from the API); Editor allowed content, push, screen set-up and pairing, refused the Users page, invites and the full audit log (sees the filtered log); Admin invites Editors and Viewers only; only an Owner grants Admin or Owner; the last Owner cannot be demoted; "billing" dropped (DEC-27); the site step waits for `site.manage`; covered by `tests/e2e/14-roles.spec.ts`. `:32` ISO-06 marked DEFERRED (DEC-35). `:180` notes ISO-06 deferred |
| `docs/tinnox-mvp-spec.md` | `:32` displays are Editor work. `:52` four nested roles, one per person; site scoping deferred. `:95` membership = role, display name, removed; Invite added; one organisation per person in release 1. `:113` "Editor or above". `:150-151` invite requests completed by TINNOX in the pilot (self-service later, CMS-20); no site scope; screens set up by Editors and up. `:162` "the first Owner (two advised; `provision-member org-create`)". §8 `:219` Editor = yes (screens, pairing, revoking; sites with `site.manage`); `:220` Admin: Editors and Viewers only; `:222` no transfer action: handover by promotion (D1 a); `:229` full log Admin and Owner, filtered for Editor and Viewer. `:231`, `:233` site scoping deferred; role rules. `:258` adds the role-403 reading |
| `docs/implementation-backlog.md` | `:104` H2 split: roles and invites (CMS-13, ISO-05); new rows H2b site scoping (ISO-06, M) and H2c several organisations per person (M); no transfer action (D1 a). `:39` "first Owner (one or two)" |
| `docs/prototype-m0.md` | `:99` adds "Stage C (CMS-13, DEC-35): four nested roles; today's operators became Owners"; `:111` memberships from `provision-member` and the seed's one member per role; `:137` the `otp --as` choice |
| `docs/portal-v2/README.md:27` | roles and users decided (DEC-35) with this build spec; no status or PR numbers (status lives in STATUS.md) |
| `docs/dev-handoff.md` | `:17`, `:28` the development users; `:55` the new `.env` keys; `:132` `membership` grants after 0013 and the `member_invite` row; `:231` the five subjects and `verify:oidc` |
| `docs/manual-test-plan.md` | `:93` heading "Sign in to TINNOX CMS"; `:106`, `:109`, `:725-736` usernames and `otp --as`; `:151`, `:763` "Person signed in" and names in activity; `:33`, `:746` Users no longer planned; a new "Roles" pass, one per role |
| `README.md` | `:29` one member per role; `:55-56` the five users and `npm run otp -- --as`; `:63` sign in as the Owner, one line on the other roles; `:106` "roles and members"; the DEC count lines `:126`, `:162`, `:224` |
| `apps/portal/README.md` | `:29-34` permission gating (`useCan`, hidden controls, 403 → message and silent refresh, refresh on focus); `:62-72` `features/users`, `planned` no longer serves `/users` |
| `apps/portal/src/ui/README.md` | `:979`, `:994` (Users only with `member.read`; Audit log for everyone, filtered without `audit.read`); `:1028` `/users` → `features/users/UsersPage.tsx`; shell table: `ForbiddenPage`, `RequirePermission`; "Notes for the Users page" like the Layouts notes |
| `apps/portal/src/features/shared/README.md` | `allowCreate` on `TagChecklist`, `TagPicker`, `TagsDialog`, `MoveToFolderDialog`; `ReadOnlyNote` |
| `apps/portal/src/features/push/README.md` | the dialog never opens without `push.publish`; the header chip |
| `tests/README.md` | `14-roles.spec.ts`; the new integration files; the five development users |
| `docs/portal-v2/stage-c.md` | after the build, "As built" (as stage B slices do) |

---

## 11. Work packages (file ownership does not overlap between packages)

- **Wave 1 / WP1 Contracts and domain** (sections 1, 3, 4). 12 files.
  - `packages/contracts/src/{session.ts, members.ts (new), ids.ts, limits.ts, errors.ts, routes.ts, audit.ts, index.ts, roles.test.ts (new)}`.
  - `packages/domain/src/{permissions.ts (new), permissions.test.ts (new), index.ts}`.
  - Publish `session.ts`, `members.ts` and `permissions.ts` first, with the exact names above.
- **Wave 1 / WP2 Migration 0013 and the database package** (sections 2, 5, 9.3). 11 files.
  - `db/migrations/0013_roles_and_members.sql` (new).
  - `packages/db/src/{sec.ts, members.ts (new), constraints.ts, index.ts}`.
  - `packages/db/test/{migration-0013.integration.test.ts (new), sec.integration.test.ts, rls.integration.test.ts, migration-0005.integration.test.ts (table list only; never `:130`), migration-0012.integration.test.ts (`:176-178` only), support.ts}`.
- **Wave 2 / WP3 API: guard, sign-in, writes** (6.1 to 6.6, 6.8; 9.4 except members and cross-org). 28 files.
  - `apps/api/src/{app.ts, auth/permissions.ts (new), auth/permission-audit.ts (new), auth/oidc.ts, routes/auth.ts, routes/audit.ts, routes/displays.ts, routes/media.ts, routes/apps.ts, routes/schedules.ts, routes/layouts.ts, routes/playlists.ts, routes/tags.ts, routes/folders.ts, routes/push.ts}`.
  - `apps/api/src/auth/{permissions.test.ts (new), write-guard.test.ts (new), oidc.test.ts}`.
  - `apps/api/test/{support.ts, roles.integration.test.ts (new), upload.integration.test.ts}`.
  - `tests/integration/{routes.ts (new), session-csrf.test.ts, roles-matrix.test.ts (new), reauth.test.ts (new), credential-audit.test.ts, backup-restore-check.test.ts, migration-backfill.test.ts (one assertion; never `:168`)}`.
  - **Writes `auth/permissions.ts` and `auth/permission-audit.ts` first**: WP4 imports `withOrgAllowed`, `PermissionDeniedError`, `recordPermissionDenied`, `parseRole`; `app.ts` imports `registerMemberRoutes` from `./routes/members.ts` (WP4).
- **Wave 2 / WP4 API: people routes** (6.7; members and cross-org tests). 3 files.
  - `apps/api/src/routes/members.ts` (new), `apps/api/test/members.integration.test.ts` (new), `tests/integration/cross-org.test.ts`.
  - **Writes `routes/members.ts` first**: it exports `registerMemberRoutes`, which registers all eight routes; handlers may throw until they are done. Until it exists, `app.ts` does not typecheck, and `checkRouteTable` (an entry with no route) stops `startTestApp`, so this lands before WP3 runs any typecheck or integration file.
- **Wave 2 / WP5 Portal: session, shell, lists, push** (7.1, 7.2). 54 files, all under `apps/portal/src/`.
  - `session/{SessionContext.tsx, SessionContext.test.tsx, AuthenticatedSession.tsx (new), session.test-support.tsx (new)}`; `api/{client.ts, client.test.ts, index.ts, upload.ts}`; `lib/{authError.ts (new), authError.test.ts (new), dashboard.ts, dashboard.test.ts, pushDialog.ts, pushDialog.test.ts, settingsView.ts, settingsView.test.ts}`; `App.tsx`; `shell/{ForbiddenPage.tsx (new), RequirePermission.tsx (new), RequirePermission.test.tsx (new), AccountMenu.tsx, nav.ts, nav.test.ts, PushButton.tsx, PushButton.test.tsx (new), Screens.tsx}`; `ui/ErrorNotice.tsx`.
  - `features/push/{PushContext.tsx, PushDialog.tsx}`; `features/dashboard/{DashboardPage.tsx, PushCard.tsx, SetupCard.tsx}`; `features/media/library/{MediaLibrary.tsx, MediaRowMenu.tsx, FolderChips.tsx, useUploadQueue.ts}`; `features/shared/{TagChecklist.tsx, TagPicker.tsx, TagsDialog.tsx, MoveToFolderDialog.tsx, ScreenPickerDialog.tsx}`; `features/apps/AppsPage.tsx`; `features/playlists/{PlaylistsPage.tsx, list/PlaylistRowMenu.tsx, list/AssignToScreens.tsx}`; `features/schedules/SchedulesPage.tsx`; `features/layouts/LayoutsPage.tsx`; `features/displays/list/{ScreensList.tsx, ScreenRowMenu.tsx, ScreensList.test.tsx}`; `features/settings/{SettingsPage.tsx, TagsPage.tsx}`; `features/planned/PlannedPage.tsx`; `features/styleguide/SurfaceSections.tsx`.
  - **Writes `session/AuthenticatedSession.tsx` (`useCan`, `useCanAtMount`), `session.test-support.tsx` and the `allowCreate` props first**: WP6 and WP7 code against them.
- **Wave 2 / WP6 Portal: read-only editors and the screen page** (7.3). 31 files, under `apps/portal/src/`.
  - `features/shared/ReadOnlyNote.tsx` (new); `ui/Segmented.tsx`.
  - `features/media/detail/{MediaEditor.tsx, MediaDetailForm.tsx, MediaDetailForm.test.tsx (new), MediaDetailsCard.tsx, MediaPendingView.tsx}`; `features/apps/AppEditor.tsx`.
  - `features/playlists/editor/{PlaylistEditor.tsx, PlaylistEditor.test.tsx (new), SequenceCard.tsx, SequenceTile.tsx, DetailsCard.tsx, PushCard.tsx}`.
  - `features/schedules/{ScheduleEditor.tsx, ScheduleEventRow.tsx}`; `features/layouts/LayoutEditor.tsx`.
  - `features/displays/detail/{ScreenDetail.tsx, ScreenTabs.tsx, SummaryCard.tsx, DetailsCard.tsx, DetailsCard.test.tsx (new), ContentCard.tsx, ContentCard.test.tsx, CanvasTab.tsx, CanvasTab.test.tsx (new), PairingTab.tsx, TagsTab.tsx, WorkingHoursTab.tsx}`; `features/displays/wizard/{ContentStep.tsx, PairStep.tsx}`.
- **Wave 2 / WP7 Portal: Users page, names, audit** (7.4, 7.5). 22 files, under `apps/portal/src/`.
  - `features/users/{UsersPage.tsx, InvitesCard.tsx, InviteDialog.tsx, RoleDialog.tsx, NameDialog.tsx, RoleChoices.tsx, users.css, UsersPage.test.tsx}` (new).
  - `lib/{users.ts (new), users.test.ts (new), activity.ts, activity.test.ts, auditView.ts, auditView.test.ts}`; `api/{endpoints.ts, endpoints.test.ts}`; `features/audit/{AuditPage.tsx, AuditDetailDialog.tsx, useAuditNames.ts}`; `features/dashboard/{ActivityCard.tsx, useActivityNames.ts}`; `ui/icons.ts`.
  - **Writes the `api/endpoints.ts` methods and `features/users/UsersPage.tsx` exporting `UsersPage` (a stub page is enough) first**: WP5's Settings row calls `api.listMembers`, and WP5's `App.tsx` imports the page.
- **Wave 2 / WP8 Scripts and development setup** (section 8). 15 files.
  - `scripts/{seed.ts, setup-dev.mjs, otp.mjs, verify-oidc-login.mjs, provision-member.ts (new), lib/provision.ts (new), lib/provision.test.ts (new), lib/idp.ts (new), revoke-subject-sessions.sql}`; `infra/keycloak/realm-template.json`; `.env.example`; `package.json` (one script line); `tests/support/dev-identity.ts`; `tests/integration/{provision-member.test.ts (new), session-revoke-all.test.ts}`.
- **Wave 3 / WP9 End to end** (9.6). 6 files, written, not run.
  - `tests/e2e/{14-roles.spec.ts (new), 01-journey.spec.ts, 11-accessibility.spec.ts}`, `tests/e2e/support/{database.ts, portal.ts, operator.ts}`.
- **Wave 3 / WP10 Docs** (section 10). 21 files: every file listed there, nothing else.

Total: 203 files (46 new).

**Checks per package are scoped to what the package owns** (as stage B slice 4, `stage-b.md:2789-2794`). WP1 changes `ROLES`, the session `user` object and `AUDIT_ACTIONS`; WP2 changes the `sessionCreate` signature and drops the role default. After Wave 1 the root typecheck is red in `apps/api`, `apps/portal`, `tests` and `scripts` until WP3 to WP8 land, and every integration file that signs in fails until WP3's `support.ts` lands. No package can make the root commands green alone, so none runs them as its gate:
- Typecheck, own workspaces only: WP1 `npm run typecheck -w @tinnox/contracts -w @tinnox/domain`; WP2 `-w @tinnox/db`; WP3 and WP4 `-w @tinnox/api`; WP5, WP6, WP7 `-w @tinnox/portal`; WP8 `npx tsc -p scripts/tsconfig.json`. Files under `tests/` are the `@tinnox/tests` workspace: WP3, WP4, WP8 and WP9 also run `npm run typecheck -w @tinnox/tests` and answer for the errors in their own files.
- Unit tests by path: `npx vitest run --project unit <own files or folders>`.
- Component tests by path (WP5, WP6, WP7): `npx vitest run --project component <own *.test.tsx files>` (headless Chromium; if it is not installed, say so in the hand-back).
- Lint by path: `npx eslint --max-warnings=0 <own files or folders>`.
- Integration by file, one agent at a time (a shared `tinnox_test`): WP2 `npx vitest run --project integration packages/db/test/migration-0013.integration.test.ts` and its other owned files; WP3, WP4, WP8 their own files. WP2's files need only WP1 and WP2. WP3, WP4 and WP8 run their integration files only after WP2, WP3's `support.ts`, `app.ts` and `auth/permissions.ts`, and WP4's `routes/members.ts` have landed (every API and repository integration file builds the app, and WP8's `session-revoke-all.test.ts` uses `createOrg` and `signIn`).
- **A failure in a file the package does not own is expected. Report it (file, line, message) in the hand-back; do not fix it.** WP5, WP6 and WP7 each report zero portal typecheck errors in their own files and list the rest.

**Integration step (the orchestrator, after Wave 2 and before Wave 3):** run the root `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:component`, then `npm run test:integration` once (the `_test` database rebuilt from 0001 to 0013), and `npm run format:check`. The orchestrator owns every failure in a file no package listed, and hands a failure in an owned file back to its package.

Nobody runs the e2e suite or `verify:oidc`, starts or stops the dev stack, migrates the development database, commits, pushes or switches branches.

---

## 12. Deferred (recorded, not dropped)

| Deferred | Why it is safe now | What keeps it cheap later |
|---|---|---|
| Fresh sign-in before owner actions (granting Admin or Owner, removing someone) | MFA sessions, 30-minute idle limit, every action audited, demotion and removal sign the target out | `auth_time` is read at sign-in now. **Do it before the first external customer** |
| Retiring `POST /api/playlists/:id/publish` | All-of entry `push.publish` + `screen.assign` | A cleanup card moves test and script helpers to assign plus `POST /api/push` |
| A dedicated database role for provisioning | Scripts run as `tinnox_migrator` from a controlled host (T14) | A login role with column grants and no `DELETE`; the `session_user` exemptions move to it |
| Refusing migrator and provisioning variables in the API's production start-up | The controlled host holds them; the dev API already loads the whole `.env` | One check in `apps/api/src/config.ts` (`:290-310`) with a `production-refusal` test |
| Site scoping, several organisations per person, Contributor role, TINNOX support grants (H1) | As the record's Deferred table (`stage-c-roles-decision.md:362-379`) | As stated there |
| Self-service sign-up and invites without TINNOX (CMS-20) | TINNOX completes invites by hand | The same tables, routes and page; only who completes steps 2 and 3 changes |
| "Last sign-in" column; purge of removed members' names | Not security-relevant; DEC-18 input needed | `auth.login` rows; `display_name` can be overwritten |
| Per-action activity filter (show `player.revoke`, hide `pairing.lock`) | Category filter; Editors pair anyway | Split `ACTIVITY_CATEGORIES` into actions |

Every `// shortcut:` this build adds: a push refused part-way answers 403 without the results so far (`routes/push.ts`); the activity filter works per category (`routes/audit.ts`); the permission-denied throttle is in memory, per process (`auth/permission-audit.ts`); the focus refresh is throttled to 10 s (`SessionContext.tsx`); read-only is decided at mount (`useCanAtMount`); 100 pending invites per organisation (`routes/members.ts`).

---

## 13. Risks

1. **Deploy order and stale tabs.** 0013 drops the five-argument `sec.session_create`, so an API from before 0013 cannot sign anyone in after it, and the new API cannot run before it. A portal tab on the previous build parses the session strictly (`apps/portal/src/api/client.ts:305`) and shows `invalid_response` until reloaded. Mitigation: the release note.
2. **Keycloak and `prompt=login`** (unverified pending runtime, `verify:oidc` step 2). If Keycloak ignored `prompt=login` while its SSO cookie lives, the loop guard stops after one forced attempt (`reauth_failed`), and the person can sign in only after the Keycloak session ends (idle 30 minutes, `realm-template.json:28`) or staff end it. Cognito's `auth_time` and `prompt=login` are unverified (A3).
3. **A write that skips the check.** 28 call sites change by hand. `write-guard.test.ts` counts them per file; `roles-matrix.test.ts` refuses every write for a Viewer.
4. **42501 means 404.** A missing column grant would make every write answer 404 silently (`errors.ts:159-163`). `migration-0013` pins the grants; every integration file writes as an Owner.
5. **Lock waits.** `tinnox_app` has `lock_timeout = 5s`: a write waiting longer on a member change answers 503. Member changes are short.
6. **Clock skew** between Keycloak and PostgreSQL: a genuine re-authentication can look older than the cut-off by a second and be refused once (`reauth_failed` says sign in again).
7. **Routine provisioning as `tinnox_migrator`** (T14, now used daily); two staff ids are typed, not proven.
8. **Display names unique including removed members:** a different person with a removed member's name needs another name at `fulfil` (the script says so). The same person coming back keeps their row and name.
9. Developer machines: new users need a Keycloak container recreate and a re-seed (setup prints the command). CI is fresh every run.

---

## 14. Defaults used (settled before this spec; the build uses them as stated)

| # | Default | Reason |
|---|---|---|
| 1 | One branch for C1 and C2; packages in waves; 0013 holds everything | `member_invite` and the membership UPDATE grants are used by routes of the same build, and a merged migration is never edited |
| 2 | Activity categories: display, pairing, player, media, tag, folder, app, playlist, schedule, layout, publication; auth, security, invite, membership need `audit.read` | Editors pair and revoke, so they must see those events |
| 3 | `auth_time` from the verified ID token (seconds), passed as `timestamptz` (NULL allowed); a cut-off needs `auth_time >= date_trunc('second', cut-off) + 1 s`, else `reauth`; `session_create` returns an outcome and locks the member row `FOR NO KEY UPDATE`; `prompt=login` once, then `authError=reauth_failed` | A revocation and a sign-in cannot interleave, and a provider that does not re-authenticate cannot loop the browser |
| 4 | `display_name` nullable, 1-120, unique per organisation on `lower()` including removed members; session gains `membershipId`, `role`, `displayName`, `permissions`; the portal shows the role label for a null name, activity "Unnamed person" | Existing rows have no name; old activity must stay readable; the Users page needs the caller's own id (D7) |
| 5 | `assertStillAllowed(tx, session, keys)` with `FOR SHARE`, returns the role; removed or sessions ended after the session began → 401, missing key → 403; 55P03 in a write → 503 `service_unavailable` (exists), mapped by the wrappers; never 42501; audit-only and read transactions exempt; one wrapper (`withOrgAllowed`) | No write commits under a role or a session already taken away; 42501 would read as 404 |
| 6 | `PERMISSION_KEYS` active only, reserved keys in a comment; `ROLES` and keys in contracts; the table, `can` and `canManage` in domain | The session schema needs the enums; contracts cannot import domain |
| 7 | A push refused part-way answers 403; pushed screens stay pushed; documented, not caught | Consistent with "no write under a removed role"; the audit rows record what happened |
| 8 | `sec.pairing_complete` also requires the claimer not to be removed | Closes the claim window after a removal |
| 9 | `actor_type 'operator'` reads "Person" | The spec uses "Operator" for TINNOX staff |
| 10 | `tests/e2e/14-roles.spec.ts` is part of this build | ISO-05 coverage |
| 11 | The sign-in page reads `?authError=` and explains every code | Today a removed member sees a plain sign-in card |
| 12 | Read-only decided at mount. A demotion through the Users page ends the session (401, "Your session has ended"); a 403 "Your role doesn't allow this." on save appears only when a write was already past the session check, with a silent refresh that keeps the router mounted | `retry()` unmounts every page and loses drafts |
| 13 | `operator` stays Owner of organisation 1, `secondOrgOperator` Owner of organisation 2; admin, editor and viewer users added; setup merges users and asks for a Keycloak re-import; the seed avoids name clashes | Every e2e spec and script defaults to `operator` |
| 14 | `security.permission_denied` in its own transaction after the refusal, throttled per member as B6 really works (first and limit rows); refused member changes always written | Nothing changed, as `security.csrf_rejected`; bounded rows |
| 15 | Script exemptions test `session_user = 'tinnox_migrator'` | Scripts run `SET LOCAL ROLE tinnox_definer`, where `current_user` is the definer |
| 16 | Last-owner trigger: 23001 with constraint `membership_last_owner` → 409 `last_owner`; fires on `UPDATE OF role, removed_at, removed_by OR DELETE` | A dedicated code the API maps; `removed_by` in the list so "never changes once set" holds |
| 17 | Read-only forms cannot submit (every handler and Enter path returns early); the file drop stays mounted and ignores files | Hiding buttons does not stop Enter, and a dropped file would leave the portal |
| 18 | `AUDIT_CATEGORIES` equals the categories of `AUDIT_ACTIONS`; invite, membership and `security.permission_denied` added with unique wording | `portal-v2.test.ts:1331-1334` |
| 19 | Deploy: stop the API, run 0013, start the new API and portal together | 0013 drops the old `session_create` signature |
| 20 | Fix the record's stale "matrix in one sentence each" in this build | It contradicts the matrix and DEC-35 |

## 15. Choices made by this spec (the inputs did not settle them)

| # | Choice | Why |
|---|---|---|
| 1 | Loop guard: a second HMAC label (`login-state-reauth`) for the forced login's state key; the callback tries it first. No `max_age`, no schema change | How login state is stored today (`routes/auth.ts:46-50`); map 02 option 1 |
| 2 | `assertStillAllowed` takes a `Requirement` (`{ all }` or `{ any }`); tag PATCH and DELETE start with the any-of keys and check the stored scope on the returned role | The scope is known only after a read inside the transaction; one lock, check first |
| 3 | `withOrgAllowed` and `withOrgDecisionAllowed` map a 55P03 raised anywhere in their transaction to 503 (a write that waited too long on any lock answered 500 before); `lockOrgMembership` throws the pg error (`@tinnox/db` cannot build `HttpError`); the callback maps it to `provider_unavailable`; the global handler keeps 55P03 as 500 | Reads and the other routes do not change |
| 4 | "Renamed" mark backed by `membership.display_name_changed_at`, stamped by a trigger; events before it show "(renamed)" | The record asks for the mark; the client cannot read `membership.update` rows without `audit.read`; 0013 cannot be edited later |
| 5 | Throttle: `AuthFailureGuard` keyed by membership id, 20 per 10 minutes, one per `AppContext` in a `WeakMap` | Reuses B6 code; no `AppContext` change |
| 6 | A 401 inside a write (removed, or sessions ended) is not written as `security.permission_denied` | The removal or sign-out is audited; 401 is not a role refusal |
| 7 | `restore-owner` is a `provision-member` subcommand; `fulfil` takes `--username`; the IdP is read by a `tinnox-provisioning` client with `view-users` only | The successor path needs an IdP read; the record's `fulfil` had no way to name the account; least privilege |
| 8 | Invites: at most 100 pending per organisation; name and e-mail clashes answer 409 `conflict` with a field path; the name is checked against active members and pending invites only | A field-level error; a returning person keeps their name |
| 9 | Owner promotion before a first sign-in: 409 `conflict` with detail code `not_signed_in_yet` | No new top-level error code |
| 10 | `member_invite` grants narrower than the record: the guard sets `closed_at`, so `tinnox_app` gets `UPDATE (status, closed_by)` and the definer `UPDATE (status)`; the definer's SELECT adds `invited_by` and `created_at` | AGENTS.md §1 least privilege; `pending` orders by age |
| 11 | Extra database guards: `membership_not_removed_by_self`, `session_membership_idx` | D7 backstop; an index for the per-member revocation |
| 12 | The sign-in heading "Operator sign-in" becomes "Sign in to TINNOX CMS" | Customers would read "Operator", the TINNOX staff role |
| 13 | `revoke-subject-sessions.sql` also sets the cut-off | Its own `:6` warns about the silent sign-back-in; the definer has the grant now |
| 14 | Dev usernames `org-admin`, `editor`, `viewer`; display names "Dev Owner" and so on; the seed appends the subject's first 8 characters when a name is taken | Avoids `dev-admin`; re-seeds never fail |
| 15 | New threat T17 (T11 is taken) | `threat-model.md:79` |
| 16 | `GET /api/invites` lists expired-but-pending invites; the portal shows "Expired, TINNOX will close it" | Honest status until the daily run |
| 17 | `roles-matrix.test.ts` uses an oracle written in the test, not the API's table | A wrong table would otherwise test itself |
| 18 | An unknown role string: the guard refuses (403) and `GET /api/session` answers unauthenticated | Fail closed |

### Self-check against the requested list

- **Files and names:** every file per package in section 11; signatures in 3 to 8.
- **SQL:** 0013 near-full in section 2 (two functions copied from 0010 with the stated one-block changes).
- **Role-to-key table:** 1.3. **Route-to-key table:** 6.1, 59 rows. **Portal controls:** 7.2 and 7.3 with keys and files.
- **Tests:** 9, per package, with the fixtures to change and the three that must not.
- **AGENTS.md:** `tinnox_app` gains only the four membership columns and the invite grants, justified in the header; the definer's new reads are script-only; every tenant query in `withOrg`; no route reads an organisation id; `member_invite` forced, with a policy, composite foreign keys and RLS and cross-org cases; every change audited on the same `Tx` (the denial row is the documented exception: nothing changed); 0001 to 0012 untouched; `sec.*` functions pin `search_path`, revoke PUBLIC and grant `tinnox_app` only, under `SET LOCAL ROLE tinnox_definer` … `RESET ROLE`.

#### Critical files for implementation
- `db/migrations/0013_roles_and_members.sql` (new)
- `apps/api/src/auth/permissions.ts` (new) and `apps/api/src/routes/members.ts` (new)
- `apps/api/src/routes/auth.ts`
- `packages/domain/src/permissions.ts` (new) and `packages/contracts/src/session.ts`
- `apps/portal/src/session/SessionContext.tsx`
- `scripts/provision-member.ts` (new)

### Release note and rollback

- Release note: **stop the API, migrate, then start the new API and portal together.** Every existing person becomes an Owner; nothing changes for them on the day. **Reload open portal tabs** after the deploy: a tab on the previous build cannot read the new session and says `invalid_response`. TINNOX names each existing member once with `npm run provision -- set-name …`; until then the portal shows the role label. Developers: `npm run setup`, recreate the Keycloak container (the command setup prints), `npm run db:migrate`, `npm run db:seed -- --second-org`.
- Operations, in order: rebuild (`npm run build`); stop the API; apply 0013 (`npm run db:migrate`; ACCESS EXCLUSIVE on `membership` until commit, a moment on a small table); start the API and the portal; on the controlled host, run `provision-member set-name` for every existing member; run `verify:oidc` against the realm in use.
- Rollback: rolling 0013 back is not supported. Read from the code, not run: the previous API cannot sign anyone in on the migrated database (`sec.session_create` has six arguments), its `GET /api/session` would still answer `role: 'operator'` against a contract the new portal refuses, and its seed and test fixtures insert roles the new CHECK refuses. Roll forward instead. If the role check itself misbehaves, a hot fix can widen an entry in `ROUTE_PERMISSIONS` (one line) without a migration.
