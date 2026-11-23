import { withOpenUrl } from '../../api/src/wallet/restore.js';
import type pg from 'pg';
import type { ServiceConfig } from '../../api/src/config.js';
import type { WalletCard } from '../../api/src/wallet/apple-pass.js';
import {
  classId,
  googleClass,
  googleObject,
  loadGoogleWallet,
  objectId,
  patchGoogle,
  putGoogle,
  putGoogleKeepingMessages,
  stripVersion,
  type GoogleWallet,
} from '../../api/src/wallet/google-wallet.js';

let cached: GoogleWallet | null | undefined;
let lastRun = 0;
// Sends changed cards to Google. A 404 means the customer never saved the card: nothing to do.
export async function runGoogleWalletUpdates(
  pool: pg.Pool,
  c: ServiceConfig,
  injected?: GoogleWallet,
): Promise<number> {
  if (c.GOOGLE_WALLET_ENABLED !== 'true') return 0;
  if (!injected && Date.now() - lastRun < 2000) return 0;
  lastRun = Date.now();
  const g = injected ?? (cached === undefined ? (cached = loadGoogleWallet(c)) : cached);
  if (!g) return 0;
  const changes = (
    await pool.query<{ object_key: string; card: WalletCard & { logo_asset_id?: string } }>(
      'SELECT object_key,card FROM google_wallet_claim_changes()',
    )
  ).rows;
  let updated = 0;
  for (const { object_key, card } of changes) {
    const object = googleObject(
      g,
      withOpenUrl(card, c.PUBLIC_APP_ORIGIN, c.AUTH_PEPPER),
      object_key,
      c.PUBLIC_APP_ORIGIN,
      stripVersion(card),
    );
    let status: number;
    try {
      // The shop's messages on the saved card survive the update (a plain PUT deleted them).
      const first = await putGoogleKeepingMessages(g, objectId(g, object_key), {
        ...object,
        // Transient: Google notifies (max 3 per day, shared with shop messages) when
        // loyaltyPoints.balance changes.
        notifyPreference: 'notifyOnUpdate',
      });
      status = first.status;
      // Over the notification quota: deliver the update silently. (A 429 on reading the card
      // is retried later instead: a PUT without its messages would delete them.)
      if (status === 429 && first.read)
        status = await putGoogle(
          g,
          'loyaltyObject',
          objectId(g, object_key),
          first.messages.length ? { ...object, messages: first.messages } : object,
        );
    } catch {
      status = 0;
    }
    if (status === 0 || status === 429 || status >= 500) {
      await pool.query('SELECT google_wallet_retry($1)', [object_key]);
      continue;
    }
    if (status === 200) {
      const klass = googleClass(g, card, c.PUBLIC_APP_ORIGIN);
      const classStatus = await patchGoogle(g, 'loyaltyClass', classId(g, card), {
        issuerName: klass.issuerName,
        programName: klass.programName,
        localizedProgramName: klass.localizedProgramName,
        programLogo: klass.programLogo,
        hexBackgroundColor: klass.hexBackgroundColor,
        accountIdLabel: klass.accountIdLabel,
        localizedAccountIdLabel: klass.localizedAccountIdLabel,
      }).catch(() => 0);
      if (classStatus === 0 || classStatus === 429 || classStatus >= 500)
        await pool.query('SELECT google_wallet_retry($1)', [object_key]);
      else updated++;
    }
  }
  return updated;
}
