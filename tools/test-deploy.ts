import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
const stamp = Date.now(),
  project = 'nuqta_l04_smoke_' + stamp;
const configOnly = process.argv.includes('--config-only');
assert.match(project, /^nuqta_l04_smoke_\d+$/);
const directory = resolve('.local', 'deploy-smoke-' + stamp);
await mkdir(directory, { recursive: true, mode: 0o700 });
const values: Record<string, string> = {
  APP_ENV: 'production',
  DOMAIN: 'localhost',
  PUBLIC_APP_ORIGIN: 'https://localhost:56443',
  HTTP_BIND: '127.0.0.1:56180',
  HTTPS_BIND: '127.0.0.1:56443',
  NUQTA_IMAGE: 'nuqta-smoke-app:' + stamp,
  NUQTA_WEB_IMAGE: 'nuqta-smoke-web:' + stamp,
  NUQTA_POSTGRES_IMAGE: 'nuqta-smoke-postgres:' + stamp,
  SMTP_HOST: 'unused.invalid',
  SMTP_PORT: '587',
  SMTP_USER: 'synthetic-only',
  SMTP_PASS: randomBytes(32).toString('hex'),
  SMTP_FROM: 'synthetic@nuqta.test',
};
for (const key of [
  'AUTH_PEPPER',
  'MONITORING_TOKEN',
  'NUQTA_POSTGRES_DB_PASSWORD',
  'NUQTA_MIGRATOR_DB_PASSWORD',
  'NUQTA_RUNTIME_DB_PASSWORD',
  'NUQTA_AUTH_DB_PASSWORD',
  'NUQTA_WORKER_DB_PASSWORD',
  'PGBACKREST_REPO1_CIPHER_PASS',
  'RESTIC_PASSWORD',
])
  values[key] = randomBytes(32).toString('hex');
const envFile = resolve(directory, 'smoke.env');
await writeFile(
  envFile,
  Object.entries(values)
    .map(([k, v]) => k + '=' + v)
    .join('\n'),
  { mode: 0o600 },
);
const childEnvironment = { ...process.env, ...values };
const prefix = [
  'compose',
  '--env-file',
  envFile,
  '-f',
  resolve('deploy/compose.yml'),
  '-p',
  project,
];
const report: {
  at: string;
  status: string;
  project: string;
  checks: string[];
  imageBytes?: number;
  source: Record<string, string>;
  reason?: string;
} = { at: new Date().toISOString(), status: 'running', project, checks: [], source: {} };
for (const path of [
  'Dockerfile',
  '.dockerignore',
  'deploy/compose.yml',
  'deploy/Caddyfile',
  'deploy/postgres/init-roles.sh',
  'apps/api/src/config.ts',
  'apps/api/src/server.ts',
  'db/migrate.ts',
  'deploy/postgres/Dockerfile',
  'deploy/postgres/postgresql.conf',
  'deploy/postgres/pgbackrest.conf',
  'deploy/backup/db-loop.py',
  'deploy/backup/files.sh',
  'deploy/backup/files-loop.sh',
])
  report.source[path] = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
