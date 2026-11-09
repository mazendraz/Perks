import { enrollmentTerms } from '../helpers.js';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { login, key } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let cu: Awaited<ReturnType<typeof login>>,
  ca: typeof cu,
  foreign: typeof cu,
  ms: string,
  token: string,
  proof: string;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  cu = await login(app, 'request-' + randomUUID() + '@nuqta.test');
  ca = await login(app, 'cashier@bunn.test');
  foreign = await login(app, 'owner@lamsa.test');
  const enrolled = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...cu, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: '40000000-0000-4000-8000-000000000001',
      programVersionId: '50000000-0000-4000-8000-000000000001',
      alias: 'Request customer',
      acceptedTerms: true,
      acceptedTermsHash: await enrollmentTerms(app, '40000000-0000-4000-8000-000000000001'),
      branchId: ids.branchA,
    },
  });
  assert.equal(enrolled.statusCode, 200);
  ms = enrolled.json().membershipId;
  const qr = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships/' + ms + '/presentation-tokens',
    headers: { ...cu, ...key() },
    payload: {},
  });
  token = qr.json().token;
  const resolved = await app.inject({
    method: 'POST',
    url: '/api/v1/cashier/scans/resolve',
    headers: ca,
    payload: { merchantId: ids.merchantA, branchId: ids.branchA, token },
  });
  assert.equal(resolved.statusCode, 200);
  proof = resolved.json().presentationContext;
});
after(async () => {
  await app.close();
  await db.end();
});
async function create() {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/me/stamp-requests',
    headers: { ...cu, ...key() },
    payload: { membershipId: ms, branchId: ids.branchA },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
const body = (r: { code: string }, receipt: string) => ({
  approve: true,
  code: r.code,
  award: {
    presentationContext: proof,
    branchId: ids.branchA,
    membershipId: ms,
    quantity: 2,
    purchaseReference: {
      namespace: 'manual',
      reference: receipt,
      businessDate: businessDate('Africa/Cairo'),
    },
  },
});
const decide = (id: string, p: Record<string, unknown>, k = randomUUID(), headers = ca) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/stamp-requests/' + id + '/decision',
    headers: { ...headers, 'idempotency-key': k },
    payload: p,
  });

