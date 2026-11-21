import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { b64url, generateVapidKeys } from '../../apps/api/src/webpush.js';
import { runCashierPushJob } from '../../apps/worker/src/cashier-push.js';
import { seed, ids } from '../../db/seed.js';
import { adminLogin, enrollmentTerms, key, login } from '../helpers.js';

// The scan → stamp flow with cashier notifications in both modes, per-merchant blocks, the
// revoke-after-redemption rule and the scan rate limit.
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
  endpoint = 'https://fcm.googleapis.com/fcm/send/scan-' + randomUUID(),
  transport = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: Buffer.from(init!.body as Uint8Array) });
    return new Response('', { status: 201 });
  }) as typeof fetch;
const { app } = await buildApp(
  { APP_ENV: 'test', LOG_LEVEL: 'silent', ...vapid },
  { pushTransport: transport },
);
const program = '40000000-0000-4000-8000-000000000001',
  version = '50000000-0000-4000-8000-000000000001',
  settingsUrl = '/api/v1/platform/merchants/' + ids.merchantA + '/stamp-collection-settings',
  merchantUrl = '/api/v1/merchants/' + ids.merchantA;
type Headers = Awaited<ReturnType<typeof login>>;
type Customer = { headers: Headers; membership: string; userId: string };
let admin: Headers, owner: Headers, cashier: Headers, terms: string, code: string;
const base = {
  requireLocation: false,
  maxAccuracy: 100,
  stampsPerDay: null,
  limitWindow: 'local_day',
  cooldownMinutes: 0,
  defaultStamps: 1,
  allowMultiple: true,
  maxStampsPerCollection: 100,
  welcomeStamps: 0,
  autoBranchHourlyCap: 1000,
  revokeWindowMinutes: 30,
};
const automatic = {
  ...base,
  requireCashier: false,
  collectionsPerDay: 20,
  openCollectionAcknowledged: true,
};
const approval = {
  ...base,
  requireCashier: true,
  collectionsPerDay: null,
  openCollectionAcknowledged: false,
};
async function configure(settings: Record<string, unknown>) {
  const current = (await app.inject({ url: settingsUrl, headers: admin })).json();
  const r = await app.inject({
    method: 'PATCH',
    url: settingsUrl,
    headers: { ...admin, 'if-match': String(current.settings.revision) },
    payload: settings,
  });
  assert.equal(r.statusCode, 200, r.body);
}
let address = 0;
async function signIn(email: string): Promise<Headers> {
  const origin = c.PUBLIC_APP_ORIGIN,
    remoteAddress = '10.23.' + Math.floor(++address / 250) + '.' + ((address % 250) + 1);
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
async function customer(alias = 'Mona Ahmed'): Promise<Customer> {
  const email = 'scan-' + randomUUID() + '@nuqta.test',
    headers = await signIn(email);
  const enrolled = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...headers, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: program,
      programVersionId: version,
      alias,
      acceptedTerms: true,
      acceptedTermsHash: terms,
      branchId: ids.branchA,
    },
  });
  assert.equal(enrolled.statusCode, 200, enrolled.body);
  const userId = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  return { headers, membership: enrolled.json().membershipId as string, userId };
}
const scan = (who: Customer, idempotency = randomUUID()) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/me/stamp-collections',
    headers: { ...who.headers, 'idempotency-key': idempotency },
    payload: { membershipId: who.membership, branchId: ids.branchA, placementCode: code },
  });
const post = (url: string, as: Headers, payload: unknown, idempotency = randomUUID()) =>
  app.inject({
    method: 'POST',
    url,
    headers: { ...as, 'idempotency-key': idempotency },
    payload: payload as object,
  });
const block = (as: Headers, who: Customer, origin = 'manual', originId?: string) =>
  post(merchantUrl + '/customer-blocks', as, {
    membershipId: who.membership,
    origin,
    ...(originId ? { originId } : {}),
  });
const stamps = async (membership: string) =>
  Number(
    (
      await db.query(
        "SELECT count(*) FROM loyalty_transactions WHERE membership_id=$1 AND type='award'",
        [membership],
      )
    ).rows[0].count,
  );
// Every cashier notification queued for one customer's scans, of either kind.
const pushJobs = async (who: Customer) =>
  (
    await db.query(
      `SELECT e.aggregate_id,e.payload FROM background_jobs j JOIN outbox_events e ON e.id=j.outbox_id
       WHERE j.kind='cashier_push' AND (e.aggregate_id IN (SELECT id FROM stamp_requests WHERE membership_id=$1)
        OR e.aggregate_id IN (SELECT id FROM loyalty_transactions WHERE membership_id=$1))`,
      [who.membership],
    )
  ).rows as { aggregate_id: string; payload: Record<string, unknown> }[];
