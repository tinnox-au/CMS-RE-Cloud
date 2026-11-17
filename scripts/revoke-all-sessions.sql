-- Ends every live operator session, in every organisation, at once.
-- Incident runbook: docs/security/operations-and-release-checklist.md, section 1.3.
--
-- Run as the database superuser (or as tinnox_migrator, which may SET ROLE
-- tinnox_definer), with psql -v ON_ERROR_STOP=1. Rotating SESSION_SECRET does not
-- do this: stored sessions are not keyed with it (review round 3, SCX-06).
--
-- Sessions are marked revoked rather than deleted, so they stay as evidence;
-- sec.session_purge_expired removes them a day later. Each organisation that had a
-- live session gets one audit event in the same transaction. Sessions at the identity
-- provider are separate: end them there too, or users sign straight back in.

BEGIN;
-- Exactly the rights of the security functions' owner: UPDATE on session, INSERT on
-- audit_event, and past row-level security on the non-tenant session table.
SET LOCAL ROLE tinnox_definer;

WITH ended AS (
  UPDATE public.session s
  SET revoked_at = now(), id_token = NULL
  WHERE s.revoked_at IS NULL AND s.expires_at > now()
  RETURNING s.org_id
)
INSERT INTO public.audit_event (org_id, actor_type, actor_id, action, object_type, object_id, result, detail)
SELECT ended.org_id, 'system', NULL, 'auth.logout', 'session', NULL, 'success',
       jsonb_build_object('reason', 'global_revocation', 'sessions', count(*))
FROM ended
GROUP BY ended.org_id;

COMMIT;
