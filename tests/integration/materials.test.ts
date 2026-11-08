import { decodeQr } from '../../tools/qr-codec.js';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { login, key, adminLogin } from '../helpers.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let owner: Awaited<ReturnType<typeof login>>, foreign: typeof owner, admin: typeof owner;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  owner = await login(app, 'owner@bunn.test');
  foreign = await login(app, 'owner@lamsa.test');
  admin = await adminLogin(app, db);
});
after(async () => {
  await app.close();
  await db.end();
});
const base = '/api/v1/merchants/' + ids.merchantA + '/placements';
test('independent placement QR is real; replacement is atomic and revokes only the replaced piece', async () => {
  const payload = { branchId: ids.branchA, label: 'Front counter', kind: 'nfc' },
    k = key();
  const r = await app.inject({ method: 'POST', url: base, headers: { ...owner, ...k }, payload });
  assert.equal(r.statusCode, 200);
  const p = r.json().placement;
  assert.equal(
    (await app.inject({ method: 'POST', url: base, headers: { ...owner, ...k }, payload })).json()
      .placement.id,
    p.id,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/public/placements/' + p.public_code })).statusCode,
    200,
  );
  const png = await app.inject({ url: base + '/' + p.id + '/qr', headers: owner });
  assert.equal(png.statusCode, 200);
  assert.equal(png.rawPayload.subarray(1, 4).toString(), 'PNG');
  assert.equal(
    await decodeQr(png.rawPayload),
    c.PUBLIC_APP_ORIGIN + '/p/' + p.public_code + '?src=qr',
  );
  assert.equal(
    (await app.inject({ url: base + '/' + p.id + '/qr', headers: foreign })).statusCode,
    404,
  );
  const replacements = await Promise.all(
    Array.from({ length: 8 }, () =>
      app.inject({
        method: 'POST',
        url: base + '/' + p.id + '/replace',
        headers: { ...owner, ...key() },
        payload: { reason: 'Damaged test piece' },
      }),
    ),
  );
  assert.ok(replacements.every((x) => x.statusCode === 200));
  assert.equal(new Set(replacements.map((x) => x.json().replacementId)).size, 1);
  assert.equal(
    (await app.inject({ url: '/api/v1/public/placements/' + p.public_code })).statusCode,
    410,
  );
  const next = (
    await db.query('SELECT * FROM placements WHERE id=$1', [replacements[0]!.json().replacementId])
  ).rows[0];
  assert.equal(
    (await app.inject({ url: '/api/v1/public/placements/' + next.public_code })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: base + '/' + p.id + '/qr', headers: owner })).statusCode,
    410,
  );
});
test('fulfillment transitions require the proper operator and explicit device attestation', async () => {
  const p = (
    await app.inject({
      method: 'POST',
      url: base,
      headers: { ...owner, ...key() },
      payload: { branchId: ids.branchA, label: 'Test print', kind: 'stand' },
    })
  ).json().placement;
  const transition = (status: string, revision: number, headers = admin, extra = {}) =>
    app.inject({
      method: 'POST',
      url: base + '/' + p.id + '/transition',
      headers: { ...headers, ...key(), 'if-match': String(revision) },
      payload: { status, reason: 'Integration fixture only', ...extra },
    });
  assert.equal((await transition('ready', 1, owner)).statusCode, 403);
  assert.equal((await transition('ready', 1)).statusCode, 200);
  assert.equal(
    (await transition('verified', 2, owner, { deviceDescription: 'Synthetic evidence fixture' }))
      .statusCode,
    409,
  );
  assert.equal((await transition('shipped', 2)).statusCode, 200);
  assert.equal((await transition('installed', 3, owner)).statusCode, 200);
  assert.equal((await transition('verified', 4, owner)).statusCode, 422);
  // Intentionally leave physical verification unperformed. Tests must not attest real hardware.
  assert.equal(
    (await db.query('SELECT status FROM placements WHERE id=$1', [p.id])).rows[0].status,
    'installed',
  );
});
