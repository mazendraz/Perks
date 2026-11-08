import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, sep, basename } from 'node:path';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import pg from 'pg';
import sharp from 'sharp';
import { readConfig, type Config } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { createFileStore } from '../../apps/api/src/storage/file-store.js';
import { hashPassword } from '../../apps/api/src/passwords.js';
import { runOne } from '../../apps/worker/src/runner.js';
import { cleanupExports } from '../../apps/worker/src/export-cleanup.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL });
assert.match(new URL(c.DATABASE_MIGRATOR_URL!).pathname, /^\/nuqta_test_\d+$/);
const origin = 'https://storage.nuqta.test',
  email = 'store-' + randomUUID() + '@nuqta.test',
  password = 'Production storage owner fixture!';
let app: Awaited<ReturnType<typeof buildApp>>['app'],
  config: Config,
  root: string,
  merchant: string;
before(async () => {
  await db.connect();
  for (let i = 0; i < 200 && (await runOne(worker, c)); i++) {
    /* Drain other synthetic fixtures locally. */
  }
  root = await mkdtemp(resolve(tmpdir(), 'nuqta-store-prod-'));
  config = readConfig({
    APP_ENV: 'production',
    AUTH_PROVIDER: 'password',
    COOKIE_SECURE: 'true',
    PUBLIC_APP_ORIGIN: origin,
    STORAGE_ROOT: root,
    MAIL_TRANSPORT: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: 9,
    SMTP_USER: 'unused-test',
    SMTP_PASS: 'unused-test',
    SMTP_FROM: 'fixture@nuqta.test',
    LOG_LEVEL: 'silent',
  });
  const user = (
    await db.query(
      "INSERT INTO users(email,display_name,password_hash,password_version) VALUES($1,'Storage owner',$2,1) RETURNING id",
      [email, await hashPassword(password, c.AUTH_PEPPER)],
    )
  ).rows[0].id;
  merchant = (
    await db.query(
      "INSERT INTO merchants(name,slug) VALUES('Production storage fixture',$1) RETURNING id",
      ['store-' + randomUUID()],
    )
  ).rows[0].id;
  const branch = (
    await db.query("INSERT INTO branches(merchant_id,name) VALUES($1,'Main') RETURNING id", [
      merchant,
    ])
  ).rows[0].id;
  const staff = (
    await db.query(
      "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,'Storage owner','owner') RETURNING id",
      [merchant, user, email],
    )
  ).rows[0].id;
  await db.query(
    'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
    [merchant, staff, branch],
  );
  ({ app } = await buildApp(config));
  await app.ready();
});
after(async () => {
  await app?.close();
  await worker.end();
  await db.end();
  if (root) {
    assert.ok(
      resolve(root).startsWith(resolve(tmpdir()) + sep) &&
        basename(root).startsWith('nuqta-store-prod-'),
    );
    await rm(root, { recursive: true, force: true });
  }
});
test('production disk storage serves sanitized published logos and a fenced private CSV, recovers a completed export after re-leasing, and runs retention', async () => {
  const signed = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email, password },
  });
  assert.equal(signed.statusCode, 200, signed.body);
  const headers = {
    origin,
    cookie: signed.cookies.map((cookie) => cookie.name + '=' + cookie.value).join('; '),
    'x-csrf-token': signed.json().csrfToken,
    'x-nuqta-workspace': 'merchant',
  };
  const bytes = await sharp({
    create: { width: 1500, height: 1000, channels: 3, background: '#204c41' },
  })
    .withExif({ IFD0: { Copyright: 'private fixture metadata' } })
    .jpeg()
    .toBuffer();
  const upload = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + merchant + '/assets',
    headers: { ...headers, 'idempotency-key': randomUUID(), 'if-match': '1' },
    payload: { base64: bytes.toString('base64'), publishLogo: true },
  });
  assert.equal(upload.statusCode, 200, upload.body);
  const asset = upload.json().asset.id;
  const image = await app.inject({
    url: '/api/v1/public/merchants/' + merchant + '/logos/' + asset,
  });
  assert.equal(image.statusCode, 200);
  const metadata = await sharp(image.rawPayload).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.exif, undefined);
  const unsafe = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + merchant + '/assets',
    headers,
    payload: {
      base64: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      ).toString('base64'),
    },
  });
  assert.equal(unsafe.statusCode, 422);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + merchant + '/customer-exports',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { segment: 'all' },
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().export.id;
  await runOne(worker, config);
  const ex = (await db.query('SELECT status,storage_key FROM customer_exports WHERE id=$1', [id]))
    .rows[0];
  assert.equal(ex.status, 'ready');
  assert.match(ex.storage_key, new RegExp('^' + merchant + '/[0-9a-f-]{36}[.]csv$'));
  const download = () =>
    app.inject({
      url: '/api/v1/merchants/' + merchant + '/customer-exports/' + id + '/download',
      headers,
    });
  const first = await download();
  assert.equal(first.statusCode, 200, first.body);
  assert.ok(first.body.includes('alias'));
  const job = (
    await db.query(
      "SELECT j.id,j.lease_id FROM background_jobs j JOIN outbox_events o ON o.id=j.outbox_id WHERE j.kind='customer_export' AND o.aggregate_id=$1",
      [id],
    )
  ).rows[0];
  await db.query(
    "UPDATE background_jobs SET status='running',lease_until=now()-interval '1 second' WHERE id=$1",
    [job.id],
  );
  await runOne(worker, config);
  assert.notEqual(
    (await db.query('SELECT lease_id FROM background_jobs WHERE id=$1', [job.id])).rows[0].lease_id,
    job.lease_id,
  );
  assert.equal((await download()).statusCode, 200);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM customer_export_artifacts WHERE export_id=$1',
        [id],
      )
    ).rows[0].n,
    1,
  );
  const files = createFileStore(config);
  await db.query("UPDATE customer_exports SET expires_at=now()-interval '1 hour' WHERE id=$1", [
    id,
  ]);
  await utimes(
    resolve(root, 'exports', ex.storage_key),
    new Date(0),
    new Date(Date.now() - 3 * 3600000),
  );
  assert.equal((await cleanupExports(worker, files)).removed, 1);
  assert.equal(await files.exists('exports/' + ex.storage_key), false);
});
