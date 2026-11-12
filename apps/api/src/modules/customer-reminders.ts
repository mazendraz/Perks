import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  reminderDefaults,
  reminderSettingsInput,
} from '../../../../packages/contracts/src/customer-reminders.js';
import { authenticated } from '../auth.js';
import { audit, transaction, type Pools, type DB, type Actor } from '../db.js';
import { merchantGrant, platform } from '../policy.js';
import { requireCondition } from '../errors.js';
import { idempotencyKey, operation } from '../operations.js';
import type { Config } from '../config.js';

async function access(db: DB, actor: Actor, merchantId: string, write = false) {
  if (actor.role === 'platform_admin') {
    platform(actor, write);
    return true;
  }
  await merchantGrant(db, actor, merchantId, ['owner', 'manager'], undefined, write);
  const allowed = (await db.query('SELECT owner_full_customer_scope($1) AS allowed', [merchantId]))
    .rows[0].allowed as boolean;
  if (write) requireCondition(allowed, 'FORBIDDEN', 403);
  return allowed;
}
export function customerRemindersModule(app: FastifyInstance, pools: Pools, c: Config) {
  app.get('/api/v1/merchants/:m/customer-reminders', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const canManage = await access(db, actor, m);
        const merchant = (await db.query('SELECT name,timezone FROM merchants WHERE id=$1', [m]))
          .rows[0];
        requireCondition(merchant, 'NOT_FOUND', 404);
        const row = (
          await db.query(
            'SELECT settings,revision FROM customer_reminder_settings WHERE merchant_id=$1',
            [m],
          )
        ).rows[0];
        const stats = canManage
          ? (
              await db.query(
                `SELECT
        count(*) FILTER(WHERE status='queued' OR status='processing')::int AS queued,
        count(*) FILTER(WHERE status='accepted')::int AS accepted,
        count(*) FILTER(WHERE status='failed')::int AS failed,
        count(*) FILTER(WHERE status='uncertain')::int AS uncertain,
        count(DISTINCT profile_id) FILTER(WHERE status='accepted')::int AS customers,
        count(DISTINCT profile_id) FILTER(WHERE returned_at IS NOT NULL)::int AS returned
        FROM customer_reminders WHERE merchant_id=$1 AND created_at>now()-interval '30 days'`,
                [m],
              )
            ).rows[0]
          : null;
        const recent = canManage
          ? (
              await db.query(
                `SELECT r.id,cp.alias,r.channel,r.status,r.created_at,r.accepted_at,r.returned_at,r.error_code
        FROM customer_reminders r JOIN tenant_customer_profiles cp ON cp.id=r.profile_id
        WHERE r.merchant_id=$1 ORDER BY r.created_at DESC LIMIT 20`,
                [m],
              )
            ).rows
          : [];
        return {
          settings: row?.settings ?? reminderDefaults,
          revision: row?.revision ?? 0,
          canManage,
          merchantName: merchant.name,
          timezone: merchant.timezone,
          stats,
          recent,
          providers: {
            apple: c.APPLE_WALLET_ENABLED === 'true',
            google: c.GOOGLE_WALLET_ENABLED === 'true',
          },
        };
      },
      actor,
    );
  });
  app.patch('/api/v1/merchants/:m/customer-reminders', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      body = reminderSettingsInput.parse(req.body),
      revision = z.coerce.number().int().min(0).parse(req.headers['if-match']),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        await access(db, actor, m, true);
        return operation(
          db,
          actor,
          { scope: 'customer.reminders:' + m, key, payload: { body, revision }, merchantId: m },
          async () => {
            // Serialize the initial insert too, so two owners cannot overwrite the first revision.
            await db.query('SELECT id FROM merchants WHERE id=$1 FOR UPDATE', [m]);
            const current = (
              await db.query(
                'SELECT revision FROM customer_reminder_settings WHERE merchant_id=$1',
                [m],
              )
            ).rows[0];
            requireCondition((current?.revision ?? 0) === revision, 'REVISION_CONFLICT', 409);
            const row = (
              await db.query(
                `INSERT INTO customer_reminder_settings(merchant_id,settings) VALUES($1,$2)
          ON CONFLICT(merchant_id) DO UPDATE SET settings=excluded.settings,revision=customer_reminder_settings.revision+1,updated_at=clock_timestamp()
          RETURNING settings,revision`,
                [m, body],
              )
            ).rows[0];
            await audit(db, actor, 'customer.reminders.configure', m, m, {
              enabled: body.enabled,
              revision: row.revision,
            });
            return row;
          },
        );
      },
      actor,
    );
  });
}
