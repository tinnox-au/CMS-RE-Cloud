#!/usr/bin/env bash
# Backup and restore exercise (docs/security/operations-and-release-checklist.md section 2).
#   npm run backup:verify
# Dumps the development database as the PostgreSQL superuser, archives the media objects,
# restores both into a scratch database and a scratch directory, and verifies that
#   - row counts match,
#   - every ready media row has its file with the recorded size and SHA-256,
#   - every asset of every publication manifest resolves to a restored file whose SHA-256
#     and size equal the values frozen in the manifest,
#   - forced row-level security and the immutability triggers survived the restore.
# Stop the API first so the database and the files agree. Nothing is restored over the
# working database. The backup set is kept in BACKUP_ROOT (default ~/tinnox-backups);
# the scratch database and directory are removed at the end.
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo ".env not found; run npm run setup first" >&2; exit 2; }

DC=(docker compose --env-file .env -f infra/docker-compose.yml)
MEDIA_ROOT_VALUE="$(grep -E '^MEDIA_ROOT=' .env | cut -d= -f2-)"
MEDIA_ROOT_VALUE="${MEDIA_ROOT_VALUE:-./data/media}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_ROOT:-$HOME/tinnox-backups}/$STAMP"
RESTORE_ROOT="$BACKUP_DIR/restore-check"
RESTORE_DB="tinnox_restore"

psql_in() { "${DC[@]}" exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -d "$1" -At "${@:2}"; }

if curl -fsS -m 2 http://127.0.0.1:4000/healthz >/dev/null 2>&1; then
  echo "The API is running on port 4000. Stop it first so the backup is consistent." >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
echo "== backup into $BACKUP_DIR"
T0=$(date +%s)
"${DC[@]}" exec -T postgres pg_dump -U postgres -d tinnox --format=custom > "$BACKUP_DIR/tinnox.dump"
tar -C "$MEDIA_ROOT_VALUE" -cf "$BACKUP_DIR/media-objects.tar" objects
( cd "$BACKUP_DIR" && shasum -a 256 tinnox.dump media-objects.tar > SHA256SUMS )
git rev-parse HEAD > "$BACKUP_DIR/git-commit.txt" 2>/dev/null || true
T1=$(date +%s)
echo "dump bytes: $(wc -c < "$BACKUP_DIR/tinnox.dump" | tr -d ' ')"
echo "media archive bytes: $(wc -c < "$BACKUP_DIR/media-objects.tar" | tr -d ' ')"
echo "media objects in archive: $(tar -tf "$BACKUP_DIR/media-objects.tar" | grep -Ec '/[0-9a-f-]{36}$' || true)"

echo "== restore into database $RESTORE_DB and $RESTORE_ROOT"
mkdir -p "$RESTORE_ROOT"
( cd "$BACKUP_DIR" && shasum -a 256 -c SHA256SUMS )
"${DC[@]}" exec -T postgres dropdb -U postgres --if-exists "$RESTORE_DB"
"${DC[@]}" exec -T postgres createdb -U postgres -O tinnox_migrator "$RESTORE_DB"
"${DC[@]}" exec -T postgres pg_restore -U postgres -d "$RESTORE_DB" --exit-on-error < "$BACKUP_DIR/tinnox.dump"
tar -C "$RESTORE_ROOT" -xf "$BACKUP_DIR/media-objects.tar"
T2=$(date +%s)

