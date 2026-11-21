// Security H1: staff-assisted recovery by pairing code. Staff never hold a bearer link,
// a staff-paired device is scoped to that merchant, nothing is revoked, other devices
// are notified, cashier pairings need owner/manager approval, and everything is audited.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { tokenHash } from '../../apps/api/src/crypto.js';
import { enrollmentTerms, login, key } from '../helpers.js';
import type { LegalNotice } from '../../packages/contracts/src/legal.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const origin = 'https://pairing-fixture.nuqta.test';
const { app } = await buildApp({
  APP_ENV: 'test',
  COOKIE_SECURE: 'true',
  PUBLIC_APP_ORIGIN: origin,
  LOG_LEVEL: 'silent',
});
const programA = '40000000-0000-4000-8000-000000000001',
  versionA = '50000000-0000-4000-8000-000000000001',
  programB = '40000000-0000-4000-8000-000000000002',
  versionB = '50000000-0000-4000-8000-000000000002';
type Result = Awaited<ReturnType<typeof app.inject>>;
type Headers = Record<string, string>;
const cookie = (result: Result) =>
  result.cookies.map((item) => item.name + '=' + item.value).join('; ');
let placement: string,
  termsA: string,
  termsB: string,
  notice: LegalNotice,
  address = 1;
const managerEmail = 'manager-' + randomUUID() + '@bunn.test';

before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  placement = randomUUID().replaceAll('-', '');
  await db.query(
    "INSERT INTO placements(merchant_id,branch_id,label,kind,public_code,created_by) VALUES($1,$2,'Pairing fixture','stand',$3,$4)",
    [ids.merchantA, ids.branchA, placement, ids.ownerA],
  );
  termsA = await enrollmentTerms(app, programA);
  termsB = await enrollmentTerms(app, programB);
  notice = (await app.inject('/api/v1/public/legal?lang=en')).json();
  const uid = (
    await db.query(
      "INSERT INTO users(email,display_name,preferred_locale) VALUES($1,'Synthetic manager','en') RETURNING id",
      [managerEmail],
    )
  ).rows[0].id;
  const sid = (
    await db.query(
      "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,'Synthetic manager','manager') RETURNING id",
      [ids.merchantA, uid, managerEmail],
    )
  ).rows[0].id;
  await db.query(
    'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
    [ids.merchantA, sid, ids.branchA],
  );
});
after(async () => {
  await app.close();
  await db.end();
});

async function boot(): Promise<Headers> {
  const result = await app.inject({
    url: '/api/v1/customer/bootstrap',
    headers: { 'x-nuqta-workspace': 'customer' },
  });
  assert.equal(result.statusCode, 200);
  return {
    origin,
    cookie: cookie(result),
    'x-csrf-token': result.json().csrfToken,
    'x-nuqta-workspace': 'customer',
  };
}
const nextPhone = () => '0155' + String(randomInt(0, 10_000_000)).padStart(7, '0');
// A customer who registered on their own phone at merchant A (an unscoped device).
async function holder() {
  const phone = nextPhone(),
    headers = await boot();
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/customer/register',
    headers,
    remoteAddress: '198.51.100.' + address++,
    payload: {
      displayName: 'Synthetic holder',
      phone,
      merchantId: ids.merchantA,
      programId: programA,
      programVersionId: versionA,
      branchId: ids.branchA,
      placementCode: placement,
      acceptedTerms: true,
      acceptedTermsHash: termsA,
      acceptedPrivacyVersion: notice.acceptance.version,
      acceptedPrivacyHash: notice.acceptance.hash,
      acceptedPrivacyLocale: notice.locale,
      source: 'qr',
    },
  });
  assert.equal(result.statusCode, 200, result.body);
  const session: Headers = {
    origin,
    cookie: headers.cookie + '; ' + cookie(result),
    'x-csrf-token': result.json().csrfToken,
    'x-nuqta-workspace': 'customer',
  };
  const uid = (
    await db.query('SELECT customer_id FROM customer_identities WHERE phone_e164=$1', [
      '+2' + phone,
    ])
  ).rows[0].customer_id as string;
  return { phone, uid, session, membershipId: result.json().membershipId as string };
}
async function startPairing(device: Headers, merchantId = ids.merchantA) {
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/customer/pairings',
    headers: device,
    remoteAddress: '203.0.113.' + (address++ % 250),
    payload: { merchantId },
  });
  assert.equal(result.statusCode, 200, result.body);
  return result.json() as { id: string; code: string; status: string };
}
const claim = (staff: Headers, uid: string, code: string, branchId = ids.branchA) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/customer-pairings',
    headers: staff,
    payload: { customerId: uid, branchId, code, requestedByCustomer: true },
  });
