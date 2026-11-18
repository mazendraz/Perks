import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed } from '../../db/seed.js';
import { login, adminLogin, key } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  worker = new pg.Client({ connectionString: c.WORKER_DATABASE_URL });
const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let admin: Awaited<ReturnType<typeof login>>;
before(async () => {
  await db.connect();
  await worker.connect();
  await seed(db);
  await app.ready();
  admin = await adminLogin(app, db);
});
after(async () => {
  await app.close();
  await worker.end();
  await db.end();
});
const date = (days = 0) => businessDate('Africa/Cairo', new Date(Date.now() + days * 86400000));

type Headers = Awaited<ReturnType<typeof login>>;
// Login is rate limited per address, so only the tests that act as the owner sign in.
async function shop(plan: string, branchCount = 1, signIn = false) {
  const email = 'billing-admin-' + randomUUID() + '@nuqta.test';
  let owner = {} as Headers;
  if (signIn) owner = await login(app, email);
  else await db.query("INSERT INTO users(email,display_name) VALUES($1,'Owner')", [email]);
  const uid = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  const mid = (
    await db.query("INSERT INTO merchants(slug,name) VALUES($1,'Billing admin') RETURNING id", [
      'bad-' + randomUUID().slice(0, 20),
    ])
  ).rows[0].id as string;
  await db.query(
    "INSERT INTO feature_entitlements(merchant_id,plan,max_branches,max_staff,max_programs,max_customers) VALUES($1,'growth',10,40,10,3000)",
    [mid],
  );
  const sid = (
    await db.query(
      "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,'Owner','owner') RETURNING id",
      [mid, uid, email],
    )
  ).rows[0].id;
  const branches: string[] = [];
  for (let i = 0; i < branchCount; i++) {
    const b = (
      await db.query(
        'INSERT INTO branches(merchant_id,name,created_at) VALUES($1,$2,clock_timestamp()+make_interval(secs=>$3)) RETURNING id',
        [mid, 'Branch ' + (i + 1), i],
      )
    ).rows[0].id as string;
    branches.push(b);
    await db.query(
      'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
      [mid, sid, b],
    );
  }
  await db.query(
    'UPDATE entitlement_overrides SET revoked_at=clock_timestamp() WHERE merchant_id=$1 AND revoked_at IS NULL',
    [mid],
  );
  await db.query(
    `UPDATE merchant_subscriptions SET plan_id=(SELECT id FROM plans WHERE key=$2),
      price_minor=coalesce((SELECT amount_minor FROM plan_prices x JOIN plans p ON p.id=x.plan_id WHERE p.key=$2 AND x.billing_period='monthly' AND x.is_active),600000),
      status='active',trial_ends_at=NULL,
      current_period_start=clock_timestamp()-interval '25 days',current_period_end=clock_timestamp()+interval '5 days' WHERE merchant_id=$1`,
    [mid, plan],
  );
  return { mid, owner, branches };
}
const billing = async (mid: string) =>
  (
    await app.inject({ url: '/api/v1/platform/merchants/' + mid + '/billing', headers: admin })
  ).json();
async function write(
  mid: string,
  path: string,
  payload: Record<string, unknown>,
  method: 'POST' | 'PUT' = 'POST',
  as: Headers = admin,
) {
  const rev = (await billing(mid)).subscription.revision;
  return app.inject({
    method,
    url: '/api/v1/platform/merchants/' + mid + '/billing' + path,
    headers: { ...as, ...key(), 'if-match': String(rev) },
    payload,
  });
}

