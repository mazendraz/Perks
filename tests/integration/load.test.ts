import { enrollmentTerms } from '../helpers.js';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { login, key } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
});
after(async () => {
  await app.close();
  await db.end();
});
test('declared local API/DB load: fifty purchases at concurrency twenty conserve ledger and rewards', async () => {
  const cu = await login(app, 'load-' + randomUUID() + '@nuqta.test'),
    ca = await login(app, 'cashier@bunn.test');
  const enrolled = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...cu, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: '40000000-0000-4000-8000-000000000001',
      programVersionId: '50000000-0000-4000-8000-000000000001',
      alias: 'Load fixture',
      acceptedTerms: true,
      acceptedTermsHash: await enrollmentTerms(app, '40000000-0000-4000-8000-000000000001'),
    },
  });
  assert.equal(enrolled.statusCode, 200);
  const ms = enrolled.json().membershipId;
  const token = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/me/memberships/' + ms + '/presentation-tokens',
      headers: { ...cu, ...key() },
      payload: {},
    })
  ).json().token;
  const latencies: number[] = [],
    results: unknown[] = [],
    started = performance.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: 20 }, async () => {
      for (;;) {
        const n = next++;
        if (n >= 50) return;
        const at = performance.now();
        const result = await app.inject({
          method: 'POST',
          url: '/api/v1/merchants/' + ids.merchantA + '/stamp-awards',
          headers: { ...ca, ...key() },
          payload: {
            branchId: ids.branchA,
            membershipId: ms,
            quantity: 3,
            presentationContext: token,
            purchaseReference: {
              namespace: 'manual',
              reference: 'LOAD-' + n,
              businessDate: businessDate('Africa/Cairo'),
            },
          },
        });
        assert.equal(result.statusCode, 200, result.body);
        latencies.push(performance.now() - at);
        results.push(result.json());
      }
    }),
  );
  const total = performance.now() - started;
  latencies.sort((a, b) => a - b);
  const state = (
    await db.query(
      'SELECT a.balance,(SELECT sum(amount)::int FROM ledger_entries WHERE membership_id=$1) AS ledger,(SELECT count(*)::int FROM reward_grants WHERE membership_id=$1) AS rewards,(SELECT count(DISTINCT purchase_id)::int FROM loyalty_transactions WHERE membership_id=$1) AS visits FROM loyalty_accounts a WHERE membership_id=$1',
      [ms],
    )
  ).rows[0];
  assert.deepEqual(state, { balance: 0, ledger: 0, rewards: 30, visits: 50 });
  const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1]!;
  assert.ok(p95 < 3000, 'Local injected API/DB p95 exceeds the declared 3s gate');
  assert.equal(results.length, 50);
  await mkdir('docs/execution/evidence/implementation', { recursive: true });
  await writeFile(
    'docs/execution/evidence/implementation/load.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        environment: 'local PostgreSQL; Fastify inject; no HTTP/TLS or device latency',
        purchases: 50,
        concurrency: 20,
        totalMs: total,
        p50Ms: latencies[24],
        p95Ms: p95,
        gateMs: 3000,
        state,
        productionSloProven: false,
      },
      null,
      2,
    ),
  );
});
