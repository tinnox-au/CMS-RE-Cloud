#!/usr/bin/env bash
# Backup and restore exercise (docs/security/operations-and-release-checklist.md section 2).
#   npm run backup:verify
# Dumps the development database as the PostgreSQL superuser, archives the media objects,
# restores both into a scratch database and a scratch directory, and verifies that
#   - row counts match, and so does the number of ready media rows,
#   - every ready media row has its file with the recorded size and SHA-256,
#   - every thumbnail a media row names is a restored, non-empty file (the row stores no
#     thumbnail hash, so presence is all that can be checked),
#   - every media item of every publication manifest resolves to a restored file whose
#     SHA-256 and size equal the values frozen in the manifest (app items carry their
#     content in the manifest and have no file; they are counted, not looked up),
#   - forced row-level security, the runtime role's isolation and the publication
#     immutability triggers survived the restore.
# A database with no ready media (only apps) or with no publications yet is valid; when the
# backup holds no media file at all the result says so. A database with no organisation is
# empty: there is nothing to verify, so it fails instead of passing on nothing.
# Stop the API first so the database and the files agree. Nothing is restored over the
# working database. The backup set is kept in BACKUP_ROOT (default ~/tinnox-backups);
# the scratch database and directory are removed at the end.
#
# Optional overrides (tests/integration/backup-restore-check.test.ts uses them):
#   BACKUP_SOURCE_DB   database to back up (default tinnox)
#   BACKUP_RESTORE_DB  scratch database; it is dropped and recreated, so its name must end in
#                      _restore or _restore_test and differ from the source (default tinnox_restore)
#   BACKUP_MEDIA_ROOT  media root to archive (default MEDIA_ROOT from .env, else ./data/media)
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo ".env not found; run npm run setup first" >&2; exit 2; }

DC=(docker compose --env-file .env -f infra/docker-compose.yml)
MEDIA_ROOT_VALUE="${BACKUP_MEDIA_ROOT:-$(grep -E '^MEDIA_ROOT=' .env | cut -d= -f2- || true)}"
MEDIA_ROOT_VALUE="${MEDIA_ROOT_VALUE:-./data/media}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_ROOT:-$HOME/tinnox-backups}/$STAMP"
RESTORE_ROOT="$BACKUP_DIR/restore-check"
SOURCE_DB="${BACKUP_SOURCE_DB:-tinnox}"
RESTORE_DB="${BACKUP_RESTORE_DB:-tinnox_restore}"

for name in "$SOURCE_DB" "$RESTORE_DB"; do
  # At most 63 bytes: PostgreSQL truncates longer names, so a long scratch name could be the source.
  [[ "$name" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "invalid database name: $name" >&2; exit 2; }
done
# The scratch database is dropped before the restore: never let that be the source.
case "$RESTORE_DB" in
  *_restore | *_restore_test) ;;
  *) echo "BACKUP_RESTORE_DB must end in _restore or _restore_test (it is dropped): $RESTORE_DB" >&2; exit 2 ;;
esac
[ "$RESTORE_DB" != "$SOURCE_DB" ] || { echo "the restore database must differ from the source" >&2; exit 2; }

psql_in() { "${DC[@]}" exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -d "$1" -At "${@:2}"; }

