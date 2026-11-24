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

// Redeem by request, with no QR and no scan: the customer taps Redeem, the branch is rung with the
// customer's first name, the reward and a 2-digit match number, and a cashier confirms (the reward is
// handed over once and a new card starts) or rejects (the reward stays). One open request per reward,
// 10 minutes to decide, nothing for a blocked customer, and the shop's scan rate limit applies.
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
  endpoint = 'https://fcm.googleapis.com/fcm/send/redeem-' + randomUUID(),
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
    remoteAddress = '10.25.' + Math.floor(++address / 250) + '.' + ((address % 250) + 1);
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
  const email = 'redeem-' + randomUUID() + '@nuqta.test',
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
    "INSERT INTO placements(merchant_id,branch_id,label,kind,public_code,created_by) VALUES($1,$2,'Redeem fixture','sticker',$3,$4)",
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

const me = (who: Customer, path = '') =>
  app.inject({ url: '/api/v1/me/memberships/' + who.membership + path, headers: who.headers });
const card = async (who: Customer) => (await me(who)).json().card;
const rewardJobs = async (who: Customer) =>
  (
    await db.query(
      `SELECT e.aggregate_id,e.payload FROM background_jobs j JOIN outbox_events e ON e.id=j.outbox_id
       WHERE j.kind='cashier_push' AND e.aggregate_id IN (SELECT id FROM reward_grants WHERE membership_id=$1)
       ORDER BY e.created_at`,
      [who.membership],
    )
  ).rows as { aggregate_id: string; payload: Record<string, unknown> }[];
let receipts = 0;
// One stamp through the shop's own flow for the current mode: the sticker scan, and in approval mode
// the cashier's receipt.
async function stamp(who: Customer, mode: 'auto' | 'approval') {
  const r = await scan(who);
  assert.equal(r.statusCode, 200, r.body);
  if (mode === 'auto') assert.equal(r.json().outcome, 'awarded', r.body);
  else {
    assert.equal(r.json().outcome, 'pending', r.body);
    const d = await post(
      merchantUrl + '/stamp-requests/' + r.json().request.id + '/decision',
      cashier,
      { approve: true, receipt: 'REDEEM-' + ++receipts, quantity: 1 },
    );
    assert.equal(d.statusCode, 200, d.body);
  }
  // Past the 60-second floor and outside the scan rate window, without waiting.
  await age(who.membership);
  await db.query('DELETE FROM scan_attempts WHERE user_id=$1', [who.userId]);
}

const requestUrl = (rewardId: string) => '/api/v1/me/rewards/' + rewardId + '/redeem-requests';
const ask = (who: Customer, rewardId: string, idempotency = randomUUID()) =>
  post(requestUrl(rewardId), who.headers, { branchId: ids.branchA }, idempotency);
const decide = (id: string, approve: boolean, as: Headers = cashier, idempotency = randomUUID()) =>
  post(
    merchantUrl + '/redeem-requests/' + id + '/decision',
    as,
    { approve, branchId: ids.branchA },
    idempotency,
  );
const mine = async (who: Customer) =>
  (await app.inject({ url: '/api/v1/me/redeem-requests', headers: who.headers })).json()
    .requests as { id: string; status: string; match_number: number; reward_id: string }[];
const queue = async () =>
  (
    await app.inject({
      url: merchantUrl + '/redeem-requests?branchId=' + ids.branchA,
      headers: cashier,
    })
  ).json().requests as { id: string; alias: string; match_number: number; title: string }[];
const requestJobs = async (requestId: string) =>
  (
    await db.query(
      `SELECT e.aggregate_id,e.payload FROM background_jobs j JOIN outbox_events e ON e.id=j.outbox_id
       WHERE j.kind='cashier_push' AND e.aggregate_id=$1 ORDER BY e.created_at`,
      [requestId],
    )
  ).rows as { aggregate_id: string; payload: Record<string, unknown> }[];
const requestPushes = async () =>
  (
    await db.query(
      "SELECT count(*)::int AS n FROM outbox_events WHERE event_type='reward.request.push' AND merchant_id=$1",
      [ids.merchantA],
    )
  ).rows[0].n as number;
