-- 0006: portal v2, stage B slice 1 (docs/portal-v2/stage-b.md section 2). 0001 to 0005 are unchanged.
--
--   1. playlist: transition between items and shuffle.
--   2. media: availability window and the key of an image thumbnail.
--   3. display: rotation and working hours, with runtime grants for both.
--   4. publication: the manifest may be schema version 1 or 2.
--
-- No new table, policy, trigger or FORCE change. Every bound below has its twin in
-- packages/contracts (TRANSITIONS, ROTATIONS, WorkingHoursSchema).
-- The migration takes ACCESS EXCLUSIVE locks on playlist, media, display and publication
-- until it commits, and reads every row of each to validate the new constraints; run it
-- while the API is stopped or idle.

-- --------------------------------------------------------------------- 1. playlist

ALTER TABLE public.playlist
  ADD COLUMN transition text NOT NULL DEFAULT 'cut',
  ADD COLUMN shuffle    boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT playlist_transition_known CHECK (transition IN ('cut', 'fade'));

-- ------------------------------------------------------------------------ 2. media

ALTER TABLE public.media
  -- Wall clock, evaluated in each screen's site zone. NULL means no limit on that side.
  ADD COLUMN available_from    timestamp(0),
  ADD COLUMN available_until   timestamp(0),
  -- Written by the media pipeline for images only; NULL serves the original.
  ADD COLUMN thumb_storage_key text UNIQUE,
  ADD CONSTRAINT media_availability_order CHECK (
    available_from IS NULL OR available_until IS NULL OR available_from < available_until
  ),
  ADD CONSTRAINT media_thumb_storage_key_in_own_org CHECK (
    thumb_storage_key IS NULL OR thumb_storage_key ~ ('^' || org_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  );

-- ---------------------------------------------------------------------- 3. display

ALTER TABLE public.display
  ADD COLUMN rotation      smallint NOT NULL DEFAULT 0,
  -- Seven entries, Monday first; NULL means always on. The day shape is checked by the API.
  ADD COLUMN working_hours jsonb,
  ADD CONSTRAINT display_rotation_known CHECK (rotation IN (0, 90, 180, 270)),
  ADD CONSTRAINT display_working_hours_shape CHECK (
    working_hours IS NULL OR (
      jsonb_typeof(working_hours) = 'array'
      AND jsonb_array_length(working_hours) = 7
      AND pg_column_size(working_hours) <= 1024
    )
  );

-- media and playlist already carry table-wide grants, which cover their new columns.
-- display is granted column by column.
GRANT UPDATE (rotation, working_hours) ON public.display TO tinnox_app;

-- ------------------------------------------------------------------ 4. publication

ALTER TABLE public.publication DROP CONSTRAINT publication_manifest_shape,
  ADD CONSTRAINT publication_manifest_shape CHECK (
    jsonb_typeof(manifest) = 'object'
    AND manifest ->> 'schemaVersion' IN ('1', '2')
    AND manifest ->> 'publicationId' = id::text
    AND manifest ->> 'displayId' = display_id::text
    AND jsonb_typeof(manifest -> 'assets') = 'array'
    AND jsonb_array_length(manifest -> 'assets') BETWEEN 1 AND 500
    AND pg_column_size(manifest) <= 1048576
  );
