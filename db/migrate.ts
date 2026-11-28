import { readFile, readdir } from 'node:fs/promises';
import { chmodSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { readMigrationConfig } from '../apps/api/src/config.js';
const c = readMigrationConfig();
if (!c.DATABASE_MIGRATOR_URL) throw new Error('DATABASE_MIGRATOR_URL is required for migrations.');
const db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
try {
  await db.connect();
  await db.query("SELECT pg_advisory_lock(hashtext('nuqta-migrations'))");
  const production = ['production', 'staging'].includes(c.APP_ENV);
  if (production) {
    const rows = (
      await db.query(
        "SELECT rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication,EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS has_memberships FROM pg_roles WHERE rolname IN ('nuqta_migrator','nuqta_runtime','nuqta_auth','nuqta_worker')",
      )
    ).rows;
    if (
      rows.length !== 4 ||
      rows.some(
        (role) =>
          role.rolsuper ||
          role.rolbypassrls ||
          role.rolcreaterole ||
          role.rolcreatedb ||
          role.rolreplication ||
          role.has_memberships,
      ) ||
      (await db.query('SELECT current_user AS role')).rows[0].role !== 'nuqta_migrator'
    )
      throw new Error(
        'Production migrations require four pre-created restricted roles and the migrator login.',
      );
  } else
    for (const [role, password] of [
      ['nuqta_runtime', process.env.NUQTA_RUNTIME_DB_PASSWORD],
      ['nuqta_auth', process.env.NUQTA_AUTH_DB_PASSWORD || process.env.NUQTA_RUNTIME_DB_PASSWORD],
      [
        'nuqta_worker',
        process.env.NUQTA_WORKER_DB_PASSWORD || process.env.NUQTA_RUNTIME_DB_PASSWORD,
      ],
    ]) {
      if (!password)
        throw new Error(
          'Local role setup requires role password variables; values will not be printed.',
        );
      if (!(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
        await db.query(
          `CREATE ROLE ${pg.escapeIdentifier(role!)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${pg.escapeLiteral(password)}`,
        );
      }
    }
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const files = (await readdir('db/migrations')).filter((f) => f.endsWith('.sql')).sort();
  // A deployed database is dumped before any new migration touches it; no dump, no migration.
  // A brand-new database has nothing to keep. MIGRATION_BACKUP=always asks for the dump anywhere;
  // =off is for Compose, whose pgBackRest service takes the pre-upgrade backup (deploy/README.md).
  const backup = process.env.MIGRATION_BACKUP;
  if ((production && backup !== 'off') || backup === 'always') {
    const applied = new Set(
      (await db.query('SELECT name FROM schema_migrations')).rows.map((row) => row.name),
    );
    const pending = files.filter((file) => !applied.has(file));
    if (pending.length && applied.size) backupBeforeMigrating(c.DATABASE_MIGRATOR_URL, pending[0]!);
  }
  for (const file of files) {
    const sql = await readFile('db/migrations/' + file, 'utf8'),
      hash = createHash('sha256').update(sql).digest('hex');
    const old = await db.query('SELECT sha256 FROM schema_migrations WHERE name=$1', [file]);
    if (old.rowCount) {
      if (old.rows[0].sha256 !== hash) throw new Error('Applied migration changed: ' + file);
      continue;
    }
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)', [file, hash]);
      await db.query('COMMIT');
      console.log('Applied ' + file);
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  }
  await db.query('GRANT USAGE ON SCHEMA public TO nuqta_runtime,nuqta_auth');
  await db.query('REVOKE SELECT ON users FROM nuqta_runtime');
  await db.query(
    'GRANT SELECT(id,email,display_name,global_role,status,created_at) ON users TO nuqta_runtime',
  );
  await db.query('GRANT SELECT ON users TO nuqta_auth');
  await db.query('REVOKE INSERT,UPDATE ON users FROM nuqta_auth');
  await db.query(
    'GRANT INSERT(email,display_name,auth_subject,password_hash,password_version,preferred_locale),UPDATE(email,auth_subject,totp_secret,last_totp_counter,password_hash,password_version,preferred_locale,password_must_change,email_verified_at) ON users TO nuqta_auth',
  );
  await db.query('GRANT SELECT,INSERT,UPDATE ON sessions,auth_challenges TO nuqta_auth');
  for (const t of ['merchants', 'branches', 'staff_memberships', 'staff_branch_grants'])
    await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${t} TO nuqta_runtime`);
  await db.query('GRANT SELECT,INSERT ON audit_events TO nuqta_runtime');
  await db.query('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC');
  for (const fn of [
    'app_user()',
    'is_platform_admin()',
    'tenant_access(uuid)',
    'branch_access(uuid,uuid)',
  ])
    await db.query(`GRANT EXECUTE ON FUNCTION ${fn} TO nuqta_runtime,nuqta_auth,nuqta_worker`);
  console.log('Migrations and restricted runtime/auth roles ready.');
} catch (e) {
  console.error(e instanceof Error ? e.message : 'Migration failed');
  process.exitCode = 1;
} finally {
  await db.end();
}

/**
 * Writes a pg_dump (custom format, restorable with pg_restore) of the whole database to
 * MIGRATION_BACKUP_DIR (default .local/pre-migrate-backups), readable by its owner only. The
 * password goes through the environment, never the command line. Any failure stops the migration.
 */
function backupBeforeMigrating(url: string, firstPending: string) {
  const target = new URL(url);
  const dir = resolve(process.env.MIGRATION_BACKUP_DIR || '.local/pre-migrate-backups');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `pre-${firstPending.replace(/\.sql$/, '')}-${stamp}.dump`);
  execFileSync(
    process.env.PG_DUMP_PATH || 'pg_dump',
    [
      '--format=custom',
      '--no-owner',
      '--file=' + file,
      '--host=' + target.hostname,
      '--port=' + (target.port || '5432'),
      '--username=' + decodeURIComponent(target.username),
      '--dbname=' + decodeURIComponent(target.pathname.slice(1)),
    ],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, PGPASSWORD: decodeURIComponent(target.password) },
    },
  );
  chmodSync(file, 0o600);
  if (!statSync(file).size) throw new Error('Pre-migration backup is empty: ' + file);
  // A dump that pg_restore cannot read is no backup: list its table of contents before migrating.
  const restore =
    process.env.PG_RESTORE_PATH ||
    (process.env.PG_DUMP_PATH
      ? join(dirname(process.env.PG_DUMP_PATH), 'pg_restore')
      : 'pg_restore');
  const toc = execFileSync(restore, ['--list', file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!/TABLE DATA public schema_migrations /.test(toc))
    throw new Error('Pre-migration backup is unreadable or incomplete: ' + file);
  console.log('Pre-migration backup written: ' + file);
}
