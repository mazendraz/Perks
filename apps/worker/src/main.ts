import pg from 'pg';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkerConfig } from '../../api/src/config.js';
import { runOne } from './runner.js';
import { cleanupExports } from './export-cleanup.js';
import { runAppleWalletPushes } from './apple-wallet-push.js';
import { runGoogleWalletUpdates } from './google-wallet-updates.js';
import { runCustomerReminders } from './customer-reminders.js';
import { runWalletMessages } from './wallet-messages.js';
import { syncWalletDesign } from './wallet-design-sync.js';
import { analyticsLoop } from './analytics-refresh.js';
import { createFileStore } from '../../api/src/storage/file-store.js';
import { operationalLog } from '../../../packages/domain/src/operational-log.js';
// Longer than any healthy iteration: a Wallet batch is at most 25 messages with 10-second deadlines.
const WATCHDOG_MS = 15 * 60000;
async function main() {
  const c = readWorkerConfig();
  if (!c.WORKER_DATABASE_URL) throw new Error('WORKER_DATABASE_URL is required.');
  const pool = new pg.Pool({
    connectionString: c.WORKER_DATABASE_URL,
    // One each for the job loop, the Wallet loop and analytics, plus one spare.
    max: 4,
    connectionTimeoutMillis: 5000,
  });
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => {
      closing = true;
    });
  operationalLog('worker', 'info', 'service.started');
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let lastSweep = 0;
  let lastHeartbeat = 0;
  // Analytics can take seconds per shop: it runs beside the delivery loop, never inside it.
  const analytics = analyticsLoop(pool, () => closing);
  // Wallet traffic (Apple and Google) waits on outside services. It has its own loop so a slow or
  // failing provider never holds back cashier pushes, mail and exports.
  let jobTick = Date.now(),
    walletTick = Date.now();
  // Docker marks a stuck worker unhealthy but does not restart it. If either loop stops making
  // progress, exit and let `restart: unless-stopped` bring up a fresh process.
  const watchdog = setInterval(() => {
    if (Date.now() - Math.min(jobTick, walletTick) > WATCHDOG_MS) {
      operationalLog('worker', 'error', 'worker.iteration_failed');
      process.exit(1);
    }
  }, 30000);
  watchdog.unref();
  const wallet = (async () => {
    while (!closing) {
      walletTick = Date.now();
      try {
        // A new Wallet design reaches cards that are already saved, before their next update.
        await syncWalletDesign(pool, c);
        await runCustomerReminders(pool, c);
        await runWalletMessages(pool, c);
        await runAppleWalletPushes(pool, c);
        await runGoogleWalletUpdates(pool, c);
        await pause(1000);
      } catch {
        operationalLog('worker', 'error', 'worker.iteration_failed');
        await pause(1500);
      }
    }
  })();
  while (!closing) {
    jobTick = Date.now();
    try {
      if (Date.now() - lastSweep > 60000) {
        // A failing sweep is retried next minute; it must not hold back pushes and Wallet updates.
        lastSweep = Date.now();
        try {
          await pool.query('SELECT sweep_expired_rewards()');
          await pool.query('SELECT sweep_expired_requests()');
          await pool.query('SELECT sweep_expired_sessions()');
          await pool.query('SELECT advance_subscription_states()');
          await cleanupExports(pool, createFileStore(c));
          await pool.query('SELECT schedule_customer_reminders($1,$2)', [
            c.APPLE_WALLET_ENABLED === 'true',
            c.GOOGLE_WALLET_ENABLED === 'true',
          ]);
        } catch {
          operationalLog('worker', 'error', 'worker.iteration_failed');
        }
      }
      const worked = await runOne(pool, c);
      if (Date.now() - lastHeartbeat > 10000) {
        await writeFile(join(tmpdir(), 'nuqta-worker-heartbeat'), '', { mode: 0o600 });
        lastHeartbeat = Date.now();
      }
      if (!worked) await pause(1000);
    } catch {
      operationalLog('worker', 'error', 'worker.iteration_failed');
      await pause(1500);
    }
  }
  await wallet;
  clearInterval(watchdog);
  await analytics;
  await pool.end();
  operationalLog('worker', 'info', 'service.stopped');
}
void main().catch(() => {
  operationalLog('worker', 'error', 'service.start_failed');
  process.exitCode = 1;
});
