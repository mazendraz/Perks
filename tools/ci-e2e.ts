import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { readConfig } from '../apps/api/src/config.js';

const c = readConfig();
assert.equal(c.APP_ENV, 'test');
assert.equal(c.AUTH_PROVIDER, 'local');
assert.equal(new URL(c.DATABASE_MIGRATOR_URL!).hostname, '127.0.0.1');
assert.equal(new URL(c.DATABASE_MIGRATOR_URL!).pathname, '/nuqta_ci');
assert.equal(c.PUBLIC_APP_ORIGIN, 'http://127.0.0.1:5173');
const urls = ['http://127.0.0.1:4100/health/ready', c.PUBLIC_APP_ORIGIN];
for (const url of urls) {
  const occupied = await fetch(url, { signal: AbortSignal.timeout(1000) }).then(
    () => true,
    () => false,
  );
  assert.equal(occupied, false, 'CI requires unused API and web ports.');
}
await mkdir('.local', { recursive: true });
const log = await open('.local/ci-servers.log', 'w');
const children: ChildProcess[] = [];
function start(args: string[]) {
  const child = spawn(process.execPath, args, {
    stdio: ['ignore', log.fd, log.fd],
    windowsHide: true,
  });
  children.push(child);
  child.on('error', () => {
    process.exitCode = 1;
  });
  return child;
}
async function stop() {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill();
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      setTimeout(5000),
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await log.close();
}
try {
  start(['--import', 'tsx', 'apps/api/src/main.ts']);
  start(['node_modules/vite/bin/vite.js', '--config', 'apps/web/vite.config.ts', 'apps/web']);
  const deadline = Date.now() + 45000;
  for (const url of urls) {
    let ready = false;
    while (Date.now() < deadline) {
      assert.ok(
        children.every((child) => child.exitCode === null && child.signalCode === null),
        'CI server exited.',
      );
      ready = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(
        (r) => r.ok,
        () => false,
      );
      if (ready) break;
      await setTimeout(250);
    }
    assert.ok(ready, 'CI server readiness timeout. See .local/ci-servers.log.');
  }
  const test = spawn(process.execPath, ['--import', 'tsx', 'tools/test-e2e.ts'], {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, NUQTA_E2E_BROWSER: 'chromium' },
  });
  children.push(test);
  process.exitCode = await new Promise<number>((resolve) => {
    test.once('exit', (code) => resolve(code ?? 1));
    test.once('error', () => resolve(1));
  });
  if (!process.exitCode) {
    const mobile = spawn(process.execPath, ['--import', 'tsx', 'tools/test-mobile.ts'], {
      stdio: 'inherit',
      windowsHide: true,
    });
    children.push(mobile);
    process.exitCode = await new Promise<number>((resolve) => {
      mobile.once('exit', (code) => resolve(code ?? 1));
      mobile.once('error', () => resolve(1));
    });
  }
  if (!process.exitCode) {
    const animation = spawn(process.execPath, ['--import', 'tsx', 'tools/test-stamp-motion.ts'], {
      stdio: 'inherit',
      windowsHide: true,
    });
    children.push(animation);
    process.exitCode = await new Promise<number>((resolve) => {
      animation.once('exit', (code) => resolve(code ?? 1));
      animation.once('error', () => resolve(1));
    });
  }
} finally {
  await stop();
}
