import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { tokenHash, keyedHash } from '../../apps/api/src/crypto.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';
import { readFile, readdir } from 'node:fs/promises';
import { enrollmentTerms, login, key } from '../helpers.js';
import type { LegalNotice } from '../../packages/contracts/src/legal.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  runtime = new pg.Client({ connectionString: c.DATABASE_URL });
const origin = 'https://device-fixture.nuqta.test';
const { app } = await buildApp({
  APP_ENV: 'test',
  COOKIE_SECURE: 'true',
  PUBLIC_APP_ORIGIN: origin,
  LOG_LEVEL: 'silent',
});
const program = '40000000-0000-4000-8000-000000000001',
  version = '50000000-0000-4000-8000-000000000001';
let code: string,
  terms: string,
  address = 1;
let notice: LegalNotice;
type Result = Awaited<ReturnType<typeof app.inject>>;
const cookie = (result: Result) =>
  result.cookies.map((item) => item.name + '=' + item.value).join('; ');
before(async () => {
  await db.connect();
  await runtime.connect();
  await seed(db);
  await app.ready();
  code = randomBytes(24).toString('base64url');
  await db.query(
    "INSERT INTO placements(merchant_id,branch_id,label,kind,public_code,created_by) VALUES($1,$2,'Device fixture','stand',$3,$4)",
    [ids.merchantA, ids.branchA, code, ids.ownerA],
  );
  terms = await enrollmentTerms(app, program);
  notice = (await app.inject('/api/v1/public/legal?lang=en')).json();
});
after(async () => {
  await app.close();
  await db.end();
  await runtime.end();
});
async function boot() {
  const result = await app.inject({
    url: '/api/v1/customer/bootstrap',
    headers: { 'x-nuqta-workspace': 'customer' },
  });
  assert.equal(result.statusCode, 200);
  return {
    origin,
    cookie: cookie(result),
    'x-csrf-token': result.json().csrfToken,
    'x-nuqta-workspace': 'customer',
  };
}
async function register(
  phone: string,
  headers?: Awaited<ReturnType<typeof boot>>,
  ip?: string,
  policy: Record<string, unknown> = {},
) {
  headers ??= await boot();
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/customer/register',
    headers,
    remoteAddress: ip || '192.0.2.' + address++,
    payload: {
      displayName: 'Synthetic holder',
      phone,
      merchantId: ids.merchantA,
      programId: program,
      programVersionId: version,
      branchId: ids.branchA,
      placementCode: code,
      acceptedTerms: true,
      acceptedTermsHash: terms,
      acceptedPrivacyVersion: notice.acceptance.version,
      acceptedPrivacyHash: notice.acceptance.hash,
      acceptedPrivacyLocale: notice.locale,
      source: 'qr',
      ...policy,
    },
  });
  return { result, headers };
}

