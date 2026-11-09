import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash, X509Certificate } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { generate } from 'selfsigned';
import { chromium } from 'playwright';
import pg from 'pg';
import { readConfig } from '../apps/api/src/config.js';
import { buildApp } from '../apps/api/src/server.js';
import {
  startKuma,
  stopKuma,
  connectKuma,
  kumaCommand,
  kumaVersion,
  kumaCommit,
  type KumaSocket,
} from './kuma-runtime.js';
const c = readConfig();
assert.ok(['development', 'test'].includes(c.APP_ENV));
const parent = new URL(c.DATABASE_MIGRATOR_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(parent.hostname));
assert.match(
  parent.pathname,
  /^\/nuqta_(local|ci)$/,
  'Never run monitoring smoke against the manual demo or production.',
);
const database = 'nuqta_monitoring_' + Date.now();
assert.match(database, /^nuqta_monitoring_\d+$/);
const root = resolve('.local', 'monitoring-smoke-' + randomUUID());
await mkdir(root, { recursive: true, mode: 0o700 });
const output = 'docs/execution/evidence/implementation/monitoring.json';
const report: {
  at: string;
  status: string;
  checks: string[];
  kuma: { version: string; commit: string };
  realExternalDelivery: boolean;
  syntheticDiskProbe: boolean;
  source: Record<string, string>;
  reason?: string;
} = {
  at: new Date().toISOString(),
  status: 'running',
  checks: [],
  kuma: { version: kumaVersion, commit: kumaCommit },
  realExternalDelivery: false,
  syntheticDiskProbe: true,
  source: {},
};
for (const file of [
  'apps/api/src/logging.ts',
  'apps/api/src/modules/monitoring.ts',
  'packages/domain/src/monitoring.ts',
  'db/migrations/011_operational_metrics.sql',
  'deploy/compose.yml',
  'tools/test-monitoring.ts',
  'tools/kuma-runtime.ts',
])
  report.source[file] = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const pass = (message: string) => {
  report.checks.push(message);
  console.log('PASS ' + message);
};
async function port() {
  const server = createNetServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const result = (server.address() as { port: number }).port;
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  return result;
}
async function until(check: () => boolean | Promise<boolean>, message: string, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(message);
}
const apiPort = await port(),
  kumaPort = await port();
const token = randomBytes(32).toString('hex'),
  password = 'Kuma-' + randomBytes(24).toString('base64url') + '-7!';
const withDatabase = (value: string) => {
  const url = new URL(value);
  assert.equal(url.hostname, parent.hostname);
  assert.equal(url.port, parent.port);
  url.pathname = '/' + database;
  return url.href;
};
const fixture = {
  APP_ENV: 'test' as const,
  AUTH_PROVIDER: 'local' as const,
  AUTH_PEPPER: randomBytes(32).toString('hex'),
  COOKIE_SECURE: 'false' as const,
  HOST: '127.0.0.1',
  PORT: apiPort,
  PUBLIC_APP_ORIGIN: 'http://127.0.0.1:' + apiPort,
  MONITORING_TOKEN: token,
  STORAGE_ROOT: join(root, 'files'),
  BACKUP_STATUS_ROOT: join(root, 'backups'),
  LOG_LEVEL: 'silent' as const,
  DATABASE_URL: withDatabase(c.DATABASE_URL),
  AUTH_DATABASE_URL: withDatabase(c.AUTH_DATABASE_URL),
  DATABASE_MIGRATOR_URL: withDatabase(c.DATABASE_MIGRATOR_URL!),
  WORKER_DATABASE_URL: withDatabase(c.WORKER_DATABASE_URL!),
};
const admin = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
let db: pg.Client | null = null,
  api: Awaited<ReturnType<typeof buildApp>> | null = null,
  kuma: Awaited<ReturnType<typeof startKuma>> | null = null,
  socket: KumaSocket | null = null;
let created = false,
  disk = 0.2;
const received: Record<string, unknown>[] = [],
  beats: { id: number; status: number }[] = [];
