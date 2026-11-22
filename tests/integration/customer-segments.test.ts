import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { clearOfShopMidnight } from '../helpers.js';
import { readConfig } from '../../apps/api/src/config.js';
import { runAnalyticsRefresh } from '../../apps/worker/src/analytics-refresh.js';
import { seed, ids } from '../../db/seed.js';
import {
  cairo,
  makeCustomer,
  stamp,
  versionA,
  type FixtureCustomer,
} from '../analytics-fixtures.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });

before(async () => {
  await clearOfShopMidnight();
  await db.connect();
  await seed(db);
  // A café with the shipped defaults: normal every 7 days, late after 14, gone after 45.
  await db.query(
    "UPDATE merchants SET business_category='cafe',expected_gap_days=NULL,at_risk_after_days=NULL,lost_after_days=NULL WHERE id=$1",
    [ids.merchantA],
  );
  await db.query(
    "UPDATE analytics_category_defaults SET expected_gap_days=7,at_risk_after_days=14,lost_after_days=45 WHERE category='cafe'",
  );
});
after(async () => {
  await db.end();
});

async function withVisits(daysAgo: number[], opts: { balance?: number } = {}) {
  const customer = await makeCustomer(db, {
    joinedAt: cairo(Math.max(0, ...daysAgo) + 1, 9),
    balance: opts.balance ?? 0,
  });
  for (const n of daysAgo) await stamp(db, customer, cairo(n, 12));
  return customer;
}
const stats = async (cu: FixtureCustomer) =>
  (await db.query('SELECT * FROM customer_stats WHERE profile_id=$1', [cu.profileId])).rows[0];
const refreshShop = () => db.query('SELECT refresh_merchant_stats($1)', [ids.merchantA]);

test('each customer lands in the right lifecycle', async () => {
  const cases = {
    never: await withVisits([]),
    new: await withVisits([3]),
    one_time: await withVisits([20]),
    regular: await withVisits([30, 20, 10, 2]),
    at_risk: await withVisits([60, 50, 40, 20]),
    lost: await withVisits([110, 100, 70]),
    reactivated: await withVisits([120, 110, 5]),
  };
  await refreshShop();
  for (const [expected, customer] of Object.entries(cases))
    assert.equal((await stats(customer)).lifecycle, expected, expected);
  // Personal rhythm: every ~10 days, so late after 15.
  const regular = await stats(cases.regular);
  assert.equal(Number(regular.personal_gap_days), 10);
  assert.equal(Number(regular.at_risk_after_days), 15);
  assert.equal(regular.visits_total, 4);
  assert.equal(regular.since_days, 2);
  // One or two visits: the shop's numbers.
  assert.equal((await stats(cases.one_time)).personal_gap_days, null);
  assert.equal(Number((await stats(cases.one_time)).at_risk_after_days), 14);
});

test('tags: near the reward, a reward waiting, and VIP', async () => {
  const threshold = (
    await db.query('SELECT threshold FROM program_versions WHERE id=$1', [versionA])
  ).rows[0].threshold as number;
  const near = await withVisits([4, 2], { balance: threshold - 1 });
  const holder = await withVisits([6]);
  const earned = await stamp(db, holder, cairo(1, 10));
  await db.query(
    "INSERT INTO reward_grants(merchant_id,membership_id,program_version_id,earned_transaction_id,ordinal,threshold,title,terms,branch_ids,status,expires_at) VALUES($1,$2,$3,$4,1,$5,'مشروب','شروط',ARRAY[$6]::uuid[],'available',now()+interval '20 days')",
    [ids.merchantA, holder.membershipId, versionA, earned, threshold, ids.branchA],
  );
  const vip = await withVisits(Array.from({ length: 30 }, (_, i) => i * 2 + 1));
  await refreshShop();
  assert.ok((await stats(near)).tags.includes('near_reward'));
  assert.equal((await stats(near)).stamps_to_reward, 1);
  assert.ok((await stats(holder)).tags.includes('reward_holder'));
  assert.ok((await stats(vip)).tags.includes('vip'));
  assert.ok(!(await stats(near)).tags.includes('vip'));
});

