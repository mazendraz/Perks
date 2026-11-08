import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { seed, ids } from '../../db/seed.js';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { transaction, type Actor } from '../../apps/api/src/db.js';
import { login } from '../helpers.js';
import { randomUUID } from 'node:crypto';
const c = readConfig(),
  admin = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const { app, pools } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
before(async () => {
  await admin.connect();
  await seed(admin);
  await app.ready();
});
after(async () => {
  await app.close();
  await admin.end();
});
const actor = (id: string): Actor => ({
  id,
  email: 'test@example.test',
  role: 'customer',
  sessionId: ids.customer,
  mfaAt: null,
  csrfHash: '',
});
test('RLS runtime is not owner/superuser/bypass; tenant and branch boundaries hold', async () => {
  const role = (
    await pools.pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
  ).rows[0];
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  const a = await transaction(
    pools.pool,
    async (db) => (await db.query('SELECT id FROM merchants')).rows,
    actor(ids.ownerA),
  );
  assert.deepEqual(
    a.map((x) => x.id),
    [ids.merchantA],
  );
  const b = await transaction(
    pools.pool,
    async (db) => (await db.query('SELECT id FROM merchants WHERE id=$1', [ids.merchantA])).rows,
    actor(ids.ownerB),
  );
  assert.equal(b.length, 0);
  const branches = await transaction(
    pools.pool,
    async (db) => (await db.query('SELECT id FROM branches')).rows,
    actor(ids.cashier),
  );
  assert.deepEqual(
    branches.map((x) => x.id),
    [ids.branchA],
  );
  assert.equal((await pools.pool.query('SELECT app_user() AS id')).rows[0].id, null);
  await assert.rejects(() =>
    transaction(
      pools.pool,
      async (db) => {
        await db.query(
          'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
          [ids.merchantA, ids.staffA, ids.branchB],
        );
      },
      actor(ids.ownerA),
    ),
  );
});
test('random expiring OTP, bounded attempts, session cookie, CSRF, logout and stale session', async () => {
  const origin = c.PUBLIC_APP_ORIGIN;
  assert.equal((await app.inject({ url: '/api/v1/session' })).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/challenges',
        payload: { email: 'owner@bunn.test' },
      })
    ).statusCode,
    403,
  );
  const challenge = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/challenges',
    headers: { origin },
    payload: { email: 'owner@bunn.test' },
  });
  assert.equal(challenge.statusCode, 202);
  const { challengeId } = challenge.json();
  const mail = (await app.inject({ url: '/api/v1/local/mail', remoteAddress: '127.0.0.1' }))
    .json()
    .messages.find((m: { id: string }) => m.id === challengeId);
  assert.match(mail.code, /^\d{6}$/);
  const wrong = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/challenges/${challengeId}/verify`,
    headers: { origin },
    payload: { code: mail.code === '000000' ? '000001' : '000000' },
  });
  assert.equal(wrong.statusCode, 401);
  assert.equal(
    (await admin.query('SELECT attempts FROM auth_challenges WHERE id=$1', [challengeId])).rows[0]
      .attempts,
    1,
  );
  const verify = await app.inject({
    method: 'POST',
    url: `/api/v1/auth/challenges/${challengeId}/verify`,
    headers: { origin },
    payload: { code: mail.code },
  });
  assert.equal(verify.statusCode, 200);
  const cookie = verify.cookies.map((x) => x.name + '=' + x.value).join('; '),
    csrf = verify.json().csrfToken;
  const session = await app.inject({ url: '/api/v1/session', headers: { cookie } });
  assert.equal(session.statusCode, 200);
  assert.equal(session.json().grants[0].merchant_id, ids.merchantA);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin, cookie } }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { origin, cookie, 'x-csrf-token': csrf },
      })
    ).statusCode,
    204,
  );
  assert.equal((await app.inject({ url: '/api/v1/session', headers: { cookie } })).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/auth/challenges/${challengeId}/verify`,
        headers: { origin },
        payload: { code: mail.code },
      })
    ).statusCode,
    401,
  );
});
test('authenticated users behind one NAT have separate limits; one user still hits a bounded quota', async () => {
  const a = await login(app, 'rate-a-' + randomUUID() + '@nuqta.test'),
    b = await login(app, 'rate-b-' + randomUUID() + '@nuqta.test');
  for (let batch = 0; batch < 8; batch++) {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        app.inject({ url: '/api/v1/session', headers: i % 2 ? a : b }),
      ),
    );
    assert.ok(results.every((r) => r.statusCode === 200));
  }
  const extra = await Promise.all(
    Array.from({ length: 150 }, () => app.inject({ url: '/api/v1/session', headers: a })),
  );
  assert.ok(extra.some((r) => r.statusCode === 429));
  assert.ok(extra.every((r) => [200, 429].includes(r.statusCode)));
});
