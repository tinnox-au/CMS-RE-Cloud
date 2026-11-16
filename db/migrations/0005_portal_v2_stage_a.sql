-- 0005: portal v2, stage A (docs/portal-v2/stage-a.md section 2.1). 0001 to 0004 are unchanged.
--
--   1. folder: flat media folders.
--   2. tag, media_tag, display_tag: tags for media and for displays.
--   3. media: operator-given name, description, default image duration, folder.
--   4. playlist: description and soft delete (deleted_at).
--   5. display: description and the assigned playlist (decision P2-05: assign, then push).
--   6. Row-level security and runtime grants for the new tables and columns.
--   7. Backfill of display.assigned_playlist_id from each display's desired publication.
--   8. A deleted playlist cannot be assigned, and an assigned playlist cannot be deleted.
--   9. audit_event: a category column computed from the action, and indexes for the
--      audit log filters.
--
-- Every bound below has its twin in packages/contracts (ABSOLUTE, TAG_SCOPES, TAG_COLOURS).
-- The migration takes ACCESS EXCLUSIVE locks on media, playlist, display, display_delivery,
-- publication and audit_event until it commits, and rewrites audit_event once (section 9);
-- run it while the API is stopped or idle.

-- ---------------------------------------------------------------------- 1. folder

CREATE TABLE public.folder (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organization (id),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  CONSTRAINT folder_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT folder_name_trimmed CHECK (name = btrim(name))
);
-- One folder per name in an organisation, ignoring case. Also serves the list, ordered by name.
CREATE UNIQUE INDEX folder_org_name_key ON public.folder (org_id, lower(name));
CREATE TRIGGER folder_set_updated_at BEFORE UPDATE ON public.folder
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------- 2. tags

CREATE TABLE public.tag (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organization (id),
  -- What the tag can be put on. Fixed for life: the runtime role has no UPDATE grant on it.
  scope      text NOT NULL,
  name       text NOT NULL,
  colour     text NOT NULL DEFAULT 'teal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  -- Referenced by the join tables, each of which accepts one scope only.
  UNIQUE (id, org_id, scope),
  CONSTRAINT tag_scope_known CHECK (scope IN ('media', 'display')),
  CONSTRAINT tag_name_length CHECK (char_length(name) BETWEEN 1 AND 40),
  CONSTRAINT tag_name_trimmed CHECK (name = btrim(name)),
  CONSTRAINT tag_colour_known CHECK (
    colour IN ('teal', 'sky', 'slate', 'green', 'amber', 'red', 'violet', 'pink')
  )
);
-- One tag per name in an organisation and scope, ignoring case. Also serves "tags of
-- this organisation and scope, ordered by name".
CREATE UNIQUE INDEX tag_org_scope_name_key ON public.tag (org_id, scope, lower(name));
CREATE TRIGGER tag_set_updated_at BEFORE UPDATE ON public.tag
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------ 3. media

ALTER TABLE public.media
  -- Name given by an operator. NULL means "show original_name".
  ADD COLUMN name                text,
  ADD COLUMN description         text,
  -- Images only: the time on screen proposed when the item is added to a playlist.
  ADD COLUMN default_duration_ms integer,
  -- NULL means the root of the library.
  ADD COLUMN folder_id           uuid,
  ADD CONSTRAINT media_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  ADD CONSTRAINT media_description_length CHECK (char_length(description) BETWEEN 1 AND 500),
  -- Same ceiling as playlist_item.duration_ms (24 hours). The configured image limits are
  -- narrower and are enforced by the API.
  ADD CONSTRAINT media_default_duration_range CHECK (default_duration_ms BETWEEN 1 AND 86400000),
  ADD CONSTRAINT media_default_duration_images_only CHECK (
    default_duration_ms IS NULL OR kind = 'image'
  ),
  -- Deleting a folder moves its media to the root. The column list keeps org_id untouched.
  ADD CONSTRAINT media_folder_fk FOREIGN KEY (folder_id, org_id)
    REFERENCES public.folder (id, org_id) ON DELETE SET NULL (folder_id);
