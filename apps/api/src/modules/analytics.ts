import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  analyticsQuery,
  businessCategory,
  cadenceInput,
  categoryDefaultsInput,
  customerTags,
  lifecycles,
  segmentKey,
  segmentKeys,
  segmentQuery,
  healthScore,
  sectionsFor,
  type ActionCard,
  type AnalyticsResponse,
  type Cadence,
  type CategoryDefaults,
  type CustomerInsights,
  type Gate,
  type SegmentKey,
  type SegmentPage,
} from '../../../../packages/contracts/src/analytics.js';
import { getEntitlements } from '../entitlements.js';
import { authenticated } from '../auth.js';
import { transaction, type Actor, type DB, type Pools } from '../db.js';
import { merchantGrant, platform } from '../policy.js';
import { requireCondition } from '../errors.js';
import { idempotencyKey, operation } from '../operations.js';

const merchantParams = z.object({ m: z.uuid() });

async function categoryDefaults(db: DB): Promise<CategoryDefaults[]> {
  return (
    await db.query(
      `SELECT category,expected_gap_days AS "expectedGapDays",at_risk_after_days AS "atRiskAfterDays",
              lost_after_days AS "lostAfterDays" FROM analytics_category_defaults ORDER BY category`,
    )
  ).rows;
}

export async function readCadence(db: DB, merchantId: string): Promise<Cadence> {
  const row = (
    await db.query(
      `SELECT c.category,c.gap,c.risk,c.lost,c.customized,m.business_category_confirmed AS confirmed,
              m.expected_gap_days,m.at_risk_after_days,m.lost_after_days
       FROM merchant_cadence($1) c JOIN merchants m ON m.id=$1`,
      [merchantId],
    )
  ).rows[0];
  requireCondition(row, 'NOT_FOUND', 404);
  return {
    category: row.category,
    confirmed: row.confirmed,
    gap: row.gap,
    risk: row.risk,
    lost: row.lost,
    customized: row.customized,
    own: {
      expectedGapDays: row.expected_gap_days,
      atRiskAfterDays: row.at_risk_after_days,
      lostAfterDays: row.lost_after_days,
    },
    defaults: await categoryDefaults(db),
  };
}

export function analyticsModule(app: FastifyInstance, pools: Pools) {
  // How often this shop's customers normally come back, and what it is based on.
  app.get('/api/v1/merchants/:m/cadence', async (req) => {
    const actor = authenticated(req),
      { m } = merchantParams.parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        if (actor.role === 'platform_admin') platform(actor, false);
        else await merchantGrant(db, actor, m, ['owner', 'manager']);
        return readCadence(db, m);
      },
      actor,
    );
  });

  // The owner picks the kind of business and, optionally, their own numbers.
  app.put('/api/v1/merchants/:m/cadence', async (req) => {
    const actor = authenticated(req),
      { m } = merchantParams.parse(req.params),
      body = cadenceInput.parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        if (actor.role === 'platform_admin') platform(actor, true);
        else await merchantGrant(db, actor, m, ['owner'], undefined, true);
        return operation(
          db,
          actor,
          { scope: 'merchant.cadence:' + m, key, payload: body, merchantId: m },
          async () => {
            await db.query('SELECT set_merchant_cadence($1,$2,$3,$4,$5)', [
              m,
              body.category,
              body.expectedGapDays,
              body.atRiskAfterDays,
              body.lostAfterDays,
            ]);
            return { ...(await readCadence(db, m)) };
          },
        );
      },
      actor,
    );
  });

  app.get('/api/v1/platform/analytics-defaults', async (req) => {
    const actor = authenticated(req);
    platform(actor, false);
    return transaction(pools.pool, async (db) => ({ defaults: await categoryDefaults(db) }), actor);
  });

  app.put('/api/v1/platform/analytics-defaults/:category', async (req) => {
    const actor = authenticated(req);
    platform(actor, true);
    const { category } = z.object({ category: businessCategory }).parse(req.params),
      body = categoryDefaultsInput.parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        await db.query('SELECT set_category_defaults($1,$2,$3,$4)', [
          category,
          body.expectedGapDays,
          body.atRiskAfterDays,
          body.lostAfterDays,
        ]);
        return { defaults: await categoryDefaults(db) };
      },
      actor,
    );
  });
}