test('legal notices are public locale-specific drafts; missing or stale acceptance cannot register, and the exact accepted text survives retries', async () => {
  const ar = (await app.inject('/api/v1/public/legal?lang=ar')).json() as LegalNotice;
  assert.equal(ar.reviewRequired, true);
  assert.equal(notice.reviewRequired, true);
  assert.notEqual(ar.acceptance.hash, notice.acceptance.hash);
  assert.equal(ar.acceptance.hash, tokenHash(ar.acceptance.text));
  assert.equal(ar.acceptance.version.endsWith(':ar'), true);
  const prepared = await boot();
  const stale = await register('01512345670', prepared, undefined, {
    acceptedPrivacyVersion: 'obsolete',
  });
  assert.equal(stale.result.statusCode, 409);
  assert.equal(stale.result.json().error.code, 'PRIVACY_CHANGED');
  const forged = await register('01512345670', prepared, undefined, {
    acceptedPrivacyHash: '0'.repeat(64),
  });
  assert.equal(forged.result.statusCode, 409);
  const missing = await register('01512345670', prepared, undefined, {
    acceptedPrivacyHash: undefined,
  });
  assert.equal(missing.result.statusCode, 422);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM customer_identities WHERE phone_e164='+201512345670'",
      )
    ).rows[0].n,
    0,
  );
  const acceptance = {
    acceptedPrivacyVersion: ar.acceptance.version,
    acceptedPrivacyHash: ar.acceptance.hash,
    acceptedPrivacyLocale: ar.locale,
  };
  const created = await register('01512345670', prepared, undefined, acceptance);
  assert.equal(created.result.statusCode, 200, created.result.body);
  assert.equal(
    (await register('01512345670', prepared, undefined, acceptance)).result.statusCode,
    200,
  );
  const uid = (
    await db.query("SELECT customer_id FROM customer_identities WHERE phone_e164='+201512345670'")
  ).rows[0].customer_id;
  const rows = (
    await db.query(
      'SELECT version,text_hash,terms_text FROM customer_privacy_acceptances WHERE customer_id=$1',
      [uid],
    )
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version, ar.acceptance.version);
  assert.equal(rows[0].text_hash, ar.acceptance.hash);
  assert.equal(rows[0].terms_text, ar.acceptance.text);
  const headers = {
    origin,
    cookie: cookie(created.result),
    'x-csrf-token': created.result.json().csrfToken,
    'x-nuqta-workspace': 'customer',
    ...key(),
  };
  const body = {
    merchantId: ids.merchantA,
    programId: program,
    programVersionId: version,
    branchId: ids.branchA,
    alias: 'Synthetic holder',
    acceptedTerms: true,
    acceptedTermsHash: terms,
  };
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/v1/me/memberships', headers, payload: body }))
      .statusCode,
    422,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/me/memberships',
        headers,
        payload: { ...body, ...acceptance, acceptedPrivacyHash: '0'.repeat(64) },
      })
    ).statusCode,
    409,
  );
  const en = {
    acceptedPrivacyVersion: notice.acceptance.version,
    acceptedPrivacyHash: notice.acceptance.hash,
    acceptedPrivacyLocale: notice.locale,
  };
  const joined = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers,
    payload: { ...body, ...en },
  });
  assert.equal(joined.statusCode, 200, joined.body);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM customer_privacy_acceptances WHERE customer_id=$1',
        [uid],
      )
    ).rows[0].n,
    2,
  );
  await assert.rejects(
    () =>
      runtime.query(
        "INSERT INTO customer_privacy_acceptances(customer_id,device_id,version,text_hash,terms_text) VALUES($1,$1,'forged',$2,'forged')",
        [uid, '0'.repeat(64)],
      ),
    (e) => (e as { code: string }).code === '42501',
  );
  await runtime.query('BEGIN');
  try {
    await runtime.query("SELECT set_config('app.user_id',$1,true)", [ids.ownerA]);
    const sid = (
      await db.query('SELECT id FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [
        uid,
      ])
    ).rows[0].id;
    await assert.rejects(
      () =>
        runtime.query('SELECT accept_customer_legal($1,$2,$3)', [
          sid,
          notice.acceptance.version,
          notice.acceptance.text,
        ]),
      /NQ:UNAUTHENTICATED/,
    );
  } finally {
    await runtime.query('ROLLBACK');
  }
});
test('phone registration needs Origin/CSRF, creates no password/email, and device cookie alone restores the isolated customer session', async () => {
  const prepared = await boot();
  const missing = await app.inject({
    method: 'POST',
    url: '/api/v1/customer/register',
    headers: { origin },
    payload: {},
  });
  assert.equal(missing.statusCode, 403);
  const evil = await app.inject({
    method: 'POST',
    url: '/api/v1/customer/register',
    headers: { ...prepared, origin: 'https://foreign.test' },
    payload: {},
  });
  assert.equal(evil.statusCode, 403);
  const created = await register('01012345678', prepared);
  assert.equal(created.result.statusCode, 200, created.result.body);
  const device = created.result.cookies.find((item) => item.name === '__Host-nq_device')!;
  assert.ok(device.httpOnly && device.secure && device.sameSite === 'Lax');
  assert.equal(device.path, '/');
  assert.equal(device.maxAge, 365 * 86400);
  assert.ok(!created.result.cookies.some((item) => item.name === '__Host-nq_session'));
  const user = (
    await db.query(
      'SELECT u.id,u.email,u.password_hash,d.token_hash,d.user_agent_family FROM users u JOIN customer_devices d ON d.customer_id=u.id WHERE d.token_hash=$1',
      [tokenHash(device.value)],
    )
  ).rows[0];
  assert.equal(user.email, null);
  assert.equal(user.password_hash, null);
  assert.notEqual(user.token_hash, device.value);
  assert.equal(user.user_agent_family, 'Other');
  const restored = await app.inject({
    url: '/api/v1/session',
    headers: { cookie: '__Host-nq_device=' + device.value, 'x-nuqta-workspace': 'customer' },
  });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(restored.json().user.id, user.id);
  assert.equal(restored.json().user.mfaRequired, false);
  const cards = await app.inject({
    url: '/api/v1/me/memberships',
    headers: { cookie: '__Host-nq_device=' + device.value, 'x-nuqta-workspace': 'customer' },
  });
  assert.equal(cards.statusCode, 200);
  assert.equal(cards.json().cards[0].id, created.result.json().membershipId);
  const unscoped = await app.inject({
    url: '/api/v1/session',
    headers: { cookie: '__Host-nq_device=' + device.value },
  });
  assert.equal(unscoped.statusCode, 401);
  for (const workspace of ['platform', 'merchant', 'cashier']) {
    const denied = await app.inject({
      url: '/api/v1/session',
      headers: { cookie: '__Host-nq_device=' + device.value, 'x-nuqta-workspace': workspace },
    });
    assert.equal(denied.statusCode, 401);
  }
  const privacy = (
    await db.query(
      'SELECT text_hash,terms_text FROM customer_privacy_acceptances WHERE customer_id=$1',
      [user.id],
    )
  ).rows[0];
  assert.equal(privacy.text_hash, tokenHash(privacy.terms_text));
  await runtime.query('BEGIN');
  try {
    await runtime.query("SELECT set_config('app.user_id',$1,true)", [ids.ownerB]);
    assert.equal(
      (await runtime.query('SELECT id FROM customer_devices WHERE customer_id=$1', [user.id]))
        .rowCount,
      0,
    );
    assert.equal(
      (
        await runtime.query('SELECT customer_id FROM customer_identities WHERE customer_id=$1', [
          user.id,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (await runtime.query('SELECT id FROM memberships WHERE user_id=$1', [user.id])).rowCount,
      0,
    );
  } finally {
    await runtime.query('ROLLBACK');
  }
  await assert.rejects(
    () => runtime.query('SELECT token_hash FROM customer_devices'),
    /permission denied/,
  );
});
test('an existing phone reveals no name or balance and never binds an unrelated device; repeated registration on the original device resumes once', async () => {
  const first = await register('01123456789');
  assert.equal(first.result.statusCode, 200, first.result.body);
  const second = await register('+201123456789');
  assert.equal(second.result.statusCode, 409);
  assert.equal(second.result.json().error.code, 'CUSTOMER_PHONE_EXISTS');
  assert.ok(!/Synthetic holder|balance|membershipId/.test(second.result.body));
  const denied = await app.inject({ url: '/api/v1/me/memberships', headers: second.headers });
  assert.equal(denied.statusCode, 401);
  const retry = await register('01123456789', first.headers);
  assert.equal(retry.result.statusCode, 200, retry.result.body);
  assert.equal(retry.result.json().membershipId, first.result.json().membershipId);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM customer_identities WHERE phone_e164='+201123456789'",
      )
    ).rows[0].n,
    1,
  );
});

