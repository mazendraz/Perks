import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../apps/api/src/config.js';
const c = readConfig();
if (!c.DATABASE_MIGRATOR_URL) throw new Error('DATABASE_MIGRATOR_URL is required for migrations.');
const db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
try {
  await db.connect();
  await db.query("SELECT pg_advisory_lock(hashtext('nuqta-migrations'))");
  for (const [role, password] of [
    ['nuqta_runtime', process.env.NUQTA_RUNTIME_DB_PASSWORD],
    ['nuqta_auth', process.env.NUQTA_AUTH_DB_PASSWORD || process.env.NUQTA_RUNTIME_DB_PASSWORD],
    ['nuqta_worker', process.env.NUQTA_WORKER_DB_PASSWORD || process.env.NUQTA_RUNTIME_DB_PASSWORD],
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
  for (const file of (await readdir('db/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
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
    'GRANT INSERT(email,display_name,auth_subject,password_hash,password_version),UPDATE(email,auth_subject,last_totp_counter,password_hash,password_version) ON users TO nuqta_auth',
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
