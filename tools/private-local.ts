import { mkdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function privateLocalDirectory(...parts: string[]) {
  let path = resolve('.local');
  await mkdir(path, { recursive: true });
  if ((await realpath(path)) !== path)
    throw new Error('Private local directory must not be a junction.');
  for (const part of parts) {
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part))
      throw new Error('Invalid private directory component.');
    path = resolve(path, part);
    await mkdir(path, { recursive: true });
    if ((await realpath(path)) !== path)
      throw new Error('Private directory must not be a junction.');
  }
  return path;
}
