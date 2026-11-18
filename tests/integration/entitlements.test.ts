import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { createPools, transaction, type Actor } from '../../apps/api/src/db.js';
import { AppError } from '../../apps/api/src/errors.js';
import { getEntitlements, assertCan, consume } from '../../apps/api/src/entitlements.js';
import { publicPlanCatalog } from '../../packages/contracts/src/plan-catalog.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  pools = createPools(c);

before(async () => {
  await db.connect();
});
after(async () => {
  await db.end();
  await pools.pool.end();
  await pools.authPool.end();
});

async function user(role: 'platform_admin' | 'customer' = 'customer') {
  return (
    await db.query(
      "INSERT INTO users(email,display_name,global_role) VALUES($1,'Synthetic',$2) RETURNING id",
      ['ent-' + randomUUID() + '@nuqta.test', role],
    )
  ).rows[0].id as string;
}
function actor(id: string): Actor {
  return {
    id,
    email: null,
    role: 'customer',
    sessionId: randomUUID(),
    mfaAt: null,
  } as unknown as Actor;
}
/** A merchant provisioned the old way (feature_entitlements) plus its active owner. */
async function merchant(limits = { branches: 3, staff: 10, programs: 3 }) {
  const mid = (
    await db.query("INSERT INTO merchants(slug,name) VALUES($1,'Synthetic plans') RETURNING id", [
      'ent-' + randomUUID().slice(0, 18),
    ])
  ).rows[0].id as string;
  await db.query(
    "INSERT INTO feature_entitlements(merchant_id,plan,max_branches,max_staff,max_programs,max_customers) VALUES($1,'growth',$2,$3,$4,3000)",
    [mid, limits.branches, limits.staff, limits.programs],
  );
  const owner = await user();
  await db.query(
    "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,'Owner','owner')",
    [mid, owner, 'owner-' + owner + '@nuqta.test'],
  );
  return { mid, owner };
}
async function moveTo(mid: string, plan: string) {
  await db.query(
    'UPDATE entitlement_overrides SET revoked_at=clock_timestamp() WHERE merchant_id=$1 AND revoked_at IS NULL',
    [mid],
  );
  await db.query(
    'UPDATE merchant_subscriptions SET plan_id=(SELECT id FROM plans WHERE key=$2) WHERE merchant_id=$1',
    [mid, plan],
  );
}
async function branches(mid: string, n: number) {
  for (let i = 0; i < n; i++)
    await db.query("INSERT INTO branches(merchant_id,name) VALUES($1,'Branch')", [mid]);
}
async function limitError(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  assert.fail('expected a plan error');
}

test('the seeded catalog matches the public price list on the landing page', async () => {
  const rows = (
    await db.query(
      `SELECT p.key,pr.amount_minor,pr.setup_fee_per_branch_minor,
        (SELECT int_value FROM plan_entitlements e WHERE e.plan_id=p.id AND e.key='max_branches') AS branches,
        (SELECT int_value FROM plan_entitlements e WHERE e.plan_id=p.id AND e.key='max_staff') AS staff,
        (SELECT int_value FROM plan_entitlements e WHERE e.plan_id=p.id AND e.key='max_active_programs') AS programs,
        (SELECT int_value FROM plan_entitlements e WHERE e.plan_id=p.id AND e.key='manual_messages_per_month') AS messages,
        (SELECT unit_amount_minor FROM plan_addons a WHERE a.plan_id=p.id AND a.key='extra_branch') AS xb,
        (SELECT unit_amount_minor FROM plan_addons a WHERE a.plan_id=p.id AND a.key='extra_staff') AS xs,
        (SELECT pa.amount_minor FROM plan_prices pa WHERE pa.plan_id=p.id AND pa.billing_period='annual' AND pa.is_active) AS annual
       FROM plans p JOIN plan_prices pr ON pr.plan_id=p.id AND pr.billing_period='monthly' AND pr.currency='EGP' AND pr.is_active
       WHERE p.is_public AND NOT p.is_custom ORDER BY p.sort_order`,
    )
  ).rows;
  assert.deepEqual(
    rows.map((r) => [
      r.key,
      r.amount_minor / 100,
      r.branches,
      r.staff,
      r.programs,
      r.messages,
      r.xb === null ? null : r.xb / 100,
      r.xs === null ? null : r.xs / 100,
    ]),
    publicPlanCatalog.map((p) => [
      p.key,
      p.monthlyPrice,
      p.includedBranches,
      p.includedStaff,
      p.activePrograms,
      p.manualMessagesPerMonth,
      p.extraBranchPrice,
      p.extraStaffPrice,
    ]),
  );
  for (const r of rows) {
    assert.equal(r.annual, r.amount_minor * 10, 'annual = 10 months');
    assert.equal(r.setup_fee_per_branch_minor, 50000);
  }
  const hidden = (await db.query('SELECT key FROM plans WHERE NOT is_public ORDER BY key')).rows;
  assert.deepEqual(
    hidden.map((r) => r.key),
    ['legacy'],
  );
});