// Let the next scan through the 60-second duplicate floor without waiting a minute.
async function age(membership: string) {
  await db.query('ALTER TABLE loyalty_transactions DISABLE TRIGGER transaction_immutable');
  try {
    await db.query(
      "UPDATE loyalty_transactions SET at=at-interval '2 minutes' WHERE membership_id=$1",
      [membership],
    );
  } finally {
    await db.query('ALTER TABLE loyalty_transactions ENABLE TRIGGER transaction_immutable');
  }
}
// A browser's own key pair, so what the worker sends can be decrypted here.
const device = createECDH('prime256v1'),
  authSecret = Buffer.from('fedcba9876543210');
device.generateKeys();
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
async function deliver(job: { aggregate_id: string; payload: Record<string, unknown> }) {
  sent.length = 0;
  const outcome = await runCashierPushJob(worker, { ...c, ...vapid }, job, transport);
  // Integration files share one database: other files' devices for this cashier are rung too.
  return { outcome, notices: sent.filter((s) => s.url === endpoint).map((s) => decrypt(s.body)) };
}

before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  admin = await adminLogin(app, db);
  owner = await login(app, 'owner@bunn.test');
  cashier = await login(app, 'cashier@bunn.test');
  code = randomBytes(24).toString('base64url');
  await db.query(
    "INSERT INTO placements(merchant_id,branch_id,label,kind,public_code,created_by) VALUES($1,$2,'Scan fixture','sticker',$3,$4)",
    [ids.merchantA, ids.branchA, code, ids.ownerA],
  );
  terms = await enrollmentTerms(app, program);
  // The branch cashier's phone, so the worker has someone to ring.
  const subscribed = await post('/api/v1/me/push/subscribe', cashier, {
    subscription: {
      endpoint,
      keys: { p256dh: b64url(device.getPublicKey()), auth: b64url(authSecret) },
    },
    language: 'en',
  });
  assert.equal(subscribed.statusCode, 200, subscribed.body);
});
after(async () => {
  await configure(approval);
  await app.close();
  await worker.end();
  await db.end();
});

test('no-approval mode: the stamp is given at once and the cashier is pushed revoke and block', async () => {
  await configure(automatic);
  const who = await customer('Mona Ahmed');
  const r = await scan(who);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().outcome, 'awarded');
  const tx = r.json().transactionId as string;
  const jobs = await pushJobs(who);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0]!.payload, { branchId: ids.branchA, kind: 'auto_stamp' });
  assert.equal(jobs[0]!.aggregate_id, tx);
  const { outcome, notices } = await deliver(jobs[0]!);
  assert.deepEqual(outcome, { outcome: 'succeeded', error: null });
  assert.equal(notices.length, 1);
  const notice = notices[0];
  // First name only on the lock screen (D4), and the screen it opens carries everything else.
  assert.equal(notice.title, 'Stamp added · Mona');
  assert.equal(notice.title.includes('Ahmed'), false);
  assert.equal(notice.url, '/cashier/stamps/' + tx);
  assert.deepEqual(
    notice.actions.map((a: { action: string }) => a.action),
    ['revoke', 'block'],
  );
  // The screen behind the notification.
  const detail = await app.inject({ url: merchantUrl + '/auto-stamps/' + tx, headers: cashier });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().stamp.alias, 'Mona Ahmed');
  assert.equal(detail.json().stamp.customerBlocked, false);
  assert.notEqual(detail.json().stamp.revocableUntil, null);
});

test('approval mode: the push opens the request; a typed receipt grants the stamp, duplicates only warn', async () => {
  await configure(approval);
  const who = await customer('Omar');
  const r = await scan(who);
  assert.equal(r.json().outcome, 'pending', r.body);
  const request = r.json().request.id as string;
  const jobs = await pushJobs(who);
  assert.equal(jobs.length, 1);
  const { notices } = await deliver(jobs[0]!);
  assert.equal(notices[0].url, '/cashier/requests/' + request);
  assert.equal(notices[0].title, 'Stamp to approve · Omar');
  assert.deepEqual(
    notices[0].actions.map((a: { action: string }) => a.action),
    ['reject-block'],
  );
  const decide = (payload: unknown, idempotency = randomUUID()) =>
    post(merchantUrl + '/stamp-requests/' + request + '/decision', cashier, payload, idempotency);
  // No customer QR and no match code: the receipt alone approves. Twelve taps, one stamp.
  const k = randomUUID(),
    replies = await Promise.all(
      Array.from({ length: 12 }, () =>
        decide({ approve: true, receipt: ' INV 77 ', quantity: 1 }, k),
      ),
    );
  assert.ok(
    replies.every((x) => x.statusCode === 200),
    replies[0]!.body,
  );
  assert.equal(new Set(replies.map((x) => x.json().transactionId)).size, 1);
  assert.equal(replies[0]!.json().purchaseId, null);
  assert.equal(replies[0]!.json().receiptAlreadyUsed, false);
  assert.equal(await stamps(who.membership), 1);
  const saved = (
    await db.query(
      'SELECT t.receipt_note,r.receipt_note AS request_note,r.status FROM loyalty_transactions t JOIN stamp_requests r ON r.transaction_id=t.id WHERE r.id=$1',
      [request],
    )
  ).rows[0];
  assert.deepEqual(saved, { receipt_note: 'INV 77', request_note: 'INV 77', status: 'approved' });
  // A fresh key cannot reuse the decided request.
  assert.equal((await decide({ approve: true, receipt: 'INV 78', quantity: 1 })).statusCode, 409);
  // The same receipt on another customer's request is allowed, with a warning.
  const other = await customer('Sara');
  const second = (await scan(other)).json().request.id as string;
  assert.deepEqual(
    (
      await app.inject({
        url: merchantUrl + '/receipts/used?receipt=' + encodeURIComponent('inv 77'),
        headers: cashier,
      })
    ).json(),
    { used: true },
  );
  const again = await post(merchantUrl + '/stamp-requests/' + second + '/decision', cashier, {
    approve: true,
    receipt: 'inv 77',
    quantity: 1,
  });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().receiptAlreadyUsed, true);
});

