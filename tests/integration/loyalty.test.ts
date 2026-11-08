import { enrollmentTerms } from '../helpers.js';
import { decodeQr } from '../../tools/qr-codec.js';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { key, login } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let customer: Awaited<ReturnType<typeof login>>,
  cashier: typeof customer,
  owner: typeof customer,
  ownerB: typeof customer,
  ms: string,
  token: string;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  customer = await login(app, 'sara@example.test');
  cashier = await login(app, 'cashier@bunn.test');
  owner = await login(app, 'owner@bunn.test');
  ownerB = await login(app, 'owner@lamsa.test');
});
after(async () => {
  await db.query("UPDATE staff_memberships SET status='active' WHERE id=$1", [ids.staffCashier]);
  await app.close();
  await db.end();
});
const payload = (receipt: string, quantity = 1) => ({
  branchId: ids.branchA,
  membershipId: ms,
  quantity,
  purchaseReference: {
    namespace: 'manual',
    reference: receipt,
    businessDate: businessDate('Africa/Cairo'),
  },
  presentationContext: token,
});
const award = (body: ReturnType<typeof payload>, headers = cashier, k = randomUUID()) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/stamp-awards',
    headers: { ...headers, 'idempotency-key': k },
    payload: body,
  });
test('concurrent enrollment produces one membership and an owned persisted card', async () => {
  const body = {
    merchantId: ids.merchantA,
    programId: '40000000-0000-4000-8000-000000000001',
    programVersionId: '50000000-0000-4000-8000-000000000001',
    alias: 'سارة م.',
    acceptedTerms: true,
    acceptedTermsHash: await enrollmentTerms(app, '40000000-0000-4000-8000-000000000001'),
    source: 'qr',
    branchId: ids.branchA,
    consents: { email: false, sms: false, whatsapp: false },
  };
  const replies = await Promise.all(
    Array.from({ length: 20 }, () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/me/memberships',
        headers: { ...customer, ...key() },
        payload: body,
      }),
    ),
  );
  assert.deepEqual(new Set(replies.map((r) => r.statusCode)), new Set([200]));
  ms = replies[0]!.json().membershipId;
  assert.ok(replies.every((r) => r.json().membershipId === ms));
  assert.equal(
    Number(
      (
        await db.query('SELECT count(*) FROM memberships WHERE user_id=$1 AND program_id=$2', [
          ids.customer,
          body.programId,
        ])
      ).rows[0].count,
    ),
    1,
  );
  const cards = (await app.inject({ url: '/api/v1/me/memberships', headers: customer })).json()
    .cards;
  assert.equal(cards[0].balance, 0);
  assert.equal(
    (await app.inject({ url: '/api/v1/me/memberships/' + ms, headers: ownerB })).statusCode,
    404,
  );
  const qr = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships/' + ms + '/presentation-tokens',
    headers: { ...customer, ...key() },
    payload: {},
  });
  assert.equal(qr.statusCode, 200);
  token = qr.json().token;
  assert.equal(await decodeQr(Buffer.from(qr.json().qrDataUrl.split(',')[1], 'base64')), token);
  assert.match(token, /^NQP:[a-f0-9]{64}$/);
  assert.match(qr.json().qrDataUrl, /^data:image\/png;base64,/);
  const resolved = await app.inject({
    method: 'POST',
    url: '/api/v1/cashier/scans/resolve',
    headers: cashier,
    payload: { merchantId: ids.merchantA, branchId: ids.branchA, token },
  });
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.json().membership.id, ms);
});
test('award persists ledger, remainder and independent reward; replay snapshot and purchase dedupe', async () => {
  assert.equal((await award(payload('L-1', 3))).statusCode, 200);
  assert.equal((await award(payload('L-2', 1))).statusCode, 200);
  const k = randomUUID(),
    body = payload('L-3', 2),
    r = await award(body, cashier, k);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().balanceAfter, 1);
  assert.equal(r.json().rewardGrants.length, 1);
  const replay = await award(body, cashier, k);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), r.json());
  assert.equal((await award({ ...body, quantity: 3 }, cashier, k)).statusCode, 409);
  const duplicate = await award(payload(' l-٣ ', 2));
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, 'PURCHASE_ALREADY_USED');
  const lookup = await app.inject({
    url:
      '/api/v1/operations/by-key?scope=' +
      encodeURIComponent('stamp.award:' + ids.merchantA) +
      '&key=' +
      k,
    headers: cashier,
  });
  assert.equal(lookup.json().status, 'committed');
  assert.deepEqual(lookup.json().result, r.json());
  const totals = (
    await db.query(
      'SELECT a.balance,(SELECT sum(amount)::int FROM ledger_entries WHERE membership_id=a.membership_id) AS total FROM loyalty_accounts a WHERE membership_id=$1',
      [ms],
    )
  ).rows[0];
  assert.equal(totals.balance, totals.total);
  await assert.rejects(
    () => db.query('UPDATE ledger_entries SET amount=999 WHERE membership_id=$1', [ms]),
    /immutable/,
  );
  await assert.rejects(
    () => db.query('UPDATE reward_grants SET terms=$1 WHERE membership_id=$2', ['changed', ms]),
    /immutable reward/,
  );
});
test('independent DB connections serialize different purchases; same purchase gets one award under contention', async () => {
  const r = await Promise.all([
    award(payload('PAR-A', 3), cashier),
    award(payload('PAR-B', 3), owner),
  ]);
  assert.deepEqual(
    r.map((x) => x.statusCode),
    [200, 200],
  );
  assert.equal(
    (await db.query('SELECT balance FROM loyalty_accounts WHERE membership_id=$1', [ms])).rows[0]
      .balance,
    2,
  );
  const same = await Promise.all(
    Array.from({ length: 12 }, (_, i) => award(payload('PAR-SAME'), i % 2 ? cashier : owner)),
  );
  assert.equal(same.filter((x) => x.statusCode === 200).length, 1);
  assert.ok(same.every((x) => [200, 409].includes(x.statusCode)));
  const k = randomUUID(),
    sameKey = await Promise.all(
      Array.from({ length: 20 }, () => award(payload('PAR-KEY'), cashier, k)),
    );
  assert.ok(sameKey.every((x) => x.statusCode === 200));
  assert.equal(new Set(sameKey.map((x) => x.json().transactionId)).size, 1);
  const invariant = (
    await db.query(
      'SELECT a.balance,(SELECT sum(amount)::int FROM ledger_entries WHERE membership_id=a.membership_id) AS ledger FROM loyalty_accounts a WHERE membership_id=$1',
      [ms],
    )
  ).rows[0];
  assert.equal(invariant.balance, invariant.ledger);
});
test('foreign owner, unauthorized branch, fractional quantity, forged QR and disabled sessions are denied', async () => {
  assert.equal((await award(payload('FOREIGN'), ownerB)).statusCode, 404);
  assert.equal(
    (await award({ ...payload('WRONG-BRANCH'), branchId: ids.branchA2 })).statusCode,
    403,
  );
  assert.equal((await award(payload('FRACTION', 1.5))).statusCode, 422);
  assert.equal(
    (await award({ ...payload('FORGED'), presentationContext: 'NQ.' + ms })).statusCode,
    422,
  );
  const savedKey = randomUUID(),
    savedBody = payload('BEFORE-GRANT-REVOCATION');
  assert.equal((await award(savedBody, cashier, savedKey)).statusCode, 200);
  const lookup = () =>
    app.inject({
      url:
        '/api/v1/operations/by-key?scope=' +
        encodeURIComponent('stamp.award:' + ids.merchantA) +
        '&key=' +
        savedKey,
      headers: cashier,
    });
  assert.equal((await lookup()).statusCode, 200);
  await db.query("UPDATE staff_memberships SET status='disabled' WHERE id=$1", [ids.staffCashier]);
  assert.equal((await award(savedBody, cashier, savedKey)).statusCode, 404);
  assert.equal((await lookup()).statusCode, 404);
  assert.equal((await award(payload('DISABLED'))).statusCode, 404);
  assert.equal(
    (await app.inject({ url: '/api/v1/session', headers: cashier })).json().grants.length,
    0,
  );
  await db.query("UPDATE staff_memberships SET status='active' WHERE id=$1", [ids.staffCashier]);
  await db.query('DELETE FROM staff_branch_grants WHERE staff_id=$1 AND branch_id=$2', [
    ids.staffCashier,
    ids.branchA,
  ]);
  try {
    assert.equal((await award(savedBody, cashier, savedKey)).statusCode, 403);
    assert.equal((await lookup()).statusCode, 404);
  } finally {
    await db.query(
      'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
      [ids.merchantA, ids.staffCashier, ids.branchA],
    );
  }
  await db.query(
    "UPDATE presentation_tokens SET expires_at=now()-interval '1 second' WHERE membership_id=$1",
    [ms],
  );
  assert.equal((await award(payload('EXPIRED'))).statusCode, 410);
});
