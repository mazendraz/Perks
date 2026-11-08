import {
  awardOutput,
  enrollmentOutput,
  redemptionOutput,
} from '../../packages/contracts/src/commands.js';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed, ids } from '../../db/seed.js';
import { login, key } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let cashier: Awaited<ReturnType<typeof login>>, owner: typeof cashier;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  cashier = await login(app, 'cashier@bunn.test');
  owner = await login(app, 'owner@bunn.test');
});
after(async () => {
  await app.close();
  await db.end();
});
async function member() {
  const email = 'reward-' + randomUUID() + '@example.test',
    headers = await login(app, email),
    p = (await app.inject({ url: '/api/v1/public/merchants/bunn' })).json().programs[0];
  const joined = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...headers, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: p.id,
      programVersionId: p.versionId,
      alias: 'عميل مكافآت',
      acceptedTerms: true,
      acceptedTermsHash: p.termsHash,
    },
  });
  assert.equal(joined.statusCode, 200);
  enrollmentOutput.parse(joined.json());
  const id = joined.json().membershipId;
  const qr = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships/' + id + '/presentation-tokens',
    headers: { ...headers, ...key() },
    payload: {},
  });
  assert.equal(qr.statusCode, 200);
  return { id, headers, token: qr.json().token as string };
}
async function awardTo(m: Awaited<ReturnType<typeof member>>, qty: number) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/stamp-awards',
    headers: { ...cashier, ...key() },
    payload: {
      branchId: ids.branchA,
      membershipId: m.id,
      quantity: qty,
      purchaseReference: {
        namespace: 'manual',
        reference: 'RW-' + randomUUID(),
        businessDate: businessDate('Africa/Cairo'),
      },
      presentationContext: m.token,
    },
  });
  assert.equal(r.statusCode, 200);
  awardOutput.parse(r.json());
  return r.json();
}
async function unlock(m: Awaited<ReturnType<typeof member>>) {
  await awardTo(m, 3);
  return awardTo(m, 2);
}
async function start(m: Awaited<ReturnType<typeof member>>, rewardId: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/rewards/' + rewardId + '/redemption-challenges',
    headers: { ...cashier, ...key() },
    payload: { branchId: ids.branchA, presentationContext: m.token },
  });
  assert.equal(r.statusCode, 200);
  return r.json();
}

