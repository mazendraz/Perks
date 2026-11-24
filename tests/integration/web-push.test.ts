import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, randomUUID } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { b64url, generateVapidKeys } from '../../apps/api/src/webpush.js';
import { runCashierPushJob } from '../../apps/worker/src/cashier-push.js';
import { seed, ids } from '../../db/seed.js';
import { login, key, enrollmentTerms } from '../helpers.js';

const c = readConfig(),
  keys = generateVapidKeys(),
  vapid = {
    WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
    WEB_PUSH_SUBJECT: 'mailto:ops@perks.test',
  },
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL, max: 2 }),
  sent: { url: string; body: Buffer }[] = [],
  transport = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: Buffer.from(init!.body as Uint8Array) });
    return new Response('', { status: 201 });
  }) as typeof fetch;
const { app } = await buildApp(
  { APP_ENV: 'test', LOG_LEVEL: 'silent', ...vapid },
  { pushTransport: transport },
);
const { app: off } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
// A browser's own key pair, so what the worker sends can be decrypted here.
const device = createECDH('prime256v1'),
  authSecret = Buffer.from('0123456789abcdef');
device.generateKeys();
const subscription = (id: string) => ({
  endpoint: 'https://fcm.googleapis.com/fcm/send/' + id,
  keys: { p256dh: b64url(device.getPublicKey()), auth: b64url(authSecret) },
});
const decrypt = (body: Buffer) => {
  const salt = body.subarray(0, 16),
    senderPublic = body.subarray(21, 21 + body[20]!),
    data = body.subarray(21 + body[20]!);
  const derive = (s: Buffer, ikm: Buffer, info: Buffer, n: number) =>
    Buffer.from(hkdfSync('sha256', ikm, s, info, n));
  const ikm = derive(
    authSecret,
    device.computeSecret(senderPublic),
    Buffer.concat([Buffer.from('WebPush: info\0'), device.getPublicKey(), senderPublic]),
    32,
  );
  const decipher = createDecipheriv(
    'aes-128-gcm',
    derive(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
    derive(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  decipher.setAuthTag(data.subarray(-16));
  const padded = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  return JSON.parse(padded.subarray(0, -1).toString());
};
let customer: Awaited<ReturnType<typeof login>>, cashier: typeof customer, membership: string;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  await off.ready();
  customer = await login(app, 'push-' + randomUUID() + '@nuqta.test');
  cashier = await login(app, 'cashier@bunn.test');
  const enrolled = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...customer, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: '40000000-0000-4000-8000-000000000001',
      programVersionId: '50000000-0000-4000-8000-000000000001',
      alias: 'Push customer',
      acceptedTerms: true,
      acceptedTermsHash: await enrollmentTerms(app, '40000000-0000-4000-8000-000000000001'),
      branchId: ids.branchA,
    },
  });
  assert.equal(enrolled.statusCode, 200);
  membership = enrolled.json().membershipId;
});
after(async () => {
  await app.close();
  await off.close();
  await worker.end();
  await db.end();
});
const post = (url: string, headers: typeof customer, payload: unknown, instance = app) =>
  instance.inject({
    method: 'POST',
    url,
    headers: { ...headers, ...key() },
    payload: payload as object,
  });
