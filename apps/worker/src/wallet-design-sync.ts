import type pg from 'pg';
import type { ServiceConfig } from '../../api/src/config.js';
import { walletDesignSignature } from '../../api/src/wallet/design-signature.js';
import { operationalLog } from '../../../packages/domain/src/operational-log.js';

let synced = false;
let lastAttempt = 0;
/**
 * Once per worker start: if this build draws the Wallet cards differently from the last build,
 * every saved Apple pass and Google card is queued for a resend, so it shows the new design.
 */
export async function syncWalletDesign(pool: pg.Pool, c: ServiceConfig, force = false) {
  if (synced && !force) return false;
  if (c.APPLE_WALLET_ENABLED !== 'true' && c.GOOGLE_WALLET_ENABLED !== 'true') {
    synced = true;
    return false;
  }
  // Never holds up the rest of the worker: a failed attempt is retried a minute later.
  if (!force && Date.now() - lastAttempt < 60000) return false;
  lastAttempt = Date.now();
  let changed: boolean;
  try {
    changed = (
      await pool.query<{ changed: boolean }>('SELECT wallet_design_sync($1) AS changed', [
        walletDesignSignature(),
      ])
    ).rows[0]!.changed;
  } catch {
    operationalLog('worker', 'error', 'worker.iteration_failed');
    return false;
  }
  synced = true;
  if (changed) operationalLog('worker', 'info', 'wallet.design_resend');
  return changed;
}
