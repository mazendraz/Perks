import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { adminLogin, enrollmentTerms, key, login } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';
import { distanceMeters } from '../../packages/domain/src/geo.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
const program = '40000000-0000-4000-8000-000000000001',
  version = '50000000-0000-4000-8000-000000000001',
  shop = { latitude: 30.0444, longitude: 31.2357 },
  // About 30 m and about 400 m north of the shop.
  inside = { latitude: 30.04467, longitude: 31.2357, accuracy: 20 },
  outside = { latitude: 30.048, longitude: 31.2357, accuracy: 20 },
  settingsUrl = '/api/v1/platform/merchants/' + ids.merchantA + '/stamp-collection-settings';
type Headers = Awaited<ReturnType<typeof login>>;
let admin: Headers, cashier: Headers, code: string, terms: string;
const defaults = {
  requireLocation: false,
  requireCashier: true,
  maxAccuracy: 100,
  collectionsPerDay: null,
  stampsPerDay: null,
  limitWindow: 'local_day',
  cooldownMinutes: 0,
  defaultStamps: 1,
  allowMultiple: true,
  maxStampsPerCollection: 100,
  welcomeStamps: 0,
  autoBranchHourlyCap: 60,
  openCollectionAcknowledged: false,
};
async function configure(changes: Record<string, unknown>, expected = 200) {
  const current = (await app.inject({ url: settingsUrl, headers: admin })).json();
  const r = await app.inject({
    method: 'PATCH',
    url: settingsUrl,
    headers: { ...admin, 'if-match': String(current.settings.revision) },
    payload: { ...defaults, ...changes },
  });
  assert.equal(r.statusCode, expected, r.body);
  return r;
}
// The sign-in limiter counts per address; each synthetic customer signs in from its own.
let address = 0;
async function signIn(email: string): Promise<Headers> {
  const origin = c.PUBLIC_APP_ORIGIN,
    remoteAddress = '10.9.' + Math.floor(++address / 250) + '.' + ((address % 250) + 1);
  const challenge = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/challenges',
    headers: { origin },
    payload: { email },
    remoteAddress,
  });
  assert.equal(challenge.statusCode, 202, challenge.body);
  const id = challenge.json().challengeId;
  const mailbox = (
    await app.inject({ url: '/api/v1/local/mail', remoteAddress: '127.0.0.1' })
  ).json();
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/challenges/' + id + '/verify',
    headers: { origin },
    payload: { code: mailbox.messages.find((m: { id: string }) => m.id === id).code },
    remoteAddress,
  });
  assert.equal(result.statusCode, 200, result.body);
  return {
    cookie: result.cookies.map((x) => x.name + '=' + x.value).join('; '),
    origin,
    'x-csrf-token': result.json().csrfToken as string,
  };
}
async function customer() {
  const headers = await signIn('collect-' + randomUUID() + '@nuqta.test');
  const enrolled = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...headers, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: program,
      programVersionId: version,
      alias: 'Collector',
      acceptedTerms: true,
      acceptedTermsHash: terms,
      branchId: ids.branchA,
    },
  });
  assert.equal(enrolled.statusCode, 200, enrolled.body);
  return { headers, membership: enrolled.json().membershipId as string };
}
const collect = (
  who: { headers: Headers; membership: string },
  location?: typeof inside,
  idempotency = randomUUID(),
  placementCode = code,
) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/me/stamp-collections',
    headers: { ...who.headers, 'idempotency-key': idempotency },
    payload: {
      membershipId: who.membership,
      branchId: ids.branchA,
      placementCode,
      ...(location ? { location } : {}),
    },
  });
const balance = async (membership: string) =>
  (await db.query('SELECT balance FROM loyalty_accounts WHERE membership_id=$1', [membership]))
    .rows[0].balance as number;