const consume = (device: Headers, id: string) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/customer/pairings/' + id + '/consume',
    headers: device,
    payload: {},
  });
const sessionHeaders = (device: Headers, result: Result): Headers => ({
  origin,
  cookie: device.cookie + '; ' + cookie(result),
  'x-csrf-token': result.json().csrfToken,
  'x-nuqta-workspace': 'customer',
});

test('the old bearer-link endpoints are gone; staff responses never contain a link, token or code', async () => {
  const owner = await login(app, 'owner@bunn.test', origin);
  const old = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/customer-recovery',
    headers: { ...owner, ...key() },
    payload: {},
  });
  assert.equal(old.statusCode, 404);
  assert.equal(
    (await app.inject({ url: '/api/v1/customer/recoveries/' + 'a'.repeat(64) })).statusCode,
    404,
  );
  const h = await holder(),
    device = await boot(),
    pairing = await startPairing(device);
  assert.match(pairing.code, /^[0-9]{6}$/);
  const row = (await db.query('SELECT code_hash FROM customer_pairings WHERE id=$1', [pairing.id]))
    .rows[0];
  assert.notEqual(row.code_hash, pairing.code);
  assert.notEqual(row.code_hash, tokenHash(pairing.code));
  const claimed = await claim(owner, h.uid, pairing.code);
  assert.equal(claimed.statusCode, 200, claimed.body);
  assert.deepEqual(Object.keys(claimed.json()).sort(), ['id', 'status']);
  assert.ok(!claimed.body.includes(pairing.code));
  assert.ok(!/https?:|wa\.me|\/r\//.test(claimed.body));
});

