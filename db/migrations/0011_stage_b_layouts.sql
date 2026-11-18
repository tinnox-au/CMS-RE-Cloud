-- 0011: portal v2, stage B slice 4: layouts (docs/portal-v2/stage-b.md, slice 4). 0001 to 0010 are unchanged.
--
--   1. layout: a named split of a screen into zones.
--   2. layout_zone: the two to four zones of a layout, each a rectangle with a playlist; 0 is the main zone.
--   3. Deleted playlists: a layout cannot use one, and a playlist that a layout uses cannot be deleted.
--   4. display: a screen has one of a playlist, a schedule or a layout assigned.
--   5. Row-level security and runtime grants.
--   6. publication: the manifest may be schema version 1, 2, 3, 4 or 5.
--
-- Every bound has its twin in packages/contracts (LAYOUT_UNITS, LayoutInputSchema, ABSOLUTE.maxLayoutZones).
-- Takes ACCESS EXCLUSIVE locks on display and publication until commit, reads every display row and
-- re-reads every publication row to validate the new CHECKs; run it while the API is stopped or idle.

-- ----------------------------------------------------------------------- 1. layout

CREATE TABLE public.layout (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organization (id),
  name        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  CONSTRAINT layout_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT layout_name_trimmed CHECK (name = btrim(name)),
  CONSTRAINT layout_description_length CHECK (char_length(description) BETWEEN 1 AND 500)
);
CREATE INDEX layout_org_idx ON public.layout (org_id, created_at);
CREATE TRIGGER layout_set_updated_at BEFORE UPDATE ON public.layout
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------ 2. layout_zone

-- Rows are replaced as a set (delete, then insert), never updated; position is the identity.
CREATE TABLE public.layout_zone (
  layout_id   uuid NOT NULL,
  -- 0 is the main zone: it speaks for the screen. Twin of ABSOLUTE.maxLayoutZones (4).
  position    integer NOT NULL,
  org_id      uuid NOT NULL REFERENCES public.organization (id),
  playlist_id uuid NOT NULL,
  -- Basis points (1/10 000) of each screen's content rectangle, origin top-left (LAYOUT_UNITS).
  x_bp        integer NOT NULL,
  y_bp        integer NOT NULL,
  width_bp    integer NOT NULL,
  height_bp   integer NOT NULL,
  PRIMARY KEY (layout_id, position),
  CONSTRAINT layout_zone_position_range CHECK (position BETWEEN 0 AND 3),
  CONSTRAINT layout_zone_in_bounds CHECK (
    x_bp >= 0 AND y_bp >= 0 AND width_bp >= 1 AND height_bp >= 1
    AND x_bp + width_bp <= 10000 AND y_bp + height_bp <= 10000
  ),
  CONSTRAINT layout_zone_layout_fk FOREIGN KEY (layout_id, org_id)
    REFERENCES public.layout (id, org_id) ON DELETE CASCADE,
  CONSTRAINT layout_zone_playlist_fk FOREIGN KEY (playlist_id, org_id)
    REFERENCES public.playlist (id, org_id)
);
-- Layouts that use a given playlist (the fourth EXISTS of playlist_delete_guard).
CREATE INDEX layout_zone_playlist_idx ON public.layout_zone (playlist_id);

-- ------------------------------------------------------------ 3. deleted playlists

-- Same rule and same locking as schedule_playlist_guard (0009): using a playlist takes a share
-- lock on its row, which the UPDATE that deletes the playlist must hold exclusively, so one of
-- the two waits for the other and then sees its result. The error carries the trigger's name.
CREATE FUNCTION public.layout_zone_playlist_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  is_deleted boolean;
BEGIN
  -- A playlist that does not exist in this organisation is left to the foreign key.
  SELECT p.deleted_at IS NOT NULL INTO is_deleted
  FROM public.playlist p
  WHERE p.id = NEW.playlist_id AND p.org_id = NEW.org_id
  FOR SHARE;
  IF FOUND AND is_deleted THEN
    RAISE EXCEPTION 'a deleted playlist cannot be used in a layout'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = TG_NAME;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER layout_zone_playlist_guard
  BEFORE INSERT OR UPDATE OF playlist_id ON public.layout_zone
  FOR EACH ROW EXECUTE FUNCTION public.layout_zone_playlist_guard();