FAIL=0
echo "== a. row counts"
# Every table in schema public, whatever migrations have added: a table that a later
# migration creates (tags, folders and their join tables in 0005) is counted without
# anyone having to remember this list.
Q="SELECT c.relname,
          (xpath('/row/n/text()',
                 query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
   FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
   ORDER BY 1"
psql_in tinnox -c "$Q" > "$RESTORE_ROOT/counts-source.txt"
psql_in "$RESTORE_DB" -c "$Q" > "$RESTORE_ROOT/counts-restore.txt"
cat "$RESTORE_ROOT/counts-restore.txt"
if [ "$(wc -l < "$RESTORE_ROOT/counts-source.txt" | tr -d ' ')" -lt 10 ]; then
  echo "TOO FEW TABLES COUNTED"; FAIL=1
elif diff "$RESTORE_ROOT/counts-source.txt" "$RESTORE_ROOT/counts-restore.txt" >/dev/null; then
  echo "counts match"
else
  echo "COUNTS DIFFER"; FAIL=1
fi

check_files() { # stdin: "<sha256> <storage_key> <bytes>" per line; $1: label
  local missing=0 hash=0 size=0 rows=0 sha key bytes file
  while read -r sha key bytes; do
    [ -n "$sha" ] || continue
    rows=$((rows + 1))
    file="$RESTORE_ROOT/objects/$key"
    if [ ! -f "$file" ]; then missing=$((missing + 1)); continue; fi
    [ "$(shasum -a 256 "$file" | cut -d' ' -f1)" = "$sha" ] || hash=$((hash + 1))
    [ "$(wc -c < "$file" | tr -d ' ')" = "$bytes" ] || size=$((size + 1))
  done
  echo "$1: checked $rows; missing $missing; hash mismatches $hash; size mismatches $size"
  [ "$rows" -gt 0 ] || { echo "$1: nothing to check (empty database?)"; return 1; }
  [ $((missing + hash + size)) -eq 0 ]
}

echo "== b. ready media rows against restored files"
psql_in "$RESTORE_DB" -F ' ' \
  -c "SELECT sha256, storage_key, bytes FROM media WHERE status = 'ready' AND storage_key IS NOT NULL ORDER BY storage_key" \
  | check_files "media rows" || FAIL=1

echo "== c. publication manifests against restored files"
# The hash and size come from the immutable manifest JSON, not from the media row.
psql_in "$RESTORE_DB" -F ' ' \
  -c "SELECT a->>'sha256', m.storage_key, a->>'bytes'
        FROM publication p
        CROSS JOIN LATERAL jsonb_array_elements(p.manifest->'assets') AS a
        JOIN media m ON m.org_id = p.org_id AND m.id = (a->>'assetId')::uuid
       ORDER BY p.created_at, 2" \
  | check_files "publication assets" || FAIL=1
PUBS=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM publication")
UNRESOLVED=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM publication p CROSS JOIN LATERAL jsonb_array_elements(p.manifest->'assets') AS a LEFT JOIN media m ON m.org_id = p.org_id AND m.id = (a->>'assetId')::uuid WHERE m.storage_key IS NULL")
ORPHANS=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM publication_asset pa LEFT JOIN media m ON m.id = pa.media_id AND m.org_id = pa.org_id WHERE m.id IS NULL")
echo "publications: $PUBS; manifest assets without a stored object: $UNRESOLVED; publication_asset rows without media: $ORPHANS"
[ "$UNRESOLVED" = "0" ] && [ "$ORPHANS" = "0" ] || FAIL=1

echo "== d. controls after restore"
# schema_migrations is the migration runner's bookkeeping table: no tenant data, no grant to the runtime role.
TABLES=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> 'schema_migrations'")
FORCED=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> 'schema_migrations' AND relrowsecurity AND relforcerowsecurity")
TRIGGERS=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")
SECFUNCS=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'sec' AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'tinnox_definer'")
echo "data tables in public: $TABLES; with forced row-level security: $FORCED; triggers: $TRIGGERS; sec functions owned by tinnox_definer: $SECFUNCS"
[ "$TABLES" = "$FORCED" ] && [ "$TRIGGERS" -gt 0 ] && [ "$SECFUNCS" -gt 0 ] || FAIL=1
# The restored database still refuses the runtime role without an organisation context.
VISIBLE=$("${DC[@]}" exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -d "$RESTORE_DB" -At \
  -c "SET ROLE tinnox_app" -c "SELECT count(*) FROM media" | tail -1)
echo "media rows visible to tinnox_app with no organisation context: $VISIBLE"
[ "$VISIBLE" = "0" ] || FAIL=1
if psql_in "$RESTORE_DB" -c "UPDATE publication SET idempotency_key = idempotency_key" >/dev/null 2>&1; then
  echo "PUBLICATION UPDATE WAS ALLOWED"; FAIL=1
else
  echo "publication update refused by trigger: yes"
fi

echo "== clean up"
"${DC[@]}" exec -T postgres dropdb -U postgres "$RESTORE_DB"
rm -rf "$RESTORE_ROOT"
echo "backup seconds: $((T1 - T0)); restore seconds: $((T2 - T1))"
if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: restore verified. Backup set kept in $BACKUP_DIR"
else
  echo "RESULT: FAILED" >&2
  exit 1
fi
