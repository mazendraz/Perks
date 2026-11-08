import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed, ids } from '../../db/seed.js';
import { adminLogin, key, login, enrollmentTerms } from '../helpers.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let admin: Awaited<ReturnType<typeof login>>,
  owner: typeof admin,
  cash: typeof admin,
  mid: string,
  branch: string,
  ownerId: string,
  cashId: string,
  ownerEmail: string,
  cashEmail: string,
  programId: string,
  versionId: string;
const original = 'Original-' + randomUUID(),
  replacement = 'Replacement-' + randomUUID();
let ip = 10;
async function signIn(email: string, password: string, expected = 200) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: '127.0.0.' + ip++,
    headers: { origin: c.PUBLIC_APP_ORIGIN },
    payload: { email, password },
  });
  assert.equal(r.statusCode, expected, r.body);
  return {
    origin: c.PUBLIC_APP_ORIGIN,
    cookie: r.cookies.map((c) => c.name + '=' + c.value).join('; '),
    'x-csrf-token': r.json().csrfToken as string,
  };
}
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  admin = await adminLogin(app, db);
  const slug = 'manage-' + randomUUID().slice(0, 8);
  ownerEmail = 'owner-' + slug + '@example.test';
  cashEmail = 'cash-' + slug + '@example.test';
  const data = {
    name: 'Managed business',
    slug,
    contactEmail: ownerEmail,
    contactPhone: '01012345678',
    timezone: 'Africa/Cairo',
    primaryColor: '#204C41',
    accentColor: '#D4AD68',
    surfaceColor: '#F9F5EA',
    template: 'cafe',
    stampShape: 'circle',
    stampIcon: 'coffee',
    stampStyle: 'solid',
    terms: 'Local fixture enrollment terms.',
    program: {
      name: 'Visits',
      threshold: 5,
      maxPerTx: 3,
      rewardTitle: 'Coffee',
      rewardTerms: 'One coffee within thirty days.',
      validityDays: 30,
      endsAt: null,
    },
    branches: [{ name: 'Main', address: '' }],
    staff: [
      { email: ownerEmail, role: 'owner', branchIndexes: [0], maxQty: 3, accessMode: 'password' },
      { email: cashEmail, role: 'cashier', branchIndexes: [0], maxQty: 3, accessMode: 'password' },
    ],
    plan: 'growth',
  };
  const d = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/platform/provisioning-drafts',
      headers: { ...admin, ...key() },
      payload: { data },
    })
  ).json().draft;
  const staged = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/provisioning-drafts/' + d.id + '/credentials',
    headers: admin,
    payload: {
      revision: d.revision,
      accounts: data.staff.map((s) => ({ email: s.email, password: original })),
    },
  });
  assert.equal(staged.statusCode, 200, staged.body);
  const activated = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/provisioning-drafts/' + d.id + '/activate',
    headers: { ...admin, ...key() },
    payload: { draftRevision: d.revision },
  });
  assert.equal(activated.statusCode, 200, activated.body);
  const a = activated.json();
  mid = a.merchant.id;
  branch = a.branches[0].id;
  ownerId = a.accounts.find((s: { role: string }) => s.role === 'owner').id;
  cashId = a.accounts.find((s: { role: string }) => s.role === 'cashier').id;
  programId = a.programId;
  versionId = a.versionId;
  owner = await signIn(ownerEmail, original);
  cash = await signIn(cashEmail, original);
});
after(async () => {
  await app.close();
  await db.end();
});
async function security(headers = admin) {
  const r = await app.inject({ url: '/api/v1/merchants/' + mid + '/account-security', headers });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(!r.body.includes('password_hash'));
  return r.json().accounts as {
    id: string;
    canManageCredentials: boolean;
    credentialVersion: number;
    activeSessions: number;
    lockedUntil: string | null;
  }[];
}
test('admin and owner reset only authorized credentials; stale versions, replay, login locks and session revocation are enforced without exposing passwords', async () => {
  const before = await security(owner);
  assert.equal(before.find((a) => a.id === ownerId)!.canManageCredentials, false);
  assert.equal(before.find((a) => a.id === cashId)!.canManageCredentials, true);
  const another = await signIn(cashEmail, original);
  for (let i = 0; i < 5; i++) await signIn(cashEmail, 'Wrong-password-value', 401);
  const target = (await security(owner)).find((a) => a.id === cashId)!;
  assert.ok(target.lockedUntil);
  const command = {
    action: 'password',
    password: replacement,
    credentialVersion: target.credentialVersion,
    acknowledgeAccountWide: true,
    reason: 'Reset managed cashier password',
  };
  const denied = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/staff/' + cashId + '/security',
    headers: { ...cash, ...key() },
    payload: command,
  });
  assert.equal(denied.statusCode, 403);
  const commandKey = key(),
    changed = await app.inject({
      method: 'POST',
      url: '/api/v1/merchants/' + mid + '/staff/' + cashId + '/security',
      headers: { ...owner, ...commandKey },
      payload: command,
    });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.ok(!changed.body.includes(replacement));
  const replay = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/staff/' + cashId + '/security',
    headers: { ...owner, ...commandKey },
    payload: command,
  });
  assert.deepEqual(replay.json(), changed.json());
  assert.equal((await app.inject({ url: '/api/v1/session', headers: cash })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/v1/session', headers: another })).statusCode, 401);
  await signIn(cashEmail, original, 401);
  cash = await signIn(cashEmail, replacement);
  const current = (await security(owner)).find((a) => a.id === cashId)!;
  assert.equal(current.credentialVersion, target.credentialVersion + 1);
  assert.equal(current.lockedUntil, null);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/merchants/' + mid + '/staff/' + cashId + '/security',
        headers: { ...owner, ...key() },
        payload: command,
      })
    ).statusCode,
    409,
  );
  const kick = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/staff/' + cashId + '/security',
    headers: { ...owner, ...key() },
    payload: {
      action: 'sessions',
      credentialVersion: current.credentialVersion,
      acknowledgeAccountWide: true,
      reason: 'Sign out old cashier devices',
    },
  });
  assert.equal(kick.statusCode, 200, kick.body);
  assert.equal((await app.inject({ url: '/api/v1/session', headers: cash })).statusCode, 401);
  cash = await signIn(cashEmail, replacement);
  const audit = (
    await db.query(
      "SELECT detail FROM audit_events WHERE merchant_id=$1 AND action LIKE 'staff.security.%'",
      [mid],
    )
  ).rows;
  assert.ok(audit.length >= 2);
  assert.ok(!JSON.stringify(audit).includes(replacement));
  const foreign = await login(app, 'owner@lamsa.test');
  assert.equal(
    (await app.inject({ url: '/api/v1/merchants/' + mid + '/account-security', headers: foreign }))
      .statusCode,
    404,
  );
  const uid = (await db.query('SELECT user_id FROM staff_memberships WHERE id=$1', [cashId]))
    .rows[0].user_id;
  await db.query(
    "INSERT INTO tenant_customer_profiles(merchant_id,user_id,alias,contact_email) VALUES($1,$2,'Other business customer',$3)",
    [ids.merchantB, uid, cashEmail],
  );
  assert.equal((await security(owner)).find((a) => a.id === cashId)!.canManageCredentials, false);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/merchants/' + mid + '/staff/' + cashId + '/security',
        headers: { ...owner, ...key() },
        payload: {
          ...command,
          credentialVersion: (await security()).find((a) => a.id === cashId)!.credentialVersion,
        },
      })
    ).statusCode,
    403,
  );
  const ownerAccount = (await db.query('SELECT * FROM staff_memberships WHERE id=$1', [ownerId]))
    .rows[0];
  const last = await app.inject({
    method: 'PATCH',
    url: '/api/v1/merchants/' + mid + '/staff/' + ownerId,
    headers: { ...admin, 'if-match': String(ownerAccount.revision) },
    payload: {
      name: ownerAccount.name,
      status: 'disabled',
      role: 'owner',
      branchIds: [branch],
      maxQty: 3,
      reason: 'Last owner must remain active',
    },
  });
  assert.equal(last.statusCode, 409);
  assert.equal(last.json().error.code, 'LAST_OWNER');
});
test('preview reports missing setup; customer and owner WhatsApp drafts require the scoped number and current customer consent, with no delivery claim', async () => {
  const customer = await login(app, 'wa-' + randomUUID() + '@example.test');
  const enrolled = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...customer, ...key() },
    payload: {
      merchantId: mid,
      programId,
      programVersionId: versionId,
      alias: 'WhatsApp customer',
      acceptedTerms: true,
      acceptedTermsHash: await enrollmentTerms(app, programId),
      branchId: branch,
      contactPhone: '01098765432',
      consents: { whatsapp: true },
    },
  });
  assert.equal(enrolled.statusCode, 200, enrolled.body);
  const directory = await app.inject({
    url: '/api/v1/merchants/' + mid + '/customer-outreach',
    headers: admin,
  });
  assert.equal(directory.statusCode, 200, directory.body);
  const client = directory
    .json()
    .customers.find((c: { alias: string }) => c.alias === 'WhatsApp customer');
  assert.ok(client.phonePresent && client.whatsappConsent);
  assert.equal(client.contactPhone, '+201098765432');
  const draft = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/customer-outreach/' + client.id + '/whatsapp',
    headers: admin,
    payload: { message: 'Hello from your business.' },
  });
  assert.equal(draft.statusCode, 200, draft.body);
  assert.equal(draft.json().draftOnly, true);
  assert.equal(new URL(draft.json().url).hostname, 'wa.me');
  assert.equal(new URL(draft.json().url).pathname, '/201098765432');
  const business = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/merchants/' + mid + '/whatsapp',
    headers: admin,
    payload: { message: 'Checking your account setup.' },
  });
  assert.equal(business.statusCode, 200, business.body);
  const workspace = await app.inject({
    url: '/api/v1/platform/merchants/' + mid + '/workspace',
    headers: admin,
  });
  assert.equal(workspace.statusCode, 200, workspace.body);
  assert.equal(workspace.json().summary.customers, 1);
  assert.equal(workspace.json().readiness.whatsapp_ready, 1);
  await app.inject({
    method: 'PATCH',
    url: '/api/v1/me/merchants/' + mid + '/preferences',
    headers: customer,
    payload: { channel: 'whatsapp', granted: false },
  });
  const revoked = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/customer-outreach/' + client.id + '/whatsapp',
    headers: owner,
    payload: { message: 'A stale draft must not pass.' },
  });
  assert.equal(revoked.statusCode, 409);
  assert.equal(revoked.json().error.code, 'WHATSAPP_CONSENT_REQUIRED');
  const masked = (
    await app.inject({ url: '/api/v1/merchants/' + mid + '/customer-outreach', headers: admin })
  )
    .json()
    .customers.find((c: { id: string }) => c.id === client.id);
  assert.equal(masked.contactPhone, '');
  const changedPhone = await app.inject({
    method: 'PATCH',
    url: '/api/v1/me/merchants/' + mid + '/contact',
    headers: customer,
    payload: { contactPhone: '+201011111111' },
  });
  assert.equal(changedPhone.statusCode, 200, changedPhone.body);
  assert.equal(changedPhone.json().whatsappConsentReset, true);
  const rejoin = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...customer, ...key() },
    payload: {
      merchantId: mid,
      programId,
      programVersionId: versionId,
      alias: 'WhatsApp customer',
      acceptedTerms: true,
      acceptedTermsHash: await enrollmentTerms(app, programId),
      branchId: branch,
      consents: { whatsapp: true },
    },
  });
  assert.equal(rejoin.statusCode, 200, rejoin.body);
  const renewedDraft = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/customer-outreach/' + client.id + '/whatsapp',
    headers: owner,
    payload: { message: 'Explicit consent after rejoining uses the current number.' },
  });
  assert.equal(renewedDraft.statusCode, 200, renewedDraft.body);
  assert.equal(new URL(renewedDraft.json().url).pathname, '/201011111111');
  const foreign = await login(app, 'owner@lamsa.test');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/merchants/' + mid + '/customer-outreach/' + client.id + '/whatsapp',
        headers: foreign,
        payload: { message: 'Denied cross tenant draft' },
      })
    ).statusCode,
    404,
  );
  const runtime = new pg.Client({ connectionString: c.DATABASE_URL });
  await runtime.connect();
  try {
    await assert.rejects(
      () => runtime.query('SELECT contact_phone FROM tenant_customer_profiles'),
      /permission denied/,
    );
  } finally {
    await runtime.end();
  }
  const jobs = (
    await db.query(
      "SELECT count(*)::int AS n FROM background_jobs WHERE merchant_id=$1 AND kind IN ('whatsapp','whatsapp_message')",
      [mid],
    )
  ).rows[0].n;
  assert.equal(jobs, 0);
});
