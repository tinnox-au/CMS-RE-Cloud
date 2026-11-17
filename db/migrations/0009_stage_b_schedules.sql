-- 0009: portal v2, stage B slice 3: schedules (docs/portal-v2/stage-b.md, slice 3). 0001 to 0008 are unchanged.
--
--   1. schedule: a named timetable with a default playlist.
--   2. schedule_event: the weekly events of a schedule, in priority order.
--   3. display: a screen has a playlist or a schedule assigned, never both.
--   4. Deleted playlists: a schedule cannot use one, and a playlist that a schedule uses cannot be deleted.
--   5. publication: the manifest may be schema version 1, 2, 3 or 4.
--   6. Row-level security and runtime grants.
--
-- Every bound has its twin in packages/contracts (ScheduleRuleSchema, ABSOLUTE.maxScheduleEvents).
-- Takes ACCESS EXCLUSIVE locks on display and publication until commit, reads every display row and
-- re-reads every publication row to validate the new CHECKs; run it while the API is stopped or idle.

-- --------------------------------------------------------------------- 1. schedule

CREATE TABLE public.schedule (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organization (id),
  name                text NOT NULL,
  description         text,
  -- Plays whenever no event applies.
  default_playlist_id uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  CONSTRAINT schedule_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT schedule_name_trimmed CHECK (name = btrim(name)),
  CONSTRAINT schedule_description_length CHECK (char_length(description) BETWEEN 1 AND 500),
  CONSTRAINT schedule_default_playlist_fk FOREIGN KEY (default_playlist_id, org_id)
    REFERENCES public.playlist (id, org_id)
);
CREATE INDEX schedule_org_idx ON public.schedule (org_id, created_at);
-- Schedules that use a given playlist (refusal of a playlist delete).
CREATE INDEX schedule_default_playlist_idx ON public.schedule (default_playlist_id);
CREATE TRIGGER schedule_set_updated_at BEFORE UPDATE ON public.schedule
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --------------------------------------------------------------- 2. schedule_event

-- Rows are replaced as a set (delete, then insert), never updated; position is the identity.
CREATE TABLE public.schedule_event (
  schedule_id uuid NOT NULL,
  -- Priority order: the first event that covers a moment wins.
  position    integer NOT NULL,
  org_id      uuid NOT NULL REFERENCES public.organization (id),
  playlist_id uuid NOT NULL,
  -- Seven entries, Monday first: the days on which the event starts.
  days        boolean[] NOT NULL,
  -- Wall clock HH:mm in each screen's site zone. An end that is not after the start is on the next day.
  start_time  text NOT NULL,
  end_time    text NOT NULL,
  PRIMARY KEY (schedule_id, position),
  CONSTRAINT schedule_event_position_range CHECK (position BETWEEN 0 AND 49),
  -- One dimension, seven entries, no NULL, at least one true. The NULL test comes before ANY:
  -- with a NULL entry "true = ANY" is NULL, and a CHECK passes on NULL.
  CONSTRAINT schedule_event_days_shape CHECK (
    array_ndims(days) = 1
    AND array_lower(days, 1) = 1
    AND cardinality(days) = 7
    AND array_position(days, NULL::boolean) IS NULL
    AND true = ANY (days)
  ),
  CONSTRAINT schedule_event_start_format CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- 24:00 is the only way to say midnight at the end, so every rule has one stored form.
  CONSTRAINT schedule_event_end_format CHECK (
    end_time ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' AND end_time <> '00:00'
  ),
  CONSTRAINT schedule_event_not_empty CHECK (start_time <> end_time),
  CONSTRAINT schedule_event_schedule_fk FOREIGN KEY (schedule_id, org_id)
    REFERENCES public.schedule (id, org_id) ON DELETE CASCADE,
  CONSTRAINT schedule_event_playlist_fk FOREIGN KEY (playlist_id, org_id)
    REFERENCES public.playlist (id, org_id)
);
CREATE INDEX schedule_event_playlist_idx ON public.schedule_event (playlist_id);

-- ---------------------------------------------------------------------- 3. display

