import type { FastifyInstance } from 'fastify';
import { lstat, readFile, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Pools } from '../db.js';
import { requireCondition } from '../errors.js';
import { safeEqual, tokenHash } from '../crypto.js';
import { backupHealth } from '../../../../packages/domain/src/backup.js';
import { HttpMetrics, operationalHealth } from '../../../../packages/domain/src/monitoring.js';
type BackupStatus = Parameters<typeof backupHealth>[0];
const count = z.number().int().nonnegative();
const queueSchema = z
  .object({
    length: count,
    actionable: count,
    pending: count,
    running: count,
    failed: count,
    blocked: count,
    unknown: count,
    oldestPendingAgeMs: z.number().nonnegative().nullable(),
  })
  .strict();
type QueueMetrics = z.infer<typeof queueSchema>;
export type MonitoringProbes = { diskUsedRatio?: () => Promise<number | null> };
async function statusFile(path: string): Promise<BackupStatus> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192)
    throw new Error('Invalid status');
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid status');
  // Never copy unknown fields (paths, command errors or secrets) into health.
  const source = value as Record<string, unknown>;
  return {
    healthy: source.healthy === true,
    checkedAt: typeof source.checkedAt === 'number' ? source.checkedAt : undefined,
    lastBackupAt: typeof source.lastBackupAt === 'number' ? source.lastBackupAt : undefined,
    lastArchivedAt: typeof source.lastArchivedAt === 'number' ? source.lastArchivedAt : undefined,
  };
}
export function monitoringModule(
  app: FastifyInstance,
  pools: Pools,
  c: Config,
  http: HttpMetrics,
  probes: MonitoringProbes = {},
) {
  const collect = async () => {
    const now = Date.now(),
      requests = http.snapshot(now);
    let databaseHealthy = false;
    let outbox: QueueMetrics | null = null;
    let diskUsedRatio: number | null = null;
    let databaseBackup = backupHealth({}, now),
      filesBackup = { healthy: false, reasons: ['backup_status_unavailable'] };
    await Promise.allSettled([
      (async () => {
        outbox = queueSchema.parse(
          (await pools.authPool.query('SELECT operational_queue_metrics() AS value')).rows[0].value,
        );
        databaseHealthy = true;
      })(),
      (async () => {
        if (probes.diskUsedRatio) {
          const ratio = await probes.diskUsedRatio();
          diskUsedRatio =
            ratio !== null && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : null;
          return;
        }
        const disk = await statfs(c.STORAGE_ROOT);
        if (disk.blocks > 0 && disk.bavail >= 0)
          diskUsedRatio = Math.max(0, Math.min(1, 1 - disk.bavail / disk.blocks));
      })(),
      (async () => {
        if (!c.BACKUP_STATUS_ROOT) return;
        databaseBackup = backupHealth(
          await statusFile(join(c.BACKUP_STATUS_ROOT, 'database', 'status.json')),
          now,
        );
      })(),
      (async () => {
        if (!c.BACKUP_STATUS_ROOT) return;
        const value = await statusFile(join(c.BACKUP_STATUS_ROOT, 'files', 'status.json'));
        const valid =
          value.healthy === true &&
          Number.isFinite(value.lastBackupAt) &&
          value.lastBackupAt! <= now + 300000 &&
          now - value.lastBackupAt! <= 26 * 3600000;
        filesBackup = {
          healthy: valid,
          reasons: valid ? [] : ['file_backup_unhealthy_or_older_than_26h'],
        };
      })(),
    ]);
    const queue = outbox as QueueMetrics | null;
    const health = operationalHealth({
      errorRatio: requests.window.errorRatio,
      diskUsedRatio,
      databaseHealthy,
      oldestPendingAgeMs: queue?.oldestPendingAgeMs ?? null,
      backupsHealthy: databaseBackup.healthy && filesBackup.healthy,
    });
    return {
      checkedAt: now,
      health,
      http: requests,
      database: { healthy: databaseHealthy },
      outbox: queue,
      disk: { usedRatio: diskUsedRatio },
      backups: { database: databaseBackup, files: filesBackup },
    };
  };
  for (const path of ['/internal/metrics', '/internal/health']) {
    app.get(path, { schema: { hide: true } }, async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      requireCondition(!!c.MONITORING_TOKEN, 'NOT_FOUND', 404);
      const supplied = req.headers.authorization;
      requireCondition(
        typeof supplied === 'string' &&
          safeEqual(tokenHash(supplied), tokenHash('Bearer ' + c.MONITORING_TOKEN)),
        'UNAUTHENTICATED',
        401,
      );
      const result = await collect();
      if (path === '/internal/health' && !result.health.healthy) reply.code(503);
      return result;
    });
  }
}
