import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed } from '../../db/seed.js';
import { login, adminLogin, key } from '../helpers.js';
import { deliverWalletMessage } from '../../apps/worker/src/wallet-messages.js';
import type { GoogleWallet } from '../../apps/api/src/wallet/google-wallet.js';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL, max: 2 });
// Google Wallet on, as in production; nothing is really sent (transports are injected).
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 }),
  pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  accountFile = join(mkdtempSync(join(tmpdir(), 'perks-wm-')), 'account.json');
writeFileSync(
  accountFile,
  JSON.stringify({ client_email: 'messages@example.test', private_key: pem }),
  { mode: 0o600 },
);
const { app } = await buildApp({
  APP_ENV: 'test',
  LOG_LEVEL: 'silent',
  APPLE_WALLET_ENABLED: 'false',
  GOOGLE_WALLET_ENABLED: 'true',
  GOOGLE_WALLET_ISSUER_ID: '3388000000012345',
  GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: accountFile,
});
type Headers = Awaited<ReturnType<typeof login>>;
let admin: Headers;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  admin = await adminLogin(app, db);
});
const touched: string[] = [];
after(async () => {
  // Fixture balances were set without ledger rows; zero them so platform balance checks stay exact.
  if (touched.length)
    await db.query('UPDATE loyalty_accounts SET balance=0 WHERE merchant_id=ANY($1)', [touched]);
  await app.close();
  await worker.end();
  await db.end();
});

// Login is rate limited per address: only the owners and one manager sign in.
async function shop(plan: string, branchCount = 1) {
  const email = 'owner-plan-' + randomUUID() + '@nuqta.test',
    owner = await login(app, email);
  const uid = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  const mid = (
    await db.query("INSERT INTO merchants(slug,name) VALUES($1,'مقهى الركن') RETURNING id", [
      'op-' + randomUUID().slice(0, 24),
    ])
  ).rows[0].id as string;
  await db.query(
    "INSERT INTO feature_entitlements(merchant_id,plan,max_branches,max_staff,max_programs,max_customers) VALUES($1,'growth',10,40,10,3000)",
    [mid],
  );
  const sid = (
    await db.query(
      "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,'Owner','owner') RETURNING id",
      [mid, uid, email],
    )
  ).rows[0].id;
  const branches: string[] = [];
  for (let i = 0; i < branchCount; i++) {
    const b = (
      await db.query(
        'INSERT INTO branches(merchant_id,name,created_at) VALUES($1,$2,clock_timestamp()+make_interval(secs=>$3)) RETURNING id',
        [mid, 'فرع ' + (i + 1), i],
      )
    ).rows[0].id as string;
    branches.push(b);
    await db.query(
      'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
      [mid, sid, b],
    );
  }
  await db.query(
    'UPDATE entitlement_overrides SET revoked_at=clock_timestamp() WHERE merchant_id=$1 AND revoked_at IS NULL',
    [mid],
  );
  await db.query(
    `UPDATE merchant_subscriptions SET plan_id=(SELECT id FROM plans WHERE key=$2),status='active',trial_ends_at=NULL,
      price_minor=(SELECT amount_minor FROM plan_prices x JOIN plans p ON p.id=x.plan_id WHERE p.key=$2 AND x.billing_period='monthly' AND x.is_active),
      current_period_start=clock_timestamp()-interval '20 days',current_period_end=clock_timestamp()+interval '10 days' WHERE merchant_id=$1`,
    [mid, plan],
  );
  return { mid, owner, branches, uid };
}
const plan = async (s: { mid: string; owner: Headers }) =>
  app.inject({ url: '/api/v1/merchants/' + s.mid + '/plan', headers: s.owner });
const post = (h: Headers, url: string, payload: Record<string, unknown> = {}, method = 'POST') =>
  app.inject({
    method: method as 'POST',
    url,
    headers: { ...h, ...key() },
    payload,
  });
