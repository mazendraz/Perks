import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
export const kumaVersion = '2.5.9';
export const kumaCommit = 'df601c58d9205562f34cfe5ef35264b341019d19';
export const kumaRoot = resolve('.local/uptime-kuma');
export async function localRuntimePath(path: string) {
  const workspace = await realpath(resolve('.')),
    local = await realpath(resolve('.local'));
  assert.ok(
    local.startsWith(workspace + sep),
    'Local runtime must stay inside the real workspace.',
  );
  const target = await realpath(path);
  assert.ok(
    target === local || target.startsWith(local + sep),
    'Runtime junction/symlink escapes the workspace.',
  );
  return target;
}
export async function checkKuma(assets = true) {
  assert.ok(kumaRoot.startsWith(resolve('.local') + sep));
  await localRuntimePath(kumaRoot);
  const pkg = JSON.parse(await readFile(resolve(kumaRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.version, kumaVersion);
  const git = spawnSync('git', ['-C', kumaRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(git.status, 0, 'Prepare the local Kuma runtime first.');
  assert.equal(
    git.stdout.trim(),
    kumaCommit,
    'Kuma source must match its pinned official release.',
  );
  const diff = spawnSync('git', ['-C', kumaRoot, 'diff', '--quiet'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(diff.status, 0, 'The pinned vendor source has local modifications.');
  if (assets)
    assert.ok(existsSync(resolve(kumaRoot, 'dist/index.html')), 'Run npm run monitoring:setup.');
}
export async function startKuma(data: string, port: number, extraCaFile?: string) {
  await checkKuma();
  const directory = resolve(data);
  assert.ok(
    directory.startsWith(resolve('.local') + sep),
    'Kuma local data must stay inside.local.',
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await localRuntimePath(directory);
  const allowed = [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'COMSPEC',
    'HOME',
    'LANG',
    'LC_ALL',
    'TZ',
  ];
  const environment: NodeJS.ProcessEnv = {};
  for (const name of allowed) if (process.env[name]) environment[name] = process.env[name];
  Object.assign(environment, {
    NODE_ENV: 'production',
    UPTIME_KUMA_HOST: '127.0.0.1',
    UPTIME_KUMA_PORT: String(port),
    UPTIME_KUMA_DB_TYPE: 'sqlite',
    DATA_DIR: directory,
  });
  if (extraCaFile) environment.NODE_EXTRA_CA_CERTS = resolve(extraCaFile);
  const log = createWriteStream(resolve(directory, 'runtime.log'), { flags: 'a', mode: 0o600 });
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: kumaRoot,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once('exit', () => log.end());
  return child;
}
export async function stopKuma(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveExit) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
    child.kill('SIGTERM');
  });
}
export type KumaSocket = {
  on: (event: string, listener: (...args: unknown[]) => void) => KumaSocket;
  once: (event: string, listener: (...args: unknown[]) => void) => KumaSocket;
  emit: (event: string, ...args: unknown[]) => void;
  connect: () => void;
  disconnect: () => void;
};
export async function connectKuma(origin: string) {
  const requireKuma = createRequire(resolve(kumaRoot, 'package.json'));
  const { io } = requireKuma('socket.io-client') as {
    io: (origin: string, options: Record<string, unknown>) => KumaSocket;
  };
  const socket = io(origin, {
    autoConnect: false,
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
    extraHeaders: { Origin: origin },
  });
  await new Promise<void>((resolveConnection, reject) => {
    const timer = setTimeout(() => reject(new Error('Local Kuma handshake timed out.')), 10000);
    // Kuma awaits its initial info query before registering command listeners.
    socket.once('info', () => {
      clearTimeout(timer);
      resolveConnection();
    });
    socket.once('connect_error', () => {
      clearTimeout(timer);
      reject(new Error('Local Kuma socket connection failed.'));
    });
    socket.connect();
  });
  return socket;
}
export async function kumaCommand(socket: KumaSocket, event: string, ...args: unknown[]) {
  return new Promise<Record<string, unknown>>((resolveReply, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Local Kuma command timed out: ' + event)),
      10000,
    );
    socket.emit(event, ...args, (value: unknown) => {
      clearTimeout(timer);
      if (!value || typeof value !== 'object' || (value as { ok?: boolean }).ok !== true)
        return reject(new Error('Local Kuma command failed: ' + event));
      resolveReply(value as Record<string, unknown>);
    });
  });
}
