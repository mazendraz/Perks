import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticated } from '../auth.js';
import { transaction, type Pools, type DB, type Actor } from '../db.js';
import { platform } from '../policy.js';
import { idempotencyKey, expectedRevision, operation } from '../operations.js';
import { requireCondition } from '../errors.js';
import { getEntitlements } from '../entitlements.js';
import {
  planUpdateInput,
  planChangeInput,
  addonInput,
  overrideInput,
  trialInput,
  cancelInput,
  reasonInput,
  agreedPriceInput,
  type EntitlementValue,
} from '../../../../packages/contracts/src/billing.js';

const merchantParams = z.object({ m: z.uuid() });
const planParams = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/) });

function columns(v: EntitlementValue) {
  return {
    type: v.type,
    int: v.type === 'int' ? v.value : null,
    bool: v.type === 'bool' ? v.value : null,
    enumValue: v.type === 'enum' ? v.value : null,
  };
}

/** Everything the Super Admin sees for one merchant's billing. */
async function billingState(db: DB, mid: string) {
  const s = (
    await db.query(
      `SELECT s.*,p.key AS plan_key,pp.key AS pending_key FROM merchant_subscriptions s JOIN plans p ON p.id=s.plan_id
       LEFT JOIN plans pp ON pp.id=s.pending_plan_id WHERE s.merchant_id=$1`,
      [mid],
    )
  ).rows[0];
  requireCondition(s, 'NOT_FOUND', 404);
  // Sequential: these share the transaction's single connection.
  const addons = await db.query(
    'SELECT key,quantity,unit_amount_minor FROM subscription_addons WHERE merchant_id=$1 ORDER BY key',
    [mid],
  );
  const overrides = await db.query(
    `SELECT o.id,o.key,o.value_type,o.int_value,o.bool_value,o.enum_value,o.reason,o.expires_at,o.created_at,o.revoked_at,
        (o.revoked_at IS NULL AND (o.expires_at IS NULL OR o.expires_at>clock_timestamp())) AS active,u.display_name AS created_by_name
       FROM entitlement_overrides o LEFT JOIN users u ON u.id=o.created_by WHERE o.merchant_id=$1 ORDER BY o.created_at DESC LIMIT 50`,
    [mid],
  );
  const events = await db.query(
    `SELECT e.id,e.event_type,e.before,e.after,e.reason,e.created_at,u.display_name AS actor_name
       FROM subscription_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.merchant_id=$1 ORDER BY e.created_at DESC,e.id LIMIT 100`,
    [mid],
  );
  const locked = await db.query(
    `SELECT 'branch' AS kind,id,name,locked_at FROM branches WHERE merchant_id=$1 AND locked_at IS NOT NULL
       UNION ALL SELECT 'program',id,name,locked_at FROM programs WHERE merchant_id=$1 AND locked_at IS NOT NULL
       UNION ALL SELECT 'staff',id,name,locked_at FROM staff_memberships WHERE merchant_id=$1 AND locked_at IS NOT NULL
       ORDER BY locked_at,name`,
    [mid],
  );
  return {
    subscription: {
      plan: s.plan_key,
      status: s.status,
      currency: s.currency,
      billingPeriod: s.billing_period,
      priceMinor: s.price_minor,
      trialEndsAt: s.trial_ends_at,
      currentPeriodStart: s.current_period_start,
      currentPeriodEnd: s.current_period_end,
      cancelAtPeriodEnd: s.cancel_at_period_end,
      pendingPlan: s.pending_key,
      pendingEffectiveAt: s.pending_effective_at,
      pastDueSince: s.past_due_since,
      revision: s.revision,
    },
    entitlements: await getEntitlements(db, mid),
    addons: addons.rows,
    overrides: overrides.rows,
    events: events.rows,
    locked: locked.rows,
  };
}