async function adminWrite(mid: string, path: string, payload: Record<string, unknown>) {
  const rev = (
    await app.inject({ url: '/api/v1/platform/merchants/' + mid + '/billing', headers: admin })
  ).json().subscription.revision;
  return app.inject({
    method: 'POST',
    url: '/api/v1/platform/merchants/' + mid + '/billing' + path,
    headers: { ...admin, ...key(), 'if-match': String(rev) },
    payload,
  });
}

test('the owner sees their plan, usage and prices; a manager never sees plans or prices', async () => {
  const s = await shop('growth', 2);
  const r = await plan(s);
  assert.equal(r.statusCode, 200, r.body);
  const p = r.json();
  assert.equal(p.entitlements.plan.key, 'growth');
  assert.equal(p.entitlements.usage.max_branches, 2);
  assert.equal(p.subscription.priceMinor, 90000);
  const pro = p.catalog.find((x: { key: string }) => x.key === 'pro');
  assert.equal(
    pro.prices.find((x: { billingPeriod: string }) => x.billingPeriod === 'monthly').amountMinor,
    150000,
  );
  assert.equal(pro.entitlements.max_branches, 4);
  assert.ok(
    !p.catalog.some((x: { key: string }) => x.key === 'legacy'),
    'hidden plans stay hidden',
  );
  const email = 'manager-' + randomUUID() + '@nuqta.test',
    manager = await login(app, email);
  const uid = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  await db.query(
    "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,'Manager','manager')",
    [s.mid, uid, email],
  );
  for (const url of ['/plan', '/wallet-messages', '/wallet-messages/preview?audience=all']) {
    const asManager = await app.inject({
      url: '/api/v1/merchants/' + s.mid + url,
      headers: manager,
    });
    assert.equal(asManager.statusCode, 403, url);
  }
  // Direct reads are closed by RLS too.
  const leaked = await post(manager, '/api/v1/merchants/' + s.mid + '/plan/requests', {
    kind: 'change_plan',
    plan: 'pro',
    billingPeriod: 'monthly',
  });
  assert.equal(leaked.statusCode, 403);
});

test('upgrade and add-on requests go to the Perks team and apply when approved', async () => {
  const s = await shop('growth');
  const base = '/api/v1/merchants/' + s.mid + '/plan/requests';
  const hidden = await post(s.owner, base, {
    kind: 'change_plan',
    plan: 'legacy',
    billingPeriod: 'monthly',
  });
  assert.equal(hidden.statusCode, 404, hidden.body);
  const up = await post(s.owner, base, {
    kind: 'change_plan',
    plan: 'pro',
    billingPeriod: 'monthly',
    note: 'فتحنا فرع جديد',
  });
  assert.equal(up.statusCode, 200, up.body);
  assert.equal(up.json().plan.request.status, 'open');
  const again = await post(s.owner, base, { kind: 'addon', addonKey: 'extra_staff', quantity: 1 });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'PLAN_REQUEST_OPEN');
  const approved = await adminWrite(s.mid, '/requests/' + up.json().id + '/approve', {
    reason: 'Paid by InstaPay',
  });
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().billing.subscription.plan, 'pro');
  assert.equal(approved.json().billing.requests[0].status, 'approved');
  const addon = await post(s.owner, base, { kind: 'addon', addonKey: 'extra_branch', quantity: 2 });
  assert.equal(addon.statusCode, 200, addon.body);
  const ok = await adminWrite(s.mid, '/requests/' + addon.json().id + '/approve', {
    reason: 'Two more branches',
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal((await plan(s)).json().entitlements.limits.max_branches, 6);
  const third = await post(s.owner, base, { kind: 'addon', addonKey: 'extra_staff', quantity: 1 });
  const declined = await adminWrite(s.mid, '/requests/' + third.json().id + '/decline', {
    reason: 'Talked on the phone, not needed',
  });
  assert.equal(declined.statusCode, 200, declined.body);
  const after = (await plan(s)).json();
  assert.equal(after.request.status, 'declined');
  assert.equal(after.request.close_reason, 'Talked on the phone, not needed');
});

