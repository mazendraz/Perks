import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed } from '../../db/seed.js';
import { login, adminLogin, key, enrollmentTerms } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  runtime = new pg.Client({ connectionString: c.DATABASE_URL });
const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let admin: Awaited<ReturnType<typeof login>>;
before(async () => {
  await db.connect();
  await runtime.connect();
  await seed(db);
  await app.ready();
  admin = await adminLogin(app, db);
});
after(async () => {
  await app.close();
  await runtime.end();
  await db.end();
});
const date = (days = 0) => businessDate('Africa/Cairo', new Date(Date.now() + days * 86400000));
async function tenant(required = true) {
  const email = 'billing-owner-' + randomUUID() + '@nuqta.test',
    owner = await login(app, email);
  const uid = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  const mid = (
    await db.query("INSERT INTO merchants(slug,name) VALUES($1,'Synthetic billing') RETURNING id", [
      'billing-' + randomUUID(),
    ])
  ).rows[0].id;
  const bid = (
    await db.query(
      "INSERT INTO branches(merchant_id,name) VALUES($1,'Billing branch') RETURNING id",
      [mid],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO feature_entitlements(merchant_id,plan,max_branches,max_staff,max_programs,max_customers,billing_required) VALUES($1,'growth',3,10,3,3000,$2)",
    [mid, required],
  );
  const sid = (
    await db.query(
      "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role,max_qty) VALUES($1,$2,$3,'Billing owner','owner',3) RETURNING id",
      [mid, uid, email],
    )
  ).rows[0].id;
  await db.query(
    'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
    [mid, sid, bid],
  );
  const pid = (
    await db.query(
      "INSERT INTO programs(merchant_id,name) VALUES($1,'Synthetic visits') RETURNING id",
      [mid],
    )
  ).rows[0].id;
  const vid = (
    await db.query(
      "INSERT INTO program_versions(merchant_id,program_id,version,threshold,max_per_tx,reward_title,reward_terms,validity_days) VALUES($1,$2,1,2,3,'Synthetic reward','Synthetic reward terms',30) RETURNING id",
      [mid, pid],
    )
  ).rows[0].id;
  await db.query(
    'INSERT INTO program_branches(merchant_id,program_version_id,branch_id) VALUES($1,$2,$3)',
    [mid, vid, bid],
  );
  await db.query('UPDATE programs SET current_version_id=$1 WHERE id=$2', [vid, pid]);
  return { mid, bid, pid, vid, owner };
}
type Tenant = Awaited<ReturnType<typeof tenant>>;
const base = (t: Tenant) => '/api/v1/platform/merchants/' + t.mid + '/subscription';
async function state(t: Tenant) {
  const r = await app.inject({ url: base(t), headers: admin });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
const paymentBody = (extra: Record<string, unknown> = {}) => ({
  amountMinor: 95050,
  method: 'instapay',
  periodStart: date(),
  periodEnd: date(30),
  reference: 'BANK-' + randomUUID(),
  reason: 'Synthetic manual payment',
  ...extra,
});
async function payment(
  t: Tenant,
  body = paymentBody(),
  revision?: number,
  k = key(),
  headers = admin,
) {
  revision ??= (await state(t)).revision;
  return app.inject({
    method: 'POST',
    url: base(t) + '/payments',
    headers: { ...headers, ...k, 'if-match': String(revision) },
    payload: body,
  });
}
async function member(t: Tenant) {
  const boot = await app.inject('/api/v1/customer/bootstrap'),
    notice = (await app.inject('/api/v1/public/legal?lang=en')).json();
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/customer/register',
    remoteAddress: '2001:db8:' + randomBytes(12).toString('hex').match(/.{4}/g)!.join(':'),
    headers: {
      origin: c.PUBLIC_APP_ORIGIN,
      cookie: boot.cookies.map((v) => v.name + '=' + v.value).join('; '),
      'x-csrf-token': boot.json().csrfToken,
      'x-nuqta-workspace': 'customer',
    },
    payload: {
      displayName: 'Synthetic billing customer',
      phone: '+2015' + String(randomBytes(4).readUInt32BE()).padStart(10, '0').slice(-8),
      merchantId: t.mid,
      programId: t.pid,
      programVersionId: t.vid,
      branchId: t.bid,
      acceptedTerms: true,
      acceptedTermsHash: await enrollmentTerms(app, t.pid),
      acceptedPrivacyVersion: notice.acceptance.version,
      acceptedPrivacyHash: notice.acceptance.hash,
      acceptedPrivacyLocale: 'en',
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  const id = r.json().membershipId as string,
    headers = {
      origin: c.PUBLIC_APP_ORIGIN,
      cookie: r.cookies.map((v) => v.name + '=' + v.value).join('; '),
      'x-csrf-token': r.json().csrfToken,
      'x-nuqta-workspace': 'customer',
    };
  const qr = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships/' + id + '/presentation-tokens',
    headers: { ...headers, ...key() },
    payload: {},
  });
  assert.equal(qr.statusCode, 200, qr.body);
  return { id, headers, token: qr.json().token as string };
}
const award = (t: Tenant, m: Awaited<ReturnType<typeof member>>, quantity = 1) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + t.mid + '/stamp-awards',
    headers: { ...t.owner, ...key() },
    payload: {
      branchId: t.bid,
      membershipId: m.id,
      quantity,
      purchaseReference: { reference: randomUUID(), businessDate: date() },
      presentationContext: m.token,
    },
  });

