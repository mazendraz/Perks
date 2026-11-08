import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { readConfig } from '../apps/api/src/config.js';
const c = readConfig();
if (!c.DATABASE_MIGRATOR_URL)
  throw new Error('A migration connection is required for isolated integration tests.');
const database = 'nuqta_test_' + Date.now();
if (!/^nuqta_test_\d+$/.test(database)) throw new Error('Invalid test database name');
const rootUrl = new URL(c.DATABASE_MIGRATOR_URL);
rootUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: rootUrl.href, connectionTimeoutMillis: 5000 });
await admin.connect();
await admin.query('CREATE DATABASE ' + pg.escapeIdentifier(database));
const withDatabase = (value: string) => {
  const url = new URL(value);
  url.pathname = '/' + database;
  return url.href;
};
const env = {
  ...process.env,
  APP_ENV: 'test',
  DATABASE_MIGRATOR_URL: withDatabase(c.DATABASE_MIGRATOR_URL),
  DATABASE_URL: withDatabase(c.DATABASE_URL),
  AUTH_DATABASE_URL: withDatabase(c.AUTH_DATABASE_URL),
  ...(c.WORKER_DATABASE_URL ? { WORKER_DATABASE_URL: withDatabase(c.WORKER_DATABASE_URL) } : {}),
  LOG_LEVEL: 'silent',
};
try {
  for (const args of [
    ['--import', 'tsx', 'db/migrate.ts'],
    ['--import', 'tsx', '--test', '--test-concurrency=1', 'tests/integration/*.test.ts'],
  ]) {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit', env, windowsHide: true });
    if (result.status !== 0) {
      process.exitCode = result.status || 1;
      break;
    }
  }
} finally {
  // Only this invocation's freshly created, strictly validated test database is dropped.
  await admin.query('DROP DATABASE ' + pg.escapeIdentifier(database) + ' WITH (FORCE)');
  await admin.end();
}
