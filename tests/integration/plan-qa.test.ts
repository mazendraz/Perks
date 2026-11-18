import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { seed, ids } from '../../db/seed.js';
import { login, adminLogin, key } from '../helpers.js';
import { googleObject, loadGoogleWallet } from '../../apps/api/src/wallet/google-wallet.js';
import { texts } from '../../apps/api/src/wallet/apple-pass.js';

// Phase 5 QA on the seeded shop (bunn), restored afterwards: what customers see while the shop's
// plan changes, a cancelled shop being read-only, and the untouched suspended screen.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 }),
  accountFile = join(mkdtempSync(join(tmpdir(), 'perks-qa-')), 'account.json');
writeFileSync(
  accountFile,
  JSON.stringify({
    client_email: 'qa@example.test',
    private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }),
  { mode: 0o600 },
);
const overrides = {
  APP_ENV: 'test' as const,
  LOG_LEVEL: 'silent' as const,
  GOOGLE_WALLET_ENABLED: 'true' as const,
  GOOGLE_WALLET_ISSUER_ID: '3388000000012399',
  GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: accountFile,
};
const c = readConfig(overrides),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  worker = new pg.Client({ connectionString: c.WORKER_DATABASE_URL }),
  { app } = await buildApp(overrides);
type Headers = Awaited<ReturnType<typeof login>>;
let owner: Headers, customer: Headers, admin: Headers, membership: string;
let saved: Record<string, unknown>;
// Overrides this suite switched off, switched back on afterwards (the legacy plan relies on them).
const revoked = new Set<string>();
const mid = ids.merchantA;

before(async () => {
  await db.connect();
  await worker.connect();
  await seed(db);
  await app.ready();
  saved = (await db.query('SELECT * FROM merchant_subscriptions WHERE merchant_id=$1', [mid]))
    .rows[0];
  owner = await login(app, 'owner@bunn.test');
  admin = await adminLogin(app, db);
  customer = await login(app, 'plan-qa-' + randomUUID() + '@example.test');
  const p = (await app.inject({ url: '/api/v1/public/merchants/bunn' })).json().programs[0];
  const joined = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...customer, ...key() },
    payload: {
      merchantId: mid,
      programId: p.id,
      programVersionId: p.versionId,
      alias: 'عميلة الباقات',
      acceptedTerms: true,
      acceptedTermsHash: p.termsHash,
    },
  });
  assert.equal(joined.statusCode, 200, joined.body);
  membership = joined.json().membershipId;
});
after(async () => {
  // Put the seeded shop back exactly as it was for the other suites.
  await db.query(
    `UPDATE merchant_subscriptions SET plan_id=$2,status=$3,price_minor=$4,billing_period=$5,trial_ends_at=$6,
      current_period_start=$7,current_period_end=$8,pending_plan_id=NULL,pending_effective_at=NULL,past_due_since=$9,
      cancel_at_period_end=false WHERE merchant_id=$1`,
    [
      mid,
      saved.plan_id,
      saved.status,
      saved.price_minor,
      saved.billing_period,
      saved.trial_ends_at,
      saved.current_period_start,
      saved.current_period_end,
      saved.past_due_since,
    ],
  );
  await db.query("UPDATE merchants SET status='active' WHERE id=$1", [mid]);
  await db.query(
    "UPDATE branches SET status='active',locked_at=NULL WHERE merchant_id=$1 AND locked_at IS NOT NULL",
    [mid],
  );
  await db.query('DELETE FROM plan_keep_choices WHERE merchant_id=$1', [mid]);
  await db.query('UPDATE entitlement_overrides SET revoked_at=NULL WHERE id=ANY($1)', [
    [...revoked],
  ]);
  await app.close();
  await worker.end();
  await db.end();
});

