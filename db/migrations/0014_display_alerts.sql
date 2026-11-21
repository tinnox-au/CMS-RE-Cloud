-- 0014: e-mail alerts for screens (CMS-15, DEC-37; docs/portal-v2/stage-c-alerts.md). 0001 to 0013
-- are unchanged.
--
--   1. display: the offline delay (30 minutes by default, NULL is off) and the back-online e-mail.
--   2. display_alert: the open offline episode of a display, the claim that makes a second runner
--      of the check harmless.
--   3. alert_recipient: the organisation's alert addresses, each confirmed by its owner first.
--   4. Row-level security and grants.
--   5. sec.*: display_alert_orgs and alert_recipient_by_token_hash.
--   6. Final checks.
--
-- Cross-organisation reads (AGENTS.md section 1). sec.display_alert_orgs returns organisation ids
-- and nothing else: the check (apps/api/src/alerts.ts) has no session, organization is under
-- row-level security keyed on app.org_id, and every read of tenant data then happens inside
-- withOrg for one organisation at a time. sec.alert_recipient_by_token_hash resolves a
-- confirmation link, which is opened by someone with no session, so the organisation is unknown
-- until the token is found; it returns the organisation and recipient id of an unexpired,
-- unconfirmed row only, never the address.
--
-- Grants. tinnox_app gets UPDATE on the two new display columns, SELECT, INSERT and DELETE on
-- display_alert (a row is opened and closed, never changed), and on alert_recipient the same plus
-- UPDATE on the three confirmation columns. tinnox_definer reads five alert_recipient columns,
-- never the address.
--
-- Locks and deploy order. Takes ACCESS EXCLUSIVE on display until commit and reads every display
-- row once to validate the new CHECK; the constant defaults rewrite nothing. An API from before
-- 0014 keeps working (it never names the new columns), so migrate, then start the new API.

-- ----------------------------------------------------------------------- 1. display

-- Twins in packages/contracts/src/display.ts (AlertOfflineMinutesSchema).
ALTER TABLE public.display
  ADD COLUMN alert_offline_minutes integer DEFAULT 30,
  ADD COLUMN alert_back_online     boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT display_alert_offline_minutes_range CHECK (
    alert_offline_minutes IS NULL
    OR (alert_offline_minutes BETWEEN 30 AND 2880 AND alert_offline_minutes % 30 = 0)
  );

-- ----------------------------------------------------------------- 2. display_alert

-- A row exists only while an offline e-mail is open: the check inserts it when the delay has
-- passed and deletes it when the screen reports again or stops being eligible (unpaired,
-- re-paired, alerts off). Displays are never deleted, so the foreign key needs no cascade.
CREATE TABLE public.display_alert (
  display_id    uuid PRIMARY KEY,
  org_id        uuid NOT NULL,
  -- The report time that went stale: a newer report closes the episode.
  offline_since timestamptz NOT NULL,
  notified_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT display_alert_display_fk FOREIGN KEY (display_id, org_id)
    REFERENCES public.display (id, org_id)
);

-- --------------------------------------------------------------- 3. alert_recipient

-- One list per organisation, used for every screen (DEC-37). An address receives nothing until
-- its owner confirms it from the link (DEC-29); the API lower-cases it, and keeps at most 20 per
-- organisation, counted under a per-organisation advisory lock.
CREATE TABLE public.alert_recipient (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organization (id),
  email              text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- The member who added it.
  created_by         uuid,
  confirmed_at       timestamptz,
  -- SHA-256 of the token in the link; NULL once confirmed.
  confirm_token_hash bytea,
  confirm_expires_at timestamptz,
  UNIQUE (org_id, email),
  UNIQUE (id, org_id),
  CONSTRAINT alert_recipient_email_length CHECK (char_length(email) BETWEEN 3 AND 254),
  -- No RFC 5322 name, group, list or quoted forms, which the mailer would deliver to another
  -- mailbox than the stored string (twin of AlertEmailSchema).
  CONSTRAINT alert_recipient_email_shape CHECK (
    email LIKE '%_@_%' AND email = lower(email) AND email !~ '[][<>()\\,;:"[:space:]]'
  ),
  CONSTRAINT alert_recipient_token_length CHECK (octet_length(confirm_token_hash) = 32),
  -- Written with IS NULL and IS NOT NULL only, so it is never NULL (0008).
  CONSTRAINT alert_recipient_confirmation CHECK (
    (confirmed_at IS NOT NULL AND confirm_token_hash IS NULL AND confirm_expires_at IS NULL)
    OR (confirmed_at IS NULL AND confirm_token_hash IS NOT NULL AND confirm_expires_at IS NOT NULL)
  ),
  CONSTRAINT alert_recipient_created_by_fk FOREIGN KEY (created_by, org_id)
    REFERENCES public.membership (id, org_id)
);
-- The confirmation link's lookup.
CREATE UNIQUE INDEX alert_recipient_token_key ON public.alert_recipient (confirm_token_hash)
  WHERE confirm_token_hash IS NOT NULL;

-- ------------------------------------------------------------- 4. RLS and grants

ALTER TABLE public.display_alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.display_alert FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.display_alert
  USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id());

ALTER TABLE public.alert_recipient ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_recipient FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.alert_recipient
  USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id());

-- display is granted column by column.
GRANT UPDATE (alert_offline_minutes, alert_back_online) ON public.display TO tinnox_app;
GRANT SELECT, INSERT, DELETE ON public.display_alert TO tinnox_app;
GRANT SELECT, INSERT, DELETE ON public.alert_recipient TO tinnox_app;
GRANT UPDATE (confirmed_at, confirm_token_hash, confirm_expires_at)
  ON public.alert_recipient TO tinnox_app;

-- What sec.alert_recipient_by_token_hash reads; never the address.
GRANT SELECT (id, org_id, confirm_token_hash, confirm_expires_at, confirmed_at)
  ON public.alert_recipient TO tinnox_definer;

-- -------------------------------------------------------------------- 5. sec.*

SET LOCAL ROLE tinnox_definer;

-- Every organisation's id, for the alert check, which then enters each one with withOrg.
-- shortcut: one pass over every organisation per run; list only organisations with paired
-- screens, or page, when there are thousands.
CREATE FUNCTION sec.display_alert_orgs()
  RETURNS TABLE (org_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT o.id FROM public.organization o ORDER BY o.id
$$;

-- The organisation and id of the unconfirmed, unexpired recipient whose link carries this token.
-- Unknown, used and expired tokens all return no row.
CREATE FUNCTION sec.alert_recipient_by_token_hash(p_hash bytea)
  RETURNS TABLE (org_id uuid, recipient_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT r.org_id, r.id
  FROM public.alert_recipient r
  WHERE r.confirm_token_hash = p_hash AND r.confirmed_at IS NULL AND r.confirm_expires_at > now()
$$;

REVOKE ALL ON FUNCTION sec.display_alert_orgs() FROM PUBLIC;
REVOKE ALL ON FUNCTION sec.alert_recipient_by_token_hash(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sec.display_alert_orgs() TO tinnox_app;
GRANT EXECUTE ON FUNCTION sec.alert_recipient_by_token_hash(bytea) TO tinnox_app;

RESET ROLE;

-- -------------------------------------------------------------------- 6. checks

-- Same guard as 0001: fail if any table in public is without forced row-level security.
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
  FROM unnest(ARRAY['display_alert', 'alert_recipient']) AS t(name)
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

-- Same guard as 0013: every sec function must be SECURITY DEFINER, owned by tinnox_definer, with
-- a locked search_path, not executable by PUBLIC and executable by tinnox_app.
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
