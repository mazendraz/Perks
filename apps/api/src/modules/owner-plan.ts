import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticated } from '../auth.js';
import { transaction, audit, type Pools, type DB } from '../db.js';
import { merchantGrant } from '../policy.js';
import { idempotencyKey, operation } from '../operations.js';
import { requireCondition } from '../errors.js';
import { getEntitlements } from '../entitlements.js';
import type { ServiceConfig } from '../config.js';
import {
  keepInput,
  planRequestInput,
  walletMessageInput,
  walletPreviewQuery,
} from '../../../../packages/contracts/src/owner-plan.js';

const params = z.object({ m: z.uuid() });

/** The owner's view of their plan. Managers and cashiers never see plans or prices. */
async function planState(db: DB, mid: string) {
  const entitlements = await getEntitlements(db, mid);
  const s = (
    await db.query(
      `SELECT s.status,s.currency,s.billing_period,s.price_minor,s.trial_ends_at,s.current_period_start,s.current_period_end,
        s.cancel_at_period_end,s.past_due_since,s.pending_effective_at,pp.key AS pending_key
       FROM merchant_subscriptions s LEFT JOIN plans pp ON pp.id=s.pending_plan_id WHERE s.merchant_id=$1`,
      [mid],
    )
  ).rows[0];
  const catalog = (
    await db.query(
      `SELECT p.key,p.name_ar,p.name_en,p.sort_order,p.is_custom,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('billingPeriod',x.billing_period,'amountMinor',x.amount_minor) ORDER BY x.billing_period),'[]')
          FROM plan_prices x WHERE x.plan_id=p.id AND x.is_active AND x.currency=$1) AS prices,
        (SELECT coalesce(jsonb_object_agg(e.key,CASE e.value_type WHEN 'unlimited' THEN 'null'::jsonb WHEN 'int' THEN to_jsonb(e.int_value)
            WHEN 'bool' THEN to_jsonb(e.bool_value) ELSE to_jsonb(e.enum_value) END),'{}')
          FROM plan_entitlements e WHERE e.plan_id=p.id) AS entitlements,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('key',a.key,'unitAmountMinor',a.unit_amount_minor,'maxTotal',a.max_total) ORDER BY a.key),'[]')
          FROM plan_addons a WHERE a.plan_id=p.id AND a.is_active AND a.currency=$1) AS addons
       FROM plans p ORDER BY p.sort_order`,
      [s.currency],
    )
  ).rows;
  const addons = (
    await db.query(
      'SELECT key,quantity,unit_amount_minor FROM subscription_addons WHERE merchant_id=$1 ORDER BY key',
      [mid],
    )
  ).rows;
  const items = (
    await db.query(
      `SELECT 'branch' AS kind,b.id,b.name,b.status,b.locked_at,b.created_at FROM branches b
        WHERE b.merchant_id=$1 AND (b.status='active' OR b.locked_at IS NOT NULL)
       UNION ALL SELECT 'program',p.id,p.name,p.status,p.locked_at,p.created_at FROM programs p
        WHERE p.merchant_id=$1 AND (p.status='active' OR p.locked_at IS NOT NULL)
       UNION ALL SELECT 'staff',s.id,s.name,s.status,s.locked_at,s.created_at FROM staff_memberships s
        WHERE s.merchant_id=$1 AND s.role<>'owner' AND (s.status='active' OR s.locked_at IS NOT NULL)
       ORDER BY 1,6,3`,
      [mid],
    )
  ).rows;
  const keep = (
    await db.query('SELECT kind,item_id FROM plan_keep_choices WHERE merchant_id=$1', [mid])
  ).rows;
  const request = (
    await db.query(
      `SELECT id,kind,plan_key,billing_period,addon_key,quantity,note,status,created_at,closed_at,close_reason
       FROM plan_requests WHERE merchant_id=$1 AND (status='open' OR closed_at>clock_timestamp()-interval '14 days')
       ORDER BY created_at DESC LIMIT 1`,
      [mid],
    )
  ).rows[0];
  // Limits of the plan a scheduled downgrade lands on, so the owner can choose what stays.
  const keepLimits = (
    await db.query(
      `SELECT k.kind,keep_limit($1,k.key) AS lim FROM (VALUES('branch','max_branches'),('program','max_active_programs'),('staff','max_staff')) k(kind,key)`,
      [mid],
    )
  ).rows;
  return {
    entitlements,
    subscription: {
      status: s.status,
      currency: s.currency,
      billingPeriod: s.billing_period,
      priceMinor: s.price_minor,
      trialEndsAt: s.trial_ends_at,
      currentPeriodStart: s.current_period_start,
      currentPeriodEnd: s.current_period_end,
      cancelAtPeriodEnd: s.cancel_at_period_end,
      pastDueSince: s.past_due_since,
      pendingPlan: s.pending_key,
      pendingEffectiveAt: s.pending_effective_at,
    },
    catalog,
    addons,
    items: items.map((i) => ({
      kind: i.kind,
      id: i.id,
      name: i.name,
      locked: i.locked_at !== null,
      kept: keep.some((k) => k.kind === i.kind && k.item_id === i.id),
    })),
    keepLimits: Object.fromEntries(keepLimits.map((k) => [k.kind, k.lim])),
    request: request ?? null,
  };
}