test('a blocked customer’s scan gives no stamp and sends no push, in both modes, and is counted', async () => {
  await configure(automatic);
  const who = await customer('Spam Sender');
  const first = await scan(who);
  assert.equal(first.json().outcome, 'awarded');
  const tx = first.json().transactionId as string;
  // The cashier blocks from the stamp's notification.
  const blocked = await block(cashier, who, 'auto_stamp', tx);
  assert.equal(blocked.statusCode, 200, blocked.body);
  assert.equal(blocked.json().blocked, true);
  const blockId = blocked.json().blockId as string;
  const audit = (
    await db.query(
      "SELECT actor_id,detail FROM audit_events WHERE action='customer.block' AND target_id=$1",
      [who.userId],
    )
  ).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_id, ids.cashier);
  assert.equal(audit[0].detail.originId, tx);
  const before = { stamps: await stamps(who.membership), pushes: (await pushJobs(who)).length };
  await age(who.membership);
  // No-approval mode.
  const refused = await scan(who);
  assert.equal(refused.statusCode, 200, refused.body);
  assert.deepEqual(refused.json(), { outcome: 'not_eligible', reason: 'unavailable' });
  // Approval mode: no request is created either.
  await configure(approval);
  const pending = await scan(who);
  assert.deepEqual(pending.json(), { outcome: 'not_eligible', reason: 'unavailable' });
  const direct = await post('/api/v1/me/stamp-requests', who.headers, {
    membershipId: who.membership,
    branchId: ids.branchA,
  });
  assert.equal(direct.statusCode, 409);
  assert.equal(direct.json().error.code, 'STAMP_UNAVAILABLE');
  assert.equal(await stamps(who.membership), before.stamps);
  assert.equal((await pushJobs(who)).length, before.pushes);
  assert.equal(
    (await db.query('SELECT 1 FROM stamp_requests WHERE membership_id=$1', [who.membership]))
      .rowCount,
    0,
  );
  // Enforced in the database too: the stamp function itself refuses a blocked customer.
  const runtime = new pg.Client({ connectionString: c.DATABASE_URL });
  await runtime.connect();
  try {
    await configure(automatic);
    await runtime.query('BEGIN');
    await runtime.query("SELECT set_config('app.user_id',$1,true)", [who.userId]);
    const op = (
      await runtime.query(
        "INSERT INTO operations(actor_id,merchant_id,scope,idempotency_key,request_hash) VALUES($1,$2,'collection.auto',$3,'x') RETURNING id",
        [who.userId, ids.merchantA, randomUUID()],
      )
    ).rows[0].id;
    const direct = (
      await runtime.query('SELECT collect_stamp_automatically($1,$2,$3) AS v', [
        who.membership,
        ids.branchA,
        op,
      ])
    ).rows[0].v;
    assert.deepEqual(direct, { eligible: false, reason: 'spam_blocked' });
  } finally {
    await runtime.query('ROLLBACK').catch(() => {});
    await runtime.end();
  }
  // A cashier cannot hand a blocked customer a stamp either way: the request queue is closed too.
  // The Spam list shows the attempts.
  const listed = await app.inject({ url: merchantUrl + '/customer-blocks', headers: cashier });
  assert.equal(listed.statusCode, 200, listed.body);
  const list = listed.json().blocks as {
    blockId: string;
    alias: string;
    attempts: number;
    lastAttemptAt: string;
  }[];
  const row = list.find((b) => b.blockId === blockId)!;
  assert.equal(row.alias, 'Spam Sender');
  assert.equal(row.attempts, 3);
  assert.ok(row.lastAttemptAt);
  // Unblock: audited with the cashier, and the next scan collects again.
  const unblocked = await post(
    merchantUrl + '/customer-blocks/' + blockId + '/unblock',
    cashier,
    {},
  );
  assert.equal(unblocked.statusCode, 200, unblocked.body);
  assert.equal(unblocked.json().changed, true);
  assert.equal(
    (
      await db.query(
        "SELECT actor_id FROM audit_events WHERE action='customer.unblock' AND target_id=$1",
        [who.userId],
      )
    ).rows[0].actor_id,
    ids.cashier,
  );
  const back = await scan(who);
  assert.equal(back.json().outcome, 'awarded', back.body);
});