test('published versions pin memberships and earned snapshots; ending earning does not expire earned rewards', async () => {
  const m = await member(),
    earned = await unlock(m),
    reward = earned.rewardGrants[0],
    old = (await db.query('SELECT program_version_id FROM memberships WHERE id=$1', [m.id])).rows[0]
      .program_version_id;
  const published = await app.inject({
    method: 'POST',
    url:
      '/api/v1/merchants/' +
      ids.merchantA +
      '/programs/40000000-0000-4000-8000-000000000001/versions',
    headers: { ...owner, ...key() },
    payload: {
      name: 'Future visits',
      threshold: 7,
      maxPerTx: 3,
      rewardTitle: 'Future reward',
      rewardTerms: 'New members only',
      validityDays: 1,
      endsAt: null,
    },
  });
  assert.equal(published.statusCode, 200);
  const fresh = await member();
  assert.notEqual(
    (await db.query('SELECT program_version_id FROM memberships WHERE id=$1', [fresh.id])).rows[0]
      .program_version_id,
    old,
  );
  assert.equal(
    (await db.query('SELECT program_version_id FROM memberships WHERE id=$1', [m.id])).rows[0]
      .program_version_id,
    old,
  );
  assert.equal(
    (await db.query('SELECT title FROM reward_grants WHERE id=$1', [reward.id])).rows[0].title,
    reward.title,
  );
  const ended = await app.inject({
    method: 'POST',
    url:
      '/api/v1/merchants/' +
      ids.merchantA +
      '/programs/40000000-0000-4000-8000-000000000001/end-earning',
    headers: owner,
    payload: {},
  });
  assert.equal(ended.statusCode, 200);
  const challenge = await start(m, reward.id);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/me/redemption-challenges/' + challenge.challengeId + '/decision',
        headers: { ...m.headers, ...key() },
        payload: { approve: true, code: challenge.code },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/merchants/' +
          ids.merchantA +
          '/redemption-challenges/' +
          challenge.challengeId +
          '/complete',
        headers: { ...cashier, ...key() },
        payload: {},
      })
    ).statusCode,
    200,
  );
  // Restore only the synthetic fixture's active pointer for later tests in this file.
  await db.query("UPDATE programs SET status='active',current_version_id=$1 WHERE id=$2", [
    old,
    '40000000-0000-4000-8000-000000000001',
  ]);
});
test('redemption requires the actual holder and commits once under concurrent completions', async () => {
  const m = await member(),
    aw = await unlock(m),
    reward = aw.rewardGrants[0],
    challenge = await start(m, reward.id);
  const complete = (k = key()) =>
    app.inject({
      method: 'POST',
      url:
        '/api/v1/merchants/' +
        ids.merchantA +
        '/redemption-challenges/' +
        challenge.challengeId +
        '/complete',
      headers: { ...cashier, ...k },
      payload: {},
    });
  assert.equal((await complete()).statusCode, 409);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/me/redemption-challenges/' + challenge.challengeId + '/decision',
        headers: { ...cashier, ...key() },
        payload: { approve: true, code: challenge.code },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/me/redemption-challenges/' + challenge.challengeId + '/decision',
        headers: { ...m.headers, ...key() },
        payload: { approve: true, code: challenge.code },
      })
    ).statusCode,
    200,
  );
  const k1 = key(),
    k2 = key(),
    attempts = await Promise.all([complete(k1), complete(k2)]);
  assert.equal(attempts.filter((x) => x.statusCode === 200).length, 1);
  assert.equal(attempts.filter((x) => x.statusCode === 409).length, 1);
  const winner = attempts[0]!.statusCode === 200 ? k1 : k2,
    replay = await complete(winner);
  assert.equal(replay.statusCode, 200);
  assert.equal(
    Number(
      (await db.query('SELECT count(*) FROM reward_redemptions WHERE reward_id=$1', [reward.id]))
        .rows[0].count,
    ),
    1,
  );
  const correction = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/corrections',
    headers: { ...cashier, ...key() },
    payload: { transactionId: aw.transactionId, delta: -2, reason: 'تصحيح بعد صرف المكافأة' },
  });
  assert.equal(correction.statusCode, 200);
  const review = await app.inject({
    method: 'POST',
    url:
      '/api/v1/merchants/' +
      ids.merchantA +
      '/corrections/' +
      correction.json().correction.id +
      '/decision',
    headers: { ...owner, ...key() },
    payload: { approve: true, reason: 'مراجعة التصحيح المطلوب' },
  });
  assert.equal(review.statusCode, 200);
  assert.equal(review.json().status, 'needs_review');
});
test('safe latest reversal voids unused grants and appends compensation once', async () => {
  const m = await member(),
    aw = await unlock(m),
    reward = aw.rewardGrants[0];
  assert.equal(aw.balanceAfter, 0);
  const requested = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/corrections',
    headers: { ...cashier, ...key() },
    payload: {
      transactionId: aw.transactionId,
      delta: -2,
      reason: 'الإيصال اتسجل بكمية غير صحيحة',
    },
  });
  assert.equal(requested.statusCode, 200);
  const id = requested.json().correction.id;
  const url = '/api/v1/merchants/' + ids.merchantA + '/corrections/' + id + '/decision';
  const decisions = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: 'POST',
        url,
        headers: { ...owner, ...key() },
        payload: { approve: true, reason: 'راجعت الإيصال واعتمدت العكس الكامل' },
      }),
    ),
  );
  assert.ok(decisions.every((r) => r.statusCode === 200));
  assert.equal(new Set(decisions.map((r) => r.json().transactionId)).size, 1);
  assert.equal(decisions[0]!.json().balanceAfter, 3);
  assert.equal(
    (await db.query('SELECT status FROM reward_grants WHERE id=$1', [reward.id])).rows[0].status,
    'voided',
  );
  assert.equal(
    Number(
      (
        await db.query(
          'SELECT count(*) FROM loyalty_transactions WHERE original_transaction_id=$1',
          [aw.transactionId],
        )
      ).rows[0].count,
    ),
    1,
  );
  const a = (
    await db.query(
      'SELECT balance,(SELECT sum(amount)::int FROM ledger_entries l WHERE l.membership_id=a.membership_id) AS ledger FROM loyalty_accounts a WHERE membership_id=$1',
      [m.id],
    )
  ).rows[0];
  assert.equal(a.balance, a.ledger);
});
test('expiry is rechecked after holder confirmation; expiration sweep is repeatable', async () => {
  const m = await member(),
    aw = await unlock(m),
    source = aw.rewardGrants[0],
    expiring = randomUUID();
  // Dedicated temporal fixture. Published expiry is immutable; no UPDATE backdoor is used.
  await db.query(
    "INSERT INTO reward_grants(id,merchant_id,membership_id,program_version_id,earned_transaction_id,ordinal,threshold,title,terms,branch_ids,earned_at,expires_at) SELECT $1,merchant_id,membership_id,program_version_id,earned_transaction_id,1001,threshold,title,terms,branch_ids,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1200 milliseconds' FROM reward_grants WHERE id=$2",
    [expiring, source.id],
  );
  const challenge = await start(m, expiring);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/me/redemption-challenges/' + challenge.challengeId + '/decision',
        headers: { ...m.headers, ...key() },
        payload: { approve: true, code: challenge.code },
      })
    ).statusCode,
    200,
  );
  await new Promise((r) => setTimeout(r, 1300));
  const complete = await app.inject({
    method: 'POST',
    url:
      '/api/v1/merchants/' +
      ids.merchantA +
      '/redemption-challenges/' +
      challenge.challengeId +
      '/complete',
    headers: { ...cashier, ...key() },
    payload: {},
  });
  assert.equal(complete.statusCode, 410);
  assert.equal(complete.json().error.code, 'REWARD_EXPIRED');
  const first = (await db.query('SELECT sweep_expired_rewards() AS n')).rows[0].n;
  const second = (await db.query('SELECT sweep_expired_rewards() AS n')).rows[0].n;
  assert.ok(first >= 1);
  assert.equal(second, 0);
});

