-- 0010: pairing hardening from security review round 3
-- (docs/reviews/2026-11-17-security-round-3/).
--
--   SCX-01  A claim, or revoking the screen's player, cancels every older claim of the
--           display that its player has not collected yet, and completing a pairing
--           never replaces an active registration. An older claim can no longer take
--           the screen back from a newer player, or come back after a revocation.
--   SCX-05  A claim checks and uses the operator's wrong-code budget under a lock per
--           membership, so concurrent claims cannot get past the limit.
--   SCX-04  The polling attempt that locks a pairing session says so, so the API can
--           write the lockout's audit event in the same transaction.
--
-- A cancelled claim gets status 'expired': its player is told the code expired and
-- asks for a new one. Only functions change; no table and no data.
--
-- Locks, always in this order: the membership lock, then the display lock, then
-- pairing_session rows, then player_registration rows. sec.pairing_complete takes no
-- advisory lock; it locks its pairing row first, like everything else.

SET LOCAL ROLE tinnox_definer;

-- pairing_claim reports the claims it cancelled. A new OUT column cannot be added
-- with CREATE OR REPLACE, so the function is dropped and created again, then granted.
DROP FUNCTION sec.pairing_claim(text, uuid, uuid, integer, integer);

-- Operator claims a code for a display. Same contract as 0002, plus:
-- cancelled_pairing_ids lists the older, uncollected claims of the display that this
-- claim cancelled (empty when there were none, NULL unless the outcome is 'claimed').
CREATE FUNCTION sec.pairing_claim(
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
  PERFORM 1 FROM public.membership m WHERE m.id = p_membership_id AND m.org_id = v_org;
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

REVOKE ALL ON FUNCTION sec.pairing_claim(text, uuid, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sec.pairing_claim(text, uuid, uuid, integer, integer) TO tinnox_app;

-- Cancels the claims of a display that its player has not collected yet, so none of
-- them can complete. Called when the operator revokes the display's player (SCX-01),
-- before anything else in that transaction. Must run inside withOrg; it touches only
-- the current organisation's rows. Returns the ids of the cancelled pairing sessions.
CREATE FUNCTION sec.pairing_cancel_claims(p_display_id uuid)
  RETURNS uuid[]
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_org uuid := public.app_org_id();
  v_cancelled uuid[];
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'pairing_cancel_claims requires an organisation context' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('tinnox.pairing_display:' || p_display_id::text, 0));
  WITH cancelled AS (
    UPDATE public.pairing_session ps SET status = 'expired'
    WHERE ps.display_id = p_display_id AND ps.org_id = v_org AND ps.status = 'claimed'
    RETURNING ps.id
  )
  SELECT coalesce(array_agg(cancelled.id), '{}') INTO v_cancelled FROM cancelled;
  RETURN v_cancelled;
END $$;

REVOKE ALL ON FUNCTION sec.pairing_cancel_claims(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sec.pairing_cancel_claims(uuid) TO tinnox_app;

-- Player collects its registration after the claim. Same contract as 0002, except that
-- it never replaces an active registration. A claim revokes the display's player in its
-- own transaction, so a registration that is active now belongs to a newer claim: this
-- pairing is cancelled instead, and the answer is 'not_claimable' (SCX-01).
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

-- Player polls with its secret polling token. Same contract as 0002, except that the
-- wrong token that locks the session answers 'wrong_token_locked' instead of
-- 'wrong_token', exactly once per session (SCX-04). Later polls answer 'locked'.
-- outcome: pending | claimed | completed | expired | locked | not_found | wrong_token | wrong_token_locked
CREATE OR REPLACE FUNCTION sec.pairing_poll(p_pairing_id uuid, p_polling_token_hash bytea, p_max_wrong_attempts integer)
  RETURNS TABLE (outcome text, expires_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v public.pairing_session%ROWTYPE;
  v_status text;
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
    WHERE ps.id = v.id
    RETURNING ps.status INTO v_status;
    -- The session was not locked before this attempt (see above), so 'locked' now
    -- means this attempt locked it.
    RETURN QUERY SELECT (CASE WHEN v_status = 'locked' THEN 'wrong_token_locked' ELSE 'wrong_token' END)::text,
                        NULL::timestamptz;
    RETURN;
  END IF;
  IF v.status IN ('pending', 'claimed') AND v.expires_at <= now() THEN
    UPDATE public.pairing_session ps SET status = 'expired' WHERE ps.id = v.id;
    RETURN QUERY SELECT 'expired'::text, v.expires_at;
    RETURN;
  END IF;
  RETURN QUERY SELECT v.status, v.expires_at;
END $$;

RESET ROLE;

-- Same guard as 0002 to 0004: every sec function must be SECURITY DEFINER, owned by
-- tinnox_definer, with a locked search_path, and must not be executable by PUBLIC.
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
