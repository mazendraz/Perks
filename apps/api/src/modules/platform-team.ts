import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  platformAdminInput,
  platformAdminCommand,
} from '../../../../packages/contracts/src/platform-admin.js';
import { authenticated } from '../auth.js';
import { transaction, type Pools } from '../db.js';
import type { Config } from '../config.js';
import { platform } from '../policy.js';
import { requireCondition } from '../errors.js';
import { operation, idempotencyKey } from '../operations.js';
import { keyedHash } from '../crypto.js';
import { hashPassword } from '../passwords.js';
export function platformTeamModule(app: FastifyInstance, pools: Pools, c: Config) {
  const local = () =>
    requireCondition(
      c.AUTH_PROVIDER === 'local' && ['development', 'test'].includes(c.APP_ENV),
      'PASSWORD_AUTH_NOT_CONFIGURED',
      503,
    );
  app.get('/api/v1/platform/admins', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    return transaction(
      pools.pool,
      async (db) => ({
        accounts: (await db.query('SELECT platform_admin_accounts() AS account')).rows.map(
          (r) => r.account,
        ),
        events: (
          await db.query(
            "SELECT a.id,a.action,a.at,a.target_id,a.detail,u.display_name AS actor_name,u.email AS actor_email FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.action LIKE 'platform.admin.%' ORDER BY a.at DESC,a.id DESC LIMIT 30",
          )
        ).rows,
      }),
      actor,
    );
  });
  app.post(
    '/api/v1/platform/admins',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const actor = authenticated(req);
      platform(actor);
      local();
      const body = platformAdminInput.parse(req.body),
        key = idempotencyKey(req),
        hash = await hashPassword(body.password, c.AUTH_PEPPER);
      return transaction(
        pools.pool,
        (db) =>
          operation(
            db,
            actor,
            {
              scope: 'platform.admin.create',
              key,
              payload: { ...body, password: keyedHash(body.password, c.AUTH_PEPPER) },
            },
            async () => ({
              account: (
                await db.query('SELECT create_platform_admin($1,$2,$3,$4) AS account', [
                  body.email,
                  body.name,
                  hash,
                  body.reason,
                ])
              ).rows[0].account,
            }),
          ),
        actor,
      );
    },
  );
  app.post(
    '/api/v1/platform/admins/:id/security',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const actor = authenticated(req);
      platform(actor);
      local();
      const { id } = z.object({ id: z.uuid() }).parse(req.params),
        body = platformAdminCommand.parse(req.body),
        key = idempotencyKey(req);
      const hash =
        body.action === 'password' ? await hashPassword(body.password, c.AUTH_PEPPER) : null;
      return transaction(
        pools.pool,
        (db) =>
          operation(
            db,
            actor,
            {
              scope: 'platform.admin.security:' + id,
              key,
              payload: {
                ...body,
                ...(body.action === 'password'
                  ? { password: keyedHash(body.password, c.AUTH_PEPPER) }
                  : {}),
              },
            },
            async () => ({
              result: (
                await db.query('SELECT manage_platform_admin($1,$2,$3,$4,$5) AS result', [
                  id,
                  body.action,
                  hash,
                  body.credentialVersion,
                  body.reason,
                ])
              ).rows[0].result,
            }),
          ),
        actor,
      );
    },
  );
}
