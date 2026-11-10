import type { DB } from './db.js';
import { requireCondition } from './errors.js';
export async function requireEarning(db: DB, merchantId: string) {
  await db.query('SELECT merchant_id FROM feature_entitlements WHERE merchant_id=$1 FOR SHARE', [
    merchantId,
  ]);
  requireCondition(
    (await db.query('SELECT merchant_earning_allowed($1) AS allowed', [merchantId])).rows[0]
      .allowed,
    'SUBSCRIPTION_INACTIVE',
    409,
  );
}
