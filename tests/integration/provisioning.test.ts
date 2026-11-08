import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { adminLogin, key, login } from '../helpers.js';
import { unseal } from '../../apps/api/src/outbox.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let pa: Awaited<ReturnType<typeof login>>;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  pa = await adminLogin(app, db);
});
after(async () => {
  await app.close();
  await db.end();
});
test('non-admin cannot provision; admin must prove MFA', async () => {
  const owner = await login(app, 'owner@bunn.test');
  assert.equal(
    (await app.inject({ url: '/api/v1/platform/provisioning-drafts', headers: owner })).statusCode,
    403,
  );
  const adminNoMfa = await login(app, 'admin@nuqta.test');
  assert.equal(
    (await app.inject({ url: '/api/v1/platform/provisioning-drafts', headers: adminNoMfa }))
      .statusCode,
    403,
  );
});
test('draft revision and concurrent activation create one merchant, program, invitation set and outbox', async () => {
  const slug = 'test-' + randomUUID().slice(0, 8),
    ownerEmail = slug + '@example.test',
    cashEmail = 'cash-' + slug + '@example.test';
  const data = {
    name: 'قهوة الاختبار',
    slug,
    contactEmail: ownerEmail,
    timezone: 'Africa/Cairo',
    primaryColor: '#6F3F22',
    accentColor: '#E2A85B',
    surfaceColor: '#FBF5EE',
    template: 'classic',
    terms: 'شروط الاختبار محفوظة للعميل.',
    program: {
      name: 'قهوتك علينا',
      threshold: 5,
      maxPerTx: 3,
      rewardTitle: 'قهوة مجانية',
      rewardTerms: 'صالحة30يوم من الكسب.',
      validityDays: 30,
      endsAt: null,
    },
    branches: [
      { name: 'الفرع الأول', address: '' },
      { name: 'الفرع التاني', address: '' },
    ],
    staff: [
      { email: ownerEmail, role: 'owner', branchIndexes: [0, 1], maxQty: 3 },
      { email: cashEmail, role: 'cashier', branchIndexes: [0], maxQty: 2 },
    ],
    plan: 'growth',
  };
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/provisioning-drafts',
    headers: { ...pa, ...key() },
    payload: { data },
  });
  assert.equal(created.statusCode, 200);
  const draft = created.json().draft;
  const update = await app.inject({
    method: 'PATCH',
    url: '/api/v1/platform/provisioning-drafts/' + draft.id,
    headers: { ...pa, 'if-match': '1' },
    payload: { data },
  });
  assert.equal(update.statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/v1/platform/provisioning-drafts/' + draft.id,
        headers: { ...pa, 'if-match': '1' },
        payload: { data },
      })
    ).statusCode,
    409,
  );
  const results = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: 'POST',
        url: '/api/v1/platform/provisioning-drafts/' + draft.id + '/activate',
        headers: { ...pa, ...key() },
        payload: { draftRevision: 2 },
      }),
    ),
  );
  assert.deepEqual(
    results.map((r) => r.statusCode),
    [200, 200],
  );
  const first = results[0]!.json(),
    second = results[1]!.json();
  assert.equal(first.merchant.id, second.merchant.id);
  assert.equal(first.operationId, second.operationId);
  assert.equal(
    Number((await db.query('SELECT count(*) FROM merchants WHERE slug=$1', [slug])).rows[0].count),
    1,
  );
  assert.equal(
    Number(
      (await db.query('SELECT count(*) FROM invitations WHERE merchant_id=$1', [first.merchant.id]))
        .rows[0].count,
    ),
    2,
  );
  assert.equal(
    Number(
      (
        await db.query('SELECT count(*) FROM outbox_events WHERE merchant_id=$1', [
          first.merchant.id,
        ])
      ).rows[0].count,
    ),
    2,
  );
  const invite = (
    await db.query("SELECT * FROM outbox_events WHERE merchant_id=$1 AND payload->>'email'=$2", [
      first.merchant.id,
      cashEmail,
    ])
  ).rows[0];
  const token = unseal(invite.payload.encryptedToken, c.AUTH_PEPPER);
  const cash = await login(app, cashEmail),
    foreign = await login(app, 'owner@lamsa.test');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/invitations/' + token + '/accept',
        headers: foreign,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/invitations/' + token + '/accept',
        headers: cash,
      })
    ).statusCode,
    200,
  );
  const session = (await app.inject({ url: '/api/v1/session', headers: cash })).json();
  assert.equal(session.grants[0].branches.length, 1);
  assert.equal(session.grants[0].branches[0].id, first.branches[0].id);
  const again = await app.inject({
    method: 'POST',
    url: '/api/v1/invitations/' + token + '/accept',
    headers: cash,
  });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().alreadyAccepted, true);
  const publicData = (await app.inject({ url: '/api/v1/public/merchants/' + slug })).json();
  assert.equal(publicData.programs[0].threshold, 5);
  assert.ok(!JSON.stringify(publicData).includes(ownerEmail));
  const ownerEvent = (
    await db.query(
      "SELECT payload FROM outbox_events WHERE merchant_id=$1 AND payload->>'email'=$2",
      [first.merchant.id, ownerEmail],
    )
  ).rows[0];
  const owner = await login(app, ownerEmail);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/invitations/' +
          unseal(ownerEvent.payload.encryptedToken, c.AUTH_PEPPER) +
          '/accept',
        headers: owner,
      })
    ).statusCode,
    200,
  );
  const inviteEmail = 'rotate-' + randomUUID() + '@nuqta.test',
    base = '/api/v1/merchants/' + first.merchant.id;
  const createdInvitation = await app.inject({
    method: 'POST',
    url: base + '/invitations',
    headers: { ...owner, ...key() },
    payload: { email: inviteEmail, role: 'cashier', branchIds: [first.branches[0].id], maxQty: 2 },
  });
  assert.equal(createdInvitation.statusCode, 200);
  const inviteId = createdInvitation.json().invitation.id;
  const initial = (
    await db.query(
      'SELECT payload FROM outbox_events WHERE aggregate_id=$1 ORDER BY aggregate_revision DESC LIMIT 1',
      [inviteId],
    )
  ).rows[0];
  const initialToken = unseal(initial.payload.encryptedToken, c.AUTH_PEPPER),
    invited = await login(app, inviteEmail);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: base + '/invitations/' + inviteId + '/resend',
        headers: { ...owner, ...key() },
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/invitations/' + initialToken + '/accept',
        headers: invited,
      })
    ).statusCode,
    404,
  );
  const rotated = (
    await db.query(
      'SELECT payload FROM outbox_events WHERE aggregate_id=$1 ORDER BY aggregate_revision DESC LIMIT 1',
      [inviteId],
    )
  ).rows[0];
  assert.equal(
    (await app.inject({ method: 'DELETE', url: base + '/invitations/' + inviteId, headers: owner }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/invitations/' +
          unseal(rotated.payload.encryptedToken, c.AUTH_PEPPER) +
          '/accept',
        headers: invited,
      })
    ).statusCode,
    404,
  );
});
test('program version rows and committed operation receipts are immutable', async () => {
  await assert.rejects(
    () =>
      db.query('UPDATE program_versions SET threshold=10 WHERE id=$1', [
        '50000000-0000-4000-8000-000000000001',
      ]),
    /immutable/,
  );
  const op = (await db.query('SELECT id FROM operations LIMIT 1')).rows[0];
  if (op)
    await assert.rejects(
      () => db.query('UPDATE operations SET result=$1 WHERE id=$2', [{}, op.id]),
      /immutable/,
    );
  const owner = await login(app, 'owner@bunn.test');
  const foreignInvite = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/invitations',
    headers: { ...owner, ...key() },
    payload: {
      email: 'foreignbranch@example.test',
      role: 'cashier',
      branchIds: [ids.branchB],
      maxQty: 1,
    },
  });
  assert.equal(foreignInvite.statusCode, 403);
});