test('worker expires pending requests once with a system event; ordinary runtime cannot run the sweep', async () => {
  const r = await create();
  await db.query(
    "UPDATE stamp_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [r.id],
  );
  const worker = new pg.Client({ connectionString: c.WORKER_DATABASE_URL });
  await worker.connect();
  try {
    await worker.query('SELECT sweep_expired_requests()');
    await worker.query('SELECT sweep_expired_requests()');
  } finally {
    await worker.end();
  }
  assert.equal(
    (await db.query('SELECT status FROM stamp_requests WHERE id=$1', [r.id])).rows[0].status,
    'expired',
  );
  const events = (
    await db.query(
      "SELECT actor_id FROM stamp_request_events WHERE request_id=$1 AND action='expired'",
      [r.id],
    )
  ).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].actor_id, null);
  const runtime = new pg.Client({ connectionString: c.DATABASE_URL });
  await runtime.connect();
  try {
    await assert.rejects(
      () => runtime.query('SELECT sweep_expired_requests()'),
      /permission denied/,
    );
  } finally {
    await runtime.end();
  }
});
test('requests require holder/branch authority; matching attempts persist and one approval uses the shared purchase key', async () => {
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/me/stamp-requests',
        headers: { ...foreign, ...key() },
        payload: { membershipId: ms, branchId: ids.branchA },
      })
    ).statusCode,
    404,
  );
  const all = await Promise.all(Array.from({ length: 8 }, () => create()));
  assert.equal(new Set(all.map((x) => x.id)).size, 1);
  const r = all[0];
  const unscanned = body(r, 'REQ-UNSCANNED');
  unscanned.award.presentationContext = token;
  assert.equal((await decide(r.id, unscanned)).statusCode, 403);
  const anotherSession = await login(app, 'cashier@bunn.test');
  assert.equal(
    (await decide(r.id, body(r, 'REQ-OTHER-SESSION'), randomUUID(), anotherSession)).statusCode,
    403,
  );
  assert.equal((await decide(r.id, body(r, 'REQ-1'), randomUUID(), foreign)).statusCode, 404);
  assert.equal(
    (await decide(r.id, { ...body(r, 'REQ-1'), code: r.code === '000000' ? '000001' : '000000' }))
      .statusCode,
    422,
  );
  assert.equal(
    (await db.query('SELECT failed_matches FROM stamp_requests WHERE id=$1', [r.id])).rows[0]
      .failed_matches,
    1,
  );
  const k = randomUUID(),
    replies = await Promise.all(
      Array.from({ length: 12 }, () => decide(r.id, body(r, 'REQ-1'), k)),
    );
  assert.ok(replies.every((x) => x.statusCode === 200));
  assert.equal(new Set(replies.map((x) => x.json().transactionId)).size, 1);
  assert.equal((await decide(r.id, body(r, 'REQ-1'))).statusCode, 409);
  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/stamp-awards',
    headers: { ...ca, ...key() },
    payload: { ...body(r, ' req-١ ').award, presentationContext: token },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, 'PURCHASE_ALREADY_USED');
  const own = (await app.inject({ url: '/api/v1/me/stamp-requests', headers: cu })).json()
    .requests[0];
  assert.equal(own.status, 'approved');
  assert.equal(own.result.quantity, 2);
});
test('expiry after waiting for an account lock prevents approval and preserves balance', async () => {
  const r = await create();
  await db.query(
    "UPDATE stamp_requests SET expires_at=clock_timestamp()+interval '600 milliseconds' WHERE id=$1",
    [r.id],
  );
  const lock = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
  await lock.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT * FROM loyalty_accounts WHERE membership_id=$1 FOR UPDATE', [ms]);
  const before = (
    await lock.query('SELECT balance FROM loyalty_accounts WHERE membership_id=$1', [ms])
  ).rows[0].balance;
  const pending = decide(r.id, body(r, 'REQ-EXPIRES'));
  await new Promise((r) => setTimeout(r, 900));
  await lock.query('COMMIT');
  await lock.end();
  const result = await pending;
  assert.equal(result.statusCode, 410);
  assert.equal(result.json().error.code, 'REQUEST_EXPIRED');
  assert.equal(
    (await db.query('SELECT balance FROM loyalty_accounts WHERE membership_id=$1', [ms])).rows[0]
      .balance,
    before,
  );
});
test('cancel versus approve has one final outcome and five wrong matching attempts lock the request', async () => {
  let r = await create();
  const results = await Promise.all([
    decide(r.id, body(r, 'REQ-CANCEL-RACE')),
    app.inject({
      method: 'POST',
      url: '/api/v1/me/stamp-requests/' + r.id + '/cancel',
      headers: cu,
      payload: {},
    }),
  ]);
  assert.equal(results.filter((x) => x.statusCode === 200).length, 1);
  const final = (
    await db.query('SELECT status,transaction_id FROM stamp_requests WHERE id=$1', [r.id])
  ).rows[0];
  assert.ok(['approved', 'cancelled'].includes(final.status));
  assert.equal(Boolean(final.transaction_id), final.status === 'approved');
  r = await create();
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await decide(r.id, {
          ...body(r, 'REQ-LOCKED'),
          code: r.code === '000000' ? '000001' : '000000',
        })
      ).statusCode,
      422,
    );
  assert.equal((await decide(r.id, body(r, 'REQ-LOCKED'))).statusCode, 429);
  assert.equal(
    Number(
      (
        await db.query(
          'SELECT count(*) FROM loyalty_transactions WHERE membership_id=$1 AND source=$2',
          [ms, 'request'],
        )
      ).rows[0].count,
    ),
    final.status === 'approved' ? 2 : 1,
  );
});
