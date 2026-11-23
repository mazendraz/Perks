import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer, type ServerHttp2Session } from 'node:http2';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../apps/api/src/server.js';
import { scrubWalletLog } from '../../apps/api/src/modules/wallet.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed, ids } from '../../db/seed.js';
import { login, key } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';
import { testWalletCertificates } from '../wallet-certs.js';
import { walletDesignSignature } from '../../apps/api/src/wallet/design-signature.js';
import {
  appleWalletPush,
  resetAppleWalletPush,
  runAppleWalletPushes,
} from '../../apps/worker/src/apple-wallet-push.js';

const passTypeId = 'pass.test.perks.loyalty',
  origin = 'https://wallet.perks.test';
process.env.PUBLIC_APP_ORIGIN = origin;
const certs = testWalletCertificates(passTypeId);
const overrides = {
  APP_ENV: 'test' as const,
  LOG_LEVEL: 'silent' as const,
  PUBLIC_APP_ORIGIN: origin,
  APPLE_WALLET_ENABLED: 'true' as const,
  // Only Apple here, whatever the developer's own .env turns on.
  GOOGLE_WALLET_ENABLED: 'false' as const,
  APPLE_PASS_TYPE_ID: passTypeId,
  APPLE_TEAM_ID: 'ABCDE12345',
  ...certs.files,
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
  const headers = await login(app, 'wallet-' + randomUUID() + '@example.test'),
    p = (await app.inject({ url: '/api/v1/public/merchants/bunn' })).json().programs[0];
  const joined = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...headers, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: p.id,
      programVersionId: p.versionId,
      alias: 'عميل والت',
      acceptedTerms: true,
      acceptedTermsHash: p.termsHash,
    },
  });
  assert.equal(joined.statusCode, 200);
  return { id: joined.json().membershipId as string, headers, rewardTitle: p.rewardTitle };
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
        reference: 'WL-' + randomUUID(),
        businessDate: businessDate('Africa/Cairo'),
      },
      presentationContext: qr.json().token,
    },
  });
  assert.equal(r.statusCode, 200);
}
// Reads the STORE-only archive the API writes.
function unzip(buffer: Buffer) {
  const files = new Map<string, Buffer>();
  let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const size = buffer.readUInt32LE(at + 18),
      nameLength = buffer.readUInt16LE(at + 26),
      name = buffer.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    files.set(name, buffer.subarray(at + 30 + nameLength, at + 30 + nameLength + size));
    at += 30 + nameLength + size;
  }
  return files;
}
const service = '/api/v1/wallet/apple/v1';

