import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed, ids } from '../../db/seed.js';
import { login, key, enrollmentTerms } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';

test('worker purges sessions after90days in bounded batches, detaches expired proof references, preserves financial history and keeps recent/live sessions', async () => {
  const c = readConfig(),
    db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
    worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL }),
    runtime = new pg.Client({ connectionString: c.DATABASE_URL });
  const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
  await db.connect();
  await runtime.connect();
  try {
    await seed(db);
    await app.ready();
    const email = 'retention-' + randomUUID() + '@example.test',
      holder = await login(app, email),
      owner = await login(app, 'owner@bunn.test');
    const uid = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
    const enrolled = await app.inject({
      method: 'POST',
      url: '/api/v1/me/memberships',
      headers: { ...holder, ...key() },
      payload: {
        merchantId: ids.merchantA,
        programId: '40000000-0000-4000-8000-000000000001',
        programVersionId: '50000000-0000-4000-8000-000000000001',
        alias: 'Synthetic retention',
        acceptedTerms: true,
        acceptedTermsHash: await enrollmentTerms(app, '40000000-0000-4000-8000-000000000001'),
      },
    });
    assert.equal(enrolled.statusCode, 200, enrolled.body);
    const member = enrolled.json().membershipId;
    const code = await app.inject({
      method: 'POST',
      url: '/api/v1/me/memberships/' + member + '/presentation-tokens',
      headers: { ...holder, ...key() },
      payload: {},
    });
    assert.equal(code.statusCode, 200, code.body);
    const token = code.json().token;
    for (const quantity of [3, 2]) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/merchants/' + ids.merchantA + '/stamp-awards',
        headers: { ...owner, ...key() },
        payload: {
          branchId: ids.branchA,
          membershipId: member,
          quantity,
          purchaseReference: {
            reference: randomUUID(),
            businessDate: businessDate('Africa/Cairo'),
          },
          presentationContext: token,
        },
      });
      assert.equal(r.statusCode, 200, r.body);
    }
    const reward = (
      await db.query("SELECT id FROM reward_grants WHERE membership_id=$1 AND status='available'", [
        member,
      ])
    ).rows[0].id;
    const challenge = await app.inject({
      method: 'POST',
      url: '/api/v1/merchants/' + ids.merchantA + '/rewards/' + reward + '/redemption-challenges',
      headers: { ...owner, ...key() },
      payload: { branchId: ids.branchA, presentationContext: token },
    });
    assert.equal(challenge.statusCode, 200, challenge.body);
    const ch = (
      await db.query('SELECT id,cashier_session_id FROM redemption_challenges WHERE reward_id=$1', [
        reward,
      ])
    ).rows[0];
    const pt = (
      await db.query('SELECT id,session_id FROM presentation_tokens WHERE membership_id=$1', [
        member,
      ])
    ).rows[0];
    const digest = async () =>
      (
        await db.query(
          "SELECT md5(coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id)::text,'[]')) AS value FROM ledger_entries l WHERE membership_id=$1",
          [member],
        )
      ).rows[0].value;
    const ledger = await digest();
    await db.query(
      "UPDATE sessions SET created_at=clock_timestamp()-interval '92 days',expires_at=clock_timestamp()-interval '91 days' WHERE id=ANY($1::uuid[])",
      [[pt.session_id, ch.cashier_session_id]],
    );
    await db.query(
      "UPDATE presentation_tokens SET expires_at=clock_timestamp()-interval '91 days' WHERE id=$1",
      [pt.id],
    );
    await db.query(
      "UPDATE redemption_challenges SET expires_at=clock_timestamp()-interval '91 days' WHERE id=$1",
      [ch.id],
    );
    await db.query(
      "INSERT INTO mfa_enrollments(user_id,session_id,secret_encrypted,expires_at) VALUES($1,$2,'synthetic-retention',clock_timestamp()-interval '91 days')",
      [uid, pt.session_id],
    );
    const idsToKeep = (
      await db.query(
        `INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at)
      SELECT $1,gen_random_uuid()::text,gen_random_uuid()::text,clock_timestamp()+days*interval '1 day' FROM unnest(ARRAY[-89,1]) AS days RETURNING id`,
        [uid],
      )
    ).rows.map((r) => r.id);
    await db.query(
      `INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at)
      SELECT $1,gen_random_uuid()::text,gen_random_uuid()::text,clock_timestamp()-interval '100 days' FROM generate_series(1,501)`,
      [uid],
    );
    await assert.rejects(
      () => runtime.query('SELECT sweep_expired_sessions()'),
      (error) => (error as { code: string }).code === '42501',
    );
    await assert.rejects(
      () => worker.query('SELECT * FROM sessions LIMIT 1'),
      (error) => (error as { code: string }).code === '42501',
    );
    const first = (await worker.query('SELECT sweep_expired_sessions() AS n')).rows[0].n;
    assert.equal(first, 500);
    for (let i = 0; i < 5; i++)
      if ((await worker.query('SELECT sweep_expired_sessions() AS n')).rows[0].n === 0) break;
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND expires_at<clock_timestamp()-interval '90 days'",
          [uid],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS n FROM sessions WHERE id=ANY($1::uuid[])', [
          idsToKeep,
        ])
      ).rows[0].n,
      2,
    );
    assert.equal(
      (await db.query('SELECT session_id FROM presentation_tokens WHERE id=$1', [pt.id])).rows[0]
        .session_id,
      null,
    );
    assert.equal(
      (await db.query('SELECT cashier_session_id FROM redemption_challenges WHERE id=$1', [ch.id]))
        .rows[0].cashier_session_id,
      null,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM mfa_enrollments WHERE user_id=$1', [uid]))
        .rows[0].n,
      0,
    );
    assert.equal(await digest(), ledger);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM reward_grants WHERE id=$1', [reward])).rows[0]
        .n,
      1,
    );
  } finally {
    await app.close();
    await runtime.end();
    await worker.end();
    await db.end();
  }
});
test('new customer exports receive24hours through the real API without extending older exports', async () => {
  const c = readConfig(),
    db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
    { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
  await db.connect();
  try {
    await seed(db);
    const owner = await login(app, 'owner@bunn.test');
    const old = (
      await db.query(
        "INSERT INTO customer_exports(merchant_id,requested_by,segment,expires_at) VALUES($1,$2,'all',clock_timestamp()+interval '1 hour') RETURNING id,expires_at",
        [ids.merchantA, ids.ownerA],
      )
    ).rows[0];
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/merchants/' + ids.merchantA + '/customer-exports',
      headers: { ...owner, ...key() },
      payload: { segment: 'all' },
    });
    assert.equal(r.statusCode, 200, r.body);
    const duration = Date.parse(r.json().export.expires_at) - Date.now();
    assert.ok(duration > 24 * 3600000 - 10000 && duration <= 24 * 3600000);
    assert.equal(
      (
        await db.query('SELECT expires_at FROM customer_exports WHERE id=$1', [old.id])
      ).rows[0].expires_at.getTime(),
      old.expires_at.getTime(),
    );
  } finally {
    await app.close();
    await db.end();
  }
});
