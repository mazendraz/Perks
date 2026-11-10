import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { privateLocalDirectory } from './private-local.js';
import { stagingReviewEnvironment, stagingEnvironmentText } from './staging-config.js';
const root = await privateLocalDirectory(
    'log-policy-test-' + Date.now() + '-' + randomBytes(4).toString('hex'),
  ),
  stage = await privateLocalDirectory(
    'log-policy-test-' + Date.now() + '-' + randomBytes(4).toString('hex'),
  ),
  values = stagingReviewEnvironment(),
  envFile = resolve(root, 'review.env');
await writeFile(envFile, stagingEnvironmentText(values), { flag: 'wx', mode: 0o600 });
const report: {
  at: string;
  status: string;
  checks: string[];
  hostPolicyApplied: boolean;
  source: Record<string, string>;
} = {
  at: new Date().toISOString(),
  status: 'CONFIG_VERIFIED_RUNTIME_NOT_RUN',
  checks: [],
  hostPolicyApplied: false,
  source: {},
};
const linuxPath = (path: string) =>
  process.platform === 'win32'
    ? path
        .replace(/^([a-zA-Z]):/, (_, drive: string) => '/mnt/' + drive.toLowerCase())
        .replaceAll('\\', '/')
    : path;
try {
  const config = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      envFile,
      '-p',
      'nuqta_log_review',
      '-f',
      'deploy/compose.yml',
      '-f',
      'deploy/compose.staging.yml',
      '-f',
      'deploy/compose.retention.yml',
      'config',
      '--format',
      'json',
    ],
    { windowsHide: true, encoding: 'utf8', timeout: 20000, env: { ...process.env, ...values } },
  );
  assert.equal(config.status, 0, 'Compose retention merge must parse.');
  const model = JSON.parse(config.stdout);
  for (const service of Object.values(model.services) as {
    logging: { driver: string; options: Record<string, string> };
  }[]) {
    assert.equal(service.logging.driver, 'journald');
    assert.deepEqual(Object.keys(service.logging.options), ['tag']);
    assert.equal(service.logging.options.tag, 'nuqta/{{.Name}}');
  }
  assert.equal(model.services.postgres.ports, undefined);
  assert.equal(model.services.monitoring.ports[0].host_ip, '127.0.0.1');
  report.checks.push(
    'Actual Compose base/staging/retention merge switches every service to journald without unsupported JSON-driver options or secret metadata',
  );
  const script = `set -eu
repo="$1"
review="$2"
sh -n "$repo/deploy/log-retention/install.sh"
sh "$repo/deploy/log-retention/install.sh" --stage "$review"
cmp "$repo/deploy/log-retention/journald.conf" "$review/etc/systemd/journald.conf.d/90-nuqta-retention.conf"
cmp "$repo/deploy/log-retention/nuqta-log-retention.service" "$review/etc/systemd/system/nuqta-log-retention.service"
cmp "$repo/deploy/log-retention/nuqta-log-retention.timer" "$review/etc/systemd/system/nuqta-log-retention.timer"
before=$(sha256sum "$review/etc/systemd/journald.conf.d/90-nuqta-retention.conf")
if sh "$repo/deploy/log-retention/install.sh" --stage "$review"; then exit 1; fi
test "$before" = "$(sha256sum "$review/etc/systemd/journald.conf.d/90-nuqta-retention.conf")"
systemd-analyze verify "$review/etc/systemd/system/nuqta-log-retention.service" "$review/etc/systemd/system/nuqta-log-retention.timer"
systemd-analyze timespan 30day >/dev/null
systemd-analyze calendar hourly >/dev/null
`;
  const args = ['-s', '--', linuxPath(resolve('.')), linuxPath(stage)];
  const result = spawnSync(
    process.platform === 'win32' ? 'wsl' : 'sh',
    process.platform === 'win32' ? ['-d', 'Ubuntu', '--exec', 'sh', ...args] : args,
    { input: script, encoding: 'utf8', windowsHide: true, timeout: 30000 },
  );
  assert.equal(result.status, 0, 'Staged policy installer and systemd verification must pass.');
  report.checks.push(
    'Installer stages exact review files and refuses a second installation without overwriting them',
  );
  report.checks.push(
    'Real systemd-analyze validates the service, hourly timer and30-day duration; no host service, journal or container is changed',
  );
  for (const path of [
    'deploy/compose.retention.yml',
    'deploy/log-retention/install.sh',
    'deploy/log-retention/journald.conf',
    'deploy/log-retention/nuqta-log-retention.service',
    'deploy/log-retention/nuqta-log-retention.timer',
    'tools/test-log-retention.ts',
  ])
    report.source[path] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  for (const check of report.checks) console.log('PASS ' + check);
} catch {
  report.status = 'failed';
  process.exitCode = 1;
} finally {
  await mkdir('docs/execution/evidence/implementation', { recursive: true });
  await writeFile(
    'docs/execution/evidence/implementation/log-retention.json',
    JSON.stringify(report, null, 2) + '\n',
  );
}
assert.notEqual(
  report.status,
  'failed',
  'Log retention configuration validation failed. No host policy was applied.',
);
