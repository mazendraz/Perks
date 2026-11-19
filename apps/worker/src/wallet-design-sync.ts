import type pg from 'pg';
import type { ServiceConfig } from '../../api/src/config.js';
import { walletDesignSignature } from '../../api/src/wallet/design-signature.js';
import { operationalLog } from '../../../packages/domain/src/operational-log.js';

// Per minute. An Apple pass takes real work to rebuild, so few at a time leaves room for stamping;
// a Google card is only an API call and a small image.
export const DESIGN_RESEND_APPLE_PER_MINUTE = 120;
export const DESIGN_RESEND_GOOGLE_PER_MINUTE = 300;

let synced = false;
let lastSync = 0;
let lastResend = 0;
let pending = true;
/**
 * When this build draws the Wallet cards differently from the last build, saved Apple passes and
 * Google cards are re-sent in batches each minute until all show the new design.
 * Never holds up the rest of the worker: a failed attempt is retried a minute later.
 */
export async function syncWalletDesign(pool: pg.Pool, c: ServiceConfig, force = false) {
  if (c.APPLE_WALLET_ENABLED !== 'true' && c.GOOGLE_WALLET_ENABLED !== 'true') return 0;
  const now = Date.now();
  try {
    if (!synced && (force || now - lastSync >= 60000)) {
      lastSync = now;
      const changed = (
        await pool.query<{ changed: boolean }>('SELECT wallet_design_sync($1) AS changed', [
          walletDesignSignature(),
        ])
      ).rows[0]!.changed;
      synced = true;
      if (changed) operationalLog('worker', 'info', 'wallet.design_resend');
    }
    if (!synced || !(force || (pending && now - lastResend >= 60000))) return 0;
    lastResend = now;
    const queued = (
      await pool.query<{ queued: number }>('SELECT wallet_design_resend($1,$2) AS queued', [
        c.APPLE_WALLET_ENABLED === 'true' ? DESIGN_RESEND_APPLE_PER_MINUTE : 0,
        c.GOOGLE_WALLET_ENABLED === 'true' ? DESIGN_RESEND_GOOGLE_PER_MINUTE : 0,
      ])
    ).rows[0]!.queued;
    // Nothing left for this design: stop asking until the next worker start.
    pending = queued > 0;
    return queued;
  } catch {
    operationalLog('worker', 'error', 'worker.iteration_failed');
    return 0;
  }
}