test('a verified legacy holder can bind its own existing cards without merging another phone identity', async () => {
  const email = 'legacy-binding-' + randomUUID() + '@nuqta.test',
    legacy = await login(app, email, origin);
  const uid = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  const enrolled = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...legacy, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: program,
      programVersionId: version,
      alias: 'Legacy holder',
      acceptedTerms: true,
      acceptedTermsHash: terms,
      branchId: ids.branchA,
    },
  });
  assert.equal(enrolled.statusCode, 200);
  const prepared = await boot(),
    headers = {
      ...prepared,
      cookie: legacy.cookie + '; ' + prepared.cookie,
      'x-csrf-token': legacy['x-csrf-token'],
    };
  const foreign = await register('01012345678', headers);
  assert.equal(foreign.result.statusCode, 409);
  const own = await register('01578901234', headers);
  assert.equal(own.result.statusCode, 200, own.result.body);
  assert.equal(own.result.json().membershipId, enrolled.json().membershipId);
  assert.equal(
    (await db.query("SELECT customer_id FROM customer_identities WHERE phone_e164='+201578901234'"))
      .rows[0].customer_id,
    uid,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM memberships WHERE user_id=$1', [uid])).rows[0]
      .n,
    1,
  );
});
test('revocation fences an existing session and customer QR immediately; session expiry automatically restores from a valid device', async () => {
  const first = await register('01234567890');
  assert.equal(first.result.statusCode, 200, first.result.body);
  const h = {
    origin,
    cookie: first.headers.cookie + '; ' + cookie(first.result),
    'x-csrf-token': first.result.json().csrfToken,
    'x-nuqta-workspace': 'customer',
  };
  const mid = first.result.json().membershipId;
  const qr = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships/' + mid + '/presentation-tokens',
    headers: { ...h, ...key() },
    payload: {},
  });
  assert.equal(qr.statusCode, 200, qr.body);
  const raw = first.result.cookies.find((item) => item.name === '__Host-nq_device')!.value;
  await db.query(
    "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE customer_device_id=(SELECT id FROM customer_devices WHERE token_hash=$1)",
    [tokenHash(raw)],
  );
  const restored = await app.inject({ url: '/api/v1/session', headers: h });
  assert.equal(restored.statusCode, 200);
  await db.query('UPDATE customer_devices SET revoked_at=clock_timestamp() WHERE token_hash=$1', [
    tokenHash(raw),
  ]);
  const denied = await app.inject({
    url: '/api/v1/me/memberships',
    headers: { ...h, cookie: cookie(restored) },
  });
  assert.equal(denied.statusCode, 401);
  const staff = await login(app, 'cashier@bunn.test', origin);
  const proof = await app.inject({
    method: 'POST',
    url: '/api/v1/cashier/scans/resolve',
    headers: { ...staff, origin },
    payload: { merchantId: ids.merchantA, branchId: ids.branchA, token: qr.json().token },
  });
  assert.equal(proof.statusCode, 410);
});

