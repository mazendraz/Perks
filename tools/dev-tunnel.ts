import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { prepareTunnel, serveTunnel } from './tunnel-fixture.js';
import { checkedCloudflared, cloudflaredEnvironment } from './cloudflared-runtime.js';
import { quickOrigin } from './tunnel-policy.js';

const args = process.argv.slice(2),
  publish = args.includes('--publish-synthetic');
if (args.some((arg) => !['--publish-synthetic', '--prepare'].includes(arg)))
  throw new Error('Use --prepare or --publish-synthetic.');
let child: ChildProcess | undefined, service: Awaited<ReturnType<typeof serveTunnel>> | undefined;
const placeholder = createServer((_req, res) => {
  res.statusCode = 503;
  res.end('Preparing synthetic test.');
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await Promise.race([
      new Promise<void>((r) => child!.once('exit', () => r())),
      new Promise<void>((r) => setTimeout(r, 5000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  if (placeholder.listening) await new Promise<void>((r) => placeholder.close(() => r()));
  await service?.stop();
}
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
try {
  // Missing binary/occupied web port fails before provisioning or publication.
  const binary = publish ? await checkedCloudflared() : undefined;
  if (publish)
    await new Promise<void>((r, j) => {
      placeholder.once('error', j);
      placeholder.listen(5173, '127.0.0.1', r);
    });
  const fixture = await prepareTunnel();
  if (stopping) throw new Error('Preparation canceled.');
  console.log('Fresh synthetic fixture: ' + fixture.database);
  console.log('Private test logins: ' + resolve(fixture.root, 'logins.txt'));
  if (!publish) {
    console.log(
      'Prepared locally. After owner approval, run npm run dev:tunnel -- --publish-synthetic. It always creates a fresh isolated test.',
    );
  } else {
    const configPath = resolve(fixture.root, 'cloudflared.yml');
    await writeFile(configPath, '{}\n', { flag: 'wx', mode: 0o600 });
    child = spawn(
      binary!,
      ['--config', configPath, '--no-autoupdate', 'tunnel', '--url', 'http://127.0.0.1:5173'],
      {
        cwd: fixture.root,
        windowsHide: true,
        env: cloudflaredEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const origin = await new Promise<string>((r, j) => {
      let buffer = '';
      const timeout = setTimeout(() => j(new Error('Quick Tunnel URL was not issued.')), 45000);
      const finish = (error?: Error, value?: string) => {
        clearTimeout(timeout);
        if (error) j(error);
        else r(value!);
      };
      const output = (chunk: Buffer) => {
        buffer = (buffer + chunk.toString()).slice(-16384);
        const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?=\s|[|]|$)/);
        if (match) finish(undefined, quickOrigin(match[0]));
      };
      child!.stdout!.on('data', output);
      child!.stderr!.on('data', output);
      child!.once('error', () => finish(new Error('Tunnel process failed.')));
      child!.once('exit', () => finish(new Error('Tunnel closed before startup.')));
    });
    if (stopping) throw new Error('Tunnel startup canceled.');
    await new Promise<void>((r) => placeholder.close(() => r()));
    if (stopping || child.exitCode !== null || child.signalCode !== null)
      throw new Error('Tunnel closed during startup.');
    service = await serveTunnel(fixture, origin);
    if (stopping || child.exitCode !== null || child.signalCode !== null) {
      await service.stop();
      throw new Error('Tunnel closed during startup.');
    }
    child.once('exit', () => {
      void stop();
    });
    console.log('Synthetic phone test: ' + origin + '/login');
    console.log(
      'Use test data only. Ctrl+C closes the link. Polling is active because Quick Tunnels do not support SSE.',
    );
  }
} catch {
  await stop();
  console.error(
    'Phone-test setup stopped. No existing database was changed. Check port5173, local DB and tunnel:setup.',
  );
  process.exitCode = 1;
}
