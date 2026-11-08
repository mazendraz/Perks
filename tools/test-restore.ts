import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readConfig } from '../apps/api/src/config.js';
const c = readConfig(),
  url = new URL(c.DATABASE_MIGRATOR_URL!);
assert.ok(['development', 'test'].includes(c.APP_ENV));
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '55432');
assert.equal(url.pathname, '/nuqta_local');
const database = 'nuqta_restore_' + Date.now();
assert.match(database, /^nuqta_restore_\d+$/);
const bin =
  process.env.PG_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/17/bin' : '');
const executable = (name: string) =>
  bin ? join(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
for (const name of ['pg_dump', 'pg_restore'])
  if (bin) assert.ok(existsSync(executable(name)), name + ' must be installed.');
const args = ['-h', url.hostname, '-p', url.port, '-U', decodeURIComponent(url.username)];
const env = {
  ...process.env,
  PGPASSWORD: decodeURIComponent(url.password),
  PGCONNECT_TIMEOUT: '5',
};
function run(name: string, args: string[]) {
  const r = spawnSync(executable(name), args, {
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 60000,
  });
  if (r.status !== 0 || r.error)
    throw new Error(name + ' failed; inspect local PostgreSQL logs. Credentials are not printed.');
}
async function fingerprint(db: pg.Client) {
  const counts: Record<string, number> = {};
  for (const table of [
    'schema_migrations',
    'users',
    'merchants',
    'branches',
    'memberships',
    'loyalty_transactions',
    'ledger_entries',
    'reward_grants',
    'reward_redemptions',
    'outbox_events',
    'background_jobs',
  ])
    counts[table] = Number(
      (await db.query('SELECT count(*) AS n FROM ' + pg.escapeIdentifier(table))).rows[0].n,
    );
  const checks = (
    await db.query(
      "SELECT (SELECT md5(coalesce(string_agg(id::text||quantity::text,'' ORDER BY id),'')) FROM loyalty_transactions) AS transactions,(SELECT md5(coalesce(string_agg(id::text||amount::text,'' ORDER BY id),'')) FROM ledger_entries) AS ledger,(SELECT md5(coalesce(string_agg(membership_id::text||balance::text||revision::text,'' ORDER BY membership_id),'')) FROM loyalty_accounts) AS accounts,(SELECT count(*)::int FROM loyalty_accounts a WHERE balance<>(SELECT coalesce(sum(amount),0) FROM ledger_entries e WHERE e.membership_id=a.membership_id)) AS drift",
    )
  ).rows[0];
  return { counts, checks };
}
const source = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  rootUrl = new URL(url);
rootUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: rootUrl.href });
let created = false,
  restored: pg.Client | undefined;
const start = performance.now();
try {
  await source.connect();
  await admin.connect();
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot = (await source.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
  const before = await fingerprint(source);
  await mkdir('.local/backups', { recursive: true });
  const backup = resolve('.local/backups', 'nuqta-' + Date.now() + '.dump');
  const b = performance.now();
  run('pg_dump', [...args, '-d', 'nuqta_local', '-Fc', '--snapshot=' + snapshot, '-f', backup]);
  const backupMs = performance.now() - b;
  await source.query('COMMIT');
  await admin.query('CREATE DATABASE ' + pg.escapeIdentifier(database));
  created = true;
  const r = performance.now();
  run('pg_restore', [...args, '-d', database, '--no-owner', '--no-acl', '--exit-on-error', backup]);
  const restoreMs = performance.now() - r;
  const restoreUrl = new URL(url);
  restoreUrl.pathname = '/' + database;
  restored = new pg.Client({ connectionString: restoreUrl.href });
  await restored.connect();
  const after = await fingerprint(restored);
  assert.deepEqual(after, before);
  assert.equal(after.checks.drift, 0);
  await mkdir('docs/execution/evidence/implementation', { recursive: true });
  await writeFile(
    'docs/execution/evidence/implementation/restore.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        snapshotConsistent: true,
        isolatedRestore: true,
        backupMs,
        restoreMs,
        totalMs: performance.now() - start,
        matched: after.counts,
        balanceDrift: after.checks.drift,
        limitations: [
          'Logical local backup/restore only; WAL/PITR and hosted disaster recovery are not proven.',
          'Restored database never runs an API, worker or provider delivery.',
          'Backup is retained privately in ignored .local/backups; credentials are not logged.',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS isolated snapshot backup/restore: exact core-table counts, transaction/ledger/account digests and zero balance drift.',
  );
} finally {
  await restored?.end();
  await source.end();
  if (created) {
    assert.match(database, /^nuqta_restore_\d+$/);
    await admin.query('DROP DATABASE ' + pg.escapeIdentifier(database) + ' WITH (FORCE)');
  }
  await admin.end();
}
