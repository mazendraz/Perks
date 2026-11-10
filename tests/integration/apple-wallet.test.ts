import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed, ids } from '../../db/seed.js';
import { login, key } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';
import { testWalletCertificates } from '../wallet-certs.js';
import { runAppleWalletPushes } from '../../apps/worker/src/apple-wallet-push.js';

const passTypeId = 'pass.test.perks.loyalty',
  origin = 'https://wallet.perks.test';
process.env.PUBLIC_APP_ORIGIN = origin;
const certs = testWalletCertificates(passTypeId);
const overrides = {
  APP_ENV: 'test' as const,
  LOG_LEVEL: 'silent' as const,
  PUBLIC_APP_ORIGIN: origin,
  APPLE_WALLET_ENABLED: 'true' as const,
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
  assert.equal(pass.barcodes[0].format, 'PKBarcodeFormatQR');
  assert.equal(pass.barcodes[0].message, origin + '/customer/' + m.id + '?wallet=1');
  assert.equal(pass.storeCard.secondaryFields[0].value, 'عميل والت');
  assert.equal(pass.storeCard.auxiliaryFields[0].value, m.rewardTitle);
  const stripMetadata = await (
    await import('sharp')
  )
    .default(files.get('strip@3x.png')!)
    .metadata();
  assert.deepEqual([stripMetadata.width, stripMetadata.height], [1125, 432]);
  const staticScan = await app.inject({
    method: 'POST',
    url: '/api/v1/cashier/scans/resolve',
    headers: cashier,
    payload: { merchantId: ids.merchantA, branchId: ids.branchA, token: pass.barcodes[0].message },
  });
  assert.equal(staticScan.statusCode, 422, 'Wallet link cannot replace a live holder proof');
  assert.equal(staticScan.json().error.code, 'TOKEN_INVALID');
  assert.ok(!pass.barcodes[0].message.includes(pass.authenticationToken));
  assert.match(
    files.get('ar.lproj/pass.strings')!.toString('utf16le'),
    /"status_value" = "باقي 3 أختام على المكافأة";/,
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
  // A device that removed the pass answers 410; its token is forgotten.
  await award(m, 1);
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
  assert.ok(
    !files.get('pass.json')!.toString().includes('عميل والت'),
    'revocation clears the displayed member name',
  );
  assert.match(files.get('en.lproj/pass.strings')!.toString('utf16le'), /This card is closed/);
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