async function lockSubscription(db: DB, mid: string, revision: number) {
  const s = (
    await db.query('SELECT * FROM merchant_subscriptions WHERE merchant_id=$1 FOR UPDATE', [mid])
  ).rows[0];
  requireCondition(s, 'NOT_FOUND', 404);
  requireCondition(s.revision === revision, 'REVISION_CONFLICT', 409);
  return s;
}
async function event(
  db: DB,
  actor: Actor,
  mid: string,
  type: string,
  before: unknown,
  after: unknown,
  reason: string,
) {
  await db.query(
    'INSERT INTO subscription_events(merchant_id,actor_id,event_type,before,after,reason) VALUES($1,$2,$3,$4,$5,$6)',
    [mid, actor.id, type, JSON.stringify(before), JSON.stringify(after), reason],
  );
}
async function bump(db: DB, mid: string) {
  await db.query(
    'UPDATE merchant_subscriptions SET revision=revision+1,updated_at=clock_timestamp() WHERE merchant_id=$1',
    [mid],
  );
}

export function billingModule(app: FastifyInstance, pools: Pools) {
  /** A platform write on one merchant's subscription: MFA, idempotency, revision fence. */
  function merchantWrite<I, R extends Record<string, unknown>>(
    path: string,
    method: 'POST' | 'PUT',
    input: z.ZodType<I>,
    scope: string,
    fn: (
      db: DB,
      actor: Actor,
      mid: string,
      body: I,
      s: Record<string, unknown>,
      req: FastifyRequest,
    ) => Promise<R>,
  ) {
    app.route({
      method,
      url: '/api/v1/platform/merchants/:m/billing' + path,
      handler: async (req) => {
        const actor = authenticated(req);
        platform(actor);
        const { m } = merchantParams.parse(req.params),
          body = input.parse(req.body),
          key = idempotencyKey(req),
          revision = expectedRevision(req),
          extra = req.params as Record<string, string>;
        return transaction(
          pools.pool,
          (db) =>
            operation(
              db,
              actor,
              {
                scope:
                  scope +
                  ':' +
                  m +
                  (extra.key ? ':' + extra.key : '') +
                  (extra.id ? ':' + extra.id : ''),
                key,
                payload: body,
                merchantId: m,
              },
              async () => {
                const s = await lockSubscription(db, m, revision);
                const result = await fn(db, actor, m, body, s, req);
                return { ...result, billing: await billingState(db, m) };
              },
            ),
          actor,
        );
      },
    });
  }

  app.get('/api/v1/platform/merchants/:m/billing', async (req) => {
    const actor = authenticated(req);
    platform(actor, false);
    const { m } = merchantParams.parse(req.params);
    return transaction(pools.pool, (db) => billingState(db, m), actor);
  });

  merchantWrite('/plan', 'POST', planChangeInput, 'billing.plan', async (db, actor, m, b) => {
    const result = (
      await db.query('SELECT change_merchant_plan($1,$2,$3,$4,$5) AS r', [
        m,
        b.plan,
        b.billingPeriod,
        b.effective,
        b.reason,
      ])
    ).rows[0].r;
    return { result };
  });

  merchantWrite(
    '/addons/:key',
    'PUT',
    addonInput,
    'billing.addon',
    async (db, actor, m, b, s, req) => {
      const { key } = z.object({ key: z.enum(['extra_branch', 'extra_staff']) }).parse(req.params);
      const before = (
        await db.query('SELECT quantity FROM subscription_addons WHERE merchant_id=$1 AND key=$2', [
          m,
          key,
        ])
      ).rows[0];
      if (b.quantity === 0)
        await db.query('DELETE FROM subscription_addons WHERE merchant_id=$1 AND key=$2', [m, key]);
      else {
        const offer = (
          await db.query(
            `SELECT a.unit_amount_minor,a.max_total,e.int_value AS base,e.value_type FROM plan_addons a
           LEFT JOIN plan_entitlements e ON e.plan_id=a.plan_id AND e.key=CASE a.key WHEN 'extra_branch' THEN 'max_branches' ELSE 'max_staff' END
           WHERE a.plan_id=$1 AND a.key=$2 AND a.currency=$3 AND a.is_active`,
            [s.plan_id, key, s.currency],
          )
        ).rows[0];
        requireCondition(offer, 'ADDON_NOT_IN_PLAN', 409);
        requireCondition(
          offer.max_total === null ||
            offer.value_type !== 'int' ||
            offer.base + b.quantity <= offer.max_total,
          'ADDON_CAP_REACHED',
          409,
        );
        await db.query(
          `INSERT INTO subscription_addons(merchant_id,key,quantity,unit_amount_minor) VALUES($1,$2,$3,$4)
         ON CONFLICT(merchant_id,key) DO UPDATE SET quantity=excluded.quantity,updated_at=clock_timestamp()`,
          [m, key, b.quantity, offer.unit_amount_minor],
        );
      }
      await bump(db, m);
      const result = (await db.query('SELECT rebalance_plan_items($1) AS r', [m])).rows[0].r;
      await event(
        db,
        actor,
        m,
        'subscription.addon_changed',
        { key, quantity: before?.quantity ?? 0 },
        { key, quantity: b.quantity, ...result },
        b.reason,
      );
      return { result };
    },
  );

  merchantWrite(
    '/overrides',
    'POST',
    overrideInput,
    'billing.override',
    async (db, actor, m, b) => {
      const v = columns(b.value);
      await db.query(
        'UPDATE entitlement_overrides SET revoked_at=clock_timestamp(),revoked_by=$3 WHERE merchant_id=$1 AND key=$2 AND revoked_at IS NULL',
        [m, b.value.key, actor.id],
      );
      const id = (
        await db.query(
          'INSERT INTO entitlement_overrides(merchant_id,key,value_type,int_value,bool_value,enum_value,reason,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          [m, b.value.key, v.type, v.int, v.bool, v.enumValue, b.reason, b.expiresAt, actor.id],
        )
      ).rows[0].id;
      await bump(db, m);
      const result = (await db.query('SELECT rebalance_plan_items($1) AS r', [m])).rows[0].r;
      await event(
        db,
        actor,
        m,
        'subscription.override_set',
        null,
        { ...b.value, expiresAt: b.expiresAt, ...result },
        b.reason,
      );
      return { id, result };
    },
  );

  merchantWrite(
    '/overrides/:id/revoke',
    'POST',
    reasonInput,
    'billing.override_revoke',
    async (db, actor, m, b, s, req) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const row = (
        await db.query(
          'UPDATE entitlement_overrides SET revoked_at=clock_timestamp(),revoked_by=$3 WHERE merchant_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING key',
          [m, id, actor.id],
        )
      ).rows[0];
      requireCondition(row, 'NOT_FOUND', 404);
      await bump(db, m);
      const result = (await db.query('SELECT rebalance_plan_items($1) AS r', [m])).rows[0].r;
      await event(
        db,
        actor,
        m,
        'subscription.override_revoked',
        { id, key: row.key },
        result,
        b.reason,
      );
      return { result };
    },
  );

  merchantWrite('/trial', 'POST', trialInput, 'billing.trial', async (db, actor, m, b, s) => {
    const result = (
      await db.query("SELECT change_merchant_plan($1,$2,'monthly','now',$3) AS r", [
        m,
        b.plan,
        b.reason,
      ])
    ).rows[0].r;
    await db.query(
      `UPDATE merchant_subscriptions SET status='trialing',trial_ends_at=clock_timestamp()+make_interval(days=>$2),
        past_due_since=NULL,cancel_at_period_end=false,revision=revision+1,updated_at=clock_timestamp() WHERE merchant_id=$1`,
      [m, b.days],
    );
    await event(
      db,
      actor,
      m,
      'subscription.trial_started',
      { status: s.status },
      { status: 'trialing', plan: b.plan, days: b.days },
      b.reason,
    );
    return { result };
  });

  merchantWrite('/cancel', 'POST', cancelInput, 'billing.cancel', async (db, actor, m, b, s) => {
    if (b.atPeriodEnd) {
      requireCondition(s.current_period_end, 'NO_BILLING_PERIOD', 409);
      await db.query(
        'UPDATE merchant_subscriptions SET cancel_at_period_end=true WHERE merchant_id=$1',
        [m],
      );
    } else
      await db.query(
        "UPDATE merchant_subscriptions SET status='cancelled',cancel_at_period_end=false WHERE merchant_id=$1",
        [m],
      );
    await bump(db, m);
    await event(
      db,
      actor,
      m,
      'subscription.cancelled',
      { status: s.status },
      { atPeriodEnd: b.atPeriodEnd },
      b.reason,
    );
    return {};
  });

  merchantWrite(
    '/reactivate',
    'POST',
    reasonInput,
    'billing.reactivate',
    async (db, actor, m, b, s) => {
      await db.query(
        `UPDATE merchant_subscriptions SET cancel_at_period_end=false,
        status=CASE WHEN status='cancelled' THEN 'active' ELSE status END WHERE merchant_id=$1`,
        [m],
      );
      await bump(db, m);
      await event(
        db,
        actor,
        m,
        'subscription.reactivated',
        { status: s.status, cancelAtPeriodEnd: s.cancel_at_period_end },
        { cancelAtPeriodEnd: false },
        b.reason,
      );
      return {};
    },
  );

  // Enterprise and other custom deals: the agreed monthly price for this merchant only.
  merchantWrite('/price', 'POST', agreedPriceInput, 'billing.price', async (db, actor, m, b, s) => {
    await db.query('UPDATE merchant_subscriptions SET price_minor=$2 WHERE merchant_id=$1', [
      m,
      b.priceMinor,
    ]);
    await bump(db, m);
    await event(
      db,
      actor,
      m,
      'subscription.price_set',
      { priceMinor: s.price_minor },
      { priceMinor: b.priceMinor },
      b.reason,
    );
    return {};
  });

  /* ---------------------------------------------------------------- catalog */

  app.get('/api/v1/platform/plans', async (req) => {
    const actor = authenticated(req);
    platform(actor, false);
    return transaction(
      pools.pool,
      async (db) => ({
        plans: (
          await db.query(
            `SELECT p.key,p.name_ar,p.name_en,p.sort_order,p.is_public,p.is_active,p.is_custom,p.revision,
              (SELECT count(*)::int FROM merchant_subscriptions s WHERE s.plan_id=p.id) AS merchants,
              (SELECT coalesce(jsonb_agg(jsonb_build_object('currency',x.currency,'billingPeriod',x.billing_period,'amountMinor',x.amount_minor,'setupFeePerBranchMinor',x.setup_fee_per_branch_minor) ORDER BY x.currency,x.billing_period),'[]')
                FROM plan_prices x WHERE x.plan_id=p.id AND x.is_active) AS prices,
              (SELECT coalesce(jsonb_agg(jsonb_build_object('key',e.key,'type',e.value_type,'value',coalesce(to_jsonb(e.int_value),to_jsonb(e.bool_value),to_jsonb(e.enum_value))) ORDER BY e.key),'[]')
                FROM plan_entitlements e WHERE e.plan_id=p.id) AS entitlements,
              (SELECT coalesce(jsonb_agg(jsonb_build_object('key',a.key,'currency',a.currency,'unitAmountMinor',a.unit_amount_minor,'maxTotal',a.max_total,'isActive',a.is_active) ORDER BY a.key),'[]')
                FROM plan_addons a WHERE a.plan_id=p.id) AS addons
             FROM plans p ORDER BY p.sort_order`,
          )
        ).rows,
      }),
      actor,
    );
  });

  app.put('/api/v1/platform/plans/:key', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { key: planKey } = planParams.parse(req.params),
      b = planUpdateInput.parse(req.body),
      key = idempotencyKey(req),
      revision = expectedRevision(req);
    return transaction(
      pools.pool,
      (db) =>
        operation(db, actor, { scope: 'plan.update:' + planKey, key, payload: b }, async () => {
          const plan = (await db.query('SELECT * FROM plans WHERE key=$1 FOR UPDATE', [planKey]))
            .rows[0];
          requireCondition(plan, 'NOT_FOUND', 404);
          requireCondition(plan.revision === revision, 'REVISION_CONFLICT', 409);
          // Hidden plans keep working for the merchants on them; only new sign-ups stop seeing them.
          await db.query(
            'UPDATE plans SET name_ar=$2,name_en=$3,is_public=$4,is_active=$5,revision=revision+1 WHERE id=$1',
            [plan.id, b.nameAr, b.nameEn, b.isPublic, b.isActive],
          );
          const changedPrices: { currency: string; billingPeriod: string; amountMinor: number }[] =
            [];
          for (const p of b.prices) {
            const current = (
              await db.query(
                'SELECT amount_minor,setup_fee_per_branch_minor FROM plan_prices WHERE plan_id=$1 AND currency=$2 AND billing_period=$3 AND is_active',
                [plan.id, p.currency, p.billingPeriod],
              )
            ).rows[0];
            if (
              current &&
              current.amount_minor === p.amountMinor &&
              current.setup_fee_per_branch_minor === p.setupFeePerBranchMinor
            )
              continue;
            // Price history is kept: the old row is retired, a new one starts.
            await db.query(
              'UPDATE plan_prices SET is_active=false WHERE plan_id=$1 AND currency=$2 AND billing_period=$3 AND is_active',
              [plan.id, p.currency, p.billingPeriod],
            );
            await db.query(
              'INSERT INTO plan_prices(plan_id,currency,billing_period,amount_minor,setup_fee_per_branch_minor) VALUES($1,$2,$3,$4,$5)',
              [plan.id, p.currency, p.billingPeriod, p.amountMinor, p.setupFeePerBranchMinor],
            );
            changedPrices.push(p);
          }
          for (const e of b.entitlements) {
            const v = columns(e);
            await db.query(
              `INSERT INTO plan_entitlements(plan_id,key,value_type,int_value,bool_value,enum_value) VALUES($1,$2,$3,$4,$5,$6)
               ON CONFLICT(plan_id,key) DO UPDATE SET value_type=excluded.value_type,int_value=excluded.int_value,bool_value=excluded.bool_value,enum_value=excluded.enum_value`,
              [plan.id, e.key, v.type, v.int, v.bool, v.enumValue],
            );
          }
          for (const a of b.addons)
            await db.query(
              `INSERT INTO plan_addons(plan_id,key,currency,unit_amount_minor,max_total,is_active) VALUES($1,$2,$3,$4,$5,$6)
               ON CONFLICT(plan_id,key,currency) DO UPDATE SET unit_amount_minor=excluded.unit_amount_minor,max_total=excluded.max_total,is_active=excluded.is_active`,
              [plan.id, a.key, a.currency, a.unitAmountMinor, a.maxTotal, a.isActive],
            );
          const affected = (
            await db.query(
              'SELECT merchant_id FROM merchant_subscriptions WHERE plan_id=$1 ORDER BY merchant_id',
              [plan.id],
            )
          ).rows.map((r) => r.merchant_id as string);
          let repriced = 0;
          for (const mid of affected) {
            const s = (
              await db.query(
                'SELECT * FROM merchant_subscriptions WHERE merchant_id=$1 FOR UPDATE',
                [mid],
              )
            ).rows[0];
            if (b.applyPriceToExisting) {
              const price = changedPrices.find(
                (p) => p.currency === s.currency && p.billingPeriod === s.billing_period,
              );
              if (price && price.amountMinor !== s.price_minor) {
                await db.query(
                  'UPDATE merchant_subscriptions SET price_minor=$2 WHERE merchant_id=$1',
                  [mid, price.amountMinor],
                );
                await event(
                  db,
                  actor,
                  mid,
                  'subscription.price_set',
                  { priceMinor: s.price_minor },
                  { priceMinor: price.amountMinor, fromCatalog: true },
                  b.reason,
                );
                repriced++;
              }
            }
            // A limit change takes effect for everyone on the plan, locking or unlocking within it.
            const result = (await db.query('SELECT rebalance_plan_items($1) AS r', [mid])).rows[0]
              .r;
            await bump(db, mid);
            if (result.locked.length || result.unlocked.length)
              await event(
                db,
                actor,
                mid,
                'plan.catalog_changed',
                null,
                { plan: planKey, ...result },
                b.reason,
              );
          }
          return { plan: planKey, affectedMerchants: affected.length, repriced };
        }),
      actor,
    );
  });

  /** How many merchants a catalog change would touch, before saving. */
  app.get('/api/v1/platform/plans/:key/impact', async (req) => {
    const actor = authenticated(req);
    platform(actor, false);
    const { key } = planParams.parse(req.params);
    return transaction(
      pools.pool,
      async (db) =>
        (
          await db.query(
            `SELECT count(*)::int AS merchants,count(*) FILTER (WHERE s.status IN ('active','trialing'))::int AS paying_or_trial
             FROM merchant_subscriptions s JOIN plans p ON p.id=s.plan_id WHERE p.key=$1`,
            [key],
          )
        ).rows[0],
      actor,
    );
  });

  /* ---------------------------------------------------------------- overview */

  app.get('/api/v1/platform/billing/overview', async (req) => {
    const actor = authenticated(req);
    platform(actor, false);
    return transaction(
      pools.pool,
      async (db) => {
        // One connection inside a transaction: run the reads one after another.
        const q = (sql: string) => db.query(sql);
        const byStatus = await q(
          `SELECT CASE WHEN m.status='suspended' THEN 'suspended' ELSE s.status END AS status,count(*)::int AS merchants
             FROM merchant_subscriptions s JOIN merchants m ON m.id=s.merchant_id GROUP BY 1 ORDER BY 1`,
        );
        // Monthly recurring revenue at each merchant's locked price; annual counts as a twelfth.
        const mrr = await q(
          `SELECT p.key AS plan,s.currency,count(*)::int AS merchants,
              sum(CASE s.billing_period WHEN 'annual' THEN s.price_minor/12.0 ELSE s.price_minor END
                + coalesce((SELECT sum(a.quantity*a.unit_amount_minor) FROM subscription_addons a WHERE a.merchant_id=s.merchant_id),0))::bigint AS mrr_minor
             FROM merchant_subscriptions s JOIN plans p ON p.id=s.plan_id JOIN merchants m ON m.id=s.merchant_id
             WHERE s.status IN ('active','past_due','grace') AND m.status<>'suspended'
             GROUP BY p.key,p.sort_order,s.currency ORDER BY p.sort_order`,
        );
        const renewals = await q(
          `SELECT m.id,m.name,p.key AS plan,s.current_period_end,s.price_minor,s.currency,s.billing_period
             FROM merchant_subscriptions s JOIN merchants m ON m.id=s.merchant_id JOIN plans p ON p.id=s.plan_id
             WHERE s.status='active' AND NOT s.cancel_at_period_end AND s.current_period_end BETWEEN clock_timestamp() AND clock_timestamp()+interval '7 days'
             ORDER BY s.current_period_end LIMIT 200`,
        );
        const pastDue = await q(
          `SELECT m.id,m.name,p.key AS plan,s.status,s.past_due_since,s.price_minor,s.currency
             FROM merchant_subscriptions s JOIN merchants m ON m.id=s.merchant_id JOIN plans p ON p.id=s.plan_id
             WHERE s.status IN ('past_due','grace') ORDER BY s.past_due_since NULLS LAST LIMIT 200`,
        );
        return {
          byStatus: byStatus.rows,
          mrr: mrr.rows.map((r) => ({ ...r, mrr_minor: Number(r.mrr_minor) })),
          renewalsDue: renewals.rows,
          pastDue: pastDue.rows,
        };
      },
      actor,
    );
  });
}
