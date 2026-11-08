import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../apps/api/src/passwords.js';
import fastifyStatic from '@fastify/static';
import { readConfig, type Config } from '../apps/api/src/config.js';
import { buildApp } from '../apps/api/src/server.js';
import { runOne } from '../apps/worker/src/runner.js';
import { cleanupExports } from '../apps/worker/src/export-cleanup.js';
import { createFileStore } from '../apps/api/src/storage/file-store.js';

export const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const manualRoot = resolve(workspace, '.local/manual-demo');
const statePath = resolve(manualRoot, 'state.json');
type State = { database: string; origin: string; adminEmail: string; pepper: string };

export function requireManualDatabase(c: Config) {
  const url = new URL(c.DATABASE_MIGRATOR_URL!);
  if (
    c.APP_ENV !== 'development' ||
    c.AUTH_PROVIDER !== 'local' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55432' ||
    !/^\/nuqta_manual_(mazen|test_\d+)$/.test(url.pathname)
  )
    throw new Error('Manual demo only supports its own isolated local database.');
  for (const value of [c.DATABASE_URL, c.AUTH_DATABASE_URL, c.WORKER_DATABASE_URL]) {
    if (!value) throw new Error('All manual database roles must be configured.');
    const roleUrl = new URL(value);
    if (
      roleUrl.hostname !== url.hostname ||
      roleUrl.port !== url.port ||
      roleUrl.pathname !== url.pathname
    )
      throw new Error('Manual API, auth and worker must use the same isolated local database.');
  }
}
export function manualConfig(state: State): Config {
  if (
    state.database !== 'nuqta_manual_mazen' ||
    state.origin !== 'http://localhost:4180' ||
    state.adminEmail !== 'mazen@nuqta.test'
  )
    throw new Error('Unexpected manual demo configuration; no database was changed.');
  const base = readConfig();
  const database = (value: string | undefined) => {
    if (!value) throw new Error('Local database connection is missing. Run db:up first.');
    const url = new URL(value);
    url.pathname = '/' + state.database;
    return url.href;
  };
  const c = readConfig({
    APP_ENV: 'development',
    AUTH_PROVIDER: 'local',
    HOST: '127.0.0.1',
    PORT: 4180,
    PUBLIC_APP_ORIGIN: state.origin,
    COOKIE_SECURE: 'false',
    AUTH_PEPPER: state.pepper,
    DATABASE_MIGRATOR_URL: database(base.DATABASE_MIGRATOR_URL),
    DATABASE_URL: database(base.DATABASE_URL),
    AUTH_DATABASE_URL: database(base.AUTH_DATABASE_URL),
    WORKER_DATABASE_URL: database(base.WORKER_DATABASE_URL),
    LOG_LEVEL: 'silent',
  });
  requireManualDatabase(c);
  return c;
}
export async function loadManualConfig() {
  return manualConfig(JSON.parse(await readFile(statePath, 'utf8')));
}