test('owner pairing: only the requesting device can consume; old devices keep working and are notified; device is scoped to the merchant', async () => {
  const h = await holder(),
    owner = await login(app, 'owner@bunn.test', origin);
  // The same customer also holds a card at merchant B, joined from their own phone.
  const joinB = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...h.session, ...key() },
    payload: {
      merchantId: ids.merchantB,
      programId: programB,
      programVersionId: versionB,
      branchId: ids.branchB,
      alias: 'Synthetic holder',
      acceptedTerms: true,
      acceptedTermsHash: termsB,
      acceptedPrivacyVersion: notice.acceptance.version,
      acceptedPrivacyHash: notice.acceptance.hash,
      acceptedPrivacyLocale: notice.locale,
    },
  });
  assert.equal(joinB.statusCode, 200, joinB.body);
  const cardB = joinB.json().membershipId as string;

  const device = await boot(),
    pairing = await startPairing(device);
  const wrong = await claim(owner, h.uid, pairing.code === '000000' ? '000001' : '000000');
  assert.equal(wrong.statusCode, 422);
  assert.equal(wrong.json().error.code, 'PAIRING_CODE_INVALID');
  const claimed = await claim(owner, h.uid, pairing.code);
  assert.equal(claimed.json().status, 'approved');
  // Another browser cannot consume this pairing, even with the id.
  const stranger = await boot();
  assert.equal((await consume(stranger, pairing.id)).statusCode, 410);
  const status = await app.inject({
    url: '/api/v1/customer/pairings/' + pairing.id,
    headers: device,
  });
  assert.equal(status.json().status, 'approved');
  const done = await consume(device, pairing.id);
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().membershipId, h.membershipId);
  assert.equal((await consume(device, pairing.id)).statusCode, 410);
  const paired = sessionHeaders(device, done);

  // Scope: only merchant A is visible from the paired device.
  const cards = await app.inject({ url: '/api/v1/me/memberships', headers: paired });
  assert.equal(cards.statusCode, 200);
  assert.deepEqual(
    cards.json().cards.map((card: { merchant_id: string }) => card.merchant_id),
    [ids.merchantA],
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/me/memberships/' + cardB, headers: paired })).statusCode,
    404,
  );
  for (const provider of ['apple', 'google']) {
    const wallet = await app.inject({
      url: '/api/v1/me/memberships/' + h.membershipId + '/wallet/' + provider,
      headers: paired,
    });
    assert.equal(wallet.json().error.code, 'DEVICE_SCOPE_RECOVERY_REQUIRED');
  }
  const qrB = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships/' + cardB + '/presentation-tokens',
    headers: { ...paired, ...key() },
    payload: {},
  });
  assert.ok([403, 404].includes(qrB.statusCode), qrB.body);
  const deleteAll = await app.inject({
    method: 'POST',
    url: '/api/v1/me/privacy/delete',
    headers: { ...paired, ...key() },
    payload: { confirmed: true },
  });
  assert.notEqual(deleteAll.statusCode, 200);

  // The customer's own phone is untouched and still sees both shops.
  const original = await app.inject({ url: '/api/v1/me/memberships', headers: h.session });
  assert.equal(original.statusCode, 200);
  assert.equal(original.json().cards.length, 2);
  const devices = (
    await db.query(
      'SELECT trust_level,revoked_at FROM customer_devices WHERE customer_id=$1 ORDER BY created_at',
      [h.uid],
    )
  ).rows;
  assert.deepEqual(
    devices.map((d) => [d.trust_level, d.revoked_at]),
    [
      ['self_registered', null],
      ['staff_paired', null],
    ],
  );

  // The original phone sees a notice and can remove the new device; the paired one cannot.
  const notices = await app.inject({ url: '/api/v1/me/device-notices', headers: h.session });
  assert.equal(notices.statusCode, 200);
  const [item] = notices.json().notices;
  assert.equal(item.kind, 'device_paired');
  assert.equal(item.canRemove, true);
  assert.deepEqual(
    (await app.inject({ url: '/api/v1/me/device-notices', headers: paired })).json().notices,
    [],
  );
  const removed = await app.inject({
    method: 'POST',
    url: '/api/v1/me/device-notices/' + item.id,
    headers: h.session,
    payload: { removeDevice: true },
  });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(
    (await app.inject({ url: '/api/v1/me/memberships', headers: paired })).statusCode,
    401,
  );

  const audit = (
    await db.query(
      "SELECT action,actor_id,detail FROM audit_events WHERE target_id=$1 AND action LIKE 'customer.pairing.%' ORDER BY at,id",
      [h.uid],
    )
  ).rows;
  assert.deepEqual(
    audit.map((row) => row.action),
    [
      'customer.pairing.code_rejected',
      'customer.pairing.approved',
      'customer.pairing.consumed',
      'customer.pairing.device_removed',
    ],
  );
  assert.equal(audit[1].detail.staffId, ids.ownerA);
  assert.equal(audit[2].detail.staffId, ids.ownerA);
  assert.equal(audit[2].detail.revokedOldDevices, false);
  assert.ok(!JSON.stringify(audit).includes(h.phone.slice(1)));
});

