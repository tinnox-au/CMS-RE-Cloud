-- 0004: hardening from the 2026-11-14 review. 0001 to 0003 are unchanged.
--
--   1. publication_asset rows can be added only in the transaction that created their
--      publication, and only exactly as the frozen manifest lists them. Before, the
--      runtime role could append rows to an existing publication and so widen what its
--      player may download.
--   2. audit_event.occurred_at is always the database's own time; no role can backdate
--      or postdate an event.
--   3. sec.heartbeat_log_purge: time-based retention of the raw heartbeat history across
--      organisations, called by the API's housekeeping (no client-supplied value decides it).
--   4. sec.session_purge_expired also removes the stored ID token of every session that
--      has ended, instead of keeping it until the row is deleted a day later.

-- ------------------------------------------------------------ 1. publication assets

CREATE FUNCTION public.publication_asset_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  listed text;
BEGIN
  SELECT p.manifest -> 'assets' -> NEW.position ->> 'assetId' INTO listed
  FROM public.publication p
  WHERE p.id = NEW.publication_id AND p.org_id = NEW.org_id
    AND p.xmin = pg_catalog.pg_current_xact_id()::xid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'publication assets can only be added with their publication'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF listed IS DISTINCT FROM NEW.media_id::text THEN
    RAISE EXCEPTION 'publication asset does not match the manifest'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER publication_asset_insert_guard BEFORE INSERT ON public.publication_asset
  FOR EACH ROW EXECUTE FUNCTION public.publication_asset_guard();

-- ------------------------------------------------------------------ 2. audit time

CREATE FUNCTION public.audit_event_stamp() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  NEW.occurred_at := pg_catalog.now();
  RETURN NEW;
END $$;

CREATE TRIGGER audit_event_stamp BEFORE INSERT ON public.audit_event
  FOR EACH ROW EXECUTE FUNCTION public.audit_event_stamp();

-- Trigger functions run as the inserting role; nobody needs to call them directly.
REVOKE ALL ON FUNCTION public.publication_asset_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_event_stamp() FROM PUBLIC;

-- ------------------------------------------------- 3 and 4. housekeeping functions

GRANT SELECT (received_at), DELETE ON public.heartbeat_log TO tinnox_definer;

SET LOCAL ROLE tinnox_definer;

-- Removes heartbeat history older than the given age (at least one hour). Returns the count.
CREATE FUNCTION sec.heartbeat_log_purge(p_older_than_seconds integer)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  n integer;
BEGIN
  IF p_older_than_seconds IS NULL OR p_older_than_seconds < 3600 THEN
    RAISE EXCEPTION 'heartbeat retention must be at least one hour' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM public.heartbeat_log
  WHERE received_at < now() - make_interval(secs => p_older_than_seconds);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Same signature as in 0002. Ended sessions lose their ID token at once; rows that ended
-- more than a day ago are removed. Returns the number of rows removed.
CREATE OR REPLACE FUNCTION sec.session_purge_expired()
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.session SET id_token = NULL
  WHERE id_token IS NOT NULL AND (expires_at <= now() OR revoked_at IS NOT NULL);
  DELETE FROM public.session
  WHERE expires_at < now() - interval '1 day' OR revoked_at < now() - interval '1 day';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION sec.heartbeat_log_purge(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sec.heartbeat_log_purge(integer) TO tinnox_app;

RESET ROLE;

-- Same guard as 0002 and 0003.
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
