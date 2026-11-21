import { enrollmentTerms } from '../helpers.js';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { login, key } from '../helpers.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let cu: Awaited<ReturnType<typeof login>>, ca: typeof cu, foreign: typeof cu, ms: string;
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
// The cashier approves from the notification with the receipt number alone: no customer QR, no code.
const body = (_r: unknown, receipt: string) => ({ approve: true, receipt, quantity: 2 });
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
test('requests require holder/branch authority; one approval per request, the receipt is kept', async () => {
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
  // Another shop's staff cannot see or decide it; an empty receipt is refused.
  assert.equal((await decide(r.id, body(r, 'REQ-1'), randomUUID(), foreign)).statusCode, 404);
  assert.equal((await decide(r.id, body(r, '   '))).statusCode, 422);
  const k = randomUUID(),
    replies = await Promise.all(
      Array.from({ length: 12 }, () => decide(r.id, body(r, 'REQ-1'), k)),
    );
  assert.ok(replies.every((x) => x.statusCode === 200));
  assert.equal(new Set(replies.map((x) => x.json().transactionId)).size, 1);
  assert.equal((await decide(r.id, body(r, 'REQ-1'))).statusCode, 409);
  assert.equal(
    (
      await db.query('SELECT receipt_note FROM loyalty_transactions WHERE id=$1', [
        replies[0]!.json().transactionId,
      ])
    ).rows[0].receipt_note,
    'REQ-1',
  );
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
test('cancel versus approve has one final outcome', async () => {
  const r = await create();
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

test('the customer can read out a 6-digit code instead of the QR; wrong digits are capped', async () => {
  const qr = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships/' + ms + '/presentation-tokens',
    headers: { ...cu, ...key() },
    payload: {},
  });
  assert.equal(qr.statusCode, 200);
  const short = qr.json().shortCode as string;
  assert.match(short, /^\d{6}$/);
  const resolved = await app.inject({
    method: 'POST',
    url: '/api/v1/cashier/scans/resolve',
    headers: ca,
    payload: {
      merchantId: ids.merchantA,
      branchId: ids.branchA,
      token: short.slice(0, 3) + ' ' + short.slice(3),
    },
  });
  assert.equal(resolved.statusCode, 200, resolved.body);
  assert.equal(resolved.json().membership.id, ms);
  // The same digits mean nothing at another shop.
  const other = await app.inject({
    method: 'POST',
    url: '/api/v1/cashier/scans/resolve',
    headers: foreign,
    payload: { merchantId: ids.merchantB, branchId: ids.branchB, token: short },
  });
  assert.notEqual(other.statusCode, 200);
  const wrong = String((Number(short) + 1) % 1_000_000).padStart(6, '0');
  const statuses: number[] = [];
  for (let i = 0; i < 9; i++)
    statuses.push(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/cashier/scans/resolve',
          headers: ca,
          payload: { merchantId: ids.merchantA, branchId: ids.branchA, token: wrong },
        })
      ).statusCode,
    );
  assert.equal(statuses[0], 410);
  assert.equal(statuses.at(-1), 429);
});
