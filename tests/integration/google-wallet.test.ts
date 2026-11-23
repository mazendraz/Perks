import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createVerify, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed, ids } from '../../db/seed.js';
import { login, key } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';
import { loadGoogleWallet } from '../../apps/api/src/wallet/google-wallet.js';
import { runGoogleWalletUpdates } from '../../apps/worker/src/google-wallet-updates.js';

const origin = 'https://wallet.perks.test',
  issuer = '3388000000099999999';
process.env.PUBLIC_APP_ORIGIN = origin;
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const dir = mkdtempSync(join(tmpdir(), 'perks-google-'));
const accountFile = join(dir, 'service-account.json');
writeFileSync(
  accountFile,
  JSON.stringify({
    type: 'service_account',
    client_email: 'perks-wallet@perks-test.iam.gserviceaccount.com',
    private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }),
  { mode: 0o600 },
);
const overrides = {
  APP_ENV: 'test' as const,
  LOG_LEVEL: 'silent' as const,
  PUBLIC_APP_ORIGIN: origin,
  GOOGLE_WALLET_ENABLED: 'true' as const,
  // Only Google here, whatever the developer's own .env turns on.
  APPLE_WALLET_ENABLED: 'false' as const,
  GOOGLE_WALLET_ISSUER_ID: issuer,
  GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: accountFile,
};
const c = readConfig(overrides),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL, max: 1 }),
  { app } = await buildApp(overrides);
let cashier: Awaited<ReturnType<typeof login>>;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  cashier = await login(app, 'cashier@bunn.test');
});
after(async () => {
  await app.close();
  await worker.end();
  await db.end();
});
async function member() {
  const headers = await login(app, 'gwallet-' + randomUUID() + '@example.test'),
    p = (await app.inject({ url: '/api/v1/public/merchants/bunn' })).json().programs[0];
  const joined = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...headers, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: p.id,
      programVersionId: p.versionId,
      alias: 'عميل جوجل',
      acceptedTerms: true,
      acceptedTermsHash: p.termsHash,
    },
  });
  assert.equal(joined.statusCode, 200);
  return { id: joined.json().membershipId as string, headers };
}
async function award(m: Awaited<ReturnType<typeof member>>, quantity: number) {
  const qr = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships/' + m.id + '/presentation-tokens',
    headers: { ...m.headers, ...key() },
    payload: {},
  });
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/stamp-awards',
    headers: { ...cashier, ...key() },
    payload: {
      branchId: ids.branchA,
      membershipId: m.id,
      quantity,
      purchaseReference: {
        namespace: 'manual',
        reference: 'GW-' + randomUUID(),
        businessDate: businessDate('Africa/Cairo'),
      },
      presentationContext: qr.json().token,
    },
  });
  assert.equal(r.statusCode, 200);
}
function readJwt(url: string) {
  const jwt = url.replace('https://pay.google.com/gp/v/save/', '');
  const [header, body, signature] = jwt.split('.');
  assert.ok(
    createVerify('RSA-SHA256')
      .update(header + '.' + body)
      .verify(keys.publicKey, signature!, 'base64url'),
    'JWT is signed by the service account',
  );
  return JSON.parse(Buffer.from(body!, 'base64url').toString());
}
async function save(m: Awaited<ReturnType<typeof member>>) {
  const r = await app.inject({
    url: '/api/v1/me/memberships/' + m.id + '/wallet/google',
    headers: { cookie: m.headers.cookie },
  });
  assert.equal(r.statusCode, 303);
  return readJwt(String(r.headers.location));
}
type Patch = {
  loyaltyPoints: { balance: { string: string } };
  notifyPreference?: string;
  heroImage: { sourceUri: { uri: string } };
};
type Call = { url: string; method: string; body: Record<string, unknown> | string };
function fakeGoogle(status: (call: Call) => number, saved: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const call = {
      url,
      method: String(init.method ?? 'GET'),
      body: url.includes('oauth2')
        ? String(init.body)
        : init.body === undefined
          ? {}
          : (JSON.parse(String(init.body)) as Record<string, unknown>),
    };
    calls.push(call);
    if (url.includes('oauth2'))
      return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }));
    // Reading the saved card returns it (with any messages the shop added).
    if (call.method === 'GET') {
      const code = status(call);
      return new Response(code === 200 ? JSON.stringify(saved) : '{}', { status: code });
    }
    return new Response('{}', { status: status(call) });
  }) as typeof fetch;
  return { calls, g: loadGoogleWallet(c, fetchImpl)! };
}

