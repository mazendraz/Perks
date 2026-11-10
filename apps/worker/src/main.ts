import pg from 'pg';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkerConfig } from '../../api/src/config.js';
import { runOne } from './runner.js';
import { cleanupExports } from './export-cleanup.js';
import { createFileStore } from '../../api/src/storage/file-store.js';
import { operationalLog } from '../../../packages/domain/src/operational-log.js';
async function main() {
  const c = readWorkerConfig();
  if (!c.WORKER_DATABASE_URL) throw new Error('WORKER_DATABASE_URL is required.');
  const pool = new pg.Pool({
    connectionString: c.WORKER_DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 5000,
  });
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => {
      closing = true;
    });
  operationalLog('worker', 'info', 'service.started');
  let lastSweep = 0;
  let lastHeartbeat = 0;
  while (!closing) {
    try {
      if (Date.now() - lastSweep > 60000) {
        await pool.query('SELECT sweep_expired_rewards()');
        await pool.query('SELECT sweep_expired_requests()');
        await pool.query('SELECT sweep_expired_sessions()');
        await cleanupExports(pool, createFileStore(c));
        lastSweep = Date.now();
      }
      const worked = await runOne(pool, c);
      if (Date.now() - lastHeartbeat > 10000) {
        await writeFile(join(tmpdir(), 'nuqta-worker-heartbeat'), '', { mode: 0o600 });
        lastHeartbeat = Date.now();
      }
      if (!worked) await new Promise((r) => setTimeout(r, 1000));
    } catch {
      operationalLog('worker', 'error', 'worker.iteration_failed');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  await pool.end();
  operationalLog('worker', 'info', 'service.stopped');
}
void main().catch(() => {
  operationalLog('worker', 'error', 'service.start_failed');
  process.exitCode = 1;
});