const requestStamp = async () => {
  const r = await post('/api/v1/me/stamp-requests', customer, {
    membershipId: membership,
    branchId: ids.branchA,
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().id as string;
};
const targets = async (request: string) =>
  (await worker.query("SELECT * FROM push_targets_for_scan('request',$1)", [request])).rows;

test('Web Push is invisible and queues nothing while no VAPID pair is configured', async () => {
  const config = await off.inject({ url: '/api/v1/me/push/config', headers: cashier });
  assert.deepEqual(config.json(), { enabled: false });
  const refused = await post(
    '/api/v1/me/push/subscribe',
    cashier,
    { subscription: subscription('off') },
    off,
  );
  assert.equal(refused.statusCode, 404);
});

test('only shop staff (owners, managers, cashiers) can register a device, and only for real push services', async () => {
  const config = await app.inject({ url: '/api/v1/me/push/config', headers: cashier });
  assert.deepEqual(config.json(), { enabled: true, publicKey: keys.publicKey });
  assert.equal(
    (await post('/api/v1/me/push/subscribe', customer, { subscription: subscription('c') }))
      .statusCode,
    403,
  );
  const elsewhere = { ...subscription('x'), endpoint: 'https://169.254.169.254/latest' };
  assert.equal(
    (await post('/api/v1/me/push/subscribe', cashier, { subscription: elsewhere })).statusCode,
    422,
  );
  const ok = await post('/api/v1/me/push/subscribe', cashier, {
    subscription: subscription('ok'),
    language: 'en',
  });
  assert.equal(ok.statusCode, 200, ok.body);
  const row = (await db.query("SELECT * FROM push_subscriptions WHERE endpoint LIKE '%/ok'"))
    .rows[0];
  assert.equal(row.language, 'en');
  // The same browser signing in as someone else takes the device over; it is never duplicated.
  await post('/api/v1/me/push/subscribe', cashier, { subscription: subscription('ok') });
  assert.equal(
    (await db.query("SELECT 1 FROM push_subscriptions WHERE endpoint LIKE '%/ok'")).rowCount,
    1,
  );
});

test('a new stamp request rings the branch’s cashiers with the branch name only', async () => {
  const request = await requestStamp();
  const job = (
    await db.query(
      'SELECT j.kind,e.payload FROM background_jobs j JOIN outbox_events e ON e.id=j.outbox_id WHERE e.aggregate_id=$1',
      [request],
    )
  ).rows;
  assert.deepEqual(
    job.map((r) => r.kind),
    ['cashier_push'],
  );
  assert.deepEqual(job[0].payload, { branchId: ids.branchA });
  assert.equal((await targets(request)).length >= 1, true);
  sent.length = 0;
  const outcome = await runCashierPushJob(
    worker,
    { ...c, ...vapid },
    { aggregate_id: request, payload: job[0].payload },
    transport,
  );
  assert.deepEqual(outcome, { outcome: 'succeeded', error: null });
  // Other test files' devices for the same cashier are rung too; read this file's own.
  const notice = decrypt(sent.find((s) => s.url.endsWith('/ok'))!.body);
  assert.deepEqual(Object.keys(notice).sort(), [
    'actions',
    'body',
    'dir',
    'lang',
    'tag',
    'title',
    'url',
  ]);
  assert.equal(notice.url, '/cashier/requests/' + request);
  assert.deepEqual(
    notice.actions.map((a: { action: string }) => a.action),
    ['reject-block'],
  );
  const branch = (await db.query('SELECT name FROM branches WHERE id=$1', [ids.branchA])).rows[0]
    .name;
  // The branch and the customer's first name; never the full name, balance or receipt.
  assert.equal(notice.body.startsWith(branch), true);
  assert.equal(notice.title.includes('customer'), false);
  // Asking again for the same pending request does not queue a second notification.
  await requestStamp();
  assert.equal(
    (
      await db.query(
        'SELECT 1 FROM background_jobs j JOIN outbox_events e ON e.id=j.outbox_id WHERE e.aggregate_id=$1',
        [request],
      )
    ).rowCount,
    1,
  );
  // The customer's request was decided or expired: nobody is rung any more.
  await db.query("UPDATE stamp_requests SET status='cancelled' WHERE id=$1", [request]);
  assert.equal((await targets(request)).length, 0);
});

test('a cashier whose grant on the branch is removed is no longer rung', async () => {
  // The earlier request was cancelled, so this one is a fresh pending request for the same branch.
  const request = await requestStamp();
  const grant = (
    await db.query('SELECT 1 FROM staff_branch_grants WHERE staff_id=$1 AND branch_id=$2', [
      ids.staffCashier,
      ids.branchA,
    ])
  ).rowCount;
  assert.equal(grant, 1);
  await db.query('DELETE FROM staff_branch_grants WHERE staff_id=$1 AND branch_id=$2', [
    ids.staffCashier,
    ids.branchA,
  ]);
  try {
    assert.equal((await targets(request)).length, 0);
  } finally {
    await db.query(
      'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
      [ids.merchantA, ids.staffCashier, ids.branchA],
    );
  }
});

test('the runtime role cannot read other people’s devices or call the worker functions, and signing out unlinks', async () => {
  const mine = await post('/api/v1/me/push/unsubscribe', cashier, {
    endpoint: subscription('nobody').endpoint,
  });
  assert.deepEqual(mine.json(), { removed: false });
  const runtime = new pg.Client({ connectionString: c.DATABASE_URL });
  await runtime.connect();
  try {
    assert.equal(
      (await runtime.query('SELECT count(*)::int AS n FROM push_subscriptions')).rows[0].n,
      0,
      'row level security hides every device without a signed-in user',
    );
    await assert.rejects(
      runtime.query("SELECT * FROM push_targets_for_scan('request',$1)", [randomUUID()]),
      /permission denied/,
    );
    await assert.rejects(
      runtime.query(
        'INSERT INTO push_subscriptions(user_id,session_id,endpoint,p256dh,auth) VALUES($1,$1,$2,$3,$4)',
        [randomUUID(), 'https://x', 'x', 'x'],
      ),
      /permission denied/,
    );
  } finally {
    await runtime.end();
  }
  assert.equal(
    (await post('/api/v1/me/push/subscribe', cashier, { subscription: subscription('logout') }))
      .statusCode,
    200,
  );
  assert.equal((await post('/api/v1/auth/logout', cashier, {})).statusCode, 204);
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM push_subscriptions WHERE endpoint LIKE '%/logout' OR endpoint LIKE '%/ok'",
      )
    ).rowCount,
    0,
  );
});

test('a customer device session of someone who also works at a shop can never hold a staff push subscription', async () => {
  const uid = (await db.query("SELECT id FROM users WHERE email='cashier@bunn.test'")).rows[0].id;
  await db.query('BEGIN');
  try {
    // The same person, signed in on a customer device (a dual-purpose legacy identity).
    await db.query(
      'INSERT INTO customer_identities(customer_id,legacy) VALUES($1,true) ON CONFLICT DO NOTHING',
      [uid],
    );
    const deviceId = (
      await db.query(
        "INSERT INTO customer_devices(customer_id,token_hash,user_agent_family) VALUES($1,$2,'Chrome') RETURNING id",
        [uid, randomUUID().replace(/-/g, '').padEnd(64, '0')],
      )
    ).rows[0].id;
    const session = (
      await db.query(
        "INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at,auth_method,customer_device_id,credential_version) SELECT $1,$2,'x',now()+interval '1 hour','device',$3,u.password_version FROM users u WHERE u.id=$1 RETURNING id",
        [uid, randomUUID(), deviceId],
      )
    ).rows[0].id;
    await db.query('SAVEPOINT attempt');
    await assert.rejects(
      db.query(
        "INSERT INTO push_subscriptions(user_id,session_id,endpoint,p256dh,auth) VALUES($1,$2,'https://fcm.googleapis.com/fcm/send/device','x','x')",
        [uid, session],
      ),
      /NQ:FORBIDDEN/,
    );
    await db.query('ROLLBACK TO SAVEPOINT attempt');
  } finally {
    await db.query('ROLLBACK');
  }
});