const receiver = createHttpServer((req, res) => {
  let body = '';
  req.on('data', (part) => {
    body += String(part);
    if (body.length > 200000) req.destroy();
  });
  req.on('end', () => {
    try {
      received.push(JSON.parse(body));
      res.writeHead(200).end('ok');
    } catch {
      res.writeHead(400).end();
    }
  });
}); // Loopback only, no actual notification provider.
let tls: ReturnType<typeof createHttpsServer> | null = null;
const backup = async (stale = false) => {
  for (const name of ['database', 'files']) {
    await mkdir(join(fixture.BACKUP_STATUS_ROOT, name), { recursive: true });
    await writeFile(
      join(fixture.BACKUP_STATUS_ROOT, name, 'status.json'),
      JSON.stringify({
        checkedAt: Date.now(),
        lastBackupAt: Date.now() - (stale && name === 'files' ? 27 * 3600000 : 0),
        lastArchivedAt: Date.now(),
        healthy: true,
      }),
    );
  }
};
const startApi = async () => {
  api = await buildApp(fixture, { monitoringProbes: { diskUsedRatio: async () => disk } });
  api.app.get('/api/v1/synthetic-monitoring-failure', async () => {
    throw new Error('Synthetic failure');
  });
  await api.app.listen({ port: apiPort, host: '127.0.0.1' });
};
const health = async () => {
  const result = await fetch(fixture.PUBLIC_APP_ORIGIN + '/internal/health', {
    headers: { authorization: 'Bearer ' + token },
  });
  return {
    status: result.status,
    value: (await result.json()) as { health: { healthy: boolean; reasons: string[] } },
  };
};
try {
  await admin.connect();
  await admin.query('CREATE DATABASE ' + pg.escapeIdentifier(database));
  created = true;
  const migrated = spawnSync(process.execPath, ['--import', 'tsx', 'db/migrate.ts'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
    env: { ...process.env, ...fixture, PORT: String(apiPort) },
  });
  assert.equal(migrated.status, 0, 'Synthetic monitoring migrations must succeed.');
  db = new pg.Client({ connectionString: fixture.DATABASE_MIGRATOR_URL });
  await db.connect();
  await mkdir(fixture.STORAGE_ROOT, { recursive: true });
  await backup();
  await startApi();
  assert.equal((await health()).status, 200);
  const cert = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec',
    algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 60000),
    notAfterDate: new Date(Date.now() + 5 * 86400000),
    extensions: [
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', digitalSignature: true, keyCertSign: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });
  const certificate = new X509Certificate(cert.cert);
  assert.ok(Date.parse(certificate.validTo) - Date.now() < 7 * 86400000);
  const ca = join(root, 'fixture-ca.pem');
  await writeFile(ca, cert.cert, { mode: 0o600 });
  tls = createHttpsServer({ key: cert.private, cert: cert.cert }, (_req, res) =>
    res.writeHead(200).end('synthetic TLS'),
  );
  await new Promise<void>((r) => tls!.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  const webhook = 'http://127.0.0.1:' + (receiver.address() as { port: number }).port;
  kuma = await startKuma(join(root, 'kuma'), kumaPort, ca);
  const origin = 'http://127.0.0.1:' + kumaPort;
  await until(
    async () => {
      try {
        return (await fetch(origin)).ok;
      } catch {
        return false;
      }
    },
    'Kuma did not start; inspect the private fixture log.',
    30000,
  );
  socket = await connectKuma(origin);
  await kumaCommand(socket, 'setup', 'nuqta-monitoring-test', password);
  await kumaCommand(socket, 'login', { username: 'nuqta-monitoring-test', password, token: '' });
  socket.on('heartbeat', (value) => {
    if (value && typeof value === 'object') {
      const row = value as { monitorID?: number; status?: number };
      if (row.monitorID !== undefined && row.status !== undefined)
        beats.push({ id: Number(row.monitorID), status: Number(row.status) });
    }
  });
  const notification = {
    name: 'Synthetic local delivery',
    type: 'webhook',
    isDefault: false,
    applyExisting: false,
    active: true,
    webhookURL: webhook,
    webhookContentType: 'application/json',
    httpMethod: 'post',
  };
  const notificationId = Number(
    (await kumaCommand(socket, 'addNotification', notification, null)).id,
  );
  assert.ok(notificationId > 0);
  await kumaCommand(socket, 'testNotification', notification);
  await until(() => received.length > 0, 'The local test notification must actually arrive.');
  pass(
    'Pinned Uptime Kuma native dashboard starts, authenticates a synthetic user and delivers a real HTTP notification to a loopback receiver',
  );
  const add = async (name: string, url: string, extra: Record<string, unknown> = {}) => {
    const result = await kumaCommand(socket!, 'add', {
      type: 'http',
      name,
      parent: null,
      url,
      method: 'GET',
      interval: 20,
      retryInterval: 20,
      resendInterval: 0,
      maxretries: 0,
      notificationIDList: { [notificationId]: true },
      ignoreTls: false,
      upsideDown: false,
      expiryNotification: false,
      domainExpiryNotification: false,
      maxredirects: 0,
      accepted_statuscodes: ['200-299'],
      active: false,
      timeout: 5,
      saveResponse: false,
      saveErrorResponse: false,
      kafkaProducerBrokers: [],
      kafkaProducerSaslOptions: { mechanism: 'None' },
      rabbitmqNodes: [],
      conditions: [],
      ...extra,
    });
    const id = Number(result.monitorID);
    assert.ok(id > 0);
    return id;
  };
  const ops = await add(
    'Synthetic Nuqta operations',
    fixture.PUBLIC_APP_ORIGIN + '/internal/health',
    { headers: JSON.stringify({ Authorization: 'Bearer ' + token }) },
  );
  const probe = async (id: number, status: number) => {
    const at = beats.length;
    await kumaCommand(socket!, 'pauseMonitor', id);
    await kumaCommand(socket!, 'resumeMonitor', id);
    await until(
      () => beats.slice(at).some((beat) => beat.id === id && beat.status === status),
      'Kuma did not report the expected actual HTTP probe state.',
    );
  };
  const notifyDown = async (reason: string) => {
    const before = received.length;
    if (reason !== 'server_unavailable') {
      const current = await health();
      assert.equal(current.status, 503);
      assert.ok(current.value.health.reasons.includes(reason));
    }
    await probe(ops, 0);
    await until(
      () =>
        received.slice(before).some((row) => {
          const hb = row.heartbeat as { status?: number } | undefined;
          return hb?.status === 0;
        }),
      'An actual failure notification must arrive.',
    );
    pass('Kuma detects ' + reason + ' and the local receiver receives its failure notification');
  };
  await probe(ops, 1);
  await api!.app.close();
  api = null;
  await notifyDown('server_unavailable');
  await startApi();
  await probe(ops, 1);
  await backup(true);
  await notifyDown('backup_unhealthy');
  await backup();
  await probe(ops, 1);
  const mid = (
    await db.query(
      "INSERT INTO merchants(slug,name) VALUES($1,'Synthetic monitoring only') RETURNING id",
      ['monitor-' + randomUUID()],
    )
  ).rows[0].id;
  const oid = randomUUID(),
    job = randomUUID();
  await db.query(
    "INSERT INTO outbox_events(id,merchant_id,event_type,aggregate_id,dedupe_key) VALUES($1,$2,'synthetic_monitoring',$1,$3)",
    [oid, mid, 'monitor:' + oid],
  );
  await db.query(
    "INSERT INTO background_jobs(id,merchant_id,outbox_id,kind,created_at) VALUES($1,$2,$3,'synthetic_monitoring',clock_timestamp()-interval '16 minutes')",
    [job, mid, oid],
  );
  await notifyDown('outbox_older_than_15m');
  await db.query("UPDATE background_jobs SET status='succeeded' WHERE id=$1 AND merchant_id=$2", [
    job,
    mid,
  ]);
  await probe(ops, 1);
  disk = 0.81;
  await notifyDown('disk_above_80_percent');
  disk = 0.2;
  await probe(ops, 1);
  assert.equal(
    (await fetch(fixture.PUBLIC_APP_ORIGIN + '/api/v1/synthetic-monitoring-failure')).status,
    500,
  );
  await notifyDown('http_5xx_above_1_percent');
  const certificateMonitor = await add(
    'Synthetic five-day TLS certificate',
    'https://127.0.0.1:' + (tls.address() as { port: number }).port,
    { expiryNotification: true },
  );
  const beforeCertificate = received.length;
  await probe(certificateMonitor, 1);
  await until(
    () =>
      received.slice(beforeCertificate).some((row) => /certificate|expir/i.test(String(row.msg))),
    'Kuma certificate expiry warning must arrive for a trusted five-day fixture certificate.',
  );
  pass(
    'Kuma validates a trusted loopback TLS certificate with verification enabled and delivers its actual expiry warning',
  );
  const raw = JSON.stringify(received);
  assert.ok(
    !raw.includes(token) && !raw.includes(password),
    'Notification payloads must not disclose monitor credentials.',
  );
  pass(
    'Delivered notifications contain no internal bearer or dashboard password; no real Telegram/SMTP channel was configured',
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1365, height: 900 } });
    await page.goto(origin);
    await page.getByLabel('Username', { exact: true }).fill('nuqta-monitoring-test');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: /^Log ?in$/i }).click();
    await page.getByRole('link', { name: 'Dashboard', exact: true }).waitFor();
    await page.getByText('Synthetic Nuqta operations', { exact: true }).first().waitFor();
    await page.screenshot({
      path: 'docs/execution/evidence/implementation/monitoring-dashboard.png',
      fullPage: true,
      animations: 'disabled',
    });
    pass('The actual Kuma web dashboard signs in and renders the configured synthetic monitors');
  } finally {
    await browser.close();
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.reason = error instanceof Error ? error.message : 'Monitoring smoke failed';
  console.error(report.reason);
  process.exitCode = 1;
} finally {
  socket?.disconnect();
  if (kuma) await stopKuma(kuma);
  const remainingApi = api as Awaited<ReturnType<typeof buildApp>> | null;
  if (remainingApi) await remainingApi.app.close();
  if (tls?.listening) await new Promise<void>((r, j) => tls!.close((e) => (e ? j(e) : r())));
  if (receiver.listening)
    await new Promise<void>((r, j) => receiver.close((e) => (e ? j(e) : r())));
  if (db) await db.end();
  if (created)
    await admin.query('DROP DATABASE ' + pg.escapeIdentifier(database) + ' WITH (FORCE)');
  await admin.end();
  await mkdir(resolve('docs/execution/evidence/implementation'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
