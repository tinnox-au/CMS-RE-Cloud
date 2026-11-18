-- Lists player credentials that may have been handed out by a version from before
-- migration 0010 against the operator's intent (security review round 3, SCX-01).
-- Upgrade runbook: docs/security/operations-and-release-checklist.md, section 1.3.
--
-- Before 0010, a pairing code an operator had accepted stayed valid when the screen's
-- player was revoked or another code was accepted for the screen. A player that
-- collected such a code afterwards got a credential that is still active. Migration
-- 0012 cancels codes not yet collected; it cannot judge credentials already collected.
--
-- A row is a credential that is active now, and whose screen had its player revoked or
-- another code accepted between the acceptance of this code and its collection. Read
-- only: it changes nothing. Decide for each row; revoke in the portal ("Revoke player"
-- on the screen). It reads the audit trail, so it sees as far back as that is kept.
-- From 0010 on such a collection is refused, so no new row can appear.
--
-- Run once after the upgrade, as the database superuser: it reads every organisation.

SELECT done.org_id,
       done.detail->>'displayId' AS display_id,
       pr.id                     AS registration_id,
       claim.occurred_at         AS code_accepted_at,
       done.occurred_at          AS credential_collected_at
FROM public.audit_event done
JOIN public.audit_event claim
  ON claim.org_id = done.org_id
 AND claim.action = 'pairing.claim' AND claim.result = 'success'
 AND claim.detail->>'pairingId' = done.detail->>'pairingId'
JOIN public.player_registration pr
  ON pr.org_id = done.org_id AND pr.id::text = done.object_id AND pr.revoked_at IS NULL
WHERE done.action = 'pairing.complete' AND done.result = 'success'
  AND EXISTS (
    SELECT 1 FROM public.audit_event later
    WHERE later.org_id = done.org_id
      AND later.id > claim.id AND later.id < done.id
      AND later.result = 'success'
      AND (
        (later.action = 'player.revoke' AND later.detail->>'displayId' = done.detail->>'displayId')
        OR (later.action = 'pairing.claim' AND later.object_id = done.detail->>'displayId')
      )
  )
ORDER BY done.id;