REVOKE ALL ON FUNCTION public.layout_zone_playlist_guard() FROM PUBLIC;

-- The 0009 function, replaced in place: it now also refuses while a layout uses the playlist.
-- Same trigger, same constraint name, same privileges (CREATE OR REPLACE keeps the 0005 REVOKE).
CREATE OR REPLACE FUNCTION public.playlist_delete_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND (
    EXISTS (SELECT 1 FROM public.display d
            WHERE d.assigned_playlist_id = OLD.id AND d.org_id = OLD.org_id)
    OR EXISTS (SELECT 1 FROM public.schedule s
               WHERE s.default_playlist_id = OLD.id AND s.org_id = OLD.org_id)
    OR EXISTS (SELECT 1 FROM public.schedule_event e
               WHERE e.playlist_id = OLD.id AND e.org_id = OLD.org_id)
    OR EXISTS (SELECT 1 FROM public.layout_zone z
               WHERE z.playlist_id = OLD.id AND z.org_id = OLD.org_id)
  ) THEN
    RAISE EXCEPTION 'a playlist that is assigned to a display or used by a schedule or a layout cannot be deleted'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'playlist_delete_guard';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------- 4. display

ALTER TABLE public.display
  -- The layout a push would publish to this display. Assigning changes nothing on the display.
  ADD COLUMN assigned_layout_id uuid,
  ADD CONSTRAINT display_assigned_layout_fk FOREIGN KEY (assigned_layout_id, org_id)
    REFERENCES public.layout (id, org_id),
  -- Same name as in 0009 (pinned by packages/db/test/stage-b-schedules.integration.test.ts).
  DROP CONSTRAINT display_one_assignment,
  ADD CONSTRAINT display_one_assignment
    CHECK (num_nonnulls(assigned_playlist_id, assigned_schedule_id, assigned_layout_id) <= 1);
-- Displays that have a given layout assigned (count per layout, refusal of a delete).
CREATE INDEX display_assigned_layout_idx ON public.display (assigned_layout_id)
  WHERE assigned_layout_id IS NOT NULL;

-- -------------------------------------------------------------- 5. RLS and grants

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['layout', 'layout_zone'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id())', t);
  END LOOP;
END $$;

-- Least privilege. A layout's identity is never updatable; zone rows are only added and removed.
GRANT SELECT, INSERT, DELETE ON public.layout TO tinnox_app;
GRANT UPDATE (name, description) ON public.layout TO tinnox_app;
GRANT SELECT, INSERT, DELETE ON public.layout_zone TO tinnox_app;
-- display is granted column by column. Required: the display PATCH writes every column.
GRANT UPDATE (assigned_layout_id) ON public.display TO tinnox_app;

-- ------------------------------------------------------------------ 6. publication

-- Last in the file, so the ACCESS EXCLUSIVE lock on publication is held for the shortest time.
-- The NULL-safe form of 0008 and 0009 (IS TRUE: a missing field fails instead of passing), with 5 added.
ALTER TABLE public.publication DROP CONSTRAINT publication_manifest_shape,
  ADD CONSTRAINT publication_manifest_shape CHECK (
    (
      jsonb_typeof(manifest) = 'object'
      AND manifest ->> 'schemaVersion' IN ('1', '2', '3', '4', '5')
      AND manifest ->> 'publicationId' = id::text
      AND manifest ->> 'displayId' = display_id::text
      AND jsonb_typeof(manifest -> 'assets') = 'array'
      AND jsonb_array_length(manifest -> 'assets') BETWEEN 1 AND 500
      AND pg_column_size(manifest) <= 1048576
    ) IS TRUE
  );

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
  FROM unnest(ARRAY['layout', 'layout_zone']) AS t(name)
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
