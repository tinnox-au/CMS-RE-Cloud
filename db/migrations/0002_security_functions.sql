-- 0002: narrow SECURITY DEFINER functions (prototype-m0.md D4).
--
-- These are the only way the runtime role can touch data before the organisation
-- of a request is known (operator session, device token, pairing), and the only
-- way it can reach the non-tenant tables session, login_state and pairing_session.
--
-- Every function:
--   * is owned by tinnox_definer (NOLOGIN, BYPASSRLS) - see section 9 of
--     docs/prototype-m0.md for why the owner is not the migrator;
--   * has a locked search_path (pg_catalog, pg_temp) and schema-qualifies every object;
--   * takes hashes, never raw secrets, and returns the minimum needed;
--   * is executable by tinnox_app only.
--
-- To change a function in a later migration:
--   SET LOCAL ROLE tinnox_definer;  CREATE OR REPLACE FUNCTION ...;  RESET ROLE;

-- ------------------------------------------------------------------ membership

CREATE FUNCTION sec.membership_by_oidc_sub(p_oidc_sub text)
  RETURNS TABLE (membership_id uuid, org_id uuid, role text, org_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT m.id, m.org_id, m.role, o.name
  FROM public.membership m JOIN public.organization o ON o.id = m.org_id
  WHERE m.oidc_sub = p_oidc_sub
$$;

-- ----------------------------------------------------------------- login state

-- Stores the PKCE verifier and nonce for one authorization request.
CREATE FUNCTION sec.login_state_put(
  p_state_hash bytea, p_code_verifier text, p_nonce text, p_return_to text, p_ttl_seconds integer)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 30 OR p_ttl_seconds > 900 THEN
    RAISE EXCEPTION 'login state ttl must be 30 to 900 seconds' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM public.login_state WHERE expires_at <= now();
  INSERT INTO public.login_state (state_hash, code_verifier, nonce, return_to, expires_at)
  VALUES (p_state_hash, p_code_verifier, p_nonce, p_return_to, now() + make_interval(secs => p_ttl_seconds));
END $$;

-- Returns and deletes the login state: a state value can be redeemed once.
CREATE FUNCTION sec.login_state_take(p_state_hash bytea)
  RETURNS TABLE (code_verifier text, nonce text, return_to text)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DELETE FROM public.login_state ls
  WHERE ls.state_hash = p_state_hash AND ls.expires_at > now()
  RETURNING ls.code_verifier, ls.nonce, ls.return_to
$$;

-- -------------------------------------------------------------------- sessions

-- Creates a session for a verified subject. The organisation comes from the
-- membership row and from nowhere else. Returns no row when the subject has no membership.
CREATE FUNCTION sec.session_create(
  p_id_hash bytea, p_oidc_sub text, p_csrf_token text, p_ttl_seconds integer, p_id_token text)
  RETURNS TABLE (membership_id uuid, org_id uuid, role text, expires_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'session ttl must be 60 to 86400 seconds' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  INSERT INTO public.session AS s (id_hash, membership_id, org_id, oidc_sub, csrf_token, id_token, expires_at)
  SELECT p_id_hash, m.id, m.org_id, m.oidc_sub, p_csrf_token, p_id_token, now() + make_interval(secs => p_ttl_seconds)
  FROM public.membership m
  WHERE m.oidc_sub = p_oidc_sub
  RETURNING s.membership_id, s.org_id,
            (SELECT m2.role FROM public.membership m2 WHERE m2.id = s.membership_id), s.expires_at;
END $$;

-- Looks up a live session and records activity. A session is live when it is
-- not revoked, not past its absolute expiry and not idle for longer than the timeout.
CREATE FUNCTION sec.session_by_id_hash(p_id_hash bytea, p_idle_timeout_seconds integer)
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
    WHERE s.id_hash = p_id_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND s.last_seen_at > now() - make_interval(secs => p_idle_timeout_seconds)
    RETURNING s.membership_id, s.org_id, s.oidc_sub, s.csrf_token, s.created_at, s.expires_at
  )
  SELECT live.membership_id, live.org_id, live.oidc_sub, m.role, o.name, live.csrf_token, live.created_at, live.expires_at
  FROM live
  JOIN public.membership m ON m.id = live.membership_id AND m.org_id = live.org_id
  JOIN public.organization o ON o.id = live.org_id;
END $$;

-- Ends a session. Returns the stored id_token (for the identity provider's logout) once.
CREATE FUNCTION sec.session_revoke(p_id_hash bytea)
  RETURNS TABLE (membership_id uuid, org_id uuid, id_token text)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  WITH target AS (
    SELECT s.id_hash, s.id_token FROM public.session s
    WHERE s.id_hash = p_id_hash AND s.revoked_at IS NULL
    FOR UPDATE
  ), done AS (
    UPDATE public.session s SET revoked_at = now(), id_token = NULL
    FROM target WHERE s.id_hash = target.id_hash
    RETURNING s.membership_id, s.org_id
  )
  SELECT done.membership_id, done.org_id, target.id_token FROM done, target
$$;

-- Housekeeping: removes sessions that ended more than a day ago. Returns the number removed.
CREATE FUNCTION sec.session_purge_expired()
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.session
  WHERE expires_at < now() - interval '1 day' OR revoked_at < now() - interval '1 day';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- --------------------------------------------------------------------- pairing

-- Player asks for a pairing session. outcome: created | rate_limited | code_collision
-- (on code_collision the caller generates a new random code and retries).
CREATE FUNCTION sec.pairing_create(
  p_code text, p_polling_token_hash bytea, p_client_key text,
  p_ttl_seconds integer, p_max_sessions_per_client integer, p_window_seconds integer)
  RETURNS TABLE (outcome text, pairing_id uuid, expires_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_recent integer;
  v_id uuid;
  v_expires timestamptz;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 3600
     OR p_max_sessions_per_client IS NULL OR p_max_sessions_per_client < 1
     OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid pairing limits' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Serialise creation per client so the count below cannot be raced past the limit.
  PERFORM pg_advisory_xact_lock(hashtextextended('tinnox.pairing_create:' || p_client_key, 0));

  UPDATE public.pairing_session SET status = 'expired'
  WHERE status = 'pending' AND pairing_session.expires_at <= now();

  SELECT count(*) INTO v_recent FROM public.pairing_session ps
  WHERE ps.client_key = p_client_key AND ps.created_at > now() - make_interval(secs => p_window_seconds);
  IF v_recent >= p_max_sessions_per_client THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.pairing_session AS ps (code, polling_token_hash, client_key, expires_at)
    VALUES (p_code, p_polling_token_hash, p_client_key, now() + make_interval(secs => p_ttl_seconds))
    RETURNING ps.id, ps.expires_at INTO v_id, v_expires;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'code_collision'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END;
  RETURN QUERY SELECT 'created'::text, v_id, v_expires;
END $$;

-- Player polls with its secret polling token.
-- outcome: pending | claimed | completed | expired | locked | not_found | wrong_token
-- A wrong token counts against the session; at p_max_wrong_attempts it is locked for good.
-- 'claimed' means: call sec.pairing_complete now to obtain the registration.
CREATE FUNCTION sec.pairing_poll(p_pairing_id uuid, p_polling_token_hash bytea, p_max_wrong_attempts integer)
  RETURNS TABLE (outcome text, expires_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v public.pairing_session%ROWTYPE;
BEGIN
  IF p_max_wrong_attempts IS NULL OR p_max_wrong_attempts < 1 THEN
    RAISE EXCEPTION 'invalid attempt limit' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v FROM public.pairing_session ps WHERE ps.id = p_pairing_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF v.status = 'locked' THEN
    RETURN QUERY SELECT 'locked'::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF v.polling_token_hash <> p_polling_token_hash THEN
    UPDATE public.pairing_session ps
    SET failed_attempts = ps.failed_attempts + 1,
        status = CASE WHEN ps.failed_attempts + 1 >= p_max_wrong_attempts AND ps.status IN ('pending', 'claimed')
                      THEN 'locked' ELSE ps.status END
    WHERE ps.id = v.id;
    RETURN QUERY SELECT 'wrong_token'::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF v.status IN ('pending', 'claimed') AND v.expires_at <= now() THEN
    UPDATE public.pairing_session ps SET status = 'expired' WHERE ps.id = v.id;
    RETURN QUERY SELECT 'expired'::text, v.expires_at;
    RETURN;
  END IF;
  RETURN QUERY SELECT v.status, v.expires_at;
END $$;

-- Operator claims a code for a display. Must run inside a transaction that has
-- app.org_id set (withOrg); the display and the membership must belong to that
-- organisation. The claim is one atomic UPDATE, so two concurrent claims of the
-- same code cannot both succeed.
-- outcome: claimed | invalid_code | display_not_found | rate_limited
-- Wrong codes are counted per operator; after p_max_failures within
-- p_window_seconds further claims return rate_limited.
CREATE FUNCTION sec.pairing_claim(
  p_code text, p_display_id uuid, p_membership_id uuid, p_max_failures integer, p_window_seconds integer)
  RETURNS TABLE (outcome text, pairing_id uuid, replaced_registration_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_org uuid := public.app_org_id();
  v_failures integer;
  v_pairing uuid;
  v_replaced uuid;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'pairing_claim requires an organisation context' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_max_failures IS NULL OR p_max_failures < 1 OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid claim limits' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM 1 FROM public.membership m WHERE m.id = p_membership_id AND m.org_id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership does not belong to the current organisation' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1 FROM public.display d WHERE d.id = p_display_id AND d.org_id = v_org;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'display_not_found'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  DELETE FROM public.pairing_claim_failure f WHERE f.failed_at < now() - interval '1 day';
  SELECT count(*) INTO v_failures FROM public.pairing_claim_failure f
  WHERE f.membership_id = p_membership_id AND f.failed_at > now() - make_interval(secs => p_window_seconds);
  IF v_failures >= p_max_failures THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.pairing_session ps
  SET status = 'claimed', org_id = v_org, display_id = p_display_id,
      claimed_at = now(), claimed_by_membership = p_membership_id,
      -- give the player time to collect its credential even if the code was about to expire
      expires_at = greatest(ps.expires_at, now() + interval '2 minutes')
  WHERE ps.code = p_code AND ps.status = 'pending' AND ps.expires_at > now()
  RETURNING ps.id INTO v_pairing;

  IF v_pairing IS NULL THEN
    INSERT INTO public.pairing_claim_failure (membership_id) VALUES (p_membership_id);
    RETURN QUERY SELECT 'invalid_code'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- The new player replaces any player currently registered to the display.
  UPDATE public.player_registration pr
  SET revoked_at = now(), revoked_reason = 'replaced'
  WHERE pr.display_id = p_display_id AND pr.org_id = v_org AND pr.revoked_at IS NULL
  RETURNING pr.id INTO v_replaced;

  RETURN QUERY SELECT 'claimed'::text, v_pairing, v_replaced;
END $$;

-- Player collects its registration after the claim. The API generates the device
-- token, passes only its hash, and returns the token to the player in the same
-- response. Succeeds exactly once per pairing session.
-- outcome: completed | not_claimable
CREATE FUNCTION sec.pairing_complete(p_pairing_id uuid, p_polling_token_hash bytea, p_device_token_hash bytea)
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

  UPDATE public.player_registration pr
  SET revoked_at = now(), revoked_reason = 'replaced'
  WHERE pr.display_id = v.display_id AND pr.org_id = v.org_id AND pr.revoked_at IS NULL;

  INSERT INTO public.player_registration AS pr (org_id, display_id, token_hash)
  VALUES (v.org_id, v.display_id, p_device_token_hash)
  RETURNING pr.id INTO v_registration;

  UPDATE public.pairing_session ps
  SET status = 'completed', completed_at = now(), registration_id = v_registration
  WHERE ps.id = v.id;

  RETURN QUERY SELECT 'completed'::text, v_registration, v.org_id, v.display_id;
END $$;

-- Housekeeping: removes pairing sessions older than the given age. Returns the number removed.
CREATE FUNCTION sec.pairing_purge(p_older_than_seconds integer)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  n integer;
BEGIN
  IF p_older_than_seconds IS NULL OR p_older_than_seconds < 3600 THEN
    RAISE EXCEPTION 'pairing sessions are kept for at least one hour' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM public.pairing_session ps WHERE ps.created_at < now() - make_interval(secs => p_older_than_seconds);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------- device

-- Resolves a device token hash to its active registration. Revoked registrations return no row.
CREATE FUNCTION sec.device_by_token_hash(p_token_hash bytea)
  RETURNS TABLE (registration_id uuid, org_id uuid, display_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT pr.id, pr.org_id, pr.display_id
  FROM public.player_registration pr
  WHERE pr.token_hash = p_token_hash AND pr.revoked_at IS NULL
$$;

-- ----------------------------------------------------------------------- audit

-- Records an event that has no organisation (for example a sign-in by a subject
-- with no membership, or a rejected device token). Such rows are invisible to
-- every organisation; they are read by a database administrator.
CREATE FUNCTION sec.audit_unscoped(
  p_actor_type text, p_actor_id text, p_action text, p_object_type text, p_object_id text,
  p_result text, p_detail jsonb)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  INSERT INTO public.audit_event (org_id, actor_type, actor_id, action, object_type, object_id, result, detail)
  VALUES (NULL, p_actor_type, p_actor_id, p_action, p_object_type, p_object_id, p_result, p_detail)
$$;

-- ------------------------------------------------------ ownership and privileges

DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'sec'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO tinnox_app', f.signature);
    EXECUTE format('ALTER FUNCTION %s OWNER TO tinnox_definer', f.signature);
  END LOOP;
END $$;

-- Fail the migration if a sec function is not SECURITY DEFINER with a locked search_path.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'sec'
    AND NOT (p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
             AND pg_get_userbyid(p.proowner) = 'tinnox_definer');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'sec functions with unsafe definition: %', bad;
  END IF;
END $$;
