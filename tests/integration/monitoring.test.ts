import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed, ids } from '../../db/seed.js';
import { login } from '../helpers.js';
const c = readConfig(),
  token = randomBytes(32).toString('hex');
const root = resolve('.local', 'monitoring-integration-' + randomUUID()),
  lines: string[] = [];
const db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const runtime = new pg.Client({ connectionString: c.DATABASE_URL });
const { app } = await buildApp(
  {
    APP_ENV: 'test',
    MONITORING_TOKEN: token,
    BACKUP_STATUS_ROOT: root,
    STORAGE_ROOT: root,
    LOG_LEVEL: 'info',
  },
  {
    logStream: {
      write: (line) => {
        lines.push(line);
      },
    },
  },
);
app.post('/api/v1/monitoring-fixture/:private', async (req) => {
  req.log.warn({ email: 'PRIVATE-PLUGIN' }, 'PRIVATE-PLUGIN-MESSAGE');
  req.log.child({ email: 'PRIVATE-BINDING' }).error('PRIVATE-CHILD-MESSAGE');
  const error = new Error('PRIVATE-PASSWORD');
  error.name = 'PRIVATE-NAME';
  throw error;
});
before(async () => {
  await db.connect();
  await runtime.connect();
  await seed(db);
  for (const name of ['database', 'files']) {
    await mkdir(join(root, name), { recursive: true });
    await writeFile(
      join(root, name, 'status.json'),
      JSON.stringify({
        checkedAt: Date.now(),
        lastBackupAt: Date.now(),
        lastArchivedAt: Date.now(),
        healthy: true,
        secret: 'PRIVATE-STATUS-SECRET',
      }),
    );
  }
  await app.ready();
});
after(async () => {
  await app.close();
  await runtime.end();
  await db.end();
});
test('internal metrics are disabled without configuration, require an independent bearer, never accept a session, and expose no OpenAPI route', async () => {
  const { app: disabled } = await buildApp({
    APP_ENV: 'test',
    MONITORING_TOKEN: '',
    LOG_LEVEL: 'silent',
  });
  try {
    assert.equal((await disabled.inject('/internal/metrics')).statusCode, 404);
  } finally {
    await disabled.close();
  }
  assert.equal((await app.inject('/internal/metrics')).statusCode, 401);
  const owner = await login(app, 'owner@bunn.test');
  assert.equal((await app.inject({ url: '/internal/metrics', headers: owner })).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        url: '/internal/metrics',
        headers: { authorization: 'Bearer ' + token + 'x' },
      })
    ).statusCode,
    401,
  );
  const good = await app.inject({
    url: '/internal/metrics',
    headers: { authorization: 'Bearer ' + token },
  });
  assert.equal(good.statusCode, 200, good.body);
  assert.equal(good.headers['cache-control'], 'no-store');
  assert.equal(good.json().database.healthy, true);
  assert.equal(typeof good.json().disk.usedRatio, 'number');
  assert.ok(good.json().disk.usedRatio >= 0 && good.json().disk.usedRatio <= 1);
  assert.equal(good.json().backups.database.healthy, true);
  assert.equal(good.json().backups.files.healthy, true);
  assert.ok(!good.body.includes('PRIVATE-STATUS-SECRET'));
  const schema = (await app.inject('/api/v1/openapi.json')).json();
  assert.ok(!Object.keys(schema.paths).some((path) => path.startsWith('/internal')));
  assert.throws(() => readConfig({ MONITORING_TOKEN: c.AUTH_PEPPER }), /independent/);
});
test('global queue access returns only counts/age to auth; runtime and worker remain fenced', async () => {
  await assert.rejects(
    () => runtime.query('SELECT operational_queue_metrics()'),
    (error) => (error as { code: string }).code === '42501',
  );
  await db.query('SET ROLE nuqta_worker');
  try {
    await assert.rejects(
      () => db.query('SELECT operational_queue_metrics()'),
      (error) => (error as { code: string }).code === '42501',
    );
  } finally {
    await db.query('RESET ROLE');
  }
  const oid = randomUUID(),
    job = randomUUID();
  const mid = (
    await db.query(
      "INSERT INTO merchants(slug,name) VALUES($1,'Synthetic monitor queue') RETURNING id",
      ['monitor-queue-' + randomUUID()],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO outbox_events(id,merchant_id,event_type,aggregate_id,payload,dedupe_key) VALUES($1,$2,'monitoring_fixture',$1,$3,$4)",
    [
      oid,
      mid,
      { email: 'PRIVATE-CUSTOMER@example.test', phone: '+201011111111' },
      'monitoring:' + oid,
    ],
  );
  await db.query(
    "INSERT INTO background_jobs(id,merchant_id,outbox_id,kind,created_at) VALUES($1,$2,$3,'monitoring_fixture',clock_timestamp()-interval '16 minutes')",
    [job, mid, oid],
  );
  try {
    const response = await app.inject({
      url: '/internal/health',
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(response.statusCode, 503);
    assert.ok(response.json().health.reasons.includes('outbox_older_than_15m'));
    assert.ok(response.json().outbox.oldestPendingAgeMs >= 16 * 60000);
    assert.ok(!/PRIVATE-CUSTOMER|201011111111|monitoring_fixture/.test(response.body));
    assert.equal(
      response.json().outbox.length,
      Object.entries(response.json().outbox)
        .filter(([name]) => ['pending', 'running', 'failed', 'blocked', 'unknown'].includes(name))
        .reduce((sum, [, value]) => sum + Number(value), 0),
    );
  } finally {
    await db.query("UPDATE background_jobs SET status='succeeded' WHERE id=$1 AND merchant_id=$2", [
      job,
      mid,
    ]);
  }
});
test('obsolete intents stay visible without masking actionable blocked, unknown or failed deliveries', async () => {
  const metrics = async () =>
    (await db.query('SELECT operational_queue_metrics() AS value')).rows[0].value;
  const baseline = await metrics(),
    job = randomUUID(),
    mail = randomUUID(),
    outbox = randomUUID();
  await db.query(
    "INSERT INTO outbox_events(id,merchant_id,event_type,aggregate_id,payload,dedupe_key) VALUES($1,$2,'monitoring_fixture',$1,'{}',$3)",
    [outbox, ids.merchantA, 'monitoring:' + outbox],
  );
  await db.query(
    "INSERT INTO background_jobs(id,merchant_id,outbox_id,kind,status,last_error,created_at) VALUES($1,$2,$3,'invitation_email','blocked','INVITATION_NOT_AVAILABLE',clock_timestamp()-interval '2 days')",
    [job, ids.merchantA, outbox],
  );
  await db.query(
    "INSERT INTO auth_mail_outbox(id,user_id,kind,credential_version,locale,dedupe_key,expires_at,status,last_error,created_at) VALUES($1,$2,'password_changed',1,'en',$3,clock_timestamp()-interval '1 day','blocked','AUTH_MAIL_STALE',clock_timestamp()-interval '2 days')",
    [mail, ids.ownerA, 'monitoring:' + mail],
  );
  try {
    let value = await metrics();
    assert.equal(value.length, baseline.length + 2);
    assert.equal(value.blocked, baseline.blocked + 2);
    assert.equal(value.actionable, baseline.actionable);
    for (const reason of ['EXPORT_SCOPE_CHANGED', 'EXPORT_NOT_AVAILABLE']) {
      await db.query('UPDATE background_jobs SET last_error=$1 WHERE id=$2', [reason, job]);
      assert.equal((await metrics()).actionable, baseline.actionable);
    }
    for (const reason of [
      'SMTP_REJECTED',
      'MAIL_INTENT_CONFLICT',
      'MAX_ATTEMPTS',
      'PROVIDER_NOT_CONFIGURED',
      null,
    ]) {
      await db.query('UPDATE auth_mail_outbox SET last_error=$1 WHERE id=$2', [reason, mail]);
      value = await metrics();
      assert.equal(value.actionable, baseline.actionable + 1);
      assert.ok(value.oldestPendingAgeMs >= 2 * 86400000);
    }
    for (const status of ['unknown', 'failed', 'pending', 'running']) {
      // A cancellation reason only suppresses a terminal blocked intent.
      await db.query(
        "UPDATE auth_mail_outbox SET status=$1,last_error='AUTH_MAIL_STALE' WHERE id=$2",
        [status, mail],
      );
      assert.equal((await metrics()).actionable, baseline.actionable + 1);
    }
    const health = await app.inject({
      url: '/internal/health',
      headers: { authorization: 'Bearer ' + token },
    });
    assert.ok(health.json().health.reasons.includes('outbox_older_than_15m'));
  } finally {
    await db.query("UPDATE background_jobs SET status='succeeded' WHERE id=$1", [job]);
    await db.query("UPDATE auth_mail_outbox SET status='sent' WHERE id=$1", [mail]);
  }
});

test('API JSON logs contain route patterns/status/duration and no raw paths, queries, contacts, IPs, credentials or error messages', async () => {
  await app.inject({
    method: 'POST',
    url: '/api/v1/monitoring-fixture/PRIVATE-PATH?email=PRIVATE-QUERY',
    headers: {
      origin: c.PUBLIC_APP_ORIGIN,
      cookie: 'private=PRIVATE-COOKIE',
      authorization: 'Bearer PRIVATE-AUTH',
      'x-csrf-token': 'PRIVATE-CSRF',
      'x-request-id': 'PRIVATE-REQUEST-ID',
    },
    payload: { password: 'PRIVATE-BODY', phone: '+201077777777' },
  });
  await app.inject('/api/v1/unknown/PRIVATE-UNKNOWN?key=PRIVATE-URL');
  const records = lines
    .flatMap((line) => line.trim().split('\n'))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const logs = JSON.stringify(records);
  assert.ok(!logs.includes(token));
  assert.ok(!logs.includes('owner@bunn.test'));
  assert.ok(!/PRIVATE-|201077777777|remoteAddress|127\.0\.0\.1|hostname/.test(logs), logs);
  const record = records.find((row) => row.route === '/api/v1/monitoring-fixture/:private');
  assert.equal(record.statusCode, 500);
  assert.equal(typeof record.durationMs, 'number');
  assert.match(record.requestId, /^[a-f0-9-]{36}$/);
  assert.ok(records.some((row) => row.errorType === 'UnexpectedError'));
  const metrics = (
    await app.inject({ url: '/internal/metrics', headers: { authorization: 'Bearer ' + token } })
  ).json();
  assert.ok(metrics.http.window.errors >= 1);
  assert.ok(metrics.http.window.p95Ms !== null);
  assert.ok(metrics.health.reasons.includes('http_5xx_above_1_percent'));
});
test('worker startup failures emit JSON without echoing malformed credentials', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'apps/worker/src/main.ts'], {
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
    env: {
      ...process.env,
      WORKER_DATABASE_URL: 'postgres://PRIVATE-STARTUP-SECRET',
      AUTH_PROVIDER: 'password',
      APP_ENV: 'production',
      PUBLIC_APP_ORIGIN: 'http://bad.invalid',
    },
  });
  assert.equal(result.status, 1);
  const output = (result.stdout + '\n' + result.stderr).trim();
  assert.ok(!output.includes('PRIVATE-STARTUP-SECRET'));
  const logs = output
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(logs.some((row) => row.service === 'worker' && row.event === 'service.start_failed'));
});
test('stale/invalid backup reports fail closed without returning their file contents', async () => {
  await writeFile(
    join(root, 'files', 'status.json'),
    JSON.stringify({
      healthy: true,
      lastBackupAt: Date.now() - 27 * 3600000,
      password: 'PRIVATE-BACKUP',
    }),
  );
  const result = await app.inject({
    url: '/internal/health',
    headers: { authorization: 'Bearer ' + token },
  });
  assert.equal(result.statusCode, 503);
  assert.equal(result.json().backups.files.healthy, false);
  assert.ok(!result.body.includes('PRIVATE-BACKUP'));
  await writeFile(join(root, 'database', 'status.json'), 'PRIVATE-INVALID-JSON');
  const invalid = await app.inject({
    url: '/internal/metrics',
    headers: { authorization: 'Bearer ' + token },
  });
  assert.equal(invalid.json().backups.database.healthy, false);
  assert.ok(!invalid.body.includes('PRIVATE-INVALID-JSON'));
  const caddy = await readFile('deploy/Caddyfile', 'utf8');
  assert.match(caddy, /@private_monitoring path \/internal \/internal\/\*/);
});
