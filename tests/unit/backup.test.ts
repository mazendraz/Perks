import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupHealth } from '../../packages/domain/src/backup.js';
test('backup alert gates reject stale/missing evidence, failed checks and future clocks', () => {
  const now = 1800000000000,
    fresh = { checkedAt: now, lastBackupAt: now, lastArchivedAt: now, healthy: true };
  assert.equal(backupHealth(fresh, now).healthy, true);
  assert.ok(
    backupHealth({ ...fresh, lastBackupAt: now - 26 * 3600000 - 1 }, now).reasons.includes(
      'backup_older_than_26h',
    ),
  );
  assert.ok(
    backupHealth({ ...fresh, lastArchivedAt: now - 30 * 60000 - 1 }, now).reasons.includes(
      'wal_older_than_30m',
    ),
  );
  assert.ok(
    backupHealth({ ...fresh, checkedAt: now - 300001 }, now).reasons.includes(
      'backup_monitor_unhealthy',
    ),
  );
  assert.equal(backupHealth({ ...fresh, healthy: false }, now).healthy, false);
  assert.equal(backupHealth({}, now).healthy, false);
  assert.equal(backupHealth({ ...fresh, lastBackupAt: now + 300001 }, now).healthy, false);
});
