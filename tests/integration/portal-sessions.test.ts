import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { hashPassword } from '../../apps/api/src/passwords.js';
test('four portals retain separate identities in one cookie jar; cross-portal CSRF, wrong roles, public staff signup and revoked membership are rejected', async () => {
  const c = readConfig(),
    db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
  const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
  const password = 'Portal-' + randomUUID(),
    jar = new Map<string, string>();
  const keys = ['platform', 'merchant', 'cashier', 'customer'] as const;
  const people = new Map<string, { id: string; email: string }>();
  await db.connect();
  await app.ready();
  try {
    const hash = await hashPassword(password, c.AUTH_PEPPER);
    const mid = (
      await db.query('INSERT INTO merchants(slug,name) VALUES($1,$2) RETURNING id', [
        'portals-' + randomUUID().slice(0, 8),
        'Portal fixture',
      ])
    ).rows[0].id;
    for (const portal of keys) {
      const email = portal + '-' + randomUUID() + '@example.test';
      const user = (
        await db.query(
          'INSERT INTO users(email,display_name,global_role,password_hash,password_version) VALUES($1,$2,$3,$4,1) RETURNING id',
          [email, portal, portal === 'platform' ? 'platform_admin' : 'customer', hash],
        )
      ).rows[0];
      people.set(portal, { id: user.id, email });
      if (portal === 'merchant' || portal === 'cashier')
        await db.query(
          'INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,$4,$5)',
          [mid, user.id, email, portal, portal === 'merchant' ? 'owner' : 'cashier'],
        );
    }
    const request = async (
      portal: string,
      path: string,
      method = 'GET',
      payload?: Record<string, unknown>,
      csrf?: string,
    ) => {
      const result = await app.inject({
        method: method as 'GET' | 'POST',
        url: '/api/v1' + path,
        headers: {
          origin: c.PUBLIC_APP_ORIGIN,
          'x-nuqta-workspace': portal,
          cookie: [...jar].map(([k, v]) => k + '=' + v).join('; '),
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        payload,
      });
      for (const cookie of result.cookies) {
        if (!cookie.value) jar.delete(cookie.name);
        else jar.set(cookie.name, cookie.value);
      }
      return result;
    };
    for (const portal of keys) {
      // A legacy login from another role must not silently open this portal.
      assert.equal((await request(portal, '/session')).statusCode, 401);
      const r = await request(portal, '/auth/login', 'POST', {
        email: people.get(portal)!.email,
        password,
      });
      assert.equal(r.statusCode, 200, r.body);
    }
    const tokens = new Map<string, string>();
    for (const portal of keys) {
      const s = await request(portal, '/session');
      assert.equal(s.statusCode, 200, s.body);
      assert.equal(s.json().user.id, people.get(portal)!.id);
      tokens.set(portal, s.json().csrfToken);
      const direct = await app.inject({
        url: '/api/v1/session?__portal=' + portal,
        headers: { cookie: [...jar].map(([k, v]) => k + '=' + v).join('; ') },
      });
      assert.equal(direct.json().user.id, people.get(portal)!.id);
    }
    const rejected = await request('merchant', '/auth/logout', 'POST', {}, tokens.get('customer'));
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.json().error.code, 'CSRF_REJECTED');
    const logout = await request('cashier', '/auth/logout', 'POST', {}, tokens.get('cashier'));
    assert.equal(logout.statusCode, 204, logout.body);
    assert.equal((await request('cashier', '/session')).statusCode, 401);
    for (const portal of ['platform', 'merchant', 'customer'])
      assert.equal((await request(portal, '/session')).json().user.id, people.get(portal)!.id);
    const wrong = await request('cashier', '/auth/login', 'POST', {
      email: people.get('platform')!.email,
      password,
    });
    assert.equal(wrong.statusCode, 403);
    assert.equal(wrong.json().error.code, 'PORTAL_ACCESS_REQUIRED');
    const rejectedEmail = 'blocked-' + randomUUID() + '@example.test';
    const signup = await request('cashier', '/auth/register', 'POST', {
      email: rejectedEmail,
      password,
    });
    assert.equal(signup.statusCode, 403);
    assert.equal(signup.json().error.code, 'REGISTRATION_CLOSED');
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM users WHERE email=$1', [rejectedEmail]))
        .rows[0].n,
      0,
    );
    await db.query("UPDATE staff_memberships SET status='disabled' WHERE user_id=$1", [
      people.get('merchant')!.id,
    ]);
    assert.equal((await request('merchant', '/session')).statusCode, 401);
    assert.equal((await request('platform', '/session')).statusCode, 200);
    assert.equal((await request('invalid', '/session')).statusCode, 422);
    const legacy = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: c.PUBLIC_APP_ORIGIN },
      payload: { email: people.get('platform')!.email, password },
    });
    const migrated = await app.inject({
      url: '/api/v1/session',
      headers: {
        'x-nuqta-workspace': 'platform',
        cookie: legacy.cookies
          .filter((c) => c.name === 'nq_session' || c.name === 'nq_csrf')
          .map((c) => c.name + '=' + c.value)
          .join('; '),
      },
    });
    assert.equal(migrated.statusCode, 200, migrated.body);
    assert.ok(migrated.cookies.some((c) => c.name === 'nq_session_platform'));
  } finally {
    await app.close();
    await db.end();
  }
});