test('only authorized admins with MFA/CSRF can record immutable idempotent payments; owners read only their own history, and voiding permits an audited correction', async () => {
  const t = await tenant(),
    foreign = await tenant(),
    initial = await state(t),
    body = paymentBody(),
    k = key();
  assert.equal(initial.billingRequired, true);
  assert.equal(initial.earningAllowed, false);
  assert.equal((await payment(t, body, initial.revision, key(), t.owner)).statusCode, 403);
  const unverifiedEmail = 'billing-unverified-' + randomUUID() + '@nuqta.test';
  await db.query(
    "INSERT INTO users(email,display_name,global_role,totp_secret) VALUES($1,'Synthetic unverified admin','platform_admin',$2)",
    [unverifiedEmail, randomBytes(20).toString('hex')],
  );
  const unverified = await login(app, unverifiedEmail);
  const noMfa = await payment(t, body, initial.revision, key(), unverified);
  assert.equal(noMfa.statusCode, 403);
  assert.equal(noMfa.json().error.code, 'MFA_REQUIRED');
  assert.equal(
    (await payment(t, body, initial.revision, key(), { ...admin, 'x-csrf-token': '' })).statusCode,
    403,
  );
  const replies = await Promise.all([
    payment(t, body, initial.revision, k),
    payment(t, body, initial.revision, k),
  ]);
  assert.ok(
    replies.every((r) => r.statusCode === 200),
    replies.map((r) => r.body).join('\n'),
  );
  const id = replies[0]!.json().paymentId;
  assert.equal(replies[1]!.json().paymentId, id);
  let current = await state(t);
  assert.equal(current.payments.length, 1);
  assert.equal(current.earningAllowed, true);
  assert.equal(current.payments[0].amount_minor, 95050);
  assert.equal(
    (await payment(t, body, current.revision)).json().error.code,
    'PAYMENT_REFERENCE_USED',
  );
  assert.equal(
    (await payment(t, paymentBody(), initial.revision)).json().error.code,
    'REVISION_CONFLICT',
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/merchants/' + t.mid + '/subscription', headers: t.owner }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        url: '/api/v1/merchants/' + t.mid + '/subscription',
        headers: foreign.owner,
      })
    ).statusCode,
    404,
  );
  const fuid = (
    await db.query('SELECT user_id FROM staff_memberships WHERE merchant_id=$1', [foreign.mid])
  ).rows[0].user_id;
  await runtime.query('BEGIN');
  try {
    await runtime.query("SELECT set_config('app.user_id',$1,true)", [fuid]);
    assert.equal(
      (await runtime.query('SELECT id FROM subscription_payments WHERE merchant_id=$1', [t.mid]))
        .rowCount,
      0,
    );
  } finally {
    await runtime.query('ROLLBACK');
  }
  await assert.rejects(() =>
    db.query('UPDATE subscription_payments SET amount_minor=1 WHERE id=$1', [id]),
  );
  const wrong = await app.inject({
    method: 'POST',
    url: base(foreign) + '/payments/' + id + '/void',
    headers: { ...admin, ...key(), 'if-match': String((await state(foreign)).revision) },
    payload: { reason: 'Synthetic wrong tenant' },
  });
  assert.equal(wrong.statusCode, 404);
  const voided = await app.inject({
    method: 'POST',
    url: base(t) + '/payments/' + id + '/void',
    headers: { ...admin, ...key(), 'if-match': String(current.revision) },
    payload: { reason: 'Correcting a synthetic entry' },
  });
  assert.equal(voided.statusCode, 200, voided.body);
  current = await state(t);
  assert.equal(current.earningAllowed, false);
  assert.ok(current.payments[0].voided_at);
  const corrected = await payment(t, { ...body, amountMinor: 100000 }, current.revision);
  assert.equal(corrected.statusCode, 200, corrected.body);
  current = await state(t);
  assert.equal(current.payments.length, 2);
  assert.equal(current.earningAllowed, true);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE merchant_id=$1 AND action LIKE 'subscription.%'",
        [t.mid],
      )
    ).rows[0].n,
    3,
  );
});