async function cashierAward(who: { headers: Headers; membership: string }, quantity: number) {
  const token = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/me/memberships/' + who.membership + '/presentation-tokens',
      headers: { ...who.headers, ...key() },
      payload: {},
    })
  ).json().token;
  const proof = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/cashier/scans/resolve',
      headers: cashier,
      payload: { merchantId: ids.merchantA, branchId: ids.branchA, token },
    })
  ).json().presentationContext;
  return app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/stamp-awards',
    headers: { ...cashier, ...key() },
    payload: {
      presentationContext: proof,
      branchId: ids.branchA,
      membershipId: who.membership,
      quantity,
      purchaseReference: {
        namespace: 'manual',
        reference: 'R-' + randomUUID(),
        businessDate: businessDate('Africa/Cairo'),
      },
    },
  });
}
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  admin = await adminLogin(app, db);
  cashier = await login(app, 'cashier@bunn.test');
  code = randomBytes(24).toString('base64url');
  await db.query(
    "INSERT INTO placements(merchant_id,branch_id,label,kind,public_code,created_by) VALUES($1,$2,'Collection fixture','stand',$3,$4)",
    [ids.merchantA, ids.branchA, code, ids.ownerA],
  );
  terms = await enrollmentTerms(app, program);
});
after(async () => {
  await configure({});
  await app.close();
  await db.end();
});