// A shop where the customer has NO card may be added (049, covered in customer-identity-flows);
// a shop where they already have one stays closed to a phone restored elsewhere.
test('a staff-paired device cannot open another shop where the customer has a card', async () => {
  const h = await holder();
  const ownB = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...h.session, ...key() },
    payload: {
      merchantId: ids.merchantB,
      programId: programB,
      programVersionId: versionB,
      branchId: ids.branchB,
      alias: 'Synthetic holder',
      acceptedTerms: true,
      acceptedTermsHash: termsB,
      acceptedPrivacyVersion: notice.acceptance.version,
      acceptedPrivacyHash: notice.acceptance.hash,
      acceptedPrivacyLocale: notice.locale,
    },
  });
  assert.equal(ownB.statusCode, 200, ownB.body);
  const owner = await login(app, 'owner@bunn.test', origin),
    device = await boot(),
    pairing = await startPairing(device);
  await claim(owner, h.uid, pairing.code);
  const done = await consume(device, pairing.id);
  assert.equal(done.statusCode, 200, done.body);
  const paired = sessionHeaders(device, done);
  const enrollB = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...paired, ...key() },
    payload: {
      merchantId: ids.merchantB,
      programId: programB,
      programVersionId: versionB,
      branchId: ids.branchB,
      alias: 'Synthetic holder',
      acceptedTerms: true,
      acceptedTermsHash: termsB,
      acceptedPrivacyVersion: notice.acceptance.version,
      acceptedPrivacyHash: notice.acceptance.hash,
      acceptedPrivacyLocale: notice.locale,
    },
  });
  assert.equal(enrollB.statusCode, 409, enrollB.body);
  assert.equal(enrollB.json().error.code, 'DEVICE_SCOPE_RECOVERY_REQUIRED');
  const registerB = await app.inject({
    method: 'POST',
    url: '/api/v1/customer/register',
    headers: paired,
    remoteAddress: '198.51.100.' + address++,
    payload: {
      displayName: 'Synthetic holder',
      phone: h.phone,
      merchantId: ids.merchantB,
      programId: programB,
      programVersionId: versionB,
      branchId: ids.branchB,
      acceptedTerms: true,
      acceptedTermsHash: termsB,
      acceptedPrivacyVersion: notice.acceptance.version,
      acceptedPrivacyHash: notice.acceptance.hash,
      acceptedPrivacyLocale: notice.locale,
      source: 'link',
    },
  });
  assert.equal(registerB.statusCode, 409, registerB.body);
  assert.equal(registerB.json().error.code, 'DEVICE_SCOPE_RECOVERY_REQUIRED');
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM memberships WHERE user_id=$1 AND merchant_id=$2',
        [h.uid, ids.merchantB],
      )
    ).rows[0].n,
    1,
    'still only the card the customer made on their own phone',
  );
});

test('a cashier pairing waits for owner/manager approval; cashiers cannot approve and nobody approves their own claim', async () => {
  const h = await holder(),
    cashier = await login(app, 'cashier@bunn.test', origin),
    manager = await login(app, managerEmail, origin),
    device = await boot(),
    pairing = await startPairing(device);
  const claimed = await claim(cashier, h.uid, pairing.code);
  assert.equal(claimed.statusCode, 200, claimed.body);
  assert.equal(claimed.json().status, 'awaiting_approval');
  assert.equal((await consume(device, pairing.id)).statusCode, 410);
  const queuePath = '/api/v1/merchants/' + ids.merchantA + '/customer-pairings';
  assert.equal((await app.inject({ url: queuePath, headers: cashier })).statusCode, 403);
  const queue = await app.inject({ url: queuePath, headers: manager });
  assert.equal(queue.statusCode, 200, queue.body);
  const pending = queue.json().pending.find((p: { id: string }) => p.id === pairing.id);
  assert.ok(pending);
  assert.ok(pending.phone.includes('•'));
  const decide = (who: Headers, approve: boolean) =>
    app.inject({
      method: 'POST',
      url: queuePath + '/' + pairing.id + '/decision',
      headers: who,
      payload: { approve },
    });
  assert.equal((await decide(cashier, true)).statusCode, 403);
  const approved = await decide(manager, true);
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal((await decide(manager, true)).json().error.code, 'PAIRING_NOT_PENDING');
  const done = await consume(device, pairing.id);
  assert.equal(done.statusCode, 200, done.body);
  const consumed = (
    await db.query(
      "SELECT detail FROM audit_events WHERE action='customer.pairing.consumed' AND detail->>'pairingId'=$1",
      [pairing.id],
    )
  ).rows[0].detail;
  assert.equal(consumed.staffId, ids.cashier);
  assert.notEqual(consumed.approverId, ids.cashier);

  // An owner/manager's own claim is direct, so self-approval only matters for queued claims.
  const other = await boot(),
    second = await startPairing(other);
  await claim(cashier, h.uid, second.code);
  await db.query(
    'UPDATE customer_pairings SET requested_by=(SELECT id FROM users WHERE email=$1) WHERE id=$2',
    [managerEmail, second.id],
  );
  const self = await app.inject({
    method: 'POST',
    url: queuePath + '/' + second.id + '/decision',
    headers: manager,
    payload: { approve: true },
  });
  assert.equal(self.json().error.code, 'PAIRING_SELF_APPROVAL');
});