test('the save link is a signed JWT with the member name and no QR', async () => {
  assert.deepEqual((await app.inject({ url: '/api/v1/wallet/availability' })).json(), {
    apple: false,
    google: true,
  });
  const m = await member();
  await award(m, 2);
  const claims = await save(m);
  assert.equal(claims.aud, 'google');
  assert.equal(claims.typ, 'savetowallet');
  assert.equal(claims.iss, 'perks-wallet@perks-test.iam.gserviceaccount.com');
  const object = claims.payload.loyaltyObjects[0],
    klass = claims.payload.loyaltyClasses[0];
  assert.equal(klass.id, issuer + '.perks-merchant-' + ids.merchantA);
  assert.equal(object.classId, klass.id);
  assert.match(object.id, new RegExp('^' + issuer + '\\.perks-card-[0-9a-f-]{36}$'));
  assert.equal(object.loyaltyPoints.balance.string, '2/5');
  assert.equal(object.state, 'ACTIVE');
  assert.equal(object.barcode, undefined, 'the card carries no QR');
  assert.match(object.accountId, /^[0-9]{6}$/);
  assert.equal(klass.localizedAccountIdLabel.defaultValue.value, 'رقم الكارت');
  assert.deepEqual(object.secondaryLoyaltyPoints.balance, { int: 3 });
  // The link carries the Wallet restore key (behind a description, never shown as text).
  const link = object.linksModuleData.uris[0].uri as string;
  assert.ok(link.startsWith(origin + '/customer/open?w=' + m.id + '.1.'), link);
  assert.equal(link.split('.').at(-1)!.length, 32);
  assert.equal(object.accountName, 'عميل جوجل');
  const publicCard = (
    await db.query('SELECT google_wallet_strip($1) AS card', [object.id.split('perks-card-')[1]])
  ).rows[0].card;
  assert.equal(
    publicCard.customer_name,
    undefined,
    'public artwork projection never exposes the member name',
  );
  assert.equal(publicCard.card_number, undefined, 'public artwork does not expose the card number');
  assert.equal((await save(m)).payload.loyaltyObjects[0].id, object.id, 'stable object id');
  const strip = await app.inject({ url: object.heroImage.sourceUri.uri.replace(origin, '') });
  assert.equal(strip.statusCode, 200);
  assert.equal(strip.headers['content-type'], 'image/png');
  const meta = await sharp(strip.rawPayload).metadata();
  assert.deepEqual([meta.width, meta.height], [1032, 812]);
  assert.equal(
    (
      await app.inject({
        url: '/api/v1/public/wallet/google/strips/' + randomUUID() + '/0123456789ab.png',
      })
    ).statusCode,
    404,
  );
  const stranger = await member();
  assert.equal(
    (
      await app.inject({
        url: '/api/v1/me/memberships/' + m.id + '/wallet/google',
        headers: { cookie: stranger.headers.cookie },
      })
    ).statusCode,
    404,
  );
});

test('a saved Google pass gets its card number when its pre-number fingerprint is refreshed', async () => {
  const m = await member();
  const object = (await save(m)).payload.loyaltyObjects[0];
  await db.query(
    `UPDATE google_wallet_objects SET fingerprint=wallet_fingerprint(
      wallet_card_json(membership_id)-'reminder_templates'-'manual_message'
    ) WHERE membership_id=$1`,
    [m.id],
  );
  const google = fakeGoogle(() => 200);
  await runGoogleWalletUpdates(worker, c, google.g);
  const updated = google.calls.find((call) => call.method === 'PUT' && call.url.endsWith(object.id));
  assert.equal((updated?.body as Record<string, unknown>)?.accountId, object.accountId);
  const klass = google.calls.find(
    (call) => call.method === 'PATCH' && call.url.endsWith(object.classId),
  );
  assert.equal((klass?.body as Record<string, unknown>)?.accountIdLabel, 'Card number');
  google.calls.length = 0;
  await runGoogleWalletUpdates(worker, c, google.g);
  assert.equal(google.calls.filter((call) => call.url.endsWith(object.id)).length, 0);
});

