#!/bin/sh
set -eu
umask 077
: "${RESTIC_REPOSITORY:?Encrypted repository required}"
: "${RESTIC_PASSWORD:?Private restic password required}"
export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-/tmp/nuqta-restic-cache}"
action="${1:-backup}"
log=$(mktemp /tmp/nuqta-restic.XXXXXXXX)
trap 'rm -f -- "$log"' EXIT INT TERM
case "$action" in
 init)
  # Existing repositories are never recreated or overwritten, including with a wrong password.
  restic init >"$log" 2>&1 || restic cat config >/dev/null
  ;;
 backup)
  : "${STORAGE_ROOT:?FileStore path required}"
  [ "${STORAGE_ROOT#/}" != "$STORAGE_ROOT" ] && [ "$STORAGE_ROOT" != / ] && [ -d "$STORAGE_ROOT" ] && [ ! -L "$STORAGE_ROOT" ]
  restic backup --json --tag nuqta-files "$STORAGE_ROOT" >"$log" 2>&1
  if [ -n "${NUQTA_FILE_BACKUP_STATE:-}" ]; then
    export NUQTA_FILE_BACKUP_NOW="$(date +%s)"
    python3 - <<'PY'
import json, os, pathlib
path=pathlib.Path(os.environ['NUQTA_FILE_BACKUP_STATE'])
temporary=path.with_suffix('.tmp')
temporary.write_text(json.dumps({'lastBackupAt':int(os.environ['NUQTA_FILE_BACKUP_NOW'])*1000,'healthy':True})+'\n')
temporary.chmod(0o644)
temporary.replace(path)
PY
  fi
  ;;
 restore-drill)
  : "${NUQTA_FILES_RESTORE_TARGET:?Fresh isolated restore path required}"
  : "${NUQTA_FILES_RESTORE_SNAPSHOT:?Explicit snapshot required}"
  case "$NUQTA_FILES_RESTORE_TARGET" in /var/lib/nuqta-files-drill|/tmp/nuqta-backup-test.*/file-restore*) ;; *) echo 'Unsafe file restore path.' >&2; exit 1;; esac
  [ "$(realpath -m -- "$NUQTA_FILES_RESTORE_TARGET")" = "$NUQTA_FILES_RESTORE_TARGET" ] && [ ! -L "$NUQTA_FILES_RESTORE_TARGET" ]
  mkdir -m 700 -p "$NUQTA_FILES_RESTORE_TARGET"
  [ -z "$(find "$NUQTA_FILES_RESTORE_TARGET" -mindepth 1 -print -quit)" ] || { echo 'Restore target is not empty; retained.' >&2; exit 1; }
  restic restore "$NUQTA_FILES_RESTORE_SNAPSHOT" --target "$NUQTA_FILES_RESTORE_TARGET" >"$log" 2>&1
  ;;
 *) echo 'Use init, backup or restore-drill.' >&2; exit 1;;
esac