test('a customer downloads a signed pass for their own card only', async () => {
  const m = await member();
  await award(m, 2);
  assert.deepEqual((await app.inject({ url: '/api/v1/wallet/availability' })).json(), {
    apple: true,
    google: false,
  });
  const r = await app.inject({
    url: '/api/v1/me/memberships/' + m.id + '/wallet/apple',
    headers: { cookie: m.headers.cookie },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['content-type'], 'application/vnd.apple.pkpass');
  const files = unzip(r.rawPayload);
  for (const name of [
    'pass.json',
    'manifest.json',
    'signature',
    'icon.png',
    'icon@2x.png',
    'strip@2x.png',
    'ar.lproj/pass.strings',
    'en.lproj/pass.strings',
  ])
    assert.ok(files.has(name), name);
  const manifest = JSON.parse(files.get('manifest.json')!.toString());
  for (const [name, digest] of Object.entries(manifest))
    assert.equal(createHash('sha1').update(files.get(name)!).digest('hex'), digest, name);
  assert.equal(Object.keys(manifest).length, files.size - 2);
  const work = mkdtempSync(join(tmpdir(), 'perks-pass-'));
  writeFileSync(join(work, 'manifest.json'), files.get('manifest.json')!);
  writeFileSync(join(work, 'signature'), files.get('signature')!);
  execFileSync(
    'openssl',
    [
      'smime',
      '-verify',
      '-binary',
      '-inform',
      'DER',
      '-in',
      join(work, 'signature'),
      '-content',
      join(work, 'manifest.json'),
      '-CAfile',
      certs.files.APPLE_WWDR_CERT_FILE,
      '-purpose',
      'any',
      '-out',
      join(work, 'verified-manifest.json'),
    ],
    { stdio: 'pipe' },
  );
  assert.deepEqual(readFileSync(join(work, 'verified-manifest.json')), files.get('manifest.json'));
  const pass = JSON.parse(files.get('pass.json')!.toString());
  assert.equal(pass.passTypeIdentifier, passTypeId);
  assert.equal(pass.teamIdentifier, 'ABCDE12345');
  assert.equal(pass.webServiceURL, origin + '/api/v1/wallet/apple');
  assert.equal(pass.storeCard.headerFields[0].value, '2/5');
  assert.deepEqual(
    pass.storeCard.auxiliaryFields.map((field: { key: string }) => field.key),
    ['left'],
  );
  assert.deepEqual(
    pass.posterGeneric.footerFields.map((field: { key: string }) => field.key),
    ['edition'],
  );
  assert.ok(!JSON.stringify(pass).includes('"card_number"'));
  for (const lang of ['ar', 'en'])
    assert.ok(
      !files
        .get(lang + '.lproj/pass.strings')!
        .toString('utf16le')
        .includes('card_number'),
    );
  assert.equal(pass.barcodes, undefined, 'the pass is a card face with no QR');
  assert.equal(pass.barcode, undefined);
  // The link carries the Wallet restore key, so it lives in the strings files, not in pass.json.
  const cardLink = origin + '/customer/open?w=' + m.id + '.1.';
  assert.equal(
    pass.storeCard.backFields.find((field: { key: string }) => field.key === 'open')
      .attributedValue,
    'open_link',
  );
  assert.ok(!files.get('pass.json')!.toString().includes('?w='));
  for (const lang of ['ar', 'en'])
    assert.ok(
      files
        .get(lang + '.lproj/pass.strings')!
        .toString('utf16le')
        .includes(cardLink),
    );
  assert.equal(
    pass.storeCard.backFields.find((field: { key: string }) => field.key === 'member').value,
    'عميل والت',
  );
  assert.equal(pass.storeCard.secondaryFields[0].value, m.rewardTitle);
  const stripMetadata = await (
    await import('sharp')
  )
    .default(files.get('strip@3x.png')!)
    .metadata();
  assert.deepEqual([stripMetadata.width, stripMetadata.height], [1125, 432]);
  // iOS 27 poster face, with the store card kept for older iPhones.
  assert.equal(pass.posterGeneric.headerFields[0].value, '2/5');
  assert.equal(pass.posterGeneric.primaryFields[0].value, m.rewardTitle);
  assert.equal(pass.posterGeneric.primaryFields[0].textAlignment, 'PKTextAlignmentCenter');
  assert.ok(pass.storeCard, 'store card fallback stays');
  const artwork = await (await import('sharp')).default(files.get('artwork@3x.png')!).metadata();
  assert.deepEqual([artwork.width, artwork.height], [1074, 1344]);
  assert.ok(files.has('ar.lproj/artwork@3x.png'));
  const staticScan = await app.inject({
    method: 'POST',
    url: '/api/v1/cashier/scans/resolve',
    headers: cashier,
    payload: { merchantId: ids.merchantA, branchId: ids.branchA, token: cardLink },
  });
  assert.equal(staticScan.statusCode, 422, 'Wallet link cannot replace a live holder proof');
  assert.equal(staticScan.json().error.code, 'TOKEN_INVALID');
  assert.ok(!JSON.stringify(pass.storeCard).includes(pass.authenticationToken));
  assert.match(
    files.get('ar.lproj/pass.strings')!.toString('utf16le'),
    /"progress_value" = "باقي 3 أختام على المكافأة";/,
  );
  const again = unzip(
    (
      await app.inject({
        url: '/api/v1/me/memberships/' + m.id + '/wallet/apple',
        headers: { cookie: m.headers.cookie },
      })
    ).rawPayload,
  );
  const second = JSON.parse(again.get('pass.json')!.toString());
  assert.equal(second.serialNumber, pass.serialNumber);
  assert.equal(second.authenticationToken, pass.authenticationToken);
  const stranger = await member();
  const denied = await app.inject({
    url: '/api/v1/me/memberships/' + m.id + '/wallet/apple',
    headers: { cookie: stranger.headers.cookie },
  });
  assert.equal(denied.statusCode, 404);
  const anonymous = await app.inject({ url: '/api/v1/me/memberships/' + m.id + '/wallet/apple' });
  assert.equal(anonymous.statusCode, 401);
});

test('Apple registers a device, gets pushed after a stamp and fetches the updated pass', async () => {
  const m = await member();
  await award(m, 1);
  const pass = JSON.parse(
    unzip(
      (
        await app.inject({
          url: '/api/v1/me/memberships/' + m.id + '/wallet/apple',
          headers: { cookie: m.headers.cookie },
        })
      ).rawPayload,
    )
      .get('pass.json')!
      .toString(),
  );
  const serial = pass.serialNumber as string,
    auth = { authorization: 'ApplePass ' + pass.authenticationToken },
    deviceId = 'device' + randomUUID().replaceAll('-', ''),
    pushToken = 'ab'.repeat(32),
    registration = service + '/devices/' + deviceId + '/registrations/' + passTypeId + '/' + serial;
  const wrong = await app.inject({
    method: 'POST',
    url: registration,
    headers: { authorization: 'ApplePass nope' },
    payload: { pushToken },
  });
  assert.equal(wrong.statusCode, 401);
  const otherType = await app.inject({
    method: 'POST',
    url: service + '/devices/' + deviceId + '/registrations/pass.other/' + serial,
    headers: auth,
    payload: { pushToken },
  });
  assert.equal(otherType.statusCode, 404);
  assert.equal(
    (await app.inject({ method: 'POST', url: registration, headers: auth, payload: { pushToken } }))
      .statusCode,
    201,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: registration, headers: auth, payload: { pushToken } }))
      .statusCode,
    200,
  );
  const list = await app.inject({
    url: service + '/devices/' + deviceId + '/registrations/' + passTypeId,
  });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().serialNumbers, [serial]);
  const tag = list.json().lastUpdated as string;
  assert.equal(
    (
      await app.inject({
        url:
          service +
          '/devices/' +
          deviceId +
          '/registrations/' +
          passTypeId +
          '?passesUpdatedSince=' +
          tag,
      })
    ).statusCode,
    204,
  );
  const first = await app.inject({
    url: service + '/passes/' + passTypeId + '/' + serial,
    headers: auth,
  });
  assert.equal(first.statusCode, 200);
  const lastModified = String(first.headers['last-modified']);
  assert.equal(
    (
      await app.inject({
        url: service + '/passes/' + passTypeId + '/' + serial,
        headers: { ...auth, 'if-modified-since': lastModified },
      })
    ).statusCode,
    304,
  );
  // Nothing changed yet, so the worker pushes nothing.
  const pushed: string[] = [];
  const fake = async (token: string) => {
    pushed.push(token);
    return 200;
  };
  await runAppleWalletPushes(worker, c, fake);
  assert.deepEqual(pushed, []);
  await new Promise((r) => setTimeout(r, 1100));
  await award(m, 2);
  assert.equal(await runAppleWalletPushes(worker, c, fake), 1);
  assert.deepEqual(pushed, [pushToken]);
  assert.equal(await runAppleWalletPushes(worker, c, fake), 0, 'one push per change');
  const changed = await app.inject({
    url:
      service +
      '/devices/' +
      deviceId +
      '/registrations/' +
      passTypeId +
      '?passesUpdatedSince=' +
      tag,
  });
  assert.equal(changed.statusCode, 200);
  assert.deepEqual(changed.json().serialNumbers, [serial]);
  const updated = await app.inject({
    url: service + '/passes/' + passTypeId + '/' + serial,
    headers: { ...auth, 'if-modified-since': lastModified },
  });
  assert.equal(updated.statusCode, 200);
  const next = JSON.parse(unzip(updated.rawPayload).get('pass.json')!.toString());
  assert.equal(next.storeCard.headerFields[0].value, '3/5');
  assert.equal(
    (
      await app.inject({
        url: service + '/passes/' + passTypeId + '/' + serial,
        headers: { authorization: 'ApplePass ' + 'x'.repeat(43) },
      })
    ).statusCode,
    401,
  );
  // A request error leaves the device registered. A 410 retires its token.
  await award(m, 1);
  assert.equal(await runAppleWalletPushes(worker, c, async () => 400), 0);
  const stillRegistered = await app.inject({
    url: service + '/devices/' + deviceId + '/registrations/' + passTypeId,
  });
  assert.deepEqual(stillRegistered.json().serialNumbers, [serial]);
  // The refused update waits for a retry (a 400 is usually our own configuration).
  assert.equal(
    (await db.query('SELECT push_attempts FROM wallet_passes WHERE serial=$1', [serial])).rows[0]
      .push_attempts,
    1,
  );
  await db.query('UPDATE wallet_passes SET push_attempts=0,push_retry_at=NULL WHERE serial=$1', [
    serial,
  ]);
  // APNs down or throttling: the update is kept and pushed again after a backoff, not lost.
  await award(m, 1);
  let calls = 0;
  const failing = async () => {
    calls++;
    return 503;
  };
  assert.equal(await runAppleWalletPushes(worker, c, failing), 0);
  assert.equal(calls, 1);
  const backoff = (
    await db.query(
      'SELECT push_attempts,push_retry_at>now() AS waiting FROM wallet_passes WHERE serial=$1',
      [serial],
    )
  ).rows[0];
  assert.deepEqual(backoff, { push_attempts: 1, waiting: true });
  assert.equal(await runAppleWalletPushes(worker, c, failing), 0);
  assert.equal(calls, 1, 'nothing is pushed while the pass waits for its retry');
  await db.query(
    "UPDATE wallet_passes SET push_retry_at=now()-interval '1 second' WHERE serial=$1",
    [serial],
  );
  assert.equal(await runAppleWalletPushes(worker, c, fake), 1, 'the retry goes out');
  assert.deepEqual(
    (
      await db.query('SELECT push_attempts,push_retry_at FROM wallet_passes WHERE serial=$1', [
        serial,
      ])
    ).rows[0],
    { push_attempts: 0, push_retry_at: null },
  );
  await db.query("UPDATE wallet_passes SET fingerprint='' WHERE serial=$1", [serial]);
  assert.equal(await runAppleWalletPushes(worker, c, async () => 410), 0);
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM wallet_registrations WHERE serial=$1', [
        serial,
      ])
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: registration, headers: auth, payload: { pushToken } }))
      .statusCode,
    201,
  );
  assert.equal(
    (await app.inject({ method: 'DELETE', url: registration, headers: auth })).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        url: service + '/devices/' + deviceId + '/registrations/' + passTypeId,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: service + '/log', payload: { logs: ['x'] } }))
      .statusCode,
    200,
  );
});