test('existing pilots land on the legacy plan with exactly their old limits, and nothing becomes past due', async () => {
  const { mid, owner } = await merchant({ branches: 3, staff: 10, programs: 3 });
  const e = await transaction(pools.pool, (t) => getEntitlements(t, mid), actor(owner));
  assert.equal(e.plan.key, 'legacy');
  assert.equal(e.status, 'active');
  assert.equal(e.currentPeriodEnd, null);
  assert.deepEqual(
    [e.limits.max_branches, e.limits.max_staff, e.limits.max_active_programs],
    [3, 10, 3],
  );
  // The old admin screen still edits feature_entitlements; a legacy merchant follows it.
  await db.query('UPDATE feature_entitlements SET max_branches=5 WHERE merchant_id=$1', [mid]);
  const after = await transaction(pools.pool, (t) => getEntitlements(t, mid), actor(owner));
  assert.equal(after.limits.max_branches, 5);
  const created = await db.query(
    "SELECT count(*)::int AS n FROM subscription_events WHERE merchant_id=$1 AND event_type='subscription.legacy_created'",
    [mid],
  );
  assert.equal(created.rows[0].n, 1);
  // Once moved to a real plan, the old table no longer drives the limits.
  await moveTo(mid, 'growth');
  await db.query('UPDATE feature_entitlements SET max_branches=9 WHERE merchant_id=$1', [mid]);
  const real = await transaction(pools.pool, (t) => getEntitlements(t, mid), actor(owner));
  assert.equal(real.limits.max_branches, 2);
});

test('every existing merchant got a subscription', async () => {
  const missing = await db.query(
    'SELECT count(*)::int AS n FROM feature_entitlements f WHERE NOT EXISTS(SELECT 1 FROM merchant_subscriptions s WHERE s.merchant_id=f.merchant_id)',
  );
  assert.equal(missing.rows[0].n, 0);
});

test('growth at two branches: the limit offers an extra branch for 400 or Pro for 1,500; the add-on lifts it', async () => {
  const { mid, owner } = await merchant();
  await moveTo(mid, 'growth');
  await branches(mid, 2);
  const err = await limitError(() =>
    transaction(pools.pool, (t) => assertCan(t, mid, 'max_branches'), actor(owner)),
  );
  assert.equal(err.code, 'PLAN_LIMIT_REACHED');
  assert.equal(err.status, 409);
  assert.deepEqual(err.details, {
    entitlement: 'max_branches',
    limit: 2,
    used: 2,
    options: [
      { type: 'addon', key: 'extra_branch', price: 400, currency: 'EGP' },
      { type: 'upgrade', plan: 'pro', price: 1500, currency: 'EGP' },
    ],
  });
  await db.query(
    "INSERT INTO subscription_addons(merchant_id,key,quantity,unit_amount_minor) VALUES($1,'extra_branch',1,40000)",
    [mid],
  );
  await transaction(pools.pool, (t) => assertCan(t, mid, 'max_branches'), actor(owner));
});