test('a downgrade lands on the billing date and keeps exactly the branches the owner picked', async () => {
  const s = await shop('pro', 4);
  const req = await post(s.owner, '/api/v1/merchants/' + s.mid + '/plan/requests', {
    kind: 'change_plan',
    plan: 'growth',
    billingPeriod: 'monthly',
  });
  assert.equal(req.statusCode, 200, req.body);
  const approved = await adminWrite(s.mid, '/requests/' + req.json().id + '/approve', {
    reason: 'Owner asked to move down',
  });
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().billing.subscription.pendingPlan, 'growth', 'waits for the date');
  const p = (await plan(s)).json();
  assert.equal(p.keepLimits.branch, 2);
  const keep = (ids: string[]) =>
    post(s.owner, '/api/v1/merchants/' + s.mid + '/plan/keep', { kind: 'branch', ids }, 'PUT');
  const tooMany = await keep(s.branches.slice(0, 3));
  assert.equal(tooMany.statusCode, 409);
  assert.equal(tooMany.json().error.code, 'PLAN_LIMIT_REACHED');
  const picked = await keep([s.branches[1]!, s.branches[3]!]);
  assert.equal(picked.statusCode, 200, picked.body);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM branches WHERE merchant_id=$1 AND status='active'",
        [s.mid],
      )
    ).rows[0].n,
    4,
    'nothing changes before the date',
  );
  await db.query(
    "UPDATE merchant_subscriptions SET pending_effective_at=clock_timestamp()-interval '1 second' WHERE merchant_id=$1",
    [s.mid],
  );
  await worker.query('SELECT advance_subscription_states()');
  const rows = (
    await db.query('SELECT id,status,locked_at FROM branches WHERE merchant_id=$1', [s.mid])
  ).rows;
  const active = rows.filter((r) => r.status === 'active').map((r) => r.id);
  assert.deepEqual(active.sort(), [s.branches[1], s.branches[3]].sort());
  assert.equal(rows.length, 4, 'no branch was deleted');
});

test('with locked branches the owner can swap which ones work, but never revive one they closed', async () => {
  const s = await shop('growth', 4);
  // The owner closed branch 4 themselves; growth allows 2, so the plan locks branch 3.
  await db.query("UPDATE branches SET status='disabled' WHERE id=$1", [s.branches[3]]);
  await adminWrite(s.mid, '/plan', {
    plan: 'growth',
    billingPeriod: 'monthly',
    effective: 'now',
    reason: 'Rebalance',
  });
  const status = async () =>
    Object.fromEntries(
      (
        await db.query(
          'SELECT id,status,locked_at IS NOT NULL AS locked FROM branches WHERE merchant_id=$1',
          [s.mid],
        )
      ).rows.map((r) => [r.id, r.status + (r.locked ? '+locked' : '')]),
    );
  assert.equal((await status())[s.branches[2]!], 'disabled+locked');
  const swap = await post(
    s.owner,
    '/api/v1/merchants/' + s.mid + '/plan/keep',
    { kind: 'branch', ids: [s.branches[0], s.branches[2]] },
    'PUT',
  );
  assert.equal(swap.statusCode, 200, swap.body);
  const after = await status();
  assert.equal(after[s.branches[0]!], 'active');
  assert.equal(after[s.branches[1]!], 'disabled+locked');
  assert.equal(after[s.branches[2]!], 'active');
  assert.equal(after[s.branches[3]!], 'disabled', 'the owner’s own choice is untouched');
  const revive = await post(
    s.owner,
    '/api/v1/merchants/' + s.mid + '/plan/keep',
    { kind: 'branch', ids: [s.branches[0], s.branches[3]] },
    'PUT',
  );
  assert.equal(revive.statusCode, 404);
});

