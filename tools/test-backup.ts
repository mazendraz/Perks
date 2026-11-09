import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readConfig } from '../apps/api/src/config.js';
const c = readConfig(),
  url = new URL(c.DATABASE_MIGRATOR_URL!);
assert.equal(c.APP_ENV, 'development');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '55432');
assert.equal(url.pathname, '/nuqta_local');
const stamp = Date.now(),
  privateRoot = resolve('.local', 'backup-drill-' + stamp),
  output = resolve('docs/execution/evidence/implementation');
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await mkdir(output, { recursive: true });
const dump = join(privateRoot, 'source.dump'),
  logo = join(privateRoot, 'logo.png');
await sharp({ create: { width: 96, height: 96, channels: 4, background: '#2b55cf' } })
  .png()
  .toFile(logo);
const sources: Record<string, string> = {};
for (const path of [
  'deploy/postgres/postgresql.conf',
  'deploy/postgres/pgbackrest.conf',
  'deploy/postgres/init-roles.sh',
  'deploy/restore-drill.sh',
  'deploy/backup/fingerprint.sql',
  'deploy/backup/verify-restore.py',
  'deploy/backup/files.sh',
  'deploy/backup/db-loop.py',
  'tests/fixtures/backup-native.sh',
  'tests/fixtures/backup-mutation.sql',
  'tools/test-backup.ts',
  ...(await readdir('db/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => 'db/migrations/' + name),
])
  sources[path] = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const log = createWriteStream(join(privateRoot, 'run.log'), { mode: 0o600 });
async function run(executable: string, args: string[], environment = process.env) {
  return await new Promise<number | null>((done, reject) => {
    const child = spawn(executable, args, {
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once('error', reject);
    child.once('close', done);
  });
}
const windows = process.platform === 'win32';
const linux = (path: string) =>
  windows
    ? path
        .replace(/^([a-zA-Z]):/, (_, drive: string) => '/mnt/' + drive.toLowerCase())
        .replaceAll('\\', '/')
    : path;
const pgDump = process.env.PG_BIN
  ? join(process.env.PG_BIN, 'pg_dump' + (windows ? '.exe' : ''))
  : windows
    ? 'C:/Program Files/PostgreSQL/17/bin/pg_dump.exe'
    : 'pg_dump';
try {
  console.log(
    'Creating a private logical clone of the synthetic development DB; manual demo is not used.',
  );
  assert.equal(
    await run(
      pgDump,
      [
        '-h',
        url.hostname,
        '-p',
        url.port,
        '-U',
        decodeURIComponent(url.username),
        '-d',
        'nuqta_local',
        '-Fc',
        '--no-owner',
        '--no-privileges',
        '-f',
        dump,
      ],
      { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: '5' },
    ),
    0,
  );
  const args = [
    linux(resolve('tests/fixtures/backup-native.sh')),
    linux(resolve('.')),
    linux(dump),
    linux(logo),
    linux(output),
  ];
  const fixtureEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(?:NUQTA_|PGBACKREST_|RESTIC_|AUTH_|DATABASE_|SMTP_|MAIL_|WORKER_DATABASE_|PGPASSWORD$)/.test(
          key,
        ),
    ),
  );
  console.log(
    'Running isolated encrypted backup, full/differential/PITR and logo recovery drills.',
  );
  assert.equal(
    await run(
      windows ? 'wsl' : 'sh',
      windows ? ['-d', 'Ubuntu', '--exec', 'sh', ...args] : args,
      fixtureEnvironment,
    ),
    0,
  );
  const path = join(output, 'backup-native.json'),
    report = JSON.parse(await readFile(path, 'utf8'));
  report.source = sources;
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      full: report.full.status,
      differential: report.differential.status,
      pitr: report.pitr.status,
      logoRestored: report.fileStoreLogoRestoredByteIdentical,
    }),
  );
} catch {
  await writeFile(
    join(output, 'backup-native.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: 'failed',
        source: sources,
        reason:
          'Inspect the private .local backup-drill log. No credentials or row data are included in this report.',
      },
      null,
      2,
    ) + '\n',
  );
  console.error('Backup drill failed; inspect private .local/backup-drill-' + stamp + '/run.log.');
  process.exitCode = 1;
} finally {
  log.end();
}
