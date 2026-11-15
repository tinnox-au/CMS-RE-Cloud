-- 0003: two more narrow lookups the API needs before an organisation is known.
-- Added by the API step; 0001 and 0002 are unchanged.
--
--   sec.device_by_registration_id  resolves the registration named in a signed
--     player media URL (the URL carries no bearer credential). The API calls it
--     only after the URL's HMAC signature has been verified, so the id is one the
--     API itself issued. Revoked registrations return no row.
--
--   sec.media_processing_jobs      lists media rows still waiting for the
--     validation worker, across organisations, so the API can ingest results and
--     time out stuck jobs after a restart. It returns identifiers and the
--     upload time only; every change to a row is then made inside withOrg.

-- The definer role reads media only through the function below.
GRANT SELECT (id, org_id, status, created_at) ON public.media TO tinnox_definer;

SET LOCAL ROLE tinnox_definer;

CREATE FUNCTION sec.device_by_registration_id(p_registration_id uuid)
  RETURNS TABLE (registration_id uuid, org_id uuid, display_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT pr.id, pr.org_id, pr.display_id
  FROM public.player_registration pr
  WHERE pr.id = p_registration_id AND pr.revoked_at IS NULL
$$;

CREATE FUNCTION sec.media_processing_jobs(p_limit integer)
  RETURNS TABLE (media_id uuid, org_id uuid, created_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT m.id, m.org_id, m.created_at
  FROM public.media m
  WHERE m.status = 'processing'
  ORDER BY m.created_at, m.id
  LIMIT greatest(1, least(coalesce(p_limit, 500), 5000))
$$;

REVOKE ALL ON FUNCTION sec.device_by_registration_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION sec.media_processing_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sec.device_by_registration_id(uuid) TO tinnox_app;
GRANT EXECUTE ON FUNCTION sec.media_processing_jobs(integer) TO tinnox_app;

RESET ROLE;

-- Same guard as 0002: every sec function must be SECURITY DEFINER, owned by
-- tinnox_definer, with a locked search_path.
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