test('acceptance 6: Pro → Growth with 4 branches waits for the billing date, then keeps 2 active and locks 2 without deleting anything', async () => {
  const s = await shop('pro', 4, true);
  const scheduled = await write(s.mid, '/plan', {
    plan: 'growth',
    billingPeriod: 'monthly',
    effective: 'period_end',
    reason: 'Owner asked to move down',
  });
  assert.equal(scheduled.statusCode, 200, scheduled.body);
  let b = scheduled.json().billing;
  assert.equal(b.subscription.plan, 'pro');
  assert.equal(b.subscription.pendingPlan, 'growth');
  assert.ok(b.subscription.pendingEffectiveAt);
  assert.equal(b.entitlements.limits.max_branches, 4, 'nothing changes before the date');
  // The owner picks the two newest to keep (Phase 4 asks the owner in the app).
  for (const id of [s.branches[2], s.branches[3]])
    await db.query(
      "INSERT INTO plan_keep_choices(merchant_id,kind,item_id) VALUES($1,'branch',$2)",
      [s.mid, id],
    );
  await db.query(
    "UPDATE merchant_subscriptions SET pending_effective_at=clock_timestamp()-interval '1 second' WHERE merchant_id=$1",
    [s.mid],
  );
  await worker.query('SELECT advance_subscription_states()');
  b = await billing(s.mid);
  assert.equal(b.subscription.plan, 'growth');
  assert.equal(b.subscription.pendingPlan, null);
  assert.equal(b.subscription.priceMinor, 90000);
  const rows = (
    await db.query(
      'SELECT id,status,locked_at FROM branches WHERE merchant_id=$1 ORDER BY created_at',
      [s.mid],
    )
  ).rows;
  assert.equal(rows.length, 4, 'no branch was deleted');
  assert.deepEqual(
    rows.map((r) => [r.status, r.locked_at !== null]),
    [
      ['disabled', true],
      ['disabled', true],
      ['active', false],
      ['active', false],
    ],
  );
  assert.deepEqual(
    b.locked.map((x: { kind: string }) => x.kind),
    ['branch', 'branch'],
  );
  // The owner hits the lock as a clear message, not a missing branch.
  const award = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + s.mid + '/branches',
    headers: { ...s.owner, ...key() },
    payload: { name: 'One more' },
  });
  assert.equal(award.statusCode, 409);
  assert.equal(award.json().error.code, 'PLAN_LIMIT_REACHED');
  // Upgrading right away gives the slots back.
  const up = await write(s.mid, '/plan', {
    plan: 'pro',
    billingPeriod: 'monthly',
    effective: 'now',
    reason: 'Owner upgraded again',
  });
  assert.equal(up.statusCode, 200, up.body);
  assert.equal(up.json().result.unlocked.length, 2);
  const active = await db.query(
    "SELECT count(*)::int AS n FROM branches WHERE merchant_id=$1 AND status='active' AND locked_at IS NULL",
    [s.mid],
  );
  assert.equal(active.rows[0].n, 4);
});

test('a cashier on a locked branch is told the branch is locked', async () => {
  const s = await shop('growth', 3, true);
  const email = 'locked-cashier-' + randomUUID() + '@nuqta.test',
    cashier = await login(app, email);
  const uid = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  const sid = (
    await db.query(
      "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,'Cashier','cashier') RETURNING id",
      [s.mid, uid, email],
    )
  ).rows[0].id;
  await db.query(
    'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
    [s.mid, sid, s.branches[2]],
  );
  const r = await write(s.mid, '/plan', {
    plan: 'growth',
    billingPeriod: 'monthly',
    effective: 'now',
    reason: 'Rebalance',
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().result.locked.length, 1);
  const queue = await app.inject({
    url: '/api/v1/merchants/' + s.mid + '/stamp-requests?branchId=' + s.branches[2],
    headers: cashier,
  });
  assert.equal(queue.statusCode, 409, queue.body);
  assert.equal(queue.json().error.code, 'BRANCH_LOCKED');
  const open = await app.inject({
    url: '/api/v1/merchants/' + s.mid + '/stamp-requests?branchId=' + s.branches[0],
    headers: s.owner,
  });
  assert.equal(open.statusCode, 200, open.body);
  const policy = await db.query(
    'SELECT status,locked_at IS NOT NULL AS locked FROM branches WHERE id=$1',
    [s.branches[2]],
  );
  assert.deepEqual(policy.rows[0], { status: 'disabled', locked: true });
});

test('acceptance 9: recording a payment moves the billing date forward, clears past due and writes an audit event', async () => {
  const s = await shop('growth');
  await db.query(
    "UPDATE merchant_subscriptions SET status='past_due',past_due_since=clock_timestamp()-interval '2 days',current_period_end=clock_timestamp()-interval '2 days' WHERE merchant_id=$1",
    [s.mid],
  );
  const state = (
    await app.inject({
      url: '/api/v1/platform/merchants/' + s.mid + '/subscription',
      headers: admin,
    })
  ).json();
  const paid = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/merchants/' + s.mid + '/subscription/payments',
    headers: { ...admin, ...key(), 'if-match': String(state.revision) },
    payload: {
      amountMinor: 90000,
      method: 'instapay',
      periodStart: date(0),
      periodEnd: date(30),
      reference: 'IP-' + randomUUID().slice(0, 8),
      reason: 'Monthly renewal',
    },
  });
  assert.equal(paid.statusCode, 200, paid.body);
  const b = await billing(s.mid);
  assert.equal(b.subscription.status, 'active');
  assert.equal(b.subscription.pastDueSince, null);
  assert.ok(Date.parse(b.subscription.currentPeriodEnd) > Date.now() + 29 * 86400000);
  const ev = b.events.find(
    (e: { event_type: string }) => e.event_type === 'subscription.payment_recorded',
  );
  assert.ok(ev, 'payment event written');
  assert.equal(ev.before.status, 'past_due');
  assert.equal(ev.after.status, 'active');
  assert.ok(ev.actor_name);
});

