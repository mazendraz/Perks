import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed, ids } from '../../db/seed.js';
import { login, key, enrollmentTerms } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';
import { LocalDiskStore } from '../../apps/api/src/storage/file-store.js';
import { cleanupExports } from '../../apps/worker/src/export-cleanup.js';
import { exportPrivacyManifest, applyPrivacyManifest } from '../../tools/privacy-manifest.js';
const c = readConfig(),
  origin = 'https://privacy-fixture.nuqta.test',
  root = resolve('.local/privacy-' + randomUUID());
const db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  runtime = new pg.Client({ connectionString: c.DATABASE_URL }),
  worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL }),
  files = new LocalDiskStore(root);
const { app } = await buildApp({
  APP_ENV: 'test',
  COOKIE_SECURE: 'true',
  PUBLIC_APP_ORIGIN: origin,
  STORAGE_ROOT: root,
  LOG_LEVEL: 'silent',
});
type Result = Awaited<ReturnType<typeof app.inject>>;
const cookies = (r: Result) => r.cookies.map((v) => v.name + '=' + v.value).join('; ');
let owner: Awaited<ReturnType<typeof login>>;
before(async () => {
  await mkdir(root, { recursive: true });
  await db.connect();
  await runtime.connect();
  await seed(db);
  await app.ready();
  owner = await login(app, 'owner@bunn.test', origin);
});
after(async () => {
  await app.close();
  await runtime.end();
  await worker.end();
  await db.end();
});
async function boot() {
  const r = await app.inject('/api/v1/customer/bootstrap');
  assert.equal(r.statusCode, 200);
  return {
    origin,
    cookie: cookies(r),
    'x-csrf-token': r.json().csrfToken,
    'x-nuqta-workspace': 'customer',
  };
}
async function enrollment(
  mid = ids.merchantA,
  pid = '40000000-0000-4000-8000-000000000001',
  bid = ids.branchA,
) {
  const notice = (await app.inject('/api/v1/public/legal?lang=en')).json();
  const version =
    pid === '40000000-0000-4000-8000-000000000001'
      ? '50000000-0000-4000-8000-000000000001'
      : '50000000-0000-4000-8000-000000000002';
  return {
    merchantId: mid,
    programId: pid,
    programVersionId: version,
    branchId: bid,
    acceptedTerms: true,
    acceptedTermsHash: await enrollmentTerms(app, pid),
    acceptedPrivacyVersion: notice.acceptance.version,
    acceptedPrivacyHash: notice.acceptance.hash,
    acceptedPrivacyLocale: 'en',
  };
}
async function customer(
  phone = '+2015' + String(randomBytes(4).readUInt32BE()).padStart(10, '0').slice(-8),
) {
  const anonymous = await boot(),
    payload = { ...(await enrollment()), displayName: 'Synthetic privacy holder', phone };
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/customer/register',
    headers: anonymous,
    remoteAddress: '2001:db8:' + randomBytes(12).toString('hex').match(/.{4}/g)!.join(':'),
    payload,
  });
  assert.equal(r.statusCode, 200, r.body);
  const headers = {
    origin,
    cookie: cookies(r),
    'x-csrf-token': r.json().csrfToken,
    'x-nuqta-workspace': 'customer',
  };
  const session = (await app.inject({ url: '/api/v1/session', headers })).json();
  return {
    uid: session.user.id as string,
    member: r.json().membershipId as string,
    headers,
    anonymous,
    payload,
    device: r.cookies.find((v) => v.name === '__Host-nq_device')!.value,
  };
}
const remove = (u: Awaited<ReturnType<typeof customer>>, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/me/privacy/delete',
    headers: { ...u.headers, ...key() },
    payload: { confirmed: true, ...extra },
  });
