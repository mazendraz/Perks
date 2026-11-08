import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticated } from '../auth.js';
import { transaction, type Pools } from '../db.js';
import { merchantGrant, platform } from '../policy.js';
import { requireCondition } from '../errors.js';
export function reportingModule(app: FastifyInstance, pools: Pools) {
  app.get('/api/v1/merchants/:m/overview', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      q = z
        .object({
          days: z.coerce
            .number()
            .int()
            .refine((n) => [7, 30, 90].includes(n))
            .default(30),
          branchId: z.uuid().optional(),
        })
        .parse(req.query);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner', 'manager']);
        if (q.branchId) await merchantGrant(db, actor, m, ['owner', 'manager'], q.branchId);
        const meta = (
          await db.query(
            'SELECT timezone,owner_full_customer_scope(id) AS full_scope FROM merchants WHERE id=$1',
            [m],
          )
        ).rows[0];
        const transactions = (
          await db.query(
            "SELECT coalesce(sum(quantity) FILTER(WHERE type='award'),0)::int AS stamps,count(DISTINCT purchase_id) FILTER(WHERE type='award')::int AS visits,count(*) FILTER(WHERE type='redeem')::int AS rewards_redeemed,coalesce(sum(quantity) FILTER(WHERE type='correction'),0)::int AS corrections,max(at) AS watermark FROM loyalty_transactions WHERE merchant_id=$1 AND branch_access(merchant_id,branch_id) AND ($2::uuid IS NULL OR branch_id=$2) AND at>=clock_timestamp()-$3*interval '1 day'",
            [m, q.branchId || null, q.days],
          )
        ).rows[0];
        const customers = (
          await db.query(
            "WITH scoped AS (SELECT cp.id,cp.created_at,(SELECT max(t.at) FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id WHERE ms.profile_id=cp.id AND t.type='award' AND branch_access(t.merchant_id,t.branch_id) AND ($2::uuid IS NULL OR t.branch_id=$2)) AS last_purchase FROM tenant_customer_profiles cp WHERE cp.merchant_id=$1 AND ($3::boolean OR EXISTS(SELECT 1 FROM memberships ms WHERE ms.profile_id=cp.id AND ((branch_access(ms.merchant_id,ms.origin_branch_id) AND ($2::uuid IS NULL OR ms.origin_branch_id=$2)) OR EXISTS(SELECT 1 FROM loyalty_transactions t WHERE t.membership_id=ms.id AND branch_access(t.merchant_id,t.branch_id) AND ($2::uuid IS NULL OR t.branch_id=$2)))))) SELECT count(*)::int AS registered,count(*) FILTER(WHERE last_purchase>=clock_timestamp()-interval '30 days')::int AS active,count(*) FILTER(WHERE last_purchase<clock_timestamp()-interval '30 days')::int AS inactive,count(*) FILTER(WHERE last_purchase IS NULL)::int AS never_active,count(*) FILTER(WHERE created_at>=clock_timestamp()-$4*interval '1 day')::int AS new_signups,max(created_at) AS watermark FROM scoped",
            [m, q.branchId || null, meta.full_scope && !q.branchId, q.days],
          )
        ).rows[0];
        const open = (
          await db.query(
            "SELECT count(*)::int AS n FROM reward_grants r WHERE merchant_id=$1 AND status='available' AND expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM unnest(r.branch_ids) b WHERE branch_access(r.merchant_id,b) AND ($2::uuid IS NULL OR b=$2))",
            [m, q.branchId || null],
          )
        ).rows[0].n;
        const branches = (
          await db.query(
            "SELECT b.id,b.name,count(DISTINCT t.purchase_id) FILTER(WHERE t.type='award')::int AS visits,coalesce(sum(t.quantity) FILTER(WHERE t.type='award'),0)::int AS stamps,count(t.id) FILTER(WHERE t.type='redeem')::int AS redeemed FROM branches b LEFT JOIN loyalty_transactions t ON t.branch_id=b.id AND t.at>=clock_timestamp()-$3*interval '1 day' WHERE b.merchant_id=$1 AND ($2::uuid IS NULL OR b.id=$2) GROUP BY b.id,b.name ORDER BY b.name",
            [m, q.branchId || null, q.days],
          )
        ).rows;
        const returning = (
          await db.query(
            "WITH visits AS (SELECT ms.profile_id,t.at FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id WHERE t.merchant_id=$1 AND t.type='award' AND branch_access(t.merchant_id,t.branch_id) AND ($2::uuid IS NULL OR t.branch_id=$2)),buyers AS (SELECT DISTINCT profile_id FROM visits WHERE at>=now()-$3*interval '1 day') SELECT count(*)::int AS buyers,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM visits v WHERE v.profile_id=buyers.profile_id AND v.at<now()-$3*interval '1 day'))::int AS returning FROM buyers",
            [m, q.branchId || null, q.days],
          )
        ).rows[0];
        const trend = (
          await db.query(
            "SELECT (t.at AT TIME ZONE $4)::date::text AS day,count(DISTINCT t.purchase_id)::int AS visits,count(DISTINCT ms.profile_id)::int AS buyers FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id WHERE t.merchant_id=$1 AND t.type='award' AND branch_access(t.merchant_id,t.branch_id) AND ($2::uuid IS NULL OR t.branch_id=$2) AND t.at>=now()-$3*interval '1 day' GROUP BY day ORDER BY day",
            [m, q.branchId || null, q.days, meta.timezone],
          )
        ).rows;
        const clock = (await db.query('SELECT clock_timestamp() AS at')).rows[0].at;
        return {
          metrics: {
            registered: customers.registered,
            active: customers.active,
            inactive: customers.inactive,
            neverActive: customers.never_active,
            newSignups: customers.new_signups,
            stamps: transactions.stamps,
            visits: transactions.visits,
            rewardsOpen: open,
            rewardsRedeemed: transactions.rewards_redeemed,
            corrections: transactions.corrections,
            purchasingCustomers: returning.buyers,
            returningCustomers: returning.returning,
            returnRate: returning.buyers
              ? Math.round((1000 * returning.returning) / returning.buyers) / 10
              : 0,
          },
          trend,
          branches,
          period: {
            days: q.days,
            from: new Date(clock.getTime() - q.days * 864e5).toISOString(),
            to: clock,
            timezone: meta.timezone,
          },
          updatedAt: clock,
          watermark: transactions.watermark || customers.watermark || null,
          customerScope:
            meta.full_scope && !q.branchId ? 'merchant' : 'attributed_to_authorized_branches',
          definitions: {
            visits: 'One distinct confirmed purchase; card opens and scans do not count.',
            stamps: 'Gross awarded stamp units; corrections are separate.',
            active: 'Distinct customers with a confirmed purchase in the last 30 days.',
            returnRate:
              'Customers who purchased in this window and before its start, divided by all purchasing customers in this window, in the selected authorized branch scope. Observational; not campaign attribution.',
            neverActive: 'Registered customers with no confirmed purchase in the selected scope.',
          },
        };
      },
      actor,
    );
  });
  app.get('/api/v1/platform/operations/:reference', async (req) => {
    const actor = authenticated(req);
    platform(actor, false);
    const { reference } = z.object({ reference: z.string().min(1).max(160) }).parse(req.params),
      uuid = z.uuid().safeParse(reference);
    return transaction(
      pools.pool,
      async (db) => {
        const found = (
          await db.query(
            'SELECT t.*,p.reference AS receipt,cp.alias,b.name AS branch_name,m.name AS merchant_name FROM loyalty_transactions t LEFT JOIN purchase_references p ON p.id=t.purchase_id JOIN memberships ms ON ms.id=t.membership_id JOIN tenant_customer_profiles cp ON cp.id=ms.profile_id JOIN branches b ON b.id=t.branch_id JOIN merchants m ON m.id=t.merchant_id WHERE t.public_reference=$1 OR p.normalized_reference=upper(trim($1)) OR ($2::uuid IS NOT NULL AND (t.id=$2 OR t.operation_id=$2)) ORDER BY t.sequence DESC LIMIT 20',
            [reference, uuid.success ? uuid.data : null],
          )
        ).rows;
        requireCondition(found.length, 'NOT_FOUND', 404);
        if (found.length > 1)
          return {
            matches: found.map((t) => ({
              id: t.id,
              reference: t.public_reference,
              merchantName: t.merchant_name,
              branchName: t.branch_name,
              at: t.at,
            })),
          };
        const tx = found[0];
        return {
          transaction: tx,
          ledger: (
            await db.query(
              'SELECT id,sequence,type,amount,reward_id,compensates_entry_id,at FROM ledger_entries WHERE transaction_id=$1 ORDER BY sequence',
              [tx.id],
            )
          ).rows,
          audit: (
            await db.query(
              "SELECT id,action,detail,at FROM audit_events WHERE target_id=$1 OR detail->>'transactionId'=$1::text OR detail->>'compensatingTransactionId'=$1::text ORDER BY at",
              [tx.id],
            )
          ).rows,
          jobs: (
            await db.query(
              "SELECT j.id,j.kind,j.status,j.attempts,j.last_error,e.event_type,e.aggregate_revision FROM outbox_events e JOIN background_jobs j ON j.outbox_id=e.id WHERE e.payload->>'transactionId'=$1::text ORDER BY j.created_at",
              [tx.id],
            )
          ).rows,
        };
      },
      actor,
    );
  });
}
