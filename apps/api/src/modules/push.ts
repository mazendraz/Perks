import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { authenticated } from '../auth.js';
import { transaction, type Pools } from '../db.js';
import { AppError, requireCondition } from '../errors.js';
import { testNotice } from '../push-notices.js';
import {
  b64urlDecode,
  delivered,
  gone,
  isPushEndpoint,
  sendPush,
  webPushConfig,
  type Transport,
} from '../webpush.js';

const subscribeInput = z
  .object({
    subscription: z
      .object({
        endpoint: z.string().max(1000).refine(isPushEndpoint),
        keys: z.object({
          // 65-byte uncompressed P-256 point and a 16-byte auth secret, as browsers produce them.
          p256dh: z.string().refine((v) => {
            const raw = b64urlDecode(v);
            return raw.length === 65 && raw[0] === 4;
          }),
          auth: z.string().refine((v) => b64urlDecode(v).length === 16),
        }),
      })
      .strip(),
    language: z.enum(['ar', 'en']).default('ar'),
  })
  .strict();
const endpointInput = z.object({ endpoint: z.string().max(1000) }).strict();

// Phone notifications for cashiers and managers. Every route 404s while Web Push is not configured,
// so a deployment without a VAPID pair behaves exactly as before.
export function pushModule(
  app: FastifyInstance,
  pools: Pools,
  c: Config,
  options: { transport?: Transport } = {},
) {
  const config = webPushConfig(c);
  const enabled = () => requireCondition(config, 'PUSH_NOT_ENABLED', 404);
  app.get('/api/v1/me/push/config', async (req) => {
    authenticated(req);
    return config ? { enabled: true, publicKey: config.publicKey } : { enabled: false };
  });
  app.post('/api/v1/me/push/subscribe', async (req) => {
    const actor = authenticated(req);
    enabled();
    const p = subscribeInput.parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        // Only people who work a branch have a use for it; a customer's session is refused here.
        requireCondition(
          (
            await db.query(
              "SELECT 1 FROM staff_memberships WHERE user_id=$1 AND role IN ('cashier','manager') AND status='active' LIMIT 1",
              [actor.id],
            )
          ).rowCount,
          'FORBIDDEN',
          403,
        );
        await db.query('SELECT push_register($1,$2,$3,$4,$5)', [
          p.subscription.endpoint,
          p.subscription.keys.p256dh,
          p.subscription.keys.auth,
          p.language,
          actor.sessionId,
        ]);
        return { subscribed: true };
      },
      actor,
    );
  });
  app.post('/api/v1/me/push/unsubscribe', async (req) => {
    const actor = authenticated(req),
      p = endpointInput.parse(req.body);
    // Allowed (and harmless) while push is off, so a device can always be unlinked.
    return transaction(
      pools.pool,
      async (db) => ({
        // Row level security limits this to the caller's own devices.
        removed: !!(
          await db.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [p.endpoint])
        ).rowCount,
      }),
      actor,
    );
  });
  app.post(
    '/api/v1/me/push/test',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req) => {
      const actor = authenticated(req);
      enabled();
      const p = endpointInput.parse(req.body);
      const sub = (
        await transaction(
          pools.pool,
          async (db) =>
            db.query<{
              id: string;
              endpoint: string;
              p256dh: string;
              auth: string;
              language: 'ar' | 'en';
            }>(
              'SELECT id,endpoint,p256dh,auth,language FROM push_subscriptions WHERE endpoint=$1',
              [p.endpoint],
            ),
          actor,
        )
      ).rows[0];
      requireCondition(sub, 'NOT_FOUND', 404);
      // Sent with no transaction open: a push service may take seconds to answer.
      const result = await sendPush(sub, { ...testNotice(sub.language) }, config!, {
        topic: 'test',
        transport: options.transport,
      });
      if (gone(result))
        await transaction(
          pools.pool,
          (db) => db.query('DELETE FROM push_subscriptions WHERE id=$1', [sub.id]),
          actor,
        );
      if (!delivered(result)) throw new AppError('PUSH_NOT_DELIVERED', 502, !gone(result));
      return { delivered: true };
    },
  );
}