test('owners see staff with unusual recovery counts; cashier pairing still obeys the owner switch', async () => {
  const owner = await login(app, 'owner@bunn.test', origin),
    cashier = await login(app, 'cashier@bunn.test', origin);
  for (let n = 0; n < 5; n++) {
    const h = await holder(),
      p = await startPairing(await boot());
    assert.equal((await claim(cashier, h.uid, p.code)).statusCode, 200);
  }
  const queue = await app.inject({
    url: '/api/v1/merchants/' + ids.merchantA + '/customer-pairings',
    headers: owner,
  });
  const flagged = queue.json().flaggedStaff as { staffName: string; count: number }[];
  assert.ok(
    flagged.some((row) => row.count >= 5),
    queue.body,
  );

  const policy = '/api/v1/merchants/' + ids.merchantA + '/customer-recovery-settings';
  const settings = (await app.inject({ url: policy, headers: owner })).json();
  const off = await app.inject({
    method: 'PATCH',
    url: policy,
    headers: { ...owner, 'if-match': String(settings.revision) },
    payload: { cashierEnabled: false },
  });
  assert.equal(off.statusCode, 200);
  const h = await holder(),
    p = await startPairing(await boot()),
    blocked = await claim(cashier, h.uid, p.code);
  assert.equal(blocked.json().error.code, 'CASHIER_RECOVERY_DISABLED');
  await app.inject({
    method: 'PATCH',
    url: policy,
    headers: { ...owner, 'if-match': String(off.json().revision) },
    payload: { cashierEnabled: true },
  });
});

test('every SECURITY DEFINER function that trusts customer ownership also checks the device scope', async () => {
  // Staff-side helpers compare app_user() to staff rows, not customer rows.
  const staffSide = new Set([
    'accept_customer_legal',
    'branch_access',
    'can_manage_staff_credentials',
    'create_merchant_branch',
    'create_staff_password_account',
    'customer_directory',
    'customer_recovery_role',
    'customer_scope_fingerprint',
    'customer_session_current',
    'manage_platform_admin',
    'manage_staff_security',
    'owner_full_customer_scope',
    'set_customer_recovery_policy',
    'staff_account_security',
    'tenant_access',
    'ticket_access',
    'delete_customer_identity',
    // Device-level or staff-level pairing functions: they act on the session's own device or
    // on staff rows, never on another merchant's customer data.
    'apply_customer_device_scope',
    'my_device_notices',
    'resolve_device_notice',
    'customer_pairing_queue',
    'decide_customer_pairing',
    // Staff-side role checks (owner/active staff of a merchant), like tenant_access above.
    'acting_staff',
    'is_active_owner',
    'merchant_owner',
    // A staff member's own wrong 6-digit customer codes (047).
    'short_code_attempt_allowed',
    'short_code_failed',
    // Widens the session's own device scope to a shop where the customer has no card (049).
    'customer_join_new_shop',
  ]);
  const rows = (
    await db.query(
      String.raw`SELECT p.proname,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.prosecdef AND p.prosrc ~ '(user_id|holder_user_id|created_by)\s*=\s*app_user\(\)'`,
    )
  ).rows as { proname: string; prosrc: string }[];
  const missing = rows
    .filter((row) => !staffSide.has(row.proname) && !row.prosrc.includes('customer_scope_ok'))
    .map((row) => row.proname);
  assert.deepEqual(missing, []);
  const deletion = rows.find((row) => row.proname === 'delete_customer_identity');
  assert.ok(deletion?.prosrc.includes('customer_scope_unrestricted'));
});