test('an expired manual subscription blocks new awards/requests but preserves viewing and holder-confirmed redemption of an earned reward', async () => {
  const t = await tenant(false),
    m = await member(t),
    earned = await award(t, m, 2);
  assert.equal(earned.statusCode, 200, earned.body);
  const reward = earned.json().rewardGrants[0].id;
  const expired = await payment(t, paymentBody({ periodStart: date(-30), periodEnd: date(-1) }));
  assert.equal(expired.statusCode, 200, expired.body);
  assert.equal((await state(t)).earningAllowed, false);
  const blocked = await award(t, m);
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error.code, 'SUBSCRIPTION_INACTIVE');
  const cards = await app.inject({ url: '/api/v1/me/memberships', headers: m.headers });
  assert.equal(cards.statusCode, 200);
  assert.equal(cards.json().cards[0].earning_active, false);
  const request = await app.inject({
    method: 'POST',
    url: '/api/v1/me/stamp-requests',
    headers: { ...m.headers, ...key() },
    payload: { membershipId: m.id, branchId: t.bid },
  });
  assert.equal(request.statusCode, 409, request.body);
  assert.equal(request.json().error.code, 'SUBSCRIPTION_INACTIVE');
  const started = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + t.mid + '/rewards/' + reward + '/redemption-challenges',
    headers: { ...t.owner, ...key() },
    payload: { branchId: t.bid, presentationContext: m.token },
  });
  assert.equal(started.statusCode, 200, started.body);
  const challenge = started.json();
  const confirmed = await app.inject({
    method: 'POST',
    url: '/api/v1/me/redemption-challenges/' + challenge.challengeId + '/decision',
    headers: { ...m.headers, ...key() },
    payload: { approve: true, code: challenge.code },
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  const complete = await app.inject({
    method: 'POST',
    url:
      '/api/v1/merchants/' +
      t.mid +
      '/redemption-challenges/' +
      challenge.challengeId +
      '/complete',
    headers: { ...t.owner, ...key() },
    payload: {},
  });
  assert.equal(complete.statusCode, 200, complete.body);
  assert.equal(
    (await db.query('SELECT status FROM merchants WHERE id=$1', [t.mid])).rows[0].status,
    'active',
  );
  assert.equal(
    (await db.query('SELECT cycle_number FROM loyalty_accounts WHERE membership_id=$1', [m.id]))
      .rows[0].cycle_number,
    2,
  );
});

