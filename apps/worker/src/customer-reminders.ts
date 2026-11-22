import type pg from 'pg';
import type { ServiceConfig } from '../../api/src/config.js';
import type { WalletCard } from '../../api/src/wallet/apple-pass.js';
import {
  accessToken,
  loadGoogleWallet,
  objectId,
  type GoogleWallet,
} from '../../api/src/wallet/google-wallet.js';
import { walletReminderText } from '../../../packages/contracts/src/customer-reminders.js';
import { appleWalletPush } from './apple-wallet-push.js';

interface ReminderJob {
  id: string;
  lease: string;
  channel: 'apple' | 'google';
  reconcileOnly: boolean;
  card: WalletCard;
  templates: {
    wallet: { ar: string; en: string };
    walletReady?: { ar: string; en: string } | null;
  };
  objectKey: string | null;
  tokens: string[];
}
export type Outcome = 'accepted' | 'retry' | 'failed' | 'skipped' | 'uncertain';
let google: GoogleWallet | null | undefined;
const plainHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export interface WalletNoticeJob {
  id: string;
  lease: string;
  channel: 'apple' | 'google';
  reconcileOnly: boolean;
  card: WalletCard;
  objectKey: string | null;
  tokens: string[];
}
export type WalletProviders = {
  apple?: (token: string) => Promise<number>;
  google?: GoogleWallet;
};

// Exported to exercise both providers with injected transports, without sending real notifications.
export async function deliverCustomerReminder(
  job: ReminderJob,
  pool: pg.Pool,
  providers: WalletProviders,
): Promise<{ outcome: Outcome; error: string | null }> {
  return deliverWalletNotice(job, pool, providers, 'reminder_dispatch_allowed', (lang) =>
    walletReminderText(job.templates, job.card, lang),
  );
}

/**
 * One notice to one card. Apple: the pass already carries the text, APNs asks the phone to
 * fetch it. Google: the text is added as a card message (reconciled by id, never sent twice).
 */
export async function deliverWalletNotice(
  job: WalletNoticeJob,
  pool: pg.Pool,
  providers: WalletProviders,
  allowedFunction: 'reminder_dispatch_allowed' | 'wallet_message_dispatch_allowed',
  text: (lang: 'ar' | 'en') => string,
): Promise<{ outcome: Outcome; error: string | null }> {
  const allowed = async () =>
    (await pool.query('SELECT ' + allowedFunction + '($1,$2) AS allowed', [job.id, job.lease]))
      .rows[0].allowed;
  if (!(await allowed())) return { outcome: 'skipped', error: 'NO_LONGER_ELIGIBLE' };
  if (job.channel === 'apple') {
    if (!providers.apple) return { outcome: 'retry', error: 'PROVIDER_UNAVAILABLE' };
    let accepted = 0,
      retry = false;
    for (const token of job.tokens) {
      if (!(await allowed())) return { outcome: 'skipped', error: 'NO_LONGER_ELIGIBLE' };
      const status = await providers.apple(token).catch(() => 0);
      if (status === 200) accepted++;
      // A malformed APNs request must not unregister a customer's Wallet card.
      else if (status === 410) await pool.query('SELECT wallet_forget_push_token($1)', [token]);
      else retry = true;
    }
    if (retry) return { outcome: 'retry', error: 'APPLE_PUSH_RETRY' };
    return {
      outcome: accepted ? 'accepted' : 'skipped',
      error: accepted ? null : 'PASS_NOT_REGISTERED',
    };
  }
  const g = providers.google;
  if (!g || !job.objectKey) return { outcome: 'retry', error: 'PROVIDER_UNAVAILABLE' };
  const url =
    'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/' +
    encodeURIComponent(objectId(g, job.objectKey));
  let headers: Record<string, string>;
  try {
    headers = {
      authorization: 'Bearer ' + (await accessToken(g)),
      'content-type': 'application/json',
    };
    const existing = await g.fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (existing.status === 404) return { outcome: 'skipped', error: 'PASS_NOT_SAVED' };
    if (!existing.ok)
      return { outcome: job.reconcileOnly ? 'uncertain' : 'retry', error: 'GOOGLE_READ_RETRY' };
    const body = (await existing.json()) as { messages?: { id: string }[] };
    if (body.messages?.some((message) => message.id === job.id))
      return { outcome: 'accepted', error: null };
  } catch {
    return { outcome: job.reconcileOnly ? 'uncertain' : 'retry', error: 'GOOGLE_READ_RETRY' };
  }
  // Google message IDs are not idempotency keys. A lost response is reconciled by GET only.
  if (job.reconcileOnly) return { outcome: 'uncertain', error: 'GOOGLE_DELIVERY_UNCONFIRMED' };
  if (!(await allowed())) return { outcome: 'skipped', error: 'NO_LONGER_ELIGIBLE' };
  const message = (lang: 'ar' | 'en') => plainHtml(text(lang));
  try {
    const response = await g.fetch(url + '/addMessage', {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        message: {
          id: job.id,
          messageType: 'TEXT_AND_NOTIFY',
          header: job.card.merchant_name,
          localizedBody: {
            defaultValue: { language: 'ar', value: message('ar') },
            translatedValues: [{ language: 'en', value: message('en') }],
          },
          displayInterval: { endTime: { date: new Date(Date.now() + 7 * 86400000).toISOString() } },
        },
      }),
    });
    if (response.ok) return { outcome: 'accepted', error: null };
    if (response.status === 404) return { outcome: 'skipped', error: 'PASS_NOT_SAVED' };
    if (response.status === 429) return { outcome: 'retry', error: 'GOOGLE_QUOTA' };
    if (response.status >= 500)
      return { outcome: 'uncertain', error: 'GOOGLE_DELIVERY_UNCONFIRMED' };
    return { outcome: 'failed', error: 'GOOGLE_MESSAGE_REJECTED' };
  } catch {
    return { outcome: 'uncertain', error: 'GOOGLE_DELIVERY_UNCONFIRMED' };
  }
}

export async function runCustomerReminders(pool: pg.Pool, c: ServiceConfig) {
  const appleEnabled = c.APPLE_WALLET_ENABLED === 'true',
    googleEnabled = c.GOOGLE_WALLET_ENABLED === 'true';
  if (!appleEnabled && !googleEnabled) return false;
  const job = (
    await pool.query('SELECT claim_customer_reminder($1,$2) AS job', [appleEnabled, googleEnabled])
  ).rows[0]?.job as ReminderJob | null;
  if (!job) return false;
  let result: { outcome: Outcome; error: string | null };
  try {
    if (google === undefined && googleEnabled) google = loadGoogleWallet(c);
    result = await deliverCustomerReminder(job, pool, {
      apple: appleWalletPush(c) ?? undefined,
      google: google ?? undefined,
    });
  } catch {
    result = { outcome: 'retry', error: 'REMINDER_EXECUTION_FAILED' };
  }
  await pool.query('SELECT finish_customer_reminder($1,$2,$3,$4)', [
    job.id,
    job.lease,
    result.outcome,
    result.error,
  ]);
  return true;
}
