import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { readConfig } from '../apps/api/src/config.js';
const c = readConfig();
assert.equal(c.APP_ENV, 'development');
assert.equal(new URL(c.DATABASE_MIGRATOR_URL!).pathname, '/nuqta_local');
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Use npm run verify:local.');
const file = 'docs/execution/evidence/implementation/checks.json';
const report: {
  at: string;
  status: string;
  steps: {
    command: string;
    exitCode: number;
    durationMs: number;
    passedTests?: number;
    skippedTests?: number;
  }[];
  browserChecks?: number;
  mobileChecks?: number;
  sourceFingerprint?: string;
  sourceFingerprintAfter?: string;
  environment?: Record<string, string>;
} = { at: new Date().toISOString(), status: 'running', steps: [] };
await mkdir('docs/execution/evidence/implementation', { recursive: true });
async function snapshot() {
  const paths: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', '.local'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (
        /\.(?:ts|tsx|js|mjs|cjs|css|html|json|webmanifest|png|sql|ya?ml|svg|ttf|woff2?|otf|sh|conf|py)$/.test(
          entry.name,
        ) ||
        ['Caddyfile', 'Dockerfile'].includes(entry.name)
      )
        paths.push(path.replaceAll('\\', '/'));
    }
  }
  for (const dir of ['apps', 'packages', 'db', 'tools', 'tests', '.github', 'deploy'])
    if (existsSync(dir)) await walk(dir);
  for (const file of [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.server.json',
    'eslint.config.js',
    'eslint.config.mjs',
    '.prettierrc.json',
    '.prettierignore',
    '.gitignore',
    '.gitattributes',
    '.env.example',
    'Dockerfile',
    '.dockerignore',
  ])
    if (existsSync(file)) paths.push(file);
  const files = await Promise.all(
    [...new Set(paths)].sort().map(async (path) => ({
      path,
      sha256: createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    })),
  );
  return { fingerprint: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}
const source = await snapshot();
async function saveEvidence(path: string, content: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const temporary = path + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code || 'UNKNOWN';
      if (attempt === 5 || !['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES'].includes(code))
        throw new Error('Could not persist verification evidence: ' + code, { cause: error });
      await setTimeout(50 * 2 ** attempt);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}
report.sourceFingerprint = source.fingerprint;
report.environment = {
  node: process.version,
  platform: process.platform,
  appEnv: c.APP_ENV,
  authProvider: c.AUTH_PROVIDER,
  browser: process.env.NUQTA_E2E_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium'),
};
await saveEvidence(
  'docs/execution/evidence/implementation/source.json',
  JSON.stringify(source, null, 2),
);
for (const script of [
  'typecheck',
  'lint',
  'test',
  'build',
  'openapi:export',
  'test:integration',
  'test:manual-demo',
  'test:e2e',
  'test:e2e:mobile',
  'test:restore',
  'verify:plan',
]) {
  await saveEvidence(file, JSON.stringify(report, null, 2));
  const at = performance.now();
  const result = spawnSync(process.execPath, [cli, 'run', script], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    timeout: ['test:integration', 'test:e2e', 'test:e2e:mobile'].includes(script) ? 300000 : 180000,
  });
  const passed = /ℹ pass (\d+)/.exec(result.stdout || '');
  const skipped = /ℹ skipped (\d+)/.exec(result.stdout || '');
  report.steps.push({
    command: 'npm run ' + script,
    exitCode: result.status ?? 1,
    durationMs: performance.now() - at,
    ...(passed ? { passedTests: Number(passed[1]) } : {}),
    ...(skipped ? { skippedTests: Number(skipped[1]) } : {}),
  });
  console.log((result.status === 0 ? 'PASS ' : 'FAIL ') + script);
  if (result.status !== 0) {
    report.status = 'failed';
    await saveEvidence(file, JSON.stringify(report, null, 2));
    console.error(
      (result.stdout + '\n' + result.stderr)
        .slice(-6000)
        .replace(/NQP:[a-f0-9]{64}/g, 'NQP:[redacted]')
        .replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database URL redacted]')
        .replace(/\/(invite|reset-password)\/[^\s/]+/g, '/$1/[redacted]'),
    );
    process.exitCode = 1;
    break;
  }
}
if (!process.exitCode) {
  report.status = 'passed';
  report.browserChecks = JSON.parse(
    await readFile('docs/execution/evidence/implementation/browser.json', 'utf8'),
  ).checks.length;
  const mobile = JSON.parse(
    await readFile('docs/execution/evidence/implementation/mobile.json', 'utf8'),
  );
  assert.equal(mobile.status, 'passed');
  report.mobileChecks = mobile.checks.length;
  report.sourceFingerprintAfter = (await snapshot()).fingerprint;
  if (report.sourceFingerprintAfter !== report.sourceFingerprint) {
    report.status = 'source_changed_during_verification';
    process.exitCode = 1;
    console.error(
      'Source changed while checks ran; this report does not certify the final source.',
    );
  }
}
await saveEvidence(file, JSON.stringify(report, null, 2));
