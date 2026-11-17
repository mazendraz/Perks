import type { FastifyInstance } from 'fastify';
import { transaction, type Pools } from './db.js';
import { AppError } from './errors.js';

// What a cancelled shop can still do. Customers come first: rewards they earned are honoured,
// their devices can be re-paired, and the owner can export customers or ask to come back.
const stillAllowed = [
  /^redemption-challenges\/[^/]+\/(cancel|complete)$/,
  /^rewards\/[^/]+\/redemption-challenges$/,
  /^customer-pairings(\/[^/]+\/decision)?$/,
  /^customer-recovery\/search$/,
  /^plan\/requests(\/[^/]+\/withdraw)?$/,
];
const exportRoute = /^customer-exports$/;
const merchantRoute = /^\/api\/v1\/merchants\/([0-9a-f-]{36})\/([^?]*)/i;

/** A cancelled subscription makes the shop read-only (CSV export stays open for 30 days). */
export function readOnlyGuard(app: FastifyInstance, pools: Pools) {
  app.addHook('preHandler', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const match = merchantRoute.exec(req.url);
    // Signed-out requests are answered by the route itself.
    if (!match || !req.actor) return;
    const [, merchantId, rest] = match as unknown as [string, string, string];
    if (stillAllowed.some((r) => r.test(rest))) return;
    const mode = await transaction(
      pools.pool,
      async (db) =>
        (await db.query('SELECT merchant_subscription_mode($1) AS mode', [merchantId])).rows[0]
          .mode as string,
      req.actor,
    );
    if (mode === 'normal' || (mode === 'read_only' && exportRoute.test(rest))) return;
    throw new AppError('SUBSCRIPTION_READ_ONLY', 409);
  });
}
