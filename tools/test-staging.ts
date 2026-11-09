import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { privateLocalDirectory } from './private-local.js';
import { stagingEnvironmentText, stagingReviewEnvironment } from './staging-config.js';
const root = await privateLocalDirectory(
  'staging-config-test-' + Date.now() + '-' + randomBytes(4).toString('hex'),
);
const report: {
  at: string;
  status: string;
  checks: string[];
  runtimeStarted: boolean;
  source: Record<string, string>;
} = {
  at: new Date().toISOString(),
  status: 'CONFIG_VERIFIED_RUNTIME_NOT_RUN',
  checks: [],
  runtimeStarted: false,
  source: {},
};
function render(project: string, file: string, staging: boolean) {
  const args = [
    'compose',
    '--env-file',
    file,
    '-p',
    project,
    '-f',
    'deploy/compose.yml',
    ...(staging ? ['-f', 'deploy/compose.staging.yml'] : []),
    'config',
    '--format',
    'json',
  ];
  const result = spawnSync('docker', args, { windowsHide: true, encoding: 'utf8', timeout: 20000 });
  if (result.status !== 0)
    throw new Error('Compose staging configuration failed; no engine was started.');
  return JSON.parse(result.stdout);
}
try {
  const stage = stagingReviewEnvironment(),
    production = stagingReviewEnvironment();
  Object.assign(production, {
    APP_ENV: 'production',
    DOMAIN: 'production.nuqta.invalid',
    PUBLIC_APP_ORIGIN: 'https://production.nuqta.invalid',
  });
  const stageFile = resolve(root, 'stage.env'),
    prodFile = resolve(root, 'prod.env');
  await writeFile(stageFile, stagingEnvironmentText(stage), { flag: 'wx', mode: 0o600 });
  await writeFile(prodFile, stagingEnvironmentText(production), { flag: 'wx', mode: 0o600 });
  const a = render('nuqta_staging_review', stageFile, true),
    b = render('nuqta_production_review', prodFile, false);
  for (const service of ['api', 'worker', 'migrate'])
    assert.equal(a.services[service].environment.APP_ENV, 'staging');
  assert.equal(a.services.api.environment.AUTH_PROVIDER, 'password');
  assert.equal(a.services.api.environment.COOKIE_SECURE, 'true');
  assert.equal(a.services.api.environment.PUBLIC_APP_ORIGIN, 'https://staging.nuqta.invalid');
  assert.equal(a.services.caddy.environment.DOMAIN, 'staging.nuqta.invalid');
  report.checks.push(
    'Staging enforces password auth, Secure cookies, HTTPS origin and its independent domain for API/worker/migrator',
  );
  for (const kind of ['volumes', 'networks']) {
    const names = Object.values(b[kind]).map((v: unknown) => (v as { name: string }).name);
    for (const value of Object.values(a[kind]))
      assert.ok(!names.includes((value as { name: string }).name));
  }
  for (const key of [
    'AUTH_PEPPER',
    'MONITORING_TOKEN',
    'NUQTA_RUNTIME_DB_PASSWORD',
    'NUQTA_AUTH_DB_PASSWORD',
    'NUQTA_WORKER_DB_PASSWORD',
  ])
    assert.notEqual(stage[key], production[key]);
  assert.equal(a.networks.proxy.ipam.config[0].subnet, '172.30.41.0/28');
  assert.equal(a.services.api.environment.TRUSTED_PROXIES, '172.30.41.2/32');
  assert.equal(a.services.caddy.networks.proxy.ipv4_address, '172.30.41.2');
  assert.equal(a.services.api.networks.proxy.ipv4_address, '172.30.41.3');
  report.checks.push(
    'Separate project, volumes, networks, proxy subnet and secrets prevent accidental production state reuse',
  );
  assert.equal(a.services.postgres.ports, undefined);
  for (const service of ['caddy', 'monitoring'])
    for (const binding of a.services[service].ports) assert.equal(binding.host_ip, '127.0.0.1');
  assert.equal(a.services.monitoring.ports[0].published, '4302');
  assert.equal(
    a.services.caddy.ports.filter((p: { target: number }) => p.target === 443).length,
    2,
  );
  report.checks.push(
    'Review bindings stay loopback and do not occupy production 80/443 or monitoring4301; database remains private',
  );
  for (const path of [
    'deploy/compose.yml',
    'deploy/compose.staging.yml',
    'tools/staging-config.ts',
    'tools/test-staging.ts',
  ])
    report.source[path] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  for (const message of report.checks) console.log('PASS ' + message);
} catch {
  report.status = 'failed';
  process.exitCode = 1;
} finally {
  await mkdir('docs/execution/evidence/implementation', { recursive: true });
  await writeFile(
    'docs/execution/evidence/implementation/staging-config.json',
    JSON.stringify(report, null, 2) + '\n',
  );
}
assert.notEqual(
  report.status,
  'failed',
  'Staging configuration verification failed; no runtime was started.',
);
