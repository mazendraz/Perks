import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed } from '../../db/seed.js';
import { login, key } from '../helpers.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
});
after(async () => {
  await app.close();
  await db.end();
});

type Headers = Awaited<ReturnType<typeof login>>;
async function staff(mid: string, role: 'owner' | 'manager', branchIds: string[]) {
  const email = 'enf-' + role + '-' + randomUUID() + '@nuqta.test',
    headers = await login(app, email);
  const uid = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  const sid = (
    await db.query(
      'INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [mid, uid, email, role, role],
    )
  ).rows[0].id;
  for (const b of branchIds)
    await db.query(
      'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
      [mid, sid, b],
    );
  return headers;
}
async function shop(plan: string) {
  const mid = (
    await db.query("INSERT INTO merchants(slug,name) VALUES($1,'Enforcement') RETURNING id", [
      'enf-' + randomUUID().slice(0, 20),
    ])
  ).rows[0].id as string;
  const first = (
    await db.query("INSERT INTO branches(merchant_id,name) VALUES($1,'First') RETURNING id", [mid])
  ).rows[0].id as string;
  await db.query(
    "INSERT INTO feature_entitlements(merchant_id,plan,max_branches,max_staff,max_programs,max_customers) VALUES($1,'growth',3,10,3,3000)",
    [mid],
  );
  await db.query(
    'UPDATE entitlement_overrides SET revoked_at=clock_timestamp() WHERE merchant_id=$1 AND revoked_at IS NULL',
    [mid],
  );
  await db.query(
    'UPDATE merchant_subscriptions SET plan_id=(SELECT id FROM plans WHERE key=$2) WHERE merchant_id=$1',
    [mid, plan],
  );
  const owner = await staff(mid, 'owner', [first]);
  return { mid, first, owner };
}
const createBranch = (mid: string, headers: Headers, name = 'Branch ' + randomUUID().slice(0, 6)) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/branches',
    headers: { ...headers, ...key() },
    payload: { name },
  });

test('acceptance 1: a 3rd branch on Growth answers PLAN_LIMIT_REACHED with an add-on and an upgrade, and the add-on unlocks it', async () => {
  const s = await shop('growth');
  assert.equal((await createBranch(s.mid, s.owner)).statusCode, 200);
  const blocked = await createBranch(s.mid, s.owner);
  assert.equal(blocked.statusCode, 409, blocked.body);
  const error = blocked.json().error;
  assert.equal(error.code, 'PLAN_LIMIT_REACHED');
  assert.equal(error.entitlement, 'max_branches');
  assert.equal(error.limit, 2);
  assert.equal(error.used, 2);
  assert.deepEqual(error.options, [
    { type: 'addon', key: 'extra_branch', price: 400, currency: 'EGP' },
    { type: 'upgrade', plan: 'pro', price: 1500, currency: 'EGP' },
  ]);
  await db.query(
    "INSERT INTO subscription_addons(merchant_id,key,quantity,unit_amount_minor) VALUES($1,'extra_branch',1,40000)",
    [s.mid],
  );
  assert.equal((await createBranch(s.mid, s.owner)).statusCode, 200);
});

test('acceptance 2: parallel branch creates at the limit through the API — exactly one succeeds', async () => {
  const s = await shop('growth');
  const results = await Promise.all([1, 2, 3, 4].map(() => createBranch(s.mid, s.owner)));
  assert.deepEqual(
    results.map((r) => r.statusCode).sort(),
    [200, 409, 409, 409],
    results.map((r) => r.body).join('\n'),
  );
  const n = await db.query(
    "SELECT count(*)::int AS n FROM branches WHERE merchant_id=$1 AND status='active'",
    [s.mid],
  );
  assert.equal(n.rows[0].n, 2);
});

test('acceptance 3: Starter has no extra-branch add-on; the only option is an upgrade', async () => {
  const s = await shop('starter');
  const blocked = await createBranch(s.mid, s.owner);
  assert.equal(blocked.statusCode, 409);
  assert.deepEqual(blocked.json().error.options, [
    { type: 'upgrade', plan: 'growth', price: 900, currency: 'EGP' },
  ]);
});

test('a manager stopped by the plan sees what fixes it, never a price', async () => {
  const s = await shop('starter');
  const manager = await staff(s.mid, 'manager', [s.first]);
  const segment = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + s.mid + '/segments',
    headers: { ...manager, ...key() },
    payload: { name: 'Regulars', segment: 'all' },
  });
  assert.equal(segment.statusCode, 409, segment.body);
  const error = segment.json().error;
  assert.equal(error.code, 'FEATURE_NOT_IN_PLAN');
  assert.deepEqual(error.options, [{ type: 'upgrade', plan: 'growth' }]);
  assert.doesNotMatch(segment.body, /price|currency|EGP|900/);
});

test('owners are free: the owner invitation never uses a staff slot, cashiers do', async () => {
  const s = await shop('starter');
  const invite = (role: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/merchants/' + s.mid + '/invitations',
      headers: { ...s.owner, ...key() },
      payload: {
        email: 'enf-invite-' + randomUUID() + '@nuqta.test',
        role,
        maxQty: 3,
        branchIds: [s.first],
      },
    });
  for (let i = 0; i < 3; i++) assert.equal((await invite('cashier')).statusCode, 200);
  const fourth = await invite('cashier');
  assert.equal(fourth.statusCode, 409, fourth.body);
  assert.equal(fourth.json().error.code, 'PLAN_LIMIT_REACHED');
  assert.equal(fourth.json().error.used, 3);
});

test('acceptance 8: grace stops new branches but never customer earning; past_due changes nothing for creation', async () => {
  const s = await shop('pro');
  await db.query("UPDATE merchant_subscriptions SET status='past_due' WHERE merchant_id=$1", [
    s.mid,
  ]);
  assert.equal((await createBranch(s.mid, s.owner)).statusCode, 200);
  await db.query("UPDATE merchant_subscriptions SET status='grace' WHERE merchant_id=$1", [s.mid]);
  const blocked = await createBranch(s.mid, s.owner);
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error.code, 'SUBSCRIPTION_GRACE');
  const earning = await db.query('SELECT merchant_earning_allowed($1) AS ok', [s.mid]);
  assert.equal(earning.rows[0].ok, true);
});

test('re-opening a disabled branch takes a plan slot again', async () => {
  const s = await shop('growth');
  const second = (await createBranch(s.mid, s.owner)).json().branch;
  const patch = (status: string, revision: number) =>
    app.inject({
      method: 'PATCH',
      url: '/api/v1/merchants/' + s.mid + '/branches/' + second.id,
      headers: { ...s.owner, 'if-match': String(revision) },
      payload: { name: second.name, address: '', status, reason: 'Synthetic change' },
    });
  const disabled = await patch('disabled', second.revision);
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal((await createBranch(s.mid, s.owner)).statusCode, 200);
  const reopened = await patch('active', disabled.json().branch.revision);
  assert.equal(reopened.statusCode, 409, reopened.body);
  assert.equal(reopened.json().error.code, 'PLAN_LIMIT_REACHED');
});
