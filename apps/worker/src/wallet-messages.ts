import type pg from 'pg';
import type { ServiceConfig } from '../../api/src/config.js';
import { loadGoogleWallet, type GoogleWallet } from '../../api/src/wallet/google-wallet.js';
import { fillWalletMessage } from '../../../packages/contracts/src/owner-plan.js';
import { appleWalletPush } from './apple-wallet-push.js';
import {
  deliverWalletNotice,
  type Outcome,
  type WalletNoticeJob,
  type WalletProviders,
} from './customer-reminders.js';

interface MessageJob extends WalletNoticeJob {
  message: { ar: string; en: string };
}
let google: GoogleWallet | null | undefined;

export function deliverWalletMessage(job: MessageJob, pool: pg.Pool, providers: WalletProviders) {
  return deliverWalletNotice(job, pool, providers, 'wallet_message_dispatch_allowed', (lang) =>
    fillWalletMessage(job.message[lang], job.card.customer_name ?? '', job.card.merchant_name),
  );
}

/** Sends up to `batch` queued manual messages; returns how many it handled. */
export async function runWalletMessages(pool: pg.Pool, c: ServiceConfig, batch = 25) {
  const appleEnabled = c.APPLE_WALLET_ENABLED === 'true',
    googleEnabled = c.GOOGLE_WALLET_ENABLED === 'true';
  if (!appleEnabled && !googleEnabled) return 0;
  let handled = 0;
  for (; handled < batch; handled++) {
    const job = (
      await pool.query('SELECT claim_wallet_message($1,$2) AS job', [appleEnabled, googleEnabled])
    ).rows[0]?.job as MessageJob | null;
    if (!job) break;
    let result: { outcome: Outcome; error: string | null };
    try {
      if (google === undefined && googleEnabled) google = loadGoogleWallet(c);
      result = await deliverWalletMessage(job, pool, {
        apple: appleWalletPush(c) ?? undefined,
        google: google ?? undefined,
      });
    } catch {
      result = { outcome: 'retry', error: 'MESSAGE_EXECUTION_FAILED' };
    }
    await pool.query('SELECT finish_wallet_message($1,$2,$3,$4)', [
      job.id,
      job.lease,
      result.outcome,
      result.error,
    ]);
  }
  return handled;
}