/* ------------------------------------------------------------------ Wallet messages */

async function customers(mid: string, n: number) {
  touched.push(mid);
  const pid = (
    await db.query("INSERT INTO programs(merchant_id,name) VALUES($1,'زيارات') RETURNING id", [mid])
  ).rows[0].id;
  const vid = (
    await db.query(
      "INSERT INTO program_versions(merchant_id,program_id,version,threshold,max_per_tx,reward_title,reward_terms,validity_days) VALUES($1,$2,1,5,3,'قهوة مجانية','شروط',30) RETURNING id",
      [mid, pid],
    )
  ).rows[0].id;
  await db.query('UPDATE programs SET current_version_id=$1 WHERE id=$2', [vid, pid]);
  const out: { membership: string; user: string }[] = [];
  for (let i = 0; i < n; i++) {
    const user = (
      await db.query("INSERT INTO users(email,display_name) VALUES($1,'Customer') RETURNING id", [
        'wm-' + randomUUID() + '@example.test',
      ])
    ).rows[0].id;
    const profile = (
      await db.query(
        "INSERT INTO tenant_customer_profiles(merchant_id,user_id,alias,contact_email,created_at) VALUES($1,$2,$3,'c@example.test',clock_timestamp()-interval '60 days') RETURNING id",
        [mid, user, 'عميل ' + (i + 1)],
      )
    ).rows[0].id;
    const membership = (
      await db.query(
        'INSERT INTO memberships(merchant_id,profile_id,user_id,program_id,program_version_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [mid, profile, user, pid, vid],
      )
    ).rows[0].id;
    await db.query(
      'INSERT INTO loyalty_accounts(membership_id,merchant_id,program_version_id,balance) VALUES($1,$2,$3,$4)',
      [membership, mid, vid, i === 0 ? 4 : 0],
    );
    // The last customer said no to notifications: they never get a message.
    await db.query(
      "INSERT INTO consent_current(merchant_id,user_id,channel,granted) VALUES($1,$2,'push',$3)",
      [mid, user, i < n - 1],
    );
    await db.query(
      "INSERT INTO google_wallet_objects(membership_id,merchant_id,fingerprint) VALUES($1,$2,'')",
      [membership, mid],
    );
    out.push({ membership, user });
  }
  return out;
}
// Shop time at noon, whatever time the test runs.
async function noon(mid: string, hour = 12) {
  const offset = new Date().getUTCHours() - hour;
  await db.query('UPDATE merchants SET timezone=$1 WHERE id=$2', [
    'Etc/GMT' + (offset >= 0 ? '+' : '') + offset,
    mid,
  ]);
}