export async function migrateManual(c: Config) {
  requireManualDatabase(c);
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'db/migrate.ts'], {
    cwd: workspace,
    env: {
      ...process.env,
      ...Object.fromEntries(
        Object.entries(c)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ),
    },
    windowsHide: true,
    encoding: 'utf8',
    timeout: 90000,
  });
  if (result.status !== 0)
    throw new Error('Manual database migration failed; no existing database was reset.');
}
async function setup() {
  await mkdir(manualRoot, { recursive: true });
  const saved = existsSync(statePath);
  const state: State = saved
    ? JSON.parse(await readFile(statePath, 'utf8'))
    : {
        database: 'nuqta_manual_mazen',
        origin: 'http://localhost:4180',
        adminEmail: 'mazen@nuqta.test',
        pepper: randomBytes(32).toString('hex'),
      };
  const c = manualConfig(state),
    adminUrl = new URL(c.DATABASE_MIGRATOR_URL!);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.href });
  await admin.connect();
  try {
    const existing = (
      await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [state.database])
    ).rowCount;
    if (existing && !saved)
      throw new Error('An unrecognized manual database already exists. It was left untouched.');
    if (!existing) await admin.query('CREATE DATABASE ' + pg.escapeIdentifier(state.database));
    await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  } finally {
    await admin.end();
  }
  await migrateManual(c);
  const db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
  await db.connect();
  try {
    await db.query(
      "INSERT INTO users(email,display_name,global_role,totp_secret) VALUES($1,'مازن','platform_admin',$2) ON CONFLICT(email) DO NOTHING",
      [state.adminEmail, randomBytes(20).toString('hex')],
    );
    const user = (
      await db.query('SELECT id,global_role,password_hash FROM users WHERE email=$1', [
        state.adminEmail,
      ])
    ).rows[0];
    if (user.global_role !== 'platform_admin')
      throw new Error(
        'The existing admin account requires review; privileges were not overwritten.',
      );
    if (!user.password_hash) {
      const password = 'Nuqta-' + randomBytes(12).toString('base64url') + '!';
      await db.query(
        'UPDATE users SET password_hash=$1,password_version=password_version+1 WHERE id=$2',
        [await hashPassword(password, c.AUTH_PEPPER), user.id],
      );
      await db.query(
        'UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL',
        [user.id],
      );
      await writeFile(
        resolve(manualRoot, 'login.txt'),
        'Email: ' +
          state.adminEmail +
          '\nPassword: ' +
          password +
          '\n\nChange this initial password from My account after signing in.\n',
        { mode: 0o600 },
      );
    }
    const count = (await db.query('SELECT count(*)::int AS n FROM merchants')).rows[0].n;
    console.log(
      JSON.stringify({
        origin: state.origin,
        adminEmail: state.adminEmail,
        companies: count,
        loginMethod: 'email and password',
        initialCredentials: '.local/manual-demo/login.txt',
        existingData: 'preserved',
      }),
    );
  } finally {
    await db.end();
  }
}
async function status() {
  const c = await loadManualConfig(),
    db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
  await db.connect();
  try {
    console.log(
      JSON.stringify({
        origin: c.PUBLIC_APP_ORIGIN,
        companies: (await db.query('SELECT id,name,slug FROM merchants ORDER BY created_at')).rows,
        staff: (await db.query('SELECT email,role,status FROM staff_memberships ORDER BY id')).rows,
        customers: (await db.query('SELECT count(*)::int AS n FROM tenant_customer_profiles'))
          .rows[0].n,
      }),
    );
  } finally {
    await db.end();
  }
}
async function start() {
  const c = await loadManualConfig();
  const assets = resolve(workspace, 'apps/web/dist');
  if (!existsSync(resolve(assets, 'index.html')))
    throw new Error('Run npm run build before starting the manual demo.');
  process.chdir(manualRoot);
  await mkdir('.local', { recursive: true });
  const { app } = await buildApp(c);
  await app.register(fastifyStatic, { root: assets, wildcard: true });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/health/'))
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.sendFile('index.html');
  });
  await app.listen({ host: c.HOST, port: c.PORT });
  const worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL, max: 3 });
  let closing = false,
    sweep = 0;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      closing = true;
    });
  console.log(
    'Mazen manual demo ready: ' + c.PUBLIC_APP_ORIGIN + '/platform (API, web and worker)',
  );
  while (!closing) {
    try {
      if (Date.now() - sweep > 60000) {
        await worker.query('SELECT sweep_expired_rewards()');
        await worker.query('SELECT sweep_expired_requests()');
        await cleanupExports(worker, createFileStore(c));
        sweep = Date.now();
      }
      if (!(await runOne(worker, c))) await new Promise((r) => setTimeout(r, 500));
    } catch {
      console.error('Manual demo worker will retry; no payloads or secrets are logged.');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  await worker.end();
  await app.close();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const action = process.argv[2];
    if (action === 'setup') await setup();
    else if (action === 'start') await start();
    else if (action === 'status') await status();
    else throw new Error('Use demo:setup, demo:start or demo:status.');
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'Manual setup failed.');
    process.exitCode = 1;
  }
}