test('a new stamp refreshes that customer at once, and logs the segment change', async () => {
  const customer = await withVisits([20]);
  await refreshShop();
  assert.equal((await stats(customer)).lifecycle, 'one_time');
  await stamp(db, customer, new Date());
  const row = await stats(customer);
  assert.equal(row.visits_total, 2);
  assert.equal(row.since_days, 0);
  assert.equal(row.lifecycle, 'regular');
  const changes = (
    await db.query(
      'SELECT from_lifecycle,to_lifecycle FROM customer_segment_changes WHERE profile_id=$1 ORDER BY id',
      [customer.profileId],
    )
  ).rows.map((r) => [r.from_lifecycle, r.to_lifecycle]);
  assert.deepEqual(changes.slice(-1), [['one_time', 'regular']]);
});

test('a new card appears as "never" before any visit', async () => {
  const customer = await makeCustomer(db);
  assert.equal((await stats(customer)).lifecycle, 'never');
});

test('the shop changing its rhythm re-sorts customers on the next refresh', async () => {
  const customer = await withVisits([60, 50, 40, 20]);
  await refreshShop();
  assert.equal((await stats(customer)).lifecycle, 'at_risk');
  // At a barber (normal every 28 days) a personal rhythm is never tighter than half of that,
  // so 20 days away is still within this customer's normal.
  await db.query("UPDATE merchants SET business_category='barber' WHERE id=$1", [ids.merchantA]);
  try {
    await refreshShop();
    const row = await stats(customer);
    assert.equal(Number(row.personal_gap_days), 14, 'clamped to half the barber gap');
    assert.equal(Number(row.at_risk_after_days), 21);
    assert.equal(row.lifecycle, 'regular');
    assert.equal(Number(row.lost_after_days), 90);
  } finally {
    await db.query("UPDATE merchants SET business_category='cafe' WHERE id=$1", [ids.merchantA]);
    await refreshShop();
  }
});

test('the whole-shop refresh and the one-customer refresh agree', async () => {
  await refreshShop();
  const all = (
    await db.query(
      'SELECT profile_id,lifecycle,tags,visits_total,since_days,stamps_to_reward FROM customer_stats WHERE merchant_id=$1 ORDER BY profile_id',
      [ids.merchantA],
    )
  ).rows;
  for (const r of all) await db.query('SELECT refresh_customer_stats($1)', [r.profile_id]);
  const again = (
    await db.query(
      'SELECT profile_id,lifecycle,tags,visits_total,since_days,stamps_to_reward FROM customer_stats WHERE merchant_id=$1 ORDER BY profile_id',
      [ids.merchantA],
    )
  ).rows;
  assert.deepEqual(again, all);
});

test('the worker refreshes shops whose day has turned, with its own database role', async () => {
  await db.query('DELETE FROM merchant_analytics_state WHERE merchant_id=$1', [ids.merchantA]);
  const pool = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL, max: 1 });
  try {
    assert.ok((await runAnalyticsRefresh(pool)) >= 1);
  } finally {
    await pool.end();
  }
  const state = (
    await db.query(
      'SELECT refreshed_day,refresh_ms FROM merchant_analytics_state WHERE merchant_id=$1',
      [ids.merchantA],
    )
  ).rows[0];
  assert.ok(state.refreshed_day);
});

test('daily summary and due list', async () => {
  await refreshShop();
  const day = (
    await db.query(
      'SELECT customers,lifecycle_counts FROM merchant_daily_stats WHERE merchant_id=$1 ORDER BY day DESC LIMIT 1',
      [ids.merchantA],
    )
  ).rows[0];
  assert.ok(day.customers > 0);
  assert.ok(day.lifecycle_counts.regular >= 1);
  await db.query('DELETE FROM merchant_analytics_state WHERE merchant_id=$1', [ids.merchantB]);
  const due = (await db.query('SELECT analytics_refresh_due(100) AS id')).rows.map((r) => r.id);
  assert.ok(!due.includes(ids.merchantA), 'refreshed today');
  assert.ok(due.includes(ids.merchantB), 'never refreshed');
});

