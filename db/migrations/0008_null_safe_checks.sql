-- 0008: two completeness checks no longer pass on SQL NULL (backend review round 1, CX-02).
-- 0001 to 0007 are unchanged.
--
-- A CHECK rejects a row only when its expression is false; NULL passes. Two checks compared
-- values that may be absent, so the comparison was NULL and the row was accepted:
--
--   1. publication_manifest_shape: a manifest without schemaVersion, publicationId, displayId
--      or assets ('{}' included) was accepted.
--   2. media_ready_is_complete: a ready media row with bytes NULL was accepted.
--
-- The rules themselves are the same as in 0007 and 0001. The application never wrote such
-- rows (packages/domain builds and validates every manifest and refuses media without a
-- size), so existing data is expected to pass; if a row does not, this migration fails and
-- changes nothing.
-- Takes ACCESS EXCLUSIVE locks on publication and media until commit and re-reads every row
-- of both to validate the new CHECKs; run it while the API is stopped or idle.

-- ------------------------------------------------------------------ 1. publication

ALTER TABLE public.publication DROP CONSTRAINT publication_manifest_shape,
  ADD CONSTRAINT publication_manifest_shape CHECK (
    (
      jsonb_typeof(manifest) = 'object'
      AND manifest ->> 'schemaVersion' IN ('1', '2', '3')
      AND manifest ->> 'publicationId' = id::text
      AND manifest ->> 'displayId' = display_id::text
      AND jsonb_typeof(manifest -> 'assets') = 'array'
      AND jsonb_array_length(manifest -> 'assets') BETWEEN 1 AND 500
      AND pg_column_size(manifest) <= 1048576
    ) IS TRUE
  );

-- ------------------------------------------------------------------------ 2. media

ALTER TABLE public.media DROP CONSTRAINT media_ready_is_complete,
  ADD CONSTRAINT media_ready_is_complete CHECK (
    status <> 'ready' OR (
      mime_type IS NOT NULL AND bytes IS NOT NULL AND bytes > 0 AND sha256 IS NOT NULL
      AND width IS NOT NULL AND height IS NOT NULL AND storage_key IS NOT NULL
      AND error_code IS NULL
      AND (kind <> 'video' OR (duration_ms IS NOT NULL AND codec IS NOT NULL))
    )
  );
