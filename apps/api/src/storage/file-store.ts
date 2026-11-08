import { mkdir, chmod, lstat, open, rename, unlink, opendir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { resolve, dirname } from 'node:path';
import type { Config } from '../config.js';
import { AppError } from '../errors.js';

export const storageUuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const png = new RegExp('^' + storageUuid + '/' + storageUuid + '[.]png$');
const csv = new RegExp('^exports/' + storageUuid + '/' + storageUuid + '[.]csv$');
const owner = new RegExp('^' + storageUuid + '$');
const csvFile = new RegExp('^' + storageUuid + '[.]csv$');
export function storageKey(key: string) {
  const normalized = key.toLowerCase();
  if (!png.test(normalized) && !csv.test(normalized))
    throw new AppError('INVALID_STORAGE_KEY', 422);
  return normalized;
}
export interface StoredFile {
  key: string;
  modifiedAt: number;
  bytes: number;
}
export interface FileStore {
  readonly namespace: string;
  put(
    key: string,
    bytes: Uint8Array,
    options: { contentType: 'image/png' | 'text/csv' },
  ): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  stat(key: string): Promise<StoredFile | null>;
  scan(prefix: 'exports'): AsyncGenerator<StoredFile | null>;
}
export class LocalDiskStore implements FileStore {
  readonly root: string;
  readonly namespace: string;
  constructor(root: string) {
    this.root = resolve(root);
    this.namespace = 'disk:' + this.root;
  }
  private async directory(path: string, create = false) {
    if (create) await mkdir(path, { recursive: true, mode: 0o700 });
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new AppError('UNSAFE_STORAGE_PATH', 422);
    if (create && process.platform !== 'win32') await chmod(path, 0o700);
  }
  private async path(key: string, create = false) {
    key = storageKey(key);
    const parts = (key.startsWith('exports/') ? key : 'assets/' + key).split('/');
    await this.directory(this.root, create);
    let parent = this.root;
    for (const part of parts.slice(0, -1)) {
      parent = resolve(parent, part);
      await this.directory(parent, create);
    }
    const path = resolve(parent, parts.at(-1)!);
    try {
      const entry = await lstat(path);
      if (!entry.isFile() || entry.isSymbolicLink()) throw new AppError('UNSAFE_STORAGE_PATH', 422);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return path;
  }
  async put(key: string, bytes: Uint8Array, options: { contentType: 'image/png' | 'text/csv' }) {
    key = storageKey(key);
    if ((key.endsWith('.png') ? 'image/png' : 'text/csv') !== options.contentType)
      throw new AppError('INVALID_STORAGE_KEY', 422);
    const path = await this.path(key, true),
      temp = resolve(dirname(path), randomUUID() + '.tmp');
    try {
      const file = await open(temp, 'wx', 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(temp, path);
          break;
        } catch (error) {
          if (
            attempt === 5 ||
            !['EPERM', 'EACCES', 'EBUSY', 'UNKNOWN'].includes(
              (error as NodeJS.ErrnoException).code || '',
            )
          )
            throw error;
          await setTimeout(20 * 2 ** attempt);
        }
      }
      if (process.platform !== 'win32') {
        const directory = await open(dirname(path), 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  async get(key: string) {
    try {
      const path = await this.path(key);
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        if (!(await file.stat()).isFile()) throw new AppError('UNSAFE_STORAGE_PATH', 422);
        return await file.readFile();
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new AppError('NOT_FOUND', 404, false, { cause: error });
      throw error;
    }
  }
  async stat(key: string): Promise<StoredFile | null> {
    key = storageKey(key);
    try {
      const entry = await lstat(await this.path(key));
      return { key, modifiedAt: entry.mtimeMs, bytes: entry.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async exists(key: string) {
    return !!(await this.stat(key));
  }
  async delete(key: string) {
    try {
      await unlink(await this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  async *scan(prefix: 'exports'): AsyncGenerator<StoredFile | null> {
    if (prefix !== 'exports') throw new AppError('INVALID_STORAGE_KEY', 422);
    try {
      await this.directory(this.root);
      const directory = resolve(this.root, prefix);
      await this.directory(directory);
      for await (const merchant of await opendir(directory)) {
        yield null;
        if (!merchant.isDirectory() || merchant.isSymbolicLink() || !owner.test(merchant.name))
          continue;
        const path = resolve(directory, merchant.name);
        await this.directory(path);
        for await (const entry of await opendir(path)) {
          if (!entry.isFile() || entry.isSymbolicLink() || !csvFile.test(entry.name)) {
            yield null;
            continue;
          }
          yield await this.stat('exports/' + merchant.name + '/' + entry.name);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
const stores = new Map<string, LocalDiskStore>();
export function createFileStore(c: Pick<Config, 'STORAGE_ROOT'>): FileStore {
  const root = resolve(c.STORAGE_ROOT);
  if (!stores.has(root)) stores.set(root, new LocalDiskStore(root));
  return stores.get(root)!;
}
