import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import sharp from 'sharp';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { login, key, adminLogin } from '../helpers.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app, pools } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
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
const base = '/api/v1/merchants/' + ids.merchantA;
test('branch quota is serialized and a downgrade cannot delete over-limit resources or earned rights', async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      app.inject({
        method: 'POST',
        url: base + '/branches',
        headers: { ...owner, ...key() },
        payload: { name: 'Capacity fixture', address: 'Local test' },
      }),
    ),
  );
  assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
  assert.ok(results.every((r) => [200, 409].includes(r.statusCode)));
  const newBranch = results.find((r) => r.statusCode === 200)!.json().branch;
  await assert.rejects(
    () =>
      db.query(
        'INSERT INTO program_branches(merchant_id,program_version_id,branch_id) VALUES($1,$2,$3)',
        [ids.merchantA, '50000000-0000-4000-8000-000000000001', newBranch.id],
      ),
    /immutable/,
  );
  await seed(db);
  assert.equal(
    Number(
      (
        await db.query(
          'SELECT count(*) FROM program_branches WHERE program_version_id=$1 AND branch_id=$2',
          ['50000000-0000-4000-8000-000000000001', newBranch.id],
        )
      ).rows[0].count,
    ),
    0,
  );
  assert.equal(
    Number(
      (await db.query('SELECT count(*) FROM branches WHERE merchant_id=$1', [ids.merchantA]))
        .rows[0].count,
    ),
    3,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: base + '/branches/' + newBranch.id,
        headers: { ...foreign, 'if-match': '1' },
        payload: {
          name: 'Denied change',
          address: '',
          status: 'disabled',
          reason: 'Foreign tenant attempt',
        },
      })
    ).statusCode,
    404,
  );
  const downgrade = await app.inject({
    method: 'PATCH',
    url: '/api/v1/platform/merchants/' + ids.merchantA + '/entitlements',
    headers: { ...admin, ...key() },
    payload: { plan: 'starter', reason: 'Capacity test only' },
  });
  assert.equal(downgrade.statusCode, 409);
  assert.equal(downgrade.json().error.code, 'DOWNGRADE_OVER_USAGE');
});
test('uploads authorize before decoding; only the explicitly published sanitized logo is public', async () => {
  const png = (
    await sharp({ create: { width: 20, height: 20, channels: 4, background: '#3355cc' } })
      .png()
      .toBuffer()
  ).toString('base64');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: base + '/assets',
        headers: foreign,
        payload: { base64: png },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: base + '/assets',
        headers: owner,
        payload: {
          base64: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
          ).toString('base64'),
        },
      })
    ).statusCode,
    422,
  );
  const upload = await app.inject({
    method: 'POST',
    url: base + '/assets',
    headers: owner,
    payload: { base64: png },
  });
  assert.equal(upload.statusCode, 200);
  const asset = upload.json().asset.id,
    url = '/api/v1/public/merchants/' + ids.merchantA + '/logos/' + asset;
  assert.equal((await app.inject(url)).statusCode, 404);
  const brand = (await app.inject({ url: base, headers: owner })).json().merchant;
  const published = await app.inject({
    method: 'PATCH',
    url: base + '/branding',
    headers: { ...owner, 'if-match': String(brand.revision) },
    payload: {
      name: brand.name,
      primaryColor: brand.primary_color,
      accentColor: brand.accent_color,
      surfaceColor: brand.surface_color,
      template: brand.template,
      terms: brand.terms,
      logoAssetId: asset,
    },
  });
  assert.equal(published.statusCode, 200);
  assert.equal((await app.inject(url)).statusCode, 200);
  assert.equal(
    (await app.inject('/api/v1/public/merchants/' + ids.merchantB + '/logos/' + asset)).statusCode,
    404,
  );
});
test('runtime cannot read MFA secrets and authentication role cannot change platform privileges', async () => {
  await assert.rejects(
    () => pools.pool.query('SELECT totp_secret FROM users'),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      pools.authPool.query("UPDATE users SET global_role='platform_admin' WHERE id=$1", [
        ids.customer,
      ]),
    /permission denied/,
  );
});

test('publishing an uploaded logo saves it immediately with revision fencing and idempotent recovery', async () => {
  const png = (
    await sharp({ create: { width: 24, height: 24, channels: 4, background: '#224e43' } })
      .png()
      .toBuffer()
  ).toString('base64');
  const merchant = (await app.inject({ url: base, headers: owner })).json().merchant;
  const headers = { ...owner, ...key(), 'if-match': String(merchant.revision) };
  const request = () =>
    app.inject({
      method: 'POST',
      url: base + '/assets',
      headers,
      payload: { base64: png, publishLogo: true },
    });
  const uploaded = await request();
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  assert.equal(uploaded.json().merchant.logo_asset_id, uploaded.json().asset.id);
  assert.equal(uploaded.json().merchant.revision, merchant.revision + 1);
  assert.deepEqual((await request()).json(), uploaded.json());
  const reloaded = (await app.inject({ url: base, headers: owner })).json().merchant;
  assert.equal(reloaded.logo_asset_id, uploaded.json().asset.id);
  assert.equal(
    (
      await app.inject(
        '/api/v1/public/merchants/' + merchant.id + '/logos/' + reloaded.logo_asset_id,
      )
    ).statusCode,
    200,
  );
  const stale = await app.inject({
    method: 'POST',
    url: base + '/assets',
    headers: { ...owner, ...key(), 'if-match': String(merchant.revision) },
    payload: { base64: png, publishLogo: true },
  });
  assert.equal(stale.statusCode, 409);
});
