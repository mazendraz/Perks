import type pg from 'pg';
import { operationalLog } from '../../../packages/domain/src/operational-log.js';

/**
 * Once a shop's own day turns, rebuild its customer analytics: "late" and "gone" happen without
 * any event, so a full pass per shop per day keeps every segment honest. Stamps refresh their own
 * customer immediately (database triggers); this is the daily sweep on top.
 *
 * It runs in its own loop (see main.ts), never in the one that delivers cashier pushes and Wallet
 * updates. It stops taking new shops after `budgetMs`, and the rest wait for the next minute; a
 * shop that fails is retried with a growing delay.
 * With fresh table statistics a shop of thousands of customers takes well under a second. If the
 * planner is working from stale statistics (a big import, say), the fast plan is cut off after
 * 15 seconds and the pass is redone with a plan that is steady whatever the statistics say.
 */
export async function runAnalyticsRefresh(pool: pg.Pool, budgetMs = 5000, batch = 20) {
  const started = Date.now();
  const due = (await pool.query<{ id: string }>('SELECT analytics_refresh_due($1) AS id', [batch]))
    .rows;
  let done = 0;
  for (const { id } of due) {
    if (Date.now() - started > budgetMs) break;
    try {
      await refreshShop(pool, id);
      await pool.query('SELECT analytics_refresh_succeeded($1)', [id]);
      done++;
    } catch {
      operationalLog('worker', 'error', 'analytics.refresh_failed');
      // Waits 5 minutes, then 10, 20 ... (at most 6 hours) so one bad shop never starves the rest.
      await pool.query('SELECT analytics_refresh_failed($1)', [id]).catch(() => undefined);
    }
  }
  return done;
}

async function refreshShop(pool: pg.Pool, merchantId: string) {
  const client = await pool.connect();
  try {
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='15s'");
      await client.query('SELECT refresh_merchant_stats($1)', [merchantId]);
      await client.query('COMMIT');
      return;
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code !== '57014') throw e;
    }
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='120s'");
    await client.query('SET LOCAL enable_nestloop=off');
    await client.query('SELECT refresh_merchant_stats($1)', [merchantId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Every minute until `stopped()`, independent of the delivery loop. Never throws. */
export async function analyticsLoop(pool: pg.Pool, stopped: () => boolean, everyMs = 60_000) {
  while (!stopped()) {
    try {
      await runAnalyticsRefresh(pool);
    } catch {
      operationalLog('worker', 'error', 'analytics.refresh_failed');
    }
    for (let waited = 0; waited < everyMs && !stopped(); waited += 1000)
      await new Promise((r) => setTimeout(r, 1000));
  }
}