test('full-number search is scoped and audited without a number; manual WhatsApp recovery preserves stamps and consumes once by POST', async () => {
  const holder = await register('01545678901');
  assert.equal(holder.result.statusCode, 200, holder.result.body);
  const h = {
    origin,
    cookie: holder.headers.cookie + '; ' + cookie(holder.result),
    'x-csrf-token': holder.result.json().csrfToken,
    'x-nuqta-workspace': 'customer',
  };
  const member = holder.result.json().membershipId,
    staff = await login(app, 'cashier@bunn.test', origin),
    foreign = await login(app, 'owner@lamsa.test', origin);
  const qr = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships/' + member + '/presentation-tokens',
    headers: { ...h, ...key() },
    payload: {},
  });
  assert.equal(qr.statusCode, 200);
  const award = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/stamp-awards',
    headers: { ...staff, ...key() },
    payload: {
      branchId: ids.branchA,
      membershipId: member,
      quantity: 2,
      purchaseReference: { reference: randomUUID(), businessDate: businessDate('Africa/Cairo') },
      presentationContext: qr.json().token,
    },
  });
  assert.equal(award.statusCode, 200, award.body);
  const search = '/api/v1/merchants/' + ids.merchantA + '/customer-recovery/search',
    payload = { phone: '01545678901', branchId: ids.branchA };
  const partial = await app.inject({
    method: 'POST',
    url: search,
    headers: staff,
    payload: { ...payload, phone: '+20101234' },
  });
  assert.equal(partial.statusCode, 422);
  const denied = await app.inject({ method: 'POST', url: search, headers: foreign, payload });
  assert.equal(denied.statusCode, 404);
  const found = await app.inject({ method: 'POST', url: search, headers: staff, payload });
  assert.equal(found.statusCode, 200, found.body);
  const customer = found.json().customer;
  assert.ok(customer.phone.includes('•'));
  assert.equal(customer.cards[0].balance, 2);
  assert.ok(!found.body.includes('+201545678901'));
  const noResult = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantB + '/customer-recovery/search',
    headers: foreign,
    payload: { ...payload, branchId: ids.branchB },
  });
  assert.equal(noResult.statusCode, 200);
  assert.equal(noResult.json().customer, null);
  const command = key(),
    request = { customerId: customer.customerId, branchId: ids.branchA, requestedByCustomer: true };
  const issue = () =>
    app.inject({
      method: 'POST',
      url: '/api/v1/merchants/' + ids.merchantA + '/customer-recovery',
      headers: { ...staff, ...command },
      payload: request,
    });
  const issued = await issue();
  assert.equal(issued.statusCode, 200, issued.body);
  assert.equal(issued.json().draftOnly, true);
  const wa = new URL(issued.json().url);
  assert.equal(wa.hostname, 'wa.me');
  assert.equal(wa.pathname, '/201545678901');
  const text = wa.searchParams.get('text')!,
    token = /\/r\/([a-f0-9]{64})/.exec(text)![1]!;
  const repeated = await issue();
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.json().url, issued.json().url);
  const row = (
    await db.query('SELECT * FROM customer_recoveries WHERE token_hash=$1', [tokenHash(token)])
  ).rows[0];
  assert.notEqual(row.token_hash, token);
  assert.ok(row.expires_at.getTime() - row.created_at.getTime() >= 86399000);
  for (let n = 0; n < 2; n++) {
    const preview = await app.inject({ url: '/api/v1/customer/recoveries/' + token });
    assert.equal(preview.statusCode, 200);
    assert.ok(!preview.body.includes('Synthetic holder'));
  }
  assert.equal(
    (await db.query('SELECT used_at FROM customer_recoveries WHERE id=$1', [row.id])).rows[0]
      .used_at,
    null,
  );
  const next = await boot();
  // Recovering a personal card must preserve an explicitly scoped team session.
  const teamToken = tokenHash(randomUUID()),
    legacyToken = tokenHash(randomUUID());
  await db.query(
    "INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at,auth_method,portal) VALUES($1,$2,$2,now()+interval '1 hour','password','merchant'),($1,$3,$3,now()+interval '1 hour','password',NULL)",
    [customer.customerId, teamToken, legacyToken],
  );
  const missing = await app.inject({
    method: 'POST',
    url: '/api/v1/customer/recoveries/' + token + '/consume',
    headers: { origin, cookie: next.cookie },
    payload: {},
  });
  assert.equal(missing.statusCode, 403);
  const consume = () =>
    app.inject({
      method: 'POST',
      url: '/api/v1/customer/recoveries/' + token + '/consume',
      headers: next,
      payload: { revokeOldDevices: true },
    });
  const recovered = await consume();
  assert.equal(recovered.statusCode, 200, recovered.body);
  assert.equal(recovered.json().membershipId, member);
  const sessionStates = (
    await db.query('SELECT token_hash,revoked_at FROM sessions WHERE token_hash=ANY($1::text[])', [
      [teamToken, legacyToken],
    ])
  ).rows;
  assert.equal(sessionStates.find((row) => row.token_hash === teamToken).revoked_at, null);
  assert.ok(sessionStates.find((row) => row.token_hash === legacyToken).revoked_at);
  assert.equal((await consume()).statusCode, 410);
  const old = await app.inject({ url: '/api/v1/me/memberships', headers: h });
  assert.equal(old.statusCode, 401);
  const cards = await app.inject({
    url: '/api/v1/me/memberships',
    headers: { 'x-nuqta-workspace': 'customer', cookie: cookie(recovered) },
  });
  assert.equal(cards.statusCode, 200);
  assert.equal(cards.json().cards[0].balance, 2);
  const audit = (
    await db.query(
      "SELECT action,detail FROM audit_events WHERE merchant_id=$1 AND action LIKE 'customer.recovery.%'",
      [ids.merchantA],
    )
  ).rows;
  assert.ok(
    audit.some(
      (row) =>
        row.action === 'customer.recovery.requested' &&
        row.detail.purpose === 'requested_by_customer',
    ),
  );
  assert.ok(!JSON.stringify(audit).includes('01545678901'));
});