test('Starter sells no extra branch: the only way out is an upgrade', async () => {
  const { mid, owner } = await merchant();
  await moveTo(mid, 'starter');
  await branches(mid, 1);
  const err = await limitError(() =>
    transaction(pools.pool, (t) => assertCan(t, mid, 'max_branches'), actor(owner)),
  );
  assert.deepEqual(err.details?.options, [
    { type: 'upgrade', plan: 'growth', price: 900, currency: 'EGP' },
  ]);
  const feature = await limitError(() =>
    transaction(pools.pool, (t) => assertCan(t, mid, 'customer_segments'), actor(owner)),
  );
  assert.equal(feature.code, 'FEATURE_NOT_IN_PLAN');
  assert.deepEqual(feature.details, {
    entitlement: 'customer_segments',
    options: [{ type: 'upgrade', plan: 'growth', price: 900, currency: 'EGP' }],
  });
});

test('Scale add-ons cannot pass 10 branches; above that the answer is Enterprise', async () => {
  const { mid, owner } = await merchant();
  await moveTo(mid, 'scale');
  await db.query(
    "INSERT INTO subscription_addons(merchant_id,key,quantity,unit_amount_minor) VALUES($1,'extra_branch',5,25000)",
    [mid],
  );
  const e = await transaction(pools.pool, (t) => getEntitlements(t, mid), actor(owner));
  assert.equal(e.limits.max_branches, 10);
  assert.equal(e.limits.max_staff, null, 'Scale staff are unlimited');
  await branches(mid, 10);
  const err = await limitError(() =>
    transaction(pools.pool, (t) => assertCan(t, mid, 'max_branches'), actor(owner)),
  );
  assert.deepEqual(err.details?.options, [{ type: 'contact', plan: 'enterprise' }]);
  await transaction(pools.pool, (t) => assertCan(t, mid, 'max_staff', 500), actor(owner));
});

test('an Enterprise override of 25 branches works and expires on its date', async () => {
  const { mid, owner } = await merchant();
  await moveTo(mid, 'enterprise');
  const admin = await user('platform_admin');
  const override = (
    await db.query(
      "INSERT INTO entitlement_overrides(merchant_id,key,value_type,int_value,reason,expires_at,created_by) VALUES($1,'max_branches','int',25,'Enterprise deal',clock_timestamp()+interval '1 hour',$2) RETURNING id",
      [mid, admin],
    )
  ).rows[0].id;
  assert.equal(
    (await transaction(pools.pool, (t) => getEntitlements(t, mid), actor(owner))).limits
      .max_branches,
    25,
  );
  await db.query(
    "UPDATE entitlement_overrides SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [override],
  );
  assert.equal(
    (await transaction(pools.pool, (t) => getEntitlements(t, mid), actor(owner))).limits
      .max_branches,
    10,
  );
});

test('two parallel creates at the limit: exactly one passes', async () => {
  const { mid, owner } = await merchant();
  await moveTo(mid, 'growth');
  await branches(mid, 1);
  const attempt = () =>
    transaction(
      pools.pool,
      async (t) => {
        await assertCan(t, mid, 'max_branches');
        await new Promise((r) => setTimeout(r, 150));
        await t.query("INSERT INTO branches(merchant_id,name) VALUES($1,'Race')", [mid]);
      },
      actor(owner),
    );
  const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of results)
    if (r.status === 'rejected') assert.equal((r.reason as AppError).code, 'PLAN_LIMIT_REACHED');
  const n = await db.query(
    "SELECT count(*)::int AS n FROM branches WHERE merchant_id=$1 AND status='active'",
    [mid],
  );
  assert.equal(n.rows[0].n, 2);
});

