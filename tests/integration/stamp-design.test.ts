import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed, ids } from '../../db/seed.js';
import { login, key, enrollmentTerms } from '../helpers.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let owner: Awaited<ReturnType<typeof login>>,
  foreign: typeof owner,
  cashier: typeof owner,
  holder: typeof owner;
const base = '/api/v1/merchants/' + ids.merchantA;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  owner = await login(app, 'owner@bunn.test');
  foreign = await login(app, 'owner@lamsa.test');
  cashier = await login(app, 'cashier@bunn.test');
  holder = await login(app, 'sara@example.test');
  const cards = (await app.inject({ url: '/api/v1/me/memberships', headers: holder })).json().cards;
  if (!cards.some((c: { merchant_id: string }) => c.merchant_id === ids.merchantA)) {
    const joined = await app.inject({
      method: 'POST',
      url: '/api/v1/me/memberships',
      headers: { ...holder, ...key() },
      payload: {
        merchantId: ids.merchantA,
        programId: '40000000-0000-4000-8000-000000000001',
        programVersionId: '50000000-0000-4000-8000-000000000001',
        alias: 'Stamp artwork fixture',
        branchId: ids.branchA,
        acceptedTerms: true,
        acceptedTermsHash: await enrollmentTerms(app, '40000000-0000-4000-8000-000000000001'),
      },
    });
    assert.equal(joined.statusCode, 200, joined.body);
  }
});
after(async () => {
  await app.close();
  await db.end();
});
test('business editions and independent stamp artwork persist to holder list/detail without changing balances, cycles or earned rewards; validation and tenant/role/revision guards hold', async () => {
  const merchant = (await app.inject({ url: base, headers: owner })).json().merchant;
  const state = async () => ({
    accounts: (
      await db.query(
        'SELECT membership_id,balance,revision,cycle_number FROM loyalty_accounts WHERE merchant_id=$1 ORDER BY membership_id',
        [ids.merchantA],
      )
    ).rows,
    rewards: (
      await db.query(
        'SELECT id,status,threshold,title,expires_at,redeemed_at FROM reward_grants WHERE merchant_id=$1 ORDER BY id',
        [ids.merchantA],
      )
    ).rows,
  });
  const before = await state();
  let revision = merchant.revision;
  const body = {
    name: merchant.name,
    primaryColor: merchant.primary_color,
    accentColor: merchant.accent_color,
    surfaceColor: merchant.surface_color,
    template: 'cafe',
    terms: merchant.terms,
    stampShape: 'seal',
    stampIcon: 'coffee',
    stampStyle: 'outline',
    logoStyle: 'plain',
    logoSize: 64,
  };
  const publish = (payload = body, headers = owner, rev = revision) =>
    app.inject({
      method: 'PATCH',
      url: base + '/branding',
      headers: { ...headers, 'if-match': String(rev) },
      payload,
    });
  assert.equal((await publish(body, foreign)).statusCode, 404);
  assert.equal((await publish(body, cashier)).statusCode, 403);
  for (const template of ['cafe', 'espresso', 'restaurant', 'bistro', 'barber', 'grooming']) {
    const r = await publish({ ...body, template });
    assert.equal(r.statusCode, 200, r.body);
    revision = r.json().merchant.revision;
  }
  const published = await app.inject({ url: base, headers: owner });
  assert.equal(published.json().merchant.template, 'grooming');
  assert.equal(published.json().merchant.stamp_icon, 'coffee');
  assert.equal(published.json().merchant.logo_style, 'plain');
  assert.equal(published.json().merchant.logo_size, 64);
  const cards = (await app.inject({ url: '/api/v1/me/memberships', headers: holder }))
    .json()
    .cards.filter((card: { merchant_id: string }) => card.merchant_id === ids.merchantA);
  assert.ok(cards.length > 0);
  for (const card of cards) {
    assert.equal(card.stamp_shape, 'seal');
    assert.equal(card.stamp_icon, 'coffee');
    assert.equal(card.stamp_style, 'outline');
    assert.equal(card.template, 'grooming');
    assert.equal(card.logo_style, 'plain');
    assert.equal(card.logo_size, 64);
    assert.equal(card.logo_asset_id, merchant.logo_asset_id);
    const detail = (
      await app.inject({ url: '/api/v1/me/memberships/' + card.id, headers: holder })
    ).json().card;
    assert.equal(detail.stamp_shape, 'seal');
    assert.equal(detail.stamp_icon, 'coffee');
    assert.equal(detail.stamp_style, 'outline');
    assert.equal(detail.logo_style, 'plain');
    assert.equal(detail.logo_size, 64);
    assert.equal(detail.logo_asset_id, merchant.logo_asset_id);
  }
  assert.equal((await publish(body, owner, revision - 1)).statusCode, 409);
  for (const invalid of [
    { stampShape: 'triangle' },
    { stampIcon: '<svg onload="alert(1)"/>' },
    { stampStyle: 'unsafe' },
    { template: 'missing-edition' },
    { logoStyle: 'unknown' },
    { logoSize: 500 },
    { logoSize: 40.5 },
  ])
    assert.equal((await publish({ ...body, ...invalid })).statusCode, 422);
  const {
    stampShape: _shape,
    stampIcon: _icon,
    stampStyle: _style,
    logoStyle: _logo,
    logoSize: _size,
    ...legacy
  } = body;
  const omitted = await publish(legacy as typeof body);
  assert.equal(omitted.statusCode, 200, omitted.body);
  revision = omitted.json().merchant.revision;
  assert.equal(omitted.json().merchant.stamp_icon, 'coffee');
  assert.equal(omitted.json().merchant.logo_style, 'plain');
  assert.equal(omitted.json().merchant.logo_size, 64);
  assert.deepEqual(await state(), before);
  const restored = await publish({
    ...body,
    template: merchant.template,
    stampShape: merchant.stamp_shape,
    stampIcon: merchant.stamp_icon,
    stampStyle: merchant.stamp_style,
    logoStyle: merchant.logo_style,
    logoSize: merchant.logo_size,
  });
  assert.equal(restored.statusCode, 200);
});
