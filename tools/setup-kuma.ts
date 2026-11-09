import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { kumaRoot, kumaVersion, checkKuma, localRuntimePath } from './kuma-runtime.js';
mkdirSync(resolve('.local'), { recursive: true });
await localRuntimePath(resolve('.local'));
const log = resolve('.local/kuma-setup.log');
const execute = (command: string, args: string[], cwd = process.cwd()) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180000,
  });
  writeFileSync(log, (result.stdout || '') + '\n' + (result.stderr || ''), { mode: 0o600 });
  if (result.status !== 0)
    throw new Error('Kuma setup failed; inspect the private.local/kuma-setup.log.');
};
if (!existsSync(kumaRoot))
  execute('git', [
    'clone',
    '--depth',
    '1',
    '--branch',
    kumaVersion,
    'https://github.com/louislam/uptime-kuma.git',
    kumaRoot,
  ]);
await checkKuma(false);
assert.ok(resolve(kumaRoot, 'node_modules').startsWith(kumaRoot + sep));
if (existsSync(resolve(kumaRoot, 'node_modules'))) {
  const modules = await localRuntimePath(resolve(kumaRoot, 'node_modules'));
  assert.ok(modules.startsWith((await localRuntimePath(kumaRoot)) + sep));
}
// npm ci only replaces this pinned dependency checkout's node_modules.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Use npm run monitoring:setup.');
execute(process.execPath, [npmCli, 'ci', '--omit=dev', '--no-audit', '--no-fund'], kumaRoot);
if (!existsSync(resolve(kumaRoot, 'dist/index.html'))) {
  if (existsSync(resolve(kumaRoot, 'dist')))
    assert.ok(
      (await localRuntimePath(resolve(kumaRoot, 'dist'))).startsWith(
        (await localRuntimePath(kumaRoot)) + sep,
      ),
    );
  assert.ok(
    !existsSync(resolve(kumaRoot, 'dist-backup')),
    'Retain and inspect an existing vendor dist backup.',
  );
  execute(process.execPath, [npmCli, 'run', 'download-dist'], kumaRoot);
}
await checkKuma();
console.log(
  'Pinned Kuma' +
    kumaVersion +
    ' prepared locally; no external account or notification configured.',
);
