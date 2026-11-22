import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { login, clearOfShopMidnight } from '../helpers.js';
import { cairo, makeCustomer, stamp, type FixtureCustomer } from '../analytics-fixtures.js';
import type { CustomerInsights } from '../../packages/contracts/src/analytics.js';
import { segmentMessages } from '../../packages/contracts/src/analytics-messages.js';
import { walletMessageInput } from '../../packages/contracts/src/owner-plan.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
type Headers = Awaited<ReturnType<typeof login>>;
let owner: Headers, otherOwner: Headers;

before(async () => {
  await clearOfShopMidnight();
  await db.connect();
  await seed(db);
  await app.ready();
  owner = await login(app, 'owner@bunn.test');
  otherOwner = await login(app, 'owner@lamsa.test');
  await db.query(
    "UPDATE merchants SET business_category='cafe',expected_gap_days=NULL,at_risk_after_days=NULL,lost_after_days=NULL WHERE id=$1",
    [ids.merchantA],
  );
});
after(async () => {
  // Later test files schedule reminders for every reachable customer of this shop: leave none.
  await db.query(
    "UPDATE consent_current SET granted=false WHERE merchant_id=$1 AND channel='push' AND user_id=ANY($2)",
    [ids.merchantA, people.map((p) => p.userId)],
  );
  await db.query('DELETE FROM google_wallet_objects WHERE membership_id=ANY($1)', [
    people.map((p) => p.membershipId),
  ]);
  await app.close();
  await db.end();
});

async function reachable(cu: FixtureCustomer, consent = true) {
  await db.query(
    "INSERT INTO consent_current(merchant_id,user_id,channel,granted) VALUES($1,$2,'push',$3)",
    [ids.merchantA, cu.userId, consent],
  );
  await db.query(
    "INSERT INTO google_wallet_objects(membership_id,merchant_id,fingerprint) VALUES($1,$2,'')",
    [cu.membershipId, ids.merchantA],
  );
}
async function withVisits(days: number[]) {
  const cu = await makeCustomer(db, { joinedAt: cairo(Math.max(0, ...days) + 1, 9) });
  for (const d of days) await stamp(db, cu, cairo(d, 12));
  return cu;
}
const audience = async (a: string) =>
  (
    await db.query(
      'SELECT profile_id FROM wallet_message_audience($1,$2,30,false,true) WHERE profile_id=ANY($3)',
      [ids.merchantA, a, people.map((p) => p.profileId)],
    )
  ).rows.map((r) => r.profile_id as string);
let people: FixtureCustomer[] = [];

test('every ready message is a valid Wallet message', () => {
  for (const [audience, text] of Object.entries(segmentMessages)) {
    for (const body of [text!.ar, text!.en])
      assert.ok(
        walletMessageInput.safeParse({ audience, bodyAr: body }).success,
        audience + ': ' + body,
      );
  }
});

test('a segment message reaches exactly the reachable people in that segment', async () => {
  const late = await withVisits([60, 50, 40, 20]),
    lateNoConsent = await withVisits([61, 51, 41, 21]),
    regular = await withVisits([30, 20, 10, 2]),
    once = await withVisits([20]);
  people = [late, lateNoConsent, regular, once];
  await reachable(late);
  await reachable(lateNoConsent, false);
  await reachable(regular);
  await reachable(once);
  await db.query('SELECT refresh_merchant_stats($1)', [ids.merchantA]);
  assert.deepEqual(await audience('at_risk'), [late.profileId]);
  assert.deepEqual(await audience('one_time'), [once.profileId]);
  assert.deepEqual(await audience('regular'), [regular.profileId]);
  assert.equal((await audience('all')).length, 3);
});

test('who came back after a message is counted, and shows on the page', async () => {
  const [late] = people;
  const msg = randomUUID();
  await db.query(
    "INSERT INTO wallet_messages(id,merchant_id,audience,body_ar,recipients,send_after,created_by,created_at) VALUES($1,$2,'at_risk','وحشتنا',1,now()-interval '3 days',$3,now()-interval '3 days')",
    [msg, ids.merchantA, ids.ownerA],
  );
  await db.query(
    "INSERT INTO wallet_message_deliveries(message_id,merchant_id,profile_id,membership_id,channel,status,next_at,accepted_at) VALUES($1,$2,$3,$4,'google','accepted',now()-interval '3 days',now()-interval '3 days')",
    [msg, ids.merchantA, late!.profileId, late!.membershipId],
  );
  const impactNow = async () =>
    (
      await app.inject({
        url: '/api/v1/merchants/' + ids.merchantA + '/analytics',
        headers: owner,
      })
    )
      .json()
      .messageImpact.find((m: { audience: string }) => m.audience === 'at_risk');
  assert.equal((await impactNow()).returned, 0);
  await stamp(db, late!, new Date());
  const page = (
    await app.inject({ url: '/api/v1/merchants/' + ids.merchantA + '/analytics', headers: owner })
  ).json();
  const impact = page.messageImpact.find((m: { audience: string }) => m.audience === 'at_risk');
  assert.deepEqual([impact.recipients, impact.returned], [1, 1]);
  const history = (
    await app.inject({
      url: '/api/v1/merchants/' + ids.merchantA + '/wallet-messages',
      headers: owner,
    })
  ).json().history;
  assert.equal(history.find((h: { id: string }) => h.id === msg).returned, 1);
});

test('one customer: rhythm, card and a timeline with receipts and messages', async () => {
  const cu = await makeCustomer(db, { joinedAt: cairo(40, 9) });
  await stamp(db, cu, cairo(30, 10), { source: 'request', receipt: 'R-1001' });
  await stamp(db, cu, cairo(20, 10));
  await stamp(db, cu, cairo(10, 10));
  const r = await app.inject({
    url: '/api/v1/merchants/' + ids.merchantA + '/customers/' + cu.profileId + '/insights',
    headers: owner,
  });
  assert.equal(r.statusCode, 200, r.body);
  const insights = r.json() as CustomerInsights;
  assert.equal(insights.visits, 3);
  assert.equal(insights.personalGapDays, 10);
  const visits = insights.timeline.filter((e) => e.kind === 'visit');
  assert.equal(visits.length, 3);
  assert.ok(
    visits.some((e) => e.kind === 'visit' && e.receipts.includes('R-1001')),
    'the receipt number shows on its visit',
  );
  const denied = await app.inject({
    url: '/api/v1/merchants/' + ids.merchantA + '/customers/' + cu.profileId + '/insights',
    headers: otherOwner,
  });
  assert.equal(denied.statusCode, 404);
});