test('acceptance 10: a catalog price change leaves existing merchants on their price unless the admin applies it', async () => {
  const s = await shop('starter');
  const plans = (await app.inject({ url: '/api/v1/platform/plans', headers: admin })).json().plans;
  const starter = plans.find((p: { key: string }) => p.key === 'starter');
  const body = (amount: number, apply: boolean) => ({
    nameAr: starter.name_ar,
    nameEn: starter.name_en,
    isPublic: true,
    isActive: true,
    prices: [
      {
        currency: 'EGP',
        billingPeriod: 'monthly',
        amountMinor: amount,
        setupFeePerBranchMinor: 50000,
      },
    ],
    entitlements: [],
    addons: [],
    applyPriceToExisting: apply,
    reason: 'Price review',
  });
  const put = async (amount: number, apply: boolean) => {
    const rev = (await app.inject({ url: '/api/v1/platform/plans', headers: admin }))
      .json()
      .plans.find((p: { key: string }) => p.key === 'starter').revision;
    return app.inject({
      method: 'PUT',
      url: '/api/v1/platform/plans/starter',
      headers: { ...admin, ...key(), 'if-match': String(rev) },
      payload: body(amount, apply),
    });
  };
  try {
    const keep = await put(60000, false);
    assert.equal(keep.statusCode, 200, keep.body);
    assert.ok(keep.json().affectedMerchants >= 1);
    assert.equal((await billing(s.mid)).subscription.priceMinor, 50000);
    const apply = await put(65000, true);
    assert.equal(apply.statusCode, 200, apply.body);
    assert.equal((await billing(s.mid)).subscription.priceMinor, 65000);
    const history = await db.query(
      "SELECT count(*)::int AS n FROM plan_prices x JOIN plans p ON p.id=x.plan_id WHERE p.key='starter' AND x.billing_period='monthly'",
    );
    assert.ok(history.rows[0].n >= 3, 'old prices are kept as history');
  } finally {
    await put(50000, false);
  }
});

test('add-ons follow the plan: none on Starter, and Scale never passes 10 branches', async () => {
  const starter = await shop('starter');
  const r1 = await write(
    starter.mid,
    '/addons/extra_branch',
    { quantity: 1, reason: 'Wants a second branch' },
    'PUT',
  );
  assert.equal(r1.statusCode, 409);
  assert.equal(r1.json().error.code, 'ADDON_NOT_IN_PLAN');
  const scale = await shop('scale');
  const r2 = await write(
    scale.mid,
    '/addons/extra_branch',
    { quantity: 1, reason: 'Eleventh branch' },
    'PUT',
  );
  assert.equal(r2.statusCode, 409);
  assert.equal(r2.json().error.code, 'ADDON_CAP_REACHED');
  const growth = await shop('growth');
  const r3 = await write(
    growth.mid,
    '/addons/extra_branch',
    { quantity: 2, reason: 'Two more branches' },
    'PUT',
  );
  assert.equal(r3.statusCode, 200, r3.body);
  assert.equal(r3.json().billing.entitlements.limits.max_branches, 4);
});

