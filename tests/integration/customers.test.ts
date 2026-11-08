import { enrollmentTerms } from '../helpers.js';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { login, key } from '../helpers.js';
import { runOne } from '../../apps/worker/src/runner.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let owner: Awaited<ReturnType<typeof login>>,
  other: typeof owner,
  manager: typeof owner,
  ca: typeof owner,
  profile: string,
  staffId: string;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  owner = await login(app, 'owner@bunn.test');
  other = await login(app, 'owner@lamsa.test');
  ca = await login(app, 'cashier@bunn.test');
  const cu = await login(app, 'directory-' + randomUUID() + '@nuqta.test');
  const enrolled = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...cu, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: '40000000-0000-4000-8000-000000000001',
      programVersionId: '50000000-0000-4000-8000-000000000001',
      alias: '=SUM(1,2)',
      acceptedTerms: true,
      acceptedTermsHash: await enrollmentTerms(app, '40000000-0000-4000-8000-000000000001'),
      branchId: ids.branchA2,
    },
  });
  assert.equal(enrolled.statusCode, 200);
  profile = (
    await db.query('SELECT profile_id FROM memberships WHERE id=$1', [enrolled.json().membershipId])
  ).rows[0].profile_id;
  const email = 'manager-' + randomUUID() + '@nuqta.test';
  manager = await login(app, email);
  const user = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  staffId = (
    await db.query(
      "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role,max_qty) VALUES($1,$2,$3,'Scoped manager','manager',3) RETURNING id",
      [ids.merchantA, user, email],
    )
  ).rows[0].id;
  await db.query(
    'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
    [ids.merchantA, staffId, ids.branchA],
  );
});
after(async () => {
  await app.close();
  await db.end();
  await worker.end();
});
const base = '/api/v1/merchants/' + ids.merchantA;
test('directory separates never-active customers and enforces branch/customer scope and explicit export permission', async () => {
  const list = await app.inject({ url: base + '/customers?segment=never_active', headers: owner });
  assert.equal(list.statusCode, 200);
  assert.ok(list.json().customers.some((x: { id: string }) => x.id === profile));
  assert.equal(
    (await app.inject({ url: base + '/customers/' + profile, headers: other })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: base + '/customers/' + profile, headers: manager })).statusCode,
    404,
  );
  await db.query("UPDATE staff_memberships SET role='owner' WHERE id=$1", [staffId]);
  assert.equal(
    (await app.inject({ url: base + '/customers/' + profile, headers: manager })).statusCode,
    404,
  );
  await db.query("UPDATE staff_memberships SET role='manager' WHERE id=$1", [staffId]);
  assert.equal(
    (
      await app.inject({
        url: base + '/customers/' + profile + '?branchId=' + ids.branchA,
        headers: owner,
      })
    ).statusCode,
    404,
  );
  assert.equal((await app.inject({ url: base + '/customers', headers: ca })).statusCode, 403);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: base + '/customer-exports',
        headers: { ...manager, ...key() },
        payload: {},
      })
    ).statusCode,
    403,
  );
  const searched = await app.inject({
    url: base + '/customers?query=' + encodeURIComponent('SUM(1,2)'),
    headers: owner,
  });
  assert.equal(searched.statusCode, 200);
  assert.equal(searched.json().customers.length, 1);
  assert.equal(
    (
      await app.inject({
        url: base + '/customers?query=' + encodeURIComponent("' OR 1=1--"),
        headers: owner,
      })
    ).json().customers.length,
    0,
  );
  assert.equal(
    (
      await app.inject({
        url: base + '/customers?query=' + encodeURIComponent('SUM(1,2)'),
        headers: manager,
      })
    ).json().customers.length,
    0,
  );
});
test('private export is asynchronous, formula-safe, tenant scoped, replayable and reauthorizes the downloader', async () => {
  const k = key(),
    r = await app.inject({
      method: 'POST',
      url: base + '/customer-exports',
      headers: { ...owner, ...k },
      payload: { segment: 'never_active' },
    });
  assert.equal(r.statusCode, 200);
  const id = r.json().export.id;
  const again = await app.inject({
    method: 'POST',
    url: base + '/customer-exports',
    headers: { ...owner, ...k },
    payload: { segment: 'never_active' },
  });
  assert.equal(again.json().export.id, id);
  for (let i = 0; i < 100 && (await runOne(worker, c)); i++) {
    /* Process local jobs. */
  }
  const state = (await db.query('SELECT * FROM customer_exports WHERE id=$1', [id])).rows[0];
  assert.equal(state.status, 'ready');
  const file = await app.inject({
    url: base + '/customer-exports/' + id + '/download',
    headers: owner,
  });
  assert.equal(file.statusCode, 200);
  assert.match(file.body, /'=SUM\(1,2\)/);
  assert.ok(!file.body.includes('owner@lamsa.test'));
  const queued = await app.inject({
    method: 'POST',
    url: base + '/customer-exports',
    headers: { ...owner, ...key() },
    payload: { segment: 'never_active' },
  });
  assert.equal(queued.statusCode, 200);
  const queuedId = queued.json().export.id;
  await db.query('DELETE FROM staff_branch_grants WHERE staff_id=$1 AND branch_id=$2', [
    ids.staffA,
    ids.branchA2,
  ]);
  try {
    const denied = await app.inject({
      url: base + '/customer-exports/' + id + '/download',
      headers: owner,
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error.code, 'EXPORT_SCOPE_CHANGED');
    const list = (await app.inject({ url: base + '/customer-exports', headers: owner })).json()
      .exports;
    assert.equal(list.find((e: { id: string }) => e.id === id).status, 'scope_changed');
    await db.query("UPDATE branches SET status='disabled' WHERE id=$1", [ids.branchA2]);
    assert.equal(
      (
        await app.inject({
          url: base + '/customers?query=' + encodeURIComponent('SUM(1,2)'),
          headers: owner,
        })
      ).json().customers.length,
      0,
    );
    for (let i = 0; i < 100 && (await runOne(worker, c)); i++) {
      /* Reauthorize queued exports with the changed scope. */
    }
    const blocked = (
      await db.query('SELECT status,error_code FROM customer_exports WHERE id=$1', [queuedId])
    ).rows[0];
    assert.equal(blocked.status, 'failed');
    assert.equal(blocked.error_code, 'EXPORT_SCOPE_CHANGED');
  } finally {
    await db.query("UPDATE branches SET status='active' WHERE id=$1", [ids.branchA2]);
    await db.query(
      'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [ids.merchantA, ids.staffA, ids.branchA2],
    );
  }
  assert.equal(
    (await app.inject({ url: base + '/customer-exports/' + id + '/download', headers: owner }))
      .statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: base + '/customer-exports/' + id + '/download', headers: other }))
      .statusCode,
    404,
  );
  await db.query("UPDATE staff_memberships SET status='disabled' WHERE id=$1", [ids.staffA]);
  assert.equal(
    (await app.inject({ url: base + '/customer-exports/' + id + '/download', headers: owner }))
      .statusCode,
    404,
  );
  await db.query("UPDATE staff_memberships SET status='active' WHERE id=$1", [ids.staffA]);
  await db.query("UPDATE customer_exports SET expires_at=now()-interval '1 second' WHERE id=$1", [
    id,
  ]);
  assert.equal(
    (await app.inject({ url: base + '/customer-exports/' + id + '/download', headers: owner }))
      .statusCode,
    404,
  );
});

