import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { privateLocalDirectory } from './private-local.js';
export const cloudflaredVersion = '2026.10.7';
export function cloudflaredAsset() {
  if (process.arch !== 'x64')
    throw new Error('This pinned tunnel setup supports x64 Windows/Linux only.');
  if (process.platform === 'win32')
    return {
      name: 'cloudflared-windows-amd64.exe',
      sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343',
    };
  if (process.platform === 'linux')
    return {
      name: 'cloudflared-linux-amd64',
      sha256: '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872',
    };
  throw new Error('This pinned tunnel setup supports x64 Windows/Linux only.');
}
export async function cloudflaredPath() {
  return resolve(
    await privateLocalDirectory('cloudflared', cloudflaredVersion),
    cloudflaredAsset().name,
  );
}
export async function checkedCloudflared() {
  const path = await cloudflaredPath(),
    stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex') !== cloudflaredAsset().sha256
  )
    throw new Error('Pinned cloudflared checksum mismatch; nothing was published.');
  return path;
}
export function cloudflaredEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'PATH',
    'PATHEXT',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ])
    if (process.env[key]) env[key] = process.env[key];
  return env;
}
