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

// The whole card cycle through the paths customers use since 038: a full card becomes a reward, the
// reward is redeemed exactly once from the customer's Redeem code, the next card starts with any
// stamps that arrived in between, and the branch staff are rung on both events. Also: a card that
// was left holding a full card's worth of stamps without a reward is repaired with nothing lost.
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
  endpoint = 'https://fcm.googleapis.com/fcm/send/cycle-' + randomUUID(),
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
    remoteAddress = '10.24.' + Math.floor(++address / 250) + '.' + ((address % 250) + 1);
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
  const email = 'cycle-' + randomUUID() + '@nuqta.test',
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
    "INSERT INTO placements(merchant_id,branch_id,label,kind,public_code,created_by) VALUES($1,$2,'Cycle fixture','sticker',$3,$4)",
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
      { approve: true, receipt: 'CYCLE-' + ++receipts, quantity: 1 },
    );
    assert.equal(d.statusCode, 200, d.body);
  }
  // Past the 60-second floor and outside the scan rate window, without waiting.
  await age(who.membership);
  await db.query('DELETE FROM scan_attempts WHERE user_id=$1', [who.userId]);
}
const issue = (who: Customer, body: Record<string, unknown>) =>
  post('/api/v1/me/memberships/' + who.membership + '/presentation-tokens', who.headers, body);
const resolve = (token: string) =>
  post('/api/v1/cashier/scans/resolve', cashier, {
    merchantId: ids.merchantA,
    branchId: ids.branchA,
    token,
  });
// The customer presses Redeem on a reward and the cashier scans the code it shows.
async function redeemCode(who: Customer, rewardId: string) {
  const token = await issue(who, { rewardId });
  assert.equal(token.statusCode, 200, token.body);
  const resolved = await resolve(token.json().token);
  assert.equal(resolved.statusCode, 200, resolved.body);
  return { token: token.json(), resolved: resolved.json() };
}
async function startAndConfirm(who: Customer, rewardId: string, context: string) {
  const started = await post(
    merchantUrl + '/rewards/' + rewardId + '/redemption-challenges',
    cashier,
    { branchId: ids.branchA, presentationContext: context },
  );
  assert.equal(started.statusCode, 200, started.body);
  const holder = (
    await app.inject({ url: '/api/v1/me/redemption-challenges', headers: who.headers })
  ).json();
  const mine = holder.challenges.find((x: { id: string }) => x.id === started.json().challengeId);
  assert.ok(mine, 'the holder sees the request to confirm');
  const confirmed = await post(
    '/api/v1/me/redemption-challenges/' + mine.id + '/decision',
    who.headers,
    { approve: true, code: mine.code },
  );
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  return started.json().challengeId as string;
}
const complete = (challengeId: string) =>
  post(merchantUrl + '/redemption-challenges/' + challengeId + '/complete', cashier, {});
const overview = async () =>
  (await app.inject({ url: merchantUrl + '/overview', headers: owner })).json().metrics;