test('a shop that keeps failing waits longer each time and does not block the others', async () => {
  const pool = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL, max: 1 });
  try {
    await db.query('DELETE FROM merchant_analytics_state WHERE merchant_id=$1', [ids.merchantB]);
    await pool.query('SELECT analytics_refresh_failed($1)', [ids.merchantB]);
    await pool.query('SELECT analytics_refresh_failed($1)', [ids.merchantB]);
    const state = (
      await db.query(
        'SELECT failures,round(extract(epoch FROM retry_after-clock_timestamp())/60) AS minutes FROM merchant_analytics_state WHERE merchant_id=$1',
        [ids.merchantB],
      )
    ).rows[0];
    assert.equal(state.failures, 2);
    assert.equal(Number(state.minutes), 10);
    let due = (await db.query('SELECT analytics_refresh_due(100) AS id')).rows.map((r) => r.id);
    assert.ok(!due.includes(ids.merchantB), 'waiting for its retry');
    // Once the wait is over it is due again, and a success clears the failures.
    await db.query(
      "UPDATE merchant_analytics_state SET retry_after=clock_timestamp()-interval '1 second' WHERE merchant_id=$1",
      [ids.merchantB],
    );
    due = (await db.query('SELECT analytics_refresh_due(100) AS id')).rows.map((r) => r.id);
    assert.ok(due.includes(ids.merchantB));
    await pool.query('SELECT analytics_refresh_succeeded($1)', [ids.merchantB]);
    const cleared = (
      await db.query(
        'SELECT failures,retry_after FROM merchant_analytics_state WHERE merchant_id=$1',
        [ids.merchantB],
      )
    ).rows[0];
    assert.deepEqual([cleared.failures, cleared.retry_after], [0, null]);
  } finally {
    await pool.end();
  }
});

test('one shop of 1,500 customers refreshes quickly; one customer in milliseconds', async () => {
  const merchant = ids.merchantB,
    version = '50000000-0000-4000-8000-000000000002',
    program = '40000000-0000-4000-8000-000000000002';
  const customers: FixtureCustomer[] = [];
  for (let i = 0; i < 1500; i++)
    customers.push(
      await makeCustomer(db, {
        merchantId: merchant,
        programId: program,
        versionId: version,
        branchId: ids.branchB,
        joinedAt: cairo(200, 9),
      }),
    );
  // ~10 visits each, inserted in bulk (without the per-stamp refresh, which the full pass replaces).
  await db.query('ALTER TABLE loyalty_transactions DISABLE TRIGGER analytics_after_transaction');
  await db.query(
    `WITH ops AS (
       INSERT INTO operations(actor_id,merchant_id,scope,idempotency_key,request_hash,status,committed_at)
       SELECT $1,$2,'fixture',gen_random_uuid()::text,'fixture','committed',now()
       FROM unnest($3::uuid[]) m, generate_series(1,10) RETURNING id),
     numbered AS (SELECT id,row_number() OVER () AS n FROM ops)
     INSERT INTO loyalty_transactions(public_reference,merchant_id,membership_id,program_version_id,branch_id,operation_id,type,quantity,source,at)
     SELECT 'FXB-'||n,$2,($3::uuid[])[1+((n-1)/10)::int],$4,$5,id,'award',1,'auto',now()-((n*7)%180)*interval '1 day'
     FROM numbered`,
    [ids.ownerB, merchant, customers.map((x) => x.membershipId), version, ids.branchB],
  );
  await db.query('ALTER TABLE loyalty_transactions ENABLE TRIGGER analytics_after_transaction');
  // A shop never jumps 15,000 stamps between two statistics runs; give the planner real numbers.
  await db.query('ANALYZE loyalty_transactions, memberships, tenant_customer_profiles, operations');
  let started = Date.now();
  await db.query('SELECT refresh_merchant_stats($1)', [merchant]);
  const whole = Date.now() - started;
  started = Date.now();
  await db.query('SELECT refresh_customer_stats($1)', [customers[700]!.profileId]);
  const one = Date.now() - started;
  assert.ok(whole < 5000, 'whole shop took ' + whole + 'ms');
  assert.ok(one < 200, 'one customer took ' + one + 'ms');
  const n = Number(
    (await db.query('SELECT count(*) FROM customer_stats WHERE merchant_id=$1', [merchant])).rows[0]
      .count,
  );
  assert.ok(n >= 1500);
});