// A customer whose card just filled, with the reward waiting.
async function fullCard(alias = 'Mona Ahmed') {
  await configure(automatic);
  const who = await customer(alias);
  for (let i = 0; i < 5; i++) await stamp(who, 'auto');
  const [reward] = (await me(who, '/rewards')).json().rewards;
  assert.equal(reward.status, 'available');
  return { who, reward: reward as { id: string; title: string } };
}
const facts = async (rewardId: string, membership: string) =>
  (
    await db.query(
      `SELECT (SELECT count(*)::int FROM reward_redemptions WHERE reward_id=$1) AS redemptions,
              (SELECT count(*)::int FROM loyalty_transactions WHERE membership_id=$2 AND type='redeem') AS transactions,
              (SELECT count(*)::int FROM audit_events WHERE action='reward.redeem' AND target_id=$1) AS audits,
              (SELECT count(*)::int FROM reward_events WHERE reward_id=$1 AND event_type='redeemed') AS events`,
      [rewardId, membership],
    )
  ).rows[0];
const once = { redemptions: 1, transactions: 1, audits: 1, events: 1 };

test('confirm: the cashier is rung, confirms once, and a new card starts', async () => {
  const { who, reward } = await fullCard('Mona Ahmed');
  const asked = await ask(who, reward.id);
  assert.equal(asked.statusCode, 200, asked.body);
  const request = asked.json();
  assert.equal(request.status, 'requested');
  assert.ok(request.matchNumber >= 10 && request.matchNumber <= 99, String(request.matchNumber));
  const life = new Date(request.expiresAt).getTime() - Date.now();
  assert.ok(life > 9 * 60_000 && life <= 10 * 60_000, String(life));
  // Tapping Redeem again shows the same request: one open request per reward, rung once.
  const again = await ask(who, reward.id);
  assert.equal(again.statusCode, 200, again.body);
  assert.deepEqual([again.json().id, again.json().matchNumber], [request.id, request.matchNumber]);
  const jobs = await requestJobs(request.id);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.payload.kind, 'reward_request');
  const rung = await deliver(jobs[0]!);
  assert.deepEqual(rung.outcome, { outcome: 'succeeded', error: null });
  assert.equal(rung.notices.length, 1);
  assert.equal(rung.notices[0].title, 'Redeem request · Mona');
  assert.ok(
    rung.notices[0].body.startsWith(reward.title + ' · match ' + request.matchNumber + ' · '),
    rung.notices[0].body,
  );
  assert.equal(rung.notices[0].url, '/cashier/redeem/' + request.id);
  // The till lists it with the name and the match number; the customer sees it waiting.
  const listed = (await queue()).find((r) => r.id === request.id);
  assert.ok(listed, 'the branch lists the request');
  assert.deepEqual([listed.alias, listed.match_number], ['Mona Ahmed', request.matchNumber]);
  assert.equal((await mine(who)).find((r) => r.id === request.id)?.status, 'requested');
  const opened = await app.inject({
    url: merchantUrl + '/redeem-requests/' + request.id,
    headers: cashier,
  });
  assert.equal(opened.statusCode, 200, opened.body);
  assert.equal(opened.json().request.status, 'requested');
  // Confirm; the same tap retried (a lost reply) returns the same handover, not a second one.
  const confirmKey = randomUUID();
  const done = await decide(request.id, true, cashier, confirmKey);
  assert.equal(done.statusCode, 200, done.body);
  assert.deepEqual([done.json().cycleNumber, done.json().status], [2, 'redeemed']);
  const replay = await decide(request.id, true, cashier, confirmKey);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().transactionId, done.json().transactionId);
  assert.deepEqual(await facts(reward.id, who.membership), once);
  const audit = (
    await db.query(
      "SELECT actor_id,detail FROM audit_events WHERE action='reward.redeem' AND target_id=$1",
      [reward.id],
    )
  ).rows[0];
  assert.equal(audit.detail.requestId, request.id);
  assert.equal(audit.actor_id, ids.cashier);
  // The customer's screen reads Redeemed and the card is on cycle 2.
  assert.equal((await mine(who)).find((r) => r.id === request.id)?.status, 'completed');
  const c2 = await card(who);
  assert.deepEqual([c2.balance, c2.pending_rewards, c2.cycle_number], [0, 0, 2]);
  assert.equal((await me(who, '/rewards')).json().rewards[0].status, 'redeemed');
  assert.ok(!(await queue()).some((r) => r.id === request.id), 'gone from the till');
  // Nothing more to ask for, and the branch was told it was handed over.
  const after = await ask(who, reward.id);
  assert.equal(after.statusCode, 409, after.body);
  assert.equal(after.json().error.code, 'REWARD_UNAVAILABLE');
  assert.deepEqual(
    (await rewardJobs(who)).map((j) => j.payload.kind),
    ['reward_earned', 'reward_redeemed'],
  );
  // The next stamp lands on the new card.
  await stamp(who, 'auto');
  const c3 = await card(who);
  assert.deepEqual([c3.balance, c3.cycle_number], [1, 2]);
});