-- Media of a folder (list filter, item count, and the foreign key's own SET NULL).
CREATE INDEX media_folder_idx ON public.media (folder_id) WHERE folder_id IS NOT NULL;

-- --------------------------------------------------------------------- 4. playlist

ALTER TABLE public.playlist
  ADD COLUMN description text,
  -- Soft delete. A playlist that was ever published is referenced by its publications
  -- for good, so the row stays; every query for live playlists filters on this column.
  ADD COLUMN deleted_at  timestamptz,
  ADD CONSTRAINT playlist_description_length CHECK (char_length(description) BETWEEN 1 AND 500);
-- Replaces playlist_org_idx: listings never include deleted playlists.
DROP INDEX public.playlist_org_idx;
CREATE INDEX playlist_live_idx ON public.playlist (org_id, created_at) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------- 5. display

ALTER TABLE public.display
  ADD COLUMN description          text,
  -- The playlist a push would publish to this display. Assigning changes nothing on the
  -- display: display_delivery.desired_publication_id still says what it was last given.
  ADD COLUMN assigned_playlist_id uuid,
  ADD CONSTRAINT display_description_length CHECK (char_length(description) BETWEEN 1 AND 500),
  ADD CONSTRAINT display_assigned_playlist_fk FOREIGN KEY (assigned_playlist_id, org_id)
    REFERENCES public.playlist (id, org_id);
-- Displays that have a given playlist assigned (count per playlist, refusal of a delete).
CREATE INDEX display_assigned_playlist_idx ON public.display (assigned_playlist_id)
  WHERE assigned_playlist_id IS NOT NULL;

-- ------------------------------------------------------------------ join tables

-- The primary key serves "tags of a media item"; the second index serves "media with a tag".
CREATE TABLE public.media_tag (
  media_id   uuid NOT NULL,
  tag_id     uuid NOT NULL,
  org_id     uuid NOT NULL REFERENCES public.organization (id),
  -- Constant. Part of the foreign key, so a display tag can never be put on media.
  scope      text NOT NULL DEFAULT 'media',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_id, tag_id),
  CONSTRAINT media_tag_scope_fixed CHECK (scope = 'media'),
  CONSTRAINT media_tag_media_fk FOREIGN KEY (media_id, org_id)
    REFERENCES public.media (id, org_id) ON DELETE CASCADE,
  CONSTRAINT media_tag_tag_fk FOREIGN KEY (tag_id, org_id, scope)
    REFERENCES public.tag (id, org_id, scope) ON DELETE CASCADE
);
CREATE INDEX media_tag_tag_idx ON public.media_tag (tag_id);

CREATE TABLE public.display_tag (
  display_id uuid NOT NULL,
  tag_id     uuid NOT NULL,
  org_id     uuid NOT NULL REFERENCES public.organization (id),
  -- Constant. Part of the foreign key, so a media tag can never be put on a display.
  scope      text NOT NULL DEFAULT 'display',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (display_id, tag_id),
  CONSTRAINT display_tag_scope_fixed CHECK (scope = 'display'),
  CONSTRAINT display_tag_display_fk FOREIGN KEY (display_id, org_id)
    REFERENCES public.display (id, org_id) ON DELETE CASCADE,
  CONSTRAINT display_tag_tag_fk FOREIGN KEY (tag_id, org_id, scope)
    REFERENCES public.tag (id, org_id, scope) ON DELETE CASCADE
);
CREATE INDEX display_tag_tag_idx ON public.display_tag (tag_id);

-- ------------------------------------------- 6. row-level security and privileges

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['folder', 'tag', 'media_tag', 'display_tag'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id())', t);
  END LOOP;
END $$;