# The API writes the database named in DATABASE_URL; only a backup of that one must wait for it.
# A value that does not parse to a plain name counts as the source, so the check is not skipped.
API_DB="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -E 's#^.*/([^/?]+)([?].*)?$#\1#' || true)"
[[ "$API_DB" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || API_DB="$SOURCE_DB"
if [ "$SOURCE_DB" = "$API_DB" ] && curl -fsS -m 2 http://127.0.0.1:4000/healthz >/dev/null 2>&1; then
  echo "The API is running on port 4000. Stop it first so the backup is consistent." >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
echo "== backup into $BACKUP_DIR"
T0=$(date +%s)
"${DC[@]}" exec -T postgres pg_dump -U postgres -d "$SOURCE_DB" --format=custom > "$BACKUP_DIR/tinnox.dump"
tar -C "$MEDIA_ROOT_VALUE" -cf "$BACKUP_DIR/media-objects.tar" objects
( cd "$BACKUP_DIR" && shasum -a 256 tinnox.dump media-objects.tar > SHA256SUMS )
git rev-parse HEAD > "$BACKUP_DIR/git-commit.txt" 2>/dev/null || true
T1=$(date +%s)
echo "dump bytes: $(wc -c < "$BACKUP_DIR/tinnox.dump" | tr -d ' ')"
echo "media archive bytes: $(wc -c < "$BACKUP_DIR/media-objects.tar" | tr -d ' ')"
echo "media objects in archive: $(tar -tf "$BACKUP_DIR/media-objects.tar" | grep -Ec '/[0-9a-f-]{36}$' || true)"

# The scratch database and directory go whatever happens next, also when a step aborts.
cleanup() {
  "${DC[@]}" exec -T postgres dropdb -U postgres --if-exists "$RESTORE_DB" >/dev/null 2>&1 || true
  rm -rf "$RESTORE_ROOT"
}
trap cleanup EXIT

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
# anyone having to remember this list. The number of ready media rows is compared too, as a
# cross-check: it decides which files (b) verifies.
Q="SELECT c.relname,
          (xpath('/row/n/text()',
                 query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
   FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
   UNION ALL
   SELECT 'media (status ready)', (SELECT count(*) FROM public.media WHERE status = 'ready')::text
   ORDER BY 1"
psql_in "$SOURCE_DB" -c "$Q" > "$RESTORE_ROOT/counts-source.txt"
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
READY="FROM media WHERE status = 'ready' AND storage_key IS NOT NULL"
READY_MEDIA=$(psql_in "$RESTORE_DB" -c "SELECT count(*) $READY")
# No ready media is not a failure: an organisation may publish only apps. Ready rows lost in
# the restore are caught by the counts (a); an empty database, after (c).
if [ "$READY_MEDIA" = "0" ]; then
  echo "media rows: none ready, nothing to check"
else
  psql_in "$RESTORE_DB" -F ' ' \
    -c "SELECT sha256, storage_key, bytes $READY ORDER BY storage_key" \
    | check_files "media rows" || FAIL=1
fi
# Thumbnails are optional (images only, none before migration 0006), so none is not a failure.
THUMB_KEYS=$(psql_in "$RESTORE_DB" -c "SELECT thumb_storage_key FROM media WHERE thumb_storage_key IS NOT NULL ORDER BY 1")
THUMBS=0; THUMBS_BAD=0
while read -r key; do
  [ -n "$key" ] || continue
  THUMBS=$((THUMBS + 1))
  [ -f "$RESTORE_ROOT/objects/$key" ] && [ -s "$RESTORE_ROOT/objects/$key" ] || THUMBS_BAD=$((THUMBS_BAD + 1))
done <<< "$THUMB_KEYS"
echo "thumbnails: checked $THUMBS; missing or empty $THUMBS_BAD"
[ "$THUMBS_BAD" -eq 0 ] || FAIL=1

echo "== c. publication manifests against restored files"
# The hash and size come from the immutable manifest JSON, not from the media row.
# An item is a media file unless its kind is "app" (manifest v3, the same rule as isMediaItem
# in packages/contracts): an app has no assetId and no stored object.
ITEMS="FROM publication p CROSS JOIN LATERAL jsonb_array_elements(p.manifest->'assets') AS a"
IS_MEDIA="a->>'kind' IS DISTINCT FROM 'app'"
PUBS=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM publication")
MEDIA_ITEMS=$(psql_in "$RESTORE_DB" -c "SELECT count(*) $ITEMS WHERE $IS_MEDIA")
APP_ITEMS=$(psql_in "$RESTORE_DB" -c "SELECT count(*) $ITEMS WHERE NOT ($IS_MEDIA)")
if [ "$PUBS" = "0" ]; then
  # Valid: media uploaded but nothing published yet. Lost publications show in the counts (a).
  echo "publication assets: no publications to check"
elif [ "$MEDIA_ITEMS" = "0" ]; then
  echo "publication assets: no media items to check (every item is an app)"
else
  psql_in "$RESTORE_DB" -F ' ' \
    -c "SELECT a->>'sha256', m.storage_key, a->>'bytes'
          $ITEMS
          JOIN media m ON m.org_id = p.org_id AND m.id = (a->>'assetId')::uuid
         WHERE $IS_MEDIA
         ORDER BY p.created_at, 2" \
    | check_files "publication assets" || FAIL=1
fi
UNRESOLVED=$(psql_in "$RESTORE_DB" -c "SELECT count(*) $ITEMS LEFT JOIN media m ON m.org_id = p.org_id AND m.id = (a->>'assetId')::uuid WHERE $IS_MEDIA AND m.storage_key IS NULL")
ORPHANS=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM publication_asset pa LEFT JOIN media m ON m.id = pa.media_id AND m.org_id = pa.org_id WHERE m.id IS NULL")
echo "publications: $PUBS; media items: $MEDIA_ITEMS; app items (no file): $APP_ITEMS; media items without a stored object: $UNRESOLVED; publication_asset rows without media: $ORPHANS"
[ "$UNRESOLVED" = "0" ] && [ "$ORPHANS" = "0" ] || FAIL=1
ORGS=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM organization")
if [ "$ORGS" = "0" ]; then
  echo "NOTHING TO VERIFY: the database has no organisation (empty database?)"; FAIL=1
elif [ "$READY_MEDIA" = "0" ] && [ "$MEDIA_ITEMS" = "0" ]; then
  echo "note: no ready media and no published media item, so no file was compared; rows, manifests and controls were verified"
fi

echo "== d. controls after restore"
# schema_migrations is the migration runner's bookkeeping table: no tenant data, no grant to the runtime role.
TABLES=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> 'schema_migrations'")
FORCED=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> 'schema_migrations' AND relrowsecurity AND relforcerowsecurity")
TRIGGERS=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")
SECFUNCS=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'sec' AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'tinnox_definer'")
echo "data tables in public: $TABLES; with forced row-level security: $FORCED; triggers: $TRIGGERS; sec functions owned by tinnox_definer: $SECFUNCS"
[ "$TABLES" = "$FORCED" ] && [ "$TRIGGERS" -gt 0 ] && [ "$SECFUNCS" -gt 0 ] || FAIL=1
# The restored database still shows the runtime role nothing without an organisation context,
# in every table it may read (not only media, which an app-only database leaves empty).
APP_TABLES="FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND has_table_privilege('tinnox_app', oid, 'SELECT')"
APP_TABLE_COUNT=$(psql_in "$RESTORE_DB" -c "SELECT count(*) $APP_TABLES")
SOURCE_APP_TABLE_COUNT=$(psql_in "$SOURCE_DB" -c "SELECT count(*) $APP_TABLES")
if [ "$APP_TABLE_COUNT" != "$SOURCE_APP_TABLE_COUNT" ]; then
  echo "TABLES TINNOX_APP MAY READ DIFFER: $SOURCE_APP_TABLE_COUNT in the source, $APP_TABLE_COUNT restored (grants lost?)"; FAIL=1
fi
if [ "$APP_TABLE_COUNT" = "0" ]; then
  echo "TINNOX_APP CAN READ NO TABLE (grants lost?)"; FAIL=1
else
  ROW_SUM=$(psql_in "$RESTORE_DB" -c "SELECT string_agg(format('(SELECT count(*) FROM public.%I)', relname), ' + ' ORDER BY relname) $APP_TABLES")
  ROWS_THERE=$(psql_in "$RESTORE_DB" -c "SELECT $ROW_SUM")
  VISIBLE=$("${DC[@]}" exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -d "$RESTORE_DB" -At \
    -c "SET ROLE tinnox_app" -c "SELECT $ROW_SUM" | tail -1)
  echo "rows visible to tinnox_app with no organisation context: $VISIBLE of $ROWS_THERE in the $APP_TABLE_COUNT tables it may read"
  [ "$VISIBLE" = "0" ] || FAIL=1
fi
# Publications are immutable (migration 0001). Each attempt runs in a transaction that is rolled
# back, and counts as refused only with publication's own trigger message (reject_change names
# the operation and the table; TRUNCATE ... CASCADE also reaches publication_asset, whose
# trigger must not stand in for it). The row trigger cannot fire on an empty table, so the
# update is tried only when publications exist; the statement trigger on TRUNCATE fires anyway.
refused_by_trigger() { # $1: operation as the trigger names it (UPDATE, TRUNCATE); $2: statement
  local label err
  label=$(tr '[:upper:]' '[:lower:]' <<< "$1")
  if err=$(psql_in "$RESTORE_DB" -c "BEGIN" -c "$2" -c "ROLLBACK" 2>&1 >/dev/null); then
    echo "PUBLICATION $label WAS ALLOWED"; FAIL=1
  elif grep -qF "$1 on table publication is not allowed: rows are immutable" <<< "$err"; then
    echo "publication $label refused by trigger: yes"
  else
    echo "PUBLICATION $label NOT REFUSED BY ITS TRIGGER: $err"; FAIL=1
  fi
}
if [ "$PUBS" = "0" ]; then
  # Nothing to update, so at least the row trigger must be there and enabled.
  ROW_TRIGGER=$(psql_in "$RESTORE_DB" -c "SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.publication'::regclass AND tgname = 'publication_immutable' AND tgenabled IN ('O', 'A')")
  if [ "$ROW_TRIGGER" = "1" ]; then
    echo "publication update: not tried (no publications); its trigger is present and enabled"
  else
    echo "PUBLICATION UPDATE TRIGGER MISSING OR DISABLED"; FAIL=1
  fi
else
  refused_by_trigger UPDATE "UPDATE publication SET idempotency_key = idempotency_key"
fi
refused_by_trigger TRUNCATE "TRUNCATE publication CASCADE"

echo "== clean up"
cleanup
echo "backup seconds: $((T1 - T0)); restore seconds: $((T2 - T1))"
if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: restore verified. Backup set kept in $BACKUP_DIR"
else
  echo "RESULT: FAILED" >&2
  exit 1
fi
