import type { FastifyInstance, FastifyReply } from 'fastify';
import { customerDeletionInput } from '../../../../packages/contracts/src/legal.js';
import type { Config } from '../config.js';
import { transaction, type Pools } from '../db.js';
import { authenticated } from '../auth.js';
import { requireCondition } from '../errors.js';
import { idempotencyKey, operation } from '../operations.js';
import { deviceCookie } from '../customer-auth/device-auth.js';
import { portalCookies } from '../portal-auth.js';
import { tokenHash } from '../crypto.js';
export function customerPrivacyModule(app: FastifyInstance, pools: Pools, c: Config) {
  const receiptCookie = c.COOKIE_SECURE === 'true' ? '__Host-nq_deleted' : 'nq_deleted';
  const clearBrowser = (reply: FastifyReply, raw?: string) => {
    const options = { path: '/', secure: c.COOKIE_SECURE === 'true', sameSite: 'strict' as const },
      names = portalCookies(c, 'customer');
    reply.clearCookie(names.session, options);
    reply.clearCookie(names.csrf, options);
    if (raw && /^[A-Za-z0-9_-]{43}$/.test(raw))
      reply.setCookie(receiptCookie, raw, {
        path: '/',
        secure: options.secure,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 600,
      });
    reply.clearCookie(deviceCookie(c), {
      path: '/',
      secure: options.secure,
      httpOnly: true,
      sameSite: 'lax',
    });
  };
  app.get('/api/v1/customer/deletion-status', async (req, reply) => {
    // A prior receipt must never confirm deletion of a newly registered card.
    if (req.actor) return { deleted: false };
    const raw = req.cookies[deviceCookie(c)] || req.cookies[receiptCookie];
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return { deleted: false };
    const row = await pools.authPool.query(
      `SELECT 1 FROM customer_devices d JOIN users u ON u.id=d.customer_id
      WHERE d.token_hash=$1 AND u.privacy_deleted_at>clock_timestamp()-interval '10 minutes'`,
      [tokenHash(raw)],
    );
    const deleted = row.rowCount === 1;
    if (deleted) clearBrowser(reply, raw);
    return { deleted };
  });
  app.post('/api/v1/me/privacy/delete', async (req, reply) => {
    const actor = authenticated(req),
      body = customerDeletionInput.parse(req.body),
      key = idempotencyKey(req);
    requireCondition(
      actor.authMethod === 'device' && actor.role === 'customer',
      'CUSTOMER_DEVICE_REQUIRED',
      403,
    );
    const result = await transaction(
      pools.pool,
      (db) =>
        operation(
          db,
          actor,
          { scope: 'customer.privacy.delete', key, payload: body },
          async () =>
            (await db.query('SELECT delete_customer_identity($1) AS value', [actor.sessionId]))
              .rows[0].value,
        ),
      actor,
    );
    clearBrowser(reply, req.cookies[deviceCookie(c)]);
    return result;
  });
}
