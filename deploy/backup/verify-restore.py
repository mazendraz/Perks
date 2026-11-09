import json
import os
import pathlib
import sys

expected = json.loads(pathlib.Path(os.environ['NUQTA_RESTORE_EXPECTED']).read_text())
actual = json.loads(pathlib.Path(os.environ['NUQTA_RESTORE_ACTUAL']).read_text())
matched = actual == expected and actual['balanceDrift'] == 0
report = {
    'status': 'passed' if matched else 'failed',
    'backupSet': os.environ['NUQTA_RESTORE_SET'],
    'pointInTime': bool(os.environ.get('NUQTA_RESTORE_TARGET_TIME')),
    'durationSeconds': int(os.environ['NUQTA_RESTORE_DURATION']),
    'migrationsMatched': actual['migrations'] == expected['migrations'],
    'countsMatched': actual['counts'] == expected['counts'],
    'ledgerMatched': actual['ledger'] == expected['ledger'],
    'transactionsMatched': actual['transactions'] == expected['transactions'],
    'accountsMatched': actual['accounts'] == expected['accounts'],
    'balanceDrift': actual['balanceDrift'],
    'applicationOrWorkerStarted': False,
}
pathlib.Path(os.environ['NUQTA_RESTORE_REPORT']).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
sys.exit(0 if matched else 1)
