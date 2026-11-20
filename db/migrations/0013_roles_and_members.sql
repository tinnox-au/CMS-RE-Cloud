-- 0013: roles and members (CMS-13, DEC-35; docs/portal-v2/stage-c.md). 0001 to 0012 are unchanged.
--
--   1. membership: four roles; today's 'operator' rows become 'owner' (D4 a); display name,
--      removal, first sign-in (filled from the session rows still kept) and the session cut-off.
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
-- Locks and deploy order. Takes ACCESS EXCLUSIVE on membership and session until commit, which
-- waits for every API request (sec.session_by_id_hash reads both). It drops the five-argument
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
  -- Written by sec.session_create only, after the one-time fill below; reactivation by
  -- provision-member fulfil clears it.
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

-- Row-level security is forced, so even the owner sees no membership or session rows without an
-- organisation context, and these two statements span every organisation. FORCE is lifted for
-- them and restored at once, inside this transaction, as 0005:179-201 does: no other session
-- ever sees the tables without it, and tinnox_app stays subject to the policy.
ALTER TABLE public.membership NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.session NO FORCE ROW LEVEL SECURITY;
UPDATE public.membership SET role = 'owner' WHERE role = 'operator';
-- A member who signed in before 0013 has signed in: first_signed_in_at becomes their earliest
-- session row. Only sec.session_create ever wrote one, after a verified sign-in. Sessions are
-- purged a day after they end (0004), so a member whose last sign-in is older stays NULL until
-- the next one. The audit log is not read: tinnox_app can write it, and no permission decision
-- reads it (stage-c-roles-decision.md, "Known residuals"; control-matrix.md:31).
UPDATE public.membership m
SET first_signed_in_at = s.first_at
FROM (SELECT membership_id, org_id, min(created_at) AS first_at
      FROM public.session GROUP BY membership_id, org_id) s
WHERE m.id = s.membership_id AND m.org_id = s.org_id;
ALTER TABLE public.session FORCE ROW LEVEL SECURITY;
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
-- sessions_valid_after; sec.pairing_complete share-locks the claimer's row.
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