// ── The analytics page ─────────────────────────────────────────────────────────────────────────

const pct = (part: number, whole: number) =>
  whole ? Math.round((1000 * part) / whole) / 10 : null;
/** Bump when the response shape changes, so browsers drop copies cached by an older release. */
const ANALYTICS_SHAPE = 2;
/** Minimum data before a section shows numbers instead of "not enough data yet". */
export const minimums = {
  funnel: 20,
  distribution: 10,
  heat: 50,
  healthCustomers: 50,
  healthDays: 30,
  cohorts: 20,
} as const;
const gate = <T extends object>(have: number, need: number, value: () => T): Gate<T> =>
  have >= need ? { status: 'ready', ...value() } : { status: 'not_enough_data', have, need };

/** Owners and managers of the shop; a branch filter must be one of the caller's branches. */
async function analyticsAccess(db: DB, actor: Actor, m: string, branchId?: string) {
  await merchantGrant(db, actor, m, ['owner', 'manager']);
  if (branchId) await merchantGrant(db, actor, m, ['owner', 'manager'], branchId);
}

// Customers the caller may see (row-level security on customer_stats), optionally one branch's.
const CUSTOMERS = `customer_stats cs WHERE cs.merchant_id=$1 AND ($2::uuid IS NULL OR cs.origin_branch_id=$2 OR $2=ANY(cs.branch_ids))`;