async function proof(u: Awaited<ReturnType<typeof customer>>) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships/' + u.member + '/presentation-tokens',
    headers: { ...u.headers, ...key() },
    payload: {},
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().token as string;
}
async function recovery(u: Awaited<ReturnType<typeof customer>>) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/customer-recovery',
    headers: { ...owner, ...key() },
    payload: { customerId: u.uid, branchId: ids.branchA, requestedByCustomer: true },
  });
  assert.equal(r.statusCode, 200, r.body);
  return new URL(r.json().url).searchParams.get('text')!.match(/\/r\/([a-f0-9]{64})/)![1]!;
}
test('deletion is customer-device only, requires confirmation/CSRF/Origin, and cannot target another identity', async () => {
  const a = await customer(),
    b = await customer();
  const mutate = (headers: Record<string, string>, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/me/privacy/delete',
      headers: { ...headers, ...key() },
      payload,
    });
  assert.equal(
    (await mutate({ ...a.headers, 'x-csrf-token': '' }, { confirmed: true })).statusCode,
    403,
  );
  assert.equal(
    (await mutate({ ...a.headers, origin: 'https://evil.example.test' }, { confirmed: true }))
      .statusCode,
    403,
  );
  assert.equal((await mutate(a.headers, { confirmed: false })).statusCode, 422);
  assert.equal((await remove(a, { customerId: b.uid })).statusCode, 422);
  assert.equal((await mutate(owner, { confirmed: true })).statusCode, 403);
  await runtime.query('BEGIN');
  try {
    await runtime.query("SELECT set_config('app.user_id',$1,true)", [a.uid]);
    const sid = (
      await db.query('SELECT id FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [
        b.uid,
      ])
    ).rows[0].id;
    await assert.rejects(
      () => runtime.query('SELECT delete_customer_identity($1)', [sid]),
      /NQ:UNAUTHENTICATED/,
    );
  } finally {
    await runtime.query('ROLLBACK');
  }
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM users WHERE id=ANY($1::uuid[]) AND privacy_deleted_at IS NOT NULL',
        [[a.uid, b.uid]],
      )
    ).rows[0].n,
    0,
  );
  assert.deepEqual((await app.inject('/api/v1/customer/deletion-status')).json(), {
    deleted: false,
  });
});