test('manual Wallet messages: preview, consent, the monthly allowance and one message a day', async () => {
  const s = await shop('starter');
  await noon(s.mid);
  const list = await customers(s.mid, 4);
  const base = '/api/v1/merchants/' + s.mid + '/wallet-messages';
  const preview = await app.inject({ url: base + '/preview?audience=all', headers: s.owner });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.deepEqual(preview.json(), {
    groupSize: 4,
    customers: 3,
    apple: 0,
    google: 3,
    notLinked: 0,
    notificationsOff: 1,
    recentlyContacted: 0,
  });
  const near = await app.inject({ url: base + '/preview?audience=near_reward', headers: s.owner });
  assert.equal(near.json().customers, 1);
  const bad = await post(s.owner, base, { audience: 'all', bodyAr: 'أهلًا {phone}' });
  assert.equal(bad.statusCode, 422);
  const sent = await post(s.owner, base, {
    audience: 'all',
    bodyAr: 'يا {name}، عندنا كرواسون جديد في {business} ☕',
  });
  assert.equal(sent.statusCode, 200, sent.body);
  assert.equal(sent.json().recipients, 3);
  let state = (await app.inject({ url: base, headers: s.owner })).json();
  assert.equal(state.used, 1);
  assert.equal(state.limit, 2);
  assert.equal(state.history[0].waiting, 3);
  const waiting = await app.inject({ url: base + '/preview?audience=all', headers: s.owner });
  assert.deepEqual(waiting.json(), {
    groupSize: 4,
    customers: 0,
    apple: 0,
    google: 0,
    notLinked: 0,
    notificationsOff: 1,
    recentlyContacted: 3,
  });
  // Same customers, same day: nobody to send to, and the allowance is not used.
  const twice = await post(s.owner, base, { audience: 'all', bodyAr: 'تاني' });
  assert.equal(twice.statusCode, 409);
  assert.equal(twice.json().error.code, 'NO_RECIPIENTS');
  state = (await app.inject({ url: base, headers: s.owner })).json();
  assert.equal(state.used, 1);
  await db.query(
    "UPDATE wallet_message_deliveries SET created_at=created_at-interval '2 days' WHERE merchant_id=$1",
    [s.mid],
  );
  assert.equal((await post(s.owner, base, { audience: 'all', bodyAr: 'تاني' })).statusCode, 200);
  await db.query(
    "UPDATE wallet_message_deliveries SET created_at=created_at-interval '2 days' WHERE merchant_id=$1",
    [s.mid],
  );
  const third = await post(s.owner, base, { audience: 'all', bodyAr: 'تالت' });
  assert.equal(third.statusCode, 409);
  assert.equal(third.json().error.code, 'PLAN_LIMIT_REACHED');
  assert.equal(third.json().error.limit, 2);
  // A preference change can make the saved card reachable without re-adding it to Wallet.
  await db.query(
    "UPDATE consent_current SET granted=true WHERE merchant_id=$1 AND user_id=$2 AND channel='push'",
    [s.mid, list[3]!.user],
  );
  await db.query('DELETE FROM google_wallet_objects WHERE membership_id=$1', [list[1]!.membership]);
  const changed = await app.inject({ url: base + '/preview?audience=all', headers: s.owner });
  assert.deepEqual(changed.json(), {
    groupSize: 4,
    customers: 3,
    apple: 0,
    google: 3,
    notLinked: 1,
    notificationsOff: 0,
    recentlyContacted: 0,
  });
});

test('a queued message waits for shop hours, then reaches the Google card once', async () => {
  const s = await shop('growth');
  await noon(s.mid, 3);
  await customers(s.mid, 3);
  const sent = await post(s.owner, '/api/v1/merchants/' + s.mid + '/wallet-messages', {
    audience: 'all',
    bodyAr: 'يا {name}، مستنيينك في {business}',
    bodyEn: 'Hi {name}, see you at {business}',
  });
  assert.equal(sent.statusCode, 200, sent.body);
  assert.ok(Date.parse(sent.json().sendAfter) > Date.now(), '3 AM shop time: waits until 10');
  const claim = async () =>
    (await worker.query('SELECT claim_wallet_message(false,true) AS job')).rows[0].job;
  const mine = async () =>
    (
      await db.query('SELECT status,next_at FROM wallet_message_deliveries WHERE merchant_id=$1', [
        s.mid,
      ])
    ).rows;
  // Not due yet: other shops' jobs may be claimed, never this one.
  await claim();
  assert.ok((await mine()).every((r) => r.status === 'queued'));
  await noon(s.mid);
  await db.query('UPDATE wallet_message_deliveries SET next_at=now() WHERE merchant_id=$1', [
    s.mid,
  ]);
  const posted: { body: string }[] = [];
  const google: GoogleWallet = {
    issuerId: '3388000000012345',
    clientEmail: 'messages@example.test',
    privateKey: pem,
    fetch: async (url, init) => {
      if (String(url).includes('oauth2'))
        return Response.json({ access_token: 't', expires_in: 3600 });
      if (init?.method === 'POST') {
        posted.push({ body: String(init.body) });
        return Response.json({});
      }
      return Response.json({ messages: [] });
    },
  };
  let delivered = 0;
  for (let i = 0; i < 20 && delivered < 2; i++) {
    const job = await claim();
    if (!job) break;
    const result = await deliverWalletMessage(job, worker, { google });
    await worker.query('SELECT finish_wallet_message($1,$2,$3,$4)', [
      job.id,
      job.lease,
      result.outcome,
      result.error,
    ]);
    if (job.card.merchant_id === s.mid) {
      assert.equal(result.outcome, 'accepted', JSON.stringify(result));
      delivered++;
    }
  }
  assert.equal(delivered, 2);
  const mineSent = posted.filter((p) => p.body.includes('مستنيينك'));
  assert.equal(mineSent.length, 2);
  assert.ok(mineSent[0]!.body.includes('مقهى الركن'), 'the shop name is filled in');
  assert.ok(!mineSent[0]!.body.includes('{name}'));
  assert.ok((await mine()).every((r) => r.status === 'accepted'));
});

