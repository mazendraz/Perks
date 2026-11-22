import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticated } from '../auth.js';
import { transaction, type Pools } from '../db.js';
import { merchantGrant, platform } from '../policy.js';
import { requireCondition } from '../errors.js';
export function reportingModule(app: FastifyInstance, pools: Pools) {
  // Today at a glance: what is waiting now, what happened since midnight (shop time),
  // and the caller's own share, which doubles as the cashier's shift summary.
  app.get('/api/v1/merchants/:m/today', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const grant = await merchantGrant(db, actor, m);
        const row = (
          await db.query(
            `WITH day AS (SELECT (date_trunc('day',clock_timestamp() AT TIME ZONE timezone)) AT TIME ZONE timezone AS start
                            FROM merchants WHERE id=$1),
             tx AS (SELECT t.* FROM loyalty_transactions t, day
                    WHERE t.merchant_id=$1 AND branch_access(t.merchant_id,t.branch_id) AND t.at>=day.start)
             SELECT
               (SELECT count(*) FROM stamp_requests r WHERE r.merchant_id=$1 AND r.status='pending'
                  AND r.expires_at>clock_timestamp() AND r.failed_matches<5
                  AND branch_access(r.merchant_id,r.branch_id))::int AS pending_requests,
               (SELECT count(*) FROM reward_grants g WHERE g.merchant_id=$1 AND g.status='available'
                  AND g.expires_at>clock_timestamp()
                  AND EXISTS(SELECT 1 FROM unnest(g.branch_ids) b WHERE branch_access(g.merchant_id,b)))::int AS rewards_ready,
               (SELECT count(*) FROM merchants m,visits_since(m.id,(clock_timestamp() AT TIME ZONE m.timezone)::date) v WHERE m.id=$1 AND branch_access(v.merchant_id,v.branch_id))::int AS visits,
               (SELECT coalesce(sum(quantity),0) FROM tx WHERE type='award' AND source<>'welcome')::int AS stamps,
               (SELECT count(*) FROM tx WHERE type='redeem')::int AS redeemed,
               (SELECT count(*) FROM merchants m,visits_since(m.id,(clock_timestamp() AT TIME ZONE m.timezone)::date) v WHERE m.id=$1 AND $2=ANY(v.staff_ids) AND branch_access(v.merchant_id,v.branch_id))::int AS my_visits,
               (SELECT coalesce(sum(quantity),0) FROM tx WHERE type='award' AND source<>'welcome' AND staff_id=$2)::int AS my_stamps,
               (SELECT count(*) FROM tx WHERE type='redeem' AND staff_id=$2)::int AS my_redeemed,
               (SELECT min(at) FROM tx WHERE staff_id=$2) AS my_first_at`,
            [m, grant.id],
          )
        ).rows[0];
        return {
          pendingRequests: row.pending_requests,
          rewardsReady: row.rewards_ready,
          today: { visits: row.visits, stamps: row.stamps, redeemed: row.redeemed },
          mine: {
            visits: row.my_visits,
            stamps: row.my_stamps,
            redeemed: row.my_redeemed,
            firstAt: row.my_first_at,
          },
        };
      },
      actor,
    );
  });
  // Each cashier's work in the period, with a flag when stamps came unusually fast.
  app.get('/api/v1/merchants/:m/staff-activity', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      q = z
        .object({
          days: z.coerce
            .number()
            .int()
            .refine((n) => [1, 7, 30, 90].includes(n))
            .default(30),
        })
        .parse(req.query);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner', 'manager']);
        const rows = (
          await db.query(
            `WITH tx AS (
               SELECT t.staff_id,t.type,t.quantity,t.at FROM loyalty_transactions t
               WHERE t.merchant_id=$1 AND t.staff_id IS NOT NULL AND branch_access(t.merchant_id,t.branch_id)
                 AND t.at>=clock_timestamp()-make_interval(days=>$2)),
             bursts AS (
               SELECT a.staff_id,max((SELECT sum(b.quantity) FROM tx b WHERE b.staff_id=a.staff_id AND b.type='award'
                 AND b.at BETWEEN a.at AND a.at+interval '10 minutes'))::int AS peak
               FROM tx a WHERE a.type='award' GROUP BY a.staff_id),
             decided AS (
               SELECT r.decided_by,count(*) FILTER (WHERE r.status='approved')::int AS approved,
                      count(*) FILTER (WHERE r.status='rejected')::int AS rejected
               FROM stamp_requests r WHERE r.merchant_id=$1 AND r.decided_at>=clock_timestamp()-make_interval(days=>$2)
                 AND branch_access(r.merchant_id,r.branch_id) GROUP BY r.decided_by)
             SELECT s.id,s.name,s.role,s.status,
               coalesce((SELECT count(*) FROM tx WHERE tx.staff_id=s.id AND tx.type='award'),0)::int AS visits,
               coalesce((SELECT sum(quantity) FROM tx WHERE tx.staff_id=s.id AND tx.type='award'),0)::int AS stamps,
               coalesce((SELECT count(*) FROM tx WHERE tx.staff_id=s.id AND tx.type='redeem'),0)::int AS rewards,
               coalesce((SELECT max(at) FROM tx WHERE tx.staff_id=s.id),NULL) AS last_at,
               coalesce(b.peak,0) AS peak_ten_minutes,
               coalesce(d.approved,0) AS approved,coalesce(d.rejected,0) AS rejected
             FROM staff_memberships s
             LEFT JOIN bursts b ON b.staff_id=s.id
             LEFT JOIN decided d ON d.decided_by=s.user_id
             WHERE s.merchant_id=$1
             ORDER BY stamps DESC,s.name`,
            [m, q.days],
          )
        ).rows;
        return {
          days: q.days,
          // More than 10 stamps from one person inside 10 minutes is worth a look.
          burstThreshold: 10,
          staff: rows,
        };
      },
      actor,
    );
  });
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
            "SELECT coalesce(sum(quantity) FILTER(WHERE type='award'),0)::int AS stamps,(SELECT count(*) FROM visits_since($1,(clock_timestamp()-$3*interval '1 day')::date-1) v WHERE branch_access(v.merchant_id,v.branch_id) AND ($2::uuid IS NULL OR v.branch_id=$2) AND v.first_at>=clock_timestamp()-$3*interval '1 day')::int AS visits,count(*) FILTER(WHERE type='redeem')::int AS rewards_redeemed,coalesce(sum(quantity) FILTER(WHERE type='correction'),0)::int AS corrections,max(at) AS watermark FROM loyalty_transactions WHERE merchant_id=$1 AND branch_access(merchant_id,branch_id) AND ($2::uuid IS NULL OR branch_id=$2) AND at>=clock_timestamp()-$3*interval '1 day'",
            [m, q.branchId || null, q.days],
          )
        ).rows[0];
        const customers = (
          await db.query(
            "WITH scoped AS (SELECT cp.id,cp.created_at,(SELECT max(t.at) FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id WHERE ms.profile_id=cp.id AND t.type='award' AND t.source<>'welcome' AND branch_access(t.merchant_id,t.branch_id) AND ($2::uuid IS NULL OR t.branch_id=$2)) AS last_purchase FROM tenant_customer_profiles cp WHERE cp.merchant_id=$1 AND ($3::boolean OR EXISTS(SELECT 1 FROM memberships ms WHERE ms.profile_id=cp.id AND ((branch_access(ms.merchant_id,ms.origin_branch_id) AND ($2::uuid IS NULL OR ms.origin_branch_id=$2)) OR EXISTS(SELECT 1 FROM loyalty_transactions t WHERE t.membership_id=ms.id AND branch_access(t.merchant_id,t.branch_id) AND ($2::uuid IS NULL OR t.branch_id=$2)))))) SELECT count(*)::int AS registered,count(*) FILTER(WHERE last_purchase>=clock_timestamp()-interval '30 days')::int AS active,count(*) FILTER(WHERE last_purchase<clock_timestamp()-interval '30 days')::int AS inactive,count(*) FILTER(WHERE last_purchase IS NULL)::int AS never_active,count(*) FILTER(WHERE created_at>=clock_timestamp()-$4*interval '1 day')::int AS new_signups,max(created_at) AS watermark FROM scoped",
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
            "SELECT b.id,b.name,(SELECT count(*) FROM visits_since(b.merchant_id,(clock_timestamp()-$3*interval '1 day')::date-1) v WHERE v.branch_id=b.id AND v.first_at>=clock_timestamp()-$3*interval '1 day')::int AS visits,coalesce(sum(t.quantity) FILTER(WHERE t.type='award'),0)::int AS stamps,count(t.id) FILTER(WHERE t.type='redeem')::int AS redeemed FROM branches b LEFT JOIN loyalty_transactions t ON t.branch_id=b.id AND t.at>=clock_timestamp()-$3*interval '1 day' WHERE b.merchant_id=$1 AND ($2::uuid IS NULL OR b.id=$2) GROUP BY b.id,b.name ORDER BY b.name",
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
            "SELECT v.business_date::text AS day,count(*)::int AS visits,count(DISTINCT v.profile_id)::int AS buyers FROM visits_since($1,(now()-$3*interval '1 day')::date-1) v WHERE branch_access(v.merchant_id,v.branch_id) AND ($2::uuid IS NULL OR v.branch_id=$2) AND v.first_at>=now()-$3*interval '1 day' GROUP BY day ORDER BY day",
            [m, q.branchId || null, q.days],
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
            visits:
              'One customer on one business day (shop timezone) with at least one counted stamp, however it was collected (cashier, receipt or automatic). Welcome stamps, fully revoked stamps, card opens and scans do not count.',
            stamps: 'Gross awarded stamp units; corrections are separate.',
            active: 'Distinct customers with at least one visit in the last 30 days.',
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