-- Same contract as 0010, plus: a removed member cannot claim (42501, as for a member of
-- another organisation). Same signature and OUT columns, so owner and grants stay. It checks
-- no role: the route and the in-write check decide who may pair, so moving screen.pair stays a
-- one-line change.
CREATE OR REPLACE FUNCTION sec.pairing_claim(
  p_code text, p_display_id uuid, p_membership_id uuid, p_max_failures integer, p_window_seconds integer)
  RETURNS TABLE (outcome text, pairing_id uuid, replaced_registration_id uuid, cancelled_pairing_ids uuid[])
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_org uuid := public.app_org_id();
  v_failures integer;
  v_pairing uuid;
  v_replaced uuid;
  v_cancelled uuid[];
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'pairing_claim requires an organisation context' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_max_failures IS NULL OR p_max_failures < 1 OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid claim limits' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM 1 FROM public.membership m
  WHERE m.id = p_membership_id AND m.org_id = v_org AND m.removed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership does not belong to the current organisation' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1 FROM public.display d WHERE d.id = p_display_id AND d.org_id = v_org;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'display_not_found'::text, NULL::uuid, NULL::uuid, NULL::uuid[];
    RETURN;
  END IF;

  -- One claim per operator at a time, until commit: counting the failures and recording
  -- this one are then a single step, across connections and API processes (SCX-05).
  -- Taken after the membership check, so the key is a verified member of this organisation.
  PERFORM pg_advisory_xact_lock(hashtextextended('tinnox.pairing_claim:' || p_membership_id::text, 0));

  DELETE FROM public.pairing_claim_failure f WHERE f.failed_at < now() - interval '1 day';
  SELECT count(*) INTO v_failures FROM public.pairing_claim_failure f
  WHERE f.membership_id = p_membership_id AND f.failed_at > now() - make_interval(secs => p_window_seconds);
  IF v_failures >= p_max_failures THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::uuid, NULL::uuid, NULL::uuid[];
    RETURN;
  END IF;

  -- One claim or cancellation per display at a time (the same lock as
  -- sec.pairing_cancel_claims), so two claims cannot both miss each other (SCX-01).
  PERFORM pg_advisory_xact_lock(hashtextextended('tinnox.pairing_display:' || p_display_id::text, 0));

  UPDATE public.pairing_session ps
  SET status = 'claimed', org_id = v_org, display_id = p_display_id,
      claimed_at = now(), claimed_by_membership = p_membership_id,
      -- give the player time to collect its credential even if the code was about to expire
      expires_at = greatest(ps.expires_at, now() + interval '2 minutes')
  WHERE ps.code = p_code AND ps.status = 'pending' AND ps.expires_at > now()
  RETURNING ps.id INTO v_pairing;

  IF v_pairing IS NULL THEN
    INSERT INTO public.pairing_claim_failure (membership_id) VALUES (p_membership_id);
    RETURN QUERY SELECT 'invalid_code'::text, NULL::uuid, NULL::uuid, NULL::uuid[];
    RETURN;
  END IF;

  -- The newest claim is the only one that can complete: older claims of this display
  -- that were never collected are cancelled. Pairing rows are locked before
  -- registration rows, the order sec.pairing_complete uses.
  WITH cancelled AS (
    UPDATE public.pairing_session ps SET status = 'expired'
    WHERE ps.display_id = p_display_id AND ps.org_id = v_org AND ps.status = 'claimed'
      AND ps.id <> v_pairing
    RETURNING ps.id
  )
  SELECT coalesce(array_agg(cancelled.id), '{}') INTO v_cancelled FROM cancelled;

  -- The new player replaces any player currently registered to the display.
  UPDATE public.player_registration pr
  SET revoked_at = now(), revoked_reason = 'replaced'
  WHERE pr.display_id = p_display_id AND pr.org_id = v_org AND pr.revoked_at IS NULL
  RETURNING pr.id INTO v_replaced;

  RETURN QUERY SELECT 'claimed'::text, v_pairing, v_replaced, v_cancelled;
END $$;

