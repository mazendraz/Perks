import { writeFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  cloudflaredAsset,
  cloudflaredPath,
  cloudflaredVersion,
  checkedCloudflared,
  cloudflaredEnvironment,
} from './cloudflared-runtime.js';
const path = await cloudflaredPath(),
  asset = cloudflaredAsset();
if (!existsSync(path)) {
  const response = await fetch(
    'https://github.com/cloudflare/cloudflared/releases/download/' +
      cloudflaredVersion +
      '/' +
      asset.name,
    { signal: AbortSignal.timeout(120000) },
  );
  if (!response.ok) throw new Error('Official cloudflared download failed.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
    throw new Error('Official download checksum mismatch.');
  await writeFile(path, bytes, { flag: 'wx', mode: 0o700 });
  if (process.platform !== 'win32') await chmod(path, 0o700);
}
await checkedCloudflared();
const result = spawnSync(path, ['--version'], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 10000,
  env: cloudflaredEnvironment(),
});
if (result.status !== 0 || !result.stdout.includes(cloudflaredVersion))
  throw new Error('Pinned tunnel binary did not pass its version check.');
console.log('Pinned cloudflared verified locally. No tunnel was opened.');