async function command(args: string[], timeout = 30000) {
  return await new Promise<{ code: number | null; out: string; timedOut: boolean }>(
    (resolveResult, reject) => {
      const child = spawn('docker', args, {
        env: childEnvironment,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '',
        timedOut = false;
      child.stdout.on('data', (chunk) => {
        out += chunk;
      });
      // Error output may include rendered env/config; never forward it to logs/evidence.
      child.stderr.resume();
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeout);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        resolveResult({ code, out, timedOut });
      });
    },
  );
}
const pass = (message: string) => {
  report.checks.push(message);
  console.log('PASS ' + message);
};
async function checked(args: string[], label: string, timeout = 30000) {
  const result = await command(args, timeout);
  assert.equal(
    result.code,
    0,
    label + ' failed; inspect Docker privately. No config/credentials printed.',
  );
  return result.out;
}
async function request(path: string, headers: Record<string, string> = {}) {
  assert.ok(path.startsWith('/') && !path.startsWith('//'));
  // Synthetic loopback stack only: Caddy's internal test CA is not installed on this host.
  // Never use this override for a production domain or SMTP.
  return await new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
    (resolveResponse, reject) => {
      const req = https.get(
        {
          hostname: 'localhost',
          port: 56443,
          path,
          headers,
          rejectUnauthorized: false,
          timeout: 5000,
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () =>
            resolveResponse({ status: res.statusCode!, headers: res.headers, body }),
          );
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Loopback request timed out.')));
    },
  );
}
let started = false;
try {
  const composed = JSON.parse(
    await checked([...prefix, 'config', '--format', 'json'], 'Compose configuration'),
  );
  const services = composed.services;
  for (const name of ['postgres', 'migrate', 'api', 'worker', 'caddy', 'monitoring'])
    assert.ok(services[name]);
  for (const name of ['postgres', 'migrate', 'api', 'worker'])
    assert.ok(!services[name].ports?.length);
  assert.ok(composed.networks.database.internal);
  assert.equal(services.monitoring.image, 'louislam/uptime-kuma:2.5.9-slim-rootless');
  assert.ok(
    services.monitoring.ports.every((port: { host_ip: string }) => port.host_ip === '127.0.0.1'),
  );
  assert.ok(!services.monitoring.networks.database);
  assert.equal(services.monitoring.user, '1000:1000');
  assert.equal(services.monitoring.read_only, true);
  assert.ok(
    !Object.keys(services.monitoring.environment).some((name) =>
      /DATABASE_URL|AUTH_PEPPER|SMTP_PASS/.test(name),
    ),
  );
  assert.equal(services.api.environment.MONITORING_TOKEN, values.MONITORING_TOKEN);
  for (const service of Object.values(services) as {
    logging: { options: Record<string, string> };
  }[]) {
    assert.equal(service.logging.options['max-size'], '20m');
    assert.equal(service.logging.options['max-file'], '5');
  }
  assert.ok(
    !services.api.environment.WORKER_DATABASE_URL &&
      !services.api.environment.DATABASE_MIGRATOR_URL,
  );
  assert.ok(
    !services.worker.environment.DATABASE_URL &&
      !services.worker.environment.AUTH_DATABASE_URL &&
      !services.worker.environment.DATABASE_MIGRATOR_URL,
  );
  assert.deepEqual(Object.keys(services.migrate.environment).sort(), [
    'APP_ENV',
    'DATABASE_MIGRATOR_URL',
  ]);
  for (const name of ['api', 'worker'])
    assert.equal(services[name].depends_on.migrate.condition, 'service_completed_successfully');
  pass('Compose parses; DB is private and process credentials are separated');
  pass(
    'Pinned rootless Kuma exposes only a loopback dashboard, has no database/auth secrets, and all services retain bounded JSON logs',
  );
  const info = configOnly ? null : await command(['info', '--format', '{{.ServerVersion}}'], 10000);
  if (configOnly) {
    report.status = 'CONFIG_VERIFIED_RUNTIME_NOT_RUN';
    report.reason =
      'Configuration-only mode selected; no engine, images, stack or gateway runtime was tested.';
  } else if (!info || info.code !== 0) {
    report.status = 'BLOCKED_LOCAL_DOCKER';
    report.reason =
      'Linux Docker engine did not respond; image build, stack, headers and container role checks were not run.';
    console.log(report.reason);
    process.exitCode = 2;
  } else {
    console.log(
      'Building isolated app/web images. Public base images/npm only; no real SMTP or deployment.',
    );
    await checked([...prefix, 'build'], 'Image build', 600000);
    const image = JSON.parse(
      await checked(['image', 'inspect', values.NUQTA_IMAGE!], 'Image inspect'),
    )[0];
    report.imageBytes = image.Size;
    assert.ok(image.Size < 300 * 1024 * 1024, 'Runtime image must be below 300MiB');
    assert.ok(image.Config.User && !['root', '0', '0:0'].includes(image.Config.User));
    pass('Single non-root app/worker image is below 300MiB');
    // This uniquely named synthetic project owns every volume removed in finally.
    started = true;
    await checked(
      [...prefix, 'up', '-d', '--wait', '--wait-timeout', '180'],
      'Isolated stack',
      240000,
    );
    const ready = await request('/health/ready');
    assert.equal(ready.status, 200);
    assert.equal((await request('/health/live')).status, 200);
    assert.equal(
      (await request('/internal/metrics', { Authorization: 'Bearer ' + values.MONITORING_TOKEN }))
        .status,
      404,
    );
    assert.equal((await request('/internal/health')).status, 404);
    pass('Fresh PostgreSQL, migrations, API, worker and Caddy are healthy');
    const login = await request('/login');
    assert.equal(login.status, 200);
    assert.match(String(login.headers['strict-transport-security']), /max-age=31536000/);
    assert.equal(login.headers['cache-control'], 'no-cache');
    assert.ok(
      !String(login.headers['content-security-policy']).match(/script-src[^;]*unsafe-inline/),
    );
    const asset = login.body.match(/(?:src|href)="(\/assets\/[^"?]+\.js)"/)?.[1];
    assert.ok(asset);
    assert.match(String((await request(asset)).headers['cache-control']), /immutable/);
    pass('HTTPS proxy, SPA fallback, HSTS, CSP and static cache headers verified');
    for (const flag of ['SUPERUSER', 'BYPASSRLS']) {
      await checked(
        [
          ...prefix,
          'exec',
          '-T',
          'postgres',
          'psql',
          '-U',
          'postgres',
          '-d',
          'nuqta',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          'ALTER ROLE nuqta_runtime ' + flag,
        ],
        'Synthetic unsafe-role setup',
      );
      try {
        assert.equal((await request('/health/ready')).status, 503);
      } finally {
        await checked(
          [
            ...prefix,
            'exec',
            '-T',
            'postgres',
            'psql',
            '-U',
            'postgres',
            '-d',
            'nuqta',
            '-v',
            'ON_ERROR_STOP=1',
            '-c',
            'ALTER ROLE nuqta_runtime NO' + flag,
          ],
          'Synthetic role recovery',
        );
      }
    }
    assert.equal((await request('/health/ready')).status, 200);
    pass('Container readiness fails closed for superuser and bypassrls, then recovers');
    report.status = 'passed';
  }
} catch {
  report.status = 'failed';
  report.reason =
    'Deployment smoke failed; inspect local Docker privately. Secrets/config were not included in evidence.';
  process.exitCode = 1;
  console.error(report.reason);
} finally {
  if (started) {
    const cleanup = await command([...prefix, 'down', '--volumes', '--remove-orphans'], 60000);
    if (cleanup.code !== 0) {
      report.status = 'failed';
      report.reason = 'Owned synthetic project cleanup failed; inspect project ' + project;
      process.exitCode = 1;
    }
  }
  await mkdir('docs/execution/evidence/implementation', { recursive: true });
  await writeFile(
    'docs/execution/evidence/implementation/' +
      (configOnly ? 'deployment-config.json' : 'deployment.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
