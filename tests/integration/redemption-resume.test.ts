import { awardOutput, enrollmentOutput } from '../../packages/contracts/src/commands.js';
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
let cashier: Awaited<ReturnType<typeof login>>;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  cashier = await login(app, 'cashier@bunn.test');
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

test('the same cashier session resumes its open redemption after losing the screen; another session still conflicts', async () => {
  const m = await member(),
    earned = await unlock(m),
    reward = earned.rewardGrants[0];
  const fresh = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/me/memberships/' + m.id + '/presentation-tokens',
        headers: { ...m.headers, ...key() },
        payload: {},
      })
    ).json().token as string;
  const first = await start({ ...m, token: await fresh() }, reward.id);
  const again = await start({ ...m, token: await fresh() }, reward.id);
  assert.equal(again.challengeId, first.challengeId);
  assert.equal(again.code, first.code);
  const otherSession = await login(app, 'cashier@bunn.test');
  const blocked = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/rewards/' + reward.id + '/redemption-challenges',
    headers: { ...otherSession, ...key() },
    payload: { branchId: ids.branchA, presentationContext: await fresh() },
  });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error.code, 'CHALLENGE_ACTIVE');
  const audit = await db.query(
    "SELECT count(*)::int AS n FROM audit_events WHERE action='redemption.resume' AND target_id=$1",
    [reward.id],
  );
  assert.equal(audit.rows[0].n, 1);
});