test('deletion removes PII across shops, revokes credentials/QR/recovery/exports, preserves exact financial rows and allows a genuinely new card', async () => {
  const u = await customer(),
    token = await proof(u),
    link = await recovery(u);
  const second = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...u.headers, ...key() },
    payload: {
      ...(await enrollment(ids.merchantB, '40000000-0000-4000-8000-000000000002', ids.branchB)),
      alias: 'Synthetic privacy holder',
    },
  });
  assert.equal(second.statusCode, 200, second.body);
  const awarded = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/stamp-awards',
    headers: { ...owner, ...key() },
    payload: {
      branchId: ids.branchA,
      membershipId: u.member,
      quantity: 2,
      purchaseReference: { reference: randomUUID(), businessDate: businessDate('Africa/Cairo') },
      presentationContext: token,
    },
  });
  assert.equal(awarded.statusCode, 200, awarded.body);
  const financial = async () => {
    const result: Record<string, unknown> = {};
    for (const table of [
      'ledger_entries',
      'loyalty_transactions',
      'loyalty_accounts',
      'reward_grants',
      'terms_acceptances',
    ])
      result[table] = (
        await db.query(
          `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY membership_id),'[]') AS value FROM ${table} t WHERE membership_id IN(SELECT id FROM memberships WHERE user_id=$1)`,
          [u.uid],
        )
      ).rows[0].value;
    return result;
  };
  const before = await financial();
  const exportId = randomUUID(),
    lease = randomUUID(),
    storageKey = ids.merchantA + '/' + lease + '.csv';
  await files.put(
    'exports/' + storageKey,
    Buffer.from('Synthetic privacy holder,' + u.payload.phone),
    { contentType: 'text/csv' },
  );
  await db.query('BEGIN');
  try {
    await db.query("SELECT set_config('app.user_id',$1,true)", [ids.ownerA]);
    await db.query(
      "INSERT INTO customer_exports(id,merchant_id,requested_by,segment,status,storage_key,scope_fingerprint) VALUES($1,$2,$3,'all','ready',$4,customer_scope_fingerprint($2,NULL))",
      [exportId, ids.merchantA, ids.ownerA, storageKey],
    );
    await db.query(
      'INSERT INTO customer_export_artifacts(storage_key,merchant_id,export_id,lease_id) VALUES($1,$2,$3,$4)',
      [storageKey, ids.merchantA, exportId, lease],
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
  const download =
    '/api/v1/merchants/' + ids.merchantA + '/customer-exports/' + exportId + '/download';
  assert.equal((await app.inject({ url: download, headers: owner })).statusCode, 200);
  const deleted = await remove(u);
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(deleted.json().deleted, true);
  assert.deepEqual(await financial(), before);
  const profile = (
    await db.query(
      'SELECT alias,contact_email,contact_phone FROM tenant_customer_profiles WHERE user_id=$1',
      [u.uid],
    )
  ).rows;
  assert.equal(profile.length, 2);
  assert.ok(
    profile.every((p) => p.alias === '—' && p.contact_email === '' && p.contact_phone === ''),
  );
  const user = (
    await db.query(
      'SELECT email,display_name,password_hash,status,privacy_deleted_at FROM users WHERE id=$1',
      [u.uid],
    )
  ).rows[0];
  assert.equal(user.email, null);
  assert.equal(user.display_name, '—');
  assert.equal(user.password_hash, null);
  assert.equal(user.status, 'disabled');
  assert.ok(user.privacy_deleted_at);
  assert.equal(
    (await db.query('SELECT phone_e164 FROM customer_identities WHERE customer_id=$1', [u.uid]))
      .rows[0].phone_e164,
    null,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM customer_devices WHERE customer_id=$1 AND revoked_at IS NULL',
        [u.uid],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL',
        [u.uid],
      )
    ).rows[0].n,
    0,
  );
  assert.equal((await app.inject({ url: '/api/v1/session', headers: u.headers })).statusCode, 401);
  assert.equal((await app.inject('/api/v1/customer/recoveries/' + link)).statusCode, 410);
  assert.equal((await app.inject({ url: download, headers: owner })).statusCode, 404);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/merchants/' + ids.merchantA + '/stamp-awards',
        headers: { ...owner, ...key() },
        payload: {
          branchId: ids.branchA,
          membershipId: u.member,
          quantity: 1,
          purchaseReference: {
            reference: randomUUID(),
            businessDate: businessDate('Africa/Cairo'),
          },
          presentationContext: token,
        },
      })
    ).statusCode,
    403,
  );
  const receipt = deleted.cookies.find((v) => v.name === '__Host-nq_deleted')!;
  assert.ok(receipt.secure && receipt.httpOnly && receipt.maxAge === 600);
  for (const value of ['__Host-nq_deleted=' + receipt.value, '__Host-nq_device=' + u.device])
    assert.deepEqual(
      (
        await app.inject({ url: '/api/v1/customer/deletion-status', headers: { cookie: value } })
      ).json(),
      { deleted: true },
    );
  assert.equal(
    (
      await app.inject({
        url: '/api/v1/session',
        headers: { cookie: '__Host-nq_deleted=' + receipt.value, 'x-nuqta-workspace': 'customer' },
      })
    ).statusCode,
    401,
  );
  assert.equal((await cleanupExports(worker, files)).removed, 1);
  assert.equal(await files.stat('exports/' + storageKey), null);
  const fresh = await customer(u.payload.phone);
  assert.notEqual(fresh.uid, u.uid);
  assert.notEqual(fresh.member, u.member);
  assert.deepEqual(
    (
      await app.inject({
        url: '/api/v1/customer/deletion-status',
        headers: {
          cookie: fresh.headers.cookie + '; __Host-nq_deleted=' + receipt.value,
          'x-nuqta-workspace': 'customer',
        },
      })
    ).json(),
    { deleted: false },
  );
  assert.equal(
    (await db.query('SELECT balance FROM loyalty_accounts WHERE membership_id=$1', [fresh.member]))
      .rows[0].balance,
    0,
  );
});