-- Same contract as 0010, plus: the member who claimed the code must still be in the
-- organisation and the claim must be later than their session cut-off, so a removal (even one
-- later undone) closes the window between a claim and its collection. Same signature and OUT
-- columns, so owner and grants stay.
CREATE OR REPLACE FUNCTION sec.pairing_complete(p_pairing_id uuid, p_polling_token_hash bytea, p_device_token_hash bytea)
  RETURNS TABLE (outcome text, registration_id uuid, org_id uuid, display_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v public.pairing_session%ROWTYPE;
  v_registration uuid;
BEGIN
  SELECT * INTO v FROM public.pairing_session ps
  WHERE ps.id = p_pairing_id AND ps.polling_token_hash = p_polling_token_hash
    AND ps.status = 'claimed' AND ps.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_claimable'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- The member who claimed the code must still be in the organisation (0013), and a claim
  -- made before their sessions were ended (removal, demotion, sign out everywhere, mfa-reset,
  -- the owner recovery that replaces an Owner, the incident script) never completes; a
  -- promotion ends no session. A reactivation keeps the cut-off, so a claim from before a
  -- removal stays dead. Both are database times and every cut-off is stamped after the member
  -- lock, so a claim that committed first is earlier; a tie is refused. FOR SHARE waits for a change that is committing and re-reads the row (the
  -- definer's 0013 UPDATE grant allows the lock). Order: pairing row, then member row; a
  -- member change never locks pairing rows.
  PERFORM 1 FROM public.membership m
  WHERE m.id = v.claimed_by_membership AND m.org_id = v.org_id AND m.removed_at IS NULL
    AND (m.sessions_valid_after IS NULL OR v.claimed_at > m.sessions_valid_after)
  FOR SHARE;
  IF NOT FOUND THEN
    UPDATE public.pairing_session ps SET status = 'expired' WHERE ps.id = v.id;
    RETURN QUERY SELECT 'not_claimable'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  PERFORM 1 FROM public.player_registration pr
  WHERE pr.display_id = v.display_id AND pr.org_id = v.org_id AND pr.revoked_at IS NULL;
  IF FOUND THEN
    UPDATE public.pairing_session ps SET status = 'expired' WHERE ps.id = v.id;
    RETURN QUERY SELECT 'not_claimable'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.player_registration AS pr (org_id, display_id, token_hash)
  VALUES (v.org_id, v.display_id, p_device_token_hash)
  RETURNING pr.id INTO v_registration;

  UPDATE public.pairing_session ps
  SET status = 'completed', completed_at = now(), registration_id = v_registration
  WHERE ps.id = v.id;

  RETURN QUERY SELECT 'completed'::text, v_registration, v.org_id, v.display_id;
END $$;

-- Ends every live session of one member of the current organisation and sets the member's
-- cut-off: sessions created, and sign-ins authenticated, before it are refused. The member
-- row is updated first, so a sign-in that locked it first and committed is visible to the
-- second statement and is revoked too (each statement takes a fresh snapshot). Returns the
-- number of sessions ended; one that had already expired is left alone and not counted, as in
-- scripts/revoke-subject-sessions.sql (sec.session_purge_expired clears its ID token).
-- tinnox_app has no rights on session, hence a sec.* function.
--
-- The cut-off is the start of this call, not of the transaction: the people routes first wait
-- for the membership lock and the member row (lock_timeout 5 s each), and a sign-in at the
-- identity provider during those waits must be refused too. From then on the member row is
-- locked, so a sign-in that commits later reads this cut-off. greatest() skips NULL and never
-- moves the cut-off back, so a revocation that commits after a later one cannot let the
-- sessions between the two back in.
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
  UPDATE public.membership m
  SET sessions_valid_after = greatest(m.sessions_valid_after, statement_timestamp())
  WHERE m.id = p_membership_id AND m.org_id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership does not belong to the current organisation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- shortcut: a session past the idle timeout (not known here) is still counted; pass the
  -- timeout in, as sec.session_by_id_hash takes it, if sessionsEnded must be exact.
  UPDATE public.session s SET revoked_at = now(), id_token = NULL
  WHERE s.membership_id = p_membership_id AND s.org_id = v_org AND s.revoked_at IS NULL
    AND s.expires_at > now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION sec.session_revoke_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sec.session_revoke_membership(uuid) TO tinnox_app;

RESET ROLE;

-- -------------------------------------------------------------------- 7. checks

-- Same guard as 0001: fail if any table in public is without forced row-level security.
-- It covers member_invite, and membership and session, whose FORCE was lifted for the mapping
-- and the first sign-in fill.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'tables without forced row-level security: %', missing;
  END IF;
END $$;

-- Fail if a tenant table created here has no tenant policy, or if a trigger in public
-- was left disabled.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(t.name, ', ') INTO bad
  FROM unnest(ARRAY['member_invite']) AS t(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = t.name AND p.policyname = 'tenant_isolation'
  );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'tables without a tenant policy: %', bad;
  END IF;

  SELECT string_agg(c.relname || '.' || g.tgname, ', ') INTO bad
  FROM pg_trigger g
  JOIN pg_class c ON c.oid = g.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT g.tgisinternal AND g.tgenabled <> 'O';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'triggers left disabled: %', bad;
  END IF;
END $$;

-- Same guard as 0002 to 0004, 0010 and 0012: every sec function must be SECURITY DEFINER,
-- owned by tinnox_definer, with a locked search_path, and must not be executable by PUBLIC.
-- It covers the five functions re-created here and sec.session_revoke_membership.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'sec'
    AND NOT (p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
             AND pg_get_userbyid(p.proowner) = 'tinnox_definer'
             AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
             AND has_function_privilege('tinnox_app', p.oid, 'EXECUTE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'sec functions with unsafe definition: %', bad;
  END IF;
END $$;