test('extra stamps: rejecting changes nothing, approving starts the next round keeping them', async () => {
  const { who, reward } = await fullCard();
  // Two stamps land while the reward waits: they belong to the next card.
  await stamp(who, 'auto');
  await stamp(who, 'auto');
  const before = await card(who);
  assert.deepEqual([before.balance, before.pending_rewards, before.cycle_number], [2, 1, 1]);
  const first = (await ask(who, reward.id)).json();
  assert.equal((await decide(first.id, false)).statusCode, 200);
  const rejected = await card(who);
  assert.deepEqual([rejected.balance, rejected.pending_rewards, rejected.cycle_number], [2, 1, 1]);
  assert.equal((await me(who, '/rewards')).json().rewards[0].status, 'available');
  const second = (await ask(who, reward.id)).json();
  assert.equal((await decide(second.id, true)).statusCode, 200);
  const approved = await card(who);
  assert.deepEqual([approved.balance, approved.pending_rewards, approved.cycle_number], [2, 0, 2]);
});

test('two cards: a request on one card never touches the other', async () => {
  const a = await fullCard('Card A'),
    b = await fullCard('Card B');
  const request = (await ask(a.who, a.reward.id)).json();
  assert.equal((await decide(request.id, true)).statusCode, 200);
  assert.equal((await me(b.who, '/rewards')).json().rewards[0].status, 'available');
  assert.equal((await card(b.who)).cycle_number, 1);
  assert.equal((await mine(b.who)).length, 0);
});

test('double confirm: two cashiers at once hand the reward over exactly once', async () => {
  const { who, reward } = await fullCard();
  const request = (await ask(who, reward.id)).json();
  const [a, b] = await Promise.all([decide(request.id, true), decide(request.id, true, owner)]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409], a.body + b.body);
  assert.equal((a.statusCode === 200 ? b : a).json().error.code, 'REWARD_ALREADY_USED');
  // A later tap, or a reject after the fact, changes nothing.
  const late = await decide(request.id, true);
  assert.equal(late.statusCode, 409, late.body);
  assert.equal(late.json().error.code, 'REWARD_ALREADY_USED');
  assert.equal((await decide(request.id, false)).statusCode, 409);
  assert.deepEqual(await facts(reward.id, who.membership), once);
  assert.equal((await card(who)).cycle_number, 2);
});

test('reject: the customer is told and the reward stays available', async () => {
  const { who, reward } = await fullCard();
  const request = (await ask(who, reward.id)).json();
  const rejected = await decide(request.id, false);
  assert.equal(rejected.statusCode, 200, rejected.body);
  assert.equal(rejected.json().status, 'rejected');
  assert.equal((await mine(who)).find((r) => r.id === request.id)?.status, 'rejected');
  assert.equal((await me(who, '/rewards')).json().rewards[0].status, 'available');
  assert.equal((await card(who)).cycle_number, 1);
  const audits = (
    await db.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action='redeem_request.reject' AND target_id=$1",
      [reward.id],
    )
  ).rows[0].n;
  assert.equal(audits, 1);
  // A rejected request cannot be confirmed afterwards.
  const confirm = await decide(request.id, true);
  assert.equal(confirm.statusCode, 409, confirm.body);
  assert.equal(confirm.json().error.code, 'CHALLENGE_FINAL');
  assert.equal((await facts(reward.id, who.membership)).redemptions, 0);
  // The customer can ask again, and that one goes through.
  const retry = (await ask(who, reward.id)).json();
  assert.notEqual(retry.id, request.id);
  assert.equal((await decide(retry.id, true)).statusCode, 200);
  assert.deepEqual(await facts(reward.id, who.membership), once);
});

