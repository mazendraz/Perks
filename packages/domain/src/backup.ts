export function backupHealth(
  status: { checkedAt?: number; lastBackupAt?: number; lastArchivedAt?: number; healthy?: boolean },
  now = Date.now(),
) {
  const age = (value: number | undefined, limit: number) =>
    !Number.isFinite(value) || value! > now + 300000 || now - value! > limit;
  const reasons: string[] = [];
  if (status.healthy !== true || age(status.checkedAt, 5 * 60000))
    reasons.push('backup_monitor_unhealthy');
  if (age(status.lastBackupAt, 26 * 3600000)) reasons.push('backup_older_than_26h');
  if (age(status.lastArchivedAt, 30 * 60000)) reasons.push('wal_older_than_30m');
  return { healthy: reasons.length === 0, reasons };
}
