-- Ends every live session of one operator (an OIDC subject), in every organisation.
-- Incident runbook: docs/security/operations-and-release-checklist.md, section 1.3.
--
-- Run as the database superuser (or as tinnox_migrator, which may SET ROLE
-- tinnox_definer), with psql -v ON_ERROR_STOP=1 -v subject='<oidc subject>'.
-- End the user's sessions at the identity provider too, or they sign straight back in.
--
-- Sessions are marked revoked rather than deleted, so they stay as evidence. Each
-- membership that had a live session gets one audit event in the same transaction.

BEGIN;
-- Exactly the rights of the security functions' owner: UPDATE on session, INSERT on
-- audit_event, and past row-level security on the non-tenant session table.
SET LOCAL ROLE tinnox_definer;

WITH ended AS (
  UPDATE public.session s
  SET revoked_at = now(), id_token = NULL
  WHERE s.oidc_sub = :'subject' AND s.revoked_at IS NULL AND s.expires_at > now()
  RETURNING s.org_id, s.membership_id
)
INSERT INTO public.audit_event (org_id, actor_type, actor_id, action, object_type, object_id, result, detail)
SELECT ended.org_id, 'system', NULL, 'auth.logout', 'membership', ended.membership_id::text, 'success',
       jsonb_build_object('reason', 'incident_revocation', 'sessions', count(*))
FROM ended
GROUP BY ended.org_id, ended.membership_id;

COMMIT;