test('owner can disable cashier recovery with revision/CSRF protection; existing cashier links are fenced and owner recovery still works', async () => {
  const holder = await register('01056789012');
  assert.equal(holder.result.statusCode, 200);
  const uid = (
    await db.query("SELECT customer_id FROM customer_identities WHERE phone_e164='+201056789012'")
  ).rows[0].customer_id;
  const owner = await login(app, 'owner@bunn.test', origin),
    staff = await login(app, 'cashier@bunn.test', origin),
    policy = '/api/v1/merchants/' + ids.merchantA + '/customer-recovery-settings';
  const issue = (who: typeof owner) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/merchants/' + ids.merchantA + '/customer-recovery',
      headers: { ...who, ...key() },
      payload: { customerId: uid, branchId: ids.branchA, requestedByCustomer: true },
    });
  const previous = await issue(staff);
  assert.equal(previous.statusCode, 200);
  const token = /\/r\/([a-f0-9]{64})/.exec(
    new URL(previous.json().url).searchParams.get('text')!,
  )![1]!;
  const settings = await app.inject({ url: policy, headers: owner });
  assert.equal(settings.statusCode, 200);
  const change = (headers: typeof owner, revision: number) =>
    app.inject({
      method: 'PATCH',
      url: policy,
      headers: { ...headers, 'if-match': String(revision) },
      payload: { cashierEnabled: false },
    });
  assert.equal(
    (await change({ ...owner, 'x-csrf-token': 'wrong' }, settings.json().revision)).statusCode,
    403,
  );
  assert.equal((await change(staff, settings.json().revision)).statusCode, 403);
  const saved = await change(owner, settings.json().revision);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal((await change(owner, settings.json().revision)).statusCode, 409);
  const blocked = await issue(staff);
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error.code, 'CASHIER_RECOVERY_DISABLED');
  const next = await boot(),
    consume = await app.inject({
      method: 'POST',
      url: '/api/v1/customer/recoveries/' + token + '/consume',
      headers: next,
      payload: {},
    });
  assert.equal(consume.statusCode, 410);
  assert.equal((await issue(owner)).statusCode, 200);
  const reset = await app.inject({
    method: 'PATCH',
    url: policy,
    headers: { ...owner, 'if-match': String(saved.json().revision) },
    payload: { cashierEnabled: true },
  });
  assert.equal(reset.statusCode, 200);
});

