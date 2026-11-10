import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { createServer, type ViteDevServer } from 'vite';
import { readConfig, type Config } from '../apps/api/src/config.js';
import { hashPassword } from '../apps/api/src/passwords.js';
import { buildApp } from '../apps/api/src/server.js';
import { seed, ids } from '../db/seed.js';
import { runOne } from '../apps/worker/src/runner.js';
import { runAppleWalletPushes } from '../apps/worker/src/apple-wallet-push.js';
import { runGoogleWalletUpdates } from '../apps/worker/src/google-wallet-updates.js';
import { tunnelServer, tunnelGuard, quickOrigin } from './tunnel-policy.js';
import { privateLocalDirectory } from './private-local.js';
import { operationalLog } from '../packages/domain/src/operational-log.js';
import { cleanupExports } from '../apps/worker/src/export-cleanup.js';
import { createFileStore } from '../apps/api/src/storage/file-store.js';

export function requireTunnelBase(c: Config) {
  const parent = new URL(c.DATABASE_MIGRATOR_URL!);
  if (
    !['development', 'test'].includes(c.APP_ENV) ||
    parent.hostname !== '127.0.0.1' ||
    !['/nuqta_local', '/nuqta_ci'].includes(parent.pathname)
  )
    throw new Error(
      'Tunnel preparation requires the dedicated local synthetic database configuration.',
    );
  for (const key of ['DATABASE_URL', 'AUTH_DATABASE_URL', 'WORKER_DATABASE_URL'] as const) {
    if (!c[key]) throw new Error('All local database roles are required.');
    const role = new URL(c[key]);
    if (
      role.hostname !== parent.hostname ||
      role.port !== parent.port ||
      role.pathname !== parent.pathname
    )
      throw new Error('Tunnel database roles must share the same local synthetic parent.');
  }
}
export async function tunnelDirectory(name: string) {
  if (!/^\d{13}-[a-f0-9]{8}$/.test(name)) throw new Error('Invalid fixture name.');
  return privateLocalDirectory('tunnel-demo', name);
}
export async function prepareTunnel(base = readConfig()) {
  requireTunnelBase(base);
  const name = Date.now() + '-' + randomBytes(4).toString('hex'),
    database = 'nuqta_tunnel_' + name.replace('-', '_'),
    root = await tunnelDirectory(name);
  const connection = (value: string | undefined) => {
    const url = new URL(value!);
    url.pathname = '/' + database;
    return url.href;
  };
  const config = readConfig({
    APP_ENV: 'development',
    AUTH_PROVIDER: 'password',
    COOKIE_SECURE: 'true',
    HOST: '127.0.0.1',
    PUBLIC_APP_ORIGIN: 'https://prepared.trycloudflare.com',
    AUTH_PEPPER: randomBytes(32).toString('hex'),
    DATABASE_MIGRATOR_URL: connection(base.DATABASE_MIGRATOR_URL),
    DATABASE_URL: connection(base.DATABASE_URL),
    AUTH_DATABASE_URL: connection(base.AUTH_DATABASE_URL),
    WORKER_DATABASE_URL: connection(base.WORKER_DATABASE_URL),
    MAIL_TRANSPORT: 'file',
    MAIL_FILE_ROOT: resolve(root, 'mail'),
    STORAGE_ROOT: resolve(root, 'files'),
    LOG_LEVEL: 'silent',
    TRUSTED_PROXIES: '',
    MONITORING_TOKEN: '',
    BACKUP_STATUS_ROOT: '',
  });
  const adminUrl = new URL(base.DATABASE_MIGRATOR_URL!);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.href });
  await admin.connect();
  let created = false;
  try {
    // No IF NOT EXISTS: never adopt, reset or publish a pre-existing database.
    await admin.query('CREATE DATABASE ' + pg.escapeIdentifier(database));
    created = true;
  } finally {
    await admin.end();
  }
  const drop = async () => {
    if (!created || !/^nuqta_tunnel_\d{13}_[a-f0-9]{8}$/.test(database))
      throw new Error('Unowned database.');
    const db = new pg.Client({ connectionString: adminUrl.href });
    await db.connect();
    try {
      await db.query('DROP DATABASE ' + pg.escapeIdentifier(database) + ' WITH (FORCE)');
      created = false;
    } finally {
      await db.end();
    }
  };
  try {
    const env = Object.fromEntries(
      Object.entries(config)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
    const migration = spawnSync(process.execPath, ['--import', 'tsx', 'db/migrate.ts'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 90000,
      env: { ...process.env, ...env },
    });
    if (migration.status !== 0) throw new Error('Isolated tunnel migration failed.');
    const db = new pg.Client({ connectionString: config.DATABASE_MIGRATOR_URL });
    await db.connect();
    const logins: { email: string; password: string; role: string }[] = [];
    try {
      await seed(db);
      for (const [id, role] of [
        [ids.admin, 'platform'],
        [ids.ownerA, 'owner'],
        [ids.cashier, 'cashier'],
        [ids.ownerB, 'owner'],
      ] as const) {
        const password = 'Synthetic-' + randomBytes(18).toString('base64url') + '!';
        const row = await db.query(
          'UPDATE users SET password_hash=$1,password_version=password_version+1 WHERE id=$2 RETURNING email',
          [await hashPassword(password, config.AUTH_PEPPER), id],
        );
        logins.push({ email: row.rows[0].email, password, role });
      }
      await db.query(
        "INSERT INTO placements(merchant_id,branch_id,label,kind,status,created_by,public_code) VALUES($1,$2,'Synthetic QR','stand','installed',$3,$4)",
        [ids.merchantA, ids.branchA, ids.admin, randomBytes(18).toString('hex')],
      );
    } finally {
      await db.end();
    }
    const state = { syntheticOnly: true, database, name, config, logins };
    await writeFile(resolve(root, 'state.json'), JSON.stringify(state, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
    await writeFile(
      resolve(root, 'logins.txt'),
      logins.map((u) => `${u.role}\nEmail: ${u.email}\nPassword: ${u.password}\n`).join('\n'),
      { mode: 0o600, flag: 'wx' },
    );
    return { database, root, config, logins, drop };
  } catch (error) {
    await drop();
    throw error;
  }
}
export async function serveTunnel(
  fixture: Awaited<ReturnType<typeof prepareTunnel>>,
  origin: string,
  webPort = 5173,
  apiPort = 4110,
) {
  quickOrigin(origin);
  const config = readConfig({ ...fixture.config, PUBLIC_APP_ORIGIN: origin, PORT: apiPort });
  const { app } = await buildApp(config);
  const worker = new pg.Pool({ connectionString: config.WORKER_DATABASE_URL, max: 1 });
  let web: ViteDevServer | undefined,
    stopped = false,
    running: Promise<void> | undefined,
    stopping: Promise<void> | undefined,
    lastSweep = 0;
  const tick = () => {
    if (stopped || running) return;
    running = (async () => {
      if (Date.now() - lastSweep > 60000) {
        await worker.query('SELECT sweep_expired_sessions()');
        await cleanupExports(worker, createFileStore(config));
        lastSweep = Date.now();
      }
      await runAppleWalletPushes(worker, config);
      await runGoogleWalletUpdates(worker, config);
      await runOne(worker, config);
    })()
      .then(
        () => {},
        () => {
          operationalLog('worker', 'error', 'worker.iteration_failed');
        },
      )
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(tick, 500);
  const stop = () =>
    (stopping ??= (async () => {
      stopped = true;
      clearInterval(timer);
      await running;
      try {
        await web?.close();
      } finally {
        await Promise.allSettled([app.close(), worker.end()]);
      }
    })());
  try {
    await app.listen({ port: apiPort, host: '127.0.0.1' });
    web = await createServer({
      root: resolve('apps/web'),
      configFile: resolve('apps/web/vite.config.ts'),
      plugins: [tunnelGuard],
      server: tunnelServer(origin, apiPort, webPort),
      clearScreen: false,
      logLevel: 'error',
    });
    await web.listen();
    await writeFile(resolve(fixture.root, 'origin.txt'), origin + '\n', { mode: 0o600 });
    return { app, web, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
