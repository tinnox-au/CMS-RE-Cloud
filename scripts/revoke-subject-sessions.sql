-- Ends every live session of one operator (an OIDC subject), in every organisation.
-- Incident runbook: docs/security/operations-and-release-checklist.md, section 1.3.
--
-- Run as the database superuser (or as tinnox_migrator, which may SET ROLE
-- tinnox_definer), with psql -v ON_ERROR_STOP=1 -v subject='<oidc subject>'.
-- It also sets the member's cut-off, so a browser still signed in at the identity provider
-- must enter the password and one-time code again. End the user's sessions at the identity
-- provider too.
--
-- Sessions are marked revoked rather than deleted, so they stay as evidence. In the same
-- transaction the membership gets one membership.sessions_end audit event (also when it had no
-- live session), and each membership that had a live session one auth.logout event.

BEGIN;
-- Exactly the rights of the security functions' owner: UPDATE on session and on the member's
-- cut-off, INSERT on audit_event, and past row-level security on every table.
SET LOCAL ROLE tinnox_definer;

-- The cut-off (0013, the definer's UPDATE (sessions_valid_after) grant): sessions created, and
-- sign-ins authenticated, before it are refused. greatest() never moves an existing one back.
WITH cut AS (
  UPDATE public.membership SET sessions_valid_after = greatest(sessions_valid_after, statement_timestamp())
  WHERE oidc_sub = :'subject'
  RETURNING id, org_id
)
INSERT INTO public.audit_event (org_id, actor_type, actor_id, action, object_type, object_id, result, detail)
SELECT cut.org_id, 'system', NULL, 'membership.sessions_end', 'membership', cut.id::text, 'success',
       jsonb_build_object('reason', 'incident_revocation')
FROM cut;

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
