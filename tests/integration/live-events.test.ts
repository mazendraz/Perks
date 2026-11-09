import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed, ids } from '../../db/seed.js';
import { login, key, enrollmentTerms } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let base: string,
  one: Awaited<ReturnType<typeof login>>,
  two: typeof one,
  cashier: typeof one,
  membership: string;
type Event = { type: string; data: Record<string, string> };
interface Live {
  state: { events: Event[]; heartbeats: number; ended: boolean };
  close: () => Promise<void>;
}
const live: Live[] = [];
async function until(check: () => boolean, timeout = 2000) {
  const end = Date.now() + timeout;
  while (!check() && Date.now() < end) await delay(10);
  assert.ok(check(), 'expected stream state before deadline');
}
async function open(path: string, headers: typeof one): Promise<Live> {
  const controller = new AbortController();
  const response = await fetch(base + path, { headers, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type')!, /text\/event-stream/);
  const state = { events: [] as Event[], heartbeats: 0, ended: false };
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  const reading = (async () => {
    let buffer = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let split: number;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          if (block.startsWith(': heartbeat')) state.heartbeats++;
          else {
            const type = /^event: ([^\n]+)/m.exec(block)?.[1],
              data = /^data: (.+)/m.exec(block)?.[1];
            if (type && data) state.events.push({ type, data: JSON.parse(data) });
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      state.ended = true;
      reader.releaseLock();
    }
  })();
  // Attach rejection handling immediately while preserving failures at cleanup.
  void reading.catch(() => {});
  const result = {
    state,
    close: async () => {
      controller.abort();
      await reading;
    },
  };
  live.push(result);
  await until(() => state.events.some((e) => e.type === 'sync'));
  return result;
}
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  one = await login(app, 'live-one-' + randomUUID() + '@nuqta.test');
  two = await login(app, 'live-two-' + randomUUID() + '@nuqta.test');
  cashier = await login(app, 'cashier@bunn.test');
  const joined = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...one, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: '40000000-0000-4000-8000-000000000001',
      programVersionId: '50000000-0000-4000-8000-000000000001',
      alias: 'Synthetic live holder',
      acceptedTerms: true,
      acceptedTermsHash: await enrollmentTerms(app, '40000000-0000-4000-8000-000000000001'),
      branchId: ids.branchA,
    },
  });
  assert.equal(joined.statusCode, 200);
  membership = joined.json().membershipId;
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});
after(async () => {
  await Promise.all(live.map((s) => s.close()));
  await app.close();
  await db.end();
});
test('SSE requires a live session and branch grants; no cross-merchant or ungranted branch stream', async () => {
  assert.equal((await fetch(base + '/api/v1/me/events')).status, 401);
  assert.equal(
    (await app.inject({ url: '/api/v1/branches/' + ids.branchB + '/events', headers: cashier }))
      .statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/branches/' + ids.branchA2 + '/events', headers: cashier }))
      .statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/branches/' + ids.branchA + '/events', headers: one }))
      .statusCode,
    404,
  );
});
test('committed request and ledger hints reach only their holder/branch in under a second; rollback emits nothing', async () => {
  const holder = await open('/api/v1/me/events', one),
    other = await open('/api/v1/me/events', two),
    staff = await open('/api/v1/branches/' + ids.branchA + '/events', cashier);
  const before = Date.now();
  const request = await app.inject({
    method: 'POST',
    url: '/api/v1/me/stamp-requests',
    headers: { ...one, ...key() },
    payload: { membershipId: membership, branchId: ids.branchA },
  });
  assert.equal(request.statusCode, 200);
  const id = request.json().id;
  await until(
    () =>
      holder.state.events.some((e) => e.data.id === id) &&
      staff.state.events.some((e) => e.data.id === id),
    1000,
  );
  assert.ok(Date.now() - before < 1000);
  await delay(75);
  assert.deepEqual(other.state.events, [{ type: 'sync', data: {} }]);
  const event = holder.state.events.find((e) => e.data.id === id)!;
  assert.deepEqual(Object.keys(event.data).sort(), ['branchId', 'id', 'kind', 'membershipId']);
  const previous = holder.state.events.length;
  await db.query('BEGIN');
  await db.query("UPDATE stamp_requests SET reason='synthetic rollback' WHERE id=$1", [id]);
  await delay(100);
  assert.equal(holder.state.events.length, previous);
  await db.query('ROLLBACK');
  await delay(100);
  assert.equal(holder.state.events.length, previous);
  const qr = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships/' + membership + '/presentation-tokens',
    headers: { ...one, ...key() },
    payload: {},
  });
  const award = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/stamp-awards',
    headers: { ...cashier, ...key() },
    payload: {
      membershipId: membership,
      branchId: ids.branchA,
      quantity: 1,
      presentationContext: qr.json().token,
      purchaseReference: {
        namespace: 'manual',
        reference: 'LIVE-' + randomUUID(),
        businessDate: businessDate('Africa/Cairo'),
      },
    },
  });
  assert.equal(award.statusCode, 200);
  const fulfilled = (
    await db.query('SELECT status,transaction_id FROM stamp_requests WHERE id=$1', [id])
  ).rows[0];
  assert.equal(fulfilled.status, 'approved');
  assert.equal(fulfilled.transaction_id, award.json().transactionId);
  await until(
    () =>
      holder.state.events.some((e) => e.data.kind === 'ledger') &&
      staff.state.events.some((e) => e.data.kind === 'ledger'),
    1000,
  );
  assert.deepEqual(other.state.events, [{ type: 'sync', data: {} }]);
  // A connection also checks revocation on every delivered notification.
  await db.query(
    'UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=(SELECT user_id FROM memberships WHERE id=$1)',
    [membership],
  );
  await db.query("UPDATE stamp_requests SET reason='synthetic revocation check' WHERE id=$1", [id]);
  await until(() => holder.state.ended);
  await other.close();
  await staff.close();
});
test(
  'open stream receives the 25-second heartbeat and app shutdown closes live responses',
  { timeout: 30000 },
  async () => {
    const holder = await open('/api/v1/me/events', two);
    await until(() => holder.state.heartbeats > 0, 26500);
    const closing = app.close();
    await until(() => holder.state.ended);
    await Promise.race([
      closing,
      delay(2000).then(() => {
        throw new Error('shutdown must drain SSE without a keepalive wait');
      }),
    ]);
  },
);