test('a stamp sends the new balance to Google with a notification, once', async () => {
  const m = await member();
  await award(m, 1);
  const object = (await save(m)).payload.loyaltyObjects[0];
  const ok = fakeGoogle(() => 200);
  await runGoogleWalletUpdates(worker, c, ok.g);
  assert.equal(ok.calls.filter((x) => x.url.includes(object.id)).length, 0, 'nothing changed');
  await award(m, 2);
  await runGoogleWalletUpdates(worker, c, ok.g);
  const patch = ok.calls.find(
    (x) => x.method === 'PUT' && x.url.endsWith('/loyaltyObject/' + encodeURIComponent(object.id)),
  );
  assert.ok(patch);
  // The whole card is replaced, so fields no longer sent (an old QR code) are removed.
  assert.equal(patch.method, 'PUT');
  assert.equal((patch.body as Record<string, unknown>).barcode, undefined);
  const body = patch.body as unknown as Patch;
  assert.equal(body.loyaltyPoints.balance.string, '3/5');
  assert.equal(body.notifyPreference, 'notifyOnUpdate');
  assert.notEqual(body.heroImage.sourceUri.uri, object.heroImage.sourceUri.uri, 'new strip URL');
  assert.ok(ok.calls.some((x) => x.url.includes('/loyaltyClass/')));
  const before = ok.calls.length;
  await runGoogleWalletUpdates(worker, c, ok.g);
  assert.equal(ok.calls.filter((x) => x.method === 'PUT' && x.url.includes(object.id)).length, 1);
  assert.ok(ok.calls.length - before <= 2);

  // Google down: retried next round. Never saved (404): dropped quietly.
  await award(m, 1);
  const down = fakeGoogle(() => 503);
  await runGoogleWalletUpdates(worker, c, down.g);
  const back = fakeGoogle(() => 200);
  await runGoogleWalletUpdates(worker, c, back.g);
  assert.equal(
    (
      back.calls.find((x) => x.method === 'PUT' && x.url.includes(encodeURIComponent(object.id)))!
        .body as unknown as Patch
    ).loyaltyPoints.balance.string,
    '4/5',
  );
  const quota = fakeGoogle((call) =>
    typeof call.body === 'object' && call.body.notifyPreference ? 429 : 200,
  );
  await db.query("UPDATE google_wallet_objects SET fingerprint='' WHERE membership_id=$1", [m.id]);
  await runGoogleWalletUpdates(worker, c, quota.g);
  const silent = quota.calls.filter(
    (x) => x.method === 'PUT' && x.url.includes(encodeURIComponent(object.id)),
  );
  assert.equal(silent.length, 2);
  assert.equal((silent[1]!.body as unknown as Patch).notifyPreference, undefined);

  // The shop's message on the saved card survives the stamp, without a second notification;
  // a message past its display window is dropped.
  const later = new Date(Date.now() + 86400000).toISOString(),
    gone = new Date(Date.now() - 86400000).toISOString();
  const keeps = fakeGoogle(() => 200, {
    messages: [
      { id: 'live', messageType: 'TEXT_AND_NOTIFY', displayInterval: { end: { date: later } } },
      { id: 'old', messageType: 'TEXT_AND_NOTIFY', displayInterval: { end: { date: gone } } },
    ],
  });
  await award(m, 1);
  await runGoogleWalletUpdates(worker, c, keeps.g);
  const kept = keeps.calls.find((x) => x.method === 'PUT' && x.url.includes(object.id))!.body as {
    messages?: { id: string; messageType: string }[];
  };
  assert.deepEqual(
    kept.messages?.map((x) => [x.id, x.messageType]),
    [['live', 'TEXT']],
  );
  // Throttled while reading the card: nothing is written (a PUT would lose the messages).
  await award(m, 1);
  const throttled = fakeGoogle((call) => (call.method === 'GET' ? 429 : 200));
  await runGoogleWalletUpdates(worker, c, throttled.g);
  assert.equal(throttled.calls.filter((x) => x.method === 'PUT').length, 0);
});

test('the runtime role cannot read Google Wallet rows or run the worker function', async () => {
  const runtime = new pg.Client({ connectionString: c.DATABASE_URL });
  await runtime.connect();
  try {
    await assert.rejects(runtime.query('SELECT * FROM google_wallet_objects'));
    await assert.rejects(runtime.query('SELECT * FROM google_wallet_claim_changes()'));
  } finally {
    await runtime.end();
  }
});
