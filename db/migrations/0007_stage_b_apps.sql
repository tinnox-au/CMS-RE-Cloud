-- 0007: portal v2, stage B slice 2: built-in apps (docs/portal-v2/stage-b.md, slice 2). 0001 to 0006 are unchanged.
--
--   1. app: one row per built-in app (type fixed for life, settings checked by packages/contracts).
--   2. playlist_item: an item is a media item or an app.
--   3. publication: the manifest may be schema version 1, 2 or 3.
--   4. Row-level security and runtime grants for app.
--
-- Every bound has its twin in packages/contracts (APP_TYPES, APP_TEXT_LIMITS, ABSOLUTE).
-- Takes ACCESS EXCLUSIVE locks on playlist_item and publication until commit and re-reads every
-- publication row to validate the new CHECK; run it while the API is stopped or idle.

-- -------------------------------------------------------------------------- 1. app

CREATE TABLE public.app (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organization (id),
  -- Fixed for life: the runtime role has no UPDATE grant on it.
  type        text NOT NULL,
  name        text NOT NULL,
  description text,
  -- Validated by AppContentSchema in packages/contracts before every write.
  settings    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  CONSTRAINT app_type_known CHECK (type IN ('clock', 'date', 'countdown', 'ticker', 'qr', 'text')),
  CONSTRAINT app_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT app_name_trimmed CHECK (name = btrim(name)),
  CONSTRAINT app_description_length CHECK (char_length(description) BETWEEN 1 AND 500),
  CONSTRAINT app_settings_shape CHECK (
    jsonb_typeof(settings) = 'object' AND pg_column_size(settings) <= 4096
  )
);
CREATE INDEX app_org_idx ON public.app (org_id, created_at);
CREATE TRIGGER app_set_updated_at BEFORE UPDATE ON public.app
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------- 2. playlist_item

-- Exactly one of media_id and app_id. An app item has a duration and no fit.
ALTER TABLE public.playlist_item
  ALTER COLUMN media_id DROP NOT NULL,
  ADD COLUMN app_id uuid,
  ADD CONSTRAINT playlist_item_app_fk FOREIGN KEY (app_id, org_id) REFERENCES public.app (id, org_id),
  ADD CONSTRAINT playlist_item_one_source CHECK (num_nonnulls(media_id, app_id) = 1),
  ADD CONSTRAINT playlist_item_app_shape CHECK (
    app_id IS NULL OR (duration_ms IS NOT NULL AND fit IS NULL)
  );
CREATE INDEX playlist_item_app_idx ON public.playlist_item (app_id) WHERE app_id IS NOT NULL;

-- ------------------------------------------------------------------ 3. publication

ALTER TABLE public.publication DROP CONSTRAINT publication_manifest_shape,
  ADD CONSTRAINT publication_manifest_shape CHECK (
    jsonb_typeof(manifest) = 'object'
    AND manifest ->> 'schemaVersion' IN ('1', '2', '3')
    AND manifest ->> 'publicationId' = id::text
    AND manifest ->> 'displayId' = display_id::text
    AND jsonb_typeof(manifest -> 'assets') = 'array'
    AND jsonb_array_length(manifest -> 'assets') BETWEEN 1 AND 500
    AND pg_column_size(manifest) <= 1048576
  );

-- -------------------------------------------------------------- 4. RLS and grants

ALTER TABLE public.app ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.app
  USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id());
GRANT SELECT, INSERT, DELETE ON public.app TO tinnox_app;
GRANT UPDATE (name, description, settings) ON public.app TO tinnox_app;
-- playlist_item already has table-wide grants (covers app_id).

-- ---------------------------------------------------------------------- final checks

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
  FROM unnest(ARRAY['app']) AS t(name)
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
