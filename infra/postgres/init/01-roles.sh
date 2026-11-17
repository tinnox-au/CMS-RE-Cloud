#!/bin/sh
# Creates the TINNOX roles and databases. Runs once, as the superuser, when the
# PostgreSQL data directory is first initialised (docker-entrypoint-initdb.d).
# The same script is used by CI against a service container, where PGHOST,
# PGPORT and PGPASSWORD select the server.
#
# Roles (prototype-m0.md D3, D4):
#   tinnox_migrator  owns the schema and runs migrations. Not a superuser.
#   tinnox_app       runtime role. No superuser, no BYPASSRLS, owns nothing.
#   tinnox_definer   cannot log in. Owns the narrow SECURITY DEFINER lookup
#                    functions that must read across organisations before the
#                    organisation is known (session, device token, pairing).
#
# Passwords come from the environment and are passed to psql as variables,
# so they are never interpolated into SQL text by the shell.
set -eu

: "${TINNOX_MIGRATOR_PASSWORD:?TINNOX_MIGRATOR_PASSWORD is required}"
: "${TINNOX_APP_PASSWORD:?TINNOX_APP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER:-postgres}" --dbname postgres \
  -v migrator_password="$TINNOX_MIGRATOR_PASSWORD" \
  -v app_password="$TINNOX_APP_PASSWORD" <<'SQL'
CREATE ROLE tinnox_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD :'migrator_password';
CREATE ROLE tinnox_app      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD :'app_password';
CREATE ROLE tinnox_definer  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS NOREPLICATION;

-- The migrator may hand function ownership to tinnox_definer (needs SET),
-- but does not inherit its privileges.
GRANT tinnox_definer TO tinnox_migrator WITH INHERIT FALSE, SET TRUE;

CREATE DATABASE tinnox      OWNER tinnox_migrator ENCODING 'UTF8';
CREATE DATABASE tinnox_test OWNER tinnox_migrator ENCODING 'UTF8';

REVOKE ALL ON DATABASE tinnox, tinnox_test FROM PUBLIC;
GRANT CONNECT ON DATABASE tinnox, tinnox_test TO tinnox_app;

-- Defaults for ad-hoc sessions. A role may change its own defaults, so the API also
-- sends the same timeouts (and row_security = on) when it connects (packages/db createPool).
ALTER ROLE tinnox_app      SET statement_timeout = '15s';
ALTER ROLE tinnox_app      SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE tinnox_app      SET lock_timeout = '5s';
ALTER ROLE tinnox_migrator SET lock_timeout = '30s';
ALTER DATABASE tinnox      SET timezone = 'UTC';
ALTER DATABASE tinnox_test SET timezone = 'UTC';
SQL