test('distance maths is accurate enough for a shop-sized zone', () => {
  const near = distanceMeters(shop.latitude, shop.longitude, inside.latitude, inside.longitude),
    far = distanceMeters(shop.latitude, shop.longitude, outside.latitude, outside.longitude);
  assert.ok(near > 25 && near < 35, String(near));
  assert.ok(far > 390 && far < 410, String(far));
});
test('only the platform team changes collection rules, and unsafe combinations are refused', async () => {
  const owner = await login(app, 'owner@bunn.test');
  assert.equal((await app.inject({ url: settingsUrl, headers: owner })).statusCode, 403);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: settingsUrl,
        headers: { ...owner, 'if-match': '1' },
        payload: defaults,
      })
    ).statusCode,
    403,
  );
  // Automatic stamps need a daily limit, small quantities, and an explicit acknowledgement when nothing verifies the visit.
  await configure({ requireCashier: false, openCollectionAcknowledged: true }, 422);
  await configure({ requireCashier: false, collectionsPerDay: 1 }, 422);
  await configure(
    {
      requireCashier: false,
      collectionsPerDay: 1,
      defaultStamps: 5,
      openCollectionAcknowledged: true,
    },
    422,
  );
  // Location cannot be required before the branches have a position.
  await configure({ requireLocation: true }, 422);
});
test('default rules keep the cashier flow: a sticker tap becomes a pending request', async () => {
  await configure({});
  const who = await customer();
  const r = await collect(who);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().outcome, 'pending');
  assert.match(r.json().request.code, /^\d{6}$/);
  assert.equal(await balance(who.membership), 0);
});
test('automatic collection without location: one stamp, replay-safe, then a clear daily limit', async () => {
  await configure({
    requireCashier: false,
    collectionsPerDay: 1,
    openCollectionAcknowledged: true,
  });
  const who = await customer();
  const idempotency = randomUUID();
  const first = await collect(who, undefined, idempotency);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().outcome, 'awarded');
  assert.equal(first.json().balanceAfter, 1);
  // The same request replayed, and five different requests racing, still leave one stamp.
  assert.equal((await collect(who, undefined, idempotency)).json().outcome, 'awarded');
  const racing = await Promise.all(Array.from({ length: 5 }, () => collect(who)));
  assert.ok(racing.every((r) => r.statusCode === 200 && r.json().outcome === 'not_eligible'));
  assert.equal(racing[0]!.json().reason, 'limit_reached');
  assert.ok(Date.parse(racing[0]!.json().nextAt) > Date.now());
  assert.equal(await balance(who.membership), 1);
  const tx = (
    await db.query(
      'SELECT source,staff_id,purchase_id,quantity FROM loyalty_transactions WHERE membership_id=$1',
      [who.membership],
    )
  ).rows;
  assert.deepEqual(tx, [{ source: 'auto', staff_id: null, purchase_id: null, quantity: 1 }]);
  // The cashier is bound by the same daily limit.
  assert.equal((await cashierAward(who, 1)).json().error.code, 'COLLECTION_LIMIT');
});
test('a wrong or foreign sticker code and another customer’s card never collect', async () => {
  await configure({
    requireCashier: false,
    collectionsPerDay: 1,
    openCollectionAcknowledged: true,
  });
  const who = await customer(),
    other = await customer();
  assert.equal(
    (await collect(who, undefined, randomUUID(), randomBytes(24).toString('base64url'))).statusCode,
    410,
  );
  const foreignCode = randomBytes(24).toString('base64url');
  await db.query(
    "INSERT INTO placements(merchant_id,branch_id,label,kind,public_code,created_by) VALUES($1,$2,'Other shop','stand',$3,$4)",
    [ids.merchantB, ids.branchB, foreignCode, ids.ownerB],
  );
  assert.notEqual((await collect(who, undefined, randomUUID(), foreignCode)).statusCode, 200);
  assert.equal(
    (await collect({ headers: other.headers, membership: who.membership })).statusCode,
    404,
  );
  assert.equal(await balance(who.membership), 0);
});
test('location is verified by the server: asked only when needed, refused outside or when inaccurate', async () => {
  const active = (await app.inject({ url: settingsUrl, headers: admin }))
    .json()
    .branches.filter((b: { status: string }) => b.status === 'active')
    .map((b: { id: string }) => b.id) as string[];
  for (const branch of active) {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/v1/platform/merchants/' + ids.merchantA + '/branches/' + branch + '/position',
      headers: admin,
      payload: { ...shop, radius: 75 },
    });
    assert.equal(r.statusCode, 200, r.body);
  }
  await configure({ requireLocation: true, requireCashier: false, collectionsPerDay: 1 });
  const who = await customer();
  assert.equal((await collect(who)).json().outcome, 'location_required');
  const far = (await collect(who, outside)).json();
  assert.deepEqual([far.outcome, far.reason], ['not_eligible', 'outside_zone']);
  const vague = (await collect(who, { ...inside, accuracy: 900 })).json();
  assert.deepEqual([vague.outcome, vague.reason], ['not_eligible', 'location_inaccurate']);
  assert.equal(await balance(who.membership), 0);
  const ok = (await collect(who, inside)).json();
  assert.equal(ok.outcome, 'awarded');
  assert.equal(await balance(who.membership), 1);
  // Only distance and accuracy are kept, never the customer's coordinates.
  const checks = (
    await db.query(
      'SELECT outcome,distance_m,accuracy_m FROM stamp_collection_checks WHERE membership_id=$1 ORDER BY at',
      [who.membership],
    )
  ).rows;
  assert.deepEqual(
    checks.map((x) => x.outcome),
    ['outside_zone', 'location_inaccurate', 'awarded'],
  );
  assert.ok(checks[0].distance_m > 390 && checks[2].distance_m < 40);
  // The cashier remains the fallback when the phone cannot prove where it is.
  const fallback = await customer();
  assert.equal((await collect(fallback, outside)).json().outcome, 'not_eligible');
  assert.equal((await cashierAward(fallback, 1)).statusCode, 200);
  // A required position cannot be removed while location is on.
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url:
          '/api/v1/platform/merchants/' + ids.merchantA + '/branches/' + ids.branchA + '/position',
        headers: admin,
        payload: { latitude: null, longitude: null, radius: 75 },
      })
    ).statusCode,
    409,
  );
});
test('location plus cashier: the request is created only from inside the zone', async () => {
  await configure({ requireLocation: true, requireCashier: true });
  const who = await customer();
  assert.equal((await collect(who)).json().outcome, 'location_required');
  assert.equal((await collect(who, outside)).json().reason, 'outside_zone');
  assert.equal(
    (await db.query('SELECT 1 FROM stamp_requests WHERE membership_id=$1', [who.membership]))
      .rowCount,
    0,
  );
  const r = (await collect(who, inside)).json();
  assert.equal(r.outcome, 'pending');
  assert.equal(await balance(who.membership), 0);
});
test('cooldown, stamps per day and the multiple-stamps switch are separate rules', async () => {
  await configure({ cooldownMinutes: 30, stampsPerDay: 4, maxStampsPerCollection: 3 });
  const who = await customer();
  assert.equal((await cashierAward(who, 4)).json().error.code, 'QTY_OVER_LIMIT');
  assert.equal((await cashierAward(who, 3)).statusCode, 200);
  assert.equal((await cashierAward(who, 1)).json().error.code, 'COLLECTION_LIMIT');
  const waiting = (await collect(who)).json();
  assert.deepEqual([waiting.outcome, waiting.reason], ['not_eligible', 'cooldown']);
  // Past the cooldown, the remaining daily stamps still cap the quantity.
  await db.query('ALTER TABLE loyalty_transactions DISABLE TRIGGER transaction_immutable');
  await db.query(
    "UPDATE loyalty_transactions SET at=at-interval '31 minutes' WHERE membership_id=$1",
    [who.membership],
  );
  await db.query('ALTER TABLE loyalty_transactions ENABLE TRIGGER transaction_immutable');
  assert.equal((await cashierAward(who, 2)).json().error.code, 'COLLECTION_LIMIT');
  assert.equal((await cashierAward(who, 1)).statusCode, 200);
  assert.equal(await balance(who.membership), 4);
  await configure({ allowMultiple: false, defaultStamps: 2 });
  const single = await customer();
  assert.equal((await cashierAward(single, 3)).json().error.code, 'QTY_OVER_LIMIT');
  assert.equal((await cashierAward(single, 2)).statusCode, 200);
});
test('welcome stamps are granted once at enrolment and do not use up the daily collection', async () => {
  await configure({
    welcomeStamps: 2,
    requireCashier: false,
    collectionsPerDay: 1,
    openCollectionAcknowledged: true,
  });
  const who = await customer();
  assert.equal(await balance(who.membership), 2);
  // Enrolling again returns the same membership and adds nothing.
  const again = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...who.headers, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: program,
      programVersionId: version,
      alias: 'Collector',
      acceptedTerms: true,
      acceptedTermsHash: terms,
      branchId: ids.branchA,
    },
  });
  assert.equal(again.json().alreadyMember, true);
  assert.equal(await balance(who.membership), 2);
  await assert.rejects(
    () =>
      db.query(
        "INSERT INTO loyalty_transactions(public_reference,merchant_id,membership_id,program_version_id,branch_id,operation_id,type,quantity,source) SELECT 'TX-DUP',merchant_id,membership_id,program_version_id,branch_id,operation_id,'award',1,'welcome' FROM loyalty_transactions WHERE membership_id=$1",
        [who.membership],
      ),
    /duplicate key/,
  );
  assert.equal((await collect(who)).json().outcome, 'awarded');
  assert.equal(await balance(who.membership), 3);
  const card = (
    await app.inject({ url: '/api/v1/me/memberships/' + who.membership, headers: who.headers })
  ).json().card;
  assert.equal(card.balance, 3);
  assert.equal(card.stamp_ink.length, 3);
});
test('the branch hourly cap stops automatic stamps and sends customers to the cashier', async () => {
  await configure({
    requireCashier: false,
    collectionsPerDay: 1,
    openCollectionAcknowledged: true,
    autoBranchHourlyCap: 1,
  });
  await db.query('ALTER TABLE loyalty_transactions DISABLE TRIGGER transaction_immutable');
  await db.query(
    "UPDATE loyalty_transactions SET at=at-interval '2 hours' WHERE merchant_id=$1 AND source='auto'",
    [ids.merchantA],
  );
  await db.query('ALTER TABLE loyalty_transactions ENABLE TRIGGER transaction_immutable');
  const first = await customer(),
    second = await customer();
  assert.equal((await collect(first)).json().outcome, 'awarded');
  const blocked = (await collect(second)).json();
  assert.deepEqual([blocked.outcome, blocked.reason], ['not_eligible', 'busy']);
  assert.equal(await balance(second.membership), 0);
});
test('a completed card through automatic stamps creates the reward', async () => {
  await configure({});
  const who = await customer();
  const threshold = (
    await db.query('SELECT threshold FROM program_versions WHERE id=$1', [version])
  ).rows[0].threshold as number;
  // One stamp short of the reward, earned through the cashier before the shop switches to automatic.
  for (let i = 1; i < threshold; i++) assert.equal((await cashierAward(who, 1)).statusCode, 200);
  await configure({
    requireCashier: false,
    collectionsPerDay: 1,
    openCollectionAcknowledged: true,
    limitWindow: 'rolling_24h',
  });
  await db.query('ALTER TABLE loyalty_transactions DISABLE TRIGGER transaction_immutable');
  await db.query("UPDATE loyalty_transactions SET at=at-interval '2 days' WHERE membership_id=$1", [
    who.membership,
  ]);
  await db.query('ALTER TABLE loyalty_transactions ENABLE TRIGGER transaction_immutable');
  const done = (await collect(who)).json();
  assert.equal(done.outcome, 'awarded');
  assert.equal(done.rewardEarned, true);
  assert.equal(done.balanceAfter, 0);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM reward_grants WHERE membership_id=$1 AND status='available'",
        [who.membership],
      )
    ).rows[0].n,
    1,
  );
});
test('a Google Maps share link is followed on Google hosts only, by the platform team only', async () => {
  const hops: string[] = [];
  const fake = (async (input: string | URL) => {
    const url = String(input);
    hops.push(url);
    if (url.startsWith('https://maps.app.goo.gl/'))
      return new Response(null, {
        status: 302,
        headers: {
          location:
            'https://www.google.com/maps/place/Cafe/@30.1,31.3,17z/data=!3d30.0444!4d31.2357',
        },
      });
    return new Response(null, { status: 302, headers: { location: 'https://evil.test/x' } });
  }) as typeof fetch;
  const isolated = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' }, { mapsFetch: fake });
  try {
    await isolated.app.ready();
    const headers = await adminLogin(isolated.app, db);
    const resolve = (url: string, h: Headers = headers) =>
      isolated.app.inject({
        method: 'POST',
        url: '/api/v1/platform/maps/resolve',
        headers: h,
        payload: { url },
      });
    const ok = await resolve('https://maps.app.goo.gl/AbC123xyz?g_st=iw');
    assert.equal(ok.statusCode, 200, ok.body);
    assert.deepEqual(ok.json(), { latitude: 30.0444, longitude: 31.2357 });
    assert.equal(hops.length, 1);
    assert.equal((await resolve('https://evil.test/AbC123xyz')).statusCode, 422);
    assert.equal(hops.length, 1);
    const owner = await login(isolated.app, 'owner@bunn.test');
    assert.equal((await resolve('https://maps.app.goo.gl/AbC123xyz', owner)).statusCode, 403);
  } finally {
    await isolated.app.close();
  }
  // A redirect that leaves Google is never followed.
  const { resolveShortMapsLink } = await import('../../apps/api/src/modules/collection.js');
  const seen: string[] = [];
  const leaving = (async (input: string | URL) => {
    seen.push(String(input));
    return new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/' },
    });
  }) as typeof fetch;
  assert.equal(await resolveShortMapsLink('https://maps.app.goo.gl/AbC123xyz', leaving), null);
  assert.equal(seen.length, 1);
});