test('ten recovery links are allowed per customer UTC day across issuers; retries do not consume more and limit attempts remain audited', async () => {
  const holder = await register('01167890123');
  assert.equal(holder.result.statusCode, 200);
  const uid = (
      await db.query("SELECT customer_id FROM customer_identities WHERE phone_e164='+201167890123'")
    ).rows[0].customer_id,
    owner = await login(app, 'owner@bunn.test', origin);
  const issue = () =>
    app.inject({
      method: 'POST',
      url: '/api/v1/merchants/' + ids.merchantA + '/customer-recovery',
      headers: { ...owner, ...key() },
      payload: { customerId: uid, branchId: ids.branchA, requestedByCustomer: true },
    });
  const replies = await Promise.all(Array.from({ length: 11 }, issue));
  assert.equal(replies.filter((result) => result.statusCode === 200).length, 10);
  assert.equal(replies.filter((result) => result.statusCode === 429).length, 1);
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM customer_recoveries WHERE customer_id=$1', [
        uid,
      ])
    ).rows[0].n,
    10,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE target_id=$1 AND action='customer.recovery.limit'",
        [uid],
      )
    ).rows[0].n,
    1,
  );
});

test('registration enumeration stops at five attempts per IP and placement without creating identities', async () => {
  const booted = await boot(),
    ip = '203.0.113.99';
  for (let n = 0; n < 5; n++) {
    const r = await register('01012345678', booted, ip);
    assert.equal(r.result.statusCode, 409);
  }
  const sixth = await register('01012345678', booted, ip);
  assert.equal(sixth.result.statusCode, 429);
  assert.equal(sixth.result.json().error.code, 'CUSTOMER_REGISTRATION_LIMIT');
  for (const identity of [
    'customer-register-ip:' + ip,
    'customer-register-placement:' + code + ':' + ip,
  ])
    assert.equal(
      (
        await db.query('SELECT attempts FROM customer_auth_limits WHERE key_hash=$1', [
          keyedHash(identity, c.AUTH_PEPPER),
        ])
      ).rows[0].attempts,
      6,
    );
});

