import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticated } from '../auth.js';
import { transaction, customerLifecycleLock, audit, type Pools } from '../db.js';
import type { Config } from '../config.js';
import { keyedHash, otpCode, tokenHash } from '../crypto.js';
import { AppError, requireCondition } from '../errors.js';
import { expectedRevision } from '../operations.js';
import { merchantGrant } from '../policy.js';
import {
  deviceCookie,
  deviceCsrf,
  deviceAgentFamily,
  issueDeviceSession,
} from '../customer-auth/device-auth.js';
import {
  customerLookupInput,
  customerPairingClaimInput,
  customerPairingStartInput,
  customerPairingDecisionInput,
  deviceNoticeInput,
} from '../../../../packages/contracts/src/customer-identity.js';
import { customerLimit } from './customer-identity.js';

const idParams = z.object({ id: z.uuid() });
// The code is bound to one merchant and peppered, so a leaked hash is not brute-forceable offline.
const pairingCodeHash = (c: Config, merchantId: string, code: string) =>
  keyedHash('customer-pairing:' + merchantId + ':' + code, c.AUTH_PEPPER);

// Staff-assisted card recovery (Security H1). Staff never receive a bearer link: the
// customer's own device shows a code, staff enter it, and only that device can consume.
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

  // Staff: enter the code shown on the customer's phone.
  app.post('/api/v1/merchants/:m/customer-pairings', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      p = customerPairingClaimInput.parse(req.body);
    // Bounds code guessing by any single staff member, whatever their role.
    requireCondition(
      await customerLimit(pools, c, 'customer-pairing-claim:' + actor.id, 20, 3600),
      'CUSTOMER_RECOVERY_LIMIT',
      429,
    );
    const result = await transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, undefined, p.branchId);
        await customerLifecycleLock(db, p.customerId);
        return (
          await db.query('SELECT claim_customer_pairing($1,$2,$3,$4) AS value', [
            m,
            p.branchId,
            p.customerId,
            pairingCodeHash(c, m, p.code),
          ])
        ).rows[0].value;
      },
      actor,
    );
    requireCondition(!result.invalid, 'PAIRING_CODE_INVALID', 422);
    requireCondition(!result.limited, 'CUSTOMER_RECOVERY_LIMIT', 429);
    return { id: result.id, status: result.status };
  });

  // Owner/manager: cashier requests waiting for approval + staff with unusual counts.
  app.get('/api/v1/merchants/:m/customer-pairings', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner', 'manager']);
        return (await db.query('SELECT customer_pairing_queue($1) AS value', [m])).rows[0].value;
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/customer-pairings/:id/decision', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      p = customerPairingDecisionInput.parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner', 'manager']);
        return (
          await db.query('SELECT decide_customer_pairing($1,$2,$3) AS value', [m, id, p.approve])
        ).rows[0].value;
      },
      actor,
    );
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

  // Customer device: public merchant name for the generic /r/<merchantId> link.
  app.get(
    '/api/v1/customer/pairing-merchants/:m',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const { m } = z.object({ m: z.uuid() }).parse(req.params);
      const result = (
        await pools.authPool.query('SELECT customer_pairing_merchant($1) AS value', [m])
      ).rows[0].value;
      requireCondition(result, 'NOT_FOUND', 404);
      return result;
    },
  );
  // Customer device: start (or resume) a pairing. Only this response ever contains the code.
  app.post(
    '/api/v1/customer/pairings',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const device = deviceCsrf(req, c),
        p = customerPairingStartInput.parse(req.body);
      for (let attempt = 0; ; attempt++) {
        const code = otpCode();
        try {
          const result = (
            await transaction(pools.authPool, (db) =>
              db.query('SELECT start_customer_pairing($1,$2,$3) AS value', [
                p.merchantId,
                device,
                pairingCodeHash(c, p.merchantId, code),
              ]),
            )
          ).rows[0].value;
          requireCondition(!result.limited, 'CUSTOMER_RECOVERY_LIMIT', 429);
          return result.status === 'waiting' ? { ...result, code } : result;
        } catch (error) {
          // Another open pairing at this shop drew the same code: draw again.
          if (error instanceof AppError && error.code === 'CONFLICT' && attempt < 4) continue;
          throw error;
        }
      }
    },
  );
  app.get(
    '/api/v1/customer/pairings/:id',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      // Read-only polling: the httpOnly device cookie identifies the pairing's own device.
      const { id } = idParams.parse(req.params),
        raw = req.cookies[deviceCookie(c)];
      requireCondition(raw && /^[A-Za-z0-9_-]{43}$/.test(raw), 'NOT_FOUND', 404);
      const device = tokenHash(raw);
      const result = (
        await pools.authPool.query('SELECT customer_pairing_status($1,$2) AS value', [id, device])
      ).rows[0].value;
      requireCondition(result, 'NOT_FOUND', 404);
      return result;
    },
  );
  app.post(
    '/api/v1/customer/pairings/:id/consume',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = idParams.parse(req.params),
        device = deviceCsrf(req, c);
      const result = await transaction(pools.authPool, async (db) => {
        const identity = (
          await db.query(
            'SELECT customer_id FROM customer_pairings WHERE id=$1 AND device_hash=$2',
            [id, device],
          )
        ).rows[0];
        if (identity?.customer_id) await customerLifecycleLock(db, identity.customer_id);
        return (
          await db.query('SELECT consume_customer_pairing($1,$2,$3) AS value', [
            id,
            device,
            deviceAgentFamily(String(req.headers['user-agent'] || '')),
          ])
        ).rows[0].value;
      });
      requireCondition(result, 'RECOVERY_LINK_INVALID', 410);
      requireCondition(!result.deviceConflict, 'DEVICE_ALREADY_BOUND', 409);
      const session = await issueDeviceSession(pools, c, req, reply);
      requireCondition(session, 'CUSTOMER_DEVICE_REVOKED', 401);
      return { membershipId: result.membershipId, csrfToken: session.csrfToken };
    },
  );

  // Customer's other devices: "a new phone was added to your card at <shop>".
  app.get('/api/v1/me/device-notices', async (req) => {
    const actor = authenticated(req);
    if (actor.authMethod !== 'device') return { notices: [] };
    return transaction(
      pools.pool,
      async (db) => ({
        notices: (await db.query('SELECT my_device_notices($1) AS value', [actor.sessionId]))
          .rows[0].value,
      }),
      actor,
    );
  });
  app.post('/api/v1/me/device-notices/:id', async (req) => {
    const actor = authenticated(req),
      { id } = idParams.parse(req.params),
      p = deviceNoticeInput.parse(req.body);
    requireCondition(actor.authMethod === 'device', 'NOT_FOUND', 404);
    return transaction(
      pools.pool,
      async (db) =>
        (
          await db.query('SELECT resolve_device_notice($1,$2,$3) AS value', [
            actor.sessionId,
            id,
            p.removeDevice,
          ])
        ).rows[0].value,
      actor,
    );
  });
}
