import { mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import pg from 'pg';
import { readMigrationConfig } from '../apps/api/src/config.js';
import { exportPrivacyManifest, applyPrivacyManifest } from './privacy-manifest.js';
const [mode, file, ...flags] = process.argv.slice(2);
if (
  !['export', 'apply'].includes(mode || '') ||
  !file ||
  flags.some((f) => f !== '--offline-confirmed')
)
  throw new Error('Use privacy:manifest export|apply <private-file> [--offline-confirmed].');
const c = readMigrationConfig(),
  pepper = process.env.AUTH_PEPPER || '',
  path = resolve(file);
const db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
try {
  await db.connect();
  if (mode === 'export') {
    const manifest = await exportPrivacyManifest(db, pepper);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(
      JSON.stringify({
        exported: manifest.payload.records.length,
        file: path,
        containsNamesOrPhones: false,
      }),
    );
  } else {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
      throw new Error('Invalid private manifest file.');
    const result = await applyPrivacyManifest(
      db,
      JSON.parse(await readFile(path, 'utf8')),
      pepper,
      flags.includes('--offline-confirmed'),
    );
    console.log(JSON.stringify(result));
  }
} catch {
  console.error(
    'Privacy manifest operation failed. Keep the restore offline and verify the private file, deployment identity and signing key.',
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
