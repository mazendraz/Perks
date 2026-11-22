import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { login, clearOfShopMidnight } from '../helpers.js';
import { cairo, makeCustomer, revoke, stamp } from '../analytics-fixtures.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let owner: Awaited<ReturnType<typeof login>>;

before(async () => {
  await clearOfShopMidnight();
  await db.connect();
  await seed(db);
  await app.ready();
  owner = await login(app, 'owner@bunn.test');
});
after(async () => {
  await app.close();
  await db.end();
});

const visitsFor = async (membershipId: string) =>
  (
    await db.query(
      'SELECT business_date::text AS day,stamps FROM visits_v WHERE profile_id=(SELECT profile_id FROM memberships WHERE id=$1) ORDER BY day',
      [membershipId],
    )
  ).rows as { day: string; stamps: number }[];

test('an automatic stamp is a visit; two stamps on one day are one visit', async () => {
  const a = await makeCustomer(db);
  await stamp(db, a, cairo(3, 10), { source: 'auto' });
  await stamp(db, a, cairo(3, 18), { source: 'request', branchId: ids.branchA2 });
  const v = await visitsFor(a.membershipId);
  assert.equal(v.length, 1);
  assert.equal(v[0]!.stamps, 2);
});

test('the business day follows the shop clock, not UTC', async () => {
  const a = await makeCustomer(db);
  await stamp(db, a, cairo(5, 23, 59));
  await stamp(db, a, cairo(4, 0, 1));
  assert.equal((await visitsFor(a.membershipId)).length, 2);
});

test('welcome stamps and fully taken-back stamps are not visits; partly taken back still is', async () => {
  const a = await makeCustomer(db);
  await stamp(db, a, cairo(6, 9), { source: 'welcome' });
  const gone = await stamp(db, a, cairo(7, 9), { quantity: 1 });
  await revoke(db, a, gone, 1, cairo(7, 9, 10));
  const half = await stamp(db, a, cairo(8, 9), { quantity: 2 });
  await revoke(db, a, half, 1, cairo(8, 9, 5));
  const v = await visitsFor(a.membershipId);
  assert.equal(v.length, 1);
  assert.equal(v[0]!.stamps, 2);
});

test('today and overview count the same visits as the view', async () => {
  const a = await makeCustomer(db),
    b = await makeCustomer(db);
  const now = new Date();
  await stamp(db, a, now, { source: 'auto' });
  await stamp(db, a, new Date(now.getTime() - 1000), { source: 'auto' });
  await stamp(db, b, new Date(now.getTime() - 2000), { source: 'request' });
  const fromView = Number(
    (
      await db.query(
        "SELECT count(*) FROM visits_v v WHERE v.merchant_id=$1 AND v.business_date=(clock_timestamp() AT TIME ZONE 'Africa/Cairo')::date",
        [ids.merchantA],
      )
    ).rows[0].count,
  );
  assert.ok(fromView >= 2);
  const today = (
    await app.inject({ url: '/api/v1/merchants/' + ids.merchantA + '/today', headers: owner })
  ).json();
  assert.equal(today.today.visits, fromView);
  const overview = await app.inject({
    url: '/api/v1/merchants/' + ids.merchantA + '/overview?days=30',
    headers: owner,
  });
  assert.equal(overview.statusCode, 200, overview.body);
  const monthly = Number(
    (
      await db.query(
        "SELECT count(*) FROM visits_v WHERE merchant_id=$1 AND first_at>=clock_timestamp()-interval '30 days'",
        [ids.merchantA],
      )
    ).rows[0].count,
  );
  assert.equal(overview.json().metrics.visits, monthly);
  const trendTotal = overview
    .json()
    .trend.reduce((n: number, d: { visits: number }) => n + d.visits, 0);
  assert.equal(trendTotal, monthly);
});

test('another shop cannot read these visits', async () => {
  const other = await login(app, 'owner@lamsa.test');
  const r = await app.inject({
    url: '/api/v1/merchants/' + ids.merchantA + '/overview?days=90',
    headers: other,
  });
  assert.equal(r.statusCode, 404);
});

test('the windowed visits match the view exactly, from the first day of the window', async () => {
  const a = await makeCustomer(db);
  await stamp(db, a, cairo(12, 23, 59));
  await stamp(db, a, cairo(11, 0, 1), { staffId: ids.staffCashier });
  await stamp(db, a, cairo(11, 9), { source: 'request' });
  const since = (
    await db.query("SELECT ((clock_timestamp() AT TIME ZONE 'Africa/Cairo')::date-11) AS d")
  ).rows[0].d;
  const cols =
    'merchant_id,profile_id,business_date,first_at,last_at,branch_id,staff_id,staff_ids,stamps,receipts';
  const fromView = (
    await db.query(
      `SELECT ${cols} FROM visits_v WHERE merchant_id=$1 AND business_date>=$2 ORDER BY profile_id,business_date`,
      [ids.merchantA, since],
    )
  ).rows;
  const fromWindow = (
    await db.query(`SELECT ${cols} FROM visits_since($1,$2) ORDER BY profile_id,business_date`, [
      ids.merchantA,
      since,
    ])
  ).rows;
  assert.deepEqual(fromWindow, fromView);
  // The day before the window (23:59 Cairo, 12 days ago) is not in it; both later stamps are one visit
  // that credits both people who stamped.
  const mine = fromWindow.filter((r) => r.profile_id === a.profileId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].stamps, 2);
  assert.ok(mine[0].staff_ids.includes(ids.staffCashier));
});
