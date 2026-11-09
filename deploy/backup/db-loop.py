import json
import os
import pathlib
import subprocess
import time

state = pathlib.Path(os.environ.get('NUQTA_DB_BACKUP_STATE', '/var/lib/nuqta-backup-state/status.json'))


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=1800)
    if result.returncode:
        raise RuntimeError('backup_command_failed')
    return result.stdout


def info():
    value = json.loads(run(['pgbackrest', '--stanza=nuqta', '--output=json', 'info']))[0]
    code = value['status']['code']
    if code == 2 and not value.get('backup') and all(repo['status']['code'] == 2 for repo in value['repo']):
        return []  # A valid, just-created stanza needs its first full backup.
    if code != 0:
        raise RuntimeError('backup_repository_unavailable')
    return value.get('backup', [])


run(['pgbackrest', '--stanza=nuqta', 'stanza-create'])
last_check = 0
while True:
    now = int(time.time())
    result = {'checkedAt': now * 1000, 'healthy': False}
    try:
        backups = info()
        last_full = max((b['timestamp']['stop'] for b in backups if b['type'] == 'full'), default=0)
        last_backup = max((b['timestamp']['stop'] for b in backups), default=0)
        kind = 'full' if now - last_full >= 7 * 86400 else ('diff' if now - last_backup >= 86400 else None)
        if kind:
            run(['pgbackrest', '--stanza=nuqta', '--type=' + kind, 'backup'])
            backups = info()
            last_backup = max(b['timestamp']['stop'] for b in backups)
        if now - last_check >= 300:
            # check forces and verifies a WAL archive roundtrip, even during quiet periods.
            run(['pgbackrest', '--stanza=nuqta', 'check'])
            last_check = int(time.time())
        archived = float(run(['psql', '--no-psqlrc', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'nuqta', '-c', 'SELECT extract(epoch FROM last_archived_time) FROM pg_stat_archiver']).strip())
        checked = int(time.time())
        result.update(checkedAt=checked * 1000, lastBackupAt=last_backup * 1000, lastArchivedAt=archived * 1000,
                      healthy=checked - last_backup <= 26 * 3600 and checked - archived <= 1800)
    except Exception:
        result['error'] = 'backup_or_archive_check_failed'
    temporary = state.with_suffix('.tmp')
    temporary.write_text(json.dumps(result) + '\n')
    temporary.chmod(0o644)
    temporary.replace(state)
    print(json.dumps({'component': 'database_backup', 'healthy': result['healthy']}), flush=True)
    if os.environ.get('NUQTA_BACKUP_ONCE') == '1':
        raise SystemExit(0 if result['healthy'] else 1)
    time.sleep(60)
