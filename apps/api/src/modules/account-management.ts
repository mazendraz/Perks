import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { staffSecurityCommand } from '../../../../packages/contracts/src/account-management.js';
import { authenticated } from '../auth.js';
import { transaction, type Pools } from '../db.js';
import { merchantGrant, platform } from '../policy.js';
import { requireCondition } from '../errors.js';
import { hashPassword } from '../passwords.js';
import { keyedHash } from '../crypto.js';
import { operation, idempotencyKey } from '../operations.js';
import type { Config } from '../config.js';
export function accountManagementModule(app: FastifyInstance, pools: Pools, c: Config) {
  app.get('/api/v1/merchants/:m/account-security', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        if (actor.role === 'platform_admin') platform(actor);
        else await merchantGrant(db, actor, m, ['owner']);
        return {
          accounts: (await db.query('SELECT staff_account_security($1) AS account', [m])).rows.map(
            (r) => ({
              ...r.account,
              canManageCredentials: r.account.canManageCredentials && c.AUTH_PROVIDER === 'local',
            }),
          ),
        };
      },
      actor,
    );
  });
  app.post(
    '/api/v1/merchants/:m/staff/:id/security',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const actor = authenticated(req),
        { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
        body = staffSecurityCommand.parse(req.body),
        key = idempotencyKey(req);
      requireCondition(
        c.AUTH_PROVIDER === 'local' && ['development', 'test'].includes(c.APP_ENV),
        'PASSWORD_AUTH_NOT_CONFIGURED',
        503,
      );
      await transaction(
        pools.pool,
        async (db) => {
          if (actor.role === 'platform_admin') platform(actor);
          else await merchantGrant(db, actor, m, ['owner']);
          requireCondition(
            (await db.query('SELECT can_manage_staff_credentials($1,$2) AS allowed', [m, id]))
              .rows[0].allowed,
            'ACCOUNT_SECURITY_NOT_MANAGED',
            403,
          );
        },
        actor,
      );
      const hash =
        body.action === 'password' ? await hashPassword(body.password, c.AUTH_PEPPER) : null;
      return transaction(
        pools.pool,
        async (db) => {
          if (actor.role === 'platform_admin') platform(actor);
          else await merchantGrant(db, actor, m, ['owner']);
          return operation(
            db,
            actor,
            {
              scope: 'staff.security:' + id,
              key,
              merchantId: m,
              payload: {
                ...body,
                ...(body.action === 'password'
                  ? { password: keyedHash(body.password, c.AUTH_PEPPER) }
                  : {}),
              },
            },
            async () => ({
              result: (
                await db.query('SELECT manage_staff_security($1,$2,$3,$4,$5,$6) AS result', [
                  m,
                  id,
                  body.action,
                  hash,
                  body.credentialVersion,
                  body.reason,
                ])
              ).rows[0].result,
            }),
          );
        },
        actor,
      );
    },
  );
}