for (const mode of ['auto', 'approval'] as const)
  test(
    mode + ' mode: full card, one redemption, next card, with pushes and carried stamps',
    async () => {
      await configure(mode === 'auto' ? automatic : approval);
      const who = await customer('Mona Ahmed');
      const before = await overview();
      for (let i = 0; i < 5; i++) await stamp(who, mode);
      // The card is full, shown full, and one reward is waiting.
      let c1 = await card(who);
      assert.deepEqual(
        [c1.balance, c1.display_balance, c1.pending_rewards, c1.cycle_number],
        [0, 5, 1, 1],
      );
      // Every approved receipt is a visit for the owner (038 left these out).
      if (mode === 'approval') assert.equal((await overview()).visits - before.visits, 5);
      const [reward] = (await me(who, '/rewards')).json().rewards;
      assert.equal(reward.status, 'available');
      // The branch is rung once: the card filled.
      let jobs = await rewardJobs(who);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]!.payload.kind, 'reward_earned');
      const earned = await deliver(jobs[0]!);
      assert.deepEqual(earned.outcome, { outcome: 'succeeded', error: null });
      assert.equal(earned.notices.length, 1);
      assert.equal(earned.notices[0].title, 'Card full · reward ready · Mona');
      assert.equal(earned.notices[0].url, '/cashier');
      // A stamp while the reward waits counts toward the next card; the full card stays full.
      await stamp(who, mode);
      c1 = await card(who);
      assert.deepEqual([c1.balance, c1.display_balance, c1.pending_rewards], [1, 5, 1]);
      // The Redeem code names the reward, lives three minutes, and the cashier lands on it.
      const { token, resolved } = await redeemCode(who, reward.id);
      const life = new Date(token.expiresAt).getTime() - Date.now();
      assert.ok(life > 150_000 && life <= 180_000, String(life));
      assert.equal(resolved.requestedRewardId, reward.id);
      assert.equal(resolved.membership.balance, 1);
      const challenge = await startAndConfirm(who, reward.id, resolved.presentationContext);
      // Two taps at once, each with its own key: exactly one hands the reward over.
      const [a, b] = await Promise.all([complete(challenge), complete(challenge)]);
      assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409], a.body + b.body);
      const done = (a.statusCode === 200 ? a : b).json(),
        refused = (a.statusCode === 200 ? b : a).json();
      assert.equal(refused.error.code, 'REWARD_ALREADY_USED');
      assert.equal(done.cycleNumber, 2);
      assert.equal(done.balanceAfter, 1);
      // A later retry, a new Redeem code and a fresh challenge from a new scan are all refused.
      assert.equal((await complete(challenge)).statusCode, 409);
      const code = await issue(who, { rewardId: reward.id });
      assert.equal(code.statusCode, 409, code.body);
      assert.equal(code.json().error.code, 'REWARD_UNAVAILABLE');
      const lookup = (await resolve((await issue(who, {})).json().token)).json();
      assert.equal(lookup.requestedRewardId, null);
      const second = await post(
        merchantUrl + '/rewards/' + reward.id + '/redemption-challenges',
        cashier,
        { branchId: ids.branchA, presentationContext: lookup.presentationContext },
      );
      assert.equal(second.statusCode, 409, second.body);
      assert.equal(second.json().error.code, 'REWARD_UNAVAILABLE');
      // Exactly one redemption, one ledger transaction, one event and one audit row.
      const facts = (
        await db.query(
          `SELECT (SELECT count(*)::int FROM reward_redemptions WHERE reward_id=$1) AS redemptions,
                  (SELECT count(*)::int FROM loyalty_transactions WHERE membership_id=$2 AND type='redeem') AS transactions,
                  (SELECT count(*)::int FROM audit_events WHERE action='reward.redeem' AND target_id=$1) AS audits,
                  (SELECT count(*)::int FROM reward_events WHERE reward_id=$1 AND event_type='redeemed') AS events`,
          [reward.id, who.membership],
        )
      ).rows[0];
      assert.deepEqual(facts, { redemptions: 1, transactions: 1, audits: 1, events: 1 });
      // The new card has started with the stamp that came in while the reward waited.
      let c2 = await card(who);
      assert.deepEqual(
        [c2.balance, c2.display_balance, c2.pending_rewards, c2.cycle_number],
        [1, 1, 0, 2],
      );
      assert.equal((await me(who, '/rewards')).json().rewards[0].status, 'redeemed');
      // The branch is rung once more: the reward was handed over.
      jobs = await rewardJobs(who);
      assert.deepEqual(
        jobs.map((j) => j.payload.kind),
        ['reward_earned', 'reward_redeemed'],
      );
      const redeemed = await deliver(jobs[1]!);
      assert.equal(redeemed.notices[0].title, 'Reward redeemed · Mona');
      assert.ok(redeemed.notices[0].body.endsWith('card 2 started'), redeemed.notices[0].body);
      // And the next stamp lands on card 2.
      await stamp(who, mode);
      c2 = await card(who);
      assert.deepEqual([c2.balance, c2.display_balance, c2.cycle_number], [2, 2, 2]);
    },
  );

test('a Redeem code is only issued for the holder’s own available reward', async () => {
  await configure(automatic);
  const who = await customer(),
    other = await customer();
  for (let i = 0; i < 5; i++) await stamp(who, 'auto');
  const [reward] = (await me(who, '/rewards')).json().rewards;
  const foreign = await issue(other, { rewardId: reward.id });
  assert.equal(foreign.statusCode, 404, foreign.body);
  const plain = await issue(who, {});
  const life = new Date(plain.json().expiresAt).getTime() - Date.now();
  assert.ok(life <= 90_000, 'a plain code keeps its 90 seconds');
});

