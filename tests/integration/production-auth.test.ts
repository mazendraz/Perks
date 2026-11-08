import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { opaqueToken, tokenHash, totp } from '../../apps/api/src/crypto.js';
import { openMfa } from '../../apps/api/src/mfa.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
assert.match(new URL(c.DATABASE_MIGRATOR_URL!).pathname, /^\/nuqta_test_\d+$/);
const origin = 'https://production.nuqta.test';
const { app } = await buildApp({
  APP_ENV: 'production',
  AUTH_PROVIDER: 'password',
  COOKIE_SECURE: 'true',
  PUBLIC_APP_ORIGIN: origin,
  LOG_LEVEL: 'silent',
});
const password = 'A production test phrase 2026!';
type Response = Awaited<ReturnType<typeof app.inject>>;
const headers = (r: Response) => ({
  origin,
  cookie: r.cookies.map((cookie) => cookie.name + '=' + cookie.value).join('; '),
  'x-csrf-token': r.json().csrfToken as string,
});
let address = 1;
async function register(role = 'customer') {
  const email = 'prod-' + randomUUID() + '@nuqta.test';
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    remoteAddress: '192.0.2.' + address++,
    headers: { origin },
    payload: { email, password },
  });
  assert.equal(r.statusCode, 200, r.body);
  const id = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  if (role !== 'customer')
    await db.query('UPDATE users SET global_role=$2 WHERE id=$1', [id, role]);
  return { email, id, first: r, headers: headers(r) };
}
const login = (email: string) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: '198.51.100.' + address++,
    headers: { origin },
    payload: { email, password },
  });
before(async () => {
  await db.connect();
  await app.ready();
});
after(async () => {
  await app.close();
  await db.end();
});

test('production password registration/login/change/reset use secure cookies and expose no local mail or managed exchange', async () => {
  const u = await register();
  assert.ok(
    u.first.cookies.every(
      (cookie) =>
        cookie.name.startsWith('__Host-') && cookie.secure && cookie.sameSite === 'Strict',
    ),
  );
  assert.ok(
    u.first.cookies
      .filter((cookie) => cookie.name.includes('session'))
      .every((cookie) => cookie.httpOnly),
  );
  const signed = await login(u.email);
  assert.equal(signed.statusCode, 200);
  assert.equal(
    (await app.inject({ url: '/api/v1/local/mail', remoteAddress: '127.0.0.1' })).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/exchange',
        headers: { origin },
        payload: { accessToken: 'unused' },
      })
    ).statusCode,
    404,
  );
  const change = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/password/change',
    headers: u.headers,
    payload: { currentPassword: password, password: 'Changed production phrase 2026!' },
  });
  assert.equal(change.statusCode, 200, change.body);
  assert.equal(
    (await app.inject({ url: '/api/v1/session', headers: headers(signed) })).statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/session', headers: headers(change) })).statusCode,
    200,
  );
  const request = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/password/reset-request',
    headers: { origin },
    payload: { email: u.email },
  });
  assert.equal(request.statusCode, 202);
  // Delivery is L02; create an owned test token to verify production reset mechanics without real email.
  const token = opaqueToken();
  await db.query(
    "INSERT INTO password_reset_tokens(user_id,token_hash,credential_version,expires_at) SELECT id,$2,password_version,now()+interval '30 minutes' FROM users WHERE id=$1",
    [u.id, tokenHash(token)],
  );
  const reset = () =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      headers: { origin },
      payload: { token, password },
    });
  assert.equal((await reset()).statusCode, 200);
  assert.equal((await reset()).statusCode, 410);
  assert.equal(
    (await app.inject({ url: '/api/v1/session', headers: headers(change) })).statusCode,
    401,
  );
  assert.equal((await login(u.email)).statusCode, 200);
});

