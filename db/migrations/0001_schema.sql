-- 0001: tables, constraints, row-level security and runtime grants.
-- Runs as tinnox_migrator (the database owner). Each migration file is one transaction.
--
-- Tenant isolation (prototype-m0.md D3, D4):
--   * every tenant table carries org_id and has ENABLE + FORCE ROW LEVEL SECURITY;
--   * the single policy compares org_id with public.app_org_id(), which reads the
--     transaction-scoped setting app.org_id; with no setting, no row is visible;
--   * child rows reference parents with composite (id, org_id) foreign keys, so a
--     row can never point at another organisation's row even if a policy is bypassed.

CREATE SCHEMA sec;
REVOKE ALL ON SCHEMA sec FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO tinnox_app, tinnox_definer;
GRANT USAGE ON SCHEMA sec TO tinnox_app;
GRANT USAGE, CREATE ON SCHEMA sec TO tinnox_definer;

-- Functions are not executable by anyone unless granted explicitly.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Current organisation of this transaction, or NULL. An empty or malformed value
-- yields NULL or an error; both fail closed.
CREATE FUNCTION public.app_org_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(pg_catalog.current_setting('app.org_id', true), '')::pg_catalog.uuid $$;
GRANT EXECUTE ON FUNCTION public.app_org_id() TO tinnox_app, tinnox_definer;

CREATE FUNCTION public.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END $$;

CREATE FUNCTION public.reject_change() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  RAISE EXCEPTION '% on table % is not allowed: rows are immutable', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

-- ---------------------------------------------------------------- organisation

