import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { hashPassword } from '../../apps/api/src/passwords.js';
import { seed } from '../../db/seed.js';
import { login, key } from '../helpers.js';
test('multiple super admins share the platform; account changes are audited, version fenced and cannot take over existing users or remove every active administrator', async () => {
  const c = readConfig();
  assert.match(new URL(c.DATABASE_MIGRATOR_URL!).pathname, /^\/nuqta_test_\d+$/);
  const db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
    { app, pools } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
  const password = 'Admin-' + randomUUID(),
    newPassword = 'Changed-' + randomUUID(),
    email = 'admin-a-' + randomUUID() + '@example.test',
    peerEmail = 'admin-b-' + randomUUID() + '@example.test';
  await db.connect();
  await seed(db);
  await app.ready();
  const signIn = async (address: string, pass = password, expected = 200) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: c.PUBLIC_APP_ORIGIN },
      payload: { email: address, password: pass },
    });
    assert.equal(r.statusCode, expected, r.body);
    if (expected === 200) assert.equal(r.json().portal, 'platform');
    return {
      origin: c.PUBLIC_APP_ORIGIN,
      cookie: r.cookies.map((c) => c.name + '=' + c.value).join('; '),
      'x-csrf-token': r.json().csrfToken as string,
    };
  };
  try {
    const a = (
      await db.query(
        "INSERT INTO users(email,display_name,global_role,password_hash,password_version) VALUES($1,'First administrator','platform_admin',$2,1) RETURNING id",
        [email, await hashPassword(password, c.AUTH_PEPPER)],
      )
    ).rows[0].id;
    const admin = await signIn(email),
      owner = await login(app, 'owner@bunn.test');
    assert.equal(
      (await app.inject({ url: '/api/v1/platform/admins', headers: owner })).statusCode,
      403,
    );
    assert.equal((await app.inject({ url: '/api/v1/platform/admins' })).statusCode, 401);
    await assert.rejects(
      () => pools.pool.query('SELECT platform_admin_accounts()'),
      /NQ:NOT_FOUND/,
    );
    const body = {
      name: 'Second administrator',
      email: peerEmail,
      password,
      reason: 'Share shop and support work.',
      acknowledgeFullAccess: true,
    };
    const headers = { ...admin, ...key() },
      create = () =>
        app.inject({ method: 'POST', url: '/api/v1/platform/admins', headers, payload: body });
    const made = await create();
    assert.equal(made.statusCode, 200, made.body);
    const b = made.json().account.id;
    assert.deepEqual((await create()).json(), made.json());
    assert.ok(!made.body.includes(password));
    const takeover = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/admins',
      headers: { ...admin, ...key() },
      payload: { ...body, email: 'owner@bunn.test' },
    });
    assert.equal(takeover.statusCode, 409);
    assert.equal(takeover.json().error.code, 'ADMIN_EMAIL_IN_USE');
    const peer = await signIn(peerEmail);
    const ids = async (h: typeof admin) =>
      (await app.inject({ url: '/api/v1/platform/merchants', headers: h }))
        .json()
        .merchants.map((m: { id: string }) => m.id)
        .sort();
    assert.deepEqual(await ids(peer), await ids(admin));
    const list = async () =>
      (await app.inject({ url: '/api/v1/platform/admins', headers: admin })).json();
    const accounts = await list();
    assert.ok(
      accounts.accounts.some((u: { id: string }) => u.id === a) &&
        accounts.accounts.some((u: { id: string }) => u.id === b),
    );
    assert.ok(!JSON.stringify(accounts).includes('password_hash'));
    const event = accounts.events.find(
      (e: { target_id: string; action: string }) =>
        e.target_id === b && e.action === 'platform.admin.create',
    );
    assert.equal(event.actor_name, 'First administrator');
    const command = (h: typeof admin, id: string, action: string, version: number, pw?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/platform/admins/' + id + '/security',
        headers: { ...h, ...key() },
        payload: {
          action,
          credentialVersion: version,
          reason: 'Authorized account management test.',
          acknowledgeFullAccess: true,
          ...(pw ? { password: pw } : {}),
        },
      });
    const version = async (id: string) =>
      (await db.query('SELECT password_version FROM users WHERE id=$1', [id])).rows[0]
        .password_version;
    const changed = await command(admin, b, 'password', 1, newPassword);
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal((await app.inject({ url: '/api/v1/session', headers: peer })).statusCode, 401);
    await signIn(peerEmail, password, 401);
    await signIn(peerEmail, newPassword);
    assert.equal((await command(admin, b, 'sessions', 1)).statusCode, 409);
    assert.equal((await command(admin, b, 'disable', await version(b))).statusCode, 200);
    await signIn(peerEmail, newPassword, 401);
    assert.equal((await command(admin, b, 'enable', await version(b))).statusCode, 200);
    const restored = await signIn(peerEmail, newPassword);
    assert.equal((await command(admin, b, 'sessions', await version(b))).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/v1/session', headers: restored })).statusCode, 401);
    assert.equal(
      (await command(admin, a, 'sessions', await version(a))).json().error.code,
      'ADMIN_SELF_MANAGEMENT',
    );
    const others = (
      await db.query(
        "SELECT id FROM users WHERE global_role='platform_admin' AND status='active' AND id<>$1",
        [a],
      )
    ).rows.map((r) => r.id);
    await db.query("UPDATE users SET status='disabled' WHERE id=ANY($1::uuid[])", [others]);
    try {
      const last = await command(admin, a, 'disable', await version(a));
      assert.equal(last.statusCode, 409);
      assert.equal(last.json().error.code, 'LAST_PLATFORM_ADMIN');
    } finally {
      await db.query("UPDATE users SET status='active' WHERE id=ANY($1::uuid[])", [others]);
    }
    const peerAgain = await signIn(peerEmail, newPassword),
      av = await version(a),
      bv = await version(b);
    const races = await Promise.all([
      command(admin, b, 'disable', bv),
      command(peerAgain, a, 'disable', av),
    ]);
    assert.equal(races.filter((r) => r.statusCode === 200).length, 1);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM users WHERE id=ANY($1::uuid[]) AND status='active'",
          [[a, b]],
        )
      ).rows[0].n,
      1,
    );
    const persisted = JSON.stringify(
      (
        await db.query(
          "SELECT result FROM operations WHERE scope LIKE 'platform.admin.%' AND actor_id=ANY($1::uuid[])",
          [[a, b]],
        )
      ).rows,
    );
    assert.ok(!persisted.includes(password) && !persisted.includes(newPassword));
  } finally {
    await app.close();
    await db.end();
  }
});