-- Least privilege, as in 0001. The identity of a row (id, org_id, a tag's scope) is never
-- updatable; join rows are only ever added and removed.
GRANT SELECT, INSERT, DELETE ON public.folder, public.tag TO tinnox_app;
GRANT UPDATE (name) ON public.folder TO tinnox_app;
GRANT UPDATE (name, colour) ON public.tag TO tinnox_app;
GRANT SELECT, INSERT, DELETE ON public.media_tag, public.display_tag TO tinnox_app;

-- media and playlist already carry table-wide grants, which cover their new columns.
-- display is granted column by column.
GRANT UPDATE (description, assigned_playlist_id) ON public.display TO tinnox_app;

-- --------------------------------------------------- 7. backfill of the assignment

-- Before this migration "publish playlist P to display D" was the only way content
-- reached a display, so the playlist of a display's desired publication is what the
-- display has assigned. A display with no desired publication stays unassigned.
--
-- Row-level security is forced, so even the table owner sees no rows without an
-- organisation context, and this statement spans every organisation. FORCE is lifted
-- for the three tables it touches and restored below, inside this transaction: no
-- other session ever sees the tables without it, and the runtime role (never the
-- owner) stays subject to the policies throughout. The check at the end of this file
-- fails the migration if any table is left unforced.
ALTER TABLE public.display NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.display_delivery NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.publication NO FORCE ROW LEVEL SECURITY;
-- An assignment made by a migration is not an edit by an operator: keep updated_at.
ALTER TABLE public.display DISABLE TRIGGER display_set_updated_at;

UPDATE public.display d
SET assigned_playlist_id = p.playlist_id
FROM public.display_delivery dd
JOIN public.publication p
  ON p.id = dd.desired_publication_id AND p.org_id = dd.org_id AND p.display_id = dd.display_id
WHERE dd.display_id = d.id AND dd.org_id = d.org_id;

ALTER TABLE public.display ENABLE TRIGGER display_set_updated_at;
ALTER TABLE public.publication FORCE ROW LEVEL SECURITY;
ALTER TABLE public.display_delivery FORCE ROW LEVEL SECURITY;
ALTER TABLE public.display FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------ 8. deleted playlists and displays

-- The API refuses to delete an assigned playlist and to assign a deleted one. These
-- triggers hold the same rule under concurrency. An assignment takes a share lock on
-- the playlist row, which the UPDATE that deletes the playlist must hold exclusively,
-- so one of the two waits for the other and then sees its result. Each error carries
-- the trigger's name as its constraint name, so a caller can tell them apart.

CREATE FUNCTION public.display_assigned_playlist_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  is_deleted boolean;
BEGIN
  IF NEW.assigned_playlist_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_playlist_id IS NOT DISTINCT FROM OLD.assigned_playlist_id THEN
    RETURN NEW;
  END IF;
  -- A playlist that does not exist in this organisation is left to the foreign key.
  SELECT p.deleted_at IS NOT NULL INTO is_deleted
  FROM public.playlist p
  WHERE p.id = NEW.assigned_playlist_id AND p.org_id = NEW.org_id
  FOR SHARE;
  IF FOUND AND is_deleted THEN
    RAISE EXCEPTION 'a deleted playlist cannot be assigned to a display'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'display_assigned_playlist_guard';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER display_assigned_playlist_guard
  BEFORE INSERT OR UPDATE OF assigned_playlist_id ON public.display
  FOR EACH ROW EXECUTE FUNCTION public.display_assigned_playlist_guard();

CREATE FUNCTION public.playlist_delete_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.display d
    WHERE d.assigned_playlist_id = OLD.id AND d.org_id = OLD.org_id
  ) THEN
    RAISE EXCEPTION 'a playlist that is assigned to a display cannot be deleted'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'playlist_delete_guard';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER playlist_delete_guard BEFORE UPDATE OF deleted_at ON public.playlist
  FOR EACH ROW EXECUTE FUNCTION public.playlist_delete_guard();

-- Trigger functions run as the writing role; nobody needs to call them directly.
REVOKE ALL ON FUNCTION public.display_assigned_playlist_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.playlist_delete_guard() FROM PUBLIC;

-- ------------------------------------------------------------- 9. audit log filters

-- GET /api/audit filters by category (the part of the action before the first dot) and
-- by result, newest first.
--
-- The category is a stored generated column, not an index on the expression. Under
-- row-level security the planner uses a condition of the query as an index condition
-- only when everything in it is leakproof, so that it cannot be evaluated on rows the
-- policy would hide. split_part() is not leakproof: an index on the expression is never
-- used for "split_part(action, '.', 1) = $1" by a role that is subject to the policy,
-- and the filter would read the audit rows of every organisation. A plain column
-- compared with "=" is leakproof, like the result filter. The column is computed by the
-- database from the action for existing and new rows; no role can write it.
ALTER TABLE public.audit_event
  ADD COLUMN category text GENERATED ALWAYS AS (split_part(action, '.', 1)) STORED;
CREATE INDEX audit_event_org_category_idx ON public.audit_event (org_id, category, id DESC);
CREATE INDEX audit_event_org_result_idx ON public.audit_event (org_id, result, id DESC);

-- ---------------------------------------------------------------------- final checks

-- Same guard as 0001: fail if any table in public is without forced row-level security.
-- It covers the four new tables and the three whose FORCE was lifted for the backfill.
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
  FROM unnest(ARRAY['folder', 'tag', 'media_tag', 'display_tag']) AS t(name)
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