test('manual messages count per Cairo calendar month and stop at the plan allowance', async () => {
  const period = async (at: string) =>
    (await db.query('SELECT usage_period($1::timestamptz) AS p', [at])).rows[0].p;
  // Cairo is UTC+2 at the end of November: 22:00 UTC is midnight on December 1st.
  assert.equal(await period('2026-11-30T21:59:59Z'), '2026-11');
  assert.equal(await period('2026-11-30T22:00:00Z'), '2026-12');
  const { mid, owner } = await merchant();
  await moveTo(mid, 'starter');
  assert.equal(
    await transaction(
      pools.pool,
      (t) => consume(t, mid, 'manual_messages_per_month'),
      actor(owner),
    ),
    1,
  );
  assert.equal(
    await transaction(
      pools.pool,
      (t) => consume(t, mid, 'manual_messages_per_month'),
      actor(owner),
    ),
    2,
  );
  const err = await limitError(() =>
    transaction(pools.pool, (t) => consume(t, mid, 'manual_messages_per_month'), actor(owner)),
  );
  assert.equal(err.code, 'PLAN_LIMIT_REACHED');
  assert.equal(err.details?.used, 2);
  // Last month's sends do not count this month.
  await db.query(
    "UPDATE usage_counters SET period='2000-01' WHERE merchant_id=$1 AND key='manual_messages_per_month'",
    [mid],
  );
  assert.equal(
    await transaction(
      pools.pool,
      (t) => consume(t, mid, 'manual_messages_per_month'),
      actor(owner),
    ),
    1,
  );
});

test('a catalog price change never moves the price an existing merchant locked in', async () => {
  const { mid } = await merchant();
  await moveTo(mid, 'growth');
  await db.query('UPDATE merchant_subscriptions SET price_minor=90000 WHERE merchant_id=$1', [mid]);
  await db.query('BEGIN');
  try {
    await db.query(
      "UPDATE plan_prices SET is_active=false WHERE plan_id=(SELECT id FROM plans WHERE key='growth') AND currency='EGP' AND billing_period='monthly' AND is_active",
    );
    await db.query(
      "INSERT INTO plan_prices(plan_id,currency,billing_period,amount_minor,setup_fee_per_branch_minor) SELECT id,'EGP','monthly',99900,50000 FROM plans WHERE key='growth'",
    );
    const locked = await db.query(
      'SELECT price_minor FROM merchant_subscriptions WHERE merchant_id=$1',
      [mid],
    );
    assert.equal(locked.rows[0].price_minor, 90000);
  } finally {
    await db.query('ROLLBACK');
  }
});

test('RLS: customers see no plans, owners see public plans and only their own subscription, nobody else edits billing', async () => {
  const a = await merchant();
  const b = await merchant();
  const customer = await user();
  const runtime = await pools.pool.connect();
  const as = async <T>(uid: string, fn: () => Promise<T>) => {
    await runtime.query('BEGIN');
    await runtime.query("SELECT set_config('app.user_id',$1,true)", [uid]);
    try {
      return await fn();
    } finally {
      await runtime.query('ROLLBACK');
    }
  };
  try {
    assert.equal((await as(customer, () => runtime.query('SELECT * FROM plans'))).rowCount, 0);
    assert.equal(
      (await as(customer, () => runtime.query('SELECT * FROM plan_prices'))).rowCount,
      0,
    );
    const ownerPlans = await as(a.owner, () =>
      runtime.query('SELECT key FROM plans ORDER BY sort_order'),
    );
    assert.deepEqual(
      ownerPlans.rows.map((r) => r.key),
      ['starter', 'growth', 'pro', 'scale', 'enterprise'],
    );
    const subs = await as(a.owner, () =>
      runtime.query('SELECT merchant_id FROM merchant_subscriptions'),
    );
    assert.deepEqual(
      subs.rows.map((r) => r.merchant_id),
      [a.mid],
    );
    const edit = await as(a.owner, () =>
      runtime.query('UPDATE merchant_subscriptions SET price_minor=0 WHERE merchant_id=$1', [
        a.mid,
      ]),
    );
    assert.equal(edit.rowCount, 0);
    await assert.rejects(
      as(a.owner, () =>
        runtime.query(
          "INSERT INTO usage_counters(merchant_id,key,period,count) VALUES($1,'manual_messages_per_month','2026-11',0)",
          [a.mid],
        ),
      ),
      /permission denied/,
    );
    await assert.rejects(
      as(a.owner, () => runtime.query('SELECT effective_entitlements($1)', [b.mid])),
      /NQ:NOT_FOUND/,
    );
    await assert.rejects(
      as(customer, () =>
        runtime.query('SELECT assert_entitlement($1,$2,1)', [a.mid, 'max_branches']),
      ),
      /NQ:NOT_FOUND/,
    );
  } finally {
    runtime.release();
  }
});