async function waiters(pid: number, count: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (
      (
        await db.query(
          'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',
          [pid],
        )
      ).rows[0].n >= count
    )
      return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('Expected lifecycle lock waiters did not arrive.');
}
test('a queued mutation rechecks revocation after deletion instead of recreating a membership', async () => {
  const u = await customer(),
    lock = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
  await lock.connect();
  let deletion: Promise<Result> | undefined, join: Promise<Result> | undefined;
  try {
    await lock.query('BEGIN');
    const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'customer-lifecycle:' + u.uid,
    ]);
    deletion = remove(u);
    await waiters(pid, 1);
    join = app.inject({
      method: 'POST',
      url: '/api/v1/me/memberships',
      headers: { ...u.headers, ...key() },
      payload: {
        ...(await enrollment(ids.merchantB, '40000000-0000-4000-8000-000000000002', ids.branchB)),
        alias: 'Late join',
      },
    });
    await waiters(pid, 2);
    await lock.query('COMMIT');
    assert.equal((await deletion).statusCode, 200);
    assert.equal((await join).statusCode, 401);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM memberships WHERE user_id=$1', [u.uid]))
        .rows[0].n,
      1,
    );
  } finally {
    await lock.query('ROLLBACK');
    await Promise.allSettled([deletion, join].filter(Boolean));
    await lock.end();
  }
});
test('a recovery queued behind deletion cannot reactivate an old or new device', async () => {
  const u = await customer(),
    token = await recovery(u),
    anonymous = await boot(),
    lock = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
  await lock.connect();
  let deletion: Promise<Result> | undefined, consume: Promise<Result> | undefined;
  try {
    await lock.query('BEGIN');
    const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'customer-lifecycle:' + u.uid,
    ]);
    deletion = remove(u);
    await waiters(pid, 1);
    consume = app.inject({
      method: 'POST',
      url: '/api/v1/customer/recoveries/' + token + '/consume',
      headers: anonymous,
      payload: { revokeOldDevices: false },
    });
    await waiters(pid, 2);
    await lock.query('COMMIT');
    assert.equal((await deletion).statusCode, 200);
    assert.equal((await consume).statusCode, 410);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM customer_devices WHERE customer_id=$1 AND revoked_at IS NULL',
          [u.uid],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await lock.query('ROLLBACK');
    await Promise.allSettled([deletion, consume].filter(Boolean));
    await lock.end();
  }
});
test('privacy deletion waits for the cashier request before locking the balance, preserving the approval lock order', async () => {
  const u = await customer(),
    request = (
      await db.query(
        'INSERT INTO stamp_requests(merchant_id,membership_id,user_id,branch_id,code_hash) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [ids.merchantA, u.member, u.uid, ids.branchA, '0'.repeat(64)],
      )
    ).rows[0].id;
  const lock = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
  await lock.connect();
  let deletion: Promise<Result> | undefined;
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM stamp_requests WHERE id=$1 FOR UPDATE', [request]);
    const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    deletion = remove(u);
    await waiters(pid, 1);
    await lock.query(
      'SELECT membership_id FROM loyalty_accounts WHERE membership_id=$1 FOR UPDATE NOWAIT',
      [u.member],
    );
    await lock.query('COMMIT');
    assert.equal((await deletion).statusCode, 200);
    assert.equal(
      (await db.query('SELECT status FROM stamp_requests WHERE id=$1', [request])).rows[0].status,
      'cancelled',
    );
    await assert.rejects(
      () => runtime.query('SELECT delete_customer_identity_v1($1)', [randomUUID()]),
      (e) => (e as { code: string }).code === '42501',
    );
  } finally {
    await lock.query('ROLLBACK');
    await deletion;
    await lock.end();
  }
});
test('a legacy identity that also belongs to a shop team needs separation; deletion never destroys its work account', async () => {
  const u = await customer();
  await db.query(
    "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role,status) VALUES($1,$2,$3,'Synthetic dual identity','cashier','disabled')",
    [ids.merchantA, u.uid, 'dual-' + randomUUID() + '@nuqta.test'],
  );
  const deleted = await remove(u);
  assert.equal(deleted.statusCode, 409);
  assert.equal(deleted.json().error.code, 'WORK_ACCOUNT_REVIEW_REQUIRED');
  assert.equal(
    (await db.query('SELECT status FROM users WHERE id=$1', [u.uid])).rows[0].status,
    'active',
  );
  assert.equal((await app.inject({ url: '/api/v1/session', headers: u.headers })).statusCode, 200);
});
test('a signed deployment-bound deletion manifest re-anonymizes restored personal fields and devices without changing the ledger; app roles cannot invoke offline maintenance', async () => {
  const u = await customer(),
    token = await proof(u);
  const earned = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/stamp-awards',
    headers: { ...owner, ...key() },
    payload: {
      membershipId: u.member,
      branchId: ids.branchA,
      quantity: 2,
      purchaseReference: { reference: randomUUID(), businessDate: businessDate('Africa/Cairo') },
      presentationContext: token,
    },
  });
  assert.equal(earned.statusCode, 200, earned.body);
  const ledger = async () =>
    (
      await db.query(
        "SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id),'[]') AS value FROM ledger_entries l WHERE membership_id=$1",
        [u.member],
      )
    ).rows[0].value;
  const before = await ledger();
  assert.equal((await remove(u)).statusCode, 200);
  const manifest = await exportPrivacyManifest(db, c.AUTH_PEPPER);
  assert.ok(!JSON.stringify(manifest).includes(u.payload.phone));
  assert.ok(!JSON.stringify(manifest).includes('Synthetic privacy holder'));
  // Simulate the personal/auth fields returned by an older snapshot. This is
  // a reconciliation test; the separate restore drill tests real pg_restore.
  await db.query(
    "UPDATE users SET display_name='Synthetic restored personal data',status='active',privacy_deleted_at=NULL WHERE id=$1",
    [u.uid],
  );
  await db.query(
    'UPDATE customer_identities SET phone_e164=$2,phone_normalized=$2,legacy=false WHERE customer_id=$1',
    [u.uid, u.payload.phone],
  );
  await db.query(
    "UPDATE tenant_customer_profiles SET alias='Synthetic restored personal data',contact_phone=$2 WHERE user_id=$1",
    [u.uid, u.payload.phone],
  );
  await db.query("UPDATE memberships SET status='active' WHERE user_id=$1", [u.uid]);
  await db.query('UPDATE customer_devices SET revoked_at=NULL WHERE customer_id=$1', [u.uid]);
  await db.query(
    'UPDATE sessions SET revoked_at=NULL,credential_version=(SELECT password_version FROM users WHERE id=$1) WHERE user_id=$1',
    [u.uid],
  );
  assert.equal((await app.inject({ url: '/api/v1/session', headers: u.headers })).statusCode, 200);
  await assert.rejects(() => applyPrivacyManifest(db, manifest, c.AUTH_PEPPER, false), /offline/);
  const tampered = structuredClone(manifest);
  tampered.payload.records[0]!.deletedAt = '2020-01-01T00:00:00.000Z';
  await assert.rejects(() => applyPrivacyManifest(db, tampered, c.AUTH_PEPPER, true), /signature/);
  await assert.rejects(
    () =>
      applyPrivacyManifest(db, manifest, 'wrong-private-key-with-more-than-32-characters', true),
    /signature/,
  );
  const instance = manifest.payload.instanceId;
  await db.query('UPDATE privacy_instance_identity SET id=$1', [randomUUID()]);
  try {
    await assert.rejects(
      () => applyPrivacyManifest(db, manifest, c.AUTH_PEPPER, true),
      /another deployment/,
    );
  } finally {
    await db.query('UPDATE privacy_instance_identity SET id=$1', [instance]);
  }
  assert.ok((await applyPrivacyManifest(db, manifest, c.AUTH_PEPPER, true)).applied >= 1);
  assert.equal((await applyPrivacyManifest(db, manifest, c.AUTH_PEPPER, true)).applied, 0);
  assert.equal((await app.inject({ url: '/api/v1/session', headers: u.headers })).statusCode, 401);
  assert.equal(
    (await db.query('SELECT contact_phone FROM tenant_customer_profiles WHERE user_id=$1', [u.uid]))
      .rows[0].contact_phone,
    '',
  );
  assert.deepEqual(await ledger(), before);
  await assert.rejects(
    () => runtime.query('SELECT id FROM privacy_instance_identity'),
    (e) => (e as { code: string }).code === '42501',
  );
  await assert.rejects(
    () => runtime.query('SELECT anonymize_customer_record($1,clock_timestamp())', [u.uid]),
    (e) => (e as { code: string }).code === '42501',
  );
  const auth = new pg.Client({ connectionString: c.AUTH_DATABASE_URL });
  await auth.connect();
  try {
    await assert.rejects(
      () => auth.query('SELECT anonymize_customer_record($1,clock_timestamp())', [u.uid]),
      (e) => (e as { code: string }).code === '42501',
    );
  } finally {
    await auth.end();
  }
});
