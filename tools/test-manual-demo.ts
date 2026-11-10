import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import pg from 'pg';
import { readConfig } from '../apps/api/src/config.js';
import { buildApp } from '../apps/api/src/server.js';
import { runOne } from '../apps/worker/src/runner.js';
import { migrateManual, requireManualDatabase, workspace } from './manual-demo.js';
import { demoCall, demoLogin, populateManualClients } from './manual-demo-clients.js';

// This test never provisions or populates Mazen's actual empty environment.
const base = readConfig(),
  database = 'nuqta_manual_test_' + Date.now();
assert.match(database, /^nuqta_manual_test_\d+$/);
const urlFor = (value: string | undefined, name = database) => {
  assert.ok(value);
  const url = new URL(value);
  url.pathname = '/' + name;
  return url.href;
};
const c = readConfig({
  APP_ENV: 'development',
  AUTH_PROVIDER: 'local',
  PUBLIC_APP_ORIGIN: 'http://localhost:4180',
  HOST: '127.0.0.1',
  PORT: 4180,
  COOKIE_SECURE: 'false',
  AUTH_PEPPER: randomBytes(32).toString('hex'),
  LOG_LEVEL: 'silent',
  // Resolve within the temporary working directory, independently of the
  // caller's configured mailbox and file store.
  MAIL_FILE_ROOT: '.local/mail',
  STORAGE_ROOT: '.local/files',
  DATABASE_MIGRATOR_URL: urlFor(base.DATABASE_MIGRATOR_URL),
  DATABASE_URL: urlFor(base.DATABASE_URL),
  AUTH_DATABASE_URL: urlFor(base.AUTH_DATABASE_URL),
  WORKER_DATABASE_URL: urlFor(base.WORKER_DATABASE_URL),
});
requireManualDatabase(c);
assert.throws(() => requireManualDatabase(base));
const adminDb = new pg.Client({ connectionString: urlFor(base.DATABASE_MIGRATOR_URL, 'postgres') });
const testDirectory = await mkdtemp(resolve(workspace, '.local/manual-demo-test-'));
await adminDb.connect();
await adminDb.query('CREATE DATABASE ' + pg.escapeIdentifier(database));
const db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL });
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
try {
  await migrateManual(c);
  process.chdir(testDirectory);
  await db.connect();
  const secret = randomBytes(20).toString('hex');
  await db.query(
    "INSERT INTO users(email,display_name,global_role,totp_secret) VALUES('sandbox-admin@nuqta.test','Manual test admin','platform_admin',$1)",
    [secret],
  );
  ({ app } = await buildApp(c));
  await app.ready();
  const admin = await demoLogin(app, c, 'sandbox-admin@nuqta.test');
  const zero = await demoCall<{ merchants: unknown[] }>(app, '/platform/merchants', admin);
  assert.equal(zero.merchants.length, 0);
  const data = {
    name: 'Manual acceptance company',
    slug: 'manual-acceptance',
    contactEmail: 'manual-owner@nuqta.test',
    timezone: 'Africa/Cairo',
    primaryColor: '#6F3F22',
    accentColor: '#E2A85B',
    surfaceColor: '#FBF5EE',
    template: 'classic',
    terms: 'Synthetic acceptance enrollment terms',
    program: {
      name: 'Manual stamps',
      threshold: 5,
      maxPerTx: 3,
      rewardTitle: 'Synthetic reward',
      rewardTerms: 'Synthetic holder-confirmed reward',
      validityDays: 30,
      endsAt: null,
    },
    branches: [{ name: 'Main branch', address: '' }],
    staff: [{ email: 'manual-owner@nuqta.test', role: 'owner', branchIndexes: [0], maxQty: 3 }],
    plan: 'growth',
  };
  const draft = await demoCall<{ draft: { id: string; revision: number } }>(
    app,
    '/platform/provisioning-drafts',
    admin,
    { data },
    randomUUID(),
  );
  const activation = await demoCall<{ merchant: { id: string }; branches: { id: string }[] }>(
    app,
    '/platform/provisioning-drafts/' + draft.draft.id + '/activate',
    admin,
    { draftRevision: draft.draft.revision },
    randomUUID(),
  );
  const mid = activation.merchant.id,
    branch = activation.branches[0]!.id;
  const invite = async (email: string) => {
    for (let i = 0; i < 100 && (await runOne(worker, c)); i++) {
      /* Drain isolated local mail only. */
    }
    const files = await readdir('.local/mail');
    for (const file of files) {
      const message = JSON.parse(await readFile(resolve('.local/mail', file), 'utf8'));
      if (message.to === email) return new URL(message.link).pathname.split('/').at(-1)!;
    }
    throw new Error('Invitation was not delivered to the isolated mail sink.');
  };
  const owner = await demoLogin(app, c, 'manual-owner@nuqta.test', '127.0.0.3');
  await demoCall(
    app,
    '/invitations/' + (await invite('manual-owner@nuqta.test')) + '/accept',
    owner,
    {},
  );
  // The platform invited only the owner. The owner creates the cashier grant.
  await assert.rejects(
    populateManualClients(c, 'manual-acceptance', resolve(testDirectory, 'fixtures')),
    /First invite the cashier/,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM tenant_customer_profiles')).rows[0].n,
    0,
  );
  await demoCall(
    app,
    '/merchants/' + mid + '/invitations',
    owner,
    { email: 'manual-cashier@nuqta.test', role: 'cashier', branchIds: [branch], maxQty: 3 },
    randomUUID(),
  );
  const cashier = await demoLogin(app, c, 'manual-cashier@nuqta.test', '127.0.0.4');
  await demoCall(
    app,
    '/invitations/' + (await invite('manual-cashier@nuqta.test')) + '/accept',
    cashier,
    {},
  );
  const report = await populateManualClients(
    c,
    'manual-acceptance',
    resolve(testDirectory, 'fixtures'),
  );
  const overview = await demoCall<{
    metrics: {
      registered: number;
      active: number;
      neverActive: number;
      rewardsOpen: number;
      rewardsRedeemed: number;
      visits: number;
    };
  }>(app, '/merchants/' + mid + '/overview', owner);
  assert.equal(overview.metrics.registered, 12);
  assert.equal(overview.metrics.active, 8);
  assert.equal(overview.metrics.neverActive, 4);
  assert.equal(overview.metrics.rewardsOpen, 2);
  assert.equal(overview.metrics.rewardsRedeemed, 2);
  const before = (await db.query('SELECT count(*)::int AS n FROM loyalty_transactions')).rows[0].n;
  assert.deepEqual(
    await populateManualClients(c, 'manual-acceptance', resolve(testDirectory, 'fixtures')),
    report,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM loyalty_transactions')).rows[0].n,
    before,
  );
  const health = await demoCall<{ merchants: number; memberships: number; balanceDrift: number }>(
    app,
    '/platform/health',
    admin,
  );
  assert.equal(health.merchants, 1);
  assert.equal(health.memberships, 12);
  assert.equal(health.balanceDrift, 0);
  process.chdir(workspace);
  await mkdir('docs/execution/evidence/implementation', { recursive: true });
  await writeFile(
    'docs/execution/evidence/implementation/manual-demo.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        passed: true,
        database: 'isolated temporary database removed after test',
        checks: [
          'zero companies before user provisioning',
          'platform invites owner only',
          'owner invites cashier and cashier accepts',
          'population is blocked before an accepted cashier',
          '12 synthetic customers use real loyalty commands',
          '4 registered only, 8 active, 2 available rewards, 2 redeemed',
          'fixture rerun creates no duplicate transactions',
          'owner reports and platform health reconcile with zero balance drift',
        ],
        metrics: overview.metrics,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS manual onboarding, owner-created cashier, 12 synthetic customers, replay safety and owner/platform reports',
  );
} finally {
  await app?.close();
  await worker.end();
  await db.end();
  process.chdir(workspace);
  await adminDb.query('DROP DATABASE ' + pg.escapeIdentifier(database) + ' WITH (FORCE)');
  await adminDb.end();
  const checked = resolve(testDirectory),
    expected = resolve(workspace, '.local') + sep;
  assert.ok(
    checked.startsWith(expected) && checked.slice(expected.length).startsWith('manual-demo-test-'),
  );
  await rm(checked, { recursive: true, force: true });
}
