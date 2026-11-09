#!/bin/sh
set -eu
# Run in an isolated container with --network none and the backup repository mounted read-only.
# Native Linux test fixtures use their own private /tmp/nuqta-backup-test.*/restore-* directories.
: "${NUQTA_RESTORE_ROOT:?Fresh isolated directory required}"
: "${NUQTA_RESTORE_EXPECTED:?Expected fingerprint from quiesced backup checkpoint required}"
: "${NUQTA_RESTORE_REPORT:?Private report output path required}"
: "${NUQTA_RESTORE_SET:?Explicit backup label required}"
case "$NUQTA_RESTORE_ROOT" in /var/lib/nuqta-restore|/tmp/nuqta-backup-test.*/restore-*) ;; *) echo 'Unsafe restore path.' >&2; exit 1;; esac
[ "$(realpath -m -- "$NUQTA_RESTORE_ROOT")" = "$NUQTA_RESTORE_ROOT" ] && [ ! -L "$NUQTA_RESTORE_ROOT" ]
[ ! -e "$NUQTA_RESTORE_ROOT/PG_VERSION" ] || { echo 'Restore target already contains a database; retained.' >&2; exit 1; }
mkdir -m 700 -p "$NUQTA_RESTORE_ROOT"
[ -z "$(find "$NUQTA_RESTORE_ROOT" -mindepth 1 -print -quit)" ] || { echo 'Restore target is not empty; retained.' >&2; exit 1; }
tools=$(CDPATH='' cd -- "$(dirname -- "$0")/backup" 2>/dev/null && pwd) || tools=/opt/nuqta-backup
socket="$NUQTA_RESTORE_ROOT/drill-socket"
port=55436
export PGBACKREST_PG1_PATH="$NUQTA_RESTORE_ROOT" PGBACKREST_PG1_SOCKET_PATH="$socket" PGBACKREST_PG1_PORT="$port"
started=0
cleanup() {
  if [ "$started" = 1 ]; then pg_ctl -D "$NUQTA_RESTORE_ROOT" -m fast -w stop >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM
start=$(date +%s)
set -- pgbackrest --stanza=nuqta --pg1-path="$NUQTA_RESTORE_ROOT" --set="$NUQTA_RESTORE_SET" --archive-mode=off --target-action=promote
if [ -n "${NUQTA_RESTORE_TARGET_TIME:-}" ]; then
  set -- "$@" --type=time --target="$NUQTA_RESTORE_TARGET_TIME"
else
  set -- "$@" --type=immediate
fi
"$@" restore
mkdir -m 700 "$socket"
# Restored jobs never get an API/worker. Recovery cannot archive into the live repository.
started=1
pg_ctl -D "$NUQTA_RESTORE_ROOT" -l "$NUQTA_RESTORE_ROOT/drill.log" -o "-c listen_addresses='' -c unix_socket_directories='$socket' -c port=$port -c archive_mode=off -c log_min_duration_statement=-1" -w -t 120 start >/dev/null
export PGHOST="$socket" PGPORT="$port" PGUSER=postgres PGDATABASE=nuqta
attempt=0
while [ "$(psql --no-psqlrc -At -v ON_ERROR_STOP=1 -c 'SELECT pg_is_in_recovery()')" != f ]; do
  attempt=$((attempt+1)); [ "$attempt" -lt 120 ] || { echo 'Recovery target not reached.' >&2; exit 1; }; sleep 1
done
actual="$NUQTA_RESTORE_ROOT/actual.json"
PGOPTIONS='-c timezone=UTC' psql --no-psqlrc -At -v ON_ERROR_STOP=1 -f "$tools/fingerprint.sql" > "$actual"
export NUQTA_RESTORE_ACTUAL="$actual" NUQTA_RESTORE_DURATION="$(( $(date +%s)-start ))"
python3 "$tools/verify-restore.py"