test('every platform role requires MFA in production, enrollment is session-bound and recovery codes work once', async () => {
  for (const role of ['platform_admin', 'platform_support']) {
    const u = await register(role),
      signed = await login(u.email),
      h = headers(signed);
    const session = (await app.inject({ url: '/api/v1/session', headers: h })).json();
    assert.equal(session.user.mfaRequired, true);
    for (const url of [
      '/api/v1/platform/admins',
      '/api/v1/platform/provisioning-drafts',
      '/api/v1/platform/health',
    ]) {
      const result = await app.inject({ url, headers: h });
      assert.equal(result.statusCode, 403);
      assert.equal(result.json().error.code, 'MFA_REQUIRED');
    }
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/setup',
      headers: h,
      payload: { currentPassword: password },
    });
    assert.equal(setup.statusCode, 200, setup.body);
    assert.match(setup.json().qrDataUrl, /^data:image\/png;base64,/);
    const stored = (
      await db.query('SELECT secret_encrypted FROM mfa_enrollments WHERE user_id=$1', [u.id])
    ).rows[0].secret_encrypted;
    const secret = openMfa(stored, c.AUTH_PEPPER);
    assert.ok(!stored.includes(secret));
    const code = totp(secret, Math.floor(Date.now() / 30000));
    const other = await login(u.email),
      otherHeaders = headers(other);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/mfa/confirm',
          headers: otherHeaders,
          payload: { code },
        })
      ).statusCode,
      401,
    );
    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/confirm',
      headers: h,
      payload: { code },
    });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    const codes: string[] = confirmed.json().recoveryCodes;
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    assert.equal(
      (await app.inject({ url: '/api/v1/session', headers: otherHeaders })).statusCode,
      401,
    );
    assert.equal(
      (await app.inject({ url: '/api/v1/session', headers: h })).json().user.mfaVerified,
      true,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/mfa/verify',
          headers: h,
          payload: { code },
        })
      ).statusCode,
      401,
    );
    if (role === 'platform_admin')
      assert.equal(
        (await app.inject({ url: '/api/v1/platform/admins', headers: h })).statusCode,
        200,
      );
    else
      assert.equal(
        (await app.inject({ url: '/api/v1/platform/admins', headers: h })).json().error.code,
        'FORBIDDEN',
      );
    const next = headers(await login(u.email));
    const recover = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/mfa/recover',
        headers: next,
        payload: { code: codes[0] },
      });
    const attempts = await Promise.all([recover(), recover()]);
    assert.deepEqual(attempts.map((r) => r.statusCode).sort(), [200, 401]);
    const hashes = (
      await db.query('SELECT code_hash,used_at FROM mfa_recovery_codes WHERE user_id=$1', [u.id])
    ).rows;
    assert.equal(hashes.filter((row) => row.used_at).length, 1);
    assert.ok(hashes.every((row) => !codes.includes(row.code_hash)));
    const events = (
      await db.query(
        "SELECT action,detail FROM audit_events WHERE actor_id=$1 AND action LIKE 'auth.mfa.%'",
        [u.id],
      )
    ).rows;
    assert.ok(events.some((event) => event.action === 'auth.mfa.enrolled'));
    assert.ok(events.some((event) => event.action === 'auth.mfa.recovered'));
    assert.ok(!JSON.stringify(events).includes(secret));
    assert.ok(codes.every((code) => !JSON.stringify(events).includes(code)));
    const wrongCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/setup',
      headers: { ...next, 'x-csrf-token': 'wrong' },
      payload: { currentPassword: password },
    });
    assert.equal(wrongCsrf.statusCode, 403);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/mfa/setup',
          headers: headers(await login(u.email)),
          payload: { currentPassword: password },
        })
      ).json().error.code,
      'MFA_REQUIRED',
    );
  }
});

test('password session lifetimes follow privilege; only active customer sessions slide and expired/promoted sessions cannot renew', async () => {
  const merchant = (
    await db.query("INSERT INTO merchants(name,slug) VALUES('TTL test',$1) RETURNING id", [
      'ttl-' + randomUUID(),
    ])
  ).rows[0].id;
  for (const role of ['platform_admin', 'owner', 'cashier', 'customer']) {
    const u = await register(role === 'platform_admin' ? role : 'customer');
    if (role === 'owner' || role === 'cashier')
      await db.query(
        'INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,$4,$4)',
        [merchant, u.id, u.email, role],
      );
    const signed = await login(u.email);
    const row = (
      await db.query(
        'SELECT id,extract(epoch from(expires_at-created_at))::integer AS ttl FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
        [u.id],
      )
    ).rows[0];
    assert.equal(
      row.ttl,
      role === 'platform_admin' ? 12 * 3600 : role === 'customer' ? 30 * 86400 : 7 * 86400,
    );
    if (role === 'customer') {
      await db.query("UPDATE sessions SET expires_at=now()+interval '1 day' WHERE id=$1", [row.id]);
      const renewed = await app.inject({ url: '/api/v1/session', headers: headers(signed) });
      assert.equal(renewed.statusCode, 200);
      assert.ok(renewed.cookies.some((cookie) => cookie.maxAge === 30 * 86400));
      assert.ok(
        (
          await db.query(
            "SELECT expires_at>now()+interval '29 days' AS renewed FROM sessions WHERE id=$1",
            [row.id],
          )
        ).rows[0].renewed,
      );
      await db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [
        row.id,
      ]);
      assert.equal(
        (await app.inject({ url: '/api/v1/session', headers: headers(signed) })).statusCode,
        401,
      );
    } else {
      await db.query(
        "UPDATE sessions SET created_at=now()-interval '8 days',expires_at=now()+interval '1 day' WHERE id=$1",
        [row.id],
      );
      assert.equal(
        (await app.inject({ url: '/api/v1/session', headers: headers(signed) })).statusCode,
        401,
      );
    }
    if (role === 'owner') {
      // A customer token minted before promotion must not become a 30-day staff session.
      await db.query("UPDATE sessions SET created_at=now()-interval '8 days' WHERE user_id=$1", [
        u.id,
      ]);
      assert.equal(
        (await app.inject({ url: '/api/v1/session', headers: u.headers })).statusCode,
        401,
      );
    }
  }
});

test('distributed password failures reach the aggregate threshold without trusting a spoofed forwarding header', async () => {
  const u = await register();
  for (let i = 0; i < 20; i++) {
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '203.0.113.' + (i + 1),
      headers: { origin, 'x-forwarded-for': '192.0.2.254' },
      payload: { email: u.email, password: 'Incorrect password phrase' },
    });
    assert.equal(result.statusCode, 401);
  }
  const guard = (
    await db.query('SELECT failures,locked_until FROM password_login_guards WHERE email=$1', [
      u.email,
    ])
  ).rows[0];
  assert.equal(guard.failures, 20);
  assert.ok(guard.locked_until > new Date());
  assert.equal((await login(u.email)).statusCode, 401);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::integer AS total FROM password_login_ip_guards WHERE email=$1',
        [u.email],
      )
    ).rows[0].total,
    21,
  );
});