test('a customer device never acquires staff access after its user is promoted, even with a forged workspace/cookie name', async () => {
  const created = await register('01278901234');
  assert.equal(created.result.statusCode, 200);
  const session = created.result.cookies.find(
    (item) => item.name === '__Host-nq_session_customer',
  )!.value;
  const uid = (
    await db.query("SELECT customer_id FROM customer_identities WHERE phone_e164='+201278901234'")
  ).rows[0].customer_id;
  const sid = (
    await db.query(
      "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,'Device promotion fixture','owner') RETURNING id",
      [ids.merchantA, uid, 'promotion-' + randomUUID() + '@nuqta.test'],
    )
  ).rows[0].id;
  await db.query(
    'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
    [ids.merchantA, sid, ids.branchA],
  );
  const headers = {
    origin,
    cookie: cookie(created.result),
    'x-csrf-token': created.result.json().csrfToken,
    'x-nuqta-workspace': 'customer',
  };
  const own = await app.inject({ url: '/api/v1/me/memberships', headers });
  assert.equal(own.statusCode, 200);
  const shop = await app.inject({
    url: '/api/v1/merchants/' + ids.merchantA + '/overview',
    headers,
  });
  assert.equal(shop.statusCode, 401);
  const scan = await app.inject({
    method: 'POST',
    url: '/api/v1/cashier/scans/resolve',
    headers,
    payload: { merchantId: ids.merchantA, branchId: ids.branchA, token: 'NQP:' + '0'.repeat(64) },
  });
  assert.equal(scan.statusCode, 401);
  const renamed = await app.inject({
    url: '/api/v1/session',
    headers: { cookie: '__Host-nq_session_merchant=' + session, 'x-nuqta-workspace': 'merchant' },
  });
  assert.equal(renamed.statusCode, 401);
  const shared = await app.inject({
    url: '/api/v1/merchants/' + ids.merchantA + '/overview',
    headers: { cookie: '__Host-nq_session=' + session },
  });
  assert.equal(shared.statusCode, 401);
});

test('cashier searches stop at thirty per hour; exact misses and blocked attempts are all audited', async () => {
  const email = 'device-search-' + randomUUID() + '@nuqta.test',
    staff = await login(app, email, origin),
    uid = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  const membership = (
    await db.query(
      "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,'Search fixture','cashier') RETURNING id",
      [ids.merchantA, uid, email],
    )
  ).rows[0].id;
  await db.query(
    'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
    [ids.merchantA, membership, ids.branchA],
  );
  for (let n = 0; n < 31; n++) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/merchants/' + ids.merchantA + '/customer-recovery/search',
      headers: staff,
      payload: { phone: '01299999999', branchId: ids.branchA },
    });
    assert.equal(response.statusCode, n < 30 ? 200 : 429);
  }
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE actor_id=$1 AND action IN ('customer.recovery.search','customer.recovery.search_limit')",
        [uid],
      )
    ).rows[0].n,
    31,
  );
});