test('the runtime role cannot read wallet tables directly', async () => {
  const runtime = new pg.Client({ connectionString: c.DATABASE_URL });
  await runtime.connect();
  try {
    await assert.rejects(runtime.query('SELECT * FROM wallet_passes'));
    await assert.rejects(runtime.query('SELECT * FROM wallet_registrations'));
    await assert.rejects(runtime.query('SELECT wallet_claim_changes()'));
  } finally {
    await runtime.end();
  }
  assert.ok(readFileSync(certs.files.APPLE_PASS_KEY_FILE, 'utf8').includes('PRIVATE KEY'));
});

test('a closed card pushes a voided pass and then forgets its devices', async () => {
  const m = await member();
  const pass = JSON.parse(
    unzip(
      (
        await app.inject({
          url: '/api/v1/me/memberships/' + m.id + '/wallet/apple',
          headers: { cookie: m.headers.cookie },
        })
      ).rawPayload,
    )
      .get('pass.json')!
      .toString(),
  );
  const auth = { authorization: 'ApplePass ' + pass.authenticationToken },
    deviceId = 'device' + randomUUID().replaceAll('-', '');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url:
          service +
          '/devices/' +
          deviceId +
          '/registrations/' +
          passTypeId +
          '/' +
          pass.serialNumber,
        headers: auth,
        payload: { pushToken: 'cd'.repeat(32) },
      })
    ).statusCode,
    201,
  );
  await db.query("UPDATE memberships SET status='suspended' WHERE id=$1", [m.id]);
  assert.equal(await runAppleWalletPushes(worker, c, async () => 200), 1);
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM wallet_registrations WHERE serial=$1', [
        pass.serialNumber,
      ])
    ).rows[0].n,
    0,
  );
  const voided = await app.inject({
    url: service + '/passes/' + passTypeId + '/' + pass.serialNumber,
    headers: auth,
  });
  const files = unzip(voided.rawPayload);
  assert.equal(JSON.parse(files.get('pass.json')!.toString()).voided, true);
  assert.ok(!files.get('pass.json')!.toString().includes('"card_number"'));
  assert.ok(
    !files.get('pass.json')!.toString().includes('عميل والت'),
    'revocation clears the displayed member name',
  );
  // The seeded program is Arabic, so every phone language gets the Arabic words.
  assert.match(files.get('en.lproj/pass.strings')!.toString('utf16le'), /الكارت ده اتقفل/);
  assert.equal(
    (
      await app.inject({
        url: '/api/v1/me/memberships/' + m.id + '/wallet/apple',
        headers: { cookie: m.headers.cookie },
      })
    ).statusCode,
    404,
  );
});