test('customer detail filters individual memberships to branch attribution and preserves tenant-wide owner access', async () => {
  const user = (
    await db.query('SELECT user_id FROM tenant_customer_profiles WHERE id=$1', [profile])
  ).rows[0].user_id;
  const programId = randomUUID(),
    versionId = randomUUID(),
    membershipId = randomUUID();
  await db.query("INSERT INTO programs(id,merchant_id,name) VALUES($1,$2,'Visible program')", [
    programId,
    ids.merchantA,
  ]);
  await db.query(
    "INSERT INTO program_versions(id,merchant_id,program_id,version,threshold,max_per_tx,reward_title,reward_terms,validity_days) VALUES($1,$2,$3,1,5,3,'Visible reward','Fixture reward terms',30)",
    [versionId, ids.merchantA, programId],
  );
  await db.query(
    'INSERT INTO memberships(id,merchant_id,profile_id,user_id,program_id,program_version_id,origin_branch_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [membershipId, ids.merchantA, profile, user, programId, versionId, ids.branchA],
  );
  await db.query(
    'INSERT INTO loyalty_accounts(membership_id,merchant_id,program_version_id) VALUES($1,$2,$3)',
    [membershipId, ids.merchantA, versionId],
  );
  const narrow = await app.inject({ url: base + '/customers/' + profile, headers: manager });
  assert.equal(narrow.statusCode, 200);
  assert.deepEqual(
    narrow.json().memberships.map((m: { id: string }) => m.id),
    [membershipId],
  );
  const full = await app.inject({ url: base + '/customers/' + profile, headers: owner });
  assert.equal(full.statusCode, 200);
  assert.equal(full.json().memberships.length, 2);
  const scopedOwner = await app.inject({
    url: base + '/customers/' + profile + '?branchId=' + ids.branchA,
    headers: owner,
  });
  assert.deepEqual(
    scopedOwner.json().memberships.map((m: { id: string }) => m.id),
    [membershipId],
  );
});