export function ownerPlanModule(app: FastifyInstance, pools: Pools, c: ServiceConfig) {
  const providers = () => ({
    apple: c.APPLE_WALLET_ENABLED === 'true',
    google: c.GOOGLE_WALLET_ENABLED === 'true',
  });

  app.get('/api/v1/merchants/:m/plan', async (req) => {
    const actor = authenticated(req),
      { m } = params.parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner']);
        return planState(db, m);
      },
      actor,
    );
  });

  app.post('/api/v1/merchants/:m/plan/requests', async (req) => {
    const actor = authenticated(req),
      { m } = params.parse(req.params),
      body = planRequestInput.parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner'], undefined, true);
        return operation(
          db,
          actor,
          { scope: 'plan.request:' + m, key, payload: body, merchantId: m },
          async () => {
            const s = (
              await db.query(
                'SELECT s.status,s.plan_id,s.currency FROM merchant_subscriptions s WHERE s.merchant_id=$1',
                [m],
              )
            ).rows[0];
            requireCondition(s, 'ENTITLEMENTS_NOT_CONFIGURED', 409);
            if (body.kind === 'change_plan') {
              // Only plans the owner can see on the pricing page (or Enterprise, which is a talk).
              const plan = (
                await db.query('SELECT id FROM plans WHERE key=$1 AND is_public AND is_active', [
                  body.plan,
                ])
              ).rows[0];
              requireCondition(plan, 'NOT_FOUND', 404);
            } else {
              const offer = (
                await db.query(
                  'SELECT 1 FROM plan_addons WHERE plan_id=$1 AND key=$2 AND currency=$3 AND is_active',
                  [s.plan_id, body.addonKey, s.currency],
                )
              ).rowCount;
              requireCondition(offer, 'ADDON_NOT_IN_PLAN', 409);
            }
            const open = (
              await db.query(
                "SELECT 1 FROM plan_requests WHERE merchant_id=$1 AND status='open' FOR UPDATE",
                [m],
              )
            ).rowCount;
            requireCondition(!open, 'PLAN_REQUEST_OPEN', 409);
            const row = (
              await db.query(
                `INSERT INTO plan_requests(merchant_id,kind,plan_key,billing_period,addon_key,quantity,note,requested_by)
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
                [
                  m,
                  body.kind,
                  body.kind === 'change_plan' ? body.plan : null,
                  body.kind === 'change_plan' ? body.billingPeriod : null,
                  body.kind === 'addon' ? body.addonKey : null,
                  body.kind === 'addon' ? body.quantity : null,
                  body.note || null,
                  actor.id,
                ],
              )
            ).rows[0];
            await audit(db, actor, 'plan.request', m, row.id, { kind: body.kind });
            return { id: row.id, plan: await planState(db, m) };
          },
        );
      },
      actor,
    );
  });

  app.post('/api/v1/merchants/:m/plan/requests/:id/withdraw', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner']);
        return operation(
          db,
          actor,
          { scope: 'plan.request.withdraw:' + id, key, payload: {}, merchantId: m },
          async () => {
            const r = await db.query(
              "UPDATE plan_requests SET status='withdrawn',closed_by=$3,closed_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 AND status='open'",
              [m, id, actor.id],
            );
            requireCondition(r.rowCount, 'NOT_FOUND', 404);
            return { plan: await planState(db, m) };
          },
        );
      },
      actor,
    );
  });

  app.put('/api/v1/merchants/:m/plan/keep', async (req) => {
    const actor = authenticated(req),
      { m } = params.parse(req.params),
      body = keepInput.parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner'], undefined, true);
        return operation(
          db,
          actor,
          { scope: 'plan.keep:' + m + ':' + body.kind, key, payload: body, merchantId: m },
          async () => {
            const result = (
              await db.query('SELECT owner_keep_items($1,$2,$3) AS r', [m, body.kind, body.ids])
            ).rows[0].r;
            await audit(db, actor, 'plan.keep', m, m, { kind: body.kind, count: body.ids.length });
            return { result, plan: await planState(db, m) };
          },
        );
      },
      actor,
    );
  });

  /* ------------------------------------------------------------ Wallet messages */

  app.get('/api/v1/merchants/:m/wallet-messages', async (req) => {
    const actor = authenticated(req),
      { m } = params.parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner']);
        const e = await getEntitlements(db, m);
        const history = (
          await db.query(
            `SELECT wm.id,wm.audience,wm.inactive_days,wm.body_ar,wm.body_en,wm.recipients,wm.send_after,wm.created_at,
              -- Per customer. Apple counts once the phone downloaded the pass with the message;
              -- APNs taking the push only means "on its way". Google shows it once accepted.
              count(DISTINCT d.profile_id) FILTER(WHERE (d.channel='apple' AND d.fetched_at IS NOT NULL)
                OR (d.channel='google' AND d.status='accepted'))::int AS delivered,
              count(DISTINCT d.profile_id) FILTER(WHERE d.channel='apple' AND d.status='accepted'
                AND d.fetched_at IS NULL AND NOT EXISTS(SELECT 1 FROM wallet_message_deliveries x
                 WHERE x.message_id=wm.id AND x.profile_id=d.profile_id
                 AND ((x.channel='apple' AND x.fetched_at IS NOT NULL) OR (x.channel='google' AND x.status='accepted'))))::int AS unconfirmed,
              count(d.id) FILTER(WHERE d.status IN ('queued','processing','uncertain'))::int AS waiting,
              count(d.id) FILTER(WHERE d.status IN ('failed','skipped'))::int AS missed,
              wallet_message_returns(wm.id) AS returned
             FROM wallet_messages wm LEFT JOIN wallet_message_deliveries d ON d.message_id=wm.id
             WHERE wm.merchant_id=$1 GROUP BY wm.id ORDER BY wm.created_at DESC LIMIT 20`,
            [m],
          )
        ).rows;
        const merchant = (await db.query('SELECT name,timezone FROM merchants WHERE id=$1', [m]))
          .rows[0];
        return {
          used: e.usage.manual_messages_per_month ?? 0,
          limit: e.limits.manual_messages_per_month ?? null,
          period: e.usagePeriod,
          status: e.status,
          providers: providers(),
          merchantName: merchant.name,
          history,
        };
      },
      actor,
    );
  });

  app.get('/api/v1/merchants/:m/wallet-messages/preview', async (req) => {
    const actor = authenticated(req),
      { m } = params.parse(req.params),
      q = walletPreviewQuery.parse(req.query),
      p = providers();
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner']);
        return (
          await db.query('SELECT wallet_message_preview($1,$2,$3,$4,$5) AS r', [
            m,
            q.audience,
            q.inactiveDays ?? null,
            p.apple,
            p.google,
          ])
        ).rows[0].r;
      },
      actor,
    );
  });

  app.post('/api/v1/merchants/:m/wallet-messages', async (req) => {
    const actor = authenticated(req),
      { m } = params.parse(req.params),
      body = walletMessageInput.parse(req.body),
      key = idempotencyKey(req),
      p = providers();
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner'], undefined, true);
        return operation(
          db,
          actor,
          { scope: 'wallet.message:' + m, key, payload: body, merchantId: m },
          async () => {
            const r = (
              await db.query('SELECT create_wallet_message($1,$2,$3,$4,$5,$6,$7) AS r', [
                m,
                body.audience,
                body.inactiveDays ?? null,
                body.bodyAr,
                body.bodyEn ?? null,
                p.apple,
                p.google,
              ])
            ).rows[0].r;
            await audit(db, actor, 'wallet.message.send', m, r.id, {
              audience: body.audience,
              recipients: r.recipients,
            });
            return r;
          },
        );
      },
      actor,
    );
  });
}