test('acceptance 5 through the admin API: an Enterprise override of 25 branches, then revoked', async () => {
  const s = await shop('enterprise');
  const set = await write(s.mid, '/overrides', {
    value: { key: 'max_branches', type: 'int', value: 25 },
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    reason: 'Enterprise contract',
  });
  assert.equal(set.statusCode, 200, set.body);
  assert.equal(set.json().billing.entitlements.limits.max_branches, 25);
  const revoke = await write(s.mid, '/overrides/' + set.json().id + '/revoke', {
    reason: 'Contract ended',
  });
  assert.equal(revoke.statusCode, 200, revoke.body);
  assert.equal(revoke.json().billing.entitlements.limits.max_branches, 10);
  const bad = await write(s.mid, '/overrides', {
    value: { key: 'white_label', type: 'bool', value: true },
    expiresAt: null,
    reason: 'Not a plan feature',
  });
  assert.equal(bad.statusCode, 422);
});

test('trial and cancel: a 14-day trial on Growth, then cancel at period end', async () => {
  const s = await shop('starter');
  const trial = await write(s.mid, '/trial', { plan: 'growth', days: 14, reason: 'Sales trial' });
  assert.equal(trial.statusCode, 200, trial.body);
  const t = trial.json().billing.subscription;
  assert.equal(t.status, 'trialing');
  assert.equal(t.plan, 'growth');
  assert.ok(Math.abs(Date.parse(t.trialEndsAt) - Date.now() - 14 * 86400000) < 60000);
  const cancel = await write(s.mid, '/cancel', { atPeriodEnd: true, reason: 'Closing the shop' });
  assert.equal(cancel.statusCode, 200, cancel.body);
  assert.equal(cancel.json().billing.subscription.cancelAtPeriodEnd, true);
  const back = await write(s.mid, '/reactivate', { reason: 'Changed their mind' });
  assert.equal(back.json().billing.subscription.cancelAtPeriodEnd, false);
});

test('only the platform team reaches billing: owners get 403 and stale revisions conflict', async () => {
  const s = await shop('growth', 1, true);
  const asOwner = await app.inject({
    url: '/api/v1/platform/merchants/' + s.mid + '/billing',
    headers: s.owner,
  });
  assert.equal(asOwner.statusCode, 403);
  const plans = await app.inject({ url: '/api/v1/platform/plans', headers: s.owner });
  assert.equal(plans.statusCode, 403);
  const stale = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/merchants/' + s.mid + '/billing/plan',
    headers: { ...admin, ...key(), 'if-match': '999' },
    payload: { plan: 'pro', billingPeriod: 'monthly', effective: 'now', reason: 'Stale screen' },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, 'REVISION_CONFLICT');
});

test('the billing overview counts MRR at locked prices, annual as a twelfth', async () => {
  const monthly = await shop('pro');
  const annual = await shop('pro');
  await db.query(
    "UPDATE merchant_subscriptions SET billing_period='annual',price_minor=1500000 WHERE merchant_id=$1",
    [annual.mid],
  );
  const o = (await app.inject({ url: '/api/v1/platform/billing/overview', headers: admin })).json();
  const pro = o.mrr.find((r: { plan: string }) => r.plan === 'pro');
  assert.ok(pro.merchants >= 2);
  const own = await db.query(
    `SELECT sum(CASE billing_period WHEN 'annual' THEN price_minor/12.0 ELSE price_minor END)::bigint AS v
     FROM merchant_subscriptions WHERE merchant_id=ANY($1)`,
    [[monthly.mid, annual.mid]],
  );
  assert.equal(Number(own.rows[0].v), 150000 + 125000);
  assert.ok(o.renewalsDue.some((r: { id: string }) => r.id === monthly.mid));
  assert.ok(Array.isArray(o.byStatus));
});
