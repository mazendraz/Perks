import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, readdir, symlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import sharp from 'sharp';
import { LocalDiskStore, storageKey } from '../../apps/api/src/storage/file-store.js';
import { sanitizeLogo } from '../../apps/api/src/storage/logo.js';
test('FileStore rejects traversal/absolute/noncanonical keys and replaces complete private files atomically', async () => {
  const owner = randomUUID(),
    id = randomUUID();
  for (const key of [
    '../outside.png',
    '/tmp/file.png',
    'C:\\private\\file.png',
    owner + '/../' + id + '.png',
    'exports/' + owner + '/' + id + '.png',
    owner + '/' + id + '.svg',
    'exports/' + owner + '/' + id + '-' + id + '.csv',
  ])
    assert.throws(() => storageKey(key), /INVALID_STORAGE_KEY/);
  await mkdir('.local', { recursive: true });
  const root = await mkdtemp(resolve('.local', 'store-test-')),
    store = new LocalDiskStore(root);
  const key = 'exports/' + owner + '/' + id + '.csv',
    a = Buffer.alloc(256 * 1024, 65),
    b = Buffer.alloc(256 * 1024, 66);
  try {
    assert.equal(await store.exists(key), false);
    await store.put(key, a, { contentType: 'text/csv' });
    await Promise.all([
      (async () => {
        for (let i = 0; i < 3; i++)
          await store.put(key, i % 2 ? a : b, { contentType: 'text/csv' });
      })(),
      (async () => {
        for (let i = 0; i < 12; i++) {
          const current = await store.get(key);
          assert.ok(current.equals(a) || current.equals(b));
        }
      })(),
    ]);
    assert.deepEqual(await readdir(resolve(root, 'exports', owner)), [id + '.csv']);
    if (process.platform !== 'win32') {
      assert.equal((await stat(resolve(root, 'exports', owner))).mode & 0o777, 0o700);
      assert.equal((await stat(resolve(root, 'exports', owner, id + '.csv'))).mode & 0o777, 0o600);
    }
    await store.delete(key);
    await store.delete(key);
    assert.equal(await store.exists(key), false);
    await assert.rejects(store.get(key), /NOT_FOUND/);
  } finally {
    assert.ok(resolve(root).startsWith(resolve('.local') + sep));
    await rm(root, { recursive: true, force: true });
  }
});
test('logo decoding limits dimensions/bytes, strips metadata and rejects SVG or disguised non-image input', async () => {
  const input = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: '#204c41' },
  })
    .withExif({ IFD0: { Copyright: 'private metadata fixture' } })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(input).metadata()).exif);
  const clean = await sanitizeLogo(input.toString('base64')),
    meta = await sharp(clean.bytes).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 768);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.icc, undefined);
  assert.ok(clean.bytes.length <= 2000000);
  for (const bytes of [
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>',
    ),
    Buffer.from('fake png payload'),
  ])
    await assert.rejects(sanitizeLogo(bytes.toString('base64')), /UNSAFE_FILE/);
  await assert.rejects(sanitizeLogo(Buffer.alloc(2000001).toString('base64')), /ASSET_TOO_LARGE/);
});
test(
  'FileStore refuses symlinks instead of reading files outside its namespace',
  {
    skip:
      process.platform === 'win32'
        ? 'The symlink fixture runs on Linux; traversal and atomic writes run on every platform.'
        : false,
  },
  async () => {
    const root = await mkdtemp(resolve('.local', 'store-links-')),
      owner = randomUUID(),
      id = randomUUID(),
      store = new LocalDiskStore(root);
    try {
      await mkdir(resolve(root, 'assets', owner), { recursive: true });
      await writeFile(resolve(root, 'outside'), 'private fixture');
      await symlink(resolve(root, 'outside'), resolve(root, 'assets', owner, id + '.png'));
      await assert.rejects(store.get(owner + '/' + id + '.png'), /UNSAFE_STORAGE_PATH/);
    } finally {
      assert.ok(resolve(root).startsWith(resolve('.local') + sep));
      await rm(root, { recursive: true, force: true });
    }
  },
);
