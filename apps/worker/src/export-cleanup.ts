import type pg from 'pg';
import {
  createFileStore,
  type FileStore,
  type StoredFile,
} from '../../api/src/storage/file-store.js';
import { readConfig } from '../../api/src/config.js';
const retentionMs = 2 * 60 * 60 * 1000;
const scans = new Map<string, AsyncGenerator<StoredFile | null>>();
export async function cleanupExports(
  pool: pg.Pool,
  files: FileStore = createFileStore(readConfig()),
) {
  let iterator = scans.get(files.namespace);
  if (!iterator) {
    iterator = files.scan('exports');
    scans.set(files.namespace, iterator);
  }
  let examined = 0,
    removed = 0;
  for (let walked = 0; walked < 2000 && examined < 200; walked++) {
    const next = await iterator.next();
    if (next.done) {
      scans.delete(files.namespace);
      break;
    }
    const entry = next.value;
    if (!entry) continue;
    examined++;
    const key = entry.key.slice('exports/'.length);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'export-file:' + key,
      ]);
      const fresh = await files.stat(entry.key);
      if (
        fresh &&
        Date.now() - fresh.modifiedAt >= retentionMs &&
        (await db.query('SELECT export_artifact_deletable($1) AS allowed', [key])).rows[0].allowed
      ) {
        await files.delete(entry.key);
        removed++;
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  return { examined, removed };
}