ALTER TABLE public.display
  -- The schedule a push would publish to this display. Assigning changes nothing on the display.
  ADD COLUMN assigned_schedule_id uuid,
  ADD CONSTRAINT display_assigned_schedule_fk FOREIGN KEY (assigned_schedule_id, org_id)
    REFERENCES public.schedule (id, org_id),
  ADD CONSTRAINT display_one_assignment
    CHECK (num_nonnulls(assigned_playlist_id, assigned_schedule_id) <= 1);
-- Displays that have a given schedule assigned (count per schedule, refusal of a delete).
CREATE INDEX display_assigned_schedule_idx ON public.display (assigned_schedule_id)
  WHERE assigned_schedule_id IS NOT NULL;

-- ------------------------------------------------------------ 4. deleted playlists

-- Same rule and same locking as display_assigned_playlist_guard (0005): using a playlist takes a
-- share lock on its row, which the UPDATE that deletes the playlist must hold exclusively, so one
-- of the two waits for the other and then sees its result. The error carries the trigger's name.
CREATE FUNCTION public.schedule_playlist_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  used_playlist_id uuid;
  is_deleted boolean;
BEGIN
  IF TG_TABLE_NAME = 'schedule' THEN
    used_playlist_id := NEW.default_playlist_id;
  ELSE
    used_playlist_id := NEW.playlist_id;
  END IF;
  -- A playlist that does not exist in this organisation is left to the foreign key.
  SELECT p.deleted_at IS NOT NULL INTO is_deleted
  FROM public.playlist p
  WHERE p.id = used_playlist_id AND p.org_id = NEW.org_id
  FOR SHARE;
  IF FOUND AND is_deleted THEN
    RAISE EXCEPTION 'a deleted playlist cannot be used in a schedule'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = TG_NAME;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER schedule_default_playlist_guard
  BEFORE INSERT OR UPDATE OF default_playlist_id ON public.schedule
  FOR EACH ROW EXECUTE FUNCTION public.schedule_playlist_guard();
CREATE TRIGGER schedule_event_playlist_guard
  BEFORE INSERT OR UPDATE OF playlist_id ON public.schedule_event
  FOR EACH ROW EXECUTE FUNCTION public.schedule_playlist_guard();
REVOKE ALL ON FUNCTION public.schedule_playlist_guard() FROM PUBLIC;

-- The 0005 function, replaced in place: it now also refuses while a schedule uses the playlist.
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
  ) THEN
    RAISE EXCEPTION 'a playlist that is assigned to a display or used by a schedule cannot be deleted'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'playlist_delete_guard';
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------------ 5. publication

-- The NULL-safe form of 0008 (IS TRUE: a missing field fails instead of passing), with 4 added.
ALTER TABLE public.publication DROP CONSTRAINT publication_manifest_shape,
  ADD CONSTRAINT publication_manifest_shape CHECK (
    (
      jsonb_typeof(manifest) = 'object'
      AND manifest ->> 'schemaVersion' IN ('1', '2', '3', '4')
      AND manifest ->> 'publicationId' = id::text
      AND manifest ->> 'displayId' = display_id::text
      AND jsonb_typeof(manifest -> 'assets') = 'array'
      AND jsonb_array_length(manifest -> 'assets') BETWEEN 1 AND 500
      AND pg_column_size(manifest) <= 1048576
    ) IS TRUE
  );

-- -------------------------------------------------------------- 6. RLS and grants

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['schedule', 'schedule_event'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id())', t);
  END LOOP;
END $$;

-- Least privilege. A schedule's identity is never updatable; event rows are only added and removed.
GRANT SELECT, INSERT, DELETE ON public.schedule TO tinnox_app;
GRANT UPDATE (name, description, default_playlist_id) ON public.schedule TO tinnox_app;
GRANT SELECT, INSERT, DELETE ON public.schedule_event TO tinnox_app;
-- display is granted column by column.
GRANT UPDATE (assigned_schedule_id) ON public.display TO tinnox_app;

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
  FROM unnest(ARRAY['schedule', 'schedule_event']) AS t(name)
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
