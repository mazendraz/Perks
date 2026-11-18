import type { DB } from './db.js';
import {
  effectiveEntitlements,
  type EffectiveEntitlements,
  type EntitlementKey,
  type LimitKey,
} from '../../../packages/contracts/src/entitlements.js';

/**
 * The single entry point for "what is this merchant allowed to do". Every value comes from the
 * database (plan → add-ons → override); nothing here knows plan names.
 * Results are cached per request only (pass the same `cache` for one request), never across.
 */
export type EntitlementCache = Map<string, EffectiveEntitlements>;

export async function getEntitlements(
  db: DB,
  merchantId: string,
  cache?: EntitlementCache,
): Promise<EffectiveEntitlements> {
  const hit = cache?.get(merchantId);
  if (hit) return hit;
  const raw = (await db.query('SELECT effective_entitlements($1) AS e', [merchantId])).rows[0]?.e;
  const value = effectiveEntitlements.parse(raw);
  cache?.set(merchantId, value);
  return value;
}

/**
 * Throws PLAN_LIMIT_REACHED (with add-on and upgrade options) or FEATURE_NOT_IN_PLAN.
 * It locks the merchant's subscription row, so call it inside the same transaction as the
 * create it guards: two parallel creates at the limit cannot both pass.
 */
export async function assertCan(db: DB, merchantId: string, key: EntitlementKey, increment = 1) {
  await db.query('SELECT assert_entitlement($1,$2,$3)', [merchantId, key, increment]);
}

/** Uses one unit of a monthly allowance; throws PLAN_LIMIT_REACHED when it is used up. */
export async function consume(
  db: DB,
  merchantId: string,
  key: Extract<LimitKey, 'manual_messages_per_month'>,
) {
  return Number(
    (await db.query('SELECT consume_entitlement_usage($1,$2) AS n', [merchantId, key])).rows[0].n,
  );
}
