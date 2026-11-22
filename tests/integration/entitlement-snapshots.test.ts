import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { seed, ids } from '../../db/seed.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });

before(async () => {
  await db.connect();
  await seed(db);
});
after(async () => {
  await db.end();
});

const planId = async (key: string) =>
  (await db.query('SELECT id FROM plans WHERE key=$1', [key])).rows[0].id as string;
const effective = async (k: string) => {
  const r = (
    await db.query('SELECT * FROM entitlements_effective_rows($1) WHERE key=$2', [ids.merchantA, k])
  ).rows[0];
  return r.value_type === 'unlimited' ? Infinity : (r.int_value ?? r.enum_value ?? r.bool_value);
};
const setCatalog = (plan: string, k: string, v: number) =>
  db.query('UPDATE plan_entitlements SET int_value=$3 WHERE plan_id=$1 AND key=$2', [plan, k, v]);
const subscribe = (plan: string, endsInDays: number) =>
  db.query(
    "UPDATE merchant_subscriptions SET plan_id=$2,status='active',current_period_start=now()-interval '1 day',current_period_end=now()+$3*interval '1 day',pending_plan_id=NULL WHERE merchant_id=$1",
    [ids.merchantA, plan, endsInDays],
  );

test('every plan gets the full analytics page for now', async () => {
  const levels = (
    await db.query("SELECT DISTINCT enum_value FROM plan_entitlements WHERE key='analytics_level'")
  ).rows.map((r) => r.enum_value);
  assert.deepEqual(levels, ['advanced']);
  assert.equal(await effective('analytics_level'), 'advanced');
});

const catalogValue = async (plan: string, k: string) =>
  (await db.query('SELECT int_value FROM plan_entitlements WHERE plan_id=$1 AND key=$2', [plan, k]))
    .rows[0].int_value as number;
// Each test puts the subscription and the catalog back the way it found them: later test files
// in the same run read the same rows.
async function preserving(fn: () => Promise<void>) {
  const saved = (
    await db.query('SELECT * FROM merchant_subscriptions WHERE merchant_id=$1', [ids.merchantA])
  ).rows[0];
  const catalog = (await db.query('SELECT plan_id,key,int_value FROM plan_entitlements')).rows;
  const overrides = (
    await db.query(
      'SELECT id,revoked_at,revoked_by FROM entitlement_overrides WHERE merchant_id=$1',
      [ids.merchantA],
    )
  ).rows;
  try {
    await fn();
  } finally {
    for (const r of catalog)
      await db.query('UPDATE plan_entitlements SET int_value=$3 WHERE plan_id=$1 AND key=$2', [
        r.plan_id,
        r.key,
        r.int_value,
      ]);
    await db.query('DELETE FROM entitlement_overrides WHERE merchant_id=$1 AND reason=$2', [
      ids.merchantA,
      'snapshot test',
    ]);
    for (const o of overrides)
      await db.query('UPDATE entitlement_overrides SET revoked_at=$2,revoked_by=$3 WHERE id=$1', [
        o.id,
        o.revoked_at,
        o.revoked_by,
      ]);
    await db.query(
      'UPDATE merchant_subscriptions SET plan_id=$2,status=$3,current_period_start=$4,current_period_end=$5,trial_ends_at=$6,pending_plan_id=$7 WHERE merchant_id=$1',
      [
        ids.merchantA,
        saved.plan_id,
        saved.status,
        saved.current_period_start,
        saved.current_period_end,
        saved.trial_ends_at,
        saved.pending_plan_id,
      ],
    );
    await db.query(
      'UPDATE merchant_subscriptions SET entitlements_snapshot=$2,snapshot_until=$3 WHERE merchant_id=$1',
      [ids.merchantA, saved.entitlements_snapshot, saved.snapshot_until],
    );
  }
}

const clearOverrides = () =>
  db.query(
    'UPDATE entitlement_overrides SET revoked_at=now(),revoked_by=$2 WHERE merchant_id=$1 AND revoked_at IS NULL',
    [ids.merchantA, ids.admin],
  );

test('a catalog cut waits for the end of the period; renewal brings the plan as it is then', () =>
  preserving(async () => {
    const growth = await planId('growth');
    await clearOverrides();
    await subscribe(growth, 20);
    const before = (await effective('manual_messages_per_month')) as number;
    assert.equal(before, await catalogValue(growth, 'manual_messages_per_month'));
    await setCatalog(growth, 'manual_messages_per_month', 1);
    assert.equal(
      await effective('manual_messages_per_month'),
      before,
      'kept until the period ends',
    );
    // The period ran out without renewal: today's plan applies.
    await db.query(
      "UPDATE merchant_subscriptions SET snapshot_until=now()-interval '1 minute' WHERE merchant_id=$1",
      [ids.merchantA],
    );
    assert.equal(await effective('manual_messages_per_month'), 1);
    // Renewal snapshots the plan as it is now.
    await db.query(
      "UPDATE merchant_subscriptions SET current_period_end=now()+interval '30 days' WHERE merchant_id=$1",
      [ids.merchantA],
    );
    assert.equal(await effective('manual_messages_per_month'), 1);
  }));

test('a plan change the shop chose applies at once, up or down', () =>
  preserving(async () => {
    const [growth, pro, starter] = [
      await planId('growth'),
      await planId('pro'),
      await planId('starter'),
    ];
    await clearOverrides();
    await subscribe(growth, 20);
    const growthStaff = (await effective('manual_messages_per_month')) as number;
    await db.query('UPDATE merchant_subscriptions SET plan_id=$2 WHERE merchant_id=$1', [
      ids.merchantA,
      pro,
    ]);
    const proStaff = (await effective('manual_messages_per_month')) as number;
    assert.ok(proStaff > growthStaff);
    await db.query('UPDATE merchant_subscriptions SET plan_id=$2 WHERE merchant_id=$1', [
      ids.merchantA,
      starter,
    ]);
    assert.equal(
      await effective('manual_messages_per_month'),
      await catalogValue(starter, 'manual_messages_per_month'),
    );
  }));

test('overrides still win over the plan and its snapshot', () =>
  preserving(async () => {
    await subscribe(await planId('growth'), 20);
    await db.query(
      "UPDATE entitlement_overrides SET revoked_at=now(),revoked_by=$2 WHERE merchant_id=$1 AND key='max_branches' AND revoked_at IS NULL",
      [ids.merchantA, ids.admin],
    );
    await db.query(
      "INSERT INTO entitlement_overrides(merchant_id,key,value_type,int_value,reason,created_by) VALUES($1,'max_branches','int',7,'snapshot test',$2)",
      [ids.merchantA, ids.admin],
    );
    assert.equal(await effective('max_branches'), 7);
  }));