test('an entitlement value of the wrong shape is refused by the database', async () => {
  const { mid } = await merchant();
  await assert.rejects(
    db.query(
      "INSERT INTO entitlement_overrides(merchant_id,key,value_type,bool_value,reason) VALUES($1,'max_branches','bool',true,'Bad shape')",
      [mid],
    ),
    /check constraint/,
  );
  await assert.rejects(
    db.query(
      "INSERT INTO entitlement_overrides(merchant_id,key,value_type,int_value,reason) VALUES($1,'white_label','int',1,'Not a plan feature')",
      [mid],
    ),
    /check constraint/,
  );
});

test('the billing calendar: period end → past_due, 7 days later → grace, cancel → cancelled, never an automatic suspension', async () => {
  const worker = new pg.Client({ connectionString: c.WORKER_DATABASE_URL });
  await worker.connect();
  try {
    const status = async (mid: string) =>
      (await db.query('SELECT status FROM merchant_subscriptions WHERE merchant_id=$1', [mid]))
        .rows[0].status;
    const run = () => worker.query('SELECT advance_subscription_states()');
    const lapsed = await merchant();
    await moveTo(lapsed.mid, 'growth');
    await db.query(
      "UPDATE merchant_subscriptions SET current_period_start=clock_timestamp()-interval '31 days',current_period_end=clock_timestamp()-interval '1 hour' WHERE merchant_id=$1",
      [lapsed.mid],
    );
    const trial = await merchant();
    await moveTo(trial.mid, 'growth');
    await db.query(
      "UPDATE merchant_subscriptions SET status='trialing',trial_ends_at=clock_timestamp()-interval '1 minute' WHERE merchant_id=$1",
      [trial.mid],
    );
    const leaving = await merchant();
    await moveTo(leaving.mid, 'pro');
    await db.query(
      "UPDATE merchant_subscriptions SET cancel_at_period_end=true,current_period_end=clock_timestamp()-interval '1 minute' WHERE merchant_id=$1",
      [leaving.mid],
    );
    const pilot = await merchant();
    await run();
    assert.equal(await status(lapsed.mid), 'past_due');
    assert.equal(await status(trial.mid), 'past_due');
    assert.equal(await status(leaving.mid), 'cancelled');
    assert.equal(await status(pilot.mid), 'active', 'a pilot with no billing date never lapses');
    await run();
    assert.equal(await status(lapsed.mid), 'past_due', 'not grace before 7 days');
    await db.query(
      "UPDATE merchant_subscriptions SET past_due_since=clock_timestamp()-interval '8 days' WHERE merchant_id=$1",
      [lapsed.mid],
    );
    await run();
    assert.equal(await status(lapsed.mid), 'grace');
    await db.query(
      "UPDATE merchant_subscriptions SET past_due_since=clock_timestamp()-interval '40 days' WHERE merchant_id=$1",
      [lapsed.mid],
    );
    await run();
    assert.equal(await status(lapsed.mid), 'grace', 'suspension is a Super Admin decision');
    assert.equal(
      (await db.query('SELECT status FROM merchants WHERE id=$1', [lapsed.mid])).rows[0].status,
      'active',
    );
    const events = await db.query(
      "SELECT after->>'status' AS s FROM subscription_events WHERE merchant_id=$1 AND event_type='subscription.status_changed' ORDER BY created_at",
      [lapsed.mid],
    );
    assert.deepEqual(
      events.rows.map((r) => r.s),
      ['past_due', 'grace'],
    );
  } finally {
    await worker.end();
  }
});
