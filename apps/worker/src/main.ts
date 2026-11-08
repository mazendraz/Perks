import pg from 'pg';
import { readConfig } from '../../api/src/config.js';
import { runOne } from './runner.js';
import { cleanupExports } from './export-cleanup.js';
const c = readConfig();
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
console.log('Nuqta worker started. Unconfigured external providers remain blocked.');
let lastSweep = 0;
while (!closing) {
  try {
    if (Date.now() - lastSweep > 60000) {
      await pool.query('SELECT sweep_expired_rewards()');
      await pool.query('SELECT sweep_expired_requests()');
      if (['development', 'test'].includes(c.APP_ENV)) await cleanupExports(pool);
      lastSweep = Date.now();
    }
    const worked = await runOne(pool, c);
    if (!worked) await new Promise((r) => setTimeout(r, 1000));
  } catch {
    console.error('Worker iteration failed; retrying without exposing payloads.');
    await new Promise((r) => setTimeout(r, 1500));
  }
}
await pool.end();