CREATE TABLE public.organization (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.membership (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organization (id),
  -- Subject identifier from the identity provider. One organisation per subject in M0.
  oidc_sub   text NOT NULL CHECK (char_length(oidc_sub) BETWEEN 1 AND 255),
  role       text NOT NULL DEFAULT 'operator' CHECK (role IN ('operator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oidc_sub),
  UNIQUE (id, org_id)
);

CREATE TABLE public.site (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organization (id),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  -- IANA time zone name. Event timestamps are stored in UTC regardless.
  timezone   text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);

-- --------------------------------------------------------------------- display

CREATE TABLE public.display (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organization (id),
  site_id        uuid NOT NULL,
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  canvas_width   integer NOT NULL CHECK (canvas_width BETWEEN 16 AND 16384),
  canvas_height  integer NOT NULL CHECK (canvas_height BETWEEN 16 AND 16384),
  -- Optional content rectangle inside the canvas; all four set or all four NULL.
  content_x      integer,
  content_y      integer,
  content_width  integer,
  content_height integer,
  default_fit    text NOT NULL DEFAULT 'contain' CHECK (default_fit IN ('contain', 'cover')),
  route          text NOT NULL DEFAULT 'browser' CHECK (route IN ('browser')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  FOREIGN KEY (site_id, org_id) REFERENCES public.site (id, org_id),
  CONSTRAINT display_content_rect_all_or_none CHECK (
    num_nulls(content_x, content_y, content_width, content_height) IN (0, 4)
  ),
  CONSTRAINT display_content_rect_in_canvas CHECK (
    content_x IS NULL OR (
      content_x >= 0 AND content_y >= 0
      AND content_width >= 16 AND content_height >= 16
      AND content_x + content_width <= canvas_width
      AND content_y + content_height <= canvas_height
    )
  )
);
CREATE INDEX display_org_idx ON public.display (org_id, created_at);
CREATE TRIGGER display_set_updated_at BEFORE UPDATE ON public.display
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------ player and pairing

CREATE TABLE public.player_registration (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organization (id),
  display_id     uuid NOT NULL,
  -- SHA-256 of the device token. The token itself is never stored.
  token_hash     bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_reason text CHECK (revoked_reason IN ('operator', 'replaced', 'player_reset')),
  UNIQUE (id, org_id),
  FOREIGN KEY (display_id, org_id) REFERENCES public.display (id, org_id),
  CONSTRAINT player_registration_revocation_pair CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
-- At most one active registration per display.
CREATE UNIQUE INDEX player_registration_one_active_per_display
  ON public.player_registration (display_id) WHERE revoked_at IS NULL;
CREATE INDEX player_registration_org_idx ON public.player_registration (org_id, display_id);

-- A revocation is permanent, and the credential of a registration never changes.
CREATE FUNCTION public.player_registration_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
                                     OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason) THEN
    RAISE EXCEPTION 'a revoked player registration cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.display_id IS DISTINCT FROM OLD.display_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'player registration identity is immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER player_registration_guard BEFORE UPDATE ON public.player_registration
  FOR EACH ROW EXECUTE FUNCTION public.player_registration_guard();

-- Pairing sessions exist before any organisation is known, so this table is not a
-- tenant table. The runtime role has no privileges on it; it is reached only
-- through the sec.pairing_* functions.
CREATE TABLE public.pairing_session (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL CHECK (code ~ '^[2-9A-HJKMNP-TV-Z]{8}$'),
  polling_token_hash    bytea NOT NULL UNIQUE CHECK (octet_length(polling_token_hash) = 32),
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'claimed', 'completed', 'expired', 'locked')),
  failed_attempts       integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  -- Opaque rate-limit key chosen by the API (for example a keyed hash of the client address).
  client_key            text NOT NULL CHECK (char_length(client_key) BETWEEN 1 AND 128),
  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  claimed_at            timestamptz,
  claimed_by_membership uuid,
  org_id                uuid,
  display_id            uuid,
  completed_at          timestamptz,
  registration_id       uuid,
  FOREIGN KEY (display_id, org_id) REFERENCES public.display (id, org_id),
  CONSTRAINT pairing_session_claim_fields CHECK (
    status IN ('expired', 'locked')
    OR ((status IN ('claimed', 'completed')) = (org_id IS NOT NULL AND display_id IS NOT NULL AND claimed_at IS NOT NULL))
  ),
  CONSTRAINT pairing_session_completed_fields CHECK (
    (status = 'completed') = (registration_id IS NOT NULL AND completed_at IS NOT NULL)
  )
);
-- A code identifies at most one claimable session.
CREATE UNIQUE INDEX pairing_session_pending_code ON public.pairing_session (code) WHERE status = 'pending';
CREATE INDEX pairing_session_client_idx ON public.pairing_session (client_key, created_at);

-- Failed claim attempts per operator, for throttling code guessing. Not a tenant table; no runtime grants.
CREATE TABLE public.pairing_claim_failure (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  membership_id uuid NOT NULL REFERENCES public.membership (id) ON DELETE CASCADE,
  failed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pairing_claim_failure_idx ON public.pairing_claim_failure (membership_id, failed_at);

-- ----------------------------------------------------------------------- media

CREATE TABLE public.media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organization (id),
  kind          text NOT NULL CHECK (kind IN ('image', 'video')),
  status        text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  error_code    text CHECK (char_length(error_code) <= 60),
  error_detail  text CHECK (char_length(error_detail) <= 500),
  mime_type     text CHECK (mime_type IN ('image/jpeg', 'image/png', 'video/mp4')),
  bytes         bigint CHECK (bytes >= 0),
  sha256        text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  width         integer CHECK (width > 0),
  height        integer CHECK (height > 0),
  duration_ms   integer CHECK (duration_ms > 0),
  codec         text CHECK (char_length(codec) <= 40),
  -- Server-generated "<org uuid>/<object uuid>". Never derived from a file name.
  storage_key   text UNIQUE,
  -- Display label only. Never used to build a path or a command.
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (id, org_id),
  FOREIGN KEY (created_by, org_id) REFERENCES public.membership (id, org_id),
  CONSTRAINT media_storage_key_in_own_org CHECK (
    storage_key IS NULL OR storage_key ~ ('^' || org_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  ),
  CONSTRAINT media_ready_is_complete CHECK (
    status <> 'ready' OR (
      mime_type IS NOT NULL AND bytes > 0 AND sha256 IS NOT NULL AND width IS NOT NULL
      AND height IS NOT NULL AND storage_key IS NOT NULL AND error_code IS NULL
      AND (kind <> 'video' OR (duration_ms IS NOT NULL AND codec IS NOT NULL))
    )
  ),
  CONSTRAINT media_failed_has_code CHECK (status <> 'failed' OR error_code IS NOT NULL)
);
CREATE INDEX media_org_idx ON public.media (org_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX media_processing_idx ON public.media (created_at) WHERE status = 'processing';
CREATE TRIGGER media_set_updated_at BEFORE UPDATE ON public.media
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------------- playlist

CREATE TABLE public.playlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organization (id),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);
CREATE INDEX playlist_org_idx ON public.playlist (org_id, created_at);
CREATE TRIGGER playlist_set_updated_at BEFORE UPDATE ON public.playlist
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.playlist_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organization (id),
  playlist_id uuid NOT NULL,
  position    integer NOT NULL CHECK (position >= 0),
  media_id    uuid NOT NULL,
  -- Required for images, NULL for video (natural duration). Enforced by the domain rules.
  duration_ms integer CHECK (duration_ms BETWEEN 1 AND 86400000),
  -- NULL means "use the display's default fit at publish time".
  fit         text CHECK (fit IN ('contain', 'cover')),
  FOREIGN KEY (playlist_id, org_id) REFERENCES public.playlist (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (media_id, org_id) REFERENCES public.media (id, org_id),
  UNIQUE (playlist_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX playlist_item_media_idx ON public.playlist_item (media_id);

-- ----------------------------------------------------------------- publication

CREATE TABLE public.publication (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organization (id),
  display_id      uuid NOT NULL,
  playlist_id     uuid NOT NULL,
  -- Manifest v1, stored exactly as delivered to players.
  manifest        jsonb NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (id, org_id, display_id),
  -- A retried publish with the same key returns the same publication.
  CONSTRAINT publication_idempotency UNIQUE (org_id, display_id, idempotency_key),
  FOREIGN KEY (display_id, org_id) REFERENCES public.display (id, org_id),
  FOREIGN KEY (playlist_id, org_id) REFERENCES public.playlist (id, org_id),
  FOREIGN KEY (created_by, org_id) REFERENCES public.membership (id, org_id),
  CONSTRAINT publication_manifest_shape CHECK (
    jsonb_typeof(manifest) = 'object'
    AND manifest ->> 'schemaVersion' = '1'
    AND manifest ->> 'publicationId' = id::text
    AND manifest ->> 'displayId' = display_id::text
    AND jsonb_typeof(manifest -> 'assets') = 'array'
    AND jsonb_array_length(manifest -> 'assets') BETWEEN 1 AND 500
    AND pg_column_size(manifest) <= 1048576
  )
);
CREATE INDEX publication_display_idx ON public.publication (display_id, created_at DESC);

-- One row per manifest entry. Gives the database a real reference from a
-- publication to its media, so published media cannot be hard-deleted and
-- player downloads can be authorised with a join.
CREATE TABLE public.publication_asset (
  publication_id uuid NOT NULL,
  position       integer NOT NULL CHECK (position >= 0),
  org_id         uuid NOT NULL REFERENCES public.organization (id),
  media_id       uuid NOT NULL,
  PRIMARY KEY (publication_id, position),
  FOREIGN KEY (publication_id, org_id) REFERENCES public.publication (id, org_id),
  FOREIGN KEY (media_id, org_id) REFERENCES public.media (id, org_id)
);
CREATE INDEX publication_asset_media_idx ON public.publication_asset (media_id);

-- Publications are immutable for every role, including the table owner.
CREATE TRIGGER publication_immutable BEFORE UPDATE OR DELETE ON public.publication
  FOR EACH ROW EXECUTE FUNCTION public.reject_change();
CREATE TRIGGER publication_no_truncate BEFORE TRUNCATE ON public.publication
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_change();
CREATE TRIGGER publication_asset_immutable BEFORE UPDATE OR DELETE ON public.publication_asset
  FOR EACH ROW EXECUTE FUNCTION public.reject_change();
CREATE TRIGGER publication_asset_no_truncate BEFORE TRUNCATE ON public.publication_asset
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_change();

-- ------------------------------------------------------------- delivery status

CREATE TABLE public.display_delivery (
  display_id                uuid PRIMARY KEY,
  org_id                    uuid NOT NULL REFERENCES public.organization (id),
  -- What the operator published.
  desired_publication_id    uuid,
  desired_at                timestamptz,
  -- What the player software last reported. Evidence from software, not proof of panel output.
  reporting_registration_id uuid,
  last_seq                  bigint CHECK (last_seq >= 0),
  downloaded_publication_id uuid,
  active_publication_id     uuid,
  active_item_index         integer CHECK (active_item_index >= 0),
  player_state              text CHECK (player_state IN ('idle', 'playing', 'error')),
  staging                   jsonb CHECK (pg_column_size(staging) <= 2048),
  last_errors               jsonb NOT NULL DEFAULT '[]'::jsonb
                              CHECK (jsonb_typeof(last_errors) = 'array' AND pg_column_size(last_errors) <= 16384),
  last_heartbeat_at         timestamptz,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (display_id, org_id) REFERENCES public.display (id, org_id) ON DELETE CASCADE,
  -- Each publication reference must be a publication of this same display and organisation.
  FOREIGN KEY (desired_publication_id, org_id, display_id) REFERENCES public.publication (id, org_id, display_id),
  FOREIGN KEY (downloaded_publication_id, org_id, display_id) REFERENCES public.publication (id, org_id, display_id),
  FOREIGN KEY (active_publication_id, org_id, display_id) REFERENCES public.publication (id, org_id, display_id),
  FOREIGN KEY (reporting_registration_id, org_id) REFERENCES public.player_registration (id, org_id),
  CONSTRAINT display_delivery_active_pair CHECK ((active_publication_id IS NULL) = (active_item_index IS NULL))
);
CREATE TRIGGER display_delivery_set_updated_at BEFORE UPDATE ON public.display_delivery
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.heartbeat_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          uuid NOT NULL REFERENCES public.organization (id),
  display_id      uuid NOT NULL,
  registration_id uuid NOT NULL,
  seq             bigint NOT NULL CHECK (seq >= 0),
  accepted        boolean NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  payload         jsonb NOT NULL CHECK (pg_column_size(payload) <= 16384),
  FOREIGN KEY (display_id, org_id) REFERENCES public.display (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (registration_id, org_id) REFERENCES public.player_registration (id, org_id)
);
CREATE INDEX heartbeat_log_display_idx ON public.heartbeat_log (display_id, received_at DESC);
CREATE INDEX heartbeat_log_received_idx ON public.heartbeat_log (received_at);

-- ----------------------------------------------------------------------- audit

CREATE TABLE public.audit_event (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- NULL only for events that happen before an organisation is known (written via sec.audit_unscoped).
  org_id      uuid REFERENCES public.organization (id),
  actor_type  text NOT NULL CHECK (actor_type IN ('operator', 'player', 'system', 'anonymous')),
  -- Membership id or registration id. Never a name, e-mail address or token.
  actor_id    text CHECK (char_length(actor_id) <= 100),
  action      text NOT NULL CHECK (action ~ '^[a-z_]+(\.[a-z_]+)+$' AND char_length(action) <= 80),
  object_type text CHECK (char_length(object_type) <= 40),
  object_id   text CHECK (char_length(object_id) <= 100),
  result      text NOT NULL CHECK (result IN ('success', 'failure', 'denied')),
  -- Small structured context. Never file content, secrets or signed URLs.
  detail      jsonb CHECK (pg_column_size(detail) <= 4096)
);
CREATE INDEX audit_event_org_idx ON public.audit_event (org_id, id DESC);

-- Audit rows are never rewritten, by any role. Deleting (retention) is reserved
-- to the migrator role; the runtime role has no DELETE privilege.
CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON public.audit_event
  FOR EACH ROW EXECUTE FUNCTION public.reject_change();

-- ------------------------------------------------- operator sessions and login

-- Not tenant tables: they are read before the organisation is known. The runtime
-- role has no privileges on them; access is only through sec.* functions.
CREATE TABLE public.session (
  -- SHA-256 of the opaque cookie value. The cookie value itself is never stored.
  id_hash       bytea PRIMARY KEY CHECK (octet_length(id_hash) = 32),
  membership_id uuid NOT NULL,
  org_id        uuid NOT NULL,
  oidc_sub      text NOT NULL,
  csrf_token    text NOT NULL CHECK (char_length(csrf_token) BETWEEN 32 AND 128),
  -- Kept server-side only, for RP-initiated logout (id_token_hint).
  id_token      text CHECK (char_length(id_token) <= 8192),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  FOREIGN KEY (membership_id, org_id) REFERENCES public.membership (id, org_id) ON DELETE CASCADE
);
CREATE INDEX session_expires_idx ON public.session (expires_at);

CREATE TABLE public.login_state (
  -- SHA-256 of the OAuth "state" value.
  state_hash    bytea PRIMARY KEY CHECK (octet_length(state_hash) = 32),
  code_verifier text NOT NULL CHECK (char_length(code_verifier) BETWEEN 43 AND 128),
  nonce         text NOT NULL CHECK (char_length(nonce) BETWEEN 16 AND 128),
  return_to     text CHECK (char_length(return_to) <= 200),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX login_state_expires_idx ON public.login_state (expires_at);

-- ---------------------------------------------------------- row-level security

ALTER TABLE public.organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.organization
  USING (id = public.app_org_id()) WITH CHECK (id = public.app_org_id());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'membership', 'site', 'display', 'player_registration', 'media', 'playlist', 'playlist_item',
    'publication', 'publication_asset', 'display_delivery', 'heartbeat_log', 'audit_event'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id())', t);
  END LOOP;
END $$;

-- Tables without a tenant policy are locked down instead: RLS on, no policy, so
-- only a BYPASSRLS role (tinnox_definer, inside sec.* functions) can read them.
ALTER TABLE public.session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session FORCE ROW LEVEL SECURITY;
ALTER TABLE public.login_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_state FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pairing_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pairing_session FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pairing_claim_failure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pairing_claim_failure FORCE ROW LEVEL SECURITY;

-- Fail the migration if any table in public was left without forced row-level security.
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

-- ------------------------------------------------------- runtime role privileges
-- Least privilege: only what the API needs. No TRUNCATE, REFERENCES or TRIGGER anywhere.

GRANT SELECT ON public.organization, public.membership, public.site TO tinnox_app;

GRANT SELECT, INSERT ON public.display TO tinnox_app;
GRANT UPDATE (name, canvas_width, canvas_height, content_x, content_y, content_width, content_height, default_fit)
  ON public.display TO tinnox_app;

-- Registrations are created only by sec.pairing_complete. The runtime role may revoke.
GRANT SELECT ON public.player_registration TO tinnox_app;
GRANT UPDATE (revoked_at, revoked_reason) ON public.player_registration TO tinnox_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media, public.playlist, public.playlist_item TO tinnox_app;

-- Insert and read only: publications are immutable.
GRANT SELECT, INSERT ON public.publication, public.publication_asset TO tinnox_app;

GRANT SELECT, INSERT, UPDATE ON public.display_delivery TO tinnox_app;
GRANT SELECT, INSERT, DELETE ON public.heartbeat_log TO tinnox_app;

-- Append-only audit trail.
GRANT SELECT, INSERT ON public.audit_event TO tinnox_app;

-- What the SECURITY DEFINER functions (owned by tinnox_definer) may touch.
GRANT SELECT ON public.organization, public.membership, public.display TO tinnox_definer;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session, public.login_state, public.pairing_session,
  public.pairing_claim_failure TO tinnox_definer;
GRANT SELECT, INSERT ON public.player_registration TO tinnox_definer;
GRANT UPDATE (revoked_at, revoked_reason) ON public.player_registration TO tinnox_definer;
GRANT INSERT ON public.audit_event TO tinnox_definer;