async function setPlan(plan: string, status = 'active') {
  await db.query(
    `UPDATE merchant_subscriptions SET plan_id=(SELECT id FROM plans WHERE key=$2),status=$3,
      past_due_since=CASE WHEN $3 IN ('past_due','grace') THEN clock_timestamp()-interval '8 days' END,
      trial_ends_at=CASE WHEN $3='trialing' THEN clock_timestamp()+interval '5 days' END,
      current_period_start=clock_timestamp()-interval '20 days',current_period_end=clock_timestamp()+interval '10 days'
     WHERE merchant_id=$1`,
    [mid, plan, status],
  );
  for (const r of (
    await db.query(
      'UPDATE entitlement_overrides SET revoked_at=clock_timestamp() WHERE merchant_id=$1 AND revoked_at IS NULL RETURNING id',
      [mid],
    )
  ).rows)
    revoked.add(r.id);
  await db.query('SELECT enforce_plan_limits($1)', [mid]);
}

// Words that would mean plan or billing state reached a customer.
const leak =
  /\b(plan|plans|subscription|entitlement|past_?due|grace|trialing|price_minor|max_branches|max_staff|addon|starter|growth|scale|enterprise)\b|باق[ةت]|اشتراك|جنيه|فترة سماح/i;
async function customerSurfaces() {
  const urls = [
    '/api/v1/public/merchants/bunn',
    '/api/v1/me/memberships',
    '/api/v1/me/memberships/' + membership,
    '/api/v1/me/memberships/' + membership + '/activity',
    '/api/v1/me/memberships/' + membership + '/rewards',
  ];
  const out: Record<string, string> = {};
  for (const url of urls) {
    const r = await app.inject({ url, headers: url.includes('/me/') ? customer : {} });
    assert.equal(r.statusCode, 200, url + ' ' + r.body);
    out[url] = r.body;
  }
  const card = (await db.query('SELECT wallet_card_json($1) AS c', [membership])).rows[0].c;
  out.walletCard = JSON.stringify(card);
  out.appleTexts = JSON.stringify(texts(card));
  const g = loadGoogleWallet(c)!;
  out.googleObject = JSON.stringify(
    googleObject(g, card, randomUUID(), 'https://perks.example', '1'),
  );
  return out;
}

test('acceptance 11: customer screens and Wallet cards never show plan, price, limit or billing text', async () => {
  for (const status of ['trialing', 'active', 'past_due', 'grace']) {
    await setPlan('growth', status);
    for (const [where, body] of Object.entries(await customerSurfaces()))
      assert.doesNotMatch(body, leak, status + ' → ' + where);
  }
  // Even a plan-limit refusal reaches staff, never a customer: customers have no such route.
  const tryPlan = await app.inject({
    url: '/api/v1/merchants/' + mid + '/plan',
    headers: customer,
  });
  assert.ok([403, 404].includes(tryPlan.statusCode));
});

test('acceptance 6: after a downgrade locks a branch, its customers’ cards still load', async () => {
  await setPlan('starter');
  const rows = (
    await db.query(
      "SELECT count(*) FILTER(WHERE status='active')::int AS active,count(*) FILTER(WHERE locked_at IS NOT NULL)::int AS locked FROM branches WHERE merchant_id=$1",
      [mid],
    )
  ).rows[0];
  assert.equal(rows.active, 1, 'starter keeps one branch working');
  assert.ok(rows.locked >= 1, 'the others are locked, not deleted');
  const cards = await app.inject({ url: '/api/v1/me/memberships', headers: customer });
  assert.equal(cards.statusCode, 200);
  assert.ok(cards.json().cards.some((x: { id: string }) => x.id === membership));
  const one = await app.inject({ url: '/api/v1/me/memberships/' + membership, headers: customer });
  assert.equal(one.statusCode, 200);
  const publicPage = await app.inject({ url: '/api/v1/public/merchants/bunn' });
  assert.equal(publicPage.statusCode, 200);
  assert.ok((await db.query('SELECT wallet_card_json($1) AS c', [membership])).rows[0].c.active);
  await setPlan('growth');
});