test('future coverage never fills an unpaid gap, and manual pause/re-enable remains revision-fenced without suspending the shop', async () => {
  const t = await tenant(),
    future = await payment(t, paymentBody({ periodStart: date(10), periodEnd: date(40) }));
  assert.equal(future.statusCode, 200, future.body);
  assert.equal((await state(t)).earningAllowed, false);
  const current = await payment(t, paymentBody({ periodEnd: date() }));
  assert.equal(current.statusCode, 200, current.body);
  assert.equal((await state(t)).earningAllowed, true);
  let s = await state(t);
  const pause = (earningPaused: boolean) =>
    app.inject({
      method: 'PATCH',
      url: base(t),
      headers: { ...admin, ...key(), 'if-match': String(s.revision) },
      payload: { earningPaused, reason: 'Synthetic concurrent change' },
    });
  const results = await Promise.all([pause(true), pause(false)]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  s = await state(t);
  const resume = await app.inject({
    method: 'PATCH',
    url: base(t),
    headers: { ...admin, ...key(), 'if-match': String(s.revision) },
    payload: { earningPaused: false, reason: 'Synthetic explicit resume' },
  });
  assert.equal(resume.statusCode, 200);
  s = await state(t);
  const voided = await app.inject({
    method: 'POST',
    url: base(t) + '/payments/' + current.json().paymentId + '/void',
    headers: { ...admin, ...key(), 'if-match': String(s.revision) },
    payload: { reason: 'Synthetic removal of present coverage' },
  });
  assert.equal(voided.statusCode, 200, voided.body);
  assert.equal((await state(t)).earningAllowed, false);
  assert.equal(
    (await db.query('SELECT status FROM merchants WHERE id=$1', [t.mid])).rows[0].status,
    'active',
  );
});

test('award rechecks the database clock after waiting for the account lock and cannot cross subscription expiry', async () => {
  const t = await tenant(false),
    m = await member(t),
    lock = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
  await lock.connect();
  let pending: ReturnType<typeof award> | undefined;
  try {
    await lock.query('BEGIN');
    await lock.query(
      'SELECT membership_id FROM loyalty_accounts WHERE membership_id=$1 FOR UPDATE',
      [m.id],
    );
    await db.query(
      "UPDATE feature_entitlements SET expires_at=clock_timestamp()+interval '2 seconds' WHERE merchant_id=$1",
      [t.mid],
    );
    pending = award(t, m);
    const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
      waitDeadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < waitDeadline) {
      blocked = (
        await db.query(
          'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS value',
          [pid],
        )
      ).rows[0].value;
      if (blocked) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(blocked, true, 'the actual award must be waiting on the account');
    assert.equal(
      (
        await db.query(
          'SELECT expires_at>clock_timestamp() AS live FROM feature_entitlements WHERE merchant_id=$1',
          [t.mid],
        )
      ).rows[0].live,
      true,
      'the subscription must still be live when the award blocks',
    );
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (
        (
          await db.query(
            'SELECT expires_at<=clock_timestamp() AS expired FROM feature_entitlements WHERE merchant_id=$1',
            [t.mid],
          )
        ).rows[0].expired
      )
        break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await lock.query('COMMIT');
    const result = await pending;
    assert.equal(result.statusCode, 409, result.body);
    assert.equal(result.json().error.code, 'SUBSCRIPTION_INACTIVE');
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1', [
          m.id,
        ])
      ).rows[0].n,
      0,
    );
  } finally {
    await lock.query('ROLLBACK');
    await pending;
    await lock.end();
  }
});
