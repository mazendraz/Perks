#!/bin/sh
set -eu
export LC_ALL=C
umask 077
repo="$1"
dump="$2"
logo="$3"
output="$4"
export PATH="/usr/lib/postgresql/17/bin:$PATH"
command -v pgbackrest >/dev/null
command -v restic >/dev/null
[ "$(id -u)" != 0 ]
fixture=$(mktemp -d /tmp/nuqta-backup-test.XXXXXXXX)
echo "Owned Linux fixture: $fixture"
[ "$(realpath -- "$fixture")" = "$fixture" ]
case "$fixture" in /tmp/nuqta-backup-test.*) ;; *) exit 1;; esac
running=0
cleanup() {
 if [ "$running" = 1 ]; then pg_ctl -D "$fixture/source" -m fast -w stop >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM
mkdir "$fixture/socket" "$fixture/repository" "$fixture/db-state"
initdb -D "$fixture/source" -U postgres --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale=C >/dev/null
# This cluster has a private Unix socket only: no TCP listener or application processes.
export PGBACKREST_CONFIG="$repo/deploy/postgres/pgbackrest.conf"
export PGBACKREST_PG1_PATH="$fixture/source" PGBACKREST_PG1_SOCKET_PATH="$fixture/socket" PGBACKREST_PG1_PORT=55436
export PGBACKREST_REPO1_PATH="$fixture/repository" PGBACKREST_REPO1_CIPHER_PASS="$(openssl rand -hex 32)"
export PGBACKREST_LOCK_PATH="$fixture/locks" PGBACKREST_SPOOL_PATH="$fixture/spool"
export PGHOST="$fixture/socket" PGPORT=55436 PGUSER=postgres PGDATABASE=postgres PGOPTIONS='-c timezone=UTC'
running=1
pg_ctl -D "$fixture/source" -l "$fixture/source.log" -o "-c config_file='$repo/deploy/postgres/postgresql.conf' -c listen_addresses='' -c unix_socket_directories='$fixture/socket' -c port=55436" -w -t 60 start >/dev/null
export POSTGRES_USER=postgres
export NUQTA_MIGRATOR_DB_PASSWORD="$(openssl rand -hex 32)" NUQTA_RUNTIME_DB_PASSWORD="$(openssl rand -hex 32)" NUQTA_AUTH_DB_PASSWORD="$(openssl rand -hex 32)" NUQTA_WORKER_DB_PASSWORD="$(openssl rand -hex 32)"
# Exercise production role SQL under forced statement logging; the script suppresses secret SQL.
PGOPTIONS='-c timezone=UTC -c log_min_duration_statement=0' sh "$repo/deploy/postgres/init-roles.sh" >/dev/null
[ "$(psql --no-psqlrc -At -c "SELECT count(*)=4 AND bool_and(NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication) FROM pg_roles WHERE rolname IN ('nuqta_migrator','nuqta_runtime','nuqta_auth','nuqta_worker')")" = t ]
for secret in "$NUQTA_MIGRATOR_DB_PASSWORD" "$NUQTA_RUNTIME_DB_PASSWORD" "$NUQTA_AUTH_DB_PASSWORD" "$NUQTA_WORKER_DB_PASSWORD"; do
 if grep -Fq -- "$secret" "$fixture/source.log"; then echo 'A bootstrap secret reached database logs.' >&2; exit 1; fi
done
# Validate every immutable SQL migration as the restricted schema owner in a separate empty DB.
createdb -O nuqta_migrator nuqta_role_test
psql --no-psqlrc -U nuqta_migrator -d nuqta_role_test -v ON_ERROR_STOP=1 -c 'CREATE TABLE schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())' >/dev/null
for migration in "$repo"/db/migrations/*.sql; do
 psql --no-psqlrc -U nuqta_migrator -d nuqta_role_test -1 -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done
export PGDATABASE=nuqta
[ "$(psql --no-psqlrc -At -c 'SHOW archive_mode')" = on ]
[ "$(psql --no-psqlrc -At -c 'SHOW archive_timeout')" = 5min ]
[ "$(psql --no-psqlrc -At -c 'SHOW log_min_duration_statement')" = 500ms ]
pg_restore --no-owner --no-acl --exit-on-error -d nuqta "$dump"
[ "$(psql --no-psqlrc -At -c 'SELECT count(*)>0 FROM ledger_entries')" = t ]
psql --no-psqlrc -At -v ON_ERROR_STOP=1 -f "$repo/deploy/backup/fingerprint.sql" > "$fixture/before.json"
export NUQTA_DB_BACKUP_STATE="$fixture/db-state/status.json"
pgbackrest --stanza=nuqta stanza-create
pgbackrest --stanza=nuqta --output=json info | python3 -c 'import json,sys;v=json.load(sys.stdin)[0];print(json.dumps({"initialStatus":v["status"],"repositories":[r["status"] for r in v["repo"]]}))'
NUQTA_BACKUP_ONCE=1 python3 "$repo/deploy/backup/db-loop.py"
pgbackrest --stanza=nuqta --output=json info > "$fixture/full-info.json"
full=$(python3 -c 'import json,sys;print(next(b["label"] for b in json.load(open(sys.argv[1]))[0]["backup"] if b["type"]=="full"))' "$fixture/full-info.json")
target=$(psql --no-psqlrc -At -c 'SELECT clock_timestamp()')
psql --no-psqlrc -qAt -c 'SELECT pg_sleep(0.1)' >/dev/null
psql --no-psqlrc -v ON_ERROR_STOP=1 -f "$repo/tests/fixtures/backup-mutation.sql" >/dev/null
psql --no-psqlrc -At -v ON_ERROR_STOP=1 -f "$repo/deploy/backup/fingerprint.sql" > "$fixture/after.json"
python3 - "$fixture/before.json" "$fixture/after.json" <<'PY'
import json,sys
a,b=(json.load(open(path)) for path in sys.argv[1:])
assert a['balanceDrift']==b['balanceDrift']==0
assert b['counts']['ledger_entries']==a['counts']['ledger_entries']+1
assert a['ledger']!=b['ledger'] and a['accounts']!=b['accounts']
PY
pgbackrest --stanza=nuqta check
pgbackrest --stanza=nuqta --type=diff backup
NUQTA_BACKUP_ONCE=1 python3 "$repo/deploy/backup/db-loop.py"
python3 - "$NUQTA_DB_BACKUP_STATE" <<'PY'
import json,sys,time
status=json.load(open(sys.argv[1]))
assert status['healthy'] and time.time()*1000-status['lastArchivedAt']<1800000
assert time.time()*1000-status['lastBackupAt']<93600000
PY
pgbackrest --stanza=nuqta --output=json info > "$fixture/diff-info.json"
diff=$(python3 -c 'import json,sys;print(next(b["label"] for b in json.load(open(sys.argv[1]))[0]["backup"] if b["type"]=="diff"))' "$fixture/diff-info.json")
# info uses exit 0 even for repository errors; exercise restore itself for the negative key check.
if PGBACKREST_REPO1_CIPHER_PASS=wrong-password pgbackrest --stanza=nuqta --pg1-path="$fixture/wrong-key-restore" --set="$full" --archive-mode=off restore >/dev/null 2>&1; then
 echo 'Encrypted repository unexpectedly accepted wrong key.' >&2; exit 1
fi
export NUQTA_RESTORE_SET="$full" NUQTA_RESTORE_ROOT="$fixture/restore-full" NUQTA_RESTORE_EXPECTED="$fixture/before.json" NUQTA_RESTORE_REPORT="$fixture/full-report.json"
sh "$repo/deploy/restore-drill.sh"
export NUQTA_RESTORE_SET="$diff" NUQTA_RESTORE_ROOT="$fixture/restore-diff" NUQTA_RESTORE_EXPECTED="$fixture/after.json" NUQTA_RESTORE_REPORT="$fixture/diff-report.json"
sh "$repo/deploy/restore-drill.sh"
export NUQTA_RESTORE_SET="$full" NUQTA_RESTORE_ROOT="$fixture/restore-pitr" NUQTA_RESTORE_EXPECTED="$fixture/before.json" NUQTA_RESTORE_REPORT="$fixture/pitr-report.json" NUQTA_RESTORE_TARGET_TIME="$target"
sh "$repo/deploy/restore-drill.sh"
# A real PNG roundtrip from the FileStore layout through an independently encrypted restic repository.
source_logo="$fixture/files/assets/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001.png"
mkdir -p "$(dirname -- "$source_logo")"
cp "$logo" "$source_logo"
expected_logo=$(sha256sum "$source_logo" | cut -d' ' -f1)
export STORAGE_ROOT="$fixture/files" RESTIC_REPOSITORY="$fixture/restic" RESTIC_PASSWORD="$(openssl rand -hex 32)"
export NUQTA_FILE_BACKUP_STATE="$fixture/files-state.json"
sh "$repo/deploy/backup/files.sh" init
sh "$repo/deploy/backup/files.sh" backup
snapshot=$(restic snapshots --json --tag nuqta-files | python3 -c 'import json,sys;print(json.load(sys.stdin)[-1]["id"])')
if RESTIC_PASSWORD=wrong-password restic snapshots >/dev/null 2>&1; then echo 'Restic unexpectedly accepted wrong key.' >&2; exit 1; fi
if RESTIC_PASSWORD=wrong-password sh "$repo/deploy/backup/files.sh" init >/dev/null 2>&1; then echo 'Existing file repository unexpectedly accepted reinitialization with a wrong key.' >&2; exit 1; fi
rm -- "$source_logo"
export NUQTA_FILES_RESTORE_TARGET="$fixture/file-restore" NUQTA_FILES_RESTORE_SNAPSHOT="$snapshot"
sh "$repo/deploy/backup/files.sh" restore-drill
[ "$expected_logo" = "$(sha256sum "$NUQTA_FILES_RESTORE_TARGET$source_logo" | cut -d' ' -f1)" ]
python3 - "$fixture" "$output" <<'PY'
import datetime,json,pathlib,subprocess,sys
fixture,output=map(pathlib.Path,sys.argv[1:])
report={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','runtime':'native Linux; PostgreSQL 17; isolated Unix sockets only','full':json.loads((fixture/'full-report.json').read_text()),'differential':json.loads((fixture/'diff-report.json').read_text()),'pitr':json.loads((fixture/'pitr-report.json').read_text()),'fileStoreLogoRestoredByteIdentical':True,'wrongDatabaseBackupKeyRejected':True,'wrongFileBackupKeyRejected':True,'restrictedRolesBootstrapVerified':True,'bootstrapSecretsAbsentFromStatementLogs':True,'sqlMigrationsAppliedAsRestrictedOwner':True,'baselineCounts':json.loads((fixture/'before.json').read_text())['counts'],'versions':{'postgres':subprocess.check_output(['postgres','--version'],text=True).strip(),'pgbackrest':subprocess.check_output(['pgbackrest','version'],text=True).strip(),'restic':subprocess.check_output(['restic','version'],text=True).strip()},'limits':['Local fixture only, not a container or production-host restore','Off-host second repository and real alert delivery not configured','Source was an isolated clone; no API/worker or provider delivery ran']}
(output/'backup-native.json').write_text(json.dumps(report,indent=2)+'\n')
PY
pg_ctl -D "$fixture/source" -m fast -w stop >/dev/null
running=0
# Verify the exact native fixture boundary before removing only this owned synthetic cluster/repositories.
[ "$(realpath -- "$fixture")" = "$fixture" ]
case "$fixture" in /tmp/nuqta-backup-test.*) rm -rf -- "$fixture";; *) exit 1;; esac
echo 'PASS encrypted full/differential/PITR restore and FileStore logo recovery'
