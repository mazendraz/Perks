import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { adminLogin, key, login } from '../helpers.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
type Headers = Awaited<ReturnType<typeof login>>;
let owner: Headers, cashier: Headers, otherOwner: Headers, admin: Headers;
const url = '/api/v1/merchants/' + ids.merchantA + '/cadence';

before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  owner = await login(app, 'owner@bunn.test');
  cashier = await login(app, 'cashier@bunn.test');
  otherOwner = await login(app, 'owner@lamsa.test');
  admin = await adminLogin(app, db);
});
after(async () => {
  await app.close();
  await db.end();
});

const put = (headers: Headers, payload: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url, headers: { ...headers, ...key() }, payload });

test('every category has sane defaults and a shop starts on its category numbers', async () => {
  const r = await app.inject({ url, headers: owner });
  assert.equal(r.statusCode, 200, r.body);
  const cadence = r.json();
  assert.equal(cadence.defaults.length, 10);
  for (const d of cadence.defaults)
    assert.ok(d.expectedGapDays < d.atRiskAfterDays && d.atRiskAfterDays < d.lostAfterDays);
  const mine = cadence.defaults.find((d: { category: string }) => d.category === cadence.category);
  assert.deepEqual(
    [cadence.gap, cadence.risk, cadence.lost, cadence.customized],
    [mine.expectedGapDays, mine.atRiskAfterDays, mine.lostAfterDays, false],
  );
});

test('owner picks a category, then their own numbers, then goes back to the defaults', async () => {
  let r = await put(owner, { category: 'barber', expectedGapDays: null, lostAfterDays: null });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(
    [r.json().category, r.json().confirmed, r.json().gap, r.json().risk, r.json().lost],
    ['barber', true, 28, 42, 90],
  );
  // Only the normal gap: late and gone follow from it.
  r = await put(owner, { category: 'barber', expectedGapDays: 20, lostAfterDays: null });
  assert.deepEqual(
    [r.json().gap, r.json().risk, r.json().lost, r.json().customized],
    [20, 30, 60, true],
  );
  r = await put(owner, { category: 'barber', expectedGapDays: 20, lostAfterDays: 75 });
  assert.deepEqual([r.json().gap, r.json().risk, r.json().lost], [20, 30, 75]);
  r = await put(owner, { category: 'cafe', expectedGapDays: null, lostAfterDays: null });
  assert.deepEqual(
    [r.json().gap, r.json().risk, r.json().lost, r.json().customized],
    [7, 14, 45, false],
  );
});

test('numbers must grow from normal to gone', async () => {
  const r = await put(owner, { category: 'cafe', expectedGapDays: 30, lostAfterDays: 20 });
  assert.equal(r.statusCode, 422, r.body);
});

test('cashiers and other shops cannot read or change it', async () => {
  assert.equal((await app.inject({ url, headers: cashier })).statusCode, 403);
  assert.equal((await app.inject({ url, headers: otherOwner })).statusCode, 404);
  assert.equal(
    (await put(otherOwner, { category: 'gym', expectedGapDays: null, lostAfterDays: null }))
      .statusCode,
    404,
  );
});

test('the platform team tunes a category for every shop that kept the defaults', async () => {
  const r = await app.inject({
    method: 'PUT',
    url: '/api/v1/platform/analytics-defaults/cafe',
    headers: admin,
    payload: { expectedGapDays: 6, atRiskAfterDays: 12, lostAfterDays: 40 },
  });
  assert.equal(r.statusCode, 200, r.body);
  const cadence = (await app.inject({ url, headers: owner })).json();
  assert.deepEqual([cadence.gap, cadence.risk, cadence.lost], [6, 12, 40]);
  const denied = await app.inject({
    method: 'PUT',
    url: '/api/v1/platform/analytics-defaults/cafe',
    headers: owner,
    payload: { expectedGapDays: 6, atRiskAfterDays: 12, lostAfterDays: 40 },
  });
  assert.equal(denied.statusCode, 403);
  // Later test files in the same run expect the shipped defaults.
  const restored = await app.inject({
    method: 'PUT',
    url: '/api/v1/platform/analytics-defaults/cafe',
    headers: admin,
    payload: { expectedGapDays: 7, atRiskAfterDays: 14, lostAfterDays: 45 },
  });
  assert.equal(restored.statusCode, 200, restored.body);
});
