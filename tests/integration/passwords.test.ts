import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  runtime = new pg.Client({ connectionString: c.DATABASE_URL }),
  { app } = await buildApp({ APP_ENV: 'development', LOG_LEVEL: 'silent' });
const password = 'A memorable local password 2026!';
const origin = { origin: c.PUBLIC_APP_ORIGIN };
type Headers = { cookie: string; origin: string; 'x-csrf-token': string };
before(async () => {
  await db.connect();
  await runtime.connect();
  await app.ready();
});
after(async () => {
  await app.close();
  await db.end();
  await runtime.end();
});
const headers = (r: {
  cookies: { name: string; value: string }[];
  json: () => { csrfToken: string };
}): Headers => ({
  ...origin,
  cookie: r.cookies.map((x) => x.name + '=' + x.value).join('; '),
  'x-csrf-token': r.json().csrfToken,
});
async function register() {
  const email = 'pw-' + randomUUID() + '@nuqta.test';
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: origin,
    payload: { email, password },
  });
  assert.equal(r.statusCode, 200, r.body);
  return { email, headers: headers(r) };
}
const addresses = new Map<string, string>();
const login = (email: string, pw = password) => {
  if (!addresses.has(email)) addresses.set(email, '127.0.0.' + (10 + addresses.size));
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: origin,
    remoteAddress: addresses.get(email)!,
    payload: { email, password: pw },
  });
};

test('platform admin, owner, cashier and customer sign in with passwords; grants stay distinct and no MFA prompt is required', async () => {
  const mid = (
    await db.query(
      "INSERT INTO merchants(name,slug) VALUES('Password role fixture',$1) RETURNING id",
      ['pw-' + randomUUID()],
    )
  ).rows[0].id;
  const branch = (
    await db.query(
      "INSERT INTO branches(merchant_id,name) VALUES($1,'Password branch') RETURNING id",
      [mid],
    )
  ).rows[0].id;
  for (const role of ['platform_admin', 'owner', 'cashier', 'customer']) {
    const actor = await register(),
      id = (await db.query('SELECT id FROM users WHERE email=$1', [actor.email])).rows[0].id;
    if (role === 'platform_admin')
      await db.query("UPDATE users SET global_role='platform_admin' WHERE id=$1", [id]);
    if (role === 'owner' || role === 'cashier') {
      const staff = (
        await db.query(
          'INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,$4,$4) RETURNING id',
          [mid, id, actor.email, role],
        )
      ).rows[0].id;
      await db.query(
        'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
        [mid, staff, branch],
      );
    }
    const signed = await login(actor.email);
    assert.equal(signed.statusCode, 200);
    const h = headers(signed);
    const session = (await app.inject({ url: '/api/v1/session', headers: h })).json();
    assert.equal(session.user.mfaRequired, false);
    assert.equal(session.user.mfaVerified, false);
    assert.equal(session.grants.length, role === 'owner' || role === 'cashier' ? 1 : 0);
    const platform = await app.inject({ url: '/api/v1/platform/provisioning-drafts', headers: h });
    assert.equal(platform.statusCode, role === 'platform_admin' ? 200 : 403);
    const company = await app.inject({ url: '/api/v1/merchants/' + mid, headers: h });
    assert.equal(
      company.statusCode,
      role === 'cashier' ? 403 : ['platform_admin', 'owner'].includes(role) ? 200 : 404,
    );
  }
});
test('signup cannot set roles or take over an existing account; password users cannot fall back to email codes', async () => {
  const actor = await register();
  const bad = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: origin,
    payload: { email: 'role-' + randomUUID() + '@nuqta.test', password, role: 'platform_admin' },
  });
  assert.equal(bad.statusCode, 422);
  const again = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: origin,
    payload: { email: actor.email, password: 'Different long password' },
  });
  assert.equal(again.statusCode, 409);
  assert.equal((await login(actor.email)).statusCode, 200);
  const otp = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/challenges',
    headers: origin,
    payload: { email: actor.email },
  });
  assert.equal(otp.statusCode, 410);
  await assert.rejects(
    runtime.query('SELECT password_hash FROM users LIMIT 1'),
    (e: { code: string }) => e.code === '42501',
  );
});
test('failed password attempts persist per account and do not disclose unknown or disabled accounts', async () => {
  const actor = await register();
  for (let i = 0; i < 5; i++) {
    const r = await login(actor.email, 'wrong password');
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().error.code, 'INVALID_CREDENTIALS');
  }
  assert.equal((await login(actor.email)).statusCode, 401);
  assert.ok(
    (await db.query('SELECT locked_until FROM password_login_guards WHERE email=$1', [actor.email]))
      .rows[0].locked_until > new Date(),
  );
  const unknown = await login('unknown-' + randomUUID() + '@nuqta.test');
  assert.equal(unknown.json().error.code, 'INVALID_CREDENTIALS');
});
test('password changes require the current password and CSRF, revoke other sessions and retain the changing session', async () => {
  const actor = await register(),
    other = await login(actor.email),
    newPassword = 'A different memorable password!';
  const endpoint = '/api/v1/auth/password/change';
  const csrf = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: { ...actor.headers, 'x-csrf-token': 'wrong' },
    payload: { currentPassword: password, password: newPassword },
  });
  assert.equal(csrf.statusCode, 403);
  const wrong = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: actor.headers,
    payload: { currentPassword: 'wrong', password: newPassword },
  });
  assert.equal(wrong.statusCode, 401);
  assert.equal(
    (await app.inject({ url: '/api/v1/session', headers: actor.headers })).statusCode,
    200,
  );
  const changed = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: actor.headers,
    payload: { currentPassword: password, password: newPassword },
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(
    (await app.inject({ url: '/api/v1/session', headers: headers(other) })).statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/session', headers: headers(changed) })).statusCode,
    200,
  );
  assert.equal((await login(actor.email)).statusCode, 401);
  assert.equal((await login(actor.email, newPassword)).statusCode, 200);
});
test('password recovery is generic, single-use and version-fenced, and revokes previous sessions', async () => {
  const actor = await register();
  const request = async (email: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset-request',
      headers: origin,
      payload: { email },
    });
  assert.deepEqual(
    (await request(actor.email)).json(),
    (await request('missing-' + randomUUID() + '@nuqta.test')).json(),
  );
  const mail = (await app.inject({ url: '/api/v1/local/mail', remoteAddress: '127.0.0.1' }))
    .json()
    .messages.find((m: { to: string; link?: string }) => m.to === actor.email && m.link);
  assert.ok(mail);
  const token = new URL(mail.link).pathname.split('/').at(-1),
    next = 'A recovered password for Nuqta!';
  const resets = await Promise.all(
    [0, 1].map(() =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/reset',
        headers: origin,
        payload: { token, password: next },
      }),
    ),
  );
  assert.equal(resets.filter((r) => r.statusCode === 200).length, 1);
  assert.equal(resets.filter((r) => r.statusCode === 410).length, 1);
  assert.equal(
    (await app.inject({ url: '/api/v1/session', headers: actor.headers })).statusCode,
    401,
  );
  assert.equal((await login(actor.email, next)).statusCode, 200);
  const hash = (await db.query('SELECT password_hash FROM users WHERE email=$1', [actor.email]))
    .rows[0].password_hash;
  assert.ok(hash.startsWith('scrypt$'));
  assert.ok(!hash.includes(next));
});
