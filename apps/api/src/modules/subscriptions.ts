import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticated } from '../auth.js';
import { transaction, audit, type Pools, type DB, type Actor } from '../db.js';
import { platform, merchantGrant } from '../policy.js';
import { idempotencyKey, expectedRevision, operation } from '../operations.js';
import { requireCondition } from '../errors.js';
import {
  subscriptionPaymentInput,
  subscriptionPauseInput,
  subscriptionVoidInput,
} from '../../../../packages/contracts/src/subscriptions.js';
const merchantParams = z.object({ m: z.uuid() });
async function state(db: DB, mid: string) {
  const e = (
    await db.query(
      'SELECT e.*,m.timezone,merchant_earning_allowed(e.merchant_id) AS allowed FROM feature_entitlements e JOIN merchants m ON m.id=e.merchant_id WHERE e.merchant_id=$1',
      [mid],
    )
  ).rows[0];
  requireCondition(e, 'NOT_FOUND', 404);
  return {
    revision: e.revision,
    billingRequired: e.billing_required,
    earningPaused: e.earning_paused,
    earningAllowed: e.allowed,
    expiresAt: e.expires_at,
    timeZone: e.timezone,
    payments: (
      await db.query(
        `SELECT p.id,p.amount_minor,p.currency,p.method,p.period_start::text,p.period_end::text,p.payment_reference,p.reason,p.created_at,p.recorded_by,u.display_name AS recorded_by_name,v.created_at AS voided_at,v.reason AS void_reason
      FROM subscription_payments p JOIN users u ON u.id=p.recorded_by LEFT JOIN subscription_payment_voids v ON v.payment_id=p.id WHERE p.merchant_id=$1 ORDER BY p.created_at DESC,p.id LIMIT 100`,
        [mid],
      )
    ).rows,
  };
}
async function lock(db: DB, actor: Actor, mid: string, revision: number) {
  platform(actor);
  const e = (
    await db.query('SELECT * FROM feature_entitlements WHERE merchant_id=$1 FOR UPDATE', [mid])
  ).rows[0];
  requireCondition(e, 'NOT_FOUND', 404);
  requireCondition(e.revision === revision, 'REVISION_CONFLICT', 409);
}
export function subscriptionsModule(app: FastifyInstance, pools: Pools) {
  app.get('/api/v1/platform/merchants/:m/subscription', async (req) => {
    const actor = authenticated(req);
    platform(actor, false);
    const { m } = merchantParams.parse(req.params);
    return transaction(pools.pool, (db) => state(db, m), actor);
  });
  app.get('/api/v1/merchants/:m/subscription', async (req) => {
    const actor = authenticated(req),
      { m } = merchantParams.parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner']);
        return state(db, m);
      },
      actor,
    );
  });
  app.post('/api/v1/platform/merchants/:m/subscription/payments', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { m } = merchantParams.parse(req.params),
      p = subscriptionPaymentInput.parse(req.body),
      key = idempotencyKey(req),
      revision = expectedRevision(req);
    return transaction(
      pools.pool,
      (db) =>
        operation(
          db,
          actor,
          { scope: 'subscription.payment:' + m, key, payload: p, merchantId: m },
          async (operationId) => {
            await lock(db, actor, m, revision);
            if (p.reference)
              requireCondition(
                !(
                  await db.query(
                    `SELECT 1 FROM subscription_payments p WHERE p.merchant_id=$1 AND p.method=$2 AND lower(p.payment_reference)=lower($3)
            AND NOT EXISTS(SELECT 1 FROM subscription_payment_voids v WHERE v.payment_id=p.id)`,
                    [m, p.method, p.reference],
                  )
                ).rowCount,
                'PAYMENT_REFERENCE_USED',
                409,
              );
            const merchant = (await db.query('SELECT timezone FROM merchants WHERE id=$1', [m]))
              .rows[0];
            const paid = (
              await db.query(
                `INSERT INTO subscription_payments(merchant_id,amount_minor,method,period_start,period_end,starts_at,ends_at,payment_reference,reason,recorded_by,operation_id)
        VALUES($1,$2,$3,$4::date,$5::date,$4::date::timestamp AT TIME ZONE $6,($5::date+1)::timestamp AT TIME ZONE $6,$7,$8,$9,$10) RETURNING id,ends_at`,
                [
                  m,
                  p.amountMinor,
                  p.method,
                  p.periodStart,
                  p.periodEnd,
                  merchant.timezone,
                  p.reference,
                  p.reason,
                  actor.id,
                  operationId,
                ],
              )
            ).rows[0];
            await db.query(
              'UPDATE feature_entitlements SET billing_required=true,earning_paused=CASE WHEN $2 THEN false ELSE earning_paused END,expires_at=greatest(expires_at,$3),revision=revision+1 WHERE merchant_id=$1',
              [m, p.resumeEarning, paid.ends_at],
            );
            await audit(db, actor, 'subscription.payment.recorded', m, paid.id, {
              amountMinor: p.amountMinor,
              currency: 'EGP',
              method: p.method,
              periodStart: p.periodStart,
              periodEnd: p.periodEnd,
            });
            return { paymentId: paid.id, subscription: await state(db, m) };
          },
        ),
      actor,
    );
  });
  app.patch('/api/v1/platform/merchants/:m/subscription', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { m } = merchantParams.parse(req.params),
      p = subscriptionPauseInput.parse(req.body),
      key = idempotencyKey(req),
      revision = expectedRevision(req);
    return transaction(
      pools.pool,
      (db) =>
        operation(
          db,
          actor,
          { scope: 'subscription.pause:' + m, key, payload: p, merchantId: m },
          async () => {
            await lock(db, actor, m, revision);
            await db.query(
              'UPDATE feature_entitlements SET earning_paused=$2,revision=revision+1 WHERE merchant_id=$1',
              [m, p.earningPaused],
            );
            await audit(db, actor, 'subscription.earning.changed', m, m, {
              earningPaused: p.earningPaused,
              reason: p.reason,
            });
            return { subscription: await state(db, m) };
          },
        ),
      actor,
    );
  });
  app.post('/api/v1/platform/merchants/:m/subscription/payments/:id/void', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { m, id } = merchantParams.extend({ id: z.uuid() }).parse(req.params),
      p = subscriptionVoidInput.parse(req.body),
      key = idempotencyKey(req),
      revision = expectedRevision(req);
    return transaction(
      pools.pool,
      (db) =>
        operation(
          db,
          actor,
          { scope: 'subscription.void:' + m, key, payload: { ...p, id }, merchantId: m },
          async (operationId) => {
            await lock(db, actor, m, revision);
            requireCondition(
              (
                await db.query(
                  'SELECT 1 FROM subscription_payments WHERE merchant_id=$1 AND id=$2',
                  [m, id],
                )
              ).rowCount,
              'NOT_FOUND',
              404,
            );
            requireCondition(
              !(
                await db.query('SELECT 1 FROM subscription_payment_voids WHERE payment_id=$1', [id])
              ).rowCount,
              'PAYMENT_ALREADY_VOID',
              409,
            );
            await db.query(
              'INSERT INTO subscription_payment_voids(payment_id,merchant_id,recorded_by,reason,operation_id) VALUES($1,$2,$3,$4,$5)',
              [id, m, actor.id, p.reason, operationId],
            );
            await db.query(
              `UPDATE feature_entitlements SET expires_at=(SELECT max(ends_at) FROM subscription_payments p WHERE p.merchant_id=$1 AND NOT EXISTS(SELECT 1 FROM subscription_payment_voids v WHERE v.payment_id=p.id)),revision=revision+1 WHERE merchant_id=$1`,
              [m],
            );
            await audit(db, actor, 'subscription.payment.voided', m, id, { reason: p.reason });
            return { subscription: await state(db, m) };
          },
        ),
      actor,
    );
  });
}