test('the Apple card carries the newest manual message; customers never see plan details', async () => {
  const s = await shop('growth');
  await noon(s.mid);
  const [first] = await customers(s.mid, 2);
  const serial = (
    await db.query(
      "INSERT INTO wallet_passes(membership_id,merchant_id,auth_token_hash,fingerprint) VALUES($1,$2,$3,'') RETURNING serial",
      [first!.membership, s.mid, 'c'.repeat(64)],
    )
  ).rows[0].serial;
  await db.query(
    'INSERT INTO wallet_registrations(device_library_id,serial,push_token) VALUES($1,$2,$3)',
    ['wm-' + randomUUID(), serial, 'd'.repeat(64)],
  );
  const msg = (
    await db.query(
      `INSERT INTO wallet_messages(merchant_id,audience,body_ar,recipients,send_after,created_by)
       VALUES($1,'all','عرض النهارده',1,now(),$2) RETURNING id`,
      [s.mid, s.uid],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO wallet_message_deliveries(message_id,merchant_id,profile_id,membership_id,channel,next_at,status)
     SELECT $1,merchant_id,profile_id,id,'apple',now(),'accepted' FROM memberships WHERE id=$2`,
    [msg, first!.membership],
  );
  const card = (await db.query('SELECT wallet_card_json($1) AS c', [first!.membership])).rows[0].c;
  assert.equal(card.manual_message.ar, 'عرض النهارده');
  assert.equal(card.manual_message.en, 'عرض النهارده', 'Arabic is used when there is no English');
  assert.equal(card.reminder_templates, null);
  // The Google fingerprint ignores it: no needless resend of the Google card.
  const g = (
    await db.query("SELECT wallet_card_json($1)-'reminder_templates'-'manual_message' AS c", [
      first!.membership,
    ])
  ).rows[0].c;
  assert.equal(g.manual_message, undefined);
  for (const field of ['plan', 'limits', 'price_minor', 'subscription'])
    assert.equal(card[field], undefined, field);
  assert.equal(card.manual_message.repeat, undefined, 'first-time words carry no marker');
  // The same words again are marked, so the pass value changes and Wallet announces them.
  const again = (
    await db.query(
      `INSERT INTO wallet_messages(merchant_id,audience,body_ar,recipients,send_after,created_by)
       VALUES($1,'all','عرض النهارده',1,now(),$2) RETURNING id`,
      [s.mid, s.uid],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO wallet_message_deliveries(message_id,merchant_id,profile_id,membership_id,channel,next_at,status,created_at)
     SELECT $1,merchant_id,profile_id,id,'apple',now(),'processing',clock_timestamp()+interval '1 second' FROM memberships WHERE id=$2`,
    [again, first!.membership],
  );
  const repeated = (await db.query('SELECT wallet_card_json($1) AS c', [first!.membership])).rows[0]
    .c;
  assert.equal(repeated.manual_message.repeat, true);
});
