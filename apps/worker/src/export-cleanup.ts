import { opendir, lstat, unlink } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import type pg from 'pg';

// Downloads live for one hour. Two hours allows abandoned writes to lose their
// lease before reclamation. Work per sweep is bounded; the cursor rotates.
const retentionMs = 2 * 60 * 60 * 1000;
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const merchantPattern = new RegExp('^' + uuid + '$');
const filePattern = new RegExp('^' + uuid + '-' + uuid + '\\.csv$');
const scans = new Map<string, AsyncGenerator<string | null>>();
async function* scan(root: string): AsyncGenerator<string | null> {
  try {
    for await (const merchant of await opendir(root)) {
      yield null;
      if (!merchant.isDirectory() || !merchantPattern.test(merchant.name)) continue;
      for await (const entry of await opendir(resolve(root, merchant.name)))
        yield entry.isFile() && filePattern.test(entry.name)
          ? merchant.name + '/' + entry.name
          : null;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}
export async function cleanupExports(pool: pg.Pool, root = resolve('.local/exports')) {
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { examined: 0, removed: 0 };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { examined: 0, removed: 0 };
    throw e;
  }
  let iterator = scans.get(root);
  if (!iterator) {
    iterator = scan(root);
    scans.set(root, iterator);
  }
  let examined = 0,
    removed = 0;
  for (let walked = 0; walked < 2000 && examined < 200; walked++) {
    const next = await iterator.next();
    if (next.done) {
      scans.delete(root);
      break;
    }
    const key = next.value;
    if (!key) continue;
    examined++;
    const path = resolve(root, key),
      rel = relative(root, path);
    if (rel.startsWith('..' + sep) || rel === '..' || rel === '') continue;
    // Do not follow replacement symlinks/junctions in either path component.
    const parent = await lstat(resolve(root, key.split('/')[0]!));
    if (!parent.isDirectory() || parent.isSymbolicLink()) continue;
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'export-file:' + key,
      ]);
      const stat = await lstat(path);
      if (stat.isFile() && !stat.isSymbolicLink() && Date.now() - stat.mtimeMs >= retentionMs) {
        const result = await db.query('SELECT export_artifact_deletable($1) AS allowed', [key]);
        if (result.rows[0].allowed) {
          await unlink(path);
          removed++;
        }
      }
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    } finally {
      db.release();
    }
  }
  return { examined, removed };
}
