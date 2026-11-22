import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { login, clearOfShopMidnight } from '../helpers.js';
import { cairo, makeCustomer, stamp } from '../analytics-fixtures.js';
import type { AnalyticsResponse, SegmentPage } from '../../packages/contracts/src/analytics.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
type Headers = Awaited<ReturnType<typeof login>>;
let owner: Headers, cashier: Headers, otherOwner: Headers;
const base = '/api/v1/merchants/' + ids.merchantA + '/analytics';

before(async () => {
  await clearOfShopMidnight();
  await db.connect();
  await seed(db);
  await app.ready();
  owner = await login(app, 'owner@bunn.test');
  cashier = await login(app, 'cashier@bunn.test');
  otherOwner = await login(app, 'owner@lamsa.test');
  await db.query(
    "UPDATE merchants SET business_category='cafe',expected_gap_days=NULL,at_risk_after_days=NULL,lost_after_days=NULL WHERE id=$1",
    [ids.merchantA],
  );
  // A small café: regulars, people who stopped coming, first-timers and never-visited cards.
  const histories: number[][] = [
    ...Array.from({ length: 8 }, () => [40, 30, 20, 10, 1]),
    ...Array.from({ length: 5 }, () => [60, 50, 40, 20]),
    ...Array.from({ length: 6 }, () => [20]),
    ...Array.from({ length: 3 }, () => [2]),
    [],
    [],
  ];
  for (const h of histories) {
    const cu = await makeCustomer(db, { joinedAt: cairo(Math.max(0, ...h) + 1, 9) });
    for (const d of h)
      await stamp(db, cu, cairo(d, d % 2 ? 9 : 19), {
        branchId: d === 1 ? ids.branchA2 : ids.branchA,
      });
  }
  await db.query('SELECT refresh_merchant_stats($1)', [ids.merchantA]);
});
after(async () => {
  await app.close();
  await db.end();
});

const get = async (url: string, headers: Headers = owner) => {
  const r = await app.inject({ url, headers });
  return { status: r.statusCode, body: r.json(), etag: r.headers.etag as string };
};

test('the page answers: what to do, how it is going, who the customers are', async () => {
  const { status, body } = await get(base + '?days=30');
  assert.equal(status, 200);
  const a = body as AnalyticsResponse;
  const count = (k: string) => a.actions.find((x) => x.key === k)!.count;
  assert.ok(count('at_risk') >= 5);
  assert.ok(count('one_time') >= 6);
  assert.equal(a.segments.regular >= 8, true);
  assert.ok(a.segments.never >= 2);
  assert.ok(a.kpis.customers >= 24);
  // Regulars came 3 times in the last 30 days (20, 10, 1 days ago).
  assert.ok(a.kpis.visits >= 8 * 3);
  assert.ok(a.kpis.returnRate! > 0 && a.kpis.returnRate! <= 100);
  assert.equal(a.trend.length, 30);
  assert.equal(
    a.trend.reduce((n, d) => n + d.visits, 0),
    a.kpis.visits,
  );
  assert.equal(a.atRisk.length, 5);
  assert.ok(a.atRisk[0]!.sinceDays >= a.atRisk[0]!.expectedGapDays);
  assert.equal(a.funnel.status, 'ready');
  if (a.funnel.status === 'ready') {
    const steps = a.funnel.steps.map((s) => s.count);
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i]! <= steps[i - 1]!);
  }
  assert.equal(a.heat.status, 'ready');
  assert.equal(a.cadence.category, 'cafe');
  assert.ok(Object.values(a.sections).every(Boolean), 'everything is open for now');
  assert.ok(a.value.returningVisits > 0);
  // Under 50 customers the health score waits; six months of first visits are enough for cohorts.
  assert.equal(a.health.status, 'not_enough_data');
  assert.equal(a.cohorts.status, 'ready');
  if (a.cohorts.status === 'ready')
    for (const r of a.cohorts.rows) assert.ok(r.back30 <= r.first && /^\d{4}-\d{2}$/.test(r.month));
});

test('a branch filter narrows visits to that branch', async () => {
  const all = (await get(base + '?days=7')).body as AnalyticsResponse;
  const one = (await get(base + '?days=7&branchId=' + ids.branchA2)).body as AnalyticsResponse;
  assert.ok(one.kpis.visits < all.kpis.visits);
  assert.ok(one.kpis.visits >= 8);
  assert.equal(one.branches.length, 1);
});

test('an unchanged page answers 304; a new stamp changes it', async () => {
  const first = await get(base + '?days=30');
  const again = await app.inject({
    url: base + '?days=30',
    headers: { ...owner, 'if-none-match': first.etag },
  });
  assert.equal(again.statusCode, 304);
  // The browser only revalidates if the response may be kept: the global no-store must not win.
  const raw = await app.inject({ url: base + '?days=30', headers: owner });
  assert.equal(raw.headers['cache-control'], 'private, no-cache');
  assert.ok(raw.headers.etag);
  const cu = await makeCustomer(db);
  await stamp(db, cu, new Date());
  const changed = await app.inject({
    url: base + '?days=30',
    headers: { ...owner, 'if-none-match': first.etag },
  });
  assert.equal(changed.statusCode, 200);
});

test('segment lists open with the most urgent first, and page', async () => {
  const { status, body } = await get(base + '/segments/at_risk');
  assert.equal(status, 200);
  const page = body as SegmentPage;
  assert.ok(page.total >= 5);
  const ratio = page.customers.map((x) => x.sinceDays! / x.expectedGapDays);
  for (let i = 1; i < ratio.length; i++) assert.ok(ratio[i]! <= ratio[i - 1]!);
  const tagged = (await get(base + '/segments/vip')).body as SegmentPage;
  assert.equal(tagged.key, 'vip');
  assert.equal((await get(base + '/segments/nope')).status, 422);
});

test('a new shop gets "not enough data yet" instead of noise', async () => {
  const other = (await get('/api/v1/merchants/' + ids.merchantB + '/analytics', otherOwner))
    .body as AnalyticsResponse;
  assert.equal(other.funnel.status, 'not_enough_data');
  assert.equal(other.heat.status, 'not_enough_data');
});

test('cashiers and other shops are kept out', async () => {
  assert.equal((await get(base, cashier)).status, 403);
  assert.equal((await get(base, otherOwner)).status, 404);
  assert.equal((await get(base + '/segments/at_risk', otherOwner)).status, 404);
});
