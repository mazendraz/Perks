import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { login, key, adminLogin } from '../helpers.js';
import { runOne, type ClaimedJob } from '../../apps/worker/src/runner.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let owner: Awaited<ReturnType<typeof login>>,
  other: typeof owner,
  admin: typeof owner,
  support: typeof owner,
  ca: typeof owner;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  owner = await login(app, 'owner@bunn.test');
  other = await login(app, 'owner@lamsa.test');
  ca = await login(app, 'cashier@bunn.test');
  admin = await adminLogin(app, db);
  const email = 'support-' + randomUUID() + '@nuqta.test';
  await db.query(
    "INSERT INTO users(email,display_name,global_role) VALUES($1,'Support fixture','platform_support')",
    [email],
  );
  support = await login(app, email);
});
after(async () => {
  await app.close();
  await db.end();
  await worker.end();
});
test('platform readiness verifies restricted runtime schema; support can read sanitized health but cannot administer', async () => {
  assert.equal((await app.inject('/health/ready')).statusCode, 200);
  const unsafe = await buildApp({
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: c.DATABASE_MIGRATOR_URL,
  });
  try {
    assert.equal((await unsafe.app.inject('/health/ready')).statusCode, 503);
  } finally {
    await unsafe.app.close();
  }
  assert.equal(
    (await app.inject({ url: '/api/v1/platform/health', headers: owner })).statusCode,
    403,
  );
  const health = await app.inject({ url: '/api/v1/platform/health', headers: support });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().balanceDrift, 0);
  const status = await app.inject({ url: '/api/v1/platform/integrations', headers: support });
  assert.equal(status.statusCode, 200);
  assert.equal(
    status.json().providers.find((x: { id: string }) => x.id === 'payments').status,
    'not_configured',
  );
  assert.ok(!status.body.includes(c.AUTH_PEPPER));
  assert.equal(
    (await app.inject({ url: '/api/v1/platform/audit', headers: support })).statusCode,
    403,
  );
});
test('support ticket messages are durable, idempotent and tenant scoped; support has ticket-only write authority', async () => {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/support/tickets',
    headers: { ...owner, ...key() },
    payload: {
      merchantId: ids.merchantA,
      subject: 'Receipt review',
      category: 'loyalty',
      message: 'Please investigate a transaction reference.',
    },
  });
  assert.equal(r.statusCode, 200);
  const id = r.json().ticket.id;
  assert.equal(
    (await app.inject({ url: '/api/v1/support/tickets/' + id, headers: other })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/support/tickets/' + id, headers: ca })).statusCode,
    404,
  );
  const k = key(),
    body = { body: 'We are checking the immutable ledger.' };
  const messages = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: 'POST',
        url: '/api/v1/support/tickets/' + id + '/messages',
        headers: { ...support, ...k },
        payload: body,
      }),
    ),
  );
  assert.ok(messages.every((x) => x.statusCode === 200));
  assert.equal(messages[0]!.json().message.id, messages[1]!.json().message.id);
  const ticket = (
    await app.inject({ url: '/api/v1/support/tickets/' + id, headers: support })
  ).json();
  assert.equal(ticket.messages.length, 2);
  const changed = await app.inject({
    method: 'PATCH',
    url: '/api/v1/support/tickets/' + id,
    headers: { ...support, 'if-match': String(ticket.ticket.revision) },
    payload: { status: 'resolved' },
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/platform/jobs/' + randomUUID() + '/retry',
        headers: { ...support, ...key() },
        payload: { reason: 'Not permitted' },
      })
    ).statusCode,
    403,
  );
});
async function job(kind: string) {
  const id = randomUUID(),
    outbox = randomUUID();
  await db.query(
    "INSERT INTO outbox_events(id,merchant_id,event_type,aggregate_id,dedupe_key) VALUES($1,$2,'test.worker',$3,$4)",
    [outbox, ids.merchantA, id, 'worker-' + id],
  );
  await db.query('INSERT INTO background_jobs(id,merchant_id,outbox_id,kind) VALUES($1,$2,$3,$4)', [
    id,
    ids.merchantA,
    outbox,
    kind,
  ]);
  return id;
}
test('expired worker leases are fenced; unknown providers never become delivery success and cannot be blindly replayed', async () => {
  for (let i = 0; i < 200 && (await runOne(worker, c)); i++) {
    /* Drain existing local jobs. */
  }
  const id = await job('domain_event'),
    old = (await worker.query<ClaimedJob>('SELECT * FROM claim_next_job()')).rows[0]!;
  assert.equal(old.job_id, id);
  await db.query(
    "UPDATE background_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [id],
  );
  const fresh = (await worker.query<ClaimedJob>('SELECT * FROM claim_next_job()')).rows[0]!;
  assert.equal(fresh.job_id, id);
  assert.notEqual(fresh.lease_id, old.lease_id);
  const session = await worker.connect();
  try {
    await session.query('BEGIN');
    await session.query("SELECT set_config('app.worker_tenant',$1,true)", [ids.merchantA]);
    const stale = await session.query(
      "UPDATE background_jobs SET status='succeeded' WHERE id=$1 AND lease_id=$2 AND lease_until>clock_timestamp()",
      [id, old.lease_id],
    );
    assert.equal(stale.rowCount, 0);
    await session.query('COMMIT');
  } finally {
    session.release();
  }
  await db.query(
    "UPDATE background_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [id],
  );
  await runOne(worker, c);
  assert.equal(
    (await db.query('SELECT status FROM background_jobs WHERE id=$1', [id])).rows[0].status,
    'succeeded',
  );
  const unknown = await job('paid_provider_unconfigured');
  await runOne(worker, c);
  const result = (
    await db.query('SELECT status,last_error FROM background_jobs WHERE id=$1', [unknown])
  ).rows[0];
  assert.equal(result.status, 'blocked');
  assert.equal(result.last_error, 'PROVIDER_NOT_CONFIGURED');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/platform/jobs/' + unknown + '/retry',
        headers: { ...admin, ...key() },
        payload: { reason: 'Unsafe blind retry' },
      })
    ).statusCode,
    409,
  );
  const failed = await job('domain_event');
  await db.query(
    "UPDATE background_jobs SET status='failed',attempts=1,last_error='TEST_FAILURE' WHERE id=$1",
    [failed],
  );
  const k = key(),
    retry = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/platform/jobs/' + failed + '/retry',
        headers: { ...admin, ...k },
        payload: { reason: 'Retry internal test after resolving dependency' },
      });
  assert.equal((await retry()).statusCode, 200);
  assert.equal((await retry()).statusCode, 200);
  await runOne(worker, c);
  assert.equal(
    (await db.query('SELECT status FROM background_jobs WHERE id=$1', [failed])).rows[0].status,
    'succeeded',
  );
});