test('the actual identity migration preserves legacy seed accounts/cards, converts a consistent unique phone, and leaves conflicts legacy without merging', async () => {
  const database = 'nuqta_customer_migration_' + Date.now();
  assert.match(database, /^nuqta_customer_migration_\d+$/);
  const connection = new URL(c.DATABASE_MIGRATOR_URL!);
  connection.pathname = '/' + database;
  await db.query('CREATE DATABASE ' + pg.escapeIdentifier(database));
  const legacy = new pg.Client({ connectionString: connection.href });
  try {
    await legacy.connect();
    await legacy.query(
      'CREATE TABLE schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const file of (await readdir('db/migrations'))
      .filter((file) => file.endsWith('.sql') && file < '010b_customer_devices.sql')
      .sort())
      await legacy.query(await readFile('db/migrations/' + file, 'utf8'));
    await seed(legacy);
    const entries: [string, string][] = [
      ['one', '+201098765432'],
      ['duplicate-one', '+201198765432'],
      ['duplicate-two', '+201198765432'],
      ['missing', ''],
    ];
    const users = new Map<string, string>();
    for (const [name, phone] of entries) {
      const id = (
        await legacy.query(
          "INSERT INTO users(email,display_name,password_hash,password_version) VALUES($1,$2,'legacy-fixture-hash',2) RETURNING id",
          [name + '@migration.test', name],
        )
      ).rows[0].id;
      users.set(name, id);
      await legacy.query("SELECT set_config('app.user_id',$1,false)", [id]);
      const proof = (await legacy.query('SELECT public_enrollment_terms($1) AS value', [program]))
        .rows[0].value;
      await legacy.query("SELECT enroll_customer_with_terms($1,$2,$3,$4,'qr',$5,'{}'::jsonb,$6)", [
        ids.merchantA,
        program,
        version,
        name,
        ids.branchA,
        proof.termsHash,
      ]);
      if (phone)
        await legacy.query('SELECT set_customer_contact_phone($1,$2,true)', [ids.merchantA, phone]);
    }
    const snapshot = async () => ({
      accounts: (
        await legacy.query(
          "SELECT md5(string_agg(id::text||coalesce(email,'')||display_name||coalesce(password_hash,'')||password_version::text||global_role||status,'' ORDER BY id)) AS value FROM users",
        )
      ).rows[0].value,
      memberships: (
        await legacy.query(
          "SELECT md5(string_agg(row_to_json(m)::text,'' ORDER BY id)) AS value FROM memberships m",
        )
      ).rows[0].value,
      accountsState: (
        await legacy.query(
          "SELECT md5(string_agg(row_to_json(a)::text,'' ORDER BY membership_id)) AS value FROM loyalty_accounts a",
        )
      ).rows[0].value,
    });
    const before = await snapshot();
    await legacy.query('BEGIN');
    await legacy.query(await readFile('db/migrations/010b_customer_devices.sql', 'utf8'));
    await legacy.query('COMMIT');
    assert.deepEqual(await snapshot(), before);
    const rows = (
      await legacy.query('SELECT customer_id,phone_e164,legacy FROM customer_identities')
    ).rows;
    assert.equal(
      rows.find((row) => row.customer_id === users.get('one')).phone_e164,
      '+201098765432',
    );
    for (const name of ['duplicate-one', 'duplicate-two', 'missing']) {
      const row = rows.find((row) => row.customer_id === users.get(name));
      assert.equal(row.legacy, true);
      assert.equal(row.phone_e164, null);
    }
    assert.ok(!rows.some((row) => row.customer_id === ids.ownerA));
    assert.equal(
      (await legacy.query('SELECT count(*)::int AS n FROM customer_devices')).rows[0].n,
      0,
    );
  } finally {
    await legacy.end();
    await db.query('DROP DATABASE ' + pg.escapeIdentifier(database) + ' WITH (FORCE)');
  }
});
test('a customer returning a week later with only the device cookie is recognised and collects at the sticker', async () => {
  await db.query(
    'UPDATE stamp_collection_settings SET require_cashier=false,require_location=false,collections_per_day=1,open_collection_acknowledged=true,welcome_stamps=1 WHERE merchant_id=$1',
    [ids.merchantA],
  );
  try {
    const first = await register('01098765432');
    assert.equal(first.result.statusCode, 200, first.result.body);
    const membership = first.result.json().membershipId;
    // The welcome stamp arrives once, with the new card.
    assert.equal(
      (await db.query('SELECT balance FROM loyalty_accounts WHERE membership_id=$1', [membership]))
        .rows[0].balance,
      1,
    );
    const device = first.result.cookies.find((item) => item.name === '__Host-nq_device')!;
    // A week passes: every session has expired and the phone kept only its device cookie.
    await db.query(
      "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 day' WHERE customer_device_id=(SELECT id FROM customer_devices WHERE token_hash=$1)",
      [tokenHash(device.value)],
    );
    await db.query(
      "UPDATE customer_devices SET last_seen_at=clock_timestamp()-interval '8 days' WHERE token_hash=$1",
      [tokenHash(device.value)],
    );
    const bare = {
      origin,
      cookie: '__Host-nq_device=' + device.value,
      'x-nuqta-workspace': 'customer',
    };
    // The sticker opens the card page; its first request restores the session from the device.
    const restored = await app.inject({ url: '/api/v1/session', headers: bare });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().user.deviceBound, true);
    const session = {
      ...bare,
      cookie: bare.cookie + '; ' + cookie(restored),
      'x-csrf-token': restored.json().csrfToken,
    };
    const cards = await app.inject({ url: '/api/v1/me/memberships', headers: session });
    assert.equal(cards.json().cards[0].id, membership);
    const collected = await app.inject({
      method: 'POST',
      url: '/api/v1/me/stamp-collections',
      headers: { ...session, ...key() },
      payload: { membershipId: membership, branchId: ids.branchA, placementCode: code },
    });
    assert.equal(collected.statusCode, 200, collected.body);
    assert.equal(collected.json().outcome, 'awarded');
    assert.equal(collected.json().balanceAfter, 2);
    // The device stays valid for another year from this visit.
    const renewed = (
      await db.query('SELECT expires_at FROM customer_devices WHERE token_hash=$1', [
        tokenHash(device.value),
      ])
    ).rows[0].expires_at as Date;
    assert.ok(renewed.getTime() - Date.now() > 360 * 86400_000);
  } finally {
    await db.query(
      'UPDATE stamp_collection_settings SET require_cashier=true,collections_per_day=NULL,open_collection_acknowledged=false,welcome_stamps=0 WHERE merchant_id=$1',
      [ids.merchantA],
    );
  }
});