test('Wallet requests use APNs background priority and an empty payload', async () => {
  const server = createServer();
  const sessions = new Set<ServerHttp2Session>();
  server.on('session', (session) => {
    sessions.add(session);
    session.on('close', () => sessions.delete(session));
  });
  server.on('stream', (stream, headers) => {
    let body = '';
    stream.setEncoding('utf8').on('data', (chunk: string) => {
      body += chunk;
    });
    stream.on('end', () => {
      const valid =
        headers['apns-push-type'] === 'background' &&
        headers['apns-priority'] === '5' &&
        headers['apns-topic'] === passTypeId &&
        body === '{}';
      stream.respond({ ':status': valid ? 200 : 400 });
      stream.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const push = appleWalletPush({ ...c, APPLE_APNS_ORIGIN: `http://127.0.0.1:${address.port}` });
    assert.ok(push);
    assert.equal(await push('ab'.repeat(32)), 200);
  } finally {
    for (const session of sessions) session.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('APNs refusals with a reason body and unanswered requests never hang the worker', async () => {
  const server = createServer();
  const sessions = new Set<ServerHttp2Session>();
  server.on('session', (session) => {
    sessions.add(session);
    session.on('close', () => sessions.delete(session));
  });
  server.on('stream', (stream, headers) => {
    const path = String(headers[':path']);
    stream.resume();
    // Silent: accept the request and never answer, like a stalled connection.
    if (path.endsWith('cd'.repeat(32))) return;
    const status = path.endsWith('ef'.repeat(32)) ? 410 : 400;
    stream.respond({ ':status': status, 'content-type': 'application/json' });
    // APNs always explains a refusal in a JSON body; the old client never read it and hung.
    stream.end(JSON.stringify({ reason: status === 410 ? 'Unregistered' : 'BadDeviceToken' }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    resetAppleWalletPush(1500);
    const push = appleWalletPush({ ...c, APPLE_APNS_ORIGIN: `http://127.0.0.1:${address.port}` });
    assert.ok(push);
    let started = Date.now();
    assert.equal(await push('ab'.repeat(32)), 400);
    assert.equal(await push('ef'.repeat(32)), 410);
    assert.ok(Date.now() - started < 1000, 'refusals answer at once');
    started = Date.now();
    assert.equal(await push('cd'.repeat(32)), 0, 'an unanswered request gives up');
    assert.ok(Date.now() - started < 4000);
  } finally {
    resetAppleWalletPush();
    for (const session of sessions) session.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('a phone downloading the pass with a shop message confirms that message reached it', async () => {
  const m = await member();
  const download = await app.inject({
    url: '/api/v1/me/memberships/' + m.id + '/wallet/apple',
    headers: { cookie: m.headers.cookie },
  });
  const pass = JSON.parse(unzip(download.rawPayload).get('pass.json')!.toString());
  const serial = pass.serialNumber as string,
    auth = { authorization: 'ApplePass ' + pass.authenticationToken };
  const who = (await db.query('SELECT user_id,profile_id FROM memberships WHERE id=$1', [m.id]))
    .rows[0];
  await db.query(
    `INSERT INTO consent_current(merchant_id,user_id,channel,granted) VALUES($1,$2,'push',true)
     ON CONFLICT DO NOTHING`,
    [ids.merchantA, who.user_id],
  );
  await db.query(
    "UPDATE consent_current SET granted=true WHERE merchant_id=$1 AND user_id=$2 AND channel='push'",
    [ids.merchantA, who.user_id],
  );
  const message = (
    await db.query(
      `INSERT INTO wallet_messages(merchant_id,audience,body_ar,recipients,send_after,created_by)
       VALUES($1,'all','عرض النهارده',1,now(),$2) RETURNING id`,
      [ids.merchantA, ids.ownerA],
    )
  ).rows[0].id;
  const delivery = (
    await db.query(
      `INSERT INTO wallet_message_deliveries(message_id,merchant_id,profile_id,membership_id,channel,next_at,status)
       VALUES($1,$2,$3,$4,'apple',now(),'accepted') RETURNING id`,
      [message, ids.merchantA, who.profile_id, m.id],
    )
  ).rows[0].id;
  const fetched = async () =>
    (
      await db.query(
        'SELECT fetched_at IS NOT NULL AS f FROM wallet_message_deliveries WHERE id=$1',
        [delivery],
      )
    ).rows[0].f;
  assert.equal(await fetched(), false);
  const updated = await app.inject({
    url: service + '/passes/' + passTypeId + '/' + serial,
    headers: auth,
  });
  assert.equal(updated.statusCode, 200);
  const back = JSON.parse(unzip(updated.rawPayload).get('pass.json')!.toString());
  assert.match(
    back.posterGeneric.backFields.find((f: { key: string }) => f.key === 'reminder').value,
    /^reminder_/,
    'the iOS 27 face carries the message too',
  );
  assert.equal(await fetched(), true);
});

test('Wallet device logs keep the reason and drop identifiers', () => {
  const line =
    '[2026-11-22 10:00:01 +0200] Get pass task (pass type pass.test.perks.loyalty, serial number ' +
    '3f6c1d2e-8a41-4b7f-9a0c-2b5e7d9f1a33, if-modified-since 1763800000; with web service url ' +
    'https://perks.example/api/v1/wallet/apple) encountered error: Authentication token ' +
    'Zk3mQp9rT2vX8yB1nC5dF7gH0jL4sW6e rejected for device ab12cd34ef56ab12cd34ef56';
  const scrubbed = scrubWalletLog(line);
  assert.match(scrubbed, /encountered error: Authentication token/);
  for (const secret of ['3f6c1d2e', 'perks.example', 'Zk3mQp9r', 'ab12cd34', '1763800000'])
    assert.ok(!scrubbed.includes(secret), secret);
});

test('a design-only update removes the number from a saved Apple pass without changing its serial', async () => {
  const signature = walletDesignSignature();
  await worker.query('SELECT wallet_design_sync($1)', ['before-number-face']);
  const m = await member();
  const download = () =>
    app.inject({
      url: '/api/v1/me/memberships/' + m.id + '/wallet/apple',
      headers: { cookie: m.headers.cookie },
    });
  const original = await download();
  assert.equal(original.statusCode, 200);
  const installed = JSON.parse(unzip(original.rawPayload).get('pass.json')!.toString());
  const serial = installed.serialNumber as string;
  const deviceId = 'design' + randomUUID().replaceAll('-', '');
  const pushToken = 'ef'.repeat(32);
  const listUrl = service + '/devices/' + deviceId + '/registrations/' + passTypeId;
  const appleHeaders = { authorization: 'ApplePass ' + installed.authenticationToken };
  const register = await app.inject({
    method: 'POST',
    url: listUrl + '/' + serial,
    headers: appleHeaders,
    payload: { pushToken },
  });
  assert.equal(register.statusCode, 201);

  // Model the previous release's number-bearing payload and Last-Modified date.
  await db.query(
    `UPDATE wallet_passes w SET changed_at=clock_timestamp()-interval '2 minutes',
      fingerprint=wallet_fingerprint(wallet_card_json(w.membership_id)||jsonb_build_object('card_number',n.card_number))
      FROM membership_card_numbers n WHERE w.serial=$1 AND n.membership_id=w.membership_id`,
    [serial],
  );
  await db.query('UPDATE wallet_passes SET design_sent=$1 WHERE serial<>$2', [signature, serial]);
  const previousTag = (await app.inject(listUrl)).json().lastUpdated as string;
  const passUrl = service + '/passes/' + passTypeId + '/' + serial;
  const previous = await app.inject({ url: passUrl, headers: appleHeaders });
  assert.equal(previous.statusCode, 200);
  const oldDate = String(previous.headers['last-modified']);
  const conditionalHeaders = { ...appleHeaders, 'if-modified-since': oldDate };
  assert.equal((await app.inject({ url: passUrl, headers: conditionalHeaders })).statusCode, 304);

  // No stamp or membership change. The worker queues the new design and notifies this serial.
  await worker.query('SELECT wallet_design_sync($1)', [signature]);
  const queue = await worker.query('SELECT wallet_design_resend(120,0) AS queued');
  assert.equal(queue.rows[0].queued, 1);
  const notified = new Set<string>();
  await runAppleWalletPushes(worker, c, async (token) => {
    notified.add(token);
    return 200;
  });
  assert.ok(notified.has(pushToken));
  const listed = await app.inject(listUrl + '?passesUpdatedSince=' + previousTag);
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json().serialNumbers, [serial]);

  const updated = await app.inject({ url: passUrl, headers: conditionalHeaders });
  const fresh = await download();
  assert.equal(updated.statusCode, 200);
  assert.equal(fresh.statusCode, 200);
  assert.ok(Date.parse(String(updated.headers['last-modified'])) > Date.parse(oldDate));
  const updateFiles = unzip(updated.rawPayload);
  const freshFiles = unzip(fresh.rawPayload);
  assert.deepEqual(updateFiles.get('pass.json'), freshFiles.get('pass.json'));
  for (const asset of ['artwork@3x.png', 'ar.lproj/artwork@3x.png', 'strip@3x.png'])
    assert.deepEqual(updateFiles.get(asset), freshFiles.get(asset));
  const pass = JSON.parse(updateFiles.get('pass.json')!.toString());
  assert.equal(pass.serialNumber, serial);
  assert.ok(!JSON.stringify(pass).includes('"card_number"'));
  assert.equal(pass.barcode, undefined);
  assert.equal(pass.barcodes, undefined);
  assert.ok(updateFiles.has('signature'));
});