test('a card stuck full without a reward is completed with no stamp lost, then redeems', async () => {
  await configure(automatic);
  const who = await customer('Stuck Card');
  // Seven stamps sitting on a 5-stamp card with no reward: what a stuck card looks like.
  const op = (
    await db.query(
      "INSERT INTO operations(actor_id,merchant_id,scope,idempotency_key,request_hash,status,committed_at) VALUES($1,$2,'test.stuck',$3,'x','committed',clock_timestamp()) RETURNING id",
      [who.userId, ids.merchantA, randomUUID()],
    )
  ).rows[0].id;
  const tx = randomUUID();
  await db.query(
    "INSERT INTO loyalty_transactions(id,public_reference,merchant_id,membership_id,program_version_id,branch_id,operation_id,type,quantity,source) VALUES($1,$2,$3,$4,$5,$6,$7,'award',7,'auto')",
    [tx, 'TX-STUCK-' + tx.slice(0, 8), ids.merchantA, who.membership, version, ids.branchA, op],
  );
  await db.query(
    "INSERT INTO ledger_entries(merchant_id,membership_id,transaction_id,program_version_id,type,amount) VALUES($1,$2,$3,$4,'earn',7)",
    [ids.merchantA, who.membership, tx, version],
  );
  await db.query('UPDATE loyalty_accounts SET balance=7 WHERE membership_id=$1', [who.membership]);
  assert.equal((await card(who)).pending_rewards, 0);
  assert.equal(Number((await db.query('SELECT repair_full_cards() AS n')).rows[0].n), 1);
  assert.equal(Number((await db.query('SELECT repair_full_cards() AS n')).rows[0].n), 0);
  const c = await card(who);
  assert.deepEqual([c.balance, c.display_balance, c.pending_rewards, c.cycle_number], [2, 5, 1, 1]);
  const ledger = (
    await db.query('SELECT sum(amount)::int AS s FROM ledger_entries WHERE membership_id=$1', [
      who.membership,
    ])
  ).rows[0].s;
  assert.equal(ledger, 2, 'the ledger and the balance agree');
  const audits = (
    await db.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action='reward.repair' AND target_id=$1",
      [who.membership],
    )
  ).rows[0].n;
  assert.equal(audits, 1);
  // A repair rings nobody: the card filled long ago.
  assert.equal((await rewardJobs(who)).length, 0);
  const [reward] = (await me(who, '/rewards')).json().rewards;
  const { resolved } = await redeemCode(who, reward.id);
  const done = await complete(await startAndConfirm(who, reward.id, resolved.presentationContext));
  assert.equal(done.statusCode, 200, done.body);
  const after = await card(who);
  assert.deepEqual(
    [after.balance, after.display_balance, after.pending_rewards, after.cycle_number],
    [2, 2, 0, 2],
  );
});

test('a reward whose branches have all closed is redeemed at another open branch', async () => {
  await configure(automatic);
  const who = await customer();
  for (let i = 0; i < 5; i++) await stamp(who, 'auto');
  const closed = (
    await db.query(
      "INSERT INTO branches(merchant_id,name) VALUES($1,'Closed corner') RETURNING id",
      [ids.merchantA],
    )
  ).rows[0].id;
  // Earned for a branch that has since closed.
  const grant = (
    await db.query(
      `INSERT INTO reward_grants(merchant_id,membership_id,program_version_id,earned_transaction_id,ordinal,threshold,title,terms,branch_ids,expires_at)
       SELECT merchant_id,membership_id,program_version_id,earned_transaction_id,ordinal+1,threshold,title,terms,ARRAY[$2::uuid],expires_at
       FROM reward_grants WHERE membership_id=$1 RETURNING id`,
      [who.membership, closed],
    )
  ).rows[0].id;
  await db.query("UPDATE branches SET status='disabled' WHERE id=$1", [closed]);
  const { resolved } = await redeemCode(who, grant);
  assert.equal(resolved.requestedRewardId, grant);
  const done = await complete(await startAndConfirm(who, grant, resolved.presentationContext));
  assert.equal(done.statusCode, 200, done.body);
});