test('a cancelled shop is read-only: CSV export for 30 days, no new stamps, and it can ask to come back', async () => {
  await setPlan('growth', 'cancelled');
  const branch = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/branches',
    headers: { ...owner, ...key() },
    payload: { name: 'فرع جديد' },
  });
  assert.equal(branch.statusCode, 409);
  assert.equal(branch.json().error.code, 'SUBSCRIPTION_READ_ONLY');
  const branding = await app.inject({
    method: 'PATCH',
    url: '/api/v1/merchants/' + mid + '/branding',
    headers: { ...owner, ...key() },
    payload: {},
  });
  assert.equal(branding.json().error.code, 'SUBSCRIPTION_READ_ONLY');
  const exported = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/customer-exports',
    headers: { ...owner, ...key() },
    payload: { segment: 'all' },
  });
  assert.notEqual(exported.json().error?.code, 'SUBSCRIPTION_READ_ONLY', exported.body);
  // Reading still works.
  assert.equal(
    (await app.inject({ url: '/api/v1/merchants/' + mid, headers: owner })).statusCode,
    200,
  );
  // Asking to come back is allowed.
  const back = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/plan/requests',
    headers: { ...owner, ...key() },
    payload: { kind: 'change_plan', plan: 'growth', billingPeriod: 'monthly' },
  });
  assert.equal(back.statusCode, 200, back.body);
  await db.query("UPDATE plan_requests SET status='withdrawn',closed_at=now() WHERE id=$1", [
    back.json().id,
  ]);
  assert.equal(
    (await db.query('SELECT merchant_earning_allowed($1) AS a', [mid])).rows[0].a,
    false,
    'no new stamps once cancelled',
  );
  // After 30 days the export closes too.
  await db.query(
    "UPDATE merchant_subscriptions SET cancelled_at=clock_timestamp()-interval '31 days' WHERE merchant_id=$1",
    [mid],
  );
  const late = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/customer-exports',
    headers: { ...owner, ...key() },
    payload: { segment: 'all' },
  });
  assert.equal(late.json().error.code, 'SUBSCRIPTION_READ_ONLY');
  // Reactivating through the admin brings everything back.
  const rev = (
    await app.inject({ url: '/api/v1/platform/merchants/' + mid + '/billing', headers: admin })
  ).json().subscription.revision;
  const reactivate = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/merchants/' + mid + '/billing/reactivate',
    headers: { ...admin, ...key(), 'if-match': String(rev) },
    payload: { reason: 'Came back' },
  });
  assert.equal(reactivate.statusCode, 200, reactivate.body);
  assert.equal((await db.query('SELECT merchant_earning_allowed($1) AS a', [mid])).rows[0].a, true);
  assert.equal(
    (await db.query('SELECT cancelled_at FROM merchant_subscriptions WHERE merchant_id=$1', [mid]))
      .rows[0].cancelled_at,
    null,
  );
});

test('acceptance 12: the suspended-shop screen still works unchanged', async () => {
  await setPlan('growth');
  await db.query("UPDATE merchants SET status='suspended' WHERE id=$1", [mid]);
  const session = (await app.inject({ url: '/api/v1/session', headers: owner })).json();
  const grant = session.grants.find((g: { merchant_id: string }) => g.merchant_id === mid);
  assert.equal(grant.status, 'suspended', 'the web app shows the paused screen from this');
  const write = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/branches',
    headers: { ...owner, ...key() },
    payload: { name: 'فرع' },
  });
  assert.equal(write.statusCode, 409);
  assert.equal(write.json().error.code, 'MERCHANT_PAUSED', 'not a plan or read-only message');
  await db.query("UPDATE merchants SET status='active' WHERE id=$1", [mid]);
});

test('acceptance 7: the monthly message counter rolls over at 00:00 Cairo on the 1st', async () => {
  const at = (iso: string) =>
    db.query('SELECT usage_period($1::timestamptz)::text AS p', [iso]).then((r) => r.rows[0].p);
  // 21:59 UTC on 31 Oct is 23:59 in Cairo (UTC+2): still October.
  assert.equal(await at('2026-10-31T21:59:59Z'), '2026-10');
  assert.equal(await at('2026-10-31T22:00:00Z'), '2026-11');
  // Cairo summer time (UTC+3): 21:00 UTC on 31 May is midnight on 1 June.
  assert.equal(await at('2026-05-31T20:59:59Z'), '2026-05');
  assert.equal(await at('2026-05-31T21:00:00Z'), '2026-06');
});