test('expiry: a request lives 10 minutes, then cannot be confirmed and can be asked again', async () => {
  const { who, reward } = await fullCard();
  const request = (await ask(who, reward.id)).json();
  await db.query(
    "UPDATE redemption_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [request.id],
  );
  // Nobody is rung for it any more, the till no longer lists it and the customer reads expired.
  assert.deepEqual((await deliver((await requestJobs(request.id))[0]!)).outcome, {
    outcome: 'succeeded',
    error: 'NO_RECIPIENTS',
  });
  assert.ok(!(await queue()).some((r) => r.id === request.id));
  assert.equal((await mine(who)).find((r) => r.id === request.id)?.status, 'expired');
  const late = await decide(request.id, true);
  assert.equal(late.statusCode, 410, late.body);
  assert.equal(late.json().error.code, 'CHALLENGE_EXPIRED');
  assert.equal((await me(who, '/rewards')).json().rewards[0].status, 'available');
  assert.equal((await facts(reward.id, who.membership)).redemptions, 0);
  // A new tap is a new request with a new 10 minutes.
  const fresh = await ask(who, reward.id);
  assert.equal(fresh.statusCode, 200, fresh.body);
  assert.notEqual(fresh.json().id, request.id);
  const open = (
    await db.query(
      "SELECT count(*)::int AS n FROM redemption_challenges WHERE reward_id=$1 AND status='requested'",
      [reward.id],
    )
  ).rows[0].n;
  assert.equal(open, 1);
});

test('blocked: no request, no ring, and a waiting request is closed to the till', async () => {
  const { who, reward } = await fullCard();
  // Blocked while a request waits: the till stops listing it and Confirm is refused.
  const waiting = (await ask(who, reward.id)).json();
  const blocked = await post(merchantUrl + '/customer-blocks', cashier, {
    membershipId: who.membership,
    origin: 'manual',
  });
  assert.equal(blocked.statusCode, 200, blocked.body);
  assert.ok(!(await queue()).some((r) => r.id === waiting.id));
  assert.deepEqual((await deliver((await requestJobs(waiting.id))[0]!)).outcome, {
    outcome: 'succeeded',
    error: 'NO_RECIPIENTS',
  });
  const refused = await decide(waiting.id, true);
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().error.code, 'REWARD_UNAVAILABLE');
  // A new tap is refused with the neutral answer, counted on the Spam list, and rings nobody.
  await db.query("UPDATE redemption_challenges SET status='cancelled' WHERE id=$1", [waiting.id]);
  const pushes = await requestPushes();
  const asked = await ask(who, reward.id);
  assert.equal(asked.statusCode, 409, asked.body);
  assert.equal(asked.json().error.code, 'REWARD_UNAVAILABLE');
  const block = (
    await db.query(
      'SELECT attempts FROM customer_blocks WHERE merchant_id=$1 AND user_id=$2 AND unblocked_at IS NULL',
      [ids.merchantA, who.userId],
    )
  ).rows[0];
  assert.equal(block.attempts, 1);
  assert.equal(await requestPushes(), pushes);
  assert.equal((await facts(reward.id, who.membership)).redemptions, 0);
});

test('rate limit: redeem requests share the shop scan limit', async () => {
  const { who, reward } = await fullCard();
  await db.query(
    'INSERT INTO scan_attempts(merchant_id,user_id) SELECT $1,$2 FROM generate_series(1,6)',
    [ids.merchantA, who.userId],
  );
  const limited = await ask(who, reward.id);
  assert.equal(limited.statusCode, 429, limited.body);
  assert.equal(limited.json().error.code, 'RATE_LIMITED');
  await db.query('DELETE FROM scan_attempts WHERE user_id=$1', [who.userId]);
  assert.equal((await ask(who, reward.id)).statusCode, 200);
});

test('a customer can only ask for their own reward, and cancel their own request', async () => {
  const { who, reward } = await fullCard();
  const other = await customer();
  const foreign = await ask(other, reward.id);
  assert.equal(foreign.statusCode, 404, foreign.body);
  const request = (await ask(who, reward.id)).json();
  const theirs = await post(
    '/api/v1/me/redeem-requests/' + request.id + '/cancel',
    other.headers,
    {},
  );
  assert.equal(theirs.statusCode, 404, theirs.body);
  const cancelled = await post(
    '/api/v1/me/redeem-requests/' + request.id + '/cancel',
    who.headers,
    {},
  );
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal(cancelled.json().status, 'cancelled');
  assert.equal((await decide(request.id, true)).statusCode, 409);
});
