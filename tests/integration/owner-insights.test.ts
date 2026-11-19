import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { login, adminLogin } from '../helpers.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let owner: Awaited<ReturnType<typeof login>>,
  cashier: typeof owner,
  other: typeof owner,
  admin: typeof owner;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  owner = await login(app, 'owner@bunn.test');
  cashier = await login(app, 'cashier@bunn.test');
  other = await login(app, 'owner@lamsa.test');
  admin = await adminLogin(app, db);
});
after(async () => {
  await app.close();
  await db.end();
});
const base = '/api/v1/merchants/' + ids.merchantA;

test('team activity is for owners and managers of that shop only', async () => {
  const r = await app.inject({ url: base + '/staff-activity?days=7', headers: owner });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.days, 7);
  assert.equal(body.burstThreshold, 10);
  assert.ok(Array.isArray(body.staff) && body.staff.length > 0);
  for (const s of body.staff) {
    for (const k of ['visits', 'stamps', 'rewards', 'peak_ten_minutes', 'approved', 'rejected'])
      assert.equal(typeof s[k], 'number', k);
  }
  assert.equal(
    (await app.inject({ url: base + '/staff-activity', headers: cashier })).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: base + '/staff-activity', headers: other })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: base + '/staff-activity?days=3', headers: owner })).statusCode,
    422,
  );
});

test('today summary works for cashiers and owners, and stays inside the shop', async () => {
  for (const h of [owner, cashier]) {
    const r = await app.inject({ url: base + '/today', headers: h });
    assert.equal(r.statusCode, 200, r.body);
    const t = r.json();
    assert.equal(typeof t.pendingRequests, 'number');
    assert.equal(typeof t.rewardsReady, 'number');
    assert.equal(typeof t.today.stamps, 'number');
    assert.equal(typeof t.mine.visits, 'number');
  }
  assert.equal((await app.inject({ url: base + '/today', headers: other })).statusCode, 404);
});

test('platform business list carries recent purchase activity', async () => {
  const r = await app.inject({ url: '/api/v1/platform/merchants', headers: admin });
  assert.equal(r.statusCode, 200, r.body);
  const m = r.json().merchants.find((x: { id: string }) => x.id === ids.merchantA);
  assert.ok(m);
  assert.equal(typeof m.visits_7d, 'number');
  assert.ok('last_purchase_at' in m);
});
