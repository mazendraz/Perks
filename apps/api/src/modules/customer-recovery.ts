import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticated } from '../auth.js';
import { transaction, audit, type Pools } from '../db.js';
import type { Config } from '../config.js';
import { keyedHash, tokenHash } from '../crypto.js';
import { requireCondition } from '../errors.js';
import { idempotencyKey, expectedRevision } from '../operations.js';
import { merchantGrant } from '../policy.js';
import { deviceCsrf, deviceAgentFamily, issueDeviceSession } from '../customer-auth/device-auth.js';
import {
  customerLookupInput,
  customerRecoveryInput,
  recoveryConsumeInput,
} from '../../../../packages/contracts/src/customer-identity.js';
import { customerLimit } from './customer-identity.js';
const tokenParams = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
export function customerRecoveryModule(app: FastifyInstance, pools: Pools, c: Config) {
  app.post('/api/v1/merchants/:m/customer-recovery/search', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      p = customerLookupInput.parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        const grant = await merchantGrant(db, actor, m, undefined, p.branchId);
        const allowed =
          grant.role !== 'cashier' ||
          (await customerLimit(pools, c, 'customer-search:' + actor.id, 30, 3600));
        await audit(
          db,
          actor,
          allowed ? 'customer.recovery.search' : 'customer.recovery.search_limit',
          m,
          null,
          { branchId: p.branchId, mode: 'full_phone_exact' },
        );
        if (!allowed) return { limited: true, customer: null };
        return {
          customer: (
            await db.query('SELECT lookup_customer_phone($1,$2,$3) AS value', [
              m,
              p.branchId,
              p.phone,
            ])
          ).rows[0].value,
        };
      },
      actor,
    ).then((result) => {
      requireCondition(!result.limited, 'CUSTOMER_SEARCH_LIMIT', 429);
      return { customer: result.customer };
    });
  });
  app.post('/api/v1/merchants/:m/customer-recovery', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      p = customerRecoveryInput.parse(req.body),
      key = idempotencyKey(req);
    // An opaque bearer value reproducible only with the server pepper and this
    // actor's command key. The database keeps its hash, never the link itself.
    const token = keyedHash('customer-recovery:' + actor.id + ':' + key, c.AUTH_PEPPER);
    const result = await transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, undefined, p.branchId);
        return (
          await db.query('SELECT create_customer_recovery($1,$2,$3,$4) AS value', [
            m,
            p.branchId,
            p.customerId,
            tokenHash(token),
          ])
        ).rows[0].value;
      },
      actor,
    );
    requireCondition(!result.limited, 'CUSTOMER_RECOVERY_LIMIT', 429);
    const link = c.PUBLIC_APP_ORIGIN + '/r/' + token;
    const message =
      actor.locale === 'en'
        ? `Hi ${result.name}, here is your ${result.merchantName} loyalty card: ${link}\nOpen it on your phone to restore your card.`
        : `أهلًا ${result.name}، ده كارت ${result.merchantName} بتاعك 👇\n${link}\nافتحه من موبايلك علشان يرجعلك الكارت.`;
    return {
      url: 'https://wa.me/' + result.phone.slice(1) + '?text=' + encodeURIComponent(message),
      expiresAt: result.expiresAt,
      draftOnly: true,
    };
  });
  app.get('/api/v1/merchants/:m/customer-recovery-settings', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner']);
        return (
          await db.query(
            'SELECT cashier_recovery_enabled AS "cashierEnabled",revision FROM merchants WHERE id=$1',
            [m],
          )
        ).rows[0];
      },
      actor,
    );
  });
  app.patch('/api/v1/merchants/:m/customer-recovery-settings', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      p = z.object({ cashierEnabled: z.boolean() }).strict().parse(req.body),
      revision = expectedRevision(req);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner']);
        return (
          await db.query('SELECT set_customer_recovery_policy($1,$2,$3) AS value', [
            m,
            revision,
            p.cashierEnabled,
          ])
        ).rows[0].value;
      },
      actor,
    );
  });
  app.get(
    '/api/v1/customer/recoveries/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const { token } = tokenParams.parse(req.params);
      const result = (
        await pools.authPool.query('SELECT customer_recovery_preview($1) AS value', [
          tokenHash(token),
        ])
      ).rows[0].value;
      requireCondition(result, 'RECOVERY_LINK_INVALID', 410);
      return result;
    },
  );
  app.post(
    '/api/v1/customer/recoveries/:token/consume',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = tokenParams.parse(req.params),
        p = recoveryConsumeInput.parse(req.body),
        hash = deviceCsrf(req, c);
      const result = await transaction(
        pools.authPool,
        async (db) =>
          (
            await db.query('SELECT consume_customer_recovery($1,$2,$3,$4) AS value', [
              tokenHash(token),
              hash,
              deviceAgentFamily(String(req.headers['user-agent'] || '')),
              p.revokeOldDevices,
            ])
          ).rows[0].value,
      );
      requireCondition(result, 'RECOVERY_LINK_INVALID', 410);
      requireCondition(!result.deviceConflict, 'DEVICE_ALREADY_BOUND', 409);
      const session = await issueDeviceSession(pools, c, req, reply);
      requireCondition(session, 'CUSTOMER_DEVICE_REVOKED', 401);
      return { membershipId: result.membershipId, csrfToken: session.csrfToken };
    },
  );
}