export function analyticsPageModule(app: FastifyInstance, pools: Pools) {
  app.get('/api/v1/merchants/:m/analytics', async (req, reply) => {
    const actor = authenticated(req),
      { m } = merchantParams.parse(req.params),
      q = analyticsQuery.parse(req.query);
    return transaction(
      pools.pool,
      async (db) => {
        await analyticsAccess(db, actor, m, q.branchId);
        const meta = (
          await db.query(
            `SELECT m.timezone,(clock_timestamp() AT TIME ZONE m.timezone)::date::text AS today,clock_timestamp() AS now,
               (SELECT max(at) FROM loyalty_transactions t WHERE t.merchant_id=m.id) AS last_tx,
               (SELECT max(joined_at) FROM memberships ms WHERE ms.merchant_id=m.id) AS last_join,
               (SELECT max(at) FROM reward_events e WHERE e.merchant_id=m.id) AS last_reward,
               (SELECT count(*) FROM memberships ms WHERE ms.merchant_id=m.id)::int AS memberships,
               (SELECT count(*) FROM stamp_requests r WHERE r.merchant_id=m.id AND r.status='pending')::int AS pending,
               (SELECT max(created_at) FROM wallet_messages w WHERE w.merchant_id=m.id) AS last_message,
               (SELECT string_agg(g.branch_id::text,',' ORDER BY g.branch_id) FROM staff_branch_grants g
                  JOIN staff_memberships st ON st.id=g.staff_id WHERE st.merchant_id=m.id AND st.user_id=$2) AS grants,
               s.refreshed_at
             FROM merchants m LEFT JOIN merchant_analytics_state s ON s.merchant_id=m.id WHERE m.id=$1`,
            [m, actor.id],
          )
        ).rows[0];
        requireCondition(meta, 'NOT_FOUND', 404);
        const sections = sectionsFor((await getEntitlements(db, m)).features.analytics_level),
          cadence = await readCadence(db, m);
        // Same inputs, same answer: let the browser keep its copy.
        const etag =
          '"' +
          createHash('sha256')
            .update(
              JSON.stringify([
                ANALYTICS_SHAPE,
                actor.id,
                q,
                meta.today,
                meta.last_tx,
                meta.last_join,
                meta.last_reward,
                meta.memberships,
                meta.pending,
                meta.last_message,
                meta.grants,
                meta.refreshed_at,
                sections,
                cadence.category,
                cadence.confirmed,
                cadence.gap,
                cadence.risk,
                cadence.lost,
              ]),
            )
            .digest('base64url')
            .slice(0, 27) +
          '"';
        reply.header('etag', etag).header('cache-control', 'private, no-cache');
        if (req.headers['if-none-match'] === etag) return reply.code(304).send();
        const days = q.days,
          branch = q.branchId ?? null;
        const period = (
          await db.query(
            `SELECT ($1::date-($2-1))::text AS start,($1::date-(2*$2-1))::text AS prev_start,($1::date-$2)::text AS prev_end`,
            [meta.today, days],
          )
        ).rows[0];

        const kpi = (
          await db.query(
            `WITH v AS (
               SELECT DISTINCT v.profile_id,v.business_date FROM visits_since($1,$3::date) v
               WHERE branch_access(v.merchant_id,v.branch_id) AND ($2::uuid IS NULL OR v.branch_id=$2)
                 AND v.business_date<=$5),
             firsts AS (SELECT cs.profile_id,cs.first_visit_on FROM customer_stats cs WHERE cs.merchant_id=$1
               AND cs.profile_id IN (SELECT profile_id FROM v)),
             win AS (
               SELECT v.profile_id,(v.business_date>=$4) AS current,count(*) AS n,max(v.business_date) AS last_day
               FROM v GROUP BY v.profile_id,(v.business_date>=$4)),
             rated AS (
               SELECT w.current,count(*) AS visitors,
                 count(*) FILTER(WHERE w.n>1 OR f.first_visit_on<w.last_day) AS back
               FROM win w LEFT JOIN firsts f ON f.profile_id=w.profile_id GROUP BY w.current)
             SELECT
               (SELECT count(*) FROM v WHERE business_date>=$4)::int AS visits,
               (SELECT count(*) FROM v WHERE business_date<$4)::int AS prev_visits,
               coalesce((SELECT visitors FROM rated WHERE current),0)::int AS active,
               coalesce((SELECT back FROM rated WHERE current),0)::int AS back,
               coalesce((SELECT visitors FROM rated WHERE NOT current),0)::int AS prev_active,
               coalesce((SELECT back FROM rated WHERE NOT current),0)::int AS prev_back`,
            [m, branch, period.prev_start, period.start, meta.today],
          )
        ).rows[0];
        const people = (
          await db.query(
            `SELECT count(*)::int AS customers,
               count(*) FILTER(WHERE (cs.joined_at AT TIME ZONE $3)::date>=$4)::int AS new_customers,
               count(*) FILTER(WHERE (cs.joined_at AT TIME ZONE $3)::date BETWEEN $5 AND $6)::int AS prev_new,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY cs.personal_gap_days) AS typical_gap,
               count(*) FILTER(WHERE cs.lifecycle='at_risk')::int AS at_risk,
               count(*) FILTER(WHERE cs.lifecycle='one_time')::int AS one_time,
               count(*) FILTER(WHERE 'near_reward'=ANY(cs.tags))::int AS near_reward,
               count(*) FILTER(WHERE 'reward_holder'=ANY(cs.tags))::int AS reward_holder,
               count(*) FILTER(WHERE cs.visits_total>=1)::int AS visited,
               count(*) FILTER(WHERE cs.visits_total>=2)::int AS came_back,
               count(*) FILTER(WHERE cs.rewards_earned>=1)::int AS earned,
               count(*) FILTER(WHERE cs.rewards_redeemed>=1)::int AS redeemed,
               count(*) FILTER(WHERE cs.visits_total=1)::int AS v1,
               count(*) FILTER(WHERE cs.visits_total=2)::int AS v2,
               count(*) FILTER(WHERE cs.visits_total=3)::int AS v3,
               count(*) FILTER(WHERE cs.visits_total=4)::int AS v4,
               count(*) FILTER(WHERE cs.visits_total>=5)::int AS v5
             FROM ${CUSTOMERS}`,
            [m, branch, meta.timezone, period.start, period.prev_start, period.prev_end],
          )
        ).rows[0];
        const segmentRows = (
          await db.query(
            `SELECT lifecycle AS key,count(*)::int AS n FROM ${CUSTOMERS} GROUP BY lifecycle
             UNION ALL SELECT t,count(*)::int FROM ${CUSTOMERS.replace('cs WHERE', 'cs CROSS JOIN LATERAL unnest(cs.tags) t WHERE')} GROUP BY t`,
            [m, branch],
          )
        ).rows as { key: SegmentKey; n: number }[];
        const segments = Object.fromEntries(segmentKeys.map((k) => [k, 0])) as Record<
          SegmentKey,
          number
        >;
        for (const r of segmentRows) segments[r.key] = r.n;
        const atRisk = (
          await db.query(
            `SELECT cs.profile_id AS "profileId",cp.alias,round(cs.expected_gap_days)::int AS "expectedGapDays",
               cs.since_days AS "sinceDays",cs.stamps_to_reward AS "stampsToReward"
             FROM ${CUSTOMERS.replace('cs WHERE', 'cs JOIN tenant_customer_profiles cp ON cp.id=cs.profile_id WHERE')}
               AND cs.lifecycle='at_risk'
             ORDER BY cs.since_days::numeric/greatest(cs.expected_gap_days,1) DESC,cs.visits_total DESC LIMIT 5`,
            [m, branch],
          )
        ).rows;
        const trendRows = (
          await db.query(
            `SELECT d::date::text AS day,count(DISTINCT v.profile_id)::int AS visits
             FROM generate_series($3::date,$4::date,interval '1 day') d
             LEFT JOIN visits_since($1,$3::date) v ON v.business_date=d::date
               AND branch_access(v.merchant_id,v.branch_id) AND ($2::uuid IS NULL OR v.branch_id=$2)
             GROUP BY d ORDER BY d`,
            [m, branch, period.start, meta.today],
          )
        ).rows;
        const value = (
          await db.query(
            `WITH v AS (
               SELECT DISTINCT v.profile_id,v.business_date,v.first_at FROM visits_since($1,$3::date) v
               WHERE branch_access(v.merchant_id,v.branch_id) AND ($2::uuid IS NULL OR v.branch_id=$2))
             SELECT
               count(*) FILTER(WHERE v.business_date>cs.first_visit_on)::int AS returning_visits,
               count(*) FILTER(WHERE EXISTS(
                 SELECT 1 FROM wallet_message_deliveries d WHERE d.profile_id=v.profile_id AND d.status='accepted'
                   AND d.accepted_at BETWEEN v.first_at-interval '14 days' AND v.first_at)
                 OR EXISTS(SELECT 1 FROM customer_reminders r WHERE r.profile_id=v.profile_id AND r.status='accepted'
                   AND r.accepted_at BETWEEN v.first_at-interval '14 days' AND v.first_at))::int AS after_messages
             FROM v JOIN customer_stats cs ON cs.profile_id=v.profile_id`,
            [m, branch, period.start],
          )
        ).rows[0];
        const heatRows = (
          await db.query(
            `SELECT ((extract(isodow FROM l)::int+1)%7) AS day,
               CASE WHEN extract(hour FROM l)>=6 AND extract(hour FROM l)<11 THEN 0
                    WHEN extract(hour FROM l)>=11 AND extract(hour FROM l)<14 THEN 1
                    WHEN extract(hour FROM l)>=14 AND extract(hour FROM l)<17 THEN 2
                    WHEN extract(hour FROM l)>=17 AND extract(hour FROM l)<20 THEN 3 ELSE 4 END AS slot,
               count(*)::int AS n
             FROM (SELECT v.first_at AT TIME ZONE $3 AS l FROM visits_since($1,$4::date-89) v
                   WHERE branch_access(v.merchant_id,v.branch_id) AND ($2::uuid IS NULL OR v.branch_id=$2)) x
             GROUP BY 1,2`,
            [m, branch, meta.timezone, meta.today],
          )
        ).rows as { day: number; slot: number; n: number }[];
        const branches = (
          await db.query(
            `WITH v AS (
               SELECT DISTINCT v.profile_id,v.business_date,v.branch_id FROM visits_since($1,$2::date) v
               WHERE branch_access(v.merchant_id,v.branch_id)),
             per AS (
               SELECT v.branch_id,v.profile_id,count(*) AS n,max(v.business_date) AS last_day FROM v GROUP BY 1,2)
             SELECT b.id,b.name,
               coalesce((SELECT count(*) FROM v WHERE v.branch_id=b.id),0)::int AS visits,
               (SELECT count(*) FROM memberships ms WHERE ms.merchant_id=$1 AND ms.origin_branch_id=b.id
                  AND (ms.joined_at AT TIME ZONE $3)::date>=$2)::int AS "newCustomers",
               (SELECT count(*) FROM per WHERE per.branch_id=b.id)::int AS visitors,
               (SELECT count(*) FROM per JOIN customer_stats cs ON cs.profile_id=per.profile_id
                  WHERE per.branch_id=b.id AND (per.n>1 OR cs.first_visit_on<per.last_day))::int AS back,
               (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM r.decided_at-r.created_at)))::int
                  FROM stamp_requests r WHERE r.merchant_id=$1 AND r.branch_id=b.id AND r.status='approved'
                  AND (r.created_at AT TIME ZONE $3)::date>=$2) AS "medianApprovalSeconds",
               (SELECT count(*) FROM stamp_requests r WHERE r.merchant_id=$1 AND r.branch_id=b.id AND r.status='pending'
                  AND r.expires_at>clock_timestamp() AND r.failed_matches<5)::int AS pending
             FROM branches b WHERE b.merchant_id=$1 AND b.status='active' AND branch_access(b.merchant_id,b.id)
               AND ($4::uuid IS NULL OR b.id=$4)
             ORDER BY visits DESC,b.name`,
            [m, period.start, meta.timezone, branch],
          )
        ).rows;

        const health = (
          await db.query(
            `SELECT count(*) FILTER(WHERE cs.visits_total>=1)::int AS visited,
               count(*) FILTER(WHERE cs.first_visit_on<=$3::date-30)::int AS old,
               count(*) FILTER(WHERE cs.first_visit_on<=$3::date-30 AND cs.visits_total>=2)::int AS old_back,
               count(*) FILTER(WHERE cs.rewards_earned>=1)::int AS completed,
               coalesce(sum(cs.rewards_earned),0)::int AS earned,
               coalesce(sum(cs.rewards_redeemed),0)::int AS redeemed,
               count(*) FILTER(WHERE cs.last_visit_on>$3::date-30)::int AS active30,
               ($3::date-min(cs.first_visit_on))::int AS history_days
             FROM ${CUSTOMERS}`,
            [m, branch, meta.today],
          )
        ).rows[0];
        const cohortRows = (
          await db.query(
            // Only customers whose very first visit is inside the six months: their whole history
            // is then inside the window, so the scan stops at its start instead of the shop's first day.
            `WITH w AS (SELECT (date_trunc('month',$3::date)-interval '5 months')::date AS start),
             days AS (
               SELECT profile_id,business_date,row_number() OVER (PARTITION BY profile_id ORDER BY business_date) AS rn
               FROM (SELECT DISTINCT v.profile_id,v.business_date FROM w,visits_since($1,w.start) v
                     WHERE branch_access(v.merchant_id,v.branch_id)
                       AND ($2::uuid IS NULL OR v.branch_id=$2)
                       AND v.profile_id IN (SELECT cs.profile_id FROM customer_stats cs,w
                                            WHERE cs.merchant_id=$1 AND cs.first_visit_on>=w.start)) x)
             SELECT to_char(f.business_date,'YYYY-MM') AS month,count(*)::int AS first,
               count(*) FILTER(WHERE s.business_date<=f.business_date+30)::int AS back30
             FROM days f LEFT JOIN days s ON s.profile_id=f.profile_id AND s.rn=2
             WHERE f.rn=1
             GROUP BY 1 ORDER BY 1`,
            [m, branch, meta.today],
          )
        ).rows as { month: string; first: number; back30: number }[];
        const healthGate: AnalyticsResponse['health'] =
          people.customers < minimums.healthCustomers
            ? {
                status: 'not_enough_data' as const,
                have: people.customers,
                need: minimums.healthCustomers,
              }
            : (health.history_days ?? 0) < minimums.healthDays
              ? {
                  status: 'not_enough_data' as const,
                  have: health.history_days ?? 0,
                  need: minimums.healthDays,
                }
              : {
                  status: 'ready' as const,
                  ...healthScore({
                    return: (pct(kpi.back, kpi.active) ?? 0) as number,
                    second_visit: pct(health.old_back, health.old) ?? 0,
                    completion: pct(health.completed, health.visited) ?? 0,
                    // No reward earned yet: nothing to claim, so this part does not count against the shop.
                    redemption: pct(health.redeemed, health.earned) ?? 80,
                    active: pct(health.active30, health.visited) ?? 0,
                  }),
                };
        const cohortTotal = cohortRows.reduce((n, r) => n + r.first, 0);
        const impact = sections.messageImpact
          ? (
              await db.query(
                `SELECT DISTINCT ON (w.audience) w.audience,w.created_at AS "sentAt",w.recipients,
                   wallet_message_returns(w.id) AS returned
                 FROM wallet_messages w WHERE w.merchant_id=$1 AND w.created_at>clock_timestamp()-interval '60 days'
                 ORDER BY w.audience,w.created_at DESC`,
                [m],
              )
            ).rows
          : [];
        const actions: ActionCard[] = (
          [
            ['at_risk', people.at_risk],
            ['near_reward', people.near_reward],
            ['one_time', people.one_time],
            ['reward_holder', people.reward_holder],
          ] as const
        ).map(([key, count]) => ({ key, count }));
        const cells = Array.from({ length: 7 }, () => [0, 0, 0, 0, 0]);
        let heatTotal = 0;
        for (const r of heatRows) {
          cells[r.day]![r.slot] = r.n;
          heatTotal += r.n;
        }
        let quietest = { day: 0, slot: 0 };
        // The calmest daytime slot (late night is calm everywhere and not useful advice).
        for (let d = 0; d < 7; d++)
          for (let s = 0; s < 4; s++)
            if (cells[d]![s]! < cells[quietest.day]![quietest.slot]!)
              quietest = { day: d, slot: s };
        const lock = <T>(open: boolean, g: Gate<T>): Gate<T> => (open ? g : { status: 'locked' });
        const response: AnalyticsResponse = {
          period: {
            days: days as 7 | 30 | 90,
            from: period.start as string,
            to: meta.today as string,
            timezone: meta.timezone,
          },
          updatedAt: meta.now.toISOString(),
          statsRefreshedAt: meta.refreshed_at ? meta.refreshed_at.toISOString() : null,
          cadence: {
            category: cadence.category,
            confirmed: cadence.confirmed,
            gap: cadence.gap,
            risk: cadence.risk,
            lost: cadence.lost,
          },
          sections,
          actions: sections.actions ? actions : [],
          kpis: {
            customers: people.customers,
            active: kpi.active,
            newCustomers: people.new_customers,
            visits: kpi.visits,
            returnRate: pct(kpi.back, kpi.active),
            typicalGapDays: people.typical_gap === null ? null : Math.round(people.typical_gap),
            previous: {
              active: kpi.prev_active,
              newCustomers: people.prev_new,
              visits: kpi.prev_visits,
              returnRate: pct(kpi.prev_back, kpi.prev_active),
            },
          },
          trend: trendRows,
          value: {
            returningVisits: value.returning_visits,
            visitsAfterMessages: sections.messageImpact ? value.after_messages : 0,
          },
          segments,
          atRisk: sections.atRisk ? atRisk : [],
          funnel: lock(
            sections.funnel,
            gate(people.customers, minimums.funnel, () => ({
              steps: [
                { key: 'registered' as const, count: people.customers },
                { key: 'first_visit' as const, count: people.visited },
                { key: 'second_visit' as const, count: people.came_back },
                { key: 'reward_earned' as const, count: people.earned },
                { key: 'reward_redeemed' as const, count: people.redeemed },
              ],
            })),
          ),
          distribution: lock(
            sections.distribution,
            gate(people.visited, minimums.distribution, () => ({
              buckets: [people.v1, people.v2, people.v3, people.v4, people.v5] as [
                number,
                number,
                number,
                number,
                number,
              ],
            })),
          ),
          heat: lock(
            sections.heat,
            gate(heatTotal, minimums.heat, () => ({ cells, quietest })),
          ),
          branches: sections.branches
            ? branches.map((b) => ({
                id: b.id,
                name: b.name,
                visits: b.visits,
                newCustomers: b.newCustomers,
                returnRate: pct(b.back, b.visitors),
                medianApprovalSeconds: b.medianApprovalSeconds,
                pending: b.pending,
              }))
            : [],
          health: lock(sections.health, healthGate),
          cohorts: lock(
            sections.cohorts,
            gate(cohortTotal, minimums.cohorts, () => ({ rows: cohortRows })),
          ),
          messageImpact: impact.map((r) => ({
            audience: r.audience,
            sentAt: r.sentAt.toISOString(),
            recipients: r.recipients,
            returned: r.returned,
          })),
        };
        return response;
      },
      actor,
    );
  });

  // The customers in one segment, most urgent first.
  app.get('/api/v1/merchants/:m/analytics/segments/:key', async (req) => {
    const actor = authenticated(req),
      { m, key } = z.object({ m: z.uuid(), key: segmentKey }).parse(req.params),
      q = segmentQuery.parse(req.query),
      offset = q.cursor ? z.coerce.number().int().min(0).max(100000).parse(q.cursor) : 0;
    return transaction(
      pools.pool,
      async (db) => {
        await analyticsAccess(db, actor, m, q.branchId);
        const sections = sectionsFor((await getEntitlements(db, m)).features.analytics_level);
        requireCondition(sections.segmentList, 'FEATURE_NOT_IN_PLAN', 403);
        const isTag = (customerTags as readonly string[]).includes(key);
        requireCondition(
          isTag || (lifecycles as readonly string[]).includes(key),
          'NOT_FOUND',
          404,
        );
        const order: Record<string, string> = {
          at_risk: 'cs.since_days::numeric/greatest(cs.expected_gap_days,1) DESC',
          lost: 'cs.visits_total DESC,cs.since_days',
          near_reward: 'cs.stamps_to_reward,cs.since_days DESC',
          reward_holder: 'cs.since_days DESC NULLS LAST',
          vip: 'cs.visits_90d DESC',
          one_time: 'cs.since_days',
          new: 'cs.first_visit_on DESC',
          never: 'cs.joined_at DESC',
        };
        const where =
          CUSTOMERS.replace(
            'cs WHERE',
            'cs JOIN tenant_customer_profiles cp ON cp.id=cs.profile_id WHERE',
          ) +
          (isTag ? ' AND $3=ANY(cs.tags)' : ' AND cs.lifecycle=$3') +
          " AND ($4::text IS NULL OR cp.alias ILIKE '%'||$4||'%')";
        // A number and WhatsApp consent: the owner can open a WhatsApp draft to this customer.
        const whatsapp = `(cp.contact_phone<>'' AND EXISTS(SELECT 1 FROM consent_current wc WHERE wc.merchant_id=cp.merchant_id AND wc.user_id=cp.user_id AND wc.channel='whatsapp' AND wc.granted))`;
        const listed = where + (q.whatsapp ? ` AND ${whatsapp}` : '');
        // The search box is plain text: % and _ are not wildcards.
        const params = [m, q.branchId ?? null, key, q.q ? q.q.replace(/[\\%_]/g, '\\$&') : null];
        const counts = (
          await db.query(
            `SELECT count(*)::int AS n,count(*) FILTER (WHERE ${whatsapp})::int AS wa FROM ${where}`,
            params,
          )
        ).rows[0];
        const rows = (
          await db.query(
            `SELECT cs.profile_id AS "profileId",cp.alias,cs.lifecycle,cs.tags,cs.visits_total AS visits,
               cs.since_days AS "sinceDays",round(cs.expected_gap_days)::int AS "expectedGapDays",
               cs.stamps_to_reward AS "stampsToReward",cs.last_visit_at AS "lastVisitAt",
               ${whatsapp} AS whatsapp
             FROM ${listed} ORDER BY ${order[key] ?? 'cs.last_visit_on DESC NULLS LAST'},cs.profile_id
             LIMIT 51 OFFSET ${offset}`,
            params,
          )
        ).rows;
        const page: SegmentPage = {
          key,
          total: counts.n,
          whatsappReady: counts.wa,
          customers: rows.slice(0, 50),
          nextCursor: rows.length > 50 ? String(offset + 50) : null,
        };
        return page;
      },
      actor,
    );
  });

  // One customer: their rhythm, card and everything that happened, newest first.
  app.get('/api/v1/merchants/:m/customers/:profileId/insights', async (req) => {
    const actor = authenticated(req),
      { m, profileId } = z.object({ m: z.uuid(), profileId: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await analyticsAccess(db, actor, m);
        const sections = sectionsFor((await getEntitlements(db, m)).features.analytics_level);
        requireCondition(sections.customer, 'FEATURE_NOT_IN_PLAN', 403);
        // customer_stats row-level security decides whether this caller may see the customer.
        const s = (
          await db.query(
            `SELECT cs.*,cp.alias,b.name AS favorite_branch FROM customer_stats cs
             JOIN tenant_customer_profiles cp ON cp.id=cs.profile_id
             LEFT JOIN branches b ON b.id=cs.favorite_branch_id
             WHERE cs.merchant_id=$1 AND cs.profile_id=$2`,
            [m, profileId],
          )
        ).rows[0];
        requireCondition(s, 'NOT_FOUND', 404);
        const timeline = (
          await db.query(
            `SELECT * FROM (
               SELECT 'visit' AS kind,v.first_at AS at,b.name AS branch,v.stamps,v.receipts,NULL AS title,NULL AS text,NULL AS source
               FROM visits_v v LEFT JOIN branches b ON b.id=v.branch_id
               WHERE v.merchant_id=$1 AND v.profile_id=$2 AND branch_access(v.merchant_id,v.branch_id)
               UNION ALL
               SELECT CASE WHEN e.event_type='earned' THEN 'reward_earned' ELSE 'reward_redeemed' END,e.at,NULL,NULL,NULL,g.title,NULL,NULL
               FROM reward_events e JOIN reward_grants g ON g.id=e.reward_id JOIN memberships ms ON ms.id=g.membership_id
               WHERE e.merchant_id=$1 AND ms.profile_id=$2 AND e.event_type IN ('earned','redeemed')
               UNION ALL
               SELECT 'message',d.accepted_at,NULL,NULL,NULL,NULL,CASE WHEN $3='en' THEN coalesce(nullif(w.body_en,''),w.body_ar) ELSE w.body_ar END,'owner'
               FROM wallet_message_deliveries d JOIN wallet_messages w ON w.id=d.message_id
               WHERE d.merchant_id=$1 AND d.profile_id=$2 AND d.status='accepted'
               UNION ALL
               SELECT 'message',r.accepted_at,NULL,NULL,NULL,NULL,NULL,'reminder'
               FROM customer_reminders r WHERE r.merchant_id=$1 AND r.profile_id=$2 AND r.status='accepted'
             ) x WHERE at IS NOT NULL ORDER BY at DESC LIMIT 60`,
            // The owner's message in the language this screen is shown in.
            [m, profileId, req.headers['x-nuqta-language'] === 'en' ? 'en' : 'ar'],
          )
        ).rows;
        const result: CustomerInsights = {
          profileId,
          alias: s.alias,
          joinedAt: s.joined_at.toISOString(),
          lifecycle: s.lifecycle,
          tags: s.tags,
          visits: s.visits_total,
          visits90d: s.visits_90d,
          sinceDays: s.since_days,
          expectedGapDays: Math.round(Number(s.expected_gap_days)),
          personalGapDays:
            s.personal_gap_days === null ? null : Math.round(Number(s.personal_gap_days)),
          stampsToReward: s.stamps_to_reward,
          rewardsEarned: s.rewards_earned,
          rewardsRedeemed: s.rewards_redeemed,
          walletSaved: s.wallet_saved,
          favoriteBranch: s.favorite_branch,
          timeline: timeline.map((e) =>
            e.kind === 'visit'
              ? {
                  kind: 'visit' as const,
                  at: e.at.toISOString(),
                  branch: e.branch,
                  stamps: e.stamps,
                  receipts: e.receipts ?? [],
                }
              : e.kind === 'message'
                ? {
                    kind: 'message' as const,
                    at: e.at.toISOString(),
                    text: e.text ?? '',
                    source: e.source,
                  }
                : { kind: e.kind, at: e.at.toISOString(), title: e.title },
          ),
        };
        return result;
      },
      actor,
    );
  });
}