test('completed card stays full until redemption; renewal is exactly once and carries surplus stamps and other rewards', async () => {
  for (const surplus of [0, 1]) {
    const m = await member();
    await awardTo(m, 3);
    const earned = await awardTo(m, 2 + surplus);
    const before = (
      await app.inject({ url: '/api/v1/me/memberships/' + m.id, headers: m.headers })
    ).json().card;
    assert.equal(before.balance, surplus);
    assert.equal(before.display_balance, 5);
    assert.equal(before.cycle_number, 1);
    assert.equal(before.pending_rewards, 1);
    const ch = await start(m, earned.rewardGrants[0].id);
    await app.inject({
      method: 'POST',
      url: '/api/v1/me/redemption-challenges/' + ch.challengeId + '/decision',
      headers: { ...m.headers, ...key() },
      payload: { approve: true, code: ch.code },
    });
    const headers = { ...cashier, ...key() },
      url =
        '/api/v1/merchants/' +
        ids.merchantA +
        '/redemption-challenges/' +
        ch.challengeId +
        '/complete';
    const completed = await Promise.all([
      app.inject({ method: 'POST', url, headers, payload: {} }),
      app.inject({ method: 'POST', url, headers, payload: {} }),
    ]);
    assert.equal(completed[0]!.statusCode, 200);
    assert.deepEqual(completed[0]!.json(), completed[1]!.json());
    redemptionOutput.parse(completed[0]!.json());
    assert.equal(completed[0]!.json().cycleNumber, 2);
    const after = (
      await app.inject({ url: '/api/v1/me/memberships/' + m.id, headers: m.headers })
    ).json().card;
    assert.equal(after.id, before.id);
    assert.equal(after.cycle_number, 2);
    assert.equal(after.balance, surplus);
    assert.equal(after.display_balance, surplus);
    assert.equal(after.pending_rewards, 0);
    assert.ok(after.cycle_renewed_at);
    assert.equal(
      Number(
        (
          await db.query(
            'SELECT coalesce(sum(amount),0) AS balance FROM ledger_entries WHERE membership_id=$1',
            [m.id],
          )
        ).rows[0].balance,
      ),
      surplus,
    );
    await awardTo(m, 3);
    assert.equal(
      (await app.inject({ url: '/api/v1/me/memberships/' + m.id, headers: m.headers })).json().card
        .balance,
      surplus + 3,
    );
  }
  const m = await member();
  await awardTo(m, 3);
  const first = await awardTo(m, 2);
  await awardTo(m, 3);
  await awardTo(m, 2);
  const ch = await start(m, first.rewardGrants[0].id);
  await app.inject({
    method: 'POST',
    url: '/api/v1/me/redemption-challenges/' + ch.challengeId + '/decision',
    headers: { ...m.headers, ...key() },
    payload: { approve: true, code: ch.code },
  });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/merchants/' +
          ids.merchantA +
          '/redemption-challenges/' +
          ch.challengeId +
          '/complete',
        headers: { ...cashier, ...key() },
        payload: {},
      })
    ).statusCode,
    200,
  );
  const card = (
    await app.inject({ url: '/api/v1/me/memberships/' + m.id, headers: m.headers })
  ).json().card;
  assert.equal(card.pending_rewards, 1);
  assert.equal(card.display_balance, 5);
  assert.equal(card.cycle_number, 2);
});
