import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { createPools, transaction } from '../../apps/api/src/db.js';
import { seed, ids } from '../../db/seed.js';
import { adminLogin, login } from '../helpers.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let admin: Awaited<ReturnType<typeof login>>, owner: typeof admin;
const selectedStaffId = '00000000-0000-4000-8000-000000000010';
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  admin = await adminLogin(app, db);
  owner = await login(app, 'owner@bunn.test');
  // Multiple owners may have different branch grants. Deliberately select a
  // second owner so the comparison cannot accidentally use the seed owner.
  const email = 'preview-owner-' + randomUUID() + '@nuqta.test';
  await login(app, email);
  const uid = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  await db.query(
    "INSERT INTO staff_memberships(id,merchant_id,user_id,email,name,role) VALUES($1,$2,$3,$4,'Preview scope fixture','owner')",
    [selectedStaffId, ids.merchantA, uid, email],
  );
  await db.query(
    'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
    [ids.merchantA, selectedStaffId, ids.branchA],
  );
});
after(async () => {
  await app.close();
  await db.end();
});

test('owner preview reads the actual owner scope, never changes sessions, rejects writes and other tenants, and rechecks owner status', async () => {
  const endpoint = '/api/v1/platform/merchants/' + ids.merchantA + '/owner-preview';
  assert.equal((await app.inject({ url: endpoint, headers: owner })).statusCode, 403);
  assert.equal((await app.inject({ url: endpoint })).statusCode, 401);
  const opened = await app.inject({ url: endpoint, headers: admin });
  assert.equal(opened.statusCode, 200, opened.body);
  const context = opened.json(),
    base = '/api/v1/merchants/' + ids.merchantA;
  const header = { ...admin, 'x-nuqta-owner-preview': ids.merchantA + ':' + context.grant.id };
  assert.equal(context.readOnly, true);
  assert.equal(context.grant.role, 'owner');
  assert.equal(context.grant.id, selectedStaffId);
  owner = await login(app, context.owner.email);
  const foreignOwner = (
    await app.inject({
      url: '/api/v1/platform/merchants/' + ids.merchantB + '/owner-preview',
      headers: admin,
    })
  ).json();
  assert.equal(
    (
      await app.inject({
        url: base,
        headers: { ...admin, 'x-nuqta-owner-preview': ids.merchantA + ':' + foreignOwner.grant.id },
      })
    ).statusCode,
    409,
  );
  assert.ok(!/password_hash|csrf|token_hash/.test(opened.body));
  for (const suffix of [
    '',
    '/overview',
    '/programs',
    '/staff',
    '/transactions',
    '/corrections',
    '/branches',
    '/customers',
    '/customer-outreach',
    '/segments',
    '/placements',
    '/account-security',
    '/customer-exports',
  ]) {
    const actual = await app.inject({ url: base + suffix, headers: owner });
    const preview = await app.inject({ url: base + suffix, headers: header });
    assert.equal(preview.statusCode, 200, suffix + ': ' + preview.body);
    const a = actual.json(),
      p = preview.json();
    delete a.updatedAt;
    delete p.updatedAt;
    if (suffix === '/overview') {
      delete a.period.from;
      delete a.period.to;
      delete p.period.from;
      delete p.period.to;
    }
    assert.deepEqual(p, a, suffix);
  }
  assert.equal(
    (
      await app.inject({
        url: '/api/v1/support/tickets?merchantId=' + ids.merchantA,
        headers: header,
      })
    ).statusCode,
    200,
  );
  for (const url of [
    '/api/v1/merchants/' + ids.merchantB,
    '/api/v1/session',
    '/api/v1/platform/health',
    '/api/v1/support/tickets',
    '/api/v1/support/tickets?merchantId=' + ids.merchantB,
  ])
    assert.equal((await app.inject({ url, headers: header })).statusCode, 403, url);
  const denied = await app.inject({
    method: 'PATCH',
    url: base + '/branding',
    headers: { ...header, 'if-match': '1' },
    payload: {},
  });
  assert.equal(denied.statusCode, 403, denied.body);
  assert.equal(denied.json().error.code, 'OWNER_PREVIEW_READ_ONLY');
  assert.equal(
    (
      await app.inject({
        url: base,
        headers: { ...owner, 'x-nuqta-owner-preview': header['x-nuqta-owner-preview'] },
      })
    ).statusCode,
    403,
  );
  const session = (await app.inject({ url: '/api/v1/session', headers: admin })).json();
  assert.equal(session.user.role, 'platform_admin');
  assert.notEqual(session.user.id, context.owner.id);
  const event = (
    await db.query(
      "SELECT actor_id,target_id,detail FROM audit_events WHERE merchant_id=$1 AND action='merchant.owner_preview' ORDER BY at DESC LIMIT 1",
      [ids.merchantA],
    )
  ).rows[0];
  assert.equal(event.actor_id, session.user.id);
  assert.equal(event.target_id, context.grant.id);
  assert.deepEqual(event.detail, { readOnly: true });
  await db.query("UPDATE staff_memberships SET status='disabled' WHERE id=$1", [context.grant.id]);
  try {
    assert.equal((await app.inject({ url: base, headers: header })).statusCode, 409);
  } finally {
    await db.query("UPDATE staff_memberships SET status='active' WHERE id=$1", [context.grant.id]);
  }

  // Even an accidentally added write in an allowed GET cannot commit as the owner.
  const pools = createPools(c);
  try {
    await assert.rejects(
      () =>
        transaction(
          pools.pool,
          async (tx) => {
            await tx.query('UPDATE merchants SET revision=revision+1 WHERE id=$1', [ids.merchantA]);
          },
          {
            id: context.owner.id,
            email: context.owner.email,
            role: 'customer',
            sessionId: '00000000-0000-4000-8000-000000000001',
            csrfHash: '',
            mfaAt: null,
            preview: {
              adminId: session.user.id,
              merchantId: ids.merchantA,
              staffId: context.grant.id,
            },
          },
        ),
      (error: unknown) => (error as { code: string }).code === 'OWNER_PREVIEW_READ_ONLY',
    );
  } finally {
    await pools.pool.end();
    await pools.authPool.end();
  }
});
