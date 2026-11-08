import { readFile, readdir, lstat, unlink, utimes } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readConfig, type Config } from '../apps/api/src/config.js';
import { LocalDiskStore, storageKey, storageUuid } from '../apps/api/src/storage/file-store.js';
import { tokenHash } from '../apps/api/src/crypto.js';

async function privateFile(root: string, path: string) {
  const rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))
    throw new Error('Unsafe legacy path.');
  let current = root;
  try {
    const base = await lstat(root);
    if (!base.isDirectory() || base.isSymbolicLink()) throw new Error('Unsafe legacy directory.');
    const parts = rel.split(sep);
    for (let i = 0; i < parts.length; i++) {
      current = resolve(current, parts[i]!);
      const info = await lstat(current);
      if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
        throw new Error('Unsafe legacy file.');
    }
    return { bytes: await readFile(path), info: await lstat(path) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function migrateLocalStorage(c: Config, legacyRoot = resolve('.local')) {
  const url = new URL(c.DATABASE_MIGRATOR_URL!);
  if (
    !['development', 'test'].includes(c.APP_ENV) ||
    url.hostname !== '127.0.0.1' ||
    !/^\/(nuqta_local|nuqta_manual_mazen|nuqta_(?:manual_)?test_\d+)$/.test(url.pathname)
  )
    throw new Error('Storage migration is limited to Nuqta local/test databases.');
  legacyRoot = resolve(legacyRoot);
  const files = new LocalDiskStore(c.STORAGE_ROOT),
    db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
  const stats = {
    assetsVerified: 0,
    assetsCopied: 0,
    draftLogosCopied: 0,
    exportsConverted: 0,
    missingFiles: 0,
  };
  await db.connect();
  try {
    if (
      !(await db.query("SELECT 1 FROM schema_migrations WHERE name='009v_file_store_exports.sql'"))
        .rowCount
    )
      throw new Error('Apply migrations before moving storage.');
    for (const logo of (await db.query('SELECT id,merchant_id,sha256 FROM assets')).rows) {
      const key = storageKey(logo.merchant_id + '/' + logo.id + '.png');
      const source = await privateFile(legacyRoot, resolve(legacyRoot, 'assets', key));
      if (await files.exists(key)) {
        if (tokenHash((await files.get(key)).toString('base64')) !== logo.sha256)
          throw new Error('Existing asset bytes differ; no overwrite performed.');
        stats.assetsVerified++;
      } else if (source) {
        if (tokenHash(source.bytes.toString('base64')) !== logo.sha256)
          throw new Error('Legacy asset digest differs.');
        await files.put(key, source.bytes, { contentType: 'image/png' });
        stats.assetsCopied++;
      } else stats.missingFiles++;
    }
    for (const logo of (
      await db.query('SELECT id,draft_id,created_by,sha256 FROM provisioning_logos')
    ).rows) {
      const key = storageKey(logo.draft_id + '/' + logo.id + '.png');
      if (!new RegExp('^' + storageUuid + '$').test(logo.created_by))
        throw new Error('Invalid draft owner.');
      if (await files.exists(key)) {
        if (tokenHash((await files.get(key)).toString('base64')) !== logo.sha256)
          throw new Error('Draft asset digest differs.');
        continue;
      }
      const source = await privateFile(
        legacyRoot,
        resolve(legacyRoot, 'draft-assets', logo.created_by, logo.draft_id, logo.id + '.png'),
      );
      if (!source) {
        stats.missingFiles++;
        continue;
      }
      if (tokenHash(source.bytes.toString('base64')) !== logo.sha256)
        throw new Error('Legacy draft digest differs.');
      await files.put(key, source.bytes, { contentType: 'image/png' });
      stats.draftLogosCopied++;
    }
    const exportRoot = resolve(legacyRoot, 'exports'),
      owner = new RegExp('^' + storageUuid + '$'),
      oldName = new RegExp('^(' + storageUuid + ')-(' + storageUuid + ')[.]csv$');
    let merchants: Dirent[];
    try {
      const directory = await lstat(exportRoot);
      if (!directory.isDirectory() || directory.isSymbolicLink())
        throw new Error('Unsafe legacy export directory.');
      merchants = await readdir(exportRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      merchants = [];
    }
    for (const merchant of merchants) {
      if (!merchant.isDirectory() || merchant.isSymbolicLink() || !owner.test(merchant.name))
        continue;
      for (const item of await readdir(resolve(exportRoot, merchant.name), {
        withFileTypes: true,
      })) {
        const match = oldName.exec(item.name);
        if (!match || !item.isFile() || item.isSymbolicLink()) continue;
        const oldKey = merchant.name + '/' + item.name,
          newKey = merchant.name + '/' + match[2] + '.csv',
          key = storageKey('exports/' + newKey),
          path = resolve(exportRoot, oldKey);
        await db.query('BEGIN');
        let inTransaction = true;
        try {
          await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            'export-file:' + oldKey,
          ]);
          const source = await privateFile(legacyRoot, path);
          if (!source) {
            await db.query('COMMIT');
            continue;
          }
          if (await files.exists(key)) {
            if (!(await files.get(key)).equals(source.bytes))
              throw new Error('Export bytes differ; no overwrite performed.');
          } else await files.put(key, source.bytes, { contentType: 'text/csv' });
          if (!(await files.get(key)).equals(source.bytes))
            throw new Error('Export copy verification failed.');
          const changed = await db.query(
            'UPDATE customer_exports SET storage_key=$1 WHERE merchant_id=$2 AND id=$3 AND storage_key=$4 RETURNING id',
            [newKey, merchant.name, match[1], oldKey],
          );
          if (changed.rowCount) {
            await db.query(
              'INSERT INTO customer_export_artifacts(storage_key,merchant_id,export_id,lease_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
              [newKey, merchant.name, match[1], match[2]],
            );
            const binding = (
              await db.query(
                'SELECT export_id,merchant_id FROM customer_export_artifacts WHERE storage_key=$1',
                [newKey],
              )
            ).rows[0];
            if (binding?.export_id !== match[1] || binding?.merchant_id !== merchant.name)
              throw new Error('Export binding differs; no legacy file removed.');
          }
          await db.query('COMMIT');
          inTransaction = false;
          await utimes(
            resolve(files.root, 'exports', newKey),
            source.info.atime,
            source.info.mtime,
          );
          // Both paths were resolved inside their named storage roots and verified byte-equal.
          await unlink(path);
          stats.exportsConverted++;
        } catch (error) {
          if (inTransaction) await db.query('ROLLBACK');
          throw error;
        }
      }
    }
    return stats;
  } finally {
    await db.end();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await migrateLocalStorage(readConfig())));
  } catch {
    console.error(
      'Storage migration stopped. Existing differing files were not overwritten; inspect the local state before retrying.',
    );
    process.exitCode = 1;
  }
}
