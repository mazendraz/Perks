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
    const object = googleObject(g, card, object_key, c.PUBLIC_APP_ORIGIN, stripVersion(card));
    let status: number;
    try {
      status = await putGoogle(g, 'loyaltyObject', objectId(g, object_key), {
        ...object,
        // Transient: Google notifies (max 3 per day) when loyaltyPoints.balance changes.
        notifyPreference: 'notifyOnUpdate',
      });
      // Over the notification quota: deliver the update silently.
      if (status === 429)
        status = await putGoogle(g, 'loyaltyObject', objectId(g, object_key), object);
    } catch {
      status = 0;
    }
    if (status === 0 || status === 429 || status >= 500) {
      await pool.query('SELECT google_wallet_retry($1)', [object_key]);
      continue;
    }
    if (status === 200) {
      updated++;
      const klass = googleClass(g, card, c.PUBLIC_APP_ORIGIN);
      await patchGoogle(g, 'loyaltyClass', classId(g, card), {
        issuerName: klass.issuerName,
        programName: klass.programName,
        localizedProgramName: klass.localizedProgramName,
        programLogo: klass.programLogo,
        hexBackgroundColor: klass.hexBackgroundColor,
      });
    }
  }
  return updated;
}
