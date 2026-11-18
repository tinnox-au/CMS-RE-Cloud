-- 0011: follow-up to 0010 from the second check of security review round 3
-- (docs/reviews/2026-11-17-security-round-3/, section 13).
--
--   1. Claims accepted before 0010 are cancelled. Before 0010, revoking a screen's
--      player or claiming it again left older claims in place. One that its player had
--      not collected could therefore still complete after the upgrade and hand out a
--      lasting credential: sec.pairing_complete refuses a claim only while the screen has
--      an active player, and a revoked screen has none. Every claim that could still
--      complete is cancelled here, once, and the cancellation is audited per screen.
--      A player that was waiting is told its code expired and asks for a new one.
--   2. sec.pairing_cancel_claims checks that the screen belongs to the current
--      organisation before it takes the screen's lock, so an id from another
--      organisation takes no lock at all.
--
-- No table changes. On a new database part 1 finds nothing and writes nothing.
--
-- This covers claims that exist when the migration runs. An API from before 0010 that is
-- still running afterwards can leave new ones, so stop it first (see the deploy order in
-- the review record).

SET LOCAL ROLE tinnox_definer;

-- ------------------------------------------- 1. claims from before migration 0010

-- Only claims that could still complete: one past its expiry is refused already.
-- One audit event per screen, in this transaction, naming the cancelled sessions.
WITH cancelled AS (
  UPDATE public.pairing_session ps SET status = 'expired'
  WHERE ps.status = 'claimed' AND ps.expires_at > now()
  RETURNING ps.id, ps.org_id, ps.display_id
)
INSERT INTO public.audit_event (org_id, actor_type, actor_id, action, object_type, object_id, result, detail)
SELECT c.org_id, 'system', NULL, 'pairing.cancel', 'display', c.display_id::text, 'success',
       jsonb_build_object('reason', 'upgrade', 'cancelledPairingIds', jsonb_agg(c.id ORDER BY c.id))
FROM cancelled c
GROUP BY c.org_id, c.display_id;

-- ------------------------------------------------------ 2. sec.pairing_cancel_claims

-- Same contract as 0010. The screen is looked up first: for a screen of another
-- organisation, or an unknown id, nothing is locked and nothing is returned.
CREATE OR REPLACE FUNCTION sec.pairing_cancel_claims(p_display_id uuid)
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
  PERFORM 1 FROM public.display d WHERE d.id = p_display_id AND d.org_id = v_org;
  IF NOT FOUND THEN
    RETURN '{}'::uuid[];
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

RESET ROLE;

-- Same guard as 0002 to 0004 and 0010: every sec function must be SECURITY DEFINER,
-- owned by tinnox_definer, with a locked search_path, and must not be executable by PUBLIC.
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