test('Reject & Block closes the request, blocks the customer, and still blocks once it expired', async () => {
  await configure(approval);
  const who = await customer('Late Night');
  const request = (await scan(who)).json().request.id as string;
  const r = await post(merchantUrl + '/stamp-requests/' + request + '/decision', cashier, {
    approve: false,
    block: true,
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, 'rejected');
  assert.equal(r.json().blocked, true);
  assert.equal(
    (await db.query('SELECT status FROM stamp_requests WHERE id=$1', [request])).rows[0].status,
    'rejected',
  );
  // A plain rejection without a reason is refused.
  const someone = await customer('Plain');
  const open = (await scan(someone)).json().request.id as string;
  assert.equal(
    (
      await post(merchantUrl + '/stamp-requests/' + open + '/decision', cashier, {
        approve: false,
      })
    ).statusCode,
    422,
  );
  // Tapped after the request timed out: no rejection to record, but the block still applies.
  await db.query(
    "UPDATE stamp_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [open],
  );
  const late = await post(merchantUrl + '/stamp-requests/' + open + '/decision', cashier, {
    approve: false,
    block: true,
  });
  assert.equal(late.statusCode, 200, late.body);
  assert.equal(late.json().blocked, true);
  assert.equal(
    (await db.query('SELECT customer_blocked($1,$2) AS b', [ids.merchantA, someone.userId])).rows[0]
      .b,
    true,
  );
});

test('revoke is refused once the stamp counted toward a redeemed reward, for every role', async () => {
  await configure(automatic);
  const who = await customer('Rewarded');
  const threshold = (
    await db.query('SELECT threshold FROM program_versions WHERE id=$1', [version])
  ).rows[0].threshold as number;
  // An early stamp, then enough later stamps to complete the card.
  const early = (await scan(who)).json().transactionId as string;
  for (let i = 1; i < threshold; i++) {
    await age(who.membership);
    assert.equal((await scan(who)).json().outcome, 'awarded');
  }
  const reward = (
    await db.query("SELECT id FROM reward_grants WHERE membership_id=$1 AND status='available'", [
      who.membership,
    ])
  ).rows[0];
  assert.ok(reward, 'the card is complete');
  await db.query(
    "UPDATE reward_grants SET status='redeemed',redeemed_at=clock_timestamp() WHERE id=$1",
    [reward.id],
  );
  // One more stamp afterwards, so a low balance is not what refuses the revoke.
  await age(who.membership);
  await scan(who);
  for (const as of [cashier, owner]) {
    const r = await post(merchantUrl + '/auto-stamps/' + early + '/revoke', as, {
      reason: 'Customer was not in the shop',
    });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().error.code, 'REWARD_ALREADY_REDEEMED');
  }
  const detail = (
    await app.inject({ url: merchantUrl + '/auto-stamps/' + early, headers: owner })
  ).json().stamp;
  assert.equal(detail.usedInRedeemedReward, true);
  assert.equal(detail.revocableUntil, null);
});

test('the scan rate limit holds under parallel taps', async () => {
  await configure(automatic);
  const who = await customer('Fast Tapper');
  const replies = await Promise.all(Array.from({ length: 15 }, () => scan(who)));
  assert.ok(
    replies.every((r) => r.statusCode === 200),
    replies.find((r) => r.statusCode !== 200)?.body,
  );
  const limited = replies.filter((r) => r.json().reason === 'rate_limited').length;
  // Exactly six scans get past the limiter (6 per 10 minutes), however the taps interleave...
  assert.equal(limited, 9);
  assert.equal(
    Number(
      (
        await db.query('SELECT count(*) FROM scan_attempts WHERE merchant_id=$1 AND user_id=$2', [
          ids.merchantA,
          who.userId,
        ])
      ).rows[0].count,
    ),
    6,
  );
  // ...and of those, the 60-second floor lets exactly one stamp through.
  assert.equal(replies.filter((r) => r.json().outcome === 'awarded').length, 1);
  assert.equal(await stamps(who.membership), 1);
  assert.equal((await pushJobs(who)).length, 1);
});
